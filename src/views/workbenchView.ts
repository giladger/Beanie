import type { MachineState, RecipeDraft } from '../api/types';
import { icon } from '../components/icons';
import { escapeAttr, escapeHtml } from '../components/html';

export type WorkbenchMachineCommandState = Extract<MachineState, 'espresso' | 'steam' | 'flush' | 'hotWater'>;

export interface WorkbenchTopbarViewModel {
  machineStatus: string;
  groupTemperature: string;
  steamTemperature: string;
  water: string;
  waterTone: '' | 'stat-alert' | 'stat-warn';
  scale: {
    label: string;
    title: string;
  };
  machineCommands: {
    available: boolean;
    current: MachineState;
    busy: boolean;
  };
  cleaningDue: boolean;
  asleep: boolean;
}

export interface WorkbenchHeroViewModel {
  beanName: string;
  roaster: string | null;
  age: string | null;
  remaining: string | null;
  shotsLeft: string | null;
  beanId: string | null;
}

export interface WorkbenchRecipeViewModel {
  draft: RecipeDraft;
  grinderStep: number;
  ratioLabel: string;
  brewTempLabel: string;
}

export interface WorkbenchViewModel {
  topbar: WorkbenchTopbarViewModel;
  hero: WorkbenchHeroViewModel;
  recipe: WorkbenchRecipeViewModel;
  historyHtml: string;
}

export interface LivePanelViewModel {
  active: boolean;
  finalizing: boolean;
  busy: boolean;
}

type EditField = 'dose' | 'yield' | 'ratio' | 'grinderSetting' | 'temperature';

export function renderWorkbench(model: WorkbenchViewModel): string {
  return `
    ${renderTopbar(model.topbar)}
    <main class="workbench">
      <section class="surface">
        ${renderHero(model.hero)}
        ${renderRecipeEditor(model.recipe)}
        ${model.historyHtml}
      </section>
    </main>
  `;
}

export function renderPageHeader(title: string, back = 'workbench', actions = ''): string {
  return `
    <header class="page-head">
      <button class="page-back" data-action="go-view" data-value="${escapeAttr(back)}" aria-label="Back" title="Back">
        ${icon('chevron-left')}<span>Back</span>
      </button>
      <h1 class="page-title">${escapeHtml(title)}</h1>
      <div class="page-head-actions">${actions}</div>
    </header>
  `;
}

export function renderLivePanel(model: LivePanelViewModel): string {
  if (!model.active && !model.finalizing) return '';
  return `
    <div class="live-panel">
      <div class="live-card panel ${model.finalizing ? 'live-finalizing' : ''}">
        <div class="live-head">
          <div class="live-title-row">
            <span class="eyebrow">${model.finalizing ? 'Saving shot' : 'Live shot'}</span>
            ${
              model.finalizing
                ? `<span class="live-saving" role="status"><span class="live-spinner" aria-hidden="true"></span><span>Saving…</span></span>`
                : `<button
              class="live-stop-button"
              data-action="stop"
              aria-label="Stop shot"
              title="Stop shot"
              ${model.busy ? 'disabled' : ''}
            >
              ${icon('square')}
              <span>Stop</span>
            </button>`
            }
          </div>
          <div class="live-readouts">
            ${liveReadout('Time', 'live-time', '0.0s')}
            ${liveReadout('Weight', 'live-weight', '--', 'g')}
            ${liveReadout('Pressure', 'live-pressure', '--', 'bar')}
            ${liveReadout('Flow', 'live-flow', '--', 'ml/s')}
            ${liveReadout('Temp', 'live-temp', '--', 'C')}
          </div>
        </div>
        <div class="live-canvas-wrap">
          <canvas id="live-canvas" class="live-canvas"></canvas>
        </div>
      </div>
    </div>
  `;
}

