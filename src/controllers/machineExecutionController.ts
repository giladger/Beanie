import type { HotWaterData, MachineSnapshot, MachineState, RinseData, SteamSettings, Workflow } from '../api/types';
import type { HotWaterStopMode } from '../domain/machinePreferences';
import { machineServiceState } from '../domain/machineService';
import {
  paddedSteamDurationSeconds,
  type MachineServiceState
} from '../domain/timedSteamStop';
import { DEFAULT_HOT_WATER } from '../domain/waterSettings';

// Headroom (seconds) added to the projected pour time so the DE1's native time
// stop never pre-empts the volume/weight stop — it stays a far backstop while
// reaprime stops hot water at weight (or the DE1 stops at the volume target).
export const HOT_WATER_BACKSTOP_HEADROOM_SECONDS = 30;

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
      status: string;
    };

export interface MachineActionPreflightInput {
  state: MachineState;
  skipScaleCheck: boolean;
  noScaleBlocked: boolean;
  waterAlertHard: boolean;
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
    status: machineActionStatus(input.state, 'sending')
  };
}

// The hot-water data beanie pushes to the gateway. reaprime owns stop-at-weight
// (it tares the scale and stops the dispense at the volume target treated as
// grams), so beanie just shapes the workflow it sends:
//   - Weight mode: keep the real volume target; give the DE1's time stop generous
//     headroom so it stays a backstop behind reaprime's weight stop.
//   - Time mode: disable the volume target (0) so the DE1 stops on duration and
//     reaprime's stop-at-weight stays inert (it skips targets <= 0).
export function hotWaterDataForGateway(
  water: HotWaterData,
  hotWaterStopMode: HotWaterStopMode
): HotWaterData {
  if (hotWaterStopMode === 'time') {
    return { ...water, volume: 0 };
  }
  const headroom = hotWaterBackstopDuration(water);
  if (headroom == null) return water;
  const duration = Math.max(positiveNumber(water.duration) ?? 0, headroom);
  if (water.duration === duration) return water;
  return { ...water, duration };
}

export function hotWaterBackstopDuration(water: HotWaterData): number | null {
  const targetVolume = positiveNumber(water.volume);
  const flow = positiveNumber(water.flow) ?? positiveNumber(DEFAULT_HOT_WATER.flow);
  if (targetVolume == null || flow == null) return null;
  return Math.min(180, Math.ceil(targetVolume / flow + HOT_WATER_BACKSTOP_HEADROOM_SECONDS));
}

export type SendMachineActionCommandResult =
  | {
      type: 'sent';
      status: string;
      restore: MachineServiceWorkflowRestore | null;
    }
  | {
      type: 'failed';
      error: unknown;
      status: 'Machine command failed';
      noScaleBlocked: boolean;
      restore: MachineServiceWorkflowRestore | null;
    };

export async function sendMachineActionCommand(
  input: {
    state: MachineState;
    workflow: Workflow | null;
    steamSettings: SteamSettings;
    hotWaterData: HotWaterData;
    rinseData: RinseData;
    twoTapSteamStop: boolean;
  },
  deps: {
    updateWorkflow(workflow: Workflow): Promise<Workflow>;
    requestState(state: MachineState): Promise<void>;
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

    await deps.requestState(input.state);
    return {
      type: 'sent',
      status: machineActionStatus(input.state, 'sent'),
      restore
    };
  } catch (error) {
    return {
      type: 'failed',
      error,
      status: 'Machine command failed',
      noScaleBlocked: input.state === 'espresso' && deps.isNoScaleShotBlockError(error),
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
