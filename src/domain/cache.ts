import type {
  Bean,
  BeanBatch,
  Grinder,
  PaginatedShots,
  ProfileRecord,
  ShotRecord,
  ShotSummary,
  Workflow
} from '../api/types';

export const BEANIE_CACHE_DB_NAME = 'beanie-cache';
export const BEANIE_CACHE_DB_VERSION = 1;

const workflowObjectKey = 'workflow:current';

const storeNames = {
  shotSummaries: 'shotSummaries',
  shotRecords: 'shotRecords',
  shotPages: 'shotPages',
  beans: 'beans',
  beanBatches: 'beanBatches',
  grinders: 'grinders',
  profiles: 'profiles',
  objects: 'objects'
} as const;

type StoreName = (typeof storeNames)[keyof typeof storeNames];
type CacheScalar = string | number | boolean | null | undefined;
type CacheQueryValue = CacheScalar | readonly CacheScalar[];

export type CacheMutationKind = 'shot' | 'workflow' | 'profile' | 'bean' | 'grinder';
export type CacheQueryInput =
  | string
  | URLSearchParams
  | Record<string, CacheQueryValue>
  | Iterable<readonly [string, CacheScalar]>;

export interface BeanieCacheOptions {
  databaseName?: string;
  indexedDB?: IDBFactory | null;
  now?: () => Date;
}

interface CacheEntry<T> {
  id: string;
  item: T;
  updatedAt: string;
  schemaVersion: number;
}

interface BeanBatchCacheEntry extends CacheEntry<BeanBatch> {
  beanId: string;
}

interface ShotPageCacheEntry {
  key: string;
  query: string;
  item: PaginatedShots;
  updatedAt: string;
  schemaVersion: number;
}

interface ObjectCacheEntry<T = unknown> {
  key: string;
  value: T;
  updatedAt: string;
  schemaVersion: number;
}

export function createBeanieCache(options: BeanieCacheOptions = {}): BeanieIndexedDbCache {
  return new BeanieIndexedDbCache(options);
}

export function cachePageKey(namespace: string, query: CacheQueryInput): string {
  return `${namespace}:${normalizeCacheQuery(query)}`;
}

export function shotPageCacheKey(query: CacheQueryInput): string {
  return cachePageKey('shots', query);
}

export function normalizeCacheQuery(query: CacheQueryInput): string {
  const entries = queryEntries(query)
    .filter(([, value]) => value != null)
    .map(([key, value]): [string, string] => [key, String(value)])
    .sort(([aKey, aValue], [bKey, bValue]) => {
      const keyCompare = aKey.localeCompare(bKey);
      return keyCompare === 0 ? aValue.localeCompare(bValue) : keyCompare;
    });

  return new URLSearchParams(entries).toString();
}

export class BeanieIndexedDbCache {
  private readonly databaseName: string;
  private readonly factory: IDBFactory | null;
  private readonly now: () => Date;
  private openPromise: Promise<IDBDatabase | null> | null = null;

  constructor(options: BeanieCacheOptions = {}) {
    this.databaseName = options.databaseName ?? BEANIE_CACHE_DB_NAME;
    this.factory = options.indexedDB === undefined ? defaultIndexedDbFactory() : options.indexedDB;
    this.now = options.now ?? (() => new Date());
  }

  get available(): boolean {
    return this.factory != null;
  }

  async isAvailable(): Promise<boolean> {
    return (await this.openDb()) != null;
  }

  async putShotPage(query: CacheQueryInput, page: PaginatedShots): Promise<void> {
    await this.putShotSummaries(page.items);
    const key = shotPageCacheKey(query);
    await this.putEntries<ShotPageCacheEntry>(storeNames.shotPages, [
      {
        key,
        query: normalizeCacheQuery(query),
        item: page,
        updatedAt: this.timestamp(),
        schemaVersion: BEANIE_CACHE_DB_VERSION
      }
    ]);
  }

  async getShotPage(query: CacheQueryInput): Promise<PaginatedShots | null> {
    const entry = await this.getEntry<ShotPageCacheEntry>(
      storeNames.shotPages,
      shotPageCacheKey(query)
    );
    return entry?.item ?? null;
  }

