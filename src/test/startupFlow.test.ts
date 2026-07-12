import type {
  ApiResource,
  ApiResourceName,
  Bean,
  GatewayStartupSnapshot,
  Grinder,
  MachineInfo,
  MachineSnapshot,
  PaginatedShots,
  ProfileRecord,
  Workflow
} from '../api/types';
import {
  StartupFlow,
  type StartupAuxiliaryOperation,
  type StartupEffectPlan,
  type StartupFlowDependencies,
  type StartupFlowHost,
  type StartupHostSnapshot,
  type StartupProjection,
  type StartupSelectionOptions
} from '../controllers/startupFlow';

const bean: Bean = { id: 'bean-1', roaster: 'Kawa', name: 'Pink Bourbon' };
const workflow: Workflow = {
  name: 'Current workflow',
  profile: { title: 'Default' },
  context: { beanId: bean.id, targetDoseWeight: 18, targetYield: 36 }
};
const grinders: Grinder[] = [{ id: 'grinder-1', model: 'DF64' }];
const profiles: ProfileRecord[] = [{ id: 'profile-1', profile: { title: 'Default' } }];
const latestShots: PaginatedShots = {
  items: [{
    id: 'shot-1',
    timestamp: '2026-07-12T10:00:00.000Z',
    workflow,
    annotations: null
  }],
  total: 1,
  limit: 50,
  offset: 0
};

await run('settings gate cache publication and cache precedes the gateway result', async () => {
  const settingsGate = deferred<void>();
  const gatewayGate = deferred<GatewayStartupSnapshot>();
  const harness = createHarness({
    loadSettings: () => settingsGate.promise,
    cached: { workflow, beans: [bean], grinders, profiles, latestShots },
    loadGateway: () => gatewayGate.promise
  });

  const loading = harness.flow.load();
  equal(types(harness.projections), ['loading']);
  await flushAsync();
  equal(types(harness.projections), ['loading']);

  settingsGate.resolve();
  await flushAsync();
  equal(types(harness.projections), ['loading', 'cached']);
  equal(harness.readLastBeanIdCalls, 1);

  gatewayGate.resolve(startup('connected'));
  const outcome = await loading;
  equal(outcome.type, 'settled');
  equal(types(harness.projections), ['loading', 'cached', 'gateway']);
  equal(harness.readLastBeanIdCalls, 2);
  equal(harness.effects.map((effect) => effect.type), ['connected']);
});

await run('startup connectivity modes preserve the exact selection and effect matrix', async () => {
  const cases: Array<{
    name: string;
    status: GatewayStartupSnapshot['status'];
    sleeping: boolean;
    matches: boolean;
    expectedEffect: StartupEffectPlan['type'];
    expectedSelection: StartupSelectionOptions | null;
    expectedSchedule: number;
  }> = [
    {
      name: 'offline',
      status: 'gateway-unavailable',
      sleeping: false,
      matches: false,
      expectedEffect: 'offline',
      expectedSelection: null,
      expectedSchedule: 0
    },
    {
      name: 'limited',
      status: 'partial-failure',
      sleeping: false,
      matches: false,
      expectedEffect: 'limited',
      expectedSelection: {
        apply: false,
        preferWorkflow: true,
        remember: false,
        allowMaintenanceWrites: false
      },
      expectedSchedule: 0
    },
    {
      name: 'connected mismatch',
      status: 'connected',
      sleeping: false,
      matches: false,
      expectedEffect: 'connected',
      expectedSelection: {
        apply: true,
        preferWorkflow: true,
        remember: true,
        allowMaintenanceWrites: true
      },
      expectedSchedule: 0
    },
    {
      name: 'connected sleeping mismatch',
      status: 'connected',
      sleeping: true,
      matches: false,
      expectedEffect: 'connected',
      expectedSelection: {
        apply: false,
        preferWorkflow: true,
        remember: true,
        allowMaintenanceWrites: true
      },
      expectedSchedule: 1
    },
    {
      name: 'connected match',
      status: 'connected',
      sleeping: false,
      matches: true,
      expectedEffect: 'connected',
      expectedSelection: {
        apply: false,
        preferWorkflow: true,
        remember: true,
        allowMaintenanceWrites: true
      },
      expectedSchedule: 0
    }
  ];

  for (const item of cases) {
    const harness = createHarness({
      initial: { hasUsableData: true },
      startup: startup(item.status),
      machine: machine(item.sleeping ? 'sleeping' : 'idle'),
      workflowMatchesBean: () => item.matches
    });

    const outcome = await harness.flow.load();

    equal(outcome.type, 'settled', item.name);
    equal(harness.effects.map((effect) => effect.type), [item.expectedEffect], item.name);
    equal(harness.selections.length, item.expectedSelection ? 1 : 0, item.name);
    equal(
      harness.selections[0]?.options ?? null,
      item.expectedSelection,
      item.name
    );
    equal(harness.scheduleApplyCalls, item.expectedSchedule, item.name);
    equal(
      harness.projections.some((projection) => projection.type === 'deferred-apply'),
      item.expectedSchedule > 0,
      item.name
    );
  }
});

