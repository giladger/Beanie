import type { BeanBatch, ShotRecord } from '../api/types';
import {
  ShotDeletionFlow as ProductionShotDeletionFlow,
  type CompletedShotDeletionFlowResult,
  type ShotDeletionFlowDependencies,
  type ShotDeletionFlowSnapshot
} from '../controllers/shotDeletionFlow';
import {
  shotDeleteReclaimIdempotencyKey,
  type PreparedShotDeleteReclaim,
  type ShotDeleteReclaimClaim,
  type ShotDeleteReclaimTransaction
} from '../controllers/doseMutationReconciler';
import {
  IdempotencyConflictError,
  pendingDoseReclaimIdempotencyKey
} from '../domain/mutationOutbox';
import type { BackgroundTaskScheduler } from '../runtime/backgroundTask';

const SOURCE_ID = shotDeleteReclaimIdempotencyKey('shot-1');
const CHILD_ID = pendingDoseReclaimIdempotencyKey('shot-1', 'batch-1');

class InertScheduler implements BackgroundTaskScheduler {
  cancelCalls = 0;
  readonly pending = new Set<number>();
  private nextHandle = 0;

  schedule(_callback: () => void, _delayMs: number): unknown {
    const handle = ++this.nextHandle;
    this.pending.add(handle);
    return handle;
  }

  cancel(handle: unknown): void {
    this.cancelCalls += 1;
    this.pending.delete(handle as number);
  }
}

/** Every flow uses a non-host scheduler unless a test explicitly supplies one. */
class ShotDeletionFlow extends ProductionShotDeletionFlow {
  constructor(
    deps: ShotDeletionFlowDependencies,
    options: { readonly scheduler?: BackgroundTaskScheduler } = {}
  ) {
    super(deps, { scheduler: options.scheduler ?? new InertScheduler() });
  }
}

await run('durable prepare precedes DELETE and the claim is acquired inside the exact shot lane', async () => {
  const calls: string[] = [];
  const reservations: string[] = [];
  const retained: string[] = [];
  let laneActive = false;
  let preparedTransaction: ShotDeleteReclaimTransaction | null = null;
  let projectedRemaining: number | null | undefined;
  let handoffOutcome: string | null = null;
  let barrierReleased = false;
  const flow = new ShotDeletionFlow(dependencies(deletionSnapshot(), {
    reservePendingRemainingWeight: (reservation) => {
      reservations.push(reservation.idempotencyKey);
      calls.push(`reserve:${reservation.idempotencyKey}`);
      return true;
    },
    retainPendingRemainingWeight: (adjustment) => {
      retained.push(adjustment.idempotencyKey);
      calls.push(`retain:${adjustment.idempotencyKey}`);
      return true;
    },
    releasePendingRemainingWeight: (idempotencyKey) => {
      calls.push(`release:${idempotencyKey}`);
    },
    prepareShotDeleteReclaim: async (input) => {
      calls.push('prepare');
      preparedTransaction = input;
      equal(input.expectedRemaining, 100);
      return prepared(input);
    },
    runDeleteShotTransaction: async (shotId, execute) => {
      equal(shotId, 'shot-1');
      calls.push('lane');
      laneActive = true;
      try {
        return await execute(async () => {
          equal(laneActive, true);
          calls.push('delete');
        });
      } finally {
        laneActive = false;
      }
    },
    claimShotDeleteReclaim: async (idempotencyKey) => {
      equal(laneActive, true);
      calls.push('claim');
      return claim(idempotencyKey, preparedTransaction ?? transaction());
    },
    onRemoteDeleteSettled: () => {
      calls.push('fence');
    },
    handoffShotDeleteReclaim: async (_claim, outcome) => {
      equal(laneActive, true);
      calls.push(`handoff:${outcome}`);
      handoffOutcome = outcome;
      return reclaimResult(() => {
        barrierReleased = true;
        calls.push('release-barrier');
      });
    },
    wakeReconciliation: () => {
      calls.push('wake');
    },
    invalidateShotMutation: async () => {
      calls.push('invalidate');
    },
    commitInventoryProjection: (projection) => {
      equal(barrierReleased, false);
      equal(retained.includes(CHILD_ID), true);
      calls.push('commit');
      projectedRemaining = projection.batches[0]?.weightRemaining;
    }
  }));

  const result = await flow.execute(deleteInput());

  equal(result.type, 'deleted');
  equal(handoffOutcome, 'committed');
  equal(projectedRemaining, 100);
  equal(barrierReleased, true);
  equal(reservations[0], SOURCE_ID);
  equal(reservations[1], CHILD_ID);
  equal(retained.join(','), CHILD_ID);
  assertOrdered(calls, [
    `reserve:${SOURCE_ID}`,
    'prepare',
    'lane',
    'claim',
    'delete',
    'fence',
    'handoff:committed',
    `reserve:${CHILD_ID}`,
    `retain:${CHILD_ID}`,
    'wake',
    `release:${SOURCE_ID}`,
    'invalidate',
    'commit',
    'release-barrier'
  ]);
  equal(result.type === 'deleted' ? result.shotProjection.shots.length : null, 0);
  equal(result.type === 'deleted' ? result.shotProjection.shotsTotal : null, 0);
});

