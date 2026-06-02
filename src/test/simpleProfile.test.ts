import type { Profile } from '../api/types';
import { createProfileEditorState } from '../components/profileEditor';
import type { EditorStep } from '../components/profileEditor';
import {
  canEditAsBasic,
  compileSimpleToSteps,
  defaultSimpleKnobs,
  parseStepsToSimple,
  type SimpleKnobs
} from '../domain/simpleProfile';

run('compiles a pressure simple profile to canonical steps', () => {
  const steps = compileSimpleToSteps(defaultSimpleKnobs('pressure'), 'pressure');
  equal(steps.length, 3);
  equal(steps[0]!.pump, 'flow');
  equal(steps[0]!.exit?.type, 'pressure');
  equal(steps[1]!.pump, 'pressure');
  equal(steps[1]!.transition, 'fast');
  equal(steps[2]!.pump, 'pressure');
  equal(steps[2]!.transition, 'smooth');
});

run('pressure knobs survive a compile → parse round-trip', () => {
  const knobs: SimpleKnobs = {
    ...defaultSimpleKnobs('pressure'),
    temperature: 92.5,
    preTime: 12,
    preFlow: 4.5,
    prePressure: 4,
    mainTime: 20,
    mainTarget: 8.6,
    limit: 2.4,
    declineTime: 28,
    declineTarget: 5.5
  };
  const steps = compileSimpleToSteps(knobs, 'pressure');
  equal(canEditAsBasic(steps), true);
  const parsed = parseStepsToSimple(steps);
  equal(parsed?.type, 'pressure');
  equalKnobs(parsed!.knobs, knobs);
});

run('flow knobs survive a compile → parse round-trip (limiter caps pressure)', () => {
  const knobs: SimpleKnobs = {
    ...defaultSimpleKnobs('flow'),
    mainTarget: 2.2,
    limit: 9, // pressure limit on a flow profile
    declineTarget: 1.2
  };
  const steps = compileSimpleToSteps(knobs, 'flow');
  equal(canEditAsBasic(steps), true);
  // limiter applied across hold + decline
  equal(steps[1]!.limiter?.value, 9);
  equal(steps[2]!.limiter?.value, 9);
  const parsed = parseStepsToSimple(steps);
  equal(parsed?.type, 'flow');
  equalKnobs(parsed!.knobs, knobs);
});

run('editing a knob recompiles and stays basic', () => {
  const knobs = { ...defaultSimpleKnobs('pressure'), mainTarget: 9, limit: 0 };
  let steps = compileSimpleToSteps(knobs, 'pressure');
  // simulate a slider edit: re-parse, mutate, recompile
  const next = { ...parseStepsToSimple(steps)!.knobs, mainTarget: 7.5, limit: 2.5 };
  steps = compileSimpleToSteps(next, 'pressure');
  equal(canEditAsBasic(steps), true);
  equal(parseStepsToSimple(steps)?.knobs.mainTarget, 7.5);
  equal(parseStepsToSimple(steps)?.knobs.limit, 2.5);
});

run('a profile with no limiter parses with limit 0 and round-trips', () => {
  const steps = compileSimpleToSteps({ ...defaultSimpleKnobs('pressure'), limit: 0 }, 'pressure');
  equal(steps[1]!.limiter, null);
  equal(parseStepsToSimple(steps)?.knobs.limit, 0);
  equal(canEditAsBasic(steps), true);
});

// `parse` rejects any step count != 3 up front, so the only way a non-simple
// profile could be mis-classified as basic is a 3-step one. These fixtures mirror
// every distinct 3-step shape in the reaprime default library (D-Flow, Damians_Q,
// the baselines, psph/rohan-soup, the Blue Willow tea) — all must open advanced.
run('rejects every advanced 3-step shape — opens advanced, never basic', () => {
  // ≠ 3 steps (e.g. rao_allonge n=2)
  equal(canEditAsBasic(stepsOf(advanced([flow(2), flow(2)]))), false);
  // p / p / f  (D-Flow, Damians_Q): preinfuse is pressure-pumped, not flow
  equal(canEditAsBasic(stepsOf(advanced([press(2), press(9), flow(2, 'smooth')]))), false);
  // f / p / f  (Blue Willow): hold and decline pumps disagree
  equal(canEditAsBasic(stepsOf(advanced([preinfuse(), press(9), flow(2, 'smooth')]))), false);
  // f / f / p-fast (baseline_hc/lc/mc): decline pump differs and isn't smooth
  equal(canEditAsBasic(stepsOf(advanced([preinfuse(), flow(2), press(6, 'fast')]))), false);
  // f / f / f all-fast (baseline_ulc): decline isn't smooth
  equal(canEditAsBasic(stepsOf(advanced([preinfuse(), flow(2), flow(1)]))), false);
  // psph/rohan-soup: a flow hold that carries its own exit condition
  equal(
    canEditAsBasic(
      stepsOf(advanced([preinfuse(), { ...flow(2), exit: { type: 'pressure', condition: 'over', value: 3 } }, flow(1, 'smooth')]))
    ),
    false
  );
  // preinfuse missing its pressure-over exit
  equal(canEditAsBasic(stepsOf(advanced([flow(4), press(9), press(6, 'smooth')]))), false);
  // preinfuse carrying a limiter (the basic preinfuse never does)
  equal(
    canEditAsBasic(stepsOf(advanced([{ ...preinfuse(), limiter: { value: 8, range: 0.6 } }, press(9), press(6, 'smooth')]))),
    false
  );
  // a water-sensor step
  equal(
    canEditAsBasic(stepsOf(advanced([{ ...preinfuse(), sensor: 'water' }, press(9), press(6, 'smooth')]))),
    false
  );
  // hold and decline limiters disagree
  equal(
    canEditAsBasic(
      stepsOf(
        advanced([
          preinfuse(),
          { ...press(9), limiter: { value: 8, range: 0.6 } },
          { ...press(6, 'smooth'), limiter: { value: 4, range: 0.6 } }
        ])
      )
    ),
    false
  );
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
  for (const key of Object.keys(expected) as (keyof SimpleKnobs)[]) {
    equal(actual[key] as unknown, expected[key] as unknown);
  }
}
