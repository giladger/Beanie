import type { BeanBatch } from '../api/types';
import {
  DOSE_MUTATION_LEASE_MS,
  PENDING_DOSE_MUTATION_KIND,
  PENDING_DOSE_RECLAIM_MUTATION_KIND,
  PENDING_SHOT_DELETE_RECLAIM_KIND,
  DoseMutationReconciler,
  shotDeleteReclaimIdempotencyKey,
  type DoseMutationCanonicalization,
  type DoseMutationAdjustmentEntry,
  type DoseMutationRetry,
  type DoseMutationSettlement,
  type EnqueueDoseMutationInput,
  type EnqueueDoseReclaimInput
} from '../controllers/doseMutationReconciler';
import {
  DurableMutationOutbox,
  IdempotencyConflictError,
  MUTATION_OUTBOX_STORAGE_KEY,
  pendingDoseIdempotencyKey,
  pendingDoseReclaimIdempotencyKey,
  type DurableMutationOutboxOptions,
  type DurableMutationRecord,
  type MutationOutboxStorage
} from '../domain/mutationOutbox';
import type { PendingDose } from '../domain/pendingDoses';
import type { BackgroundTaskScheduler } from '../runtime/backgroundTask';
import { createFakeIndexedDb } from './fakeIndexedDb';

class FakeStorage implements MutationOutboxStorage {
  private readonly values = new Map<string, string>();
  readonly writes: string[] = [];

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.writes.push(key);
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  records(): DurableMutationRecord[] {
    const raw = this.getItem(MUTATION_OUTBOX_STORAGE_KEY);
    return raw ? JSON.parse(raw) as DurableMutationRecord[] : [];
  }
}

class FakeScheduler implements BackgroundTaskScheduler {
  private nextId = 1;
  readonly pending = new Map<number, { callback: () => void; delayMs: number }>();

  schedule(callback: () => void, delayMs: number): unknown {
    const id = this.nextId++;
    this.pending.set(id, { callback, delayMs });
    return id;
  }

  cancel(handle: unknown): void {
    this.pending.delete(handle as number);
  }
}

interface Harness {
  reconciler: DoseMutationReconciler;
  storage: FakeStorage;
  scheduler: FakeScheduler;
  batches: Map<string, BeanBatch>;
  updates: Array<{ id: string; patch: Partial<BeanBatch>; idempotencyKey: string }>;
  exactKeys: string[];
  saved: BeanBatch[];
  savedAdjustments: DoseMutationAdjustmentEntry[];
  settlements: DoseMutationSettlement[];
  canonicalizations: DoseMutationCanonicalization[];
  retries: DoseMutationRetry[];
  workerErrors: unknown[];
  setNow(value: string): void;
}

function createHarness(options: {
  storage?: FakeStorage;
  legacy?: PendingDose[];
  clearLegacy?: (storage: FakeStorage) => void;
  update?: (
    id: string,
    patch: Partial<BeanBatch>,
    idempotencyKey: string,
    batches: Map<string, BeanBatch>
  ) => Promise<BeanBatch>;
  beforeExact?: () => void;
  onAdjustmentSettled?: (settlement: DoseMutationSettlement) => void;
  onAdjustmentCanonicalized?: (canonicalization: DoseMutationCanonicalization) => void;
  outbox?: Omit<DurableMutationOutboxOptions, 'now'>;
} = {}): Harness {
  const storage = options.storage ?? new FakeStorage();
  const scheduler = new FakeScheduler();
  const batches = new Map<string, BeanBatch>();
  const updates: Harness['updates'] = [];
  const exactKeys: string[] = [];
  const saved: BeanBatch[] = [];
  const savedAdjustments: DoseMutationAdjustmentEntry[] = [];
  const settlements: DoseMutationSettlement[] = [];
  const canonicalizations: DoseMutationCanonicalization[] = [];
  const retries: DoseMutationRetry[] = [];
  const workerErrors: unknown[] = [];
  let legacy = [...(options.legacy ?? [])];
  let now = new Date('2026-07-10T10:00:00.000Z');
  let lease = 0;

  const reconciler = new DoseMutationReconciler({
    readBatch: async (id) => batches.get(id) ?? null,
    updateBatch: async (id, patch, { idempotencyKey }) => {
      updates.push({ id, patch, idempotencyKey });
      if (options.update) return options.update(id, patch, idempotencyKey, batches);
      const current = batches.get(id);
      if (!current) throw new Error(`Missing batch ${id}`);
      const savedBatch = { ...current, ...patch };
      batches.set(id, savedBatch);
      return savedBatch;
    },
    runExactAggregate: async (key, run) => {
      exactKeys.push(key);
      options.beforeExact?.();
      return await run();
    },
    readLegacy: () => legacy,
    clearLegacy: () => {
      options.clearLegacy?.(storage);
      legacy = [];
    },
    now: () => new Date(now),
    onAdjustmentCanonicalized: (canonicalization) => {
      canonicalizations.push(canonicalization);
      options.onAdjustmentCanonicalized?.(canonicalization);
    },
    onAdjustmentSettled: (settlement) => {
      settlements.push(settlement);
      if (settlement.outcome === 'committed') {
        const batch = batches.get(settlement.entry.batchId);
        if (batch) saved.push(batch);
        savedAdjustments.push(settlement.entry);
      }
      options.onAdjustmentSettled?.(settlement);
    },
    onRetryScheduled: (retry) => retries.push(retry),
    onWorkerError: (error) => workerErrors.push(error)
  }, {
    scheduler,
    outbox: options.outbox ?? {
      indexedDB: null,
      storage,
      createLeaseToken: () => `lease-${++lease}`
    }
  });

  return {
    reconciler,
    storage,
    scheduler,
    batches,
    updates,
    exactKeys,
    saved,
    savedAdjustments,
    settlements,
    canonicalizations,
    retries,
    workerErrors,
    setNow: (value) => {
      now = new Date(value);
    }
  };
}

await run('journals before applying, serializes the aggregate, and forwards the idempotency key', async () => {
  const events: string[] = [];
  let observedProjectionRevision: number | null = null;
  let observedResolvedRemaining: number | null = null;
  const storage = new FakeStorage();
  const originalSet = storage.setItem.bind(storage);
  storage.setItem = (key, value) => {
    events.push('journal');
    originalSet(key, value);
  };
  const harness = createHarness({
    storage,
    update: async (id, patch, _idempotencyKey, batches) => {
      events.push('update');
      const saved = { ...batches.get(id)!, ...patch };
      batches.set(id, saved);
      // Some gateway versions return a sparse acknowledgement. The worker
      // must still pass its freshly resolved scalar to the projection owner.
      return { id: saved.id, beanId: saved.beanId };
    },
    onAdjustmentSettled: (settlement) => {
      observedResolvedRemaining = settlement.resolvedRemaining;
      observedProjectionRevision = settlement.projectionRevision;
    }
  });
  harness.batches.set('batch-1', batch('batch-1', 100));

  const queued = await harness.reconciler.enqueue({
    ...input('shot-1', 'batch-1', 18, 82),
    projectionRevision: 7
  });
  equal(queued.inserted, true);
  queued.releaseProjection();
  await waitFor(() => harness.saved.length === 1);

  equal(events.indexOf('journal') < events.indexOf('update'), true);
  deepEqual(harness.exactKeys, ['bean-inventory:bean-1']);
  deepEqual(harness.updates[0], {
    id: 'batch-1',
    patch: { beanId: 'bean-1', weightRemaining: 82 },
    idempotencyKey: pendingDoseIdempotencyKey('shot-1', 'batch-1')
  });
  equal(harness.batches.get('batch-1')?.weightRemaining, 82);
  equal(observedResolvedRemaining, 82);
  equal(observedProjectionRevision, 7);

  const duplicate = await harness.reconciler.enqueue({
    ...input('shot-1', 'batch-1', 18, 64),
    at: '2026-07-12T12:00:00.000Z',
    projectionRevision: 99
  });
  equal(duplicate.inserted, false);
  duplicate.releaseProjection();
  await settle();
  equal(harness.updates.length, 1);
  equal(projectionRevisionCount(harness.reconciler), 0);
  await harness.reconciler.dispose();
});

