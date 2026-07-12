import type { De1AdvancedSettingsPatch } from '../api/settings';
import type { De1MachineSettings, MachineState, Workflow } from '../api/types';
import {
  RECIPE_APPLY_DEBOUNCE_MS,
  RecipeApplyController,
  type RecipeApplyEvent,
  type RecipeApplyRuntimeState,
  type RecipeApplyScheduler
} from '../controllers/recipeApplyController';
import {
  MachineWorkflowCommands,
  type MachineAuthorityPort,
  type MachineWorkflowTransport
} from '../controllers/machineWorkflowCommands';
import { createRecipeCandidate, type RecipeCandidate } from '../domain/recipeIdentity';
import { GatewayMutationCoordinator } from '../runtime/gatewayMutationCoordinator';

await run('recipe staging debounces writes and dispatches only the latest candidate', async () => {
  const fixture = createFixture();
  const first = candidate('First', 8);
  const latest = candidate('Latest', 9);

  const firstStage = fixture.controller.stage(first);
  const latestStage = fixture.controller.stage(latest);

  equal(firstStage.type, 'scheduled');
  equal(latestStage.type, 'scheduled');
  equal(firstStage.type === 'scheduled' ? firstStage.delayMs : null, RECIPE_APPLY_DEBOUNCE_MS);
  equal(fixture.scheduler.size, 1);
  equal(fixture.commands.snapshot.desired, latest.workflow);
  equal(fixture.transport.updatedWorkflows.length, 0);

  fixture.scheduler.runNext();
  await settle();

  deepEqual(fixture.transport.updatedWorkflows, [latest.workflow]);
  equal(fixture.events.filter((event) => event.type === 'applied').length, 1);
  fixture.dispose();
});

await run('a different staged candidate immediately revokes the active apply', async () => {
  const fixture = createFixture();
  const first = candidate('Same title', 8);
  const latest = candidate('Same title', 9);
  const save = deferred<Workflow>();
  fixture.transport.updateWorkflow = (workflow) => {
    fixture.transport.updatedWorkflows.push(workflow);
    return save.promise;
  };

  fixture.controller.stage(first);
  const applying = fixture.controller.flush();
  await settle();
  equal(fixture.controller.snapshot.activeFingerprint, first.fingerprint);

  fixture.controller.stage(latest);

  // Synchronous assertion: the replacement's 200 ms timer has not fired.
  equal(fixture.controller.snapshot.activeFingerprint, null);
  equal(fixture.controller.snapshot.stagedFingerprint, latest.fingerprint);
  equal(fixture.controller.snapshot.scheduled, true);
  equal(fixture.scheduler.size, 1);

  save.resolve(first.workflow);
  const result = await applying;
  equal(result.type, 'not-applied');
  equal(result.type === 'not-applied' ? result.reason : null, 'superseded');
  equal(
    fixture.events.some((event) =>
      event.type === 'applied' && event.request.candidate.fingerprint === first.fingerprint
    ),
    false
  );
  fixture.dispose();
});

await run('an older same-recipe flush cannot clear ownership from a newer flush', async () => {
  const fixture = createFixture();
  const firstSave = deferred<Workflow>();
  const secondSave = deferred<Workflow>();
  let writes = 0;
  fixture.transport.updateWorkflow = (workflow) => {
    fixture.transport.updatedWorkflows.push(workflow);
    writes += 1;
    return writes === 1 ? firstSave.promise : secondSave.promise;
  };
  const original = candidate('Original', 8);
  const replacement = candidate('Replacement', 9);
  fixture.controller.stage(original);

  const olderFlush = fixture.controller.flush();
  await settle();
  const newerFlush = fixture.controller.flush();
  firstSave.resolve(original.workflow);
  await olderFlush;
  await settle();

  equal(fixture.controller.snapshot.activeFingerprint, original.fingerprint);
  fixture.controller.stage(replacement);
  equal(fixture.controller.snapshot.activeFingerprint, null);
  secondSave.resolve(original.workflow);
  equal((await newerFlush).type, 'not-applied');
  fixture.dispose();
});

await run('a synchronous applying observer can supersede before gateway dispatch', async () => {
  const fixture = createFixture();
  const first = candidate('Observed', 8);
  const replacement = candidate('Observer replacement', 9);
  fixture.controller.subscribe((event) => {
    if (event.type === 'applying' && event.request.candidate.fingerprint === first.fingerprint) {
      fixture.controller.stage(replacement);
    }
  });
  fixture.controller.stage(first);

  const result = await fixture.controller.flush();

  equal(result.type, 'not-applied');
  equal(fixture.transport.updatedWorkflows.length, 0);
  equal(fixture.controller.snapshot.stagedFingerprint, replacement.fingerprint);
  fixture.dispose();
});

