import type { De1AdvancedSettingsPatch } from '../api/settings';
import type { De1MachineSettings, MachineState, Workflow } from '../api/types';
import type {
  GatewayMutationOutcome,
  GatewayMutationPort
} from '../runtime/gatewayMutationCoordinator';

const MACHINE_RESOURCE = 'machine';

export interface MachineWorkflowTransport {
  updateWorkflow(workflow: Workflow): Workflow | PromiseLike<Workflow>;
  updateCalibration(flowMultiplier: number): void | PromiseLike<void>;
  updateMachineSettings(patch: Partial<De1MachineSettings>): void | PromiseLike<void>;
  updateMachineAdvancedSettings(patch: De1AdvancedSettingsPatch): void | PromiseLike<void>;
  resetMachineSettings(): void | PromiseLike<void>;
  setRefillLevel(refillLevel: number): void | PromiseLike<void>;
  requestState(state: MachineState): void | PromiseLike<void>;
}

/** Read at dispatch and immediately before every owned-lane mutation. */
export interface MachineAuthorityPort {
  hasLiveAuthority(): boolean;
}

/**
 * Capabilities available while a command owns the shared machine lane.
 *
 * There is intentionally no scheduling method on this object. Compound
 * commands call these operations directly while retaining the lane, avoiding
 * a nested submission that would wait on itself.
 */
export interface OwnedMachineLane {
  updateWorkflow(workflow: Workflow): Promise<Workflow>;
  updateCalibration(flowMultiplier: number): Promise<void>;
  updateMachineSettings(patch: Partial<De1MachineSettings>): Promise<void>;
  updateMachineAdvancedSettings(patch: De1AdvancedSettingsPatch): Promise<void>;
  resetMachineSettings(): Promise<void>;
  setRefillLevel(refillLevel: number): Promise<void>;
  requestState(state: MachineState): Promise<void>;
}

export interface MachineWorkflowSnapshot {
  /** Most recent workflow requested by local intent, which may not be saved yet. */
  readonly desired: Workflow | null;
  /** Most recent workflow confirmed by an authoritative gateway response. */
  readonly shadow: Workflow | null;
}

export type MachineWorkflowCommandOutcome<Value> =
  | GatewayMutationOutcome<Value>
  | { status: 'authority-blocked' };

/**
 * Typed authority for workflow and physical machine mutations.
 *
 * The owner keeps desired intent separate from the last gateway-confirmed
 * workflow and supplies one non-nestable capability to exact/latest command
 * bodies. Ordinary commands always require live authority. The only offline
 * exception is the argument-free `stopSafely()` method, which can request the
 * fail-safe idle state and cannot be repurposed to start another mode.
 */
export class MachineWorkflowCommands {
  private desiredWorkflow: Workflow | null = null;
  private shadowWorkflow: Workflow | null = null;
  private readonly ownedLane: OwnedMachineLane;

  constructor(
    private readonly mutations: GatewayMutationPort<string>,
    private readonly transport: MachineWorkflowTransport,
    private readonly authority: MachineAuthorityPort
  ) {
    this.ownedLane = Object.freeze({
      updateWorkflow: (workflow: Workflow) => this.updateWorkflowInOwnedLane(workflow),
      updateCalibration: (flowMultiplier: number) => this.runOwnedMutation(
        () => this.transport.updateCalibration(flowMultiplier)
      ),
      updateMachineSettings: (patch: Partial<De1MachineSettings>) => this.runOwnedMutation(
        () => this.transport.updateMachineSettings(patch)
      ),
      updateMachineAdvancedSettings: (patch: De1AdvancedSettingsPatch) => this.runOwnedMutation(
        () => this.transport.updateMachineAdvancedSettings(patch)
      ),
      resetMachineSettings: () => this.runOwnedMutation(
        () => this.transport.resetMachineSettings()
      ),
      setRefillLevel: (refillLevel: number) => this.runOwnedMutation(
        () => this.transport.setRefillLevel(refillLevel)
      ),
      requestState: (state: MachineState) => this.requestStateInOwnedLane(state)
    });
  }

