import type { De1AdvancedSettingsPatch } from '../api/settings';
import type {
  De1MachineSettings,
  HotWaterData,
  MachineState,
  RinseData,
  SteamSettings,
  Workflow
} from '../api/types';
import {
  CleaningExecutionFlow,
  type CleaningExecutionInput,
  type CleaningMachineCommandsPort
} from '../controllers/cleaningExecutionFlow';
import {
  MachineWorkflowCommands,
  type MachineAuthorityPort,
  type MachineWorkflowCommandOutcome,
  type MachineWorkflowTransport,
  type OwnedMachineLane
} from '../controllers/machineWorkflowCommands';
import type {
  GatewayMutationOutcome,
  GatewayMutationPort
} from '../runtime/gatewayMutationCoordinator';

async function main(): Promise<void> {
  await run('live cleaning loads the workflow and starts espresso in one exact lane', async () => {
    const harness = createHarness();
    harness.transport.confirmWorkflowAs = 'confirmed-cleaning';
    const input = cleaningInput({ startShot: true });

    const result = await harness.flow.execute(input);

    equal(result.type, 'started');
    equal(result.type === 'started' ? result.source : null, 'gateway');
    equal(result.type === 'started' ? result.workflow.name : null, 'confirmed-cleaning');
    equal(result.type === 'started' ? result.status : null, 'shot started');
    deepEqual(harness.transport.events, ['workflow:cleaning', 'state:espresso']);
    equal(harness.mutations.exactCalls, 1);
    equal(harness.mutations.latestCalls, 0);
    equal(harness.mutations.nestedSubmission, false);
    equal(harness.commands.snapshot.desired, input.workflow);
    equal(harness.commands.snapshot.shadow?.name, 'confirmed-cleaning');
  });

  await run('group-head-controller arm-only mode loads the workflow without starting espresso', async () => {
    const harness = createHarness();
    const result = await harness.flow.execute(cleaningInput({ startShot: false }));

    equal(result.type, 'loaded');
    equal(result.type === 'loaded' ? result.source : null, 'gateway');
    equal(result.type === 'loaded' ? result.status : null, 'Press the GHC to run the cleaning flush');
    deepEqual(harness.transport.events, ['workflow:cleaning']);
    equal(harness.mutations.exactCalls, 1);
    equal(harness.mutations.nestedSubmission, false);
  });

  await run('demo cleaning stages intent without acquiring the machine lane', async () => {
    const startedHarness = createHarness();
    startedHarness.authority.live = false;
    const startedInput = cleaningInput({ demo: true, startShot: true });
    const started = await startedHarness.flow.execute(startedInput);

    equal(started.type, 'started');
    equal(started.type === 'started' ? started.source : null, 'demo');
    equal(started.type === 'started' ? started.command : 'unexpected', null);
    equal(started.type === 'started' ? started.status : null, 'Demo shot');
    equal(startedHarness.mutations.exactCalls, 0);
    equal(startedHarness.commands.snapshot.desired, startedInput.workflow);
    deepEqual(startedHarness.transport.events, []);

    const armedHarness = createHarness();
    const armed = await armedHarness.flow.execute(cleaningInput({ demo: true, startShot: false }));
    equal(armed.type, 'loaded');
    equal(armed.type === 'loaded' ? armed.source : null, 'demo');
    equal(armedHarness.mutations.exactCalls, 0);
    deepEqual(armedHarness.transport.events, []);
  });

  await run('workflow load failures do not request espresso', async () => {
    const harness = createHarness();
    harness.transport.workflowError = new Error('workflow unavailable');
    const result = await harness.flow.execute(cleaningInput({ startShot: true }));

    equal(result.type, 'failed');
    equal(result.type === 'failed' ? result.phase : null, 'load');
    equal(result.type === 'failed' ? result.status : null, 'Cleaning profile load failed');
    equal(result.type === 'failed' ? result.noScaleBlocked : null, false);
    deepEqual(harness.transport.events, ['workflow:cleaning']);
    deepEqual(harness.transport.requestedStates, []);
  });

  await run('espresso start failures retain their phase and no-scale classification', async () => {
    const harness = createHarness();
    harness.transport.stateError = new Error('block_no_scale');
    const result = await harness.flow.execute(cleaningInput({ startShot: true }));

    equal(result.type, 'failed');
    equal(result.type === 'failed' ? result.phase : null, 'start');
    equal(result.type === 'failed' ? result.status : null, 'Machine command failed');
    equal(result.type === 'failed' ? result.noScaleBlocked : null, true);
    deepEqual(harness.transport.events, ['workflow:cleaning', 'state:espresso']);
  });

  await run('dispatch-time authority rejection returns an explicit authority outcome', async () => {
    const harness = createHarness();
    harness.authority.live = false;
    const result = await harness.flow.execute(cleaningInput({ startShot: true }));

    equal(result.type, 'authority');
    equal(result.type === 'authority' ? result.status : null, 'Cleaning is read-only until live data reconnects');
    deepEqual(harness.transport.events, []);
    equal(harness.mutations.exactCalls, 1);
  });

  await run('authority loss between workflow load and espresso start is classified explicitly', async () => {
    const harness = createHarness();
    harness.transport.afterWorkflow = () => {
      harness.authority.live = false;
    };
    const result = await harness.flow.execute(cleaningInput({ startShot: true }));

    equal(result.type, 'authority');
    deepEqual(harness.transport.events, ['workflow:cleaning']);
    deepEqual(harness.transport.requestedStates, []);
  });

  await run('shared queue cancellation outcomes remain distinct from command failures', async () => {
    for (const reason of ['superseded', 'canceled', 'disposed'] as const) {
      const commands = new CannedCommands({ status: reason });
      const flow = new CleaningExecutionFlow({
        commands,
        hasLiveAuthority: () => true,
        isNoScaleShotBlockError: () => false
      });
      const input = cleaningInput({ startShot: true });
      const result = await flow.execute(input);

      equal(result.type, 'canceled');
      equal(result.type === 'canceled' ? result.reason : null, reason);
      equal(commands.staged, input.workflow);
      equal(commands.runCalls, 1);
    }
  });

  await run('unexpected shared command failures return the command phase', async () => {
    const error = new Error('scheduler failed');
    const commands = new CannedCommands({ status: 'failed', error });
    const flow = new CleaningExecutionFlow({
      commands,
      hasLiveAuthority: () => true,
      isNoScaleShotBlockError: () => false
    });
    const result = await flow.execute(cleaningInput({ startShot: true }));

    equal(result.type, 'failed');
    equal(result.type === 'failed' ? result.phase : null, 'command');
    equal(result.type === 'failed' ? result.error : null, error);
    equal(result.type === 'failed' ? result.status : null, 'Cleaning profile failed');
  });
}