await run('a failed gateway retains published cache and schedules retry only', async () => {
  const failure = new Error('gateway down');
  const harness = createHarness({
    cached: { workflow, beans: [bean], latestShots },
    loadGateway: async () => { throw failure; }
  });

  const outcome = await harness.flow.load();

  equal(outcome.type, 'fallback');
  if (outcome.type === 'fallback') equal(outcome.phase, 'offline-cache');
  equal(types(harness.projections), ['loading', 'cached', 'retained-fallback']);
  equal(harness.effects.map((effect) => effect.type), ['retry-only']);
  equal(harness.enterDemoCalls, 0);
});

await run('missing essential data enters demo only when no usable snapshot exists', async () => {
  const harness = createHarness({
    cached: {},
    startup: startup('partial-failure', { beans: [bean] })
  });

  const outcome = await harness.flow.load();

  equal(outcome.type, 'fallback');
  if (outcome.type === 'fallback') equal(outcome.phase, 'demo');
  equal(harness.enterDemoCalls, 1);
  equal(harness.effects, []);
  equal(types(harness.projections), ['loading']);
});

await run('machine metadata failures are auxiliary and do not demote connected startup', async () => {
  const harness = createHarness({
    initial: { hasUsableData: true },
    loadMachineInfo: async () => { throw new Error('info failed'); },
    loadMachineState: async () => { throw new Error('state failed'); }
  });

  const outcome = await harness.flow.load();
  const gateway = harness.projections.find(
    (projection): projection is Extract<StartupProjection, { type: 'gateway' }> =>
      projection.type === 'gateway'
  );

  equal(outcome.type, 'settled');
  equal(gateway?.patch.machineInfo, null);
  equal(gateway?.patch.machine, null);
  equal(harness.auxiliaryFailures, ['machine-info', 'machine-state']);
  equal(harness.effects.map((effect) => effect.type), ['connected']);
});

await run('recovering from demo resets settings before connected effects', async () => {
  const harness = createHarness({
    initial: { hasUsableData: true, demo: true }
  });

  await harness.flow.load();
  const gateway = harness.projections.find(
    (projection): projection is Extract<StartupProjection, { type: 'gateway' }> =>
      projection.type === 'gateway'
  );

  equal(gateway?.resetDemoSettings, true);
  equal(harness.recoverSettingsCalls, 1);
  equal(harness.effects.map((effect) => effect.type), ['connected']);
  equal(
    harness.callOrder.indexOf('recover-settings') <
      harness.callOrder.indexOf('select:bean-1'),
    true
  );
});

