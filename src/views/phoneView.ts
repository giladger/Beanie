import type { Bean, BeanBatch, RecipeDraft, ShotRecord } from '../api/types';
import type { ShotEditDraft, ShotEditField } from '../domain/shotEditModel';
import { shotNumberFieldStep } from '../domain/shotEditModel';
import {
  beanLabel,
  batchForShotFreshness,
  formatGrams,
  formatRatio,
  ratioFor,
  recipeFromShot,
  roastFreshnessLabel,
  shotFreshnessBadgeForShot
} from '../domain/beanWorkflow';
import { beanStockSummary } from '../domain/beanDisplay';
import { isServiceShot } from '../domain/shotRecord';
import { escapeAttr, escapeHtml } from '../components/html';
import { icon } from '../components/icons';
import { enjoymentBadge, shotScoreControl } from '../components/shotScore';

export type PhoneTab = 'home' | 'scan' | 'beans' | 'shots' | 'settings';

export interface PhoneShellModel {
  activeTab: PhoneTab;
  status: string;
  machineStatus: string;
  asleep: boolean;
  selectedBean: Bean | null;
  selectedBatch: BeanBatch | null;
  batchesByBean: Record<string, BeanBatch[]>;
  beans: Bean[];
  beanSearch: string;
  shotSearch: string;
  favoriteBeanIds: readonly string[];
  averageDoseIn: number | null;
  applyState: 'idle' | 'pending' | 'applied' | 'failed' | 'stale';
  shots: ShotRecord[];
  selectedShot: ShotRecord | null;
  selectedShotDraft: ShotEditDraft | null;
  selectedShotDirty: boolean;
  shotsTotal: number;
  shotsLoadingMore: boolean;
  demo: boolean;
  draft: RecipeDraft;
  ratioLabel: string;
  brewTempLabel: string;
  settingsHtml: string;
}

const TABS: Array<{ id: PhoneTab; label: string; icon: string }> = [
  { id: 'home', label: 'Home', icon: 'coffee' },
  { id: 'scan', label: 'Scan', icon: 'camera' },
  { id: 'beans', label: 'Beans', icon: 'bean' },
  { id: 'shots', label: 'Shots', icon: 'history' },
  { id: 'settings', label: 'Settings', icon: 'settings' }
];

export function renderPhoneShell(model: PhoneShellModel): string {
  return `
    <div class="phone-shell">
      <main class="phone-main">
        ${renderPhoneTab(model)}
      </main>
      <nav class="phone-tabs" aria-label="Phone helper sections">
        ${TABS.map((tab) => renderPhoneTabButton(tab, model.activeTab)).join('')}
      </nav>
    </div>
  `;
}

function renderPhoneTab(model: PhoneShellModel): string {
  switch (model.activeTab) {
    case 'scan':
      return renderScanTab();
    case 'beans':
      return renderBeansTab(model);
    case 'shots':
      return renderShotsTab(model);
    case 'settings':
      return renderSettingsTab(model);
    case 'home':
    default:
      return renderHomeTab(model);
  }
}

function renderPhoneTabButton(
  tab: { id: PhoneTab; label: string; icon: string },
  activeTab: PhoneTab
): string {
  const active = tab.id === activeTab;
  return `
    <button type="button" class="phone-tab ${active ? 'active' : ''}" data-action="phone-tab" data-value="${tab.id}" aria-pressed="${active}">
      ${icon(tab.icon)}
      <span>${escapeHtml(tab.label)}</span>
    </button>
  `;
}

