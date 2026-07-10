import {
  IdempotencyConflictError,
  MUTATION_OUTBOX_DB_NAME,
  MUTATION_OUTBOX_STORAGE_KEY,
  MUTATION_OUTBOX_STORE_NAME,
  DurableMutationOutbox,
  MutationOutboxCorruptionError,
  legacyPendingDoseIdempotencyKey,
  pendingDoseIdempotencyKey,
  type MutationCommand,
  type MutationOutboxStorage
} from '../domain/mutationOutbox';
import { createFakeIndexedDb, type FakeIndexedDb } from './fakeIndexedDb';

interface TestCase {
  name: string;
  fn: () => void | Promise<void>;
}

interface DosePayload {
  shotId: string;
  batchId: string;
  beanId: string;
  dose: number;
  expectedRemaining: number;
  at: string;
}

class FakeStorage implements MutationOutboxStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

class UnavailableStorage implements MutationOutboxStorage {
  getItem(_key: string): string | null {
    throw new Error('storage denied');
  }

  setItem(_key: string, _value: string): void {
    throw new Error('storage denied');
  }

  removeItem(_key: string): void {
    throw new Error('storage denied');
  }
}

class ThrowingIndexedDbFactory {
  open(): never {
    throw new DOMException('temporarily unavailable', 'InvalidStateError');
  }
}

class RecoveringIndexedDbFactory {
  attempts = 0;

  constructor(private readonly delegate: IDBFactory) {}

  open(name: string, version?: number): IDBOpenDBRequest {
    this.attempts += 1;
    if (this.attempts === 1) {
      throw new DOMException('temporarily unavailable', 'InvalidStateError');
    }
    return this.delegate.open(name, version);
  }
}

const tests: TestCase[] = [];

run('persists commands per idempotency key and deduplicates identical enqueue calls', async () => {
  const { outbox, factory } = fakeBackedOutbox();
  const first = await outbox.enqueue(doseCommand('shot-1', 'batch-1'));
  const duplicate = await outbox.enqueue(doseCommand('shot-1', 'batch-1'));

  equal(first.inserted, true);
  equal(first.durability, 'indexeddb');
  equal(duplicate.inserted, false);
  equal(duplicate.record.idempotencyKey, first.record.idempotencyKey);
  equal(duplicate.record.state, 'pending');
  equal(
    factory.rawKeys(MUTATION_OUTBOX_DB_NAME, MUTATION_OUTBOX_STORE_NAME).join(','),
    first.record.idempotencyKey
  );

  const reopened = new DurableMutationOutbox({ indexedDB: factory as unknown as IDBFactory });
  equal((await reopened.list()).length, 1);
  equal((await reopened.get<DosePayload>(first.record.idempotencyKey))?.payload.shotId, 'shot-1');
});

run('rejects reuse of an idempotency key for different physical command data', async () => {
  const { outbox } = fakeBackedOutbox();
  const command = doseCommand('shot-1', 'batch-1');
  await outbox.enqueue(command);

  let error: unknown = null;
  try {
    await outbox.enqueue({ ...command, payload: { ...command.payload, dose: 19 } });
  } catch (caught) {
    error = caught;
  }
  equal(error instanceof IdempotencyConflictError, true);
  equal((await outbox.list()).length, 1);
});

