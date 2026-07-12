import type { De1AdvancedSettingsPatch } from '../api/settings';
import type {
  De1MachineSettings,
  Workflow
} from '../api/types';
import {
  MachineActionFlow,
  type MachineActionRequest,
  type MachineActionSafetyPort,
  type MachineActionSafetySnapshot
} from '../controllers/machineActionFlow';
import {
  MachineWorkflowCommands,
  type MachineAuthorityPort,
  type MachineWorkflowTransport
} from '../controllers/machineWorkflowCommands';
import { GatewayMutationCoordinator } from '../runtime/gatewayMutationCoordinator';

class NoScaleGatewayError extends Error {}

await run('machine action flow blocks unsafe espresso before queueing', async () => {
  const harness = createHarness();
  harness.safety.current = { noScaleBlocked: true, waterAlertHard: true };

  deepEqual(await harness.flow.execute(action()), {
    type: 'blocked-safety',
    reason: 'no-scale',
    phase: 'prequeue'
  });
  deepEqual(harness.transport.calls, []);
  equal(harness.mutations.snapshot.pendingCount, 0);

  deepEqual(await harness.flow.execute(action({ skipScaleCheck: true })), {
    type: 'blocked-safety',
    reason: 'water',
    phase: 'prequeue'
  });
  deepEqual(harness.transport.calls, []);
});

await run('machine action flow repeats safety preflight when queued work dispatches', async () => {
  const harness = createHarness();
  const gate = deferred<void>();
  const blocker = harness.commands.runExact(() => gate.promise);
  const started = harness.flow.start(action());
  equal(started.type, 'queued');
  if (started.type !== 'queued') throw new Error('Expected queued action');
  equal(started.status, 'Starting shot');
  equal(started.service, null);

  harness.safety.current = { noScaleBlocked: true, waterAlertHard: false };
  gate.resolve(undefined);
  equal((await blocker).status, 'completed');
  deepEqual(await started.completion, {
    type: 'blocked-safety',
    reason: 'no-scale',
    phase: 'dispatch'
  });
  deepEqual(harness.transport.calls, []);
});

await run('offline actions are blocked except for the argument-free safety stop', async () => {
  const harness = createHarness();
  harness.authority.live = false;

  deepEqual(await harness.flow.execute(action({ state: 'idle', liveAuthority: false })), {
    type: 'blocked-authority',
    phase: 'prequeue',
    restore: null
  });
  deepEqual(harness.transport.calls, []);

  deepEqual(await harness.flow.stopSafely(), {
    type: 'sent',
    state: 'idle',
    service: null,
    status: 'Machine stopped',
    restore: null
  });
  deepEqual(harness.transport.calls, ['state:idle']);
});

await run('espresso workflow calibration and physical start stay in one exact lane transaction', async () => {
  const harness = createHarness();
  const newer = workflow('newer-staged');
  const confirmed = workflow('gateway-confirmed');
  const requestGate = deferred<void>();
  harness.commands.stageDesired(newer);
  harness.transport.updateWorkflow = (next) => {
    harness.transport.calls.push(`workflow:${next.name}`);
    return confirmed;
  };
  harness.transport.requestState = (state) => {
    harness.transport.calls.push(`state:${state}`);
    return requestGate.promise;
  };

  const started = harness.flow.start(action({
    workflow: workflow('stale-fallback'),
    calibration: { flowMultiplier: 1.04, persist: true }
  }));
  if (started.type !== 'queued') throw new Error('Expected queued action');
  const after = harness.commands.runExact(() => {
    harness.transport.calls.push('after');
  });
  await settle();

  deepEqual(harness.transport.calls, [
    'workflow:newer-staged',
    'calibration:1.04',
    'state:espresso'
  ]);
  deepEqual(harness.commands.snapshot, { desired: newer, shadow: confirmed });

  requestGate.resolve(undefined);
  const outcome = await started.completion;
  equal(outcome.type, 'sent');
  if (outcome.type !== 'sent') throw new Error('Expected sent action');
  equal(outcome.state, 'espresso');
  equal(outcome.status, 'shot started');
  equal((await after).status, 'completed');
  deepEqual(harness.transport.calls, [
    'workflow:newer-staged',
    'calibration:1.04',
    'state:espresso',
    'after'
  ]);
});