  get snapshot(): MachineWorkflowSnapshot {
    return {
      desired: this.desiredWorkflow,
      shadow: this.shadowWorkflow
    };
  }

  /** Adopt startup/socket authority as both the confirmed and desired baseline. */
  synchronizeAuthoritative(workflow: Workflow | null): void {
    this.shadowWorkflow = workflow;
    this.desiredWorkflow = workflow;
  }

  /** Record a confirmed response without overwriting newer local intent. */
  adoptAuthoritative(workflow: Workflow | null): void {
    this.shadowWorkflow = workflow;
  }

  stageDesired(workflow: Workflow | null): void {
    this.desiredWorkflow = workflow;
  }

  /** Resolve local intent first, then confirmed state, then the caller's fallback. */
  desiredOr(fallback: Workflow | null): Workflow | null {
    return this.desiredWorkflow ?? this.shadowWorkflow ?? fallback;
  }

  runExact<Value>(
    run: (lane: OwnedMachineLane) => Value | PromiseLike<Value>
  ): Promise<MachineWorkflowCommandOutcome<Value>> {
    return this.runAuthorized((execute) => this.mutations.exact(MACHINE_RESOURCE, execute), run);
  }

  runLatest<Value>(
    coalesceKey: string,
    run: (lane: OwnedMachineLane) => Value | PromiseLike<Value>
  ): Promise<MachineWorkflowCommandOutcome<Value>> {
    return this.runAuthorized(
      (execute) => this.mutations.latest(MACHINE_RESOURCE, coalesceKey, execute),
      run
    );
  }

  /**
   * Queue the one mutation allowed without live startup authority.
   *
   * The state and policy are closed over here rather than exposed as options,
   * so an offline exception cannot accidentally be applied to Wake or Start.
   */
  async stopSafely(): Promise<MachineWorkflowCommandOutcome<void>> {
    const outcome = await this.mutations.exact(
      MACHINE_RESOURCE,
      () => this.transport.requestState('idle')
    );
    return mapAuthorityOutcome(outcome);
  }

  private async runAuthorized<Value>(
    submit: (
      execute: () => Value | PromiseLike<Value>
    ) => Promise<GatewayMutationOutcome<Value>>,
    run: (lane: OwnedMachineLane) => Value | PromiseLike<Value>
  ): Promise<MachineWorkflowCommandOutcome<Value>> {
    const outcome = await submit(() => {
      this.assertLiveAuthority();
      return run(this.ownedLane);
    });
    return mapAuthorityOutcome(outcome);
  }

  private async updateWorkflowInOwnedLane(workflow: Workflow): Promise<Workflow> {
    const saved = await this.runOwnedMutation(() => this.transport.updateWorkflow(workflow));
    // A newer desired workflow may have been staged while this request was in
    // flight. Only advance the confirmed shadow here.
    this.adoptAuthoritative(saved);
    return saved;
  }

  private async requestStateInOwnedLane(state: MachineState): Promise<void> {
    await this.runOwnedMutation(() => this.transport.requestState(state));
  }

  /** Revalidate live authority immediately before every gateway side effect. */
  private async runOwnedMutation<Value>(
    mutation: () => Value | PromiseLike<Value>
  ): Promise<Value> {
    this.assertLiveAuthority();
    return await mutation();
  }

  private assertLiveAuthority(): void {
    if (!this.authority.hasLiveAuthority()) throw new MachineAuthorityUnavailableError();
  }
}

class MachineAuthorityUnavailableError extends Error {
  constructor() {
    super('Live machine authority is unavailable');
    this.name = 'MachineAuthorityUnavailableError';
  }
}

function mapAuthorityOutcome<Value>(
  outcome: GatewayMutationOutcome<Value>
): MachineWorkflowCommandOutcome<Value> {
  if (outcome.status === 'failed' && outcome.error instanceof MachineAuthorityUnavailableError) {
    return { status: 'authority-blocked' };
  }
  return outcome;
}
