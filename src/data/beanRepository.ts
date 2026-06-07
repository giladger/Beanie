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
    await deps.cache.putBeanBatches(beanId, batches).catch(() => {});
    return batches;
  } catch (error) {
    console.warn('[Beanie] Could not load batches', error);
    return deps.cache.getBeanBatches(beanId).catch(() => []);
  }
}
