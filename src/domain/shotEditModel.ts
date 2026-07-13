import type {
  Bean,
  BeanBatch,
  Grinder,
  ShotAnnotations,
  ShotRecord,
  ShotUpdate,
  WorkflowContext
} from '../api/types';
import { shotMetadataWithFreshness } from './liveShotRecord';

export type ShotEditField =
  | 'finalBeverageType'
  | 'baristaName'
  | 'drinkerName'
  | 'targetDoseWeight'
  | 'targetYield'
  | 'actualDoseWeight'
  | 'actualYield'
  | 'grinderId'
  | 'grinderSetting'
  | 'drinkTds'
  | 'drinkEy'
  | 'espressoNotes';

export interface ShotEditDraft {
  shotId: string;
  coffeeRoaster: string | null;
  coffeeName: string | null;
  beanId?: string | null;
  beanBatchId: string | null;
  finalBeverageType: string | null;
  baristaName: string | null;
  drinkerName: string | null;
  targetDoseWeight: number | null;
  targetYield: number | null;
  actualDoseWeight: number | null;
  actualYield: number | null;
  grinderId: string | null;
  grinderModel: string | null;
  grinderSetting: string | null;
  drinkTds: number | null;
  drinkEy: number | null;
  enjoyment: number | null;
  espressoNotes: string | null;
  contextExtras: Record<string, unknown> | null;
  annotationExtras: Record<string, unknown> | null;
}

// The combined bean/roaster picker shown inside the shot editor. Editing a
// shot's bean is one act, like everywhere else in the skin: pick a bag, which
// carries its roaster and the latest batch. `creating` swaps the bag list for
// an inline new-bean form.
export interface ShotBeanEditState {
  creating: boolean;
}

export interface ShotFieldOption {
  label: string;
  value: string;
  detail?: string;
}

export interface ShotFieldSpec {
  label: string;
  kind: 'text' | 'number' | 'textarea';
  value: string;
  step?: string;
  options: ShotFieldOption[];
}

export interface ShotEditorNumberValues {
  targetDoseWeight?: string;
  targetYield?: string;
  actualDoseWeight?: string;
  actualYield?: string;
  drinkTds?: string;
  drinkEy?: string;
}

export type ShotNumberField = Extract<
  ShotEditField,
  'targetDoseWeight' | 'targetYield' | 'actualDoseWeight' | 'actualYield' | 'drinkTds' | 'drinkEy'
>;

export function isShotNumberField(field: ShotEditField): field is ShotNumberField {
  return (
    field === 'targetDoseWeight' ||
    field === 'targetYield' ||
    field === 'actualDoseWeight' ||
    field === 'actualYield' ||
    field === 'drinkTds' ||
    field === 'drinkEy'
  );
}

export function isShotEditField(value: string | undefined): value is ShotEditField {
  return (
    value === 'finalBeverageType' ||
    value === 'baristaName' ||
    value === 'drinkerName' ||
    value === 'targetDoseWeight' ||
    value === 'targetYield' ||
    value === 'actualDoseWeight' ||
    value === 'actualYield' ||
    value === 'grinderId' ||
    value === 'grinderSetting' ||
    value === 'drinkTds' ||
    value === 'drinkEy' ||
    value === 'espressoNotes'
  );
}

export function shotNumberFieldStep(field: ShotEditField): string {
  return field === 'drinkTds' || field === 'drinkEy' ? '0.01' : '0.1';
}

/**
 * Extraction yield derived from the refractometer reading: beverage weight ×
 * TDS ÷ dose, preferring actual weights over targets. Null until TDS, a dose,
 * and a yield are all known. Rounded to two decimals, matching the EY field's
 * input step.
 */
export function calculatedEy(
  draft: Pick<ShotEditDraft, 'drinkTds' | 'actualDoseWeight' | 'targetDoseWeight' | 'actualYield' | 'targetYield'>
): number | null {
  const tds = positiveNumber(draft.drinkTds);
  const dose = positiveNumber(draft.actualDoseWeight) ?? positiveNumber(draft.targetDoseWeight);
  const beverage = positiveNumber(draft.actualYield) ?? positiveNumber(draft.targetYield);
  if (tds == null || dose == null || beverage == null) return null;
  return Math.round(((beverage * tds) / dose) * 100) / 100;
}

