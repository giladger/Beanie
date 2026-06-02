import type { Profile } from '../api/types';

export type ProfileStepDurationKey = 'seconds' | 'duration' | 'time';

export type ProfileMetadataField =
  | 'title'
  | 'author'
  | 'notes'
  | 'beverageType'
  | 'targetWeight'
  | 'targetVolume'
  | 'tankTemperature'
  | 'version';

export type ProfileStepField =
  | 'name'
  | 'temperature'
  | 'pressure'
  | 'flow'
  | 'seconds'
  | 'duration'
  | 'time'
  | 'durationSeconds'
  | 'sensor'
  | 'pump'
  | 'transition'
  | 'exit';

export type ProfileValidationSeverity = 'error' | 'warning';

export interface ProfileValidationIssue {
  path: string;
  message: string;
  severity: ProfileValidationSeverity;
}

export interface EditableProfileMetadata {
  title: string | null;
  author: string | null;
  notes: string | null;
  beverageType: string | null;
  targetWeight: number | null;
  targetVolume: number | null;
  tankTemperature: number | null;
  version: string | null;
}

export interface EditableStepExit {
  enabled: boolean | null;
  type: string | null;
  pressureOver: number | null;
  pressureUnder: number | null;
  flowOver: number | null;
  flowUnder: number | null;
  maxFlowOrPressure: number | null;
  maxFlowOrPressureRange: number | null;
  extra: Record<string, unknown>;
}

export interface EditableProfileStep {
  name: string;
  temperature: number | null;
  pressure: number | null;
  flow: number | null;
  seconds: number | null;
  duration: number | null;
  time: number | null;
  durationSeconds: number | null;
  durationKey: ProfileStepDurationKey;
  sensor: string | null;
  pump: string | null;
  transition: string | null;
  exit: EditableStepExit | null;
  extra: Record<string, unknown>;
}

export interface ProfileEditorSource {
  baseProfile: Record<string, unknown>;
  stepKey: 'steps' | 'advanced_shot';
  metadataKeys: Partial<Record<ProfileMetadataField, string>>;
}

export interface ProfileEditorModel {
  metadata: EditableProfileMetadata;
  steps: EditableProfileStep[];
  source: ProfileEditorSource;
}

const PROFILE_META_KEY_ALIASES: Record<ProfileMetadataField, string[]> = {
  title: ['title', 'profile_title'],
  author: ['author'],
  notes: ['notes', 'profile_notes'],
  beverageType: ['beverage_type'],
  targetWeight: ['target_weight', 'final_desired_shot_weight_advanced', 'final_desired_shot_weight'],
  targetVolume: ['target_volume', 'final_desired_shot_volume_advanced', 'final_desired_shot_volume'],
  tankTemperature: ['tank_temperature', 'tank_desired_water_temperature'],
  version: ['version']
};

const CANONICAL_PROFILE_KEYS: Record<ProfileMetadataField, keyof Profile> = {
  title: 'title',
  author: 'author',
  notes: 'notes',
  beverageType: 'beverage_type',
  targetWeight: 'target_weight',
  targetVolume: 'target_volume',
  tankTemperature: 'tank_temperature',
  version: 'version'
};

const KNOWN_EXIT_KEYS = new Set([
  'exit',
  'exit_if',
  'exit_type',
  'exit_pressure_over',
  'exit_pressure_under',
  'exit_flow_over',
  'exit_flow_under',
  'max_flow_or_pressure',
  'max_flow_or_pressure_range'
]);

const KNOWN_STEP_KEYS = new Set([
  'name',
  'temperature',
  'pressure',
  'flow',
  'seconds',
  'duration',
  'time',
  'sensor',
  'pump',
  'transition',
  ...KNOWN_EXIT_KEYS
]);

export function normalizeProfileForEditing(profile: Profile | null | undefined): ProfileEditorModel {
  const baseProfile = cloneRecord(asRecord(profile) ?? {});
  const metadataKeys = metadataSourceKeys(baseProfile);
  const stepKey = Array.isArray(baseProfile.steps) ? 'steps' : 'advanced_shot';
  const rawSteps = Array.isArray(baseProfile.steps)
    ? baseProfile.steps
    : Array.isArray(baseProfile.advanced_shot)
      ? baseProfile.advanced_shot
      : [];

  return {
    metadata: readMetadata(baseProfile, metadataKeys),
    steps: rawSteps.map((step, index) => readStep(step, index)),
    source: {
      baseProfile,
      stepKey,
      metadataKeys
    }
  };
}

