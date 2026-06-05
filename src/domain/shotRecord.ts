import type { ShotRecord, ShotSummary } from '../api/types';

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
