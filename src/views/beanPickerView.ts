import type { Bean, BeanBatch, BeanBatchStorageEvent } from '../api/types';
import {
  batchStorageState,
  beanLabel,
  computeBeanFreshness,
  formatGrams,
  latestBatch
} from '../domain/beanWorkflow';
import {
  dateInputValue,
  recentBatches,
  stockLocationLabel,
  stockOptionLabel,
  storageTimeline
} from '../domain/beanDisplay';
import { icon } from '../components/icons';
import { escapeAttr, escapeHtml } from '../components/html';

export interface BeanPickerViewModel {
  search: string;
  autofocusSearch: boolean;
  matches: Bean[];
  focusedBean: Bean | null;
  mode: 'inspect' | 'create';
  selectedBeanId: string | null;
  selectedBatchId: string | null;
  focusedBatchId?: string | null;
  freezeStepperBatchId?: string | null;
  batchesByBean: Record<string, BeanBatch[]>;
  prefillBeans: Bean[];
  draftBatchBeanId?: string | null;
  editingBeanDetailsId?: string | null;
  editingBatchId?: string | null;
  showAllBags?: boolean;
  formNumbers?: Record<string, string>;
  secondTapHint: { kind: 'shot' | 'bean'; id: string } | null;
}

export function renderBeanPickerModal(model: BeanPickerViewModel): string {
  const focusedId = model.focusedBean?.id ?? null;
  const autofocus = model.autofocusSearch ? ' autofocus' : '';
  const creating = model.mode === 'create';
  return `
    <div class="modal-backdrop bean-picker-backdrop" data-action="close-modal">
      <section class="modal panel bean-picker-modal ${creating ? 'create-mode' : ''}" role="dialog" aria-modal="true" aria-label="${creating ? 'Add coffee' : 'Choose coffee'}" data-action="noop">
        <div class="modal-head bean-picker-head">
          <div>
            <span class="eyebrow">Beans</span>
            <h2>${creating ? 'Add coffee' : 'Choose coffee'}</h2>
          </div>
          <div class="modal-head-actions">
            ${creating ? '' : `<button class="icon-button" data-action="open-add-bean" aria-label="Add coffee" title="Add coffee">${icon('plus')}</button>`}
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
  const armed = options.focused && !options.current;
  const hint = armed ? '' : renderSecondTapHint('bean', bean.id, options.secondTapHint);
  const status = options.current ? 'Current' : armed ? 'Tap again' : '';
  const origin = bean.country ? `<small>${escapeHtml(bean.country)}</small>` : '';
  return `
    <button class="bean-row ${options.focused ? 'active' : ''} ${armed || hint ? 'has-second-tap-hint' : ''}" data-action="inspect-bean" data-id="${escapeAttr(bean.id)}">
      <span>
        ${origin}
        <b>${escapeHtml(bean.roaster)}</b>
        <strong>${escapeHtml(bean.name)}</strong>
      </span>
      ${status ? `<em class="bean-row-action ${options.current ? 'current' : armed ? 'armed' : ''}">${escapeHtml(status)}</em>` : ''}
      ${hint}
    </button>
  `;
}

function renderBeanPickerInspector(model: BeanPickerViewModel): string {
  const bean = model.focusedBean;
  if (model.mode === 'create' || !bean) {
    return `
      <div class="bean-picker-inspector">
        ${renderBeanPickerBeanForm(null, model.prefillBeans, model.formNumbers ?? {})}
      </div>
    `;
  }

  const batches = model.batchesByBean[bean.id] ?? [];
  const openBatches = batches.filter((batch) => !isNearlyEmptyBatch(batch));
  const hiddenCount = batches.length - openBatches.length;
  const showingAll = model.showAllBags === true;
  const displayedBatches = showingAll ? batches : openBatches;
  const visibleBatches = recentBatches(displayedBatches, Math.max(1, displayedBatches.length));
  const focusedBatch = pickerFocusedBatch(model, bean, visibleBatches);
  const inUseBatchId = bean.id === model.selectedBeanId
    ? model.selectedBatchId ?? latestBatch(openBatches)?.id ?? null
    : null;
  const latest = latestBatch(batches);
  const editingDetails = model.editingBeanDetailsId === bean.id;
  const bagCountText = showingAll || hiddenCount === 0
    ? `${batches.length} ${batches.length === 1 ? 'bag' : 'bags'}`
    : `${openBatches.length} active ${openBatches.length === 1 ? 'bag' : 'bags'}`;
  return `
    <div class="bean-picker-inspector">
      <div class="bean-picker-decision">
        <div class="bean-picker-details ${editingDetails ? 'open' : ''}">
          <button type="button" class="bean-picker-bean-summary" data-action="toggle-bean-details" data-id="${escapeAttr(bean.id)}" aria-expanded="${editingDetails ? 'true' : 'false'}" title="Edit coffee">
            ${renderBeanPickerSummary(bean, latest)}
            <span class="icon-button bean-picker-edit-icon" aria-hidden="true">${icon('pencil')}</span>
          </button>
          ${editingDetails ? renderBeanPickerBeanForm(bean, model.prefillBeans, model.formNumbers ?? {}, { showHeader: false }) : ''}
        </div>
      </div>
      <div class="bean-picker-batches">
        <div class="bean-picker-section-head">
          <div>
            <span class="eyebrow">Bags on hand</span>
            <strong>${escapeHtml(batches.length === 0 ? 'No bags yet' : bagCountText)}</strong>
          </div>
          <div class="bean-picker-section-actions">
            ${hiddenCount > 0 ? `<button type="button" class="secondary-button compact" data-action="toggle-bean-picker-show-all">${escapeHtml(showingAll ? 'Hide finished' : 'Show all')}</button>` : ''}
            <button type="button" class="secondary-button compact" data-action="bean-picker-add-batch">${icon('plus')}<span>Bag</span></button>
          </div>
        </div>
        ${model.draftBatchBeanId === bean.id ? renderBeanPickerBatchDraft(bean, latest, model.formNumbers ?? {}) : ''}
        ${
          batches.length === 0
            ? '<p class="empty-history">No bags on hand.</p>'
            : visibleBatches.length === 0
              ? '<p class="empty-history">No active bags. Tap Show all to see finished bags.</p>'
              : renderStockColumns(bean, visibleBatches, {
                  focusedBatchId: focusedBatch?.id ?? null,
                  inUseBatchId,
                  freezeStepperBatchId: model.freezeStepperBatchId ?? null,
                  editingBatchId: model.editingBatchId ?? null,
                  formNumbers: model.formNumbers ?? {}
                })
        }
      </div>
    </div>
  `;
}

function pickerFocusedBatch(
  model: BeanPickerViewModel,
  bean: Bean,
  visibleBatches: BeanBatch[]
): BeanBatch | null {
  const explicit = model.focusedBatchId
    ? visibleBatches.find((batch) => batch.id === model.focusedBatchId)
    : null;
  if (explicit) return explicit;
  if (bean.id === model.selectedBeanId && model.selectedBatchId) {
    const selected = visibleBatches.find((batch) => batch.id === model.selectedBatchId);
    if (selected) return selected;
  }
  // Default to the newest bag so the action bar (Brew / Freeze / edit) is always
  // visible for whatever bean you land on. visibleBatches is sorted newest-first,
  // so the freshest active bag is the sensible target until you tap another.
  return visibleBatches[0] ?? null;
}

interface StockRowContext {
  focusedBatchId: string | null;
  inUseBatchId: string | null;
  freezeStepperBatchId: string | null;
  editingBatchId: string | null;
  formNumbers: Record<string, string>;
}

function renderStockColumns(
  bean: Bean,
  visibleBatches: BeanBatch[],
  ctx: StockRowContext
): string {
  const shelf = visibleBatches.filter((batch) => batchStorageState(batch) !== 'frozen');
  const freezer = visibleBatches.filter((batch) => batchStorageState(batch) === 'frozen');
  const single = shelf.length === 0 || freezer.length === 0;
  const column = (title: string, iconName: string, hint: string, rows: BeanBatch[]) => `
    <div class="stock-column">
      <div class="stock-column-head">
        ${icon(iconName)}
        <span>${escapeHtml(title)} · ${rows.length}</span>
        ${hint ? `<em>${escapeHtml(hint)}</em>` : ''}
      </div>
      ${rows.map((batch) => renderStockRow(bean, batch, ctx)).join('')}
    </div>
  `;
  return `
    <div class="stock-columns ${single ? 'single' : ''}">
      ${shelf.length > 0 ? column('On shelf', 'archive', '', shelf) : ''}
      ${freezer.length > 0 ? column('In freezer', 'snowflake', 'aging paused', freezer) : ''}
    </div>
  `;
}

function renderStockRow(bean: Bean, batch: BeanBatch, ctx: StockRowContext): string {
  const focused = batch.id === ctx.focusedBatchId;
  const finished = isNearlyEmptyBatch(batch);
  const frozen = batchStorageState(batch) === 'frozen';
  const freshness = computeBeanFreshness(batch);
  const meta = [
    formatGrams(batch.weightRemaining),
    freshness ? `${freshness.activeAgeDays}d` : null,
    batch.roastLevel ?? null,
    batch.id === ctx.inUseBatchId ? 'in use' : null,
    finished ? 'finished' : null
  ].filter(Boolean).join(' · ');
  const stepper = focused && ctx.freezeStepperBatchId === batch.id && !frozen
    ? renderFreezeStepper(bean, batch, ctx.formNumbers)
    : '';
  const editPanel = focused && ctx.editingBatchId === batch.id
    ? renderStockEditPanel(bean, batch)
    : '';
  return `
    <div class="stock-row-group">
      <div
        class="stock-row ${focused ? 'focused' : ''} ${finished ? 'finished' : ''}"
        role="button"
        tabindex="0"
        data-action="focus-batch"
        data-id="${escapeAttr(batch.id)}"
        data-bean-id="${escapeAttr(bean.id)}"
        aria-pressed="${focused ? 'true' : 'false'}"
        title="${finished ? 'Finished bag' : 'Select this bag'}"
      >
        <strong>${escapeHtml(stockRowDate(batch))}</strong>
        <small>${escapeHtml(meta || 'Bag')}</small>
        ${focused ? renderStockRowActions(bean, batch, { finished, frozen }) : ''}
      </div>
      ${stepper}
      ${editPanel}
    </div>
  `;
}

function renderStockRowActions(
  bean: Bean,
  batch: BeanBatch,
  options: { finished: boolean; frozen: boolean }
): string {
  const moveButton = options.frozen
    ? `<button type="button" class="secondary-button compact" data-action="batch-storage-event" data-type="thawed" data-id="${escapeAttr(batch.id)}" data-bean-id="${escapeAttr(bean.id)}" title="Move to shelf">${icon('sun')}<span>Thaw</span></button>`
    : `<button type="button" class="secondary-button compact" data-action="toggle-freeze-stepper" data-id="${escapeAttr(batch.id)}" title="Freeze this bag">${icon('snowflake')}<span>Freeze</span></button>`;
  return `
    <div class="stock-row-actions">
      ${options.finished ? '' : `<button type="button" class="primary-button compact stock-brew-button" data-action="select-batch" data-id="${escapeAttr(batch.id)}" data-bean-id="${escapeAttr(bean.id)}">${icon('coffee')}<span>Brew this</span></button>`}
      ${options.finished ? '' : moveButton}
      <button type="button" class="icon-button" data-action="toggle-batch-details" data-id="${escapeAttr(batch.id)}" aria-label="Edit bag" title="Edit bag">${icon('pencil')}</button>
      ${options.finished ? '' : `<button type="button" class="icon-button" data-action="finish-batch" data-id="${escapeAttr(batch.id)}" data-bean-id="${escapeAttr(bean.id)}" aria-label="Mark bag finished" title="Mark finished">${icon('circle-check')}</button>`}
    </div>
  `;
}

function stockRowDate(batch: BeanBatch): string {
  const roast = batch.roastDate ? new Date(batch.roastDate) : null;
  return roast && !Number.isNaN(roast.valueOf())
    ? roast.toLocaleDateString([], { month: 'short', day: 'numeric' })
    : 'Undated';
}

function renderFreezeStepper(bean: Bean, batch: BeanBatch, formNumbers: Record<string, string>): string {
  const remaining = typeof batch.weightRemaining === 'number' && Number.isFinite(batch.weightRemaining) && batch.weightRemaining > 0
    ? batch.weightRemaining
    : null;
  const confirmButton = (label: string, disabled: boolean) => `
    <button type="button" class="primary-button compact" data-action="confirm-freeze-stock" data-id="${escapeAttr(batch.id)}" data-bean-id="${escapeAttr(bean.id)}"${disabled ? ' disabled' : ''}>${icon('snowflake')}<span>${escapeHtml(label)}</span></button>
  `;
  const cancelButton = `
    <button type="button" class="icon-button" data-action="toggle-freeze-stepper" data-id="${escapeAttr(batch.id)}" aria-label="Cancel freeze" title="Cancel">${icon('x')}</button>
  `;
  if (remaining == null) {
    return `
      <div class="freeze-stepper">
        ${icon('snowflake')}
        <span>The whole bag moves to the freezer.</span>
        ${confirmButton('Freeze bag', false)}
        ${cancelButton}
      </div>
    `;
  }
  const keepKey = freezeKeepFormKey(batch.id);
  const keepRaw = Number.parseFloat(formNumbers[keepKey] ?? '0');
  const keep = Number.isFinite(keepRaw) ? Math.min(Math.max(keepRaw, 0), remaining) : 0;
  const freezeAmount = Math.max(0, round(remaining - keep, 1));
  return `
    <div class="freeze-stepper">
      ${icon('snowflake')}
      <span>Keep</span>
      <button
        type="button"
        class="number-edit-button freeze-keep-number"
        data-action="open-number-edit"
        data-target="form-field"
        data-form-key="${escapeAttr(keepKey)}"
        data-title="Keep on shelf"
        data-value="${escapeAttr(inputValue(keep))}"
        data-min="0"
        data-max="${escapeAttr(inputValue(remaining))}"
        data-step="0.1"
        data-unit="g"
        data-return-modal="bean-picker"
      >${escapeHtml(inputValue(keep))}<em>g</em></button>
      <span>on shelf · freeze <b>${escapeHtml(inputValue(freezeAmount))}g</b></span>
      ${confirmButton(`Freeze ${inputValue(freezeAmount)}g`, freezeAmount <= 0)}
      ${cancelButton}
    </div>
  `;
}

function renderStockEditPanel(bean: Bean, batch: BeanBatch): string {
  return `
    <form
      class="stock-edit-panel"
      data-form="bean-picker-batch"
      data-bean-id="${escapeAttr(bean.id)}"
      data-batch-id="${escapeAttr(batch.id)}"
    >
      <div class="bean-picker-batch-fields">
        <label>Roast date<input data-action="bean-picker-batch-field" type="date" name="roastDate" value="${escapeAttr(dateInputValue(batch.roastDate))}" /></label>
        <label>Roast<input data-action="bean-picker-batch-field" name="roastLevel" autocomplete="off" value="${escapeAttr(inputValue(batch.roastLevel))}" /></label>
        ${batchNumberField(bean, batch, 'weight', 'Bag', batch.weight)}
        ${batchNumberField(bean, batch, 'weightRemaining', 'Left', batch.weightRemaining)}
      </div>
      <button type="button" class="secondary-button compact stock-history-button" data-action="open-batch-storage" data-id="${escapeAttr(batch.id)}" data-bean-id="${escapeAttr(bean.id)}">${icon('history')}<span>Dates and history</span></button>
    </form>
  `;
}

function batchNumberField(
  bean: Bean,
  batch: BeanBatch,
  name: 'weight' | 'weightRemaining',
  label: string,
  value: number | null | undefined
): string {
  return `
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
}

