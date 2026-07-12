import type { Bean, BeanBatch, ShotRecord, Workflow } from '../api/types';

export type LiveShotAttributionSource =
  | 'confirmed-batch'
  | 'confirmed-bean'
  | 'explicit-unresolved'
  | 'ui-fallback'
  | 'unresolved';

export interface LiveShotSelection {
  readonly bean: Bean | null;
  readonly batch: BeanBatch | null;
  readonly source?: LiveShotAttributionSource;
}

export interface LiveShotAttribution extends LiveShotSelection {
  readonly workflow: Workflow | null;
  readonly source: LiveShotAttributionSource;
}

export interface LiveShotInventoryProjection {
  readonly beans: readonly Bean[];
  readonly batchesByBean: Readonly<Record<string, readonly BeanBatch[]>>;
}

export type ShotSelectionCompatibility =
  | 'batch-match'
  | 'bean-match'
  | 'unknown'
  | 'conflict';

/**
 * Resolve the coffee the machine is confirmed to have loaded.
 *
 * The gateway commonly omits context.beanId but retains beanBatchId, so batch
 * identity is the primary key. The mutable UI selection is used only when the
 * confirmed workflow carries no identity that the local inventory can resolve.
 */
export function resolveLiveShotAttribution(
  workflow: Workflow | null,
  inventory: LiveShotInventoryProjection,
  fallback: LiveShotSelection
): LiveShotAttribution {
  const context = workflow?.context;
  const batchId = nonEmptyString(context?.beanBatchId);
  if (batchId) {
    const resolved = batchAndBeanForId(batchId, inventory);
    if (resolved) {
      return { ...resolved, workflow, source: 'confirmed-batch' };
    }
    return { bean: null, batch: null, workflow, source: 'explicit-unresolved' };
  }

  const beanId = nonEmptyString(context?.beanId);
  if (beanId) {
    const bean = inventory.beans.find((candidate) => candidate.id === beanId) ?? null;
    if (bean) {
      const batch = batchId
        ? inventory.batchesByBean[bean.id]?.find((candidate) => candidate.id === batchId) ?? null
        : null;
      return { bean, batch, workflow, source: 'confirmed-bean' };
    }
    return { bean: null, batch: null, workflow, source: 'explicit-unresolved' };
  }

  if (fallback.bean) {
    const batch = fallback.batch?.beanId === fallback.bean.id ? fallback.batch : null;
    return { bean: fallback.bean, batch, workflow, source: 'ui-fallback' };
  }
  return { bean: null, batch: null, workflow, source: 'unresolved' };
}

/** Resolve only identity explicitly persisted on a shot; never use UI state. */
export function resolvePersistedShotSelection(
  shot: ShotRecord,
  inventory: LiveShotInventoryProjection
): LiveShotSelection | null {
  const context = shot.workflow?.context;
  const batchId = nonEmptyString(context?.beanBatchId);
  if (batchId) {
    const resolved = batchAndBeanForId(batchId, inventory);
    if (resolved) return resolved;
  }

  const beanId = nonEmptyString(context?.beanId);
  if (!beanId) return null;
  const bean = inventory.beans.find((candidate) => candidate.id === beanId) ?? null;
  return bean ? { bean, batch: null } : null;
}

/**
 * Compare a persisted shot with the coffee expected for a live pull.
 * Explicit disagreement is unsafe; absent legacy fields remain admissible for
 * history matching but are not strong enough to authorize a bag deduction.
 */
export function shotSelectionCompatibility(
  shot: ShotRecord,
  expected: { readonly beanId: string | null; readonly batchId: string | null }
): ShotSelectionCompatibility {
  const context = shot.workflow?.context;
  const actualBatchId = nonEmptyString(context?.beanBatchId);
  const actualBeanId = nonEmptyString(context?.beanId);

  if (expected.batchId && actualBatchId && expected.batchId !== actualBatchId) return 'conflict';
  if (expected.beanId && actualBeanId && expected.beanId !== actualBeanId) return 'conflict';
  if (expected.batchId && actualBatchId === expected.batchId) return 'batch-match';
  if (expected.beanId && actualBeanId === expected.beanId) return 'bean-match';
  return 'unknown';
}

export function shotCoffeeLabel(shot: ShotRecord): string | null {
  const context = shot.workflow?.context;
  const label = [nonEmptyString(context?.coffeeRoaster), nonEmptyString(context?.coffeeName)]
    .filter((part): part is string => part != null)
    .join(' ')
    .trim();
  return label || null;
}

function batchAndBeanForId(
  batchId: string,
  inventory: LiveShotInventoryProjection
): LiveShotSelection | null {
  for (const batches of Object.values(inventory.batchesByBean)) {
    const batch = batches.find((candidate) => candidate.id === batchId);
    if (!batch) continue;
    const bean = inventory.beans.find((candidate) => candidate.id === batch.beanId) ?? null;
    if (bean) return { bean, batch };
  }
  return null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}