await run('durable execution waits until its optimistic projection hand-off is released', async () => {
  const harness = createHarness();
  harness.batches.set('batch-1', batch('batch-1', 100));

  const admission = await harness.reconciler.enqueue(
    input('shot-held', 'batch-1', 18, 82)
  );
  await settle();
  equal(harness.updates.length, 0);

  admission.releaseProjection();
  await waitFor(() => harness.settlements.length === 1);
  equal(harness.updates[0]?.patch.weightRemaining, 82);
  await harness.reconciler.dispose();
});

await run('durably reclaims a dose, exposes adjustment context, and deduplicates the shot', async () => {
  const harness = createHarness();
  harness.batches.set('batch-1', batch('batch-1', 80));
  const input = reclaimInput('shot-reclaim', 'batch-1', 18, 98);

  equal(await harness.reconciler.existingReclaim('shot-reclaim', 'batch-1'), null);
  const queued = await harness.reconciler.enqueueReclaim(input);
  equal(queued.inserted, true);
  equal(queued.durability, 'local-storage');
  deepEqual(await harness.reconciler.existingReclaim('shot-reclaim', 'batch-1'), {
    beanId: 'bean-1',
    batchId: 'batch-1',
    dose: 18,
    state: 'pending',
    expectedRemaining: 98,
    durability: 'local-storage'
  });
  queued.releaseProjection();
  await waitFor(() => harness.saved.length === 1);

  deepEqual(harness.updates[0], {
    id: 'batch-1',
    patch: { beanId: 'bean-1', weightRemaining: 98 },
    idempotencyKey: pendingDoseReclaimIdempotencyKey('shot-reclaim', 'batch-1')
  });
  equal(harness.batches.get('batch-1')?.weightRemaining, 98);
  equal(harness.savedAdjustments[0]?.adjustment, 'reclaim');
  equal(harness.savedAdjustments[0]?.expectedRemaining, 98);
  const record = harness.storage.records().find(
    (candidate) => candidate.idempotencyKey === pendingDoseReclaimIdempotencyKey('shot-reclaim', 'batch-1')
  );
  equal(record?.kind, PENDING_DOSE_RECLAIM_MUTATION_KIND);
  equal(record?.receipt?.outcome, 'committed');
  deepEqual(await harness.reconciler.existingReclaim('shot-reclaim', 'batch-1'), {
    beanId: 'bean-1',
    batchId: 'batch-1',
    dose: 18,
    state: 'acknowledged',
    outcome: 'committed',
    resolvedRemaining: 98,
    durability: 'local-storage'
  });

  const duplicate = await harness.reconciler.enqueueReclaim({
    ...input,
    expectedRemaining: 116,
    at: '2026-07-12T12:00:00.000Z',
    projectionRevision: 99
  });
  equal(duplicate.inserted, false);
  duplicate.releaseProjection();
  await settle();
  equal(harness.updates.length, 1);
  equal(projectionRevisionCount(harness.reconciler), 0);
  await harness.reconciler.dispose();
});

await run('prepares one durable shot-delete transaction before dispatch and fails closed without persistent storage', async () => {
  const harness = createHarness();
  const first = await harness.reconciler.prepareShotDeleteReclaim({
    ...reclaimInput('shot-delete', 'batch-1', 18, 98),
    projectionRevision: 7
  });

  equal(first.idempotencyKey, shotDeleteReclaimIdempotencyKey('shot-delete'));
  equal(first.inserted, true);
  equal(first.durability, 'local-storage');
  equal(first.state, 'pending');
  deepEqual(first.transaction, {
    shotId: 'shot-delete',
    beanId: 'bean-1',
    batchId: 'batch-1',
    dose: 18,
    expectedRemaining: 98,
    at: '2026-07-10T10:00:00.000Z'
  });
  const stored = harness.storage.records()[0]!;
  equal(stored.kind, PENDING_SHOT_DELETE_RECLAIM_KIND);
  equal(stored.aggregateKey, 'bean-inventory:bean-1');
  equal(stored.physicalIdentity, JSON.stringify(['shot-delete', 'bean-1', 'batch-1', 18]));

  const duplicate = await harness.reconciler.prepareShotDeleteReclaim({
    ...reclaimInput('shot-delete', 'batch-1', 18, 116),
    at: '2026-07-12T12:00:00.000Z',
    projectionRevision: 99
  });
  equal(duplicate.inserted, false);
  equal(duplicate.transaction.expectedRemaining, 98);
  equal(duplicate.transaction.at, '2026-07-10T10:00:00.000Z');

  let conflict: unknown = null;
  try {
    await harness.reconciler.prepareShotDeleteReclaim(
      reclaimInput('shot-delete', 'changed-batch', 18, 98)
    );
  } catch (error) {
    conflict = error;
  }
  equal(conflict instanceof IdempotencyConflictError, true);
  deepEqual(await harness.reconciler.pendingAdjustments(), []);
  deepEqual(await harness.reconciler.pendingShotDeleteReclaims(), [{
    idempotencyKey: shotDeleteReclaimIdempotencyKey('shot-delete'),
    state: 'pending',
    transaction: first.transaction
  }]);
  await harness.reconciler.start();
  await settle();
  equal(harness.storage.records()[0]?.state, 'pending');
  await harness.reconciler.dispose();

  const memory = createHarness({ outbox: { indexedDB: null, storage: null } });
  let persistenceFailure: unknown = null;
  try {
    await memory.reconciler.prepareShotDeleteReclaim(
      reclaimInput('unsafe-delete', 'batch-1', 18, 98)
    );
  } catch (error) {
    persistenceFailure = error;
  }
  equal((persistenceFailure as Error)?.message, 'Shot deletion requires persistent mutation storage');
  await memory.reconciler.dispose();
});

await run('pending work classifies delete sources and reclaim children from one snapshot', async () => {
  const harness = createHarness();
  const source = await harness.reconciler.prepareShotDeleteReclaim(
    reclaimInput('source-shot', 'batch-1', 18, 100)
  );
  const child = await harness.reconciler.enqueueReclaim(
    reclaimInput('child-shot', 'batch-1', 18, 118)
  );
  child.releaseProjection();

  const work = await harness.reconciler.pendingWork();

  deepEqual(work.shotDeleteReclaims, [{
    idempotencyKey: source.idempotencyKey,
    state: 'pending',
    transaction: source.transaction
  }]);
  deepEqual(work.adjustments, [{
    idempotencyKey: child.idempotencyKey,
    entry: {
      batchId: 'batch-1',
      beanId: 'bean-1',
      dose: 18,
      expectedRemaining: 118,
      at: '2026-07-10T10:00:00.000Z',
      adjustment: 'reclaim'
    }
  }]);
  equal(harness.updates.length, 0);
  await harness.reconciler.dispose();
});