function renderHomeTab(model: PhoneShellModel): string {
  const bean = model.selectedBean;
  const batch = bean ? model.selectedBatch : null;
  const freshness = bean ? roastFreshnessLabel(batch) : null;
  const remaining = batch && typeof batch.weightRemaining === 'number' && batch.weightRemaining > 0
    ? batch.weightRemaining
    : null;
  const shotsLeft = remaining != null && model.averageDoseIn && model.averageDoseIn > 0
    ? Math.floor(remaining / model.averageDoseIn)
    : null;
  const facts = [
    remaining != null ? `${formatGrams(remaining)} left` : null,
    shotsLeft != null ? `~${shotsLeft} shot${shotsLeft === 1 ? '' : 's'}` : null
  ].filter((item): item is string => item != null);
  return `
    <section class="phone-stack phone-home">
      <button type="button" class="phone-wake ${model.asleep ? 'sleeping' : ''}" data-action="${model.asleep ? 'wake' : 'sleep'}" aria-label="${model.asleep ? 'Wake machine' : 'Sleep machine'}">
        ${icon('power')}<span>${model.asleep ? 'Wake machine' : 'Sleep machine'}</span>
      </button>
      <button type="button" class="phone-card phone-home-hero" data-action="open-bean-picker" aria-label="Choose coffee">
        <span class="phone-card-head">
          <span class="phone-card-label">Current bag</span>
          ${icon('chevron-down')}
        </span>
        <strong class="phone-hero-title">${escapeHtml(bean ? beanLabel(bean) : 'No bean selected')}</strong>
        <span class="phone-hero-sub">${escapeHtml(freshness ?? beanMeta(bean) ?? 'Scan or pick a bean to update coffee metadata.')}</span>
        ${facts.length ? `<span class="phone-home-stats">${facts.map((fact) => `<span>${escapeHtml(fact)}</span>`).join('')}</span>` : ''}
      </button>
      ${renderPhoneRecipe(model)}
      ${renderRecentShots(model)}
    </section>
  `;
}

const APPLY_CHIP: Record<string, { cls: string; text: string }> = {
  pending: { cls: 'pending', text: 'Applying…' },
  applied: { cls: 'ok', text: 'Applied' },
  failed: { cls: 'alert', text: 'Apply failed' },
  stale: { cls: 'stale', text: 'Not applied' }
};

function applyChip(state: PhoneShellModel['applyState']): string {
  const info = APPLY_CHIP[state];
  return info ? `<span class="phone-apply-chip ${info.cls}" role="status">${info.text}</span>` : '';
}

function renderPhoneRecipe(model: PhoneShellModel): string {
  const draft = model.draft;
  return `
    <div class="phone-card phone-recipe">
      <div class="phone-card-head">
        <span class="phone-recipe-head-left">
          <span class="phone-card-label">Edit recipe</span>
          ${applyChip(model.applyState)}
        </span>
        <button type="button" class="phone-icon-button" data-action="open-profile-picker" aria-label="Choose profile">${icon('sliders-horizontal')}</button>
      </div>
      <div class="phone-recipe-grid">
        ${recipeInput('Dose', numberInputValue(draft.dose), 'dose', 'g', 'number')}
        ${recipeInput('Yield', numberInputValue(draft.yield), 'yield', 'g', 'number')}
        ${recipeInput('Ratio', ratioInputValue(draft), 'ratio', '1:', 'number')}
        ${recipeInput('Grind', draft.grinderSetting || '', 'grinderSetting', '', 'text')}
        ${recipeInput('Temp', model.brewTempLabel === '--' ? '' : model.brewTempLabel, 'temperature', 'C', 'number')}
        <button type="button" class="phone-recipe-cell" data-action="open-profile-picker">
          <span>Profile</span><strong>${escapeHtml(draft.profileTitle ?? 'Choose')}</strong>
        </button>
      </div>
    </div>
  `;
}

function recipeInput(label: string, value: string, field: string, suffix: string, type: 'number' | 'text'): string {
  const attrs = type === 'number' ? 'type="number" inputmode="decimal" step="0.1"' : 'type="text" inputmode="decimal"';
  return `
    <label class="phone-recipe-cell phone-recipe-input">
      <span>${escapeHtml(label)}</span>
      <span class="phone-input-wrap">
        ${suffix === '1:' ? '<em>1:</em>' : ''}
        <input ${attrs} data-action="phone-recipe-field" data-field="${escapeAttr(field)}" value="${escapeAttr(value)}" aria-label="${escapeAttr(label)}" />
        ${suffix && suffix !== '1:' ? `<em>${escapeHtml(suffix)}</em>` : ''}
      </span>
    </label>
  `;
}

function renderRecentShots(model: PhoneShellModel): string {
  const shots = visibleShots(model.shots).slice(0, 3);
  return `
    <div class="phone-card phone-recent">
      <div class="phone-card-head">
        <span class="phone-card-label">Recent shots</span>
      </div>
      ${shots.length ? shots.map((shot) => renderShotRow(shot, shot.id === model.selectedShot?.id, model.batchesByBean)).join('') : '<p class="phone-empty">No espresso shots for this bean yet.</p>'}
    </div>
  `;
}

