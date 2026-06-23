import type { Profile } from '../api/types';
import {
  canEditAsBasic,
  compileSimpleToSteps,
  defaultSimpleKnobs,
  parseStepsToSimple,
  type SimpleKnobs,
  type SimpleType
} from '../domain/simpleProfile';
import {
  FIELD_SPECS,
  MAX_STEPS,
  PROFILE_BEVERAGE_TYPES,
  type EditorStep,
  type ProfileMetaKey,
  type StepExit,
  type StepExitCondition,
  type StepExitType,
  type StepFieldKey,
  type StepLimiter,
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
  /** Sub-tab within the advanced editor (de1app settings_2c / settings_2c2). */
  advancedTab: AdvancedTab;
  dirty: boolean;
  /** Outcome of the last save attempt, surfaced as a banner; null when none. */
  saveNotice: { tone: 'error' | 'success'; message: string } | null;
  extra: Record<string, unknown>;
}

const META_NUMBER_KEYS: ProfileMetaKey[] = [
  'tank_temperature',
  'target_weight',
  'target_volume',
  'target_volume_count_start'
];

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
      // reaprime requires both tank_temperature and target_volume_count_start
      // on every profile, so prefill their canonical defaults rather than leave
      // them unset (target_weight / target_volume stay optional).
      tankTemperature: FIELD_SPECS.tankTemperature.default,
      targetWeight: null,
      targetVolume: null,
      targetVolumeCountStart: FIELD_SPECS.targetVolumeCountStart.default,
      version: '2',
      steps: [defaultStep()],
      selectedStep: 0,
      editorMode: 'advanced',
      advancedTab: 'steps',
      dirty: false,
      saveNotice: null,
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
    advancedTab: 'steps',
    dirty: false,
    saveNotice: null,
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
  const { min, max } = STEP_FIELD_LIMITS[key as NumericStepField];
  return setStepField(state, index, key, String(clampNumber(current + delta, min, max)));
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
  const { type, knobs } = simpleKnobsOf(state);
  const current = key === 'stop_volume' ? (state.targetVolume ?? 0) : knobs[SIMPLE_FIELD_TO_KNOB[key]];
  const { min, max } = simpleFieldLimits(key, type);
  return setSimpleProfileField(state, key, String(clampNumber(current + delta, min, max)));
}

/**
 * Dialog/nudge bounds for the simple (basic) editor, by profile kind: the
 * main target and the limit swap their pressure/flow scales when the kind
 * flips. Shared by renderSimpleControl (data-min/data-max) and the nudges.
 */
function simpleFieldLimits(key: SimpleProfileField, type: SimpleType): { min: number; max: number } {
  switch (key) {
    case 'temperature':
      return { min: 1, max: 105 };
    case 'pre_time':
    case 'main_time':
    case 'decline_time':
      return { min: 0, max: 60 };
    case 'pre_flow':
      return { min: 0, max: 8 };
    case 'pre_pressure':
      return { min: 0, max: 12 };
    case 'main_target':
    case 'decline_target':
      return { min: 0, max: type === 'flow' ? 8 : 12 };
    case 'limit':
      return { min: 0, max: type === 'flow' ? 12 : 8 };
    case 'stop_volume':
      return { min: 0, max: 100 };
  }
}

/** Switch the editor surface. Basic is refused unless the steps pass the guard. */
export function setEditorMode(state: ProfileEditorState, mode: EditorMode): ProfileEditorState {
  // Switching to Basic when the steps aren't already a canonical simple shape
  // (a brand-new profile, or any advanced profile) compiles a simple template —
  // keeping the knobs where the steps already parse, else sensible defaults.
  if (mode === 'basic' && !canEditAsBasic(state.steps)) {
    return setSimpleProfileType(state, simpleStateType(state));
  }
  return { ...state, editorMode: mode };
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
  return { ...state, steps, dirty: true };
}

