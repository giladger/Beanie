import type {
  Bean,
  BeanBatch,
  Grinder,
  MachineState,
  PaginatedShots,
  ProfileRecord,
  ShotRecord,
  Workflow,
  WorkflowUpdate
} from './types';

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

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${gatewayHttpOrigin()}${path}`, init);
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} returned ${res.status}`);
  return res.json() as Promise<T>;
}

async function fetchEmpty(path: string, init?: RequestInit): Promise<void> {
  const res = await fetch(`${gatewayHttpOrigin()}${path}`, init);
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} returned ${res.status}`);
}

export const gateway = {
  workflow: () => fetchJson<Workflow>('/api/v1/workflow'),
  updateWorkflow: (body: WorkflowUpdate) =>
    fetchJson<Workflow>('/api/v1/workflow', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }),

  beans: () => fetchJson<Bean[]>('/api/v1/beans?includeArchived=false'),
  createBean: (bean: Pick<Bean, 'roaster' | 'name'>) =>
    fetchJson<Bean>('/api/v1/beans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bean)
    }),
  batches: (beanId: string) =>
    fetchJson<BeanBatch[]>(
      `/api/v1/beans/${encodeURIComponent(beanId)}/batches?includeArchived=false`
    ),
  grinders: () => fetchJson<Grinder[]>('/api/v1/grinders?includeArchived=false'),
  profiles: () => fetchJson<ProfileRecord[]>('/api/v1/profiles?visibility=visible'),
  shots: (query: URLSearchParams) =>
    fetchJson<PaginatedShots>(`/api/v1/shots?${query.toString()}`),
  shot: (id: string) => fetchJson<ShotRecord>(`/api/v1/shots/${encodeURIComponent(id)}`),
  requestState: (state: MachineState) =>
    fetchEmpty(`/api/v1/machine/state/${encodeURIComponent(state)}`, {
      method: 'PUT'
    }),
  tareScale: () => fetchEmpty('/api/v1/scale/tare', { method: 'PUT' })
};
