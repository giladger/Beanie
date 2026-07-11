import type { MachineSnapshot, ScaleSnapshot } from '../api/types';
import { FLOW_CALIBRATION_STORAGE_KEYS } from './flowCalibration';
import {
  clockFormatKey,
  getSyncedItem,
  removeSyncedItem,
  screensaverBrightnessKey,
  screensaverModeKey,
  setSyncedItem,
  syncedCacheKeys,
  topbarClockKey,
  uiScaleKey,
  wakeAppZoneEnabledKey,
  wakeAppZonePositionKey,
  waterSoftKey
} from './settingsStore';
import {
  DEFAULT_SCREENSAVER_BRIGHTNESS,
  SCREENSAVER_MODES,
  type ScreensaverMode
} from './screensaver';
import { DEFAULT_WATER_SOFT_ML } from './waterAlert';

export type ThemePreference =
  | 'system'
  | 'dark'
  | 'light'
  | 'espresso'
  | 'latte'
  | 'nord'
  | 'solarized'
  | 'dracula'
  | 'gruvbox'
  | 'rosepine'
  | 'contrast';
export type UIScalePreference = 'compact' | 'standard' | 'large';

/**
 * Clock display format. 'auto' follows the browser locale — which on Android
 * webviews does NOT track the system's 24-hour switch, hence the explicit
 * overrides.
 */
export type ClockFormat = 'auto' | '12h' | '24h';

export const CLOCK_FORMATS: ClockFormat[] = ['auto', '12h', '24h'];

export function isClockFormat(value: string | undefined): value is ClockFormat {
  return value === 'auto' || value === '12h' || value === '24h';
}

/** Edge the sleep-screen "wake app only" tap zone sits on. */
export type WakeAppZonePosition = 'top' | 'bottom' | 'left' | 'right';

export const WAKE_APP_ZONE_POSITIONS: WakeAppZonePosition[] = ['top', 'bottom', 'left', 'right'];

export function isWakeAppZonePosition(value: string | undefined): value is WakeAppZonePosition {
  return value === 'top' || value === 'bottom' || value === 'left' || value === 'right';
}

/**
 * Every selectable theme. Each value (except `system`) must have a matching
 * `[data-theme="<value>"]` palette block in styles.css. `system` follows the OS
 * light/dark preference. Used for validation and to render the Settings picker.
 */
export const THEME_PREFERENCES: ThemePreference[] = [
  'system',
  'dark',
  'light',
  'espresso',
  'latte',
  'nord',
  'solarized',
  'dracula',
  'gruvbox',
  'rosepine',
  'contrast'
];

export interface SettingsPreferences {
  theme: ThemePreference;
  uiScale: UIScalePreference;
  /** Soft low-water warning threshold in ml (0 = off). The hard block is the
   * machine's own refill threshold (configured via gateway.setRefillLevel). */
  waterSoftLimitMl: number;
  /** When on, the sleep screen shows a tap zone that wakes Beanie (restoring the
   * screen) while leaving the machine asleep — like opening the skin in a browser. */
  wakeAppZoneEnabled: boolean;
  /** Which screen edge the wake-app tap zone occupies. */
  wakeAppZonePosition: WakeAppZonePosition;
  /** Show the wall clock in the workbench topbar. */
  topbarClock: boolean;
  /** 12h/24h override for the topbar and screensaver clocks ('auto' = locale). */
  clockFormat: ClockFormat;
  /** What the sleep screensaver shows (black stays a fully dark screen). */
  screensaverMode: ScreensaverMode;
  /** Backlight percent while a clock/photos screensaver shows (black is always 0). */
  screensaverBrightness: number;
}

export interface GatewayStatusModel {
  label: string;
  detail: string;
  host: string;
  tone: 'good' | 'warn' | 'muted';
  machine: string;
  scale: string;
}

export interface VersionInfoModel {
  version: string;
  gitCommit: string;
  buildTime: string;
  defaultSkinStatus: string;
}

