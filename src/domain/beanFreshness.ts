import type {
  BeanBatch,
  BeanBatchStorageEvent,
  BeanBatchStorageState,
  BeanFreshnessSnapshot,
  ShotSummary
} from '../api/types';

const DAY_MS = 86_400_000;

interface FrozenInterval {
  frozenAt: string;
  thawedAt?: string | null;
  frozenMs: number;
  thawedMs?: number | null;
}

export interface BeanFreshness extends BeanFreshnessSnapshot {
  dateText: string;
}

export function batchStorageEvents(batch: BeanBatch | null | undefined): BeanBatchStorageEvent[] {
  return normalizeStorageEvents(batch?.storageEvents);
}

export function batchStorageState(batch: BeanBatch | null | undefined): BeanBatchStorageState {
  const events = batchStorageEvents(batch);
  if (events.length === 0) return batch?.frozen ? 'frozen' : 'ambient';
  return events[events.length - 1]!.type === 'frozen' ? 'frozen' : 'thawed';
}

export function appendBatchStorageEvent(
  batch: BeanBatch,
  type: BeanBatchStorageEvent['type'],
  at: Date = new Date()
): Partial<BeanBatch> {
  const events = batchStorageEvents(batch);
  const latest = events[events.length - 1];
  const atIso = at.toISOString();
  const nextEvents = latest?.type === type
    ? [...events.slice(0, -1), { type, at: atIso }]
    : [...events, { type, at: atIso }];
  return {
    storageEvents: nextEvents,
    frozen: type === 'frozen'
  };
}

export function editLastBatchStorageEventDate(
  batch: BeanBatch,
  atDate: string,
  fallback: Date = new Date()
): Partial<BeanBatch> {
  const events = batchStorageEvents(batch);
  const latest = events[events.length - 1];
  if (!latest) return {};
  const at = dateInputToIso(atDate, latest.at, fallback);
  const nextEvents = [...events.slice(0, -1), { ...latest, at }];
  return {
    storageEvents: nextEvents,
    frozen: latest.type === 'frozen'
  };
}

export function computeBeanFreshness(
  batch: BeanBatch | null | undefined,
  now: Date = new Date()
): BeanFreshness | null {
  const roast = parseDate(batch?.roastDate);
  if (!batch?.roastDate || !roast) return null;
  const nowMs = now.getTime();
  const roastAgeDays = daysBetween(roast.getTime(), nowMs);
  if (roastAgeDays < 0) {
    return null;
  }

  const intervals = frozenIntervals(batch, roast.getTime(), nowMs);
  const frozenMs = intervals.reduce((sum, interval) => sum + interval.frozenMs, 0);
  const activeAgeDays = Math.max(0, Math.floor((nowMs - roast.getTime() - frozenMs) / DAY_MS));
  const thawedAt = lastThawedAt(batch);
  return {
    roastDate: batch.roastDate,
    roastAgeDays,
    activeAgeDays,
    storageState: batchStorageState(batch),
    frozenIntervals: intervals.map((interval) => ({
      frozenAt: interval.frozenAt,
      thawedAt: interval.thawedAt ?? null
    })),
    thawedAt,
    dateText: roast.toLocaleDateString([], { month: 'short', day: 'numeric' })
  };
}

export function freshnessSnapshotForShot(
  batch: BeanBatch | null | undefined,
  shotTimestamp: string | Date = new Date()
): BeanFreshnessSnapshot | null {
  const now = shotTimestamp instanceof Date ? shotTimestamp : new Date(shotTimestamp);
  const freshness = Number.isNaN(now.valueOf()) ? computeBeanFreshness(batch) : computeBeanFreshness(batch, now);
  if (!freshness) return null;
  const { dateText: _dateText, ...snapshot } = freshness;
  return snapshot;
}

export function roastFreshnessLabel(
  batch: BeanBatch | null | undefined,
  now: Date = new Date()
): string | null {
  const freshness = computeBeanFreshness(batch, now);
  if (!freshness) return null;
  const roastText = dayLabel(freshness.roastAgeDays, 'off roast', 'today');
  const activeText = freshness.activeAgeDays === freshness.roastAgeDays && freshness.storageState === 'ambient'
    ? null
    : activeDayLabel(freshness.activeAgeDays);
  const storage = storageStatusLabel(batch, now);
  return [freshness.dateText, roastText, activeText, storage].filter(Boolean).join(' · ');
}

export function freshnessBadgeLabel(
  batch: BeanBatch | null | undefined,
  now: Date = new Date()
): string | null {
  const freshness = computeBeanFreshness(batch, now);
  if (!freshness) return null;
  if (freshness.storageState === 'ambient' && freshness.activeAgeDays === freshness.roastAgeDays) {
    return `${freshness.roastAgeDays}d`;
  }
  return `${freshness.roastAgeDays}d · ${freshness.activeAgeDays}a`;
}

