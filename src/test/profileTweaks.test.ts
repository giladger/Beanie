import type { Profile } from '../api/types';
import { createProfileEditorState, profileFromEditorState } from '../components/profileEditor';
import type { EditorStep } from '../domain/profileModel';
import { compileSimpleToSteps, defaultSimpleKnobs, parseStepsToSimple } from '../domain/simpleProfile';
import {
  applyProfileTweak,
  baseProfileTitle,
  isDerekVariantTitle
} from '../domain/profileTweaks';
import type { DialInSuggestion } from '../domain/dialIn';

function suggestion(parameter: string, target: number): DialInSuggestion {
  return { kind: 'profile', parameter, direction: null, current: null, target, unit: null, why: 'test' };
}

function profileWithSteps(title: string, steps: EditorStep[]): Profile {
  return profileFromEditorState({ ...createProfileEditorState(null), title, steps });
}

function simplePressureProfile(title = 'Best Practice'): Profile {
  const knobs = { ...defaultSimpleKnobs('pressure'), preTime: 20, preFlow: 4, mainTarget: 8.6 };
  return profileWithSteps(title, compileSimpleToSteps(knobs, 'pressure'));
}

function advancedStep(patch: Partial<EditorStep>): EditorStep {
  return {
    name: 'step',
    temperature: 92,
    sensor: 'coffee',
    pump: 'pressure',
    pressure: 0,
    flow: 0,
    transition: 'fast',
    seconds: 10,
    volume: 0,
    weight: 100, // a per-step weight target disqualifies the simple parser
    exit: null,
    limiter: null,
    extra: {},
    ...patch
  };
}

run('simple profile: preinfusion_time tweak edits the knob and retitles', () => {
  const result = applyProfileTweak(simplePressureProfile(), suggestion('preinfusion_time', 30));
  if (!result) throw new Error('expected a tweak');
  equal(result.baseTitle, 'Best Practice');
  equal(result.profile.title, 'Best Practice · derek: preinfusion 30s');
  equal(result.summary, 'Preinfusion time 20s → 30s');
  const state = createProfileEditorState(result.profile);
  const parsed = parseStepsToSimple(state.steps);
  equal(parsed?.knobs.preTime, 30);
  // The single-parameter promise: nothing else moved.
  equal(parsed?.knobs.mainTarget, 8.6);
  equal(parsed?.knobs.preFlow, 4);
});

run('simple pressure profile: peak_pressure tweak edits the hold target', () => {
  const result = applyProfileTweak(simplePressureProfile(), suggestion('peak_pressure', 7));
  if (!result) throw new Error('expected a tweak');
  equal(result.summary, 'Peak pressure 8.6 bar → 7 bar');
  const parsed = parseStepsToSimple(createProfileEditorState(result.profile).steps);
  equal(parsed?.knobs.mainTarget, 7);
});

run('simple flow profile: peak_pressure adjusts an existing pressure limiter only', () => {
  const withLimiter = { ...defaultSimpleKnobs('flow'), limit: 8.4 };
  const limited = profileWithSteps('Flow', compileSimpleToSteps(withLimiter, 'flow'));
  const result = applyProfileTweak(limited, suggestion('peak_pressure', 7.5));
  if (!result) throw new Error('expected a tweak');
  const parsed = parseStepsToSimple(createProfileEditorState(result.profile).steps);
  equal(parsed?.knobs.limit, 7.5);

  const uncapped = profileWithSteps('Flow', compileSimpleToSteps(defaultSimpleKnobs('flow'), 'flow'));
  equal(applyProfileTweak(uncapped, suggestion('peak_pressure', 7.5)), null);
});

run('advanced profile: peak_pressure moves every step holding the old peak', () => {
  const profile = profileWithSteps('Adv', [
    advancedStep({ name: 'fill', pump: 'flow', flow: 4, pressure: 0 }),
    advancedStep({ name: 'ramp', pressure: 8.6 }),
    advancedStep({ name: 'hold', pressure: 8.6 }),
    advancedStep({ name: 'decline', pressure: 6 })
  ]);
  const result = applyProfileTweak(profile, suggestion('peak_pressure', 7));
  if (!result) throw new Error('expected a tweak');
  const steps = createProfileEditorState(result.profile).steps;
  equal(steps[1]!.pressure, 7);
  equal(steps[2]!.pressure, 7);
  equal(steps[3]!.pressure, 6); // below-peak step untouched
  equal(steps[0]!.flow, 4);
});

run('advanced profile: preinfusion tweaks need exactly one matching step', () => {
  const single = profileWithSteps('Adv', [
    advancedStep({ name: 'preinfusion', pump: 'flow', flow: 4, seconds: 8 }),
    advancedStep({ name: 'hold', pressure: 9 })
  ]);
  const result = applyProfileTweak(single, suggestion('preinfusion_time', 13));
  if (!result) throw new Error('expected a tweak');
  equal(createProfileEditorState(result.profile).steps[0]!.seconds, 13);

  const ambiguous = profileWithSteps('Adv', [
    advancedStep({ name: 'fill', pump: 'flow', flow: 4 }),
    advancedStep({ name: 'soak', pump: 'flow', flow: 0.5 }),
    advancedStep({ name: 'hold', pressure: 9 })
  ]);
  equal(applyProfileTweak(ambiguous, suggestion('preinfusion_time', 13)), null);
});

run('advanced profile: preinfusion_flow requires a flow-pumped preinfusion step', () => {
  const pressurePre = profileWithSteps('Adv', [
    advancedStep({ name: 'preinfusion', pump: 'pressure', pressure: 3, seconds: 8 }),
    advancedStep({ name: 'hold', pressure: 9 })
  ]);
  equal(applyProfileTweak(pressurePre, suggestion('preinfusion_flow', 3)), null);
});

run('targets are clamped to machine ranges', () => {
  const result = applyProfileTweak(simplePressureProfile(), suggestion('preinfusion_time', 500));
  if (!result) throw new Error('expected a tweak');
  const parsed = parseStepsToSimple(createProfileEditorState(result.profile).steps);
  equal(parsed?.knobs.preTime, 60);
});

run('a no-op tweak produces no variant', () => {
  equal(applyProfileTweak(simplePressureProfile(), suggestion('peak_pressure', 8.6)), null);
});

run('re-tweaking a Derek variant does not chain title suffixes', () => {
  const first = applyProfileTweak(simplePressureProfile(), suggestion('preinfusion_time', 30));
  if (!first) throw new Error('expected a tweak');
  const second = applyProfileTweak(first.profile, suggestion('preinfusion_time', 25));
  if (!second) throw new Error('expected a tweak');
  equal(second.profile.title, 'Best Practice · derek: preinfusion 25s');
  equal(second.baseTitle, 'Best Practice');
});

run('non-tweakable suggestions and string targets are rejected safely', () => {
  equal(applyProfileTweak(simplePressureProfile(), suggestion('grind', 14)), null);
  const textTarget: DialInSuggestion = {
    kind: 'profile',
    parameter: 'peak_pressure',
    direction: null,
    current: null,
    target: 'lower',
    unit: null,
    why: ''
  };
  equal(applyProfileTweak(simplePressureProfile(), textTarget), null);
});

run('variant helpers recognize and strip the Derek suffix', () => {
  equal(isDerekVariantTitle('Best Practice · derek: peak 7 bar'), true);
  equal(isDerekVariantTitle('Best Practice'), false);
  equal(baseProfileTitle('Best Practice · derek: peak 7 bar'), 'Best Practice');
  equal(baseProfileTitle('Plain'), 'Plain');
});

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
