import type { Profile } from '../api/types';
import {
  decodeProfile,
  encodeProfile,
  FIELD_SPECS,
  type EditorStep
} from './profileModel';
import {
  canEditAsBasic,
  compileSimpleToSteps,
  parseStepsToSimple,
  type SimpleKnobs
} from './simpleProfile';
import type { DialInSuggestion } from './dialIn';

// Turns an accepted profile-level Derek suggestion into a tweaked copy of the
// profile, deterministically. Two paths:
//
// - Profiles that pass `canEditAsBasic` (the lossless simple round-trip
//   guard) are edited at the KNOB level: parse → change one knob → compile.
// - Advanced profiles get a targeted step edit, but only when the knob can be
//   located unambiguously.
//
// Anything ambiguous returns null and the suggestion stays a manual card —
// this module never guess-edits a profile.

export type TweakableParameter = 'peak_pressure' | 'preinfusion_time' | 'preinfusion_flow';

export interface ProfileTweakResult {
  /** The tweaked profile, retitled as a Derek variant of the original. */
  profile: Profile;
  /** The original title with any previous Derek-variant suffix stripped. */
  baseTitle: string;
  /** Human summary, e.g. "Preinfusion time 8s → 13s". */
  summary: string;
}

const DEREK_SUFFIX = ' · derek: ';

export function applyProfileTweak(
  profile: Profile,
  suggestion: DialInSuggestion
): ProfileTweakResult | null {
  const parameter = tweakableParameter(suggestion);
  const target = numericTarget(suggestion);
  if (!parameter || target == null) return null;

  const model = decodeProfile(profile);
  const steps = model.steps;
  const tweaked = canEditAsBasic(steps)
    ? tweakSimpleSteps(steps, parameter, target)
    : tweakAdvancedSteps(steps, parameter, target);
  if (!tweaked) return null;
  // A tweak that lands on the current value would spawn a pointless variant.
  if (Math.abs(tweaked.current - tweaked.value) < 0.05) return null;

  const baseTitle = baseProfileTitle(model.title);
  const title = `${baseTitle}${DEREK_SUFFIX}${variantLabel(parameter, tweaked.value)}`;
  return {
    profile: encodeProfile({ ...model, steps: tweaked.steps, title }),
    baseTitle,
    summary: `${parameterLabel(parameter)} ${formatTweakValue(parameter, tweaked.current)} → ${formatTweakValue(parameter, tweaked.value)}`
  };
}

/** Whether accepting this suggestion can produce a tweaked profile at all. */
export function isProfileTweakable(profile: Profile | null, suggestion: DialInSuggestion): boolean {
  return profile != null && applyProfileTweak(profile, suggestion) != null;
}

export function baseProfileTitle(title: string): string {
  const at = title.indexOf(DEREK_SUFFIX);
  const base = at === -1 ? title : title.slice(0, at);
  return base.trim() || 'Profile';
}

/** True when the title marks a Beanie-made Derek variant. */
export function isDerekVariantTitle(title: string | null | undefined): boolean {
  return typeof title === 'string' && title.includes(DEREK_SUFFIX);
}

interface StepsTweak {
  steps: EditorStep[];
  current: number;
  value: number;
}

function tweakSimpleSteps(
  steps: EditorStep[],
  parameter: TweakableParameter,
  target: number
): StepsTweak | null {
  const knobs = parseStepsToSimple(steps);
  if (!knobs) return null;

  switch (parameter) {
    case 'peak_pressure': {
      // Either way the knob is the hold stage's `pressure`: its target when the
      // hold pumps pressure, otherwise its pressure ceiling. On a flow hold only
      // an existing ceiling moves — introducing one is more than a one-knob change.
      const pumpsPressure = knobs.hold.pump === 'pressure';
      const current = knobs.hold.pressure;
      if (!pumpsPressure && current <= 0) return null;
      const value = clamp(target, pumpsPressure ? FIELD_SPECS.stepPressure : FIELD_SPECS.limiterValue);
      const next: SimpleKnobs = { ...knobs, hold: { ...knobs.hold, pressure: value } };
      // A ceiling shared with the decline stage moves with it, so the pair stays coherent.
      if (!pumpsPressure && knobs.decline.pump === 'flow' && knobs.decline.pressure === current) {
        next.decline = { ...knobs.decline, pressure: value };
      }
      return { steps: compileSimpleToSteps(next), current, value };
    }
    case 'preinfusion_time': {
      const value = clamp(target, FIELD_SPECS.preinfusionTime);
      const current = knobs.pre.seconds;
      return {
        steps: compileSimpleToSteps({ ...knobs, pre: { ...knobs.pre, seconds: value } }),
        current,
        value
      };
    }
    case 'preinfusion_flow': {
      // Only meaningful while preinfusion pumps flow; otherwise its flow number
      // is a ceiling, not the rate Derek is asking about.
      if (knobs.pre.pump !== 'flow') return null;
      const value = clamp(target, FIELD_SPECS.preinfusionFlow);
      const current = knobs.pre.flow;
      return {
        steps: compileSimpleToSteps({ ...knobs, pre: { ...knobs.pre, flow: value } }),
        current,
        value
      };
    }
  }
}

