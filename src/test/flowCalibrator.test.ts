import type { ShotRecord } from '../api/types';
import {
  analyzeFlowCalibration,
  calibrationShotCandidate,
  roundCalibration
} from '../components/flowCalibrator';

run('analyzeFlowCalibration suggests current multiplier times scale over machine flow', () => {
  const analysis = analyzeFlowCalibration(flowShot(1.5, 1.8, 40), 1.1);
  equal(analysis.averageMachineFlow?.toFixed(2), '1.50');
  equal(analysis.averageScaleFlow?.toFixed(2), '1.80');
  equal(analysis.ratio?.toFixed(3), '1.200');
  equal(analysis.suggestedMultiplier, 1.32);
  equal(analysis.confidence, 'medium');
});

run('analyzeFlowCalibration scales machine flow by preview over baseline', () => {
  const analysis = analyzeFlowCalibration(flowShot(1.5, 1.8, 40), 1, 1.2);
  equal(analysis.averageMachineFlow?.toFixed(2), '1.80');
  equal(analysis.averageScaleFlow?.toFixed(2), '1.80');
  equal(analysis.ratio?.toFixed(3), '1.000');
  equal(analysis.suggestedMultiplier, 1.2);
});

run('analyzeFlowCalibration focuses the stable tail instead of the whole shot', () => {
  const analysis = analyzeFlowCalibration(rampingThenStableShot(), 1, 1, 8);
  equal(analysis.tailStart?.toFixed(1), '11.0');
  equal(analysis.averageMachineFlow?.toFixed(2), '2.00');
  equal(analysis.averageScaleFlow?.toFixed(2), '2.00');
  equal(analysis.suggestedMultiplier, 1);
});

run('analyzeFlowCalibration trims trailing idle frames from chart samples', () => {
  const analysis = analyzeFlowCalibration(activeShotWithTrailingIdle(), 1, 1, 8);
  const maxTime = Math.max(...analysis.samples.map((sample) => sample.t));
  equal(analysis.samples.length, 24);
  equal(maxTime.toFixed(1), '23.0');
  equal(analysis.tailStart?.toFixed(1), '15.0');
});

run('analyzeFlowCalibration clamps suggested multiplier into DE1 bounds', () => {
  const analysis = analyzeFlowCalibration(flowShot(0.2, 2, 40), 1.5);
  equal(analysis.suggestedMultiplier, 2);
});

run('calibrationShotCandidate accepts old shots with paired flow traces', () => {
  equal(calibrationShotCandidate(flowShot(1, 1, 2)), true);
});

run('calibrationShotCandidate rejects shots without scale flow', () => {
  equal(calibrationShotCandidate(machineOnlyShot()), false);
});

run('roundCalibration applies two-digit DE1 slider precision', () => {
  equal(roundCalibration(1.234), 1.23);
  equal(roundCalibration(0), 0.13);
});

function flowShot(machineFlow: number, scaleFlow: number, count: number, title = 'Any shot'): ShotRecord {
  const start = Date.parse('2026-06-01T10:00:00.000Z');
  return {
    id: 'flow-shot',
    timestamp: '2026-06-01T10:00:00.000Z',
    workflow: { profile: { title } },
    measurements: Array.from({ length: count }, (_, index) => ({
      machine: {
        timestamp: new Date(start + index * 1000).toISOString(),
        flow: machineFlow
      },
      scale: {
        timestamp: new Date(start + index * 1000).toISOString(),
        weightFlow: scaleFlow
      }
    }))
  } as ShotRecord;
}

function rampingThenStableShot(): ShotRecord {
  const start = Date.parse('2026-06-01T10:00:00.000Z');
  return {
    id: 'tail-shot',
    timestamp: '2026-06-01T10:00:00.000Z',
    measurements: Array.from({ length: 20 }, (_, index) => ({
      machine: {
        timestamp: new Date(start + index * 1000).toISOString(),
        flow: index < 10 ? 0.8 : 2
      },
      scale: {
        timestamp: new Date(start + index * 1000).toISOString(),
        weightFlow: index < 10 ? 1.4 : 2
      }
    }))
  } as ShotRecord;
}

function machineOnlyShot(): ShotRecord {
  const start = Date.parse('2026-06-01T10:00:00.000Z');
  return {
    id: 'machine-only-shot',
    timestamp: '2026-06-01T10:00:00.000Z',
    measurements: Array.from({ length: 20 }, (_, index) => ({
      machine: {
        timestamp: new Date(start + index * 1000).toISOString(),
        flow: 2
      }
    }))
  } as ShotRecord;
}

function activeShotWithTrailingIdle(): ShotRecord {
  const start = Date.parse('2026-06-01T10:00:00.000Z');
  return {
    id: 'trailing-idle-shot',
    timestamp: '2026-06-01T10:00:00.000Z',
    measurements: Array.from({ length: 34 }, (_, index) => {
      const active = index <= 23;
      return {
        machine: {
          timestamp: new Date(start + index * 1000).toISOString(),
          flow: active ? 2 : 0
        },
        scale: {
          timestamp: new Date(start + index * 1000).toISOString(),
          weightFlow: active ? 2 : 0.4
        }
      };
    })
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