await run('workflow and remote calibration share one latest-only compound machine command', async () => {
  const fixture = createFixture();
  const next = candidate('Calibrated', 8);

  fixture.controller.stage(next, { target: 1.07, persistToMachine: true });
  const result = await fixture.controller.flush();

  equal(result.type, 'applied');
  equal(result.type === 'applied' ? result.source : null, 'gateway');
  deepEqual(fixture.transport.calls, ['workflow:Calibrated', 'calibration:1.07']);
  deepEqual(fixture.transport.calibrations, [1.07]);
  fixture.dispose();
});

await run('local-only calibration is reported but not sent to the machine', async () => {
  const fixture = createFixture();
  const next = candidate('Local calibration', 8);

  fixture.controller.stage(next, { target: 1.04, persistToMachine: false });
  const result = await fixture.controller.flush();

  equal(result.type, 'applied');
  deepEqual(fixture.transport.calls, ['workflow:Local calibration']);
  equal(result.type === 'applied' ? result.request.calibration?.target : null, 1.04);
  fixture.dispose();
});

await run('sleeping live machines defer the latest recipe until wake', async () => {
  const fixture = createFixture();
  const next = candidate('After wake', 8);
  fixture.runtime.sleeping = true;

  const staged = fixture.controller.stage(next);
  equal(staged.type, 'deferred');
  equal(fixture.controller.snapshot.deferredUntilWake, true);
  equal(fixture.scheduler.size, 0);
  equal(fixture.transport.updatedWorkflows.length, 0);

  fixture.runtime.sleeping = false;
  const result = await fixture.controller.resumeAfterWake();
  equal(result.type, 'applied');
  deepEqual(fixture.transport.updatedWorkflows, [next.workflow]);
  equal(fixture.controller.snapshot.deferredUntilWake, false);
  fixture.dispose();
});

await run('offline staging remains desired but performs no gateway mutation', async () => {
  const fixture = createFixture();
  const next = candidate('Offline intent', 8);
  fixture.runtime.connected = false;
  fixture.authority.live = false;

  const staged = fixture.controller.stage(next);
  const flushed = await fixture.controller.flush();

  equal(staged.type, 'blocked');
  equal(flushed.type, 'blocked');
  equal(flushed.type === 'blocked' ? flushed.reason : null, 'offline');
  equal(fixture.commands.snapshot.desired, next.workflow);
  equal(fixture.transport.updatedWorkflows.length, 0);
  fixture.dispose();
});

await run('machine authority is still checked by the shared owner at dispatch', async () => {
  const fixture = createFixture();
  fixture.controller.stage(candidate('Authority loss', 8));
  fixture.authority.live = false;

  const result = await fixture.controller.flush();

  equal(result.type, 'blocked');
  equal(result.type === 'blocked' ? result.reason : null, 'authority');
  equal(fixture.transport.updatedWorkflows.length, 0);
  fixture.dispose();
});

await run('demo apply confirms locally without entering the gateway lane', async () => {
  const fixture = createFixture();
  const next = candidate('Demo', 8);
  fixture.runtime.demo = true;
  fixture.runtime.connected = false;
  fixture.authority.live = false;

  fixture.controller.stage(next, { target: 1.03, persistToMachine: true });
  const result = await fixture.controller.flush();

  equal(result.type, 'applied');
  equal(result.type === 'applied' ? result.source : null, 'demo');
  equal(result.type === 'applied' ? result.workflow : null, next.workflow);
  equal(fixture.transport.updatedWorkflows.length, 0);
  equal(fixture.transport.calibrations.length, 0);
  fixture.dispose();
});

await run('dispose cancels the feature timer without disposing the shared machine queue', async () => {
  const fixture = createFixture();
  fixture.controller.stage(candidate('Canceled timer', 8));

  fixture.controller.dispose();

  equal(fixture.scheduler.size, 0);
  equal(fixture.controller.snapshot.disposed, true);
  fixture.scheduler.runAll();
  await settle();
  equal(fixture.transport.updatedWorkflows.length, 0);
  const sharedQueueStillWorks = await fixture.commands.runExact((lane) => lane.requestState('idle'));
  equal(sharedQueueStillWorks.status, 'completed');
  deepEqual(fixture.transport.requestedStates, ['idle']);
  fixture.mutations.dispose();
});

await run('invalid calibration never reaches staging or machine intent', () => {
  const fixture = createFixture();
  throws(
    () => fixture.controller.stage(candidate('Invalid', 8), { target: Number.NaN, persistToMachine: true }),
    'finite positive'
  );
  equal(fixture.commands.snapshot.desired, null);
  fixture.dispose();
});

