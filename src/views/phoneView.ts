import type { Bean, BeanBatch, RecipeDraft, ShotRecord } from '../api/types';
import type { ShotEditDraft, ShotEditField } from '../domain/shotEditModel';
import { shotNumberFieldStep } from '../domain/shotEditModel';
import {
  beanLabel,
  formatGrams,
  formatRatio,
  latestBatch,
  ratioFor,
  recipeFromShot,
  roastFreshnessLabel
} from '../domain/beanWorkflow';
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
  batchesByBean: Record<string, BeanBatch[]>;
  beans: Bean[];
  beanSearch: string;
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
  { id: 'beans', label: 'Beans', icon: 'coffee' },
  { id: 'shots', label: 'Shots', icon: 'history' },
  { id: 'settings', label: 'Settings', icon: 'settings' }
];

export function renderPhoneShell(model: PhoneShellModel): string {
  return `
    <div class="phone-shell">
      <header class="phone-head">
        <h1>${escapeHtml(phoneTitle(model))}</h1>
        <button type="button" class="phone-wake ${model.asleep ? 'sleeping' : ''}" data-action="${model.asleep ? 'wake' : 'sleep'}" aria-label="${model.asleep ? 'Wake machine' : 'Sleep machine'}" title="${model.asleep ? 'Wake machine' : 'Sleep machine'}">
          ${icon('power')}<span>${model.asleep ? 'Wake' : 'Sleep'}</span>
        </button>
      </header>
      <main class="phone-main">
        ${renderPhoneTab(model)}
      </main>
      <nav class="phone-tabs" aria-label="Phone helper sections">
        ${TABS.map((tab) => renderPhoneTabButton(tab, model.activeTab)).join('')}
      </nav>
    </div>
  `;
}

function phoneTitle(model: PhoneShellModel): string {
  if (model.activeTab === 'scan') return 'Scan a bag';
  if (model.activeTab === 'beans') return 'Beans';
  if (model.activeTab === 'shots') return 'Shot notes';
  if (model.activeTab === 'settings') return 'Settings';
  return 'Home';
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
  const batch = bean ? latestBatch(model.batchesByBean[bean.id] ?? []) : null;
  const freshness = bean ? roastFreshnessLabel(batch) : null;
  return `
    <section class="phone-stack phone-home">
      <div class="phone-card phone-home-hero">
        <span class="phone-card-label">Current bag</span>
        <h2>${escapeHtml(bean ? beanLabel(bean) : 'No bean selected')}</h2>
        <p>${escapeHtml(freshness ?? beanMeta(bean) ?? 'Scan or pick a bean to update coffee metadata.')}</p>
        <div class="phone-home-stats">
          <span>${escapeHtml(model.draft.profileTitle ?? 'No profile')}</span>
          <span>${escapeHtml(`${formatGrams(model.draft.dose)} -> ${formatGrams(model.draft.yield)}`)}</span>
        </div>
      </div>
      ${renderPhoneRecipe(model)}
      ${renderRecentShots(model)}
    </section>
  `;
}

function renderPhoneRecipe(model: PhoneShellModel): string {
  const draft = model.draft;
  return `
    <div class="phone-card phone-recipe">
      <div class="phone-card-head">
        <span class="phone-card-label">Edit recipe</span>
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
      ${shots.length ? shots.map((shot) => renderShotRow(shot, shot.id === model.selectedShot?.id)).join('') : '<p class="phone-empty">No espresso shots for this bean yet.</p>'}
    </div>
  `;
}

function renderScanTab(): string {
  return `
    <section class="phone-stack">
      <div class="phone-card phone-scan-card">
        <span class="phone-card-label">Bag capture</span>
        <h2>Scan label details</h2>
        <p>Photograph the bag, review the extracted bean and roast fields, then save.</p>
        <button type="button" class="phone-scan-button" data-action="open-label-scanner">
          ${icon('camera')}<span>Scan bag label</span>
        </button>
      </div>
      <div class="phone-card">
        <span class="phone-card-label">Manual fallback</span>
        <div class="phone-actions">
          <button type="button" class="phone-action" data-action="open-add-bean">${icon('plus')}<span>New bean</span></button>
          <button type="button" class="phone-action" data-action="open-bean-picker">${icon('search')}<span>Edit beans</span></button>
        </div>
      </div>
    </section>
  `;
}

