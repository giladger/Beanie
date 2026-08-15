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
// A simple profile chases ONE axis, the way de1app's own simple editor does:
// settings_2a is a pressure profile, settings_2b is a flow profile, and neither
// offers per-stage pumps. So the shape a profile must have to be simple is:
//   1. preinfuse — always FLOW-pumped, fast, exits when pressure rises over a
//                  threshold (identical on both de1app pages)
//   2. hold      — fast, on the profile's axis
//   3. decline   — smooth, on the profile's axis
// plus one profile-level cap on the *other* axis ("Limit flow" on a pressure
// profile, "Limit pressure" on a flow profile), which de1app applies to hold and
// decline and never to preinfusion. Temperature stays per stage — de1app can do
// that too (espresso_temperature_steps_enabled) and it costs nothing here.

import { FIELD_SPECS, type EditorStep } from './profileModel';

export type SimpleType = 'pressure' | 'flow';
export type SimpleStageId = 'pre' | 'hold' | 'decline';

/**
 * The kind a new profile is created as — the one choice de1app's "New Preset —
 * what kind of preset?" page asks for, and the only point a profile's kind is
 * ever chosen. Pressure and flow seed the canonical three-stage simple shape;
 * advanced seeds a single step to build on. Afterwards a profile's steps are
 * what say which kind it is (`canEditAsBasic`), because reaprime stores no type.
 */
export type NewProfileKind = SimpleType | 'advanced';

export const SIMPLE_STAGE_IDS: readonly SimpleStageId[] = ['pre', 'hold', 'decline'];

/**
 * One main stage of a simple profile. It carries only its target on the
 * profile's own axis — there is no per-stage pump, because de1app's simple
 * editor has none: a pressure profile's stages chase pressure and a flow
 * profile's chase flow.
 */
export interface SimpleStage {
  name: string;
  seconds: number;
  temperature: number;
  /** The value on the profile's axis: bar on a pressure profile, ml/s on a flow one. */
  target: number;
}

/** Preinfusion, which is flow-pumped on both de1app simple pages. */
export interface SimplePreStage {
  name: string;
  seconds: number;
  temperature: number;
  flow: number;
}

export interface SimpleKnobs {
  /** Which axis the two main stages chase — the profile's kind. */
  type: SimpleType;
  pre: SimplePreStage;
  /** Preinfusion's "move on once pressure is over this" exit. */
  preExitPressure: number;
  hold: SimpleStage;
  decline: SimpleStage;
  /**
   * One cap on the axis the profile is NOT chasing — de1app's "Limit flow" on a
   * pressure profile, "Limit pressure" on a flow profile. It applies to hold and
   * decline (never preinfusion, which is flow-pumped either way). 0 means off.
   */
  limit: number;
  /** Range of that cap; only meaningful while it is > 0. */
  limitRange: number;
}

/** The axis a simple profile's cap sits on — always the one it isn't chasing. */
export function simpleLimitAxis(type: SimpleType): SimpleType {
  return type === 'pressure' ? 'flow' : 'pressure';
}

/** The canonical target for a main stage on a given axis. */
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
    type,
    pre: {
      name: 'preinfusion',
      seconds: FIELD_SPECS.preinfusionTime.default,
      temperature: FIELD_SPECS.stepTemperature.default,
      flow: defaultStageTarget('pre', 'flow')
    },
    preExitPressure: FIELD_SPECS.preinfusionStopPressure.default,
    hold: {
      name: type === 'pressure' ? 'rise and hold' : 'hold',
      seconds: 25,
      temperature: FIELD_SPECS.stepTemperature.default,
      target: defaultStageTarget('hold', type)
    },
    decline: {
      name: 'decline',
      seconds: FIELD_SPECS.declineTime.default,
      temperature: FIELD_SPECS.stepTemperature.default,
      target: defaultStageTarget('decline', type)
    },
    // A fresh profile carries no cap it never asked for.
    limit: 0,
    limitRange: FIELD_SPECS.limiterRange.default
  };
}

/**
 * Compile the knobs to canonical steps: preinfuse (flow-pumped, fast,
 * pressure-over exit), hold (fast) and decline (smooth). The profile-level cap
 * becomes hold's and decline's limiter, exactly where de1app's
 * pressure_to_advanced_list puts `maximum_flow` — and nowhere else.
 */
export function compileSimpleToSteps(knobs: SimpleKnobs): EditorStep[] {
  const limiter = knobs.limit > 0 ? { value: knobs.limit, range: knobs.limitRange } : null;
  return [
    {
      ...baseStep(knobs.pre.name, knobs.pre.seconds, knobs.pre.temperature),
      pump: 'flow',
      flow: knobs.pre.flow,
      transition: 'fast',
      exit: { type: 'pressure', condition: 'over', value: knobs.preExitPressure }
    },
    compileMainStage(knobs, knobs.hold, 'fast', limiter),
    compileMainStage(knobs, knobs.decline, 'smooth', limiter)
  ];
}

function baseStep(name: string, seconds: number, temperature: number): EditorStep {
  return {
    name,
    temperature,
    sensor: 'coffee',
    pump: 'pressure',
    pressure: 0,
    flow: 0,
    transition: 'fast',
    seconds,
    volume: 0,
    weight: 0,
    exit: null,
    limiter: null,
    extra: {}
  };
}

function compileMainStage(
  knobs: SimpleKnobs,
  stage: SimpleStage,
  transition: 'fast' | 'smooth',
  limiter: { value: number; range: number } | null
): EditorStep {
  return {
    ...baseStep(stage.name, stage.seconds, stage.temperature),
    pump: knobs.type,
    pressure: knobs.type === 'pressure' ? stage.target : 0,
    flow: knobs.type === 'flow' ? stage.target : 0,
    transition,
    limiter: limiter ? { ...limiter } : null
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

  // One axis for the whole profile, preinfused on flow, and a single cap shared
  // by hold and decline — anything else is an advanced profile.
  if (pre.pump !== 'flow' || pre.limiter) return null;
  if (hold.pump !== decline.pump) return null;
  const type: SimpleType = hold.pump === 'flow' ? 'flow' : 'pressure';
  const limit = hold.limiter?.value ?? 0;
  const limitRange = hold.limiter?.range ?? FIELD_SPECS.limiterRange.default;
  if ((decline.limiter?.value ?? 0) !== limit) return null;
  if (limit > 0 && (decline.limiter?.range ?? 0) !== limitRange) return null;

  return {
    type,
    pre: {
      name: pre.name,
      seconds: pre.seconds,
      temperature: pre.temperature,
      flow: pre.flow
    },
    preExitPressure: pre.exit.value,
    hold: parseMainStage(hold, type),
    decline: parseMainStage(decline, type),
    limit,
    limitRange
  };
}

function parseMainStage(step: EditorStep, type: SimpleType): SimpleStage {
  return {
    name: step.name,
    seconds: step.seconds,
    temperature: step.temperature,
    target: type === 'pressure' ? step.pressure : step.flow
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

// A step's identity for guard comparison. Only the value on the step's own axis
// counts: the off-axis one never reaches the machine and reaprime doesn't
// serialize it, so it must not affect the decision.
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
