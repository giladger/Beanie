import type { De1MachineSettings, HotWaterData, RinseData, SteamSettings, Workflow } from '../api/types';
import type { SettingsBundle } from '../domain/settingsModel';
import type { HotWaterStopMode, MachinePresetValueOverrides } from '../domain/machinePreferences';
import {
  DEFAULT_HOT_WATER,
  DEFAULT_RINSE,
  DEFAULT_STEAM,
  FLUSH_PRESETS,
  HOT_WATER_PRESETS,
  STEAM_PRESETS,
  clampFlush,
  clampHotWater,
  clampSteam,
  matchingPreset,
  type WaterControlCapabilities,
  type WaterPreset
} from '../domain/waterSettings';
import { hotWaterDataForGateway } from './machineExecutionController';

export type MachinePresetName = 'steamPreset' | 'waterPreset' | 'flushPreset';
export type MachineValueField =
  | 'steamFlow'
  | 'steamTemp'
  | 'steamDuration'
  | 'steamStopTemp'
  | 'waterTemp'
  | 'waterFlow'
  | 'waterVolume'
  | 'waterDuration'
  | 'flushDuration'
  | 'flushFlow'
  | 'flushTemp';

export interface MachineWorkflowPlanInput {
  workflow: Workflow | null;
  steamSettings: SteamSettings;
  hotWaterData: HotWaterData;
  rinseData: RinseData;
  currentMachineSettings: De1MachineSettings | null;
  hotWaterStopMode: HotWaterStopMode;
  status: string;
}

export interface MachineWorkflowPlan {
  workflow: Workflow;
  workflowForGateway: Workflow;
  machineSettings: De1MachineSettings;
  machinePatch: Partial<De1MachineSettings>;
  hotWaterStopMode: HotWaterStopMode;
  hotWaterWeightTarget: number | null | undefined;
  savingStatus: string;
  successStatus: string;
}

export type PersistMachineWorkflowResult =
  | {
      type: 'demo';
      status: string;
    }
  | {
      type: 'saved';
      workflow: Workflow;
      directMachineSaved: boolean;
      status: string;
    }
  | {
      type: 'failed';
      error: unknown;
      status: 'Machine settings save failed';
    };

export interface PersistMachineWorkflowDeps {
  writeHotWaterWeightTarget(value: number | null | undefined): void;
  updateWorkflow(workflow: Workflow): Promise<Workflow>;
  updateMachineSettings(patch: Partial<De1MachineSettings>): Promise<unknown>;
  logDirectMachineUpdateFailure(error: unknown): void;
}

export interface MachineSettingsSet {
  steamSettings: SteamSettings;
  hotWaterData: HotWaterData;
  rinseData: RinseData;
}

export interface ApplyMachinePresetInput extends MachineSettingsSet {
  name: string;
  presetId: string;
  machinePresetValues: MachinePresetValueOverrides;
  capabilities: WaterControlCapabilities;
}

export interface ApplyMachinePresetPlan extends MachineSettingsSet {
  applied: boolean;
  status: 'Machine preset saved';
}

export interface ApplyMachineValueInput extends MachineSettingsSet {
  name: string;
  value: number | null;
  machinePresetValues: MachinePresetValueOverrides;
  capabilities: WaterControlCapabilities;
}

export interface ApplyMachineValuePlan extends MachineSettingsSet {
  applied: boolean;
  machinePresetValues: MachinePresetValueOverrides | null;
  status: 'Machine setting saved';
}

export interface SteamPurgeModePlan {
  nextMode: number;
  machineSettings: De1MachineSettings;
  settingsBundle: SettingsBundle | null;
  savingStatus: 'Steam purge setting...';
  demoStatus: 'Steam purge setting saved (demo)';
  successStatus: 'Steam purge setting saved';
  failedStatus: 'Steam purge setting failed';
}

export interface SteamPurgeModeDeps {
  updateMachineSettings(patch: Partial<De1MachineSettings>): Promise<unknown>;
  readMachineSettings(): Promise<De1MachineSettings>;
}

