import type { MachineState } from '../api/types';
import {
  emptyMachineServiceProgress,
  nextMachineServiceProgress,
  type MachineServiceProgressState,
  type MachineServiceProgressTransition
} from '../domain/machineService';
import {
  timedSteamStopDelayMs,
  type MachineServiceState
} from '../domain/timedSteamStop';

export interface MachineServiceControllerSnapshot extends MachineServiceProgressState {
  stopRequestedFor: MachineServiceState | null;
  stopRequestedAtMs: number | null;
  timedSteamStopRequestedAtMs: number | null;
}

export class MachineServiceController {
  private progressState = emptyMachineServiceProgress();
  private stopFor: MachineServiceState | null = null;
  private stopAtMs: number | null = null;
  private timedSteamRequestedAtMs: number | null = null;

  get progress(): MachineServiceProgressState {
    return this.progressState;
  }

  get service(): MachineServiceState | null {
    return this.progressState.service;
  }

  get startedAtMs(): number | null {
    return this.progressState.startedAtMs;
  }

  get phase(): MachineServiceProgressState['phase'] {
    return this.progressState.phase;
  }

  get targetOverrideSeconds(): number | null {
    return this.progressState.targetOverrideSeconds;
  }

  get stopRequestedFor(): MachineServiceState | null {
    return this.stopFor;
  }

  get stopRequestedAtMs(): number | null {
    return this.stopAtMs;
  }

  get timedSteamStopRequestedAtMs(): number | null {
    return this.timedSteamRequestedAtMs;
  }

  snapshot(): MachineServiceControllerSnapshot {
    return {
      ...this.progressState,
      stopRequestedFor: this.stopFor,
      stopRequestedAtMs: this.stopAtMs,
      timedSteamStopRequestedAtMs: this.timedSteamRequestedAtMs
    };
  }

  track(
    state: MachineState | undefined,
    substate: string | undefined,
    nowMs: number
  ): MachineServiceProgressTransition {
    const transition = nextMachineServiceProgress(this.progressState, state, substate, nowMs);
    this.progressState = transition.next;
    if (transition.clearTimedSteamRequest) this.timedSteamRequestedAtMs = null;
    if (transition.clearMachineStopRequest) this.clearStopRequest();
    if (this.stopFor && this.stopFor !== transition.currentService) this.clearStopRequest();
    return transition;
  }

  setProgress(progress: MachineServiceProgressState): void {
    this.progressState = progress;
  }

  markStopRequested(service: MachineServiceState, nowMs: number): void {
    this.stopFor = service;
    this.stopAtMs = nowMs;
  }

  clearStopRequest(): void {
    this.stopFor = null;
    this.stopAtMs = null;
  }

  markTimedSteamStopRequested(nowMs: number): void {
    this.timedSteamRequestedAtMs = nowMs;
    this.markStopRequested('steam', nowMs);
  }

  clearTimedSteamStopRequest(): void {
    this.timedSteamRequestedAtMs = null;
    if (this.stopFor === 'steam') this.clearStopRequest();
  }

  /** Drop progress and pending stop intent at a runtime provenance boundary. */
  reset(): void {
    this.progressState = emptyMachineServiceProgress();
    this.stopFor = null;
    this.stopAtMs = null;
    this.timedSteamRequestedAtMs = null;
  }

  timedSteamStopDelay(input: {
    disabled: boolean;
    twoTapStop: boolean;
    targetSeconds: number | null;
    nowMs: number;
  }): number | null {
    if (input.disabled || input.twoTapStop) return null;
    return timedSteamStopDelayMs({
      service: this.progressState.service,
      phase: this.progressState.phase,
      startedAtMs: this.progressState.startedAtMs,
      stopRequested: this.timedSteamRequestedAtMs != null || this.stopFor === 'steam',
      targetSeconds: input.targetSeconds,
      nowMs: input.nowMs
    });
  }

  extendTarget(seconds: number, nowMs: number, currentTargetSeconds: number | null): number {
    const elapsedSeconds = this.progressState.startedAtMs == null
      ? 0
      : Math.max(0, (nowMs - this.progressState.startedAtMs) / 1000);
    const nextTarget = Math.ceil((this.progressState.targetOverrideSeconds ?? currentTargetSeconds ?? elapsedSeconds) + seconds);
    this.progressState = { ...this.progressState, targetOverrideSeconds: nextTarget };
    return nextTarget;
  }
}