interface MutableAuthority extends MachineAuthorityPort {
  live: boolean;
}

interface RecordingTransport extends MachineWorkflowTransport {
  events: string[];
  requestedStates: MachineState[];
  confirmWorkflowAs: string | null;
  workflowError: unknown;
  stateError: unknown;
  afterWorkflow: (() => void) | null;
}

interface Harness {
  mutations: RecordingMutationPort;
  authority: MutableAuthority;
  transport: RecordingTransport;
  commands: MachineWorkflowCommands;
  flow: CleaningExecutionFlow;
}

function createHarness(): Harness {
  const mutations = new RecordingMutationPort();
  const authority: MutableAuthority = {
    live: true,
    hasLiveAuthority() {
      return this.live;
    }
  };
  const transport = recordingTransport();
  const commands = new MachineWorkflowCommands(mutations, transport, authority);
  const flow = new CleaningExecutionFlow({
    commands,
    hasLiveAuthority: () => authority.live,
    isNoScaleShotBlockError: (error) => error instanceof Error && error.message.includes('block_no_scale')
  });
  return { mutations, authority, transport, commands, flow };
}

class RecordingMutationPort implements GatewayMutationPort<string> {
  exactCalls = 0;
  latestCalls = 0;
  nestedSubmission = false;
  private laneActive = false;

