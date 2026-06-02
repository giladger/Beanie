import type { Profile } from '../api/types';
import {
  canEditAsBasic,
  compileSimpleToSteps,
  defaultSimpleKnobs,
  parseStepsToSimple,
  type SimpleKnobs,
  type SimpleType
} from '../domain/simpleProfile';
import { buildProfileChartModel, type ChartPoint, type ProfileChartModel } from './profileChartModel';
import { icon } from './icons';

export type EditorMode = 'basic' | 'advanced';

interface ChartPlot {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type StepSensor = 'coffee' | 'water';
export type StepPump = 'pressure' | 'flow';
export type StepTransition = 'fast' | 'smooth';
export type StepExitType = 'pressure' | 'flow';
export type StepExitCondition = 'over' | 'under';

export interface StepExit {
  type: StepExitType;
  condition: StepExitCondition;
  value: number;
}

export interface StepLimiter {
  value: number;
  range: number;
}

export interface EditorStep {
  name: string;
  temperature: number;
  sensor: StepSensor;
  pump: StepPump;
  pressure: number;
  flow: number;
  transition: StepTransition;
  seconds: number;
  volume: number;
  weight: number;
  exit: StepExit | null;
  limiter: StepLimiter | null;
  extra: Record<string, unknown>;
}

export interface ProfileEditorState {
  title: string;
  author: string;
  notes: string;
  beverageType: string;
  type: string;
  legacyProfileType: string;
  tankTemperature: number | null;
  targetWeight: number | null;
  targetVolume: number | null;
  targetVolumeCountStart: number | null;
  version: string;
  steps: EditorStep[];
  selectedStep: number;
  /** Which editor surface is shown. Derived from `canEditAsBasic` on load; the user can toggle. */
  editorMode: EditorMode;
  dirty: boolean;
  extra: Record<string, unknown>;
}

export type ProfileMetaKey =
  | 'title'
  | 'author'
  | 'notes'
  | 'beverage_type'
  | 'type'
  | 'legacy_profile_type'
  | 'tank_temperature'
  | 'target_weight'
  | 'target_volume'
  | 'target_volume_count_start';

export type StepFieldKey =
  | 'name'
  | 'popup'
  | 'temperature'
  | 'sensor'
  | 'pressure'
  | 'flow'
  | 'seconds'
  | 'volume'
  | 'weight'
  | 'limiter_value'
  | 'limiter_range';

export const PROFILE_BEVERAGE_TYPES = [
  'espresso',
  'filter',
  'pour_over',
  'tea_portafilter',
  'cleaning',
  'calibrate',
  'manual'
] as const;

const META_NUMBER_KEYS: ProfileMetaKey[] = [
  'tank_temperature',
  'target_weight',
  'target_volume',
  'target_volume_count_start'
];

export const PROFILE_TYPES = ['advanced', 'pressure', 'flow'] as const;

// de1app caps advanced profiles at 20 steps.
export const MAX_STEPS = 20;

/**
 * Canonical field ranges, mirrored from de1app `machine.tcl` / `vars.tcl` so the
 * editor's limits match the Decent tablet exactly. Single source of truth for
 * min/max/step/default/unit — later phases (sliders, validation, the simple↔
 * advanced compiler) read from here instead of scattering magic numbers.
 */
export interface FieldSpec {
  min: number;
  max: number;
  step: number;
  default: number;
  unit: string;
}

export const FIELD_SPECS = {
  // Advanced step fields (settings_2c)
  stepTemperature: { min: -30, max: 105, step: 0.5, default: 90, unit: '°C' },
  stepPressure: { min: 0, max: 11, step: 0.1, default: 9, unit: 'bar' },
  stepFlow: { min: 0, max: 8, step: 0.1, default: 6, unit: 'ml/s' },
  stepSeconds: { min: 0, max: 127, step: 0.2, default: 30, unit: 's' },
  stepVolume: { min: 0, max: 2000, step: 1, default: 0, unit: 'ml' },
  stepWeight: { min: 0, max: 2000, step: 0.1, default: 0, unit: 'g' },
  exitPressure: { min: 0, max: 11, step: 0.1, default: 4, unit: 'bar' },
  exitFlow: { min: 0, max: 6, step: 0.1, default: 6, unit: 'ml/s' },
  limiterValue: { min: 0, max: 11, step: 0.1, default: 0, unit: '' },
  limiterRange: { min: 0.1, max: 8, step: 0.1, default: 0.6, unit: '' },
  // Simple editors (settings_2a / settings_2b)
  preinfusionTime: { min: 0, max: 60, step: 1, default: 20, unit: 's' },
  preinfusionFlow: { min: 1, max: 8, step: 0.1, default: 4, unit: 'ml/s' },
  preinfusionStopPressure: { min: 1, max: 12, step: 0.1, default: 4, unit: 'bar' },
  espressoPressure: { min: 1, max: 12, step: 0.1, default: 8.6, unit: 'bar' },
  pressureEnd: { min: 1, max: 12, step: 0.1, default: 6, unit: 'bar' },
  holdTime: { min: 0, max: 60, step: 1, default: 4, unit: 's' },
  declineTime: { min: 0, max: 60, step: 1, default: 30, unit: 's' },
  maximumPressure: { min: 0, max: 12, step: 0.1, default: 0, unit: 'bar' },
  maximumFlow: { min: 0, max: 8, step: 0.1, default: 0, unit: 'ml/s' },
  // Limits tab (settings_2c2)
  tankTemperature: { min: 0, max: 45, step: 1, default: 0, unit: '°C' },
  targetWeight: { min: 0, max: 2000, step: 0.1, default: 36, unit: 'g' },
  targetVolume: { min: 0, max: 2000, step: 1, default: 36, unit: 'ml' },
  targetVolumeCountStart: { min: 0, max: 10, step: 1, default: 0, unit: '' }
} as const satisfies Record<string, FieldSpec>;

export type FieldSpecKey = keyof typeof FIELD_SPECS;

const TOP_LEVEL_PROFILE_KEYS = new Set([
  'title',
  'author',
  'notes',
  'beverage_type',
  'type',
  'legacy_profile_type',
  'tank_temperature',
  'target_weight',
  'target_volume',
  'target_volume_count_start',
  'version',
  'steps'
]);

const KNOWN_STEP_KEYS = new Set([
  'name',
  'temperature',
  'sensor',
  'pump',
  'pressure',
  'flow',
  'transition',
  'seconds',
  'volume',
  'weight',
  'exit',
  'limiter'
]);

export function createProfileEditorState(profile: Profile | null): ProfileEditorState {
  if (!profile) {
    return {
      title: 'New profile',
      author: '',
      notes: '',
      beverageType: 'espresso',
      type: 'advanced',
      legacyProfileType: 'settings_2c',
      tankTemperature: null,
      targetWeight: null,
      targetVolume: null,
      targetVolumeCountStart: null,
      version: '2',
      steps: [defaultStep()],
      selectedStep: 0,
      editorMode: 'advanced',
      dirty: false,
      extra: {}
    };
  }

  const record = profile as Record<string, unknown>;
  // Read canonical reaprime `steps` first, falling back to the de1app Tcl
  // `advanced_shot` list so imported tablet profiles load correctly.
  const rawSteps = Array.isArray(profile.steps)
    ? profile.steps
    : Array.isArray(record.advanced_shot)
      ? (record.advanced_shot as unknown[])
      : [];
  const steps = rawSteps.map(readStep);
  const extra = extraTopLevelFields(profile);
  const inferredType = inferProfileTypeFromSteps(steps);
  const type = profile.type ?? typeFromLegacy(profile.legacy_profile_type) ?? inferredType;
  const finalSteps = steps.length > 0 ? steps : [defaultStep()];
  return {
    title: stringValue(profile.title) ?? stringValue(record.profile_title) ?? '',
    author: profile.author ?? '',
    notes: stringValue(profile.notes) ?? stringValue(record.profile_notes) ?? '',
    beverageType: profile.beverage_type ?? 'espresso',
    type,
    legacyProfileType: profile.legacy_profile_type ?? legacyFromType(type),
    tankTemperature: aliasNumber(record, ['tank_temperature', 'tank_desired_water_temperature']),
    targetWeight: aliasNumber(record, [
      'target_weight',
      'final_desired_shot_weight_advanced',
      'final_desired_shot_weight'
    ]),
    targetVolume: aliasNumber(record, [
      'target_volume',
      'final_desired_shot_volume_advanced',
      'final_desired_shot_volume'
    ]),
    targetVolumeCountStart: aliasNumber(record, [
      'target_volume_count_start',
      'final_desired_shot_volume_advanced_count_start'
    ]),
    version: profile.version ?? '2',
    steps: finalSteps,
    selectedStep: 0,
    editorMode: canEditAsBasic(finalSteps) ? 'basic' : 'advanced',
    dirty: false,
    extra
  };
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
    return { ...state, ...next, dirty: true };
  }