await run('a scheduler failure is returned synchronously instead of reporting a false schedule', () => {
  const fixture = createFixture();
  const broken = new RecipeApplyController({
    commands: fixture.commands,
    runtime: () => fixture.runtime,
    scheduler: {
      schedule() {
        throw new Error('timer unavailable');
      },
      cancel() {}
    }
  });

  const result = broken.stage(candidate('No timer', 8));

  equal(result.type, 'failed');
  equal(
    result.type === 'failed' && result.error instanceof Error ? result.error.message : null,
    'timer unavailable'
  );
  broken.dispose();
  fixture.dispose();
});

interface MutableRuntime extends RecipeApplyRuntimeState {
  demo: boolean;
  connected: boolean;
  sleeping: boolean;
}

interface MutableAuthority extends MachineAuthorityPort {
  live: boolean;
}

interface FakeTransport extends MachineWorkflowTransport {
  updatedWorkflows: Workflow[];
  calibrations: number[];
  requestedStates: MachineState[];
  calls: string[];
}

interface Fixture {
  controller: RecipeApplyController;
  commands: MachineWorkflowCommands;
  mutations: GatewayMutationCoordinator<string>;
  transport: FakeTransport;
  runtime: MutableRuntime;
  authority: MutableAuthority;
  scheduler: FakeScheduler;
  events: RecipeApplyEvent[];
  dispose(): void;
}

function createFixture(): Fixture {
  const runtime: MutableRuntime = { demo: false, connected: true, sleeping: false };
  const authority: MutableAuthority = {
    live: true,
    hasLiveAuthority() {
      return this.live;
    }
  };
  const transport = fakeTransport();
  const mutations = new GatewayMutationCoordinator<string>();
  const commands = new MachineWorkflowCommands(mutations, transport, authority);
  const scheduler = fakeScheduler();
  const controller = new RecipeApplyController({
    commands,
    runtime: () => runtime,
    scheduler
  });
  const events: RecipeApplyEvent[] = [];
  controller.subscribe((event) => events.push(event));
  return {
    controller,
    commands,
    mutations,
    transport,
    runtime,
    authority,
    scheduler,
    events,
    dispose() {
      controller.dispose();
      mutations.dispose();
    }
  };
}

function candidate(title: string, pressure: number): RecipeCandidate {
  return createRecipeCandidate({
    name: title,
    profile: {
      title,
      tank_temperature: 93,
      steps: [{ name: 'Pour', pressure, temperature: 93 }]
    },
    context: {
      beanId: 'bean-a',
      beanBatchId: 'batch-a',
      targetDoseWeight: 18,
      targetYield: 40,
      grinderId: 'grinder-a',
      grinderModel: 'DF64',
      grinderSetting: '5.5'
    }
  });
}

function fakeTransport(): FakeTransport {
  const transport: FakeTransport = {
    updatedWorkflows: [],
    calibrations: [],
    requestedStates: [],
    calls: [],
    updateWorkflow(workflow) {
      transport.updatedWorkflows.push(workflow);
      transport.calls.push(`workflow:${workflow.name ?? ''}`);
      return workflow;
    },
    updateCalibration(flowMultiplier) {
      transport.calibrations.push(flowMultiplier);
      transport.calls.push(`calibration:${flowMultiplier}`);
    },
    updateMachineSettings(_patch: Partial<De1MachineSettings>) {},
    updateMachineAdvancedSettings(_patch: De1AdvancedSettingsPatch) {},
    resetMachineSettings() {},
    setRefillLevel(_refillLevel: number) {},
    requestState(state) {
      transport.requestedStates.push(state);
    }
  };
  return transport;
}

interface FakeScheduler extends RecipeApplyScheduler {
  readonly size: number;
  runNext(): void;
  runAll(): void;
}

function fakeScheduler(): FakeScheduler {
  let nextId = 0;
  const tasks = new Map<number, () => void>();
  const scheduler: FakeScheduler = {
    get size() {
      return tasks.size;
    },
    schedule(callback) {
      const id = ++nextId;
      tasks.set(id, callback);
      return id;
    },
    cancel(handle) {
      tasks.delete(handle as number);
    },
    runNext() {
      const entry = tasks.entries().next().value as [number, () => void] | undefined;
      if (!entry) return;
      tasks.delete(entry[0]);
      entry[1]();
    },
    runAll() {
      while (tasks.size > 0) scheduler.runNext();
    }
  };
  return scheduler;
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

function throws(run: () => void, expected: string): void {
  try {
    run();
  } catch (error) {
    if (error instanceof Error && error.message.includes(expected)) return;
    throw error;
  }
  throw new Error(`Expected an error containing ${expected}`);
}
