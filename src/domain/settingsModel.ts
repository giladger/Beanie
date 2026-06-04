// Declarative spec for the reaprime-backed settings sections. Each field knows
// its group (which endpoint it belongs to), key, control type, and bounds, so
// the renderer and the change handler stay generic instead of hand-wiring ~30
// controls. Skin-local prefs (theme, UI scale, cache) live in domain/settings.ts
// and are rendered separately.

import {
  CHARGING_MODES,
  GATEWAY_MODES,
  LOG_LEVELS,
  SCALE_POWER_MODES,
  THEME_MODES,
  demoCalibration,
  demoDe1AdvancedSettings,
  demoDevices,
  demoDisplayState,
  demoMachineSettings,
  demoPlugins,
  demoPresenceSettings,
  demoReaSettings,
  demoWakeSchedules,
  type De1AdvancedSettings,
  type De1Calibration,
  type DeviceInfo,
  type DisplayState,
  type PluginInfo,
  type PresenceSettings,
  type ReaSettings,
  type SkinInfo,
  type WakeSchedule
} from '../api/settings';
import type { De1MachineSettings } from '../api/types';

export interface SettingsBundle {
  rea: ReaSettings;
  de1: De1MachineSettings;
  advanced: De1AdvancedSettings;
  calibration: De1Calibration;
  presence: PresenceSettings;
  display: DisplayState;
  skins: SkinInfo[];
  devices: DeviceInfo[];
  plugins: PluginInfo[];
  schedules: WakeSchedule[];
}

export type SettingsGroup = 'rea' | 'de1' | 'advanced' | 'calibration' | 'presence';
export type SettingsFieldType = 'toggle' | 'select' | 'number' | 'time';

export interface SettingsOption {
  value: string;
  label: string;
}

export interface SettingsField {
  group: SettingsGroup;
  key: string;
  label: string;
  type: SettingsFieldType;
  help?: string;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: SettingsOption[];
  /** Populate select options dynamically from the bundle (e.g. installed skins). */
  optionsFrom?: 'skins';
  /** Label to show when a select value is unknown/unset instead of falling through to the first option. */
  unknownLabel?: string;
}

export interface SettingsSpecSection {
  id: string;
  title: string;
  terms: string;
  tone?: 'danger';
  fields: SettingsField[];
}

const opts = (values: string[], label?: (v: string) => string): SettingsOption[] =>
  values.map((value) => ({ value, label: label ? label(value) : titleCase(value) }));

function titleCase(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase());
}