await run('handoff to an acknowledged child reports its terminal receipt instead of queued work', async () => {
  let existingCalls = 0;
  let childReservations = 0;
  const flow = new ShotDeletionFlow(dependencies(deletionSnapshot(), {
    handoffShotDeleteReclaim: async () => ({
      inserted: false,
      idempotencyKey: CHILD_ID,
      settlementPending: false,
      expectedRemaining: 98,
      durability: 'indexeddb',
      releaseProjection: () => {}
    }),
    existingReclaim: async (_shotId, _batchId, projectionRevision) => {
      equal(projectionRevision, 0);
      existingCalls += 1;
      return {
        beanId: 'bean-1',
        batchId: 'batch-1',
        dose: 18,
        state: 'acknowledged',
        outcome: 'committed',
        resolvedRemaining: 98,
        durability: 'indexeddb'
      };
    },
    reservePendingRemainingWeight: (reservation) => {
      if (reservation.idempotencyKey === CHILD_ID) childReservations += 1;
      return true;
    }
  }));

  const result = await flow.execute(deleteInput());

  equal(result.type, 'deleted');
  equal(existingCalls, 1);
  equal(childReservations, 0);
  equal(result.type === 'deleted' ? result.reclaim?.type : null, 'reclaimed');
  equal(result.type === 'deleted' && result.reclaim?.type === 'reclaimed'
    ? result.reclaim.resolvedRemaining
    : null, 98);
  equal(result.type === 'deleted' ? result.status : null, 'Shot deleted · Bag: 98g left');
});

await run('cache-time inventory changes fence the optimistic reclaim and request review', async () => {
  let snapshot = deletionSnapshot();
  let revision = 0;
  let commitCalls = 0;
  const flow = new ShotDeletionFlow(dependencies(() => snapshot, {
    remainingWeightRevision: () => revision,
    invalidateShotMutation: async () => {
      snapshot = {
        ...snapshot,
        batchesByBean: {
          'bean-1': [{ ...snapshot.batchesByBean['bean-1']![0]!, weightRemaining: 70 }]
        }
      };
      revision += 1;
    },
    commitInventoryProjection: () => {
      commitCalls += 1;
    }
  }));

  const result = await flow.execute(deleteInput());

  equal(result.type, 'deleted');
  equal(commitCalls, 0);
  equal(snapshot.batchesByBean['bean-1']?.[0]?.weightRemaining, 70);
  equal(result.type === 'deleted' ? result.inventoryReviewBeanId : null, 'bean-1');
  equal(result.type === 'deleted' ? result.reclaim?.type : null, 'queued');
});

await run('a first owned 404 atomically hands off the reclaim without decrementing remote total', async () => {
  const missing = new Error('missing');
  let outcome: string | null = null;
  let fenceCalls = 0;
  const flow = new ShotDeletionFlow(dependencies(deletionSnapshot(), {
    runDeleteShotTransaction: async (_shotId, execute) => execute(async () => {
      throw missing;
    }),
    isAlreadyDeleted: (error) => error === missing,
    onRemoteDeleteSettled: () => {
      fenceCalls += 1;
    },
    handoffShotDeleteReclaim: async (_claim, value) => {
      outcome = value;
      return reclaimResult();
    }
  }));

  const result = await flow.execute(deleteInput());

  equal(result.type, 'deleted');
  equal(outcome, 'already-applied');
  equal(fenceCalls, 1);
  equal(result.type === 'deleted' ? result.deleteAlreadyAbsent : null, true);
  equal(result.type === 'deleted' ? result.shotProjection.shots.length : null, 0);
  equal(result.type === 'deleted' ? result.shotProjection.shotsTotal : null, 1);
  equal(result.type === 'deleted' ? result.status : null, 'Shot already deleted · Bag: 100g left');
});

