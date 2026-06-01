import type { MachineSnapshot, ScaleSnapshot } from '../api/types';
import { readAutoLoad, writeAutoLoad } from './storage';

export type ThemePreference = 'system' | 'dark' | 'light';
export type UIScalePreference = 'compact' | 'standard' | 'large';

export interface SettingsPreferences {
  theme: ThemePreference;
  uiScale: UIScalePreference;
  autoLoad: boolean;
  visualizerUpload: boolean;
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
}

const themeKey = 'beanie:settings:theme';
const uiScaleKey = 'beanie:settings:ui-scale';
const visualizerUploadKey = 'beanie:settings:visualizer-upload';
const preservedResetKeys = new Set([
  'beanie:auto-load',
  themeKey,
  uiScaleKey,
  visualizerUploadKey
]);

export function readSettingsPreferences(autoLoad = readAutoLoad()): SettingsPreferences {
  return {
    theme: readEnum(themeKey, ['system', 'dark', 'light'], 'dark'),
    uiScale: readEnum(uiScaleKey, ['compact', 'standard', 'large'], 'standard'),
    autoLoad,
    visualizerUpload: localStorage.getItem(visualizerUploadKey) === '1'
  };
}

export function writeSettingsPreferences(next: SettingsPreferences): void {
  localStorage.setItem(themeKey, next.theme);
  localStorage.setItem(uiScaleKey, next.uiScale);
  localStorage.setItem(visualizerUploadKey, next.visualizerUpload ? '1' : '0');
  writeAutoLoad(next.autoLoad);
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
    cacheKeyCount: listResettableBeanieKeys().length
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

function formatNumber(value: number | null | undefined, digits: number): string {
  return value == null || Number.isNaN(value) ? '--' : value.toFixed(digits);
}

function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}