  async putShotSummaries(shots: readonly ShotSummary[]): Promise<void> {
    await this.putEntries<CacheEntry<ShotSummary>>(
      storeNames.shotSummaries,
      shots.map((shot) => this.entry(shot.id, shot))
    );
  }

  async putShotRecord(shot: ShotRecord): Promise<void> {
    await Promise.all([
      this.putShotSummaries([shot]),
      this.putEntries<CacheEntry<ShotRecord>>(storeNames.shotRecords, [this.entry(shot.id, shot)])
    ]);
  }

  async getShotRecord(id: string): Promise<ShotRecord | null> {
    const entry = await this.getEntry<CacheEntry<ShotRecord>>(storeNames.shotRecords, id);
    return entry?.item ?? null;
  }

  async putBeans(beans: readonly Bean[]): Promise<void> {
    await this.putCollection(storeNames.beans, 'collection:beans:ids', beans);
  }

  async getBeans(): Promise<Bean[]> {
    return this.getCollection<Bean>(storeNames.beans, 'collection:beans:ids');
  }

  async putBeanBatches(beanId: string, batches: readonly BeanBatch[]): Promise<void> {
    await this.replaceEntries<BeanBatchCacheEntry>(
      storeNames.beanBatches,
      `collection:bean-batches:${beanId}:ids`,
      batches.map((batch) => ({
        ...this.entry(batch.id, batch),
        beanId
      })),
      (existing) => existing.beanId === beanId
    );
  }

  async getBeanBatches(beanId: string): Promise<BeanBatch[]> {
    const entries = await this.getAllEntries<BeanBatchCacheEntry>(storeNames.beanBatches);
    const batches = entries.filter((entry) => entry.beanId === beanId).map((entry) => entry.item);
    const ids = await this.getObject<string[]>(`collection:bean-batches:${beanId}:ids`, []);
    return orderByIds(batches, ids);
  }

  async putGrinders(grinders: readonly Grinder[]): Promise<void> {
    await this.putCollection(storeNames.grinders, 'collection:grinders:ids', grinders);
  }

  async getGrinders(): Promise<Grinder[]> {
    return this.getCollection<Grinder>(storeNames.grinders, 'collection:grinders:ids');
  }

  async putProfiles(profiles: readonly ProfileRecord[]): Promise<void> {
    await this.putCollection(storeNames.profiles, 'collection:profiles:ids', profiles);
  }

  async getProfiles(): Promise<ProfileRecord[]> {
    return this.getCollection<ProfileRecord>(storeNames.profiles, 'collection:profiles:ids');
  }

  async putWorkflow(workflow: Workflow | null): Promise<void> {
    if (workflow == null) {
      await this.deleteObject(workflowObjectKey);
      return;
    }
    await this.putObject(workflowObjectKey, workflow);
  }

  async getWorkflow(): Promise<Workflow | null> {
    return this.getObject<Workflow>(workflowObjectKey);
  }

  async putObject<T>(key: string, value: T): Promise<void> {
    await this.putEntries<ObjectCacheEntry<T>>(storeNames.objects, [
      {
        key,
        value,
        updatedAt: this.timestamp(),
        schemaVersion: BEANIE_CACHE_DB_VERSION
      }
    ]);
  }

  async getObject<T>(key: string): Promise<T | null>;
  async getObject<T>(key: string, fallback: T): Promise<T>;
  async getObject<T>(key: string, fallback?: T): Promise<T | null> {
    const entry = await this.getEntry<ObjectCacheEntry<T>>(storeNames.objects, key);
    return entry?.value ?? fallback ?? null;
  }

  async deleteObject(key: string): Promise<void> {
    await this.deleteKeys(storeNames.objects, [key]);
  }

  // Drops only the cached shot pages so the next page fetch can discover newly
  // appended shots, while keeping per-shot summaries/records intact. Use this
  // for refresh polling (no shot actually changed); offline history then
  // survives if the gateway dies between the invalidation and the refetch.
  async invalidateShotPages(): Promise<void> {
    await this.clearStore(storeNames.shotPages);
  }

