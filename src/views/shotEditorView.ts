import type { Bean, BeanBatch, Grinder, ShotRecord } from '../api/types';
import { batchOptionLabel } from '../domain/beanDisplay';
import { beanLabel } from '../domain/beanWorkflow';
import {
  batchAndBeanForId,
  type ShotBeanEditState,
  type ShotEditDraft,
  type ShotEditField,
  type ShotFieldSpec,
  type ShotNumberField,
  calculatedEy,
  shotDraftBean,
  shotEditDraftFromShot,
  shotFieldSpec,
  shotNumberFieldStep
} from '../domain/shotEditModel';
import { icon } from '../components/icons';
import { shotScoreControl } from '../components/shotScore';
import { escapeAttr, escapeHtml } from '../components/html';

export interface ShotEditModalViewModel {
  shotId: string;
  shotLabel: string;
  draft: ShotEditDraft;
  grinders: Grinder[];
  beanSummary: {
    batchLabel: string | null;
  };
  fieldDialog: {
    field: ShotEditField;
    spec: ShotFieldSpec;
  } | null;
  beanDialog: {
    state: ShotBeanEditState;
    selectedBeanId: string | null;
    beans: Bean[];
    prefillBeans: Bean[];
  } | null;
}

export interface ShotEditorViewInput {
  shot: ShotRecord;
  draft: ShotEditDraft | null;
  field: ShotEditField | null;
  beanDialog: ShotBeanEditState | null;
  grinders: Grinder[];
  beans: Bean[];
  batchesByBean: Record<string, BeanBatch[]>;
  shots: ShotRecord[];
}

/** Builds the complete editor presentation without exposing AppState to the view. */
export function renderShotEditor(input: ShotEditorViewInput): string {
  const draft = input.draft?.shotId === input.shot.id
    ? input.draft
    : shotEditDraftFromShot(input.shot);
  const shotDate = new Date(input.shot.timestamp);
  const shotLabel = Number.isNaN(shotDate.valueOf())
    ? input.shot.timestamp
    : shotDate.toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
  const batch = batchAndBeanForId(
    draft.beanBatchId,
    input.beans,
    input.batchesByBean
  )?.batch ?? null;
  return renderShotEditModal({
    shotId: input.shot.id,
    shotLabel,
    draft,
    grinders: input.grinders,
    beanSummary: {
      batchLabel: batch ? batchOptionLabel(batch) : draft.beanBatchId ? 'Saved batch' : null
    },
    fieldDialog: input.field
      ? {
          field: input.field,
          spec: shotFieldSpec(input.field, draft, input.grinders, input.shots)
        }
      : null,
    beanDialog: input.beanDialog
      ? {
          state: input.beanDialog,
          selectedBeanId: shotDraftBean(draft, input.beans, input.batchesByBean)?.id ?? null,
          beans: input.beans,
          prefillBeans: input.beans
        }
      : null
  });
}

export function renderShotEditModal(model: ShotEditModalViewModel): string {
  const { draft } = model;
  return `
    <div class="modal-backdrop" data-action="close-modal">
      <form class="modal panel shot-edit-modal" data-form="shot-dye-editor" data-id="${escapeAttr(model.shotId)}" data-action="noop">
        <div class="modal-head shot-edit-head">
          <div>
            <h2>Edit shot</h2>
            <p class="modal-hint">${escapeHtml(model.shotLabel)}</p>
          </div>
          <div class="shot-edit-head-actions">
            <button type="button" class="icon-button danger-icon" data-action="delete-shot" data-id="${escapeAttr(model.shotId)}" aria-label="Delete shot" title="Delete shot">${icon('trash-2')}</button>
            <button type="button" class="icon-button" data-action="close-modal" aria-label="Close">${icon('x')}</button>
          </div>
        </div>

        <div class="shot-edit-grid">
          <fieldset class="shot-edit-section">
            <legend>Bean</legend>
            <div class="shot-edit-fields">
              ${renderShotBeanControl(draft, model.beanSummary)}
              ${field('finalBeverageType', 'Drink', draft.finalBeverageType)}
              ${field('baristaName', 'Barista', draft.baristaName)}
              ${field('drinkerName', 'Drinker', draft.drinkerName)}
            </div>
          </fieldset>

          <fieldset class="shot-edit-section">
            <legend>Recipe</legend>
            <div class="shot-edit-fields">
              ${numberField('targetDoseWeight', 'Target in', draft.targetDoseWeight)}
              ${numberField('targetYield', 'Target out', draft.targetYield)}
              ${numberField('actualDoseWeight', 'Actual in', draft.actualDoseWeight)}
              ${numberField('actualYield', 'Actual out', draft.actualYield)}
              ${field('grinderId', 'Grinder', grinderDisplayLabel(draft.grinderId, model.grinders) ?? draft.grinderModel)}
              ${field('grinderSetting', 'Grind', draft.grinderSetting)}
            </div>
          </fieldset>

          <fieldset class="shot-edit-section">
            <legend>Result</legend>
            <div class="shot-edit-fields">
              ${numberField('drinkTds', 'TDS', draft.drinkTds)}
              ${numberField('drinkEy', 'EY', draft.drinkEy, eyCalcHint(draft))}
              <label class="wide">
                <span>Score</span>
                ${shotScoreControl(draft.enjoyment, { action: 'shot-edit-score', variant: 'edit' })}
              </label>
              ${field('espressoNotes', 'Notes', draft.espressoNotes, true, true)}
            </div>
          </fieldset>
        </div>

        <div class="modal-actions shot-edit-actions">
          <button type="button" class="command" data-action="close-modal">Cancel</button>
          <button type="submit" class="command primary commit-action">${icon('check')}<span>Save</span></button>
        </div>
      </form>
      ${renderShotFieldDialog(model.fieldDialog)}
      ${renderShotBeanDialog(model.beanDialog)}
    </div>
  `;
}

