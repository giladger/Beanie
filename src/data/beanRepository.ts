import type { BeanBatch } from '../api/types';

export interface BeanRepositoryGateway {
  batches(beanId: string): Promise<BeanBatch[]>;
  updateBatch(id: string, batch: Partial<BeanBatch>): Promise<BeanBatch>;
}

export interface BeanRepositoryCache {
  putBeanBatches(beanId: string, batches: readonly BeanBatch[]): Promise<void>;
  getBeanBatches(beanId: string): Promise<BeanBatch[]>;
}

export async function loadBeanBatches(
  beanId: string,
  deps: { gateway: BeanRepositoryGateway; cache: BeanRepositoryCache }
): Promise<BeanBatch[]> {
  try {
    const batches = await deps.gateway.batches(beanId);
    // The gateway now persists freeze/thaw history (nested under `extras`), but a
    // batch frozen on this device before that change still has its events only in
    // the local cache. Backfill any such gateway batch from the cache so the
    // dates aren't dropped, then write that history back up to the gateway so it
    // becomes durable and reaches other devices. Once migrated, the gateway
    // returns the events itself and the backfill/push is a no-op.
    const cached = await deps.cache.getBeanBatches(beanId).catch(() => []);
    const { merged, toMigrate } = mergeCachedStorageEvents(batches, cached);
    await deps.cache.putBeanBatches(beanId, merged).catch(() => {});
    for (const batch of toMigrate) {
      deps.gateway
        .updateBatch(batch.id, { beanId: batch.beanId, storageEvents: batch.storageEvents })
        .catch(() => {});
    }
    return merged;
  } catch (error) {
    console.warn('[Beanie] Could not load batches', error);
    return deps.cache.getBeanBatches(beanId).catch(() => []);
  }
}

function mergeCachedStorageEvents(
  gatewayBatches: BeanBatch[],
  cachedBatches: readonly BeanBatch[]
): { merged: BeanBatch[]; toMigrate: BeanBatch[] } {
  const cachedById = new Map(cachedBatches.map((batch) => [batch.id, batch]));
  const toMigrate: BeanBatch[] = [];
  const merged = gatewayBatches.map((batch) => {
    if (batch.storageEvents && batch.storageEvents.length > 0) return batch;
    const cachedEvents = cachedById.get(batch.id)?.storageEvents;
    if (!cachedEvents || cachedEvents.length === 0) return batch;
    const filled = { ...batch, storageEvents: cachedEvents };
    toMigrate.push(filled);
    return filled;
  });
  return { merged, toMigrate };
}
