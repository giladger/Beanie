import type {
  Bean,
  BeanBatch,
  De1MachineSettings,
  Grinder,
  MachineCapabilities,
  MachineInfo,
  PaginatedShots,
  ProfileRecord,
  ShotRecord,
  Workflow
} from './types';

export interface ValidationIssue {
  path: string;
  message: string;
}

export class ApiValidationError extends Error {
  constructor(
    readonly label: string,
    readonly issues: ValidationIssue[]
  ) {
    super(`${label} response did not match the expected shape`);
    this.name = 'ApiValidationError';
  }
}

export type ApiResponseGuard<T> = (value: unknown) => T;

export function readBean(value: unknown): Bean {
  return checked('Bean', value, validateBean);
}

export function readBeans(value: unknown): Bean[] {
  return checked('Bean[]', value, (candidate, path, issues) =>
    validateArray(candidate, path, issues, validateBean)
  );
}

export function readBatches(value: unknown): BeanBatch[] {
  return checked('BeanBatch[]', value, (candidate, path, issues) =>
    validateArray(candidate, path, issues, validateBeanBatch)
  );
}

export function readBatch(value: unknown): BeanBatch {
  return checked('BeanBatch', value, validateBeanBatch);
}

export function readGrinder(value: unknown): Grinder {
  return checked('Grinder', value, validateGrinder);
}

export function readGrinders(value: unknown): Grinder[] {
  return checked('Grinder[]', value, (candidate, path, issues) =>
    validateArray(candidate, path, issues, validateGrinder)
  );
}

export function readProfiles(value: unknown): ProfileRecord[] {
  return checked('ProfileRecord[]', value, (candidate, path, issues) =>
    validateArray(candidate, path, issues, validateProfileRecord)
  );
}

export function readProfile(value: unknown): ProfileRecord {
  return checked('ProfileRecord', value, validateProfileRecord);
}

export function readWorkflow(value: unknown): Workflow {
  return checked('Workflow', value, validateWorkflow);
}

export function readMachineCapabilities(value: unknown): MachineCapabilities {
  return checked('MachineCapabilities', value, validateMachineCapabilities);
}

export function readDe1MachineSettings(value: unknown): De1MachineSettings {
  return checked('De1MachineSettings', value, validateDe1MachineSettings);
}

export function readMachineInfo(value: unknown): MachineInfo {
  return checked('MachineInfo', value, validateMachineInfo);
}

export function readPaginatedShots(value: unknown): PaginatedShots {
  return checked('PaginatedShots', value, validatePaginatedShots);
}

export function readShotRecord(value: unknown): ShotRecord {
  return checked('ShotRecord', value, validateShotRecord);
}

function checked<T>(
  label: string,
  value: unknown,
  validator: (value: unknown, path: string, issues: ValidationIssue[]) => void
): T {
  const issues: ValidationIssue[] = [];
  validator(value, '$', issues);
  if (issues.length > 0) throw new ApiValidationError(label, issues);
  return value as T;
}

function validateBean(value: unknown, path: string, issues: ValidationIssue[]): void {
  const obj = expectRecord(value, path, issues);
  if (!obj) return;

  requiredString(obj, 'id', path, issues);
  requiredString(obj, 'roaster', path, issues);
  requiredString(obj, 'name', path, issues);
  optionalString(obj, 'species', path, issues, true);
  optionalBoolean(obj, 'decaf', path, issues);
  optionalString(obj, 'country', path, issues, true);
  optionalString(obj, 'region', path, issues, true);
  optionalString(obj, 'producer', path, issues, true);
  optionalString(obj, 'processing', path, issues, true);
  optionalStringArray(obj, 'variety', path, issues, true);
  optionalNumberArray(obj, 'altitude', path, issues, true);
  optionalString(obj, 'notes', path, issues, true);
  optionalBoolean(obj, 'archived', path, issues);
  optionalString(obj, 'createdAt', path, issues);
  optionalString(obj, 'updatedAt', path, issues);
}

function validateBeanBatch(value: unknown, path: string, issues: ValidationIssue[]): void {
  const obj = expectRecord(value, path, issues);
  if (!obj) return;

  requiredString(obj, 'id', path, issues);
  requiredString(obj, 'beanId', path, issues);
  optionalString(obj, 'roastDate', path, issues, true);
  optionalString(obj, 'roastLevel', path, issues, true);
  optionalNumber(obj, 'weight', path, issues, true);
  optionalNumber(obj, 'weightRemaining', path, issues, true);
  optionalBoolean(obj, 'frozen', path, issues);
  optionalBoolean(obj, 'archived', path, issues);
}

