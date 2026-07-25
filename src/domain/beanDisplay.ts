import type { Bean, BeanBatch } from '../api/types';
import {
  batchStorageEvents,
  batchStorageState,
  computeBeanFreshness,
  formatGrams,
  latestBatch,
  storageStatusLabel
} from './beanWorkflow';

export interface BeanStockSummary {
  bagCount: number;
  frozenCount: number;
  totalRemaining: number | null;
  roastDateText: string | null;
  activeAgeDays: number | null;
  shotsLeft: number | null;
}

export function isNearlyEmptyBatch(batch: BeanBatch): boolean {
  return typeof batch.weightRemaining === 'number' && Number.isFinite(batch.weightRemaining) && batch.weightRemaining < 5;
}

// Active age comes from the freshest bag on hand (the one you'd brew next);
// shots-left sums the remaining grams across every active bag of this coffee,
// divided by the average dose-in. Returns null when no bags are on hand.
export function beanStockSummary(
  batches: BeanBatch[],
  averageDoseIn: number | null,
  now: Date = new Date()
): BeanStockSummary | null {
  const active = batches.filter((batch) => !isNearlyEmptyBatch(batch));
  if (active.length === 0) return null;
  const freshness = computeBeanFreshness(latestBatch(active), now);
  const totalRemaining = active.reduce(
    (sum, batch) => sum + (typeof batch.weightRemaining === 'number' && batch.weightRemaining > 0 ? batch.weightRemaining : 0),
    0
  );
  const shotsLeft = averageDoseIn && averageDoseIn > 0 && totalRemaining > 0
    ? Math.floor(totalRemaining / averageDoseIn)
    : null;
  return {
    bagCount: active.length,
    frozenCount: active.filter((batch) => batchStorageState(batch) === 'frozen').length,
    totalRemaining: totalRemaining > 0 ? totalRemaining : null,
    roastDateText: freshness?.dateText ?? null,
    activeAgeDays: freshness?.activeAgeDays ?? null,
    shotsLeft
  };
}

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

export interface RotationInput {
  beans: readonly Bean[];
  selectedBeanId: string | null;
  /** Star order (oldest star first) — pinned rotation slots. */
  favoriteBeanIds: readonly string[];
  /** Selection history, most recent first. */
  recentBeanIds: readonly string[];
  /** Last-shot timestamp per bean — recency fallback predating the history. */
  beanUsageAt: Readonly<Record<string, number>>;
  batchesByBean: Readonly<Record<string, readonly BeanBatch[]>>;
  limit?: number;
}

/**
 * The workbench rotation strip: beans reachable in one tap beside the hero.
 * Starred beans hold slots first (in star order); whatever room is left is
 * filled by most recently used beans. The selected bean is never a tile (it IS
 * the hero), and a bean whose every known bag is finished drops out — beans
 * with no loaded batch data stay in, since absence of data is not empty stock.
 */
export function rotationBeans(input: RotationInput): Bean[] {
  const limit = input.limit ?? 2;
  if (limit <= 0) return [];
  const byId = new Map(input.beans.map((bean) => [bean.id, bean]));
  const hasStock = (id: string): boolean => {
    const batches = input.batchesByBean[id];
    if (!batches || batches.length === 0) return true;
    return batches.some((batch) => !isNearlyEmptyBatch(batch));
  };
  const usageRecency = [...input.beans]
    .filter((bean) => (input.beanUsageAt[bean.id] ?? 0) > 0)
    .sort((a, b) => (input.beanUsageAt[b.id] ?? 0) - (input.beanUsageAt[a.id] ?? 0))
    .map((bean) => bean.id);
  const picked: Bean[] = [];
  const seen = new Set<string>();
  for (const id of [...input.favoriteBeanIds, ...input.recentBeanIds, ...usageRecency]) {
    if (picked.length >= limit) break;
    if (seen.has(id)) continue;
    seen.add(id);
    if (id === input.selectedBeanId) continue;
    const bean = byId.get(id);
    if (!bean || bean.archived) continue;
    if (!hasStock(id)) continue;
    picked.push(bean);
  }
  return picked;
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
