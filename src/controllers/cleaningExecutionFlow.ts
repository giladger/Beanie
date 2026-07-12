import type { HotWaterData, RinseData, SteamSettings, Workflow } from '../api/types';
import {
  loadCleaningWorkflow,
  type CleaningWorkflowLoadResult
} from './cleaningWorkflowController';
import {
  machineActionStatus,
  sendMachineActionCommand,
  type SendMachineActionCommandResult
} from './machineExecutionController';
import type {
  MachineWorkflowCommandOutcome,
  OwnedMachineLane
} from './machineWorkflowCommands';

const CLEANING_ARMED_STATUS = 'Press the GHC to run the cleaning flush';
const CLEANING_AUTHORITY_STATUS = 'Cleaning is read-only until live data reconnects';
const CLEANING_CANCELED_STATUS = 'Cleaning command canceled';

export interface CleaningEspressoCommand {
  steamSettings: SteamSettings;
  hotWaterData: HotWaterData;
  rinseData: RinseData;
  twoTapSteamStop: boolean;
}

export interface CleaningExecutionInput {
  /** Bean-independent workflow produced by cleaningStartPlan. */
  workflow: Workflow;
  demo: boolean;
  /** False arms a group-head-controller machine without requesting espresso. */
  startShot: boolean;
  espresso: CleaningEspressoCommand;
}

/** Structural subset of MachineWorkflowCommands used by this feature. */
export interface CleaningMachineCommandsPort {
  stageDesired(workflow: Workflow | null): void;
  runExact<Value>(
    run: (lane: OwnedMachineLane) => Value | PromiseLike<Value>
  ): Promise<MachineWorkflowCommandOutcome<Value>>;
}

export interface CleaningExecutionDependencies {
  commands: CleaningMachineCommandsPort;
  /** Classification only; the owned lane remains the authority enforcer. */
  hasLiveAuthority(): boolean;
  isNoScaleShotBlockError(error: unknown): boolean;
}

export type CleaningExecutionOutcome =
  | {
      type: 'loaded';
      source: 'demo' | 'gateway';
      workflow: Workflow;
      status: typeof CLEANING_ARMED_STATUS;
    }
  | {
      type: 'started';
      source: 'demo';
      workflow: Workflow;
      command: null;
      status: string;
    }
  | {
      type: 'started';
      source: 'gateway';
      workflow: Workflow;
      command: Extract<SendMachineActionCommandResult, { type: 'sent' }>;
      status: string;
    }
  | {
      type: 'failed';
      phase: 'load' | 'start' | 'command';
      error: unknown;
      status: string;
      noScaleBlocked: boolean;
    }
  | {
      type: 'authority';
      status: typeof CLEANING_AUTHORITY_STATUS;
    }
  | {
      type: 'canceled';
      reason: 'superseded' | 'canceled' | 'disposed';
      status: typeof CLEANING_CANCELED_STATUS;
    };

type OwnedLaneCleaningResult =
  | { type: 'load-failed'; result: Extract<CleaningWorkflowLoadResult, { type: 'failed' }> }
  | { type: 'loaded'; workflow: Workflow }
  | { type: 'started'; workflow: Workflow; command: SendMachineActionCommandResult };

/**
 * Executes the mutation-only portion of a cleaning cycle.
 *
 * The live path acquires the shared machine lane exactly once. Workflow load
 * and the optional espresso request both use the provided owned-lane
 * capability, so a recipe apply cannot interleave and no nested scheduler can
 * deadlock the transaction.
 */
export class CleaningExecutionFlow {
  constructor(private readonly deps: CleaningExecutionDependencies) {}

  async execute(input: CleaningExecutionInput): Promise<CleaningExecutionOutcome> {
    this.deps.commands.stageDesired(input.workflow);

    if (input.demo) return this.executeDemo(input);

    const coordinated = await this.deps.commands.runExact(
      (lane) => this.executeInOwnedLane(input, lane)
    );
    if (coordinated.status === 'authority-blocked') return this.authorityOutcome();
    if (
      coordinated.status === 'superseded' ||
      coordinated.status === 'canceled' ||
      coordinated.status === 'disposed'
    ) {
      return {
        type: 'canceled',
        reason: coordinated.status,
        status: CLEANING_CANCELED_STATUS
      };
    }
    if (coordinated.status === 'failed') {
      if (!this.deps.hasLiveAuthority()) return this.authorityOutcome();
      return {
        type: 'failed',
        phase: 'command',
        error: coordinated.error,
        status: 'Cleaning profile failed',
        noScaleBlocked: false
      };
    }

    const result = coordinated.value;
    if (result.type === 'load-failed') {
      if (!this.deps.hasLiveAuthority()) return this.authorityOutcome();
      return {
        type: 'failed',
        phase: 'load',
        error: result.result.error,
        status: result.result.status,
        noScaleBlocked: false
      };
    }
    if (result.type === 'loaded') {
      return {
        type: 'loaded',
        source: 'gateway',
        workflow: result.workflow,
        status: CLEANING_ARMED_STATUS
      };
    }
    if (result.command.type === 'failed') {
      if (!this.deps.hasLiveAuthority()) return this.authorityOutcome();
      return {
        type: 'failed',
        phase: 'start',
        error: result.command.error,
        status: result.command.status,
        noScaleBlocked: result.command.noScaleBlocked
      };
    }
    return {
      type: 'started',
      source: 'gateway',
      workflow: result.workflow,
      command: result.command,
      status: result.command.status
    };
  }

  private async executeDemo(input: CleaningExecutionInput): Promise<CleaningExecutionOutcome> {
    const result = await loadCleaningWorkflow(input.workflow, true, {
      updateWorkflow: () => Promise.reject(new Error('Demo cleaning must not write a workflow'))
    });
    // loadCleaningWorkflow's demo branch is total; retain an explicit guard so
    // this flow stays safe if that lower-level contract changes later.
    if (result.type === 'failed') {
      return {
        type: 'failed',
        phase: 'load',
        error: result.error,
        status: result.status,
        noScaleBlocked: false
      };
    }
    if (!input.startShot) {
      return {
        type: 'loaded',
        source: 'demo',
        workflow: result.workflow,
        status: CLEANING_ARMED_STATUS
      };
    }
    return {
      type: 'started',
      source: 'demo',
      workflow: result.workflow,
      command: null,
      status: machineActionStatus('espresso', 'demo')
    };
  }

  private async executeInOwnedLane(
    input: CleaningExecutionInput,
    lane: OwnedMachineLane
  ): Promise<OwnedLaneCleaningResult> {
    const result = await loadCleaningWorkflow(input.workflow, false, {
      updateWorkflow: (workflow) => lane.updateWorkflow(workflow)
    });
    if (result.type === 'failed') return { type: 'load-failed', result };
    if (!input.startShot) return { type: 'loaded', workflow: result.workflow };

    const command = await sendMachineActionCommand({
      state: 'espresso',
      workflow: result.workflow,
      ...input.espresso
    }, {
      // Espresso currently does not rewrite the workflow inside the send path,
      // but the owned capability preserves atomicity if that behavior evolves.
      updateWorkflow: (workflow) => lane.updateWorkflow(workflow),
      requestState: (state) => lane.requestState(state),
      isNoScaleShotBlockError: this.deps.isNoScaleShotBlockError
    });
    return { type: 'started', workflow: result.workflow, command };
  }

  private authorityOutcome(): Extract<CleaningExecutionOutcome, { type: 'authority' }> {
    return { type: 'authority', status: CLEANING_AUTHORITY_STATUS };
  }
}
