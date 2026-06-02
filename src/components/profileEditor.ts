import type { Profile } from '../api/types';
import { icon } from './icons';

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
      dirty: false,
      extra: {}
    };
  }

  const steps = Array.isArray(profile.steps) ? profile.steps.map(readStep) : [];
  const extra = extraTopLevelFields(profile);
  return {
    title: profile.title ?? '',
    author: profile.author ?? '',
    notes: profile.notes ?? '',
    beverageType: profile.beverage_type ?? 'espresso',
    type: profile.type ?? typeFromLegacy(profile.legacy_profile_type),
    legacyProfileType: profile.legacy_profile_type ?? legacyFromType(profile.type),
    tankTemperature: numeric(profile.tank_temperature),
    targetWeight: numeric(profile.target_weight),
    targetVolume: numeric(profile.target_volume),
    targetVolumeCountStart: numeric(profile.target_volume_count_start),
    version: profile.version ?? '2',
    steps: steps.length > 0 ? steps : [defaultStep()],
    selectedStep: 0,
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

  const next: Partial<ProfileEditorState> =
    key === 'title'
      ? { title: value }
      : key === 'author'
        ? { author: value }
        : key === 'notes'
          ? { notes: value }
          : key === 'beverage_type'
            ? { beverageType: value }
            : key === 'type'
              ? { type: value, legacyProfileType: legacyFromType(value) }
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
  return `
    <div class="profile-editor">
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
      <div class="pe-step-editor-board">
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
        <div class="pe-advanced-controls top">
          ${renderVerticalControl(index, 'temperature', '1: Temperature', step.temperature, '°C', 1, 105, 0.5, 'thermometer', 'red')}
          ${renderToggleTile(index, 'sensor', 'sensor', step.sensor, step.sensor === 'water' ? 'droplets' : 'coffee')}
          ${renderGoalControl(index, 'flow', isFlow ? 'flow' : 'flow limit', isFlow ? step.flow : (step.limiter?.value ?? 0), 'ml/s', 0, 12, isFlow)}
          ${renderGoalControl(index, 'pressure', isFlow ? 'pressure limit' : 'pressure', isFlow ? (step.limiter?.value ?? 0) : step.pressure, 'bar', 0, 12, !isFlow)}
          ${renderToggleTile(index, 'transition', 'transition', step.transition, step.transition === 'smooth' ? 'waves' : 'move-right')}
        </div>
        <div class="pe-advanced-controls bottom">
          ${renderVerticalControl(index, 'seconds', 'time', step.seconds, 's', 0, 127, 1, 'timer', 'stage')}
          ${renderVerticalControl(index, 'volume', 'volume', step.volume, 'ml', 0, 1023, 1, 'beaker', 'blue')}
          ${renderVerticalControl(index, 'weight', 'weight', step.weight, 'g', 0, 1000, 0.1, 'scale', 'amber')}
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
  const centerAttrs = centerAction
    ? `data-action="${centerAction.action}" data-index="${index}" data-value="${escapeAttr(centerAction.value)}"`
    : '';
  return `
    <div class="pe-vertical-control ${escapeAttr(tone)} ${centerAction?.active ? 'active' : ''}">
      <button type="button" class="pe-v-plus" data-action="pe-step-nudge" data-index="${index}" data-key="${key}" data-delta="${step}">${icon('plus')}</button>
      <div class="pe-v-body">
        <input class="pe-v-slider" type="range" min="${min}" max="${max}" step="${step}" data-action="pe-step-field" data-index="${index}" data-key="${key}" value="${escapeAttr(formatted)}" aria-label="${escapeAttr(label)}" />
        <button type="button" class="pe-v-center" ${centerAttrs} aria-label="${escapeAttr(label)}">
          ${icon(iconName)}
        </button>
      </div>
      <button type="button" class="pe-v-minus" data-action="pe-step-nudge" data-index="${index}" data-key="${key}" data-delta="${-step}">${icon('minus')}</button>
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(formatted)}${unit ? ` ${escapeHtml(unit)}` : ''}</strong>
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
    <div class="pe-toggle-tile">
      <button type="button" class="pe-v-center" data-action="${action}" data-index="${index}" aria-label="${escapeAttr(label)}">
        ${icon(iconName)}
      </button>
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
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
  return `
    <div class="pe-vertical-control exit ${active ? 'active' : ''}">
      <button type="button" class="pe-v-plus" data-action="pe-step-exit-nudge" data-index="${index}" data-type="${type}" data-condition="${condition}" data-delta="0.1">${icon('plus')}</button>
      <div class="pe-v-body">
        <input class="pe-v-slider" type="range" min="0" max="${max}" step="0.1" data-action="pe-step-exit" data-index="${index}" data-key="value" data-type="${type}" data-condition="${condition}" value="${escapeAttr(formatNumber(value))}" aria-label="${escapeAttr(label)}" />
        <button type="button" class="pe-v-center" data-action="pe-step-exit-preset" data-index="${index}" data-type="${type}" data-condition="${condition}" data-value="${escapeAttr(formatNumber(value || defaultExitValue(type, condition)))}" aria-label="${escapeAttr(label)}">
          ${icon(type === 'pressure' ? (condition === 'over' ? 'arrow-up-to-line' : 'arrow-down-to-line') : 'droplets')}
        </button>
      </div>
      <button type="button" class="pe-v-minus" data-action="pe-step-exit-nudge" data-index="${index}" data-type="${type}" data-condition="${condition}" data-delta="-0.1">${icon('minus')}</button>
      <span>${escapeHtml(type)}</span>
      <small>is ${escapeHtml(condition)}</small>
      <strong>${active ? `${escapeHtml(formatNumber(value))} ${unit}` : '-'}</strong>
    </div>
  `;
}