await run('claims a known delete transaction outside the inventory head and retries with fencing', async () => {
  const storage = new FakeStorage();
  const seed = new DurableMutationOutbox({ indexedDB: null, storage });
  const older = await seed.enqueue({
    idempotencyKey: pendingDoseIdempotencyKey('older-shot', 'batch-1'),
    kind: PENDING_DOSE_MUTATION_KIND,
    aggregateKey: 'bean-inventory:bean-1',
    payload: legacyDose('batch-1', 18, 82, '2026-07-10T09:00:00.000Z'),
    createdAt: new Date('2026-07-10T09:00:00.000Z')
  });
  const [olderClaim] = await seed.claimDue({
    ownerId: 'seed',
    leaseMs: 60_000,
    now: new Date('2026-07-10T09:00:00.000Z')
  });
  await seed.markRetry({
    idempotencyKey: older.record.idempotencyKey,
    leaseToken: olderClaim!.leaseToken,
    retryAt: new Date('2026-07-10T11:00:00.000Z'),
    error: new Error('offline'),
    now: new Date('2026-07-10T09:00:01.000Z')
  });
  await seed.dispose();

  const harness = createHarness({ storage });
  const prepared = await harness.reconciler.prepareShotDeleteReclaim(
    reclaimInput('delete-behind-head', 'batch-1', 18, 100)
  );
  const firstClaim = await harness.reconciler.claimShotDeleteReclaim(prepared.idempotencyKey);
  equal(firstClaim?.attemptCount, 1);
  equal(await harness.reconciler.renewShotDeleteReclaim(firstClaim!), true);

  const retry = await harness.reconciler.retryShotDeleteReclaim(
    firstClaim!,
    new Error('DELETE unavailable')
  );
  equal(retry.retained, true);
  equal(retry.attemptCount, 1);
  equal(retry.retryAt.toISOString(), '2026-07-10T10:00:30.000Z');
  equal(await harness.reconciler.claimShotDeleteReclaim(prepared.idempotencyKey), null);
  harness.setNow('2026-07-10T10:00:30.000Z');
  const secondClaim = await harness.reconciler.claimShotDeleteReclaim(prepared.idempotencyKey);
  equal(secondClaim?.attemptCount, 2);
  await harness.reconciler.retryShotDeleteReclaim(secondClaim!, new Error('still offline'));
  equal(harness.storage.records().find(
    (record) => record.idempotencyKey === prepared.idempotencyKey
  )?.nextAttemptAt, '2026-07-10T10:01:30.000Z');
  await harness.reconciler.dispose();
});

await run('atomically hands an owned delete transaction to the standard reclaim worker in its causal slot', async () => {
  const harness = createHarness();
  harness.batches.set('batch-1', batch('batch-1', 80));
  harness.batches.set('batch-2', batch('batch-2', 100));
  const prepared = await harness.reconciler.prepareShotDeleteReclaim({
    ...reclaimInput('delete-handoff', 'batch-1', 18, 98),
    projectionRevision: 12
  });
  const sourceCreatedAt = harness.storage.records().find(
    (record) => record.idempotencyKey === prepared.idempotencyKey
  )!.createdAt;
  const newer = await harness.reconciler.enqueue(
    input('newer-dose', 'batch-2', 18, 82)
  );
  newer.releaseProjection();
  await settle();
  // The delete phase owns the aggregate head; the standard worker cannot
  // skip it to execute a newer dose command.
  equal(harness.updates.length, 0);

  const claim = await harness.reconciler.claimShotDeleteReclaim(prepared.idempotencyKey);
  const handoff = await harness.reconciler.handoffShotDeleteReclaim(claim!, 'committed');
  equal(handoff?.inserted, true);
  equal(handoff?.settlementPending, true);
  equal(handoff?.expectedRemaining, 98);
  await settle();
  equal(harness.updates.length, 0);

  const source = harness.storage.records().find(
    (record) => record.idempotencyKey === prepared.idempotencyKey
  )!;
  const child = harness.storage.records().find(
    (record) => record.idempotencyKey === pendingDoseReclaimIdempotencyKey('delete-handoff', 'batch-1')
  )!;
  equal(source.state, 'acknowledged');
  equal(source.receipt?.outcome, 'committed');
  equal(child.kind, PENDING_DOSE_RECLAIM_MUTATION_KIND);
  equal(child.createdAt, sourceCreatedAt);
  deepEqual(await harness.reconciler.pendingShotDeleteReclaims(), []);

  handoff!.releaseProjection();
  await waitFor(() => harness.settlements.length === 2);
  deepEqual(harness.updates.map((update) => update.idempotencyKey), [
    child.idempotencyKey,
    pendingDoseIdempotencyKey('newer-dose', 'batch-2')
  ]);
  deepEqual(harness.updates.map((update) => update.patch.weightRemaining), [98, 82]);
  equal(harness.settlements.find(
    (settlement) => settlement.idempotencyKey === child.idempotencyKey
  )?.projectionRevision, 12);
  await harness.reconciler.dispose();
});

await run('handoff returns the canonical acknowledged child and a stale delete lease cannot release one', async () => {
  const storage = new FakeStorage();
  const seed = new DurableMutationOutbox({ indexedDB: null, storage });
  const existing = await seed.enqueue({
    idempotencyKey: pendingDoseReclaimIdempotencyKey('delete-deduped', 'batch-1'),
    kind: PENDING_DOSE_RECLAIM_MUTATION_KIND,
    aggregateKey: 'bean-inventory:bean-1',
    payload: legacyDose('batch-1', 18, 95, '2026-07-10T09:00:00.000Z'),
    physicalIdentity: JSON.stringify(['bean-1', 'batch-1', 18]),
    createdAt: new Date('2026-07-10T09:00:00.000Z')
  });
  const [existingClaim] = await seed.claimDue({
    ownerId: 'seed',
    leaseMs: 60_000,
    now: new Date('2026-07-10T09:00:00.000Z')
  });
  await seed.acknowledge({
    idempotencyKey: existing.record.idempotencyKey,
    leaseToken: existingClaim!.leaseToken,
    outcome: 'already-applied',
    details: { weightRemaining: 95 },
    now: new Date('2026-07-10T09:00:01.000Z')
  });
  await seed.dispose();

  const harness = createHarness({ storage });
  const prepared = await harness.reconciler.prepareShotDeleteReclaim({
    ...reclaimInput('delete-deduped', 'batch-1', 18, 98),
    projectionRevision: 3
  });
  const claim = await harness.reconciler.claimShotDeleteReclaim(prepared.idempotencyKey);
  const handoff = await harness.reconciler.handoffShotDeleteReclaim(claim!, 'already-applied');
  equal(handoff?.inserted, false);
  equal(handoff?.settlementPending, false);
  equal(handoff?.expectedRemaining, 95);
  handoff!.releaseProjection();
  await settle();
  equal(harness.updates.length, 0);
  equal(harness.settlements.length, 0);
  equal(projectionBarrierCount(harness.reconciler), 0);

  const stalePrepared = await harness.reconciler.prepareShotDeleteReclaim(
    reclaimInput('delete-stale', 'batch-1', 18, 98)
  );
  const staleClaim = await harness.reconciler.claimShotDeleteReclaim(stalePrepared.idempotencyKey);
  harness.setNow('2026-07-10T10:06:00.000Z');
  equal(await harness.reconciler.handoffShotDeleteReclaim(staleClaim!, 'committed'), null);
  equal(harness.storage.records().some(
    (record) => record.idempotencyKey === pendingDoseReclaimIdempotencyKey('delete-stale', 'batch-1')
  ), false);
  equal(projectionBarrierCount(harness.reconciler), 0);
  await harness.reconciler.dispose();
});

