import {
  WAKE_APP_ZONE_POSITIONS,
  type ClockFormat,
  type SettingsPreferences,
  type SettingsShellModel,
  type ThemePreference,
  type UIScalePreference,
  type WakeAppZonePosition
} from '../domain/settings';
import {
  SETTINGS_SPEC,
  fieldValue,
  minutesToTime,
  type SettingsBundle,
  type SettingsField,
  type SettingsSpecSection
} from '../domain/settingsModel';
import {
  pluginSettingsSpec,
  type PluginConfigState,
  type PluginSettingField,
  type PluginSettingsSpec
} from '../domain/pluginSettings';
import {
  MACHINE_REFILL_MAX_MM,
  MACHINE_REFILL_MIN_MM,
  MACHINE_REFILL_STEP_MM,
  WATER_SOFT_MAX_ML,
  WATER_SOFT_MIN_ML,
  WATER_SOFT_STEP_ML,
  waterLevelMl
} from '../domain/waterAlert';
import { MAX_SCREENSAVER_PHOTOS, screensaverShowsPhotos, type ScreensaverMode } from '../domain/screensaver';
import type { PluginInfo } from '../api/settings';
import type { DecentAccountStatus } from '../api/settings';
import { escapeAttr, escapeHtml } from './html';
import { icon } from './icons';

interface SettingsSection {
  id: string;
  title: string;
  terms: string;
  html: string;
}

// The resolved flow calibration for the active profile, surfaced read-only in
// Settings → Brew so it always reflects the value the active profile applies.
export interface FlowCalibrationDisplay {
  value: number;
  origin: 'default' | 'profile';
  profileTitle: string | null;
}

interface SettingsRenderOptions {
  phone?: boolean;
  flowCalibration?: FlowCalibrationDisplay;
}

export interface DecentAccountPanelState {
  status: DecentAccountStatus | null;
  source: 'loading' | 'gateway' | 'demo' | 'unavailable' | null;
  emailDraft: string;
  passwordDraft: string;
  saving: boolean;
  message: { tone: 'good' | 'warn' | 'muted'; text: string } | null;
}