await run('acknowledged source outcome distinguishes committed DELETE from already absent', async () => {
  for (const deleteOutcome of ['committed', 'already-applied'] as const) {
    let laneCalls = 0;
    let existingCalls = 0;
    const flow = new ShotDeletionFlow(dependencies(deletionSnapshot(), {
      prepareShotDeleteReclaim: async () => ({
        ...prepared(transaction()),
        inserted: false,
        state: 'acknowledged',
        deleteOutcome
      }),
      runDeleteShotTransaction: async () => {
        laneCalls += 1;
        throw new Error('acknowledged source must not dispatch DELETE');
      },
      existingReclaim: async () => {
        existingCalls += 1;
        return {
          beanId: 'bean-1',
          batchId: 'batch-1',
          dose: 18,
          state: 'acknowledged',
          outcome: 'committed',
          resolvedRemaining: 100,
          durability: 'indexeddb'
        };
      }
    }));

    const result = await flow.execute(deleteInput());

    equal(result.type, 'deleted');
    equal(laneCalls, 0);
    equal(existingCalls, 1);
    equal(result.type === 'deleted' ? result.deleteAlreadyAbsent : null,
      deleteOutcome === 'already-applied');
    equal(result.type === 'deleted' ? result.reclaim?.type : null, 'reclaimed');
    equal(result.type === 'deleted' ? result.shotProjection.shots.length : null, 0);
    equal(result.type === 'deleted' ? result.shotProjection.shotsTotal : null,
      deleteOutcome === 'committed' ? 0 : 1);
    equal(result.type === 'deleted' ? result.status : null,
      deleteOutcome === 'committed'
        ? 'Shot deleted · Bag: 100g left'
        : 'Shot already deleted · Bag: 100g left');
  }
});

await run('a non-404 DELETE failure retains the transaction for retry and leaves the shot visible', async () => {
  const offline = new Error('offline');
  const retryAt = new Date('2026-07-12T10:00:30.000Z');
  const retriedIds: string[] = [];
  let handoffCalls = 0;
  let cacheCalls = 0;
  let fenceCalls = 0;
  const releases: string[] = [];
  const notifications: Array<{ error: unknown; retryAt: Date | null }> = [];
  const snapshot = deletionSnapshot();
  const flow = new ShotDeletionFlow(dependencies(snapshot, {
    runDeleteShotTransaction: async (_shotId, execute) => execute(async () => {
      throw offline;
    }),
    retryShotDeleteReclaim: async (claimed, error) => {
      equal(error, offline);
      retriedIds.push(claimed.idempotencyKey);
      return { retained: true, retryAt, attemptCount: claimed.attemptCount };
    },
    onTransactionRetry: (error, at) => {
      notifications.push({ error, retryAt: at });
    },
    handoffShotDeleteReclaim: async () => {
      handoffCalls += 1;
      return reclaimResult();
    },
    onRemoteDeleteSettled: () => {
      fenceCalls += 1;
    },
    invalidateShotMutation: async () => {
      cacheCalls += 1;
    },
    releasePendingRemainingWeight: (idempotencyKey) => {
      releases.push(idempotencyKey);
    }
  }));

  const result = await flow.execute(deleteInput());

  equal(result.type, 'queued');
  equal(result.type === 'queued' ? result.status : null, 'Delete queued — will retry');
  equal(retriedIds.join(','), SOURCE_ID);
  equal(notifications.length, 1);
  equal(notifications[0]?.retryAt?.toISOString(), retryAt.toISOString());
  equal(handoffCalls, 0);
  equal(fenceCalls, 0);
  equal(cacheCalls, 0);
  equal(releases.length, 0);
  equal(snapshot.shots.length, 1);
  equal(snapshot.shotsTotal, 1);
});

