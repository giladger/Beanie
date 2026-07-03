import { STEAM_PURGE_MODES } from '../api/settings';
import { CLEANING_THRESHOLD_OPTIONS } from '../domain/cleaning';
import type { HotWaterStopMode } from '../domain/machinePreferences';
import type { NumberSpec } from '../domain/waterSettings';
import { icon } from '../components/icons';
import { escapeAttr, escapeHtml } from '../components/html';

export type MachineViewTone = 'steam' | 'water' | 'flush';

export interface CleaningBarViewModel {
  due: boolean;
  profileTitle: string | null;
  profilesAvailable: boolean;
  shotsSinceClean: number;
  lastCleanedAt: string | null;
  threshold: number;
}

export interface MachineProgressViewModel {
  title: string;
  tone: MachineViewTone;
  primaryTime: { value: string; label: string | null };
  meta: string[];
  stats: Array<{ label: string; value: string; unit: string }>;
  busy: boolean;
  stopRequested: boolean;
  stopLabel: string;
}

export interface MachinePageViewModel {
  headerHtml: string;
  lanes: MachineLaneOptions[];
  cleaningBarHtml: string;
}

export interface MachinePresetOption {
  id: string;
  label: string;
}

export interface MachineLaneOptions {
  tone: MachineViewTone;
  eyebrow: string;
  title: string;
  presetName: string;
  presets: MachinePresetOption[];
  selectedPreset: string;
  labelOverrides: Record<string, string>;
  values: MachineValueTile[];
  /**
   * App-side start command for machines without a GHC (and the simulator/demo);
   * null hides the button where the physical GHC buttons do this job.
   */
  start: { state: 'steam' | 'hotWater' | 'flush'; busy: boolean } | null;
}

export interface MachineValueTile {
  name?: string;
  label: string;
  value: string;
  unit: string;
  action?: string;
  actionValue?: string;
  spec?: NumberSpec;
  disabled?: boolean;
}

export function renderMachinePage(model: MachinePageViewModel): string {
  return `
    ${model.headerHtml}
    <main class="page-body machine-page no-scroll-page">
      <div class="machine-lanes">
        ${model.lanes.map((lane) => renderMachineLane(lane)).join('')}
      </div>
      ${model.cleaningBarHtml}
    </main>
  `;
}

export function renderCleaningBar(model: CleaningBarViewModel): string {
  const profileControl = model.profilesAvailable
    ? `<button type="button" class="cleaning-profile-button" data-action="open-cleaning-profile-picker" aria-label="Choose cleaning profile">
        <span>${escapeHtml(model.profileTitle ?? 'Choose…')}</span>
        ${icon('chevron-down')}
      </button>`
    : '<em class="cleaning-missing">No profiles loaded</em>';

  const count = model.shotsSinceClean;
  const countLabel = `${count} ${count === 1 ? 'shot' : 'shots'} since last clean`;
  const sinceLine = model.lastCleanedAt
    ? `${countLabel} · last cleaned ${cleaningDateLabel(model.lastCleanedAt)}`
    : `${countLabel} · never cleaned`;

  const thresholdButtons = CLEANING_THRESHOLD_OPTIONS.map((n) => {
    const active = model.threshold === n;
    return `<button type="button" class="${active ? 'active' : ''}" data-action="cleaning-threshold" data-value="${n}" aria-pressed="${active}">${
      n === 0 ? 'Off' : String(n)
    }</button>`;
  }).join('');

  const stat = model.profileTitle ? sinceLine : 'Install a “Cleaning / forward flush ×5” profile to enable';
  return `
    <section class="cleaning-bar ${model.due ? 'due' : ''}">
      <div class="cleaning-bar-info">
        <span class="cleaning-bar-icon">${icon('refresh-cw')}</span>
        <div class="cleaning-bar-text">
          <strong>Backflush cleaning</strong>
          <small class="${model.due ? 'due' : ''}">${escapeHtml(stat)}</small>
        </div>
      </div>
      <div class="cleaning-bar-field">
        <span>Profile</span>
        ${profileControl}
      </div>
      <div class="cleaning-bar-field">
        <span>Remind</span>
        <div class="settings-segmented cleaning-threshold" role="group" aria-label="Cleaning reminder threshold">${thresholdButtons}</div>
      </div>
      <button type="button" class="cleaning-run" data-action="open-cleaning-wizard" title="Open the guided backflush cleaning routine — detergent in a blind basket, run the profile, flush, then repeat. Your recipe is restored afterwards.">
        ${icon('refresh-cw')}<span>Run cleaning cycle</span>
      </button>
    </section>`;
}

