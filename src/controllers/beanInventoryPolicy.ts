import type { BeanBatch } from '../api/types';
import { appendBatchStorageEvent } from '../domain/beanFreshness';
import { latestBatch } from '../domain/beanWorkflow';
import type {
  BatchUpdatePurpose,
  BatchUpdateRequest,
  BeanInventoryCommandPort,
  BeanInventoryProjection,
  BeanInventorySnapshot,
  CreateBatchOutcome,
  FreezeStockOutcome
} from './beanInventoryContract';

export interface BatchFieldSnapshot {
  readonly key: keyof BeanBatch;
  readonly hadValue: boolean;
  readonly previous: unknown;
  readonly optimistic: unknown;
}

export interface BatchUpdateToken {
  readonly request: BatchUpdateRequest;
  readonly fields: readonly BatchFieldSnapshot[];
  readonly revision: number;
  readonly optimisticSelection: string | null | undefined;
  readonly previousSelection: string | null;
  readonly selectionRevisionBeforeProjection: number;
}

export interface ConfirmedBatchField {
  readonly revision: number;
  readonly hadValue: boolean;
  readonly value: unknown;
}

export interface SplitPlan {
  readonly source: BeanBatch;
  readonly admittedSourceWeightRemaining: number | null | undefined;
  readonly grams: number;
  readonly keepGrams: number;
  readonly operationStartedAtMs: number;
  readonly idempotencyKey: string;
  readonly recoveredOnSuccess: boolean;
  readonly frozenBatch: Partial<BeanBatch>;
  readonly sourcePatch: Partial<BeanBatch>;
}

export function beanInventoryMutationKey(beanId: string): string {
  return `bean-inventory:${beanId}`;
}

export function fieldOwnerKey(batchId: string, field: keyof BeanBatch): string {
  return `${batchId}:${field}`;
}

export function normalizedPatch(beanId: string, patch: Partial<BeanBatch>): Partial<BeanBatch> {
  return { ...patch, beanId };
}

export function storagePatch(beanId: string, batch: Partial<BeanBatch>): Partial<BeanBatch> {
  return {
    beanId,
    storageEvents: batch.storageEvents ?? null,
    frozen: batch.frozen === true
  };
}

export function needsStorageFollowUp(batch: Partial<BeanBatch>): boolean {
  return Object.prototype.hasOwnProperty.call(batch, 'storageEvents') || batch.frozen === true;
}

export function copyBatches(snapshot: BeanInventorySnapshot, beanId: string): BeanBatch[] {
  return [...(snapshot.batchesByBean[beanId] ?? [])];
}

export function replaceBatch(batches: readonly BeanBatch[], replacement: BeanBatch): BeanBatch[] {
  return batches.map((batch) => (batch.id === replacement.id ? replacement : batch));
}

export function prependUnique(batch: BeanBatch, batches: readonly BeanBatch[]): BeanBatch[] {
  return [batch, ...batches.filter((item) => item.id !== batch.id)];
}

export function makeProjection(
  beanId: string,
  batches: readonly BeanBatch[],
  selectedBatchId: string | null | undefined,
  shouldScheduleApply: boolean
): BeanInventoryProjection {
  return {
    beanId,
    batches,
    ...(selectedBatchId === undefined ? {} : { selectedBatchId }),
    shouldScheduleApply
  };
}

export function optimisticSelection(
  snapshot: BeanInventorySnapshot,
  request: BatchUpdateRequest,
  previous: readonly BeanBatch[],
  optimistic: readonly BeanBatch[]
): { next: string | null | undefined; changed: boolean } {
  if (request.purpose !== 'finish' || snapshot.selectedBeanId !== request.beanId) {
    return { next: undefined, changed: false };
  }
  const selected = snapshot.selectedBatchId === request.batchId ||
    (snapshot.selectedBatchId == null && latestBatch(previous.filter(isUsableBatch))?.id === request.batchId);
  if (!selected) return { next: undefined, changed: false };
  const next = latestBatch(optimistic.filter(isUsableBatch))?.id ?? null;
  return { next, changed: next !== snapshot.selectedBatchId };
}

export function shouldScheduleOptimisticApply(
  snapshot: BeanInventorySnapshot,
  request: BatchUpdateRequest,
  previous: readonly BeanBatch[],
  optimistic: readonly BeanBatch[],
  selectionChanged: boolean
): boolean {
  if (snapshot.selectedBeanId !== request.beanId) return false;
  if (selectionChanged) return true;
  const before = effectiveSelectedBatch(previous, snapshot.selectedBatchId);
  const after = effectiveSelectedBatch(optimistic, snapshot.selectedBatchId);
  return before?.id === request.batchId ||
    after?.id === request.batchId ||
    before?.id !== after?.id;
}

