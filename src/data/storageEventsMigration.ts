import type { BeanBatch } from '../api/types';

// One-time migration: freeze/thaw history (`storageEvents`) used to live only in
// this device's IndexedDB cache because the gateway had nowhere to put it. The
// gateway now persists it (nested under a batch's `extras`), so on the first
// open of this version we copy every cached batch's history up to the gateway —
// proactively, so even batches the user never reopens become durable and sync
// across devices.
//
// Safety rules:
//  - Only push when the gateway has NO events for that batch, so we never
//    clobber a value another device already migrated with a stale local copy.
//  - Report whether the pass completed without a gateway error; the caller only
//    sets the "done" flag on a clean pass, so an offline launch retries later.
//  - The per-bean backfill in loadBeanBatches stays as the safety net for
//    anything this bulk pass misses.

export interface StorageEventsMigrationGateway {
  batches(beanId: string): Promise<BeanBatch[]>;
  updateBatch(id: string, batch: Partial<BeanBatch>): Promise<BeanBatch>;
}

export interface StorageEventsMigrationCache {
  getAllBeanBatches(): Promise<BeanBatch[]>;
}

export interface StorageEventsMigrationResult {
  migrated: number;
  completed: boolean;
}

function hasEvents(batch: BeanBatch | undefined): boolean {
  return !!batch?.storageEvents && batch.storageEvents.length > 0;
}

export async function migrateStorageEventsToGateway(deps: {
  gateway: StorageEventsMigrationGateway;
  cache: StorageEventsMigrationCache;
}): Promise<StorageEventsMigrationResult> {
  const cached = await deps.cache.getAllBeanBatches().catch(() => [] as BeanBatch[]);
  const withHistory = cached.filter(hasEvents);
  if (withHistory.length === 0) return { migrated: 0, completed: true };

  // Group by bean so we read each bean's current gateway state just once.
  const byBean = new Map<string, BeanBatch[]>();
  for (const batch of withHistory) {
    const list = byBean.get(batch.beanId);
    if (list) list.push(batch);
    else byBean.set(batch.beanId, [batch]);
  }

  let migrated = 0;
  let completed = true;
  for (const [beanId, localBatches] of byBean) {
    let gatewayBatches: BeanBatch[];
    try {
      gatewayBatches = await deps.gateway.batches(beanId);
    } catch {
      // Couldn't check this bean — leave the flag unset so we retry next open.
      completed = false;
      continue;
    }
    const gatewayById = new Map(gatewayBatches.map((batch) => [batch.id, batch]));
    for (const local of localBatches) {
      const remote = gatewayById.get(local.id);
      // Skip batches the gateway no longer has, or that already carry history.
      if (!remote || hasEvents(remote)) continue;
      try {
        await deps.gateway.updateBatch(local.id, {
          beanId: local.beanId,
          storageEvents: local.storageEvents
        });
        migrated += 1;
      } catch {
        completed = false;
      }
    }
  }

  return { migrated, completed };
}