export function shotFreshnessBadgeLabel(metadata: Record<string, unknown> | null | undefined): string | null {
  const freshness = metadata?.freshness;
  if (!freshness || typeof freshness !== 'object' || Array.isArray(freshness)) return null;
  const record = freshness as Record<string, unknown>;
  const roastAgeDays = record.roastAgeDays;
  const activeAgeDays = record.activeAgeDays;
  const storageState = record.storageState;
  if (typeof roastAgeDays !== 'number' || !Number.isFinite(roastAgeDays)) return null;
  if (
    typeof activeAgeDays === 'number' &&
    Number.isFinite(activeAgeDays) &&
    (activeAgeDays !== roastAgeDays || storageState === 'frozen' || storageState === 'thawed')
  ) {
    return `${roastAgeDays}d · ${activeAgeDays}a`;
  }
  return `${roastAgeDays}d`;
}

export function batchForShotFreshness(
  shot: Pick<ShotSummary, 'workflow'>,
  batchesByBean: Record<string, BeanBatch[]>
): BeanBatch | null {
  const batchId = shot.workflow?.context?.beanBatchId;
  if (!batchId) return null;
  for (const batches of Object.values(batchesByBean)) {
    const batch = batches.find((item) => item.id === batchId);
    if (batch) return batch;
  }
  return null;
}

export function shotFreshnessBadgeForShot(
  shot: Pick<ShotSummary, 'timestamp' | 'metadata' | 'workflow'>,
  batch: BeanBatch | null | undefined
): string | null {
  const stamped = shotFreshnessBadgeLabel(shot.metadata);
  if (stamped) return stamped;
  if (!batch) return null;
  const at = new Date(shot.timestamp);
  if (Number.isNaN(at.valueOf())) return null;
  return freshnessBadgeLabel(batch, at);
}

export function storageStatusLabel(
  batch: BeanBatch | null | undefined,
  now: Date = new Date()
): string | null {
  const state = batchStorageState(batch);
  const events = batchStorageEvents(batch);
  if (state === 'ambient' && events.length === 0) return null;
  const latest = events[events.length - 1];
  if (state === 'frozen') {
    return latest ? `frozen ${shortRelativeDate(latest.at, now)}` : 'frozen';
  }
  const thawed = latest?.type === 'thawed' ? latest.at : lastThawedAt(batch);
  return thawed ? `thawed ${shortRelativeDate(thawed, now)}` : 'thawed';
}

function frozenIntervals(
  batch: BeanBatch | null | undefined,
  roastMs: number,
  nowMs: number
): FrozenInterval[] {
  const intervals: FrozenInterval[] = [];
  let open: BeanBatchStorageEvent | null = null;
  for (const event of batchStorageEvents(batch)) {
    const eventMs = Date.parse(event.at);
    if (!Number.isFinite(eventMs) || eventMs > nowMs) continue;
    if (event.type === 'frozen') {
      open = event;
      continue;
    }
    if (!open) continue;
    const startMs = Math.max(roastMs, Date.parse(open.at));
    const endMs = Math.max(startMs, Math.min(nowMs, eventMs));
    intervals.push({
      frozenAt: open.at,
      thawedAt: event.at,
      frozenMs: endMs - startMs,
      thawedMs: endMs
    });
    open = null;
  }
  if (open) {
    const startMs = Math.max(roastMs, Date.parse(open.at));
    intervals.push({
      frozenAt: open.at,
      thawedAt: null,
      frozenMs: Math.max(0, nowMs - startMs),
      thawedMs: null
    });
  }
  return intervals;
}

function normalizeStorageEvents(events: BeanBatch['storageEvents']): BeanBatchStorageEvent[] {
  if (!Array.isArray(events)) return [];
  return events
    .filter((event): event is BeanBatchStorageEvent =>
      (event?.type === 'frozen' || event?.type === 'thawed') &&
      typeof event.at === 'string' &&
      Number.isFinite(Date.parse(event.at))
    )
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

function lastThawedAt(batch: BeanBatch | null | undefined): string | null {
  return [...batchStorageEvents(batch)].reverse().find((event) => event.type === 'thawed')?.at ?? null;
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date;
}

function daysBetween(startMs: number, endMs: number): number {
  return Math.floor((endMs - startMs) / DAY_MS);
}

function dayLabel(days: number, suffix: string, zeroLabel: string): string {
  if (days === 0) return zeroLabel;
  if (days === 1) return `1 day ${suffix}`;
  return `${days} days ${suffix}`;
}

function activeDayLabel(days: number): string {
  if (days === 1) return '1 active day';
  return `${days} active days`;
}

function shortRelativeDate(value: string, now: Date): string {
  const at = parseDate(value);
  if (!at) return '';
  const days = daysBetween(at.getTime(), now.getTime());
  if (days <= 0) return 'today';
  if (days === 1) return '1d ago';
  if (days < 14) return `${days}d ago`;
  return at.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function dateInputToIso(value: string, previousIso: string, fallback: Date): string {
  const dateText = value.trim();
  if (!dateText) return previousIso || fallback.toISOString();
  const previous = parseDate(previousIso) ?? fallback;
  const parsed = new Date(`${dateText}T${timePart(previous)}`);
  return Number.isNaN(parsed.valueOf()) ? previousIso : parsed.toISOString();
}

function timePart(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.000`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
