import type {
  ApiIssue,
  ApiResource,
  ApiResourceName,
  Bean,
  BeanBatch,
  De1MachineSettings,
  GatewayStartupSnapshot,
  Grinder,
  MachineCapabilities,
  MachineInfo,
  MachineSnapshot,
  MachineState,
  PaginatedShots,
  Profile,
  ProfileRecord,
  ShotRecord,
  ShotUpdate,
  Workflow
} from './types';
import {
  ApiValidationError,
  readBatch,
  readBatches,
  readBean,
  readBeans,
  readDe1MachineSettings,
  readGrinder,
  readGrinders,
  readMachineCapabilities,
  readMachineInfo,
  readMachineSnapshot,
  readPaginatedShots,
  readProfile,
  readProfiles,
  readShotRecord,
  readWorkflow,
  type ApiResponseGuard
} from './guards';
import {
  de1MachineSettingsPatchBody,
  readDe1AdvancedSettings,
  readDe1Calibration,
  readDecentAccountStatus,
  readDevices,
  readDisplayState,
  readPlugins,
  readPluginSettings,
  readPluginVerify,
  readPresenceSettings,
  readReaSettings,
  readSkins,
  readWakeSchedules,
  type De1AdvancedSettings,
  type De1AdvancedSettingsPatch,
  type De1Calibration,
  type DecentAccountStatus,
  type DeviceInfo,
  type DisplayState,
  type PluginInfo,
  type PluginSettings,
  type PluginVerifyResult,
  type PresenceSettings,
  type PresenceSettingsPatch,
  type ReaSettings,
  type ReaSettingsPatch,
  type SkinInfo,
  type WakeSchedule
} from './settings';

function resolveGatewayOrigin(): string {
  const override = window.BEANIE_GATEWAY;
  if (override) return override.replace(/\/$/, '');
  if (location.port === '3000') {
    return `${location.protocol}//${location.hostname}:8080`;
  }
  return '';
}

export function gatewayHttpOrigin(): string {
  return resolveGatewayOrigin();
}

export function gatewayWsOrigin(): string {
  const origin = resolveGatewayOrigin();
  if (origin) return origin.replace(/^http/, 'ws');
  return location.origin.replace(/^http/, 'ws');
}

export class GatewayRequestError extends Error {
  constructor(
    readonly issue: ApiIssue,
    readonly cause?: unknown
  ) {
    super(issue.message);
    this.name = 'GatewayRequestError';
  }
}

// Every gateway request is guarded by a timeout so a hung gateway can never
// wedge the UI forever. reaprime can sit on a workflow PUT for up to its ~10s
// BLE write timeout (plus a reconnect attempt) when the DE1 is asleep, so the
// budget is generous enough not to abort a request it is still honestly
// processing — but it always settles instead of hanging.
const REQUEST_TIMEOUT_MS = 20000;