export function shotEditDraftFromShot(shot: ShotRecord): ShotEditDraft {
  const context = shot.workflow?.context ?? {};
  const annotations = shot.annotations ?? {};
  return {
    shotId: shot.id,
    coffeeRoaster: context.coffeeRoaster ?? null,
    coffeeName: context.coffeeName ?? null,
    beanId: context.beanId ?? null,
    beanBatchId: context.beanBatchId ?? null,
    finalBeverageType: context.finalBeverageType ?? null,
    baristaName: context.baristaName ?? null,
    drinkerName: context.drinkerName ?? null,
    targetDoseWeight: context.targetDoseWeight ?? null,
    targetYield: context.targetYield ?? null,
    actualDoseWeight: annotations.actualDoseWeight ?? null,
    actualYield: annotations.actualYield ?? null,
    grinderId: context.grinderId ?? null,
    grinderModel: context.grinderModel ?? null,
    grinderSetting: textOrNull(inputValue(context.grinderSetting)),
    drinkTds: annotations.drinkTds ?? null,
    drinkEy: annotations.drinkEy ?? null,
    enjoyment: annotations.enjoyment ?? null,
    espressoNotes: annotations.espressoNotes ?? shot.shotNotes ?? null,
    contextExtras: context.extras ?? null,
    annotationExtras: annotations.extras ?? shot.metadata ?? null
  };
}

export function shotEditDraftWithNumbers(
  draft: ShotEditDraft,
  values: ShotEditorNumberValues
): ShotEditDraft {
  let next = draft;
  for (const field of SHOT_NUMBER_FIELDS) {
    if (values[field] !== undefined) {
      next = { ...next, [field]: numberOrNullInput(values[field]) };
    }
  }
  return next;
}

export function updateShotEditDraftField(
  draft: ShotEditDraft,
  field: ShotEditField,
  value: string,
  grinders: readonly Grinder[]
): ShotEditDraft {
  const text = textOrNull(value);
  const number = numberOrNullInput(value);
  if (isShotNumberField(field)) return { ...draft, [field]: number };
  if (field === 'grinderId') {
    const grinder = text ? grinders.find((item) => item.id === text) : null;
    return {
      ...draft,
      grinderId: grinder?.id ?? null,
      grinderModel: grinder?.model ?? draft.grinderModel
    };
  }
  return { ...draft, [field]: text };
}

export function shotUpdateFromDraft(
  shot: ShotRecord,
  draft: ShotEditDraft,
  grinders: readonly Grinder[],
  beans: readonly Bean[],
  batchesByBean: Readonly<Record<string, readonly BeanBatch[]>>
): ShotUpdate {
  const selectedGrinder = draft.grinderId
    ? grinders.find((grinder) => grinder.id === draft.grinderId) ?? null
    : null;
  const selectedBatch = batchAndBeanForId(draft.beanBatchId, beans, batchesByBean);
  const beanId = draft.beanId ?? selectedBatch?.bean.id ?? null;

  const context: WorkflowContext = {
    ...(shot.workflow?.context ?? {}),
    targetDoseWeight: draft.targetDoseWeight,
    targetYield: draft.targetYield,
    grinderId: draft.grinderId,
    grinderModel: draft.grinderModel ?? selectedGrinder?.model ?? null,
    grinderSetting: draft.grinderSetting,
    beanId,
    beanBatchId: draft.beanBatchId,
    coffeeName: draft.coffeeName ?? selectedBatch?.bean.name ?? null,
    coffeeRoaster: draft.coffeeRoaster ?? selectedBatch?.bean.roaster ?? null,
    finalBeverageType: draft.finalBeverageType,
    baristaName: draft.baristaName,
    drinkerName: draft.drinkerName,
    extras: draft.contextExtras
  };
  const annotations: ShotAnnotations = {
    ...(shot.annotations ?? {}),
    actualDoseWeight: draft.actualDoseWeight,
    actualYield: draft.actualYield,
    drinkTds: draft.drinkTds,
    drinkEy: draft.drinkEy,
    enjoyment: draft.enjoyment,
    espressoNotes: draft.espressoNotes,
    extras: draft.annotationExtras
  };

  return {
    workflow: { context },
    annotations,
    shotNotes: annotations.espressoNotes ?? null,
    metadata: shotMetadataWithFreshness(
      shot.metadata,
      annotations.extras,
      selectedBatch?.batch ?? null,
      shot.timestamp
    )
  };
}

export function batchAndBeanForId(
  batchId: string | null,
  beans: readonly Bean[],
  batchesByBean: Readonly<Record<string, readonly BeanBatch[]>>
): { batch: BeanBatch; bean: Bean } | null {
  if (!batchId) return null;
  for (const bean of beans) {
    const batch = (batchesByBean[bean.id] ?? []).find((item) => item.id === batchId);
    if (batch) return { batch, bean };
  }
  return null;
}

export function shotDraftBean(
  draft: ShotEditDraft,
  beans: readonly Bean[],
  batchesByBean: Readonly<Record<string, readonly BeanBatch[]>>
): Bean | null {
  if (draft.beanId) {
    const byBeanId = beans.find((bean) => bean.id === draft.beanId);
    if (byBeanId) return byBeanId;
  }
  return batchAndBeanForId(draft.beanBatchId, beans, batchesByBean)?.bean ?? null;
}

