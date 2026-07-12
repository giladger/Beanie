import type {
  HotWaterData,
  MachineState,
  RinseData,
  SteamSettings,
  Workflow
} from '../api/types';
import {
  machineServiceState,
  type MachineServiceProgressTransition
} from '../domain/machineService';
import type { MachineServiceState } from '../domain/timedSteamStop';
import {
  captureMachineServiceWorkflowRestore,
  extendedMachineServiceWorkflow,
  restoredMachineServiceWorkflow,
  type MachineServiceWorkflowRestore
} from './machineExecutionController';
import {
  MachineServiceController,
  type MachineServiceControllerSnapshot
} from './machineServiceController';
import type {
  MachineWorkflowCommandOutcome,
  MachineWorkflowCommands
} from './machineWorkflowCommands';

export const MACHINE_STOP_FEEDBACK_MS = 4_000;

export interface MachineServiceFlowScheduler {
  schedule(callback: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

export type MachineServiceCommandPort = Pick<
  MachineWorkflowCommands,
  'desiredOr' | 'stageDesired' | 'runExact' | 'stopSafely'
>;

export interface MachineServiceFlowOptions {
  commands: MachineServiceCommandPort;
  machineState(): MachineState | undefined;
  scheduler?: MachineServiceFlowScheduler;
  now?: () => number;
  stopFeedbackMs?: number;
}

export interface MachineServiceFlowSnapshot {
  readonly service: MachineServiceControllerSnapshot;
  readonly restorePending: boolean;
  readonly timedStopScheduledForMs: number | null;
  readonly stopFeedbackPending: boolean;
  readonly disposed: boolean;
}

export interface MachineServiceTrackInput {
  state: MachineState | undefined;
  substate?: string;
  demo: boolean;
  twoTapSteamStop: boolean;
  targetSeconds: number | null;
  nowMs?: number;
}

export interface MachineServiceTrackResult {
  transition: MachineServiceProgressTransition;
  restore: Promise<MachineServiceRestoreResult> | null;
}

export type MachineServiceStopResult =
  | { type: 'requested'; service: MachineServiceState | null; timed: boolean }
  | { type: 'demo-stopped'; service: MachineServiceState | null }
  | {
      type: 'failed';
      service: MachineServiceState | null;
      timed: boolean;
      reason: MachineCommandFailureReason;
      error?: unknown;
    }
  | { type: 'disposed' };

export interface MachineServiceExtendInput {
  seconds: number;
  machineState: MachineState | undefined;
  demo: boolean;
  workflow: Workflow | null;
  steamSettings: SteamSettings;
  hotWaterData: HotWaterData;
  rinseData: RinseData;
  currentTargetSeconds: number | null;
  twoTapSteamStop: boolean;
  nowMs?: number;
}

export type MachineServiceExtendResult =
  | { type: 'extended'; service: MachineServiceState; nextTargetSeconds: number; workflow: Workflow }
  | { type: 'local-only'; service: MachineServiceState; nextTargetSeconds: number }
  | { type: 'ignored'; reason: 'no-service' | 'demo' | 'invalid-seconds' }
  | {
      type: 'failed';
      service: MachineServiceState;
      nextTargetSeconds: number;
      reason: MachineCommandFailureReason;
      error?: unknown;
    }
  | { type: 'disposed' };

export type MachineServiceRestoreResult =
  | { type: 'restored'; workflow: Workflow }
  | { type: 'skipped'; reason: 'none' | 'demo' }
  | { type: 'failed'; reason: MachineCommandFailureReason; error?: unknown }
  | { type: 'disposed' };

export type MachineServiceFlowEvent =
  | { type: 'transition'; transition: MachineServiceProgressTransition; state: MachineServiceFlowSnapshot }
  | { type: 'timed-stop-scheduled'; delayMs: number; state: MachineServiceFlowSnapshot }
  | { type: 'stop-result'; result: MachineServiceStopResult; state: MachineServiceFlowSnapshot }
  | { type: 'stop-not-confirmed'; service: MachineServiceState; state: MachineServiceFlowSnapshot }
  | { type: 'extend-result'; result: MachineServiceExtendResult; state: MachineServiceFlowSnapshot }
  | { type: 'restore-result'; result: MachineServiceRestoreResult; state: MachineServiceFlowSnapshot }
  | { type: 'restore-captured'; state: MachineServiceFlowSnapshot }
  | { type: 'disposed'; state: MachineServiceFlowSnapshot };

export interface MachineServiceFlowSubscription {
  dispose(): void;
}

type MachineCommandFailureReason =
  | 'authority'
  | 'failed'
  | 'superseded'
  | 'canceled'
  | 'disposed';

const browserScheduler: MachineServiceFlowScheduler = {
  schedule: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  cancel: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>)
};

/**
 * Owns the lifecycle around an already-started steam/water/flush service.
 *
 * MachineActionFlow owns starting a service. This flow owns its stop requests,
 * timed-steam deadline, temporary workflow restore token, duration extension,
 * and stop-confirmation feedback. It borrows the shared machine command lane;
 * disposing it never disposes or cancels that shared queue.
 */
export class MachineServiceFlow {
  private readonly commands: MachineServiceCommandPort;
  private readonly readMachineState: () => MachineState | undefined;
  private readonly scheduler: MachineServiceFlowScheduler;
  private readonly now: () => number;
  private readonly stopFeedbackMs: number;
  private readonly progress = new MachineServiceController();
  private readonly listeners = new Set<(event: MachineServiceFlowEvent) => void>();
  private restore: MachineServiceWorkflowRestore | null = null;
  private timedStopHandle: unknown;
  private timedStopArmed = false;
  private timedStopScheduledForMs: number | null = null;
  private timedStopGeneration = 0;
  private stopFeedbackHandle: unknown;
  private stopFeedbackArmed = false;
  private stopFeedbackGeneration = 0;
  private disposed = false;