export function buildMachineWorkflowPlan(input: MachineWorkflowPlanInput): MachineWorkflowPlan {
  const workflow: Workflow = {
    ...(input.workflow ?? {}),
    steamSettings: input.steamSettings,
    hotWaterData: input.hotWaterData,
    rinseData: input.rinseData
  };
  const gatewayHotWaterData = hotWaterDataForGateway(
    input.hotWaterData,
    input.hotWaterStopMode
  );
  return {
    workflow,
    workflowForGateway: { ...workflow, hotWaterData: gatewayHotWaterData },
    machineSettings: machineSettingsFromWorkflow(
      input.steamSettings,
      input.hotWaterData,
      input.rinseData,
      input.currentMachineSettings
    ),
    machinePatch: machineSettingsPatchFromWorkflow(input.steamSettings, input.hotWaterData, input.rinseData),
    hotWaterStopMode: input.hotWaterStopMode,
    hotWaterWeightTarget: input.hotWaterData.volume,
    savingStatus: `${input.status}...`,
    successStatus: input.status
  };
}

export function applyMachinePresetPlan(input: ApplyMachinePresetInput): ApplyMachinePresetPlan {
  const name = machinePresetName(input.name);
  if (!name) return unchangedPresetPlan(input);
  const presets = presetsForName(name, input.machinePresetValues);
  const preset = presets.find((item) => item.id === input.presetId);
  if (!preset) return unchangedPresetPlan(input);

  if (name === 'steamPreset') {
    return {
      applied: true,
      status: 'Machine preset saved',
      steamSettings: clampSteam({ ...DEFAULT_STEAM, ...preset.values }, input.capabilities),
      hotWaterData: input.hotWaterData,
      rinseData: input.rinseData
    };
  }
  if (name === 'waterPreset') {
    return {
      applied: true,
      status: 'Machine preset saved',
      steamSettings: input.steamSettings,
      hotWaterData: clampHotWater({ ...DEFAULT_HOT_WATER, ...preset.values }, input.capabilities),
      rinseData: input.rinseData
    };
  }
  return {
    applied: true,
    status: 'Machine preset saved',
    steamSettings: input.steamSettings,
    hotWaterData: input.hotWaterData,
    rinseData: clampFlush({ ...DEFAULT_RINSE, ...preset.values }, input.capabilities)
  };
}

export function applyMachineValuePlan(input: ApplyMachineValueInput): ApplyMachineValuePlan {
  if (input.value == null) return unchangedValuePlan(input);
  const fieldName = machineValueFieldName(input.name);
  if (!fieldName) return unchangedValuePlan(input);

  const selectedSteamPreset = matchingPreset(
    input.steamSettings,
    machinePresetsWithValues('steamPreset', STEAM_PRESETS, input.machinePresetValues)
  );
  const selectedWaterPreset = matchingPreset(
    input.hotWaterData,
    machinePresetsWithValues('waterPreset', HOT_WATER_PRESETS, input.machinePresetValues)
  );
  const selectedFlushPreset = matchingPreset(
    input.rinseData,
    machinePresetsWithValues('flushPreset', FLUSH_PRESETS, input.machinePresetValues)
  );

  const steamSettings = { ...input.steamSettings };
  const hotWaterData = { ...input.hotWaterData };
  const rinseData = { ...input.rinseData };
  applyMachineValue(fieldName, input.value, steamSettings, hotWaterData, rinseData);
  const nextSteamSettings = clampSteam(steamSettings, input.capabilities);
  const nextHotWaterData = clampHotWater(hotWaterData, input.capabilities);
  const nextRinseData = clampFlush(rinseData, input.capabilities);

  return {
    applied: true,
    status: 'Machine setting saved',
    steamSettings: nextSteamSettings,
    hotWaterData: nextHotWaterData,
    rinseData: nextRinseData,
    machinePresetValues: machinePresetValuesAfterEdit({
      fieldName,
      selectedSteamPreset,
      selectedWaterPreset,
      selectedFlushPreset,
      steamSettings: nextSteamSettings,
      hotWaterData: nextHotWaterData,
      rinseData: nextRinseData,
      currentValues: input.machinePresetValues
    })
  };
}

export function machinePresetLabelKey(name: string, presetId: string): string {
  return `${name}:${presetId}`;
}