export interface SettingsShellModel {
  query: string;
  preferences: SettingsPreferences;
  gateway: GatewayStatusModel;
  version: VersionInfoModel;
  cacheKeyCount: number;
  /** The machine's own low-water refill threshold (mm), or null if unknown. */
  machineRefillLevelMm: number | null;
  /** Photos stored on this device for the screensaver slideshow. */
  screensaverPhotoCount: number;
}

export interface BuildSettingsShellModelOptions {
  query: string;
  preferences: SettingsPreferences;
  demo: boolean;
  /** False when the shell is presenting cached/limited last-known data. */
  connected?: boolean;
  loading: boolean;
  status: string;
  gatewayHost: string;
  machine: MachineSnapshot | null;
  scale: ScaleSnapshot | null;
  machineRefillLevelMm: number | null;
  screensaverPhotoCount: number;
}

// Theme stays per-browser: it lives in localStorage (not the gateway store) and
// keeps its historic key so an upgrading device keeps its current theme.
const themeKey = 'beanie:settings:theme';

const preservedResetKeys = new Set([
  uiScaleKey,
  waterSoftKey,
  wakeAppZoneEnabledKey,
  wakeAppZonePositionKey,
  topbarClockKey,
  clockFormatKey,
  screensaverModeKey,
  screensaverBrightnessKey,
  // Per-profile/global flow calibration is hardware-tuning config — a reset
  // must not wipe it.
  ...FLOW_CALIBRATION_STORAGE_KEYS
]);

export function readSettingsPreferences(): SettingsPreferences {
  return {
    theme: readLocalTheme(),
    uiScale: readEnum(uiScaleKey, ['compact', 'standard', 'large'], 'standard'),
    waterSoftLimitMl: readNonNegativeNumber(waterSoftKey, DEFAULT_WATER_SOFT_ML),
    wakeAppZoneEnabled: readBoolean(wakeAppZoneEnabledKey, false),
    wakeAppZonePosition: readEnum(wakeAppZonePositionKey, WAKE_APP_ZONE_POSITIONS, 'top'),
    topbarClock: readBoolean(topbarClockKey, true),
    clockFormat: readEnum(clockFormatKey, CLOCK_FORMATS, 'auto'),
    screensaverMode: readEnum(screensaverModeKey, SCREENSAVER_MODES, 'black'),
    screensaverBrightness: readNonNegativeNumber(screensaverBrightnessKey, DEFAULT_SCREENSAVER_BRIGHTNESS)
  };
}

export function writeSettingsPreferences(next: SettingsPreferences): void {
  writeSettingsPreferencePatch(next);
}

/** Write only fields the user actually changed, avoiding unrelated store writes. */
export function writeSettingsPreferencePatch(next: Partial<SettingsPreferences>): void {
  // Theme is per-browser (localStorage); the rest sync via the store.
  if (next.theme !== undefined) writeLocalTheme(next.theme);
  if (next.uiScale !== undefined) setSyncedItem(uiScaleKey, next.uiScale);
  if (next.waterSoftLimitMl !== undefined) setSyncedItem(waterSoftKey, String(next.waterSoftLimitMl));
  if (next.wakeAppZoneEnabled !== undefined) setSyncedItem(wakeAppZoneEnabledKey, String(next.wakeAppZoneEnabled));
  if (next.wakeAppZonePosition !== undefined) setSyncedItem(wakeAppZonePositionKey, next.wakeAppZonePosition);
  if (next.topbarClock !== undefined) setSyncedItem(topbarClockKey, String(next.topbarClock));
  if (next.clockFormat !== undefined) setSyncedItem(clockFormatKey, next.clockFormat);
  if (next.screensaverMode !== undefined) setSyncedItem(screensaverModeKey, next.screensaverMode);
  if (next.screensaverBrightness !== undefined) {
    setSyncedItem(screensaverBrightnessKey, String(next.screensaverBrightness));
  }
}

