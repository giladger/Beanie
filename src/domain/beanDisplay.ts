import type { BeanBatch } from '../api/types';
import { formatGrams } from './beanWorkflow';

export function batchOptionLabel(batch: BeanBatch): string {
  const roast = batch.roastDate ? new Date(batch.roastDate) : null;
  const roastText =
    roast && !Number.isNaN(roast.valueOf())
      ? roast.toLocaleDateString([], { month: 'short', day: 'numeric' })
      : 'Batch';
  const remaining = batch.weightRemaining != null ? ` · ${formatGrams(batch.weightRemaining)}` : '';
  return `${roastText}${remaining}`;
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