export function renderMachineProgressPage(model: MachineProgressViewModel): string {
  return `
    <header class="page-head machine-progress-head">
      <h1 class="page-title">${escapeHtml(model.title)}</h1>
    </header>
    <main class="page-body machine-page machine-progress-page no-scroll-page">
      <section class="machine-progress ${model.tone}">
        <div class="machine-progress-focus">
          <div class="machine-progress-ring">${machineGraphicIcon(model.tone)}</div>
          <div class="machine-progress-time">
            <strong>${escapeHtml(model.primaryTime.value)}</strong>
            ${model.primaryTime.label == null ? '' : `<span>${escapeHtml(model.primaryTime.label)}</span>`}
          </div>
          <div class="machine-progress-meta">
            ${model.meta.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}
          </div>
        </div>
        <div class="machine-progress-actions">
          <div class="machine-progress-stats">
            ${model.stats.map((stat) => `
              <div class="machine-progress-stat">
                <span>${escapeHtml(stat.label)}</span>
                <strong>${escapeHtml(stat.value)}</strong>
                <em>${escapeHtml(stat.unit)}</em>
              </div>
            `).join('')}
          </div>
          <button type="button" class="machine-progress-add" data-action="machine-extend-service" ${model.busy ? 'disabled' : ''}>
            ${icon('plus')}
            <span>+5s</span>
          </button>
          <button type="button" class="machine-progress-stop ${model.stopRequested ? 'stopping' : ''}" data-action="stop" ${model.busy && model.stopRequested ? 'disabled' : ''}>
            ${icon('square')}
            <span>${escapeHtml(model.stopLabel)}</span>
          </button>
        </div>
      </section>
    </main>
  `;
}

function cleaningDateLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) return iso;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function renderMachineLane(options: MachineLaneOptions): string {
  const startLabel = `Start ${options.eyebrow.toLowerCase()}`;
  const start = options.start
    ? `<button
        type="button"
        class="machine-lane-start"
        data-action="machine-command"
        data-value="${escapeAttr(options.start.state)}"
        aria-label="${escapeAttr(startLabel)}"
        title="${escapeAttr(startLabel)}"
        ${options.start.busy ? 'disabled' : ''}
      >${icon('play')}<span>Start</span></button>`
    : '';
  return `
    <section class="machine-lane ${options.tone}">
      <div class="machine-lane-title">
        <div>
          <span class="eyebrow">${escapeHtml(options.eyebrow)}</span>
          <h2>${escapeHtml(options.title)}</h2>
        </div>
        ${start}
      </div>
      <div class="machine-graphic" aria-hidden="true">
        ${machineGraphicIcon(options.tone)}
      </div>
      ${renderMachinePresetTiles(options.presetName, options.presets, options.selectedPreset, options.labelOverrides)}
      <div class="machine-values">
        ${options.values.map(renderMachineValueTile).join('')}
      </div>
    </section>
  `;
}

function renderMachinePresetTiles(
  name: string,
  presets: MachinePresetOption[],
  selected: string,
  labelOverrides: Record<string, string>
): string {
  return `
    <div class="machine-presets" role="group">
      ${presets.map((preset) => renderMachinePresetTile(name, preset, selected === preset.id, labelOverrides)).join('')}
    </div>
  `;
}