await run('demo recovery awaits real settings before selection and connected effects', async () => {
  const recoveryGate = deferred<void>();
  const harness = createHarness({
    initial: { hasUsableData: true, demo: true },
    recoverSettings: () => recoveryGate.promise
  });

  const loading = harness.flow.load();
  await waitFor(() => harness.recoverSettingsCalls === 1);
  equal(harness.selections.length, 0);
  equal(harness.effects.length, 0);
  const gated = harness.projections.find(
    (projection): projection is Extract<StartupProjection, { type: 'gateway' }> =>
      projection.type === 'gateway'
  );
  equal(gated?.settingsRecoveryPending, true);
  equal(gated?.patch.startupPhase, 'retrying');
  equal(gated?.patch.loading, true);
  equal(types(harness.projections).includes('settings-recovered'), false);

  recoveryGate.resolve();
  const outcome = await loading;
  equal(outcome.type, 'settled');
  equal(types(harness.projections).includes('settings-recovered'), true);
  equal(harness.selections.length, 1);
  equal(harness.effects.map((effect) => effect.type), ['connected']);
});

await run('demo recovery never starts a settings read from offline-cache mode', async () => {
  const harness = createHarness({
    initial: { hasUsableData: true, demo: true },
    startup: startup('gateway-unavailable')
  });

  const outcome = await harness.flow.load();
  const gateway = harness.projections.find(
    (projection): projection is Extract<StartupProjection, { type: 'gateway' }> =>
      projection.type === 'gateway'
  );

  equal(outcome.type, 'settled');
  equal(outcome.type === 'settled' ? outcome.phase : null, 'offline-cache');
  equal(gateway?.resetDemoSettings, true);
  equal(harness.recoverSettingsCalls, 0);
  equal(harness.effects.map((effect) => effect.type), ['offline']);
  equal(gateway?.patch.selectedBeanId, bean.id);
  equal(gateway?.patch.selectedBatchId, null);
  equal(Object.keys(gateway?.patch.batchesByBean ?? {}).length, 0);
  equal(gateway?.patch.shots?.length, 0);
  equal(gateway?.patch.shotsTotal, 0);
  equal(gateway?.patch.draft?.dose, 18);
});

await run('offline demo recovery retains the forced-settings obligation for reconnect', async () => {
  let gatewayAttempt = 0;
  const harness = createHarness({
    initial: { hasUsableData: true, demo: true },
    loadGateway: async () => startup(gatewayAttempt++ === 0 ? 'gateway-unavailable' : 'connected')
  });

  await harness.flow.load();
  equal(harness.recoverSettingsCalls, 0);
  await harness.flow.load();

  equal(harness.recoverSettingsCalls, 1);
  equal(harness.effects.map((effect) => effect.type), ['offline', 'connected']);
});

await run('a failed forced-settings recovery remains required on the next retry', async () => {
  let recoveryAttempt = 0;
  const harness = createHarness({
    initial: { hasUsableData: true, demo: true },
    recoverSettings: async () => {
      recoveryAttempt += 1;
      if (recoveryAttempt === 1) throw new Error('store unavailable');
    }
  });

  const first = await harness.flow.load();
  equal(first.type, 'fallback');
  const fallback = harness.projections.find(
    (projection): projection is Extract<StartupProjection, { type: 'retained-fallback' }> =>
      projection.type === 'retained-fallback'
  );
  equal(fallback?.releaseSettingsGate, true);
  const second = await harness.flow.load();

  equal(second.type, 'settled');
  equal(harness.recoverSettingsCalls, 2);
  equal(harness.effects.map((effect) => effect.type), ['retry-only', 'connected']);
});