function renderScanTab(): string {
  return `
    <section class="phone-stack phone-scan-tab">
      <div class="phone-card phone-scan-card">
        <span class="phone-scan-icon" aria-hidden="true">${icon('camera')}</span>
        <h2>Scan a bag label</h2>
        <p>Snap the front — and the back if it shows the roast date or weight. Beanie reads the roaster, origin, process, and dates for you.</p>
        <button type="button" class="phone-scan-button" data-action="open-label-scanner">
          ${icon('camera')}<span>Scan bag label</span>
        </button>
        <ul class="phone-scan-tips">
          <li>Good light, fill the frame</li>
          <li>Add the back for the roast date</li>
          <li>Review the fields before saving</li>
        </ul>
      </div>
    </section>
  `;
}

function renderBeansTab(model: PhoneShellModel): string {
  const query = model.beanSearch.trim().toLowerCase();
  const beans = model.beans.filter((bean) => beanLabel(bean).toLowerCase().includes(query));
  return `
    <section class="phone-stack">
      <div class="phone-search-row">
        <input class="phone-search" type="search" data-action="search" placeholder="Search beans" value="${escapeAttr(model.beanSearch)}" />
        <button type="button" class="phone-icon-button strong" data-action="open-add-bean" aria-label="Add bean">${icon('plus')}</button>
      </div>
      <div class="phone-list">
        ${beans.length ? beans.map((bean) => renderBeanRow(bean, model)).join('') : '<p class="phone-empty">No beans match that search.</p>'}
      </div>
    </section>
  `;
}

function renderBeanRow(bean: Bean, model: PhoneShellModel): string {
  const selected = bean.id === model.selectedBean?.id;
  const favorite = model.favoriteBeanIds.includes(bean.id);
  const detail = beanRowDetail(bean, model, selected);
  return `
    <article class="phone-list-item ${selected ? 'active' : ''}">
      <button type="button" class="phone-list-main" data-action="phone-select-bean" data-id="${escapeAttr(bean.id)}">
        <strong>${favorite ? '<span class="phone-row-fav">★</span> ' : ''}${escapeHtml(beanLabel(bean))}</strong>
        <span>${escapeHtml(detail)}</span>
      </button>
      <span class="phone-row-actions">
        <button type="button" class="phone-icon-button phone-row-edit" data-action="open-edit-bean" data-id="${escapeAttr(bean.id)}" aria-label="Manage bags for ${escapeAttr(beanLabel(bean))}">${icon('chevron-right')}</button>
      </span>
    </article>
  `;
}

// Raw bag facts, matching the bean picker: roast date and active age of the
// freshest bag on hand, estimated shots left across all active bags (grams
// when no dose average exists yet), plus bag-count and frozen counts.
function beanRowDetail(bean: Bean, model: PhoneShellModel, selected: boolean): string {
  const summary = beanStockSummary(model.batchesByBean[bean.id] ?? [], model.averageDoseIn);
  if (summary) {
    const detail = [
      summary.roastDateText,
      summary.activeAgeDays != null ? `${summary.activeAgeDays}d active` : null,
      summary.shotsLeft != null
        ? `~${summary.shotsLeft} shot${summary.shotsLeft === 1 ? '' : 's'}`
        : summary.totalRemaining != null
          ? `${formatGrams(summary.totalRemaining)} left`
          : null,
      summary.bagCount > 1 ? `${summary.bagCount} bags` : null,
      summary.frozenCount > 0
        ? summary.frozenCount === summary.bagCount ? 'frozen' : `${summary.frozenCount} frozen`
        : null
    ].filter(Boolean).join(' · ');
    if (detail) return detail;
  }
  return beanMeta(bean) ?? (selected ? 'Current bean' : 'No bags on hand');
}

function renderShotsTab(model: PhoneShellModel): string {
  const all = visibleShots(model.shots);
  const query = model.shotSearch.trim().toLowerCase();
  const shots = query ? all.filter((shot) => shotMatchesQuery(shot, query)) : all;
  const selected = model.selectedShot;
  const draft = selected && model.selectedShotDraft?.shotId === selected.id ? model.selectedShotDraft : null;
  return `
    <section class="phone-shots-layout">
      <div class="phone-search-row">
        <input class="phone-search" type="search" data-action="shot-search" placeholder="Search shots" value="${escapeAttr(model.shotSearch)}" spellcheck="false" autocapitalize="none" autocorrect="off" />
      </div>
      <div class="phone-section-title">
        <span>History</span>
        <small>${shots.length} shown${query && all.length !== shots.length ? ` of ${all.length}` : ''}</small>
      </div>
      <div class="phone-list phone-shot-list">
        ${
          shots.length
            ? shots.map((shot) => {
                const active = shot.id === selected?.id;
                return `${renderShotRow(shot, active, model.batchesByBean)}${active ? renderShotDetail(shot, draft, model.selectedShotDirty, model.batchesByBean) : ''}`;
              }).join('')
            : `<p class="phone-empty">${query ? 'No shots match that search.' : 'No espresso shots found.'}</p>`
        }
        ${query ? '' : renderLoadMore(model, shots.length)}
      </div>
    </section>
  `;
}

