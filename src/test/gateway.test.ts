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
  gateway,
  loadGatewayStartup,
  type GatewayStartupClient
} from '../api/gateway';
import type { Bean, BeanBatchStorageEvent, Grinder, PaginatedShots, ProfileRecord, Workflow } from '../api/types';

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

await run('guards reject bean responses that are not arrays', () => {
  throwsValidation(() => readBeans({ beans: [] }), '$');
});

await run('guards drop malformed bean records but keep the rest', () => {
  const restoreWarn = silenceWarn();
  try {
    const guarded = readBeans([
      { id: 'bean-missing-name', roaster: 'Kawa' },
      { id: 'bean-ok', roaster: 'Kawa', name: 'Pink Bourbon' }
    ]);
    equal(guarded.length, 1);
    equal(guarded[0]?.id, 'bean-ok');
  } finally {
    restoreWarn();
  }
});

await run('guards drop malformed paginated shot summaries but keep the page', () => {
  const restoreWarn = silenceWarn();
  try {
    const page = readPaginatedShots({
      items: [{ id: 'shot-missing-time' }, { id: 'shot-ok', timestamp: '2026-06-01T10:00:00Z' }],
      total: 2,
      limit: 2,
      offset: 0
    });
    equal(page.items.length, 1);
    equal(page.items[0]?.id, 'shot-ok');
    equal(page.total, 2);
  } finally {
    restoreWarn();
  }
});

await run('guards reject paginated shots without an items array', () => {
  throwsValidation(
    () => readPaginatedShots({ items: 'nope', total: 1, limit: 1, offset: 0 }),
    '$.items'
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

  equal(snapshot.status, 'partial-failure');
  equal(snapshot.data.beans?.length, 1);
  equal(snapshot.resources.profiles.status, 'failed');
  equal(snapshot.issues.length, 1);
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

await run('decent account status reads the status-only account endpoint', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const restore = installFetchStub(calls, { loggedIn: true });
  let loggedIn = false;
  let email: string | null = 'stale@example.com';
  try {
    const status = await gateway.decentAccount();
    loggedIn = status.loggedIn;
    email = status.email;
  } finally {
    restore();
  }

  equal(loggedIn, true);
  equal(email, null);
  equal(calls.length, 1);
  equal(calls[0]!.url, '/api/v1/account/decent');
  equal(calls[0]!.init?.method, undefined);
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

await run('decent account login includes injected skin token when present', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const restore = installFetchStub(calls, { loggedIn: true, email: null }, 200, 'skin-token');
  try {
    await gateway.loginDecentAccount('user@example.com', 'secret');
  } finally {
    restore();
  }

  equal(headerValue(calls[0]!.init?.headers, 'Authorization'), 'Bearer skin-token');
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

await run('updateBatch nests storageEvents under extras and lifts them back from the response', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const events: BeanBatchStorageEvent[] = [{ type: 'frozen', at: '2026-05-22T08:00:00.000Z' }];
  // reaprime has no top-level storageEvents column, so it round-trips them inside `extras`.
  const restore = installFetchStub(calls, { id: 'batch-1', beanId: 'bean-1', frozen: true, extras: { storageEvents: events } });
  try {
    const saved = await gateway.updateBatch('batch-1', { beanId: 'bean-1', frozen: true, storageEvents: events });
    equal(calls[0]!.init?.method, 'PUT');
    // The request nests the events under extras, not at the top level.
    const sent = JSON.parse(calls[0]!.init?.body as string) as { storageEvents?: unknown; extras?: { storageEvents?: BeanBatchStorageEvent[] } };
    equal(sent.storageEvents, undefined);
    equal(sent.extras?.storageEvents?.[0]?.at, '2026-05-22T08:00:00.000Z');
    // The response's nested events are lifted back to the top-level field.
    equal(saved.storageEvents?.length, 1);
    equal(saved.storageEvents?.[0]?.at, '2026-05-22T08:00:00.000Z');
    equal((saved as { extras?: unknown }).extras, undefined);
    equal(saved.frozen, true);
  } finally {
    restore();
  }
});

await run('createBatch nests storageEvents under extras and lifts them back from the response', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const events: BeanBatchStorageEvent[] = [{ type: 'frozen', at: '2026-05-30T08:00:00.000Z' }];
  const restore = installFetchStub(calls, { id: 'batch-2', beanId: 'bean-1', weightRemaining: 120, frozen: true, extras: { storageEvents: events } });
  try {
    const saved = await gateway.createBatch('bean-1', { beanId: 'bean-1', weightRemaining: 120, frozen: true, storageEvents: events });
    const sent = JSON.parse(calls[0]!.init?.body as string) as { storageEvents?: unknown; extras?: { storageEvents?: BeanBatchStorageEvent[] } };
    equal(sent.storageEvents, undefined);
    equal(sent.extras?.storageEvents?.[0]?.at, '2026-05-30T08:00:00.000Z');
    equal(saved.storageEvents?.[0]?.at, '2026-05-30T08:00:00.000Z');
    equal(saved.frozen, true);
  } finally {
    restore();
  }
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
  status = 200,
  skinToken?: string
): () => void {
  const previousFetch = globalThis.fetch;
  const previousWindow = (globalThis as unknown as { window?: unknown }).window;
  const previousLocation = (globalThis as unknown as { location?: unknown }).location;
  (globalThis as unknown as { window: { BEANIE_GATEWAY?: string; __REA_PROXY_TOKEN__?: string } }).window = {};
  if (skinToken) {
    (globalThis as unknown as { window: { __REA_PROXY_TOKEN__?: string } }).window.__REA_PROXY_TOKEN__ = skinToken;
  }
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

function silenceWarn(): () => void {
  const previous = console.warn;
  console.warn = () => {};
  return () => {
    console.warn = previous;
  };
}

function headerValue(headers: HeadersInit | undefined, key: string): string | null {
  if (!headers) return null;
  return new Headers(headers).get(key);
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