  constructor(options: MachineServiceFlowOptions) {
    const feedbackMs = options.stopFeedbackMs ?? MACHINE_STOP_FEEDBACK_MS;
    if (!Number.isFinite(feedbackMs) || feedbackMs < 0) {
      throw new RangeError('Machine stop feedback delay must be finite and non-negative');
    }
    this.commands = options.commands;
    this.readMachineState = options.machineState;
    this.scheduler = options.scheduler ?? browserScheduler;
    this.now = options.now ?? Date.now;
    this.stopFeedbackMs = feedbackMs;
  }

  get snapshot(): MachineServiceFlowSnapshot {
    return {
      service: this.progress.snapshot(),
      restorePending: this.restore != null,
      timedStopScheduledForMs: this.timedStopScheduledForMs,
      stopFeedbackPending: this.stopFeedbackArmed,
      disposed: this.disposed
    };
  }

  subscribe(listener: (event: MachineServiceFlowEvent) => void): MachineServiceFlowSubscription {
    if (!this.disposed) this.listeners.add(listener);
    let active = true;
    return {
      dispose: () => {
        if (!active) return;
        active = false;
        this.listeners.delete(listener);
      }
    };
  }

  /** Preserve the first pre-service settings until the service ends. */
  captureRestore(restore: MachineServiceWorkflowRestore): void {
    if (this.disposed || this.restore != null) return;
    this.restore = captureMachineServiceWorkflowRestore(restore);
    this.emit({ type: 'restore-captured', state: this.snapshot });
  }

  clearRestore(): void {
    this.restore = null;
  }

  track(input: MachineServiceTrackInput): MachineServiceTrackResult {
    const nowMs = input.nowMs ?? this.now();
    const transition = this.progress.track(input.state, input.substate, nowMs);
    if (transition.clearTimedSteamTimer) this.cancelTimedStop();
    if (transition.clearMachineStopRequest) this.cancelStopFeedback();
    if (transition.updateTimedSteamStopTimer) {
      this.syncTimedSteamStop({
        demo: input.demo,
        twoTapSteamStop: input.twoTapSteamStop,
        targetSeconds: input.targetSeconds,
        nowMs
      });
    }
    this.emit({ type: 'transition', transition, state: this.snapshot });
    const restore = transition.restoreWorkflowAfterEnd
      ? this.restoreAfterEnd(input.demo)
      : null;
    return { transition, restore };
  }

  stop(input: {
    demo: boolean;
    machineState?: MachineState;
    timed?: boolean;
    nowMs?: number;
  }): Promise<MachineServiceStopResult> {
    if (this.disposed) return Promise.resolve({ type: 'disposed' });
    const service = machineServiceState(input.machineState ?? this.readMachineState()) ?? this.progress.service;
    return this.requestStop(service, input.timed === true, input.demo, input.nowMs ?? this.now());
  }

