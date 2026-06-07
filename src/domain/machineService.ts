import type { HotWaterData, MachineSnapshot, MachineState, RinseData, ScaleSnapshot, SteamSettings } from '../api/types';
import type { HotWaterStopMode } from './machinePreferences';
import type { MachineServicePhase, MachineServiceState } from './timedSteamStop';

export interface MachineServiceProgressState {
  service: MachineServiceState | null;
  startedAtMs: number | null;
  phase: MachineServicePhase | null;
  targetOverrideSeconds: number | null;
}

export interface MachineServiceProgressTransition {
  next: MachineServiceProgressState;
  previousService: MachineServiceState | null;
  currentService: MachineServiceState | null;
  clearTimedSteamTimer: boolean;
  clearTimedSteamRequest: boolean;
  clearMachineStopRequest: boolean;
  resetHotWaterWeightStop: boolean;
  restoreWorkflowAfterEnd: boolean;
  updateTimedSteamStopTimer: boolean;
}

export interface HotWaterWeightStopController {
  targetWeight: number;
  configuredFlow: number;
  armedAtMs: number;
  tareRequestedAtMs: number | null;
  activeSeen: boolean;
  stopRequested: boolean;
}

export type HotWaterWeightStopDecision =
  | { action: 'wait'; controller: HotWaterWeightStopController }
  | { action: 'clear'; controller: null }
  | {
    action: 'stop';
    controller: HotWaterWeightStopController;
    targetWeight: number;
    weight: number;
    projectedWeight: number;
  };

export interface HotWaterWeightStopDecisionInput {
  machineState: MachineState | undefined;
  nowMs: number;
  freshScale: boolean;
  lastScaleFrameMs: number | null;
  weight: number | null | undefined;
  weightFlow: number | null | undefined;
  lookaheadSeconds: number;
}

export function emptyMachineServiceProgress(): MachineServiceProgressState {
  return {
    service: null,
    startedAtMs: null,
    phase: null,
    targetOverrideSeconds: null
  };
}

export function machineServiceState(state: MachineState | undefined): MachineServiceState | null {
  if (state === 'steamRinse') return 'steam';
  if (state === 'steam' || state === 'flush' || state === 'hotWater') return state;
  return null;
}

export function nextMachineServiceProgress(
  current: MachineServiceProgressState,
  state: MachineState | undefined,
  substate: string | undefined,
  nowMs: number
): MachineServiceProgressTransition {
  const service = machineServiceState(state);
  if (!service) {
    return {
      next: emptyMachineServiceProgress(),
      previousService: current.service,
      currentService: null,
      clearTimedSteamTimer: true,
      clearTimedSteamRequest: false,
      clearMachineStopRequest: true,
      resetHotWaterWeightStop: current.service === 'hotWater',
      restoreWorkflowAfterEnd: current.service != null,
      updateTimedSteamStopTimer: false
    };
  }

  let next: MachineServiceProgressState = current;
  let clearTimedSteamRequest = false;
  if (current.service !== service) {
    next = {
      service,
      startedAtMs: null,
      phase: 'starting',
      targetOverrideSeconds: null
    };
    clearTimedSteamRequest = service === 'steam' && state !== 'steamRinse';
  }

  if (state === 'steamRinse') {
    return {
      next: { ...next, service, phase: 'purging' },
      previousService: current.service,
      currentService: service,
      clearTimedSteamTimer: true,
      clearTimedSteamRequest,
      clearMachineStopRequest: false,
      resetHotWaterWeightStop: false,
      restoreWorkflowAfterEnd: false,
      updateTimedSteamStopTimer: false
    };
  }

  const flowing = substate === 'pouring';
  if (flowing) {
    next = {
      ...next,
      service,
      startedAtMs: next.startedAtMs ?? nowMs,
      phase: 'active'
    };
  } else if (next.phase === 'active') {
    next = { ...next, service, phase: 'purging' };
  } else {
    next = { ...next, service };
  }

  return {
    next,
    previousService: current.service,
    currentService: service,
    clearTimedSteamTimer: false,
    clearTimedSteamRequest,
    clearMachineStopRequest: false,
    resetHotWaterWeightStop: false,
    restoreWorkflowAfterEnd: false,
    updateTimedSteamStopTimer: true
  };
}

export function machineServiceTargetSeconds(
  service: MachineServiceState,
  steam: SteamSettings,
  water: HotWaterData,
  flush: RinseData,
  hotWaterStopMode: HotWaterStopMode,
  hotWaterScaleConnected: boolean
): number | null {
  if (service === 'steam') return positiveNumber(steam.duration);
  if (service === 'flush') return positiveNumber(flush.duration);
  if (hotWaterStopMode === 'time') return positiveNumber(water.duration);
  if (hotWaterScaleConnected) return null;
  return positiveNumber(water.duration) ?? hotWaterVolumeSeconds(water);
}

