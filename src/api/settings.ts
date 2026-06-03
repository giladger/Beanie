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

export type GatewayMode = 'disabled' | 'tracking' | 'full';
export type ScalePowerMode = 'disabled' | 'displayOff' | 'disconnect';
export type ChargingMode = 'disabled' | 'longevity' | 'balanced' | 'highAvailability';
export type ThemeMode = 'system' | 'light' | 'dark';

export const GATEWAY_MODES: GatewayMode[] = ['disabled', 'tracking', 'full'];
export const SCALE_POWER_MODES: ScalePowerMode[] = ['disabled', 'displayOff', 'disconnect'];
export const CHARGING_MODES: ChargingMode[] = ['disabled', 'longevity', 'balanced', 'highAvailability'];
export const THEME_MODES: ThemeMode[] = ['system', 'light', 'dark'];
export const LOG_LEVELS = ['FINEST', 'FINER', 'FINE', 'CONFIG', 'INFO', 'WARNING', 'SEVERE'];

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

export interface De1Settings {
  usb: boolean;
  fan: number | null;
  flushTemp: number | null;
  flushFlow: number | null;
  flushTimeout: number | null;
  hotWaterFlow: number | null;
  steamFlow: number | null;
  tankTemp: number | null;
  steamPurgeMode: number | null;
}

export type De1SettingsPatch = Partial<De1Settings>;

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

export function readDe1Settings(value: unknown): De1Settings {
  const r = rec(value);
  return {
    usb: bool(r.usb),
    fan: numOrNull(r.fan),
    flushTemp: numOrNull(r.flushTemp),
    flushFlow: numOrNull(r.flushFlow),
    flushTimeout: numOrNull(r.flushTimeout),
    hotWaterFlow: numOrNull(r.hotWaterFlow),
    steamFlow: numOrNull(r.steamFlow),
    tankTemp: numOrNull(r.tankTemp),
    steamPurgeMode: numOrNull(r.steamPurgeMode)
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
export function de1SettingsPatchBody(patch: De1SettingsPatch): Record<string, unknown> {
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

export function demoDe1Settings(): De1Settings {
  return readDe1Settings({
    usb: true,
    fan: 40,
    flushTemp: 90,
    flushFlow: 6,
    flushTimeout: 5,
    hotWaterFlow: 6,
    steamFlow: 1.2,
    tankTemp: 0,
    steamPurgeMode: 0
  });
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