await run('a queued reclaim source prevents a later delete-without-reclaim from issuing bare DELETE', async () => {
  const scheduler = new InertScheduler();
  let claimCalls = 0;
  let remoteDeleteCalls = 0;
  let laneCalls = 0;
  const releases: string[] = [];
  const flow = new ShotDeletionFlow(dependencies(deletionSnapshot(), {
    runDeleteShotTransaction: async (_shotId, execute) => {
      laneCalls += 1;
      return execute(async () => {
        remoteDeleteCalls += 1;
      });
    },
    claimShotDeleteReclaim: async () => {
      claimCalls += 1;
      return null;
    },
    releasePendingRemainingWeight: (idempotencyKey) => {
      releases.push(idempotencyKey);
    }
  }), { scheduler });

  const first = await flow.execute(deleteInput());
  const second = await flow.execute({ ...deleteInput(), reclaim: null });
  await waitFor(() => claimCalls >= 2);

  equal(first.type, 'queued');
  equal(second.type, 'queued');
  equal(remoteDeleteCalls, 0);
  equal(laneCalls >= 1, true);
  equal(releases.length, 0);
  await flow.disposeAndWait();
  equal(scheduler.pending.size, 0);
});

await run('exact-lane and claim exceptions retain the source and arm recovery', async () => {
  for (const failurePoint of ['lane', 'claim'] as const) {
    const scheduler = new InertScheduler();
    const failure = new Error(`${failurePoint} failed`);
    const retryErrors: unknown[] = [];
    const releases: string[] = [];
    let remoteDeleteCalls = 0;
    const flow = new ShotDeletionFlow(dependencies(deletionSnapshot(), {
      runDeleteShotTransaction: async (_shotId, execute) => {
        if (failurePoint === 'lane') throw failure;
        return execute(async () => {
          remoteDeleteCalls += 1;
        });
      },
      claimShotDeleteReclaim: async () => {
        if (failurePoint === 'claim') throw failure;
        return claim(SOURCE_ID, transaction());
      },
      onTransactionRetry: (error) => {
        retryErrors.push(error);
      },
      releasePendingRemainingWeight: (idempotencyKey) => {
        releases.push(idempotencyKey);
      }
    }), { scheduler });

    const result = await flow.execute(deleteInput());

    equal(result.type, 'queued');
    equal(retryErrors[0], failure);
    equal(remoteDeleteCalls, 0);
    equal(releases.length, 0);
    equal(scheduler.pending.size, 1);
    await flow.disposeAndWait();
    equal(scheduler.pending.size, 0);
  }
});

await run('persistent prepare rejection, including memory-only storage, never dispatches DELETE', async () => {
  for (const message of ['journal unavailable', 'Shot deletion requires persistent mutation storage']) {
    let laneCalls = 0;
    let claimCalls = 0;
    const releases: string[] = [];
    const flow = new ShotDeletionFlow(dependencies(deletionSnapshot(), {
      prepareShotDeleteReclaim: async () => {
        throw new Error(message);
      },
      runDeleteShotTransaction: async () => {
        laneCalls += 1;
        throw new Error('unexpected DELETE lane');
      },
      claimShotDeleteReclaim: async () => {
        claimCalls += 1;
        return null;
      },
      releasePendingRemainingWeight: (idempotencyKey) => {
        releases.push(idempotencyKey);
      }
    }));

    const result = await flow.execute(deleteInput());

    equal(result.type, 'failed');
    equal(laneCalls, 0);
    equal(claimCalls, 0);
    equal(releases.join(','), SOURCE_ID);
  }
});

await run('missing tracked remaining weight fails before journal prepare or DELETE', async () => {
  const base = deletionSnapshot();
  const snapshot: ShotDeletionFlowSnapshot = {
    ...base,
    batchesByBean: {
      'bean-1': [{ ...base.batchesByBean['bean-1']![0]!, weightRemaining: null }]
    }
  };
  let prepareCalls = 0;
  let laneCalls = 0;
  let reserveCalls = 0;
  const flow = new ShotDeletionFlow(dependencies(snapshot, {
    prepareShotDeleteReclaim: async (input) => {
      prepareCalls += 1;
      return prepared(input);
    },
    runDeleteShotTransaction: async () => {
      laneCalls += 1;
      throw new Error('unexpected DELETE lane');
    },
    reservePendingRemainingWeight: () => {
      reserveCalls += 1;
      return true;
    }
  }));

  const result = await flow.execute(deleteInput());

  equal(result.type, 'failed');
  equal(prepareCalls, 0);
  equal(laneCalls, 0);
  equal(reserveCalls, 0);
  equal(snapshot.shots.length, 1);
});

