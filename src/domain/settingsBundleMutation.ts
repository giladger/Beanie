import type {
  DisplayPlatformSupport,
  DisplayState,
  PluginInfo,
  WakeSchedule
} from '../api/settings';
import type {
  SettingsBundle,
  SettingsField,
  SettingsGroup
} from './settingsModel';

export type SettingsFieldValue = string | number | boolean | null;

export type DisplayStatePatch = Partial<Omit<DisplayState, 'platformSupported'>> & {
  platformSupported?: Partial<DisplayPlatformSupport>;
};

export type WakeSchedulePatch = Partial<Omit<WakeSchedule, 'id'>>;
export type PluginInfoPatch = Partial<Omit<PluginInfo, 'id'>>;

/**
 * Targeted changes to a Settings bundle.
 *
 * These operations are deliberately narrower than replacing a complete bundle
 * or collection. An optimistic update and its inverse can therefore be applied
 * to the latest bundle without erasing unrelated changes that landed while the
 * remote request was in flight.
 */
export type SettingsBundleMutation =
  | {
      type: 'set-field';
      field: Pick<SettingsField, 'group' | 'key'>;
      value: SettingsFieldValue;
    }
  | { type: 'patch-display'; patch: DisplayStatePatch }
  | { type: 'replace-display'; display: DisplayState }
  | { type: 'add-schedule'; schedule: WakeSchedule; index?: number }
  | { type: 'remove-schedule'; id: string }
  | { type: 'restore-schedule'; schedule: WakeSchedule; index: number }
  | { type: 'update-schedule'; id: string; patch: WakeSchedulePatch }
  | { type: 'set-schedule-enabled'; id: string; enabled: boolean }
  | { type: 'update-plugin'; id: string; patch: PluginInfoPatch }
  | { type: 'set-plugin-loaded'; id: string; loaded: boolean };

export function applySettingsBundleMutation(
  bundle: SettingsBundle,
  mutation: SettingsBundleMutation
): SettingsBundle {
  switch (mutation.type) {
    case 'set-field':
      return setField(bundle, mutation.field.group, mutation.field.key, mutation.value);
    case 'patch-display':
      return patchDisplay(bundle, mutation.patch);
    case 'replace-display':
      return replaceDisplay(bundle, mutation.display);
    case 'add-schedule':
      return addSchedule(bundle, mutation.schedule, mutation.index);
    case 'remove-schedule':
      return removeSchedule(bundle, mutation.id);
    case 'restore-schedule':
      return restoreSchedule(bundle, mutation.schedule, mutation.index);
    case 'update-schedule':
      return updateSchedule(bundle, mutation.id, mutation.patch);
    case 'set-schedule-enabled':
      return updateSchedule(bundle, mutation.id, { enabled: mutation.enabled });
    case 'update-plugin':
      return updatePlugin(bundle, mutation.id, mutation.patch);
    case 'set-plugin-loaded':
      return updatePlugin(bundle, mutation.id, { loaded: mutation.loaded });
  }
}

export function applySettingsBundleMutations(
  bundle: SettingsBundle,
  mutations: readonly SettingsBundleMutation[]
): SettingsBundle {
  return mutations.reduce(applySettingsBundleMutation, bundle);
}

function setField(
  bundle: SettingsBundle,
  group: SettingsGroup,
  key: string,
  value: SettingsFieldValue
): SettingsBundle {
  const current = bundle[group] as unknown as Record<string, unknown>;
  if (Object.is(current[key], value)) return bundle;
  return {
    ...bundle,
    [group]: { ...current, [key]: value }
  } as SettingsBundle;
}

function patchDisplay(bundle: SettingsBundle, patch: DisplayStatePatch): SettingsBundle {
  const platformSupported = patch.platformSupported == null
    ? bundle.display.platformSupported
    : {
        ...bundle.display.platformSupported,
        ...patch.platformSupported
      };
  const next: DisplayState = {
    ...bundle.display,
    ...patch,
    platformSupported
  };
  if (displayEqual(bundle.display, next)) return bundle;
  return { ...bundle, display: next };
}