export function machinePresetsWithValues<T extends object>(
  name: string,
  presets: WaterPreset<T>[],
  valueOverrides: MachinePresetValueOverrides
): WaterPreset<T>[] {
  return presets.map((preset) => {
    const overrides = valueOverrides[machinePresetLabelKey(name, preset.id)];
    if (!overrides) return preset;
    return {
      ...preset,
      values: { ...preset.values, ...overrides }
    };
  });
}

export function numericPresetValues(values: object): Record<string, number> {
  return Object.fromEntries(
    Object.entries(values).filter((entry): entry is [string, number] => (
      typeof entry[1] === 'number' && Number.isFinite(entry[1])
    ))
  );
}

export function normalizeSteamPurgeMode(mode: number | null | undefined): number {
  if (mode === 0 || mode === 1) return mode;
  return 0;
}

export function steamPurgeModePlan(
  mode: number,
  machineSettings: De1MachineSettings | null,
  settingsBundle: SettingsBundle | null
): SteamPurgeModePlan {
  const nextMode = normalizeSteamPurgeMode(mode);
  return {
    nextMode,
    machineSettings: { ...(machineSettings ?? {}), steamPurgeMode: nextMode },
    settingsBundle: settingsBundle
      ? { ...settingsBundle, de1: { ...settingsBundle.de1, steamPurgeMode: nextMode } }
      : settingsBundle,
    savingStatus: 'Steam purge setting...',
    demoStatus: 'Steam purge setting saved (demo)',
    successStatus: 'Steam purge setting saved',
    failedStatus: 'Steam purge setting failed'
  };
}

export async function updateSteamPurgeModeAndReadBack(
  nextMode: number,
  deps: SteamPurgeModeDeps
): Promise<De1MachineSettings> {
  const normalizedMode = normalizeSteamPurgeMode(nextMode);
  await deps.updateMachineSettings({ steamPurgeMode: normalizedMode });
  const settings = await deps.readMachineSettings();
  const readBackMode = settings.steamPurgeMode;
  if (readBackMode !== 0 && readBackMode !== 1) {
    throw new Error('Steam purge mode read-back was missing');
  }
  if (readBackMode !== normalizedMode) {
    throw new Error(`Steam purge mode read back as ${readBackMode}, expected ${normalizedMode}`);
  }
  return settings;
}

export async function persistMachineWorkflowPlan(
  plan: MachineWorkflowPlan,
  demo: boolean,
  deps: PersistMachineWorkflowDeps
): Promise<PersistMachineWorkflowResult> {
  const writeHotWaterWeightTarget = (): void => {
    if (plan.hotWaterStopMode === 'volume') deps.writeHotWaterWeightTarget(plan.hotWaterWeightTarget);
  };
  if (demo) {
    writeHotWaterWeightTarget();
    return { type: 'demo', status: `${plan.successStatus} (demo)` };
  }

  try {
    const saved = await deps.updateWorkflow(plan.workflowForGateway);
    writeHotWaterWeightTarget();
    let directMachineSaved = true;
    try {
      await deps.updateMachineSettings(plan.machinePatch);
    } catch (error) {
      directMachineSaved = false;
      deps.logDirectMachineUpdateFailure(error);
    }
    return {
      type: 'saved',
      workflow: { ...saved, steamSettings: plan.workflow.steamSettings, hotWaterData: plan.workflow.hotWaterData, rinseData: plan.workflow.rinseData },
      directMachineSaved,
      status: directMachineSaved ? plan.successStatus : `${plan.successStatus}; direct machine update failed`
    };
  } catch (error) {
    return { type: 'failed', error, status: 'Machine settings save failed' };
  }
}

export function machineSettingsFromWorkflow(
  steam: SteamSettings,
  water: HotWaterData,
  flush: RinseData,
  current: De1MachineSettings | null
): De1MachineSettings {
  return {
    ...(current ?? {}),
    steamFlow: steam.flow,
    hotWaterFlow: water.flow,
    flushTemp: flush.targetTemperature,
    flushFlow: flush.flow,
    flushTimeout: flush.duration
  };
}

export function machineSettingsPatchFromWorkflow(
  steam: SteamSettings,
  water: HotWaterData,
  flush: RinseData
): Partial<De1MachineSettings> {
  return {
    steamFlow: steam.flow,
    hotWaterFlow: water.flow,
    flushTemp: flush.targetTemperature,
    flushFlow: flush.flow,
    flushTimeout: flush.duration
  };
}

