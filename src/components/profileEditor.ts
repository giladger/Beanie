import type { Profile } from '../api/types';

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
  const steps = [...state.steps, defaultStep()];
  return { ...state, steps, selectedStep: steps.length - 1, dirty: true };
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
      ${renderStepList(state)}
      ${renderStepDetail(state)}
    </div>
  `;
}

function renderMeta(state: ProfileEditorState): string {
  return `
    <section class="pe-meta">
      <h2>Profile</h2>
      <label class="pe-field">
        <span>Title</span>
        <input type="text" data-action="pe-meta" data-key="title" value="${escapeAttr(state.title)}" />
      </label>
      <label class="pe-field">
        <span>Author</span>
        <input type="text" data-action="pe-meta" data-key="author" value="${escapeAttr(state.author)}" />
      </label>
      <label class="pe-field">
        <span>Beverage type</span>
        <select data-action="pe-meta" data-key="beverage_type">
          ${PROFILE_BEVERAGE_TYPES.map((type) => `
            <option value="${escapeAttr(type)}" ${type === state.beverageType ? 'selected' : ''}>${escapeHtml(type)}</option>
          `).join('')}
        </select>
      </label>
      <label class="pe-field">
        <span>Tank temperature (°C)</span>
        <input type="number" step="0.1" data-action="pe-meta" data-key="tank_temperature" value="${escapeAttr(numberText(state.tankTemperature))}" />
      </label>
      <label class="pe-field">
        <span>Target weight (g)</span>
        <input type="number" step="0.1" data-action="pe-meta" data-key="target_weight" value="${escapeAttr(numberText(state.targetWeight))}" />
      </label>
      <label class="pe-field">
        <span>Target volume (ml)</span>
        <input type="number" step="1" data-action="pe-meta" data-key="target_volume" value="${escapeAttr(numberText(state.targetVolume))}" />
      </label>
      <label class="pe-field">
        <span>Notes</span>
        <textarea data-action="pe-meta" data-key="notes" rows="3">${escapeHtml(state.notes)}</textarea>
      </label>
    </section>
  `;
}

function renderStepList(state: ProfileEditorState): string {
  return `
    <section class="pe-steps">
      <div class="pe-steps-head">
        <h2>Steps</h2>
        <button type="button" data-action="pe-add-step">Add step</button>
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
  return `
    <li class="pe-step-row ${index === state.selectedStep ? 'active' : ''}">
      <button type="button" class="pe-step-select" data-action="pe-select-step" data-index="${index}">
        <strong>${escapeHtml(step.name || `Step ${index + 1}`)}</strong>
        <span>${escapeHtml(step.pump)} ${escapeHtml(target)}</span>
        <span>${escapeHtml(formatNumber(step.temperature))} °C</span>
        <span>${escapeHtml(formatNumber(step.seconds))} s</span>
      </button>
      <span class="pe-step-actions">
        <button type="button" data-action="pe-move-step" data-index="${index}" data-value="-1" aria-label="Move up">↑</button>
        <button type="button" data-action="pe-move-step" data-index="${index}" data-value="1" aria-label="Move down">↓</button>
        <button type="button" data-action="pe-remove-step" data-index="${index}" aria-label="Remove step">✕</button>
      </span>
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
      <h2>Edit step ${index + 1}</h2>
      <label class="pe-field">
        <span>Name</span>
        <input type="text" data-action="pe-step-field" data-index="${index}" data-key="name" value="${escapeAttr(step.name)}" />
      </label>
      <div class="pe-field-group">
        <label class="pe-field">
          <span>Temperature (°C)</span>
          <input type="number" step="0.1" data-action="pe-step-field" data-index="${index}" data-key="temperature" value="${escapeAttr(formatNumber(step.temperature))}" />
        </label>
        <label class="pe-field">
          <span>Sensor</span>
          <select data-action="pe-step-field" data-index="${index}" data-key="sensor">
            <option value="coffee" ${step.sensor === 'coffee' ? 'selected' : ''}>Coffee</option>
            <option value="water" ${step.sensor === 'water' ? 'selected' : ''}>Water</option>
          </select>
        </label>
      </div>
      <div class="pe-field-group">
        <span class="pe-toggle" role="group" aria-label="Pump target">
          <button type="button" class="${!isFlow ? 'active' : ''}" data-action="pe-step-pump" data-index="${index}" data-value="pressure">Pressure</button>
          <button type="button" class="${isFlow ? 'active' : ''}" data-action="pe-step-pump" data-index="${index}" data-value="flow">Flow</button>
        </span>
        <label class="pe-field">
          <span>${isFlow ? 'Flow (ml/s)' : 'Pressure (bar)'}</span>
          <input type="number" step="0.1" data-action="pe-step-field" data-index="${index}" data-key="${isFlow ? 'flow' : 'pressure'}" value="${escapeAttr(formatNumber(isFlow ? step.flow : step.pressure))}" />
        </label>
      </div>
      <div class="pe-field-group">
        <span class="pe-toggle" role="group" aria-label="Transition">
          <button type="button" class="${step.transition === 'fast' ? 'active' : ''}" data-action="pe-step-transition" data-index="${index}" data-value="fast">Fast</button>
          <button type="button" class="${step.transition === 'smooth' ? 'active' : ''}" data-action="pe-step-transition" data-index="${index}" data-value="smooth">Smooth</button>
        </span>
      </div>
      <div class="pe-field-group">
        <label class="pe-field">
          <span>Max seconds</span>
          <input type="number" step="1" data-action="pe-step-field" data-index="${index}" data-key="seconds" value="${escapeAttr(formatNumber(step.seconds))}" />
        </label>
        <label class="pe-field">
          <span>Volume limit (ml, 0 = none)</span>
          <input type="number" step="1" data-action="pe-step-field" data-index="${index}" data-key="volume" value="${escapeAttr(formatNumber(step.volume))}" />
        </label>
      </div>
      ${renderExit(step, index)}
    </section>
  `;
}

function renderExit(step: EditorStep, index: number): string {
  const enabled = step.exit !== null;
  const exit = step.exit ?? { type: 'pressure' as StepExitType, condition: 'over' as StepExitCondition, value: 0 };
  return `
    <fieldset class="pe-step-exit">
      <legend>Exit condition</legend>
      <label class="pe-checkbox">
        <input type="checkbox" data-action="pe-step-exit" data-index="${index}" data-key="enabled" ${enabled ? 'checked' : ''} />
        <span>Exit early</span>
      </label>
      ${enabled ? `
        <div class="pe-field-group">
          <label class="pe-field">
            <span>Type</span>
            <select data-action="pe-step-exit" data-index="${index}" data-key="type">
              <option value="pressure" ${exit.type === 'pressure' ? 'selected' : ''}>Pressure</option>
              <option value="flow" ${exit.type === 'flow' ? 'selected' : ''}>Flow</option>
            </select>
          </label>
          <label class="pe-field">
            <span>Condition</span>
            <select data-action="pe-step-exit" data-index="${index}" data-key="condition">
              <option value="over" ${exit.condition === 'over' ? 'selected' : ''}>Over</option>
              <option value="under" ${exit.condition === 'under' ? 'selected' : ''}>Under</option>
            </select>
          </label>
          <label class="pe-field">
            <span>Value</span>
            <input type="number" step="0.1" data-action="pe-step-exit" data-index="${index}" data-key="value" value="${escapeAttr(formatNumber(exit.value))}" />
          </label>
        </div>
      ` : ''}
    </fieldset>
  `;
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

function numberText(value: number | null): string {
  return value == null ? '' : formatNumber(value);
}

function formatNumber(value: number): string {
  return value.toString();
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