await run('demo recovery clears dependent identity when the gateway has no beans', async () => {
  const harness = createHarness({
    initial: { hasUsableData: true, demo: true },
    startup: startup('connected', { workflow, beans: [] })
  });

  const outcome = await harness.flow.load();
  const gateway = harness.projections.find(
    (projection): projection is Extract<StartupProjection, { type: 'gateway' }> =>
      projection.type === 'gateway'
  );

  equal(outcome.type, 'settled');
  equal(harness.selections.length, 0);
  equal(gateway?.patch.selectedBeanId, null);
  equal(gateway?.patch.selectedBatchId, null);
  equal(gateway?.patch.shots?.length, 0);
  equal(gateway?.patch.detailShotId, null);
});

await run('deferred apply status precedes workflow-stale status', async () => {
  const harness = createHarness({
    initial: { hasUsableData: true, appliedSignature: 'older-workflow' },
    machine: machine('sleeping'),
    workflowMatchesBean: () => false
  });

  await harness.flow.load();

  const deferred = harness.callOrder.indexOf('commit:deferred-apply');
  const stale = harness.callOrder.indexOf('commit:workflow-stale');
  const connected = harness.callOrder.indexOf('effect:connected');
  equal(deferred >= 0, true);
  equal(deferred < stale, true);
  equal(stale < connected, true);
});

await run('single-flight ownership includes the awaited bean selection', async () => {
  const selectionGate = deferred<void>();
  let selectionAttempts = 0;
  const harness = createHarness({
    initial: { hasUsableData: true },
    selectBean: async () => {
      selectionAttempts += 1;
      if (selectionAttempts === 1) await selectionGate.promise;
    }
  });

  const first = harness.flow.load();
  await waitFor(() => harness.selections.length === 1);
  equal(harness.flow.snapshot.inFlight, true);
  const overlapping = await harness.flow.load();
  equal(overlapping, { type: 'ignored', reason: 'in-flight' });
  equal(harness.gatewayCalls, 1);

  selectionGate.resolve();
  await first;
  equal(harness.flow.snapshot.inFlight, false);
  await harness.flow.load();
  equal(harness.gatewayCalls, 2);
});

await run('a rejected settings gate releases single-flight ownership for retry', async () => {
  let settingsAttempts = 0;
  const harness = createHarness({
    loadSettings: async () => {
      settingsAttempts += 1;
      if (settingsAttempts === 1) throw new Error('settings unavailable');
    }
  });

  const first = await harness.flow.load();
  equal(first.type, 'fallback');
  equal(harness.flow.snapshot.inFlight, false);
  equal(harness.enterDemoCalls, 1);

  const second = await harness.flow.load();
  equal(second.type, 'settled');
  equal(settingsAttempts, 2);
  equal(harness.gatewayCalls, 1);
});

await run('disposal after the settings await suppresses all later work', async () => {
  const settingsGate = deferred<void>();
  const harness = createHarness({ loadSettings: () => settingsGate.promise });

  const loading = harness.flow.load();
  harness.flow.dispose();
  settingsGate.resolve();
  const outcome = await loading;

  equal(outcome.type, 'disposed');
  equal(types(harness.projections), ['loading']);
  equal(harness.cachedCalls, 0);
  equal(harness.gatewayCalls, 0);
  equal(harness.effects, []);
  equal(harness.flow.snapshot.inFlight, false);
});

await run('disposal during selection suppresses deferred apply and terminal effects', async () => {
  const selectionGate = deferred<void>();
  const harness = createHarness({
    initial: { hasUsableData: true, appliedSignature: 'old' },
    machine: machine('sleeping'),
    selectBean: () => selectionGate.promise
  });

  const loading = harness.flow.load();
  await waitFor(() => harness.selections.length === 1);
  harness.flow.dispose();
  selectionGate.resolve();
  const outcome = await loading;

  equal(outcome.type, 'disposed');
  equal(harness.scheduleApplyCalls, 0);
  equal(harness.effects, []);
  equal(
    harness.projections.some((projection) => projection.type === 'workflow-stale'),
    false
  );
});