export function shotFieldSpec(
  field: ShotEditField,
  draft: ShotEditDraft,
  grinders: readonly Grinder[],
  shots: readonly ShotRecord[]
): ShotFieldSpec {
  const label = shotFieldLabel(field);
  if (field === 'grinderId') {
    return {
      label,
      kind: 'text',
      value: draft.grinderId ?? '',
      options: [
        { label: 'No grinder', value: '' },
        ...grinders.map((grinder) => ({
          label: grinder.model,
          value: grinder.id,
          detail: grinder.burrs ?? undefined
        }))
      ]
    };
  }
  if (field === 'espressoNotes') {
    return {
      label,
      kind: 'textarea',
      value: draft.espressoNotes ?? '',
      options: [
        { label: 'Clear', value: '' },
        { label: 'Sweet', value: 'Sweet, balanced, clean.' },
        { label: 'Sour', value: 'Sour, fast, needs finer grind or more yield.' },
        { label: 'Bitter', value: 'Bitter, dry, needs coarser grind or less yield.' }
      ]
    };
  }
  const value = draft[field];
  if (isShotNumberField(field)) {
    return {
      label,
      kind: 'number',
      value: inputValue(value),
      step: shotNumberFieldStep(field),
      options: numericShotFieldOptions(field)
    };
  }
  return {
    label,
    kind: 'text',
    value: inputValue(value),
    options: textShotFieldOptions(field, shots)
  };
}

const SHOT_NUMBER_FIELDS: readonly ShotNumberField[] = [
  'targetDoseWeight',
  'targetYield',
  'actualDoseWeight',
  'actualYield',
  'drinkTds',
  'drinkEy'
];

function numericShotFieldOptions(field: ShotEditField): ShotFieldOption[] {
  const values =
    field === 'drinkTds'
      ? [7, 8, 9, 10, 11, 12]
      : field === 'drinkEy'
        ? [16, 18, 20, 22, 24]
        : field === 'targetYield' || field === 'actualYield'
          ? [34, 36, 38, 40, 42, 45]
          : [17, 17.5, 18, 18.5, 20];
  return [
    { label: 'Clear', value: '' },
    ...values.map((item) => ({ label: inputValue(item), value: String(item) }))
  ];
}

function textShotFieldOptions(
  field: ShotEditField,
  shots: readonly ShotRecord[]
): ShotFieldOption[] {
  if (field === 'finalBeverageType') {
    return uniqueTextOptions([
      { label: 'Espresso', value: 'espresso' },
      { label: 'Americano', value: 'americano' },
      { label: 'Cortado', value: 'cortado' },
      { label: 'Cappuccino', value: 'cappuccino' },
      { label: 'Iced', value: 'iced' },
      ...shots.map((shot) => ({
        label: shot.workflow?.context?.finalBeverageType ?? '',
        value: shot.workflow?.context?.finalBeverageType ?? ''
      }))
    ]);
  }
  if (field === 'baristaName' || field === 'drinkerName') {
    return uniqueTextOptions(
      shots.map((shot) => {
        const value = shot.workflow?.context?.[field] ?? '';
        return { label: value, value };
      })
    );
  }
  if (field === 'grinderSetting') {
    return uniqueTextOptions([
      ...shots.map((shot) => {
        const value = inputValue(shot.workflow?.context?.grinderSetting);
        return {
          label: value,
          value,
          detail: shot.workflow?.context?.grinderModel ?? ''
        };
      }),
      { label: '5.0', value: '5.0' },
      { label: '5.5', value: '5.5' },
      { label: '6.0', value: '6.0' },
      { label: '6.5', value: '6.5' }
    ]);
  }
  return [{ label: 'Clear', value: '' }];
}

function uniqueTextOptions(items: readonly ShotFieldOption[]): ShotFieldOption[] {
  const options: ShotFieldOption[] = [{ label: 'Clear', value: '' }];
  const seen = new Set<string>();
  for (const item of items) {
    const value = item.value.trim();
    const label = item.label.trim();
    if (!value || !label) continue;
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    options.push({ label, value, detail: item.detail?.trim() || undefined });
  }
  return options;
}

function shotFieldLabel(field: ShotEditField): string {
  const labels: Record<ShotEditField, string> = {
    finalBeverageType: 'Drink',
    baristaName: 'Barista',
    drinkerName: 'Drinker',
    targetDoseWeight: 'Target in',
    targetYield: 'Target out',
    actualDoseWeight: 'Actual in',
    actualYield: 'Actual out',
    grinderId: 'Grinder',
    grinderSetting: 'Grind',
    drinkTds: 'TDS',
    drinkEy: 'EY',
    espressoNotes: 'Notes'
  };
  return labels[field];
}

function inputValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : String(round(value, 3));
  }
  return String(value);
}

function numberOrNullInput(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function textOrNull(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function positiveNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}