function validateGrinder(value: unknown, path: string, issues: ValidationIssue[]): void {
  const obj = expectRecord(value, path, issues);
  if (!obj) return;

  requiredString(obj, 'id', path, issues);
  requiredString(obj, 'model', path, issues);
  optionalString(obj, 'burrs', path, issues, true);
  optionalNumber(obj, 'burrSize', path, issues, true);
  optionalString(obj, 'burrType', path, issues, true);
  optionalString(obj, 'settingType', path, issues);
  optionalNumber(obj, 'settingSmallStep', path, issues, true);
  optionalNumber(obj, 'settingBigStep', path, issues, true);
  optionalBoolean(obj, 'archived', path, issues);
}

function validateProfileRecord(value: unknown, path: string, issues: ValidationIssue[]): void {
  const obj = expectRecord(value, path, issues);
  if (!obj) return;

  requiredString(obj, 'id', path, issues);
  validateRequiredObject(obj, 'profile', path, issues, validateProfile);
  optionalStringEnum(obj, 'visibility', path, issues, ['visible', 'hidden', 'deleted']);
  optionalBoolean(obj, 'isDefault', path, issues);
}

function validateWorkflow(value: unknown, path: string, issues: ValidationIssue[]): void {
  const obj = expectRecord(value, path, issues);
  if (!obj) return;

  optionalString(obj, 'id', path, issues);
  optionalString(obj, 'name', path, issues);
  optionalString(obj, 'description', path, issues);
  validateOptionalObject(obj, 'profile', path, issues, true, validateProfile);
  validateOptionalObject(obj, 'context', path, issues, true, validateWorkflowContext);
  optionalRecord(obj, 'steamSettings', path, issues);
  optionalRecord(obj, 'hotWaterData', path, issues);
  optionalRecord(obj, 'rinseData', path, issues);
}

function validateMachineCapabilities(
  value: unknown,
  path: string,
  issues: ValidationIssue[]
): void {
  const obj = expectRecord(value, path, issues);
  if (!obj) return;

  requiredStringArray(obj, 'capabilities', path, issues);
}

function validateDe1MachineSettings(
  value: unknown,
  path: string,
  issues: ValidationIssue[]
): void {
  const obj = expectRecord(value, path, issues);
  if (!obj) return;

  optionalBoolean(obj, 'usb', path, issues, true);
  optionalNumber(obj, 'fan', path, issues, true);
  optionalNumber(obj, 'flushTemp', path, issues, true);
  optionalNumber(obj, 'flushFlow', path, issues, true);
  optionalNumber(obj, 'flushTimeout', path, issues, true);
  optionalNumber(obj, 'hotWaterFlow', path, issues, true);
  optionalNumber(obj, 'steamFlow', path, issues, true);
  optionalNumber(obj, 'tankTemp', path, issues, true);
  optionalNumber(obj, 'steamPurgeMode', path, issues, true);
}

function validateMachineInfo(value: unknown, path: string, issues: ValidationIssue[]): void {
  const obj = expectRecord(value, path, issues);
  if (!obj) return;

  optionalString(obj, 'version', path, issues);
  optionalString(obj, 'model', path, issues);
  optionalString(obj, 'serialNumber', path, issues);
  optionalBoolean(obj, 'GHC', path, issues);
  optionalBoolean(obj, 'groupHeadControllerPresent', path, issues);
  optionalRecord(obj, 'extra', path, issues);
}

function validateWorkflowContext(
  value: unknown,
  path: string,
  issues: ValidationIssue[]
): void {
  const obj = expectRecord(value, path, issues);
  if (!obj) return;

  optionalNumber(obj, 'targetDoseWeight', path, issues, true);
  optionalNumber(obj, 'targetYield', path, issues, true);
  optionalString(obj, 'grinderId', path, issues, true);
  optionalString(obj, 'grinderModel', path, issues, true);
  optionalStringOrNumber(obj, 'grinderSetting', path, issues, true);
  optionalString(obj, 'beanBatchId', path, issues, true);
  optionalString(obj, 'coffeeName', path, issues, true);
  optionalString(obj, 'coffeeRoaster', path, issues, true);
  optionalString(obj, 'finalBeverageType', path, issues, true);
  optionalString(obj, 'baristaName', path, issues, true);
  optionalString(obj, 'drinkerName', path, issues, true);
  optionalRecord(obj, 'extras', path, issues, true);
}