  // Choosing a simple type compiles that template (preserving knobs where the
  // current steps already parse) and switches to the basic editor; "advanced"
  // keeps the steps and switches to the advanced editor.
  if (key === 'type') {
    if (value === 'pressure' || value === 'flow') return setSimpleProfileType(state, value);
    return { ...state, type: 'advanced', legacyProfileType: 'settings_2c', editorMode: 'advanced', dirty: true };
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
            : { legacyProfileType: value, type: typeFromLegacy(value) };
  return { ...state, ...next, dirty: true };
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
      case 'popup':
        return { ...step, extra: { ...step.extra, popup: value } };
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
  return setStepField(state, index, key, String(clampNumber(current + delta)));
}

export type SimpleProfileField =
  | 'temperature'
  | 'pre_time'
  | 'pre_flow'
  | 'pre_pressure'
  | 'main_time'
  | 'main_target'
  | 'limit'
  | 'decline_time'
  | 'decline_target'
  | 'stop_volume';

type NumericKnobKey = Exclude<keyof SimpleKnobs, 'preName' | 'mainName' | 'declineName'>;

const SIMPLE_FIELD_TO_KNOB: Record<Exclude<SimpleProfileField, 'stop_volume'>, NumericKnobKey> = {
  temperature: 'temperature',
  pre_time: 'preTime',
  pre_flow: 'preFlow',
  pre_pressure: 'prePressure',
  main_time: 'mainTime',
  main_target: 'mainTarget',
  limit: 'limit',
  decline_time: 'declineTime',
  decline_target: 'declineTarget'
};

function simpleStateType(state: ProfileEditorState): SimpleType {
  return parseStepsToSimple(state.steps)?.type ?? (state.type === 'flow' ? 'flow' : 'pressure');
}

function simpleKnobsOf(state: ProfileEditorState): { type: SimpleType; knobs: SimpleKnobs } {
  const parsed = parseStepsToSimple(state.steps);
  if (parsed) return parsed;
  const type = simpleStateType(state);
  return { type, knobs: defaultSimpleKnobs(type) };
}

// Simple edits never poke at individual steps. They read the current knobs out
// of the steps, change one, and recompile — so the steps stay canonical and the
// basic⇄advanced guard keeps holding (see domain/simpleProfile.ts).
export function setSimpleProfileField(
  state: ProfileEditorState,
  key: SimpleProfileField,
  value: string
): ProfileEditorState {
  const parsedValue = parseNumber(value) ?? 0;
  if (key === 'stop_volume') {
    return { ...state, targetVolume: parsedValue, dirty: true };
  }
  const { type, knobs } = simpleKnobsOf(state);
  const nextKnobs: SimpleKnobs = { ...knobs, [SIMPLE_FIELD_TO_KNOB[key]]: parsedValue };
  return {
    ...state,
    type,
    legacyProfileType: legacyFromType(type),
    steps: compileSimpleToSteps(nextKnobs, type),
    dirty: true
  };
}

export function nudgeSimpleProfileField(
  state: ProfileEditorState,
  key: SimpleProfileField,
  delta: number
): ProfileEditorState {
  const current =
    key === 'stop_volume' ? (state.targetVolume ?? 0) : simpleKnobsOf(state).knobs[SIMPLE_FIELD_TO_KNOB[key]];
  return setSimpleProfileField(state, key, String(clampNumber(current + delta)));
}

/** Switch the editor surface. Basic is refused unless the steps pass the guard. */
export function setEditorMode(state: ProfileEditorState, mode: EditorMode): ProfileEditorState {
  if (mode === 'basic' && !canEditAsBasic(state.steps)) return state;
  return { ...state, editorMode: mode };
}

/** Set the simple profile kind (pressure/flow), recompiling the current knobs. */
export function setSimpleProfileType(state: ProfileEditorState, type: SimpleType): ProfileEditorState {
  const { knobs } = simpleKnobsOf(state);
  return {
    ...state,
    type,
    legacyProfileType: legacyFromType(type),
    steps: compileSimpleToSteps(knobs, type),
    selectedStep: 0,
    editorMode: 'basic',
    dirty: true
  };
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
  return { ...state, steps, selectedStep: index + 1, dirty: true };
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
    : defaultStep();
  const insertAt = clamp(state.selectedStep + 1, 0, state.steps.length);
  const steps = [...state.steps.slice(0, insertAt), step, ...state.steps.slice(insertAt)];
  return { ...state, steps, selectedStep: insertAt, dirty: true };
}

export function removeStep(state: ProfileEditorState, index: number): ProfileEditorState {
  if (index < 0 || index >= state.steps.length) return state;
  if (state.steps.length <= 1) return state;
  const steps = state.steps.filter((_, i) => i !== index);
  const selectedStep = clamp(state.selectedStep > index ? state.selectedStep - 1 : state.selectedStep, 0, steps.length - 1);
  return { ...state, steps, selectedStep, dirty: true };
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
  return { ...state, steps, selectedStep, dirty: true };
}

export function selectStep(state: ProfileEditorState, index: number): ProfileEditorState {
  if (index < 0 || index >= state.steps.length) return state;
  return { ...state, selectedStep: index };
}

export function profileFromEditorState(state: ProfileEditorState): Profile {
  const profile: Profile = {
    ...state.extra,
    version: state.version,
    steps: state.steps.map(writeStep)
  };
  if (state.title) profile.title = state.title;
  if (state.author) profile.author = state.author;
  if (state.notes) profile.notes = state.notes;
  if (state.beverageType) profile.beverage_type = state.beverageType;
  if (state.type) profile.type = state.type;
  if (state.legacyProfileType) profile.legacy_profile_type = state.legacyProfileType;
  if (state.tankTemperature != null) profile.tank_temperature = state.tankTemperature;
  if (state.targetWeight != null) profile.target_weight = state.targetWeight;
  if (state.targetVolume != null) profile.target_volume = state.targetVolume;
  if (state.targetVolumeCountStart != null) profile.target_volume_count_start = state.targetVolumeCountStart;
  return profile;
}

export function renderProfileEditor(state: ProfileEditorState): string {
  if (state.editorMode === 'basic') return renderSimpleProfileEditor(state);
  return `
    <div class="profile-editor">
      ${renderEditorModeBar(state)}
      ${renderMeta(state)}
      <div class="pe-main-grid">
        <section class="pe-left-rail">
          ${renderStepList(state)}
          ${renderProfileChart(state)}
        </section>
        ${renderStepDetail(state)}
      </div>
    </div>
  `;
}

function renderEditorModeBar(state: ProfileEditorState): string {
  const canBasic = canEditAsBasic(state.steps);
  const basicAttrs = canBasic
    ? ''
    : 'disabled title="These steps are too detailed for the basic editor — edit them in Advanced."';
  return `
    <div class="pe-mode-bar" role="group" aria-label="Editor mode">
      <button type="button" class="pe-mode-btn ${state.editorMode === 'basic' ? 'active' : ''}" data-action="pe-set-mode" data-value="basic" ${basicAttrs}>Basic</button>
      <button type="button" class="pe-mode-btn ${state.editorMode === 'advanced' ? 'active' : ''}" data-action="pe-set-mode" data-value="advanced">Advanced</button>
    </div>
  `;
}

function renderSimpleTypeToggle(type: SimpleType): string {
  return `
    <div class="pe-kind-bar" role="group" aria-label="Profile kind">
      <button type="button" class="pe-kind-btn ${type === 'pressure' ? 'active' : ''}" data-action="pe-set-simple-type" data-value="pressure">Pressure</button>
      <button type="button" class="pe-kind-btn ${type === 'flow' ? 'active' : ''}" data-action="pe-set-simple-type" data-value="flow">Flow</button>
    </div>
  `;
}

function renderSimpleProfileEditor(state: ProfileEditorState): string {
  const { type, knobs } = simpleKnobsOf(state);
  const model = {
    temperature: knobs.temperature,
    preTime: knobs.preTime,
    preFlow: knobs.preFlow,
    prePressure: knobs.prePressure,
    mainTime: knobs.mainTime,
    mainTarget: knobs.mainTarget,
    limit: knobs.limit,
    declineTime: knobs.declineTime,
    declineTarget: knobs.declineTarget,
    stopVolume: state.targetVolume ?? 0
  };
  const isFlow = type === 'flow';
  const modeLabel = isFlow ? 'Flow' : 'Pressure';
  const mainUnit = isFlow ? 'ml/s' : 'bar';
  const limitLabel = isFlow ? 'Limit pressure' : 'Limit flow';
  const limitUnit = isFlow ? 'bar' : 'ml/s';
  return `
    <div class="profile-editor pe-de1 ${isFlow ? 'flow' : 'pressure'}">
      <header class="pe-de1-tabs">
        <button type="button" class="pe-de1-tab" data-action="go-view" data-value="profiles">Presets</button>
        <div class="pe-de1-tab active">
          <strong>${escapeHtml(modeLabel.toUpperCase())}</strong>
          <span>${escapeHtml(state.title || 'New profile')}</span>
        </div>
        <button type="button" class="pe-de1-tab" data-action="go-view" data-value="machine">Machine</button>
        <button type="button" class="pe-de1-tab" data-action="go-view" data-value="settings">App</button>
      </header>

      <div class="pe-de1-toolbar">
        ${renderEditorModeBar(state)}
        ${renderSimpleTypeToggle(type)}
      </div>

      <div class="pe-de1-graph">
        ${renderDe1ExplanationChart(state)}
      </div>

      <div class="pe-de1-stage-grid">
        <section class="pe-de1-stage stage-1">
          <h3>1: preinfuse</h3>
          <div class="pe-de1-stage-rows">
            ${renderDe1HSlider('pre_time', model.preTime, 'seconds', 0, 60, 1, 'stage-1', 'time')}
            ${renderDe1HSlider('pre_flow', model.preFlow, 'mL/s', 0, 12, 0.1, 'stage-1', 'flow')}
          </div>
          ${renderDe1VSlider('pre_pressure', model.prePressure, 'bar', 0, 12, 0.1, 'stage-1', isFlow ? 'stop pressure' : '< pressure')}
        </section>

        <section class="pe-de1-stage stage-2">
          <h3>${isFlow ? '2: hold' : '2: rise and hold'}</h3>
          <div class="pe-de1-stage-rows">
            ${renderDe1HSlider('main_time', model.mainTime, 'seconds', 0, 60, 1, 'stage-2', 'time')}
            ${renderDe1HSlider('limit', model.limit, limitUnit, 0, 12, 0.1, 'stage-2', limitLabel, true)}
          </div>
          ${renderDe1VSlider('main_target', model.mainTarget, mainUnit, 0, 12, 0.1, 'stage-2', modeLabel.toLowerCase())}
        </section>

        <section class="pe-de1-stage stage-3">
          <h3>3: decline</h3>
          <div class="pe-de1-stage-rows">
            ${renderDe1HSlider('decline_time', model.declineTime, 'seconds', 0, 60, 1, 'stage-3', 'time')}
          </div>
          ${renderDe1VSlider('decline_target', model.declineTarget, mainUnit, 0, 12, 0.1, 'stage-3', `${modeLabel.toLowerCase()} end`)}
        </section>

        <section class="pe-de1-stage stage-4">
          <h3>4: stop at pour</h3>
          <div class="pe-de1-stage-rows">
            ${renderDe1HSlider('stop_volume', model.stopVolume, 'mL', 0, 100, 1, 'stage-4', 'volume')}
          </div>
        </section>

        <section class="pe-de1-stage temp">
          <h3>Temperature</h3>
          ${renderDe1Temperature(model.temperature)}
        </section>
      </div>

      <footer class="pe-de1-footer">
        <button type="button" class="command" data-action="go-view" data-value="profiles">Cancel</button>
        <button type="button" class="command primary" data-action="save-profile">${icon('save')}<span>OK</span></button>
      </footer>
    </div>
  `;
}

function renderDe1HSlider(
  key: SimpleProfileField,
  value: number,
  unit: string,
  min: number,
  max: number,
  step: number,
  stage: string,
  label: string,
  offWhenZero = false
): string {
  const fill = rangeFill(value, min, max);
  return `
    <label class="pe-de1-slider horizontal ${stage}" style="--fill:${fill}%;">
      <span class="pe-de1-cap">${escapeHtml(label)}</span>
      <input type="range" min="${min}" max="${max}" step="${step}" value="${escapeAttr(formatNumber(value))}" data-action="pe-simple-field" data-key="${key}" aria-label="${escapeAttr(label)}" />
      ${renderDe1ValueButton(key, value, unit, min, max, step, label, formatDe1Value(value, unit, offWhenZero))}
    </label>
  `;
}

function renderDe1VSlider(
  key: SimpleProfileField,
  value: number,
  unit: string,
  min: number,
  max: number,
  step: number,
  stage: string,
  label: string
): string {
  const fill = rangeFill(value, min, max);
  return `
    <label class="pe-de1-slider vertical ${stage}" style="--fill:${fill}%;">
      <span class="pe-de1-cap">${escapeHtml(label)}</span>
      <input type="range" min="${min}" max="${max}" step="${step}" value="${escapeAttr(formatNumber(value))}" data-action="pe-simple-field" data-key="${key}" aria-label="${escapeAttr(label)}" />
      ${renderDe1ValueButton(key, value, unit, min, max, step, label, formatDe1Value(value, unit, false, label.startsWith('<')))}
    </label>
  `;
}

function renderDe1Temperature(value: number): string {
  return `
    <div class="pe-de1-temp" aria-label="Temperature">
      <button type="button" class="pe-de1-temp-btn" data-action="pe-simple-nudge" data-key="temperature" data-delta="0.5" aria-label="Increase temperature">${icon('plus')}</button>
      <input type="range" min="1" max="105" step="0.5" value="${escapeAttr(formatNumber(value))}" data-action="pe-simple-field" data-key="temperature" aria-label="temperature" />
      <button type="button" class="pe-de1-temp-btn" data-action="pe-simple-nudge" data-key="temperature" data-delta="-0.5" aria-label="Decrease temperature">${icon('minus')}</button>
      ${renderDe1ValueButton('temperature', value, '°C', 1, 105, 0.5, 'Temperature', `${formatNumber(value)}°C`)}
    </div>
  `;
}

function renderDe1ValueButton(
  key: SimpleProfileField,
  value: number,
  unit: string,
  min: number,
  max: number,
  step: number,
  title: string,
  label: string
): string {
  return `
    <button
      type="button"
      class="pe-de1-value"
      data-action="pe-simple-edit"
      data-key="${key}"
      data-value="${escapeAttr(formatNumber(value))}"
      data-title="${escapeAttr(title)}"
      data-unit="${escapeAttr(unit)}"
      data-min="${min}"
      data-max="${max}"
      data-step="${step}"
    >${escapeHtml(label)}</button>
  `;
}

function formatDe1Value(value: number, unit: string, offWhenZero = false, lessThan = false): string {
  if (offWhenZero && value <= 0) return 'off';
  const prefix = lessThan ? '< ' : '';
  return `${prefix}${formatNumber(value)} ${unit}`;
}

function rangeFill(value: number, min: number, max: number): string {
  if (max <= min) return '0';
  return (clamp01((value - min) / (max - min)) * 100).toFixed(2);
}

function renderMeta(state: ProfileEditorState): string {
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
        <span>Type</span>
        <select data-action="pe-meta" data-key="type">
          ${PROFILE_TYPES.map((type) => `
            <option value="${escapeAttr(type)}" ${type === state.type ? 'selected' : ''}>${escapeHtml(displayType(type))}</option>
          `).join('')}
        </select>
      </label>
      <label class="pe-field">
        <span>Beverage</span>
        <select data-action="pe-meta" data-key="beverage_type">
          ${PROFILE_BEVERAGE_TYPES.map((type) => `
            <option value="${escapeAttr(type)}" ${type === state.beverageType ? 'selected' : ''}>${escapeHtml(displayType(type))}</option>
          `).join('')}
        </select>
      </label>
      <label class="pe-field">
        <span>Tank °C</span>
        <input type="number" step="0.1" data-action="pe-meta" data-key="tank_temperature" value="${escapeAttr(numberText(state.tankTemperature))}" />
      </label>
      <label class="pe-field">
        <span>Stop g</span>
        <input type="number" step="0.1" data-action="pe-meta" data-key="target_weight" value="${escapeAttr(numberText(state.targetWeight))}" />
      </label>
      <label class="pe-field">
        <span>Stop ml</span>
        <input type="number" step="1" data-action="pe-meta" data-key="target_volume" value="${escapeAttr(numberText(state.targetVolume))}" />
      </label>
      <label class="pe-field">
        <span>Count start</span>
        <input type="number" step="1" data-action="pe-meta" data-key="target_volume_count_start" value="${escapeAttr(numberText(state.targetVolumeCountStart))}" />
      </label>
      <label class="pe-field pe-notes-field">
        <span>Notes</span>
        <input type="text" data-action="pe-meta" data-key="notes" value="${escapeAttr(state.notes)}" />
      </label>
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
          ${renderVerticalControl(index, 'temperature', 'temperature', step.temperature, '°C', 1, 105, 0.5, 'thermometer', 'red')}
          ${renderToggleTile(index, 'sensor', 'sensor', step.sensor, step.sensor === 'water' ? 'droplets' : 'coffee')}
          ${renderGoalControl(index, 'flow', isFlow ? 'flow' : 'flow limit', isFlow ? step.flow : (step.limiter?.value ?? 0), 'ml/s', 0, 12, isFlow)}
          ${renderGoalControl(index, 'pressure', isFlow ? 'pressure limit' : 'pressure', isFlow ? (step.limiter?.value ?? 0) : step.pressure, 'bar', 0, 12, !isFlow)}
          ${step.limiter
            ? renderVerticalControl(index, 'limiter_range', 'limit range', step.limiter.range, '', FIELD_SPECS.limiterRange.min, FIELD_SPECS.limiterRange.max, FIELD_SPECS.limiterRange.step, 'sliders-horizontal', 'stage')
            : ''}
          ${renderToggleTile(index, 'transition', 'transition', step.transition, step.transition === 'smooth' ? 'waves' : 'move-right')}
        </div>
      </div>
      <div class="pe-ctl-group">
        <span class="pe-ctl-group-title">Stop after</span>
        <div class="pe-ctl-grid">
          ${renderVerticalControl(index, 'seconds', 'time', step.seconds, 's', 0, 127, 1, 'timer', 'stage')}
          ${renderVerticalControl(index, 'volume', 'volume', step.volume, 'ml', 0, 1023, 1, 'beaker', 'blue')}
          ${renderVerticalControl(index, 'weight', 'weight', step.weight, 'g', 0, 1000, 0.1, 'scale', 'amber')}
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
  min: number,
  max: number,
  active: boolean
): string {
  const field: StepFieldKey = active ? pumpKey : 'limiter_value';
  return renderVerticalControl(index, field, label, value, unit, min, max, 0.1, pumpKey === 'flow' ? 'droplets' : 'gauge', pumpKey === 'flow' ? 'blue' : 'purple', {
    action: 'pe-step-pump',
    value: pumpKey,
    active
  });
}

function renderVerticalControl(
  index: number,
  key: StepFieldKey,
  label: string,
  value: number,
  unit: string,
  min: number,
  max: number,
  step: number,
  iconName: string,
  tone: string,
  centerAction?: { action: string; value: string; active?: boolean }
): string {
  const formatted = formatNumber(value);
  const faceAttrs = centerAction
    ? `data-action="${centerAction.action}" data-index="${index}" data-value="${escapeAttr(centerAction.value)}"`
    : 'tabindex="-1"';
  return `
    <div class="pe-ctl ${escapeAttr(tone)} ${centerAction?.active ? 'active' : ''}">
      <button type="button" class="pe-ctl-face" ${faceAttrs} aria-label="${escapeAttr(label)}">${icon(iconName)}</button>
      <span class="pe-ctl-label">${escapeHtml(label)}</span>
      <strong class="pe-ctl-value">${escapeHtml(formatted)}${unit ? `<em>${escapeHtml(unit)}</em>` : ''}</strong>
      <div class="pe-ctl-adjust">
        <button type="button" class="pe-ctl-step" data-action="pe-step-nudge" data-index="${index}" data-key="${key}" data-delta="${-step}" aria-label="decrease ${escapeAttr(label)}">${icon('minus')}</button>
        <input class="pe-ctl-range" type="range" min="${min}" max="${max}" step="${step}" data-action="pe-step-field" data-index="${index}" data-key="${key}" value="${escapeAttr(formatted)}" aria-label="${escapeAttr(label)}" />
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
  return `
    <div class="pe-ctl exit ${active ? 'active' : ''}">
      <button type="button" class="pe-ctl-face" data-action="pe-step-exit-preset" data-index="${index}" data-type="${type}" data-condition="${condition}" data-value="${escapeAttr(formatNumber(value || defaultExitValue(type, condition)))}" aria-label="${escapeAttr(label)}">${icon(iconName)}</button>
      <span class="pe-ctl-label">${escapeHtml(type)} <em>${escapeHtml(condition)}</em></span>
      <strong class="pe-ctl-value">${active ? `${escapeHtml(formatNumber(value))}<em>${escapeHtml(unit)}</em>` : '<span class="pe-ctl-off">off</span>'}</strong>
      <div class="pe-ctl-adjust">
        <button type="button" class="pe-ctl-step" data-action="pe-step-exit-nudge" data-index="${index}" data-type="${type}" data-condition="${condition}" data-delta="-0.1" aria-label="decrease ${escapeAttr(label)}">${icon('minus')}</button>
        <input class="pe-ctl-range" type="range" min="0" max="${max}" step="0.1" data-action="pe-step-exit" data-index="${index}" data-key="value" data-type="${type}" data-condition="${condition}" value="${escapeAttr(formatNumber(value))}" aria-label="${escapeAttr(label)}" />
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

function renderDe1ExplanationChart(state: ProfileEditorState): string {
  const width = 1188;
  const height = 250;
  const plot: ChartPlot = { x: 32, y: 10, w: 1136, h: 228 };
  const isFlow = state.type === 'flow';
  const maxValue = isFlow ? 8 : 12;
  const model = buildProfileChartModel(state.steps);
  const trace = isFlow ? model.flow : model.pressure;
  const mainLine = traceToPath(trace, plot, model.totalSeconds, maxValue);
  const ticks = isFlow ? [0, 2, 4, 6, 8] : [1, 3, 5, 7, 9, 11];
  const axisTitle = isFlow ? 'flow (ml/s)' : 'pressure (bar)';
  const nodes = model.spans.map((span, index) => {
    const step = state.steps[index];
    const value = step ? (isFlow ? step.flow : step.pressure) : 0;
    return {
      x: plot.x + (span.end / model.totalSeconds) * plot.w,
      y: plot.y + plot.h - clamp01(value / maxValue) * plot.h
    };
  });
  return `
    <section class="pe-de1-chart-panel" aria-label="Profile preview">
      <svg class="pe-de1-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeAttr(axisTitle)} profile">
        <rect class="pe-de1-plot" x="${plot.x}" y="${plot.y}" width="${plot.w}" height="${plot.h}" rx="3"></rect>
        ${ticks.map((tick) => {
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
        <text class="pe-de1-axis-title" transform="translate(24 ${plot.y + plot.h / 2}) rotate(-90)">${escapeHtml(axisTitle)}</text>
        ${selectedStepBand(model, state.selectedStep, plot)}
        <path class="pe-de1-main-line" d="${mainLine}" fill="none"></path>
        ${nodes.map((point) => `
          <circle class="pe-de1-node" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="6"></circle>
        `).join('')}
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

function inferProfileTypeFromSteps(steps: EditorStep[]): string {
  if (!steps.length) return 'advanced';
  const hasPressure = steps.some((step) => step.pump === 'pressure' || step.pressure > 0);
  const hasFlow = steps.some((step) => step.pump === 'flow' || step.flow > 0);
  if (hasFlow && !hasPressure) return 'flow';
  if (hasPressure && !hasFlow) return 'pressure';
  const firstPressure = steps.findIndex((step) => step.pump === 'pressure');
  const flowAfterPressure = firstPressure >= 0 && steps.some((step, index) => index > firstPressure && step.pump === 'flow');
  if (hasPressure && hasFlow && firstPressure >= 0 && !flowAfterPressure) return 'pressure';
  return 'advanced';
}

function defaultStep(): EditorStep {
  return {
    name: 'Pressure',
    temperature: 93,
    sensor: 'coffee',
    pump: 'pressure',
    pressure: 9,
    flow: 6,
    transition: 'fast',
    seconds: 30,
    volume: 0,
    weight: 0,
    exit: null,
    limiter: null,
    extra: {}
  };
}

// de1app flat per-step keys that `readStep` folds into nested `exit`/`limiter`.
// Consumed here so they don't survive into the canonical reaprime output.
const TCL_STEP_FLAT_KEYS = new Set([
  'exit_if',
  'exit_type',
  'exit_pressure_over',
  'exit_pressure_under',
  'exit_flow_over',
  'exit_flow_under',
  'max_flow_or_pressure',
  'max_flow_or_pressure_range'
]);

function readStep(raw: unknown): EditorStep {
  const record = objectRecord(raw) ?? {};
  const base = defaultStep();
  const extra: Record<string, unknown> = {};
  for (const key of Object.keys(record)) {
    if (!KNOWN_STEP_KEYS.has(key) && !TCL_STEP_FLAT_KEYS.has(key)) extra[key] = record[key];
  }
  return {
    name: stringValue(record.name) ?? base.name,
    temperature: numeric(record.temperature) ?? base.temperature,
    sensor: record.sensor === 'water' ? 'water' : 'coffee',
    pump: record.pump === 'flow' ? 'flow' : 'pressure',
    pressure: numeric(record.pressure) ?? base.pressure,
    flow: numeric(record.flow) ?? base.flow,
    transition: record.transition === 'smooth' ? 'smooth' : 'fast',
    seconds: numeric(record.seconds) ?? base.seconds,
    volume: numeric(record.volume) ?? 0,
    weight: numeric(record.weight) ?? 0,
    exit: readExit(record),
    limiter: readLimiter(record),
    extra
  };
}

// Accepts a step record and reads the nested `exit` object (reaprime v2) or,
// failing that, the de1app flat `exit_if`/`exit_type`/`exit_*` keys.
function readExit(record: Record<string, unknown>): StepExit | null {
  const nested = objectRecord(record.exit);
  if (nested) {
    const value = numeric(nested.value);
    if (value == null) return null;
    return {
      type: nested.type === 'flow' ? 'flow' : 'pressure',
      condition: nested.condition === 'under' ? 'under' : 'over',
      value
    };
  }
  if (!isTruthyFlag(record.exit_if)) return null;
  const exitType = stringValue(record.exit_type);
  if (!exitType) return null;
  const type: StepExitType = exitType.startsWith('flow') ? 'flow' : 'pressure';
  const condition: StepExitCondition = exitType.endsWith('under') ? 'under' : 'over';
  const value = numeric(record[`exit_${type}_${condition}`]);
  if (value == null) return null;
  return { type, condition, value };
}

// Reads nested `limiter` (reaprime v2) or de1app flat `max_flow_or_pressure`.
function readLimiter(record: Record<string, unknown>): StepLimiter | null {
  const nested = objectRecord(record.limiter);
  if (nested) {
    const value = numeric(nested.value);
    if (value == null) return null;
    return { value, range: numeric(nested.range) ?? FIELD_SPECS.limiterRange.default };
  }
  const flat = numeric(record.max_flow_or_pressure);
  if (flat == null || flat <= 0) return null;
  return {
    value: flat,
    range: numeric(record.max_flow_or_pressure_range) ?? FIELD_SPECS.limiterRange.default
  };
}

function isTruthyFlag(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return value === '1' || value.toLowerCase() === 'true';
  return false;
}

function writeStep(step: EditorStep): Record<string, unknown> {
  const out: Record<string, unknown> = {
    ...step.extra,
    name: step.name,
    temperature: step.temperature,
    sensor: step.sensor,
    pump: step.pump,
    pressure: step.pressure,
    flow: step.flow,
    transition: step.transition,
    seconds: step.seconds,
    volume: step.volume,
    weight: step.weight
  };
  if (step.exit) out.exit = { type: step.exit.type, condition: step.exit.condition, value: step.exit.value };
  else delete out.exit;
  if (step.limiter) out.limiter = { value: step.limiter.value, range: step.limiter.range };
  else delete out.limiter;
  return out;
}

function updateStep(
  state: ProfileEditorState,
  index: number,
  fn: (step: EditorStep) => EditorStep
): ProfileEditorState {
  if (index < 0 || index >= state.steps.length) return state;
  const steps = state.steps.map((step, i) => (i === index ? fn(step) : step));
  return { ...state, steps, dirty: true };
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

// de1app Tcl aliases that `createProfileEditorState` reads into typed fields.
// Excluded from `extra` so they don't leak back into the canonical reaprime
// output alongside their normalized counterparts.
const CONSUMED_ALIAS_KEYS = new Set([
  'advanced_shot',
  'profile_title',
  'profile_notes',
  'tank_desired_water_temperature',
  'final_desired_shot_weight_advanced',
  'final_desired_shot_weight',
  'final_desired_shot_volume_advanced',
  'final_desired_shot_volume',
  'final_desired_shot_volume_advanced_count_start'
]);

function extraTopLevelFields(profile: Profile): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(profile)) {
    if (!TOP_LEVEL_PROFILE_KEYS.has(key) && !CONSUMED_ALIAS_KEYS.has(key)) extra[key] = value;
  }
  return extra;
}

function aliasNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = numeric(record[key]);
    if (value != null) return value;
  }
  return null;
}

function typeFromLegacy(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value === 'settings_2a') return 'pressure';
  if (value === 'settings_2b') return 'flow';
  return 'advanced';
}

function legacyFromType(value: string | undefined): string {
  if (value === 'pressure') return 'settings_2a';
  if (value === 'flow') return 'settings_2b';
  return 'settings_2c';
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function numeric(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
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

function clampNumber(value: number): number {
  return Math.max(0, Number(value.toFixed(2)));
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

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}
