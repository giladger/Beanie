import type { Bean, Grinder } from '../api/types';
import { beanLabel } from '../domain/beanWorkflow';
import { icon } from '../components/icons';
import { escapeAttr, escapeHtml } from '../components/html';

export function renderBeanEditorPage(headerHtml: string, bean: Bean | null): string {
  const v = (value: string | null | undefined) => escapeAttr(value ?? '');
  return `
    ${headerHtml}
    <form id="bean-form" class="page-body form-page" data-form="bean-editor">
      <label>Roaster<input name="roaster" required autocomplete="off" value="${v(bean?.roaster)}" /></label>
      <label>Coffee<input name="name" required autocomplete="off" value="${v(bean?.name)}" /></label>
      <div class="field-row">
        <label>Country<input name="country" autocomplete="off" value="${v(bean?.country)}" /></label>
        <label>Region<input name="region" autocomplete="off" value="${v(bean?.region)}" /></label>
      </div>
      <label>Process<input name="processing" autocomplete="off" value="${v(bean?.processing)}" /></label>
      <label>Notes<textarea name="notes" rows="3">${escapeHtml(bean?.notes ?? '')}</textarea></label>
    </form>
  `;
}

export function renderBatchEditorPage(
  headerHtml: string,
  bean: Bean | null,
  formNumbers: Record<string, string>
): string {
  return `
    ${headerHtml}
    <form id="batch-form" class="page-body form-page" data-form="batch-editor">
      <p class="modal-hint">${escapeHtml(bean ? beanLabel(bean) : 'No bean selected')}</p>
      <div class="field-row">
        <label>Roast date<input type="date" name="roastDate" /></label>
        <label>Roast level<input name="roastLevel" autocomplete="off" /></label>
      </div>
      <div class="field-row">
        ${formNumber('batch-form:weight', 'weight', 'Bag weight', formNumbers['batch-form:weight'] ?? '', 1, 'g')}
        ${formNumber('batch-form:weightRemaining', 'weightRemaining', 'Remaining', formNumbers['batch-form:weightRemaining'] ?? '', 1, 'g')}
      </div>
      <label class="switch inline-switch"><input type="checkbox" name="frozen" /><span>Frozen</span></label>
    </form>
  `;
}

export function renderGrinderEditorPage(
  headerHtml: string,
  grinder: Grinder | null,
  formNumbers: Record<string, string>
): string {
  const grinderKey = grinder?.id ?? 'new';
  const smallKey = `grinder-form:${grinderKey}:settingSmallStep`;
  const bigKey = `grinder-form:${grinderKey}:settingBigStep`;
  return `
    ${headerHtml}
    <form id="grinder-form" class="page-body form-page" data-form="grinder-editor">
      <label>Model<input name="model" required autocomplete="off" value="${escapeAttr(grinder?.model ?? '')}" /></label>
      <label>Burrs<input name="burrs" autocomplete="off" value="${escapeAttr(grinder?.burrs ?? '')}" /></label>
      <label>Setting type
        <select name="settingType">
          <option value="numeric" ${grinder?.settingType === 'numeric' || !grinder?.settingType ? 'selected' : ''}>Numeric</option>
          <option value="preset" ${grinder?.settingType === 'preset' ? 'selected' : ''}>Preset</option>
        </select>
      </label>
      <div class="field-row">
        ${formNumber(smallKey, 'settingSmallStep', 'Small step', formNumbers[smallKey] ?? String(grinder?.settingSmallStep ?? 0.1), 0.01)}
        ${formNumber(bigKey, 'settingBigStep', 'Big step', formNumbers[bigKey] ?? String(grinder?.settingBigStep ?? 1), 0.1)}
      </div>
    </form>
  `;
}

export function renderMachineLabelModal(label: string): string {
  return `
    <div class="modal-backdrop" data-action="close-modal">
      <section class="modal machine-label-modal" role="dialog" aria-modal="true" aria-label="Rename button" data-action="noop">
        <div class="modal-head">
          <div>
            <span class="eyebrow">Button name</span>
            <h2>Rename</h2>
          </div>
          <button type="button" class="icon-button" data-action="close-modal" aria-label="Close">${icon('x')}</button>
        </div>
        <input class="machine-label-input" data-action="machine-label-input" value="${escapeAttr(label)}" autocomplete="off" />
        <div class="modal-actions">
          <button type="button" class="text-button" data-action="close-modal">Cancel</button>
          <button type="button" class="command primary" data-action="machine-label-save">${icon('pencil')}<span>Rename</span></button>
        </div>
      </section>
    </div>
  `;
}

function formNumber(
  formKey: string,
  name: string,
  label: string,
  value: string,
  step: number,
  unit = ''
): string {
  const unitAttr = unit ? ` data-unit="${escapeAttr(unit)}"` : '';
  const suffix = unit ? `<em>${escapeHtml(unit)}</em>` : '';
  return `
    <label>${escapeHtml(label)}
      <input type="hidden" name="${escapeAttr(name)}" value="${escapeAttr(value)}" />
      <button type="button" class="number-edit-button form-number-button" data-action="open-number-edit" data-target="form-field" data-form-key="${escapeAttr(formKey)}" data-title="${escapeAttr(label)}" data-value="${escapeAttr(value)}" data-min="0" data-max="${unit ? '5000' : '100'}" data-step="${step}"${unitAttr}>${escapeHtml(value || '--')}${suffix}</button>
    </label>
  `;
}
