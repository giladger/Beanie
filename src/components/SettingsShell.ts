import type {
  SettingsPreferences,
  SettingsShellModel,
  ThemePreference,
  UIScalePreference
} from '../domain/settings';
import { icon } from './icons';

interface SettingsSection {
  id: string;
  title: string;
  terms: string;
  html: string;
}

export function renderSettingsShell(model: SettingsShellModel): string {
  const query = model.query.trim().toLowerCase();
  const sections = settingsSections(model);
  const visibleSections = query
    ? sections.filter((section) => `${section.title} ${section.terms}`.toLowerCase().includes(query))
    : sections;

  return `
    <div class="modal-backdrop">
      <div class="settings-shell panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div class="modal-head settings-shell-head">
          <div>
            <span class="eyebrow">Skin</span>
            <h2 id="settings-title">Settings</h2>
          </div>
          <button type="button" class="icon-button" data-action="close-modal" aria-label="Close" title="Close">${icon('x')}</button>
        </div>
        <label class="settings-search">
          ${icon('search')}
          <input type="search" data-action="settings-search" value="${escapeAttr(model.query)}" placeholder="Search settings" />
        </label>
        <div class="settings-shell-content">
          ${visibleSections.length === 0 ? '<p class="settings-empty">No settings match.</p>' : visibleSections.map((section) => section.html).join('')}
        </div>
        <div class="settings-shell-actions">
          <button type="button" class="command" data-action="refresh">${icon('refresh-cw')}<span>Sync</span></button>
          <button type="button" class="command primary" data-action="close-modal">Done</button>
        </div>
      </div>
    </div>
  `;
}

function settingsSections(model: SettingsShellModel): SettingsSection[] {
  return [
    {
      id: 'gateway',
      title: 'Gateway',
      terms: 'status host machine scale decent app demo connected',
      html: renderSection('Gateway', renderGatewayRows(model))
    },
    {
      id: 'appearance',
      title: 'Appearance',
      terms: 'theme ui scale display compact standard large light dark',
      html: renderSection('Appearance', renderAppearanceRows(model.preferences))
    },
    {
      id: 'workflow',
      title: 'Workflow',
      terms: 'auto load bean change workflow recipe',
      html: renderSection('Workflow', renderWorkflowRows(model.preferences))
    },
    {
      id: 'data',
      title: 'Demo And Cache',
      terms: 'demo cache reset local data presets recent values',
      html: renderSection('Demo And Cache', renderDataRows(model))
    },
    {
      id: 'about',
      title: 'About',
      terms: 'version build commit default skin about',
      html: renderSection('About', renderAboutRows(model))
    }
  ];
}

function renderGatewayRows(model: SettingsShellModel): string {
  return `
    ${settingReadout('Gateway status', model.gateway.label, model.gateway.detail, model.gateway.tone)}
    ${settingReadout('Host', model.gateway.host || 'Current origin', 'Resolved ReaPrime gateway origin', 'muted')}
    ${settingReadout('Machine', model.gateway.machine, 'Latest machine WebSocket snapshot', 'muted')}
    ${settingReadout('Scale', model.gateway.scale, 'Latest scale WebSocket snapshot', 'muted')}
  `;
}

function renderAppearanceRows(preferences: SettingsPreferences): string {
  return `
    ${settingControlRow(
      'Theme',
      'Skin color mode preference',
      segmentedControl('settings-theme', preferences.theme, [
        ['dark', 'Dark'],
        ['light', 'Light'],
        ['system', 'System']
      ] satisfies Array<[ThemePreference, string]>)
    )}
    ${settingControlRow(
      'UI scale',
      'Stored display density preference',
      segmentedControl('settings-ui-scale', preferences.uiScale, [
        ['compact', 'Compact'],
        ['standard', 'Standard'],
        ['large', 'Large']
      ] satisfies Array<[UIScalePreference, string]>)
    )}
  `;
}

function renderWorkflowRows(preferences: SettingsPreferences): string {
  return `
    ${settingControlRow(
      'Auto-load bean recipe',
      'Load the selected bean workflow on bean change',
      `<label class="settings-toggle"><input type="checkbox" data-field="autoLoad" ${preferences.autoLoad ? 'checked' : ''} /><span></span></label>`
    )}
    ${settingControlRow(
      'Visualizer upload',
      'Preference placeholder for the ReaPrime visualizer integration',
      `<label class="settings-toggle"><input type="checkbox" data-field="visualizerUpload" ${preferences.visualizerUpload ? 'checked' : ''} /><span></span></label>`
    )}
  `;
}

function renderDataRows(model: SettingsShellModel): string {
  const count = model.cacheKeyCount === 1 ? '1 local key' : `${model.cacheKeyCount} local keys`;
  return `
    ${settingReadout('Mode', model.gateway.label, model.gateway.detail, model.gateway.tone)}
    ${settingControlRow(
      'Demo/cache reset',
      `${count} can be cleared; theme, scale, and auto-load are kept`,
      `<button type="button" class="text-button" data-action="settings-reset-cache">${icon('rotate-ccw')}<span>Reset</span></button>`
    )}
  `;
}

function renderAboutRows(model: SettingsShellModel): string {
  return `
    ${settingReadout('Beanie version', model.version.version, `Commit ${model.version.gitCommit}`, 'muted')}
    ${settingReadout('Build time', model.version.buildTime, 'Generated by the Vite skin build', 'muted')}
    ${settingReadout('Default skin', model.version.defaultSkinStatus, 'ReaPrime skin status endpoint is not wired yet', 'muted')}
  `;
}

function renderSection(title: string, body: string): string {
  return `
    <section class="settings-section">
      <h3>${escapeHtml(title)}</h3>
      <div class="settings-section-rows">${body}</div>
    </section>
  `;
}

function settingReadout(
  label: string,
  value: string,
  detail: string,
  tone: 'good' | 'warn' | 'muted'
): string {
  return `
    <div class="settings-line">
      <div>
        <span>${escapeHtml(label)}</span>
        <small>${escapeHtml(detail)}</small>
      </div>
      <strong class="${tone}">${escapeHtml(value)}</strong>
    </div>
  `;
}

function settingControlRow(label: string, detail: string, control: string): string {
  return `
    <div class="settings-line">
      <div>
        <span>${escapeHtml(label)}</span>
        <small>${escapeHtml(detail)}</small>
      </div>
      ${control}
    </div>
  `;
}

function segmentedControl<T extends string>(
  action: string,
  activeValue: T,
  options: Array<[T, string]>
): string {
  return `
    <div class="settings-segmented" role="group">
      ${options.map(([value, label]) => `
        <button type="button" class="${activeValue === value ? 'active' : ''}" data-action="${escapeAttr(action)}" data-value="${escapeAttr(value)}" aria-pressed="${activeValue === value}">
          ${escapeHtml(label)}
        </button>
      `).join('')}
    </div>
  `;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}