await run('transport demotion during selection suppresses every terminal startup effect', async () => {
  const selectionGate = deferred<void>();
  const harness = createHarness({
    initial: { hasUsableData: true, appliedSignature: 'old' },
    machine: machine('sleeping'),
    selectBean: () => selectionGate.promise
  });

  const loading = harness.flow.load();
  await waitFor(() => harness.selections.length === 1);
  harness.invalidateAuthority();
  selectionGate.resolve();
  const outcome = await loading;

  equal(outcome, { type: 'ignored', reason: 'authority-changed' });
  equal(harness.scheduleApplyCalls, 0);
  equal(harness.effects, []);
  equal(
    harness.projections.some((projection) => projection.type === 'workflow-stale'),
    false
  );
});

interface HarnessOptions {
  initial?: Partial<StartupHostSnapshot>;
  cached?: GatewayStartupSnapshot['data'];
  startup?: GatewayStartupSnapshot;
  machine?: MachineSnapshot;
  loadSettings?: () => Promise<void>;
  loadGateway?: () => Promise<GatewayStartupSnapshot>;
  loadMachineInfo?: () => Promise<MachineInfo>;
  loadMachineState?: () => Promise<MachineSnapshot>;
  workflowMatchesBean?: (bean: Bean) => boolean;
  selectBean?: (beanId: string, options: StartupSelectionOptions) => Promise<void>;
  recoverSettings?: () => Promise<void>;
}

function createHarness(options: HarnessOptions = {}): {
  flow: StartupFlow;
  projections: StartupProjection[];
  effects: StartupEffectPlan[];
  selections: Array<{ beanId: string; options: StartupSelectionOptions }>;
  auxiliaryFailures: StartupAuxiliaryOperation[];
  callOrder: string[];
  readonly cachedCalls: number;
  readonly gatewayCalls: number;
  readonly readLastBeanIdCalls: number;
  readonly enterDemoCalls: number;
  readonly scheduleApplyCalls: number;
  readonly recoverSettingsCalls: number;
  invalidateAuthority(): void;
} {
  const current: {
    hasUsableData: boolean;
    demo: boolean;
    appliedSignature: string | null;
    batchesByBean: StartupHostSnapshot['batchesByBean'];
    settingsRecoveryRequired: boolean;
    authorityRevision: number;
  } = {
    hasUsableData: false,
    demo: false,
    appliedSignature: null,
    batchesByBean: {},
    settingsRecoveryRequired: false,
    authorityRevision: 0,
    ...options.initial
  };
  const projections: StartupProjection[] = [];
  const effects: StartupEffectPlan[] = [];
  const selections: Array<{ beanId: string; options: StartupSelectionOptions }> = [];
  const auxiliaryFailures: StartupAuxiliaryOperation[] = [];
  const callOrder: string[] = [];
  let cachedCalls = 0;
  let gatewayCalls = 0;
  let readLastBeanIdCalls = 0;
  let enterDemoCalls = 0;
  let scheduleApplyCalls = 0;
  let recoverSettingsCalls = 0;

  const deps: StartupFlowDependencies = {
    loadSettings: options.loadSettings ?? (async () => {}),
    loadCached: async () => {
      cachedCalls += 1;
      return options.cached ?? {};
    },
    loadGateway: async () => {
      gatewayCalls += 1;
      return options.loadGateway ? options.loadGateway() : options.startup ?? startup('connected');
    },
    loadMachineInfo: options.loadMachineInfo ?? (async () => ({ model: 'DE1' })),
    loadMachineState: options.loadMachineState ?? (async () => options.machine ?? machine('idle')),
    readLastBeanId: () => {
      readLastBeanIdCalls += 1;
      return bean.id;
    },
    onAuxiliaryFailure: (operation) => auxiliaryFailures.push(operation)
  };
  const host: StartupFlowHost = {
    snapshot: () => current,
    commit: (projection) => {
      projections.push(projection);
      callOrder.push(`commit:${projection.type}`);
      if (projection.type === 'cached') {
        current.hasUsableData = true;
        current.demo = false;
        current.appliedSignature = projection.patch.appliedSignature;
      } else if (projection.type === 'gateway') {
        current.hasUsableData = true;
        current.demo = false;
        if (projection.resetDemoSettings) current.settingsRecoveryRequired = true;
      }
    },
    workflowMatchesBean: options.workflowMatchesBean ?? (() => false),
    selectBean: async (beanId, selectionOptions) => {
      selections.push({ beanId, options: selectionOptions });
      callOrder.push(`select:${beanId}`);
      await options.selectBean?.(beanId, selectionOptions);
    },
    scheduleApply: () => {
      scheduleApplyCalls += 1;
      callOrder.push('schedule-apply');
    },
    recoverSettings: async () => {
      recoverSettingsCalls += 1;
      callOrder.push('recover-settings');
      await options.recoverSettings?.();
      current.settingsRecoveryRequired = false;
    },
    applyEffects: (plan) => {
      effects.push(plan);
      callOrder.push(`effect:${plan.type}`);
    },
    enterDemo: () => {
      enterDemoCalls += 1;
      current.hasUsableData = true;
      current.demo = true;
      callOrder.push('enter-demo');
    }
  };
  const flow = new StartupFlow(deps, host);
  return {
    flow,
    projections,
    effects,
    selections,
    auxiliaryFailures,
    callOrder,
    get cachedCalls() { return cachedCalls; },
    get gatewayCalls() { return gatewayCalls; },
    get readLastBeanIdCalls() { return readLastBeanIdCalls; },
    get enterDemoCalls() { return enterDemoCalls; },
    get scheduleApplyCalls() { return scheduleApplyCalls; },
    get recoverSettingsCalls() { return recoverSettingsCalls; },
    invalidateAuthority: () => { current.authorityRevision += 1; }
  };
}

