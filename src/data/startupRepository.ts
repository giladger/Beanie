import { loadGatewayStartup } from '../api/gateway';
import type {
  Bean,
  GatewayStartupSnapshot,
  Grinder,
  PaginatedShots,
  ProfileRecord,
  Workflow
} from '../api/types';

export interface StartupCache {
  putWorkflow(workflow: Workflow | null): Promise<void>;
  putBeans(beans: readonly Bean[]): Promise<void>;
  putGrinders(grinders: readonly Grinder[]): Promise<void>;
  putProfiles(profiles: readonly ProfileRecord[]): Promise<void>;
  putShotPage(query: URLSearchParams, page: PaginatedShots): Promise<void>;
  getWorkflow(): Promise<Workflow | null>;
  getBeans(): Promise<Bean[]>;
  getGrinders(): Promise<Grinder[]>;
  getProfiles(): Promise<ProfileRecord[]>;
  getShotPage(query: URLSearchParams): Promise<PaginatedShots | null>;
}

interface LoadStartupOptions {
  latestShotQuery: URLSearchParams;
}

export interface StartupRepositoryOptions {
  cache: StartupCache;
  loadStartup?: (options: LoadStartupOptions) => Promise<GatewayStartupSnapshot>;
}

export async function loadGatewayStartupWithCache(
  latestShotQuery: URLSearchParams,
  options: StartupRepositoryOptions
): Promise<GatewayStartupSnapshot> {
  const startup = await (options.loadStartup ?? loadGatewayStartup)({ latestShotQuery });
  await cacheStartupData(startup.data, latestShotQuery, options.cache);
  const cached = await cachedStartupData(latestShotQuery, options.cache);
  return {
    ...startup,
    data: {
      workflow: startup.data.workflow ?? cached.workflow,
      beans: startup.data.beans ?? cached.beans,
      grinders: startup.data.grinders ?? cached.grinders,
      profiles: startup.data.profiles ?? cached.profiles,
      latestShots: startup.data.latestShots ?? cached.latestShots
    }
  };
}

export async function cacheStartupData(
  data: GatewayStartupSnapshot['data'],
  latestShotQuery: URLSearchParams,
  cache: StartupCache
): Promise<void> {
  const writes: Array<Promise<void>> = [];
  if (data.workflow !== undefined) writes.push(cache.putWorkflow(data.workflow));
  if (data.beans !== undefined) writes.push(cache.putBeans(data.beans));
  if (data.grinders !== undefined) writes.push(cache.putGrinders(data.grinders));
  if (data.profiles !== undefined) writes.push(cache.putProfiles(data.profiles));
  if (data.latestShots !== undefined) writes.push(cache.putShotPage(latestShotQuery, data.latestShots));
  await Promise.all(writes.map((write) => write.catch(() => {})));
}

export async function cachedStartupData(
  latestShotQuery: URLSearchParams,
  cache: StartupCache
): Promise<GatewayStartupSnapshot['data']> {
  const [workflow, beans, grinders, profiles, latestShots] = await Promise.all([
    cache.getWorkflow().catch(() => null),
    cache.getBeans().catch(() => []),
    cache.getGrinders().catch(() => []),
    cache.getProfiles().catch(() => []),
    cache.getShotPage(latestShotQuery).catch(() => null)
  ]);

  return {
    workflow: workflow ?? undefined,
    beans: beans.length > 0 ? beans : undefined,
    grinders,
    profiles,
    latestShots: latestShots ?? undefined
  };
}
