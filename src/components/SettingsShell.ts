import type {
  SettingsPreferences,
  SettingsShellModel,
  ThemePreference,
  UIScalePreference
} from '../domain/settings';
import {
  SETTINGS_SPEC,
  fieldValue,
  minutesToTime,
  type SettingsBundle,
  type SettingsField,
  type SettingsSpecSection
} from '../domain/settingsModel';
import { icon } from './icons';

interface SettingsSection {
  id: string;
  title: string;
  terms: string;
  html: string;
}

export function renderSettingsShell(
  model: SettingsShellModel,
  activeSection: string,
  bundle: SettingsBundle | null
): string {
  const sections = settingsSections(model, bundle);
  const active = sections.find((section) => section.id === activeSection) ?? sections[0]!;

  return `
    <main class="page-body settings-page">
      <nav class="settings-nav" aria-label="Settings sections">
        ${sections
          .map(
            (section) =>
              `<button type="button" class="settings-nav-btn ${section.id === active.id ? 'active' : ''}" data-action="settings-section" data-value="${escapeAttr(section.id)}" aria-pressed="${section.id === active.id}">${escapeHtml(section.title)}</button>`
          )
          .join('')}
      </nav>
      <section class="settings-detail">
        ${active.html}
      </section>
    </main>
  `;
}

function settingsSections(model: SettingsShellModel, bundle: SettingsBundle | null): SettingsSection[] {
  const sections: SettingsSection[] = [
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
    }
  ];
  // reaprime-backed sections (only when settings have loaded from the gateway/demo)
  if (bundle) {
    for (const spec of SETTINGS_SPEC) {
      sections.push({ id: spec.id, title: spec.title, terms: spec.terms, html: renderSpecSection(spec, bundle) });
    }
  }
  sections.push(
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
  );
  return sections;
}

function renderSpecSection(section: SettingsSpecSection, bundle: SettingsBundle): string {
  const rows = section.fields.map((field) => renderSettingsField(field, bundle)).join('');
  const extra = section.id === 'machine-advanced'
    ? settingControlRow(
        'Reset machine settings',
        'Restore DE1 fan, heater, refill, calibration, and purge defaults',
        `<button type="button" class="text-button" data-action="settings-reset-machine">${icon('rotate-ccw')}<span>Reset</span></button>`
      )
    : '';
  return renderSection(section.title, rows + extra);
}

function renderSettingsField(field: SettingsField, bundle: SettingsBundle): string {
  const value = fieldValue(bundle, field);
  const base = `data-action="settings-field" data-group="${field.group}" data-key="${escapeAttr(field.key)}" data-type="${field.type}"`;
  let control = '';
  if (field.type === 'toggle') {
    control = `<label class="settings-toggle"><input type="checkbox" ${base} ${value === true ? 'checked' : ''} /><span></span></label>`;
  } else if (field.type === 'select') {
    const current = String(value ?? '');
    control = `<select class="settings-select" ${base}>${(field.options ?? [])
      .map((o) => `<option value="${escapeAttr(o.value)}" ${o.value === current ? 'selected' : ''}>${escapeHtml(o.label)}</option>`)
      .join('')}</select>`;
  } else if (field.type === 'time') {
    control = `<input class="settings-input" type="time" ${base} value="${minutesToTime(typeof value === 'number' ? value : null)}" />`;
  } else {
    const num = typeof value === 'number' ? String(value) : '';
    const unit = field.unit ? `<span class="settings-unit">${escapeHtml(field.unit)}</span>` : '';
    const bounds = [
      field.min != null ? `min="${field.min}"` : '',
      field.max != null ? `max="${field.max}"` : '',
      field.step != null ? `step="${field.step}"` : ''
    ].join(' ');
    control = `<span class="settings-number"><input class="settings-input" type="number" ${base} ${bounds} value="${escapeAttr(num)}" />${unit}</span>`;
  }
  return settingControlRow(field.label, field.help ?? '', control);
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
