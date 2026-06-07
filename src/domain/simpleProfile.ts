// Phase 2 — the simple ⇄ advanced engine for the profile editor.
//
// reaprime stores every profile as a flat `steps[]` list (the "advanced" form);
// it does not persist the de1app simple-editor scalars or a profile "type". So
// the simple (pressure/flow) editor is a *derived view*: we COMPILE a small set
// of knobs down to canonical steps, and PARSE canonical steps back to knobs.
// Nothing is stored — which means another client's step edits can never leave a
// stale copy behind (see docs/profile-editor-carbon-copy-plan.md §2).
//
// `canEditAsBasic(steps)` is the lossless guard that decides whether a profile
// opens in the basic editor: it holds iff `compile(parse(steps))` reproduces the
// steps. A profile that merely looks simple but carries anything the basic knobs
// can't express fails the guard and opens in the advanced editor instead.

import { FIELD_SPECS, type EditorStep } from './profileModel';

export type SimpleType = 'pressure' | 'flow';

/**
 * The full set of knobs a de1app-style simple editor exposes. Step names are
 * carried (though the slider UI doesn't edit them) so a parse→compile round-trip
 * is byte-faithful regardless of how the steps were named.
 */
export interface SimpleKnobs {
  temperature: number;
  preName: string;
  preTime: number;
  preFlow: number;
  prePressure: number;
  mainName: string;
  mainTime: number;
  mainTarget: number;
  limit: number;
  limitRange: number;
  declineName: string;
  declineTime: number;
  declineTarget: number;
}

export interface ParsedSimple {
  type: SimpleType;
  knobs: SimpleKnobs;
}

export function defaultSimpleKnobs(type: SimpleType): SimpleKnobs {
  return {
    temperature: FIELD_SPECS.stepTemperature.default,
    preName: 'preinfusion',
    preTime: FIELD_SPECS.preinfusionTime.default,
    preFlow: FIELD_SPECS.preinfusionFlow.default,
    prePressure: FIELD_SPECS.preinfusionStopPressure.default,
    mainName: type === 'pressure' ? 'rise and hold' : 'hold',
    mainTime: 25,
    mainTarget: type === 'pressure' ? FIELD_SPECS.espressoPressure.default : 2,
    limit: 0,
    limitRange: FIELD_SPECS.limiterRange.default,
    declineName: 'decline',
    declineTime: FIELD_SPECS.declineTime.default,
    declineTarget: type === 'pressure' ? FIELD_SPECS.pressureEnd.default : 1.2
  };
}

/**
 * Canonical simple shape (Beanie's own clean, invertible decomposition):
 *   1. preinfuse — flow, fast, exit when pressure rises over `prePressure`
 *   2. hold      — `type` pump, fast, optional limiter
 *   3. decline   — `type` pump, smooth, same limiter as hold
 * The limiter caps the *other* axis (flow on a pressure profile, pressure on a
 * flow profile) across hold + decline, matching de1app behaviour.
 */
export function compileSimpleToSteps(knobs: SimpleKnobs, type: SimpleType): EditorStep[] {
  const limiter = knobs.limit > 0 ? { value: knobs.limit, range: knobs.limitRange } : null;

  const make = (
    name: string,
    pump: 'pressure' | 'flow',
    primary: number,
    transition: 'fast' | 'smooth',
    seconds: number
  ): EditorStep => ({
    name,
    temperature: knobs.temperature,
    sensor: 'coffee',
    pump,
    pressure: pump === 'pressure' ? primary : 0,
    flow: pump === 'flow' ? primary : 0,
    transition,
    seconds,
    volume: 0,
    weight: 0,
    exit: null,
    limiter: null,
    extra: {}
  });

  const pre = make(knobs.preName, 'flow', knobs.preFlow, 'fast', knobs.preTime);
  pre.exit = { type: 'pressure', condition: 'over', value: knobs.prePressure };

  const hold = make(knobs.mainName, type, knobs.mainTarget, 'fast', knobs.mainTime);
  hold.limiter = limiter ? { ...limiter } : null;

  const decline = make(knobs.declineName, type, knobs.declineTarget, 'smooth', knobs.declineTime);
  decline.limiter = limiter ? { ...limiter } : null;

  return [pre, hold, decline];
}

/** Parse canonical simple steps back to knobs, or null if they aren't canonical. */
export function parseStepsToSimple(steps: EditorStep[]): ParsedSimple | null {
  if (steps.length !== 3) return null;
  const [pre, hold, decline] = steps as [EditorStep, EditorStep, EditorStep];

  // Anything the basic knobs can't express disqualifies the whole profile.
  for (const step of steps) {
    if (Object.keys(step.extra).length > 0) return null;
    if (step.volume !== 0 || step.weight !== 0) return null;
    if (step.sensor !== 'coffee') return null;
  }
  if (pre.temperature !== hold.temperature || hold.temperature !== decline.temperature) return null;

  // 1. preinfuse: flow, fast, a single pressure-over exit, no limiter
  if (pre.pump !== 'flow' || pre.transition !== 'fast' || pre.limiter) return null;
  if (!pre.exit || pre.exit.type !== 'pressure' || pre.exit.condition !== 'over') return null;

  // 2+3. hold (fast) and decline (smooth) share one pump = the profile type
  const type: SimpleType = hold.pump === 'flow' ? 'flow' : 'pressure';
  if (hold.pump !== type || decline.pump !== type) return null;
  if (hold.transition !== 'fast' || decline.transition !== 'smooth') return null;
  if (hold.exit || decline.exit) return null;
  if (!limiterEqual(hold.limiter, decline.limiter)) return null;

  const target = (step: EditorStep): number => (type === 'pressure' ? step.pressure : step.flow);

  return {
    type,
    knobs: {
      temperature: pre.temperature,
      preName: pre.name,
      preTime: pre.seconds,
      preFlow: pre.flow,
      prePressure: pre.exit.value,
      mainName: hold.name,
      mainTime: hold.seconds,
      mainTarget: target(hold),
      limit: hold.limiter?.value ?? 0,
      limitRange: hold.limiter?.range ?? FIELD_SPECS.limiterRange.default,
      declineName: decline.name,
      declineTime: decline.seconds,
      declineTarget: target(decline)
    }
  };
}

/**
 * The lossless guard. Basic mode is offered iff the steps parse to knobs AND
 * recompiling those knobs reproduces the steps — so editing in basic mode can
 * never silently drop anything the steps carried.
 */
export function canEditAsBasic(steps: EditorStep[]): boolean {
  const parsed = parseStepsToSimple(steps);
  if (!parsed) return false;
  return stepsEquivalent(compileSimpleToSteps(parsed.knobs, parsed.type), steps);
}

function limiterEqual(
  a: EditorStep['limiter'],
  b: EditorStep['limiter']
): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return round(a.value) === round(b.value) && round(a.range) === round(b.range);
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
