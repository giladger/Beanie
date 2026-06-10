import type { Bean, BeanBatch, PaginatedShots, ShotRecord } from '../api/types';
import {
  BEANIE_CACHE_DB_NAME,
  BEANIE_CACHE_DB_VERSION,
  cachePageKey,
  createBeanieCache,
  normalizeCacheQuery,
  shotPageCacheKey
} from '../domain/cache';
import { createFakeIndexedDb, type FakeIndexedDb } from './fakeIndexedDb';

interface TestCase {
  name: string;
  fn: () => void | Promise<void>;
}

const tests: TestCase[] = [];

function fakeBackedCache(): { cache: ReturnType<typeof createBeanieCache>; factory: FakeIndexedDb } {
  const { factory, asIDBFactory } = createFakeIndexedDb();
  const cache = createBeanieCache({
    indexedDB: asIDBFactory,
    now: () => new Date('2026-06-01T00:00:00.000Z')
  });
  return { cache, factory };
}

function bean(id: string, name: string): Bean {
  return { id, roaster: 'Kawa', name };
}

function batch(id: string, beanId: string): BeanBatch {
  return { id, beanId, roastDate: '2026-05-20' };
}

run('normalizes cache queries independent of parameter order', () => {
  const left = normalizeCacheQuery(new URLSearchParams('offset=0&limit=24&order=desc'));
  const right = normalizeCacheQuery({ order: 'desc', limit: 24, offset: 0 });
  equal(left, right);
});

run('creates stable namespaced page keys', () => {
  equal(
    shotPageCacheKey({ beanBatchId: 'batch-1', limit: 24, offset: 0, order: 'desc' }),
    cachePageKey('shots', 'offset=0&limit=24&order=desc&beanBatchId=batch-1')
  );
});

run('falls back cleanly when IndexedDB is unavailable', async () => {
  const cache = createBeanieCache({
    indexedDB: null,
    now: () => new Date('2026-06-01T00:00:00.000Z')
  });
  const bean: Bean = { id: 'bean-1', roaster: 'Kawa', name: 'Pink Bourbon' };
  const shot: ShotRecord = {
    id: 'shot-1',
    timestamp: '2026-06-01T10:00:00.000Z',
    workflow: { context: { beanBatchId: 'batch-1' } },
    measurements: []
  };
  const page: PaginatedShots = { items: [shot], total: 1, limit: 1, offset: 0 };

  equal(cache.available, false);
  equal(await cache.isAvailable(), false);

  await cache.putBeans([bean]);
  await cache.putShotPage({ beanBatchId: 'batch-1', limit: 1, offset: 0 }, page);
  await cache.putShotRecord(shot);
  await cache.putObject('setting:theme', 'dark');
  await cache.invalidateCacheForMutation('shot', 'shot-1');
  await cache.invalidateCacheForMutation('workflow');
  await cache.invalidateCacheForMutation('bean', bean.id);
  await cache.invalidateCacheForMutation('profile');
  await cache.invalidateCacheForMutation('grinder');
  await cache.clear();

  equal((await cache.getBeans()).length, 0);
  equal(await cache.getShotPage({ limit: 1, offset: 0, beanBatchId: 'batch-1' }), null);
  equal(await cache.getShotRecord(shot.id), null);
  equal(await cache.getObject('setting:theme', 'light'), 'light');
});

run('exports an explicit schema version', () => {
  equal(BEANIE_CACHE_DB_VERSION, 1);
});

run('round-trips a collection through the fake IndexedDB', async () => {
  const { cache } = fakeBackedCache();
  await cache.putBeans([bean('bean-1', 'Pink Bourbon'), bean('bean-2', 'Gesha')]);

  const beans = await cache.getBeans();
  equal(beans.length, 2);
  equal(beans[0].id, 'bean-1');
  equal(beans[0].name, 'Pink Bourbon');
  equal(beans[1].id, 'bean-2');
});

