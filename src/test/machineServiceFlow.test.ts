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
  MACHINE_STOP_FEEDBACK_MS,
  MachineServiceFlow,
  type MachineServiceFlowEvent,
  type MachineServiceFlowScheduler
} from '../controllers/machineServiceFlow';
import {
  MachineWorkflowCommands,
  type MachineAuthorityPort,
  type MachineWorkflowTransport
} from '../controllers/machineWorkflowCommands';
import { GatewayMutationCoordinator } from '../runtime/gatewayMutationCoordinator';

await run('active steam owns one deadline and requests only the safe idle command', async () => {
  const fixture = createFixture();
  fixture.machineState.value = 'steam';

  fixture.flow.track({
    state: 'steam',
    substate: 'pouring',
    demo: false,
    twoTapSteamStop: false,
    targetSeconds: 10,
    nowMs: 1_000
  });

  equal(fixture.flow.snapshot.timedStopScheduledForMs, 11_000);
  equal(fixture.scheduler.nextDelay, 10_000);
  fixture.clock.value = 11_000;
  fixture.scheduler.runNext();
  await settle();

  deepEqual(fixture.transport.requestedStates, ['idle']);
  equal(fixture.flow.snapshot.service.stopRequestedFor, 'steam');
  equal(fixture.flow.snapshot.service.timedSteamStopRequestedAtMs, 11_000);
  equal(
    fixture.events.some((event) =>
      event.type === 'stop-result' && event.result.type === 'requested' && event.result.timed
    ),
    true
  );
  fixture.dispose();
});

await run('telemetry confirmation clears stop feedback and service timers', async () => {
  const fixture = createFixture();
  fixture.machineState.value = 'steam';
  fixture.flow.track({
    state: 'steam',
    substate: 'pouring',
    demo: false,
    twoTapSteamStop: false,
    targetSeconds: 30,
    nowMs: 1_000
  });
  await fixture.flow.stop({ demo: false, machineState: 'steam', nowMs: 2_000 });
  equal(fixture.flow.snapshot.stopFeedbackPending, true);

  const tracked = fixture.flow.track({
    state: 'idle',
    demo: false,
    twoTapSteamStop: false,
    targetSeconds: 30,
    nowMs: 2_500
  });
  if (tracked.restore) await tracked.restore;

  equal(fixture.flow.snapshot.stopFeedbackPending, false);
  equal(fixture.flow.snapshot.timedStopScheduledForMs, null);
  equal(fixture.flow.snapshot.service.stopRequestedFor, null);
  fixture.scheduler.runAll();
  equal(fixture.events.some((event) => event.type === 'stop-not-confirmed'), false);
  fixture.dispose();
});

await run('an unconfirmed stop emits feedback after the owned deadline', async () => {
  const fixture = createFixture();
  fixture.machineState.value = 'hotWater';
  fixture.flow.track({
    state: 'hotWater',
    substate: 'pouring',
    demo: false,
    twoTapSteamStop: false,
    targetSeconds: 20,
    nowMs: 1_000
  });
  await fixture.flow.stop({ demo: false, machineState: 'hotWater', nowMs: 2_000 });

  equal(fixture.scheduler.nextDelay, MACHINE_STOP_FEEDBACK_MS);
  fixture.scheduler.runNext();

  equal(
    fixture.events.some((event) =>
      event.type === 'stop-not-confirmed' && event.service === 'hotWater'
    ),
    true
  );
  fixture.dispose();
});

await run('manual service stop keeps the offline exception inside stopSafely', async () => {
  const fixture = createFixture();
  fixture.authority.live = false;
  fixture.machineState.value = 'flush';
  fixture.flow.track({
    state: 'flush',
    substate: 'pouring',
    demo: false,
    twoTapSteamStop: false,
    targetSeconds: 8,
    nowMs: 1_000
  });

  const result = await fixture.flow.stop({ demo: false, machineState: 'flush', nowMs: 2_000 });

  equal(result.type, 'requested');
  deepEqual(fixture.transport.requestedStates, ['idle']);
  const ordinary = await fixture.commands.runExact((lane) => lane.requestState('steam'));
  equal(ordinary.status, 'authority-blocked');
  deepEqual(fixture.transport.requestedStates, ['idle']);
  fixture.dispose();
});