function machinePresetName(name: string): MachinePresetName | null {
  if (name === 'steamPreset' || name === 'waterPreset' || name === 'flushPreset') return name;
  return null;
}

function presetsForName(
  name: MachinePresetName,
  valueOverrides: MachinePresetValueOverrides
): WaterPreset<SteamSettings>[] | WaterPreset<HotWaterData>[] | WaterPreset<RinseData>[] {
  if (name === 'steamPreset') return machinePresetsWithValues(name, STEAM_PRESETS, valueOverrides);
  if (name === 'waterPreset') return machinePresetsWithValues(name, HOT_WATER_PRESETS, valueOverrides);
  return machinePresetsWithValues(name, FLUSH_PRESETS, valueOverrides);
}

function unchangedPresetPlan(input: ApplyMachinePresetInput): ApplyMachinePresetPlan {
  return {
    applied: false,
    status: 'Machine preset saved',
    steamSettings: input.steamSettings,
    hotWaterData: input.hotWaterData,
    rinseData: input.rinseData
  };
}

function unchangedValuePlan(input: ApplyMachineValueInput): ApplyMachineValuePlan {
  return {
    applied: false,
    status: 'Machine setting saved',
    steamSettings: input.steamSettings,
    hotWaterData: input.hotWaterData,
    rinseData: input.rinseData,
    machinePresetValues: null
  };
}

function applyMachineValue(
  name: MachineValueField,
  value: number,
  steamSettings: SteamSettings,
  hotWaterData: HotWaterData,
  rinseData: RinseData
): void {
  if (name === 'steamFlow') steamSettings.flow = value;
  if (name === 'steamTemp') steamSettings.targetTemperature = value;
  if (name === 'steamDuration') steamSettings.duration = value;
  if (name === 'steamStopTemp') steamSettings.stopAtTemperature = value;
  if (name === 'waterTemp') hotWaterData.targetTemperature = value;
  if (name === 'waterFlow') hotWaterData.flow = value;
  if (name === 'waterVolume') hotWaterData.volume = value;
  if (name === 'waterDuration') hotWaterData.duration = value;
  if (name === 'flushDuration') rinseData.duration = value;
  if (name === 'flushFlow') rinseData.flow = value;
  if (name === 'flushTemp') rinseData.targetTemperature = value;
}

function machineValueFieldName(name: string): MachineValueField | null {
  if (
    name === 'steamFlow' ||
    name === 'steamTemp' ||
    name === 'steamDuration' ||
    name === 'steamStopTemp' ||
    name === 'waterTemp' ||
    name === 'waterFlow' ||
    name === 'waterVolume' ||
    name === 'waterDuration' ||
    name === 'flushDuration' ||
    name === 'flushFlow' ||
    name === 'flushTemp'
  ) {
    return name;
  }
  return null;
}

function machinePresetValuesAfterEdit(options: {
  fieldName: string;
  selectedSteamPreset: string;
  selectedWaterPreset: string;
  selectedFlushPreset: string;
  steamSettings: SteamSettings;
  hotWaterData: HotWaterData;
  rinseData: RinseData;
  currentValues: MachinePresetValueOverrides;
}): MachinePresetValueOverrides | null {
  let key: string | null = null;
  let values: object | null = null;
  if (options.fieldName.startsWith('steam') && options.selectedSteamPreset !== 'custom') {
    key = machinePresetLabelKey('steamPreset', options.selectedSteamPreset);
    values = options.steamSettings;
  }
  if (options.fieldName.startsWith('water') && options.selectedWaterPreset !== 'custom') {
    key = machinePresetLabelKey('waterPreset', options.selectedWaterPreset);
    values = options.hotWaterData;
  }
  if (options.fieldName.startsWith('flush') && options.selectedFlushPreset !== 'custom') {
    key = machinePresetLabelKey('flushPreset', options.selectedFlushPreset);
    values = options.rinseData;
  }
  if (!key || !values) return null;
  return {
    ...options.currentValues,
    [key]: numericPresetValues(values)
  };
}
