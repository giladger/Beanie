import type { Bean } from '../api/types';
import { beanFieldsFromForm } from '../domain/beanForm';
import {
  isShotEditField,
  type ShotEditorNumberValues,
  type ShotEditField,
  type ShotNumberField
} from '../domain/shotEditModel';

export type ShotEditorSubmission =
  | { type: 'field'; field: ShotEditField; value: string }
  | { type: 'save'; shotId: string | null; numbers: ShotEditorNumberValues }
  | { type: 'create-bean'; fields: Partial<Bean> };

const NUMBER_FIELDS: readonly ShotNumberField[] = [
  'targetDoseWeight',
  'targetYield',
  'actualDoseWeight',
  'actualYield',
  'drinkTds',
  'drinkEy'
];

/** Reads only the three forms owned by the shot editor. */
export function readShotEditorSubmission(form: HTMLFormElement): ShotEditorSubmission | null {
  if (form.dataset.form === 'shot-field-dialog') {
    const field = form.dataset.field;
    if (!isShotEditField(field)) return null;
    return {
      type: 'field',
      field,
      value: String(new FormData(form).get('value') ?? '')
    };
  }
  if (form.dataset.form === 'shot-dye-editor') {
    return {
      type: 'save',
      shotId: form.dataset.id || null,
      numbers: shotNumberValuesFromForm(form)
    };
  }
  if (form.dataset.form === 'shot-bean-create') {
    return {
      type: 'create-bean',
      fields: beanFieldsFromForm(new FormData(form))
    };
  }
  return null;
}

function shotNumberValuesFromForm(form: HTMLFormElement): ShotEditorNumberValues {
  const values: ShotEditorNumberValues = {};
  for (const field of NUMBER_FIELDS) {
    const control = form.elements.namedItem(field);
    if (control instanceof HTMLInputElement) values[field] = control.value;
  }
  return values;
}
