import type { ShotRecord } from '../api/types';
import { analyzeShotCalibration, roundCalibration } from '../components/flowCalibrator';

run('analyzeShotCalibration suggests base multiplier times cup weight over machine volume', () => {
  // Constant 2 mL/s for 20s -> 40 mL machine volume; 36 g in the cup.
  const analysis = analyzeShotCalibration(constFlowShot(2, 21, { yield: 36 }), 1);
  equal(analysis.machineVolume?.toFixed(1), '40.0');
  equal(analysis.cupWeight, 36);
  equal(analysis.weightSource, 'yield');
  equal(analysis.ratio?.toFixed(3), '0.900');
  equal(analysis.suggestedMultiplier, 0.9);
});

run('analyzeShotCalibration prefers a scale weight trace over the recorded yield', () => {
  // 40 mL machine volume, scale ramps to 38 g (yield annotation deliberately wrong).
  const analysis = analyzeShotCalibration(constFlowShot(2, 21, { scaleTo: 38, yield: 99 }), 1);
  equal(analysis.weightSource, 'scale');
  equal(analysis.cupWeight, 38);
  equal(analysis.suggestedMultiplier, 0.95);
});

run('analyzeShotCalibration scales the suggestion by the base multiplier', () => {
  // base 1.2 * (36/40) = 1.08
  const analysis = analyzeShotCalibration(constFlowShot(2, 21, { yield: 36 }), 1.2);
  equal(analysis.suggestedMultiplier, 1.08);
});

run('analyzeShotCalibration clamps the suggestion into DE1 slider bounds', () => {
  // 0.5 mL/s for 4s -> 2 mL volume, 40 g cup -> ratio 20 -> clamp to 2.
  const analysis = analyzeShotCalibration(constFlowShot(0.5, 5, { yield: 40 }), 1.5);
  equal(analysis.suggestedMultiplier, 2);
});

run('analyzeShotCalibration returns no suggestion without a cup weight', () => {
  const analysis = analyzeShotCalibration(constFlowShot(2, 21, {}), 1);
  equal(analysis.machineVolume?.toFixed(1), '40.0');
  equal(analysis.cupWeight, null);
  equal(analysis.weightSource, null);
  equal(analysis.suggestedMultiplier, null);
});

run('analyzeShotCalibration returns no suggestion without a flow trace', () => {
  const analysis = analyzeShotCalibration(noFlowShot(36), 1);
  equal(analysis.machineVolume, null);
  equal(analysis.suggestedMultiplier, null);
});

run('analyzeShotCalibration reports the shot duration in seconds', () => {
  const analysis = analyzeShotCalibration(constFlowShot(2, 21, { yield: 36 }), 1);
  equal(analysis.durationSeconds, 20);
});

run('roundCalibration applies two-digit DE1 slider precision', () => {
  equal(roundCalibration(1.234), 1.23);
  equal(roundCalibration(0), 0.13);
});

interface ShotOptions {
  scaleTo?: number;
  yield?: number;
}

// One measurement per second so the trapezoidal integral of a constant flow is
// flow * (count - 1) seconds.
function constFlowShot(flow: number, count: number, options: ShotOptions): ShotRecord {
  const start = Date.parse('2026-06-01T10:00:00.000Z');
  return {
    id: 'shot',
    timestamp: '2026-06-01T10:00:00.000Z',
    workflow: { profile: { title: 'Any shot' } },
    annotations: options.yield == null ? {} : { actualYield: options.yield },
    measurements: Array.from({ length: count }, (_, index) => ({
      machine: {
        timestamp: new Date(start + index * 1000).toISOString(),
        flow
      },
      scale:
        options.scaleTo == null
          ? null
          : {
              timestamp: new Date(start + index * 1000).toISOString(),
              weight: (options.scaleTo * index) / (count - 1)
            }
    }))
  } as ShotRecord;
}

function noFlowShot(yieldWeight: number): ShotRecord {
  const start = Date.parse('2026-06-01T10:00:00.000Z');
  return {
    id: 'no-flow-shot',
    timestamp: '2026-06-01T10:00:00.000Z',
    annotations: { actualYield: yieldWeight },
    measurements: Array.from({ length: 10 }, (_, index) => ({
      machine: {
        timestamp: new Date(start + index * 1000).toISOString()
      }
    }))
  } as ShotRecord;
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
