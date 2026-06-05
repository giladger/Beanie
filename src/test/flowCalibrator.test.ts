import type { ShotRecord } from '../api/types';
import {
  FLOW_CALIBRATION_MAX,
  FLOW_CALIBRATION_MIN,
  calibrationPreviewFactor,
  clampCalibration,
  recordedFlowMultiplier,
  roundCalibration
} from '../components/flowCalibrator';

run('calibrationPreviewFactor is 1 when the draft matches the base', () => {
  equal(calibrationPreviewFactor(1, 1), 1);
  equal(calibrationPreviewFactor(1.25, 1.25), 1);
});

run('calibrationPreviewFactor scales the recorded flow up as the draft rises', () => {
  // Shot pulled at 1.0; previewing at 1.2 draws the machine flow 20% higher.
  equal(calibrationPreviewFactor(1, 1.2), 1.2);
});

run('calibrationPreviewFactor unwinds the base the shot was pulled under', () => {
  // Shot recorded at 1.25; previewing at 1.0 scales the trace back by 0.8.
  equal(Number(calibrationPreviewFactor(1.25, 1).toFixed(3)), 0.8);
});

run('calibrationPreviewFactor treats a non-positive base as 1', () => {
  equal(calibrationPreviewFactor(0, 1.3), 1.3);
  equal(calibrationPreviewFactor(Number.NaN, 1.3), 1.3);
});

run('calibrationPreviewFactor falls back to the base when the draft is invalid', () => {
  equal(calibrationPreviewFactor(1.4, Number.NaN), 1);
  equal(calibrationPreviewFactor(1.4, 0), 1);
});

run('clampCalibration holds the value inside the DE1 slider bounds', () => {
  equal(clampCalibration(0.05), FLOW_CALIBRATION_MIN);
  equal(clampCalibration(3), FLOW_CALIBRATION_MAX);
  equal(clampCalibration(1.1), 1.1);
});

run('roundCalibration applies two-digit DE1 slider precision', () => {
  equal(roundCalibration(1.234), 1.23);
  equal(roundCalibration(0), 0.13);
});

run('recordedFlowMultiplier reads the value reaprime stamps into annotations.extras', () => {
  equal(recordedFlowMultiplier(shotWith({ extras: { flowCalibrationMultiplier: 1.05 } })), 1.05);
});

run('recordedFlowMultiplier falls back to top-level metadata', () => {
  equal(recordedFlowMultiplier({ ...shotWith({}), metadata: { flowCalibrationMultiplier: 0.9 } } as ShotRecord), 0.9);
});

run('recordedFlowMultiplier prefers annotations.extras over metadata', () => {
  const shot = {
    ...shotWith({ extras: { flowCalibrationMultiplier: 1.1 } }),
    metadata: { flowCalibrationMultiplier: 0.8 }
  } as ShotRecord;
  equal(recordedFlowMultiplier(shot), 1.1);
});

run('recordedFlowMultiplier coerces a numeric string', () => {
  equal(recordedFlowMultiplier(shotWith({ extras: { flowCalibrationMultiplier: '0.88' } })), 0.88);
});

run('recordedFlowMultiplier is null for shots without the stamp (old reaprime)', () => {
  equal(recordedFlowMultiplier(shotWith({})), null);
  equal(recordedFlowMultiplier(shotWith({ extras: { other: 1 } })), null);
});

run('recordedFlowMultiplier rejects non-positive or non-numeric values', () => {
  equal(recordedFlowMultiplier(shotWith({ extras: { flowCalibrationMultiplier: 0 } })), null);
  equal(recordedFlowMultiplier(shotWith({ extras: { flowCalibrationMultiplier: 'n/a' } })), null);
});

function shotWith(annotations: Record<string, unknown>): ShotRecord {
  return {
    id: 'shot',
    timestamp: '2026-06-01T10:00:00.000Z',
    annotations,
    measurements: []
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