export function renderSettingsShell(
  model: SettingsShellModel,
  activeSection: string,
  bundle: SettingsBundle | null,
  pluginConfig: PluginConfigState | null,
  decentAccount: DecentAccountPanelState,
  allowedSectionIds?: string[],
  options: SettingsRenderOptions = {}
): string {
  const allSections = settingsSections(model, bundle, pluginConfig, decentAccount, options);
  const sections = allowedSectionIds?.length
    ? allSections.filter((section) => allowedSectionIds.includes(section.id))
    : allSections;
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

function settingsSections(
  model: SettingsShellModel,
  bundle: SettingsBundle | null,
  pluginConfig: PluginConfigState | null,
  decentAccount: DecentAccountPanelState,
  options: SettingsRenderOptions
): SettingsSection[] {
  const connectionSection: SettingsSection = {
    id: 'connection',
    title: 'Connection',
    terms: 'status host gateway devices bluetooth machine scale connect control',
    html: [
      renderSection('Status', renderGatewayRows(model)),
      bundle ? renderConnectionRuntimeSection(bundle) : '',
      bundle ? renderDevicesSection(bundle) : '',
      bundle ? renderSpecSectionById('connection-policy', bundle, options) : ''
    ].join('')
  };
  const sections: SettingsSection[] = [
    {
      id: 'app',
      title: 'App',
      terms: 'appearance theme ui skin update diagnostics about version brightness screen display sleep wake tap zone area machine asleep screensaver saver clock photos slideshow',
      html: [
        renderSection('Beanie display', renderAppearanceRows(model.preferences)),
        renderSection('Sleep screen', renderSleepScreenRows(model)),
        renderSection('Bean scanner', renderScannerKeyRows()),
        bundle ? renderDisplayRuntimeSection(bundle, options) : '',
        bundle ? renderSpecSectionById('app-skin', bundle, options) : '',
        renderSection('About', renderAboutRows(model))
      ].join('')
    }
  ];
  // Decent.app-backed settings only render after the gateway/demo bundle loads.
  if (bundle) {
    sections.push(
      {
        id: 'brew',
        title: 'Brew',
        terms: 'shot stopping weight yield volume stop scale target',
        html: renderSpecSectionById('shot-stopping', bundle, options)
      },
      {
        id: 'machine',
        title: 'Machine',
        terms: 'descale sleep routine defaults water level low tank refill warning alert steam flush clean flow calibration',
        html: [
          renderPhoneMachineLinks(options),
          renderMaintenanceSection(),
          renderSection('Water level alerts', renderWaterAlertRows(model, options))
        ].join('')
      },
      {
        id: 'power',
        title: 'Power',
        terms: 'sleep wake charging night battery presence usb scale power',
        html: [
          renderPowerRuntimeSection(bundle),
          renderSpecSectionById('power', bundle, options)
        ].join('')
      },
      {
        id: 'account',
        title: 'Account',
        terms: 'decent account login email password credentials link unlink serial',
        html: renderDecentAccountSection(decentAccount)
      },
      {
        id: 'plugins',
        title: 'Plugins',
        terms: 'plugins visualizer extensions enable disable configure credentials',
        html: renderPluginsSection(bundle, pluginConfig, options)
      },
      connectionSection,
      {
        id: 'danger',
        title: 'Danger',
        terms: 'danger advanced heater voltage refill kit firmware reset cache',
        html: [
          renderSpecSectionById('danger-zone', bundle, options),
          renderSection('Local data', renderCacheResetRows(model), 'danger')
        ].join('')
      }
    );
  } else {
    sections.push(connectionSection);
  }
  return sections;
}

function renderSpecSectionById(id: string, bundle: SettingsBundle, options: SettingsRenderOptions = {}): string {
  const section = SETTINGS_SPEC.find((spec) => spec.id === id);
  return section ? renderSpecSection(section, bundle, options) : '';
}

function renderSpecSection(section: SettingsSpecSection, bundle: SettingsBundle, options: SettingsRenderOptions = {}): string {
  const rows = section.fields.map((field) => renderSettingsField(field, bundle, options)).join('');
  let extra = '';
  if (section.id === 'danger-zone') {
    extra = renderDangerActions();
  } else if (section.id === 'power') {
    extra = renderWakeSchedules(bundle);
  }
  return renderSection(section.title, rows + extra, section.tone);
}

function renderDevicesSection(bundle: SettingsBundle): string {
  const scan = settingControlRow(
    'Bluetooth devices',
    'Scan only, or let Decent.app connect preferred devices',
    `<div class="settings-inline-actions">
      <button type="button" class="text-button" data-action="settings-scan-devices">${icon('refresh-cw')}<span>Scan</span></button>
      <button type="button" class="text-button primary" data-action="settings-connect-preferred-devices">${icon('scale')}<span>Auto-connect</span></button>
    </div>`
  );
  const preferred = `
    ${settingReadout('Preferred machine', compactId(bundle.rea.preferredMachineId), 'Used for automatic machine reconnect', 'muted')}
    ${settingReadout('Preferred scale', compactId(bundle.rea.preferredScaleId), 'Used for automatic scale reconnect', 'muted')}
  `;
  const rows = bundle.devices.length
    ? bundle.devices.map(renderDeviceRow).join('')
    : `<p class="settings-empty">No devices found yet — tap Scan to search.</p>`;
  return renderSection('Devices', scan + preferred + rows);
}

function renderConnectionRuntimeSection(bundle: SettingsBundle): string {
  const simulated = bundle.rea.simulatedDevices.length ? bundle.rea.simulatedDevices.join(', ') : 'None';
  return renderSection('Runtime', settingReadout('Simulated devices', simulated, 'Simulator devices reported by Decent.app', 'muted'));
}

function renderPowerRuntimeSection(bundle: SettingsBundle): string {
  const state = bundle.rea.chargingState;
  if (!state) return '';
  const battery = typeof state.batteryPercent === 'number' ? `${Math.round(state.batteryPercent)}%` : 'Unknown';
  const mode = typeof state.mode === 'string' ? state.mode : 'unknown mode';
  const phase = typeof state.currentPhase === 'string' ? state.currentPhase : 'unknown phase';
  const usb = typeof state.usbChargerOn === 'boolean' ? (state.usbChargerOn ? 'charger on' : 'charger off') : 'charger unknown';
  return renderSection('Battery state', settingReadout('Battery', battery, `${mode} · ${phase} · ${usb}`, 'muted'));
}

function renderDisplayRuntimeSection(bundle: SettingsBundle, options: SettingsRenderOptions = {}): string {
  const display = bundle.display;
  const supported = display.platformSupported.brightness;
  const requested = String(display.requestedBrightness);
  const detail = supported
    ? display.lowBatteryBrightnessActive
      ? `Actual ${display.brightness}% · low battery cap`
      : `Actual ${display.brightness}% · 100 = auto`
    : 'Brightness control is not available on this host';
  const control = options.phone
    ? phoneNumberInput({
        action: 'settings-display-brightness',
        value: requested,
        min: 0,
        max: 100,
        step: 5,
        unit: '%',
        disabled: !supported
      })
    : `
      <button
        type="button"
        class="settings-input number-edit-button settings-number-button"
        data-action="open-number-edit"
        data-target="display-brightness"
        data-title="Screen brightness"
        data-value="${escapeAttr(requested)}"
        data-min="0"
        data-max="100"
        data-step="5"
        data-unit="%"
        ${supported ? '' : 'disabled'}
      >
        <span>${escapeHtml(requested)}</span><em class="settings-unit">%</em>
      </button>`;
  return renderSection('Display', settingControlRow('Screen brightness', detail, control));
}

function compactId(value: string | null): string {
  if (!value) return 'None';
  return value.length > 18 ? `...${value.slice(-15)}` : value;
}

function renderDeviceRow(device: SettingsBundle['devices'][number]): string {
  const connected = device.state === 'connected';
  const action = connected ? 'settings-disconnect-device' : 'settings-connect-device';
  const label = connected ? 'Disconnect' : 'Connect';
  return settingControlRow(
    device.name,
    `${device.type} · ${connected ? 'connected' : 'available'}`,
    `<button type="button" class="text-button ${connected ? '' : 'primary'}" data-action="${action}" data-id="${escapeAttr(device.id)}">${escapeHtml(label)}</button>`
  );
}

// On phone there is no top bar, so the Steam·Water·Flush page (which also hosts the
// cleaning wizard) and the flow calibrator are otherwise unreachable. Surface them as
// links inside the Machine settings section. Hidden on tablet, where the top bar wins.
function renderPhoneMachineLinks(options: SettingsRenderOptions): string {
  if (!options.phone) return '';
  return renderSection('Machine controls', [
    settingControlRow(
      'Steam · Water · Flush',
      'Steam, hot water, flush controls and cleaning',
      `<button type="button" class="text-button primary" data-action="open-machine-settings">${icon('droplet')}<span>Open</span></button>`
    ),
    settingControlRow(
      'Flow calibration',
      'Calibrate machine flow against a scale',
      `<button type="button" class="text-button" data-action="open-flow-calibrator">${icon('scale')}<span>Open</span></button>`
    )
  ].join(''));
}

function renderMaintenanceSection(): string {
  const stateBtn = (state: string, label: string): string =>
    `<button type="button" class="text-button" data-action="settings-machine-state" data-value="${state}">${escapeHtml(label)}</button>`;
  return renderSection('Maintenance', [
    settingControlRow('Descale', 'Run the descaling cycle on the machine', stateBtn('descaling', 'Start descale')),
    settingControlRow('Sleep', 'Put the machine to sleep', stateBtn('sleeping', 'Sleep'))
  ].join(''));
}

function renderDecentAccountSection(account: DecentAccountPanelState): string {
  const status = account.status;
  const loggedIn = status?.loggedIn === true;
  const message = account.message
    ? `<span class="settings-plugin-verify ${account.message.tone}">${escapeHtml(account.message.text)}</span>`
    : '';
  const unavailable = account.source === 'unavailable'
    ? `<span class="settings-plugin-verify warn">Decent account login is not available from this gateway.</span>`
    : '';
  const statusRow = loggedIn
    ? settingReadout(
        'Status',
        status.email ? `Linked as ${status.email}` : 'Linked',
        'Decent Espresso account is linked on this tablet.',
        'good'
      )
    : settingReadout(
        'Status',
        account.source === 'loading' ? 'Loading' : 'Not linked',
        'Link your Decent Espresso account for account-backed machine checks.',
        account.source === 'loading' ? 'muted' : 'warn'
      );
  const refreshButton = `<button type="button" class="text-button" data-action="settings-account-refresh" ${account.saving || account.source === 'loading' ? 'disabled' : ''}>${icon('refresh-cw')}<span>Refresh</span></button>`;
  const form = loggedIn
    ? `
      <div class="settings-line">
        <div><span>Decent Account</span><small>Remove the linked account from this tablet.</small></div>
        <span class="settings-plugin-buttons">
          ${refreshButton}
          <button type="button" class="text-button danger" data-action="settings-account-logout" ${account.saving ? 'disabled' : ''}>${icon('log-out')}<span>${account.saving ? 'Unlinking...' : 'Unlink'}</span></button>
        </span>
      </div>
      ${message}`
    : `
      <div class="settings-line">
        <div><span>Email</span><small>Decent Espresso account email.</small></div>
        <input class="settings-input settings-plugin-text" type="email" data-action="settings-account-field" data-key="email" value="${escapeAttr(account.emailDraft)}" autocomplete="username" spellcheck="false" />
      </div>
      <div class="settings-line">
        <div><span>Password</span><small>Sent to the gateway for secure account linking.</small></div>
        <input class="settings-input settings-plugin-text" type="password" data-action="settings-account-field" data-key="password" value="${escapeAttr(account.passwordDraft)}" autocomplete="current-password" spellcheck="false" />
      </div>
      <div class="settings-plugin-config-actions">
        ${message || unavailable}
        <span class="settings-plugin-buttons">
          ${refreshButton}
          <button type="button" class="text-button primary" data-action="settings-account-login" ${account.saving || account.source === 'loading' ? 'disabled' : ''}>${icon('log-in')}<span>${account.saving ? 'Linking...' : 'Link'}</span></button>
        </span>
      </div>`;
  return renderSection('Decent Account', `${statusRow}${form}`);
}

function renderDangerActions(): string {
  return `
    <div class="settings-subsection settings-danger-actions">
      ${settingControlRow(
        'Firmware update',
        'Upload a DE1 firmware file and let the machine apply it',
        `<label class="text-button danger"><input type="file" accept=".bin,.fw,.dfu" data-action="settings-firmware" hidden />${icon('upload')}<span>Upload…</span></label>`
      )}
      ${settingControlRow(
        'Reset machine settings',
        'Restore DE1 fan, heater, refill, calibration, and purge defaults',
        `<button type="button" class="text-button danger" data-action="settings-reset-machine">${icon('rotate-ccw')}<span>Reset</span></button>`
      )}
    </div>`;
}

function renderPluginsSection(bundle: SettingsBundle, pluginConfig: PluginConfigState | null, options: SettingsRenderOptions = {}): string {
  if (!bundle.plugins.length) return renderSection('Plugins', `<p class="settings-empty">No plugins installed.</p>`);
  const rows = bundle.plugins.map((plugin) => renderPluginRow(plugin, pluginConfig, options)).join('');
  return renderSection('Plugins', rows);
}

function renderPluginRow(plugin: PluginInfo, pluginConfig: PluginConfigState | null, options: SettingsRenderOptions = {}): string {
  const spec = pluginSettingsSpec(plugin.id);
  const expanded = pluginConfig?.id === plugin.id;
  const configure = spec
    ? `<button type="button" class="text-button" data-action="settings-plugin-config" data-id="${escapeAttr(plugin.id)}" aria-expanded="${expanded}">${icon(expanded ? 'x' : 'sliders-horizontal')}<span>${expanded ? 'Close' : 'Configure'}</span></button>`
    : '';
  const toggle = `<label class="settings-toggle"><input type="checkbox" data-action="settings-plugin-toggle" data-id="${escapeAttr(plugin.id)}" ${plugin.loaded ? 'checked' : ''} /><span></span></label>`;
  const row = `
    <div class="settings-line">
      <div>
        <span>${escapeHtml(plugin.name)}</span>
        <small>${escapeHtml([plugin.author, plugin.version ? `v${plugin.version}` : ''].filter(Boolean).join(' · '))}</small>
      </div>
      <span class="settings-plugin-actions">${configure}${toggle}</span>
    </div>`;
  const panel = expanded && spec && pluginConfig ? renderPluginConfig(spec, pluginConfig, options) : '';
  return row + panel;
}

function renderPluginConfig(spec: PluginSettingsSpec, config: PluginConfigState, options: SettingsRenderOptions = {}): string {
  const help = spec.help ? `<p class="settings-plugin-help">${escapeHtml(spec.help)}</p>` : '';
  const fields = spec.fields.map((field) => renderPluginField(field, config, options)).join('');
  const verifyMsg = config.verify
    ? `<span class="settings-plugin-verify ${config.verify.tone}">${escapeHtml(config.verify.message)}</span>`
    : '';
  const verifyBtn = spec.supportsVerify
    ? `<button type="button" class="text-button" data-action="settings-plugin-verify" data-id="${escapeAttr(config.id)}">${icon('refresh-cw')}<span>Verify</span></button>`
    : '';
  const saveDisabled = config.dirty && !config.saving ? '' : 'disabled';
  const saveBtn = `<button type="button" class="text-button primary" data-action="settings-plugin-save" data-id="${escapeAttr(config.id)}" ${saveDisabled}>${icon('save')}<span>${config.saving ? 'Saving…' : 'Save'}</span></button>`;
  return `
    <div class="settings-plugin-config">
      ${help}
      <div class="settings-plugin-fields">${fields}</div>
      <div class="settings-plugin-config-actions">
        ${verifyMsg}
        <span class="settings-plugin-buttons">${verifyBtn}${saveBtn}</span>
      </div>
    </div>`;
}

function renderPluginField(field: PluginSettingField, config: PluginConfigState, options: SettingsRenderOptions = {}): string {
  const base = `data-action="settings-plugin-field" data-key="${escapeAttr(field.key)}" data-type="${field.type}"`;
  const draftVal = config.draft[field.key];
  let control: string;
  if (field.type === 'toggle') {
    control = `<label class="settings-toggle"><input type="checkbox" ${base} ${draftVal === true ? 'checked' : ''} /><span></span></label>`;
  } else if (field.type === 'select') {
    const current = String(draftVal ?? '');
    control = `<select class="settings-select" ${base}>${(field.options ?? [])
      .map((o) => `<option value="${escapeAttr(o.value)}" ${o.value === current ? 'selected' : ''}>${escapeHtml(o.label)}</option>`)
      .join('')}</select>`;
  } else if (field.type === 'number') {
    const unit = field.unit ? `<em class="settings-unit">${escapeHtml(field.unit)}</em>` : '';
    const value = String(draftVal ?? '');
    control = options.phone
      ? phoneNumberInput({
          action: 'settings-plugin-field',
          value,
          min: field.min ?? 0,
          max: field.max ?? 9999,
          step: field.step ?? 1,
          unit: field.unit ?? '',
          attrs: `data-key="${escapeAttr(field.key)}" data-type="${field.type}"`
        })
      : `<button type="button" class="settings-input number-edit-button settings-number-button" data-action="open-number-edit" data-target="settings-plugin-field" data-key="${escapeAttr(field.key)}" data-title="${escapeAttr(field.label)}" data-value="${escapeAttr(value)}" data-min="${field.min ?? 0}" data-max="${field.max ?? 9999}" data-step="${field.step ?? 1}" data-unit="${escapeAttr(field.unit ?? '')}"><span>${escapeHtml(value || '--')}</span>${unit}</button>`;
  } else {
    // text / password
    const inputType = field.type === 'password' ? 'password' : 'text';
    const savedValue = config.settings.values[field.key];
    const isSet = field.secret
      ? config.settings.secretsSet[field.key] === true || (savedValue != null && String(savedValue) !== '')
      : false;
    const placeholder = field.secret
      ? isSet
        ? '•••••••• (saved)'
        : 'Not set'
      : field.placeholder ?? '';
    // Secret fields render blank after save; while editing, keep the draft visible
    // so a re-render does not wipe the user's typed password.
    const val = field.secret
      ? config.secretEdited[field.key]
        ? escapeAttr(String(draftVal ?? ''))
        : ''
      : escapeAttr(String(draftVal ?? ''));
    control = `<input class="settings-input settings-plugin-text" type="${inputType}" ${base} value="${val}" placeholder="${escapeAttr(placeholder)}" autocomplete="off" spellcheck="false" />`;
  }
  const help = field.help ? `<small>${escapeHtml(field.help)}</small>` : '';
  return `
    <div class="settings-line">
      <div>
        <span>${escapeHtml(field.label)}</span>
        ${help}
      </div>
      ${control}
    </div>`;
}

function renderWakeSchedules(bundle: SettingsBundle): string {
  const dayNames = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const fmtDays = (days: number[]): string => (days.length === 0 ? 'Every day' : days.map((d) => dayNames[d] ?? '').join(' '));
  const rows = bundle.schedules
    .map(
      (schedule) => `
        <div class="settings-line">
          <div>
            <span>${escapeHtml(schedule.time)}</span>
            <small>${escapeHtml(fmtDays(schedule.daysOfWeek))}${schedule.keepAwakeFor ? ` · keep awake ${schedule.keepAwakeFor}m` : ''}</small>
          </div>
          <span class="settings-schedule-actions">
            <label class="settings-toggle"><input type="checkbox" data-action="settings-schedule-toggle" data-id="${escapeAttr(schedule.id)}" ${schedule.enabled ? 'checked' : ''} /><span></span></label>
            <button type="button" class="text-button" data-action="settings-schedule-delete" data-id="${escapeAttr(schedule.id)}" aria-label="Delete schedule">${icon('x')}</button>
          </span>
        </div>`
    )
    .join('');
  const add = `
    <div class="settings-line">
      <div><span>Add wake schedule</span><small>Wakes daily at the chosen time</small></div>
      <span class="settings-schedule-add">
        <input class="settings-input" type="time" data-action="settings-schedule-time" value="06:30" />
        <button type="button" class="text-button primary" data-action="settings-schedule-add">${icon('plus')}<span>Add</span></button>
      </span>
    </div>`;
  return `<div class="settings-subsection"><h4>Wake schedules</h4>${rows}${add}</div>`;
}

function renderSettingsField(field: SettingsField, bundle: SettingsBundle, options: SettingsRenderOptions = {}): string {
  const value = fieldValue(bundle, field);
  const base = `data-action="settings-field" data-group="${field.group}" data-key="${escapeAttr(field.key)}" data-type="${field.type}"`;
  let control = '';
  if (field.type === 'toggle') {
    control = `<label class="settings-toggle"><input type="checkbox" ${base} ${value === true ? 'checked' : ''} /><span></span></label>`;
  } else if (field.type === 'select') {
    const current = String(value ?? '');
    const options = field.optionsFrom === 'skins'
      ? bundle.skins.map((skin) => ({ value: skin.id, label: skin.name }))
      : (field.options ?? []);
    const hasCurrent = options.some((option) => option.value === current);
    const unknown = !hasCurrent && field.unknownLabel && current !== ''
      ? `<option value="${escapeAttr(current)}" selected disabled>${escapeHtml(field.unknownLabel)}</option>`
      : '';
    control = `<select class="settings-select" ${base}>${unknown}${options
      .map((o) => `<option value="${escapeAttr(o.value)}" ${o.value === current ? 'selected' : ''}>${escapeHtml(o.label)}</option>`)
      .join('')}</select>`;
  } else if (field.type === 'time') {
    control = `<input class="settings-input" type="time" ${base} value="${minutesToTime(typeof value === 'number' ? value : null)}" />`;
  } else {
    const num =
      typeof value === 'number'
        ? field.decimals != null
          ? value.toFixed(field.decimals)
          : String(value)
        : '';
    const unit = field.unit ? `<em class="settings-unit">${escapeHtml(field.unit)}</em>` : '';
    control = options.phone
      ? phoneNumberInput({
          action: 'settings-field',
          value: num,
          min: field.min ?? 0,
          max: field.max ?? 9999,
          step: field.step ?? 1,
          unit: field.unit ?? '',
          attrs: `data-group="${field.group}" data-key="${escapeAttr(field.key)}" data-type="${field.type}"`
        })
      : `<button type="button" class="settings-input number-edit-button settings-number-button" data-action="open-number-edit" data-target="settings-field" data-group="${field.group}" data-key="${escapeAttr(field.key)}" data-title="${escapeAttr(field.label)}" data-value="${escapeAttr(num)}" data-min="${field.min ?? 0}" data-max="${field.max ?? 9999}" data-step="${field.step ?? 1}" data-unit="${escapeAttr(field.unit ?? '')}"><span>${escapeHtml(num || '--')}</span>${unit}</button>`;
    if (field.group === 'calibration' && field.key === 'flowMultiplier') {
      // Read-only: flow calibration is set in the Flow Calibrator (Graph), per
      // profile or as the default. Show the resolved value and where it came from.
      const fc = options.flowCalibration;
      const display = (fc ? fc.value : typeof value === 'number' ? value : 1).toFixed(2);
      const origin = fc
        ? fc.origin === 'profile'
          ? `from profile${fc.profileTitle ? ` · ${escapeHtml(fc.profileTitle)}` : ''}`
          : 'from default'
        : '';
      control = `
        <span class="settings-inline-actions">
          <span class="settings-flow-cal" title="Set in the Flow Calibrator">
            <strong>${escapeHtml(display)}×</strong>
            ${origin ? `<em class="settings-flow-cal-origin">${origin}</em>` : ''}
          </span>
          <button type="button" class="text-button" data-action="open-flow-calibrator">${icon('sliders-horizontal')}<span>Graph</span></button>
        </span>`;
    }
  }
  return settingControlRow(field.label, field.help ?? '', control);
}

function renderGatewayRows(model: SettingsShellModel): string {
  return `
    ${settingReadout('Gateway status', model.gateway.label, model.gateway.detail, model.gateway.tone)}
    ${settingReadout('Host', model.gateway.host || 'Current origin', 'Resolved Decent.app gateway origin', 'muted')}
    ${settingReadout('Machine', model.gateway.machine, 'Latest machine WebSocket snapshot', 'muted')}
    ${settingReadout('Scale', model.gateway.scale, 'Latest scale WebSocket snapshot', 'muted')}
  `;
}

function renderAppearanceRows(preferences: SettingsPreferences): string {
  return `
    ${settingControlRow(
      'Theme',
      'Skin color theme (tap a swatch to preview it live)',
      themePicker(preferences.theme),
      'settings-line-stack'
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
    ${settingControlRow(
      'Topbar clock',
      'Show the wall clock in the top bar',
      `<label class="settings-toggle"><input type="checkbox" data-action="settings-topbar-clock" ${preferences.topbarClock ? 'checked' : ''} /><span></span></label>`
    )}
    ${settingControlRow(
      'Clock format',
      'Auto follows the tablet locale, which may ignore the Android 24-hour switch',
      segmentedControl('settings-clock-format', preferences.clockFormat, [
        ['auto', 'Auto'],
        ['12h', '12h'],
        ['24h', '24h']
      ] satisfies Array<[ClockFormat, string]>),
      'settings-line-wrap'
    )}
  `;
}

const WAKE_APP_ZONE_LABELS: Record<WakeAppZonePosition, string> = {
  top: 'Top',
  bottom: 'Bottom',
  left: 'Left',
  right: 'Right'
};

function renderSleepScreenRows(model: SettingsShellModel): string {
  const preferences = model.preferences;
  const enabled = preferences.wakeAppZoneEnabled;
  const toggle = `<label class="settings-toggle"><input type="checkbox" data-action="settings-wake-app-zone" ${enabled ? 'checked' : ''} /><span></span></label>`;
  const positionRow = enabled
    ? settingControlRow(
        'Tap zone position',
        'Which screen edge the wake-app zone sits on',
        segmentedControl(
          'settings-wake-app-zone-position',
          preferences.wakeAppZonePosition,
          WAKE_APP_ZONE_POSITIONS.map((position) => [position, WAKE_APP_ZONE_LABELS[position]])
        ),
        'settings-line-wrap'
      )
    : '';
  return `
    ${renderScreensaverRows(model)}
    ${settingControlRow(
      'Wake app without the machine',
      'Adds a tap zone to the tablet sleep screen that opens Beanie while the machine stays asleep',
      toggle,
      'settings-line-wrap'
    )}
    ${positionRow}
  `;
}

const SCREENSAVER_MODE_LABELS: Array<[ScreensaverMode, string]> = [
  ['black', 'Black'],
  ['clock', 'Clock'],
  ['photos', 'Photos'],
  ['photos-clock', 'Photos + clock']
];

function renderScreensaverRows(model: SettingsShellModel): string {
  const preferences = model.preferences;
  const mode = preferences.screensaverMode;
  const black = mode === 'black';
  const brightnessRow = settingControlRow(
    'Screensaver brightness',
    black ? 'The black screensaver always turns the screen fully off' : 'Screen backlight while the screensaver shows',
    numberEditButton({
      target: 'screensaver-brightness',
      title: 'Screensaver brightness',
      value: String(preferences.screensaverBrightness),
      display: black ? 'Screen off' : `${preferences.screensaverBrightness}%`,
      min: 0,
      max: 100,
      step: 5,
      unit: '%',
      disabled: black
    })
  );
  const count = model.screensaverPhotoCount;
  const photosRow = screensaverShowsPhotos(mode)
    ? settingControlRow(
        'Screensaver photos',
        count > 0
          ? `${count} photo${count === 1 ? '' : 's'} stored on this device, changing every minute (up to ${MAX_SCREENSAVER_PHOTOS})`
          : 'Pick a folder or photos to store on this device; with none, the screensaver falls back to the clock',
        `<span class="settings-inline-actions">
          <label class="text-button"><input type="file" accept="image/*" multiple webkitdirectory data-action="settings-screensaver-add-photos" hidden />${icon('upload')}<span>Add folder…</span></label>
          <label class="text-button"><input type="file" accept="image/*" multiple data-action="settings-screensaver-add-photos" hidden />${icon('plus')}<span>Add photos…</span></label>
          ${count > 0 ? `<button type="button" class="text-button" data-action="settings-screensaver-clear-photos">${icon('trash-2')}<span>Clear</span></button>` : ''}
        </span>`,
        'settings-line-wrap'
      )
    : '';
  return `
    ${settingControlRow(
      'Screensaver',
      'What the tablet shows while the machine sleeps (tap the screen to wake)',
      `<span class="settings-saver-mode">
        ${segmentedControl('settings-screensaver-mode', mode, SCREENSAVER_MODE_LABELS)}
        <button type="button" class="text-button" data-action="screensaver-preview">${icon('eye')}<span>Preview</span></button>
      </span>`,
      'settings-line-stack'
    )}
    ${brightnessRow}
    ${photosRow}
  `;
}

function numberEditButton(opts: {
  target: string;
  title: string;
  value: string;
  display: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  disabled?: boolean;
}): string {
  if (opts.disabled) {
    return `<button type="button" class="settings-input number-edit-button settings-number-button" disabled><span>${escapeHtml(opts.display)}</span></button>`;
  }
  return `<button type="button" class="settings-input number-edit-button settings-number-button" data-action="open-number-edit" data-target="${escapeAttr(opts.target)}" data-title="${escapeAttr(opts.title)}" data-value="${escapeAttr(opts.value)}" data-min="${opts.min}" data-max="${opts.max}" data-step="${opts.step}" data-unit="${escapeAttr(opts.unit)}"><span>${escapeHtml(opts.display)}</span></button>`;
}

function phoneNumberInput(opts: {
  action: string;
  value: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  attrs?: string;
  disabled?: boolean;
}): string {
  const unit = opts.unit ? `<em class="settings-unit">${escapeHtml(opts.unit)}</em>` : '';
  return `
    <span class="settings-phone-number">
      <input class="settings-input settings-number-input" type="number" inputmode="decimal" data-action="${escapeAttr(opts.action)}" ${opts.attrs ?? ''} value="${escapeAttr(opts.value)}" min="${opts.min}" max="${opts.max}" step="${opts.step}" ${opts.disabled ? 'disabled' : ''} />
      ${unit}
    </span>`;
}

function renderScannerKeyRows(): string {
  return settingControlRow(
    'Gemini key',
    'Update the API key used by bag label scanning',
    `<button type="button" class="text-button" data-action="settings-change-scanner-key">${icon('key-round')}<span>Change key</span></button>`
  );
}

function renderWaterAlertRows(model: SettingsShellModel, options: SettingsRenderOptions = {}): string {
  const soft = model.preferences.waterSoftLimitMl;
  const refill = model.machineRefillLevelMm;
  const refillKnown = refill != null;
  const refillMm = refillKnown ? Math.round(refill) : 0;
  const refillMl = refillKnown ? waterLevelMl(refill) : null;
  return `
    ${settingControlRow(
      'Low-water warning',
      'Show a banner and flag the tank reading when it drops to this level',
      options.phone
        ? phoneNumberInput({
            action: 'settings-water-soft',
            value: String(soft),
            min: WATER_SOFT_MIN_ML,
            max: WATER_SOFT_MAX_ML,
            step: WATER_SOFT_STEP_ML,
            unit: 'ml'
          })
        : numberEditButton({
            target: 'water-soft',
            title: 'Low-water warning',
            value: String(soft),
            display: soft > 0 ? `${soft} ml` : 'Off',
            min: WATER_SOFT_MIN_ML,
            max: WATER_SOFT_MAX_ML,
            step: WATER_SOFT_STEP_ML,
            unit: 'ml'
          })
    )}
    ${settingControlRow(
      'Machine refill level',
      refillKnown
        ? `The DE1 pauses shots and shows the refill popup at this tank level${refillMl != null ? ` (≈ ${refillMl} ml)` : ''}`
        : 'Connect the machine to set its refill level',
      options.phone
        ? phoneNumberInput({
            action: 'settings-machine-refill',
            value: String(refillMm),
            min: MACHINE_REFILL_MIN_MM,
            max: MACHINE_REFILL_MAX_MM,
            step: MACHINE_REFILL_STEP_MM,
            unit: 'mm',
            disabled: !refillKnown
          })
        : numberEditButton({
            target: 'machine-refill',
            title: 'Machine refill level',
            value: String(refillMm),
            display: refillKnown ? `${refillMm} mm` : '--',
            min: MACHINE_REFILL_MIN_MM,
            max: MACHINE_REFILL_MAX_MM,
            step: MACHINE_REFILL_STEP_MM,
            unit: 'mm',
            disabled: !refillKnown
          })
    )}
  `;
}

function renderCacheResetRows(model: SettingsShellModel): string {
  const count = model.cacheKeyCount === 1 ? '1 local key' : `${model.cacheKeyCount} local keys`;
  return `
    ${settingControlRow(
      'Demo/cache reset',
      `${count} can be cleared; theme and scale are kept`,
      `<button type="button" class="text-button" data-action="settings-reset-cache">${icon('rotate-ccw')}<span>Reset</span></button>`
    )}
  `;
}

function renderAboutRows(model: SettingsShellModel): string {
  return `
    ${settingReadout('Beanie version', model.version.version, ``, 'muted')}
    ${settingReadout('Build time', model.version.buildTime, '', 'muted')}
  `;
}

function renderSection(title: string, body: string, tone?: SettingsSpecSection['tone']): string {
  const className = ['settings-section', tone ? `settings-section-${tone}` : ''].filter(Boolean).join(' ');
  return `
    <section class="${className}">
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

function settingControlRow(label: string, detail: string, control: string, extraClass = ''): string {
  return `
    <div class="settings-line${extraClass ? ` ${extraClass}` : ''}">
      <div>
        <span>${escapeHtml(label)}</span>
        <small>${escapeHtml(detail)}</small>
      </div>
      ${control}
    </div>
  `;
}

const THEME_OPTIONS: Array<[ThemePreference, string]> = [
  ['system', 'System'],
  ['dark', 'Dark'],
  ['light', 'Light'],
  ['espresso', 'Espresso'],
  ['latte', 'Latte'],
  ['nord', 'Nord'],
  ['solarized', 'Solarized'],
  ['dracula', 'Dracula'],
  ['gruvbox', 'Gruvbox'],
  ['rosepine', 'Rosé Pine'],
  ['contrast', 'Contrast']
];

// A grid of theme swatches. Each preview carries data-theme="<value>" so the
// theme's palette tokens cascade into it (styles.css), letting the chip render
// the real colors without duplicating any palette here.
function themePicker(activeValue: ThemePreference): string {
  return `
    <div class="theme-picker" role="group" aria-label="Theme">
      ${THEME_OPTIONS.map(([value, label]) => `
        <button type="button" class="theme-swatch ${activeValue === value ? 'active' : ''}" data-action="settings-theme" data-value="${escapeAttr(value)}" aria-pressed="${activeValue === value}">
          <span class="theme-swatch-preview ${value === 'system' ? 'system' : ''}" data-theme="${escapeAttr(value)}" aria-hidden="true">
            <i class="theme-swatch-dot"></i>
            <i class="theme-swatch-bar"></i>
            <i class="theme-swatch-ink"></i>
          </span>
          <span class="theme-swatch-name">${escapeHtml(label)}</span>
        </button>
      `).join('')}
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
