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

await run('cacheStartupData publishes nothing after startup authority is revoked', async () => {
  const cache = new FakeStartupCache();
  await cacheStartupData(
    { workflow, beans, grinders, profiles, latestShots },
    latestQuery(),
    cache,
    () => false
  );
  equal(cache.puts.length, 0);
});

await run('cachedStartupData does not present empty collection defaults as cached data', async () => {
  const cache = new FakeStartupCache();
  cache.workflow = workflow;

  const cached = await cachedStartupData(latestQuery(), cache);

  equal(cached.workflow?.name, 'Current workflow');
  equal(cached.beans, undefined);
  equal(cached.grinders, undefined);
  equal(cached.profiles, undefined);
  equal(cached.latestShots, undefined);
});

await run('loadGatewayStartupWithCache fills failed resources from cache with truthful metadata', async () => {
  const cache = new FakeStartupCache();
  cache.workflow = workflow;
  cache.beans = beans;
  cache.grinders = grinders;
  cache.profiles = profiles;
  cache.latestShots = latestShots;
  const workflowIssue = failed<Workflow>('workflow', 'workflow unavailable');
  const profilesIssue = failed<ProfileRecord[]>('profiles', 'profiles unavailable');
  const shotsIssue = failed<PaginatedShots>('shots', 'shots unavailable');
  const startup = startupSnapshot(
    { beans: [], grinders },
    {
      workflow: workflowIssue,
      beans: loaded('beans', []),
      grinders: loaded('grinders', grinders),
      profiles: profilesIssue,
      shots: shotsIssue
    },
    [workflowIssue.issue, profilesIssue.issue, shotsIssue.issue]
  );

  const loadedStartup = await loadGatewayStartupWithCache(latestQuery(), {
    cache,
    loadStartup: async () => startup
  });

  equal(loadedStartup.data.workflow?.name, 'Current workflow');
  equal(JSON.stringify(loadedStartup.data.beans), '[]');
  equal(loadedStartup.data.grinders?.[0]?.id, 'grinder-1');
  equal(loadedStartup.data.profiles?.[0]?.id, 'profile-1');
  equal(loadedStartup.data.latestShots?.items[0]?.id, 'shot-1');
  equal(loadedStartup.resources.workflow.status, 'loaded');
  equal(loadedStartup.resources.workflow.source, 'cache');
  equal(loadedStartup.resources.beans.status, 'loaded');
  equal(loadedStartup.resources.beans.source, 'gateway');
  equal(loadedStartup.resources.grinders.status, 'loaded');
  equal(loadedStartup.resources.grinders.source, 'gateway');
  equal(loadedStartup.resources.profiles.status, 'loaded');
  equal(loadedStartup.resources.profiles.source, 'cache');
  equal(loadedStartup.resources.shots.status, 'loaded');
  equal(loadedStartup.resources.shots.source, 'cache');
  equal(loadedStartup.status, 'partial-failure');
  equal(loadedStartup.issues, startup.issues);
});

await run('loadGatewayStartupWithCache leaves failed resources failed without proven cached data', async () => {
  const cache = new FakeStartupCache();
  const workflowIssue = failed<Workflow>('workflow', 'workflow unavailable');
  const grindersIssue = failed<Grinder[]>('grinders', 'grinders unavailable');
  const profilesIssue = failed<ProfileRecord[]>('profiles', 'profiles unavailable');
  const startup = startupSnapshot(
    { beans, latestShots },
    {
      workflow: workflowIssue,
      beans: loaded('beans', beans),
      grinders: grindersIssue,
      profiles: profilesIssue,
      shots: loaded('shots', latestShots)
    },
    [workflowIssue.issue, grindersIssue.issue, profilesIssue.issue]
  );

  const loadedStartup = await loadGatewayStartupWithCache(latestQuery(), {
    cache,
    loadStartup: async () => startup
  });

  equal(loadedStartup.data.workflow, undefined);
  equal(loadedStartup.data.grinders, undefined);
  equal(loadedStartup.data.profiles, undefined);
  equal(loadedStartup.resources.workflow.status, 'failed');
  equal(loadedStartup.resources.workflow.source, 'gateway');
  equal(loadedStartup.resources.grinders.status, 'failed');
  equal(loadedStartup.resources.grinders.source, 'gateway');
  equal(loadedStartup.resources.profiles.status, 'failed');
  equal(loadedStartup.resources.profiles.source, 'gateway');
  equal(loadedStartup.status, 'partial-failure');
  equal(loadedStartup.issues, startup.issues);
});

function latestQuery(): URLSearchParams {
  return new URLSearchParams({ limit: '1', offset: '0', order: 'desc' });
}

function startupSnapshot(
  data: GatewayStartupSnapshot['data'],
  resources: GatewayStartupSnapshot['resources'] = {
    workflow: loaded('workflow', workflow),
    beans: loaded('beans', beans),
    grinders: loaded('grinders', grinders),
    profiles: loaded('profiles', profiles),
    shots: loaded('shots', latestShots)
  },
  issues: GatewayStartupSnapshot['issues'] = []
): GatewayStartupSnapshot {
  return {
    mode: 'real',
    status: 'partial-failure',
    source: 'gateway',
    origin: 'http://gateway.test',
    fallbackToDemo: null,
    issues,
    resources,
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

function failed<T>(resource: ApiResource<T>['resource'], message: string): ApiResource<T> & {
  status: 'failed';
} {
  return {
    resource,
    status: 'failed',
    source: 'gateway',
    issue: { resource, kind: 'network', message },
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