export type MachineServiceTone = 'steam' | 'flush' | 'water';

export function machineServiceTone(service: MachineServiceState): MachineServiceTone {
  if (service === 'hotWater') return 'water';
  return service;
}

export function machineServiceVerb(service: MachineServiceState): string {
  if (service === 'hotWater') return 'Pouring hot water';
  if (service === 'flush') return 'Flushing';
  return 'Steaming';
}

export function machineServiceStats(
  targetSeconds: number | null,
  targetWeight: number | null = null
): Array<{ label: string; value: string; unit: string }> {
  const target = targetWeight == null
    ? { label: 'Target', value: targetSeconds == null ? '--' : formatSecondsValue(targetSeconds), unit: 's' }
    : { label: 'Target', value: formatNumber(targetWeight, 0), unit: 'g' };
  return [target];
}

export function machineServiceMeta(
  service: MachineServiceState,
  steam: SteamSettings,
  water: HotWaterData,
  flush: RinseData,
  machine: MachineSnapshot | null,
  scale: ScaleSnapshot | null,
  hotWaterStopMode: HotWaterStopMode
): string[] {
  if (service === 'steam') {
    return [
      `${formatNumber(steam.flow, 1)} ml/s`,
      `${formatNumber(steam.targetTemperature, 0)} C target`,
      `${formatNumber(machine?.steamTemperature, 0)} C steam`
    ];
  }
  if (service === 'hotWater') {
    const scaleIsConnected = scaleConnected(scale);
    const targetLabel = hotWaterStopMode === 'volume' && scaleIsConnected
      ? `${formatNumber(water.volume, 0)} g target`
      : hotWaterStopMode === 'time'
        ? `${formatNumber(water.duration, 0)} s target`
        : `${formatNumber(water.volume, 0)} ml target`;
    return [
      `${formatNumber(water.flow, 1)} ml/s`,
      targetLabel,
      ...(hotWaterStopMode === 'volume' && scaleIsConnected ? [`${formatNumber(scale?.weight, 1)} g scale`] : []),
      `${formatNumber(water.targetTemperature, 0)} C target`,
      `${formatNumber(machine?.mixTemperature, 0)} C water`
    ];
  }
  return [
    `${formatNumber(flush.flow, 1)} ml/s`,
    `${formatNumber(flush.targetTemperature, 0)} C target`,
    `${formatNumber(machine?.groupTemperature, 0)} C group`
  ];
}

export function machineServicePrimaryTime(
  elapsedSeconds: number,
  targetSeconds: number | null
): { value: string; label: string } {
  if (targetSeconds == null) return { value: `${formatSecondsValue(elapsedSeconds)}s`, label: 'elapsed' };
  if (elapsedSeconds > targetSeconds) {
    return { value: `+${formatSecondsValue(elapsedSeconds - targetSeconds)}s`, label: 'over target' };
  }
  return { value: `${formatSecondsValue(targetSeconds - elapsedSeconds)}s`, label: 'remaining' };
}

export function nextHotWaterWeightStop(
  controller: HotWaterWeightStopController,
  input: HotWaterWeightStopDecisionInput
): HotWaterWeightStopDecision {
  let next = { ...controller };
  if (input.machineState === 'hotWater') {
    next = { ...next, activeSeen: true };
  } else if (next.activeSeen || input.nowMs - next.armedAtMs > 10_000) {
    return { action: 'clear', controller: null };
  }

  if (!next.activeSeen || next.stopRequested) return { action: 'wait', controller: next };
  if (!input.freshScale) return { action: 'wait', controller: next };
  if (next.tareRequestedAtMs != null && input.lastScaleFrameMs != null && input.lastScaleFrameMs < next.tareRequestedAtMs) {
    return { action: 'wait', controller: next };
  }

  const weight = finiteNumber(input.weight) ?? 0;
  const flow = positiveNumber(input.weightFlow) ?? next.configuredFlow;
  const projectedWeight = weight + flow * input.lookaheadSeconds;
  if (projectedWeight < next.targetWeight) return { action: 'wait', controller: next };

  next = { ...next, stopRequested: true };
  return {
    action: 'stop',
    controller: next,
    targetWeight: next.targetWeight,
    weight,
    projectedWeight
  };
}

function hotWaterVolumeSeconds(water: HotWaterData): number | null {
  const volume = positiveNumber(water.volume);
  const flow = positiveNumber(water.flow);
  if (volume == null || flow == null) return null;
  return volume / flow;
}

function positiveNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function finiteNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function scaleConnected(scale: ScaleSnapshot | null): boolean {
  return scale != null && scale.status !== 'disconnected';
}

function formatNumber(value: number | null | undefined, digits: number): string {
  return value == null || Number.isNaN(value) ? '--' : value.toFixed(digits);
}

function formatSecondsValue(value: number): string {
  if (!Number.isFinite(value)) return '--';
  return String(Math.max(0, Math.round(value)));
}
