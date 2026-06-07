import type { HotWaterData, MachineSnapshot, MachineState, RinseData, SteamSettings, Workflow } from '../api/types';
import type { HotWaterStopMode } from '../domain/machinePreferences';
import {
  machineServiceState,
  type HotWaterWeightStopController
} from '../domain/machineService';
import {
  paddedSteamDurationSeconds,
  type MachineServiceState
} from '../domain/timedSteamStop';
import { DEFAULT_HOT_WATER } from '../domain/waterSettings';

export const DEFAULT_HOT_WATER_WEIGHT_LOOKAHEAD_SECONDS = 0.3;
export const HOT_WATER_WEIGHT_NATIVE_HEADROOM_SECONDS = 30;
export const HOT_WATER_WEIGHT_NATIVE_VOLUME_ML = 500;

export interface HotWaterWeightStopTarget {
  targetWeight: number;
  configuredFlow: number;
}

export interface MachineServiceWorkflowRestore {
  steamSettings: SteamSettings;
  hotWaterData: HotWaterData;
  rinseData: RinseData;
}

export type MachineActionPreflight =
  | { type: 'blocked-no-scale' }
  | { type: 'blocked-water' }
  | {
      type: 'ready';
      service: MachineServiceState | null;
      hotWaterWeightStop: HotWaterWeightStopTarget | null;
      status: string;
    };

export interface MachineActionPreflightInput {
  state: MachineState;
  skipScaleCheck: boolean;
  noScaleBlocked: boolean;
  waterAlertHard: boolean;
  hotWaterStopMode: HotWaterStopMode;
  scaleConnected: boolean;
  hotWaterData: HotWaterData;
}

export function machineActionPreflight(input: MachineActionPreflightInput): MachineActionPreflight {
  if (input.state === 'espresso' && !input.skipScaleCheck && input.noScaleBlocked) {
    return { type: 'blocked-no-scale' };
  }
  if (input.state === 'espresso' && input.waterAlertHard) {
    return { type: 'blocked-water' };
  }
  return {
    type: 'ready',
    service: machineServiceState(input.state),
    hotWaterWeightStop: input.state === 'hotWater'
      ? hotWaterWeightStopTarget(input.hotWaterData, input.hotWaterStopMode, input.scaleConnected)
      : null,
    status: machineActionStatus(input.state, 'sending')
  };
}

export function hotWaterWeightStopTarget(
  water: HotWaterData,
  hotWaterStopMode: HotWaterStopMode,
  hotWaterScaleConnected: boolean
): HotWaterWeightStopTarget | null {
  if (hotWaterStopMode !== 'volume') return null;
  if (!hotWaterScaleConnected) return null;
  const targetWeight = positiveNumber(water.volume);
  if (targetWeight == null) return null;
  return {
    targetWeight,
    configuredFlow: positiveNumber(water.flow) ?? 0
  };
}

export function hotWaterDataForNativeWorkflow(
  water: HotWaterData,
  hotWaterStopMode: HotWaterStopMode,
  hotWaterScaleConnected: boolean
): HotWaterData {
  if (hotWaterStopMode !== 'volume' || !hotWaterScaleConnected) return water;
  const nativeDuration = hotWaterWeightNativeDuration(water);
  if (nativeDuration == null) return water;
  const currentDuration = positiveNumber(water.duration) ?? 0;
  const duration = Math.max(currentDuration, nativeDuration);
  if (water.volume === HOT_WATER_WEIGHT_NATIVE_VOLUME_ML && water.duration === duration) return water;
  return {
    ...water,
    volume: HOT_WATER_WEIGHT_NATIVE_VOLUME_ML,
    duration
  };
}

export function hotWaterWeightNativeDuration(water: HotWaterData): number | null {
  const targetWeight = positiveNumber(water.volume);
  const flow = positiveNumber(water.flow) ?? positiveNumber(DEFAULT_HOT_WATER.flow);
  if (targetWeight == null || flow == null) return null;
  return Math.min(180, Math.ceil(targetWeight / flow + HOT_WATER_WEIGHT_NATIVE_HEADROOM_SECONDS));
}

export function createHotWaterWeightStopController(
  target: HotWaterWeightStopTarget,
  tareRequestedAtMs: number | null,
  armedAtMs: number
): HotWaterWeightStopController {
  return {
    ...target,
    armedAtMs,
    tareRequestedAtMs,
    activeSeen: false,
    stopRequested: false
  };
}

export type TareAndArmHotWaterWeightStopResult =
  | { type: 'armed'; controller: HotWaterWeightStopController }
  | { type: 'ignored' }
  | { type: 'failed'; error: unknown; status: 'Hot water scale tare failed' };

export async function tareAndArmHotWaterWeightStop(
  input: {
    target: HotWaterWeightStopTarget;
    shouldArm(): boolean;
  },
  deps: {
    tareScale(): Promise<void>;
    nowMs(): number;
  }
): Promise<TareAndArmHotWaterWeightStopResult> {
  try {
    await deps.tareScale();
    if (!input.shouldArm()) return { type: 'ignored' };
    return {
      type: 'armed',
      controller: createHotWaterWeightStopController(input.target, deps.nowMs(), deps.nowMs())
    };
  } catch (error) {
    return { type: 'failed', error, status: 'Hot water scale tare failed' };
  }
}