function renderBeanPickerSummary(bean: Bean, latest: BeanBatch | null): string {
  const origin = [bean.country, bean.region].filter(Boolean).join(' · ');
  const meta = [origin || null, bean.processing ?? null, latest ? stockOptionLabel(latest) : null].filter(Boolean).join(' · ');
  return `
    <div>
      <span class="eyebrow">Selected coffee</span>
      <strong>${escapeHtml(beanLabel(bean))}</strong>
      ${meta ? `<small>${escapeHtml(meta)}</small>` : ''}
    </div>
  `;
}

function renderBeanPickerBeanForm(
  bean: Bean | null,
  prefillBeans: Bean[],
  formNumbers: Record<string, string>,
  options: { showHeader?: boolean } = {}
): string {
  const editing = bean != null;
  const dataId = editing ? ` data-id="${escapeAttr(bean.id)}"` : '';
  const showHeader = options.showHeader ?? true;
  return `
    <form class="bean-picker-bean-form" data-form="bean-picker-bean"${dataId}>
      ${
        showHeader
          ? `<div class="bean-picker-section-head">
              <div>
                <span class="eyebrow">${editing ? 'Coffee' : 'New coffee'}</span>
                <strong>${escapeHtml(editing ? beanLabel(bean) : 'Add coffee')}</strong>
              </div>
              <div class="bean-picker-actions">
                ${
                  editing
                    ? `<button type="button" class="icon-button subtle-danger bean-delete-button" data-action="archive-bean" data-id="${escapeAttr(bean.id)}" aria-label="Delete coffee" title="Delete coffee">${icon('trash-2')}</button>`
                    : `<button type="button" class="secondary-button compact" data-action="close-modal"><span>Cancel</span></button>`
                }
              </div>
            </div>`
          : ''
      }
      ${editing ? '' : `<input type="hidden" name="prefillBeanId" value="" />${beanPrefillSelect(prefillBeans)}`}
      <div class="bean-picker-fields">
        <label>Roaster<input data-action="bean-picker-bean-field" name="roaster" required autocomplete="off" value="${escapeAttr(editing ? bean.roaster : '')}" /></label>
        <label>Coffee<input data-action="bean-picker-bean-field" name="name" required autocomplete="off" value="${escapeAttr(editing ? bean.name : '')}" /></label>
        <label>Country<input data-action="bean-picker-bean-field" name="country" autocomplete="off" value="${escapeAttr(inputValue(editing ? bean.country : ''))}" /></label>
        <label>Region<input data-action="bean-picker-bean-field" name="region" autocomplete="off" value="${escapeAttr(inputValue(editing ? bean.region : ''))}" /></label>
        <label>Process<input data-action="bean-picker-bean-field" name="processing" autocomplete="off" value="${escapeAttr(inputValue(editing ? bean.processing : ''))}" /></label>
        <label class="bean-picker-notes">Notes<textarea data-action="bean-picker-bean-field" name="notes" rows="4" autocomplete="off">${escapeHtml(inputValue(editing ? bean.notes : ''))}</textarea></label>
      </div>
      ${editing ? '' : renderBeanPickerFirstStock(formNumbers)}
    </form>
  `;
}