function renderProfileChart(state: ProfileEditorState): string {
  const width = 360;
  const height = 210;
  const plot = { x: 18, y: 18, w: 324, h: 150 };
  const totalSeconds = Math.max(1, state.steps.reduce((sum, step) => sum + Math.max(0, step.seconds || 0), 0));
  const pressure = steppedSeries(state, (step) => step.pressure, totalSeconds, plot, 12);
  const flow = steppedSeries(state, (step) => step.flow, totalSeconds, plot, 12);
  const temp = steppedSeries(state, (step) => step.temperature / 10, totalSeconds, plot, 12);
  const selected = selectedStepBand(state, totalSeconds, plot);
  return `
    <section class="pe-chart-panel" aria-label="Profile preview">
      <svg class="pe-profile-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Pressure, flow, and temperature profile">
        <rect class="pe-chart-bg" x="${plot.x}" y="${plot.y}" width="${plot.w}" height="${plot.h}" rx="4"></rect>
        ${[0, 0.25, 0.5, 0.75, 1].map((tick) => `
          <line class="pe-chart-grid" x1="${plot.x}" x2="${plot.x + plot.w}" y1="${plot.y + plot.h * tick}" y2="${plot.y + plot.h * tick}"></line>
        `).join('')}
        ${selected}
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

function steppedSeries(
  state: ProfileEditorState,
  pick: (step: EditorStep) => number,
  totalSeconds: number,
  plot: { x: number; y: number; w: number; h: number },
  maxValue: number
): string {
  let elapsed = 0;
  let path = '';
  state.steps.forEach((step, index) => {
    const duration = Math.max(1, step.seconds || 1);
    const x0 = plot.x + (elapsed / totalSeconds) * plot.w;
    elapsed += duration;
    const x1 = plot.x + (elapsed / totalSeconds) * plot.w;
    const y = plot.y + plot.h - clamp01(pick(step) / maxValue) * plot.h;
    path += `${index === 0 ? 'M' : 'L'}${x0.toFixed(1)} ${y.toFixed(1)}L${x1.toFixed(1)} ${y.toFixed(1)}`;
  });
  return path;
}

function selectedStepBand(
  state: ProfileEditorState,
  totalSeconds: number,
  plot: { x: number; y: number; w: number; h: number }
): string {
  let elapsed = 0;
  for (let i = 0; i < state.steps.length; i += 1) {
    const step = state.steps[i]!;
    const duration = Math.max(1, step.seconds || 1);
    if (i === state.selectedStep) {
      const x = plot.x + (elapsed / totalSeconds) * plot.w;
      const width = Math.max(4, (duration / totalSeconds) * plot.w);
      return `<rect class="pe-chart-selected" x="${x.toFixed(1)}" y="${plot.y}" width="${width.toFixed(1)}" height="${plot.h}"></rect>`;
    }
    elapsed += duration;
  }
  return '';
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

function readStep(raw: unknown): EditorStep {
  const record = objectRecord(raw) ?? {};
  const base = defaultStep();
  const extra: Record<string, unknown> = {};
  for (const key of Object.keys(record)) {
    if (!KNOWN_STEP_KEYS.has(key)) extra[key] = record[key];
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
    exit: readExit(record.exit),
    limiter: readLimiter(record.limiter),
    extra
  };
}

function readExit(raw: unknown): StepExit | null {
  const record = objectRecord(raw);
  if (!record) return null;
  const value = numeric(record.value);
  if (value == null) return null;
  return {
    type: record.type === 'flow' ? 'flow' : 'pressure',
    condition: record.condition === 'under' ? 'under' : 'over',
    value
  };
}

function readLimiter(raw: unknown): StepLimiter | null {
  const record = objectRecord(raw);
  if (!record) return null;
  const value = numeric(record.value);
  if (value == null) return null;
  return { value, range: numeric(record.range) ?? 0.6 };
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

function extraTopLevelFields(profile: Profile): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(profile)) {
    if (!TOP_LEVEL_PROFILE_KEYS.has(key)) extra[key] = value;
  }
  return extra;
}

function typeFromLegacy(value: string | undefined): string {
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
