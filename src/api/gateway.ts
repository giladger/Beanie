import type {
  ApiDemoFallback,
  ApiIssue,
  ApiResource,
  ApiResourceName,
  Bean,
  BeanBatch,
  De1MachineSettings,
  DemoStartupSnapshot,
  GatewayStartupSnapshot,
  Grinder,
  MachineCapabilities,
  MachineState,
  PaginatedShots,
  Profile,
  ProfileRecord,
  ShotRecord,
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
  readPaginatedShots,
  readProfile,
  readProfiles,
  readShotRecord,
  readWorkflow,
  type ApiResponseGuard
} from './guards';

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

async function fetchJson<T>(
  resource: ApiResourceName,
  path: string,
  guard: ApiResponseGuard<T>,
  init?: RequestInit
): Promise<T> {
  const method = init?.method ?? 'GET';
  let res: Response;
  try {
    res = await fetch(`${gatewayHttpOrigin()}${path}`, init);
  } catch (cause) {
    throw requestError(resource, path, method, 'network', `Could not reach ${path}`, cause);
  }

  if (!res.ok) {
    throw requestError(
      resource,
      path,
      method,
      'http',
      `${method} ${path} returned ${res.status}`,
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
  let res: Response;
  try {
    res = await fetch(`${gatewayHttpOrigin()}${path}`, init);
  } catch (cause) {
    throw requestError(resource, path, method, 'network', `Could not reach ${path}`, cause);
  }

  if (!res.ok) {
    throw requestError(
      resource,
      path,
      method,
      'http',
      `${method} ${path} returned ${res.status}`,
      undefined,
      res.status
    );
  }
}

export const gateway = {
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
    ),
  grinders: () =>
    fetchJson<Grinder[]>('grinders', '/api/v1/grinders?includeArchived=false', readGrinders),
  createGrinder: (grinder: Partial<Grinder>) =>
    fetchJson<Grinder>('grinders', '/api/v1/grinders', readGrinder, {
      method: 'POST',
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
  shots: (query: URLSearchParams) =>
    fetchJson<PaginatedShots>('shots', `/api/v1/shots?${query.toString()}`, readPaginatedShots),
  shot: (id: string) =>
    fetchJson<ShotRecord>('shot', `/api/v1/shots/${encodeURIComponent(id)}`, readShotRecord),
  updateShot: (
    id: string,
    body: {
      annotations?: { espressoNotes?: string | null; enjoyment?: number | null };
      shotNotes?: string | null;
    }
  ) =>
    fetchJson<ShotRecord>('shot', `/api/v1/shots/${encodeURIComponent(id)}`, readShotRecord, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }),
  deleteShot: (id: string) =>
    fetchEmpty('shot', `/api/v1/shots/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  requestState: (state: MachineState) =>
    fetchEmpty('machine', `/api/v1/machine/state/${encodeURIComponent(state)}`, {
      method: 'PUT'
    }),
  machineCapabilities: () =>
    fetchJson<MachineCapabilities>('machine', '/api/v1/machine/capabilities', readMachineCapabilities),
  machineSettings: () =>
    fetchJson<De1MachineSettings>('machine', '/api/v1/machine/settings', readDe1MachineSettings),
  updateMachineSettings: (body: De1MachineSettings) =>
    fetchEmpty('machine', '/api/v1/machine/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }),
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

export interface DemoStartupInput {
  workflow: Workflow;
  beans: Bean[];
  batchesByBean?: Record<string, BeanBatch[]>;
  grinders: Grinder[];
  profiles: ProfileRecord[];
  latestShots?: PaginatedShots;
  shots?: ShotRecord[];
  fallbackToDemo?: ApiDemoFallback | null;
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

export function createDemoStartupSnapshot(input: DemoStartupInput): DemoStartupSnapshot {
  const resources: DemoStartupSnapshot['resources'] = {
    workflow: loadedResource('workflow', 'demo', input.workflow),
    beans: loadedResource('beans', 'demo', input.beans),
    grinders: loadedResource('grinders', 'demo', input.grinders),
    profiles: loadedResource('profiles', 'demo', input.profiles)
  };

  if (input.latestShots) {
    resources.shots = loadedResource('shots', 'demo', input.latestShots);
  }

  return {
    mode: 'demo',
    status: 'demo',
    source: 'demo',
    origin: null,
    fallbackToDemo: input.fallbackToDemo ?? null,
    resources,
    issues: input.fallbackToDemo?.issues ?? [],
    data: {
      workflow: input.workflow,
      beans: input.beans,
      batchesByBean: input.batchesByBean,
      grinders: input.grinders,
      profiles: input.profiles,
      latestShots: input.latestShots,
      shots: input.shots
    }
  };
}

export function fallbackFromGatewaySnapshot(
  snapshot: GatewayStartupSnapshot,
  reason = 'Gateway startup did not fully load'
): ApiDemoFallback | null {
  if (snapshot.status === 'connected') return null;
  return {
    fromStatus: snapshot.status,
    reason,
    issues: snapshot.issues
  };
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
