import type { Bean, BeanBatch } from '../api/types';
import {
  batchStorageEvents,
  batchStorageState,
  computeBeanFreshness,
  formatGrams,
  latestBatch,
  storageStatusLabel
} from './beanWorkflow';

/** Optional nickname belongs to the physical bag, independent of coffee metadata. */
export function bagDisplayName(batch: Partial<BeanBatch> | null | undefined): string | null {
  const metadata = batch?.extras?.beanie;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>).displayName;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function bagShortcutLabel(batch: Partial<BeanBatch> | null | undefined): string | null {
  const metadata = batch?.extras?.beanie;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>).shortcutLabel;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export const BAG_ICONS = ['bean', 'coffee', 'heart', 'sun', 'sparkles', 'beaker', 'droplet', 'snowflake'] as const;
export type BagIcon = typeof BAG_ICONS[number];

export function bagIcon(batch: Partial<BeanBatch> | null | undefined, fallbackId = ''): BagIcon {
  const metadata = batch?.extras?.beanie;
  const chosen = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>).icon : null;
  if (BAG_ICONS.includes(chosen as BagIcon)) return chosen as BagIcon;
  const id = batch?.id ?? fallbackId;
  const hash = [...id].reduce((value, ch) => (value * 31 + ch.charCodeAt(0)) >>> 0, 0);
  return BAG_ICONS[hash % BAG_ICONS.length]!;
}

export function bagImage(batch: Partial<BeanBatch> | null | undefined): string | null {
  const metadata = batch?.extras?.beanie;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>).image;
  // Uploaded raster thumbnails only; no remote image fetches or active SVG data.
  return typeof value === 'string' && /^data:image\/(?:jpeg|png|webp);base64,[a-zA-Z0-9+/=]+$/.test(value) && value.length <= 150_000
    ? value : null;
}

export function bagPresentationExtras(
  batch: Partial<BeanBatch> | null | undefined,
  fields: { displayName?: string | null; shortcutLabel?: string | null; image?: string | null; icon?: string | null }
): Record<string, unknown> {
  const metadata = batch?.extras?.beanie;
  return { ...batch?.extras, beanie: {
    ...(metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {}),
    ...fields
  } };
}

export function bagDisplayExtras(batch: BeanBatch | undefined, displayName: string | null): Record<string, unknown> {
  return bagPresentationExtras(batch, { displayName: displayName?.trim() || null });
}

/** Match automatic selection: newest usable bag, then newest finished bag. */
export function displayBatch(batches: readonly BeanBatch[]): BeanBatch | null {
  return latestBatch(batches.filter((batch) => !isNearlyEmptyBatch(batch))) ?? latestBatch([...batches]);
}

export function bagName(bean: Bean, batch: Partial<BeanBatch> | null | undefined): string {
  return bagDisplayName(batch) ?? bean.name;
}

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
  return `${bagDisplayName(batch) ? `${bagDisplayName(batch)} · ` : ''}${roastText}${remaining}`;
}

export function stockOptionLabel(batch: BeanBatch): string {
  const roast = batch.roastDate ? new Date(batch.roastDate) : null;
  const roastText =
    roast && !Number.isNaN(roast.valueOf())
      ? roast.toLocaleDateString([], { month: 'short', day: 'numeric' })
      : 'Undated stock';
  return `${bagDisplayName(batch) ? `${bagDisplayName(batch)} · ` : ''}${roastText} · ${formatGrams(batch.weightRemaining)}`;
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
  /** Selection history, most recent first — fallback for never-brewed beans. */
  recentBeanIds: readonly string[];
  /** Last-shot timestamp per bean — the primary recency signal. */
  beanUsageAt: Readonly<Record<string, number>>;
  limit?: number;
  /** Favorites keep their slots even when selected; recent coffees are hidden. */
  favoritesOnly?: boolean;
}

/**
 * The workbench rotation dock: beans reachable in one tap beside the hero.
 * Starred beans hold slots first (in star order); whatever room is left is
 * filled by most recently used beans. The selected bean is never a tile (it IS
 * the hero).
 *
 * Stock is deliberately NOT a filter: a coffee you just finished is the one
 * you're most likely to reach for (to log the last shot, to compare, to weigh
 * a fresh bag in), so a finished bag keeps its slot until the bean is archived.
 *
 * Recency decides only WHICH beans fill the free slots, never where they sit:
 * fills display in name order so a slot's position doesn't trade places with
 * its neighbor every time a switch reshuffles recency.
 *
 * "Recent" means recently BREWED (last shot per bean), not recently selected —
 * browsing the picker or tapping a dock button must not promote a bean you
 * never pulled into the rotation. The selection history only ranks beans that
 * have no shot on record (e.g. a bag added moments ago).
 */
export function rotationBeans(input: RotationInput): Bean[] {
  const limit = input.limit ?? 2;
  if (limit <= 0) return [];
  const byId = new Map(input.beans.map((bean) => [bean.id, bean]));
  if (input.favoritesOnly) {
    return [...new Set(input.favoriteBeanIds)]
      .map((id) => byId.get(id))
      .filter((bean): bean is Bean => Boolean(bean && !bean.archived))
      .slice(0, limit);
  }
  const usageRecency = [...input.beans]
    .filter((bean) => (input.beanUsageAt[bean.id] ?? 0) > 0)
    .sort((a, b) => (input.beanUsageAt[b.id] ?? 0) - (input.beanUsageAt[a.id] ?? 0))
    .map((bean) => bean.id);
  const favorites = new Set(input.favoriteBeanIds);
  const pinned: Bean[] = [];
  const fills: Bean[] = [];
  const seen = new Set<string>();
  for (const id of [...input.favoriteBeanIds, ...usageRecency, ...input.recentBeanIds]) {
    if (pinned.length + fills.length >= limit) break;
    if (seen.has(id)) continue;
    seen.add(id);
    if (id === input.selectedBeanId) continue;
    const bean = byId.get(id);
    if (!bean || bean.archived) continue;
    (favorites.has(id) ? pinned : fills).push(bean);
  }
  fills.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  return [...pinned, ...fills];
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