await run('extending a service persists its target and restores the first settings after end', async () => {
  const fixture = createFixture();
  const baseline = workflow('Recipe A', steam({ duration: 10 }));
  fixture.commands.synchronizeAuthoritative(baseline);
  fixture.machineState.value = 'steam';
  fixture.flow.track({
    state: 'steam',
    substate: 'pouring',
    demo: false,
    twoTapSteamStop: false,
    targetSeconds: 10,
    nowMs: 1_000
  });

  const extended = await fixture.flow.extend({
    seconds: 5,
    machineState: 'steam',
    demo: false,
    workflow: baseline,
    steamSettings: steam({ duration: 10 }),
    hotWaterData: water(),
    rinseData: rinse(),
    currentTargetSeconds: 10,
    twoTapSteamStop: false,
    nowMs: 3_000
  });

  equal(extended.type, 'extended');
  equal(extended.type === 'extended' ? extended.nextTargetSeconds : null, 15);
  // One-tap steam retains three seconds of native-machine headroom.
  equal(fixture.transport.updatedWorkflows[0]?.steamSettings?.duration, 18);
  equal(fixture.flow.snapshot.restorePending, true);

  const ended = fixture.flow.track({
    state: 'idle',
    demo: false,
    twoTapSteamStop: false,
    targetSeconds: 15,
    nowMs: 4_000
  });
  const restored = ended.restore ? await ended.restore : null;

  equal(restored?.type, 'restored');
  equal(fixture.transport.updatedWorkflows.at(-1)?.steamSettings?.duration, 10);
  equal(fixture.transport.updatedWorkflows.at(-1)?.context?.coffeeName, 'Recipe A');
  equal(fixture.flow.snapshot.restorePending, false);
  fixture.dispose();
});

await run('queued restore rebases service settings onto the newest desired recipe', async () => {
  const fixture = createFixture();
  const baseline = workflow('Old recipe', steam({ duration: 10 }));
  const padded = workflow('Old recipe', steam({ duration: 13 }));
  const newest = workflow('New recipe', steam({ duration: 99 }));
  fixture.commands.synchronizeAuthoritative(padded);
  fixture.flow.captureRestore({
    steamSettings: steam({ duration: 10 }),
    hotWaterData: water({ duration: 20 }),
    rinseData: rinse({ duration: 7 })
  });
  fixture.flow.track({
    state: 'steam',
    substate: 'pouring',
    demo: false,
    twoTapSteamStop: true,
    targetSeconds: 10,
    nowMs: 1_000
  });
  const gate = deferred<void>();
  const blocker = fixture.commands.runExact(() => gate.promise);

  const ended = fixture.flow.track({
    state: 'idle',
    demo: false,
    twoTapSteamStop: true,
    targetSeconds: 10,
    nowMs: 2_000
  });
  fixture.commands.stageDesired(newest);
  gate.resolve(undefined);
  await blocker;
  const restored = ended.restore ? await ended.restore : null;

  equal(restored?.type, 'restored');
  equal(fixture.transport.updatedWorkflows.at(-1)?.context?.coffeeName, 'New recipe');
  equal(fixture.transport.updatedWorkflows.at(-1)?.steamSettings?.duration, 10);
  equal(fixture.transport.updatedWorkflows.at(-1)?.hotWaterData?.duration, 20);
  // Keep a reference assertion so the baseline is not optimized out of the scenario.
  equal(baseline.context?.coffeeName, 'Old recipe');
  fixture.dispose();
});

await run('an authority-blocked restore keeps its token for reconnect retry', async () => {
  const fixture = createFixture();
  const padded = workflow('Recipe', steam({ duration: 15 }));
  fixture.commands.synchronizeAuthoritative(padded);
  fixture.flow.captureRestore({
    steamSettings: steam({ duration: 12 }),
    hotWaterData: water(),
    rinseData: rinse()
  });
  fixture.authority.live = false;

  const blocked = await fixture.flow.restoreAfterEnd(false);

  equal(blocked.type, 'failed');
  equal(blocked.type === 'failed' ? blocked.reason : null, 'authority');
  equal(fixture.flow.snapshot.restorePending, true);
  fixture.authority.live = true;
  const retried = await fixture.flow.restoreAfterEnd(false);
  equal(retried.type, 'restored');
  equal(fixture.transport.updatedWorkflows.at(-1)?.steamSettings?.duration, 12);
  equal(fixture.flow.snapshot.restorePending, false);
  fixture.dispose();
});