export type StopHotWaterAtWeightResult =
  | { type: 'demo'; status: 'Demo water stopped' }
  | { type: 'requested'; status: string }
  | { type: 'failed'; error: unknown; status: 'Hot water stop failed' };

export async function stopHotWaterAtWeight(
  input: {
    demo: boolean;
    weight: number;
    projectedWeight: number;
  },
  deps: {
    requestState(state: MachineState): Promise<void>;
  }
): Promise<StopHotWaterAtWeightResult> {
  if (input.demo) return { type: 'demo', status: 'Demo water stopped' };
  try {
    await deps.requestState('idle');
    return {
      type: 'requested',
      status: `Stopping at ${formatNumber(input.weight, 1)} g (${formatNumber(input.projectedWeight, 1)} g projected)`
    };
  } catch (error) {
    return { type: 'failed', error, status: 'Hot water stop failed' };
  }
}

export type SendMachineActionCommandResult =
  | {
      type: 'sent';
      status: string;
      restore: MachineServiceWorkflowRestore | null;
      hotWaterWeightStop: HotWaterWeightStopController | null;
    }
  | {
      type: 'failed';
      error: unknown;
      status: 'Machine command failed';
      noScaleBlocked: boolean;
      clearHotWaterWeightStop: boolean;
      restore: MachineServiceWorkflowRestore | null;
    };

export async function sendMachineActionCommand(
  input: {
    state: MachineState;
    hotWaterWeightStop: HotWaterWeightStopTarget | null;
    workflow: Workflow | null;
    steamSettings: SteamSettings;
    hotWaterData: HotWaterData;
    rinseData: RinseData;
    twoTapSteamStop: boolean;
  },
  deps: {
    updateWorkflow(workflow: Workflow): Promise<Workflow>;
    tareScale(): Promise<void>;
    requestState(state: MachineState): Promise<void>;
    nowMs(): number;
    isNoScaleShotBlockError(error: unknown): boolean;
  }
): Promise<SendMachineActionCommandResult> {
  let restore: MachineServiceWorkflowRestore | null = null;
  try {
    if (input.state === 'steam') {
      const prepared = await prepareTimedSteamHeadroom({
        workflow: input.workflow,
        twoTapStop: input.twoTapSteamStop,
        steamSettings: input.steamSettings,
        hotWaterData: input.hotWaterData,
        rinseData: input.rinseData
      }, deps);
      if (prepared.type === 'failed') throw prepared.error;
      if (prepared.type === 'prepared') restore = prepared.restore;
    }

    let hotWaterWeightStop: HotWaterWeightStopController | null = null;
    if (input.state === 'hotWater' && input.hotWaterWeightStop) {
      const tare = await tareAndArmHotWaterWeightStop({
        target: input.hotWaterWeightStop,
        shouldArm: () => true
      }, deps);
      if (tare.type === 'failed') throw tare.error;
      hotWaterWeightStop = tare.type === 'armed' ? tare.controller : null;
    }

    await deps.requestState(input.state);
    return {
      type: 'sent',
      status: machineActionStatus(input.state, 'sent'),
      restore,
      hotWaterWeightStop
    };
  } catch (error) {
    return {
      type: 'failed',
      error,
      status: 'Machine command failed',
      noScaleBlocked: input.state === 'espresso' && deps.isNoScaleShotBlockError(error),
      clearHotWaterWeightStop: input.state === 'hotWater',
      restore
    };
  }
}

export function captureMachineServiceWorkflowRestore(input: {
  steamSettings: SteamSettings;
  hotWaterData: HotWaterData;
  rinseData: RinseData;
}): MachineServiceWorkflowRestore {
  return {
    steamSettings: { ...input.steamSettings },
    hotWaterData: { ...input.hotWaterData },
    rinseData: { ...input.rinseData }
  };
}

export type TimedSteamHeadroomPlan =
  | { type: 'none' }
  | {
      type: 'pad';
      workflow: Workflow;
      restore: MachineServiceWorkflowRestore;
      paddedDuration: number;
    };

export function timedSteamHeadroomPlan(input: {
  workflow: Workflow | null;
  twoTapStop: boolean;
  steamSettings: SteamSettings;
  hotWaterData: HotWaterData;
  rinseData: RinseData;
}): TimedSteamHeadroomPlan {
  if (input.twoTapStop || input.workflow == null) return { type: 'none' };
  const userDuration = positiveNumber(input.steamSettings.duration);
  const paddedDuration = paddedSteamDurationSeconds(userDuration);
  if (paddedDuration == null || userDuration == null || paddedDuration <= userDuration) {
    return { type: 'none' };
  }
  return {
    type: 'pad',
    paddedDuration,
    restore: captureMachineServiceWorkflowRestore(input),
    workflow: {
      ...input.workflow,
      steamSettings: { ...input.steamSettings, duration: paddedDuration }
    }
  };
}

