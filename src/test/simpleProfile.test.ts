import type { Profile } from '../api/types';
import { createProfileEditorState } from '../components/profileEditor';
import type { EditorStep } from '../domain/profileModel';
import {
  canEditAsBasic,
  compileSimpleToSteps,
  defaultSimpleKnobs,
  parseStepsToSimple,
  simpleProfileType,
  type SimpleKnobs
} from '../domain/simpleProfile';

run('compiles a pressure simple profile to canonical steps', () => {
  const steps = compileSimpleToSteps(defaultSimpleKnobs('pressure'));
  equal(steps.length, 3);
  equal(steps[0]!.pump, 'flow');
  equal(steps[0]!.exit?.type, 'pressure');
  equal(steps[1]!.pump, 'pressure');
  equal(steps[1]!.transition, 'fast');
  equal(steps[2]!.pump, 'pressure');
  equal(steps[2]!.transition, 'smooth');
});

run('a fresh profile carries no cap it never asked for', () => {
  for (const steps of [compileSimpleToSteps(defaultSimpleKnobs('pressure')), compileSimpleToSteps(defaultSimpleKnobs('flow'))]) {
    for (const step of steps) equal(step.limiter, null);
  }
});

run('pressure knobs survive a compile → parse round-trip', () => {
  const base = defaultSimpleKnobs('pressure');
  const knobs: SimpleKnobs = {
    pre: { ...base.pre, seconds: 12, flow: 4.5, temperature: 92.5 },
    preExitPressure: 4,
    hold: { ...base.hold, seconds: 20, pressure: 8.6, flow: 2.4, temperature: 92.5 },
    decline: { ...base.decline, seconds: 28, pressure: 5.5, temperature: 92.5 }
  };
  const steps = compileSimpleToSteps(knobs);
  equal(canEditAsBasic(steps), true);
  // the hold's off-axis flow is its cap
  equal(steps[1]!.limiter?.value, 2.4);
  equalKnobs(parseStepsToSimple(steps)!, knobs);
  equal(simpleProfileType(knobs), 'pressure');
});

run('flow knobs survive a compile → parse round-trip (the cap is pressure)', () => {
  const base = defaultSimpleKnobs('flow');
  const knobs: SimpleKnobs = {
    ...base,
    hold: { ...base.hold, flow: 2.2, pressure: 9 },
    decline: { ...base.decline, flow: 1.2, pressure: 9 }
  };
  const steps = compileSimpleToSteps(knobs);
  equal(canEditAsBasic(steps), true);
  equal(steps[1]!.limiter?.value, 9);
  equal(steps[2]!.limiter?.value, 9);
  equalKnobs(parseStepsToSimple(steps)!, knobs);
  equal(simpleProfileType(knobs), 'flow');
});

run('every stage keeps its own pump, temperature and cap', () => {
  const base = defaultSimpleKnobs('pressure');
  const knobs: SimpleKnobs = {
    ...base,
    pre: { ...base.pre, temperature: 94, pressure: 0 },
    hold: { ...base.hold, temperature: 92, flow: 2.5 },
    decline: { ...base.decline, pump: 'flow', flow: 1.4, pressure: 6, temperature: 90 }
  };
  const steps = compileSimpleToSteps(knobs);
  equal(canEditAsBasic(steps), true);
  equal(steps[0]!.temperature, 94);
  equal(steps[1]!.temperature, 92);
  equal(steps[2]!.pump, 'flow');
  equal(steps[2]!.limiter?.value, 6);
  equalKnobs(parseStepsToSimple(steps)!, knobs);
  // hold and decline disagree, so the profile is no longer one de1app kind
  equal(simpleProfileType(knobs), 'advanced');
});

run('editing a knob recompiles and stays basic', () => {
  const base = defaultSimpleKnobs('pressure');
  let steps = compileSimpleToSteps(base);
  // simulate an edit: re-parse, mutate, recompile
  const parsed = parseStepsToSimple(steps)!;
  steps = compileSimpleToSteps({ ...parsed, hold: { ...parsed.hold, pressure: 7.5, flow: 2.5 } });
  equal(canEditAsBasic(steps), true);
  equal(parseStepsToSimple(steps)?.hold.pressure, 7.5);
  equal(parseStepsToSimple(steps)?.hold.flow, 2.5);
});

run('a stage with no cap parses back to 0 and round-trips', () => {
  const base = defaultSimpleKnobs('pressure');
  const steps = compileSimpleToSteps({ ...base, hold: { ...base.hold, flow: 0 } });
  equal(steps[1]!.limiter, null);
  equal(parseStepsToSimple(steps)?.hold.flow, 0);
  equal(canEditAsBasic(steps), true);
});

// `parse` rejects any step count != 3 up front, so the only way a non-simple
// profile could be mis-classified as basic is a 3-step one. Basic mode is about
// the *skeleton* — fast preinfuse that exits on rising pressure, fast hold,
// smooth decline — while pressure, flow and temperature are free per stage. So a
// 3-step profile whose skeleton matches opens basic even with mixed pumps; only
// shapes the knobs genuinely cannot express must open advanced.
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

run('accepts the basic skeleton even when the stages differ', () => {
  // f / p / f (Blue Willow): each stage picks its own pump
  const mixed = stepsOf(advanced([preinfuse(), press(9), flow(2, 'smooth')]));
  equal(canEditAsBasic(mixed), true);
  equal(parseStepsToSimple(mixed)?.hold.pump, 'pressure');
  equal(parseStepsToSimple(mixed)?.decline.pump, 'flow');

  // caps that differ stage to stage, including one on the preinfuse
  const capped = stepsOf(
    advanced([
      { ...preinfuse(), limiter: { value: 8, range: 0.6 } },
      { ...press(9), limiter: { value: 2, range: 0.6 } },
      { ...press(6, 'smooth'), limiter: { value: 4, range: 0.6 } }
    ])
  );
  equal(canEditAsBasic(capped), true);
  equal(parseStepsToSimple(capped)?.pre.pressure, 8);
  equal(parseStepsToSimple(capped)?.hold.flow, 2);
  equal(parseStepsToSimple(capped)?.decline.flow, 4);

  // temperatures that differ stage to stage
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
