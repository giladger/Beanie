import type { De1AdvancedSettingsPatch } from '../api/settings';
import type { De1MachineSettings, MachineState, Workflow } from '../api/types';
import {
  MachineWorkflowCommands,
  type MachineAuthorityPort,
  type MachineWorkflowTransport,
  type OwnedMachineLane
} from '../controllers/machineWorkflowCommands';
import { GatewayMutationCoordinator } from '../runtime/gatewayMutationCoordinator';

await run('machine workflow owner keeps newer desired intent separate from confirmed shadow', async () => {
  const mutations = new GatewayMutationCoordinator<string>();
  const save = deferred<Workflow>();
  const transport = fakeTransport();
  transport.updateWorkflow = () => save.promise;
  const commands = new MachineWorkflowCommands(mutations, transport, liveAuthority());
  const baseline = workflow('baseline');
  const sent = workflow('sent');
  const newer = workflow('newer-local-intent');
  const confirmed = workflow('gateway-confirmed');

  commands.synchronizeAuthoritative(baseline);
  deepEqual(commands.snapshot, { desired: baseline, shadow: baseline });
  commands.stageDesired(sent);
  const writing = commands.runExact((lane) => lane.updateWorkflow(sent));
  commands.stageDesired(newer);
  save.resolve(confirmed);

  const outcome = await writing;
  equal(outcome.status, 'completed');
  deepEqual(commands.snapshot, { desired: newer, shadow: confirmed });
  equal(commands.desiredOr(workflow('fallback')), newer);

  commands.stageDesired(null);
  equal(commands.desiredOr(workflow('fallback')), confirmed);
  commands.synchronizeAuthoritative(baseline);
  deepEqual(commands.snapshot, { desired: baseline, shadow: baseline });
});

await run('exact and latest machine calls use one shared owned lane', async () => {
  const mutations = new GatewayMutationCoordinator<string>();
  const transport = fakeTransport();
  const commands = new MachineWorkflowCommands(mutations, transport, liveAuthority());
  const gate = deferred<void>();
  const starts: string[] = [];

  const blocking = commands.runExact(() => {
    starts.push('blocking');
    return gate.promise;
  });
  const stale = commands.runLatest('recipe', () => starts.push('stale'));
  const latest = commands.runLatest('recipe', (lane) => {
    starts.push('latest');
    return lane.requestState('espresso');
  });

  equal((await stale).status, 'superseded');
  gate.resolve(undefined);
  equal((await blocking).status, 'completed');
  equal((await latest).status, 'completed');
  deepEqual(starts, ['blocking', 'latest']);
  deepEqual(transport.requestedStates, ['espresso']);
});

await run('machine authority is evaluated when queued work actually dispatches', async () => {
  const mutations = new GatewayMutationCoordinator<string>();
  const transport = fakeTransport();
  const authority = liveAuthority();
  const commands = new MachineWorkflowCommands(mutations, transport, authority);
  const gate = deferred<void>();
  const blocking = commands.runExact(() => gate.promise);
  const queuedStart = commands.runExact((lane) => lane.requestState('espresso'));

  authority.live = false;
  gate.resolve(undefined);
  equal((await blocking).status, 'completed');
  deepEqual(await queuedStart, { status: 'authority-blocked' });
  deepEqual(transport.requestedStates, []);
});

await run('owned lane rechecks authority between compound machine mutations', async () => {
  const mutations = new GatewayMutationCoordinator<string>();
  const authority = liveAuthority();
  const transport = fakeTransport();
  const confirmed = workflow('confirmed-before-disconnect');
  transport.updateWorkflow = () => {
    authority.live = false;
    return confirmed;
  };
  const commands = new MachineWorkflowCommands(mutations, transport, authority);

  const outcome = await commands.runExact(async (lane) => {
    await lane.updateWorkflow(workflow('desired'));
    await lane.requestState('espresso');
  });

  deepEqual(outcome, { status: 'authority-blocked' });
  deepEqual(commands.snapshot, { desired: null, shadow: confirmed });
  deepEqual(transport.requestedStates, []);
});

await run('owned lane routes every typed machine mutation through the injected transport', async () => {
  const mutations = new GatewayMutationCoordinator<string>();
  const transport = fakeTransport();
  const commands = new MachineWorkflowCommands(mutations, transport, liveAuthority());
  const machinePatch: Partial<De1MachineSettings> = { steamPurgeMode: 1, tankTemp: 88 };
  const advancedPatch: De1AdvancedSettingsPatch = { heaterVoltage: 230, refillKitSetting: 2 };

  const outcome = await commands.runExact(async (lane) => {
    await lane.updateCalibration(1.07);
    await lane.updateMachineSettings(machinePatch);
    await lane.updateMachineAdvancedSettings(advancedPatch);
    await lane.setRefillLevel(42);
    await lane.resetMachineSettings();
  });

  equal(outcome.status, 'completed');
  deepEqual(transport.calibrations, [1.07]);
  deepEqual(transport.machineSettingsPatches, [machinePatch]);
  deepEqual(transport.advancedSettingsPatches, [advancedPatch]);
  deepEqual(transport.refillLevels, [42]);
  equal(transport.resetCount, 1);
});