await run('handoff failure after DELETE leaves the source reservation owned for replay', async () => {
  const handoffError = new Error('handoff storage failed');
  const retryAt = new Date('2026-07-12T10:00:30.000Z');
  const releases: string[] = [];
  let retryError: unknown = null;
  let fenceCalls = 0;
  let cacheCalls = 0;
  const flow = new ShotDeletionFlow(dependencies(deletionSnapshot(), {
    onRemoteDeleteSettled: () => {
      fenceCalls += 1;
    },
    handoffShotDeleteReclaim: async () => {
      throw handoffError;
    },
    retryShotDeleteReclaim: async (claimed, error) => {
      retryError = error;
      return { retained: true, retryAt, attemptCount: claimed.attemptCount };
    },
    invalidateShotMutation: async () => {
      cacheCalls += 1;
    },
    releasePendingRemainingWeight: (idempotencyKey) => {
      releases.push(idempotencyKey);
    }
  }));

  const result = await flow.execute(deleteInput());

  equal(result.type, 'queued');
  equal(retryError, handoffError);
  equal(fenceCalls, 1);
  equal(cacheCalls, 0);
  equal(releases.length, 0);
});

await run('a deterministic child conflict terminates the source and requests manual review', async () => {
  let terminationOutcome: string | null = null;
  let retryCalls = 0;
  const flow = new ShotDeletionFlow(dependencies(deletionSnapshot(), {
    handoffShotDeleteReclaim: async () => {
      throw new IdempotencyConflictError(CHILD_ID);
    },
    terminateShotDeleteReclaim: async (_claim, _reason, outcome) => {
      terminationOutcome = outcome;
      return true;
    },
    retryShotDeleteReclaim: async (claimed) => {
      retryCalls += 1;
      return {
        retained: true,
        retryAt: new Date('2026-07-12T10:00:30.000Z'),
        attemptCount: claimed.attemptCount
      };
    }
  }));

  const result = await flow.execute(deleteInput());

  equal(result.type, 'deleted');
  equal(terminationOutcome, 'committed');
  equal(retryCalls, 0);
  equal(result.type === 'deleted' ? result.inventoryReviewBeanId : null, 'bean-1');
  equal(result.type === 'deleted' ? result.status : null, 'Shot deleted · Bag reclaim failed');
  equal(result.type === 'deleted' ? result.shotProjection.shots.length : null, 0);
});

await run('recovery reserves without overlay, handles an owned 404, and completes through callback', async () => {
  const scheduler = new InertScheduler();
  const missing = new Error('missing');
  const pending = transaction();
  let releaseDelete!: () => void;
  const deleteGate = new Promise<void>((resolve) => {
    releaseDelete = resolve;
  });
  let deleteStarted = false;
  const reservations: string[] = [];
  const retained: string[] = [];
  const releases: string[] = [];
  const recovered: CompletedShotDeletionFlowResult[] = [];
  const calls: string[] = [];
  let barrierReleased = false;
  let outcome: string | null = null;
  const flow = new ShotDeletionFlow(dependencies(deletionSnapshot(), {
    pendingShotDeleteReclaims: async () => [{
      idempotencyKey: SOURCE_ID,
      state: 'pending',
      transaction: pending
    }],
    reservePendingRemainingWeight: (reservation) => {
      reservations.push(reservation.idempotencyKey);
      calls.push(`reserve:${reservation.idempotencyKey}`);
      return true;
    },
    retainPendingRemainingWeight: (adjustment) => {
      retained.push(adjustment.idempotencyKey);
      calls.push(`retain:${adjustment.idempotencyKey}`);
      return true;
    },
    releasePendingRemainingWeight: (idempotencyKey) => {
      releases.push(idempotencyKey);
      calls.push(`release:${idempotencyKey}`);
    },
    runDeleteShotTransaction: async (_shotId, execute) => execute(async () => {
      deleteStarted = true;
      calls.push('delete');
      await deleteGate;
      throw missing;
    }),
    isAlreadyDeleted: (error) => error === missing,
    handoffShotDeleteReclaim: async (_claim, value) => {
      outcome = value;
      calls.push(`handoff:${value}`);
      return reclaimResult(() => {
        barrierReleased = true;
        calls.push('release-barrier');
      });
    },
    onRecoveredDeletion: (result) => {
      equal(barrierReleased, false);
      recovered.push(result);
      calls.push('recovered');
    }
  }), { scheduler });

  const starting = flow.start();
  await waitFor(() => deleteStarted);
  equal(reservations.join(','), SOURCE_ID);
  equal(retained.length, 0);
  equal(recovered.length, 0);

  releaseDelete();
  await starting;

  equal(outcome, 'already-applied');
  equal(reservations.join(','), `${SOURCE_ID},${CHILD_ID}`);
  equal(retained.join(','), CHILD_ID);
  equal(releases.includes(SOURCE_ID), true);
  equal(recovered.length, 1);
  equal(recovered[0]?.deleteAlreadyAbsent, true);
  equal(recovered[0]?.shotProjection.shots.length, 0);
  equal(recovered[0]?.shotProjection.shotsTotal, 1);
  equal(barrierReleased, true);
  assertOrdered(calls, [
    `reserve:${SOURCE_ID}`,
    'delete',
    'handoff:already-applied',
    `reserve:${CHILD_ID}`,
    `retain:${CHILD_ID}`,
    `release:${SOURCE_ID}`,
    'recovered',
    'release-barrier'
  ]);
  await flow.disposeAndWait();
  equal(scheduler.cancelCalls > 0, true);
  equal(scheduler.pending.size, 0);
});

