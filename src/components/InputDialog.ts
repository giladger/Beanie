import type { Grinder } from '../api/types';
import { icon } from './icons';

export type InputDialogKind = 'dose' | 'yield' | 'ratio' | 'grind' | 'temperature';
export type InputDialogField = 'dose' | 'yield' | 'ratio' | 'grinderSetting' | 'temperature';

export interface InputDialogChoice {
  id: string;
  label: string;
  detail?: string;
}

export interface InputDialogState {
  field: InputDialogField;
  kind: InputDialogKind;
  title: string;
  value: string;
  originalValue: string;
  unit: string;
  helper: string;
  step: number;
  bigStep: number;
  digits: number;
  min: number;
  max: number;
  maxLength: number;
  allowDecimal: boolean;
  replaceOnNextKey: boolean;
  recentValues: string[];
  choiceTitle?: string;
  choices: InputDialogChoice[];
  selectedChoiceId?: string | null;
}

export interface CreateInputDialogOptions {
  field: InputDialogField;
  kind: InputDialogKind;
  value?: string | number | null;
  title?: string;
  unit?: string;
  helper?: string;
  step?: number;
  bigStep?: number;
  digits?: number;
  min?: number;
  max?: number;
  maxLength?: number;
  allowDecimal?: boolean;
  recentValues?: string[];
  choiceTitle?: string;
  choices?: InputDialogChoice[];
  selectedChoiceId?: string | null;
}

interface InputDialogPreset {
  title: string;
  unit: string;
  helper: string;
  defaultValue: string;
  step: number;
  bigStep: number;
  digits: number;
  min: number;
  max: number;
  maxLength: number;
  allowDecimal: boolean;
}

const recentKeyPrefix = 'beanie:input-dialog-recents:';

const presets: Record<InputDialogKind, InputDialogPreset> = {
  dose: {
    title: 'Dose',
    unit: 'g',
    helper: 'Input value between 1 and 120',
    defaultValue: '18',
    step: 0.5,
    bigStep: 1,
    digits: 1,
    min: 1,
    max: 120,
    maxLength: 6,
    allowDecimal: true
  },
  yield: {
    title: 'Yield',
    unit: 'g',
    helper: 'Input value between 1 and 200',
    defaultValue: '40',
    step: 1,
    bigStep: 5,
    digits: 1,
    min: 1,
    max: 200,
    maxLength: 6,
    allowDecimal: true
  },
  ratio: {
    title: 'Ratio',
    unit: 'x',
    helper: 'Input brew ratio between 1.0 and 6.0',
    defaultValue: '2',
    step: 0.1,
    bigStep: 0.5,
    digits: 2,
    min: 1,
    max: 6,
    maxLength: 5,
    allowDecimal: true
  },
  grind: {
    title: 'Grind',
    unit: '',
    helper: 'Input grinder setting between 0 and 9999',
    defaultValue: '',
    step: 0.1,
    bigStep: 1,
    digits: 2,
    min: 0,
    max: 9999,
    maxLength: 7,
    allowDecimal: true
  },
  temperature: {
    title: 'Temperature',
    unit: 'C',
    helper: 'Input temperature between 70 and 110',
    defaultValue: '93',
    step: 1,
    bigStep: 5,
    digits: 1,
    min: 70,
    max: 110,
    maxLength: 5,
    allowDecimal: true
  }
};

export function createInputDialog(options: CreateInputDialogOptions): InputDialogState {
  const preset = presets[options.kind];
  const value = normalizeInitialValue(options.value, preset.defaultValue);

  return {
    field: options.field,
    kind: options.kind,
    title: options.title ?? preset.title,
    value,
    originalValue: value,
    unit: options.unit ?? preset.unit,
    helper: options.helper ?? preset.helper,
    step: options.step ?? preset.step,
    bigStep: options.bigStep ?? preset.bigStep,
    digits: options.digits ?? preset.digits,
    min: options.min ?? preset.min,
    max: options.max ?? preset.max,
    maxLength: options.maxLength ?? preset.maxLength,
    allowDecimal: options.allowDecimal ?? preset.allowDecimal,
    replaceOnNextKey: true,
    recentValues: uniqueValues(options.recentValues ?? readInputDialogRecents(options.kind)),
    choiceTitle: options.choiceTitle,
    choices: options.choices ?? [],
    selectedChoiceId: options.selectedChoiceId ?? null
  };
}

