import type { MachineState, RecipeDraft } from '../api/types';
import type { StageReason } from '../domain/liveStageReason';
import type { TopbarViewModel } from '../render/topbarPresentation';
import { icon } from '../components/icons';
import { escapeAttr, escapeHtml } from '../components/html';

export interface WorkbenchTopbarViewModel {
  /** Complete atomic presentation for the morph-opaque telemetry island. */
  stats: TopbarViewModel;
  machineCommands: {
    available: boolean;
    current: MachineState;
    busy: boolean;
  };
  /** Wall-clock label (e.g. "14:05"), or null to hide the topbar clock.
   * The app patches #top-clock in place each minute. */
  clock: string | null;
  cleaningDue: boolean;
  /** Show the "Ask Derek" tool (live gateway with the Derek relay). */
  derekEnabled?: boolean;
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
  /** Visible acknowledgement for the debounced recipe -> machine workflow write. */
  applyState?: 'idle' | 'pending' | 'applied' | 'failed' | 'stale';
  /** A Derek change is staged for the next shot; offers one-tap revert and
   * highlights the control carrying the changed value. */
  derekTweak?: { summary: string; parameter: string | null } | null;
}

export interface WorkbenchViewModel {
  topbar: WorkbenchTopbarViewModel;
  hero: WorkbenchHeroViewModel;
  recipe: WorkbenchRecipeViewModel;
  historyHtml: string;
}

export interface LiveStageView {
  /** Step name, e.g. "Preinfusion", "Pour", "Decline". */
  name: string;
  /**
   * The actual reason this stage advanced (e.g. "weight 18.2 g",
   * "pressure 4.2 bar", "9.8s elapsed") — from the gateway's shotState
   * decision, described with handoff telemetry for firmware-side exits.
   * The kind picks the chip tint (series colors for advances, semantic
   * goal/stop/warn for the final stop). Null until the stage has handed off.
   */
  reason: StageReason | null;
}

export interface LiveStagesView {
  /** Every profile step, in order. */
  steps: LiveStageView[];
  /** Index of the stage the machine is currently in, or null when unknown. */
  currentIndex: number | null;
}