run('claims due records in creation order and records explicit attempt metadata', async () => {
  let lease = 0;
  const { outbox } = fakeBackedOutbox({ createLeaseToken: () => `lease-${++lease}` });
  await outbox.enqueue({
    ...doseCommand('shot-2', 'batch-2'),
    createdAt: new Date('2026-07-10T10:00:01.000Z')
  });
  await outbox.enqueue({
    ...doseCommand('shot-1', 'batch-1'),
    createdAt: new Date('2026-07-10T10:00:00.000Z')
  });

  const claimed = await outbox.claimDue<DosePayload>({
    ownerId: 'dose-worker',
    leaseMs: 30_000,
    limit: 2,
    now: new Date('2026-07-10T10:01:00.000Z')
  });

  equal(claimed.length, 2);
  equal(claimed[0]?.record.payload.shotId, 'shot-1');
  equal(claimed[1]?.record.payload.shotId, 'shot-2');
  equal(claimed[0]?.record.state, 'in-flight');
  equal(claimed[0]?.record.attemptCount, 1);
  equal(claimed[0]?.record.lastAttemptAt, '2026-07-10T10:01:00.000Z');
  equal(claimed[0]?.record.lease?.ownerId, 'dose-worker');
  equal(claimed[0]?.record.lease?.expiresAt, '2026-07-10T10:01:30.000Z');
  equal(claimed[0]?.leaseToken, 'lease-1');
  equal((await outbox.claimDue({ ownerId: 'other', leaseMs: 1_000 })).length, 0);
});

run('claims only the mutation kinds owned by a worker', async () => {
  const { outbox } = fakeBackedOutbox();
  await outbox.enqueue(doseCommand('shot-1', 'batch-1'));
  await outbox.enqueue({
    idempotencyKey: 'settings:v1:display-brightness',
    kind: 'display-setting',
    aggregateKey: 'display',
    payload: { brightness: 35 }
  });

  const doses = await outbox.claimDue<DosePayload>({
    ownerId: 'dose-worker',
    leaseMs: 30_000,
    kinds: ['batch-dose-deduction'],
    limit: 10
  });
  equal(doses.length, 1);
  equal(doses[0]?.record.kind, 'batch-dose-deduction');

  const settings = await outbox.claimDue({
    ownerId: 'settings-worker',
    leaseMs: 30_000,
    kinds: ['display-setting'],
    limit: 10
  });
  equal(settings.length, 1);
  equal(settings[0]?.record.kind, 'display-setting');
});

run('serializes each aggregate and never lets a later command bypass its head', async () => {
  const { outbox } = fakeBackedOutbox();
  const first = await outbox.enqueue(doseCommand('shot-1', 'batch-1'));
  await outbox.enqueue(doseCommand('shot-2', 'batch-1'));
  await outbox.enqueue(doseCommand('shot-3', 'batch-2'));

  const initial = await outbox.claimDue<DosePayload>({
    ownerId: 'dose-worker',
    leaseMs: 30_000,
    kinds: ['batch-dose-deduction'],
    limit: 10,
    now: new Date('2026-07-10T10:00:00.000Z')
  });
  equal(initial.length, 2);
  equal(initial.filter((claim) => claim.record.payload.batchId === 'batch-1').length, 1);
  equal(initial.find((claim) => claim.record.payload.batchId === 'batch-1')?.record.payload.shotId, 'shot-1');

  const batchOneClaim = initial.find((claim) => claim.record.payload.batchId === 'batch-1')!;
  const batchTwoClaim = initial.find((claim) => claim.record.payload.batchId === 'batch-2')!;
  equal(
    await outbox.acknowledge({
      idempotencyKey: batchTwoClaim.record.idempotencyKey,
      leaseToken: batchTwoClaim.leaseToken,
      outcome: 'committed',
      now: new Date('2026-07-10T10:00:01.000Z')
    }),
    true
  );
  equal(
    await outbox.markRetry({
      idempotencyKey: first.record.idempotencyKey,
      leaseToken: batchOneClaim.leaseToken,
      retryAt: new Date('2026-07-10T10:05:00.000Z'),
      error: 'offline',
      now: new Date('2026-07-10T10:00:01.000Z')
    }),
    true
  );

  equal(
    (
      await outbox.claimDue({
        ownerId: 'second-worker',
        leaseMs: 30_000,
        kinds: ['batch-dose-deduction'],
        limit: 10,
        now: new Date('2026-07-10T10:04:59.000Z')
      })
    ).length,
    0
  );
  const retriedHead = await outbox.claimDue<DosePayload>({
    ownerId: 'second-worker',
    leaseMs: 30_000,
    kinds: ['batch-dose-deduction'],
    limit: 10,
    now: new Date('2026-07-10T10:05:00.000Z')
  });
  equal(retriedHead.length, 1);
  equal(retriedHead[0]?.record.payload.shotId, 'shot-1');
});

