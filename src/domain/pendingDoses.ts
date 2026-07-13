import type { BeanBatch } from '../api/types';

// A shot's bag deduction that could not reach the gateway (offline, timeout).
// The queue lives per-device in localStorage — the failed write happened here,
// so this device owns the retry — and is replayed against FRESH batch state on
// the next startup or gateway reconnect, so a late retry deducts from whatever
// the bag holds by then instead of restoring a stale weight.
export interface PendingDose {
  batchId: string;
  beanId: string;
  /** Grams the shot used. */
  dose: number;
  /** Authoritative bag weight observed before the absolute target was prepared. */
  baseRemaining?: number;
  /** The weightRemaining the failed write tried to store. */
  expectedRemaining: number;
  /** When the shot ended (ISO) — entries too old to matter are pruned. */
  at: string;
}

export type PendingDoseResolution =
  | { action: 'drop' }
  | { action: 'apply'; weightRemaining: number };

interface StringStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const pendingDosesKey = 'beanie:pending-dose-deductions-v1';
const maxEntries = 20;
const maxAgeMs = 14 * 24 * 60 * 60 * 1000;

function defaultStorage(): StringStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function readPendingDoses(storage: StringStorage | null = defaultStorage()): PendingDose[] {
  try {
    const raw = storage?.getItem(pendingDosesKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPendingDose);
  } catch {
    return [];
  }
}

export function writePendingDoses(
  entries: readonly PendingDose[],
  storage: StringStorage | null = defaultStorage()
): void {
  try {
    if (entries.length === 0) storage?.removeItem(pendingDosesKey);
    else storage?.setItem(pendingDosesKey, JSON.stringify(entries));
  } catch {
    // Best-effort; on failure the deduction is simply lost, as it was before
    // the queue existed.
  }
}

// Append a failed deduction, dropping entries old enough that replaying them
// would surprise more than help, and capping the queue so a long outage can't
// grow it without bound (oldest first — the newest failure is the most likely
// to still be wanted).
export function appendPendingDose(
  entries: readonly PendingDose[],
  entry: PendingDose,
  now: Date
): PendingDose[] {
  const cutoff = now.getTime() - maxAgeMs;
  const kept = entries.filter((item) => {
    const at = Date.parse(item.at);
    return Number.isFinite(at) && at >= cutoff;
  });
  return [...kept, entry].slice(-maxEntries);
}

// Decide what a replay should do to the batch as it exists NOW on the gateway.
export function resolvePendingDose(
  entry: PendingDose,
  batch: BeanBatch | null
): PendingDoseResolution {
  // Bag deleted, or it no longer tracks a remaining weight: nothing to deduct from.
  if (!batch) return { action: 'drop' };
  const remaining = batch.weightRemaining;
  if (typeof remaining !== 'number' || !Number.isFinite(remaining)) return { action: 'drop' };
  // The bag already holds the weight the failed write was storing: the write
  // actually landed (only its response was lost). Deducting again would count
  // the shot twice, so err on the side of dropping.
  if (Math.abs(remaining - entry.expectedRemaining) < 0.05) return { action: 'drop' };
  return { action: 'apply', weightRemaining: Math.max(0, round1(remaining - entry.dose)) };
}

function isPendingDose(value: unknown): value is PendingDose {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.batchId === 'string' &&
    typeof entry.beanId === 'string' &&
    typeof entry.dose === 'number' &&
    Number.isFinite(entry.dose) &&
    (entry.baseRemaining === undefined ||
      (typeof entry.baseRemaining === 'number' && Number.isFinite(entry.baseRemaining))) &&
    typeof entry.expectedRemaining === 'number' &&
    Number.isFinite(entry.expectedRemaining) &&
    typeof entry.at === 'string'
  );
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
