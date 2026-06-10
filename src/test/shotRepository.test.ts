import type { PaginatedShots, ShotRecord, ShotSummary } from '../api/types';
import {
  fetchShotPage,
  loadFullShot,
  loadLatestShotCandidates,
  type ShotRepositoryCache,
  type ShotRepositoryGateway
} from '../data/shotRepository';

const summary: ShotSummary = {
  id: 'shot-1',
  timestamp: '2026-06-01T10:00:00.000Z',
  shotNotes: 'summary notes'
};
const fullRecord: ShotRecord = {
  ...summary,
  shotNotes: 'cached notes',
  measurements: [
    {
      machine: { timestamp: '2026-06-01T10:00:01.000Z', pressure: 8 },
      scale: { timestamp: '2026-06-01T10:00:01.000Z', weight: 18 }
    }
  ]
};
const page: PaginatedShots = {
  items: [summary],
  total: 12,
  limit: 1,
  offset: 0
};

class FakeShotGateway implements ShotRepositoryGateway {
  page: PaginatedShots = page;
  record: ShotRecord = fullRecord;
  failShots = false;
  failShot = false;
  shotQueries: string[] = [];
  shotIds: string[] = [];

  async shots(query: URLSearchParams): Promise<PaginatedShots> {
    this.shotQueries.push(query.toString());
    if (this.failShots) throw new Error('shots unavailable');
    return this.page;
  }

  async shot(id: string): Promise<ShotRecord> {
    this.shotIds.push(id);
    if (this.failShot) throw new Error('shot unavailable');
    return this.record;
  }
}

class FakeShotCache implements ShotRepositoryCache {
  page: PaginatedShots | null = null;
  record: ShotRecord | null = null;
  pageWrites: string[] = [];
  recordWrites: ShotRecord[] = [];
  getRecordCalls = 0;
  failPutRecord = false;

  async putShotPage(query: URLSearchParams, pageValue: PaginatedShots): Promise<void> {
    this.pageWrites.push(query.toString());
    this.page = pageValue;
  }

  async getShotPage(): Promise<PaginatedShots | null> {
    return this.page;
  }

  async putShotRecord(shot: ShotRecord): Promise<void> {
    if (this.failPutRecord) throw new Error('record write failed');
    this.recordWrites.push(shot);
    this.record = shot;
  }

  async getShotRecord(): Promise<ShotRecord | null> {
    this.getRecordCalls += 1;
    return this.record;
  }
}

await run('loadFullShot merges cached measurements with fresh summary fields', async () => {
  const gateway = new FakeShotGateway();
  const cache = new FakeShotCache();
  cache.record = fullRecord;

  const loaded = await loadFullShot(summary, { gateway, cache });

  equal(loaded.shotNotes, 'summary notes');
  equal(loaded.measurements.length, 1);
  equal(cache.recordWrites.length, 1);
  equal(gateway.shotIds.length, 0);
});

await run('loadFullShot fetches and caches a record when no cached record exists', async () => {
  const gateway = new FakeShotGateway();
  const cache = new FakeShotCache();

  const loaded = await loadFullShot(summary, { gateway, cache });

  equal(loaded.measurements.length, 1);
  equal(gateway.shotIds[0], 'shot-1');
  equal(cache.recordWrites.length, 1);
});

await run('loadFullShot skips cache reads and writes when cache generation is stale', async () => {
  const gateway = new FakeShotGateway();
  gateway.failShot = true;
  const cache = new FakeShotCache();
  cache.record = fullRecord;

  const loaded = await loadFullShot(summary, {
    gateway,
    cache,
    canWriteCache: () => false
  });

  equal(cache.getRecordCalls, 0);
  equal(cache.recordWrites.length, 0);
  equal(loaded.measurements.length, 0);
});

