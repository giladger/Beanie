import { liveStageAdvanceReason } from '../domain/liveStageReason';
import type { EditorStep } from '../domain/profileModel';

const NO_TELEMETRY = { pressure: null, flow: null, weight: null };

run('a weight-target step reports the measured weight it advanced at', () => {
  const step = makeStep({ seconds: 30, weight: 8 });
  equal(
    liveStageAdvanceReason(step, 6, { pressure: 9, flow: 2, weight: 8.3 }),
    'weight 8.3 g'
  );
});

run('a weight-target step falls back to the goal when no weight was captured', () => {
  const step = makeStep({ seconds: 30, weight: 8 });
  equal(liveStageAdvanceReason(step, 6, NO_TELEMETRY), 'weight 8 g');
});

run('a pressure-exit step reports the measured pressure, not the threshold', () => {
  const step = makeStep({ seconds: 30, exit: { type: 'pressure', condition: 'over', value: 4 } });
  equal(
    liveStageAdvanceReason(step, 8, { pressure: 4.2, flow: 1, weight: 5 }),
    'pressure 4.2 bar'
  );
});

run('a flow-exit step reports the measured flow', () => {
  const step = makeStep({ seconds: 30, exit: { type: 'flow', condition: 'under', value: 2 } });
  equal(
    liveStageAdvanceReason(step, 8, { pressure: 6, flow: 1.8, weight: 5 }),
    'flow 1.8 ml/s'
  );
});

run('a placeholder exit (value 0) is ignored so a weight step reports weight', () => {
  // How a profile stores a "stop at weight" step: a disabled `flow under 0` exit
  // that can never fire, plus the real weight goal.
  const step = makeStep({ seconds: 80, weight: 5, exit: { type: 'flow', condition: 'under', value: 0 } });
  equal(
    liveStageAdvanceReason(step, 6, { pressure: 9, flow: 4.8, weight: 5.1 }),
    'weight 5.1 g'
  );
});

run('an exit takes precedence over a weight goal on the same step', () => {
  const step = makeStep({ seconds: 30, weight: 8, exit: { type: 'pressure', condition: 'over', value: 4 } });
  equal(
    liveStageAdvanceReason(step, 8, { pressure: 4.5, flow: 1, weight: 8.3 }),
    'pressure 4.5 bar'
  );
});

run('a step that ran to its time cap reports the elapsed time', () => {
  const step = makeStep({ seconds: 30, exit: { type: 'pressure', condition: 'over', value: 9 } });
  equal(liveStageAdvanceReason(step, 30.2, { pressure: 8, flow: 1, weight: 5 }), '30.2s elapsed');
});

run('a volume-target step names the volume goal', () => {
  const step = makeStep({ seconds: 40, volume: 36 });
  equal(liveStageAdvanceReason(step, 12, NO_TELEMETRY), 'volume 36 ml');
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