await run('a conflicting reclaim child terminates source ownership for manual review', async () => {
  const storage = new FakeStorage();
  const seed = new DurableMutationOutbox({ indexedDB: null, storage });
  await seed.enqueue({
    idempotencyKey: pendingDoseReclaimIdempotencyKey('delete-conflict', 'batch-1'),
    kind: PENDING_DOSE_RECLAIM_MUTATION_KIND,
    aggregateKey: 'bean-inventory:bean-1',
    payload: legacyDose('batch-1', 17, 96, '2026-07-10T09:00:00.000Z'),
    physicalIdentity: JSON.stringify(['bean-1', 'batch-1', 17])
  });
  await seed.dispose();

  const harness = createHarness({ storage });
  const prepared = await harness.reconciler.prepareShotDeleteReclaim(
    reclaimInput('delete-conflict', 'batch-1', 18, 98)
  );
  const claim = await harness.reconciler.claimShotDeleteReclaim(prepared.idempotencyKey);
  let conflict: unknown = null;
  try {
    await harness.reconciler.handoffShotDeleteReclaim(claim!, 'committed');
  } catch (error) {
    conflict = error;
  }
  equal(conflict instanceof IdempotencyConflictError, true);
  equal(await harness.reconciler.terminateShotDeleteReclaim(
    claim!,
    'reclaim-idempotency-conflict',
    'committed'
  ), true);

  const replay = await harness.reconciler.prepareShotDeleteReclaim(
    reclaimInput('delete-conflict', 'batch-1', 18, 98)
  );
  equal(replay.state, 'acknowledged');
  equal(replay.deleteOutcome, 'committed');
  equal(harness.storage.records().find(
    (record) => record.idempotencyKey === prepared.idempotencyKey
  )?.receipt?.outcome, 'not-applicable');
  await harness.reconciler.dispose();
});

await run('an older retry-wait deduction blocks a newer reclaim on the same inventory head', async () => {
  let failures = 1;
  const harness = createHarness({
    update: async (id, patch, _key, batches) => {
      if (failures-- > 0) throw new Error('offline');
      const saved = { ...batches.get(id)!, ...patch };
      batches.set(id, saved);
      return saved;
    }
  });
  harness.batches.set('batch-1', batch('batch-1', 100));
  await enqueueDose(harness, input('shot-consumed', 'batch-1', 18, 82));
  await waitFor(() => harness.retries.length === 1);
  harness.updates.length = 0;

  // Even an identical event timestamp keeps the already-enqueued deduction
  // as the aggregate head before its inverse.
  await enqueueReclaim(harness,
    reclaimInput('shot-consumed', 'batch-1', 18, 100)
  );
  await settle();
  // The newer pending reclaim is due, but the older retry head is not.
  equal(harness.updates.length, 0);

  harness.setNow('2026-07-10T10:00:30.000Z');
  await harness.reconciler.trigger();
  await waitFor(() => harness.saved.length === 2);

  deepEqual(harness.updates.map((update) => update.patch.weightRemaining), [82, 100]);
  deepEqual(harness.savedAdjustments.map((entry) => entry.adjustment), ['deduction', 'reclaim']);
  equal(harness.batches.get('batch-1')?.weightRemaining, 100);
  await harness.reconciler.dispose();
});

await run('a backward wall clock cannot order reclaim ahead of its deduction', async () => {
  const harness = createHarness();
  harness.batches.set('batch-1', { ...batch('batch-1', 100), weight: 100 });
  const optimisticShotId = 'pending-live-123';
  const persistedShotId = 'gateway-shot-456';
  const deduction = await harness.reconciler.enqueue({
    ...input(optimisticShotId, 'batch-1', 18, 82),
    at: '2026-07-10T11:00:00.000Z'
  });
  const reclaim = await harness.reconciler.enqueueReclaim({
    ...reclaimInput(persistedShotId, 'batch-1', 18, 100),
    at: '2026-07-10T10:00:00.000Z'
  });

  reclaim.releaseProjection();
  deduction.releaseProjection();
  await waitFor(() => harness.settlements.length === 2);

  deepEqual(harness.updates.map((update) => update.patch.weightRemaining), [82, 100]);
  const records = harness.storage.records();
  const deductionRecord = records.find(
    (record) => record.idempotencyKey === pendingDoseIdempotencyKey(optimisticShotId, 'batch-1')
  );
  const reclaimRecord = records.find(
    (record) => record.idempotencyKey === pendingDoseReclaimIdempotencyKey(persistedShotId, 'batch-1')
  );
  equal((reclaimRecord?.createdAt ?? '') > (deductionRecord?.createdAt ?? ''), true);
  await harness.reconciler.dispose();
});

await run('causal admission canonicalizes legacy batch lanes before ordering', async () => {
  const storage = new FakeStorage();
  const seed = new DurableMutationOutbox({
    indexedDB: null,
    storage,
    now: () => new Date('2026-07-10T11:00:00.000Z')
  });
  const legacyInput = input('legacy-route', 'batch-1', 18, 82);
  const { shotId: _shotId, ...legacyPayload } = legacyInput;
  await seed.enqueue({
    idempotencyKey: pendingDoseIdempotencyKey('legacy-route', 'batch-1'),
    kind: PENDING_DOSE_MUTATION_KIND,
    aggregateKey: 'batch:batch-1',
    payload: legacyPayload,
    createdAt: new Date('2026-07-10T11:00:00.000Z')
  });
  await seed.dispose();

  const harness = createHarness({ storage });
  harness.batches.set('batch-1', batch('batch-1', 100));
  const newer = await harness.reconciler.enqueue({
    ...input('new-route', 'batch-1', 18, 64),
    at: '2026-07-10T10:00:00.000Z'
  });
  const records = storage.records();
  const legacyRecord = records.find(
    (record) => record.idempotencyKey === pendingDoseIdempotencyKey('legacy-route', 'batch-1')
  );
  const newerRecord = records.find(
    (record) => record.idempotencyKey === pendingDoseIdempotencyKey('new-route', 'batch-1')
  );

  equal(legacyRecord?.aggregateKey, 'bean-inventory:bean-1');
  equal((newerRecord?.createdAt ?? '') > (legacyRecord?.createdAt ?? ''), true);
  newer.releaseProjection();
  await harness.reconciler.dispose();
});

await run('a lost reclaim response replays the same idempotency key without adding twice', async () => {
  let receipt: BeanBatch | null = null;
  let receiptKey: string | null = null;
  const harness = createHarness({
    update: async (id, patch, idempotencyKey, batches) => {
      if (receipt) {
        equal(idempotencyKey, receiptKey);
        return receipt;
      }
      const saved = { ...batches.get(id)!, ...patch };
      batches.set(id, saved);
      receipt = saved;
      receiptKey = idempotencyKey;
      throw new Error('response lost');
    }
  });
  harness.batches.set('batch-1', batch('batch-1', 70));
  await enqueueReclaim(harness, reclaimInput('shot-lost', 'batch-1', 20, 100));
  await waitFor(() => harness.retries.length === 1);
  equal(harness.batches.get('batch-1')?.weightRemaining, 90);

  harness.setNow('2026-07-10T10:00:30.000Z');
  await harness.reconciler.trigger();
  await waitFor(() => harness.saved.length === 1);

  // A non-idempotent replay would apply the freshly computed 110. The gateway
  // receipt for the stable key instead resolves the original physical +20.
  deepEqual(harness.updates.map((update) => update.patch.weightRemaining), [90, 110]);
  equal(harness.updates[0]?.idempotencyKey, harness.updates[1]?.idempotencyKey);
  equal(harness.updates[0]?.idempotencyKey, pendingDoseReclaimIdempotencyKey('shot-lost', 'batch-1'));
  equal(harness.batches.get('batch-1')?.weightRemaining, 90);
  equal(harness.saved[0]?.weightRemaining, 90);
  equal(harness.storage.records().find(
    (record) => record.idempotencyKey === pendingDoseReclaimIdempotencyKey('shot-lost', 'batch-1')
  )?.receipt?.outcome, 'committed');
  await harness.reconciler.dispose();
});

