import type { ShotRecord } from '../api/types';
import { isServiceShot } from './shotRecord';

// Raw per-bean trend data: one row per metric, sampled across the loaded
// shots in brew order (oldest → newest). Display only states what was
// measured — no freshness labels, no dial-in advice.

export type ShotTrendKey = 'dose' | 'yield' | 'ratio' | 'duration' | 'ey' | 'enjoyment';

export interface ShotTrendPoint {
  shotId: string;
  value: number;
}

export interface ShotTrendRow {
  key: ShotTrendKey;
  label: string;
  unit: string;
  decimals: number;
  points: ShotTrendPoint[];
  min: number;
  max: number;
  latest: number;
}

interface ShotTrendDefinition {
  key: ShotTrendKey;
  label: string;
  unit: string;
  decimals: number;
  value: (shot: ShotRecord) => number | null;
}

const TREND_DEFINITIONS: ShotTrendDefinition[] = [
  { key: 'dose', label: 'Dose', unit: 'g', decimals: 1, value: doseIn },
  { key: 'yield', label: 'Yield', unit: 'g', decimals: 1, value: yieldOut },
  {
    key: 'ratio',
    label: 'Ratio',
    unit: '',
    decimals: 2,
    value: (shot) => {
      const dose = doseIn(shot);
      const out = yieldOut(shot);
      return dose != null && out != null ? out / dose : null;
    }
  },
  { key: 'duration', label: 'Time', unit: 's', decimals: 0, value: shotDurationSeconds },
  { key: 'ey', label: 'EY', unit: '%', decimals: 1, value: (shot) => positive(shot.annotations?.drinkEy) },
  {
    key: 'enjoyment',
    label: 'Score',
    unit: '',
    decimals: 0,
    value: (shot) => finite(shot.annotations?.enjoyment)
  }
];

/**
 * Build trend rows for a bean's shot history. `shots` arrives newest-first
 * (the order the app stores it in); rows come back oldest-first so a sparkline
 * reads left → right in brew order. Rows with fewer than two measured points
 * are dropped — a single value has no trend to show.
 */
export function buildShotTrends(shots: ShotRecord[]): ShotTrendRow[] {
  const ordered = shots.filter((shot) => !isServiceShot(shot)).reverse();
  return TREND_DEFINITIONS.flatMap((definition) => {
    const points = ordered.flatMap((shot) => {
      const value = definition.value(shot);
      return value == null ? [] : [{ shotId: shot.id, value }];
    });
    if (points.length < 2) return [];
    const values = points.map((point) => point.value);
    return [
      {
        key: definition.key,
        label: definition.label,
        unit: definition.unit,
        decimals: definition.decimals,
        points,
        min: Math.min(...values),
        max: Math.max(...values),
        latest: values[values.length - 1]!
      }
    ];
  });
}

// Saved shots are replaced (never mutated) when they change, and computing a
// duration walks the full measurement array, so memoize by record identity.
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
  const all = shot.measurements;
  if (!Array.isArray(all) || all.length < 2) return null;
  const pour = all.filter((measurement) => {
    const sub = (measurement.machine as { state?: { substate?: string } } | undefined)?.state?.substate;
    return sub === 'preinfusion' || sub === 'pouring';
  });
  const series = pour.length > 1 ? pour : all;
  const first = Date.parse(series[0]!.machine.timestamp);
  const last = Date.parse(series[series.length - 1]!.machine.timestamp);
  if (!Number.isFinite(first) || !Number.isFinite(last) || last <= first) return null;
  return (last - first) / 1000;
}

function doseIn(shot: ShotRecord): number | null {
  return positive(shot.annotations?.actualDoseWeight) ?? positive(shot.workflow?.context?.targetDoseWeight);
}

function yieldOut(shot: ShotRecord): number | null {
  return positive(shot.annotations?.actualYield) ?? positive(shot.workflow?.context?.targetYield);
}

function positive(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function finite(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
