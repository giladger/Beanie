import type { Bean, PaginatedShots, ShotRecord } from '../api/types';
import {
  BEANIE_CACHE_DB_VERSION,
  cachePageKey,
  createBeanieCache,
  normalizeCacheQuery,
  shotPageCacheKey
} from '../domain/cache';

interface TestCase {
  name: string;
  fn: () => void | Promise<void>;
}

const tests: TestCase[] = [];

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