run('moves a failed claim to retry-wait and only reclaims it once due', async () => {
  let lease = 0;
  const { outbox } = fakeBackedOutbox({ createLeaseToken: () => `lease-${++lease}` });
  const queued = await outbox.enqueue(doseCommand('shot-1', 'batch-1'));
  const first = await outbox.claimDue({
    ownerId: 'worker',
    leaseMs: 10_000,
    now: new Date('2026-07-10T10:00:00.000Z')
  });
  equal(first.length, 1);

  const marked = await outbox.markRetry({
    idempotencyKey: queued.record.idempotencyKey,
    leaseToken: first[0]!.leaseToken,
    retryAt: new Date('2026-07-10T10:05:00.000Z'),
    error: new Error('gateway offline'),
    now: new Date('2026-07-10T10:00:02.000Z')
  });
  equal(marked, true);

  const waiting = await outbox.get(queued.record.idempotencyKey);
  equal(waiting?.state, 'retry-wait');
  equal(waiting?.lastError?.message, 'gateway offline');
  equal(waiting?.nextAttemptAt, '2026-07-10T10:05:00.000Z');
  equal(
    (
      await outbox.claimDue({
        ownerId: 'worker',
        leaseMs: 10_000,
        now: new Date('2026-07-10T10:04:59.999Z')
      })
    ).length,
    0
  );

  const retry = await outbox.claimDue({
    ownerId: 'worker',
    leaseMs: 10_000,
    now: new Date('2026-07-10T10:05:00.000Z')
  });
  equal(retry.length, 1);
  equal(retry[0]?.record.attemptCount, 2);
  equal(retry[0]?.leaseToken, 'lease-2');
});

run('reclaims an expired lease and rejects acknowledgement from its stale worker', async () => {
  let lease = 0;
  const { outbox } = fakeBackedOutbox({ createLeaseToken: () => `lease-${++lease}` });
  const queued = await outbox.enqueue(doseCommand('shot-1', 'batch-1'));
  const first = await outbox.claimDue({
    ownerId: 'worker-a',
    leaseMs: 1_000,
    now: new Date('2026-07-10T10:00:00.000Z')
  });
  equal(
    await outbox.acknowledge({
      idempotencyKey: queued.record.idempotencyKey,
      leaseToken: first[0]!.leaseToken,
      outcome: 'committed',
      now: new Date('2026-07-10T10:00:01.000Z')
    }),
    false
  );
  const reclaimed = await outbox.claimDue({
    ownerId: 'worker-b',
    leaseMs: 1_000,
    now: new Date('2026-07-10T10:00:01.000Z')
  });

  equal(reclaimed.length, 1);
  equal(reclaimed[0]?.record.attemptCount, 2);
  equal(reclaimed[0]?.record.lease?.ownerId, 'worker-b');
  equal(
    await outbox.acknowledge({
      idempotencyKey: queued.record.idempotencyKey,
      leaseToken: first[0]!.leaseToken,
      outcome: 'committed'
    }),
    false
  );
  equal(
    await outbox.markRetry({
      idempotencyKey: queued.record.idempotencyKey,
      leaseToken: first[0]!.leaseToken,
      retryAt: new Date('2026-07-10T10:10:00.000Z'),
      error: 'stale failure'
    }),
    false
  );

  equal(
    await outbox.acknowledge({
      idempotencyKey: queued.record.idempotencyKey,
      leaseToken: reclaimed[0]!.leaseToken,
      outcome: 'already-applied',
      remoteReceiptId: 'receipt-44',
      remoteRevision: 'batch-rev-8',
      details: { remaining: 82 },
      committedAt: new Date('2026-07-10T10:00:00.500Z'),
      now: new Date('2026-07-10T10:00:01.100Z')
    }),
    true
  );

  const acknowledged = await outbox.get(queued.record.idempotencyKey);
  equal(acknowledged?.state, 'acknowledged');
  equal(acknowledged?.lease, null);
  equal(acknowledged?.receipt?.outcome, 'already-applied');
  equal(acknowledged?.receipt?.remoteReceiptId, 'receipt-44');
  equal(acknowledged?.receipt?.idempotencyKey, queued.record.idempotencyKey);
  equal((await outbox.claimDue({ ownerId: 'worker-c', leaseMs: 1_000 })).length, 0);

  const duplicate = await outbox.enqueue(doseCommand('shot-1', 'batch-1'));
  equal(duplicate.inserted, false);
  equal(duplicate.record.state, 'acknowledged');
});