await run('a later recovery pass observes another context handoff and resumes its child', async () => {
  const scheduler = new InertScheduler();
  const discovered = transaction();
  const reservations: string[] = [];
  const retained: string[] = [];
  const releases: string[] = [];
  const recovered: CompletedShotDeletionFlowResult[] = [];
  const existingProjectionRevisions: Array<number | undefined> = [];
  let discoveryCalls = 0;
  let prepareCalls = 0;
  let claimCalls = 0;
  let deleteCalls = 0;
  let anotherContextAcknowledged = false;
  let fenceCalls = 0;
  const flow = new ShotDeletionFlow(dependencies(deletionSnapshot(), {
    pendingShotDeleteReclaims: async () => {
      discoveryCalls += 1;
      return discoveryCalls === 1
        ? [{ idempotencyKey: SOURCE_ID, state: 'pending' as const, transaction: discovered }]
        : [];
    },
    prepareShotDeleteReclaim: async () => {
      prepareCalls += 1;
      return {
        ...prepared(discovered),
        inserted: false,
        state: anotherContextAcknowledged ? 'acknowledged' as const : 'pending' as const
      };
    },
    reservePendingRemainingWeight: (reservation) => {
      reservations.push(reservation.idempotencyKey);
      return true;
    },
    retainPendingRemainingWeight: (adjustment) => {
      retained.push(adjustment.idempotencyKey);
      return true;
    },
    releasePendingRemainingWeight: (idempotencyKey) => {
      releases.push(idempotencyKey);
    },
    runDeleteShotTransaction: async (_shotId, execute) => execute(async () => {
      deleteCalls += 1;
    }),
    claimShotDeleteReclaim: async () => {
      claimCalls += 1;
      return null;
    },
    remainingWeightRevision: () => 23,
    existingReclaim: async (_shotId, _batchId, projectionRevision) => {
      existingProjectionRevisions.push(projectionRevision);
      return {
        beanId: 'bean-1',
        batchId: 'batch-1',
        dose: 18,
        state: 'pending',
        expectedRemaining: 100,
        durability: 'indexeddb'
      };
    },
    onRemoteDeleteSettled: () => {
      fenceCalls += 1;
    },
    onRecoveredDeletion: (result) => {
      recovered.push(result);
    }
  }), { scheduler });

  await flow.start();

  equal(prepareCalls, 1);
  equal(claimCalls, 1);
  equal(deleteCalls, 0);
  equal(reservations.join(','), SOURCE_ID);
  equal(retained.length, 0);
  equal(releases.length, 0);
  equal(recovered.length, 0);

  anotherContextAcknowledged = true;
  await flow.trigger();
  await waitFor(() => recovered.length === 1);

  equal(prepareCalls, 2);
  equal(claimCalls, 1);
  equal(deleteCalls, 0);
  equal(reservations.join(','), `${SOURCE_ID},${SOURCE_ID},${CHILD_ID}`);
  equal(retained.join(','), CHILD_ID);
  equal(releases.join(','), SOURCE_ID);
  equal(existingProjectionRevisions.join(','), '23');
  equal(fenceCalls, 1);
  equal(recovered[0]?.deleteAlreadyAbsent, true);
  equal(recovered[0]?.reclaim?.type, 'queued');
  equal(recovered[0]?.shotProjection.shots.length, 0);
  await flow.disposeAndWait();
  equal(scheduler.pending.size, 0);
});

