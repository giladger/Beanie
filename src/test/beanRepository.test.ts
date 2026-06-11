import type { BeanBatch } from '../api/types';
import {
  loadBeanBatches,
  type BeanRepositoryCache,
  type BeanRepositoryGateway
} from '../data/beanRepository';

const batches: BeanBatch[] = [
  { id: 'batch-1', beanId: 'bean-1', roastDate: '2026-06-01' }
];

class FakeBeanGateway implements BeanRepositoryGateway {
  fail = false;
  frozenWithoutEvents = false;
  calls: string[] = [];

  async batches(beanId: string): Promise<BeanBatch[]> {
    this.calls.push(beanId);
    if (this.fail) throw new Error('batches unavailable');
    if (this.frozenWithoutEvents) {
      return [{ id: 'batch-1', beanId: 'bean-1', roastDate: '2026-06-01', frozen: true, storageEvents: null }];
    }
    return batches;
  }
}

class FakeBeanCache implements BeanRepositoryCache {
  batches: BeanBatch[] = [];
  writes: Array<{ beanId: string; batches: BeanBatch[] }> = [];

  async putBeanBatches(beanId: string, batchValues: readonly BeanBatch[]): Promise<void> {
    this.writes.push({ beanId, batches: [...batchValues] });
    this.batches = [...batchValues];
  }

  async getBeanBatches(): Promise<BeanBatch[]> {
    return this.batches;
  }
}

await run('loadBeanBatches reads from gateway and writes through to cache', async () => {
  const gateway = new FakeBeanGateway();
  const cache = new FakeBeanCache();

  const loaded = await loadBeanBatches('bean-1', { gateway, cache });

  equal(loaded[0]?.id, 'batch-1');
  equal(gateway.calls[0], 'bean-1');
  equal(cache.writes[0]?.beanId, 'bean-1');
});

await run('loadBeanBatches falls back to cache when gateway fails', async () => {
  const gateway = new FakeBeanGateway();
  gateway.fail = true;
  const cache = new FakeBeanCache();
  cache.batches = batches;

  const loaded = await withSuppressedWarnings(() => loadBeanBatches('bean-1', { gateway, cache }));

  equal(loaded[0]?.id, 'batch-1');
  equal(cache.writes.length, 0);
});

await run('loadBeanBatches backfills cached storageEvents when the gateway drops them', async () => {
  const gateway = new FakeBeanGateway();
  gateway.frozenWithoutEvents = true;
  const cache = new FakeBeanCache();
  cache.batches = [
    {
      id: 'batch-1',
      beanId: 'bean-1',
      roastDate: '2026-06-01',
      frozen: true,
      storageEvents: [{ type: 'frozen', at: '2026-06-03T08:00:00.000Z' }]
    }
  ];

  const loaded = await loadBeanBatches('bean-1', { gateway, cache });

  equal(loaded[0]?.storageEvents?.length, 1);
  equal(loaded[0]?.storageEvents?.[0]?.at, '2026-06-03T08:00:00.000Z');
  // The merged events are written through so the cache stays the source of truth.
  equal(cache.writes[0]?.batches[0]?.storageEvents?.length, 1);
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

async function withSuppressedWarnings<T>(fn: () => Promise<T>): Promise<T> {
  const warn = console.warn;
  console.warn = () => {};
  try {
    return await fn();
  } finally {
    console.warn = warn;
  }
}