  async extend(input: MachineServiceExtendInput): Promise<MachineServiceExtendResult> {
    if (this.disposed) return { type: 'disposed' };
    if (!Number.isFinite(input.seconds) || input.seconds <= 0) {
      return this.emitExtend({ type: 'ignored', reason: 'invalid-seconds' });
    }
    const service = machineServiceState(input.machineState) ?? this.progress.service;
    if (!service) return this.emitExtend({ type: 'ignored', reason: 'no-service' });
    if (input.demo) return this.emitExtend({ type: 'ignored', reason: 'demo' });

    const nowMs = input.nowMs ?? this.now();
    const nextTargetSeconds = this.progress.extendTarget(
      input.seconds,
      nowMs,
      input.currentTargetSeconds
    );
    this.captureRestore({
      steamSettings: input.steamSettings,
      hotWaterData: input.hotWaterData,
      rinseData: input.rinseData
    });
    this.syncTimedSteamStop({
      demo: false,
      twoTapSteamStop: input.twoTapSteamStop,
      targetSeconds: nextTargetSeconds,
      nowMs
    });

    const workflow = this.commands.desiredOr(input.workflow);
    if (!workflow) {
      return this.emitExtend({ type: 'local-only', service, nextTargetSeconds });
    }
    const nextWorkflow = extendedMachineServiceWorkflow({
      workflow,
      service,
      steamSettings: input.steamSettings,
      hotWaterData: input.hotWaterData,
      rinseData: input.rinseData,
      nextTargetSeconds,
      twoTapSteamStop: input.twoTapSteamStop
    });
    this.commands.stageDesired(nextWorkflow);
    const outcome = await this.commands.runExact((lane) => lane.updateWorkflow(nextWorkflow));
    if (this.disposed) return { type: 'disposed' };
    if (outcome.status === 'completed') {
      return this.emitExtend({
        type: 'extended',
        service,
        nextTargetSeconds,
        workflow: outcome.value
      });
    }
    const failure = commandFailure(outcome);
    return this.emitExtend({
      type: 'failed',
      service,
      nextTargetSeconds,
      ...failure
    });
  }

  async restoreAfterEnd(demo: boolean): Promise<MachineServiceRestoreResult> {
    if (this.disposed) return { type: 'disposed' };
    const restore = this.restore;
    this.restore = null;
    if (!restore) return this.emitRestore({ type: 'skipped', reason: 'none' });
    if (demo) return this.emitRestore({ type: 'skipped', reason: 'demo' });

    // Publish restored desired intent synchronously. Rebase again inside the
    // exact lane so a recipe staged while this command waited is preserved.
    const planned = restoredMachineServiceWorkflow(this.commands.desiredOr(null), restore);
    this.commands.stageDesired(planned);
    const outcome = await this.commands.runExact((lane) => {
      const rebased = restoredMachineServiceWorkflow(this.commands.desiredOr(planned), restore);
      this.commands.stageDesired(rebased);
      return lane.updateWorkflow(rebased);
    });
    if (this.disposed) return { type: 'disposed' };
    if (outcome.status === 'completed') {
      return this.emitRestore({ type: 'restored', workflow: outcome.value });
    }
    // Authority/network loss after a temporary workflow landed must not erase
    // the only restore token. Keep it for the reconnect path to retry, without
    // replacing a newer service token that may have been captured meanwhile.
    if (this.restore == null) this.restore = restore;
    return this.emitRestore({ type: 'failed', ...commandFailure(outcome) });
  }

  dispose(): void {
    if (this.disposed) return;
    this.cancelTimedStop();
    this.cancelStopFeedback();
    this.restore = null;
    this.disposed = true;
    this.emit({ type: 'disposed', state: this.snapshot });
    this.listeners.clear();
  }

