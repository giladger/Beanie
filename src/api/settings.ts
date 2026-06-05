// reaprime settings API — types, lenient readers, and demo defaults.
//
// Covers the four data-backed settings endpoints a web skin can drive:
//   GET/POST /api/v1/settings                 (app · gateway · scale · battery · device prefs)
//   GET/POST /api/v1/machine/settings         (DE1 basic: usb/fan/tank/steam/flush/hot water)
//   GET/POST /api/v1/machine/settings/advanced(DE1 heater + refill kit)
//   GET/POST /api/v1/machine/calibration      (flow estimation multiplier)
//   GET/POST /api/v1/presence/settings        (sleep timeout + wake schedules)
//
// Readers are deliberately lenient: settings should degrade gracefully, so a
// missing/odd field falls back to a default rather than throwing.
//
// The DE1 machine-settings type/reader (De1MachineSettings) lives in types.ts /
// guards.ts (shared with the water-settings feature); we only add the usb
// boolean→enable/disable patch helper here.

import type { De1MachineSettings } from './types';

export type GatewayMode = 'disabled' | 'tracking' | 'full';
export type ScalePowerMode = 'disabled' | 'displayOff' | 'disconnect';
export type ChargingMode = 'disabled' | 'longevity' | 'balanced' | 'highAvailability';
export type ThemeMode = 'system' | 'light' | 'dark';

export const GATEWAY_MODES: GatewayMode[] = ['disabled', 'tracking', 'full'];
export const SCALE_POWER_MODES: ScalePowerMode[] = ['disabled', 'displayOff', 'disconnect'];
export const CHARGING_MODES: ChargingMode[] = ['disabled', 'longevity', 'balanced', 'highAvailability'];
export const THEME_MODES: ThemeMode[] = ['system', 'light', 'dark'];
export const LOG_LEVELS = ['FINEST', 'FINER', 'FINE', 'CONFIG', 'INFO', 'WARNING', 'SEVERE'];
export const STEAM_PURGE_MODES = [
  { value: 0, label: 'Auto purge' },
  { value: 1, label: 'Two tap stop' }
] as const;

export interface ReaSettings {
  gatewayMode: GatewayMode;
  webUiPath: string | null;
  logLevel: string;
  weightFlowMultiplier: number;
  volumeFlowMultiplier: number;
  scalePowerMode: ScalePowerMode;
  blockOnNoScale: boolean;
  preferredMachineId: string | null;
  preferredScaleId: string | null;
  defaultSkinId: string | null;
  automaticUpdateCheck: boolean;
  chargingMode: ChargingMode;
  nightModeEnabled: boolean;
  nightModeSleepTime: number; // minutes since midnight (0–1439)
  nightModeMorningTime: number; // minutes since midnight (0–1439)
  lowBatteryBrightnessLimit: boolean;
  simulatedDevices: string[];
  themeMode: ThemeMode;
  /** Read-only runtime charging snapshot when a battery is present. */
  chargingState: Record<string, unknown> | null;
}

/** Writable subset of ReaSettings (POST /api/v1/settings accepts partial updates). */
export type ReaSettingsPatch = Partial<
  Pick<
    ReaSettings,
    | 'gatewayMode'
    | 'logLevel'
    | 'weightFlowMultiplier'
    | 'volumeFlowMultiplier'
    | 'scalePowerMode'
    | 'blockOnNoScale'
    | 'preferredMachineId'
    | 'preferredScaleId'
    | 'defaultSkinId'
    | 'automaticUpdateCheck'
    | 'chargingMode'
    | 'nightModeEnabled'
    | 'nightModeSleepTime'
    | 'nightModeMorningTime'
    | 'lowBatteryBrightnessLimit'
    | 'themeMode'
  >
>;

export interface De1AdvancedSettings {
  heaterPh1Flow: number | null;
  heaterPh2Flow: number | null;
  heaterIdleTemp: number | null;
  heaterPh2Timeout: number | null;
  heaterVoltage: number | null; // 120 | 230 | -1 (unset)
  refillKitSetting: number | null; // 0 force off · 1 force on · 2 auto
}

export type De1AdvancedSettingsPatch = Partial<De1AdvancedSettings>;

export interface De1Calibration {
  flowMultiplier: number;
}

export interface PresenceSettings {
  userPresenceEnabled: boolean;
  sleepTimeoutMinutes: number;
  wakeSchedules: unknown[];
}