function renderBeanPickerFirstStock(formNumbers: Record<string, string>): string {
  const weightKey = createStockFormKey('weight');
  const remainingKey = createStockFormKey('weightRemaining');
  const weightValue = formNumbers[weightKey] ?? '250';
  const remainingValue = formNumbers[remainingKey] ?? weightValue;
  return `
    <div class="bean-picker-first-stock">
      <div class="bean-picker-section-head">
        <div>
          <span class="eyebrow">Bag</span>
          <strong>On hand</strong>
        </div>
      </div>
      <div class="bean-picker-first-stock-fields">
        <label>Roast date<input type="date" name="roastDate" value="${escapeAttr(todayDateInputValue())}" /></label>
        <label>Roast<input name="roastLevel" autocomplete="off" /></label>
        ${draftNumber(weightKey, 'weight', 'Bag', weightValue)}
        ${draftNumber(remainingKey, 'weightRemaining', 'Left', remainingValue)}
      </div>
    </div>
  `;
}

function isNearlyEmptyBatch(batch: BeanBatch): boolean {
  return typeof batch.weightRemaining === 'number' && Number.isFinite(batch.weightRemaining) && batch.weightRemaining < 5;
}

function renderBeanPickerBatchDraft(
  bean: Bean,
  latest: BeanBatch | null,
  formNumbers: Record<string, string>
): string {
  const weightKey = newStockFormKey(bean.id, 'weight');
  const remainingKey = newStockFormKey(bean.id, 'weightRemaining');
  const weightValue = formNumbers[weightKey] ?? inputValue(latest?.weight ?? 250);
  const remainingValue = formNumbers[remainingKey] ?? weightValue;
  return `
    <form class="bean-picker-batch stock-card stock-card-draft" data-form="bean-picker-batch" data-bean-id="${escapeAttr(bean.id)}">
      <div class="bean-picker-batch-title">
        <strong>Add bag</strong>
        <small>${escapeHtml(beanLabel(bean))}</small>
      </div>
      <div class="bean-picker-batch-fields">
        <label>Roast date<input data-action="bean-picker-batch-field-draft" type="date" name="roastDate" value="${escapeAttr(todayDateInputValue())}" /></label>
        <label>Roast<input data-action="bean-picker-batch-field-draft" name="roastLevel" autocomplete="off" value="${escapeAttr(inputValue(latest?.roastLevel))}" /></label>
        ${draftNumber(weightKey, 'weight', 'Bag', weightValue)}
        ${draftNumber(remainingKey, 'weightRemaining', 'Left', remainingValue)}
      </div>
      <div class="stock-draft-actions">
        <button type="button" class="secondary-button compact" data-action="cancel-batch-draft"><span>Cancel</span></button>
        <button type="submit" class="primary-button compact">${icon('check')}<span>Add bag</span></button>
      </div>
    </form>
  `;
}