await run('extended machine mutations recheck authority between compound steps', async () => {
  const mutations = new GatewayMutationCoordinator<string>();
  const authority = liveAuthority();
  const transport = fakeTransport();
  transport.updateCalibration = (flowMultiplier) => {
    transport.calibrations.push(flowMultiplier);
    authority.live = false;
  };
  const commands = new MachineWorkflowCommands(mutations, transport, authority);

  const outcome = await commands.runExact(async (lane) => {
    await lane.updateCalibration(1.03);
    await lane.updateMachineSettings({ fan: 2 });
  });

  deepEqual(outcome, { status: 'authority-blocked' });
  deepEqual(transport.calibrations, [1.03]);
  deepEqual(transport.machineSettingsPatches, []);
});

await run('only the explicit safety-stop API bypasses live authority', async () => {
  const mutations = new GatewayMutationCoordinator<string>();
  const transport = fakeTransport();
  const authority = liveAuthority();
  authority.live = false;
  const commands = new MachineWorkflowCommands(mutations, transport, authority);

  const ordinaryStop = await commands.runExact((lane) => lane.requestState('idle'));
  const ordinaryWake = await commands.runExact((lane) => lane.requestState('sleeping'));
  deepEqual(ordinaryStop, { status: 'authority-blocked' });
  deepEqual(ordinaryWake, { status: 'authority-blocked' });
  deepEqual(transport.requestedStates, []);

  deepEqual(await commands.stopSafely(), { status: 'completed', value: undefined });
  deepEqual(transport.requestedStates, ['idle']);
});

await run('owned machine lane exposes mutation capabilities but no nested scheduler', async () => {
  const mutations = new GatewayMutationCoordinator<string>();
  const commands = new MachineWorkflowCommands(mutations, fakeTransport(), liveAuthority());
  let captured: OwnedMachineLane | null = null;

  const outcome = await commands.runExact((lane) => {
    captured = lane;
  });

  equal(outcome.status, 'completed');
  equal(Object.isFrozen(captured), true);
  deepEqual(Object.keys(captured ?? {}).sort(), [
    'requestState',
    'resetMachineSettings',
    'setRefillLevel',
    'updateCalibration',
    'updateMachineAdvancedSettings',
    'updateMachineSettings',
    'updateWorkflow'
  ]);
});

await run('shared mutation owner, not the machine feature, owns disposal and drain', async () => {
  const mutations = new GatewayMutationCoordinator<string>();
  const transport = fakeTransport();
  const commands = new MachineWorkflowCommands(mutations, transport, liveAuthority());
  mutations.dispose();

  deepEqual(await commands.runExact((lane) => lane.requestState('espresso')), { status: 'disposed' });
  deepEqual(await commands.stopSafely(), { status: 'disposed' });
  deepEqual(transport.requestedStates, []);
  await mutations.disposeAndWait();
});

// Compile-time architecture fences: an owned lane cannot reacquire its own
// scheduler, and a feature-specific owner cannot tear down the shared queue.
function assertNarrowOwnership(lane: OwnedMachineLane, commands: MachineWorkflowCommands): void {
  // @ts-expect-error The lane deliberately has no nested scheduling capability.
  void lane.runExact;
  // @ts-expect-error The machine feature does not own shared scheduler disposal.
  void commands.dispose;
}
void assertNarrowOwnership;

interface MutableAuthority extends MachineAuthorityPort {
  live: boolean;
}

interface FakeTransport extends MachineWorkflowTransport {
  requestedStates: MachineState[];
  updatedWorkflows: Workflow[];
  calibrations: number[];
  machineSettingsPatches: Array<Partial<De1MachineSettings>>;
  advancedSettingsPatches: De1AdvancedSettingsPatch[];
  refillLevels: number[];
  resetCount: number;
}

function liveAuthority(): MutableAuthority {
  return {
    live: true,
    hasLiveAuthority() {
      return this.live;
    }
  };
}

function fakeTransport(): FakeTransport {
  const requestedStates: MachineState[] = [];
  const updatedWorkflows: Workflow[] = [];
  const calibrations: number[] = [];
  const machineSettingsPatches: Array<Partial<De1MachineSettings>> = [];
  const advancedSettingsPatches: De1AdvancedSettingsPatch[] = [];
  const refillLevels: number[] = [];
  return {
    requestedStates,
    updatedWorkflows,
    calibrations,
    machineSettingsPatches,
    advancedSettingsPatches,
    refillLevels,
    resetCount: 0,
    updateWorkflow(next) {
      updatedWorkflows.push(next);
      return next;
    },
    updateCalibration(flowMultiplier) {
      calibrations.push(flowMultiplier);
    },
    updateMachineSettings(patch) {
      machineSettingsPatches.push(patch);
    },
    updateMachineAdvancedSettings(patch) {
      advancedSettingsPatches.push(patch);
    },
    resetMachineSettings() {
      this.resetCount += 1;
    },
    setRefillLevel(refillLevel) {
      refillLevels.push(refillLevel);
    },
    requestState(state) {
      requestedStates.push(state);
    }
  };
}

function workflow(name: string): Workflow {
  return { name };
}

interface Deferred<Value> {
  promise: Promise<Value>;
  resolve(value: Value): void;
}

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function run(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

function equal<T>(actual: T, expected: T): void {
  if (actual !== expected) throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
}

function deepEqual(actual: unknown, expected: unknown): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) throw new Error(`Expected ${expectedJson}, received ${actualJson}`);
}