function renderMachinePresetTile(
  name: string,
  preset: MachinePresetOption,
  selected: boolean,
  labelOverrides: Record<string, string>
): string {
  const label = presetLabel(name, preset, labelOverrides);
  return `
    <span class="machine-preset ${selected ? 'active' : ''}">
      <button type="button" class="machine-preset-select" data-action="machine-preset" data-name="${escapeAttr(name)}" data-value="${escapeAttr(preset.id)}" aria-pressed="${selected}">
        <strong>${escapeHtml(label)}</strong>
      </button>
      <button type="button" class="machine-preset-edit" data-action="machine-edit-label" data-name="${escapeAttr(name)}" data-value="${escapeAttr(preset.id)}" data-label="${escapeAttr(label)}" aria-label="Rename ${escapeAttr(label)}" title="Rename">
        ${icon('pencil')}
      </button>
    </span>
  `;
}

function renderMachineValueTile(tile: MachineValueTile): string {
  const disabled = tile.disabled === true ? ' disabled' : '';
  const action = tile.action
    ? ` data-action="${escapeAttr(tile.action)}" data-value="${escapeAttr(tile.actionValue ?? '')}"`
    : tile.name && tile.spec?.enabled
      ? ` data-action="machine-edit-value" data-name="${escapeAttr(tile.name)}" data-title="${escapeAttr(tile.label)}" data-value="${escapeAttr(tile.value)}" data-unit="${escapeAttr(tile.spec.unit)}" data-min="${tile.spec.min}" data-max="${tile.spec.max}" data-step="${tile.spec.step}"`
      : '';
  const title = tile.spec?.reason ? ` title="${escapeAttr(tile.spec.reason)}"` : '';
  return `
    <button type="button" class="machine-value-tile ${tile.disabled ? 'disabled' : ''}"${action}${title}${disabled}>
      <span class="machine-value-label">${escapeHtml(tile.label)}</span>
      <strong>${escapeHtml(tile.value || '--')}</strong>
      <em>${escapeHtml(tile.unit)}</em>
    </button>
  `;
}