function startup(
  status: GatewayStartupSnapshot['status'],
  data: GatewayStartupSnapshot['data'] = {
    workflow,
    beans: [bean],
    grinders,
    profiles,
    latestShots
  }
): GatewayStartupSnapshot {
  return {
    mode: 'real',
    status,
    source: 'gateway',
    origin: 'http://gateway.test',
    fallbackToDemo: null,
    issues: [],
    resources: {
      workflow: loaded('workflow', workflow),
      beans: loaded('beans', [bean]),
      grinders: loaded('grinders', grinders),
      profiles: loaded('profiles', profiles),
      shots: loaded('shots', latestShots)
    },
    data
  };
}

function loaded<T>(resource: ApiResourceName, data: T): ApiResource<T> {
  return {
    resource,
    status: 'loaded',
    source: 'gateway',
    data,
    receivedAt: '2026-07-12T10:00:00.000Z'
  };
}

function machine(state: MachineSnapshot['state']['state']): MachineSnapshot {
  return {
    timestamp: '2026-07-12T10:00:00.000Z',
    state: { state },
    flow: 0,
    pressure: 0,
    targetFlow: 0,
    targetPressure: 0,
    mixTemperature: 93,
    groupTemperature: 93,
    targetMixTemperature: 93,
    targetGroupTemperature: 93,
    profileFrame: 0,
    steamTemperature: 140
  };
}

function types(projections: readonly StartupProjection[]): StartupProjection['type'][] {
  return projections.map((projection) => projection.type);
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T extends void ? never : T): void;
  resolve(): void;
} {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolve) => { resolvePromise = resolve; });
  return {
    promise,
    resolve: ((value?: T) => resolvePromise(value as T)) as {
      (value: T extends void ? never : T): void;
      (): void;
    }
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await flushAsync();
  }
  throw new Error('Timed out waiting for startup flow state');
}

function flushAsync(): Promise<void> {
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

function equal(actual: unknown, expected: unknown, context = ''): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${context ? `${context}: ` : ''}expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`
    );
  }
}