run('renews only a current unexpired fencing lease', async () => {
  const { outbox } = fakeBackedOutbox({ createLeaseToken: () => 'lease-current' });
  const queued = await outbox.enqueue(doseCommand('shot-renew', 'batch-renew'));
  const claim = await outbox.claimDue({
    ownerId: 'worker',
    leaseMs: 1_000,
    now: new Date('2026-07-10T10:00:00.000Z')
  });

  equal(await outbox.renewLease({
    idempotencyKey: queued.record.idempotencyKey,
    leaseToken: 'wrong-token',
    leaseMs: 2_000,
    now: new Date('2026-07-10T10:00:00.500Z')
  }), false);
  equal(await outbox.renewLease({
    idempotencyKey: queued.record.idempotencyKey,
    leaseToken: claim[0]!.leaseToken,
    leaseMs: 2_000,
    now: new Date('2026-07-10T10:00:00.500Z')
  }), true);
  equal(
    (await outbox.get(queued.record.idempotencyKey))?.lease?.expiresAt,
    '2026-07-10T10:00:02.500Z'
  );
  equal(await outbox.renewLease({
    idempotencyKey: queued.record.idempotencyKey,
    leaseToken: claim[0]!.leaseToken,
    leaseMs: 2_000,
    now: new Date('2026-07-10T10:00:02.500Z')
  }), false);
});

run('never loses a concurrent enqueue while another record is acknowledged', async () => {
  const { outbox } = fakeBackedOutbox();
  const first = await outbox.enqueue(doseCommand('shot-1', 'batch-1'));
  const claim = await outbox.claimDue({ ownerId: 'worker', leaseMs: 30_000 });

  await Promise.all([
    outbox.acknowledge({
      idempotencyKey: first.record.idempotencyKey,
      leaseToken: claim[0]!.leaseToken,
      outcome: 'committed'
    }),
    outbox.enqueue(doseCommand('shot-2', 'batch-2'))
  ]);

  const records = await outbox.list<DosePayload>();
  equal(records.length, 2);
  equal(records.find((record) => record.payload.shotId === 'shot-1')?.state, 'acknowledged');
  equal(records.find((record) => record.payload.shotId === 'shot-2')?.state, 'pending');
});

run('retains receipt tombstones until an explicit age-bounded prune', async () => {
  const { outbox } = fakeBackedOutbox();
  const queued = await outbox.enqueue(doseCommand('shot-1', 'batch-1'));
  const claim = await outbox.claimDue({ ownerId: 'worker', leaseMs: 30_000 });
  await outbox.acknowledge({
    idempotencyKey: queued.record.idempotencyKey,
    leaseToken: claim[0]!.leaseToken,
    outcome: 'committed',
    now: new Date('2026-07-10T10:00:00.000Z')
  });

  equal(
    await outbox.pruneAcknowledged({ before: new Date('2026-07-10T10:00:00.000Z') }),
    0
  );
  equal(
    await outbox.pruneAcknowledged({ before: new Date('2026-07-10T10:00:00.001Z') }),
    1
  );
  equal(await outbox.get(queued.record.idempotencyKey), null);
});

