import type { MachineSnapshot, ScaleSnapshot } from '../api/types';
import { machineServiceState } from './machineService';
import type { MachineServiceState } from './timedSteamStop';

export interface LiveTelemetryFrameStateInput {
  currentMachine: MachineSnapshot | null;
  currentScale: ScaleSnapshot | null;
  machineFrame: MachineSnapshot | null;
  scaleFrame: ScaleSnapshot | null;
  view: string;
  asleep: boolean;
  tMs: number;
}

export interface LiveTelemetryFrameState {
  previousMachineState: string | undefined;
  previousService: MachineServiceState | null;
  currentMachine: MachineSnapshot | null;
  currentScale: ScaleSnapshot | null;
  currentService: MachineServiceState | null;
  previousScaleConnected: boolean;
  scaleConnected: boolean;
  scaleConnectionChanged: boolean;
  freshScaleConnected: boolean;
  sleeping: boolean;
  idleDecisionInput: LiveTelemetryIdleDecisionInput;
}

export type LiveShotPanelDecision = 'started' | 'ended' | 'active' | 'idle';

export type LiveTelemetryIdleDecision =
  | { type: 'set-asleep'; asleep: boolean }
  | { type: 'enter-service'; service: MachineServiceState }
  | { type: 'refresh-service' }
  | { type: 'leave-service' }
  | { type: 'check-water-alert' }
  | { type: 'water-alert-changed' }
  | { type: 'refresh-scale-connection' }
  | { type: 'patch-topbar' };

export interface LiveTelemetryIdleDecisionInput {
  previousService: MachineServiceState | null;
  currentService: MachineServiceState | null;
  currentView: string;
  sleeping: boolean;
  asleep: boolean;
  scaleConnectionChanged: boolean;
  waterAlertChanged?: boolean;
}

export function liveTelemetryIdleDecision(input: LiveTelemetryIdleDecisionInput): LiveTelemetryIdleDecision {
  if (input.sleeping !== input.asleep) return { type: 'set-asleep', asleep: input.sleeping };
  if (input.currentService && input.currentView !== 'machine') {
    return { type: 'enter-service', service: input.currentService };
  }
  if (input.currentView === 'machine' && input.currentService) return { type: 'refresh-service' };
  if (input.previousService && !input.currentService && input.currentView === 'machine') return { type: 'leave-service' };
  if (input.waterAlertChanged == null) return { type: 'check-water-alert' };
  if (input.waterAlertChanged) return { type: 'water-alert-changed' };
  if (input.currentView === 'machine' && input.scaleConnectionChanged) return { type: 'refresh-scale-connection' };
  return { type: 'patch-topbar' };
}

export function liveTelemetryFrameState(input: LiveTelemetryFrameStateInput): LiveTelemetryFrameState {
  const previousMachineState = input.currentMachine?.state?.state;
  const previousService = machineServiceState(input.currentMachine?.state?.state);
  const previousScaleConnected = scaleConnected(input.currentScale);
  const currentMachine = input.machineFrame ?? input.currentMachine;
  const currentScale = input.scaleFrame ?? input.currentScale;
  const currentService = machineServiceState(currentMachine?.state?.state);
  const nextScaleConnected = scaleConnected(currentScale);
  const sleeping = currentMachine?.state?.state === 'sleeping';
  const scaleConnectionChanged = previousScaleConnected !== nextScaleConnected;
  return {
    previousMachineState,
    previousService,
    currentMachine,
    currentScale,
    currentService,
    previousScaleConnected,
    scaleConnected: nextScaleConnected,
    scaleConnectionChanged,
    freshScaleConnected: input.scaleFrame != null && nextScaleConnected,
    sleeping,
    idleDecisionInput: {
      previousService,
      currentService,
      currentView: input.view,
      sleeping,
      asleep: input.asleep,
      scaleConnectionChanged
    }
  };
}

export function liveShotPanelDecision(wasActive: boolean, active: boolean): LiveShotPanelDecision {
  if (active && !wasActive) return 'started';
  if (!active && wasActive) return 'ended';
  if (active) return 'active';
  return 'idle';
}

function scaleConnected(scale: ScaleSnapshot | null): boolean {
  return scale != null && scale.status !== 'disconnected';
}
