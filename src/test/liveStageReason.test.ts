import { liveStageAdvanceReason } from '../domain/liveStageReason';
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
  equal(
    liveStageAdvanceReason(SKIP(8.3), step, 6, { pressure: 9, flow: 2, weight: 8.1 }),
    'weight 8.3 g'
  );
});

run('a weight skip without a decision value falls back to measured weight', () => {
  const step = makeStep({ seconds: 30, weight: 8 });
  equal(
    liveStageAdvanceReason(SKIP(null), step, 6, { pressure: 9, flow: 2, weight: 8.1 }),
    'weight 8.1 g'
  );
});

run('a weight skip with no telemetry falls back to the step goal', () => {
  const step = makeStep({ seconds: 30, weight: 8 });
  equal(liveStageAdvanceReason(SKIP(null), step, 6, NO_TELEMETRY), 'weight 8 g');
});

run('a firmware advance on a pressure-exit step reports the measured pressure', () => {
  const step = makeStep({ seconds: 30, exit: { type: 'pressure', condition: 'over', value: 4 } });
  equal(
    liveStageAdvanceReason(FIRMWARE, step, 8, { pressure: 4.2, flow: 1, weight: 5 }),
    'pressure 4.2 bar'
  );
});

run('a firmware advance on a flow-exit step reports the measured flow', () => {
  const step = makeStep({ seconds: 30, exit: { type: 'flow', condition: 'under', value: 2 } });
  equal(
    liveStageAdvanceReason(FIRMWARE, step, 8, { pressure: 6, flow: 1.8, weight: 5 }),
    'flow 1.8 ml/s'
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
  equal(
    liveStageAdvanceReason(FIRMWARE, step, 6, { pressure: 9, flow: 4.8, weight: 5.1 }),
    'volume 40 ml'
  );
});

run('a firmware advance at the time cap reports elapsed time', () => {
  const step = makeStep({ seconds: 10, exit: { type: 'pressure', condition: 'over', value: 9 } });
  equal(liveStageAdvanceReason(FIRMWARE, step, 9.8, NO_TELEMETRY), '9.8s elapsed');
});

run('a missing decision (transient socket gap) uses the firmware description', () => {
  const step = makeStep({ seconds: 30, exit: { type: 'pressure', condition: 'over', value: 4 } });
  equal(
    liveStageAdvanceReason(null, step, 8, { pressure: 4.2, flow: 1, weight: 5 }),
    'pressure 4.2 bar'
  );
});

run('an unknown future advance reason falls back to the firmware description', () => {
  const step = makeStep({ seconds: 40, volume: 36 });
  equal(
    liveStageAdvanceReason(
      { reason: 'someFutureReason', weight: null },
      step,
      12,
      NO_TELEMETRY
    ),
    'volume 36 ml'
  );
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