export function inputDialogKindForField(field: InputDialogField): InputDialogKind {
  return field === 'grinderSetting' ? 'grind' : field;
}

export function readInputDialogRecents(kind: InputDialogKind): string[] {
  try {
    const raw = localStorage.getItem(recentKey(kind));
    return raw ? uniqueValues(JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function rememberInputDialogValue(kind: InputDialogKind, value: string): void {
  const next = value.trim();
  if (!next) return;
  const values = uniqueValues([next, ...readInputDialogRecents(kind)]).slice(0, 8);
  localStorage.setItem(recentKey(kind), JSON.stringify(values));
}

export function parseInputDialogNumber(value: string): number | null {
  const parsed = Number.parseFloat(value.replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

export function setInputDialogValue(dialog: InputDialogState, value: string): InputDialogState {
  return {
    ...dialog,
    value: sanitizeValue(value, dialog),
    replaceOnNextKey: false
  };
}

export function clearInputDialogValue(dialog: InputDialogState): InputDialogState {
  return { ...dialog, value: '', replaceOnNextKey: false };
}

export function typeInputDialogKey(dialog: InputDialogState, key: string): InputDialogState {
  if (key === '.' && !dialog.allowDecimal) return dialog;
  if (key === '.' && dialog.value.includes('.') && !dialog.replaceOnNextKey) return dialog;
  if (key !== '.' && !/^\d$/.test(key)) return dialog;

  const prefix = dialog.replaceOnNextKey ? '' : dialog.value;
  const raw =
    key === '.' && prefix === ''
      ? '0.'
      : prefix === '0' && key !== '.'
        ? key
        : `${prefix}${key}`;

  return {
    ...dialog,
    value: sanitizeValue(raw, dialog),
    replaceOnNextKey: false
  };
}

export function backspaceInputDialogValue(dialog: InputDialogState): InputDialogState {
  return {
    ...dialog,
    value: dialog.replaceOnNextKey ? '' : dialog.value.slice(0, -1),
    replaceOnNextKey: false
  };
}

export function nudgeInputDialogValue(dialog: InputDialogState, delta: number): InputDialogState {
  const current = parseInputDialogNumber(dialog.value) ?? parseInputDialogNumber(dialog.originalValue) ?? 0;
  const next = clamp(current + delta, dialog.min, dialog.max);
  return setInputDialogValue(dialog, formatNumber(next, dialog.digits));
}

export function selectInputDialogChoice(
  dialog: InputDialogState,
  choiceId: string | null
): InputDialogState {
  return { ...dialog, selectedChoiceId: choiceId };
}

export function inputDialogCommitValue(dialog: InputDialogState): string {
  const parsed = parseInputDialogNumber(dialog.value);
  if (parsed == null) return dialog.value.trim();
  return formatNumber(clamp(parsed, dialog.min, dialog.max), dialog.digits);
}

export function grinderChoicesFromGrinders(grinders: Grinder[]): InputDialogChoice[] {
  return grinders.map((grinder) => {
    const parts = [
      grinder.burrs,
      grinder.settingSmallStep != null ? `step ${formatNumber(grinder.settingSmallStep, 2)}` : null
    ].filter(Boolean);
    return {
      id: grinder.id,
      label: grinder.model,
      detail: parts.join(' / ')
    };
  });
}

export function renderInputDialog(dialog: InputDialogState): string {
  const nudges = nudgeValues(dialog);
  const unit = dialog.unit ? `<span>${escapeHtml(dialog.unit)}</span>` : '';

  return `
    <div class="modal-backdrop">
      <div class="input-dialog panel" role="dialog" aria-modal="true" aria-labelledby="input-dialog-title">
        <div class="modal-head input-dialog-head">
          <div>
            <span class="eyebrow">Input</span>
            <h2 id="input-dialog-title">${escapeHtml(dialog.title)}</h2>
          </div>
          <button type="button" class="icon-button" data-action="close-modal" aria-label="Close" title="Close">${icon('x')}</button>
        </div>
        <div class="input-dialog-body">
          <section class="input-dialog-main">
            <div class="input-dialog-display" aria-live="polite">
              <strong>${escapeHtml(dialog.value || '--')}${unit}</strong>
              <small>${escapeHtml(dialog.helper)}</small>
            </div>
            <div class="input-dialog-nudges" aria-label="${escapeAttr(dialog.title)} quick adjustments">
              ${nudges.map((delta) => `
                <button type="button" data-action="dialog-adjust" data-delta="${delta}">${delta > 0 ? '+' : ''}${escapeHtml(formatNudge(delta))}</button>
              `).join('')}
            </div>
            ${renderRecents(dialog)}
            ${renderChoices(dialog)}
          </section>
          <section class="keypad input-dialog-keypad" aria-label="Numeric keypad">
            ${['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0'].map((key) => `
              <button type="button" data-action="dialog-key" data-key="${key}" ${key === '.' && !dialog.allowDecimal ? 'disabled' : ''}>${key}</button>
            `).join('')}
            <button type="button" data-action="dialog-backspace" aria-label="Backspace">${icon('delete')}</button>
            <button type="button" class="muted-key" data-action="dialog-clear">Clear</button>
            <button type="button" class="commit-key" data-action="dialog-commit">Done</button>
          </section>
        </div>
      </div>
    </div>
  `;
}

function renderRecents(dialog: InputDialogState): string {
  if (dialog.recentValues.length === 0) return '';
  return `
    <div class="input-dialog-recents" aria-label="Recent ${escapeAttr(dialog.title)} values">
      <span>Recent</span>
      <div>
        ${dialog.recentValues.map((value) => `
          <button type="button" data-action="dialog-recent" data-value="${escapeAttr(value)}">${escapeHtml(value)}</button>
        `).join('')}
      </div>
    </div>
  `;
}

function renderChoices(dialog: InputDialogState): string {
  if (dialog.choices.length === 0) return '';
  const noneActive = !dialog.selectedChoiceId;
  return `
    <div class="input-dialog-choices" role="listbox" aria-label="${escapeAttr(dialog.choiceTitle ?? 'Choices')}">
      <span>${escapeHtml(dialog.choiceTitle ?? 'Choices')}</span>
      <button type="button" class="${noneActive ? 'active' : ''}" data-action="dialog-choice" data-id="">No grinder</button>
      ${dialog.choices.map((choice) => `
        <button type="button" class="${choice.id === dialog.selectedChoiceId ? 'active' : ''}" data-action="dialog-choice" data-id="${escapeAttr(choice.id)}">
          <strong>${escapeHtml(choice.label)}</strong>
          ${choice.detail ? `<small>${escapeHtml(choice.detail)}</small>` : ''}
        </button>
      `).join('')}
      <button type="button" class="input-dialog-add-choice" data-action="open-add-grinder">${icon('plus')}<span>Add grinder</span></button>
    </div>
  `;
}

function nudgeValues(dialog: InputDialogState): number[] {
  return uniqueNumbers([-dialog.bigStep, -dialog.step, dialog.step, dialog.bigStep]);
}

function sanitizeValue(value: string, dialog: Pick<InputDialogState, 'allowDecimal' | 'maxLength'>): string {
  const allowed = dialog.allowDecimal ? /[^\d.]/g : /\D/g;
  let next = value.replace(allowed, '');
  if (dialog.allowDecimal) {
    const dot = next.indexOf('.');
    if (dot >= 0) {
      next = `${next.slice(0, dot + 1)}${next.slice(dot + 1).replaceAll('.', '')}`;
    }
  }
  return next.slice(0, dialog.maxLength);
}

function normalizeInitialValue(value: string | number | null | undefined, fallback: string): string {
  if (typeof value === 'number' && Number.isFinite(value)) return value.toString();
  if (typeof value === 'string') return value.replace(/[^\d.]/g, '');
  return fallback;
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values)].filter((value) => value !== 0);
}

function recentKey(kind: InputDialogKind): string {
  return `${recentKeyPrefix}${kind}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatNudge(value: number): string {
  return Number.isInteger(value) ? value.toString() : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function formatNumber(value: number, digits: number): string {
  const rounded = round(value, digits);
  return Number.isInteger(rounded) ? rounded.toString() : rounded.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '');
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
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