await run('reclaim acknowledges missing, untracked, and already-applied bags without writing', async () => {
  const harness = createHarness();
  harness.batches.set('untracked', {
    id: 'untracked',
    beanId: 'bean-1',
    weight: 250,
    weightRemaining: null
  });
  harness.batches.set('already', batch('already', 98));

  await enqueueReclaim(harness, reclaimInput('shot-missing', 'missing', 18, 18));
  await enqueueReclaim(harness, reclaimInput('shot-untracked', 'untracked', 18, 18));
  await enqueueReclaim(harness, reclaimInput('shot-already', 'already', 18, 98));
  await waitFor(() => harness.storage.records().filter((record) => record.state === 'acknowledged').length === 3);

  equal(harness.updates.length, 0);
  equal(harness.storage.records().find((record) => record.idempotencyKey.includes('shot-missing'))?.receipt?.outcome, 'not-applicable');
  equal(harness.storage.records().find((record) => record.idempotencyKey.includes('shot-untracked'))?.receipt?.outcome, 'not-applicable');
  equal(harness.storage.records().find((record) => record.idempotencyKey.includes('shot-already'))?.receipt?.outcome, 'already-applied');
  deepEqual(harness.settlements.map((settlement) => ({
    batchId: settlement.entry.batchId,
    outcome: settlement.outcome,
    remaining: settlement.resolvedRemaining
  })).sort((left, right) => left.batchId.localeCompare(right.batchId)), [
    { batchId: 'already', outcome: 'already-applied', remaining: 98 },
    { batchId: 'missing', outcome: 'not-applicable', remaining: null },
    { batchId: 'untracked', outcome: 'not-applicable', remaining: null }
  ]);
  await harness.reconciler.dispose();
});

await run('an idempotency payload conflict fails closed instead of entering volatile intake', async () => {
  const updateGate = deferred<BeanBatch>();
  const harness = createHarness({ update: () => updateGate.promise });
  harness.batches.set('batch-1', batch('batch-1', 100));
  await enqueueDose(harness, input('shot-conflict', 'batch-1', 18, 82));
  await waitFor(() => harness.updates.length === 1);

  let conflict: unknown = null;
  try {
    await harness.reconciler.enqueue(input('shot-conflict', 'batch-1', 17, 83));
  } catch (error) {
    conflict = error;
  }

  equal(conflict instanceof IdempotencyConflictError, true);
  equal(volatileEnqueueCount(harness.reconciler), 0);
  updateGate.resolve({ ...batch('batch-1', 82), beanId: 'bean-1' });
  await waitFor(() => harness.saved.length === 1);
  await harness.reconciler.dispose();
});

await run('migrates every legacy entry before clearing and preserves the per-bean inventory lane', async () => {
  const legacy = [
    legacyDose('batch-1', 10, 90, '2026-07-10T09:00:00.000Z'),
    legacyDose('batch-1', 10, 80, '2026-07-10T09:01:00.000Z')
  ];
  let durableCountAtClear = 0;
  const harness = createHarness({
    legacy,
    clearLegacy: (storage) => {
      durableCountAtClear = storage.records().filter((record) => record.kind === PENDING_DOSE_MUTATION_KIND).length;
    }
  });
  harness.batches.set('batch-1', batch('batch-1', 100));

  await harness.reconciler.start();
  await waitFor(() => harness.saved.length === 2);

  equal(durableCountAtClear, 2);
  deepEqual(harness.updates.map((update) => update.patch.weightRemaining), [90, 80]);
  deepEqual(harness.exactKeys, ['bean-inventory:bean-1', 'bean-inventory:bean-1']);
  await harness.reconciler.dispose();
});

await run('live admission cannot splice between records in the legacy migration epoch', async () => {
  const storage = new FakeStorage();
  const legacy = [
    legacyDose('batch-1', 30, 70, '2026-07-10T09:00:00.000Z'),
    legacyDose('batch-1', 30, 40, '2026-07-10T09:01:00.000Z')
  ];
  let concurrent: Promise<Awaited<ReturnType<DoseMutationReconciler['enqueueReclaim']>>> | null = null;
  let armed = true;
  const originalSet = storage.setItem.bind(storage);
  let harness!: Harness;
  storage.setItem = (key, value) => {
    originalSet(key, value);
    if (!armed) return;
    armed = false;
    concurrent = harness.reconciler.enqueueReclaim(
      reclaimInput('live-during-legacy', 'batch-1', 50, 90)
    );
  };
  harness = createHarness({ storage, legacy });
  harness.batches.set('batch-1', { ...batch('batch-1', 100), weight: 100 });

  const running = harness.reconciler.start();
  await waitFor(() => concurrent != null);
  const live = await concurrent!;
  live.releaseProjection();
  await running;

  const orderedKinds = storage.records()
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .map((record) => record.kind);
  deepEqual(orderedKinds, [
    PENDING_DOSE_MUTATION_KIND,
    PENDING_DOSE_MUTATION_KIND,
    PENDING_DOSE_RECLAIM_MUTATION_KIND
  ]);
  await harness.reconciler.dispose();
});

await run('dispatches previously journaled batch-key doses on the current inventory lane', async () => {
  const storage = new FakeStorage();
  const seed = new DurableMutationOutbox({ indexedDB: null, storage });
  await seed.enqueue({
    idempotencyKey: 'legacy-batch-lane',
    kind: PENDING_DOSE_MUTATION_KIND,
    aggregateKey: 'batch:batch-1',
    payload: legacyDose('batch-1', 18, 82, '2026-07-10T09:00:00.000Z'),
    createdAt: new Date('2026-07-10T09:00:00.000Z')
  });
  await seed.dispose();
  const harness = createHarness({ storage });
  harness.batches.set('batch-1', batch('batch-1', 100));

  await harness.reconciler.start();
  await waitFor(() => harness.saved.length === 1);

  deepEqual(harness.exactKeys, ['bean-inventory:bean-1']);
  equal(harness.batches.get('batch-1')?.weightRemaining, 82);
  equal(storage.records()[0]?.aggregateKey, 'bean-inventory:bean-1');
  await harness.reconciler.dispose();
});