// Match the visible row text plus the people/coffee context behind it, so a
// search finds shots by profile, drink, barista, drinker, bean, or grind.
function shotMatchesQuery(shot: ShotRecord, query: string): boolean {
  const recipe = recipeFromShot(shot);
  const ctx = shot.workflow?.context ?? {};
  const haystack = [
    recipe.profileTitle,
    ctx.finalBeverageType,
    ctx.baristaName,
    ctx.drinkerName,
    ctx.coffeeRoaster,
    ctx.coffeeName,
    ctx.grinderSetting,
    shotDate(shot.timestamp)
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(query);
}

function renderShotRow(shot: ShotRecord, active: boolean, batchesByBean: Record<string, BeanBatch[]>): string {
  const recipe = recipeFromShot(shot);
  const freshness = shotFreshnessBadgeForShot(shot, batchForShotFreshness(shot, batchesByBean));
  return `
    <button type="button" class="phone-list-item phone-shot-row ${active ? 'active' : ''}" data-action="phone-select-shot" data-id="${escapeAttr(shot.id)}">
      <span class="phone-list-main">
        <strong>${escapeHtml(`${formatGrams(recipe.dose)} -> ${formatGrams(recipe.yield)}`)}</strong>
        <span>${escapeHtml([freshness, recipe.profileTitle ?? 'No profile', shotDate(shot.timestamp)].filter(Boolean).join(' · '))}</span>
      </span>
      ${enjoymentBadge(shot)}
    </button>
  `;
}

function renderShotDetail(
  shot: ShotRecord,
  draft: ShotEditDraft | null,
  dirty: boolean,
  batchesByBean: Record<string, BeanBatch[]>
): string {
  const recipe = recipeFromShot(shot);
  const ratio = formatRatio(ratioFor(recipe.dose, recipe.yield));
  const edit = draft ?? shotDraftFallback(shot);
  const freshness = shotFreshnessBadgeForShot(shot, batchForShotFreshness(shot, batchesByBean));
  return `
    <article class="phone-card phone-shot-card">
      <div class="phone-card-head">
        <span class="phone-card-label">Selected shot</span>
        <button type="button" class="phone-shot-save" data-action="phone-save-shot" data-id="${escapeAttr(shot.id)}" ${dirty ? '' : 'disabled'}>
          ${icon('check')}<span>${dirty ? 'Save' : 'Saved'}</span>
        </button>
      </div>
      <h2>${escapeHtml(`${formatGrams(recipe.dose)} -> ${formatGrams(recipe.yield)}`)}</h2>
      <p>${escapeHtml([freshness, recipe.profileTitle, ratio, shotDate(shot.timestamp)].filter(Boolean).join(' · '))}</p>
      ${shotScoreControl(edit.enjoyment ?? null, {
        action: 'phone-shot-score',
        shotId: shot.id,
        variant: 'detail'
      })}
      <div class="phone-shot-fields">
        ${shotInput(shot.id, 'Drink', 'finalBeverageType', edit.finalBeverageType, 'text')}
        ${shotInput(shot.id, 'Barista', 'baristaName', edit.baristaName, 'text')}
        ${shotInput(shot.id, 'Drinker', 'drinkerName', edit.drinkerName, 'text')}
        ${shotInput(shot.id, 'Target in', 'targetDoseWeight', edit.targetDoseWeight, 'number', 'g')}
        ${shotInput(shot.id, 'Target out', 'targetYield', edit.targetYield, 'number', 'g')}
        ${shotInput(shot.id, 'Actual in', 'actualDoseWeight', edit.actualDoseWeight, 'number', 'g')}
        ${shotInput(shot.id, 'Actual out', 'actualYield', edit.actualYield, 'number', 'g')}
        ${shotInput(shot.id, 'Grind', 'grinderSetting', edit.grinderSetting, 'text')}
        ${shotInput(shot.id, 'TDS', 'drinkTds', edit.drinkTds, 'number', '%')}
        ${shotInput(shot.id, 'EY', 'drinkEy', edit.drinkEy, 'number', '%')}
        ${shotNotesInput(shot.id, edit.espressoNotes)}
      </div>
      <div class="phone-chart">
        <canvas id="detail-canvas" class="live-canvas detail-canvas"></canvas>
      </div>
    </article>
  `;
}

function shotInput(
  shotId: string,
  label: string,
  field: ShotEditField,
  value: unknown,
  type: 'number' | 'text',
  suffix = ''
): string {
  const attrs = type === 'number'
    ? `type="number" inputmode="decimal" step="${escapeAttr(shotNumberFieldStep(field))}"`
    : 'type="text"';
  return `
    <label class="phone-shot-input">
      <span>${escapeHtml(label)}</span>
      <span class="phone-input-wrap">
        <input ${attrs} data-action="phone-shot-field" data-id="${escapeAttr(shotId)}" data-field="${escapeAttr(field)}" value="${escapeAttr(inputValue(value))}" aria-label="${escapeAttr(label)}" />
        ${suffix ? `<em>${escapeHtml(suffix)}</em>` : ''}
      </span>
    </label>
  `;
}

function shotNotesInput(shotId: string, value: string | null): string {
  return `
    <label class="phone-shot-input phone-shot-notes">
      <span>Notes</span>
      <textarea data-action="phone-shot-field" data-id="${escapeAttr(shotId)}" data-field="espressoNotes" rows="3" aria-label="Notes">${escapeHtml(value ?? '')}</textarea>
    </label>
  `;
}

function renderLoadMore(model: PhoneShellModel, visibleCount: number): string {
  if (model.demo || model.shots.length >= model.shotsTotal) return '';
  const remaining = Math.max(0, model.shotsTotal - model.shots.length);
  return `
    <button type="button" class="phone-action phone-load-more" data-action="load-more-shots" ${model.shotsLoadingMore ? 'disabled' : ''}>
      ${model.shotsLoadingMore ? 'Loading...' : `Load ${remaining || visibleCount} more`}
    </button>
  `;
}

function renderSettingsTab(model: PhoneShellModel): string {
  return `<section class="phone-settings">${model.settingsHtml}</section>`;
}

function visibleShots(shots: ShotRecord[]): ShotRecord[] {
  return shots.filter((shot) => !isServiceShot(shot));
}

function beanMeta(bean: Bean | null): string | null {
  if (!bean) return null;
  const parts = [bean.country, bean.region, bean.processing].filter((item): item is string => Boolean(item));
  return parts.length ? parts.join(' · ') : null;
}

function numberInputValue(value: number | null | undefined): string {
  return value == null ? '' : String(value);
}

function ratioInputValue(draft: RecipeDraft): string {
  return ratioFor(draft.dose, draft.yield)?.toFixed(1) ?? '';
}

function shotDraftFallback(shot: ShotRecord): ShotEditDraft {
  const ctx = shot.workflow?.context ?? {};
  const ann = shot.annotations ?? {};
  return {
    shotId: shot.id,
    coffeeRoaster: ctx.coffeeRoaster ?? null,
    coffeeName: ctx.coffeeName ?? null,
    beanBatchId: ctx.beanBatchId ?? null,
    finalBeverageType: ctx.finalBeverageType ?? null,
    baristaName: ctx.baristaName ?? null,
    drinkerName: ctx.drinkerName ?? null,
    targetDoseWeight: ctx.targetDoseWeight ?? null,
    targetYield: ctx.targetYield ?? null,
    actualDoseWeight: ann.actualDoseWeight ?? null,
    actualYield: ann.actualYield ?? null,
    grinderId: ctx.grinderId ?? null,
    grinderModel: ctx.grinderModel ?? null,
    grinderSetting: inputValue(ctx.grinderSetting) || null,
    drinkTds: ann.drinkTds ?? null,
    drinkEy: ann.drinkEy ?? null,
    enjoyment: ann.enjoyment ?? null,
    espressoNotes: ann.espressoNotes ?? shot.shotNotes ?? null,
    contextExtras: ctx.extras ?? null,
    annotationExtras: ann.extras ?? shot.metadata ?? null
  };
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

function shotDate(timestamp: string): string | null {
  const date = new Date(timestamp);
  if (Number.isNaN(date.valueOf())) return null;
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