await run('demo stop is local and service flow disposal leaves the shared queue alive', async () => {
  const fixture = createFixture();
  fixture.machineState.value = 'steam';
  fixture.flow.track({
    state: 'steam',
    substate: 'pouring',
    demo: true,
    twoTapSteamStop: false,
    targetSeconds: 10,
    nowMs: 1_000
  });

  const stopped = await fixture.flow.stop({ demo: true, machineState: 'steam', nowMs: 2_000 });
  equal(stopped.type, 'demo-stopped');
  equal(fixture.transport.requestedStates.length, 0);

  fixture.flow.dispose();
  equal(fixture.scheduler.size, 0);
  const command = await fixture.commands.runExact((lane) => lane.requestState('idle'));
  equal(command.status, 'completed');
  deepEqual(fixture.transport.requestedStates, ['idle']);
  fixture.mutations.dispose();
});

interface MutableAuthority extends MachineAuthorityPort {
  live: boolean;
}

interface MutableValue<Value> {
  value: Value;
}

interface FakeTransport extends MachineWorkflowTransport {
  updatedWorkflows: Workflow[];
  requestedStates: MachineState[];
}

interface Fixture {
  flow: MachineServiceFlow;
  commands: MachineWorkflowCommands;
  mutations: GatewayMutationCoordinator<string>;
  transport: FakeTransport;
  authority: MutableAuthority;
  machineState: MutableValue<MachineState | undefined>;
  clock: MutableValue<number>;
  scheduler: FakeScheduler;
  events: MachineServiceFlowEvent[];
  dispose(): void;
}

function createFixture(): Fixture {
  const authority: MutableAuthority = {
    live: true,
    hasLiveAuthority() {
      return this.live;
    }
  };
  const machineState: MutableValue<MachineState | undefined> = { value: undefined };
  const clock = { value: 0 };
  const scheduler = fakeScheduler();
  const transport = fakeTransport();
  const mutations = new GatewayMutationCoordinator<string>();
  const commands = new MachineWorkflowCommands(mutations, transport, authority);
  const flow = new MachineServiceFlow({
    commands,
    machineState: () => machineState.value,
    scheduler,
    now: () => clock.value
  });
  const events: MachineServiceFlowEvent[] = [];
  flow.subscribe((event) => events.push(event));
  return {
    flow,
    commands,
    mutations,
    transport,
    authority,
    machineState,
    clock,
    scheduler,
    events,
    dispose() {
      flow.dispose();
      mutations.dispose();
    }
  };
}

function fakeTransport(): FakeTransport {
  const transport: FakeTransport = {
    updatedWorkflows: [],
    requestedStates: [],
    updateWorkflow(next) {
      transport.updatedWorkflows.push(next);
      return next;
    },
    updateCalibration() {},
    updateMachineSettings(_patch: Partial<De1MachineSettings>) {},
    updateMachineAdvancedSettings(_patch: De1AdvancedSettingsPatch) {},
    resetMachineSettings() {},
    setRefillLevel() {},
    requestState(state) {
      transport.requestedStates.push(state);
    }
  };
  return transport;
}

interface FakeScheduler extends MachineServiceFlowScheduler {
  readonly size: number;
  readonly nextDelay: number | null;
  runNext(): void;
  runAll(): void;
}

function fakeScheduler(): FakeScheduler {
  let nextId = 0;
  const tasks = new Map<number, { callback: () => void; delayMs: number }>();
  const scheduler: FakeScheduler = {
    get size() {
      return tasks.size;
    },
    get nextDelay() {
      return tasks.values().next().value?.delayMs ?? null;
    },
    schedule(callback, delayMs) {
      const id = ++nextId;
      tasks.set(id, { callback, delayMs });
      return id;
    },
    cancel(handle) {
      tasks.delete(handle as number);
    },
    runNext() {
      const entry = tasks.entries().next().value as [number, { callback: () => void }] | undefined;
      if (!entry) return;
      tasks.delete(entry[0]);
      entry[1].callback();
    },
    runAll() {
      while (tasks.size > 0) scheduler.runNext();
    }
  };
  return scheduler;
}

function workflow(name: string, steamSettings: SteamSettings): Workflow {
  return {
    profile: { title: name, steps: [] },
    context: { coffeeName: name, beanId: `bean-${name}` },
    steamSettings,
    hotWaterData: water(),
    rinseData: rinse()
  };
}

function steam(overrides: Partial<SteamSettings> = {}): SteamSettings {
  return { duration: 10, flow: 1.5, targetTemperature: 130, ...overrides };
}

function water(overrides: Partial<HotWaterData> = {}): HotWaterData {
  return { duration: 30, flow: 5, volume: 100, targetTemperature: 85, ...overrides };
}

function rinse(overrides: Partial<RinseData> = {}): RinseData {
  return { duration: 8, flow: 5, targetTemperature: 90, ...overrides };
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

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
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
  if (actual !== expected) throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
}

function deepEqual(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}