function validateProfile(value: unknown, path: string, issues: ValidationIssue[]): void {
  const obj = expectRecord(value, path, issues);
  if (!obj) return;

  optionalString(obj, 'title', path, issues, true);
  optionalString(obj, 'author', path, issues, true);
  optionalString(obj, 'notes', path, issues, true);
  optionalString(obj, 'beverage_type', path, issues, true);
  optionalNumber(obj, 'target_weight', path, issues, true);
  optionalNumber(obj, 'target_volume', path, issues, true);
  optionalNumber(obj, 'tank_temperature', path, issues, true);
  optionalArray(obj, 'steps', path, issues);
  optionalString(obj, 'version', path, issues, true);
}

function validatePaginatedShots(value: unknown, path: string, issues: ValidationIssue[]): void {
  const obj = expectRecord(value, path, issues);
  if (!obj) return;

  validateRequiredArray(obj, 'items', path, issues, validateShotSummary);
  requiredNumber(obj, 'total', path, issues);
  requiredNumber(obj, 'limit', path, issues);
  requiredNumber(obj, 'offset', path, issues);
}

function validateShotRecord(value: unknown, path: string, issues: ValidationIssue[]): void {
  validateShotSummary(value, path, issues);
  const obj = expectRecord(value, path, issues);
  if (!obj) return;

  validateRequiredArray(obj, 'measurements', path, issues, validateShotMeasurement);
}

function validateShotSummary(value: unknown, path: string, issues: ValidationIssue[]): void {
  const obj = expectRecord(value, path, issues);
  if (!obj) return;

  requiredString(obj, 'id', path, issues);
  requiredString(obj, 'timestamp', path, issues);
  validateOptionalObject(obj, 'workflow', path, issues, true, validateWorkflow);
  validateOptionalObject(obj, 'annotations', path, issues, true, validateShotAnnotations);
  optionalString(obj, 'shotNotes', path, issues, true);
  optionalRecord(obj, 'metadata', path, issues, true);
}

function validateShotAnnotations(
  value: unknown,
  path: string,
  issues: ValidationIssue[]
): void {
  const obj = expectRecord(value, path, issues);
  if (!obj) return;

  optionalNumber(obj, 'actualDoseWeight', path, issues, true);
  optionalNumber(obj, 'actualYield', path, issues, true);
  optionalNumber(obj, 'drinkTds', path, issues, true);
  optionalNumber(obj, 'drinkEy', path, issues, true);
  optionalNumber(obj, 'enjoyment', path, issues, true);
  optionalString(obj, 'espressoNotes', path, issues, true);
  optionalRecord(obj, 'extras', path, issues, true);
}

function validateShotMeasurement(
  value: unknown,
  path: string,
  issues: ValidationIssue[]
): void {
  const obj = expectRecord(value, path, issues);
  if (!obj) return;

  validateRequiredObject(obj, 'machine', path, issues, validateMachineMeasurement);
  validateOptionalObject(obj, 'scale', path, issues, true, validateScaleMeasurement);
  optionalNumber(obj, 'volume', path, issues, true);
}

function validateMachineMeasurement(
  value: unknown,
  path: string,
  issues: ValidationIssue[]
): void {
  const obj = expectRecord(value, path, issues);
  if (!obj) return;

  requiredString(obj, 'timestamp', path, issues);
  optionalNumber(obj, 'pressure', path, issues, true);
  optionalNumber(obj, 'flow', path, issues, true);
  optionalNumber(obj, 'mixTemperature', path, issues, true);
  optionalNumber(obj, 'groupTemperature', path, issues, true);
}

function validateScaleMeasurement(
  value: unknown,
  path: string,
  issues: ValidationIssue[]
): void {
  const obj = expectRecord(value, path, issues);
  if (!obj) return;

  optionalString(obj, 'timestamp', path, issues);
  optionalNumber(obj, 'weight', path, issues, true);
  optionalNumber(obj, 'weightFlow', path, issues, true);
  optionalNumber(obj, 'batteryLevel', path, issues, true);
}

function expectRecord(
  value: unknown,
  path: string,
  issues: ValidationIssue[]
): Record<string, unknown> | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    issues.push({ path, message: 'Expected an object' });
    return null;
  }
  return value as Record<string, unknown>;
}

function validateArray(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  itemValidator: (value: unknown, path: string, issues: ValidationIssue[]) => void
): void {
  if (!Array.isArray(value)) {
    issues.push({ path, message: 'Expected an array' });
    return;
  }
  value.forEach((item, index) => itemValidator(item, `${path}[${index}]`, issues));
}

function requiredString(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  issues: ValidationIssue[]
): void {
  const value = obj[key];
  if (typeof value !== 'string') {
    issues.push({ path: `${path}.${key}`, message: 'Expected a string' });
  }
}

