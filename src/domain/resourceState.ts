import type { SettingsBundle } from './settingsModel';

/** Where the value currently rendered for a resource came from. */
export type ResourceSource = 'gateway' | 'cache' | 'default' | 'demo';

export interface ResourceState {
  source: ResourceSource;
  /** False when the UI is only showing a fallback it must not write back. */
  writable: boolean;
  message: string | null;
}

export type SettingsResourceKey = keyof SettingsBundle;
export type SettingsResourceStates = Record<SettingsResourceKey, ResourceState>;

export const SETTINGS_RESOURCE_KEYS: readonly SettingsResourceKey[] = [
  'rea',
  'de1',
  'advanced',
  'calibration',
  'presence',
  'display',
  'skins',
  'devices',
  'plugins',
  'schedules'
];

export function settingsResourceStates(
  source: Extract<ResourceSource, 'gateway' | 'demo'>
): SettingsResourceStates {
  return Object.fromEntries(
    SETTINGS_RESOURCE_KEYS.map((key) => [
      key,
      { source, writable: true, message: null } satisfies ResourceState
    ])
  ) as unknown as SettingsResourceStates;
}

export function unavailableSettingsResources(states: SettingsResourceStates): SettingsResourceKey[] {
  return SETTINGS_RESOURCE_KEYS.filter((key) => !states[key].writable);
}

export function settingsResourceWritable(
  states: SettingsResourceStates | null,
  key: SettingsResourceKey
): boolean {
  // Null means the endpoint bundle is still unverified/loading. Demo mode has
  // an explicit writable provenance map, so there is no reason to fail open.
  return states?.[key].writable === true;
}