export type PresenceSettingsPatch = Partial<Pick<PresenceSettings, 'userPresenceEnabled' | 'sleepTimeoutMinutes'>>;

export interface DisplayPlatformSupport {
  brightness: boolean;
  wakeLock: boolean;
}

export interface DisplayState {
  wakeLockEnabled: boolean;
  wakeLockOverride: boolean;
  brightness: number;
  requestedBrightness: number;
  lowBatteryBrightnessActive: boolean;
  platformSupported: DisplayPlatformSupport;
}

export interface DecentAccountStatus {
  loggedIn: boolean;
  email: string | null;
}

export interface SkinInfo {
  id: string;
  name: string;
}

// --- lenient coercion -----------------------------------------------------

function rec(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function num(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function numOrNull(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function bool(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return value === 'true' || value === '1' || value === 'enable';
  return fallback;
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function strOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function enumOr<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return typeof value === 'string' && (allowed as string[]).includes(value) ? (value as T) : fallback;
}

function intInRange(value: unknown, fallback: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(num(value, fallback))));
}

// --- readers --------------------------------------------------------------

export function readReaSettings(value: unknown): ReaSettings {
  const r = rec(value);
  return {
    gatewayMode: enumOr(r.gatewayMode, GATEWAY_MODES, 'disabled'),
    webUiPath: strOrNull(r.webUiPath),
    logLevel: str(r.logLevel, 'INFO'),
    weightFlowMultiplier: num(r.weightFlowMultiplier, 1),
    volumeFlowMultiplier: num(r.volumeFlowMultiplier, 0.3),
    scalePowerMode: enumOr(r.scalePowerMode, SCALE_POWER_MODES, 'disconnect'),
    blockOnNoScale: bool(r.blockOnNoScale),
    preferredMachineId: strOrNull(r.preferredMachineId),
    preferredScaleId: strOrNull(r.preferredScaleId),
    defaultSkinId: strOrNull(r.defaultSkinId),
    automaticUpdateCheck: bool(r.automaticUpdateCheck, true),
    chargingMode: enumOr(r.chargingMode, CHARGING_MODES, 'disabled'),
    nightModeEnabled: bool(r.nightModeEnabled),
    nightModeSleepTime: num(r.nightModeSleepTime, 1320),
    nightModeMorningTime: num(r.nightModeMorningTime, 420),
    lowBatteryBrightnessLimit: bool(r.lowBatteryBrightnessLimit),
    simulatedDevices: Array.isArray(r.simulatedDevices)
      ? r.simulatedDevices.filter((d): d is string => typeof d === 'string')
      : [],
    themeMode: enumOr(r.themeMode, THEME_MODES, 'system'),
    chargingState: r.chargingState != null && typeof r.chargingState === 'object'
      ? (r.chargingState as Record<string, unknown>)
      : null
  };
}

export function readDe1AdvancedSettings(value: unknown): De1AdvancedSettings {
  const r = rec(value);
  return {
    heaterPh1Flow: numOrNull(r.heaterPh1Flow),
    heaterPh2Flow: numOrNull(r.heaterPh2Flow),
    heaterIdleTemp: numOrNull(r.heaterIdleTemp),
    heaterPh2Timeout: numOrNull(r.heaterPh2Timeout),
    heaterVoltage: numOrNull(r.heaterVoltage),
    refillKitSetting: numOrNull(r.refillKitSetting)
  };
}

export function readDe1Calibration(value: unknown): De1Calibration {
  return { flowMultiplier: num(rec(value).flowMultiplier, 1) };
}

export function readPresenceSettings(value: unknown): PresenceSettings {
  const r = rec(value);
  return {
    userPresenceEnabled: bool(r.userPresenceEnabled, true),
    sleepTimeoutMinutes: num(r.sleepTimeoutMinutes, 30),
    wakeSchedules: Array.isArray(r.wakeSchedules) ? r.wakeSchedules : []
  };
}

export function readDisplayState(value: unknown): DisplayState {
  const r = rec(value);
  const platform = rec(r.platformSupported);
  return {
    wakeLockEnabled: bool(r.wakeLockEnabled),
    wakeLockOverride: bool(r.wakeLockOverride),
    brightness: intInRange(r.brightness, 100, 0, 100),
    requestedBrightness: intInRange(r.requestedBrightness, 100, 0, 100),
    lowBatteryBrightnessActive: bool(r.lowBatteryBrightnessActive),
    platformSupported: {
      brightness: bool(platform.brightness, true),
      wakeLock: bool(platform.wakeLock, true)
    }
  };
}

export function readDecentAccountStatus(value: unknown): DecentAccountStatus {
  const r = rec(value);
  const email = strOrNull(r.email);
  return {
    loggedIn: r.loggedIn === true || r.isLoggedIn === true || email != null,
    email
  };
}

export function readSkins(value: unknown): SkinInfo[] {
  const list = Array.isArray(value)
    ? value
    : Array.isArray(rec(value).skins)
      ? (rec(value).skins as unknown[])
      : [];
  return list.map((entry) => {
    const r = rec(entry);
    const id = str(r.id ?? r.skinId ?? r.name, '');
    return { id, name: str(r.name ?? r.title ?? id, id) };
  }).filter((skin) => skin.id !== '');
}

/**
 * The POST /api/v1/machine/settings body uses usb: 'enable' | 'disable', while
 * the response uses usb: boolean. Convert a patch to the wire shape.
 */
export function de1MachineSettingsPatchBody(patch: Partial<De1MachineSettings>): Record<string, unknown> {
  const body: Record<string, unknown> = { ...patch };
  if ('usb' in patch && typeof patch.usb === 'boolean') {
    body.usb = patch.usb ? 'enable' : 'disable';
  }
  return body;
}

// --- demo defaults --------------------------------------------------------

export function demoReaSettings(): ReaSettings {
  return readReaSettings({
    gatewayMode: 'tracking',
    webUiPath: '/web-ui/beanie',
    logLevel: 'INFO',
    weightFlowMultiplier: 1,
    volumeFlowMultiplier: 0.3,
    scalePowerMode: 'disconnect',
    blockOnNoScale: false,
    preferredMachineId: 'demo-de1',
    preferredScaleId: 'demo-scale',
    defaultSkinId: 'beanie',
    automaticUpdateCheck: true,
    chargingMode: 'balanced',
    nightModeEnabled: false,
    nightModeSleepTime: 1320,
    nightModeMorningTime: 420,
    lowBatteryBrightnessLimit: false,
    simulatedDevices: ['machine', 'scale'],
    themeMode: 'system'
  });
}

export function demoMachineSettings(): De1MachineSettings {
  return {
    usb: true,
    fan: 40,
    flushTemp: 90,
    flushFlow: 6,
    flushTimeout: 5,
    hotWaterFlow: 6,
    steamFlow: 1.2,
    tankTemp: 0,
    steamPurgeMode: 0
  };
}

export function demoDe1AdvancedSettings(): De1AdvancedSettings {
  return readDe1AdvancedSettings({
    heaterPh1Flow: 4,
    heaterPh2Flow: 4,
    heaterIdleTemp: 85,
    heaterPh2Timeout: 10,
    heaterVoltage: 230,
    refillKitSetting: 2
  });
}

export function demoCalibration(): De1Calibration {
  return { flowMultiplier: 1 };
}

export function demoPresenceSettings(): PresenceSettings {
  return { userPresenceEnabled: true, sleepTimeoutMinutes: 30, wakeSchedules: [] };
}

export function demoDisplayState(): DisplayState {
  return readDisplayState({
    wakeLockEnabled: true,
    wakeLockOverride: false,
    brightness: 100,
    requestedBrightness: 100,
    lowBatteryBrightnessActive: false,
    platformSupported: { brightness: true, wakeLock: true }
  });
}

export function demoDecentAccountStatus(): DecentAccountStatus {
  return { loggedIn: false, email: null };
}

// --- devices · wake schedules · plugins ----------------------------------

export type DeviceState = 'connected' | 'disconnected';
export type DeviceKind = 'machine' | 'scale' | 'sensor';

export interface DeviceInfo {
  id: string;
  name: string;
  state: DeviceState;
  type: DeviceKind;
}

export interface WakeSchedule {
  id: string;
  time: string; // "HH:MM"
  daysOfWeek: number[]; // ISO 1=Mon … 7=Sun; empty = every day
  enabled: boolean;
  keepAwakeFor: number | null;
}

export interface PluginInfo {
  id: string;
  name: string;
  author: string;
  version: string;
  loaded: boolean;
  autoLoad: boolean;
}

export function readDevices(value: unknown): DeviceInfo[] {
  const list = Array.isArray(value) ? value : [];
  return list
    .map((entry) => {
      const r = rec(entry);
      return {
        id: str(r.id, ''),
        name: str(r.name, str(r.id, 'Unknown device')),
        state: r.state === 'connected' ? 'connected' : ('disconnected' as DeviceState),
        type: enumOr(r.type, ['machine', 'scale', 'sensor'] as DeviceKind[], 'sensor')
      };
    })
    .filter((d) => d.id !== '');
}

export function readWakeSchedules(value: unknown): WakeSchedule[] {
  const list = Array.isArray(value) ? value : [];
  return list
    .map((entry) => {
      const r = rec(entry);
      const hour = num(r.hour, NaN);
      const minute = num(r.minute, NaN);
      const time = typeof r.time === 'string'
        ? r.time
        : Number.isFinite(hour)
          ? `${String(hour).padStart(2, '0')}:${String(Number.isFinite(minute) ? minute : 0).padStart(2, '0')}`
          : '';
      return {
        id: str(r.id, ''),
        time,
        daysOfWeek: Array.isArray(r.daysOfWeek)
          ? r.daysOfWeek.map((d) => num(d, 0)).filter((d) => d >= 1 && d <= 7)
          : [],
        enabled: bool(r.enabled, true),
        keepAwakeFor: numOrNull(r.keepAwakeFor)
      };
    })
    .filter((s) => s.id !== '' && s.time !== '');
}

export function readPlugins(value: unknown): PluginInfo[] {
  const list = Array.isArray(value) ? value : [];
  return list
    .map((entry) => {
      const r = rec(entry);
      return {
        id: str(r.id, ''),
        name: str(r.name, str(r.id, 'Plugin')),
        author: str(r.author, ''),
        version: str(r.version, ''),
        loaded: bool(r.loaded),
        autoLoad: bool(r.autoLoad)
      };
    })
    .filter((p) => p.id !== '');
}

export function demoDevices(): DeviceInfo[] {
  return [
    { id: 'MockDe1', name: 'DE1 (simulated)', state: 'connected', type: 'machine' },
    { id: 'MockScale', name: 'Decent Scale (simulated)', state: 'connected', type: 'scale' }
  ];
}

export function demoWakeSchedules(): WakeSchedule[] {
  return [{ id: 'demo-1', time: '06:30', daysOfWeek: [1, 2, 3, 4, 5], enabled: true, keepAwakeFor: 60 }];
}

export function demoPlugins(): PluginInfo[] {
  return [
    { id: 'visualizer', name: 'Visualizer upload', author: 'Decent', version: '1.0.0', loaded: true, autoLoad: true },
    { id: 'time-to-ready', name: 'Time to ready', author: 'Decent', version: '1.0.0', loaded: false, autoLoad: false }
  ];
}

// Per-plugin configuration. `values` carries the non-secret settings; `secretsSet`
// flags which secret fields (e.g. a password) currently have a value on the
// gateway — the secret itself is never sent to the browser.
export interface PluginSettings {
  values: Record<string, string | number | boolean>;
  secretsSet: Record<string, boolean>;
}

export interface PluginVerifyResult {
  ok: boolean;
  message: string;
}

export function readPluginSettings(value: unknown): PluginSettings {
  const r = rec(value);
  // Accept either an envelope ({ values, secretsSet }) or a flat settings map —
  // reaprime returns the bare settings object, so default to treating the top
  // level as the values.
  const hasEnvelope = typeof r.values === 'object' && r.values !== null && !Array.isArray(r.values);
  const rawValues = hasEnvelope ? rec(r.values) : r;
  const values: Record<string, string | number | boolean> = {};
  for (const [key, entry] of Object.entries(rawValues)) {
    if (key === 'values' || key === 'secretsSet') continue;
    if (typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean') {
      values[key] = entry;
    }
  }
  const rawSecrets = rec(r.secretsSet);
  const secretsSet: Record<string, boolean> = {};
  for (const [key, entry] of Object.entries(rawSecrets)) secretsSet[key] = entry === true;
  return { values, secretsSet };
}

export function readPluginVerify(value: unknown): PluginVerifyResult {
  const r = rec(value);
  const ok = r.ok === true || r.valid === true;
  return { ok, message: str(r.message, ok ? 'Credentials verified' : 'Verification failed') };
}

export function demoPluginSettings(id: string): PluginSettings {
  if (id.replace(/\.reaplugin$/i, '').toLowerCase() === 'visualizer') {
    return {
      values: { Username: 'demo@visualizer.coffee', Password: 'demo-password', AutoUpload: true, LengthThreshold: 6 },
      secretsSet: { Password: true }
    };
  }
  return { values: {}, secretsSet: {} };
}