function machineGraphicIcon(tone: MachineViewTone): string {
  const streamlineGlyphs: Record<MachineViewTone, string> = {
    steam: 'M 86.125 -11.625 C 83.042969 -9.042969 79.605469 -7.082031 75.8125 -5.75 C 72.019531 -4.417969 68.082031 -3.75 64 -3.75 C 60 -3.75 56.105469 -4.457031 52.3125 -5.875 C 48.519531 -7.292969 45.082031 -9.332031 42 -12 C 39.25 -14.332031 36.9375 -17.042969 35.0625 -20.125 C 33.1875 -23.207031 31.832031 -26.5 31 -30 C 29.667969 -30.25 28.332031 -30.625 27 -31.125 C 25.667969 -31.625 24.375 -32.207031 23.125 -32.875 C 21.457031 -33.792969 19.9375 -34.832031 18.5625 -36 C 17.1875 -37.167969 15.957031 -38.5 14.875 -40 C 13.792969 -41.417969 12.855469 -42.957031 12.0625 -44.625 C 11.269531 -46.292969 10.667969 -48 10.25 -49.75 C 9.832031 -51.5 9.625 -53.292969 9.625 -55.125 C 9.625 -56.957031 9.792969 -58.75 10.125 -60.5 C 10.457031 -62.332031 10.980469 -64.082031 11.6875 -65.75 C 12.394531 -67.417969 13.25 -69 14.25 -70.5 C 15.332031 -72 16.542969 -73.375 17.875 -74.625 C 19.207031 -75.875 20.625 -76.957031 22.125 -77.875 C 23.707031 -78.875 25.375 -79.667969 27.125 -80.25 C 28.875 -80.832031 30.625 -81.25 32.375 -81.5 C 33.292969 -81.667969 34.105469 -81.480469 34.8125 -80.9375 C 35.519531 -80.394531 35.917969 -79.667969 36 -78.75 C 36.082031 -77.917969 35.875 -77.144531 35.375 -76.4375 C 34.875 -75.730469 34.167969 -75.332031 33.25 -75.25 C 31.917969 -75 30.582031 -74.644531 29.25 -74.1875 C 27.917969 -73.730469 26.667969 -73.167969 25.5 -72.5 C 24.332031 -71.75 23.25 -70.894531 22.25 -69.9375 C 21.25 -68.980469 20.332031 -67.957031 19.5 -66.875 C 18.75 -65.707031 18.105469 -64.5 17.5625 -63.25 C 17.019531 -62 16.625 -60.707031 16.375 -59.375 C 16.125 -58.042969 16 -56.6875 16 -55.3125 C 16 -53.9375 16.167969 -52.582031 16.5 -51.25 C 16.832031 -49.917969 17.292969 -48.625 17.875 -47.375 C 18.457031 -46.125 19.167969 -44.957031 20 -43.875 C 20.832031 -42.707031 21.769531 -41.6875 22.8125 -40.8125 C 23.855469 -39.9375 24.957031 -39.167969 26.125 -38.5 C 27.375 -37.832031 28.667969 -37.292969 30 -36.875 C 31.332031 -36.457031 32.667969 -36.167969 34 -36 C 34.75 -35.917969 35.394531 -35.625 35.9375 -35.125 C 36.480469 -34.625 36.792969 -34.042969 36.875 -33.375 C 37.375 -30.125 38.417969 -27.082031 40 -24.25 C 41.582031 -21.417969 43.625 -18.917969 46.125 -16.75 C 48.625 -14.667969 51.417969 -13.042969 54.5 -11.875 C 57.582031 -10.707031 60.75 -10.125 64 -10.125 C 67.332031 -10.125 70.542969 -10.667969 73.625 -11.75 C 76.707031 -12.832031 79.5 -14.417969 82 -16.5 C 84.582031 -18.667969 86.6875 -21.144531 88.3125 -23.9375 C 89.9375 -26.730469 91 -29.75 91.5 -33 C 91.667969 -33.75 92 -34.355469 92.5 -34.8125 C 93 -35.269531 93.625 -35.542969 94.375 -35.625 C 95.792969 -35.707031 97.167969 -35.957031 98.5 -36.375 C 99.832031 -36.792969 101.082031 -37.332031 102.25 -38 C 103.5 -38.667969 104.667969 -39.4375 105.75 -40.3125 C 106.832031 -41.1875 107.792969 -42.167969 108.625 -43.25 C 109.457031 -44.332031 110.167969 -45.5 110.75 -46.75 C 111.332031 -48 111.792969 -49.292969 112.125 -50.625 C 112.457031 -51.957031 112.644531 -53.3125 112.6875 -54.6875 C 112.730469 -56.0625 112.625 -57.417969 112.375 -58.75 C 112.207031 -60.082031 111.855469 -61.394531 111.3125 -62.6875 C 110.769531 -63.980469 110.125 -65.167969 109.375 -66.25 C 108.625 -67.417969 107.75 -68.480469 106.75 -69.4375 C 105.75 -70.394531 104.667969 -71.25 103.5 -72 C 102.25 -72.75 100.980469 -73.355469 99.6875 -73.8125 C 98.394531 -74.269531 97.082031 -74.625 95.75 -74.875 C 94.832031 -74.957031 94.125 -75.355469 93.625 -76.0625 C 93.125 -76.769531 92.917969 -77.542969 93 -78.375 C 93.167969 -79.292969 93.582031 -80.019531 94.25 -80.5625 C 94.917969 -81.105469 95.707031 -81.292969 96.625 -81.125 C 98.457031 -80.875 100.230469 -80.4375 101.9375 -79.8125 C 103.644531 -79.1875 105.25 -78.375 106.75 -77.375 C 108.332031 -76.375 109.792969 -75.25 111.125 -74 C 112.457031 -72.75 113.625 -71.375 114.625 -69.875 C 115.625 -68.375 116.480469 -66.769531 117.1875 -65.0625 C 117.894531 -63.355469 118.417969 -61.625 118.75 -59.875 C 119 -58.042969 119.105469 -56.230469 119.0625 -54.4375 C 119.019531 -52.644531 118.792969 -50.875 118.375 -49.125 C 117.875 -47.292969 117.230469 -45.5625 116.4375 -43.9375 C 115.644531 -42.3125 114.707031 -40.792969 113.625 -39.375 C 112.457031 -37.957031 111.1875 -36.644531 109.8125 -35.4375 C 108.4375 -34.230469 106.957031 -33.207031 105.375 -32.375 C 104.125 -31.707031 102.8125 -31.144531 101.4375 -30.6875 C 100.0625 -30.230469 98.667969 -29.875 97.25 -29.625 C 96.417969 -26.125 95.042969 -22.832031 93.125 -19.75 C 91.207031 -16.667969 88.875 -13.957031 86.125 -11.625 Z M 64.375 -105.75 C 65.207031 -105.75 65.9375 -105.4375 66.5625 -104.8125 C 67.1875 -104.1875 67.5 -103.457031 67.5 -102.625 L 67.5 -34.625 C 67.5 -33.792969 67.1875 -33.0625 66.5625 -32.4375 C 65.9375 -31.8125 65.207031 -31.5 64.375 -31.5 C 63.457031 -31.5 62.6875 -31.8125 62.0625 -32.4375 C 61.4375 -33.0625 61.125 -33.792969 61.125 -34.625 L 61.125 -102.625 C 61.125 -103.457031 61.4375 -104.1875 62.0625 -104.8125 C 62.6875 -105.4375 63.457031 -105.75 64.375 -105.75 Z M 52.625 -105.75 C 53.457031 -105.5 54.105469 -105 54.5625 -104.25 C 55.019531 -103.5 55.125 -102.707031 54.875 -101.875 L 41 -45 C 40.75 -44.167969 40.25 -43.519531 39.5 -43.0625 C 38.75 -42.605469 37.957031 -42.457031 37.125 -42.625 C 36.292969 -42.875 35.644531 -43.375 35.1875 -44.125 C 34.730469 -44.875 34.582031 -45.667969 34.75 -46.5 L 48.75 -103.375 C 48.917969 -104.207031 49.375 -104.855469 50.125 -105.3125 C 50.875 -105.769531 51.707031 -105.917969 52.625 -105.75 Z M 76.125 -105.75 C 75.292969 -105.5 74.644531 -105 74.1875 -104.25 C 73.730469 -103.5 73.582031 -102.707031 73.75 -101.875 L 87.75 -45 C 87.917969 -44.167969 88.394531 -43.519531 89.1875 -43.0625 C 89.980469 -42.605469 90.792969 -42.457031 91.625 -42.625 C 92.457031 -42.875 93.105469 -43.375 93.5625 -44.125 C 94.019531 -44.875 94.125 -45.667969 93.875 -46.5 L 80 -103.375 C 79.75 -104.207031 79.25 -104.855469 78.5 -105.3125 C 77.75 -105.769531 76.957031 -105.917969 76.125 -105.75 Z M 76.125 -105.75',
    water: 'M 63.875 -109.375 C 64.625 -109.375 65.292969 -109.125 65.875 -108.625 C 66.457031 -108.125 66.832031 -107.5 67 -106.75 C 67.582031 -103.667969 68.5 -100.582031 69.75 -97.5 C 71 -94.5 72.480469 -91.582031 74.1875 -88.75 C 75.894531 -85.917969 77.832031 -83.292969 80 -80.875 C 82.167969 -78.375 84.542969 -76.125 87.125 -74.125 C 92.707031 -69.625 96.957031 -64.6875 99.875 -59.3125 C 102.792969 -53.9375 104.25 -48.292969 104.25 -42.375 C 104.25 -37.042969 103.207031 -31.894531 101.125 -26.9375 C 99.042969 -21.980469 96.125 -17.625 92.375 -13.875 C 88.625 -10.042969 84.269531 -7.105469 79.3125 -5.0625 C 74.355469 -3.019531 69.207031 -2 63.875 -2 C 58.542969 -2 53.394531 -3.019531 48.4375 -5.0625 C 43.480469 -7.105469 39.082031 -10.042969 35.25 -13.875 C 31.5 -17.625 28.605469 -21.980469 26.5625 -26.9375 C 24.519531 -31.894531 23.5 -37.042969 23.5 -42.375 C 23.5 -48.292969 24.957031 -53.9375 27.875 -59.3125 C 30.792969 -64.6875 35.042969 -69.625 40.625 -74.125 C 43.125 -76.125 45.457031 -78.375 47.625 -80.875 C 49.792969 -83.292969 51.75 -85.917969 53.5 -88.75 C 55.25 -91.582031 56.75 -94.5 58 -97.5 C 59.167969 -100.582031 60.082031 -103.667969 60.75 -106.75 C 60.917969 -107.5 61.292969 -108.125 61.875 -108.625 C 62.457031 -109.125 63.125 -109.375 63.875 -109.375 Z M 63.875 -95.125 C 61.792969 -90.042969 59.105469 -85.269531 55.8125 -80.8125 C 52.519531 -76.355469 48.792969 -72.457031 44.625 -69.125 C 39.542969 -65.125 35.8125 -60.855469 33.4375 -56.3125 C 31.0625 -51.769531 29.875 -47.125 29.875 -42.375 C 29.875 -37.875 30.730469 -33.542969 32.4375 -29.375 C 34.144531 -25.207031 36.582031 -21.542969 39.75 -18.375 C 43 -15.207031 46.707031 -12.75 50.875 -11 C 55.042969 -9.25 59.375 -8.375 63.875 -8.375 C 68.375 -8.375 72.707031 -9.25 76.875 -11 C 81.042969 -12.75 84.707031 -15.207031 87.875 -18.375 C 91.042969 -21.542969 93.5 -25.207031 95.25 -29.375 C 97 -33.542969 97.875 -37.875 97.875 -42.375 C 97.875 -47.125 96.667969 -51.769531 94.25 -56.3125 C 91.832031 -60.855469 88.125 -65.125 83.125 -69.125 C 78.957031 -72.457031 75.207031 -76.355469 71.875 -80.8125 C 68.542969 -85.269531 65.875 -90.042969 63.875 -95.125 Z M 41.625 -45.5 C 42.542969 -45.75 43.375 -45.644531 44.125 -45.1875 C 44.875 -44.730469 45.332031 -44.082031 45.5 -43.25 C 46.25 -40.417969 47.0625 -37.8125 47.9375 -35.4375 C 48.8125 -33.0625 50.082031 -30.957031 51.75 -29.125 C 53.25 -27.292969 55.332031 -25.707031 58 -24.375 C 60.667969 -23.042969 64.332031 -22.125 69 -21.625 C 69.832031 -21.542969 70.542969 -21.144531 71.125 -20.4375 C 71.707031 -19.730469 71.917969 -18.957031 71.75 -18.125 C 71.667969 -17.207031 71.292969 -16.480469 70.625 -15.9375 C 69.957031 -15.394531 69.167969 -15.167969 68.25 -15.25 C 63.082031 -15.832031 58.769531 -16.957031 55.3125 -18.625 C 51.855469 -20.292969 49.042969 -22.375 46.875 -24.875 C 44.707031 -27.375 43.105469 -30.082031 42.0625 -33 C 41.019531 -35.917969 40.125 -38.792969 39.375 -41.625 C 39.125 -42.457031 39.230469 -43.25 39.6875 -44 C 40.144531 -44.75 40.792969 -45.25 41.625 -45.5 Z M 41.625 -45.5',
    flush: 'M 33.25 -71.25 L 33.25 -84.375 C 33.25 -89.457031 35.042969 -93.792969 38.625 -97.375 C 42.207031 -100.957031 46.542969 -102.75 51.625 -102.75 L 76.25 -102.75 C 81.332031 -102.75 85.644531 -100.957031 89.1875 -97.375 C 92.730469 -93.792969 94.5 -89.457031 94.5 -84.375 L 94.5 -71.25 Z M 100.125 -65.75 L 100.125 -84.375 C 100.125 -90.957031 97.792969 -96.582031 93.125 -101.25 C 88.457031 -105.917969 82.832031 -108.25 76.25 -108.25 L 51.625 -108.25 C 45.042969 -108.25 39.417969 -105.917969 34.75 -101.25 C 30.082031 -96.582031 27.75 -90.957031 27.75 -84.375 L 27.75 -65.75 Z M 27.75 -54.375 C 27.75 -55.125 28.019531 -55.769531 28.5625 -56.3125 C 29.105469 -56.855469 29.792969 -57.125 30.625 -57.125 L 98.75 -57.125 C 99.5 -57.125 100.144531 -56.855469 100.6875 -56.3125 C 101.230469 -55.769531 101.5 -55.125 101.5 -54.375 C 101.5 -53.625 101.230469 -52.957031 100.6875 -52.375 C 100.144531 -51.792969 99.5 -51.5 98.75 -51.5 L 30.625 -51.5 C 29.792969 -51.5 29.105469 -51.792969 28.5625 -52.375 C 28.019531 -52.957031 27.75 -53.625 27.75 -54.375 Z M 63.875 -45.75 C 64.542969 -45.75 65.144531 -45.542969 65.6875 -45.125 C 66.230469 -44.707031 66.542969 -44.167969 66.625 -43.5 C 67.125 -41.25 68.042969 -39.0625 69.375 -36.9375 C 70.707031 -34.8125 72.292969 -33.042969 74.125 -31.625 C 76.542969 -29.707031 78.394531 -27.605469 79.6875 -25.3125 C 80.980469 -23.019531 81.625 -20.542969 81.625 -17.875 C 81.625 -15.542969 81.167969 -13.3125 80.25 -11.1875 C 79.332031 -9.0625 78.042969 -7.167969 76.375 -5.5 C 74.707031 -3.917969 72.792969 -2.6875 70.625 -1.8125 C 68.457031 -0.9375 66.207031 -0.5 63.875 -0.5 C 61.542969 -0.5 59.292969 -0.9375 57.125 -1.8125 C 54.957031 -2.6875 53.042969 -3.917969 51.375 -5.5 C 49.792969 -7.167969 48.542969 -9.0625 47.625 -11.1875 C 46.707031 -13.3125 46.25 -15.542969 46.25 -17.875 C 46.25 -20.542969 46.894531 -23.019531 48.1875 -25.3125 C 49.480469 -27.605469 51.292969 -29.707031 53.625 -31.625 C 55.542969 -33.042969 57.167969 -34.8125 58.5 -36.9375 C 59.832031 -39.0625 60.75 -41.25 61.25 -43.5 C 61.332031 -44.167969 61.625 -44.707031 62.125 -45.125 C 62.625 -45.542969 63.207031 -45.75 63.875 -45.75 Z M 63.875 -35.125 C 63.042969 -33.625 62.042969 -32.207031 60.875 -30.875 C 59.707031 -29.542969 58.457031 -28.332031 57.125 -27.25 C 55.207031 -25.75 53.832031 -24.207031 53 -22.625 C 52.167969 -21.042969 51.75 -19.457031 51.75 -17.875 C 51.75 -16.292969 52.0625 -14.792969 52.6875 -13.375 C 53.3125 -11.957031 54.207031 -10.667969 55.375 -9.5 C 56.457031 -8.417969 57.75 -7.5625 59.25 -6.9375 C 60.75 -6.3125 62.292969 -6 63.875 -6 C 65.542969 -6 67.105469 -6.3125 68.5625 -6.9375 C 70.019531 -7.5625 71.332031 -8.417969 72.5 -9.5 C 73.667969 -10.667969 74.542969 -11.957031 75.125 -13.375 C 75.707031 -14.792969 76 -16.292969 76 -17.875 C 76 -19.457031 75.582031 -21.042969 74.75 -22.625 C 73.917969 -24.207031 72.582031 -25.75 70.75 -27.25 C 69.332031 -28.332031 68.0625 -29.542969 66.9375 -30.875 C 65.8125 -32.207031 64.792969 -33.625 63.875 -35.125 Z M 63.875 -35.125'
  };
  return `
    <svg class="machine-graphic-streamline" viewBox="0 0 160 160" role="img" aria-label="${toneLabel(tone)}">
      <g transform="translate(16 136)">
        <path d="${streamlineGlyphs[tone]}" />
      </g>
    </svg>
  `;
}

