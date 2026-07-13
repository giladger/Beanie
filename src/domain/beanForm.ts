import type { Bean, BeanBatch } from '../api/types';

export interface BeanBatchFormFields {
  readonly roastDate: string | null;
  readonly roastLevel: string | null;
  readonly weight: { readonly present: boolean; readonly value: number | null };
  readonly weightRemaining: { readonly present: boolean; readonly value: number | null };
}

export interface BeanFormSubmission {
  readonly type: 'bean';
  readonly editingId: string | null;
  readonly fields: Partial<Bean>;
  readonly prefillBeanId: string | null;
  readonly firstStock: BeanBatchFormFields;
}

export interface BeanBatchFormSubmission {
  readonly type: 'batch';
  readonly beanId: string;
  readonly batchId: string | null;
  readonly fields: BeanBatchFormFields;
}

export interface BatchStorageDatesSubmission {
  readonly type: 'storage-dates';
  readonly values: Readonly<Record<string, string>>;
}

export type BeanInventoryFormSubmission =
  | BeanFormSubmission
  | BeanBatchFormSubmission
  | BatchStorageDatesSubmission;

// Reading the bean and batch edit forms into gateway-ready partials. Shared by
// the bean picker forms (app.ts) and the label-scanner review form.

export function textOrNull(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? '').trim();
  return text ? text : null;
}

export function numberOrNullInput(value: FormDataEntryValue | null): number | null {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

export function beanFieldsFromForm(data: FormData): Partial<Bean> {
  return {
    roaster: String(data.get('roaster') ?? '').trim(),
    name: String(data.get('name') ?? '').trim(),
    country: textOrNull(data.get('country')),
    region: textOrNull(data.get('region')),
    processing: textOrNull(data.get('processing')),
    notes: textOrNull(data.get('notes'))
  };
}

export function beanFieldsUnchanged(fields: Partial<Bean>, bean: Bean): boolean {
  return (
    normalizeBeanField(fields.roaster) === normalizeBeanField(bean.roaster) &&
    normalizeBeanField(fields.name) === normalizeBeanField(bean.name) &&
    normalizeBeanField(fields.country) === normalizeBeanField(bean.country) &&
    normalizeBeanField(fields.region) === normalizeBeanField(bean.region) &&
    normalizeBeanField(fields.processing) === normalizeBeanField(bean.processing) &&
    normalizeBeanField(fields.notes) === normalizeBeanField(bean.notes)
  );
}

export function beanSubmissionIsComplete(
  submission: BeanFormSubmission
): boolean {
  return Boolean(submission.fields.roaster && submission.fields.name);
}

export function batchInputFromSubmission(
  submission: BeanBatchFormFields,
  beanId: string,
  fallback?: BeanBatch
): Partial<BeanBatch> {
  const weight = submission.weight.present
    ? submission.weight.value
    : fallback?.weight ?? null;
  const weightRemaining = submission.weightRemaining.present
    ? submission.weightRemaining.value
    : fallback?.weightRemaining ?? null;
  return {
    beanId,
    roastDate: submission.roastDate,
    roastLevel: submission.roastLevel,
    weight,
    weightRemaining: clampRemainingToWeight(weightRemaining, weight)
  };
}

export function newStockFormKey(
  beanId: string,
  name: 'weight' | 'weightRemaining'
): string {
  return `bean-picker-new:${beanId}:${name}`;
}

export function createStockFormKey(name: 'weight' | 'weightRemaining'): string {
  return `bean-picker-create:${name}`;
}

export function freezeAmountFormKey(batchId: string): string {
  return `freeze-amount:${batchId}`;
}

export function normalizeBeanField(value: unknown): string {
  return String(value ?? '').trim();
}

// Only the fields the form actually edits go into the patch. The gateway merges
// partial bodies, so anything echoed from the previous batch (notably the
// freeze/thaw history, which no batch form edits) would overwrite concurrent
// changes from another device.
export function batchFieldsFromForm(data: FormData, beanId: string, fallback?: BeanBatch): Partial<BeanBatch> {
  const weight = data.has('weight') ? numberOrNullInput(data.get('weight')) : fallback?.weight ?? null;
  const weightRemaining = data.has('weightRemaining')
    ? numberOrNullInput(data.get('weightRemaining'))
    : fallback?.weightRemaining ?? null;
  return {
    beanId,
    roastDate: textOrNull(data.get('roastDate')),
    roastLevel: textOrNull(data.get('roastLevel')),
    weight,
    // A bag can't hold more than its size, so "left" is capped at the bag weight.
    weightRemaining: clampRemainingToWeight(weightRemaining, weight)
  };
}

// "Grams left" can never exceed the bag's size. When both are known numbers,
// pull a too-high remaining down to the bag weight; otherwise leave it as-is.
export function clampRemainingToWeight(remaining: number | null, weight: number | null): number | null {
  if (typeof remaining === 'number' && typeof weight === 'number' && remaining > weight) return weight;
  return remaining;
}