const PREINFUSION_NAME = /pre.?inf|fill|soak|bloom/i;

function tweakAdvancedSteps(
  steps: EditorStep[],
  parameter: TweakableParameter,
  target: number
): StepsTweak | null {
  switch (parameter) {
    case 'peak_pressure': {
      const pressures = steps
        .filter((step) => step.pump === 'pressure' && step.pressure > 0)
        .map((step) => step.pressure);
      if (pressures.length === 0) return null;
      const peak = Math.max(...pressures);
      const value = clamp(target, FIELD_SPECS.stepPressure);
      // Every step holding the old peak moves together (a hold/decline pair
      // that starts at the same bar stays coherent).
      const next = steps.map((step) =>
        step.pump === 'pressure' && Math.abs(step.pressure - peak) < 0.05
          ? cloneStep(step, { pressure: value })
          : step
      );
      return { steps: next, current: peak, value };
    }
    case 'preinfusion_time': {
      const index = singlePreinfusionIndex(steps);
      if (index == null) return null;
      const value = clamp(target, FIELD_SPECS.stepSeconds);
      const current = steps[index]!.seconds;
      const next = steps.map((step, at) => (at === index ? cloneStep(step, { seconds: value }) : step));
      return { steps: next, current, value };
    }
    case 'preinfusion_flow': {
      const index = singlePreinfusionIndex(steps);
      if (index == null || steps[index]!.pump !== 'flow') return null;
      const value = clamp(target, FIELD_SPECS.stepFlow);
      const current = steps[index]!.flow;
      const next = steps.map((step, at) => (at === index ? cloneStep(step, { flow: value }) : step));
      return { steps: next, current, value };
    }
  }
}

// The preinfusion step, but only when the profile names exactly one — two
// "fill"/"soak" steps mean we can't know which one Derek means.
function singlePreinfusionIndex(steps: EditorStep[]): number | null {
  const matches = steps
    .map((step, index) => (PREINFUSION_NAME.test(step.name) ? index : -1))
    .filter((index) => index !== -1);
  return matches.length === 1 ? matches[0]! : null;
}

function cloneStep(step: EditorStep, patch: Partial<EditorStep>): EditorStep {
  return {
    ...step,
    ...patch,
    exit: step.exit ? { ...step.exit } : null,
    limiter: step.limiter ? { ...step.limiter } : null,
    extra: { ...step.extra }
  };
}

function tweakableParameter(suggestion: DialInSuggestion): TweakableParameter | null {
  return suggestion.parameter === 'peak_pressure' ||
    suggestion.parameter === 'preinfusion_time' ||
    suggestion.parameter === 'preinfusion_flow'
    ? suggestion.parameter
    : null;
}

function numericTarget(suggestion: DialInSuggestion): number | null {
  const target = suggestion.target;
  if (typeof target === 'number' && Number.isFinite(target)) return target;
  if (typeof target === 'string') {
    const parsed = Number(target);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function parameterLabel(parameter: TweakableParameter): string {
  switch (parameter) {
    case 'peak_pressure':
      return 'Peak pressure';
    case 'preinfusion_time':
      return 'Preinfusion time';
    case 'preinfusion_flow':
      return 'Preinfusion flow';
  }
}

function variantLabel(parameter: TweakableParameter, value: number): string {
  switch (parameter) {
    case 'peak_pressure':
      return `peak ${round1(value)} bar`;
    case 'preinfusion_time':
      return `preinfusion ${round1(value)}s`;
    case 'preinfusion_flow':
      return `pre-flow ${round1(value)} ml/s`;
  }
}

function formatTweakValue(parameter: TweakableParameter, value: number): string {
  switch (parameter) {
    case 'peak_pressure':
      return `${round1(value)} bar`;
    case 'preinfusion_time':
      return `${round1(value)}s`;
    case 'preinfusion_flow':
      return `${round1(value)} ml/s`;
  }
}

function clamp(value: number, spec: { min: number; max: number }): number {
  return round1(Math.min(spec.max, Math.max(spec.min, value)));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