function renderBeansTab(model: PhoneShellModel): string {
  const query = model.beanSearch.trim().toLowerCase();
  const beans = [...model.beans]
    .filter((bean) => beanLabel(bean).toLowerCase().includes(query))
    .sort((a, b) => beanLabel(a).localeCompare(beanLabel(b), undefined, { sensitivity: 'base' }));
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
  const batch = latestBatch(model.batchesByBean[bean.id] ?? []);
  const freshness = roastFreshnessLabel(batch);
  const selected = bean.id === model.selectedBean?.id;
  const detail = freshness ?? batchWeight(batch) ?? beanMeta(bean) ?? (selected ? 'Current bean' : 'Tap to select');
  return `
    <article class="phone-list-item ${selected ? 'active' : ''}">
      <button type="button" class="phone-list-main" data-action="phone-select-bean" data-id="${escapeAttr(bean.id)}">
        <strong>${escapeHtml(beanLabel(bean))}</strong>
        <span>${escapeHtml(detail)}</span>
      </button>
      <button type="button" class="phone-icon-button phone-row-edit" data-action="open-edit-bean" data-id="${escapeAttr(bean.id)}" aria-label="Edit bean">${icon('pencil')}</button>
    </article>
  `;
}

function renderShotsTab(model: PhoneShellModel): string {
  const shots = visibleShots(model.shots);
  const selected = model.selectedShot ?? shots[0] ?? null;
  const draft = selected && model.selectedShotDraft?.shotId === selected.id ? model.selectedShotDraft : null;
  return `
    <section class="phone-shots-layout">
      <div class="phone-shot-detail">
        ${selected ? renderShotDetail(selected, draft, model.selectedShotDirty) : ''}
      </div>
      <div class="phone-section-title">
        <span>History</span>
        <small>${shots.length} shown</small>
      </div>
      <div class="phone-list phone-shot-list">
        ${shots.length ? shots.map((shot) => renderShotRow(shot, shot.id === selected?.id)).join('') : '<p class="phone-empty">No espresso shots found.</p>'}
        ${renderLoadMore(model, shots.length)}
      </div>
    </section>
  `;
}

function renderShotRow(shot: ShotRecord, active: boolean): string {
  const recipe = recipeFromShot(shot);
  return `
    <button type="button" class="phone-list-item phone-shot-row ${active ? 'active' : ''}" data-action="phone-select-shot" data-id="${escapeAttr(shot.id)}">
      <span class="phone-list-main">
        <strong>${escapeHtml(`${formatGrams(recipe.dose)} -> ${formatGrams(recipe.yield)}`)}</strong>
        <span>${escapeHtml([recipe.profileTitle ?? 'No profile', shotDate(shot.timestamp)].filter(Boolean).join(' · '))}</span>
      </span>
      ${enjoymentBadge(shot)}
    </button>
  `;
}

function renderShotDetail(shot: ShotRecord, draft: ShotEditDraft | null, dirty: boolean): string {
  const recipe = recipeFromShot(shot);
  const ratio = formatRatio(ratioFor(recipe.dose, recipe.yield));
  const edit = draft ?? shotDraftFallback(shot);
  return `
    <article class="phone-card phone-shot-card">
      <div class="phone-card-head">
        <span class="phone-card-label">Selected shot</span>
        <button type="button" class="phone-shot-save" data-action="phone-save-shot" data-id="${escapeAttr(shot.id)}" ${dirty ? '' : 'disabled'}>
          ${icon('check')}<span>${dirty ? 'Save' : 'Saved'}</span>
        </button>
      </div>
      <h2>${escapeHtml(`${formatGrams(recipe.dose)} -> ${formatGrams(recipe.yield)}`)}</h2>
      <p>${escapeHtml([recipe.profileTitle, ratio, shotDate(shot.timestamp)].filter(Boolean).join(' · '))}</p>
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

function batchWeight(batch: BeanBatch | null): string | null {
  if (!batch || batch.weightRemaining == null) return null;
  return `${formatGrams(batch.weightRemaining)} left`;
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
