import type {
  HotWaterData,
  MachineState,
  RinseData,
  SteamSettings,
  Workflow
} from '../api/types';
import type { MachineServiceState } from '../domain/timedSteamStop';
import {
  machineActionPreflight,
  machineActionStatus,
  sendMachineActionCommand,
  type MachineActionPreflight,
  type MachineServiceWorkflowRestore,
  type SendMachineActionCommandResult
} from './machineExecutionController';
import {
  MachineWorkflowCommands,
  isMachineAuthorityUnavailableError,
  type OwnedMachineLane
} from './machineWorkflowCommands';

export interface MachineActionSafetySnapshot {
  readonly noScaleBlocked: boolean;
  readonly waterAlertHard: boolean;
}

/** Narrow live observations needed to repeat safety preflight at dispatch. */
export interface MachineActionSafetyPort {
  snapshot(): MachineActionSafetySnapshot;
}

export interface MachineActionFailureClassifier {
  isNoScaleShotBlockError(error: unknown): boolean;
}

export interface MachineActionCalibration {
  readonly flowMultiplier: number;
  /** False when calibration is device-local and must not be sent to the gateway. */
  readonly persist: boolean;
}

/** Immutable tap-time data; the flow never receives AppState or UI callbacks. */
export interface MachineActionRequest {
  readonly state: MachineState;
  /** Fast pre-queue observation. MachineWorkflowCommands rechecks at dispatch. */
  readonly liveAuthority: boolean;
  readonly skipScaleCheck?: boolean;
  /** Captured recipe fallback; newer staged intent still wins via desiredOr(). */
  readonly workflow: Workflow | null;
  readonly steamSettings: SteamSettings;
  readonly hotWaterData: HotWaterData;
  readonly rinseData: RinseData;
  readonly twoTapSteamStop: boolean;
  readonly calibration?: MachineActionCalibration | null;
}

export type MachineActionSafetyReason = 'no-scale' | 'water';
export type MachineActionCanceledReason = 'superseded' | 'canceled' | 'disposed';

export type MachineActionOutcome =
  | {
      type: 'blocked-safety';
      reason: MachineActionSafetyReason;
      phase: 'prequeue' | 'dispatch' | 'gateway';
      error?: unknown;
    }
  | {
      type: 'blocked-authority';
      phase: 'prequeue' | 'dispatch';
      /** Present when a temporary steam workflow landed before authority was lost. */
      restore: MachineServiceWorkflowRestore | null;
    }
  | {
      type: 'sent';
      state: MachineState;
      service: MachineServiceState | null;
      status: string;
      restore: MachineServiceWorkflowRestore | null;
    }
  | {
      type: 'failed';
      state: MachineState;
      status: 'Machine command failed';
      error: unknown;
      restore: MachineServiceWorkflowRestore | null;
    }
  | {
      type: 'canceled';
      reason: MachineActionCanceledReason;
    };

export type MachineActionStart =
  | Extract<MachineActionOutcome, { type: 'blocked-safety' | 'blocked-authority' }>
  | {
      type: 'queued';
      state: MachineState;
      service: MachineServiceState | null;
      status: string;
      completion: Promise<MachineActionOutcome>;
    };

interface PreparedMachineAction {
  readonly state: MachineState;
  readonly skipScaleCheck: boolean;
  readonly command: Parameters<typeof sendMachineActionCommand>[0];
  readonly calibration: MachineActionCalibration | null;
  readonly service: MachineServiceState | null;
}

type DispatchedMachineAction =
  | { type: 'blocked'; preflight: Exclude<MachineActionPreflight, { type: 'ready' }> }
  | { type: 'command'; command: SendMachineActionCommandResult };

/**
 * Owns physical machine-action policy while the app remains a presentation adapter.
 *
 * `start()` exposes the synchronous admission result so UI code can publish a
 * busy state without callbacks. `execute()` is the simpler final-outcome API.
 * Demo simulation remains a presentation concern and does not enter this flow.
 */
export class MachineActionFlow {
  constructor(
    private readonly commands: MachineWorkflowCommands,
    private readonly safety: MachineActionSafetyPort,
    private readonly failures: MachineActionFailureClassifier
  ) {}

  start(request: MachineActionRequest): MachineActionStart {
    // Capture the exact intent at the tap. This preserves edits whose debounced
    // recipe apply has not dispatched yet and keeps later edits separate.
    const workflow = this.commands.desiredOr(request.workflow);
    this.commands.stageDesired(workflow);

    if (!request.liveAuthority) {
      return { type: 'blocked-authority', phase: 'prequeue', restore: null };
    }

    const skipScaleCheck = request.skipScaleCheck === true;
    const preflight = this.preflight(request.state, skipScaleCheck);
    if (preflight.type !== 'ready') return blockedSafety(preflight, 'prequeue');

    const prepared: PreparedMachineAction = {
      state: request.state,
      skipScaleCheck,
      service: preflight.service,
      calibration: validCalibration(request.calibration),
      command: {
        state: request.state,
        workflow,
        steamSettings: request.steamSettings,
        hotWaterData: request.hotWaterData,
        rinseData: request.rinseData,
        twoTapSteamStop: request.twoTapSteamStop
      }
    };
    return {
      type: 'queued',
      state: request.state,
      service: preflight.service,
      status: preflight.status,
      completion: this.dispatch(prepared)
    };
  }