function optionalString(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  issues: ValidationIssue[],
  nullable = false
): void {
  const value = obj[key];
  if (value === undefined || (nullable && value === null)) return;
  if (typeof value !== 'string') {
    issues.push({ path: `${path}.${key}`, message: 'Expected a string' });
  }
}

function requiredNumber(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  issues: ValidationIssue[]
): void {
  const value = obj[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    issues.push({ path: `${path}.${key}`, message: 'Expected a finite number' });
  }
}

function optionalNumber(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  issues: ValidationIssue[],
  nullable = false
): void {
  const value = obj[key];
  if (value === undefined || (nullable && value === null)) return;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    issues.push({ path: `${path}.${key}`, message: 'Expected a finite number' });
  }
}

function optionalBoolean(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  issues: ValidationIssue[],
  nullable = false
): void {
  const value = obj[key];
  if (value === undefined || (nullable && value === null)) return;
  if (typeof value !== 'boolean') {
    issues.push({ path: `${path}.${key}`, message: 'Expected a boolean' });
  }
}

function optionalStringOrNumber(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  issues: ValidationIssue[],
  nullable = false
): void {
  const value = obj[key];
  if (value === undefined || (nullable && value === null)) return;
  if (typeof value === 'string') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  issues.push({ path: `${path}.${key}`, message: 'Expected a string or finite number' });
}

function optionalStringEnum<T extends string>(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  issues: ValidationIssue[],
  allowed: readonly T[]
): void {
  const value = obj[key];
  if (value === undefined) return;
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    issues.push({ path: `${path}.${key}`, message: `Expected one of: ${allowed.join(', ')}` });
  }
}

function optionalStringArray(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  issues: ValidationIssue[],
  nullable = false
): void {
  const value = obj[key];
  if (value === undefined || (nullable && value === null)) return;
  if (!Array.isArray(value)) {
    issues.push({ path: `${path}.${key}`, message: 'Expected an array' });
    return;
  }
  value.forEach((item, index) => {
    if (typeof item !== 'string') {
      issues.push({ path: `${path}.${key}[${index}]`, message: 'Expected a string' });
    }
  });
}

function requiredStringArray(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  issues: ValidationIssue[]
): void {
  const value = obj[key];
  if (!Array.isArray(value)) {
    issues.push({ path: `${path}.${key}`, message: 'Expected an array' });
    return;
  }
  value.forEach((item, index) => {
    if (typeof item !== 'string') {
      issues.push({ path: `${path}.${key}[${index}]`, message: 'Expected a string' });
    }
  });
}

function optionalNumberArray(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  issues: ValidationIssue[],
  nullable = false
): void {
  const value = obj[key];
  if (value === undefined || (nullable && value === null)) return;
  if (!Array.isArray(value)) {
    issues.push({ path: `${path}.${key}`, message: 'Expected an array' });
    return;
  }
  value.forEach((item, index) => {
    if (typeof item !== 'number' || !Number.isFinite(item)) {
      issues.push({ path: `${path}.${key}[${index}]`, message: 'Expected a finite number' });
    }
  });
}

function optionalArray(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  issues: ValidationIssue[]
): void {
  const value = obj[key];
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    issues.push({ path: `${path}.${key}`, message: 'Expected an array' });
  }
}

function optionalRecord(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  issues: ValidationIssue[],
  nullable = false
): void {
  const value = obj[key];
  if (value === undefined || (nullable && value === null)) return;
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    issues.push({ path: `${path}.${key}`, message: 'Expected an object' });
  }
}

function validateRequiredObject(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  issues: ValidationIssue[],
  validator: (value: unknown, path: string, issues: ValidationIssue[]) => void
): void {
  if (!(key in obj)) {
    issues.push({ path: `${path}.${key}`, message: 'Expected an object' });
    return;
  }
  validator(obj[key], `${path}.${key}`, issues);
}

function validateOptionalObject(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  issues: ValidationIssue[],
  nullable: boolean,
  validator: (value: unknown, path: string, issues: ValidationIssue[]) => void
): void {
  const value = obj[key];
  if (value === undefined || (nullable && value === null)) return;
  validator(value, `${path}.${key}`, issues);
}

function validateRequiredArray(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  issues: ValidationIssue[],
  itemValidator: (value: unknown, path: string, issues: ValidationIssue[]) => void
): void {
  if (!(key in obj)) {
    issues.push({ path: `${path}.${key}`, message: 'Expected an array' });
    return;
  }
  validateArray(obj[key], `${path}.${key}`, issues, itemValidator);
}
