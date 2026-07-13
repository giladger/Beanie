import type { Bean } from '../api/types';
import {
  beanFieldsFromForm,
  numberOrNullInput,
  textOrNull,
  type BeanBatchFormFields,
  type BeanInventoryFormSubmission
} from '../domain/beanForm';

/**
 * DOM adapter for the bean inventory feature. Controllers receive stable,
 * typed submissions instead of HTML forms or FormData instances.
 */
export function readBeanInventoryForm(
  form: HTMLFormElement
): BeanInventoryFormSubmission | null {
  const data = new FormData(form);
  if (form.dataset.form === 'bean-picker-bean') {
    const prefillBeanId = String(data.get('prefillBeanId') ?? '').trim();
    return {
      type: 'bean',
      editingId: form.dataset.id || null,
      fields: beanFieldsFromForm(data),
      prefillBeanId: prefillBeanId || null,
      firstStock: readBatchFields(data)
    };
  }
  if (form.dataset.form === 'bean-picker-batch') {
    const beanId = form.dataset.beanId;
    if (!beanId) return null;
    return {
      type: 'batch',
      beanId,
      batchId: form.dataset.batchId || null,
      fields: readBatchFields(data)
    };
  }
  if (form.dataset.form === 'batch-storage-dates') {
    return {
      type: 'storage-dates',
      values: Object.fromEntries(
        [...data.entries()].map(([name, value]) => [name, String(value).trim()])
      )
    };
  }
  return null;
}

// Prefilling intentionally mutates the uncontrolled form in place. Re-rendering
// here would erase any subsequent edits before the form is submitted.
export function prefillBeanInventoryForm(
  form: HTMLFormElement | null,
  bean: Bean | null
): void {
  if (!form || !bean) return;
  const set = (name: string, value: unknown) => {
    const element = form.elements.namedItem(name);
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      element.value = inputValue(value);
    }
  };
  set('prefillBeanId', bean.id);
  set('roaster', bean.roaster);
  set('name', bean.name);
  set('country', bean.country);
  set('region', bean.region);
  set('processing', bean.processing);
  set('notes', bean.notes);
}

function readBatchFields(data: FormData): BeanBatchFormFields {
  return {
    roastDate: textOrNull(data.get('roastDate')),
    roastLevel: textOrNull(data.get('roastLevel')),
    weight: {
      present: data.has('weight'),
      value: numberOrNullInput(data.get('weight'))
    },
    weightRemaining: {
      present: data.has('weightRemaining'),
      value: numberOrNullInput(data.get('weightRemaining'))
    }
  };
}

function inputValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'number') {
    const rounded = Math.round(value * 1000) / 1000;
    return String(rounded);
  }
  return String(value);
}
