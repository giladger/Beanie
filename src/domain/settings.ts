import type { MachineSnapshot, ScaleSnapshot } from '../api/types';
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
}

export interface BuildSettingsShellModelOptions {
  query: string;
  preferences: SettingsPreferences;
  demo: boolean;
  loading: boolean;
  status: string;
  gatewayHost: string;
  machine: MachineSnapshot | null;
  scale: ScaleSnapshot | null;
  machineRefillLevelMm: number | null;
}

const themeKey = 'beanie:settings:theme';
const uiScaleKey = 'beanie:settings:ui-scale';
const waterSoftKey = 'beanie:settings:water-soft-ml';
const preservedResetKeys = new Set([
  themeKey,
  uiScaleKey,
  waterSoftKey
]);

export function readSettingsPreferences(): SettingsPreferences {
  return {
    theme: readEnum(themeKey, THEME_PREFERENCES, 'espresso'),
    uiScale: readEnum(uiScaleKey, ['compact', 'standard', 'large'], 'standard'),
    waterSoftLimitMl: readNonNegativeNumber(waterSoftKey, DEFAULT_WATER_SOFT_ML)
  };
}

export function writeSettingsPreferences(next: SettingsPreferences): void {
  localStorage.setItem(themeKey, next.theme);
  localStorage.setItem(uiScaleKey, next.uiScale);
  localStorage.setItem(waterSoftKey, String(next.waterSoftLimitMl));
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
    machineRefillLevelMm: options.machineRefillLevelMm
  };
}

export function listResettableBeanieKeys(): string[] {
  return Object.keys(localStorage)
    .filter((key) => key.startsWith('beanie:') && !preservedResetKeys.has(key))
    .sort();
}

export function resetBeanieCache(): number {
  const keys = listResettableBeanieKeys();
  keys.forEach((key) => localStorage.removeItem(key));
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

function readEnum<T extends string>(key: string, values: readonly T[], fallback: T): T {
  const stored = localStorage.getItem(key);
  return values.includes(stored as T) ? (stored as T) : fallback;
}

function readNonNegativeNumber(key: string, fallback: number): number {
  const stored = localStorage.getItem(key);
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