  async invalidateShotMutation(ids?: string | readonly string[]): Promise<void> {
    const shotIds = normalizeIds(ids);
    await this.invalidateShotPages();
    if (shotIds.length === 0) {
      await Promise.all([
        this.clearStore(storeNames.shotSummaries),
        this.clearStore(storeNames.shotRecords)
      ]);
      return;
    }

    await Promise.all([
      this.deleteKeys(storeNames.shotSummaries, shotIds),
      this.deleteKeys(storeNames.shotRecords, shotIds)
    ]);
  }

  async invalidateShots(ids?: string | readonly string[]): Promise<void> {
    await this.invalidateShotMutation(ids);
  }

  async invalidateWorkflowMutation(): Promise<void> {
    await this.deleteObject(workflowObjectKey);
  }

  async invalidateBeanMutation(ids?: string | readonly string[]): Promise<void> {
    const beanIds = normalizeIds(ids);
    await this.clearStore(storeNames.shotPages);

    if (beanIds.length === 0) {
      await Promise.all([this.clearStore(storeNames.beans), this.clearStore(storeNames.beanBatches)]);
      await Promise.all([
        this.deleteObject('collection:beans:ids'),
        this.deleteObjectsByPrefix('collection:bean-batches:')
      ]);
      return;
    }

    await this.deleteKeys(storeNames.beans, beanIds);
    await this.deleteObject('collection:beans:ids');
    await Promise.all(beanIds.map((beanId) => this.deleteBatchesForBean(beanId)));
  }

  async invalidateProfileMutation(ids?: string | readonly string[]): Promise<void> {
    const profileIds = normalizeIds(ids);
    await this.invalidateWorkflowMutation();

    if (profileIds.length === 0) {
      await this.clearStore(storeNames.profiles);
      await this.deleteObject('collection:profiles:ids');
      return;
    }

    await this.deleteKeys(storeNames.profiles, profileIds);
    await this.deleteObject('collection:profiles:ids');
  }

  async invalidateGrinderMutation(ids?: string | readonly string[]): Promise<void> {
    const grinderIds = normalizeIds(ids);
    await this.invalidateWorkflowMutation();

    if (grinderIds.length === 0) {
      await this.clearStore(storeNames.grinders);
      await this.deleteObject('collection:grinders:ids');
      return;
    }

    await this.deleteKeys(storeNames.grinders, grinderIds);
    await this.deleteObject('collection:grinders:ids');
  }

  async invalidateCacheForMutation(
    kind: CacheMutationKind,
    ids?: string | readonly string[]
  ): Promise<void> {
    switch (kind) {
      case 'shot':
        await this.invalidateShotMutation(ids);
        return;
      case 'workflow':
        await this.invalidateWorkflowMutation();
        return;
      case 'profile':
        await this.invalidateProfileMutation(ids);
        return;
      case 'bean':
        await this.invalidateBeanMutation(ids);
        return;
      case 'grinder':
        await this.invalidateGrinderMutation(ids);
        return;
    }
  }

  async clear(): Promise<void> {
    await Promise.all(Object.values(storeNames).map((storeName) => this.clearStore(storeName)));
  }

  private async putCollection<T extends { id: string }>(
    storeName: StoreName,
    orderKey: string,
    items: readonly T[]
  ): Promise<void> {
    await this.replaceEntries<CacheEntry<T>>(
      storeName,
      orderKey,
      items.map((item) => this.entry(item.id, item)),
      () => true
    );
  }

  /**
   * Replaces the cached entries behind an ordered collection in one readwrite
   * transaction: stale entries (matched by `isReplaced` but absent from the new
   * list) are deleted, new entries are written, and the order-key id list is
   * rewritten alongside them.
   */
  private async replaceEntries<E extends { id: string }>(
    storeName: StoreName,
    orderKey: string,
    entries: readonly E[],
    isReplaced: (existing: E) => boolean
  ): Promise<void> {
    const db = await this.openDb();
    if (!db) return;

    try {
      const tx = db.transaction([storeName, storeNames.objects], 'readwrite');
      const done = transactionDone(tx);
      const store = tx.objectStore(storeName);
      const nextIds = new Set(entries.map((entry) => entry.id));
      const existing = await requestToPromise<E[]>(store.getAll());
      for (const entry of existing) {
        if (isReplaced(entry) && !nextIds.has(entry.id)) store.delete(entry.id);
      }
      for (const entry of entries) store.put(entry);
      tx.objectStore(storeNames.objects).put({
        key: orderKey,
        value: entries.map((entry) => entry.id),
        updatedAt: this.timestamp(),
        schemaVersion: BEANIE_CACHE_DB_VERSION
      } satisfies ObjectCacheEntry<string[]>);
      await done;
    } catch {
      return;
    }
  }