function draftNumber(formKey: string, name: 'weight' | 'weightRemaining', label: string, value: string): string {
  return `
    <label>${escapeHtml(label)}
      <input type="hidden" name="${name}" value="${escapeAttr(value)}" />
      <button
        type="button"
        class="number-edit-button bean-picker-number"
        data-action="open-number-edit"
        data-target="form-field"
        data-form-key="${escapeAttr(formKey)}"
        data-title="${escapeAttr(label)}"
        data-value="${escapeAttr(value)}"
        data-min="0"
        data-max="5000"
        data-step="0.1"
        data-unit="g"
        data-return-modal="bean-picker"
      >${escapeHtml(value || '--')}<em>g</em></button>
    </label>
  `;
}

export function renderBatchStorageModal(bean: Bean, batch: BeanBatch): string {
  const state = batchStorageState(batch);
  const location = stockLocationLabel(batch);
  const freshnessDetail = computeBeanFreshness(batch);
  const latest = [...(batch.storageEvents ?? [])].reverse().find((event) => event?.at);
  const freshnessChips = renderBatchFreshnessChips(freshnessDetail);
  const move = state === 'frozen'
    ? { type: 'thawed' as const, label: 'Move to shelf', detail: 'Active age resumes from today.', icon: 'sun' }
    : { type: 'frozen' as const, label: 'Move to freezer', detail: 'Active age pauses from today.', icon: 'snowflake' };
  return `
    <div class="modal-backdrop bean-picker-backdrop" data-action="close-modal">
      <section class="modal panel batch-storage-modal" role="dialog" aria-modal="true" aria-label="Bag details" data-action="noop">
        <div class="modal-head bean-picker-head">
          <div>
            <span class="eyebrow">Bag details</span>
            <h2>${escapeHtml(stockOptionLabel(batch))}</h2>
          </div>
          <button class="icon-button" data-action="close-modal" aria-label="Close" title="Close">${icon('x')}</button>
        </div>
        <div class="batch-storage-body">
          <div class="batch-storage-summary">
            <div>
              <span class="batch-storage-label">Current stock</span>
              <strong>${escapeHtml(beanLabel(bean))}</strong>
              <span>${escapeHtml([stockOptionLabel(batch), location].filter(Boolean).join(' · '))}</span>
            </div>
            ${freshnessChips}
          </div>
          <div class="batch-storage-card batch-storage-move">
            <div>
              <span class="batch-storage-label">Move stock</span>
              <p>${escapeHtml(move.detail)}</p>
            </div>
            <button type="button" class="secondary-button" data-action="batch-storage-event" data-type="${move.type}">${icon(move.icon)}<span>${escapeHtml(move.label)}</span></button>
          </div>
          ${renderStorageTimeline(batch)}
          ${renderBatchStorageDateControl(latest, state)}
        </div>
      </section>
    </div>
  `;
}