export type PrepareTimedSteamHeadroomResult =
  | { type: 'none' }
  | { type: 'prepared'; restore: MachineServiceWorkflowRestore }
  | { type: 'failed'; error: unknown };

export async function prepareTimedSteamHeadroom(
  input: {
    workflow: Workflow | null;
    twoTapStop: boolean;
    steamSettings: SteamSettings;
    hotWaterData: HotWaterData;
    rinseData: RinseData;
  },
  deps: {
    updateWorkflow(workflow: Workflow): Promise<Workflow>;
  }
): Promise<PrepareTimedSteamHeadroomResult> {
  const plan = timedSteamHeadroomPlan(input);
  if (plan.type === 'none') return { type: 'none' };
  try {
    await deps.updateWorkflow(plan.workflow);
    return { type: 'prepared', restore: plan.restore };
  } catch (error) {
    return { type: 'failed', error };
  }
}

export function extendedMachineServiceWorkflow(input: {
  workflow: Workflow;
  service: MachineServiceState;
  steamSettings: SteamSettings;
  hotWaterData: HotWaterData;
  rinseData: RinseData;
  nextTargetSeconds: number;
  twoTapSteamStop: boolean;
}): Workflow {
  const nextWorkflow: Workflow = {
    ...input.workflow,
    steamSettings: input.steamSettings,
    hotWaterData: input.hotWaterData,
    rinseData: input.rinseData
  };
  if (input.service === 'steam') {
    nextWorkflow.steamSettings = {
      ...input.steamSettings,
      duration: input.twoTapSteamStop
        ? input.nextTargetSeconds
        : paddedSteamDurationSeconds(input.nextTargetSeconds) ?? input.nextTargetSeconds
    };
  } else if (input.service === 'hotWater') {
    nextWorkflow.hotWaterData = { ...input.hotWaterData, duration: input.nextTargetSeconds };
  } else {
    nextWorkflow.rinseData = { ...input.rinseData, duration: input.nextTargetSeconds };
  }
  return nextWorkflow;
}

export function restoredMachineServiceWorkflow(
  workflow: Workflow | null,
  restore: MachineServiceWorkflowRestore
): Workflow {
  return {
    ...(workflow ?? {}),
    steamSettings: restore.steamSettings,
    hotWaterData: restore.hotWaterData,
    rinseData: restore.rinseData
  };
}

export type RestoreMachineServiceWorkflowResult =
  | { type: 'skipped' }
  | { type: 'restored' }
  | { type: 'failed'; error: unknown; status: 'Machine service restore failed' };

export async function restoreMachineServiceWorkflowAfterEnd(
  input: {
    restore: MachineServiceWorkflowRestore | null;
    workflow: Workflow | null;
    demo: boolean;
  },
  deps: {
    updateWorkflow(workflow: Workflow): Promise<Workflow>;
  }
): Promise<RestoreMachineServiceWorkflowResult> {
  if (input.restore == null || input.demo) return { type: 'skipped' };
  try {
    await deps.updateWorkflow(restoredMachineServiceWorkflow(input.workflow, input.restore));
    return { type: 'restored' };
  } catch (error) {
    return { type: 'failed', error, status: 'Machine service restore failed' };
  }
}

export function optimisticMachineSnapshot(
  machine: MachineSnapshot | null,
  state: MachineState
): MachineSnapshot {
  const now = new Date().toISOString();
  return {
    timestamp: now,
    state: { state },
    flow: machine?.flow ?? 0,
    pressure: machine?.pressure ?? 0,
    targetFlow: machine?.targetFlow ?? 0,
    targetPressure: machine?.targetPressure ?? 0,
    mixTemperature: machine?.mixTemperature ?? 0,
    groupTemperature: machine?.groupTemperature ?? 0,
    targetMixTemperature: machine?.targetMixTemperature ?? 0,
    targetGroupTemperature: machine?.targetGroupTemperature ?? 0,
    profileFrame: machine?.profileFrame ?? 0,
    steamTemperature: machine?.steamTemperature ?? 0
  };
}

export function machineActionStatus(
  state: MachineState,
  phase: 'sending' | 'sent' | 'demo'
): string {
  const label = machineStateLabel(state);
  if (phase === 'sending') return state === 'idle' ? 'Stopping machine' : `Starting ${label}`;
  if (phase === 'demo') return state === 'idle' ? 'Demo stopped' : `Demo ${label}`;
  return state === 'idle' ? 'Machine stopped' : `${label} started`;
}

function machineStateLabel(state: MachineState): string {
  switch (state) {
    case 'espresso':
      return 'shot';
    case 'hotWater':
      return 'water';
    default:
      return state;
  }
}

function positiveNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function formatNumber(value: number | null | undefined, digits: number): string {
  return value == null || Number.isNaN(value) ? '--' : value.toFixed(digits);
}
