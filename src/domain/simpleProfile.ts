// Phase 2 — the simple ⇄ advanced engine for the profile editor.
//
// reaprime stores every profile as a flat `steps[]` list (the "advanced" form);
// it does not persist the de1app simple-editor scalars or a profile "type". So
// the simple (basic) editor is a *derived view*: we COMPILE a small set of
// knobs down to canonical steps, and PARSE canonical steps back to knobs.
// Nothing is stored — which means another client's step edits can never leave a
// stale copy behind (see docs/profile-editor-carbon-copy-plan.md §2).
//
// `canEditAsBasic(steps)` is the lossless guard that decides whether a profile
// opens in the basic editor: it holds iff `compile(parse(steps))` reproduces the
// steps. A profile that merely looks simple but carries anything the basic knobs
// can't express fails the guard and opens in the advanced editor instead.
//
// The knobs are per stage (Insight-style): each of the three stages carries its
// own pump, temperature, pressure and flow. Whichever axis the pump follows is
// that stage's target; the other axis is its optional cap (0 = off). So the
// basic shape a profile must have is only about its *skeleton* —
//   1. preinfuse — fast, exits when pressure rises over a threshold
//   2. hold      — fast
//   3. decline   — smooth
// — and pressure/flow/temperature are free to differ stage by stage.

import { FIELD_SPECS, type EditorStep } from './profileModel';

export type SimpleType = 'pressure' | 'flow';
export type SimpleStageId = 'pre' | 'hold' | 'decline';

export const SIMPLE_STAGE_IDS: readonly SimpleStageId[] = ['pre', 'hold', 'decline'];

/**
 * One stage of a basic profile. `pressure` and `flow` are both always carried:
 * the one matching `pump` is the target the machine chases, the other is that
 * stage's cap (limiter), with 0 meaning "no cap". Flipping `pump` therefore
 * only changes which of the two numbers is the target — nothing is lost.
 */
export interface SimpleStage {
  name: string;
  pump: SimpleType;
  seconds: number;
  temperature: number;
  pressure: number;
  flow: number;
  /** Range of this stage's cap; only meaningful while the cap is > 0. */
  limitRange: number;
}

export interface SimpleKnobs {
  pre: SimpleStage;
  /** Preinfusion's "move on once pressure is over this" exit. */
  preExitPressure: number;
  hold: SimpleStage;
  decline: SimpleStage;
}

/**
 * The profile-level `type` these knobs describe, for `legacy_profile_type` and
 * the de1app editor tab. Preinfusion is excluded — de1app's own simple pressure
 * profile (settings_2a) preinfuses on flow — so the kind follows the two main
 * stages, and only a genuine mix reads as "advanced".
 */
export function simpleProfileType(knobs: SimpleKnobs): string {
  return knobs.hold.pump === knobs.decline.pump ? knobs.hold.pump : 'advanced';
}

/** The canonical target for a stage once its pump switches axis. */
export function defaultStageTarget(stage: SimpleStageId, pump: SimpleType): number {
  if (pump === 'pressure') {
    if (stage === 'pre') return FIELD_SPECS.preinfusionStopPressure.default;
    if (stage === 'hold') return FIELD_SPECS.espressoPressure.default;
    return FIELD_SPECS.pressureEnd.default;
  }
  if (stage === 'pre') return FIELD_SPECS.preinfusionFlow.default;
  if (stage === 'hold') return 2;
  return 1.2;
}

export function defaultSimpleKnobs(type: SimpleType): SimpleKnobs {
  return {
    pre: defaultStage('preinfusion', 'pre', 'flow', FIELD_SPECS.preinfusionTime.default),
    preExitPressure: FIELD_SPECS.preinfusionStopPressure.default,
    hold: defaultStage(type === 'pressure' ? 'rise and hold' : 'hold', 'hold', type, 25),
    decline: defaultStage('decline', 'decline', type, FIELD_SPECS.declineTime.default)
  };
}

function defaultStage(
  name: string,
  id: SimpleStageId,
  pump: SimpleType,
  seconds: number
): SimpleStage {
  const target = defaultStageTarget(id, pump);
  return {
    name,
    pump,
    seconds,
    temperature: FIELD_SPECS.stepTemperature.default,
    // The off-axis starts at 0 so a fresh profile carries no cap it never asked for.
    pressure: pump === 'pressure' ? target : 0,
    flow: pump === 'flow' ? target : 0,
    limitRange: FIELD_SPECS.limiterRange.default
  };
}