export function newStockFormKey(beanId: string, name: 'weight' | 'weightRemaining'): string {
  return `bean-picker-new:${beanId}:${name}`;
}

export function createStockFormKey(name: 'weight' | 'weightRemaining'): string {
  return `bean-picker-create:${name}`;
}

export function freezeKeepFormKey(batchId: string): string {
  return `freeze-keep:${batchId}`;
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
          <span class="batch-storage-label">Correct dates</span>
          <strong>No freeze dates yet</strong>
          <p>Use a location action first, or add the first freezer date here.</p>
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
        <span class="batch-storage-label">Correct dates</span>
        <strong>${escapeHtml(title)}</strong>
        <p>${escapeHtml(detail)}</p>
      </div>
      <input type="hidden" name="type" value="${escapeAttr(type)}" />
      <label>${escapeHtml(label)}<input type="date" name="at" value="${escapeAttr(dateValue)}" /></label>
      <button type="submit" class="secondary-button compact">${icon('check')}<span>Save date</span></button>
    </form>
  `;
}

function renderStorageTimeline(batch: BeanBatch): string {
  const entries = storageTimeline(batch);
  if (entries.length === 0) return '';
  return `
    <div class="batch-storage-card storage-timeline-card">
      <div>
        <span class="batch-storage-label">History</span>
        <strong>Storage timeline</strong>
      </div>
      <ol class="storage-timeline">
        ${entries.map((entry) => `<li><span>${escapeHtml(entry.label)}</span><strong>${escapeHtml(shortDate(entry.at))}</strong></li>`).join('')}
      </ol>
    </div>
  `;
}

function renderBatchFreshnessChips(freshness: ReturnType<typeof computeBeanFreshness>): string {
  if (!freshness) {
    return '<div class="batch-freshness-panel muted"><span>Add roast date for freshness</span></div>';
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
      <span>Continue from</span>
      <select data-action="bean-prefill" aria-label="Copy details from an existing bean">
        <option value="">New coffee</option>
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
  return '<span class="second-tap-tooltip">Tap again to brew</span>';
}

function inputValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(round(value, 3));
  return String(value);
}

function todayDateInputValue(): string {
  return new Date().toISOString().slice(0, 10);
}

function shortDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