function toneLabel(tone: MachineViewTone): string {
  if (tone === 'water') return 'Water';
  if (tone === 'flush') return 'Flush';
  return 'Steam';
}

export function machineValueTile(name: string, label: string, value: number | undefined, spec: NumberSpec): MachineValueTile {
  return {
    name,
    label,
    value: formatMachineValue(value),
    unit: spec.enabled ? spec.unit : 'Unavailable',
    spec,
    disabled: !spec.enabled
  };
}

export function machineHotWaterStopModeTile(mode: HotWaterStopMode, scaleIsConnected: boolean): MachineValueTile {
  const nextMode: HotWaterStopMode = mode === 'time' ? 'volume' : 'time';
  return {
    label: 'Stop by',
    value: mode === 'time' ? 'Time' : scaleIsConnected ? 'Weight' : 'Volume',
    unit: mode === 'time'
      ? 'Timer'
      : scaleIsConnected
        ? 'Scale'
        : 'Machine',
    action: 'machine-water-stop-mode',
    actionValue: nextMode
  };
}

export function hotWaterTargetSpec(spec: NumberSpec, scaleIsConnected: boolean): NumberSpec {
  return scaleIsConnected
    ? { ...spec, unit: 'g', reason: undefined }
    : spec;
}

export function machineSteamPurgeTile(mode: number | null | undefined): MachineValueTile {
  const currentMode = normalizeSteamPurgeMode(mode);
  const nextMode = currentMode === 0 ? 1 : 0;
  return {
    name: 'steamPurgeMode',
    label: 'Purge',
    value: steamPurgeModeLabel(currentMode),
    unit: currentMode === 0 ? 'On stop' : 'Second tap',
    action: 'machine-steam-purge-mode',
    actionValue: String(nextMode)
  };
}

function machinePresetLabelKey(name: string, presetId: string): string {
  return `${name}:${presetId}`;
}

function presetLabel(
  name: string,
  preset: MachinePresetOption,
  labelOverrides: Record<string, string>
): string {
  return labelOverrides[machinePresetLabelKey(name, preset.id)] ?? preset.label;
}

function normalizeSteamPurgeMode(mode: number | null | undefined): number {
  if (mode === 0 || mode === 1) return mode;
  return 0;
}

function steamPurgeModeLabel(mode: number): string {
  return STEAM_PURGE_MODES.find((option) => option.value === mode)?.label ?? STEAM_PURGE_MODES[0]!.label;
}

function formatMachineValue(value: number | undefined): string {
  if (value == null || !Number.isFinite(value)) return '';
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}
