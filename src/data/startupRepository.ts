import { loadGatewayStartup } from '../api/gateway';
import type {
  ApiResource,
  Bean,
  GatewayStartupSnapshot,
  Grinder,
  PaginatedShots,
  ProfileRecord,
  ShotRecord,
  Workflow
} from '../api/types';
import { hydrateCachedShotSummaries } from './shotRepository';

export interface StartupCache {
  putWorkflow(workflow: Workflow | null, canCommit?: () => boolean): Promise<void>;
  putBeans(beans: readonly Bean[], canCommit?: () => boolean): Promise<void>;
  putGrinders(grinders: readonly Grinder[], canCommit?: () => boolean): Promise<void>;
  putProfiles(profiles: readonly ProfileRecord[], canCommit?: () => boolean): Promise<void>;
  putShotPage(query: URLSearchParams, page: PaginatedShots, canCommit?: () => boolean): Promise<void>;
  getWorkflow(): Promise<Workflow | null>;
  getBeans(): Promise<Bean[]>;
  getGrinders(): Promise<Grinder[]>;
  getProfiles(): Promise<ProfileRecord[]>;
  getShotPage(query: URLSearchParams): Promise<PaginatedShots | null>;
  getShotRecord(id: string): Promise<ShotRecord | null>;
}

interface LoadStartupOptions {
  latestShotQuery: URLSearchParams;
}

export interface StartupRepositoryOptions {
  cache: StartupCache;
  loadStartup?: (options: LoadStartupOptions) => Promise<GatewayStartupSnapshot>;
  canCommit?: () => boolean;
}

export async function loadGatewayStartupWithCache(
  latestShotQuery: URLSearchParams,
  options: StartupRepositoryOptions
): Promise<GatewayStartupSnapshot> {
  const startup = await (options.loadStartup ?? loadGatewayStartup)({ latestShotQuery });
  const canCommit = options.canCommit ?? (() => true);
  await cacheStartupData(startup.data, latestShotQuery, options.cache, canCommit);
  const cached = await cachedStartupData(latestShotQuery, options.cache);
  const workflow = mergeStartupResource(
    startup.resources.workflow,
    startup.data.workflow,
    cached.workflow
  );
  const beans = mergeStartupResource(startup.resources.beans, startup.data.beans, cached.beans);
  const grinders = mergeStartupResource(
    startup.resources.grinders,
    startup.data.grinders,
    cached.grinders
  );
  const profiles = mergeStartupResource(
    startup.resources.profiles,
    startup.data.profiles,
    cached.profiles
  );
  const shots = mergeStartupResource(
    startup.resources.shots,
    startup.data.latestShots,
    cached.latestShots
  );

  return {
    ...startup,
    resources: {
      workflow: workflow.resource,
      beans: beans.resource,
      grinders: grinders.resource,
      profiles: profiles.resource,
      shots: shots.resource
    },
    data: {
      workflow: workflow.data,
      beans: beans.data,
      grinders: grinders.data,
      profiles: profiles.data,
      latestShots: shots.data
    }
  };
}

function mergeStartupResource<T>(
  resource: ApiResource<T>,
  gatewayData: T | undefined,
  cachedData: T | undefined
): { resource: ApiResource<T>; data: T | undefined } {
  if (gatewayData !== undefined || cachedData === undefined) {
    return { resource, data: gatewayData };
  }

  return {
    resource: {
      resource: resource.resource,
      status: 'loaded',
      source: 'cache',
      data: cachedData,
      receivedAt: new Date().toISOString()
    },
    data: cachedData
  };
}

export async function cacheStartupData(
  data: GatewayStartupSnapshot['data'],
  latestShotQuery: URLSearchParams,
  cache: StartupCache,
  canCommit: () => boolean = () => true
): Promise<void> {
  const writes: Array<Promise<void>> = [];
  if (data.workflow !== undefined && canCommit()) writes.push(cache.putWorkflow(data.workflow, canCommit));
  if (data.beans !== undefined && canCommit()) writes.push(cache.putBeans(data.beans, canCommit));
  if (data.grinders !== undefined && canCommit()) writes.push(cache.putGrinders(data.grinders, canCommit));
  if (data.profiles !== undefined && canCommit()) writes.push(cache.putProfiles(data.profiles, canCommit));
  if (data.latestShots !== undefined && canCommit()) {
    writes.push(cache.putShotPage(latestShotQuery, data.latestShots, canCommit));
  }
  await Promise.all(writes.map((write) => write.catch(() => {})));
}

export async function cachedStartupData(
  latestShotQuery: URLSearchParams,
  cache: StartupCache
): Promise<GatewayStartupSnapshot['data']> {
  const [workflow, beans, grinders, profiles, latestShotPage] = await Promise.all([
    cache.getWorkflow().catch(() => null),
    cache.getBeans().catch(() => []),
    cache.getGrinders().catch(() => []),
    cache.getProfiles().catch(() => []),
    cache.getShotPage(latestShotQuery).catch(() => null)
  ]);
  const latestShots = latestShotPage
    ? {
        ...latestShotPage,
        items: await hydrateCachedShotSummaries(latestShotPage.items, cache)
      }
    : null;

  return {
    workflow: workflow ?? undefined,
    beans: beans.length > 0 ? beans : undefined,
    grinders: grinders.length > 0 ? grinders : undefined,
    profiles: profiles.length > 0 ? profiles : undefined,
    latestShots: latestShots ?? undefined
  };
}