export const SETTINGS_SPEC: SettingsSpecSection[] = [
  {
    id: 'connection-policy',
    title: 'Control policy',
    terms: 'gateway mode control external clients tracking full disabled',
    fields: [
      {
        group: 'rea',
        key: 'gatewayMode',
        label: 'Gateway control mode',
        type: 'select',
        options: opts(GATEWAY_MODES),
        help: 'How much control external clients (this skin) have over the machine.'
      }
    ]
  },
  {
    id: 'app-skin',
    title: 'Skin & diagnostics',
    terms: 'skin update log theme diagnostics',
    fields: [
      { group: 'rea', key: 'defaultSkinId', label: 'Active skin', type: 'select', optionsFrom: 'skins', help: 'The skin Decent.app serves by default.' },
      { group: 'rea', key: 'automaticUpdateCheck', label: 'Automatic update check', type: 'toggle' },
      { group: 'rea', key: 'themeMode', label: 'Decent.app theme', type: 'select', options: opts(THEME_MODES), help: 'Stored Decent.app theme preference.' },
      { group: 'rea', key: 'logLevel', label: 'Log level', type: 'select', options: opts(LOG_LEVELS, (v) => v), help: 'Only change while debugging.' }
    ]
  },
  {
    id: 'shot-stopping',
    title: 'Shot stopping',
    terms: 'scale weight target volume stop yield flow multiplier',
    fields: [
      { group: 'rea', key: 'blockOnNoScale', label: 'Block shots without a scale', type: 'toggle' },
      { group: 'rea', key: 'weightFlowMultiplier', label: 'Weight stop lookahead', type: 'number', min: 0, max: 5, step: 0.05, help: 'Higher stops earlier when using stop-at-weight.' },
      { group: 'rea', key: 'volumeFlowMultiplier', label: 'Volume stop lookahead', type: 'number', min: 0, max: 2, step: 0.05, unit: 's', help: 'Seconds of flow to expect after a volume stop command.' },
      { group: 'calibration', key: 'flowMultiplier', label: 'Flow calibration', type: 'number', min: 0.13, max: 2, step: 0.01, help: 'Adjusts Decent.app flow estimation.' }
    ]
  },
  {
    id: 'machine-outputs',
    title: 'Machine outputs',
    terms: 'tank steam flush hot water purge flow temperature',
    fields: [
      { group: 'de1', key: 'tankTemp', label: 'Tank preheat target', type: 'number', min: 0, max: 60, step: 1, unit: '°C', help: '0 = off' },
      { group: 'de1', key: 'steamFlow', label: 'Steam flow', type: 'number', min: 0, max: 5, step: 0.1, unit: 'ml/s' },
      { group: 'de1', key: 'steamPurgeMode', label: 'Steam purge mode', type: 'number', min: 0, max: 4, step: 1 },
      { group: 'de1', key: 'hotWaterFlow', label: 'Hot water flow', type: 'number', min: 0, max: 10, step: 0.1, unit: 'ml/s' },
      { group: 'de1', key: 'flushTemp', label: 'Flush temperature', type: 'number', min: 0, max: 110, step: 1, unit: '°C' },
      { group: 'de1', key: 'flushFlow', label: 'Flush flow', type: 'number', min: 0, max: 10, step: 0.1, unit: 'ml/s' },
      { group: 'de1', key: 'flushTimeout', label: 'Flush timeout', type: 'number', min: 0, max: 30, step: 1, unit: 's' }
    ]
  },
  {
    id: 'danger-zone',
    title: 'Danger zone',
    terms: 'danger advanced heater voltage refill kit calibration fan firmware reset',
    tone: 'danger',
    fields: [
      { group: 'de1', key: 'fan', label: 'Fan threshold', type: 'number', min: 0, max: 100, step: 1, unit: '°C', help: 'Machine cooling threshold.' },
      {
        group: 'advanced',
        key: 'heaterVoltage',
        label: 'Mains voltage hint',
        type: 'select',
        help: 'Nominal heater-voltage region; wrong values affect heater behavior.',
        unknownLabel: 'Unknown',
        options: [
          { value: '120', label: '110–120 V' },
          { value: '230', label: '220–230 V' }
        ]
      },
      { group: 'advanced', key: 'heaterIdleTemp', label: 'Heater idle temperature', type: 'number', min: 0, max: 95, step: 1, unit: '°C' },
      { group: 'advanced', key: 'heaterPh1Flow', label: 'Heater phase 1 flow', type: 'number', min: 0, max: 10, step: 0.1, unit: 'ml/s' },
      { group: 'advanced', key: 'heaterPh2Flow', label: 'Heater phase 2 flow', type: 'number', min: 0, max: 10, step: 0.1, unit: 'ml/s' },
      { group: 'advanced', key: 'heaterPh2Timeout', label: 'Heater phase 2 timeout', type: 'number', min: 0, max: 60, step: 1, unit: 's' },
      {
        group: 'advanced',
        key: 'refillKitSetting',
        label: 'Refill kit',
        type: 'select',
        options: [
          { value: '2', label: 'Auto' },
          { value: '1', label: 'Force on' },
          { value: '0', label: 'Force off' }
        ]
      }
    ]
  },
  {
    id: 'power',
    title: 'Power',
    terms: 'sleep presence wake charging night battery brightness usb scale power',
    fields: [
      { group: 'rea', key: 'scalePowerMode', label: 'Scale power mode', type: 'select', options: opts(SCALE_POWER_MODES) },
      { group: 'de1', key: 'usb', label: 'USB charger output', type: 'toggle' },
      { group: 'presence', key: 'userPresenceEnabled', label: 'Presence detection', type: 'toggle' },
      { group: 'presence', key: 'sleepTimeoutMinutes', label: 'Sleep after', type: 'number', min: 0, max: 180, step: 1, unit: 'min', help: '0 = never' },
      { group: 'rea', key: 'chargingMode', label: 'Smart charging', type: 'select', options: opts(CHARGING_MODES) },
      { group: 'rea', key: 'nightModeEnabled', label: 'Night charging mode', type: 'toggle' },
      { group: 'rea', key: 'nightModeSleepTime', label: 'Night mode starts', type: 'time' },
      { group: 'rea', key: 'nightModeMorningTime', label: 'Night mode ends', type: 'time' },
      { group: 'rea', key: 'lowBatteryBrightnessLimit', label: 'Dim screen on low battery', type: 'toggle' }
    ]
  }
];