run('uses persistent localStorage when IndexedDB is unavailable', async () => {
  const storage = new FakeStorage();
  const first = new DurableMutationOutbox({ indexedDB: null, storage });
  equal(await first.durability(), 'local-storage');
  await first.enqueue(doseCommand('shot-1', 'batch-1'));
  await first.dispose();

  const reopened = new DurableMutationOutbox({ indexedDB: null, storage });
  equal(await reopened.durability(), 'local-storage');
  const records = await reopened.list<DosePayload>();
  equal(records.length, 1);
  equal(records[0]?.payload.shotId, 'shot-1');
});

run('fails closed instead of splitting authority when a present IndexedDB cannot open', async () => {
  const storage = new FakeStorage();
  const outbox = new DurableMutationOutbox({
    indexedDB: new ThrowingIndexedDbFactory() as unknown as IDBFactory,
    storage
  });

  let error: unknown = null;
  try {
    await outbox.enqueue(doseCommand('shot-1', 'batch-1'));
  } catch (caught) {
    error = caught;
  }

  equal(error instanceof Error, true);
  equal(storage.getItem(MUTATION_OUTBOX_STORAGE_KEY), null);
  await outbox.dispose();
});

run('retries backend selection after a transient fail-closed IndexedDB open', async () => {
  const { asIDBFactory } = createFakeIndexedDb();
  const recovering = new RecoveringIndexedDbFactory(asIDBFactory);
  const outbox = new DurableMutationOutbox({
    indexedDB: recovering as unknown as IDBFactory,
    storage: null
  });

  let failed = false;
  try {
    await outbox.enqueue(doseCommand('shot-first', 'batch-first'));
  } catch {
    failed = true;
  }
  equal(failed, true);

  const queued = await outbox.enqueue(doseCommand('shot-second', 'batch-second'));
  equal(queued.inserted, true);
  equal(queued.durability, 'indexeddb');
  equal(recovering.attempts, 2);
  await outbox.dispose();
});

run('promotes fallback records into IndexedDB without splitting the journal', async () => {
  const storage = new FakeStorage();
  const fallback = new DurableMutationOutbox({ indexedDB: null, storage });
  await fallback.enqueue(doseCommand('shot-1', 'batch-1'));
  await fallback.dispose();

  const { factory, asIDBFactory } = createFakeIndexedDb();
  const promoted = new DurableMutationOutbox({ indexedDB: asIDBFactory, storage });
  equal(await promoted.durability(), 'indexeddb');
  equal((await promoted.list<DosePayload>())[0]?.payload.shotId, 'shot-1');
  equal(storage.getItem(MUTATION_OUTBOX_STORAGE_KEY), null);
  await promoted.dispose();

  const reopened = new DurableMutationOutbox({ indexedDB: asIDBFactory, storage: null });
  equal((await reopened.list()).length, 1);
  equal(
    factory.rawKeys(MUTATION_OUTBOX_DB_NAME, MUTATION_OUTBOX_STORE_NAME).length,
    1
  );
});

run('fails closed instead of overwriting a corrupt authoritative fallback journal', async () => {
  const storage = new FakeStorage();
  storage.setItem(MUTATION_OUTBOX_STORAGE_KEY, '{not valid JSON');
  const outbox = new DurableMutationOutbox({ indexedDB: null, storage });

  let error: unknown = null;
  try {
    await outbox.enqueue(doseCommand('shot-1', 'batch-1'));
  } catch (caught) {
    error = caught;
  }

  equal(error instanceof MutationOutboxCorruptionError, true);
  equal(storage.getItem(MUTATION_OUTBOX_STORAGE_KEY), '{not valid JSON');
});

