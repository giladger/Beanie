import type { Grinder } from '../api/types';
import { icon } from '../components/icons';
import { escapeAttr, escapeHtml } from '../components/html';

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

export function renderImportProfileModal(state: {
  code: string;
  busy: boolean;
  error: string | null;
}): string {
  const disabled = state.busy ? 'disabled' : '';
  return `
    <div class="modal-backdrop" data-action="${state.busy ? 'noop' : 'close-modal'}">
      <section class="modal machine-label-modal" role="dialog" aria-modal="true" aria-label="Import profile from Visualizer" data-action="noop">
        <div class="modal-head">
          <div>
            <span class="eyebrow">Visualizer</span>
            <h2>Import profile</h2>
          </div>
          <button type="button" class="icon-button" data-action="close-modal" aria-label="Close" ${disabled}>${icon('x')}</button>
        </div>
        <input class="machine-label-input" data-action="import-profile-input" value="${escapeAttr(state.code)}" placeholder="Share code" autocomplete="off" ${disabled} />
        ${
          state.error
            ? `<p class="profile-import-error">${escapeHtml(state.error)}</p>`
            : `<p class="profile-import-hint">Enter the share code from visualizer.coffee. Private shots need your Visualizer credentials set in Settings.</p>`
        }
        <div class="modal-actions">
          <button type="button" class="text-button" data-action="close-modal" ${disabled}>Cancel</button>
          <button type="button" class="command primary" data-action="import-profile-submit" ${disabled}>${icon('arrow-down')}<span>${state.busy ? 'Importing…' : 'Import'}</span></button>
        </div>
      </section>
    </div>
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

export function renderProfileNotesModal(notes: string): string {
  return `
    <div class="modal-backdrop notes-modal-backdrop" data-action="close-modal">
      <section class="modal profile-notes-modal" role="dialog" aria-modal="true" aria-label="Edit notes" data-action="noop">
        <div class="modal-head">
          <div>
            <span class="eyebrow">Profile</span>
            <h2>Notes</h2>
          </div>
          <button type="button" class="icon-button" data-action="close-modal" aria-label="Close">${icon('x')}</button>
        </div>
        <textarea class="profile-notes-input" data-action="pe-notes-input" spellcheck="true" placeholder="Tasting notes, dial-in tips, anything worth remembering…">${escapeHtml(notes)}</textarea>
        <div class="modal-actions">
          <button type="button" class="text-button" data-action="close-modal">Cancel</button>
          <button type="button" class="command primary" data-action="pe-notes-save">${icon('check')}<span>Save</span></button>
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
