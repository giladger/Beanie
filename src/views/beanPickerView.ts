import type { Bean, BeanBatch, BeanBatchStorageEvent } from '../api/types';
import {
  batchStorageState,
  beanLabel,
  computeBeanFreshness,
  freshnessBadgeLabel,
  latestBatch,
  storageStatusLabel
} from '../domain/beanWorkflow';
import { batchOptionLabel, dateInputValue, recentBatches } from '../domain/beanDisplay';
import { icon } from '../components/icons';
import { escapeAttr, escapeHtml } from '../components/html';

export interface BeanPickerViewModel {
  search: string;
  autofocusSearch: boolean;
  matches: Bean[];
  focusedBean: Bean | null;
  mode: 'inspect' | 'create';
  selectedBeanId: string | null;
  batchesByBean: Record<string, BeanBatch[]>;
  prefillBeans: Bean[];
  secondTapHint: { kind: 'shot' | 'bean'; id: string } | null;
}

export function renderBeanPickerModal(model: BeanPickerViewModel): string {
  const focusedId = model.focusedBean?.id ?? null;
  const autofocus = model.autofocusSearch ? ' autofocus' : '';
  const creating = model.mode === 'create';
  return `
    <div class="modal-backdrop bean-picker-backdrop" data-action="close-modal">
      <section class="modal panel bean-picker-modal ${creating ? 'create-mode' : ''}" role="dialog" aria-modal="true" aria-label="${creating ? 'New bean' : 'Pick a bag'}" data-action="noop">
        <div class="modal-head bean-picker-head">
          <div>
            <span class="eyebrow">Beans</span>
            <h2>${creating ? 'New bean' : 'Pick a bag'}</h2>
          </div>
          <div class="modal-head-actions">
            ${creating ? '' : `<button class="icon-button" data-action="open-add-bean" aria-label="Add bean" title="Add bean">${icon('plus')}</button>`}
            ${creating ? '' : `<button class="icon-button" data-action="open-label-scanner" aria-label="Scan a bag with AI" title="Scan a bag with AI">${icon('camera')}</button>`}
            <button class="icon-button" data-action="close-modal" aria-label="Close" title="Close">${icon('x')}</button>
          </div>
        </div>
        <div class="bean-picker-body">
          ${
            creating
              ? ''
              : `<div class="bean-picker-list-panel">
                  <label class="search bean-picker-search">
                    ${icon('search')}
                    <input type="search" data-action="search" value="${escapeAttr(model.search)}" placeholder="Search beans"${autofocus} />
                  </label>
                  <div class="bean-picker-list">
                    ${
                      model.matches.length === 0
                        ? '<p class="empty-history">No beans found.</p>'
                        : model.matches
                            .map((bean) =>
                              renderBeanPickerRow(bean, {
                                focused: bean.id === focusedId,
                                current: bean.id === model.selectedBeanId,
                                secondTapHint: model.secondTapHint
                              })
                            )
                            .join('')
                    }
                  </div>
                </div>`
          }
          ${renderBeanPickerInspector(model)}
        </div>
      </section>
    </div>
  `;
}

function renderBeanPickerRow(
  bean: Bean,
  options: { focused: boolean; current: boolean; secondTapHint: BeanPickerViewModel['secondTapHint'] }
): string {
  const hint = renderSecondTapHint('bean', bean.id, options.secondTapHint);
  const origin = bean.country ? `<small>${escapeHtml(bean.country)}</small>` : '';
  return `
    <button class="bean-row ${options.focused ? 'active' : ''} ${hint ? 'has-second-tap-hint' : ''}" data-action="inspect-bean" data-id="${escapeAttr(bean.id)}">
      <span>
        ${origin}
        <b>${escapeHtml(bean.roaster)}</b>
        <strong>${escapeHtml(bean.name)}</strong>
      </span>
      ${options.current ? '<em>In use</em>' : ''}
      ${hint}
    </button>
  `;
}