run('reports memory-only durability when every persistent store is unavailable', async () => {
  const outbox = new DurableMutationOutbox({
    indexedDB: null,
    storage: new UnavailableStorage()
  });
  equal(await outbox.durability(), 'memory');
  await outbox.enqueue(doseCommand('shot-1', 'batch-1'));
  equal((await outbox.list()).length, 1);
});

run('reopens its IndexedDB connection after versionchange', async () => {
  const { outbox, factory } = fakeBackedOutbox();
  await outbox.enqueue(doseCommand('shot-1', 'batch-1'));
  equal(factory.openConnectionCount(MUTATION_OUTBOX_DB_NAME), 1);

  factory.notifyVersionChange(MUTATION_OUTBOX_DB_NAME);
  equal(factory.openConnectionCount(MUTATION_OUTBOX_DB_NAME), 0);
  equal((await outbox.list()).length, 1);
  equal(factory.openConnectionCount(MUTATION_OUTBOX_DB_NAME), 1);
});

run('all concurrent disposers await the same drain operation', async () => {
  const { outbox } = fakeBackedOutbox();
  await outbox.enqueue(doseCommand('shot-1', 'batch-1'));

  const first = outbox.dispose();
  const second = outbox.dispose();
  equal(first, second);
  await Promise.all([first, second]);

  let error: unknown = null;
  try {
    await outbox.list();
  } catch (caught) {
    error = caught;
  }
  equal(error instanceof Error, true);
});

run('builds stable, collision-resistant physical and legacy dose keys', () => {
  equal(
    pendingDoseIdempotencyKey('shot/one', 'batch two'),
    'pending-dose:v1:shot%2Fone:batch%20two'
  );
  equal(
    pendingDoseIdempotencyKey('shot/one', 'batch two'),
    pendingDoseIdempotencyKey('shot/one', 'batch two')
  );
  notEqual(
    pendingDoseIdempotencyKey('shot/one', 'batch two'),
    pendingDoseIdempotencyKey('shot/two', 'batch two')
  );

  const legacy = {
    batchId: 'batch-1',
    beanId: 'bean-1',
    dose: 18,
    expectedRemaining: 82,
    at: '2026-07-10T10:00:00.000Z'
  };
  equal(legacyPendingDoseIdempotencyKey(legacy), legacyPendingDoseIdempotencyKey({ ...legacy }));
  notEqual(
    legacyPendingDoseIdempotencyKey(legacy),
    legacyPendingDoseIdempotencyKey({ ...legacy, at: '2026-07-10T10:00:01.000Z' })
  );
});

for (const test of tests) {
  try {
    await test.fn();
    console.log(`ok - ${test.name}`);
  } catch (error) {
    console.error(`not ok - ${test.name}`);
    throw error;
  }
}

function fakeBackedOutbox(
  options: { createLeaseToken?: () => string } = {}
): { outbox: DurableMutationOutbox; factory: FakeIndexedDb } {
  const { factory, asIDBFactory } = createFakeIndexedDb();
  return {
    factory,
    outbox: new DurableMutationOutbox({
      indexedDB: asIDBFactory,
      storage: null,
      now: () => new Date('2026-07-10T10:00:00.000Z'),
      ...options
    })
  };
}

function doseCommand(shotId: string, batchId: string): MutationCommand<DosePayload> {
  return {
    idempotencyKey: pendingDoseIdempotencyKey(shotId, batchId),
    kind: 'batch-dose-deduction',
    aggregateKey: `bean-batch:${batchId}`,
    payload: {
      shotId,
      batchId,
      beanId: `bean-for-${batchId}`,
      dose: 18,
      expectedRemaining: 82,
      at: '2026-07-10T10:00:00.000Z'
    }
  };
}

function run(name: string, fn: () => void | Promise<void>): void {
  tests.push({ name, fn });
}

function equal<Value>(actual: Value, expected: Value): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  }
}

function notEqual<Value>(actual: Value, expected: Value): void {
  if (actual === expected) throw new Error(`Expected ${String(actual)} to differ`);
}