export function renderTopbar(model: WorkbenchTopbarViewModel): string {
  const powerAction = model.asleep ? 'wake' : 'sleep';
  const powerLabel = model.asleep ? 'Wake' : 'Sleep';
  const machineSettingsLabel = model.cleaningDue
    ? 'Water - steam, water, flush (cleaning due)'
    : 'Water - steam, water, flush';
  return `
    <header class="topbar">
      <div class="top-inline">
        <div class="top-stats" aria-label="Machine metrics">
          ${topStat('Status', model.machineStatus, 'stat-machine')}
          ${topStat('Group', model.groupTemperature, 'stat-group')}
          ${topStat('Steam', model.steamTemperature, 'stat-steam')}
          ${topStat('Water', model.water, 'stat-water', model.waterTone)}
          ${topStatButton('Scale', model.scale.label, model.scale.title, 'scale-stat', 'stat-scale')}
        </div>
        ${renderMachineCommands(model.machineCommands)}
        <div class="top-icons" role="toolbar" aria-label="Skin actions">
          <button class="icon-tool icon-tool-labeled ${model.cleaningDue ? 'has-badge' : ''}" data-action="open-machine-settings" aria-label="${escapeAttr(machineSettingsLabel)}" title="${escapeAttr(machineSettingsLabel)}">${icon('droplet')}<span class="icon-tool-label">Water</span>${model.cleaningDue ? '<span class="icon-tool-badge" aria-hidden="true"></span>' : ''}</button>
          <button class="icon-tool icon-tool-labeled" data-action="open-settings" aria-label="Settings" title="Settings">${icon('settings')}<span class="icon-tool-label">Settings</span></button>
          <button class="icon-tool icon-tool-labeled ${model.asleep ? 'icon-tool-wake' : ''}" data-action="${powerAction}" aria-label="${powerLabel}" title="${powerLabel}">${icon('power')}<span class="icon-tool-label">${escapeHtml(powerLabel)}</span></button>
        </div>
      </div>
    </header>
  `;
}

export function renderHero(model: WorkbenchHeroViewModel): string {
  return `
    <button class="hero panel" data-action="open-bean-picker" aria-label="Choose bean" title="Choose bean">
      <span class="bean-title">
        <span class="bean-name">${escapeHtml(model.beanName)}</span>
        ${model.roaster ? `<span class="bean-roaster">${escapeHtml(model.roaster)}</span>` : ''}
        ${icon('chevron-down')}
      </span>
      <span class="hero-facts">
        ${model.remaining ? `<span class="hero-remaining">${escapeHtml(model.remaining)}</span>` : ''}
        ${model.shotsLeft ? `<span class="hero-shots">${escapeHtml(model.shotsLeft)}</span>` : ''}
        ${(model.remaining || model.shotsLeft) && model.age ? '<span class="hero-divider" aria-hidden="true"></span>' : ''}
        ${model.age ? `<span class="hero-roast">${escapeHtml(model.age)}</span>` : ''}
      </span>
    </button>
  `;
}

export function renderRecipeEditor(model: WorkbenchRecipeViewModel): string {
  const draft = model.draft;
  return `
    <section class="recipe-grid">
      ${controlProfile(draft.profileTitle ?? 'No profile')}
      ${controlNumber('Dose', 'dose', draft.dose, 0.5)}
      ${controlNumber('Yield', 'yield', draft.yield, 1)}
      ${controlRatio(model.ratioLabel)}
      ${controlGrind(draft.grinderSetting ?? '--', model.grinderStep)}
      ${controlTemp(model.brewTempLabel)}
    </section>
  `;
}

function renderMachineCommands(model: WorkbenchTopbarViewModel['machineCommands']): string {
  if (!model.available) return '';
  const commands: Array<{ state: WorkbenchMachineCommandState; label: string; icon: string }> = [
    { state: 'espresso', label: 'Shot', icon: 'coffee' },
    { state: 'steam', label: 'Steam', icon: 'waves' },
    { state: 'flush', label: 'Flush', icon: 'refresh-cw' },
    { state: 'hotWater', label: 'Water', icon: 'droplets' }
  ];
  return `
    <div class="top-machine-actions" role="toolbar" aria-label="Machine commands">
      ${commands
        .map(({ state, label, icon: iconName }) => {
          const active = model.current === state;
          const disabled = model.busy ? ' disabled' : '';
          const title = active ? `Stop ${label.toLowerCase()}` : label;
          return `
            <button
              class="machine-command ${active ? 'active' : ''}"
              data-action="machine-command"
              data-value="${escapeAttr(state)}"
              aria-pressed="${active ? 'true' : 'false'}"
              aria-label="${escapeAttr(title)}"
              title="${escapeAttr(title)}"
              ${disabled}
            >
              ${icon(iconName)}
              <span>${escapeHtml(label)}</span>
            </button>
          `;
        })
        .join('')}
    </div>
  `;
}