function field(
  name: ShotEditField,
  label: string,
  value: unknown,
  wide = false,
  multiline = false
): string {
  return `
    <label class="${wide ? 'wide' : ''}">
      <span>${escapeHtml(label)}</span>
      <button type="button" class="shot-edit-value ${multiline ? 'multiline' : ''}" data-action="open-shot-field" data-field="${escapeAttr(name)}">
        <strong>${escapeHtml(fieldDisplayValue(name, value))}</strong>
      </button>
    </label>
  `;
}

function numberField(name: ShotNumberField, label: string, value: number | null, extra = ''): string {
  return `
    <label>
      <span>${escapeHtml(label)}</span>
      <button
        type="button"
        class="shot-edit-value number-edit-button"
        data-action="open-number-edit"
        data-target="shot-edit"
        data-field="${escapeAttr(name)}"
        data-title="${escapeAttr(label)}"
        data-value="${escapeAttr(inputValue(value))}"
        data-min="0"
        data-max="9999"
        data-step="${escapeAttr(shotNumberFieldStep(name))}"
        data-return-modal="edit-shot"
      ><strong>${escapeHtml(inputValue(value) || '--')}</strong></button>
      ${extra}
    </label>
  `;
}

// Offer the EY derived from the entered TDS and weights as a one-tap fill.
// Hidden once the recorded EY already matches the arithmetic.
function eyCalcHint(draft: ShotEditDraft): string {
  const calculated = calculatedEy(draft);
  if (calculated == null) return '';
  if (draft.drinkEy != null && Math.abs(draft.drinkEy - calculated) < 0.05) return '';
  return `
    <button type="button" class="ey-calc-hint" data-action="shot-edit-ey-calc" data-value="${escapeAttr(String(calculated))}" title="Use the EY calculated from TDS, dose, and yield">
      = ${escapeHtml(String(calculated))}% from TDS
    </button>
  `;
}

// One wide control standing in for roaster + bean + batch. Tapping it opens
// the combined picker; on its own it just summarises the current bag.
function renderShotBeanControl(draft: ShotEditDraft, beanSummary: ShotEditModalViewModel['beanSummary']): string {
  return `
    <label class="wide">
      <span>Bean</span>
      <button type="button" class="shot-edit-value shot-bean-value" data-action="open-shot-bean">
        <strong>${escapeHtml(shotBeanLabel(draft))}</strong>
        <small>${escapeHtml(beanSummary.batchLabel ?? 'No batch')}</small>
      </button>
    </label>
  `;
}

function renderShotBeanDialog(dialog: ShotEditModalViewModel['beanDialog']): string {
  if (!dialog) return '';
  const body = dialog.state.creating
    ? renderShotBeanCreateForm(dialog.prefillBeans)
    : renderShotBeanPicker(dialog.selectedBeanId, dialog.beans);
  return `
    <div class="modal-backdrop shot-field-backdrop shot-bean-backdrop" data-action="close-shot-bean">
      <section class="modal panel shot-field-dialog shot-bean-dialog" role="dialog" aria-modal="true" aria-label="Choose bean" data-action="noop">
        <div class="modal-head shot-edit-head">
          <div>
            <span class="eyebrow">Edit</span>
            <h2>${dialog.state.creating ? 'New bean' : 'Bean'}</h2>
          </div>
          <div class="shot-edit-head-actions">
            ${
              dialog.state.creating
                ? ''
                : `<button type="button" class="icon-button" data-action="shot-bean-new" aria-label="Add bean" title="Add bean">${icon('plus')}</button>`
            }
            <button type="button" class="icon-button" data-action="close-shot-bean" aria-label="Close">${icon('x')}</button>
          </div>
        </div>
        ${body}
      </section>
    </div>
  `;
}

