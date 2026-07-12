import type { Workflow } from '../api/types';
import {
  recipeOperationSubject,
  type RecipeCandidate
} from '../domain/recipeIdentity';
import { OperationAuthority, type OperationLease } from '../runtime/operationAuthority';
import type {
  MachineWorkflowCommandOutcome,
  MachineWorkflowCommands,
  OwnedMachineLane
} from './machineWorkflowCommands';

const RECIPE_COALESCE_KEY = 'recipe';
export const RECIPE_APPLY_DEBOUNCE_MS = 200;

export interface RecipeApplyCalibration {
  /** Flow multiplier the UI should adopt when this request is confirmed. */
  readonly target: number;
  /** Whether the multiplier must be written to the live machine in this command. */
  readonly persistToMachine: boolean;
}

export interface RecipeApplyRequest {
  readonly candidate: RecipeCandidate;
  readonly calibration: RecipeApplyCalibration | null;
}

export interface RecipeApplyRuntimeState {
  readonly demo: boolean;
  readonly connected: boolean;
  readonly sleeping: boolean;
}

export interface RecipeApplyScheduler {
  schedule(callback: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

export type RecipeApplyMachinePort = Pick<
  MachineWorkflowCommands,
  'stageDesired' | 'runLatest'
>;

export interface RecipeApplyControllerOptions {
  commands: RecipeApplyMachinePort;
  runtime(): RecipeApplyRuntimeState;
  scheduler?: RecipeApplyScheduler;
  debounceMs?: number;
}

export interface RecipeApplySnapshot {
  readonly stagedFingerprint: string | null;
  readonly activeFingerprint: string | null;
  readonly scheduled: boolean;
  readonly deferredUntilWake: boolean;
  readonly disposed: boolean;
}

export type RecipeApplyStageResult =
  | { type: 'scheduled'; request: RecipeApplyRequest; delayMs: number }
  | { type: 'in-flight'; request: RecipeApplyRequest }
  | { type: 'deferred'; request: RecipeApplyRequest; reason: 'sleeping' }
  | { type: 'blocked'; request: RecipeApplyRequest; reason: 'offline' }
  | { type: 'failed'; request: RecipeApplyRequest; error: unknown }
  | { type: 'disposed' };

export type RecipeApplyResult =
  | {
      type: 'applied';
      request: RecipeApplyRequest;
      workflow: Workflow;
      source: 'demo' | 'gateway';
    }
  | { type: 'deferred'; request: RecipeApplyRequest; reason: 'sleeping' }
  | { type: 'blocked'; request: RecipeApplyRequest; reason: 'offline' | 'authority' }
  | {
      type: 'not-applied';
      request: RecipeApplyRequest;
      reason: 'superseded' | 'canceled' | 'disposed';
    }
  | { type: 'failed'; request: RecipeApplyRequest; error: unknown }
  | { type: 'no-candidate' }
  | { type: 'disposed' };

export type RecipeApplyEvent =
  | { type: 'staged'; request: RecipeApplyRequest; state: RecipeApplySnapshot }
  | ({ state: RecipeApplySnapshot } & RecipeApplyStageResult)
  | { type: 'applying'; request: RecipeApplyRequest; state: RecipeApplySnapshot }
  | ({ state: RecipeApplySnapshot } & RecipeApplyResult)
  | { type: 'canceled'; reason: unknown; state: RecipeApplySnapshot };

export interface RecipeApplySubscription {
  dispose(): void;
}

interface TrackedRequest extends RecipeApplyRequest {
  readonly key: string;
  readonly subject: string;
}

interface ActiveRequest {
  readonly request: TrackedRequest;
  readonly generation: number;
}

const browserScheduler: RecipeApplyScheduler = {
  schedule: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  cancel: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>)
};

/**
 * Owns recipe staging, debounce, semantic apply authority, and wake deferral.
 *
 * The application remains responsible only for producing a canonical
 * RecipeCandidate and projecting events into UI/cache state. All gateway work
 * goes through MachineWorkflowCommands, so workflow + calibration retain the
 * shared machine lane and re-check live authority between mutations.
 */
export class RecipeApplyController {
  private readonly commands: RecipeApplyMachinePort;
  private readonly readRuntime: () => RecipeApplyRuntimeState;
  private readonly scheduler: RecipeApplyScheduler;
  private readonly debounceMs: number;
  private readonly authority = new OperationAuthority();
  private readonly listeners = new Set<(event: RecipeApplyEvent) => void>();
  private staged: TrackedRequest | null = null;
  private active: ActiveRequest | null = null;
  private deferredKey: string | null = null;
  private timerHandle: unknown;
  private timerArmed = false;
  private timerGeneration = 0;
  private disposed = false;