export function serializeProfileEditor(model: ProfileEditorModel): Profile {
  const out: Record<string, unknown> = cloneRecord(model.source.baseProfile);
  writeMetadata(out, model.metadata, model.source.metadataKeys);
  out[model.source.stepKey] = model.steps.map(writeStep);
  if (model.source.stepKey === 'steps') {
    delete out.advanced_shot;
  } else {
    delete out.steps;
  }
  return out as Profile;
}

export function updateProfileMetadata(
  model: ProfileEditorModel,
  field: ProfileMetadataField,
  value: string | number | null
): ProfileEditorModel {
  const metadata = { ...model.metadata };
  switch (field) {
    case 'targetWeight':
    case 'targetVolume':
    case 'tankTemperature':
      metadata[field] = numberOrNull(value);
      break;
    case 'title':
    case 'author':
    case 'notes':
    case 'beverageType':
    case 'version':
      metadata[field] = value == null ? null : String(value);
      break;
  }
  return { ...model, metadata };
}

export function addProfileStep(
  model: ProfileEditorModel,
  step: Partial<EditableProfileStep> = {}
): ProfileEditorModel {
  return {
    ...model,
    steps: [...model.steps, { ...defaultStep(model.steps.length), ...cloneStepPatch(step) }]
  };
}

export function duplicateProfileStep(model: ProfileEditorModel, index: number): ProfileEditorModel {
  if (!isValidIndex(model.steps, index)) return model;
  const copy = cloneStep(model.steps[index]!);
  const steps = [...model.steps];
  steps.splice(index + 1, 0, copy);
  return { ...model, steps };
}

export function deleteProfileStep(model: ProfileEditorModel, index: number): ProfileEditorModel {
  if (!isValidIndex(model.steps, index)) return model;
  return { ...model, steps: model.steps.filter((_, stepIndex) => stepIndex !== index) };
}

export function moveProfileStep(
  model: ProfileEditorModel,
  fromIndex: number,
  toIndex: number
): ProfileEditorModel {
  if (!isValidIndex(model.steps, fromIndex) || !isValidIndex(model.steps, toIndex)) return model;
  if (fromIndex === toIndex) return model;
  const steps = [...model.steps];
  const [moved] = steps.splice(fromIndex, 1);
  steps.splice(toIndex, 0, moved!);
  return { ...model, steps };
}

export function updateProfileStepField(
  model: ProfileEditorModel,
  index: number,
  field: ProfileStepField | string,
  value: unknown
): ProfileEditorModel {
  if (!isValidIndex(model.steps, index)) return model;
  const steps = model.steps.map((step, stepIndex) =>
    stepIndex === index ? updateStepField(step, field, value) : step
  );
  return { ...model, steps };
}

export function validateProfileEditor(model: ProfileEditorModel): ProfileValidationIssue[] {
  const issues: ProfileValidationIssue[] = [];

  validateOptionalNumber(model.metadata.tankTemperature, '$.metadata.tankTemperature', issues, {
    min: 0,
    max: 110,
    severity: 'warning',
    label: 'Tank temperature'
  });
  validateOptionalNumber(model.metadata.targetWeight, '$.metadata.targetWeight', issues, {
    min: 0,
    max: 250,
    severity: 'warning',
    label: 'Target weight'
  });
  validateOptionalNumber(model.metadata.targetVolume, '$.metadata.targetVolume', issues, {
    min: 0,
    max: 1000,
    severity: 'warning',
    label: 'Target volume'
  });

  if (model.steps.length === 0) {
    issues.push({
      path: '$.steps',
      message: 'Profile has no advanced steps to edit',
      severity: 'warning'
    });
  }

  model.steps.forEach((step, index) => validateStep(step, index, issues));
  return issues;
}

export function defaultProfileStep(index = 0): EditableProfileStep {
  return defaultStep(index);
}

function readMetadata(
  profile: Record<string, unknown>,
  metadataKeys: Partial<Record<ProfileMetadataField, string>>
): EditableProfileMetadata {
  return {
    title: stringOrNull(readProfileField(profile, metadataKeys.title)),
    author: stringOrNull(readProfileField(profile, metadataKeys.author)),
    notes: stringOrNull(readProfileField(profile, metadataKeys.notes)),
    beverageType: stringOrNull(readProfileField(profile, metadataKeys.beverageType)),
    targetWeight: numberOrNull(readProfileField(profile, metadataKeys.targetWeight)),
    targetVolume: numberOrNull(readProfileField(profile, metadataKeys.targetVolume)),
    tankTemperature: numberOrNull(readProfileField(profile, metadataKeys.tankTemperature)),
    version: stringOrNull(readProfileField(profile, metadataKeys.version))
  };
}