export function currentLimiterRange(state: ProfileEditorState): number {
  return state.steps.find((step) => step.limiter && step.limiter.value > 0)?.limiter?.range
    ?? FIELD_SPECS.limiterRange.default;
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
  // tank_temperature and target_volume_count_start are mandatory server-side
  // (reaprime rejects a profile without either), so always emit them — falling
  // back to their defaults — instead of dropping them when the field is empty.
  // target_weight / target_volume stay optional and are only sent when set.
  profile.tank_temperature = state.tankTemperature ?? FIELD_SPECS.tankTemperature.default;
  profile.target_volume_count_start =
    state.targetVolumeCountStart ?? FIELD_SPECS.targetVolumeCountStart.default;
  if (state.targetWeight != null) profile.target_weight = state.targetWeight;
  if (state.targetVolume != null) profile.target_volume = state.targetVolume;
  return profile;
}

function renderSaveNotice(state: ProfileEditorState): string {
  const notice = state.saveNotice;
  if (!notice) return '';
  // A success banner is stale the moment the user edits again, so hide it once
  // the editor is dirty; errors (validation, save failure, duplicate) persist
  // until they're resolved.
  if (notice.tone === 'success' && state.dirty) return '';
  if (notice.tone === 'success') {
    return `
    <div class="pe-save-notice success" role="status">
      <strong>${escapeHtml(notice.message)}</strong>
    </div>`;
  }
  return `
    <div class="pe-save-notice error" role="alert">
      <strong>Couldn't save profile</strong>
      <span>${escapeHtml(notice.message)}</span>
    </div>`;
}

export function renderProfileEditor(state: ProfileEditorState): string {
  if (state.editorMode === 'basic') return `${renderSaveNotice(state)}${renderSimpleProfileEditor(state)}`;
  return `
    <div class="profile-editor">
      ${renderSaveNotice(state)}
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

export function renderEditorModeBar(state: ProfileEditorState): string {
  return `
    <div class="pe-mode-bar" role="group" aria-label="Editor mode">
      <button type="button" class="pe-mode-btn ${state.editorMode === 'basic' ? 'active' : ''}" data-action="pe-set-mode" data-value="basic">Basic</button>
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
  const isFlow = type === 'flow';
  const mainUnit = isFlow ? 'ml/s' : 'bar';
  const mainLabel = isFlow ? 'flow' : 'pressure';
  const mainIcon = isFlow ? 'droplets' : 'gauge';
  const mainTone = isFlow ? 'blue' : 'purple';
  const limitUnit = isFlow ? 'bar' : 'ml/s';
  const limitLabel = isFlow ? 'pressure limit' : 'flow limit';
  const stopVolume = state.targetVolume ?? 0;
  return `
    <div class="profile-editor">
      ${renderIdentityMeta(state)}
      <div class="pe-kind-row">${renderSimpleTypeToggle(type)}</div>
      <div class="pe-simple-chart">${renderDe1ExplanationChart(state)}</div>
      <div class="pe-simple-stages">
      <div class="pe-ctl-group">
        <span class="pe-ctl-group-title">1 · Preinfuse</span>
        <div class="pe-ctl-grid">
          ${renderSimpleControl(type, 'pre_time', 'time', knobs.preTime, 's', 1, 'timer', 'stage')}
          ${renderSimpleControl(type, 'pre_flow', 'flow', knobs.preFlow, 'ml/s', 0.1, 'droplets', 'blue')}
          ${renderSimpleControl(type, 'pre_pressure', isFlow ? 'stop at pressure' : 'until pressure', knobs.prePressure, 'bar', 0.1, 'gauge', 'purple')}
        </div>
      </div>
      <div class="pe-ctl-group">
        <span class="pe-ctl-group-title">2 · ${isFlow ? 'Hold' : 'Rise &amp; hold'}</span>
        <div class="pe-ctl-grid">
          ${renderSimpleControl(type, 'main_time', 'time', knobs.mainTime, 's', 1, 'timer', 'stage')}
          ${renderSimpleControl(type, 'main_target', mainLabel, knobs.mainTarget, mainUnit, 0.1, mainIcon, mainTone)}
          ${renderSimpleControl(type, 'limit', limitLabel, knobs.limit, limitUnit, 0.1, 'sliders-horizontal', 'amber', true)}
        </div>
      </div>
      <div class="pe-ctl-group">
        <span class="pe-ctl-group-title">3 · Decline</span>
        <div class="pe-ctl-grid">
          ${renderSimpleControl(type, 'decline_time', 'time', knobs.declineTime, 's', 1, 'timer', 'stage')}
          ${renderSimpleControl(type, 'decline_target', `${mainLabel} end`, knobs.declineTarget, mainUnit, 0.1, mainIcon, mainTone)}
        </div>
      </div>
      <div class="pe-ctl-group">
        <span class="pe-ctl-group-title">4 · Finish</span>
        <div class="pe-ctl-grid">
          ${renderSimpleControl(type, 'stop_volume', 'stop at volume', stopVolume, 'ml', 1, 'beaker', 'blue', true)}
          ${renderSimpleControl(type, 'temperature', 'temperature', knobs.temperature, '°C', 0.5, 'thermometer', 'red')}
        </div>
      </div>
      </div>
    </div>
  `;
}

