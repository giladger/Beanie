import type { Profile } from '../api/types';
import { createProfileEditorState } from '../components/profileEditor';
import type { EditorStep } from '../domain/profileModel';
import {
  canEditAsBasic,
  compileSimpleToSteps,
  defaultSimpleKnobs,
  parseStepsToSimple,
  type SimpleKnobs
} from '../domain/simpleProfile';

run('compiles a pressure simple profile to canonical steps', () => {
  const steps = compileSimpleToSteps(defaultSimpleKnobs('pressure'));
  equal(steps.length, 3);
  // preinfusion pumps flow on BOTH de1app simple pages, never the profile's axis
  equal(steps[0]!.pump, 'flow');
  equal(steps[0]!.exit?.type, 'pressure');
  equal(steps[1]!.pump, 'pressure');
  equal(steps[1]!.transition, 'fast');
  equal(steps[2]!.pump, 'pressure');
  equal(steps[2]!.transition, 'smooth');
});

run('compiles a flow simple profile with flow-chasing main stages', () => {
  const steps = compileSimpleToSteps(defaultSimpleKnobs('flow'));
  equal(steps[0]!.pump, 'flow');
  equal(steps[1]!.pump, 'flow');
  equal(steps[2]!.pump, 'flow');
});

run('a fresh profile carries no cap it never asked for', () => {
  for (const type of ['pressure', 'flow'] as const) {
    for (const step of compileSimpleToSteps(defaultSimpleKnobs(type))) equal(step.limiter, null);
  }
});

run('pressure knobs survive a compile → parse round-trip', () => {
  const base = defaultSimpleKnobs('pressure');
  const knobs: SimpleKnobs = {
    ...base,
    pre: { ...base.pre, seconds: 12, flow: 4.5, temperature: 92.5 },
    preExitPressure: 4,
    hold: { ...base.hold, seconds: 20, target: 8.6, temperature: 92.5 },
    decline: { ...base.decline, seconds: 28, target: 5.5, temperature: 92.5 },
    limit: 2.4
  };
  const steps = compileSimpleToSteps(knobs);
  equal(canEditAsBasic(steps), true);
  equal(steps[1]!.pressure, 8.6);
  equal(steps[2]!.pressure, 5.5);
  equalKnobs(parseStepsToSimple(steps)!, knobs);
});

run('flow knobs survive a compile → parse round-trip (the cap is pressure)', () => {
  const base = defaultSimpleKnobs('flow');
  const knobs: SimpleKnobs = {
    ...base,
    hold: { ...base.hold, target: 2.2 },
    decline: { ...base.decline, target: 1.2 },
    limit: 9
  };
  const steps = compileSimpleToSteps(knobs);
  equal(canEditAsBasic(steps), true);
  equal(steps[1]!.flow, 2.2);
  equal(steps[2]!.flow, 1.2);
  equalKnobs(parseStepsToSimple(steps)!, knobs);
});

run('the profile-level cap lands on hold and decline, never preinfusion', () => {
  // Exactly where de1app's pressure_to_advanced_list appends max_flow_or_pressure.
  const steps = compileSimpleToSteps({ ...defaultSimpleKnobs('pressure'), limit: 2.5, limitRange: 0.4 });
  equal(steps[0]!.limiter, null);
  equal(steps[1]!.limiter?.value, 2.5);
  equal(steps[1]!.limiter?.range, 0.4);
  equal(steps[2]!.limiter?.value, 2.5);
  equal(steps[2]!.limiter?.range, 0.4);
});

run('each stage keeps its own time and temperature', () => {
  const base = defaultSimpleKnobs('pressure');
  const knobs: SimpleKnobs = {
    ...base,
    pre: { ...base.pre, temperature: 94 },
    hold: { ...base.hold, temperature: 92 },
    decline: { ...base.decline, temperature: 90 }
  };
  const steps = compileSimpleToSteps(knobs);
  equal(canEditAsBasic(steps), true);
  equal(steps[0]!.temperature, 94);
  equal(steps[1]!.temperature, 92);
  equal(steps[2]!.temperature, 90);
  equalKnobs(parseStepsToSimple(steps)!, knobs);
});

run('editing a knob recompiles and stays basic', () => {
  const base = defaultSimpleKnobs('pressure');
  let steps = compileSimpleToSteps(base);
  // simulate an edit: re-parse, mutate, recompile
  const parsed = parseStepsToSimple(steps)!;
  steps = compileSimpleToSteps({ ...parsed, hold: { ...parsed.hold, target: 7.5 }, limit: 2.5 });
  equal(canEditAsBasic(steps), true);
  equal(parseStepsToSimple(steps)?.hold.target, 7.5);
  equal(parseStepsToSimple(steps)?.limit, 2.5);
});

run('no cap parses back to 0 and round-trips', () => {
  const steps = compileSimpleToSteps({ ...defaultSimpleKnobs('pressure'), limit: 0 });
  equal(steps[1]!.limiter, null);
  equal(parseStepsToSimple(steps)?.limit, 0);
  equal(canEditAsBasic(steps), true);
});