await run('loadFullShot resolves the merged record when the cache write fails', async () => {
  const gateway = new FakeShotGateway();
  const cache = new FakeShotCache();
  cache.record = fullRecord;
  cache.failPutRecord = true;

  const loaded = await loadFullShot(summary, { gateway, cache });

  equal(loaded.shotNotes, 'summary notes');
  equal(loaded.measurements.length, 1);
  equal(gateway.shotIds.length, 0);
});

await run('loadFullShot resolves the fetched record when the cache write fails', async () => {
  const gateway = new FakeShotGateway();
  const cache = new FakeShotCache();
  cache.failPutRecord = true;

  const loaded = await loadFullShot(summary, { gateway, cache });

  equal(loaded.measurements.length, 1);
  equal(gateway.shotIds[0], 'shot-1');
});

await run('fetchShotPage cache fallback does not reject when a record cache write fails', async () => {
  const gateway = new FakeShotGateway();
  gateway.failShots = true;
  const cache = new FakeShotCache();
  cache.page = page;
  cache.record = fullRecord;
  cache.failPutRecord = true;

  const loaded = await withSuppressedWarnings(() =>
    fetchShotPage({ query: new URLSearchParams(), pageSize: 12, offset: 0 }, { gateway, cache })
  );

  equal(loaded.total, 12);
  equal(loaded.records[0]?.id, 'shot-1');
  equal(loaded.records[0]?.measurements.length, 1);
});

await run('fetchShotPage sets pagination, writes the page, and hydrates records', async () => {
  const gateway = new FakeShotGateway();
  const cache = new FakeShotCache();
  const query = new URLSearchParams({ order: 'desc' });

  const loaded = await fetchShotPage({ query, pageSize: 24, offset: 48 }, { gateway, cache });

  equal(gateway.shotQueries[0], 'order=desc&limit=24&offset=48');
  equal(cache.pageWrites[0], 'order=desc&limit=24&offset=48');
  equal(loaded.total, 12);
  equal(loaded.records[0]?.measurements.length, 1);
});

await run('fetchShotPage falls back before caching when a page is rejected', async () => {
  const gateway = new FakeShotGateway();
  const cache = new FakeShotCache();
  const query = new URLSearchParams({ beanId: 'bean-1' });
  const fallbackQuery = new URLSearchParams({ coffeeRoaster: 'Kawa', coffeeName: 'Pink Bourbon' });

  const loaded = await fetchShotPage(
    {
      query,
      pageSize: 24,
      offset: 0,
      fallbackQuery,
      acceptPage: () => false
    },
    { gateway, cache }
  );

  equal(gateway.shotQueries[0], 'beanId=bean-1&limit=24&offset=0');
  equal(gateway.shotQueries[1], 'coffeeRoaster=Kawa&coffeeName=Pink+Bourbon&limit=24&offset=0');
  equal(cache.pageWrites.length, 1);
  equal(cache.pageWrites[0], 'coffeeRoaster=Kawa&coffeeName=Pink+Bourbon&limit=24&offset=0');
  equal(loaded.total, 12);
});

await run('fetchShotPage falls back to a cached page when shots fail', async () => {
  const gateway = new FakeShotGateway();
  gateway.failShots = true;
  const cache = new FakeShotCache();
  cache.page = page;

  const loaded = await withSuppressedWarnings(() =>
    fetchShotPage({ query: new URLSearchParams(), pageSize: 10, offset: 20 }, { gateway, cache })
  );

  equal(loaded.total, 12);
  equal(loaded.records[0]?.id, 'shot-1');
});

await run('loadLatestShotCandidates returns cached candidates when latest page fails', async () => {
  const gateway = new FakeShotGateway();
  gateway.failShots = true;
  const cache = new FakeShotCache();
  cache.page = page;

  const loaded = await withSuppressedWarnings(() => loadLatestShotCandidates(6, { gateway, cache }));

  equal(loaded.length, 1);
  equal(loaded[0]?.id, 'shot-1');
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
