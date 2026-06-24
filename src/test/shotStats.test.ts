import type { ShotMeasurement, ShotRecord } from '../api/types';
import { buildShotStats, hasShotStats, shotDurationSeconds } from '../domain/shotStats';

run('shot stats compute peaks, means, first drops, and post-stop drip from the pour window', () => {
  const shot = record(
    [
      // Idle frame outside the pour window — must be ignored.
      frame(0, { substate: 'heating', pressure: 9.9, flow: 9 }),
      frame(1, { substate: 'preinfusion', pressure: 2, flow: 4, temp: 92, weight: 0 }),
      frame(2, { substate: 'pouring', pressure: 8, flow: 2, temp: 93, weight: 1.2 }),
      frame(3, { substate: 'pouring', pressure: 9, flow: 3, temp: 94, weight: 20 }),
      frame(4, { substate: 'pouring', pressure: 6, flow: 1, temp: 93, weight: 38 })
    ],
    { actualYield: 39.5 }
  );

  const stats = buildShotStats(shot);
  equal(stats.peakPressure, 9);
  equal(stats.avgFlow, 2); // pouring frames only: (2 + 3 + 1) / 3
  equal(stats.avgTemperature, 93); // pour window: (92 + 93 + 94 + 93) / 4
  equal(stats.firstDropsSeconds, 1); // window starts at t=1, weight ≥ 1g at t=2
  equal(stats.endWeight, 38);
  equal(Number(stats.postStopDrip?.toFixed(1)), 1.5);
  equal(hasShotStats(stats), true);
});

run('shot stats fall back to the full series without substates and hide missing data', () => {
  const shot = record(
    [frame(0, { pressure: 7, flow: 2 }), frame(1, { pressure: 8, flow: 4 })],
    {}
  );

  const stats = buildShotStats(shot);
  equal(stats.peakPressure, 8);
  equal(stats.avgFlow, 3);
  equal(stats.avgTemperature, null);
  equal(stats.firstDropsSeconds, null);
  equal(stats.endWeight, null);
  equal(stats.postStopDrip, null);
});

run('shot stats are empty for a shot without measurements', () => {
  const stats = buildShotStats(record([], {}));
  equal(hasShotStats(stats), false);
});

run('shot stats are memoized by record identity', () => {
  const shot = record([frame(0, { pressure: 7 })], {});
  equal(buildShotStats(shot), buildShotStats(shot));
});

run('shot duration spans the pour window from its measurement timestamps', () => {
  const shot = record(
    [
      // Heating frame before the pour — excluded from the window.
      frame(0, { substate: 'heating' }),
      frame(2, { substate: 'preinfusion' }),
      frame(30, { substate: 'pouring' })
    ],
    {}
  );
  equal(shotDurationSeconds(shot), 28); // t=2 → t=30
});

run('shot duration is null without two parsable measurements', () => {
  equal(shotDurationSeconds(record([], {})), null);
  equal(shotDurationSeconds(record([frame(0, { substate: 'pouring' })], {})), null);
});

interface FrameSpec {
  substate?: string;
  pressure?: number;
  flow?: number;
  temp?: number;
  weight?: number;
}

function frame(second: number, spec: FrameSpec): ShotMeasurement {
  const timestamp = new Date(Date.UTC(2026, 5, 5, 10, 0, second)).toISOString();
  return {
    machine: {
      timestamp,
      pressure: spec.pressure ?? null,
      flow: spec.flow ?? null,
      groupTemperature: spec.temp ?? null,
      ...(spec.substate ? { state: { substate: spec.substate } } : {})
    } as ShotMeasurement['machine'],
    scale: spec.weight == null ? null : { timestamp, weight: spec.weight, weightFlow: 0 }
  };
}

function record(measurements: ShotMeasurement[], annotations: { actualYield?: number }): ShotRecord {
  return {
    id: `shot-${Math.abs(JSON.stringify(measurements).length)}`,
    timestamp: '2026-06-05T10:00:00.000Z',
    annotations: { actualYield: annotations.actualYield ?? null },
    measurements
  };
}

function run(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

function equal<T>(actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  }
}