// `parse` rejects any step count != 3 up front, so the only way a non-simple
// profile could be mis-classified as basic is a 3-step one. A simple profile
// chases ONE axis — de1app's settings_2a is a pressure profile and settings_2b a
// flow one, with no per-stage pumps — so the skeleton must be: flow-pumped
// preinfuse that exits on rising pressure, then a hold and a decline that agree
// on their axis and share one cap.
run('rejects 3-step shapes the basic knobs cannot express', () => {
  // ≠ 3 steps (e.g. rao_allonge n=2)
  equal(canEditAsBasic(stepsOf(advanced([flow(2), flow(2)]))), false);
  // preinfuse missing its pressure-over exit (D-Flow, Damians_Q: p / p / f)
  equal(canEditAsBasic(stepsOf(advanced([press(2), press(9), flow(2, 'smooth')]))), false);
  equal(canEditAsBasic(stepsOf(advanced([flow(4), press(9), press(6, 'smooth')]))), false);
  // f / f / p-fast (baseline_hc/lc/mc): the decline isn't smooth
  equal(canEditAsBasic(stepsOf(advanced([preinfuse(), flow(2), press(6, 'fast')]))), false);
  // f / f / f all-fast (baseline_ulc): the decline isn't smooth
  equal(canEditAsBasic(stepsOf(advanced([preinfuse(), flow(2), flow(1)]))), false);
  // psph/rohan-soup: a flow hold that carries its own exit condition
  equal(
    canEditAsBasic(
      stepsOf(advanced([preinfuse(), { ...flow(2), exit: { type: 'pressure', condition: 'over', value: 3 } }, flow(1, 'smooth')]))
    ),
    false
  );
  // a water-sensor step
  equal(
    canEditAsBasic(stepsOf(advanced([{ ...preinfuse(), sensor: 'water' }, press(9), press(6, 'smooth')]))),
    false
  );
});

run('one axis for the whole profile, and one cap shared by hold and decline', () => {
  // f / p / f (Blue Willow): hold and decline chase different axes, which the
  // simple editor has no way to show — de1app has no per-stage pump either.
  equal(canEditAsBasic(stepsOf(advanced([preinfuse(), press(9), flow(2, 'smooth')]))), false);

  // a cap on the preinfuse: de1app never puts one there
  equal(
    canEditAsBasic(
      stepsOf(advanced([
        { ...preinfuse(), limiter: { value: 8, range: 0.6 } },
        press(9),
        press(6, 'smooth')
      ]))
    ),
    false
  );

  // caps that disagree between hold and decline — there is only one cap knob
  equal(
    canEditAsBasic(
      stepsOf(advanced([
        preinfuse(),
        { ...press(9), limiter: { value: 2, range: 0.6 } },
        { ...press(6, 'smooth'), limiter: { value: 4, range: 0.6 } }
      ]))
    ),
    false
  );

  // the same cap on both is exactly what the one knob compiles to
  const shared = stepsOf(
    advanced([
      preinfuse(),
      { ...press(9), limiter: { value: 2.4, range: 0.6 } },
      { ...press(6, 'smooth'), limiter: { value: 2.4, range: 0.6 } }
    ])
  );
  equal(canEditAsBasic(shared), true);
  equal(parseStepsToSimple(shared)?.type, 'pressure');
  equal(parseStepsToSimple(shared)?.limit, 2.4);

  // temperatures still differ freely stage to stage
  const temps = stepsOf(
    advanced([{ ...preinfuse(), temperature: 94 }, press(9), { ...press(6, 'smooth'), temperature: 88 }])
  );
  equal(canEditAsBasic(temps), true);
  equal(parseStepsToSimple(temps)?.pre.temperature, 94);
  equal(parseStepsToSimple(temps)?.decline.temperature, 88);
});

run('per-step popup / custom field disqualifies basic mode', () => {
  const withPopup = advanced([{ ...preinfuse(), popup: 'hi' }, press(9), press(6, 'smooth')]);
  equal(canEditAsBasic(stepsOf(withPopup)), false);
});

run('a non-zero per-step weight or volume disqualifies basic mode', () => {
  equal(canEditAsBasic(stepsOf(advanced([preinfuse(), { ...press(9), weight: 18 }, press(6, 'smooth')]))), false);
  equal(canEditAsBasic(stepsOf(advanced([preinfuse(), press(9), { ...press(6, 'smooth'), volume: 60 }]))), false);
});

// --- fixtures -------------------------------------------------------------

function preinfuse(): Record<string, unknown> {
  return {
    name: 'preinfusion',
    pump: 'flow',
    flow: 4,
    temperature: 90,
    transition: 'fast',
    seconds: 10,
    sensor: 'coffee',
    exit: { type: 'pressure', condition: 'over', value: 4 }
  };
}

function press(pressure: number, transition: 'fast' | 'smooth' = 'fast'): Record<string, unknown> {
  return { name: 'p', pump: 'pressure', pressure, temperature: 90, transition, seconds: 20, sensor: 'coffee' };
}

function flow(rate: number, transition: 'fast' | 'smooth' = 'fast'): Record<string, unknown> {
  return { name: 'f', pump: 'flow', flow: rate, temperature: 90, transition, seconds: 20, sensor: 'coffee' };
}

function advanced(steps: Record<string, unknown>[]): Profile {
  return { title: 'adv', steps } as Profile;
}

function stepsOf(profile: Profile): EditorStep[] {
  return createProfileEditorState(profile).steps;
}

// --- mini test harness (matches the other *.test.ts files) ----------------

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

function equalKnobs(actual: SimpleKnobs, expected: SimpleKnobs): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Knobs differ:\n  expected ${JSON.stringify(expected)}\n  received ${JSON.stringify(actual)}`);
  }
}
