import type { PaginatedShots, ShotRecord, ShotSummary } from '../api/types';
import { mergeShotSummaryIntoRecord } from '../domain/shotRecord';

export interface ShotRepositoryGateway {
  shots(query: URLSearchParams): Promise<PaginatedShots>;
  shot(id: string): Promise<ShotRecord>;
}

export interface ShotRepositoryCache {
  putShotPage(query: URLSearchParams, page: PaginatedShots): Promise<void>;
  getShotPage(query: URLSearchParams): Promise<PaginatedShots | null>;
  putShotRecord(shot: ShotRecord): Promise<void>;
  getShotRecord(id: string): Promise<ShotRecord | null>;
}

export interface ShotRepositoryDeps {
  gateway: ShotRepositoryGateway;
  cache: ShotRepositoryCache;
  canWriteCache?: () => boolean;
}

export interface FetchShotPageInput {
  query: URLSearchParams;
  pageSize: number;
  offset: number;
}

export async function fetchShotPage(
  input: FetchShotPageInput,
  deps: ShotRepositoryDeps
): Promise<{ records: ShotRecord[]; total: number }> {
  const query = new URLSearchParams(input.query);
  query.set('limit', String(input.pageSize));
  query.set('offset', String(input.offset));

  try {
    const page = await deps.gateway.shots(query);
    if (canWriteCache(deps)) await deps.cache.putShotPage(query, page);
    const records = await Promise.all(page.items.map((shot) => loadFullShot(shot, deps)));
    return { records, total: page.total };
  } catch (error) {
    console.warn('[Beanie] Could not load shots', error);
    const cached = await deps.cache.getShotPage(query).catch(() => null);
    if (cached) {
      const records = await Promise.all(cached.items.map((shot) => loadFullShot(shot, deps)));
      return { records, total: cached.total };
    }
    return { records: [], total: input.offset };
  }
}

export async function loadFullShot(
  shot: ShotSummary,
  deps: ShotRepositoryDeps
): Promise<ShotRecord> {
  const cached = canWriteCache(deps)
    ? await deps.cache.getShotRecord(shot.id).catch(() => null)
    : null;
  if (cached) {
    const merged = mergeShotSummaryIntoRecord(cached, shot);
    if (canWriteCache(deps)) await deps.cache.putShotRecord(merged);
    return merged;
  }
  try {
    const record = await deps.gateway.shot(shot.id);
    if (canWriteCache(deps)) await deps.cache.putShotRecord(record);
    return record;
  } catch {
    return { ...shot, measurements: [] };
  }
}

export async function loadLatestShotCandidates(
  limit: number,
  deps: ShotRepositoryDeps
): Promise<ShotRecord[]> {
  const query = new URLSearchParams({ limit: String(limit), offset: '0', order: 'desc' });
  try {
    const page = await deps.gateway.shots(query);
    if (canWriteCache(deps)) await deps.cache.putShotPage(query, page);
    return Promise.all(page.items.map((shot) => loadFullShot(shot, deps)));
  } catch (error) {
    console.warn('[Beanie] Could not load latest shot candidates', error);
    const cached = await deps.cache.getShotPage(query).catch(() => null);
    if (!cached) return [];
    return Promise.all(cached.items.map((shot) => loadFullShot(shot, deps)));
  }
}

function canWriteCache(deps: ShotRepositoryDeps): boolean {
  return deps.canWriteCache?.() ?? true;
}