function renderShotBeanPicker(selectedId: string | null, beans: Bean[]): string {
  const beanButton = (bean: Bean) => `
    <button type="button" class="${bean.id === selectedId ? 'active' : ''}" data-action="shot-bean-pick" data-id="${escapeAttr(bean.id)}">
      <strong>${escapeHtml(bean.name)}</strong>
      <small>${escapeHtml(bean.roaster)}${bean.country ? ` · ${escapeHtml(bean.country)}` : ''}</small>
    </button>
  `;
  return `
    <div class="shot-bean-section">
      <span class="eyebrow">Bag</span>
      <div class="shot-field-options shot-bean-list" aria-label="Beans">
        <button type="button" class="${selectedId ? '' : 'active'}" data-action="shot-bean-pick" data-id="">
          <strong>No bean</strong>
        </button>
        ${beans.length === 0 ? '<p class="empty-history">No beans yet.</p>' : beans.map(beanButton).join('')}
      </div>
    </div>
    <div class="modal-actions shot-edit-actions">
      <button type="button" class="command primary" data-action="close-shot-bean">Done</button>
    </div>
  `;
}

function renderShotBeanCreateForm(prefillBeans: Bean[]): string {
  const text = (name: string, label: string, required = false) => `
    <label>${escapeHtml(label)}<input name="${name}" autocomplete="off"${required ? ' required' : ''} /></label>
  `;
  return `
    <form class="shot-bean-create" data-form="shot-bean-create" data-action="noop">
      ${beanPrefillSelect(prefillBeans)}
      <div class="shot-bean-create-fields">
        ${text('roaster', 'Roaster', true)}
        ${text('name', 'Bean', true)}
        ${text('country', 'Country')}
        ${text('region', 'Region')}
        ${text('processing', 'Process')}
      </div>
      <div class="modal-actions shot-edit-actions">
        <button type="button" class="command" data-action="shot-bean-cancel-new">Cancel</button>
        <button type="submit" class="command primary">${icon('check')}<span>Add bean</span></button>
      </div>
    </form>
  `;
}

function renderShotFieldDialog(dialog: ShotEditModalViewModel['fieldDialog']): string {
  if (!dialog) return '';
  const { field: fieldName, spec } = dialog;
  const input =
    spec.kind === 'textarea'
      ? `<textarea name="value" rows="5" spellcheck="true">${escapeHtml(spec.value)}</textarea>`
      : spec.kind === 'number'
        ? `<input name="value" value="${escapeAttr(spec.value)}" inputmode="decimal" autocomplete="off" />`
        : `<input name="value" value="${escapeAttr(spec.value)}" autocomplete="off" />`;
  const options =
    spec.options.length === 0
      ? ''
      : `<div class="shot-field-options" aria-label="${escapeAttr(spec.label)} options">
          ${spec.options
            .map(
              (option) => `
                <button type="button" data-action="shot-field-option" data-field="${escapeAttr(fieldName)}" data-value="${escapeAttr(option.value)}">
                  <strong>${escapeHtml(option.label)}</strong>
                  ${option.detail ? `<small>${escapeHtml(option.detail)}</small>` : ''}
                </button>
              `
            )
            .join('')}
        </div>`;

  return `
    <div class="modal-backdrop shot-field-backdrop" data-action="close-shot-field">
      <form class="modal panel shot-field-dialog" data-form="shot-field-dialog" data-field="${escapeAttr(fieldName)}" data-action="noop">
        <div class="modal-head shot-edit-head">
          <div>
            <span class="eyebrow">Edit</span>
            <h2>${escapeHtml(spec.label)}</h2>
          </div>
          <button type="button" class="icon-button" data-action="close-shot-field" aria-label="Close">${icon('x')}</button>
        </div>
        <label class="shot-field-input">
          <span>${escapeHtml(spec.label)}</span>
          ${input}
        </label>
        ${options}
        <div class="modal-actions shot-edit-actions">
          <button type="button" class="command" data-action="close-shot-field">Cancel</button>
          <button type="submit" class="command primary">Done</button>
        </div>
      </form>
    </div>
  `;
}

function beanPrefillSelect(beans: Bean[]): string {
  if (beans.length === 0) return '';
  return `
    <label class="bean-prefill">
      <span>Copy from</span>
      <select data-action="bean-prefill" aria-label="Copy details from an existing bean">
        <option value="">Start blank</option>
        ${beans.map((bean) => `<option value="${escapeAttr(bean.id)}">${escapeHtml(beanLabel(bean))}</option>`).join('')}
      </select>
    </label>
  `;
}

function fieldDisplayValue(fieldName: ShotEditField, value: unknown): string {
  const text = inputValue(value);
  if (!text) return '--';
  if (fieldName === 'espressoNotes') return text.length > 52 ? `${text.slice(0, 49)}...` : text;
  return text;
}

function grinderDisplayLabel(grinderId: string | null, grinders: Grinder[]): string | null {
  if (!grinderId) return null;
  return grinders.find((grinder) => grinder.id === grinderId)?.model ?? grinderId;
}

function shotBeanLabel(draft: ShotEditDraft): string {
  const roaster = (draft.coffeeRoaster ?? '').trim();
  const name = (draft.coffeeName ?? '').trim();
  if (roaster && name) return `${roaster} · ${name}`;
  return name || roaster || 'No bean';
}

function inputValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(round(value, 3));
  return String(value);
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