function writeMetadata(
  out: Record<string, unknown>,
  metadata: EditableProfileMetadata,
  metadataKeys: Partial<Record<ProfileMetadataField, string>>
): void {
  writeMetadataField(out, metadataKeys, 'title', metadata.title);
  writeMetadataField(out, metadataKeys, 'author', metadata.author);
  writeMetadataField(out, metadataKeys, 'notes', metadata.notes);
  writeMetadataField(out, metadataKeys, 'beverageType', metadata.beverageType);
  writeMetadataField(out, metadataKeys, 'targetWeight', metadata.targetWeight);
  writeMetadataField(out, metadataKeys, 'targetVolume', metadata.targetVolume);
  writeMetadataField(out, metadataKeys, 'tankTemperature', metadata.tankTemperature);
  writeMetadataField(out, metadataKeys, 'version', metadata.version);
}

function writeMetadataField(
  out: Record<string, unknown>,
  metadataKeys: Partial<Record<ProfileMetadataField, string>>,
  field: ProfileMetadataField,
  value: string | number | null
): void {
  const canonicalKey = CANONICAL_PROFILE_KEYS[field];
  setOrDelete(out, canonicalKey, value);
  const sourceKey = metadataKeys[field];
  if (sourceKey && sourceKey !== canonicalKey) {
    setOrDelete(out, sourceKey, value);
  }
}

function readStep(raw: unknown, index: number): EditableProfileStep {
  const record = asRecord(raw) ?? {};
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!KNOWN_STEP_KEYS.has(key)) extra[key] = cloneValue(value);
  }

  const seconds = numberOrNull(record.seconds);
  const duration = numberOrNull(record.duration);
  const time = numberOrNull(record.time);
  const durationKey = durationKeyFor(record);
  return {
    name: stringOrNull(record.name) ?? `Step ${index + 1}`,
    temperature: numberOrNull(record.temperature),
    pressure: numberOrNull(record.pressure),
    flow: numberOrNull(record.flow),
    seconds,
    duration,
    time,
    durationSeconds: seconds ?? duration ?? time,
    durationKey,
    sensor: stringOrNull(record.sensor),
    pump: stringOrNull(record.pump),
    transition: stringOrNull(record.transition),
    exit: readExit(record),
    extra
  };
}

function writeStep(step: EditableProfileStep): Record<string, unknown> {
  const out: Record<string, unknown> = cloneRecord(step.extra);
  setOrDelete(out, 'name', step.name);
  setOrDelete(out, 'temperature', step.temperature);
  setOrDelete(out, 'pressure', step.pressure);
  setOrDelete(out, 'flow', step.flow);
  setOrDelete(out, 'sensor', step.sensor);
  setOrDelete(out, 'pump', step.pump);
  setOrDelete(out, 'transition', step.transition);
  setOrDelete(out, 'seconds', step.seconds);
  setOrDelete(out, 'duration', step.duration);
  setOrDelete(out, 'time', step.time);
  writeExit(out, step.exit);
  return out;
}

function readExit(record: Record<string, unknown>): EditableStepExit | null {
  const nested = asRecord(record.exit);
  const hasFlatExit = [...KNOWN_EXIT_KEYS].some((key) => key !== 'exit' && key in record);
  if (!nested && !hasFlatExit) return null;

  const extra: Record<string, unknown> = {};
  if (nested) {
    for (const [key, value] of Object.entries(nested)) {
      if (
        ![
          'enabled',
          'type',
          'pressureOver',
          'pressureUnder',
          'flowOver',
          'flowUnder',
          'maxFlowOrPressure',
          'maxFlowOrPressureRange'
        ].includes(key)
      ) {
        extra[key] = cloneValue(value);
      }
    }
  }

  return {
    enabled: booleanOrNull(nested?.enabled) ?? booleanish(record.exit_if),
    type: stringOrNull(nested?.type) ?? stringOrNull(record.exit_type),
    pressureOver: numberOrNull(nested?.pressureOver) ?? numberOrNull(record.exit_pressure_over),
    pressureUnder: numberOrNull(nested?.pressureUnder) ?? numberOrNull(record.exit_pressure_under),
    flowOver: numberOrNull(nested?.flowOver) ?? numberOrNull(record.exit_flow_over),
    flowUnder: numberOrNull(nested?.flowUnder) ?? numberOrNull(record.exit_flow_under),
    maxFlowOrPressure:
      numberOrNull(nested?.maxFlowOrPressure) ?? numberOrNull(record.max_flow_or_pressure),
    maxFlowOrPressureRange:
      numberOrNull(nested?.maxFlowOrPressureRange) ?? numberOrNull(record.max_flow_or_pressure_range),
    extra
  };
}