export function demoSettingsBundle(): SettingsBundle {
  return {
    rea: demoReaSettings(),
    de1: demoMachineSettings(),
    advanced: demoDe1AdvancedSettings(),
    calibration: demoCalibration(),
    presence: demoPresenceSettings(),
    display: demoDisplayState(),
    skins: [
      { id: 'beanie', name: 'Beanie' },
      { id: 'streamline.js', name: 'streamline.js' },
      { id: 'decent.baseline', name: 'decent.baseline' }
    ],
    devices: demoDevices(),
    plugins: demoPlugins(),
    schedules: demoWakeSchedules()
  };
}

/** Raw value for a field out of the bundle (string for selects/time, number, or boolean). */
export function fieldValue(bundle: SettingsBundle, field: SettingsField): string | number | boolean | null {
  const group = bundle[field.group] as unknown as Record<string, unknown>;
  const value = group[field.key];
  if (field.type === 'toggle') return value === true;
  if (field.type === 'number' || field.type === 'time') {
    return typeof value === 'number' ? value : null;
  }
  return value == null ? '' : String(value);
}

/** Coerce a control's raw input into the typed value for its field. */
export function coerceFieldValue(field: SettingsField, raw: string | boolean): string | number | boolean | null {
  if (field.type === 'toggle') return raw === true || raw === 'true';
  if (field.type === 'number') {
    const n = Number(raw);
    return Number.isFinite(n) ? clamp(n, field.min, field.max) : null;
  }
  if (field.type === 'time') {
    // raw is "HH:MM" → minutes since midnight
    const [h, m] = String(raw).split(':').map((p) => Number(p));
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return clamp(h * 60 + m, 0, 1439);
  }
  return String(raw);
}

/** Return a new bundle with one field updated. */
export function setBundleField(
  bundle: SettingsBundle,
  field: SettingsField,
  value: string | number | boolean | null
): SettingsBundle {
  const next: SettingsBundle = {
    ...bundle,
    rea: { ...bundle.rea },
    de1: { ...bundle.de1 },
    advanced: { ...bundle.advanced },
    calibration: { ...bundle.calibration },
    presence: { ...bundle.presence },
    display: { ...bundle.display }
  };
  (next[field.group] as unknown as Record<string, unknown>)[field.key] = value;
  return next;
}

/** "HH:MM" string for a time field's minutes-since-midnight value. */
export function minutesToTime(minutes: number | null): string {
  if (minutes == null || !Number.isFinite(minutes)) return '00:00';
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function clamp(value: number, min?: number, max?: number): number {
  let out = value;
  if (typeof min === 'number') out = Math.max(min, out);
  if (typeof max === 'number') out = Math.min(max, out);
  return out;
}