  private async getCollection<T extends { id: string }>(
    storeName: StoreName,
    orderKey: string
  ): Promise<T[]> {
    const entries = await this.getAllEntries<CacheEntry<T>>(storeName);
    const ids = await this.getObject<string[]>(orderKey, []);
    return orderByIds(
      entries.map((entry) => entry.item),
      ids
    );
  }

  private async deleteBatchesForBean(beanId: string): Promise<void> {
    const entries = await this.getAllEntries<BeanBatchCacheEntry>(storeNames.beanBatches);
    const ids = entries.filter((entry) => entry.beanId === beanId).map((entry) => entry.id);
    await Promise.all([
      this.deleteKeys(storeNames.beanBatches, ids),
      this.deleteObject(`collection:bean-batches:${beanId}:ids`)
    ]);
  }

  private async deleteObjectsByPrefix(prefix: string): Promise<void> {
    const entries = await this.getAllEntries<ObjectCacheEntry>(storeNames.objects);
    await this.deleteKeys(
      storeNames.objects,
      entries.filter((entry) => entry.key.startsWith(prefix)).map((entry) => entry.key)
    );
  }

  private entry<T>(id: string, item: T): CacheEntry<T> {
    return {
      id,
      item,
      updatedAt: this.timestamp(),
      schemaVersion: BEANIE_CACHE_DB_VERSION
    };
  }

  private timestamp(): string {
    return this.now().toISOString();
  }

  private async getEntry<T>(storeName: StoreName, key: IDBValidKey): Promise<T | null> {
    const db = await this.openDb();
    if (!db) return null;

    try {
      const tx = db.transaction(storeName, 'readonly');
      const entry = await requestToPromise<T | undefined>(tx.objectStore(storeName).get(key));
      return entry ?? null;
    } catch {
      return null;
    }
  }

  private async getAllEntries<T>(storeName: StoreName): Promise<T[]> {
    const db = await this.openDb();
    if (!db) return [];

    try {
      const tx = db.transaction(storeName, 'readonly');
      return await requestToPromise<T[]>(tx.objectStore(storeName).getAll());
    } catch {
      return [];
    }
  }

  private async putEntries<T>(storeName: StoreName, entries: readonly T[]): Promise<void> {
    if (entries.length === 0) return;

    const db = await this.openDb();
    if (!db) return;

    try {
      const tx = db.transaction(storeName, 'readwrite');
      const done = transactionDone(tx);
      const store = tx.objectStore(storeName);
      for (const entry of entries) store.put(entry);
      await done;
    } catch {
      return;
    }
  }

  private async deleteKeys(storeName: StoreName, keys: readonly IDBValidKey[]): Promise<void> {
    if (keys.length === 0) return;

    const db = await this.openDb();
    if (!db) return;

    try {
      const tx = db.transaction(storeName, 'readwrite');
      const done = transactionDone(tx);
      const store = tx.objectStore(storeName);
      for (const key of keys) store.delete(key);
      await done;
    } catch {
      return;
    }
  }

  private async clearStore(storeName: StoreName): Promise<void> {
    const db = await this.openDb();
    if (!db) return;

    try {
      const tx = db.transaction(storeName, 'readwrite');
      const done = transactionDone(tx);
      tx.objectStore(storeName).clear();
      await done;
    } catch {
      return;
    }
  }