// A simple-editor control card — the same .pe-ctl card the advanced editor uses,
// wired to the scalar pe-simple-field / pe-simple-nudge actions (no per-step index).
function renderSimpleControl(
  type: SimpleType,
  key: SimpleProfileField,
  label: string,
  value: number,
  unit: string,
  step: number,
  iconName: string,
  tone: string,
  offWhenZero = false
): string {
  const { min, max } = simpleFieldLimits(key, type);
  const formatted = formatNumber(value);
  const display = offWhenZero && value <= 0
    ? '<span class="pe-ctl-off">off</span>'
    : `${escapeHtml(formatted)}${unit ? `<em>${escapeHtml(unit)}</em>` : ''}`;
  return `
    <div class="pe-ctl ${escapeAttr(tone)}">
      <button type="button" class="pe-ctl-face" tabindex="-1" aria-label="${escapeAttr(label)}">${icon(iconName)}</button>
      <span class="pe-ctl-label">${escapeHtml(label)}</span>
      <div class="pe-ctl-stepper">
        <button type="button" class="pe-ctl-step" data-action="pe-simple-nudge" data-key="${key}" data-delta="${-step}" aria-label="decrease ${escapeAttr(label)}">${icon('minus')}</button>
        <button type="button" class="pe-ctl-value" data-action="pe-edit-value" data-target="simple-field" data-key="${key}" data-min="${min}" data-max="${max}" data-step="${step}" data-value="${escapeAttr(formatted)}" data-title="${escapeAttr(label)}" data-unit="${escapeAttr(unit)}" aria-label="edit ${escapeAttr(label)}">${display}</button>
        <button type="button" class="pe-ctl-step" data-action="pe-simple-nudge" data-key="${key}" data-delta="${step}" aria-label="increase ${escapeAttr(label)}">${icon('plus')}</button>
      </div>
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
      <label class="pe-field pe-notes-field">
        <span>Notes</span>
        <input type="text" data-action="pe-meta" data-key="notes" value="${escapeAttr(state.notes)}" />
      </label>
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
  return `
    <div class="pe-ctl exit ${active ? 'active' : ''}">
      <button type="button" class="pe-ctl-face" data-action="pe-step-exit-preset" data-index="${index}" data-type="${type}" data-condition="${condition}" data-value="${escapeAttr(formatNumber(value || defaultExitValue(type, condition)))}" aria-label="${escapeAttr(label)}">${icon(iconName)}</button>
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
        <path class="pe-de1-main-fill ${isFlow ? 'flow' : 'pressure'}" d="${mainLine}L${(plot.x + plot.w).toFixed(1)} ${(plot.y + plot.h).toFixed(1)}L${plot.x} ${(plot.y + plot.h).toFixed(1)}Z" stroke="none"></path>
        <path class="pe-de1-main-line ${isFlow ? 'flow' : 'pressure'}" d="${mainLine}" fill="none"></path>
        ${nodes.map((point) => `
          <circle class="pe-de1-node ${isFlow ? 'flow' : 'pressure'}" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="6"></circle>
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
