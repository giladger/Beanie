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

/**
 * Normalized persistent profile data used by editor and non-UI domain flows.
 * UI-only session fields such as selectedStep, dirty, tabs, and save notices
 * deliberately do not cross this boundary.
 */
export interface ProfileModel {
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

// de1app caps advanced profiles at 20 steps.
export const MAX_STEPS = 20;

/**
 * Canonical field ranges, mirrored from de1app `machine.tcl` / `vars.tcl` so the
 * editor's limits match the Decent tablet exactly. Single source of truth for
 * min/max/step/default/unit.
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

// de1app flat per-step keys folded into canonical nested exit/limiter values.
// They are consumed rather than copied into `extra` so canonical output never
// contains both representations.
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

// de1app Tcl aliases consumed by decodeProfile. They are excluded from `extra`
// so encodeProfile emits one canonical reaprime representation.
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

/** Decode canonical reaprime or de1app/Tcl profile data into one typed model. */
export function decodeProfile(profile: Profile | null): ProfileModel {
  if (!profile) {
    return {
      title: 'New profile',
      author: '',
      notes: '',
      beverageType: 'espresso',
      type: 'advanced',
      legacyProfileType: 'settings_2c',
      // reaprime requires these two fields on every saved profile.
      tankTemperature: FIELD_SPECS.tankTemperature.default,
      targetWeight: null,
      targetVolume: null,
      targetVolumeCountStart: FIELD_SPECS.targetVolumeCountStart.default,
      version: '2',
      steps: [defaultProfileStep()],
      extra: {}
    };
  }

  const record = profile as Record<string, unknown>;
  // Canonical reaprime steps take precedence. Only a missing canonical array
  // falls back to the tablet's Tcl `advanced_shot` representation.
  const rawSteps = Array.isArray(profile.steps)
    ? profile.steps
    : Array.isArray(record.advanced_shot)
      ? (record.advanced_shot as unknown[])
      : [];
  const decodedSteps = rawSteps.map(decodeProfileStep);
  const type =
    profile.type ??
    profileTypeFromLegacy(profile.legacy_profile_type) ??
    inferProfileTypeFromSteps(decodedSteps);

  return {
    title: stringValue(profile.title) ?? stringValue(record.profile_title) ?? '',
    author: profile.author ?? '',
    notes: stringValue(profile.notes) ?? stringValue(record.profile_notes) ?? '',
    beverageType: profile.beverage_type ?? 'espresso',
    type,
    legacyProfileType: profile.legacy_profile_type ?? legacyProfileTypeFromType(type),
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
    steps: decodedSteps.length > 0 ? decodedSteps : [defaultProfileStep()],
    extra: extraTopLevelFields(profile)
  };
}

/** Encode the normalized model as canonical reaprime v2 profile data. */
export function encodeProfile(model: ProfileModel): Profile {
  const profile: Profile = {
    ...model.extra,
    version: model.version,
    steps: model.steps.map(encodeProfileStep)
  };
  if (model.title) profile.title = model.title;
  if (model.author) profile.author = model.author;
  if (model.notes) profile.notes = model.notes;
  if (model.beverageType) profile.beverage_type = model.beverageType;
  if (model.type) profile.type = model.type;
  if (model.legacyProfileType) profile.legacy_profile_type = model.legacyProfileType;

  // These two fields are mandatory server-side. Clearing an editor control
  // restores its canonical default rather than producing an invalid profile.
  profile.tank_temperature =
    model.tankTemperature ?? FIELD_SPECS.tankTemperature.default;
  profile.target_volume_count_start =
    model.targetVolumeCountStart ?? FIELD_SPECS.targetVolumeCountStart.default;
  if (model.targetWeight != null) profile.target_weight = model.targetWeight;
  if (model.targetVolume != null) profile.target_volume = model.targetVolume;
  return profile;
}

export function defaultProfileStep(): EditorStep {
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

export function profileTypeFromLegacy(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value === 'settings_2a') return 'pressure';
  if (value === 'settings_2b') return 'flow';
  return 'advanced';
}

export function legacyProfileTypeFromType(value: string | undefined): string {
  if (value === 'pressure') return 'settings_2a';
  if (value === 'flow') return 'settings_2b';
  return 'settings_2c';
}

function inferProfileTypeFromSteps(steps: EditorStep[]): string {
  if (!steps.length) return 'advanced';
  const hasPressure = steps.some((step) => step.pump === 'pressure' || step.pressure > 0);
  const hasFlow = steps.some((step) => step.pump === 'flow' || step.flow > 0);
  if (hasFlow && !hasPressure) return 'flow';
  if (hasPressure && !hasFlow) return 'pressure';
  const firstPressure = steps.findIndex((step) => step.pump === 'pressure');
  const flowAfterPressure =
    firstPressure >= 0 &&
    steps.some((step, index) => index > firstPressure && step.pump === 'flow');
  if (hasPressure && hasFlow && firstPressure >= 0 && !flowAfterPressure) return 'pressure';
  return 'advanced';
}

function decodeProfileStep(raw: unknown): EditorStep {
  const record = objectRecord(raw) ?? {};
  const base = defaultProfileStep();
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
    exit: decodeStepExit(record),
    limiter: decodeStepLimiter(record),
    extra
  };
}

function decodeStepExit(record: Record<string, unknown>): StepExit | null {
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
  return value == null ? null : { type, condition, value };
}

function decodeStepLimiter(record: Record<string, unknown>): StepLimiter | null {
  const nested = objectRecord(record.limiter);
  if (nested) {
    const value = numeric(nested.value);
    if (value == null) return null;
    return {
      value,
      range: numeric(nested.range) ?? FIELD_SPECS.limiterRange.default
    };
  }
  const value = numeric(record.max_flow_or_pressure);
  if (value == null || value <= 0) return null;
  return {
    value,
    range:
      numeric(record.max_flow_or_pressure_range) ?? FIELD_SPECS.limiterRange.default
  };
}

function encodeProfileStep(step: EditorStep): Record<string, unknown> {
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
  if (step.exit) {
    out.exit = {
      type: step.exit.type,
      condition: step.exit.condition,
      value: step.exit.value
    };
  } else {
    delete out.exit;
  }
  if (step.limiter) {
    out.limiter = { value: step.limiter.value, range: step.limiter.range };
  } else {
    delete out.limiter;
  }
  return out;
}

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

function isTruthyFlag(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return value === '1' || value.toLowerCase() === 'true';
  return false;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object'
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function numeric(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