await run('demo reclaim remains local and never touches the durable transaction journal', async () => {
  const snapshot = deletionSnapshot();
  let prepareCalls = 0;
  let laneCalls = 0;
  let cacheCalls = 0;
  let projectedRemaining: number | null | undefined;
  const flow = new ShotDeletionFlow(dependencies(snapshot, {
    prepareShotDeleteReclaim: async (input) => {
      prepareCalls += 1;
      return prepared(input);
    },
    runDeleteShotTransaction: async () => {
      laneCalls += 1;
      throw new Error('unexpected live delete');
    },
    invalidateShotMutation: async () => {
      cacheCalls += 1;
    },
    reclaimDemo: async () => ({
      type: 'reclaimed',
      batch: { ...snapshot.batchesByBean['bean-1']![0]!, weightRemaining: 100 },
      projection: {
        beanId: 'bean-1',
        batches: [{ ...snapshot.batchesByBean['bean-1']![0]!, weightRemaining: 100 }],
        shouldScheduleApply: false
      },
      previousRemaining: 82,
      resolvedRemaining: 100,
      reclaimedDose: 18,
      status: 'Dose reclaimed (demo)'
    }),
    commitInventoryProjection: (projection) => {
      projectedRemaining = projection.batches[0]?.weightRemaining;
    }
  }));

  const result = await flow.execute({ ...deleteInput(), demo: true });

  equal(result.type, 'deleted');
  equal(result.type === 'deleted' ? result.status : null, 'Shot deleted (demo) · Bag: 100g left');
  equal(prepareCalls, 0);
  equal(laneCalls, 0);
  equal(cacheCalls, 0);
  equal(projectedRemaining, 100);
});

await run('dispose waits for an already-dispatched delete and its handoff continuation', async () => {
  let releaseDelete!: () => void;
  const deleteGate = new Promise<void>((resolve) => {
    releaseDelete = resolve;
  });
  let deleteStarted = false;
  let disposed = false;
  let handoffCalls = 0;
  const flow = new ShotDeletionFlow(dependencies(deletionSnapshot(), {
    runDeleteShotTransaction: async (_shotId, execute) => execute(async () => {
      deleteStarted = true;
      await deleteGate;
    }),
    handoffShotDeleteReclaim: async () => {
      handoffCalls += 1;
      return reclaimResult();
    }
  }));

  const deleting = flow.execute(deleteInput());
  await waitFor(() => deleteStarted);
  const draining = flow.disposeAndWait().then(() => {
    disposed = true;
  });
  await Promise.resolve();
  equal(disposed, false);

  releaseDelete();
  await Promise.all([deleting, draining]);

  equal(handoffCalls, 1);
  equal(disposed, true);
  equal((await flow.execute(deleteInput())).type, 'failed');
});

await run('a journaled delete cannot publish inventory into a replacement runtime', async () => {
  let runtimeRevision = 0;
  let inventoryCommits = 0;
  const flow = new ShotDeletionFlow(dependencies(deletionSnapshot(), {
    runtimeRevision: () => runtimeRevision,
    invalidateShotMutation: async () => {
      runtimeRevision += 1;
    },
    commitInventoryProjection: () => {
      inventoryCommits += 1;
    }
  }));

  const result = await flow.execute(deleteInput());

  equal(result.type, 'superseded');
  equal(inventoryCommits, 0);
});