function replaceDisplay(bundle: SettingsBundle, display: DisplayState): SettingsBundle {
  if (displayEqual(bundle.display, display)) return bundle;
  return {
    ...bundle,
    display: cloneDisplay(display)
  };
}

function addSchedule(
  bundle: SettingsBundle,
  schedule: WakeSchedule,
  index: number | undefined
): SettingsBundle {
  if (!schedule.id || bundle.schedules.some((item) => item.id === schedule.id)) return bundle;
  const schedules = [...bundle.schedules];
  schedules.splice(insertionIndex(index, schedules.length), 0, cloneSchedule(schedule));
  return { ...bundle, schedules };
}

function removeSchedule(bundle: SettingsBundle, id: string): SettingsBundle {
  const index = bundle.schedules.findIndex((schedule) => schedule.id === id);
  if (index < 0) return bundle;
  const schedules = [...bundle.schedules];
  schedules.splice(index, 1);
  return { ...bundle, schedules };
}

function restoreSchedule(
  bundle: SettingsBundle,
  schedule: WakeSchedule,
  index: number
): SettingsBundle {
  if (!schedule.id || bundle.schedules.some((item) => item.id === schedule.id)) return bundle;
  const schedules = [...bundle.schedules];
  schedules.splice(insertionIndex(index, schedules.length), 0, cloneSchedule(schedule));
  return { ...bundle, schedules };
}

function updateSchedule(
  bundle: SettingsBundle,
  id: string,
  patch: WakeSchedulePatch
): SettingsBundle {
  const index = bundle.schedules.findIndex((schedule) => schedule.id === id);
  if (index < 0) return bundle;
  const current = bundle.schedules[index]!;
  const next: WakeSchedule = {
    ...current,
    ...patch,
    id: current.id,
    daysOfWeek: patch.daysOfWeek == null ? current.daysOfWeek : [...patch.daysOfWeek]
  };
  if (scheduleEqual(current, next)) return bundle;
  const schedules = [...bundle.schedules];
  schedules[index] = next;
  return { ...bundle, schedules };
}

function updatePlugin(
  bundle: SettingsBundle,
  id: string,
  patch: PluginInfoPatch
): SettingsBundle {
  const index = bundle.plugins.findIndex((plugin) => plugin.id === id);
  if (index < 0) return bundle;
  const current = bundle.plugins[index]!;
  const next: PluginInfo = { ...current, ...patch, id: current.id };
  if (shallowEqual(current, next)) return bundle;
  const plugins = [...bundle.plugins];
  plugins[index] = next;
  return { ...bundle, plugins };
}

function insertionIndex(index: number | undefined, length: number): number {
  if (index == null || !Number.isFinite(index)) return length;
  return Math.max(0, Math.min(length, Math.trunc(index)));
}

function cloneSchedule(schedule: WakeSchedule): WakeSchedule {
  return { ...schedule, daysOfWeek: [...schedule.daysOfWeek] };
}

function cloneDisplay(display: DisplayState): DisplayState {
  return {
    ...display,
    platformSupported: { ...display.platformSupported }
  };
}

function displayEqual(left: DisplayState, right: DisplayState): boolean {
  return (
    left.wakeLockEnabled === right.wakeLockEnabled &&
    left.wakeLockOverride === right.wakeLockOverride &&
    left.brightness === right.brightness &&
    left.requestedBrightness === right.requestedBrightness &&
    left.lowBatteryBrightnessActive === right.lowBatteryBrightnessActive &&
    left.platformSupported.brightness === right.platformSupported.brightness &&
    left.platformSupported.wakeLock === right.platformSupported.wakeLock
  );
}

function scheduleEqual(left: WakeSchedule, right: WakeSchedule): boolean {
  return (
    left.id === right.id &&
    left.time === right.time &&
    left.enabled === right.enabled &&
    left.keepAwakeFor === right.keepAwakeFor &&
    left.daysOfWeek.length === right.daysOfWeek.length &&
    left.daysOfWeek.every((day, index) => day === right.daysOfWeek[index])
  );
}

function shallowEqual(left: object, right: object): boolean {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  return leftEntries.length === rightEntries.length &&
    leftEntries.every(([key, value]) => Object.is(value, (right as Record<string, unknown>)[key]));
}