function controlNumber(label: string, field: EditField, value: number | null | undefined, step: number): string {
  return `
    <div class="control panel">
      <label>${escapeHtml(label)}</label>
      <div class="stepper compact-stepper">
        <button data-action="adjust" data-field="${field}" data-delta="${-step}" aria-label="Decrease ${escapeAttr(label)}">${icon('minus')}</button>
        <button class="value-button" data-action="edit-field" data-field="${field}">${escapeHtml(value == null ? '--' : value.toString())}</button>
        <button data-action="adjust" data-field="${field}" data-delta="${step}" aria-label="Increase ${escapeAttr(label)}">${icon('plus')}</button>
      </div>
    </div>
  `;
}

function controlGrind(value: string, step: number): string {
  return `
    <div class="control grind-control panel">
      <label>Grind</label>
      <div class="stepper compact-stepper">
        <button data-action="adjust" data-field="grinderSetting" data-delta="${-step}" aria-label="Decrease grind">${icon('minus')}</button>
        <button class="value-button" data-action="edit-field" data-field="grinderSetting">${escapeHtml(value)}</button>
        <button data-action="adjust" data-field="grinderSetting" data-delta="${step}" aria-label="Increase grind">${icon('plus')}</button>
      </div>
    </div>
  `;
}

function controlProfile(title: string): string {
  return `
    <div class="select-control profile-control panel">
      <label>Profile</label>
      <button type="button" class="profile-button" data-action="open-profile-picker">
        <span>${escapeHtml(title)}</span>
      </button>
    </div>
  `;
}

function controlRatio(label: string): string {
  return `
    <div class="control panel">
      <label>Ratio</label>
      <div class="stepper compact-stepper">
        <button data-action="adjust" data-field="ratio" data-delta="-0.1" aria-label="Decrease ratio">${icon('minus')}</button>
        <button class="value-button" data-action="edit-field" data-field="ratio">${escapeHtml(label)}</button>
        <button data-action="adjust" data-field="ratio" data-delta="0.1" aria-label="Increase ratio">${icon('plus')}</button>
      </div>
    </div>
  `;
}

function controlTemp(label: string): string {
  return `
    <div class="control panel">
      <label>Temp</label>
      <div class="stepper compact-stepper">
        <button data-action="adjust" data-field="temperature" data-delta="-0.5" aria-label="Decrease temperature">${icon('minus')}</button>
        <button class="value-button" data-action="edit-field" data-field="temperature">${escapeHtml(label)}</button>
        <button data-action="adjust" data-field="temperature" data-delta="0.5" aria-label="Increase temperature">${icon('plus')}</button>
      </div>
    </div>
  `;
}

function topStat(label: string, value: string, id?: string, toneClass?: string): string {
  const idAttr = id ? ` id="${id}"` : '';
  const cls = toneClass ? ` ${toneClass}` : '';
  return `<div class="top-stat${cls}"><label>${escapeHtml(label)}</label><strong${idAttr}>${escapeHtml(value)}</strong></div>`;
}

function topStatButton(label: string, value: string, title: string, action: string, id?: string): string {
  const idAttr = id ? ` id="${id}"` : '';
  return `
    <button class="top-stat top-stat-button" data-action="${escapeAttr(action)}" aria-label="${escapeAttr(`${label}: ${value}. ${title}`)}" title="${escapeAttr(title)}">
      <span class="top-stat-label">${escapeHtml(label)}</span>
      <strong${idAttr}>${escapeHtml(value)}</strong>
    </button>
  `;
}

function liveReadout(label: string, id: string, value: string, unit = ''): string {
  const suffix = unit ? `<em>${escapeHtml(unit)}</em>` : '';
  return `<div class="live-readout"><label>${escapeHtml(label)}</label><strong id="${id}">${escapeHtml(value)}</strong>${suffix}</div>`;
}