  async execute(request: MachineActionRequest): Promise<MachineActionOutcome> {
    const started = this.start(request);
    return started.type === 'queued' ? await started.completion : started;
  }

  /** The one argument-free path allowed to bypass live startup authority. */
  async stopSafely(): Promise<MachineActionOutcome> {
    const outcome = await this.commands.stopSafely();
    if (outcome.status === 'completed') {
      return {
        type: 'sent',
        state: 'idle',
        service: null,
        status: machineActionStatus('idle', 'sent'),
        restore: null
      };
    }
    if (outcome.status === 'authority-blocked') {
      return { type: 'blocked-authority', phase: 'dispatch', restore: null };
    }
    if (outcome.status === 'failed') {
      return failedOutcome('idle', outcome.error, null);
    }
    return { type: 'canceled', reason: outcome.status };
  }

  private async dispatch(prepared: PreparedMachineAction): Promise<MachineActionOutcome> {
    const coordinated = await this.commands.runExact(async (lane) => {
      const dispatchPreflight = this.preflight(prepared.state, prepared.skipScaleCheck);
      if (dispatchPreflight.type !== 'ready') {
        return { type: 'blocked' as const, preflight: dispatchPreflight };
      }

      let command = prepared.command;
      if (prepared.state === 'espresso' && prepared.command.workflow) {
        const workflow = await lane.updateWorkflow(prepared.command.workflow);
        command = { ...prepared.command, workflow };
        if (prepared.calibration?.persist === true) {
          await lane.updateCalibration(prepared.calibration.flowMultiplier);
        }
      }

      return {
        type: 'command' as const,
        command: await this.sendInOwnedLane(command, lane)
      };
    });

    if (coordinated.status === 'authority-blocked') {
      return { type: 'blocked-authority', phase: 'dispatch', restore: null };
    }
    if (coordinated.status === 'failed') {
      return failedOutcome(prepared.state, coordinated.error, null);
    }
    if (coordinated.status !== 'completed') {
      return { type: 'canceled', reason: coordinated.status };
    }
    return this.mapDispatched(prepared, coordinated.value);
  }

  private mapDispatched(
    prepared: PreparedMachineAction,
    dispatched: DispatchedMachineAction
  ): MachineActionOutcome {
    if (dispatched.type === 'blocked') return blockedSafety(dispatched.preflight, 'dispatch');
    const command = dispatched.command;
    if (command.type === 'sent') {
      return {
        type: 'sent',
        state: prepared.state,
        service: prepared.service,
        status: command.status,
        restore: command.restore
      };
    }
    if (isMachineAuthorityUnavailableError(command.error)) {
      return { type: 'blocked-authority', phase: 'dispatch', restore: command.restore };
    }
    if (command.noScaleBlocked) {
      return {
        type: 'blocked-safety',
        reason: 'no-scale',
        phase: 'gateway',
        error: command.error
      };
    }
    return failedOutcome(prepared.state, command.error, command.restore);
  }

  private sendInOwnedLane(
    command: Parameters<typeof sendMachineActionCommand>[0],
    lane: OwnedMachineLane
  ): Promise<SendMachineActionCommandResult> {
    return sendMachineActionCommand(command, {
      updateWorkflow: (workflow) => lane.updateWorkflow(workflow),
      requestState: (state) => lane.requestState(state),
      isNoScaleShotBlockError: (error) => this.failures.isNoScaleShotBlockError(error)
    });
  }

  private preflight(state: MachineState, skipScaleCheck: boolean): MachineActionPreflight {
    const safety = this.safety.snapshot();
    return machineActionPreflight({
      state,
      skipScaleCheck,
      noScaleBlocked: safety.noScaleBlocked,
      waterAlertHard: safety.waterAlertHard
    });
  }
}

function blockedSafety(
  preflight: Exclude<MachineActionPreflight, { type: 'ready' }>,
  phase: 'prequeue' | 'dispatch'
): Extract<MachineActionOutcome, { type: 'blocked-safety' }> {
  return {
    type: 'blocked-safety',
    reason: preflight.type === 'blocked-no-scale' ? 'no-scale' : 'water',
    phase
  };
}

function failedOutcome(
  state: MachineState,
  error: unknown,
  restore: MachineServiceWorkflowRestore | null
): MachineActionOutcome {
  return {
    type: 'failed',
    state,
    status: 'Machine command failed',
    error,
    restore
  };
}

function validCalibration(
  calibration: MachineActionCalibration | null | undefined
): MachineActionCalibration | null {
  if (
    calibration == null ||
    typeof calibration.flowMultiplier !== 'number' ||
    !Number.isFinite(calibration.flowMultiplier) ||
    calibration.flowMultiplier <= 0
  ) return null;
  return calibration;
}