await run('local-only calibration stays out of the espresso transaction', async () => {
  const harness = createHarness();
  const outcome = await harness.flow.execute(action({
    calibration: { flowMultiplier: 1.05, persist: false }
  }));

  equal(outcome.type, 'sent');
  deepEqual(harness.transport.calls, ['workflow:recipe', 'state:espresso']);
});

await run('machine action flow reports authority lost while waiting to dispatch', async () => {
  const harness = createHarness();
  const gate = deferred<void>();
  const blocker = harness.commands.runExact(() => gate.promise);
  const started = harness.flow.start(action());
  if (started.type !== 'queued') throw new Error('Expected queued action');

  harness.authority.live = false;
  gate.resolve(undefined);
  await blocker;
  deepEqual(await started.completion, {
    type: 'blocked-authority',
    phase: 'dispatch',
    restore: null
  });
  deepEqual(harness.transport.calls, []);
});

await run('machine action flow rechecks authority between workflow and calibration', async () => {
  const harness = createHarness();
  harness.transport.updateWorkflow = (next) => {
    harness.transport.calls.push(`workflow:${next.name}`);
    harness.authority.live = false;
    return next;
  };

  deepEqual(await harness.flow.execute(action({
    calibration: { flowMultiplier: 1.02, persist: true }
  })), {
    type: 'blocked-authority',
    phase: 'dispatch',
    restore: null
  });
  deepEqual(harness.transport.calls, ['workflow:recipe']);
});

await run('caught request-state authority failures retain blocked-authority semantics', async () => {
  const harness = createHarness();
  harness.transport.updateCalibration = (flowMultiplier) => {
    harness.transport.calls.push(`calibration:${flowMultiplier}`);
    harness.authority.live = false;
  };

  const caught = await harness.flow.execute(action({
    calibration: { flowMultiplier: 1.03, persist: true }
  }));
  deepEqual(caught, {
    type: 'blocked-authority',
    phase: 'dispatch',
    restore: null
  });
  deepEqual(harness.transport.calls, ['workflow:recipe', 'calibration:1.03']);
});

await run('timed steam preparation saves padded headroom and returns restoration data', async () => {
  const harness = createHarness();
  const recipe = workflow('steam-recipe');
  const outcome = await harness.flow.execute(action({
    state: 'steam',
    workflow: recipe,
    steamSettings: { targetTemperature: 135, duration: 12, flow: 1.5 },
    twoTapSteamStop: false
  }));

  equal(outcome.type, 'sent');
  if (outcome.type !== 'sent') throw new Error('Expected sent steam action');
  equal(outcome.service, 'steam');
  equal(outcome.restore?.steamSettings.duration, 12);
  equal(harness.commands.snapshot.desired, recipe);
  equal(harness.commands.snapshot.shadow?.steamSettings?.duration, 15);
  deepEqual(harness.transport.calls, ['workflow:steam-recipe', 'state:steam']);
});

await run('authority loss after steam padding preserves the workflow restoration token', async () => {
  const harness = createHarness();
  harness.transport.updateWorkflow = (next) => {
    harness.transport.calls.push(`workflow:${next.name}`);
    harness.authority.live = false;
    return next;
  };

  const outcome = await harness.flow.execute(action({
    state: 'steam',
    workflow: workflow('steam-recipe'),
    steamSettings: { targetTemperature: 135, duration: 12, flow: 1.5 }
  }));

  equal(outcome.type, 'blocked-authority');
  if (outcome.type !== 'blocked-authority') throw new Error('Expected authority block');
  equal(outcome.phase, 'dispatch');
  equal(outcome.restore?.steamSettings.duration, 12);
  deepEqual(harness.transport.calls, ['workflow:steam-recipe']);
});

await run('gateway no-scale rejection is a safety block while other request failures stay failed', async () => {
  const noScale = createHarness();
  const noScaleError = new NoScaleGatewayError();
  noScale.transport.requestState = () => {
    throw noScaleError;
  };
  const blocked = await noScale.flow.execute(action({ workflow: null }));
  equal(blocked.type, 'blocked-safety');
  if (blocked.type !== 'blocked-safety') throw new Error('Expected safety block');
  equal(blocked.reason, 'no-scale');
  equal(blocked.phase, 'gateway');
  equal(blocked.error, noScaleError);

  const failedHarness = createHarness();
  const expected = new Error('gateway offline');
  failedHarness.transport.requestState = () => {
    throw expected;
  };
  const failed = await failedHarness.flow.execute(action({ state: 'hotWater' }));
  equal(failed.type, 'failed');
  if (failed.type !== 'failed') throw new Error('Expected failed action');
  equal(failed.state, 'hotWater');
  equal(failed.error, expected);
  equal(failed.status, 'Machine command failed');
});