function dependencies(
  snapshot: ShotDeletionFlowSnapshot | (() => ShotDeletionFlowSnapshot),
  overrides: Partial<ShotDeletionFlowDependencies> = {}
): ShotDeletionFlowDependencies {
  const read = typeof snapshot === 'function' ? snapshot : () => snapshot;
  return {
    snapshot: read,
    runtimeRevision: () => 0,
    runDeleteShotTransaction: async (_shotId, execute) => execute(async () => {}),
    isAlreadyDeleted: () => false,
    onRemoteDeleteSettled: () => {},
    invalidateShotMutation: async () => {},
    reclaimDemo: async () => ({
      type: 'not-applicable',
      reason: 'missing-batch',
      status: 'Dose reclaim not applicable'
    }),
    prepareShotDeleteReclaim: async (input) => prepared(input),
    pendingShotDeleteReclaims: async () => [],
    claimShotDeleteReclaim: async (idempotencyKey) => claim(idempotencyKey, transaction()),
    retryShotDeleteReclaim: async (claimed) => ({
      retained: true,
      retryAt: new Date('2026-07-12T10:00:30.000Z'),
      attemptCount: claimed.attemptCount
    }),
    terminateShotDeleteReclaim: async () => true,
    handoffShotDeleteReclaim: async () => reclaimResult(),
    existingReclaim: async () => null,
    remainingWeightRevision: () => 0,
    reservePendingRemainingWeight: () => true,
    retainPendingRemainingWeight: () => true,
    releasePendingRemainingWeight: () => {},
    commitInventoryProjection: () => {},
    wakeReconciliation: () => {},
    onRecoveredDeletion: () => {},
    onTransactionRetry: () => {},
    onAuxiliaryFailure: () => {},
    now: () => new Date('2026-07-12T10:00:00.000Z'),
    ...overrides
  };
}

function prepared(input: ShotDeleteReclaimTransaction): PreparedShotDeleteReclaim {
  return {
    idempotencyKey: shotDeleteReclaimIdempotencyKey(input.shotId),
    inserted: true,
    durability: 'indexeddb',
    state: 'pending',
    deleteOutcome: null,
    transaction: { ...input }
  };
}

function claim(
  idempotencyKey: string,
  value: ShotDeleteReclaimTransaction,
  attemptCount = 1
): ShotDeleteReclaimClaim {
  return {
    idempotencyKey,
    transaction: { ...value },
    leaseToken: `lease-${attemptCount}`,
    attemptCount
  };
}

function reclaimResult(releaseProjection: () => void = () => {}) {
  return {
    inserted: true,
    idempotencyKey: CHILD_ID,
    settlementPending: true,
    expectedRemaining: 100,
    durability: 'indexeddb' as const,
    releaseProjection
  };
}

function transaction(): ShotDeleteReclaimTransaction {
  return {
    shotId: 'shot-1',
    beanId: 'bean-1',
    batchId: 'batch-1',
    dose: 18,
    expectedRemaining: 100,
    at: '2026-07-12T10:00:00.000Z'
  };
}

function deletionSnapshot(): ShotDeletionFlowSnapshot {
  const batch: BeanBatch = {
    id: 'batch-1',
    beanId: 'bean-1',
    weight: 100,
    weightRemaining: 82
  };
  return {
    shots: [shot('shot-1')],
    shotsTotal: 1,
    detailShotId: 'shot-1',
    compareShotId: null,
    batchesByBean: { 'bean-1': [batch] }
  };
}

function deleteInput() {
  return {
    shotId: 'shot-1',
    demo: false,
    reclaim: { beanId: 'bean-1', batchId: 'batch-1', dose: 18 }
  } as const;
}

function shot(id: string): ShotRecord {
  return {
    id,
    timestamp: '2026-07-12T10:00:00.000Z',
    workflow: { context: { beanId: 'bean-1', beanBatchId: 'batch-1' } },
    annotations: { actualDoseWeight: 18 },
    measurements: []
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error('Timed out waiting for condition');
}

function assertOrdered(actual: readonly string[], expected: readonly string[]): void {
  let cursor = -1;
  for (const value of expected) {
    const found = actual.indexOf(value, cursor + 1);
    if (found < 0) {
      throw new Error(`Expected ${JSON.stringify(value)} after index ${cursor}; calls: ${actual.join(',')}`);
    }
    cursor = found;
  }
}

function run(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`ok - ${name}`);
    })
    .catch((error) => {
      console.error(`not ok - ${name}`);
      throw error;
    });
}

function equal<T>(actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(`Expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`);
  }
}