// Respect an explicit caller signal; otherwise attach a timeout signal.
function requestTimeout(existing?: AbortSignal | null): {
  signal: AbortSignal | undefined;
  done: () => void;
} {
  if (existing) return { signal: existing, done: () => {} };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

function isAbort(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError';
}

async function fetchJson<T>(
  resource: ApiResourceName,
  path: string,
  guard: ApiResponseGuard<T>,
  init?: RequestInit
): Promise<T> {
  const method = init?.method ?? 'GET';
  const timeout = requestTimeout(init?.signal);
  let res: Response;
  try {
    res = await fetch(`${gatewayHttpOrigin()}${path}`, { ...init, signal: timeout.signal });
  } catch (cause) {
    const message = isAbort(cause) ? `${method} ${path} timed out` : `Could not reach ${path}`;
    throw requestError(resource, path, method, 'network', message, cause);
  } finally {
    timeout.done();
  }

  if (!res.ok) {
    const detail = await responseErrorDetail(res);
    throw requestError(
      resource,
      path,
      method,
      'http',
      detail ? `${method} ${path} returned ${res.status}: ${detail}` : `${method} ${path} returned ${res.status}`,
      undefined,
      res.status
    );
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch (cause) {
    throw requestError(resource, path, method, 'malformed', `${method} ${path} returned invalid JSON`, cause);
  }

  try {
    return guard(body);
  } catch (cause) {
    if (cause instanceof ApiValidationError) {
      throw requestError(
        resource,
        path,
        method,
        'malformed',
        `${method} ${path} returned a malformed ${cause.label} response`,
        cause,
        undefined,
        cause.issues.map((issue) => `${issue.path}: ${issue.message}`)
      );
    }
    throw cause;
  }
}

async function fetchEmpty(
  resource: ApiResourceName,
  path: string,
  init?: RequestInit
): Promise<void> {
  const method = init?.method ?? 'GET';
  const timeout = requestTimeout(init?.signal);
  let res: Response;
  try {
    res = await fetch(`${gatewayHttpOrigin()}${path}`, { ...init, signal: timeout.signal });
  } catch (cause) {
    const message = isAbort(cause) ? `${method} ${path} timed out` : `Could not reach ${path}`;
    throw requestError(resource, path, method, 'network', message, cause);
  } finally {
    timeout.done();
  }

  if (!res.ok) {
    const detail = await responseErrorDetail(res);
    throw requestError(
      resource,
      path,
      method,
      'http',
      detail ? `${method} ${path} returned ${res.status}: ${detail}` : `${method} ${path} returned ${res.status}`,
      undefined,
      res.status
    );
  }
}

async function responseErrorDetail(res: Response): Promise<string | null> {
  let text = '';
  try {
    text = await res.text();
  } catch {
    return null;
  }
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const json = JSON.parse(trimmed) as unknown;
    if (json && typeof json === 'object') {
      const record = json as Record<string, unknown>;
      const detail = record.error ?? record.message ?? record.details ?? record.type;
      if (typeof detail === 'string' && detail.trim()) return detail.trim();
    }
  } catch {
    // Plain text error body.
  }
  return trimmed.length > 180 ? `${trimmed.slice(0, 177)}...` : trimmed;
}

function jsonPost(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}

// The gateway persists a batch's `frozen` flag but never stores its
// `storageEvents` array — a PUT/POST always echoes back `storageEvents: null`
// (verified against the live gateway). Since the server can't round-trip the
// freeze/thaw dates, we keep the client authoritative: merge what we just sent
// back into the parsed response so the stripped reply doesn't clobber the dates
// in state and the local cache. Without this, editing a freeze/thaw date silently
// reverts the moment the save completes.
function withSentStorage(saved: BeanBatch, sent: Partial<BeanBatch>): BeanBatch {
  const next = { ...saved };
  if ('storageEvents' in sent) next.storageEvents = sent.storageEvents ?? null;
  if (typeof sent.frozen === 'boolean') next.frozen = sent.frozen;
  return next;
}

function withSkinProxyToken(init: RequestInit): RequestInit {
  const token = window.__REA_PROXY_TOKEN__;
  if (!token) return init;
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return { ...init, headers };
}

export const gateway = {
  machineInfo: () => fetchJson<MachineInfo>('machine', '/api/v1/machine/info', readMachineInfo),

  workflow: () => fetchJson<Workflow>('workflow', '/api/v1/workflow', readWorkflow),
  updateWorkflow: (body: Workflow) =>
    fetchJson<Workflow>('workflow', '/api/v1/workflow', readWorkflow, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }),

  beans: () => fetchJson<Bean[]>('beans', '/api/v1/beans?includeArchived=false', readBeans),
  createBean: (bean: Partial<Bean>) =>
    fetchJson<Bean>('beans', '/api/v1/beans', readBean, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bean)
    }),
  updateBean: (id: string, bean: Partial<Bean>) =>
    fetchJson<Bean>('beans', `/api/v1/beans/${encodeURIComponent(id)}`, readBean, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bean)
    }),
  batches: (beanId: string) =>
    fetchJson<BeanBatch[]>(
      'batches',
      `/api/v1/beans/${encodeURIComponent(beanId)}/batches?includeArchived=false`,
      readBatches
    ),
  createBatch: (beanId: string, batch: Partial<BeanBatch>) =>
    fetchJson<BeanBatch>(
      'batches',
      `/api/v1/beans/${encodeURIComponent(beanId)}/batches`,
      readBatch,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batch)
      }
    ).then((saved) => withSentStorage(saved, batch)),
  updateBatch: (id: string, batch: Partial<BeanBatch>) =>
    fetchJson<BeanBatch>('batches', `/api/v1/bean-batches/${encodeURIComponent(id)}`, readBatch, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batch)
    }).then((saved) => withSentStorage(saved, batch)),
  deleteBatch: (id: string) =>
    fetchEmpty('batches', `/api/v1/bean-batches/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  grinders: () =>
    fetchJson<Grinder[]>('grinders', '/api/v1/grinders?includeArchived=false', readGrinders),
  createGrinder: (grinder: Partial<Grinder>) =>
    fetchJson<Grinder>('grinders', '/api/v1/grinders', readGrinder, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(grinder)
    }),
  updateGrinder: (id: string, grinder: Partial<Grinder>) =>
    fetchJson<Grinder>('grinders', `/api/v1/grinders/${encodeURIComponent(id)}`, readGrinder, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(grinder)
    }),
  profiles: () =>
    fetchJson<ProfileRecord[]>(
      'profiles',
      '/api/v1/profiles?visibility=visible',
      readProfiles
    ),
  createProfile: (body: { profile: Profile; parentId?: string }) =>
    fetchJson<ProfileRecord>('profiles', '/api/v1/profiles', readProfile, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }),
  updateProfile: (id: string, body: { profile: Profile }) =>
    fetchJson<ProfileRecord>('profiles', `/api/v1/profiles/${encodeURIComponent(id)}`, readProfile, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }),

  // --- settings ---
  settings: () => fetchJson<ReaSettings>('settings', '/api/v1/settings', readReaSettings),
  updateSettings: (patch: ReaSettingsPatch) =>
    fetchEmpty('settings', '/api/v1/settings', jsonPost(patch)),
  machineAdvancedSettings: () =>
    fetchJson<De1AdvancedSettings>('settings', '/api/v1/machine/settings/advanced', readDe1AdvancedSettings),
  updateMachineAdvancedSettings: (patch: De1AdvancedSettingsPatch) =>
    fetchEmpty('settings', '/api/v1/machine/settings/advanced', jsonPost(patch)),
  calibration: () =>
    fetchJson<De1Calibration>('settings', '/api/v1/machine/calibration', readDe1Calibration),
  updateCalibration: (flowMultiplier: number) =>
    fetchEmpty('settings', '/api/v1/machine/calibration', jsonPost({ flowMultiplier })),
  resetMachineSettings: () =>
    fetchEmpty('settings', '/api/v1/machine/settings/reset', { method: 'DELETE' }),
  presenceSettings: () =>
    fetchJson<PresenceSettings>('settings', '/api/v1/presence/settings', readPresenceSettings),
  updatePresenceSettings: (patch: PresenceSettingsPatch) =>
    fetchEmpty('settings', '/api/v1/presence/settings', jsonPost(patch)),
  displayState: () =>
    fetchJson<DisplayState>('settings', '/api/v1/display', readDisplayState),
  setDisplayBrightness: (brightness: number) =>
    fetchJson<DisplayState>('settings', '/api/v1/display/brightness', readDisplayState, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brightness: Math.max(0, Math.min(100, Math.round(brightness))) })
    }),

  // --- Decent account ---
  decentAccount: () =>
    fetchJson<DecentAccountStatus>('settings', '/api/v1/account/decent', readDecentAccountStatus),
  loginDecentAccount: (email: string, password: string) =>
    fetchJson<DecentAccountStatus>(
      'settings',
      '/api/v1/account/decent/login',
      readDecentAccountStatus,
      withSkinProxyToken(jsonPost({ email, password }))
    ),
  logoutDecentAccount: () =>
    fetchEmpty('settings', '/api/v1/account/decent', withSkinProxyToken({ method: 'DELETE' })),

  skins: () => fetchJson<SkinInfo[]>('settings', '/api/v1/webui/skins', readSkins),

  // The gateway's LAN/Wi-Fi IP, for the label scanner's phone hand-off QR (the
  // tablet webview is on localhost, so it can't know its own LAN address). Reads
  // `localIp` from /api/v1/info; fail-soft (null) on any error or older gateways.
  lanAddress: async (): Promise<string | null> => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);
      const res = await fetch(`${gatewayHttpOrigin()}/api/v1/info`, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) return null;
      const data: unknown = await res.json().catch(() => null);
      const ip = (data as { localIp?: unknown } | null)?.localIp;
      return typeof ip === 'string' && ip.trim() ? ip.trim() : null;
    } catch {
      return null;
    }
  },

  // Generic gateway KV store (/api/v1/store/{namespace}/{key}) — the source of
  // truth for cross-device settings. Errors propagate (no fail-soft): a 404
  // means the key is absent (returns undefined), but a network/timeout/server
  // error throws so callers can surface it instead of silently losing data.
  storeGet: async (namespace: string, key: string): Promise<unknown> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    let res: Response;
    try {
      res = await fetch(
        `${gatewayHttpOrigin()}/api/v1/store/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}`,
        { signal: controller.signal }
      );
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 404) return undefined;
    if (!res.ok) throw new Error(`Gateway store GET ${namespace}/${key} failed: ${res.status}`);
    return (await res.json()) as unknown;
  },
  // Bulk read of a whole namespace in one request (?full=1) instead of one GET
  // per key. Returns the {key: value} map, or null when the gateway is too old
  // to support the flag — older builds ignore it and return the key list (an
  // array), so callers fall back to per-key gets.
  storeGetAll: async (namespace: string): Promise<Record<string, unknown> | null> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    let res: Response;
    try {
      res = await fetch(
        `${gatewayHttpOrigin()}/api/v1/store/${encodeURIComponent(namespace)}?full=1`,
        { signal: controller.signal }
      );
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error(`Gateway store GET-all ${namespace} failed: ${res.status}`);
    const data = (await res.json()) as unknown;
    if (data === null || typeof data !== 'object' || Array.isArray(data)) return null;
    return data as Record<string, unknown>;
  },
  storeSet: async (namespace: string, key: string, value: unknown): Promise<void> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    let res: Response;
    try {
      res = await fetch(
        `${gatewayHttpOrigin()}/api/v1/store/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(value),
          signal: controller.signal
        }
      );
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error(`Gateway store SET ${namespace}/${key} failed: ${res.status}`);
  },
  // True removal — POSTing `null` would store the string "null" rather than
  // clear the key, so a cleared setting must DELETE to read back as absent.
  storeDelete: async (namespace: string, key: string): Promise<void> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    let res: Response;
    try {
      res = await fetch(
        `${gatewayHttpOrigin()}/api/v1/store/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}`,
        { method: 'DELETE', signal: controller.signal }
      );
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error(`Gateway store DELETE ${namespace}/${key} failed: ${res.status}`);
  },

  // --- devices (pairing) ---
  devices: () => fetchJson<DeviceInfo[]>('settings', '/api/v1/devices', readDevices),
  scanDevices: async (): Promise<DeviceInfo[]> => {
    // Scan-only (no auto-connect) so the user explicitly picks a device, then list.
    await fetchEmpty('settings', '/api/v1/devices/scan?connect=false');
    return fetchJson<DeviceInfo[]>('settings', '/api/v1/devices', readDevices);
  },
  connectPreferredDevices: async (): Promise<DeviceInfo[]> => {
    // Reaprime's connect=true scan runs ConnectionManager's preferred/single-device policy.
    await fetchEmpty('settings', '/api/v1/devices/scan?connect=true');
    return fetchJson<DeviceInfo[]>('settings', '/api/v1/devices', readDevices);
  },
  connectDevice: (deviceId: string) =>
    fetchEmpty('settings', '/api/v1/devices/connect', { ...jsonPost({ deviceId }), method: 'PUT' }),
  disconnectDevice: (deviceId: string) =>
    fetchEmpty('settings', '/api/v1/devices/disconnect', { ...jsonPost({ deviceId }), method: 'PUT' }),

  // --- maintenance + firmware ---
  uploadFirmware: (bytes: ArrayBuffer) =>
    fetchEmpty('machine', '/api/v1/machine/firmware', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: bytes
    }),

  // --- wake schedules ---
  wakeSchedules: () => fetchJson<WakeSchedule[]>('settings', '/api/v1/presence/schedules', readWakeSchedules),
  addWakeSchedule: (body: { time: string; daysOfWeek: number[]; enabled: boolean; keepAwakeFor?: number | null }) =>
    fetchEmpty('settings', '/api/v1/presence/schedules', jsonPost(body)),
  updateWakeSchedule: (id: string, body: Partial<WakeSchedule>) =>
    fetchEmpty('settings', `/api/v1/presence/schedules/${encodeURIComponent(id)}`, { ...jsonPost(body), method: 'PUT' }),
  deleteWakeSchedule: (id: string) =>
    fetchEmpty('settings', `/api/v1/presence/schedules/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // --- plugins ---
  plugins: () => fetchJson<PluginInfo[]>('settings', '/api/v1/plugins', readPlugins),
  enablePlugin: (id: string) =>
    fetchEmpty('settings', `/api/v1/plugins/${encodeURIComponent(id)}/enable`, { method: 'POST' }),
  disablePlugin: (id: string) =>
    fetchEmpty('settings', `/api/v1/plugins/${encodeURIComponent(id)}/disable`, { method: 'POST' }),
  pluginSettings: (id: string) =>
    fetchJson<PluginSettings>('settings', `/api/v1/plugins/${encodeURIComponent(id)}/settings`, readPluginSettings),
  updatePluginSettings: (id: string, values: Record<string, string | number | boolean>) =>
    fetchEmpty('settings', `/api/v1/plugins/${encodeURIComponent(id)}/settings`, jsonPost(values)),
  verifyPlugin: (id: string, credentials: { username: string; password: string }) =>
    fetchJson<PluginVerifyResult>(
      'settings',
      `/api/v1/plugins/${encodeURIComponent(id)}/verifyCredentials`,
      readPluginVerify,
      jsonPost(credentials)
    ),
  shots: (query: URLSearchParams) =>
    fetchJson<PaginatedShots>('shots', `/api/v1/shots?${query.toString()}`, readPaginatedShots),
  shot: (id: string) =>
    fetchJson<ShotRecord>('shot', `/api/v1/shots/${encodeURIComponent(id)}`, readShotRecord),
  updateShot: (id: string, body: ShotUpdate) =>
    fetchJson<ShotRecord>('shot', `/api/v1/shots/${encodeURIComponent(id)}`, readShotRecord, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }),
  deleteShot: (id: string) =>
    fetchEmpty('shot', `/api/v1/shots/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  heartbeat: () => fetchEmpty('machine', '/api/v1/machine/heartbeat', { method: 'POST' }),
  requestState: (state: MachineState) =>
    fetchEmpty('machine', `/api/v1/machine/state/${encodeURIComponent(state)}`, {
      method: 'PUT'
    }),

  // Set the DE1's own low-water refill threshold (mm). The machine raises the
  // `needsWater` state when the tank drops to this level.
  setRefillLevel: (refillLevel: number) =>
    fetchEmpty('machine', '/api/v1/machine/waterLevels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refillLevel: Math.round(refillLevel) })
    }),
  machineState: () =>
    fetchJson<MachineSnapshot>('machine', '/api/v1/machine/state', readMachineSnapshot),
  machineCapabilities: () =>
    fetchJson<MachineCapabilities>('machine', '/api/v1/machine/capabilities', readMachineCapabilities),
  machineSettings: () =>
    fetchJson<De1MachineSettings>('machine', '/api/v1/machine/settings', readDe1MachineSettings),
  updateMachineSettings: (patch: Partial<De1MachineSettings>) =>
    // POST expects usb as 'enable' | 'disable'; the GET response uses a boolean.
    fetchEmpty('machine', '/api/v1/machine/settings', jsonPost(de1MachineSettingsPatchBody(patch))),
  tareScale: () => fetchEmpty('scale', '/api/v1/scale/tare', { method: 'PUT' })
};

