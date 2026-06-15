import type { ShotRecord, ShotSummary } from '../api/types';

// Flush / steam / hot-water actions can end up in the shot store (e.g. imported
// de1app history) tagged with a non-espresso beverage type. Keep them out of a
// bean's shot history. Only records explicitly marked as service are hidden, so
// real espresso shots (beverage type espresso, or unlabelled) are untouched.
const SERVICE_BEVERAGE_TYPES = new Set([
  'steam',
  'water',
  'hot_water',
  'hotwater',
  'hot water',
  'flush',
  'rinse',
  'clean',
  'cleaning',
  'calibrate',
  'calibration'
]);

export function mergeShotSummaryIntoRecord(
  cached: ShotRecord,
  summary: ShotSummary
): ShotRecord {
  return {
    ...cached,
    ...summary,
    measurements: cached.measurements
  };
}

// A beverage type that marks a machine-service action (backflush, steam, flush…)
// rather than a coffee. Used both to hide these from history and to stop a stale
// service tag from leaking onto the next espresso workflow.
export function isServiceBeverageType(type: string | null | undefined): boolean {
  return type != null && SERVICE_BEVERAGE_TYPES.has(String(type).toLowerCase().trim());
}

export function isServiceShot(shot: ShotRecord): boolean {
  const types = [shot.workflow?.context?.finalBeverageType, shot.workflow?.profile?.beverage_type];
  return types.some(isServiceBeverageType);
}
