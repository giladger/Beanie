import type { Profile } from '../api/types';
import {
  canEditAsBasic,
  compileSimpleToSteps,
  defaultSimpleKnobs,
  parseStepsToSimple,
  simpleLimitAxis,
  type NewProfileKind,
  type SimpleKnobs,
  type SimpleType
} from '../domain/simpleProfile';
import {
  decodeProfile,
  defaultProfileStep,
  encodeProfile,
  FIELD_SPECS,
  legacyProfileTypeFromType,
  MAX_STEPS,
  PROFILE_BEVERAGE_TYPES,
  profileTypeFromLegacy,
  type EditorStep,
  type ProfileMetaKey,
  type ProfileModel,
  type StepExit,
  type StepExitCondition,
  type StepExitType,
  type StepFieldKey,
  type StepPump,
  type StepTransition
} from '../domain/profileModel';
import { buildProfileChartModel, type ChartPoint, type ProfileChartModel } from './profileChartModel';
import { escapeAttr, escapeHtml } from './html';
import { icon } from './icons';

export type EditorMode = 'basic' | 'advanced';
export type AdvancedTab = 'steps' | 'limits';

interface ChartPlot {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ProfileEditorState extends ProfileModel {
  selectedStep: number;
  /** Which editor surface is shown. Derived from `canEditAsBasic` on load; the user can toggle. */
  editorMode: EditorMode;
  /** Sub-tab within the advanced editor (de1app settings_2c / settings_2c2). */
  advancedTab: AdvancedTab;
  /**
   * Whether the profile differs from the one the editor was opened on — a
   * comparison, not a record of having been touched, so nudging a value up and
   * back down leaves nothing to save.
   */
  dirty: boolean;
  /** Signature of the profile as opened (or as last saved). See `touched`. */
  baseline: string;
  /**
   * Why the last save was refused, shown as a banner above the editor; null when
   * there is nothing to explain. Only failures get one — a save that worked is
   * reported by the Save button, and anything else the editor can simply show.
   */
  saveError: string | null;
}

const META_NUMBER_KEYS: ProfileMetaKey[] = [
  'tank_temperature',
  'target_weight',
  'target_volume',
  'target_volume_count_start'
];

type NumericStepField = Extract<
  StepFieldKey,
  'temperature' | 'pressure' | 'flow' | 'seconds' | 'volume' | 'weight' | 'limiter_value' | 'limiter_range'
>;

/**
 * Min/max bounds shared by the edit dialog (data-min/data-max) and the −/+
 * nudge buttons, so repeated nudges can't escape the range the dialog
 * enforces. Sourced from FIELD_SPECS where the dialog already matches it; the
 * rest mirror the bounds the advanced step detail has always rendered (which
 * deliberately differ from FIELD_SPECS in places, e.g. goal pressure shows a
 * 0–12 dial on screen).
 */
const STEP_FIELD_LIMITS: Record<NumericStepField, { min: number; max: number }> = {
  temperature: { min: 1, max: FIELD_SPECS.stepTemperature.max },
  pressure: { min: 0, max: 12 },
  flow: { min: 0, max: 12 },
  seconds: { min: FIELD_SPECS.stepSeconds.min, max: FIELD_SPECS.stepSeconds.max },
  volume: { min: 0, max: 1023 },
  weight: { min: 0, max: 1000 },
  limiter_value: { min: 0, max: 12 },
  limiter_range: { min: FIELD_SPECS.limiterRange.min, max: FIELD_SPECS.limiterRange.max }
};

function newProfileModel(kind: NewProfileKind): ProfileModel {
  const model = decodeProfile(null);
  if (kind === 'advanced') return model;
  return {
    ...model,
    type: kind,
    legacyProfileType: legacyProfileTypeFromType(kind),
    steps: compileSimpleToSteps(defaultSimpleKnobs(kind))
  };
}

/**
 * Open a profile in the editor. Which surface it gets is the profile's own
 * property, read off its steps and fixed for the session: a canonical
 * three-stage shape is a simple profile and opens in the simple editor,
 * anything else is an advanced one. There is no toggle — see `profileKindLabel`
 * for why the kind can't simply be stored and trusted.
 */
/**
 * Everything about a profile that a save would write: its identity, its limits
 * and how it pours. Deliberately not `selectedStep`, the open tab or which
 * surface is showing — looking at a different step is not an edit.
 *
 * Built field by field rather than by stringifying the model, so two states that
 * describe the same profile compare equal whatever order their keys ended up in.
 */
function profileEditorSignature(model: ProfileModel): string {
  return JSON.stringify({
    title: model.title,
    author: model.author,
    notes: model.notes,
    beverageType: model.beverageType,
    type: model.type,
    legacyProfileType: model.legacyProfileType,
    tankTemperature: model.tankTemperature,
    targetWeight: model.targetWeight,
    targetVolume: model.targetVolume,
    targetVolumeCountStart: model.targetVolumeCountStart,
    steps: model.steps.map((step) => ({
      name: step.name,
      temperature: step.temperature,
      sensor: step.sensor,
      pump: step.pump,
      pressure: step.pressure,
      flow: step.flow,
      transition: step.transition,
      seconds: step.seconds,
      volume: step.volume,
      weight: step.weight,
      exit: step.exit
        ? { type: step.exit.type, condition: step.exit.condition, value: step.exit.value }
        : null,
      limiter: step.limiter ? { value: step.limiter.value, range: step.limiter.range } : null,
      extra: Object.keys(step.extra).sort().map((key) => [key, step.extra[key]])
    }))
  });
}

/**
 * Stamp a changed editor state with whether it still matches what was opened.
 * Every reducer returns through here, so none of them can decide on its own that
 * an edit happened — the numbers decide.
 */
function touched(next: ProfileEditorState): ProfileEditorState {
  return { ...next, dirty: profileEditorSignature(next) !== next.baseline };
}

/**
 * Measure edits from the profile as it stands now rather than as it was built.
 * Needed wherever the editor is adjusted after it is created — the title a new
 * profile is given to keep it distinct is set that way, and without this the
 * state would sit there differing from its own baseline while reading clean.
 */
export function rebaseProfileEditor(state: ProfileEditorState): ProfileEditorState {
  return { ...state, baseline: profileEditorSignature(state), dirty: false };
}

export function createProfileEditorState(
  profile: Profile | null,
  newProfileKind: NewProfileKind = 'pressure'
): ProfileEditorState {
  const model = profile ? decodeProfile(profile) : newProfileModel(newProfileKind);
  return {
    ...model,
    selectedStep: 0,
    editorMode: canEditAsBasic(model.steps) ? 'basic' : 'advanced',
    advancedTab: 'steps',
    dirty: false,
    baseline: profileEditorSignature(model),
    saveError: null
  };
}

/**
 * Which kind of profile this is, for the editor header.
 *
 * A profile's kind is not stored anywhere: reaprime's `Profile` model has no
 * `type` field at all — `fromJson` drops one if we send it and `toJson` never
 * emits one — so the kind is read back off the steps every time (see
 * domain/simpleProfile.ts). That is the sturdier arrangement anyway: a stored
 * kind could be left lying by another client's step edits, while the steps can
 * only ever describe themselves.
 */
export function profileKindLabel(state: ProfileEditorState): string {
  if (state.editorMode === 'advanced') return 'Advanced profile';
  // In the simple editor the steps are known to parse, so the knobs' own axis is
  // the profile's kind — a surer source than `state.type`, which starts life
  // inferred from a profile JSON that carries no type at all.
  return simpleKnobsOf(state).type === 'flow' ? 'Flow profile' : 'Pressure profile';
}

export function setProfileMeta(
  state: ProfileEditorState,
  key: ProfileMetaKey,
  value: string
): ProfileEditorState {
  if (META_NUMBER_KEYS.includes(key)) {
    const parsed = parseNumber(value);
    const next: Partial<ProfileEditorState> =
      key === 'tank_temperature'
        ? { tankTemperature: parsed }
        : key === 'target_weight'
          ? { targetWeight: parsed }
          : key === 'target_volume'
            ? { targetVolume: parsed }
            : { targetVolumeCountStart: parsed };
    return touched({ ...state, ...next });
  }

  const next: Partial<ProfileEditorState> =
    key === 'title'
      ? { title: value }
      : key === 'author'
        ? { author: value }
        : key === 'notes'
          ? { notes: value }
          : key === 'beverage_type'
            ? { beverageType: value }
            : { legacyProfileType: value, type: profileTypeFromLegacy(value) };
  return touched({ ...state, ...next });
}

export function setStepField(
  state: ProfileEditorState,
  index: number,
  key: StepFieldKey,
  value: string
): ProfileEditorState {
  return updateStep(state, index, (step) => {
    switch (key) {
      case 'name':
        return { ...step, name: value };
      case 'popup': {
        // Clearing the message drops the key rather than storing an empty one,
        // so typing something and taking it out again leaves nothing behind.
        const extra = { ...step.extra };
        if (value) extra.popup = value;
        else delete extra.popup;
        return { ...step, extra };
      }
      case 'sensor':
        return { ...step, sensor: value === 'water' ? 'water' : 'coffee' };
      case 'temperature':
        return { ...step, temperature: parseNumber(value) ?? 0 };
      case 'pressure':
        return { ...step, pressure: parseNumber(value) ?? 0 };
      case 'flow':
        return { ...step, flow: parseNumber(value) ?? 0 };
      case 'seconds':
        return { ...step, seconds: parseNumber(value) ?? 0 };
      case 'volume':
        return { ...step, volume: parseNumber(value) ?? 0 };
      case 'weight':
        return { ...step, weight: parseNumber(value) ?? 0 };
      case 'limiter_value':
        return setStepLimiterValue(step, parseNumber(value) ?? 0);
      case 'limiter_range':
        return setStepLimiterRange(step, parseNumber(value) ?? 0);
      default:
        return step;
    }
  });
}

export function nudgeStepField(
  state: ProfileEditorState,
  index: number,
  key: StepFieldKey,
  delta: number
): ProfileEditorState {
  const step = state.steps[index];
  if (!step) return state;
  const current =
    key === 'temperature'
      ? step.temperature
      : key === 'pressure'
        ? step.pressure
        : key === 'flow'
          ? step.flow
          : key === 'seconds'
            ? step.seconds
            : key === 'volume'
              ? step.volume
              : key === 'weight'
                ? step.weight
                : key === 'limiter_value'
                  ? (step.limiter?.value ?? 0)
                  : key === 'limiter_range'
                    ? (step.limiter?.range ?? 0.6)
                    : null;
  if (current == null) return state;
  const { min, max } = STEP_FIELD_LIMITS[key as NumericStepField];
  return setStepField(state, index, key, String(clampNumber(current + delta, min, max)));
}

/**
 * Basic-editor field keys. A simple profile chases one axis, so its two main
 * stages expose a single `target` rather than a flow and a pressure; `limit` is
 * the one profile-level cap on the other axis, `pre_until` is preinfusion's
 * pressure exit, and `stop_volume` is the profile-level stop.
 */
export type SimpleProfileField =
  | 'pre_time'
  | 'pre_flow'
  | 'pre_temp'
  | 'pre_until'
  | 'hold_time'
  | 'hold_target'
  | 'hold_temp'
  | 'decline_time'
  | 'decline_target'
  | 'decline_temp'
  | 'limit'
  | 'stop_volume';

function simpleStateType(state: ProfileEditorState): SimpleType {
  return state.type === 'flow' ? 'flow' : 'pressure';
}

function simpleKnobsOf(state: ProfileEditorState): SimpleKnobs {
  return parseStepsToSimple(state.steps) ?? defaultSimpleKnobs(simpleStateType(state));
}

/**
 * Recompile the steps from knobs. Simple edits never poke at individual steps:
 * they read the current knobs out of the steps, change one, and recompile — so
 * the steps stay canonical and the guard that decides which editor a profile
 * opens in keeps holding (see domain/simpleProfile.ts).
 */
function withSimpleKnobs(state: ProfileEditorState, knobs: SimpleKnobs): ProfileEditorState {
  return touched({
    ...state,
    type: knobs.type,
    legacyProfileType: legacyProfileTypeFromType(knobs.type),
    steps: compileSimpleToSteps(knobs)
  });
}

export function setSimpleProfileField(
  state: ProfileEditorState,
  key: SimpleProfileField,
  value: string
): ProfileEditorState {
  const parsedValue = parseNumber(value) ?? 0;
  if (key === 'stop_volume') {
    return touched({ ...state, targetVolume: parsedValue });
  }
  const knobs = simpleKnobsOf(state);
  switch (key) {
    case 'pre_until':
      return withSimpleKnobs(state, { ...knobs, preExitPressure: parsedValue });
    case 'limit':
      return withSimpleKnobs(state, { ...knobs, limit: parsedValue });
    case 'pre_time':
      return withSimpleKnobs(state, { ...knobs, pre: { ...knobs.pre, seconds: parsedValue } });
    case 'pre_flow':
      return withSimpleKnobs(state, { ...knobs, pre: { ...knobs.pre, flow: parsedValue } });
    case 'pre_temp':
      return withSimpleKnobs(state, { ...knobs, pre: { ...knobs.pre, temperature: parsedValue } });
    default: {
      const stage = key.startsWith('hold_') ? 'hold' : 'decline';
      const prop = key.endsWith('_time') ? 'seconds' : key.endsWith('_temp') ? 'temperature' : 'target';
      return withSimpleKnobs(state, { ...knobs, [stage]: { ...knobs[stage], [prop]: parsedValue } });
    }
  }
}

export function nudgeSimpleProfileField(
  state: ProfileEditorState,
  key: SimpleProfileField,
  delta: number
): ProfileEditorState {
  const current = simpleFieldValue(state, key);
  if (current == null) return state;
  const { min, max } = simpleFieldLimits(key, simpleKnobsOf(state).type);
  return setSimpleProfileField(state, key, String(clampNumber(current + delta, min, max)));
}

function simpleFieldValue(state: ProfileEditorState, key: SimpleProfileField): number | null {
  if (key === 'stop_volume') return state.targetVolume ?? 0;
  const knobs = simpleKnobsOf(state);
  switch (key) {
    case 'pre_until':
      return knobs.preExitPressure;
    case 'limit':
      return knobs.limit;
    case 'pre_time':
      return knobs.pre.seconds;
    case 'pre_flow':
      return knobs.pre.flow;
    case 'pre_temp':
      return knobs.pre.temperature;
    default: {
      const stage = key.startsWith('hold_') ? knobs.hold : knobs.decline;
      if (key.endsWith('_time')) return stage.seconds;
      if (key.endsWith('_temp')) return stage.temperature;
      return stage.target;
    }
  }
}

/**
 * Dialog/nudge bounds for the basic editor. Pressure and flow keep their own
 * scale — 0–12 bar, 0–8 ml/s — so which bound a target or the cap gets depends
 * on the profile's axis. Shared by renderSimpleRow (data-min/data-max) and nudges.
 */
function simpleFieldLimits(
  key: SimpleProfileField,
  type: SimpleType
): { min: number; max: number } {
  const axisLimits = (axis: SimpleType) =>
    axis === 'flow' ? { min: 0, max: 8 } : { min: 0, max: 12 };
  if (key === 'stop_volume') return { min: 0, max: 100 };
  if (key === 'pre_until') return axisLimits('pressure');
  if (key === 'pre_flow') return axisLimits('flow');
  if (key === 'limit') return axisLimits(simpleLimitAxis(type));
  if (key.endsWith('_time')) return { min: 0, max: 60 };
  if (key.endsWith('_temp')) return { min: 1, max: 105 };
  return axisLimits(type);
}

/** Switch the Steps/Limits sub-tab in the advanced editor. */
export function setAdvancedTab(state: ProfileEditorState, tab: AdvancedTab): ProfileEditorState {
  return { ...state, advancedTab: tab };
}

/** de1app keeps one global limiter range; apply it to every step that has a limiter. */
export function setAllLimiterRanges(state: ProfileEditorState, range: number): ProfileEditorState {
  const clamped = Math.max(FIELD_SPECS.limiterRange.min, range);
  const steps = state.steps.map((step) =>
    step.limiter ? { ...step, limiter: { ...step.limiter, range: clamped } } : step
  );
  return touched({ ...state, steps });
}

export function currentLimiterRange(state: ProfileEditorState): number {
  return state.steps.find((step) => step.limiter && step.limiter.value > 0)?.limiter?.range
    ?? FIELD_SPECS.limiterRange.default;
}

export function setStepPump(state: ProfileEditorState, index: number, pump: StepPump): ProfileEditorState {
  return updateStep(state, index, (step) => ({ ...step, pump }));
}

export function setStepTransition(
  state: ProfileEditorState,
  index: number,
  transition: StepTransition
): ProfileEditorState {
  return updateStep(state, index, (step) => ({ ...step, transition }));
}

export function setStepExit(
  state: ProfileEditorState,
  index: number,
  partialExit: Partial<StepExit> | null
): ProfileEditorState {
  return updateStep(state, index, (step) => {
    if (partialExit === null) return { ...step, exit: null };
    const base: StepExit = step.exit ?? { type: 'pressure', condition: 'over', value: 0 };
    return {
      ...step,
      exit: {
        type: partialExit.type ?? base.type,
        condition: partialExit.condition ?? base.condition,
        value: partialExit.value ?? base.value
      }
    };
  });
}

export function duplicateStep(state: ProfileEditorState, index: number): ProfileEditorState {
  if (index < 0 || index >= state.steps.length) return state;
  if (state.steps.length >= MAX_STEPS) return state;
  const original = state.steps[index]!;
  const copy: EditorStep = {
    ...original,
    name: `${original.name || `Step ${index + 1}`} copy`,
    exit: original.exit ? { ...original.exit } : null,
    limiter: original.limiter ? { ...original.limiter } : null,
    extra: { ...original.extra }
  };
  const steps = [...state.steps.slice(0, index + 1), copy, ...state.steps.slice(index + 1)];
  return touched({ ...state, steps, selectedStep: index + 1 });
}

export function addStep(state: ProfileEditorState): ProfileEditorState {
  if (state.steps.length >= MAX_STEPS) return state;
  const selected = state.steps[state.selectedStep];
  const step = selected
    ? {
        ...selected,
        name: `${selected.name || `Step ${state.selectedStep + 1}`} copy`,
        exit: selected.exit ? { ...selected.exit } : null,
        limiter: selected.limiter ? { ...selected.limiter } : null,
        extra: { ...selected.extra }
      }
    : defaultProfileStep();
  const insertAt = clamp(state.selectedStep + 1, 0, state.steps.length);
  const steps = [...state.steps.slice(0, insertAt), step, ...state.steps.slice(insertAt)];
  return touched({ ...state, steps, selectedStep: insertAt });
}

export function removeStep(state: ProfileEditorState, index: number): ProfileEditorState {
  if (index < 0 || index >= state.steps.length) return state;
  if (state.steps.length <= 1) return state;
  const steps = state.steps.filter((_, i) => i !== index);
  const selectedStep = clamp(state.selectedStep > index ? state.selectedStep - 1 : state.selectedStep, 0, steps.length - 1);
  return touched({ ...state, steps, selectedStep });
}

export function moveStep(state: ProfileEditorState, index: number, dir: -1 | 1): ProfileEditorState {
  const target = index + dir;
  if (index < 0 || index >= state.steps.length) return state;
  if (target < 0 || target >= state.steps.length) return state;
  const steps = [...state.steps];
  const moved = steps[index];
  steps[index] = steps[target];
  steps[target] = moved;
  const selectedStep = state.selectedStep === index ? target : state.selectedStep === target ? index : state.selectedStep;
  return touched({ ...state, steps, selectedStep });
}

export function selectStep(state: ProfileEditorState, index: number): ProfileEditorState {
  if (index < 0 || index >= state.steps.length) return state;
  return { ...state, selectedStep: index };
}

export function profileFromEditorState(state: ProfileEditorState): Profile {
  return encodeProfile(state);
}

function renderSaveError(state: ProfileEditorState): string {
  if (!state.saveError) return '';
  return `
    <div class="pe-save-notice error" role="alert">
      <strong>Couldn't save profile</strong>
      <span>${escapeHtml(state.saveError)}</span>
    </div>`;
}

export function renderProfileEditor(state: ProfileEditorState): string {
  if (state.editorMode === 'basic') return `${renderSaveError(state)}${renderSimpleProfileEditor(state)}`;
  return `
    <div class="profile-editor">
      ${renderSaveError(state)}
      ${renderIdentityMeta(state)}
      ${renderAdvancedTabs(state)}
      ${state.advancedTab === 'limits'
        ? renderLimitsPanel(state)
        : `<div class="pe-main-grid">
            <section class="pe-left-rail">
              ${renderStepList(state)}
              ${renderProfileChart(state)}
            </section>
            ${renderStepDetail(state)}
          </div>`}
    </div>
  `;
}

/** The header's read-only "what this profile is" tag, where the toggle used to be. */
export function renderEditorKindTag(state: ProfileEditorState): string {
  return `<span class="pe-kind-tag">${escapeHtml(profileKindLabel(state))}</span>`;
}

function renderSimpleProfileEditor(state: ProfileEditorState): string {
  const knobs = simpleKnobsOf(state);
  return `
    <div class="profile-editor pe-basic">
      ${renderIdentityMeta(state)}
      <div class="pe-simple-chart">${renderDe1ExplanationChart(state)}</div>
      <div class="pe-simple-stages">
        ${renderPreinfuseStage(knobs)}
        ${renderMainStage(knobs, 'hold', `2 · ${knobs.type === 'flow' ? 'Hold' : 'Rise &amp; hold'}`)}
        ${renderMainStage(knobs, 'decline', '3 · Decline')}
        ${renderFinishStage(state)}
      </div>
    </div>
  `;
}

/**
 * Preinfusion is the same on both de1app simple pages: flow-pumped, for a time,
 * until pressure rises past a threshold. It carries no target on the profile's
 * axis and no cap.
 */
function renderPreinfuseStage(knobs: SimpleKnobs): string {
  return `
    <section class="pe-stage-col">
      <header class="pe-stage-head">
        <span class="pe-ctl-group-title">1 · Preinfuse</span>
      </header>
      <div class="pe-row-grid">
        ${renderSimpleRow('pre_time', 'time', knobs.pre.seconds, 's', 1, 'timer', 'time', knobs.type)}
        ${renderSimpleRow('pre_flow', 'flow', knobs.pre.flow, 'ml/s', 0.1, 'droplets', 'flow', knobs.type, { target: true })}
        ${renderSimpleRow('pre_until', 'until pressure', knobs.preExitPressure, 'bar', 0.1, 'arrow-up-to-line', 'pressure', knobs.type)}
        ${renderSimpleRow('pre_temp', 'temperature', knobs.pre.temperature, '°C', 0.5, 'thermometer', 'temp', knobs.type)}
      </div>
    </section>
  `;
}

/**
 * Hold and decline chase the profile's own axis — pressure on a pressure
 * profile, flow on a flow one, never a choice per stage. The single cap on the
 * other axis rides on the hold stage, where de1app puts "Limit flow".
 */
function renderMainStage(knobs: SimpleKnobs, id: 'hold' | 'decline', title: string): string {
  const stage = knobs[id];
  const isFlow = knobs.type === 'flow';
  const targetLabel = isFlow
    ? (id === 'decline' ? 'flow end' : 'flow')
    : (id === 'decline' ? 'pressure end' : 'pressure');
  const capAxis = simpleLimitAxis(knobs.type);
  return `
    <section class="pe-stage-col">
      <header class="pe-stage-head">
        <span class="pe-ctl-group-title">${title}</span>
      </header>
      <div class="pe-row-grid">
        ${renderSimpleRow(`${id}_time` as SimpleProfileField, 'time', stage.seconds, 's', 1, 'timer', 'time', knobs.type)}
        ${renderSimpleRow(
          `${id}_target` as SimpleProfileField,
          targetLabel,
          stage.target,
          isFlow ? 'ml/s' : 'bar',
          0.1,
          isFlow ? 'droplets' : 'gauge',
          isFlow ? 'flow' : 'pressure',
          knobs.type,
          { target: true }
        )}
        ${id === 'hold'
          ? renderSimpleRow(
              'limit',
              capAxis === 'flow' ? 'limit flow' : 'limit pressure',
              knobs.limit,
              capAxis === 'flow' ? 'ml/s' : 'bar',
              0.1,
              capAxis === 'flow' ? 'droplets' : 'gauge',
              capAxis,
              knobs.type,
              { offWhenZero: true }
            )
          : ''}
        ${renderSimpleRow(`${id}_temp` as SimpleProfileField, 'temperature', stage.temperature, '°C', 0.5, 'thermometer', 'temp', knobs.type)}
      </div>
    </section>
  `;
}

function renderFinishStage(state: ProfileEditorState): string {
  return `
    <section class="pe-stage-col">
      <header class="pe-stage-head">
        <span class="pe-ctl-group-title">4 · Finish</span>
      </header>
      <div class="pe-row-grid">
        ${renderSimpleRow('stop_volume', 'stop at volume', state.targetVolume ?? 0, 'ml', 1, 'beaker', 'flow', simpleStateType(state), { offWhenZero: true })}
      </div>
    </section>
  `;
}

/**
 * A compact row control — icon, label, then −/value/+ — wired to the scalar
 * pe-simple-field / pe-simple-nudge actions (no per-step index). Rows rather
 * than the advanced editor's tall cards so a whole stage fits on a short tablet.
 */
function renderSimpleRow(
  key: SimpleProfileField,
  label: string,
  value: number,
  unit: string,
  step: number,
  iconName: string,
  tone: 'time' | 'flow' | 'pressure' | 'temp',
  type: SimpleType,
  options: { target?: boolean; offWhenZero?: boolean } = {}
): string {
  const { min, max } = simpleFieldLimits(key, type);
  const formatted = formatNumber(value);
  // An optional value reads "off" at zero; everything else shows its number.
  const display = options.offWhenZero && value <= 0
    ? '<span class="pe-ctl-off">off</span>'
    : `${escapeHtml(formatted)}${unit ? `<em>${escapeHtml(unit)}</em>` : ''}`;
  return `
    <div class="pe-row ${escapeAttr(tone)} ${options.target ? 'target' : ''}">
      <span class="pe-row-face">${icon(iconName)}</span>
      <span class="pe-row-label">${escapeHtml(label)}</span>
      <button type="button" class="pe-row-step" data-action="pe-simple-nudge" data-key="${key}" data-delta="${-step}" aria-label="decrease ${escapeAttr(label)}">${icon('minus')}</button>
      <button type="button" class="pe-row-value" data-action="pe-edit-value" data-target="simple-field" data-key="${key}" data-min="${min}" data-max="${max}" data-step="${step}" data-value="${escapeAttr(formatted)}" data-title="${escapeAttr(label)}" data-unit="${escapeAttr(unit)}" aria-label="edit ${escapeAttr(label)}">${display}</button>
      <button type="button" class="pe-row-step" data-action="pe-simple-nudge" data-key="${key}" data-delta="${step}" aria-label="increase ${escapeAttr(label)}">${icon('plus')}</button>
    </div>
  `;
}

function renderIdentityMeta(state: ProfileEditorState): string {
  return `
    <section class="pe-meta">
      <label class="pe-field pe-title-field">
        <span>Preset name</span>
        <input type="text" data-action="pe-meta" data-key="title" value="${escapeAttr(state.title)}" />
      </label>
      <label class="pe-field">
        <span>Author</span>
        <input type="text" data-action="pe-meta" data-key="author" value="${escapeAttr(state.author)}" />
      </label>
      <label class="pe-field">
        <span>Beverage</span>
        <select data-action="pe-meta" data-key="beverage_type">
          ${PROFILE_BEVERAGE_TYPES.map((type) => `
            <option value="${escapeAttr(type)}" ${type === state.beverageType ? 'selected' : ''}>${escapeHtml(displayType(type))}</option>
          `).join('')}
        </select>
      </label>
      <div class="pe-field pe-notes-field">
        <span>Notes</span>
        <button type="button" class="pe-notes-open" data-action="pe-edit-notes" aria-label="Edit notes">
          ${
            state.notes.trim()
              ? `<span class="pe-notes-preview">${escapeHtml(state.notes)}</span>`
              : `<span class="pe-notes-placeholder">Add notes…</span>`
          }
          <span class="pe-notes-open-icon">${icon('eye')}</span>
        </button>
      </div>
    </section>
  `;
}

function renderAdvancedTabs(state: ProfileEditorState): string {
  const tab = (id: AdvancedTab, label: string) =>
    `<button type="button" class="pe-subtab ${state.advancedTab === id ? 'active' : ''}" data-action="pe-advanced-tab" data-value="${id}">${label}</button>`;
  return `<div class="pe-subtabs" role="group" aria-label="Advanced editor section">${tab('steps', 'Steps')}${tab('limits', 'Limits')}</div>`;
}

function renderLimitsPanel(state: ProfileEditorState): string {
  const hasLimiter = state.steps.some((step) => step.limiter && step.limiter.value > 0);
  const range = currentLimiterRange(state);
  const field = (label: string, key: ProfileMetaKey, value: number | null, step: string, max: number, unit = '') => `
    <label class="pe-limit-field">
      <span>${escapeHtml(label)}</span>
      <button type="button" class="number-edit-button pe-limit-value" data-action="pe-edit-value" data-target="meta" data-key="${key}" data-min="0" data-max="${max}" data-step="${step}" data-value="${escapeAttr(numberText(value))}" data-title="${escapeAttr(label)}" data-unit="${escapeAttr(unit)}">${escapeHtml(numberText(value) || '--')}${unit ? `<em>${escapeHtml(unit)}</em>` : ''}</button>
    </label>`;
  return `
    <section class="pe-limits" aria-label="Profile limits">
      <div class="pe-limits-grid">
        ${field('Tank temperature °C', 'tank_temperature', state.tankTemperature, '1', FIELD_SPECS.tankTemperature.max, '°C')}
        ${field('Stop at weight (g)', 'target_weight', state.targetWeight, '0.1', FIELD_SPECS.targetWeight.max, 'g')}
        ${field('Stop at volume (ml)', 'target_volume', state.targetVolume, '1', FIELD_SPECS.targetVolume.max, 'ml')}
        ${field('Preinfusion ends after step', 'target_volume_count_start', state.targetVolumeCountStart, '1', FIELD_SPECS.targetVolumeCountStart.max)}
        <label class="pe-limit-field ${hasLimiter ? '' : 'disabled'}">
          <span>Limiter range</span>
          <button type="button" class="number-edit-button pe-limit-value" data-action="pe-edit-value" data-target="limiter-range" data-min="${FIELD_SPECS.limiterRange.min}" data-max="${FIELD_SPECS.limiterRange.max}" data-step="${FIELD_SPECS.limiterRange.step}" data-value="${escapeAttr(formatNumber(range))}" data-title="Limiter range" ${hasLimiter ? '' : 'disabled'}>${escapeHtml(formatNumber(range))}</button>
        </label>
      </div>
      <p class="pe-limits-hint">${hasLimiter
        ? 'Limiter range applies to every step that has a flow or pressure limit.'
        : 'No step has a limit set, so the limiter range is inactive.'}</p>
    </section>
  `;
}

function renderStepList(state: ProfileEditorState): string {
  const index = state.selectedStep;
  return `
    <section class="pe-steps">
      <div class="pe-steps-head">
        <h2>Steps</h2>
        <div class="pe-step-toolbar">
          <button type="button" data-action="pe-add-step" title="Add step">${icon('plus')}</button>
          <button type="button" data-action="pe-duplicate-step" data-index="${index}" aria-label="Duplicate selected step" title="Duplicate selected">${icon('copy')}</button>
          <button type="button" data-action="pe-move-step" data-index="${index}" data-value="-1" aria-label="Move selected step up" title="Move up">${icon('arrow-up')}</button>
          <button type="button" data-action="pe-move-step" data-index="${index}" data-value="1" aria-label="Move selected step down" title="Move down">${icon('arrow-down')}</button>
          <button type="button" data-action="pe-remove-step" data-index="${index}" aria-label="Remove selected step" title="Remove selected">${icon('x')}</button>
        </div>
      </div>
      <ol class="pe-step-list">
        ${state.steps.map((step, index) => renderStepRow(state, step, index)).join('')}
      </ol>
    </section>
  `;
}

function renderStepRow(state: ProfileEditorState, step: EditorStep, index: number): string {
  const target = step.pump === 'flow'
    ? `${formatNumber(step.flow)} ml/s`
    : `${formatNumber(step.pressure)} bar`;
  const limiter = step.limiter?.value ? `limit ${formatNumber(step.limiter.value)}` : 'no limit';
  return `
    <li class="pe-step-row ${index === state.selectedStep ? 'active' : ''}">
      <button type="button" class="pe-step-select" data-action="pe-select-step" data-index="${index}">
        <span class="pe-step-number">${index + 1}</span>
        <span class="pe-step-copy">
          <strong>${escapeHtml(step.name || `Step ${index + 1}`)}</strong>
          <small>${escapeHtml(step.pump)} ${escapeHtml(target)} · ${escapeHtml(formatNumber(step.temperature))} °C · ${escapeHtml(limiter)}</small>
        </span>
      </button>
    </li>
  `;
}

function renderStepDetail(state: ProfileEditorState): string {
  const index = state.selectedStep;
  const step = state.steps[index];
  if (!step) return '';
  const isFlow = step.pump === 'flow';
  return `
    <section class="pe-step-detail" data-index="${index}">
      <div class="pe-step-identity">
        <label class="pe-field">
          <span>Title</span>
          <input type="text" data-action="pe-step-field" data-index="${index}" data-key="name" value="${escapeAttr(step.name)}" />
        </label>
        <label class="pe-field">
          <span>Message</span>
          <input type="text" data-action="pe-step-field" data-index="${index}" data-key="popup" value="${escapeAttr(stringValue(step.extra.popup) ?? '')}" />
        </label>
      </div>
      <div class="pe-ctl-group">
        <span class="pe-ctl-group-title">Targets</span>
        <div class="pe-ctl-grid">
          ${renderVerticalControl(index, 'temperature', 'temperature', step.temperature, '°C', 0.5, 'thermometer', 'red')}
          ${renderToggleTile(index, 'sensor', 'sensor', step.sensor, step.sensor === 'water' ? 'droplets' : 'coffee')}
          ${renderGoalControl(index, 'flow', isFlow ? 'flow' : 'flow limit', isFlow ? step.flow : (step.limiter?.value ?? 0), 'ml/s', isFlow)}
          ${renderGoalControl(index, 'pressure', isFlow ? 'pressure limit' : 'pressure', isFlow ? (step.limiter?.value ?? 0) : step.pressure, 'bar', !isFlow)}
          ${step.limiter && step.limiter.value > 0
            ? renderVerticalControl(index, 'limiter_range', 'limit range', step.limiter.range, '', FIELD_SPECS.limiterRange.step, 'sliders-horizontal', 'stage')
            : ''}
          ${renderToggleTile(index, 'transition', 'transition', step.transition, step.transition === 'smooth' ? 'waves' : 'move-right')}
        </div>
      </div>
      <div class="pe-ctl-group">
        <span class="pe-ctl-group-title">Stop after</span>
        <div class="pe-ctl-grid">
          ${renderVerticalControl(index, 'seconds', 'time', step.seconds, 's', 1, 'timer', 'stage')}
          ${renderVerticalControl(index, 'volume', 'volume', step.volume, 'ml', 1, 'beaker', 'blue')}
          ${renderVerticalControl(index, 'weight', 'weight', step.weight, 'g', 0.1, 'scale', 'amber')}
        </div>
      </div>
      <div class="pe-ctl-group">
        <span class="pe-ctl-group-title">Move on if…</span>
        <div class="pe-ctl-grid">
          ${renderExitSlider(step, index, 'pressure', 'over')}
          ${renderExitSlider(step, index, 'pressure', 'under')}
          ${renderExitSlider(step, index, 'flow', 'over')}
          ${renderExitSlider(step, index, 'flow', 'under')}
        </div>
      </div>
    </section>
  `;
}

function renderGoalControl(
  index: number,
  pumpKey: StepPump,
  label: string,
  value: number,
  unit: string,
  active: boolean
): string {
  const field: NumericStepField = active ? pumpKey : 'limiter_value';
  return renderVerticalControl(index, field, label, value, unit, 0.1, pumpKey === 'flow' ? 'droplets' : 'gauge', pumpKey === 'flow' ? 'blue' : 'purple', {
    action: 'pe-step-pump',
    value: pumpKey,
    active
  });
}

function renderVerticalControl(
  index: number,
  key: NumericStepField,
  label: string,
  value: number,
  unit: string,
  step: number,
  iconName: string,
  tone: string,
  centerAction?: { action: string; value: string; active?: boolean }
): string {
  const { min, max } = STEP_FIELD_LIMITS[key];
  const formatted = formatNumber(value);
  const faceAttrs = centerAction
    ? `data-action="${centerAction.action}" data-index="${index}" data-value="${escapeAttr(centerAction.value)}"`
    : 'tabindex="-1"';
  return `
    <div class="pe-ctl ${escapeAttr(tone)} ${centerAction?.active ? 'active' : ''}">
      <button type="button" class="pe-ctl-face" ${faceAttrs} aria-label="${escapeAttr(label)}">${icon(iconName)}</button>
      <span class="pe-ctl-label">${escapeHtml(label)}</span>
      <div class="pe-ctl-stepper">
        <button type="button" class="pe-ctl-step" data-action="pe-step-nudge" data-index="${index}" data-key="${key}" data-delta="${-step}" aria-label="decrease ${escapeAttr(label)}">${icon('minus')}</button>
        <button type="button" class="pe-ctl-value" data-action="pe-edit-value" data-target="step-field" data-index="${index}" data-key="${key}" data-min="${min}" data-max="${max}" data-step="${step}" data-value="${escapeAttr(formatted)}" data-title="${escapeAttr(label)}" data-unit="${escapeAttr(unit)}" aria-label="edit ${escapeAttr(label)}">${escapeHtml(formatted)}${unit ? `<em>${escapeHtml(unit)}</em>` : ''}</button>
        <button type="button" class="pe-ctl-step" data-action="pe-step-nudge" data-index="${index}" data-key="${key}" data-delta="${step}" aria-label="increase ${escapeAttr(label)}">${icon('plus')}</button>
      </div>
    </div>
  `;
}

function renderToggleTile(
  index: number,
  type: 'sensor' | 'transition',
  label: string,
  value: string,
  iconName: string
): string {
  const action = type === 'sensor' ? 'pe-step-sensor-toggle' : 'pe-step-transition-toggle';
  return `
    <div class="pe-ctl toggle">
      <button type="button" class="pe-ctl-face" data-action="${action}" data-index="${index}" aria-label="${escapeAttr(label)}">${icon(iconName)}</button>
      <span class="pe-ctl-label">${escapeHtml(label)}</span>
      <strong class="pe-ctl-value">${escapeHtml(value)}</strong>
    </div>
  `;
}

function renderExitSlider(
  step: EditorStep,
  index: number,
  type: StepExitType,
  condition: StepExitCondition
): string {
  const active = step.exit?.type === type && step.exit.condition === condition;
  const value = active ? step.exit!.value : 0;
  const max = type === 'pressure' ? 12 : 8;
  const unit = type === 'pressure' ? 'bar' : 'ml/s';
  const label = `${type} is ${condition}`;
  const iconName = type === 'pressure'
    ? (condition === 'over' ? 'arrow-up-to-line' : 'arrow-down-to-line')
    : 'droplets';
  // The lit tile's face turns the condition back off. A step carries at most one
  // exit, so without this there is no way to remove one once set — and 0 is no
  // escape either, since "pressure over 0" fires the moment the step starts.
  const faceAttrs = active
    ? `data-action="pe-step-exit-clear" data-index="${index}" aria-label="${escapeAttr(`turn off ${label}`)}"`
    : `data-action="pe-step-exit-preset" data-index="${index}" data-type="${type}" data-condition="${condition}" data-value="${escapeAttr(formatNumber(value || defaultExitValue(type, condition)))}" aria-label="${escapeAttr(label)}"`;
  return `
    <div class="pe-ctl exit ${active ? 'active' : ''}">
      <button type="button" class="pe-ctl-face" ${faceAttrs}>${icon(iconName)}</button>
      <span class="pe-ctl-label">${escapeHtml(type)} <em>${escapeHtml(condition)}</em></span>
      <div class="pe-ctl-stepper">
        <button type="button" class="pe-ctl-step" data-action="pe-step-exit-nudge" data-index="${index}" data-type="${type}" data-condition="${condition}" data-delta="-0.1" aria-label="decrease ${escapeAttr(label)}">${icon('minus')}</button>
        <button type="button" class="pe-ctl-value" data-action="pe-edit-value" data-target="exit" data-index="${index}" data-type="${type}" data-condition="${condition}" data-min="0" data-max="${max}" data-step="0.1" data-value="${escapeAttr(formatNumber(value))}" data-title="${escapeAttr(label)}" data-unit="${escapeAttr(unit)}" aria-label="edit ${escapeAttr(label)}">${active ? `${escapeHtml(formatNumber(value))}<em>${escapeHtml(unit)}</em>` : '<span class="pe-ctl-off">off</span>'}</button>
        <button type="button" class="pe-ctl-step" data-action="pe-step-exit-nudge" data-index="${index}" data-type="${type}" data-condition="${condition}" data-delta="0.1" aria-label="increase ${escapeAttr(label)}">${icon('plus')}</button>
      </div>
    </div>
  `;
}

function renderProfileChart(state: ProfileEditorState): string {
  const width = 360;
  const height = 210;
  const plot: ChartPlot = { x: 18, y: 18, w: 324, h: 150 };
  const model = buildProfileChartModel(state.steps);
  const pressure = traceToPath(model.pressure, plot, model.totalSeconds, 12);
  const flow = traceToPath(model.flow, plot, model.totalSeconds, 12);
  const temp = traceToPath(model.temperature.map((p) => ({ t: p.t, v: p.v / 10 })), plot, model.totalSeconds, 12);
  return `
    <section class="pe-chart-panel" aria-label="Profile preview">
      <svg class="pe-profile-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Pressure, flow, and temperature profile">
        <rect class="pe-chart-bg" x="${plot.x}" y="${plot.y}" width="${plot.w}" height="${plot.h}" rx="4"></rect>
        ${[0, 0.25, 0.5, 0.75, 1].map((tick) => `
          <line class="pe-chart-grid" x1="${plot.x}" x2="${plot.x + plot.w}" y1="${plot.y + plot.h * tick}" y2="${plot.y + plot.h * tick}"></line>
        `).join('')}
        ${selectedStepBand(model, state.selectedStep, plot)}
        <path class="pe-chart-pressure" d="${pressure}" fill="none"></path>
        <path class="pe-chart-flow" d="${flow}" fill="none"></path>
        <path class="pe-chart-temp" d="${temp}" fill="none"></path>
        <text x="${plot.x}" y="${height - 16}" class="pe-chart-label">pressure</text>
        <text x="${plot.x + 74}" y="${height - 16}" class="pe-chart-label flow">flow</text>
        <text x="${plot.x + 126}" y="${height - 16}" class="pe-chart-label temp">temperature</text>
      </svg>
    </section>
  `;
}

/**
 * The basic editor's preview: pressure, flow and temperature on one de1app-style
 * 0–12 axis (temperature at ÷10, as the advanced chart does), so every stage's
 * three numbers are readable at a glance whichever axis it is pumping. A node
 * marks each stage's end on the axis that stage's pump follows.
 */
function renderDe1ExplanationChart(state: ProfileEditorState): string {
  // A wide, short viewBox: the svg scales to the panel width with `height: auto`,
  // so its aspect ratio *is* its on-screen height. Keeping that ratio close to the
  // box it lands in is what stops it letterboxing into the middle of the page.
  const width = 1188;
  const height = 190;
  const plot: ChartPlot = { x: 32, y: 8, w: 1136, h: 142 };
  const maxValue = 12;
  const model = buildProfileChartModel(state.steps);
  const pressure = traceToPath(model.pressure, plot, model.totalSeconds, maxValue);
  const flow = traceToPath(model.flow, plot, model.totalSeconds, maxValue);
  const temperature = traceToPath(
    model.temperature.map((point) => ({ t: point.t, v: point.v / 10 })),
    plot,
    model.totalSeconds,
    maxValue
  );
  const nodes = model.spans.map((span, index) => {
    const step = state.steps[index];
    const isFlow = step?.pump === 'flow';
    const value = step ? (isFlow ? step.flow : step.pressure) : 0;
    return {
      kind: isFlow ? 'flow' : 'pressure',
      x: plot.x + (span.end / model.totalSeconds) * plot.w,
      y: plot.y + plot.h - clamp01(value / maxValue) * plot.h
    };
  });
  const legend = (x: number, kind: string, label: string) =>
    `<text class="pe-de1-legend ${kind}" x="${x}" y="${height - 8}">${escapeHtml(label)}</text>`;
  return `
    <section class="pe-de1-chart-panel" aria-label="Profile preview">
      <svg class="pe-de1-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Pressure, flow, and temperature profile">
        <rect class="pe-de1-plot" x="${plot.x}" y="${plot.y}" width="${plot.w}" height="${plot.h}" rx="3"></rect>
        ${[0, 2, 4, 6, 8, 10, 12].map((tick) => {
          const y = plot.y + plot.h - clamp01(tick / maxValue) * plot.h;
          return `
            <line class="pe-de1-grid" x1="${plot.x}" x2="${plot.x + plot.w}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"></line>
            <text class="pe-de1-tick" x="${plot.x - 18}" y="${(y + 5).toFixed(1)}">${tick}</text>
          `;
        }).join('')}
        ${[0, 0.25, 0.5, 0.75, 1].map((tick) => {
          const x = plot.x + plot.w * tick;
          return `<line class="pe-de1-grid x" x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${plot.y}" y2="${plot.y + plot.h}"></line>`;
        }).join('')}
        <path class="pe-de1-main-line temp" d="${temperature}" fill="none"></path>
        <path class="pe-de1-main-line flow" d="${flow}" fill="none"></path>
        <path class="pe-de1-main-line pressure" d="${pressure}" fill="none"></path>
        ${nodes.map((point) => `
          <circle class="pe-de1-node ${point.kind}" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="6"></circle>
        `).join('')}
        ${legend(plot.x, 'pressure', 'pressure (bar)')}
        ${legend(plot.x + 190, 'flow', 'flow (ml/s)')}
        ${legend(plot.x + 360, 'temp', 'temperature (÷10 °C)')}
      </svg>
    </section>
  `;
}

// Map a model trace (time/value points) into an SVG path for the given plot box.
function traceToPath(points: ChartPoint[], plot: ChartPlot, totalSeconds: number, maxValue: number): string {
  return points
    .map((point, index) => {
      const x = plot.x + (point.t / totalSeconds) * plot.w;
      const y = plot.y + plot.h - clamp01(point.v / maxValue) * plot.h;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join('');
}

function selectedStepBand(model: ProfileChartModel, selectedStep: number, plot: ChartPlot): string {
  const span = model.spans[selectedStep];
  if (!span) return '';
  const x = plot.x + (span.start / model.totalSeconds) * plot.w;
  const width = Math.max(4, ((span.end - span.start) / model.totalSeconds) * plot.w);
  return `<rect class="pe-chart-selected" x="${x.toFixed(1)}" y="${plot.y}" width="${width.toFixed(1)}" height="${plot.h}"></rect>`;
}

function updateStep(
  state: ProfileEditorState,
  index: number,
  fn: (step: EditorStep) => EditorStep
): ProfileEditorState {
  if (index < 0 || index >= state.steps.length) return state;
  const steps = state.steps.map((step, i) => (i === index ? fn(step) : step));
  return touched({ ...state, steps });
}

function setStepLimiterValue(step: EditorStep, value: number): EditorStep {
  if (value <= 0) return { ...step, limiter: null };
  return {
    ...step,
    limiter: {
      value,
      range: step.limiter?.range ?? 0.6
    }
  };
}

function setStepLimiterRange(step: EditorStep, range: number): EditorStep {
  if (!step.limiter) return step;
  return { ...step, limiter: { ...step.limiter, range } };
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function parseNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number(value.toFixed(2))));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function numberText(value: number | null): string {
  return value == null ? '' : formatNumber(value);
}

function formatNumber(value: number): string {
  return value.toString();
}

function displayType(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function defaultExitValue(type: StepExitType, condition: StepExitCondition): number {
  if (type === 'pressure') return condition === 'over' ? 11 : 0;
  return condition === 'over' ? 6 : 0;
}