function renderBeanPickerInspector(model: BeanPickerViewModel): string {
  const bean = model.focusedBean;
  if (model.mode === 'create' || !bean) {
    return `
      <div class="bean-picker-inspector">
        ${renderBeanPickerBeanForm(null, model.prefillBeans)}
        <p class="bean-picker-hint">Save the bag first, then add roast batches.</p>
      </div>
    `;
  }

  const batches = model.batchesByBean[bean.id] ?? [];
  const visibleBatches = recentBatches(batches, 2);
  const currentBatchId = latestBatch(batches)?.id ?? null;
  return `
    <div class="bean-picker-inspector">
      ${renderBeanPickerBeanForm(bean, model.prefillBeans)}
      <div class="bean-picker-batches">
        <div class="bean-picker-section-head">
          <div>
            <span class="eyebrow">Batches</span>
            <strong>${escapeHtml(batches.length === 0 ? 'None' : batchOptionLabel(latestBatch(batches)!))}</strong>
          </div>
          <button type="button" class="secondary-button compact" data-action="bean-picker-add-batch">${icon('plus')}<span>Batch</span></button>
        </div>
        <div class="bean-picker-batch-list">
          ${
            batches.length === 0
              ? '<p class="empty-history">No batches yet.</p>'
              : visibleBatches.map((batch) => renderBeanPickerBatchForm(bean, batch, batch.id === currentBatchId)).join('')
          }
        </div>
      </div>
    </div>
  `;
}

function renderBeanPickerBeanForm(bean: Bean | null, prefillBeans: Bean[]): string {
  const editing = bean != null;
  const dataId = editing ? ` data-id="${escapeAttr(bean.id)}"` : '';
  return `
    <form class="bean-picker-bean-form" data-form="bean-picker-bean"${dataId}>
      <div class="bean-picker-section-head">
        <div>
          <span class="eyebrow">${editing ? 'Bean' : 'New bean'}</span>
          <strong>${escapeHtml(editing ? beanLabel(bean) : 'Add a bag')}</strong>
        </div>
        <div class="bean-picker-actions">
          ${
            editing
              ? `<button type="button" class="secondary-button compact" data-action="select-bean" data-id="${escapeAttr(bean.id)}">${icon('check')}<span>Use</span></button>
                 <button type="submit" class="primary-button compact">${icon('check')}<span>Save</span></button>
                 <button type="button" class="icon-button subtle-danger bean-delete-button" data-action="archive-bean" data-id="${escapeAttr(bean.id)}" aria-label="Delete bag" title="Delete bag">${icon('trash-2')}</button>`
              : `<button type="button" class="secondary-button compact" data-action="close-modal"><span>Cancel</span></button>`
          }
          ${editing ? '' : `<button type="submit" class="primary-button compact">${icon('check')}<span>Save</span></button>`}
        </div>
      </div>
      ${editing ? '' : beanPrefillSelect(prefillBeans)}
      <div class="bean-picker-fields">
        <label>Roaster<input name="roaster" required autocomplete="off" value="${escapeAttr(editing ? bean.roaster : '')}" /></label>
        <label>Bean<input name="name" required autocomplete="off" value="${escapeAttr(editing ? bean.name : '')}" /></label>
        <label>Country<input name="country" autocomplete="off" value="${escapeAttr(inputValue(editing ? bean.country : ''))}" /></label>
        <label>Region<input name="region" autocomplete="off" value="${escapeAttr(inputValue(editing ? bean.region : ''))}" /></label>
        <label>Process<input name="processing" autocomplete="off" value="${escapeAttr(inputValue(editing ? bean.processing : ''))}" /></label>
        <label class="bean-picker-notes">Notes<textarea name="notes" rows="4" autocomplete="off">${escapeHtml(inputValue(editing ? bean.notes : ''))}</textarea></label>
      </div>
    </form>
  `;
}