  constructor(options: RecipeApplyControllerOptions) {
    const debounceMs = options.debounceMs ?? RECIPE_APPLY_DEBOUNCE_MS;
    if (!Number.isFinite(debounceMs) || debounceMs < 0) {
      throw new RangeError('Recipe apply debounce must be a finite non-negative number');
    }
    this.commands = options.commands;
    this.readRuntime = options.runtime;
    this.scheduler = options.scheduler ?? browserScheduler;
    this.debounceMs = debounceMs;
  }

  get snapshot(): RecipeApplySnapshot {
    return {
      stagedFingerprint: this.staged?.candidate.fingerprint ?? null,
      activeFingerprint: this.active?.request.candidate.fingerprint ?? null,
      scheduled: this.timerArmed,
      deferredUntilWake: this.deferredKey != null,
      disposed: this.disposed
    };
  }

  subscribe(listener: (event: RecipeApplyEvent) => void): RecipeApplySubscription {
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

  /** Stage desired machine intent immediately, then debounce only the write. */
  stage(candidate: RecipeCandidate, calibration: RecipeApplyCalibration | null = null): RecipeApplyStageResult {
    if (this.disposed) return { type: 'disposed' };
    const request = trackedRequest(candidate, calibration);
    const candidateChanged = this.staged?.key !== request.key;
    this.staged = request;
    this.commands.stageDesired(candidate.workflow);

    if (candidateChanged) {
      this.cancelTimer();
      this.deferredKey = null;
    }
    if (this.active && this.active.request.key !== request.key) {
      this.authority.invalidate(new Error('Superseded by a newly staged recipe'));
      this.active = null;
    }
    this.emit({ type: 'staged', request, state: this.snapshot });

    const runtime = this.readRuntime();
    if (!runtime.demo && !runtime.connected) {
      this.cancelTimer();
      this.deferredKey = null;
      return this.emitStageResult({ type: 'blocked', request, reason: 'offline' });
    }
    if (!runtime.demo && runtime.sleeping) {
      this.cancelTimer();
      this.deferredKey = request.key;
      return this.emitStageResult({ type: 'deferred', request, reason: 'sleeping' });
    }
    if (this.active?.request.key === request.key) {
      return this.emitStageResult({ type: 'in-flight', request });
    }

    this.deferredKey = null;
    const schedule = this.armTimer(request);
    if (!schedule.ok) {
      return this.emitStageResult({ type: 'failed', request, error: schedule.error });
    }
    return this.emitStageResult({ type: 'scheduled', request, delayMs: this.debounceMs });
  }

  /** Apply the latest staged candidate now, canceling any pending debounce. */
  flush(): Promise<RecipeApplyResult> {
    if (this.disposed) return Promise.resolve({ type: 'disposed' });
    const request = this.staged;
    if (!request) return Promise.resolve({ type: 'no-candidate' });
    this.cancelTimer();
    return this.dispatch(request);
  }

  /** Apply a sleeping request immediately after a successful machine wake. */
  resumeAfterWake(): Promise<RecipeApplyResult> {
    if (this.disposed) return Promise.resolve({ type: 'disposed' });
    const request = this.staged;
    if (!request || this.deferredKey !== request.key) {
      return Promise.resolve({ type: 'no-candidate' });
    }
    this.deferredKey = null;
    return this.dispatch(request);
  }

  /** Cancel staged and in-flight semantic ownership without stopping physical I/O. */
  cancel(reason: unknown = new Error('Recipe apply canceled')): void {
    if (this.disposed) return;
    this.cancelTimer();
    this.deferredKey = null;
    this.staged = null;
    this.active = null;
    this.authority.invalidate(reason);
    this.emit({ type: 'canceled', reason, state: this.snapshot });
  }

  dispose(): void {
    if (this.disposed) return;
    this.cancelTimer();
    this.deferredKey = null;
    this.staged = null;
    this.active = null;
    this.disposed = true;
    this.authority.dispose();
    this.emit({ type: 'disposed', state: this.snapshot });
    this.listeners.clear();
  }

  private armTimer(request: TrackedRequest): { ok: true } | { ok: false; error: unknown } {
    this.cancelTimer();
    const generation = ++this.timerGeneration;
    try {
      this.timerArmed = true;
      this.timerHandle = this.scheduler.schedule(() => {
        if (this.disposed || !this.timerArmed || generation !== this.timerGeneration) return;
        this.timerArmed = false;
        this.timerHandle = undefined;
        if (this.staged?.key !== request.key) return;
        void this.dispatch(request);
      }, this.debounceMs);
      return { ok: true };
    } catch (error) {
      this.timerArmed = false;
      this.timerHandle = undefined;
      return { ok: false, error };
    }
  }

  private cancelTimer(): void {
    this.timerGeneration += 1;
    if (!this.timerArmed) return;
    this.scheduler.cancel(this.timerHandle);
    this.timerArmed = false;
    this.timerHandle = undefined;
  }

  private async dispatch(request: TrackedRequest): Promise<RecipeApplyResult> {
    if (this.disposed) return { type: 'disposed' };
    if (this.staged?.key !== request.key) {
      return { type: 'not-applied', request, reason: 'superseded' };
    }

    const runtime = this.readRuntime();
    if (!runtime.demo && !runtime.connected) {
      this.deferredKey = null;
      return this.emitResult({ type: 'blocked', request, reason: 'offline' });
    }
    if (!runtime.demo && runtime.sleeping) {
      this.deferredKey = request.key;
      return this.emitResult({ type: 'deferred', request, reason: 'sleeping' });
    }

    this.deferredKey = null;
    const operation = this.authority.begin(request.subject);
    this.active = { request, generation: operation.generation };
    operation.commit(() => this.emit({ type: 'applying', request, state: this.snapshot }));
    if (!operation.isCurrent) {
      return { type: 'not-applied', request, reason: 'superseded' };
    }

    try {
      if (runtime.demo) {
        return this.commitResult(operation, {
          type: 'applied',
          request,
          workflow: request.candidate.workflow,
          source: 'demo'
        });
      }

      const outcome = await this.commands.runLatest(
        RECIPE_COALESCE_KEY,
        async (lane: OwnedMachineLane) => {
          const workflow = await lane.updateWorkflow(request.candidate.workflow);
          if (request.calibration?.persistToMachine) {
            await lane.updateCalibration(request.calibration.target);
          }
          return workflow;
        }
      );
      if (!operation.isCurrent) {
        return { type: 'not-applied', request, reason: 'superseded' };
      }
      return this.finishCommand(operation, request, outcome);
    } catch (error) {
      return this.commitResult(operation, { type: 'failed', request, error });
    } finally {
      operation.finish();
      if (this.active?.generation === operation.generation) this.active = null;
    }
  }

  private finishCommand(
    operation: OperationLease,
    request: TrackedRequest,
    outcome: MachineWorkflowCommandOutcome<Workflow>
  ): RecipeApplyResult {
    switch (outcome.status) {
      case 'completed':
        return this.commitResult(operation, {
          type: 'applied',
          request,
          workflow: outcome.value,
          source: 'gateway'
        });
      case 'authority-blocked':
        return this.commitResult(operation, { type: 'blocked', request, reason: 'authority' });
      case 'failed':
        return this.commitResult(operation, { type: 'failed', request, error: outcome.error });
      case 'superseded':
      case 'canceled':
      case 'disposed':
        return this.commitResult(operation, { type: 'not-applied', request, reason: outcome.status });
    }
  }

  private commitResult(operation: OperationLease, result: RecipeApplyResult): RecipeApplyResult {
    const committed = operation.commit(() => {
      this.emit({ ...result, state: this.snapshot } as RecipeApplyEvent);
      return result;
    });
    return committed.status === 'committed'
      ? committed.value
      : staleResult(result);
  }

  private emitStageResult(result: RecipeApplyStageResult): RecipeApplyStageResult {
    this.emit({ ...result, state: this.snapshot } as RecipeApplyEvent);
    return result;
  }

  private emitResult(result: RecipeApplyResult): RecipeApplyResult {
    this.emit({ ...result, state: this.snapshot } as RecipeApplyEvent);
    return result;
  }

  private emit(event: RecipeApplyEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        // Observers project state; they cannot interrupt command ownership.
      }
    }
  }
}

function trackedRequest(
  candidate: RecipeCandidate,
  calibration: RecipeApplyCalibration | null
): TrackedRequest {
  const normalizedCalibration = normalizeCalibration(calibration);
  const calibrationKey = normalizedCalibration == null
    ? 'none'
    : `${normalizedCalibration.target}:${normalizedCalibration.persistToMachine ? 'machine' : 'local'}`;
  const key = `${candidate.fingerprint}|calibration:${calibrationKey}`;
  return {
    candidate,
    calibration: normalizedCalibration,
    key,
    subject: recipeOperationSubject(key)
  };
}

function normalizeCalibration(calibration: RecipeApplyCalibration | null): RecipeApplyCalibration | null {
  if (calibration == null) return null;
  if (!Number.isFinite(calibration.target) || calibration.target <= 0) {
    throw new RangeError('Recipe flow calibration must be a finite positive number');
  }
  return {
    target: calibration.target,
    persistToMachine: calibration.persistToMachine
  };
}

function staleResult(result: RecipeApplyResult): RecipeApplyResult {
  if ('request' in result) {
    return { type: 'not-applied', request: result.request, reason: 'superseded' };
  }
  return result;
}