await run('a legacy retry head blocks a newer canonical dose until it is due', async () => {
  const storage = new FakeStorage();
  const seed = new DurableMutationOutbox({ indexedDB: null, storage });
  const legacy = await seed.enqueue({
    idempotencyKey: 'legacy-retry-head',
    kind: PENDING_DOSE_MUTATION_KIND,
    aggregateKey: 'batch:batch-1',
    payload: legacyDose('batch-1', 18, 82, '2026-07-10T09:00:00.000Z'),
    createdAt: new Date('2026-07-10T09:00:00.000Z')
  });
  const [legacyClaim] = await seed.claimDue({
    ownerId: 'old-worker',
    leaseMs: 60_000,
    kinds: [PENDING_DOSE_MUTATION_KIND],
    now: new Date('2026-07-10T10:00:00.000Z')
  });
  equal(
    await seed.markRetry({
      idempotencyKey: legacy.record.idempotencyKey,
      leaseToken: legacyClaim!.leaseToken,
      retryAt: new Date('2026-07-10T10:05:00.000Z'),
      error: new Error('offline'),
      now: new Date('2026-07-10T10:00:01.000Z')
    }),
    true
  );
  await seed.enqueue({
    idempotencyKey: pendingDoseIdempotencyKey('shot-newer', 'batch-1'),
    kind: PENDING_DOSE_MUTATION_KIND,
    aggregateKey: 'bean-inventory:bean-1',
    payload: legacyDose('batch-1', 18, 64, '2026-07-10T10:01:00.000Z'),
    createdAt: new Date('2026-07-10T10:01:00.000Z')
  });
  await seed.dispose();

  const harness = createHarness({ storage });
  harness.batches.set('batch-1', batch('batch-1', 100));
  await harness.reconciler.start();

  equal(harness.updates.length, 0);
  equal(
    storage.records()
      .filter((record) => record.kind === PENDING_DOSE_MUTATION_KIND)
      .every((record) => record.aggregateKey === 'bean-inventory:bean-1'),
    true
  );

  harness.setNow('2026-07-10T10:05:00.000Z');
  await harness.reconciler.trigger();
  await waitFor(() => harness.saved.length === 2);

  deepEqual(harness.updates.map((update) => update.patch.weightRemaining), [82, 64]);
  deepEqual(harness.exactKeys, ['bean-inventory:bean-1', 'bean-inventory:bean-1']);
  equal(harness.batches.get('batch-1')?.weightRemaining, 64);
  await harness.reconciler.dispose();
});

await run('claims only dose mutations one at a time and uses a five-minute lease', async () => {
  const storage = new FakeStorage();
  const seed = new DurableMutationOutbox({ indexedDB: null, storage });
  await seed.enqueue({
    idempotencyKey: 'foreign-setting',
    kind: 'display-setting',
    aggregateKey: 'display',
    payload: { brightness: 20 },
    createdAt: new Date('2026-07-10T09:00:00.000Z')
  });
  await seed.dispose();

  const updateGate = deferred<BeanBatch>();
  const harness = createHarness({ storage, update: () => updateGate.promise });
  harness.batches.set('batch-1', batch('batch-1', 100));
  harness.batches.set('batch-2', batch('batch-2', 100));
  await enqueueDose(harness, input('shot-1', 'batch-1', 18, 82));
  await enqueueDose(harness, input('shot-2', 'batch-2', 18, 82));
  await waitFor(() => harness.updates.length === 1);

  const records = storage.records();
  const inFlight = records.find((record) => record.state === 'in-flight');
  equal(records.filter((record) => record.state === 'in-flight').length, 1);
  equal(inFlight?.lease?.expiresAt, new Date(Date.parse('2026-07-10T10:00:00.000Z') + DOSE_MUTATION_LEASE_MS).toISOString());
  equal(records.find((record) => record.idempotencyKey === 'foreign-setting')?.state, 'pending');

  updateGate.resolve({ ...batch('batch-1', 82), beanId: 'bean-1' });
  await waitFor(() => harness.updates.length === 2);
  await harness.reconciler.dispose();
});

await run('backs retries off exponentially and does not retry before the due time', async () => {
  let failures = 2;
  const harness = createHarness({
    update: async (id, patch, _key, batches) => {
      if (failures-- > 0) throw new Error('offline');
      const saved = { ...batches.get(id)!, ...patch };
      batches.set(id, saved);
      return saved;
    }
  });
  harness.batches.set('batch-1', batch('batch-1', 100));
  await enqueueDose(harness, input('shot-1', 'batch-1', 18, 82));
  await waitFor(() => harness.retries.length === 1);
  equal(harness.retries[0]?.attemptCount, 1);
  equal(harness.retries[0]?.retryAt.toISOString(), '2026-07-10T10:00:30.000Z');

  harness.setNow('2026-07-10T10:00:29.999Z');
  await harness.reconciler.trigger();
  equal(harness.updates.length, 1);

  harness.setNow('2026-07-10T10:00:30.000Z');
  await harness.reconciler.trigger();
  await waitFor(() => harness.retries.length === 2);
  equal(harness.retries[1]?.attemptCount, 2);
  equal(harness.retries[1]?.retryAt.toISOString(), '2026-07-10T10:01:30.000Z');

  harness.setNow('2026-07-10T10:01:30.000Z');
  await harness.reconciler.trigger();
  await waitFor(() => harness.saved.length === 1);
  equal(harness.updates.length, 3);
  await harness.reconciler.dispose();
});

await run('applies the lost-response heuristic and leaves unrelated mutation kinds untouched', async () => {
  const storage = new FakeStorage();
  const seed = new DurableMutationOutbox({ indexedDB: null, storage });
  await seed.enqueue({
    idempotencyKey: 'foreign',
    kind: 'other-kind',
    aggregateKey: 'batch:other',
    payload: {},
    createdAt: new Date('2026-07-10T08:00:00.000Z')
  });
  await seed.dispose();
  const harness = createHarness({ storage });
  harness.batches.set('already', batch('already', 82));

  await enqueueDose(harness, input('shot-already', 'already', 18, 82));
  await enqueueDose(harness, input('shot-deleted', 'deleted', 18, 82));
  await waitFor(() => storage.records().filter((record) => record.state === 'acknowledged').length === 2);

  equal(harness.updates.length, 0);
  const records = storage.records();
  equal(records.find((record) => record.idempotencyKey === 'foreign')?.state, 'pending');
  equal(records.find((record) => record.idempotencyKey.includes('shot-already'))?.receipt?.outcome, 'already-applied');
  equal(records.find((record) => record.idempotencyKey.includes('shot-deleted'))?.receipt?.outcome, 'not-applicable');
  await harness.reconciler.dispose();
});

await run('prunes only tombstones older than thirty days', async () => {
  const storage = new FakeStorage();
  let now = new Date('2026-06-01T00:00:00.000Z');
  let lease = 0;
  const seed = new DurableMutationOutbox({
    indexedDB: null,
    storage,
    now: () => new Date(now),
    createLeaseToken: () => `seed-${++lease}`
  });
  await acknowledgeSeed(seed, 'old', now);
  now = new Date('2026-06-12T00:00:00.000Z');
  await acknowledgeSeed(seed, 'recent', now);
  await seed.dispose();

  const harness = createHarness({ storage });
  await harness.reconciler.start();
  await waitFor(() => storage.records().length === 1);
  equal(storage.records()[0]?.idempotencyKey, 'recent');
  await harness.reconciler.dispose();
});

await run('dispose waits for a claimed physical update and then closes the journal', async () => {
  const gate = deferred<BeanBatch>();
  const harness = createHarness({ update: () => gate.promise });
  harness.batches.set('batch-1', batch('batch-1', 100));
  await enqueueDose(harness, input('shot-1', 'batch-1', 18, 82));
  await waitFor(() => harness.updates.length === 1);

  let disposed = false;
  const disposing = harness.reconciler.dispose().then(() => {
    disposed = true;
  });
  await settle();
  equal(disposed, false);
  gate.resolve({ ...batch('batch-1', 82), beanId: 'bean-1' });
  await disposing;
  equal(disposed, true);
  equal(harness.storage.records()[0]?.receipt?.outcome, 'committed');
});

await run('an expired lease waiting for the aggregate lane cannot dispatch a remote write', async () => {
  let harness!: Harness;
  harness = createHarness({
    beforeExact: () => harness.setNow('2026-07-10T10:06:00.000Z')
  });
  harness.batches.set('batch-1', batch('batch-1', 100));

  await enqueueDose(harness, input('shot-expired', 'batch-1', 18, 82));
  await waitFor(() => harness.exactKeys.length === 1);
  await settle();

  equal(harness.updates.length, 0);
  equal(harness.saved.length, 0);
  equal(harness.retries.length, 0);
  await harness.reconciler.dispose();
});