function effectiveSelectedBatch(
  batches: readonly BeanBatch[],
  selectedBatchId: string | null
): BeanBatch | null {
  const selected = selectedBatchId
    ? batches.find((batch) => batch.id === selectedBatchId) ?? null
    : null;
  if (selected && isUsableBatch(selected)) return selected;
  return latestBatch(batches.filter(isUsableBatch)) ?? latestBatch([...batches]);
}

export function captureFields(
  previous: BeanBatch,
  optimistic: BeanBatch,
  patch: Partial<BeanBatch>
): BatchFieldSnapshot[] {
  return (Object.keys(patch) as Array<keyof BeanBatch>)
    .filter((key) => key !== 'id' && key !== 'beanId')
    .map((key) => ({
      key,
      hadValue: Object.prototype.hasOwnProperty.call(previous, key),
      previous: previous[key],
      optimistic: optimistic[key]
    }));
}

export function reconcileSavedBatch(
  batches: readonly BeanBatch[],
  saved: BeanBatch,
  fields: readonly BatchFieldSnapshot[]
): BeanBatch[] {
  const current = batches.find((batch) => batch.id === saved.id);
  if (!current) return [...batches];
  let next = current;
  for (const field of fields) {
    if (!sameValue(current[field.key], field.optimistic) && !sameValue(current[field.key], field.previous)) continue;
    const savedValue = saved[field.key];
    next = assignBatchField(next, field.key, savedValue, Object.prototype.hasOwnProperty.call(saved, field.key));
  }
  return next === current ? [...batches] : replaceBatch(batches, next);
}

export function rollbackBatch(
  batches: readonly BeanBatch[],
  batchId: string,
  fields: readonly BatchFieldSnapshot[],
  confirmedFields: ReadonlyMap<string, ConfirmedBatchField>
): BeanBatch[] {
  const current = batches.find((batch) => batch.id === batchId);
  if (!current) return [...batches];
  let next = current;
  for (const field of fields) {
    if (!sameValue(current[field.key], field.optimistic)) continue;
    const confirmed = confirmedFields.get(fieldOwnerKey(batchId, field.key));
    next = assignBatchField(
      next,
      field.key,
      confirmed ? confirmed.value : field.previous,
      confirmed?.hadValue ?? field.hadValue
    );
  }
  return next === current ? [...batches] : replaceBatch(batches, next);
}

function assignBatchField(
  batch: BeanBatch,
  key: keyof BeanBatch,
  value: unknown,
  present: boolean
): BeanBatch {
  const next = { ...batch } as Record<keyof BeanBatch, unknown>;
  if (present) next[key] = value;
  else delete next[key];
  return next as unknown as BeanBatch;
}

export function rollbackSelection(
  currentSelection: string | null,
  token: BatchUpdateToken,
  confirmedSelection: string | null
): string | null | undefined {
  if (token.optimisticSelection === undefined || currentSelection !== token.optimisticSelection) return undefined;
  return confirmedSelection;
}

export function sameBatchList(left: readonly BeanBatch[], right: readonly BeanBatch[]): boolean {
  return left.length === right.length && left.every((batch, index) => batch === right[index]);
}

function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => sameValue(value, right[index]));
  }
  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length &&
      leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && sameValue(left[key], right[key]));
  }
  return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

export function updateStatus(purpose: BatchUpdatePurpose, success: boolean, demo: boolean): string {
  if (!success) {
    if (purpose === 'finish') return 'Finish batch failed';
    if (purpose === 'stock') return 'Save stock failed';
    return 'Save batch failed';
  }
  const status = purpose === 'finish' ? 'Bag finished' : purpose === 'stock' ? 'Stock saved' : 'Batch saved';
  return demo ? `${status} (demo)` : status;
}

export function commandFailureReason(
  status: 'failed' | 'superseded' | 'canceled' | 'disposed'
): 'gateway' | 'superseded' | 'canceled' | 'disposed' {
  return status === 'failed' ? 'gateway' : status;
}

export function createCommandFailure(
  outcome: Exclude<Awaited<ReturnType<BeanInventoryCommandPort['exact']>>, { status: 'completed' }>
): Extract<CreateBatchOutcome, { type: 'failed' }> {
  return {
    type: 'failed',
    reason: commandFailureReason(outcome.status),
    status: 'Add batch failed',
    ...(outcome.status === 'failed' ? { error: outcome.error } : {})
  };
}

