import type { BeanBatch } from '../api/types';
import {
  migrateStorageEventsToGateway,
  type StorageEventsMigrationCache,
  type StorageEventsMigrationGateway
} from '../data/storageEventsMigration';

const events = (at: string): BeanBatch['storageEvents'] => [{ type: 'frozen', at }];

class FakeCache implements StorageEventsMigrationCache {
  constructor(private readonly batches: BeanBatch[]) {}
  async getAllBeanBatches(): Promise<BeanBatch[]> {
    return this.batches;
  }
}

class FakeGateway implements StorageEventsMigrationGateway {
  failBeans = new Set<string>();
  failUpdates = new Set<string>();
  reads: string[] = [];
  updates: Array<{ id: string; batch: Partial<BeanBatch> }> = [];

  constructor(private readonly remote: Record<string, BeanBatch[]> = {}) {}

  async batches(beanId: string): Promise<BeanBatch[]> {
    this.reads.push(beanId);
    if (this.failBeans.has(beanId)) throw new Error('batches unavailable');
    return this.remote[beanId] ?? [];
  }

  async updateBatch(id: string, batch: Partial<BeanBatch>): Promise<BeanBatch> {
    if (this.failUpdates.has(id)) throw new Error('update failed');
    this.updates.push({ id, batch });
    return { id, beanId: 'bean-1', ...batch };
  }
}

await run('copies cache-only history up to the gateway', async () => {
  const cache = new FakeCache([
    { id: 'batch-1', beanId: 'bean-1', storageEvents: events('2026-06-03T08:00:00.000Z') }
  ]);
  const gateway = new FakeGateway({
    'bean-1': [{ id: 'batch-1', beanId: 'bean-1', frozen: true, storageEvents: null }]
  });

  const result = await migrateStorageEventsToGateway({ gateway, cache });

  equal(result.migrated, 1);
  equal(result.completed, true);
  equal(gateway.updates[0]?.id, 'batch-1');
  equal(gateway.updates[0]?.batch.storageEvents?.[0]?.at, '2026-06-03T08:00:00.000Z');
});

await run('does not clobber history the gateway already has', async () => {
  const cache = new FakeCache([
    { id: 'batch-1', beanId: 'bean-1', storageEvents: events('2026-06-03T08:00:00.000Z') }
  ]);
  const gateway = new FakeGateway({
    'bean-1': [{ id: 'batch-1', beanId: 'bean-1', storageEvents: events('2026-06-10T08:00:00.000Z') }]
  });

  const result = await migrateStorageEventsToGateway({ gateway, cache });

  equal(result.migrated, 0);
  equal(result.completed, true);
  equal(gateway.updates.length, 0);
});

await run('skips batches the gateway no longer has', async () => {
  const cache = new FakeCache([
    { id: 'gone', beanId: 'bean-1', storageEvents: events('2026-06-03T08:00:00.000Z') }
  ]);
  const gateway = new FakeGateway({ 'bean-1': [] });

  const result = await migrateStorageEventsToGateway({ gateway, cache });

  equal(result.migrated, 0);
  equal(result.completed, true);
  equal(gateway.updates.length, 0);
});

await run('ignores cached batches without any history and reports a clean pass', async () => {
  const cache = new FakeCache([
    { id: 'batch-1', beanId: 'bean-1', frozen: true, storageEvents: null },
    { id: 'batch-2', beanId: 'bean-1' }
  ]);
  const gateway = new FakeGateway({ 'bean-1': [{ id: 'batch-1', beanId: 'bean-1' }] });

  const result = await migrateStorageEventsToGateway({ gateway, cache });

  equal(result.migrated, 0);
  equal(result.completed, true);
  // Nothing to migrate means we never even read the gateway.
  equal(gateway.reads.length, 0);
});

await run('reads each bean once even with several batches', async () => {
  const cache = new FakeCache([
    { id: 'batch-1', beanId: 'bean-1', storageEvents: events('2026-06-03T08:00:00.000Z') },
    { id: 'batch-2', beanId: 'bean-1', storageEvents: events('2026-06-04T08:00:00.000Z') }
  ]);
  const gateway = new FakeGateway({
    'bean-1': [
      { id: 'batch-1', beanId: 'bean-1', storageEvents: null },
      { id: 'batch-2', beanId: 'bean-1', storageEvents: null }
    ]
  });

  const result = await migrateStorageEventsToGateway({ gateway, cache });

  equal(result.migrated, 2);
  equal(gateway.reads.length, 1);
});

await run('a failed bean read leaves the pass incomplete so it retries', async () => {
  const cache = new FakeCache([
    { id: 'batch-1', beanId: 'bean-1', storageEvents: events('2026-06-03T08:00:00.000Z') }
  ]);
  const gateway = new FakeGateway({ 'bean-1': [{ id: 'batch-1', beanId: 'bean-1', storageEvents: null }] });
  gateway.failBeans.add('bean-1');

  const result = await migrateStorageEventsToGateway({ gateway, cache });

  equal(result.migrated, 0);
  equal(result.completed, false);
});

await run('a failed update leaves the pass incomplete so it retries', async () => {
  const cache = new FakeCache([
    { id: 'batch-1', beanId: 'bean-1', storageEvents: events('2026-06-03T08:00:00.000Z') }
  ]);
  const gateway = new FakeGateway({ 'bean-1': [{ id: 'batch-1', beanId: 'bean-1', storageEvents: null }] });
  gateway.failUpdates.add('batch-1');

  const result = await migrateStorageEventsToGateway({ gateway, cache });

  equal(result.migrated, 0);
  equal(result.completed, false);
});

async function run(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

function equal<T>(actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  }
}