export function applySettingsPreferences(preferences: SettingsPreferences): void {
  document.documentElement.dataset.theme = preferences.theme;
  document.documentElement.dataset.uiScale = preferences.uiScale;
}

export function buildSettingsShellModel(
  options: BuildSettingsShellModelOptions
): SettingsShellModel {
  return {
    query: options.query,
    preferences: options.preferences,
    gateway: buildGatewayStatus(options),
    version: {
      version: __APP_VERSION__,
      gitCommit: __GIT_COMMIT__,
      buildTime: formatBuildTime(__BUILD_TIME__),
      defaultSkinStatus: 'Not checked by Beanie yet'
    },
    cacheKeyCount: listResettableBeanieKeys().length,
    machineRefillLevelMm: options.machineRefillLevelMm,
    screensaverPhotoCount: options.screensaverPhotoCount
  };
}

export function listResettableBeanieKeys(): string[] {
  return syncedCacheKeys()
    .filter((key) => !preservedResetKeys.has(key))
    .sort();
}

export function resetBeanieCache(): number {
  const keys = listResettableBeanieKeys();
  keys.forEach((key) => removeSyncedItem(key));
  return keys.length;
}

function buildGatewayStatus(options: BuildSettingsShellModelOptions): GatewayStatusModel {
  if (options.loading) {
    return {
      label: 'Loading',
      detail: options.status,
      host: options.gatewayHost,
      tone: 'muted',
      machine: 'Waiting',
      scale: 'Waiting'
    };
  }

  if (options.demo) {
    return {
      label: 'Demo mode',
      detail: 'Gateway unavailable; using seeded local data',
      host: options.gatewayHost,
      tone: 'warn',
      machine: machineLabel(options.machine),
      scale: scaleLabel(options.scale)
    };
  }

  if (options.connected === false) {
    return {
      label: 'Not connected',
      detail: options.status,
      host: options.gatewayHost,
      tone: 'warn',
      machine: machineLabel(options.machine),
      scale: scaleLabel(options.scale)
    };
  }

  return {
    label: 'Connected',
    detail: options.status,
    host: options.gatewayHost,
    tone: 'good',
    machine: machineLabel(options.machine),
    scale: scaleLabel(options.scale)
  };
}

function machineLabel(machine: MachineSnapshot | null): string {
  const state = machine?.state?.state;
  return state ? capitalize(state) : 'No snapshot';
}

function scaleLabel(scale: ScaleSnapshot | null): string {
  if (!scale) return 'No snapshot';
  if (scale.status === 'disconnected') return 'Disconnected';
  return `${formatNumber(scale.weight, 1)} g`;
}

function formatBuildTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf())
    ? value
    : parsed.toLocaleString([], {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
}

function readLocalTheme(): ThemePreference {
  try {
    if (typeof localStorage === 'undefined') return 'espresso';
    const stored = localStorage.getItem(themeKey);
    return THEME_PREFERENCES.includes(stored as ThemePreference) ? (stored as ThemePreference) : 'espresso';
  } catch {
    return 'espresso';
  }
}

function writeLocalTheme(theme: ThemePreference): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(themeKey, theme);
  } catch {
    // Best-effort; the live in-memory preference stays authoritative this session.
  }
}

function readEnum<T extends string>(key: string, values: readonly T[], fallback: T): T {
  const stored = getSyncedItem(key);
  return values.includes(stored as T) ? (stored as T) : fallback;
}

function readBoolean(key: string, fallback: boolean): boolean {
  const stored = getSyncedItem(key);
  if (stored == null) return fallback;
  return stored === 'true';
}

function readNonNegativeNumber(key: string, fallback: number): number {
  const stored = getSyncedItem(key);
  if (stored == null) return fallback;
  const value = Number(stored);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function formatNumber(value: number | null | undefined, digits: number): string {
  return value == null || Number.isNaN(value) ? '--' : value.toFixed(digits);
}

function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}