await run('volatile intake preserves projection order while IDB recovers', async () => {
  const { asIDBFactory } = createFakeIndexedDb();
  let attempts = 0;
  const recoveringFactory = {
    open: (name: string, version?: number): IDBOpenDBRequest => {
      attempts += 1;
      if (attempts === 1) throw new DOMException('IDB temporarily unavailable', 'InvalidStateError');
      return asIDBFactory.open(name, version);
    }
  } as unknown as IDBFactory;
  let projectedRemaining = 100;
  const harness = createHarness({
    outbox: { indexedDB: recoveringFactory, storage: null },
    onAdjustmentSettled: ({ entry, resolvedRemaining }) => {
      // Mirrors the app's stale-response fence: only the command whose desired
      // projection is still current may publish its absolute response.
      if (resolvedRemaining != null && projectedRemaining === entry.expectedRemaining) {
        projectedRemaining = resolvedRemaining;
      }
    }
  });
  harness.batches.set('batch-1', batch('batch-1', 100));

  const first = await harness.reconciler.enqueue(input('shot-recover-a', 'batch-1', 18, 82));
  equal(first.inserted, true);
  equal(first.durability, 'volatile');
  if (first.inserted) projectedRemaining = 82;
  first.releaseProjection();
  await waitFor(() => harness.saved.length === 1);
  equal(projectedRemaining, 82);

  const secondExpected = projectedRemaining - 18;
  const second = await harness.reconciler.enqueue(
    input('shot-recover-b', 'batch-1', 18, secondExpected)
  );
  if (second.inserted) projectedRemaining = secondExpected;
  second.releaseProjection();
  await waitFor(() => harness.saved.length === 2);

  equal(attempts, 2);
  deepEqual(harness.updates.map((update) => update.patch.weightRemaining), [82, 64]);
  equal(projectedRemaining, 64);
  await harness.reconciler.dispose();
});

await run('volatile promotion settles locally when recovery discovers an acknowledged tombstone', async () => {
  const { asIDBFactory } = createFakeIndexedDb();
  const canonicalInput = input('shot-promoted-tombstone', 'batch-1', 18, 82);
  const { shotId: _shotId, ...canonicalPayload } = canonicalInput;
  const key = pendingDoseIdempotencyKey(canonicalInput.shotId, canonicalInput.batchId);
  const seed = new DurableMutationOutbox({ indexedDB: asIDBFactory, storage: null });
  await seed.enqueue({
    idempotencyKey: key,
    kind: PENDING_DOSE_MUTATION_KIND,
    aggregateKey: 'bean-inventory:bean-1',
    payload: canonicalPayload
  });
  const claim = await seed.claimDue({ ownerId: 'seed', leaseMs: 30_000 });
  await seed.acknowledge({
    idempotencyKey: key,
    leaseToken: claim[0]!.leaseToken,
    outcome: 'committed',
    details: { weightRemaining: 82 }
  });
  await seed.dispose();

  let attempts = 0;
  const recoveringFactory = {
    open: (name: string, version?: number): IDBOpenDBRequest => {
      attempts += 1;
      if (attempts === 1) throw new DOMException('IDB temporarily unavailable', 'InvalidStateError');
      return asIDBFactory.open(name, version);
    }
  } as unknown as IDBFactory;
  let projectedRemaining = 100;
  const harness = createHarness({
    outbox: { indexedDB: recoveringFactory, storage: null },
    onAdjustmentCanonicalized: (canonicalization) => {
      if (projectedRemaining === canonicalization.projectedExpectedRemaining) {
        projectedRemaining = canonicalization.entry.expectedRemaining;
      }
    },
    onAdjustmentSettled: (settlement) => {
      if (
        settlement.resolvedRemaining != null &&
        projectedRemaining === settlement.entry.expectedRemaining
      ) projectedRemaining = settlement.resolvedRemaining;
    }
  });
  harness.batches.set('batch-1', batch('batch-1', 100));

  const admission = await harness.reconciler.enqueue({
    ...canonicalInput,
    expectedRemaining: 64,
    at: '2026-07-12T12:00:00.000Z',
    projectionRevision: 9
  });
  equal(admission.durability, 'volatile');
  projectedRemaining = admission.expectedRemaining;
  admission.releaseProjection();
  await waitFor(() => harness.settlements.length === 1);

  equal(harness.updates.length, 0);
  equal(harness.canonicalizations[0]?.projectedExpectedRemaining, 64);
  equal(harness.settlements[0]?.entry.expectedRemaining, 82);
  equal(harness.settlements[0]?.resolvedRemaining, 82);
  equal(projectedRemaining, 82);
  equal(projectionRevisionCount(harness.reconciler), 0);
  await harness.reconciler.dispose();
});

await run('volatile promotion rebases optimism to a pending record first-admission scalar', async () => {
  const { asIDBFactory } = createFakeIndexedDb();
  const canonicalInput = input('shot-promoted-pending', 'batch-1', 18, 82);
  const { shotId: _shotId, ...canonicalPayload } = canonicalInput;
  const key = pendingDoseIdempotencyKey(canonicalInput.shotId, canonicalInput.batchId);
  const seed = new DurableMutationOutbox({ indexedDB: asIDBFactory, storage: null });
  await seed.enqueue({
    idempotencyKey: key,
    kind: PENDING_DOSE_MUTATION_KIND,
    aggregateKey: 'bean-inventory:bean-1',
    payload: canonicalPayload
  });
  await seed.dispose();

  let attempts = 0;
  const recoveringFactory = {
    open: (name: string, version?: number): IDBOpenDBRequest => {
      attempts += 1;
      if (attempts === 1) throw new DOMException('IDB temporarily unavailable', 'InvalidStateError');
      return asIDBFactory.open(name, version);
    }
  } as unknown as IDBFactory;
  const updateGate = deferred<BeanBatch>();
  let projectedRemaining = 100;
  const harness = createHarness({
    outbox: { indexedDB: recoveringFactory, storage: null },
    update: () => updateGate.promise,
    onAdjustmentCanonicalized: (canonicalization) => {
      if (projectedRemaining === canonicalization.projectedExpectedRemaining) {
        projectedRemaining = canonicalization.entry.expectedRemaining;
      }
    }
  });
  harness.batches.set('batch-1', batch('batch-1', 100));

  const admission = await harness.reconciler.enqueue({
    ...canonicalInput,
    expectedRemaining: 64,
    at: '2026-07-12T12:00:00.000Z',
    projectionRevision: 4
  });
  projectedRemaining = admission.expectedRemaining;
  admission.releaseProjection();
  await waitFor(() => harness.canonicalizations.length === 1);

  equal(projectedRemaining, 82);
  equal(harness.canonicalizations[0]?.entry.expectedRemaining, 82);
  updateGate.resolve(batch('batch-1', 82));
  await waitFor(() => harness.settlements.length === 1);
  await harness.reconciler.dispose();
});

await run('a duplicate waiter observes another context acknowledging its leased command', async () => {
  const { asIDBFactory } = createFakeIndexedDb();
  const updateGate = deferred<BeanBatch>();
  const first = createHarness({
    outbox: { indexedDB: asIDBFactory, storage: null },
    update: () => updateGate.promise
  });
  const second = createHarness({
    outbox: { indexedDB: asIDBFactory, storage: null }
  });
  first.batches.set('batch-1', batch('batch-1', 100));
  second.batches.set('batch-1', batch('batch-1', 100));
  const command = input('shot-cross-context', 'batch-1', 18, 82);

  const owner = await first.reconciler.enqueue(command);
  owner.releaseProjection();
  await waitFor(() => first.updates.length === 1);
  const waiter = await second.reconciler.enqueue(command);
  equal(waiter.inserted, false);
  equal(waiter.settlementPending, true);
  waiter.releaseProjection();

  updateGate.resolve(batch('batch-1', 82));
  await waitFor(() => first.settlements.length === 1);
  await second.reconciler.trigger();
  await waitFor(() => second.settlements.length === 1);

  equal(second.updates.length, 0);
  equal(second.settlements[0]?.resolvedRemaining, 82);
  await Promise.all([first.reconciler.dispose(), second.reconciler.dispose()]);
});

