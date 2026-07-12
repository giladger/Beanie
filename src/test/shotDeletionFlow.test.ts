import type { BeanBatch, ShotRecord } from '../api/types';
import {
  ShotDeletionFlow,
  type ShotDeletionFlowDependencies,
  type ShotDeletionFlowSnapshot
} from '../controllers/shotDeletionFlow';

await run('shot deletion flow owns durable reclaim policy and returns typed projections', async () => {
  const calls: string[] = [];
  const snapshot = deletionSnapshot();
  let queuedExpected: number | null = null;
  let projectedRemaining: number | null | undefined;
  const flow = new ShotDeletionFlow(dependencies(snapshot, {
    deleteShot: async () => {
      calls.push('delete');
    },
    onRemoteDeleteSettled: () => {
      calls.push('fence');
    },
    enqueueReclaim: async (input) => {
      calls.push('enqueue');
      queuedExpected = input.expectedRemaining ?? null;
      return {
        inserted: true,
        idempotencyKey: 'reclaim-1',
        settlementPending: true,
        expectedRemaining: input.expectedRemaining,
        durability: 'indexeddb',
        releaseProjection: () => {
          calls.push('release');
        }
      };
    },
    invalidateShotMutation: async () => {
      calls.push('invalidate');
    },
    commitInventoryProjection: (projection) => {
      calls.push('commit');
      projectedRemaining = projection.batches[0]?.weightRemaining;
    }
  }));

  const result = await flow.execute(deleteInput());

  equal(result.type, 'deleted');
  equal(calls.join(','), 'delete,fence,enqueue,invalidate,commit,release');
  equal(queuedExpected, 100);
  equal(projectedRemaining, 100);
  equal(result.type === 'deleted' ? result.shotProjection.shots.length : null, 0);
  equal(result.type === 'deleted' ? result.shotProjection.shotsTotal : null, 0);
});

await run('shot deletion flow does not invent a reclaim after a retry 404', async () => {
  const missing = new Error('missing');
  const snapshot = deletionSnapshot();
  let enqueueCalls = 0;
  const flow = new ShotDeletionFlow(dependencies(snapshot, {
    deleteShot: async () => {
      throw missing;
    },
    isAlreadyDeleted: (error) => error === missing,
    existingReclaim: async () => null,
    enqueueReclaim: async () => {
      enqueueCalls += 1;
      return { inserted: true, idempotencyKey: 'reclaim-1', settlementPending: true, expectedRemaining: 100, durability: 'indexeddb', releaseProjection: () => {} };
    }
  }));

  const result = await flow.execute(deleteInput());

  equal(result.type, 'deleted');
  equal(enqueueCalls, 0);
  equal(result.type === 'deleted' ? result.status : null, 'Shot already deleted · Bag unchanged');
  equal(result.type === 'deleted' ? result.shotProjection.shotsTotal : null, 1);
});

await run('shot deletion flow fences inventory changes that land during cache cleanup', async () => {
  let snapshot = deletionSnapshot();
  let projectionCalls = 0;
  const flow = new ShotDeletionFlow(dependencies(() => snapshot, {
    invalidateShotMutation: async () => {
      snapshot = {
        ...snapshot,
        batchesByBean: {
          'bean-1': [{ ...snapshot.batchesByBean['bean-1']![0]!, weightRemaining: 70 }]
        }
      };
    },
    commitInventoryProjection: () => {
      projectionCalls += 1;
    }
  }));

  const result = await flow.execute(deleteInput());

  equal(result.type, 'deleted');
  equal(projectionCalls, 0);
  equal(result.type === 'deleted' ? result.inventoryReviewBeanId : null, 'bean-1');
});

await run('reclaim admission captures stock before DELETE and cannot overwrite an edit made while it waits', async () => {
  let snapshot = deletionSnapshot();
  let revision = 0;
  let resolveDelete!: () => void;
  const deleteGate = new Promise<void>((resolve) => { resolveDelete = resolve; });
  let queuedExpected: number | null = null;
  let projectionCalls = 0;
  const flow = new ShotDeletionFlow(dependencies(() => snapshot, {
    deleteShot: () => deleteGate,
    remainingWeightRevision: () => revision,
    enqueueReclaim: async (input) => {
      queuedExpected = input.expectedRemaining;
      return {
        inserted: true,
        idempotencyKey: 'reclaim-1',
        settlementPending: true,
        expectedRemaining: input.expectedRemaining,
        durability: 'indexeddb',
        releaseProjection: () => {}
      };
    },
    commitInventoryProjection: () => { projectionCalls += 1; }
  }));

  const deleting = flow.execute(deleteInput());
  await Promise.resolve();
  snapshot = {
    ...snapshot,
    batchesByBean: {
      'bean-1': [{ ...snapshot.batchesByBean['bean-1']![0]!, weightRemaining: 60 }]
    }
  };
  revision = 1;
  resolveDelete();
  const result = await deleting;

  equal(result.type, 'deleted');
  equal(queuedExpected, 100);
  equal(projectionCalls, 0);
  equal(result.type === 'deleted' ? result.inventoryReviewBeanId : null, 'bean-1');
});

