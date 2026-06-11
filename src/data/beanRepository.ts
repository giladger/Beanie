import type { BeanBatch } from '../api/types';

export interface BeanRepositoryGateway {
  batches(beanId: string): Promise<BeanBatch[]>;
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
    // The gateway can't store `storageEvents`, so a fresh GET always returns them
    // as null — re-fetching would otherwise wipe the freeze/thaw dates the user
    // recorded. The local cache is the only durable record, so backfill events
    // from it before writing through.
    const cached = await deps.cache.getBeanBatches(beanId).catch(() => []);
    const merged = mergeCachedStorageEvents(batches, cached);
    await deps.cache.putBeanBatches(beanId, merged).catch(() => {});
    return merged;
  } catch (error) {
    console.warn('[Beanie] Could not load batches', error);
    return deps.cache.getBeanBatches(beanId).catch(() => []);
  }
}

function mergeCachedStorageEvents(
  gatewayBatches: BeanBatch[],
  cachedBatches: readonly BeanBatch[]
): BeanBatch[] {
  const cachedById = new Map(cachedBatches.map((batch) => [batch.id, batch]));
  return gatewayBatches.map((batch) => {
    if (batch.storageEvents && batch.storageEvents.length > 0) return batch;
    const cachedEvents = cachedById.get(batch.id)?.storageEvents;
    if (!cachedEvents || cachedEvents.length === 0) return batch;
    return { ...batch, storageEvents: cachedEvents };
  });
}