export type GatewayStartupClient = Pick<
  typeof gateway,
  'workflow' | 'beans' | 'grinders' | 'profiles' | 'shots'
>;

export interface GatewayStartupOptions {
  client?: GatewayStartupClient;
  latestShotQuery?: URLSearchParams;
  origin?: string;
}

export async function loadGatewayStartup(
  options: GatewayStartupOptions = {}
): Promise<GatewayStartupSnapshot> {
  const client = options.client ?? gateway;
  const latestShotQuery =
    options.latestShotQuery ?? new URLSearchParams({ limit: '1', offset: '0', order: 'desc' });

  const [workflow, beans, grinders, profiles, shots] = await Promise.all([
    loadGatewayResource('workflow', () => client.workflow()),
    loadGatewayResource('beans', () => client.beans()),
    loadGatewayResource('grinders', () => client.grinders()),
    loadGatewayResource('profiles', () => client.profiles()),
    loadGatewayResource('shots', () => client.shots(latestShotQuery))
  ]);

  const resources = { workflow, beans, grinders, profiles, shots };
  const settled = Object.values(resources);
  const issues = settled.flatMap((resource) =>
    resource.status === 'failed' ? [resource.issue] : []
  );
  const loadedCount = settled.length - issues.length;
  const status =
    issues.length === 0
      ? 'connected'
      : loadedCount === 0
        ? 'gateway-unavailable'
        : 'partial-failure';
  const data: GatewayStartupSnapshot['data'] = {};

  if (workflow.status === 'loaded') data.workflow = workflow.data;
  if (beans.status === 'loaded') data.beans = beans.data;
  if (grinders.status === 'loaded') data.grinders = grinders.data;
  if (profiles.status === 'loaded') data.profiles = profiles.data;
  if (shots.status === 'loaded') data.latestShots = shots.data;

  return {
    mode: 'real',
    status,
    source: 'gateway',
    origin: options.origin ?? gatewayHttpOrigin(),
    fallbackToDemo: null,
    resources,
    issues,
    data
  };
}

