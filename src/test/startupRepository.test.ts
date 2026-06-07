import {
  cachedStartupData,
  cacheStartupData,
  loadGatewayStartupWithCache,
  type StartupCache
} from '../data/startupRepository';
import type {
  ApiResource,
  Bean,
  GatewayStartupSnapshot,
  Grinder,
  PaginatedShots,
  ProfileRecord,
  Workflow
} from '../api/types';

const workflow: Workflow = {
  name: 'Current workflow',
  profile: { title: 'Default' },
  context: { coffeeName: 'Pink Bourbon' }
};
const beans: Bean[] = [{ id: 'bean-1', roaster: 'Kawa', name: 'Pink Bourbon' }];
const grinders: Grinder[] = [{ id: 'grinder-1', model: 'DF64' }];
const profiles: ProfileRecord[] = [{ id: 'profile-1', profile: { title: 'Default' } }];
const latestShots: PaginatedShots = {
  items: [{ id: 'shot-1', timestamp: '2026-06-01T10:00:00.000Z' }],
  total: 1,
  limit: 1,
  offset: 0
};

class FakeStartupCache implements StartupCache {
  puts: string[] = [];
  workflow: Workflow | null = null;
  beans: Bean[] = [];
  grinders: Grinder[] = [];
  profiles: ProfileRecord[] = [];
  latestShots: PaginatedShots | null = null;
  failPutProfiles = false;

  async putWorkflow(workflowValue: Workflow | null): Promise<void> {
    this.puts.push('workflow');
    this.workflow = workflowValue;
  }

  async putBeans(beanValues: readonly Bean[]): Promise<void> {
    this.puts.push('beans');
    this.beans = [...beanValues];
  }

  async putGrinders(grinderValues: readonly Grinder[]): Promise<void> {
    this.puts.push('grinders');
    this.grinders = [...grinderValues];
  }

  async putProfiles(profileValues: readonly ProfileRecord[]): Promise<void> {
    this.puts.push('profiles');
    if (this.failPutProfiles) throw new Error('profile write failed');
    this.profiles = [...profileValues];
  }

  async putShotPage(_query: URLSearchParams, page: PaginatedShots): Promise<void> {
    this.puts.push('shots');
    this.latestShots = page;
  }

  async getWorkflow(): Promise<Workflow | null> {
    return this.workflow;
  }

  async getBeans(): Promise<Bean[]> {
    return this.beans;
  }

  async getGrinders(): Promise<Grinder[]> {
    return this.grinders;
  }

  async getProfiles(): Promise<ProfileRecord[]> {
    return this.profiles;
  }

  async getShotPage(): Promise<PaginatedShots | null> {
    return this.latestShots;
  }
}

await run('cacheStartupData writes loaded startup resources and ignores write failures', async () => {
  const cache = new FakeStartupCache();
  cache.failPutProfiles = true;

  await cacheStartupData({ workflow, beans, grinders, profiles, latestShots }, latestQuery(), cache);

  equal(cache.puts.includes('workflow'), true);
  equal(cache.puts.includes('beans'), true);
  equal(cache.puts.includes('grinders'), true);
  equal(cache.puts.includes('profiles'), true);
  equal(cache.puts.includes('shots'), true);
});

await run('cachedStartupData returns cached essentials and empty optional collections', async () => {
  const cache = new FakeStartupCache();
  cache.workflow = workflow;

  const cached = await cachedStartupData(latestQuery(), cache);

  equal(cached.workflow?.name, 'Current workflow');
  equal(cached.beans, undefined);
  equal(JSON.stringify(cached.grinders), '[]');
  equal(JSON.stringify(cached.profiles), '[]');
  equal(cached.latestShots, undefined);
});

await run('loadGatewayStartupWithCache fills missing gateway data from cache', async () => {
  const cache = new FakeStartupCache();
  cache.workflow = workflow;
  cache.beans = beans;
  cache.grinders = grinders;
  cache.profiles = profiles;
  cache.latestShots = latestShots;
  const startup = startupSnapshot({ grinders: [] });

  const loaded = await loadGatewayStartupWithCache(latestQuery(), {
    cache,
    loadStartup: async () => startup
  });

  equal(loaded.data.workflow?.name, 'Current workflow');
  equal(loaded.data.beans?.[0]?.id, 'bean-1');
  equal(JSON.stringify(loaded.data.grinders), '[]');
  equal(loaded.data.profiles?.[0]?.id, 'profile-1');
  equal(loaded.data.latestShots?.items[0]?.id, 'shot-1');
});

function latestQuery(): URLSearchParams {
  return new URLSearchParams({ limit: '1', offset: '0', order: 'desc' });
}

function startupSnapshot(data: GatewayStartupSnapshot['data']): GatewayStartupSnapshot {
  return {
    mode: 'real',
    status: 'partial-failure',
    source: 'gateway',
    origin: 'http://gateway.test',
    fallbackToDemo: null,
    issues: [],
    resources: {
      workflow: loaded('workflow', workflow),
      beans: loaded('beans', beans),
      grinders: loaded('grinders', grinders),
      profiles: loaded('profiles', profiles),
      shots: loaded('shots', latestShots)
    },
    data
  };
}

function loaded<T>(resource: ApiResource<T>['resource'], data: T): ApiResource<T> {
  return {
    resource,
    status: 'loaded',
    source: 'gateway',
    data,
    receivedAt: '2026-06-01T00:00:00.000Z'
  };
}

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
