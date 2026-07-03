import { historicShotStages } from '../domain/historicShotStages';
import type { ShotMeasurement } from '../api/types';
import type { EditorStep } from '../domain/profileModel';

// A measurement sample the way reaprime persists them: profileFrame rides on
// the machine object past beanie's narrow ShotMeasurement type.
function sample(
  second: number,
  frame: number,
  values: { pressure?: number; flow?: number; weight?: number } = {}
): ShotMeasurement {
  return {
    machine: {
      timestamp: new Date(Date.UTC(2026, 6, 1, 10, 0, second)).toISOString(),
      pressure: values.pressure ?? 0,
      flow: values.flow ?? 0,
      profileFrame: frame
    } as ShotMeasurement['machine'],
    scale: { weight: values.weight ?? 0 }
  };
}

run('labels vacated stages from handoff telemetry and the last from stopReason', () => {
  const steps = [
    makeStep({ name: 'Fill', seconds: 30, exit: { type: 'pressure', condition: 'over', value: 4 } }),
    makeStep({ name: 'Pour', seconds: 30 })
  ];
  const view = historicShotStages(
    {
      measurements: [
        sample(0, 0, { pressure: 2 }),
        sample(2, 0, { pressure: 4.2 }),
        sample(3, 1, { pressure: 9 }),
        sample(20, 1, { pressure: 8 })
      ],
      stopReason: 'targetWeight'
    },
    steps
  );

  equal(view?.currentIndex, 1);
  // Stage 0 advanced early on its genuine pressure exit — the reason carries
  // the ENDING stage's last reading (4.2), not the new stage's (9).
  equal(view?.steps[0]?.reason?.text, 'pressure 4.2 bar');
  equal(view?.steps[0]?.reason?.kind, 'pressure');
  // The last reached stage carries the persisted stop reason as a goal chip.
  equal(view?.steps[1]?.reason?.text, 'target weight');
  equal(view?.steps[1]?.reason?.kind, 'goal');
});

run('a weight-target step advancing early reads as a weight exit', () => {
  // Persisted shots carry no advance decisions, so the placeholder-exit
  // heuristic applies: weight steps that advanced early advanced on weight.
  const steps = [
    makeStep({
      name: 'To weight',
      seconds: 80,
      weight: 18,
      exit: { type: 'flow', condition: 'under', value: 0 }
    }),
    makeStep({ name: 'Finish', seconds: 10 })
  ];
  const view = historicShotStages(
    {
      measurements: [
        sample(0, 0, { weight: 0 }),
        sample(8, 0, { weight: 18.2 }),
        sample(9, 1, { weight: 19 })
      ],
      stopReason: null
    },
    steps
  );

  equal(view?.steps[0]?.reason?.text, 'weight 18.2 g');
  equal(view?.steps[0]?.reason?.kind, 'weight');
  // Legacy shot without a stopReason: the final stage carries no chip.
  equal(view?.steps[1]?.reason, null);
});

run('a trace without frame data lists the steps plainly', () => {
  const steps = [makeStep({ name: 'Only' })];
  const measurement = sample(0, 0);
  delete (measurement.machine as unknown as Record<string, unknown>).profileFrame;

  const view = historicShotStages({ measurements: [measurement], stopReason: null }, steps);
  equal(view?.currentIndex, null);
  equal(view?.steps[0]?.reason, null);
});

run('frame regressions in the trace are ignored', () => {
  const steps = [makeStep({ name: 'A', seconds: 30 }), makeStep({ name: 'B', seconds: 30 })];
  const view = historicShotStages(
    {
      measurements: [
        sample(0, 0),
        sample(5, 1),
        sample(6, 0), // out-of-order sample must not rewind the timeline
        sample(7, 1)
      ],
      stopReason: 'machineEnded'
    },
    steps
  );

  equal(view?.currentIndex, 1);
  equal(view?.steps[1]?.reason?.text, 'machine stop');
  equal(view?.steps[1]?.reason?.kind, 'stop');
});

run('an empty step list yields no view', () => {
  equal(historicShotStages({ measurements: [], stopReason: null }, []), null);
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
