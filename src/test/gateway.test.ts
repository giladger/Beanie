import { ApiValidationError, readBeans, readMachineInfo, readPaginatedShots } from '../api/guards';
import {
  GatewayRequestError,
  createDemoStartupSnapshot,
  fallbackFromGatewaySnapshot,
  loadGatewayStartup,
  type GatewayStartupClient
} from '../api/gateway';
import type { Bean, Grinder, PaginatedShots, ProfileRecord, Workflow } from '../api/types';

const workflow: Workflow = {
  name: 'Current workflow',
  profile: { title: 'Default' },
  context: {
    coffeeRoaster: 'Kawa',
    coffeeName: 'Pink Bourbon',
    targetDoseWeight: 18
  }
};

const beans: Bean[] = [{ id: 'bean-1', roaster: 'Kawa', name: 'Pink Bourbon' }];
const grinders: Grinder[] = [{ id: 'grinder-1', model: 'DF64' }];
const profiles: ProfileRecord[] = [{ id: 'profile-1', profile: { title: 'Default' } }];
const latestShots: PaginatedShots = {
  items: [{ id: 'shot-1', timestamp: '2026-06-01T10:00:00Z', workflow }],
  total: 1,
  limit: 1,
  offset: 0
};

const okClient: GatewayStartupClient = {
  workflow: async () => workflow,
  beans: async () => beans,
  grinders: async () => grinders,
  profiles: async () => profiles,
  shots: async (_query: URLSearchParams) => latestShots
};

await run('guards preserve valid bean responses', () => {
  const guarded = readBeans([
    {
      id: 'bean-extra',
      roaster: 'Tsukcafe',
      name: 'Tore Badiya',
      unknownGatewayField: 'kept'
    }
  ]);

  equal(guarded[0]?.id, 'bean-extra');
  equal((guarded[0] as { unknownGatewayField?: string } | undefined)?.unknownGatewayField, 'kept');
});

await run('guards preserve machine info group-head-controller flag', () => {
  const info = readMachineInfo({
    version: '1337',
    model: 'MockDe1',
    serialNumber: 'mock-de1',
    GHC: false,
    extra: { simulated: true }
  });

  equal(info.GHC, false);
  equal(info.extra?.simulated, true);
});

await run('guards reject malformed bean responses', () => {
  throwsValidation(() => readBeans([{ id: 'bean-missing-name', roaster: 'Kawa' }]), '$[0].name');
});

await run('guards reject malformed paginated shot summaries', () => {
  throwsValidation(
    () => readPaginatedShots({ items: [{ id: 'shot-missing-time' }], total: 1, limit: 1, offset: 0 }),
    '$.items[0].timestamp'
  );
});

await run('startup snapshot reports connected gateway when every resource loads', async () => {
  const snapshot = await loadGatewayStartup({ client: okClient, origin: 'http://gateway.test' });

  equal(snapshot.mode, 'real');
  equal(snapshot.status, 'connected');
  equal(snapshot.data.beans?.[0]?.id, 'bean-1');
  equal(snapshot.issues.length, 0);
  equal(snapshot.resources.profiles.status, 'loaded');
});

await run('startup snapshot preserves partial gateway data and failures', async () => {
  const partialClient: GatewayStartupClient = {
    ...okClient,
    profiles: async () => {
      throw new GatewayRequestError({
        resource: 'profiles',
        kind: 'http',
        statusCode: 503,
        message: 'Profiles unavailable'
      });
    }
  };

  const snapshot = await loadGatewayStartup({
    client: partialClient,
    origin: 'http://gateway.test'
  });
  const fallback = fallbackFromGatewaySnapshot(snapshot, 'Use demo after partial startup');
  const demo = createDemoStartupSnapshot({
    workflow,
    beans,
    grinders,
    profiles,
    latestShots,
    fallbackToDemo: fallback
  });

  equal(snapshot.status, 'partial-failure');
  equal(snapshot.data.beans?.length, 1);
  equal(snapshot.resources.profiles.status, 'failed');
  equal(fallback?.fromStatus, 'partial-failure');
  equal(demo.mode, 'demo');
  equal(demo.fallbackToDemo?.issues.length, 1);
});

await run('startup snapshot reports unavailable when no gateway resources load', async () => {
  const fail = async () => {
    throw new Error('offline');
  };
  const unavailableClient: GatewayStartupClient = {
    workflow: fail,
    beans: fail,
    grinders: fail,
    profiles: fail,
    shots: fail
  };

  const snapshot = await loadGatewayStartup({
    client: unavailableClient,
    origin: 'http://gateway.test'
  });

  equal(snapshot.status, 'gateway-unavailable');
  equal(snapshot.issues.length, 5);
  equal(snapshot.data.beans, undefined);
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

function throwsValidation(fn: () => unknown, expectedPath: string): void {
  try {
    fn();
  } catch (error) {
    if (!(error instanceof ApiValidationError)) {
      throw new Error(`Expected ApiValidationError, received ${String(error)}`);
    }
    if (!error.issues.some((issue) => issue.path === expectedPath)) {
      throw new Error(`Expected validation issue at ${expectedPath}`);
    }
    return;
  }

  throw new Error('Expected validation to fail');
}
