import {
  ApiValidationError,
  readBeans,
  readMachineInfo,
  readMachineSnapshot,
  readPaginatedShots,
  readShotRecord
} from '../api/guards';
import {
  GatewayRequestError,
  createDemoStartupSnapshot,
  fallbackFromGatewaySnapshot,
  gateway,
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

await run('guards normalize machine state snapshots for startup sleep checks', () => {
  const snapshot = readMachineSnapshot({ state: { state: 'sleeping' } });

  equal(snapshot.state.state, 'sleeping');
  equal(snapshot.flow, 0);
  equal(snapshot.groupTemperature, 0);
});

await run('guards preserve workflow machine flow calibration on shots', () => {
  const shot = readShotRecord({
    id: 'shot-flow-cal',
    timestamp: '2026-06-08T09:00:00.000Z',
    workflow: { machine: { flowCalibration: 1.17 } },
    measurements: []
  });

  equal(shot.workflow?.machine?.flowCalibration, 1.17);
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

await run('plugin settings save uses Reaprime POST endpoint', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const restore = installFetchStub(calls, {});
  try {
    await gateway.updatePluginSettings('visualizer.reaplugin', {
      Username: 'user@example.com',
      Password: 'secret',
      AutoUpload: true,
      LengthThreshold: 6
    });
  } finally {
    restore();
  }

  equal(calls.length, 1);
  equal(calls[0]!.url, '/api/v1/plugins/visualizer.reaplugin/settings');
  equal(calls[0]!.init?.method, 'POST');
  equal(calls[0]!.init?.body, JSON.stringify({
    Username: 'user@example.com',
    Password: 'secret',
    AutoUpload: true,
    LengthThreshold: 6
  }));
});

await run('visualizer verify calls plugin verifyCredentials endpoint', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const restore = installFetchStub(calls, { valid: true });
  let ok = false;
  try {
    ok = (await gateway.verifyPlugin('visualizer.reaplugin', { username: 'user@example.com', password: 'secret' })).ok;
  } finally {
    restore();
  }

  equal(ok, true);
  equal(calls.length, 1);
  equal(calls[0]!.url, '/api/v1/plugins/visualizer.reaplugin/verifyCredentials');
  equal(calls[0]!.init?.method, 'POST');
  equal(calls[0]!.init?.body, JSON.stringify({ username: 'user@example.com', password: 'secret' }));
});

await run('decent account login posts credentials to account endpoint', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const restore = installFetchStub(calls, { loggedIn: true, email: 'user@example.com' });
  let email: string | null = null;
  try {
    email = (await gateway.loginDecentAccount('user@example.com', 'secret')).email;
  } finally {
    restore();
  }

  equal(email, 'user@example.com');
  equal(calls.length, 1);
  equal(calls[0]!.url, '/api/v1/account/decent/login');
  equal(calls[0]!.init?.method, 'POST');
  equal(calls[0]!.init?.body, JSON.stringify({ email: 'user@example.com', password: 'secret' }));
});

await run('decent account login includes gateway error body in request errors', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const restore = installFetchStub(calls, { error: 'Invalid Decent account email or password' }, 401);
  try {
    await gateway.loginDecentAccount('user@example.com', 'wrong');
  } catch (error) {
    if (!(error instanceof GatewayRequestError)) {
      throw new Error(`Expected GatewayRequestError, received ${String(error)}`);
    }
    equal(error.issue.statusCode, 401);
    equal(error.issue.message.includes('Invalid Decent account email or password'), true);
    return;
  } finally {
    restore();
  }

  throw new Error('Expected Decent account login to fail');
});

await run('decent account logout deletes account endpoint', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const restore = installFetchStub(calls, {});
  try {
    await gateway.logoutDecentAccount();
  } finally {
    restore();
  }

  equal(calls.length, 1);
  equal(calls[0]!.url, '/api/v1/account/decent');
  equal(calls[0]!.init?.method, 'DELETE');
});

await run('device scan uses scan-only Reaprime endpoint before listing devices', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const restore = installFetchStub(calls, [{ id: 'scale-1', name: 'Scale', state: 'disconnected', type: 'scale' }]);
  try {
    await gateway.scanDevices();
  } finally {
    restore();
  }

  equal(calls.length, 2);
  equal(calls[0]!.url, '/api/v1/devices/scan?connect=false');
  equal(calls[1]!.url, '/api/v1/devices');
});

await run('preferred device connect uses Reaprime scan-and-connect endpoint before listing devices', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const restore = installFetchStub(calls, [{ id: 'scale-1', name: 'Scale', state: 'connected', type: 'scale' }]);
  try {
    await gateway.connectPreferredDevices();
  } finally {
    restore();
  }

  equal(calls.length, 2);
  equal(calls[0]!.url, '/api/v1/devices/scan?connect=true');
  equal(calls[1]!.url, '/api/v1/devices');
});

await run('scale tare calls Reaprime tare endpoint', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const restore = installFetchStub(calls, {});
  try {
    await gateway.tareScale();
  } finally {
    restore();
  }

  equal(calls.length, 1);
  equal(calls[0]!.url, '/api/v1/scale/tare');
  equal(calls[0]!.init?.method, 'PUT');
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

function installFetchStub(
  calls: Array<{ url: string; init?: RequestInit }>,
  responseBody: unknown,
  status = 200
): () => void {
  const previousFetch = globalThis.fetch;
  const previousWindow = (globalThis as unknown as { window?: unknown }).window;
  const previousLocation = (globalThis as unknown as { location?: unknown }).location;
  (globalThis as unknown as { window: { BEANIE_GATEWAY?: string } }).window = {};
  (globalThis as unknown as { location: { port: string; protocol: string; hostname: string; origin: string } }).location = {
    port: '',
    protocol: 'http:',
    hostname: 'localhost',
    origin: ''
  };
  globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(responseBody), {
      status,
      headers: { 'Content-Type': 'application/json' }
    });
  };
  return () => {
    globalThis.fetch = previousFetch;
    (globalThis as unknown as { window?: unknown }).window = previousWindow;
    (globalThis as unknown as { location?: unknown }).location = previousLocation;
  };
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