export interface LivePanelViewModel {
  active: boolean;
  finalizing: boolean;
  busy: boolean;
  /** Reference-shot overlay: null when no usable reference shot exists. */
  ghost: { enabled: boolean; title: string } | null;
  /** The profile's stages for the rail beside the chart; null when unknown. */
  stages: LiveStagesView | null;
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
            ${model.finalizing ? '<span class="eyebrow">Saving shot</span>' : ''}
            ${
              model.ghost
                ? `<button
              class="live-ghost-button ${model.ghost.enabled ? 'active' : ''}"
              data-action="live-ghost-toggle"
              aria-pressed="${model.ghost.enabled}"
              aria-label="${escapeAttr(model.ghost.title)}"
              title="${escapeAttr(model.ghost.title)}"
            >${icon('ghost')}<span>Ghost</span></button>`
                : ''
            }
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
          <div class="live-readouts" data-morph-skip="live-readouts">
            ${liveReadout('Time', 'live-time', '0.0s')}
            ${liveReadout('Weight', 'live-weight', '--', 'g')}
            ${liveReadout('Pressure', 'live-pressure', '--', 'bar')}
            ${liveReadout('Flow', 'live-flow', '--', 'ml/s')}
            ${liveReadout('Temp', 'live-temp', '--', 'C')}
          </div>
        </div>
        <div class="live-body">
          ${renderStageRail(model.stages)}
          <div class="live-canvas-wrap">
            <canvas id="live-canvas" class="live-canvas"></canvas>
          </div>
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
  const stats = model.stats;
  return `
    <header class="topbar">
      <div class="top-inline">
        <div id="top-stats-island" class="top-stats" data-morph-skip="topbar-stats" aria-label="Machine metrics">
          ${topStat('Status', stats.machine, 'stat-machine')}
          ${topStat('Group', stats.group, 'stat-group')}
          ${topStat('Steam', stats.steam, 'stat-steam')}
          ${topStatButton('Water', stats.water, 'water-stat', 'stat-water')}
          ${topStatButton('Scale', stats.scale, 'scale-stat', 'stat-scale')}
        </div>
        ${renderShotCommand(model.machineCommands)}
        ${model.clock == null ? '' : `<div class="top-clock" id="top-clock" data-morph-skip="top-clock" aria-label="Clock">${escapeHtml(model.clock)}</div>`}
        <div class="top-icons" role="toolbar" aria-label="Skin actions">
          ${model.derekEnabled ? `<button class="icon-tool icon-tool-labeled" data-action="derek-open" aria-label="Ask Derek, the Decent assistant" title="Ask Derek, the Decent assistant">${icon('sparkles')}<span class="icon-tool-label">Derek</span></button>` : ''}
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

// Which recipe control carries a staged Derek change, per dial-in parameter.
// Profile-level knobs (peak pressure, preinfusion) live in the profile cell.
function derekMarkFor(tweak: WorkbenchRecipeViewModel['derekTweak'], control: string): boolean {
  const parameter = tweak?.parameter;
  if (!parameter) return false;
  if (control === 'dose' || control === 'yield' || control === 'grind') {
    return parameter === (control === 'grind' ? 'grind' : control);
  }
  if (control === 'temp') return parameter === 'brew_temperature';
  return control === 'profile' && !['grind', 'dose', 'yield', 'brew_temperature'].includes(parameter);
}

export function renderRecipeEditor(model: WorkbenchRecipeViewModel): string {
  const draft = model.draft;
  const mark = (control: string) => (derekMarkFor(model.derekTweak, control) ? ' derek-changed' : '');
  return `
    <section class="recipe-grid">
      ${controlProfile(draft.profileTitle ?? 'No profile', model.derekTweak, model.applyState, mark('profile'))}
      ${controlNumber('Dose', 'dose', draft.dose, 0.5, mark('dose'))}
      ${controlNumber('Yield', 'yield', draft.yield, 1, mark('yield'))}
      ${controlRatio(model.ratioLabel)}
      ${controlGrind(draft.grinderSetting ?? '--', model.grinderStep, mark('grind'))}
      ${controlTemp(model.brewTempLabel, mark('temp'))}
    </section>
  `;
}

// Fallback shot trigger for machines without a GHC (and the simulator/demo).
// The steam/flush/hot-water fallbacks live on the machine page's lanes; the
// shot stays up here because brewing is the workbench's own live view.
function renderShotCommand(model: WorkbenchTopbarViewModel['machineCommands']): string {
  if (!model.available) return '';
  const active = model.current === 'espresso';
  const title = active ? 'Stop shot' : 'Shot';
  return `
    <button
      class="machine-command ${active ? 'active' : ''}"
      data-action="machine-command"
      data-value="espresso"
      aria-pressed="${active ? 'true' : 'false'}"
      aria-label="${escapeAttr(title)}"
      title="${escapeAttr(title)}"
      ${model.busy ? 'disabled' : ''}
    >
      ${icon('coffee')}
      <span>Shot</span>
    </button>
  `;
}

function controlNumber(label: string, field: EditField, value: number | null | undefined, step: number, markClass = ''): string {
  return `
    <div class="control panel${markClass}">
      <label>${escapeHtml(label)}</label>
      <div class="stepper compact-stepper">
        <button data-action="adjust" data-field="${field}" data-delta="${-step}" aria-label="Decrease ${escapeAttr(label)}">${icon('minus')}</button>
        <button class="value-button" data-action="edit-field" data-field="${field}">${escapeHtml(value == null ? '--' : value.toString())}</button>
        <button data-action="adjust" data-field="${field}" data-delta="${step}" aria-label="Increase ${escapeAttr(label)}">${icon('plus')}</button>
      </div>
    </div>
  `;
}

function controlGrind(value: string, step: number, markClass = ''): string {
  return `
    <div class="control grind-control panel${markClass}">
      <label>Grind</label>
      <div class="stepper compact-stepper">
        <button data-action="adjust" data-field="grinderSetting" data-delta="${-step}" aria-label="Decrease grind">${icon('minus')}</button>
        <button class="value-button" data-action="edit-field" data-field="grinderSetting">${escapeHtml(value)}</button>
        <button data-action="adjust" data-field="grinderSetting" data-delta="${step}" aria-label="Increase grind">${icon('plus')}</button>
      </div>
    </div>
  `;
}

// The staged-tweak affordance lives in the label row: the profile button
// already shows the variant's "· derek:" title, so all that's needed is the
// way back — and the workbench has no vertical room for a separate banner
// (the surface grid is three fixed rows).
function controlProfile(
  title: string,
  tweak: { summary: string; parameter: string | null } | null | undefined,
  applyState: WorkbenchRecipeViewModel['applyState'],
  markClass = ''
): string {
  const revert = tweak
    ? `<button type="button" class="derek-tweak-revert" data-action="derek-revert-tweak" title="${escapeAttr(`Revert: ${tweak.summary}`)}" aria-label="${escapeAttr(`Revert Derek tweak: ${tweak.summary}`)}">${icon('rotate-ccw')}<span>Revert tweak</span></button>`
    : '';
  const apply = recipeApplyChip(applyState);
  return `
    <div class="select-control profile-control panel${markClass}">
      <div class="profile-label-row"><label>Profile</label><span class="profile-label-actions">${revert}${apply}</span></div>
      <button type="button" class="profile-button" data-action="open-profile-picker">
        <span>${escapeHtml(title)}</span>
      </button>
    </div>
  `;
}

function recipeApplyChip(state: WorkbenchRecipeViewModel['applyState'] = 'idle'): string {
  if (state === 'idle' || state === 'stale') return '';
  const presentation = {
    pending: { label: 'Applying…', tone: 'pending' },
    applied: { label: 'Applied', tone: 'ok' },
    failed: { label: 'Apply failed', tone: 'alert' }
  }[state];
  return `<span class="recipe-apply-chip ${presentation.tone}">${escapeHtml(presentation.label)}</span>`;
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

function controlTemp(label: string, markClass = ''): string {
  return `
    <div class="control panel${markClass}">
      <label>Temp</label>
      <div class="stepper compact-stepper">
        <button data-action="adjust" data-field="temperature" data-delta="-0.5" aria-label="Decrease temperature">${icon('minus')}</button>
        <button class="value-button" data-action="edit-field" data-field="temperature">${escapeHtml(label)}</button>
        <button data-action="adjust" data-field="temperature" data-delta="0.5" aria-label="Increase temperature">${icon('plus')}</button>
      </div>
    </div>
  `;
}

function topStat(label: string, stat: TopbarViewModel['machine'], id?: string): string {
  const idAttr = id ? ` id="${id}"` : '';
  return `<div class="${escapeAttr(stat.className)}" aria-label="${escapeAttr(stat.ariaLabel)}"><label>${escapeHtml(label)}</label><strong${idAttr}>${escapeHtml(stat.text)}</strong></div>`;
}

function topStatButton(label: string, stat: TopbarViewModel['water'], action: string, id?: string): string {
  const idAttr = id ? ` id="${id}"` : '';
  return `
    <button class="${escapeAttr(stat.className)}" data-action="${escapeAttr(action)}" aria-label="${escapeAttr(stat.ariaLabel)}" title="${escapeAttr(stat.title)}">
      <span class="top-stat-label">${escapeHtml(label)}</span>
      <strong${idAttr}>${escapeHtml(stat.text)}</strong>
    </button>
  `;
}

function liveReadout(label: string, id: string, value: string, unit = ''): string {
  const suffix = unit ? `<em>${escapeHtml(unit)}</em>` : '';
  return `<div class="live-readout"><label>${escapeHtml(label)}</label><strong id="${id}">${escapeHtml(value)}</strong>${suffix}</div>`;
}

// Fixed vertical rail of every profile stage, seeded beside the chart; the
// LiveReadouts owner can rebuild it when an opaque surviving rail receives a
// different profile, then patches done/current/upcoming states. Hidden
// (but kept in the DOM for patching) when the profile's steps aren't known.
// Also reused by the historic shot-stages overlay, which passes its own id.
export function renderStageRail(
  stages: LiveStagesView | null,
  id = 'live-stage-rail'
): string {
  const morphSkip = id === 'live-stage-rail' ? ' data-morph-skip="live-stage-rail"' : '';
  if (!stages || stages.steps.length === 0) {
    return `<ol class="live-stage-rail" id="${id}"${morphSkip} hidden></ol>`;
  }
  const items = stages.steps
    .map(
      (step, index) => `
      <li class="live-stage-item ${stageStateClass(index, stages.currentIndex)}" data-index="${index}">
        <span class="live-stage-num">${index + 1}</span>
        <span class="live-stage-text">
          <span class="live-stage-label">${escapeHtml(step.name)}</span>
          <span class="live-stage-reason" data-index="${index}"${
            step.reason ? ` data-kind="${step.reason.kind}"` : ''
          }>${escapeHtml(step.reason?.text ?? '')}</span>
        </span>
      </li>`
    )
    .join('');
  return `<ol class="live-stage-rail" id="${id}"${morphSkip}>${items}</ol>`;
}

// Timeline state for a rail item: stages before the current one are done,
// stages after it upcoming. No classes when the current stage is unknown.
function stageStateClass(index: number, currentIndex: number | null): string {
  if (currentIndex == null) return '';
  if (index < currentIndex) return 'done';
  if (index === currentIndex) return 'current';
  return 'upcoming';
}
