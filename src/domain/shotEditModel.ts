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

function positiveNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}