run('drops removed collection items on the next put and deletes their keys', async () => {
  const { cache, factory } = fakeBackedCache();
  await cache.putBeans([bean('bean-1', 'Pink Bourbon'), bean('bean-2', 'Gesha')]);
  await cache.putBeans([bean('bean-1', 'Pink Bourbon')]);

  const beans = await cache.getBeans();
  equal(beans.length, 1);
  equal(beans[0].id, 'bean-1');
  equal(factory.rawKeys(BEANIE_CACHE_DB_NAME, 'beans').join(','), 'bean-1');
});

run('deletes stale bean batches per bean without touching other beans', async () => {
  const { cache, factory } = fakeBackedCache();
  await cache.putBeanBatches('bean-1', [batch('batch-1a', 'bean-1'), batch('batch-1b', 'bean-1')]);
  await cache.putBeanBatches('bean-2', [batch('batch-2a', 'bean-2')]);

  await cache.putBeanBatches('bean-1', [batch('batch-1a', 'bean-1')]);

  const beanOneBatches = await cache.getBeanBatches('bean-1');
  equal(beanOneBatches.length, 1);
  equal(beanOneBatches[0].id, 'batch-1a');

  const beanTwoBatches = await cache.getBeanBatches('bean-2');
  equal(beanTwoBatches.length, 1);
  equal(beanTwoBatches[0].id, 'batch-2a');

  equal(factory.rawKeys(BEANIE_CACHE_DB_NAME, 'beanBatches').join(','), 'batch-1a,batch-2a');
});

run('clearing a collection deletes every previously cached key', async () => {
  const { cache, factory } = fakeBackedCache();
  await cache.putBeanBatches('bean-1', [batch('batch-1a', 'bean-1'), batch('batch-1b', 'bean-1')]);

  await cache.putBeanBatches('bean-1', []);

  equal((await cache.getBeanBatches('bean-1')).length, 0);
  equal(factory.rawKeys(BEANIE_CACHE_DB_NAME, 'beanBatches').length, 0);
});

run('invalidateShotPages drops page entries but keeps shot records and summaries', async () => {
  const { cache } = fakeBackedCache();
  const shot: ShotRecord = {
    id: 'shot-1',
    timestamp: '2026-06-01T10:00:00.000Z',
    workflow: { context: { beanBatchId: 'batch-1' } },
    measurements: []
  };
  const page: PaginatedShots = { items: [shot], total: 1, limit: 1, offset: 0 };
  await cache.putShotPage({ beanBatchId: 'batch-1', limit: 1, offset: 0 }, page);
  await cache.putShotRecord(shot);

  await cache.invalidateShotPages();

  equal(await cache.getShotPage({ beanBatchId: 'batch-1', limit: 1, offset: 0 }), null);
  const record = await cache.getShotRecord('shot-1');
  equal(record?.id, 'shot-1');

  // Re-caching the same page afterwards reuses the surviving summaries/records.
  await cache.putShotPage({ beanBatchId: 'batch-1', limit: 1, offset: 0 }, page);
  equal((await cache.getShotPage({ beanBatchId: 'batch-1', limit: 1, offset: 0 }))?.items.length, 1);

  // Full mutation invalidation still clears the per-shot stores.
  await cache.invalidateShotMutation();
  equal(await cache.getShotRecord('shot-1'), null);
});

run('reopens the database after a versionchange closes the connection', async () => {
  const { cache, factory } = fakeBackedCache();
  await cache.putBeans([bean('bean-1', 'Pink Bourbon')]);
  equal(factory.openConnectionCount(BEANIE_CACHE_DB_NAME), 1);

  factory.notifyVersionChange(BEANIE_CACHE_DB_NAME);
  equal(factory.openConnectionCount(BEANIE_CACHE_DB_NAME), 0);

  const beans = await cache.getBeans();
  equal(beans.length, 1);
  equal(beans[0].id, 'bean-1');
  equal(factory.openConnectionCount(BEANIE_CACHE_DB_NAME), 1);

  await cache.putBeans([bean('bean-2', 'Gesha')]);
  const next = await cache.getBeans();
  equal(next.length, 1);
  equal(next[0].id, 'bean-2');
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

function run(name: string, fn: () => void | Promise<void>): void {
  tests.push({ name, fn });
}

function equal<T>(actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  }
}
