import {
  getSyncedItem,
  hotWaterStopModeKey as hotWaterStopModeStorageKey,
  hotWaterWeightTargetKey as hotWaterWeightTargetStorageKey,
  machinePresetLabelsKey as machinePresetLabelsStorageKey,
  machinePresetValuesKey as machinePresetValuesStorageKey,
  setSyncedItem
} from './settingsStore';

export type HotWaterStopMode = 'volume' | 'time';
export type MachinePresetValueOverrides = Record<string, Record<string, number>>;

export function readMachinePresetLabels(): Record<string, string> {
  try {
    const raw = getSyncedItem(machinePresetLabelsStorageKey);
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    );
  } catch {
    return {};
  }
}

export function writeMachinePresetLabels(labels: Record<string, string>): void {
  setSyncedItem(machinePresetLabelsStorageKey, JSON.stringify(labels));
}

export function readMachinePresetValues(): MachinePresetValueOverrides {
  try {
    const raw = getSyncedItem(machinePresetValuesStorageKey);
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([key, value]) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
        const numericValues = Object.fromEntries(
          Object.entries(value).filter((entry): entry is [string, number] => (
            typeof entry[1] === 'number' && Number.isFinite(entry[1])
          ))
        );
        return Object.keys(numericValues).length > 0 ? [[key, numericValues]] : [];
      })
    );
  } catch {
    return {};
  }
}

export function writeMachinePresetValues(values: MachinePresetValueOverrides): void {
  setSyncedItem(machinePresetValuesStorageKey, JSON.stringify(values));
}

export function readHotWaterStopMode(): HotWaterStopMode {
  try {
    const value = getSyncedItem(hotWaterStopModeStorageKey);
    return value === 'time' ? 'time' : 'volume';
  } catch {
    return 'volume';
  }
}

export function writeHotWaterStopMode(mode: HotWaterStopMode): void {
  setSyncedItem(hotWaterStopModeStorageKey, mode);
}

export function readHotWaterWeightTarget(): number | null {
  try {
    const value = Number(getSyncedItem(hotWaterWeightTargetStorageKey));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

export function writeHotWaterWeightTarget(value: number | null | undefined): void {
  if (value == null || !Number.isFinite(value) || value <= 0) return;
  setSyncedItem(hotWaterWeightTargetStorageKey, String(value));
}
