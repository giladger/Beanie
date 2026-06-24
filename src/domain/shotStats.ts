import type { ShotMeasurement, ShotRecord } from '../api/types';

// Raw per-shot numbers computed from the stored measurement series — the
// same data the chart plots, condensed into the figures a barista actually
// quotes (peak pressure, average flow, ...). Values only; no judgments.

export interface ShotStats {
  /** Highest machine pressure in the pour window (bar). */
  peakPressure: number | null;
  /** Mean machine flow while pouring (ml/s); falls back to the pour window. */
  avgFlow: number | null;
  /** Mean group temperature over the pour window (°C). */
  avgTemperature: number | null;
  /** Seconds from the start of the pour window until the scale first read ≥ 1 g. */
  firstDropsSeconds: number | null;
  /** Last scale weight in the pour window (g). */
  endWeight: number | null;
  /** Recorded actual yield minus the last measured weight (g) — what dripped after stop. */
  postStopDrip: number | null;
}

const ESPRESSO_SUBSTATES = new Set(['preinfusion', 'pouring']);
const FIRST_DROPS_GRAMS = 1;

// Measurement arrays are immutable once saved and records are replaced, never
// mutated, so stats can be memoized by record identity (same pattern as the
// chart model and duration caches).
const statsCache = new WeakMap<ShotRecord, ShotStats>();

export function buildShotStats(shot: ShotRecord): ShotStats {
  const cached = statsCache.get(shot);
  if (cached) return cached;
  const stats = computeShotStats(shot);
  statsCache.set(shot, stats);
  return stats;
}

export function hasShotStats(stats: ShotStats): boolean {
  return Object.values(stats).some((value) => value != null);
}

// Same memoization rationale as buildShotStats: records are replaced, never
// mutated, and computing a duration walks the whole measurement array.
const durationCache = new WeakMap<ShotRecord, number | null>();

/**
 * Shot duration in seconds from its measurement timestamps, preferring the
 * espresso pour (preinfusion/pouring) window when substates are recorded —
 * the same window the shot charts plot.
 */
export function shotDurationSeconds(shot: ShotRecord): number | null {
  if (durationCache.has(shot)) return durationCache.get(shot)!;
  const duration = computeShotDurationSeconds(shot);
  durationCache.set(shot, duration);
  return duration;
}

function computeShotDurationSeconds(shot: ShotRecord): number | null {
  const all = Array.isArray(shot.measurements) ? shot.measurements : [];
  if (all.length < 2) return null;
  const pour = all.filter((measurement) => {
    const sub = substate(measurement);
    return sub != null && ESPRESSO_SUBSTATES.has(sub);
  });
  const series = pour.length > 1 ? pour : all;
  const first = timestampFor(series[0]!.machine.timestamp);
  const last = timestampFor(series[series.length - 1]!.machine.timestamp);
  if (first == null || last == null || last <= first) return null;
  return (last - first) / 1000;
}

function computeShotStats(shot: ShotRecord): ShotStats {
  const all = Array.isArray(shot.measurements) ? shot.measurements : [];
  const window = pourWindow(all);
  const pouring = window.filter((measurement) => substate(measurement) === 'pouring');

  const pressures = numbersFrom(window, (m) => machineNumber(m, 'pressure'));
  const flows = numbersFrom(pouring.length > 0 ? pouring : window, (m) => machineNumber(m, 'flow'));
  const temperatures = numbersFrom(
    window,
    (m) => machineNumber(m, 'groupTemperature') ?? machineNumber(m, 'mixTemperature')
  );

  const endWeight = lastScaleWeight(window);
  const actualYield = positive(shot.annotations?.actualYield);

  return {
    peakPressure: pressures.length > 0 ? Math.max(...pressures) : null,
    avgFlow: mean(flows),
    avgTemperature: mean(temperatures),
    firstDropsSeconds: firstDropsSeconds(window),
    endWeight,
    postStopDrip: endWeight != null && actualYield != null ? actualYield - endWeight : null
  };
}

function pourWindow(measurements: ShotMeasurement[]): ShotMeasurement[] {
  const espresso = measurements.filter((measurement) => {
    const sub = substate(measurement);
    return sub != null && ESPRESSO_SUBSTATES.has(sub);
  });
  return espresso.length > 0 ? espresso : measurements;
}

function firstDropsSeconds(window: ShotMeasurement[]): number | null {
  const start = firstTimestamp(window);
  if (start == null) return null;
  for (const measurement of window) {
    const weight = scaleNumber(measurement, 'weight');
    if (weight == null || weight < FIRST_DROPS_GRAMS) continue;
    const at = timestampFor(measurement.scale?.timestamp) ?? timestampFor(measurement.machine.timestamp);
    if (at == null) return null;
    return Math.max(0, (at - start) / 1000);
  }
  return null;
}

function lastScaleWeight(window: ShotMeasurement[]): number | null {
  for (let i = window.length - 1; i >= 0; i -= 1) {
    const weight = scaleNumber(window[i]!, 'weight');
    if (weight != null && weight > 0) return weight;
  }
  return null;
}

function firstTimestamp(measurements: ShotMeasurement[]): number | null {
  for (const measurement of measurements) {
    const at = timestampFor(measurement.machine.timestamp) ?? timestampFor(measurement.scale?.timestamp);
    if (at != null) return at;
  }
  return null;
}

function numbersFrom(
  measurements: ShotMeasurement[],
  pick: (measurement: ShotMeasurement) => number | null
): number[] {
  return measurements.map(pick).filter((value): value is number => value != null);
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function substate(measurement: ShotMeasurement): string | null {
  const machine = measurement.machine as { state?: { substate?: unknown } } | undefined;
  const value = machine?.state?.substate;
  return typeof value === 'string' && value ? value : null;
}

function machineNumber(measurement: ShotMeasurement, key: string): number | null {
  return numeric((measurement.machine as Record<string, unknown>)?.[key]);
}

function scaleNumber(measurement: ShotMeasurement, key: string): number | null {
  return numeric((measurement.scale as Record<string, unknown> | null | undefined)?.[key]);
}

function timestampFor(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? at : null;
}

function numeric(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function positive(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}