function writeExit(out: Record<string, unknown>, exit: EditableStepExit | null): void {
  delete out.exit;
  delete out.exit_if;
  delete out.exit_type;
  delete out.exit_pressure_over;
  delete out.exit_pressure_under;
  delete out.exit_flow_over;
  delete out.exit_flow_under;
  delete out.max_flow_or_pressure;
  delete out.max_flow_or_pressure_range;
  if (!exit) return;

  setOrDelete(out, 'exit_if', exit.enabled == null ? null : exit.enabled ? 1 : 0);
  setOrDelete(out, 'exit_type', exit.type);
  setOrDelete(out, 'exit_pressure_over', exit.pressureOver);
  setOrDelete(out, 'exit_pressure_under', exit.pressureUnder);
  setOrDelete(out, 'exit_flow_over', exit.flowOver);
  setOrDelete(out, 'exit_flow_under', exit.flowUnder);
  setOrDelete(out, 'max_flow_or_pressure', exit.maxFlowOrPressure);
  setOrDelete(out, 'max_flow_or_pressure_range', exit.maxFlowOrPressureRange);
  if (Object.keys(exit.extra).length > 0) {
    out.exit = cloneRecord(exit.extra);
  }
}

function updateStepField(step: EditableProfileStep, field: ProfileStepField | string, value: unknown): EditableProfileStep {
  switch (field) {
    case 'name':
      return { ...step, name: value == null ? '' : String(value) };
    case 'temperature':
    case 'pressure':
    case 'flow':
    case 'seconds':
    case 'duration':
    case 'time':
      return { ...step, [field]: numberOrNull(value), durationSeconds: nextDurationSeconds(step, field, value) };
    case 'durationSeconds':
      return updateDurationSeconds(step, numberOrNull(value));
    case 'sensor':
    case 'pump':
    case 'transition':
      return { ...step, [field]: value == null ? null : String(value) };
    case 'exit':
      return { ...step, exit: readExitField(value) };
    default:
      return { ...step, extra: { ...step.extra, [field]: cloneValue(value) } };
  }
}

function readExitField(value: unknown): EditableStepExit | null {
  if (value == null) return null;
  const record = asRecord(value);
  if (!record) return null;
  return {
    enabled: booleanOrNull(record.enabled),
    type: stringOrNull(record.type),
    pressureOver: numberOrNull(record.pressureOver),
    pressureUnder: numberOrNull(record.pressureUnder),
    flowOver: numberOrNull(record.flowOver),
    flowUnder: numberOrNull(record.flowUnder),
    maxFlowOrPressure: numberOrNull(record.maxFlowOrPressure),
    maxFlowOrPressureRange: numberOrNull(record.maxFlowOrPressureRange),
    extra: cloneRecord(asRecord(record.extra) ?? {})
  };
}

function nextDurationSeconds(
  step: EditableProfileStep,
  field: ProfileStepField | string,
  value: unknown
): number | null {
  if (field !== step.durationKey) return step.durationSeconds;
  return numberOrNull(value);
}

function updateDurationSeconds(step: EditableProfileStep, value: number | null): EditableProfileStep {
  return {
    ...step,
    durationSeconds: value,
    [step.durationKey]: value
  };
}