function renderBeanPickerBatchForm(bean: Bean, batch: BeanBatch, active: boolean): string {
  const freshness = freshnessBadgeLabel(batch);
  const storage = storageStatusLabel(batch) ?? (batchStorageState(batch) === 'ambient' ? 'On shelf' : 'Storage');
  const batchNumber = (name: 'weight' | 'weightRemaining', label: string, value: number | null | undefined) => `
    <label>${escapeHtml(label)}
      <input type="hidden" name="${name}" value="${escapeAttr(inputValue(value))}" />
      <button
        type="button"
        class="number-edit-button bean-picker-number"
        data-action="open-number-edit"
        data-target="bean-picker-batch"
        data-bean-id="${escapeAttr(bean.id)}"
        data-batch-id="${escapeAttr(batch.id)}"
        data-name="${name}"
        data-title="${escapeAttr(label)}"
        data-value="${escapeAttr(inputValue(value))}"
        data-min="0"
        data-max="5000"
        data-step="0.1"
        data-unit="g"
        data-return-modal="bean-picker"
      >${escapeHtml(inputValue(value) || '--')}<em>g</em></button>
    </label>
  `;
  return `
    <form
      class="bean-picker-batch ${active ? 'current' : ''}"
      data-form="bean-picker-batch"
      data-bean-id="${escapeAttr(bean.id)}"
      data-batch-id="${escapeAttr(batch.id)}"
    >
      <div class="bean-picker-batch-title">
        <strong>${escapeHtml(batchOptionLabel(batch))}</strong>
        <small>${escapeHtml([active ? 'Latest' : null, freshness, batch.roastLevel ?? null].filter(Boolean).join(' · ') || 'Batch')}</small>
      </div>
      <label>Date<input data-action="bean-picker-batch-field" type="date" name="roastDate" value="${escapeAttr(dateInputValue(batch.roastDate))}" /></label>
      <label>Roast<input data-action="bean-picker-batch-field" name="roastLevel" autocomplete="off" value="${escapeAttr(inputValue(batch.roastLevel))}" /></label>
      ${batchNumber('weight', 'Bag', batch.weight)}
      ${batchNumber('weightRemaining', 'Left', batch.weightRemaining)}
      <button type="button" class="bean-picker-storage" data-action="open-batch-storage" data-id="${escapeAttr(batch.id)}" data-bean-id="${escapeAttr(bean.id)}" title="Storage">${icon(batchStorageState(batch) === 'frozen' ? 'snowflake' : 'archive')}<span>${escapeHtml(storage)}</span></button>
      <button type="button" class="icon-button danger-icon bean-picker-batch-delete" data-action="delete-batch" data-id="${escapeAttr(batch.id)}" data-bean-id="${escapeAttr(bean.id)}" aria-label="Delete batch" title="Delete batch">${icon('trash-2')}</button>
    </form>
  `;
}

export function renderBatchStorageModal(
  bean: Bean,
  batch: BeanBatch,
  formNumbers: Record<string, string> = {}
): string {
  const state = batchStorageState(batch);
  const status = storageStatusLabel(batch) ?? 'On shelf now';
  const freshness = freshnessBadgeLabel(batch);
  const freshnessDetail = computeBeanFreshness(batch);
  const latest = [...(batch.storageEvents ?? [])].reverse().find((event) => event?.at);
  const remaining = typeof batch.weightRemaining === 'number' && Number.isFinite(batch.weightRemaining)
    ? batch.weightRemaining
    : null;
  const portionEditMax = remaining != null ? inputValue(remaining) : '5000';
  const portionPlaceholder = remaining != null ? inputValue(Math.min(remaining, 100)) : '100';
  const portionFormKey = freezePortionFormKey(batch.id);
  const portionValue = formNumbers[portionFormKey] ?? '';
  const portionDisplayValue = portionValue || portionPlaceholder;
  const nextEvent = state === 'frozen'
    ? {
        type: 'thawed' as const,
        title: 'Whole batch',
        button: 'Mark thawed',
        detail: 'Active age resumes from today.',
        icon: 'sun'
      }
    : {
        type: 'frozen' as const,
        title: 'Whole batch',
        button: 'Freeze whole batch',
        detail: 'Active age pauses from today.',
        icon: 'snowflake'
      };
  return `
    <div class="modal-backdrop bean-picker-backdrop" data-action="close-modal">
      <section class="modal panel batch-storage-modal" role="dialog" aria-modal="true" aria-label="Batch storage" data-action="noop">
        <div class="modal-head bean-picker-head">
          <div>
            <span class="eyebrow">Storage</span>
            <h2>${escapeHtml(batchOptionLabel(batch))}</h2>
          </div>
          <button class="icon-button" data-action="close-modal" aria-label="Close" title="Close">${icon('x')}</button>
        </div>
        <div class="batch-storage-body">
          <div class="batch-storage-summary">
            <span class="batch-storage-label">Current state</span>
            <strong>${escapeHtml(beanLabel(bean))}</strong>
            <span>${escapeHtml([status, freshness].filter(Boolean).join(' · '))}</span>
          </div>
          ${renderBatchFreshnessPanel(freshnessDetail)}
          <div class="batch-storage-card batch-storage-next">
            <div>
              <span class="batch-storage-label">Next action</span>
              <strong>${escapeHtml(nextEvent.title)}</strong>
              <p>${escapeHtml(nextEvent.detail)}</p>
            </div>
            <button type="button" class="primary-button" data-action="batch-storage-event" data-type="${nextEvent.type}">${icon(nextEvent.icon)}<span>${escapeHtml(nextEvent.button)}</span></button>
          </div>
          ${
            state === 'frozen'
              ? ''
              : `<form class="batch-storage-card batch-freeze-portion" data-form="batch-freeze-portion" data-form-key="${escapeAttr(portionFormKey)}">
                  <div>
                    <span class="batch-storage-label">Partial freezer stash</span>
                    <strong>Freeze part of this bag</strong>
                    <p>Create a separate frozen batch and subtract grams from this shelf batch.</p>
                  </div>
                  <label>Grams to freeze
                    <input type="hidden" name="amount" value="${escapeAttr(portionValue)}" />
                    <button
                      type="button"
                      class="number-edit-button batch-freeze-number"
                      data-action="open-number-edit"
                      data-target="form-field"
                      data-form-key="${escapeAttr(portionFormKey)}"
                      data-title="Grams to freeze"
                      data-value="${escapeAttr(portionDisplayValue)}"
                      data-min="0.1"
                      data-max="${escapeAttr(portionEditMax)}"
                      data-step="0.1"
                      data-unit="g"
                      data-return-modal="batch-storage"
                    >${escapeHtml(portionDisplayValue)}<em>g</em></button>
                  </label>
                  <button type="submit" class="secondary-button compact">${icon('snowflake')}<span>Create frozen portion</span></button>
                </form>`
          }
          ${renderBatchStorageDateControl(latest, state)}
          <p class="bean-picker-hint">Shots save the freshness at pull time, so later storage edits do not rewrite history.</p>
        </div>
      </section>
    </div>
  `;
}