await run('untracked local stock refuses a non-replay-safe reclaim and requests review', async () => {
  const base = deletionSnapshot();
  const snapshot: ShotDeletionFlowSnapshot = {
    ...base,
    batchesByBean: {
      'bean-1': [{ ...base.batchesByBean['bean-1']![0]!, weightRemaining: null }]
    }
  };
  let enqueueCalls = 0;
  let projectionCalls = 0;
  const flow = new ShotDeletionFlow(dependencies(snapshot, {
    enqueueReclaim: async (input) => {
      void input;
      enqueueCalls += 1;
      return { inserted: true, idempotencyKey: 'reclaim-1', settlementPending: true, expectedRemaining: 100, durability: 'indexeddb', releaseProjection: () => {} };
    },
    commitInventoryProjection: () => { projectionCalls += 1; }
  }));

  const result = await flow.execute(deleteInput());

  equal(result.type, 'deleted');
  equal(enqueueCalls, 0);
  equal(projectionCalls, 0);
  equal(result.type === 'deleted' ? result.inventoryReviewBeanId : null, 'bean-1');
  equal(result.type === 'deleted' ? result.status : null, 'Shot deleted · Bag reclaim unavailable');
});

await run('shot deletion flow resumes only its existing volatile reclaim and requests review', async () => {
  const missing = new Error('missing');
  const snapshot = deletionSnapshot();
  let wakeCalls = 0;
  const flow = new ShotDeletionFlow(dependencies(snapshot, {
    deleteShot: async () => {
      throw missing;
    },
    isAlreadyDeleted: (error) => error === missing,
    existingReclaim: async () => ({
      beanId: 'bean-1',
      batchId: 'batch-1',
      dose: 18,
      state: 'pending',
      expectedRemaining: 100,
      durability: 'volatile'
    }),
    wakeReconciliation: () => {
      wakeCalls += 1;
    }
  }));

  const result = await flow.execute(deleteInput());

  equal(result.type, 'deleted');
  equal(wakeCalls, 1);
  equal(result.type === 'deleted' ? result.inventoryReviewBeanId : null, 'bean-1');
  equal(result.type === 'deleted' ? result.status : null,
    'Shot already deleted · Bag: 100g left · storage unavailable');
});

await run('shot deletion flow reports an acknowledged reclaim receipt without waking work', async () => {
  const missing = new Error('missing');
  let wakeCalls = 0;
  const flow = new ShotDeletionFlow(dependencies(deletionSnapshot(), {
    deleteShot: async () => {
      throw missing;
    },
    isAlreadyDeleted: (error) => error === missing,
    existingReclaim: async () => ({
      beanId: 'bean-1',
      batchId: 'batch-1',
      dose: 18,
      state: 'acknowledged',
      outcome: 'committed',
      resolvedRemaining: 96,
      durability: 'indexeddb'
    }),
    wakeReconciliation: () => {
      wakeCalls += 1;
    }
  }));

  const result = await flow.execute(deleteInput());

  equal(result.type, 'deleted');
  equal(wakeCalls, 0);
  equal(result.type === 'deleted' ? result.inventoryReviewBeanId : null, 'bean-1');
  equal(result.type === 'deleted' ? result.status : null,
    'Shot already deleted · Bag: 96g left');
});

await run('demo deletion cannot project into a replacement live runtime', async () => {
  let runtimeRevision = 0;
  let resolveReclaim!: (outcome: Awaited<ReturnType<ShotDeletionFlowDependencies['reclaimDemo']>>) => void;
  const reclaimGate = new Promise<Awaited<ReturnType<ShotDeletionFlowDependencies['reclaimDemo']>>>(
    (resolve) => { resolveReclaim = resolve; }
  );
  let inventoryCommits = 0;
  const snapshot = deletionSnapshot();
  const flow = new ShotDeletionFlow(dependencies(snapshot, {
    runtimeRevision: () => runtimeRevision,
    reclaimDemo: () => reclaimGate,
    commitInventoryProjection: () => { inventoryCommits += 1; }
  }));

  const deleting = flow.execute({ ...deleteInput(), demo: true });
  await Promise.resolve();
  runtimeRevision += 1;
  resolveReclaim({
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
  });
  const result = await deleting;

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
    deleteShot: async () => {},
    isAlreadyDeleted: () => false,
    onRemoteDeleteSettled: () => {},
    invalidateShotMutation: async () => {},
    reclaimDemo: async () => ({
      type: 'not-applicable',
      reason: 'missing-batch',
      status: 'Dose reclaim not applicable'
    }),
    existingReclaim: async () => null,
    enqueueReclaim: async () => ({
      inserted: true,
      idempotencyKey: 'reclaim-1',
      settlementPending: true,
      expectedRemaining: 100,
      durability: 'indexeddb',
      releaseProjection: () => {}
    }),
    remainingWeightRevision: () => 0,
    reservePendingRemainingWeight: () => true,
    retainPendingRemainingWeight: () => true,
    releasePendingRemainingWeight: () => {},
    commitInventoryProjection: () => {},
    wakeReconciliation: () => {},
    now: () => new Date('2026-07-12T10:00:00.000Z'),
    ...overrides
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