function validateStep(
  step: EditableProfileStep,
  index: number,
  issues: ProfileValidationIssue[]
): void {
  const path = `$.steps[${index}]`;
  if (step.name.trim() === '') {
    issues.push({ path: `${path}.name`, message: 'Step name is empty', severity: 'warning' });
  }
  validateOptionalNumber(step.temperature, `${path}.temperature`, issues, {
    min: 0,
    max: 110,
    severity: 'warning',
    label: 'Temperature'
  });
  validateOptionalNumber(step.pressure, `${path}.pressure`, issues, {
    min: -0.01,
    max: 15,
    severity: 'warning',
    label: 'Pressure'
  });
  validateOptionalNumber(step.flow, `${path}.flow`, issues, {
    min: -0.01,
    max: 15,
    severity: 'warning',
    label: 'Flow'
  });
  validateOptionalNumber(step.durationSeconds, `${path}.durationSeconds`, issues, {
    min: 0,
    max: 600,
    severity: 'warning',
    label: 'Duration'
  });
  if (step.sensor != null && !['coffee', 'water'].includes(step.sensor)) {
    issues.push({
      path: `${path}.sensor`,
      message: `Unexpected sensor "${step.sensor}"`,
      severity: 'warning'
    });
  }
  if (step.pump != null && !['pressure', 'flow'].includes(step.pump)) {
    issues.push({
      path: `${path}.pump`,
      message: `Unexpected pump "${step.pump}"`,
      severity: 'warning'
    });
  }
  if (step.transition != null && !['fast', 'smooth'].includes(step.transition)) {
    issues.push({
      path: `${path}.transition`,
      message: `Unexpected transition "${step.transition}"`,
      severity: 'warning'
    });
  }
}

function validateOptionalNumber(
  value: number | null,
  path: string,
  issues: ProfileValidationIssue[],
  opts: { min: number; max: number; severity: ProfileValidationSeverity; label: string }
): void {
  if (value == null) return;
  if (!Number.isFinite(value)) {
    issues.push({ path, message: `${opts.label} is not a finite number`, severity: 'error' });
    return;
  }
  if (value < opts.min || value > opts.max) {
    issues.push({
      path,
      message: `${opts.label} ${value} is outside the usual Decent profile range`,
      severity: opts.severity
    });
  }
}

function defaultStep(index: number): EditableProfileStep {
  return {
    name: `Step ${index + 1}`,
    temperature: 93,
    pressure: 9,
    flow: 6,
    seconds: 30,
    duration: null,
    time: null,
    durationSeconds: 30,
    durationKey: 'seconds',
    sensor: 'coffee',
    pump: 'pressure',
    transition: 'fast',
    exit: null,
    extra: {}
  };
}

function cloneStepPatch(step: Partial<EditableProfileStep>): Partial<EditableProfileStep> {
  return {
    ...step,
    exit: step.exit ? cloneExit(step.exit) : step.exit,
    extra: step.extra ? cloneRecord(step.extra) : step.extra
  };
}

function cloneStep(step: EditableProfileStep): EditableProfileStep {
  return {
    ...step,
    exit: step.exit ? cloneExit(step.exit) : null,
    extra: cloneRecord(step.extra)
  };
}

function cloneExit(exit: EditableStepExit): EditableStepExit {
  return {
    ...exit,
    extra: cloneRecord(exit.extra)
  };
}

function metadataSourceKeys(profile: Record<string, unknown>): Partial<Record<ProfileMetadataField, string>> {
  const out: Partial<Record<ProfileMetadataField, string>> = {};
  for (const [field, aliases] of Object.entries(PROFILE_META_KEY_ALIASES) as Array<
    [ProfileMetadataField, string[]]
  >) {
    const sourceKey = aliases.find((key) => key in profile);
    if (sourceKey) out[field] = sourceKey;
  }
  return out;
}

function readProfileField(profile: Record<string, unknown>, key: string | undefined): unknown {
  return key ? profile[key] : undefined;
}

function durationKeyFor(record: Record<string, unknown>): ProfileStepDurationKey {
  if ('seconds' in record) return 'seconds';
  if ('duration' in record) return 'duration';
  if ('time' in record) return 'time';
  return 'seconds';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function cloneRecord(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] = cloneValue(value);
  }
  return out;
}

function cloneValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneValue);
  const record = asRecord(value);
  if (record) return cloneRecord(record);
  return value;
}

function setOrDelete(out: Record<string, unknown>, key: string, value: unknown): void {
  if (value == null) {
    delete out[key];
  } else {
    out[key] = value;
  }
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringOrNull(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function booleanish(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value !== 0;
  if (typeof value === 'string') {
    if (value === '1' || value.toLowerCase() === 'true') return true;
    if (value === '0' || value.toLowerCase() === 'false') return false;
  }
  return null;
}

function isValidIndex<T>(items: T[], index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < items.length;
}