function freezePortionFormKey(batchId: string): string {
  return `batch-storage:${batchId}:amount`;
}

function renderBatchStorageDateControl(
  latest: BeanBatchStorageEvent | undefined,
  state: ReturnType<typeof batchStorageState>
): string {
  const fallbackFrozen = !latest && state === 'frozen';
  if (!latest && !fallbackFrozen) {
    return `
      <div class="batch-storage-card batch-storage-date muted">
        <div>
          <span class="batch-storage-label">Dates</span>
          <strong>No freeze dates yet</strong>
          <p>Use Freeze whole batch or Freeze part of this bag to start tracking freezer time.</p>
        </div>
      </div>
    `;
  }

  const type = latest?.type ?? 'frozen';
  const label = type === 'frozen' ? 'Frozen on' : 'Thawed on';
  const title = latest
    ? type === 'frozen' ? 'Correct freeze date' : 'Correct thaw date'
    : 'Add freeze date';
  const detail = latest
    ? type === 'frozen'
      ? 'Use the day this batch actually went into the freezer.'
      : 'Use the day this batch actually came out of the freezer.'
    : 'Backfill when this batch first went into the freezer.';
  const dateValue = dateInputValue(latest?.at ?? new Date().toISOString());
  return `
    <form class="batch-storage-card batch-storage-date" data-form="batch-storage-date">
      <div>
        <span class="batch-storage-label">Date</span>
        <strong>${escapeHtml(title)}</strong>
        <p>${escapeHtml(detail)}</p>
      </div>
      <input type="hidden" name="type" value="${escapeAttr(type)}" />
      <label>${escapeHtml(label)}<input type="date" name="at" value="${escapeAttr(dateValue)}" /></label>
      <button type="submit" class="secondary-button compact">${icon('check')}<span>Save date</span></button>
    </form>
  `;
}

function renderBatchFreshnessPanel(freshness: ReturnType<typeof computeBeanFreshness>): string {
  if (!freshness) {
    return `
      <div class="batch-freshness-panel muted">
        <strong>Freshness</strong>
        <span>Add a roast date to track roast and active days.</span>
      </div>
    `;
  }
  return `
    <div class="batch-freshness-panel">
      <div>
        <span>Roast age</span>
        <strong>${escapeHtml(String(freshness.roastAgeDays))}<em>d</em></strong>
      </div>
      <div>
        <span>Active age</span>
        <strong>${escapeHtml(String(freshness.activeAgeDays))}<em>d</em></strong>
      </div>
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

function renderSecondTapHint(
  kind: 'shot' | 'bean',
  id: string,
  secondTapHint: BeanPickerViewModel['secondTapHint']
): string {
  if (!secondTapHint || secondTapHint.kind !== kind || secondTapHint.id !== id) return '';
  return '<span class="second-tap-tooltip">Tap again to load</span>';
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