await run('queued and disposed machine actions return explicit cancellation outcomes', async () => {
  const queuedHarness = createHarness();
  const gate = deferred<void>();
  const blocker = queuedHarness.commands.runExact(() => gate.promise);
  const started = queuedHarness.flow.start(action());
  if (started.type !== 'queued') throw new Error('Expected queued action');
  equal(queuedHarness.mutations.cancelQueued('machine'), 1);
  deepEqual(await started.completion, { type: 'canceled', reason: 'canceled' });
  gate.resolve(undefined);
  await blocker;

  const disposedHarness = createHarness();
  disposedHarness.mutations.dispose();
  deepEqual(await disposedHarness.flow.execute(action()), {
    type: 'canceled',
    reason: 'disposed'
  });
});

interface MutableAuthority extends MachineAuthorityPort {
  live: boolean;
}

interface MutableSafety extends MachineActionSafetyPort {
  current: MachineActionSafetySnapshot;
}

interface FakeTransport extends MachineWorkflowTransport {
  calls: string[];
}

interface Harness {
  mutations: GatewayMutationCoordinator<string>;
  authority: MutableAuthority;
  safety: MutableSafety;
  transport: FakeTransport;
  commands: MachineWorkflowCommands;
  flow: MachineActionFlow;
}

function createHarness(): Harness {
  const mutations = new GatewayMutationCoordinator<string>();
  const authority: MutableAuthority = {
    live: true,
    hasLiveAuthority() {
      return this.live;
    }
  };
  const safety: MutableSafety = {
    current: { noScaleBlocked: false, waterAlertHard: false },
    snapshot() {
      return this.current;
    }
  };
  const transport = fakeTransport();
  const commands = new MachineWorkflowCommands(mutations, transport, authority);
  const flow = new MachineActionFlow(commands, safety, {
    isNoScaleShotBlockError: (error) => error instanceof NoScaleGatewayError
  });
  return { mutations, authority, safety, transport, commands, flow };
}

function fakeTransport(): FakeTransport {
  const calls: string[] = [];
  return {
    calls,
    updateWorkflow(next) {
      calls.push(`workflow:${next.name}`);
      return next;
    },
    updateCalibration(flowMultiplier) {
      calls.push(`calibration:${flowMultiplier}`);
    },
    updateMachineSettings(patch: Partial<De1MachineSettings>) {
      calls.push(`machine-settings:${JSON.stringify(patch)}`);
    },
    updateMachineAdvancedSettings(patch: De1AdvancedSettingsPatch) {
      calls.push(`advanced-settings:${JSON.stringify(patch)}`);
    },
    resetMachineSettings() {
      calls.push('reset-machine-settings');
    },
    setRefillLevel(level) {
      calls.push(`refill:${level}`);
    },
    requestState(state) {
      calls.push(`state:${state}`);
    }
  };
}

function action(overrides: Partial<MachineActionRequest> = {}): MachineActionRequest {
  return {
    state: 'espresso',
    liveAuthority: true,
    workflow: workflow('recipe'),
    steamSettings: { targetTemperature: 135, duration: 12, flow: 1.5 },
    hotWaterData: { targetTemperature: 85, duration: 30, volume: 100, flow: 5 },
    rinseData: { targetTemperature: 90, duration: 8, flow: 6 },
    twoTapSteamStop: false,
    calibration: null,
    ...overrides
  };
}

function workflow(name: string): Workflow {
  return {
    name,
    context: { coffeeName: 'Test' },
    steamSettings: { targetTemperature: 135, duration: 12, flow: 1.5 },
    hotWaterData: { targetTemperature: 85, duration: 30, volume: 100, flow: 5 },
    rinseData: { targetTemperature: 90, duration: 8, flow: 6 }
  };
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

async function settle(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
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