  private syncTimedSteamStop(input: {
    demo: boolean;
    twoTapSteamStop: boolean;
    targetSeconds: number | null;
    nowMs: number;
  }): void {
    const targetSeconds = this.progress.targetOverrideSeconds ?? input.targetSeconds;
    const delayMs = this.progress.timedSteamStopDelay({
      disabled: input.demo,
      twoTapStop: input.twoTapSteamStop,
      targetSeconds,
      nowMs: input.nowMs
    });
    if (delayMs == null) {
      this.cancelTimedStop();
      return;
    }
    const scheduledForMs = input.nowMs + delayMs;
    if (
      this.timedStopArmed &&
      this.timedStopScheduledForMs != null &&
      Math.abs(this.timedStopScheduledForMs - scheduledForMs) < 250
    ) return;

    this.cancelTimedStop();
    const generation = ++this.timedStopGeneration;
    this.timedStopScheduledForMs = scheduledForMs;
    try {
      this.timedStopArmed = true;
      this.timedStopHandle = this.scheduler.schedule(() => {
        if (this.disposed || generation !== this.timedStopGeneration) return;
        this.timedStopArmed = false;
        this.timedStopHandle = undefined;
        this.timedStopScheduledForMs = null;
        if (this.readMachineState() !== 'steam') return;
        void this.requestStop('steam', true, false, this.now());
      }, delayMs);
      this.emit({ type: 'timed-stop-scheduled', delayMs, state: this.snapshot });
    } catch {
      this.timedStopArmed = false;
      this.timedStopHandle = undefined;
      this.timedStopScheduledForMs = null;
    }
  }

  private cancelTimedStop(): void {
    this.timedStopGeneration += 1;
    if (this.timedStopArmed) this.scheduler.cancel(this.timedStopHandle);
    this.timedStopArmed = false;
    this.timedStopHandle = undefined;
    this.timedStopScheduledForMs = null;
  }

  private async requestStop(
    service: MachineServiceState | null,
    timed: boolean,
    demo: boolean,
    nowMs: number
  ): Promise<MachineServiceStopResult> {
    if (service) {
      if (timed && service === 'steam') this.progress.markTimedSteamStopRequested(nowMs);
      else this.progress.markStopRequested(service, nowMs);
    }
    if (service === 'steam') this.cancelTimedStop();

    if (demo) {
      this.progress.track('idle', undefined, nowMs);
      this.cancelStopFeedback();
      return this.emitStop({ type: 'demo-stopped', service });
    }
    const outcome = await this.commands.stopSafely();
    if (this.disposed) return { type: 'disposed' };
    if (outcome.status === 'completed') {
      if (service) this.armStopFeedback(service);
      return this.emitStop({ type: 'requested', service, timed });
    }
    this.progress.clearStopRequest();
    this.cancelStopFeedback();
    return this.emitStop({
      type: 'failed',
      service,
      timed,
      ...commandFailure(outcome)
    });
  }

  private armStopFeedback(service: MachineServiceState): void {
    this.cancelStopFeedback();
    const generation = ++this.stopFeedbackGeneration;
    try {
      this.stopFeedbackArmed = true;
      this.stopFeedbackHandle = this.scheduler.schedule(() => {
        if (this.disposed || generation !== this.stopFeedbackGeneration) return;
        this.stopFeedbackArmed = false;
        this.stopFeedbackHandle = undefined;
        if (this.progress.stopRequestedFor !== service) return;
        this.emit({ type: 'stop-not-confirmed', service, state: this.snapshot });
      }, this.stopFeedbackMs);
    } catch {
      this.stopFeedbackArmed = false;
      this.stopFeedbackHandle = undefined;
    }
  }

  private cancelStopFeedback(): void {
    this.stopFeedbackGeneration += 1;
    if (this.stopFeedbackArmed) this.scheduler.cancel(this.stopFeedbackHandle);
    this.stopFeedbackArmed = false;
    this.stopFeedbackHandle = undefined;
  }

  private emitStop(result: MachineServiceStopResult): MachineServiceStopResult {
    this.emit({ type: 'stop-result', result, state: this.snapshot });
    return result;
  }

  private emitExtend(result: MachineServiceExtendResult): MachineServiceExtendResult {
    this.emit({ type: 'extend-result', result, state: this.snapshot });
    return result;
  }

  private emitRestore(result: MachineServiceRestoreResult): MachineServiceRestoreResult {
    this.emit({ type: 'restore-result', result, state: this.snapshot });
    return result;
  }

  private emit(event: MachineServiceFlowEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        // UI/cache observers cannot interrupt physical machine ownership.
      }
    }
  }
}

function commandFailure<Value>(
  outcome: Exclude<MachineWorkflowCommandOutcome<Value>, { status: 'completed' }>
): { reason: MachineCommandFailureReason; error?: unknown } {
  if (outcome.status === 'authority-blocked') return { reason: 'authority' };
  if (outcome.status === 'failed') return { reason: 'failed', error: outcome.error };
  return { reason: outcome.status };
}
