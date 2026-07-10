import type { BeanBatch } from '../api/types';
import {
  DOSE_MUTATION_LEASE_MS,
  PENDING_DOSE_MUTATION_KIND,
  DoseMutationReconciler,
  type DoseMutationRetry,
  type EnqueueDoseMutationInput
} from '../controllers/doseMutationReconciler';
import {
  DurableMutationOutbox,
  MUTATION_OUTBOX_STORAGE_KEY,
  pendingDoseIdempotencyKey,
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
  onBatchSaved?: (batch: BeanBatch, entry: PendingDose) => void;
  outbox?: Omit<DurableMutationOutboxOptions, 'now'>;
} = {}): Harness {
  const storage = options.storage ?? new FakeStorage();
  const scheduler = new FakeScheduler();
  const batches = new Map<string, BeanBatch>();
  const updates: Harness['updates'] = [];
  const exactKeys: string[] = [];
  const saved: BeanBatch[] = [];
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
    onBatchSaved: (batch, entry) => {
      saved.push(batch);
      options.onBatchSaved?.(batch, entry);
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
    retries,
    workerErrors,
    setNow: (value) => {
      now = new Date(value);
    }
  };
}

await run('journals before applying, serializes the aggregate, and forwards the idempotency key', async () => {
  const events: string[] = [];
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
      return saved;
    }
  });
  harness.batches.set('batch-1', batch('batch-1', 100));

  const queued = await harness.reconciler.enqueue(input('shot-1', 'batch-1', 18, 82));
  equal(queued.inserted, true);
  await waitFor(() => harness.saved.length === 1);

  equal(events.indexOf('journal') < events.indexOf('update'), true);
  deepEqual(harness.exactKeys, ['batch:batch-1']);
  deepEqual(harness.updates[0], {
    id: 'batch-1',
    patch: { beanId: 'bean-1', weightRemaining: 82 },
    idempotencyKey: pendingDoseIdempotencyKey('shot-1', 'batch-1')
  });
  equal(harness.batches.get('batch-1')?.weightRemaining, 82);

  const duplicate = await harness.reconciler.enqueue(input('shot-1', 'batch-1', 18, 82));
  equal(duplicate.inserted, false);
  await settle();
  equal(harness.updates.length, 1);
  await harness.reconciler.dispose();
});

await run('migrates every legacy entry before clearing and preserves per-batch FIFO', async () => {
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
  deepEqual(harness.exactKeys, ['batch:batch-1', 'batch:batch-1']);
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
  await harness.reconciler.enqueue(input('shot-1', 'batch-1', 18, 82));
  await harness.reconciler.enqueue(input('shot-2', 'batch-2', 18, 82));
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
  await harness.reconciler.enqueue(input('shot-1', 'batch-1', 18, 82));
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

  await harness.reconciler.enqueue(input('shot-already', 'already', 18, 82));
  await harness.reconciler.enqueue(input('shot-deleted', 'deleted', 18, 82));
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
  await harness.reconciler.enqueue(input('shot-1', 'batch-1', 18, 82));
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

  await harness.reconciler.enqueue(input('shot-expired', 'batch-1', 18, 82));
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
    onBatchSaved: (saved, entry) => {
      // Mirrors the app's stale-response fence: only the command whose desired
      // projection is still current may publish its absolute response.
      if (projectedRemaining === entry.expectedRemaining) {
        projectedRemaining = saved.weightRemaining ?? projectedRemaining;
      }
    }
  });
  harness.batches.set('batch-1', batch('batch-1', 100));

  const first = await harness.reconciler.enqueue(input('shot-recover-a', 'batch-1', 18, 82));
  equal(first.inserted, true);
  equal(first.durability, 'volatile');
  if (first.inserted) projectedRemaining = 82;
  await waitFor(() => harness.saved.length === 1);
  equal(projectedRemaining, 82);

  const secondExpected = projectedRemaining - 18;
  const second = await harness.reconciler.enqueue(
    input('shot-recover-b', 'batch-1', 18, secondExpected)
  );
  if (second.inserted) projectedRemaining = secondExpected;
  await waitFor(() => harness.saved.length === 2);

  equal(attempts, 2);
  deepEqual(harness.updates.map((update) => update.patch.weightRemaining), [82, 64]);
  equal(projectedRemaining, 64);
  await harness.reconciler.dispose();
});

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

function legacyDose(batchId: string, dose: number, expectedRemaining: number, at: string): PendingDose {
  return { batchId, beanId: 'bean-1', dose, expectedRemaining, at };
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
