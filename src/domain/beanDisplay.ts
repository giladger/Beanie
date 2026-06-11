import type { BeanBatch } from '../api/types';
import {
  batchStorageEvents,
  batchStorageState,
  computeBeanFreshness,
  formatGrams,
  storageStatusLabel
} from './beanWorkflow';

export function batchOptionLabel(batch: BeanBatch): string {
  const roast = batch.roastDate ? new Date(batch.roastDate) : null;
  const roastText =
    roast && !Number.isNaN(roast.valueOf())
      ? roast.toLocaleDateString([], { month: 'short', day: 'numeric' })
      : 'Batch';
  const remaining = batch.weightRemaining != null ? ` · ${formatGrams(batch.weightRemaining)}` : '';
  return `${roastText}${remaining}`;
}

export function stockOptionLabel(batch: BeanBatch): string {
  const roast = batch.roastDate ? new Date(batch.roastDate) : null;
  const roastText =
    roast && !Number.isNaN(roast.valueOf())
      ? roast.toLocaleDateString([], { month: 'short', day: 'numeric' })
      : 'Undated stock';
  return `${roastText} · ${formatGrams(batch.weightRemaining)}`;
}

export function stockLocationLabel(batch: BeanBatch): string {
  const state = batchStorageState(batch);
  if (state === 'frozen') return 'In freezer';
  if (state === 'thawed') return 'Thawed';
  return 'On shelf';
}

export function stockLocationDetail(batch: BeanBatch, now: Date = new Date()): string {
  const freshness = computeBeanFreshness(batch, now);
  const status = storageStatusLabel(batch, now);
  const active = freshness ? activeDayText(freshness.activeAgeDays) : null;
  const grams = formatGrams(batch.weightRemaining);
  if (batchStorageState(batch) === 'frozen') {
    return [status ?? 'frozen', grams, 'active age paused'].filter(Boolean).join(' · ');
  }
  if (batchStorageState(batch) === 'thawed') {
    return [status ?? 'thawed', grams, active].filter(Boolean).join(' · ');
  }
  return [grams, active].filter(Boolean).join(' · ');
}

export function storageTimeline(batch: BeanBatch): Array<{ label: string; type: 'roast' | 'frozen' | 'thawed'; at: string }> {
  const entries: Array<{ label: string; type: 'roast' | 'frozen' | 'thawed'; at: string }> = [];
  if (batch.roastDate) entries.push({ label: 'Roasted', type: 'roast', at: batch.roastDate });
  for (const event of batchStorageEvents(batch)) {
    entries.push({ label: event.type === 'frozen' ? 'Moved to freezer' : 'Moved to shelf', type: event.type, at: event.at });
  }
  return entries;
}

export function recentBatches(batches: BeanBatch[], limit: number): BeanBatch[] {
  return [...batches]
    .sort((a, b) => {
      const ad = a.roastDate ? Date.parse(a.roastDate) : 0;
      const bd = b.roastDate ? Date.parse(b.roastDate) : 0;
      return bd - ad;
    })
    .slice(0, limit);
}

export function dateInputValue(value: string | null | undefined): string {
  if (!value) return '';
  const match = value.match(/^\d{4}-\d{2}-\d{2}/);
  if (match) return match[0]!;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '' : date.toISOString().slice(0, 10);
}

function activeDayText(days: number): string {
  return days === 1 ? '1 active day' : `${days} active days`;
}
