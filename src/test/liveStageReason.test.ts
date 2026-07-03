import {
  liveStageAdvanceReason,
  stageStopReason,
  type StageReason
} from '../domain/liveStageReason';
import type { StageAdvanceDecision } from '../domain/shotDecisions';
import type { EditorStep } from '../domain/profileModel';

const NO_TELEMETRY = { pressure: null, flow: null, weight: null };

const SKIP = (weight: number | null): StageAdvanceDecision => ({
  reason: 'profileSkip',
  weight
});
const FIRMWARE: StageAdvanceDecision = { reason: 'profileAdvance', weight: null };

run('an app-issued weight skip reports the projected weight from the decision', () => {
  const step = makeStep({ seconds: 30, weight: 8 });
  reasonEqual(
    liveStageAdvanceReason(SKIP(8.3), step, 6, { pressure: 9, flow: 2, weight: 8.1 }),
    'weight 8.3 g',
    'weight'
  );
});

run('a weight skip without a decision value falls back to measured weight', () => {
  const step = makeStep({ seconds: 30, weight: 8 });
  reasonEqual(
    liveStageAdvanceReason(SKIP(null), step, 6, { pressure: 9, flow: 2, weight: 8.1 }),
    'weight 8.1 g',
    'weight'
  );
});

run('a weight skip with no telemetry falls back to the step goal', () => {
  const step = makeStep({ seconds: 30, weight: 8 });
  reasonEqual(liveStageAdvanceReason(SKIP(null), step, 6, NO_TELEMETRY), 'weight 8 g', 'weight');
});

run('a firmware advance on a pressure-exit step reports the measured pressure', () => {
  const step = makeStep({ seconds: 30, exit: { type: 'pressure', condition: 'over', value: 4 } });
  reasonEqual(
    liveStageAdvanceReason(FIRMWARE, step, 8, { pressure: 4.2, flow: 1, weight: 5 }),
    'pressure 4.2 bar',
    'pressure'
  );
});

run('a firmware advance on a flow-exit step reports the measured flow', () => {
  const step = makeStep({ seconds: 30, exit: { type: 'flow', condition: 'under', value: 2 } });
  reasonEqual(
    liveStageAdvanceReason(FIRMWARE, step, 8, { pressure: 6, flow: 1.8, weight: 5 }),
    'flow 1.8 ml/s',
    'flow'
  );
});

run('a firmware advance ignores a placeholder exit and reports the volume goal', () => {
  // A "stop at weight" step stores a disabled `flow under 0` exit that can
  // never fire; when the FIRMWARE advanced such a step, the trigger cannot be
  // the app's weight skip (that would be profileSkip) — describe the volume.
  const step = makeStep({
    seconds: 80,
    volume: 40,
    exit: { type: 'flow', condition: 'under', value: 0 }
  });
  reasonEqual(
    liveStageAdvanceReason(FIRMWARE, step, 6, { pressure: 9, flow: 4.8, weight: 5.1 }),
    'volume 40 ml',
    'volume'
  );
});

run('a firmware advance at the time cap reports elapsed time', () => {
  const step = makeStep({ seconds: 10, exit: { type: 'pressure', condition: 'over', value: 9 } });
  reasonEqual(liveStageAdvanceReason(FIRMWARE, step, 9.8, NO_TELEMETRY), '9.8s elapsed', 'time');
});

run('a missing decision (transient socket gap) uses the firmware description', () => {
  const step = makeStep({ seconds: 30, exit: { type: 'pressure', condition: 'over', value: 4 } });
  reasonEqual(
    liveStageAdvanceReason(null, step, 8, { pressure: 4.2, flow: 1, weight: 5 }),
    'pressure 4.2 bar',
    'pressure'
  );
});

run('a missing decision on a weight step uses the weight heuristic (history)', () => {
  // Saved shots persist no advance decisions; a weight-target step with only
  // a placeholder exit that advanced early most likely advanced on weight.
  const step = makeStep({
    seconds: 80,
    weight: 18,
    exit: { type: 'flow', condition: 'under', value: 0 }
  });
  reasonEqual(
    liveStageAdvanceReason(null, step, 8, { pressure: 9, flow: 2, weight: 18.2 }),
    'weight 18.2 g',
    'weight'
  );
});

run('a KNOWN firmware advance never claims the weight heuristic', () => {
  const step = makeStep({
    seconds: 10,
    weight: 18,
    exit: { type: 'flow', condition: 'under', value: 0 }
  });
  reasonEqual(
    liveStageAdvanceReason(FIRMWARE, step, 9.8, { pressure: 9, flow: 2, weight: 12 }),
    '9.8s elapsed',
    'time'
  );
});

run('an unknown future advance reason falls back to the firmware description', () => {
  const step = makeStep({ seconds: 40, volume: 36 });
  reasonEqual(
    liveStageAdvanceReason({ reason: 'someFutureReason', weight: null }, step, 12, NO_TELEMETRY),
    'volume 36 ml',
    'volume'
  );
});

run('a met target stop reads as a goal chip', () => {
  reasonEqual(stageStopReason({ kind: 'stop', reason: 'targetWeight' }), 'target weight', 'goal');
  reasonEqual(stageStopReason({ kind: 'stop', reason: 'targetVolume' }), 'target volume', 'goal');
});

run('commanded and machine stops read as neutral stop chips', () => {
  reasonEqual(stageStopReason({ kind: 'stop', reason: 'apiStop' }), 'stopped via API', 'stop');
  reasonEqual(stageStopReason({ kind: 'stop', reason: 'appStop' }), 'stopped from app', 'stop');
  reasonEqual(stageStopReason({ kind: 'stop', reason: 'machineEnded' }), 'machine stop', 'stop');
});

run('abnormal endings warn', () => {
  reasonEqual(stageStopReason({ kind: 'terminal', reason: 'error' }), 'machine error', 'warn');
  reasonEqual(
    stageStopReason({ kind: 'terminal', reason: 'disconnected' }),
    'machine disconnected',
    'warn'
  );
});

run('an unknown stop reason passes through as a neutral chip; null stays null', () => {
  reasonEqual(stageStopReason({ kind: 'stop', reason: 'someFutureReason' }), 'someFutureReason', 'stop');
  equal(stageStopReason(null), null);
});

function makeStep(overrides: Partial<EditorStep>): EditorStep {
  return {
    name: 'Step',
    temperature: 92,
    sensor: 'coffee',
    pump: 'pressure',
    pressure: 9,
    flow: 2,
    transition: 'fast',
    seconds: 0,
    volume: 0,
    weight: 0,
    exit: null,
    limiter: null,
    extra: {},
    ...overrides
  };
}

function reasonEqual(actual: StageReason | null, text: string, kind: string): void {
  if (!actual) throw new Error(`Expected "${text}" (${kind}), received null`);
  if (actual.text !== text || actual.kind !== kind) {
    throw new Error(
      `Expected "${text}" (${kind}), received "${actual.text}" (${actual.kind})`
    );
  }
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