await run('existing pending reclaim observes another context tombstone without writing twice', async () => {
  const { asIDBFactory } = createFakeIndexedDb();
  const now = new Date('2026-07-10T10:00:00.000Z');
  const external = new DurableMutationOutbox({
    indexedDB: asIDBFactory,
    storage: null,
    now: () => new Date(now),
    createLeaseToken: () => 'external-reclaim-lease'
  });
  const input = reclaimInput('shot-external-reclaim', 'batch-1', 18, 98);
  const { shotId: _shotId, ...payload } = input;
  const idempotencyKey = pendingDoseReclaimIdempotencyKey(input.shotId, input.batchId);
  await external.enqueue({
    idempotencyKey,
    kind: PENDING_DOSE_RECLAIM_MUTATION_KIND,
    aggregateKey: 'bean-inventory:bean-1',
    payload,
    createdAt: now
  });

  const waiter = createHarness({
    outbox: { indexedDB: asIDBFactory, storage: null }
  });
  waiter.batches.set('batch-1', batch('batch-1', 80));
  deepEqual(
    await waiter.reconciler.existingReclaim(input.shotId, input.batchId, 31),
    {
      beanId: 'bean-1',
      batchId: 'batch-1',
      dose: 18,
      state: 'pending',
      expectedRemaining: 98,
      durability: 'indexeddb'
    }
  );
  equal(projectionRevisionCount(waiter.reconciler), 1);
  equal(waiter.updates.length, 0);

  const [claimed] = await external.claimDue({
    ownerId: 'other-context',
    leaseMs: 30_000,
    kinds: [PENDING_DOSE_RECLAIM_MUTATION_KIND],
    now
  });
  equal(claimed?.record.idempotencyKey, idempotencyKey);
  equal(await external.acknowledge({
    idempotencyKey,
    leaseToken: claimed!.leaseToken,
    outcome: 'committed',
    details: { weightRemaining: 98 },
    now: new Date('2026-07-10T10:00:01.000Z')
  }), true);

  await waiter.reconciler.start();
  await waitFor(() => waiter.settlements.length === 1);

  equal(waiter.updates.length, 0);
  equal(waiter.settlements[0]?.idempotencyKey, idempotencyKey);
  equal(waiter.settlements[0]?.entry.adjustment, 'reclaim');
  equal(waiter.settlements[0]?.outcome, 'committed');
  equal(waiter.settlements[0]?.resolvedRemaining, 98);
  equal(waiter.settlements[0]?.projectionRevision, 31);
  equal(projectionRevisionCount(waiter.reconciler), 0);
  await Promise.all([waiter.reconciler.dispose(), external.dispose()]);
});

await run('newer same-bean admissions stay behind volatile predecessors during recovery', async () => {
  const { asIDBFactory } = createFakeIndexedDb();
  let attempts = 0;
  const recoveringFactory = {
    open: (name: string, version?: number): IDBOpenDBRequest => {
      attempts += 1;
      if (attempts === 1) throw new DOMException('IDB temporarily unavailable', 'InvalidStateError');
      return asIDBFactory.open(name, version);
    }
  } as unknown as IDBFactory;
  const harness = createHarness({
    outbox: { indexedDB: recoveringFactory, storage: null }
  });
  harness.batches.set('batch-1', batch('batch-1', 100));

  const [first, second] = await Promise.all([
    harness.reconciler.enqueue(input('shot-volatile-a', 'batch-1', 18, 82)),
    harness.reconciler.enqueue(input('shot-volatile-b', 'batch-1', 18, 64))
  ]);
  equal(first.durability, 'volatile');
  equal(second.durability, 'volatile');
  first.releaseProjection();
  second.releaseProjection();
  await waitFor(() => harness.saved.length === 2);

  deepEqual(harness.updates.map((update) => update.patch.weightRemaining), [82, 64]);
  equal(harness.batches.get('batch-1')?.weightRemaining, 64);
  await harness.reconciler.dispose();
});

async function enqueueDose(harness: Harness, value: EnqueueDoseMutationInput): Promise<void> {
  const admission = await harness.reconciler.enqueue(value);
  admission.releaseProjection();
}

async function enqueueReclaim(harness: Harness, value: EnqueueDoseReclaimInput): Promise<void> {
  const admission = await harness.reconciler.enqueueReclaim(value);
  admission.releaseProjection();
}

async function acknowledgeSeed(outbox: DurableMutationOutbox, id: string, now: Date): Promise<void> {
  await outbox.enqueue({
    idempotencyKey: id,
    kind: PENDING_DOSE_MUTATION_KIND,
    aggregateKey: `batch:${id}`,
    payload: legacyDose(id, 1, 1, now.toISOString()),
    createdAt: now
  });
  const claim = await outbox.claimDue({
    ownerId: 'seed',
    leaseMs: 60_000,
    kinds: [PENDING_DOSE_MUTATION_KIND],
    now
  });
  await outbox.acknowledge({
    idempotencyKey: id,
    leaseToken: claim[0]!.leaseToken,
    outcome: 'committed',
    now
  });
}

function batch(id: string, weightRemaining: number): BeanBatch {
  return { id, beanId: 'bean-1', weight: 250, weightRemaining };
}

function input(
  shotId: string,
  batchId: string,
  dose: number,
  expectedRemaining: number
): EnqueueDoseMutationInput {
  return {
    shotId,
    batchId,
    beanId: 'bean-1',
    dose,
    expectedRemaining,
    at: '2026-07-10T10:00:00.000Z'
  };
}

function reclaimInput(
  shotId: string,
  batchId: string,
  dose: number,
  expectedRemaining: number
): EnqueueDoseReclaimInput {
  return {
    shotId,
    batchId,
    beanId: 'bean-1',
    dose,
    expectedRemaining,
    at: '2026-07-10T10:00:00.000Z'
  };
}

function legacyDose(batchId: string, dose: number, expectedRemaining: number, at: string): PendingDose {
  return { batchId, beanId: 'bean-1', dose, expectedRemaining, at };
}

function projectionRevisionCount(reconciler: DoseMutationReconciler): number {
  return (reconciler as unknown as { projectionRevisions: Map<string, number> })
    .projectionRevisions.size;
}

function projectionBarrierCount(reconciler: DoseMutationReconciler): number {
  return (reconciler as unknown as { projectionBarriers: Map<string, unknown> })
    .projectionBarriers.size;
}

function volatileEnqueueCount(reconciler: DoseMutationReconciler): number {
  return (reconciler as unknown as { volatileEnqueues: Map<string, EnqueueDoseMutationInput> })
    .volatileEnqueues.size;
}

interface Deferred<Value> {
  promise: Promise<Value>;
  resolve(value: Value): void;
}

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
  }
  throw new Error('Timed out waiting for condition');
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function run(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

function equal<Value>(actual: Value, expected: Value): void {
  if (actual !== expected) throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
}

function deepEqual(actual: unknown, expected: unknown): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) throw new Error(`Expected ${expectedJson}, received ${actualJson}`);
}