/**
 * Compile the knobs to canonical steps: preinfuse (fast, pressure-over exit),
 * hold (fast) and decline (smooth). Each stage's off-axis value becomes its
 * limiter, matching de1app's "max flow or pressure" behaviour per step.
 */
export function compileSimpleToSteps(knobs: SimpleKnobs): EditorStep[] {
  const pre = compileStage(knobs.pre, 'fast');
  pre.exit = { type: 'pressure', condition: 'over', value: knobs.preExitPressure };
  return [pre, compileStage(knobs.hold, 'fast'), compileStage(knobs.decline, 'smooth')];
}

function compileStage(stage: SimpleStage, transition: 'fast' | 'smooth'): EditorStep {
  const cap = stage.pump === 'pressure' ? stage.flow : stage.pressure;
  return {
    name: stage.name,
    temperature: stage.temperature,
    sensor: 'coffee',
    pump: stage.pump,
    pressure: stage.pump === 'pressure' ? stage.pressure : 0,
    flow: stage.pump === 'flow' ? stage.flow : 0,
    transition,
    seconds: stage.seconds,
    volume: 0,
    weight: 0,
    exit: null,
    limiter: cap > 0 ? { value: cap, range: stage.limitRange } : null,
    extra: {}
  };
}

/** Parse canonical simple steps back to knobs, or null if they aren't canonical. */
export function parseStepsToSimple(steps: EditorStep[]): SimpleKnobs | null {
  if (steps.length !== 3) return null;
  const [pre, hold, decline] = steps as [EditorStep, EditorStep, EditorStep];

  // Anything the basic knobs can't express disqualifies the whole profile.
  for (const step of steps) {
    if (Object.keys(step.extra).length > 0) return null;
    if (step.volume !== 0 || step.weight !== 0) return null;
    if (step.sensor !== 'coffee') return null;
  }

  // The skeleton: fast preinfuse that exits on rising pressure, fast hold,
  // smooth decline, and no other exit conditions.
  if (pre.transition !== 'fast' || hold.transition !== 'fast' || decline.transition !== 'smooth') {
    return null;
  }
  if (!pre.exit || pre.exit.type !== 'pressure' || pre.exit.condition !== 'over') return null;
  if (hold.exit || decline.exit) return null;

  return {
    pre: parseStage(pre),
    preExitPressure: pre.exit.value,
    hold: parseStage(hold),
    decline: parseStage(decline)
  };
}

function parseStage(step: EditorStep): SimpleStage {
  const pump: SimpleType = step.pump === 'flow' ? 'flow' : 'pressure';
  const cap = step.limiter?.value ?? 0;
  return {
    name: step.name,
    pump,
    seconds: step.seconds,
    temperature: step.temperature,
    pressure: pump === 'pressure' ? step.pressure : cap,
    flow: pump === 'flow' ? step.flow : cap,
    limitRange: step.limiter?.range ?? FIELD_SPECS.limiterRange.default
  };
}

/**
 * The lossless guard. Basic mode is offered iff the steps parse to knobs AND
 * recompiling those knobs reproduces the steps — so editing in basic mode can
 * never silently drop anything the steps carried.
 */
export function canEditAsBasic(steps: EditorStep[]): boolean {
  const knobs = parseStepsToSimple(steps);
  if (!knobs) return false;
  return stepsEquivalent(compileSimpleToSteps(knobs), steps);
}

function stepsEquivalent(a: EditorStep[], b: EditorStep[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((step, index) => stepSignature(step) === stepSignature(b[index]!));
}

// A step's identity for guard comparison. The off-axis value (pressure on a
// flow step, flow on a pressure step) is excluded — it never reaches the machine
// and reaprime doesn't serialize it, so it must not affect the decision.
function stepSignature(step: EditorStep): string {
  const primary = step.pump === 'pressure' ? step.pressure : step.flow;
  return JSON.stringify({
    name: step.name,
    pump: step.pump,
    primary: round(primary),
    temperature: round(step.temperature),
    sensor: step.sensor,
    transition: step.transition,
    seconds: round(step.seconds),
    volume: round(step.volume),
    weight: round(step.weight),
    exit: step.exit
      ? { type: step.exit.type, condition: step.exit.condition, value: round(step.exit.value) }
      : null,
    limiter: step.limiter ? { value: round(step.limiter.value), range: round(step.limiter.range) } : null,
    extra: Object.keys(step.extra).sort()
  });
}

function round(value: number): number {
  return Number(value.toFixed(3));
}