  exact<Value>(
    _resourceKey: string,
    run: () => Value | PromiseLike<Value>
  ): Promise<GatewayMutationOutcome<Value>> {
    this.exactCalls += 1;
    return this.execute(run);
  }

  latest<Value>(
    _resourceKey: string,
    _coalesceKey: string,
    run: () => Value | PromiseLike<Value>
  ): Promise<GatewayMutationOutcome<Value>> {
    this.latestCalls += 1;
    return this.execute(run);
  }

  private async execute<Value>(
    run: () => Value | PromiseLike<Value>
  ): Promise<GatewayMutationOutcome<Value>> {
    if (this.laneActive) {
      this.nestedSubmission = true;
      return { status: 'failed', error: new Error('Nested lane acquisition') };
    }
    this.laneActive = true;
    try {
      return { status: 'completed', value: await run() };
    } catch (error) {
      return { status: 'failed', error };
    } finally {
      this.laneActive = false;
    }
  }
}

class CannedCommands implements CleaningMachineCommandsPort {
  staged: Workflow | null = null;
  runCalls = 0;

  constructor(private readonly outcome: MachineWorkflowCommandOutcome<never>) {}

  stageDesired(workflow: Workflow | null): void {
    this.staged = workflow;
  }

  runExact<Value>(
    _run: (lane: OwnedMachineLane) => Value | PromiseLike<Value>
  ): Promise<MachineWorkflowCommandOutcome<Value>> {
    this.runCalls += 1;
    return Promise.resolve(this.outcome as MachineWorkflowCommandOutcome<Value>);
  }
}

function recordingTransport(): RecordingTransport {
  const events: string[] = [];
  const requestedStates: MachineState[] = [];
  return {
    events,
    requestedStates,
    confirmWorkflowAs: null,
    workflowError: null,
    stateError: null,
    afterWorkflow: null,
    updateWorkflow(workflow) {
      events.push(`workflow:${workflow.name ?? ''}`);
      if (this.workflowError != null) throw this.workflowError;
      const confirmed = this.confirmWorkflowAs == null
        ? workflow
        : { ...workflow, name: this.confirmWorkflowAs };
      this.afterWorkflow?.();
      return confirmed;
    },
    updateCalibration() {},
    updateMachineSettings(_patch: Partial<De1MachineSettings>) {},
    updateMachineAdvancedSettings(_patch: De1AdvancedSettingsPatch) {},
    resetMachineSettings() {},
    setRefillLevel() {},
    requestState(state) {
      events.push(`state:${state}`);
      requestedStates.push(state);
      if (this.stateError != null) throw this.stateError;
    }
  };
}

function cleaningInput(
  overrides: Partial<CleaningExecutionInput> = {}
): CleaningExecutionInput {
  return {
    workflow: {
      name: 'cleaning',
      profile: { title: 'Cleaning / forward flush x5', steps: [] },
      context: { beanId: null, beanBatchId: null, finalBeverageType: 'cleaning' }
    },
    demo: false,
    startShot: true,
    espresso: {
      steamSettings: steam(),
      hotWaterData: water(),
      rinseData: rinse(),
      twoTapSteamStop: false
    },
    ...overrides
  };
}

function steam(): SteamSettings {
  return { targetTemperature: 130, duration: 20, flow: 1.2, stopAtTemperature: 60 };
}

function water(): HotWaterData {
  return { targetTemperature: 90, duration: 30, flow: 6, volume: 120 };
}

function rinse(): RinseData {
  return { targetTemperature: 90, duration: 8, flow: 6 };
}

async function run(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

function equal<T>(actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(`Expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`);
  }
}

function deepEqual(actual: unknown, expected: unknown): void {
  equal(JSON.stringify(actual), JSON.stringify(expected));
}

await main();