export function splitPlan(
  beanId: string,
  source: BeanBatch,
  grams: number,
  keepGrams: number,
  operationStartedAtMs: number,
  idempotencyKey: string,
  recoveredOnSuccess: boolean,
  admittedSourceWeightRemaining: number | null | undefined = source.weightRemaining
): SplitPlan {
  const frozen = appendBatchStorageEvent(source, 'frozen', new Date(operationStartedAtMs));
  return {
    source,
    admittedSourceWeightRemaining,
    grams,
    keepGrams,
    operationStartedAtMs,
    idempotencyKey,
    recoveredOnSuccess,
    frozenBatch: {
      beanId,
      roastDate: source.roastDate ?? null,
      roastLevel: source.roastLevel ?? null,
      weight: grams,
      weightRemaining: grams,
      storageEvents: frozen.storageEvents ?? null,
      frozen: true
    },
    sourcePatch: { beanId, weightRemaining: keepGrams }
  };
}

export function newCreationCandidates(
  authoritative: readonly BeanBatch[] | null,
  knownBatchIds: readonly string[] | null
): BeanBatch[] {
  if (!authoritative || !knownBatchIds) return [];
  const known = new Set(knownBatchIds);
  return authoritative.filter((batch) => !known.has(batch.id));
}

export function createIntentKey(
  beanId: string,
  input: Partial<BeanBatch>,
  demo: boolean
): string {
  return [
    'bean-batch-create-intent:v1',
    demo ? 'demo' : 'remote',
    encodeURIComponent(beanId),
    stableIntentValue(input)
  ].join(':');
}

export function createRemainsUnresolved(outcome: CreateBatchOutcome): boolean {
  return outcome.type === 'reconciliation-required' && outcome.phase === 'create';
}

export function splitCreateIntentKey(
  beanId: string,
  sourceBatchId: string,
  grams: number
): string {
  return [
    'bean-batch-split-intent:v1',
    encodeURIComponent(beanId),
    encodeURIComponent(sourceBatchId),
    grams
  ].join(':');
}

export function splitCreateRemainsUnresolved(outcome: FreezeStockOutcome): boolean {
  return outcome.type === 'reconciliation-required' && outcome.phase === 'create-portion';
}

export function batchCreateIdempotencyKey(
  beanId: string,
  nowMs: number,
  sequence: number,
  input: Partial<BeanBatch>
): string {
  return [
    'bean-batch-create:v1',
    encodeURIComponent(beanId),
    nowMs,
    sequence,
    intentFingerprint(input)
  ].join(':');
}

export function splitCreateIdempotencyKey(
  beanId: string,
  sourceBatchId: string,
  grams: number,
  keepGrams: number,
  operationStartedAtMs: number
): string {
  return [
    'bean-batch-split:v1',
    encodeURIComponent(beanId),
    encodeURIComponent(sourceBatchId),
    grams,
    keepGrams,
    operationStartedAtMs
  ].join(':');
}

function intentFingerprint(value: unknown): string {
  const serialized = stableIntentValue(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function stableIntentValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return `string:${JSON.stringify(value)}`;
  if (typeof value === 'number') return `number:${String(value)}`;
  if (typeof value === 'boolean') return `boolean:${value}`;
  if (Array.isArray(value)) return `[${value.map(stableIntentValue).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(
      (key) => `${JSON.stringify(key)}:${stableIntentValue(record[key])}`
    ).join(',')}}`;
  }
  return `${typeof value}:${String(value)}`;
}

export function mergePatchedFields(
  current: BeanBatch,
  authoritative: BeanBatch,
  patch: Partial<BeanBatch>
): BeanBatch {
  let merged = current;
  for (const key of Object.keys(patch) as Array<keyof BeanBatch>) {
    if (key === 'id') continue;
    merged = assignBatchField(
      merged,
      key,
      authoritative[key],
      Object.prototype.hasOwnProperty.call(authoritative, key)
    );
  }
  return merged;
}

export function isFrozenPortion(batch: BeanBatch): boolean {
  const events = batch.storageEvents ?? [];
  return batch.frozen === true && events[events.length - 1]?.type === 'frozen';
}

export function batchFromProjection(
  projection: BeanInventoryProjection,
  batchId: string,
  fallback: BeanBatch
): BeanBatch {
  return projection.batches.find((batch) => batch.id === batchId) ?? fallback;
}

export function positiveNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

export function finiteNumber(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

export function roundGrams(value: number): number {
  return Math.round(value * 10) / 10;
}

export function formatGrams(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}g`;
}

function isUsableBatch(batch: BeanBatch): boolean {
  return !(typeof batch.weightRemaining === 'number' && Number.isFinite(batch.weightRemaining) && batch.weightRemaining < 5);
}