  private async openDb(): Promise<IDBDatabase | null> {
    if (!this.factory) return null;
    if (this.openPromise) return this.openPromise;

    const promise = new Promise<IDBDatabase | null>((resolve) => {
      const request = this.factory!.open(this.databaseName, BEANIE_CACHE_DB_VERSION);
      // Drop the memoized promise so the next call reopens, but only if it
      // still belongs to this open attempt (a newer attempt may have replaced it).
      const forget = () => {
        if (this.openPromise === promise) this.openPromise = null;
      };
      let abandoned = false;

      request.onupgradeneeded = () => {
        const tx = request.transaction;
        if (tx) migrateCacheSchema(request.result, tx);
      };
      request.onsuccess = () => {
        const db = request.result;
        if (abandoned) {
          // The open was abandoned after onblocked but eventually succeeded:
          // close it so the orphan connection does not hold the version lock.
          db.close();
          return;
        }
        db.onversionchange = () => {
          // Another tab is upgrading the database (e.g. after a deploy). Close
          // this connection and forget it so the next operation reopens.
          forget();
          db.close();
        };
        db.onclose = () => forget();
        resolve(db);
      };
      request.onerror = () => {
        forget();
        resolve(null);
      };
      request.onblocked = () => {
        abandoned = true;
        forget();
        resolve(null);
      };
    });

    this.openPromise = promise;
    return promise;
  }
}

export const beanieCache = createBeanieCache();

function migrateCacheSchema(db: IDBDatabase, tx: IDBTransaction): void {
  storeForUpgrade(db, tx, storeNames.shotSummaries, 'id');
  storeForUpgrade(db, tx, storeNames.shotRecords, 'id');
  storeForUpgrade(db, tx, storeNames.shotPages, 'key');
  storeForUpgrade(db, tx, storeNames.beans, 'id');
  const batches = storeForUpgrade(db, tx, storeNames.beanBatches, 'id');
  storeForUpgrade(db, tx, storeNames.grinders, 'id');
  storeForUpgrade(db, tx, storeNames.profiles, 'id');
  storeForUpgrade(db, tx, storeNames.objects, 'key');

  if (!batches.indexNames.contains('beanId')) {
    batches.createIndex('beanId', 'beanId');
  }
}

function storeForUpgrade(
  db: IDBDatabase,
  tx: IDBTransaction,
  storeName: StoreName,
  keyPath: string
): IDBObjectStore {
  if (db.objectStoreNames.contains(storeName)) {
    return tx.objectStore(storeName);
  }
  return db.createObjectStore(storeName, { keyPath });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

function defaultIndexedDbFactory(): IDBFactory | null {
  return typeof indexedDB === 'undefined' ? null : indexedDB;
}

function queryEntries(query: CacheQueryInput): Array<[string, CacheScalar]> {
  if (typeof query === 'string') {
    const text = query.startsWith('?') ? query.slice(1) : query;
    return Array.from(new URLSearchParams(text).entries());
  }

  if (query instanceof URLSearchParams) {
    return Array.from(query.entries());
  }

  if (isIterableQuery(query)) {
    return Array.from(query, ([key, value]) => [key, value]);
  }

  const entries: Array<[string, CacheScalar]> = [];
  for (const [key, value] of Object.entries(query)) {
    if (isCacheValueArray(value)) {
      for (const item of value) entries.push([key, item]);
    } else {
      entries.push([key, value]);
    }
  }
  return entries;
}

function isIterableQuery(value: unknown): value is Iterable<readonly [string, CacheScalar]> {
  return typeof value === 'object' && value != null && Symbol.iterator in value;
}

function isCacheValueArray(value: CacheQueryValue): value is readonly CacheScalar[] {
  return Array.isArray(value);
}

function normalizeIds(ids?: string | readonly string[]): string[] {
  if (!ids) return [];
  return (Array.isArray(ids) ? ids : [ids]).filter((id) => id.length > 0);
}

function orderByIds<T extends { id: string }>(items: readonly T[], ids: readonly string[]): T[] {
  // No order list (e.g. it was dropped by a targeted invalidate*Mutation while
  // entries remain): fall back to whatever entries exist.
  if (ids.length === 0) return [...items];
  // An order list is authoritative: entries absent from it were deleted or
  // archived upstream and must not resurrect from the cache.
  const byId = new Map(items.map((item) => [item.id, item]));
  return ids.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
}