export async function loadGatewayResource<T>(
  resource: ApiResourceName,
  request: () => Promise<T>
): Promise<ApiResource<T>> {
  try {
    return loadedResource(resource, 'gateway', await request());
  } catch (error) {
    return {
      resource,
      status: 'failed',
      source: 'gateway',
      issue: issueFromError(resource, error),
      receivedAt: new Date().toISOString()
    };
  }
}

export function issueFromError(resource: ApiResourceName, error: unknown): ApiIssue {
  if (error instanceof GatewayRequestError) {
    return { ...error.issue, resource: error.issue.resource ?? resource };
  }

  return {
    resource,
    kind: 'unknown',
    message: error instanceof Error ? error.message : String(error)
  };
}

function loadedResource<T>(
  resource: ApiResourceName,
  source: 'gateway' | 'demo',
  data: T
): ApiResource<T> {
  return {
    resource,
    status: 'loaded',
    source,
    data,
    receivedAt: new Date().toISOString()
  };
}

function requestError(
  resource: ApiResourceName,
  path: string,
  method: string,
  kind: ApiIssue['kind'],
  message: string,
  cause?: unknown,
  statusCode?: number,
  details?: string[]
): GatewayRequestError {
  return new GatewayRequestError(
    {
      resource,
      method,
      path,
      kind,
      message,
      statusCode,
      details
    },
    cause
  );
}
