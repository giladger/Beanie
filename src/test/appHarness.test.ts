type Listener = (event: Event) => void | Promise<void>;
type DoseMutationEnqueueResult =
  import('../controllers/doseMutationReconciler').DoseMutationEnqueueResult;

class FakeClassList {
  add(): void {}
  remove(): void {}
  contains(): boolean {
    return false;
  }
}

class FakeElement {
  innerHTML = '';
  dataset: Record<string, string> = {};
  parentElement: FakeElement | null = null;
  scrollTop = 0;
  scrollHeight = 0;
  scrollWidth = 0;
  clientHeight = 0;
  clientWidth = 0;
  classList = new FakeClassList();

  private readonly listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  async dispatch(type: string, target: FakeElement = this): Promise<void> {
    for (const listener of this.listeners.get(type) ?? []) {
      await listener({ target } as unknown as Event);
    }
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }

  querySelector(): null {
    return null;
  }

  querySelectorAll(): FakeElement[] {
    return [];
  }

  closest(selector: string): FakeElement | null {
    return selector === '[data-action]' && this.dataset.action ? this : null;
  }

  getAttribute(): null {
    return null;
  }

  focus(): void {}
}

class FakeFormElement extends FakeElement {
  readonly formValues: Readonly<Record<string, string>>;

  constructor(dataset: Record<string, string>, formValues: Readonly<Record<string, string>>) {
    super();
    this.dataset = dataset;
    this.formValues = formValues;
  }
}

class FakeFormData {
  private readonly values: Readonly<Record<string, string>>;

  constructor(form?: HTMLFormElement) {
    this.values = (form as unknown as FakeFormElement | undefined)?.formValues ?? {};
  }

  get(name: string): FormDataEntryValue | null {
    return Object.prototype.hasOwnProperty.call(this.values, name) ? this.values[name]! : null;
  }

  has(name: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.values, name);
  }
}

class FakeStorage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value));
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }
}

function installBrowserFakes(): void {
  const documentElement = new FakeElement();
  const documentFake = {
    activeElement: null,
    documentElement,
    // morphdom probes document.createElement('template') at import time.
    createElement: () => new FakeElement(),
    querySelectorAll: () => [],
    querySelector: () => null
  };
  const windowFake = {
    BEANIE_GATEWAY: 'http://beanie-test-gateway',
    addEventListener: () => {},
    removeEventListener: () => {},
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0),
    cancelAnimationFrame: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    getComputedStyle: () => ({ overflowX: 'visible', overflowY: 'visible' })
  };

  Object.assign(globalThis, {
    document: documentFake,
    window: windowFake,
    localStorage: new FakeStorage(),
    location: {
      port: '',
      protocol: 'http:',
      hostname: 'localhost',
      origin: 'http://localhost'
    },
    Element: FakeElement,
    HTMLElement: FakeElement,
    HTMLCanvasElement: FakeElement,
    __APP_VERSION__: 'test',
    __GIT_COMMIT__: 'test',
    __BUILD_TIME__: '2026-06-07T00:00:00.000Z',
    // Resolve settings-store GETs (so the boot settings load completes and the
    // spinner clears); every other gateway call hangs to keep a controlled state.
    fetch: (input: unknown) =>
      String(input).includes('/api/v1/store/')
        ? Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(null) })
        : new Promise(() => {})
  });
}

installBrowserFakes();

const { BeanieApp } = await import('../app');
const { GatewayRequestError } = await import('../api/gateway');
const { demoSettingsBundle } = await import('../domain/settingsModel');
const { beanieCache } = await import('../domain/cache');
const {
  captureSyncedCache,
  clearSyncedCache,
  favoriteBeansKey,
  getSyncedItem,
  restoreSyncedCache,
  setSyncedItem,
  uiScaleKey
} = await import('../domain/settingsStore');

await run('BeanieApp starts by rendering the workbench shell and delegated listeners', async () => {
  const root = new FakeElement();
  const app = new BeanieApp(root as unknown as HTMLElement);

  app.start();

  // Settings now load from the store first, so the very first paint is a spinner.
  includes(root.innerHTML, 'settings-boot');
  // Once the settings load resolves, the workbench shell renders.
  await flushAsync();
  includes(root.innerHTML, 'app-shell');
  includes(root.innerHTML, 'topbar');
  equal(root.listenerCount('click'), 1);
  equal(root.listenerCount('input'), 1);
  equal(root.listenerCount('change'), 1);
  equal(root.listenerCount('submit'), 1);
  equal(root.listenerCount('keydown'), 1);
  equal(root.listenerCount('wheel'), 1);
  equal(root.listenerCount('touchstart'), 1);
  equal(root.listenerCount('touchmove'), 1);

  app.dispose();
});

await run('blocked dose journal discovery does not block application bootstrap', async () => {
  const root = new FakeElement();
  const app = new BeanieApp(root as unknown as HTMLElement);
  let loadCalls = 0;
  const harness = app as unknown as {
    inventoryJournalReady: boolean;
    load(): Promise<void>;
    doseMutationReconciler: {
      pendingAdjustments(): Promise<readonly never[]>;
    };
  };
  harness.load = async () => { loadCalls += 1; };
  harness.doseMutationReconciler.pendingAdjustments = () => new Promise(() => {});

  app.start();
  await flushAsync();

  equal(loadCalls, 1);
  equal(harness.inventoryJournalReady, false);
  app.dispose();
});

await run('dose journal hydration overlays pending physical inventory before enabling writes', async () => {
  const root = new FakeElement();
  const app = new BeanieApp(root as unknown as HTMLElement);
  let reconcilerStarts = 0;
  const harness = app as unknown as {
    state: {
      batchesByBean: Record<string, Array<{ id: string; weightRemaining?: number | null }>>;
    };
    inventoryJournalReady: boolean;
    setState(next: Record<string, unknown>): void;
    prepareDoseReconciliation(): Promise<void>;
    doseMutationReconciler: {
      pendingAdjustments(): Promise<readonly [{
        idempotencyKey: string;
        entry: {
          adjustment: 'deduction';
          shotId: string;
          beanId: string;
          batchId: string;
          dose: number;
          expectedRemaining: number;
          at: string;
        };
      }]>;
      start(): Promise<void>;
    };
  };
  harness.setState({
    batchesByBean: {
      'bean-1': [{ id: 'batch-1', weightRemaining: 100 }]
    }
  });
  harness.doseMutationReconciler.pendingAdjustments = async () => [{
    idempotencyKey: 'dose-1',
    entry: {
      adjustment: 'deduction',
      shotId: 'shot-1',
      beanId: 'bean-1',
      batchId: 'batch-1',
      dose: 18,
      expectedRemaining: 82,
      at: '2026-07-12T10:00:00.000Z'
    }
  }];
  harness.doseMutationReconciler.start = async () => { reconcilerStarts += 1; };

  await harness.prepareDoseReconciliation();

  equal(harness.inventoryJournalReady, true);
  equal(harness.state.batchesByBean['bean-1']?.[0]?.weightRemaining, 82);
  equal(reconcilerStarts, 1);
  app.dispose();
});

await run('foreground inventory writes fail closed until journal hydration succeeds', async () => {
  const root = new FakeElement();
  const app = new BeanieApp(root as unknown as HTMLElement);
  const harness = app as unknown as {
    state: {
      batchesByBean: Record<string, Array<{ id: string; weightRemaining?: number | null }>>;
    };
    setState(next: Record<string, unknown>): void;
    beanInventory: {
      startBatchUpdate(request: Record<string, unknown>): {
        completion: Promise<{ type: string }> | null;
      };
    };
    updateInventoryBatch(request: {
      beanId: string;
      batchId: string;
      patch: { beanId: string; weightRemaining: number };
      purpose: 'edit';
      demo: false;
    }): Promise<'saved' | 'failed' | 'skipped'>;
  };
  harness.setState({
    batchesByBean: {
      'bean-1': [{ id: 'batch-1', weightRemaining: 100 }]
    }
  });

  const outcome = await harness.updateInventoryBatch({
    beanId: 'bean-1',
    batchId: 'batch-1',
    patch: { beanId: 'bean-1', weightRemaining: 90 },
    purpose: 'edit',
    demo: false
  });

  equal(outcome, 'failed');
  equal(harness.state.batchesByBean['bean-1']?.[0]?.weightRemaining, 100);
  const directControllerAttempt = harness.beanInventory.startBatchUpdate({
    beanId: 'bean-1',
    batchId: 'batch-1',
    patch: { beanId: 'bean-1', weightRemaining: 80 },
    purpose: 'edit',
    demo: false
  });
  equal((await directControllerAttempt.completion)?.type, 'failed');
  app.dispose();
});

await run('BeanieApp dispose is idempotent and removes delegated listeners', () => {
  const root = new FakeElement();
  const app = new BeanieApp(root as unknown as HTMLElement);

  app.start();
  app.dispose();
  app.dispose();

  equal(root.listenerCount('click'), 0);
  equal(root.listenerCount('input'), 0);
  equal(root.listenerCount('change'), 0);
  equal(root.listenerCount('submit'), 0);
  equal(root.listenerCount('keydown'), 0);
  equal(root.listenerCount('wheel'), 0);
  equal(root.listenerCount('touchstart'), 0);
  equal(root.listenerCount('touchmove'), 0);
});

await run('BeanieApp lifecycle is one-shot and cannot duplicate or revive disposed owners', () => {
  const root = new FakeElement();
  const app = new BeanieApp(root as unknown as HTMLElement);

  app.start();
  app.start();
  equal(root.listenerCount('click'), 1);
  equal(root.listenerCount('input'), 1);

  app.dispose();
  app.start();
  equal(root.listenerCount('click'), 0);
  equal(root.listenerCount('input'), 0);
});

await run('BeanieApp delegated click dispatch opens settings', async () => {
  const root = new FakeElement();
  const app = new BeanieApp(root as unknown as HTMLElement);
  const button = new FakeElement();
  button.dataset.action = 'open-settings';

  app.start();
  await root.dispatch('click', button);
  await flushAsync();

  includes(root.innerHTML, 'page-title">Settings</h1>');

  app.dispose();
});

await run('BeanieApp delegated click dispatch opens the profile picker', async () => {
  const root = new FakeElement();
  const app = new BeanieApp(root as unknown as HTMLElement);
  const button = new FakeElement();
  button.dataset.action = 'open-profile-picker';

  app.start();
  await root.dispatch('click', button);
  await flushAsync();

  includes(root.innerHTML, 'profiles-page');

  app.dispose();
});

await run('queued machine mutations re-check live authority at dispatch', async () => {
  const root = new FakeElement();
  const app = new BeanieApp(root as unknown as HTMLElement);
  const harness = app as unknown as {
    setState(next: Record<string, unknown>): void;
    runExactMachineCommand<T>(
      run: (lane: unknown) => T | PromiseLike<T>
    ): Promise<T>;
  };
  harness.setState({ startupPhase: 'connected', demo: false });

  let releaseFirst!: () => void;
  const first = harness.runExactMachineCommand(
    () => new Promise<void>((resolve) => { releaseFirst = resolve; })
  );
  await flushAsync();
  let secondRuns = 0;
  const second = harness.runExactMachineCommand(() => {
    secondRuns += 1;
    return 'sent';
  });
  harness.setState({ startupPhase: 'offline-cache' });
  releaseFirst();
  await first;

  let rejected = false;
  try {
    await second;
  } catch {
    rejected = true;
  }
  equal(rejected, true);
  equal(secondRuns, 0);

  app.dispose();
});

await run('queued automatic brightness work re-checks authority before dispatch', async () => {
  const root = new FakeElement();
  const app = new BeanieApp(root as unknown as HTMLElement);
  let releaseLane!: () => void;
  const laneGate = new Promise<void>((resolve) => { releaseLane = resolve; });
  const harness = app as unknown as {
    startupAuthorityRevision: number;
    setState(next: Record<string, unknown>): void;
    setGatewayBrightnessLatest(
      brightness: number,
      options: { requiresConnectedAuthority: true }
    ): Promise<unknown>;
    gatewayMutations: {
      latest<T>(key: string, coalesceKey: string, run: () => Promise<T>): Promise<unknown>;
    };
  };
  const nativeFetch = globalThis.fetch;
  let brightnessWrites = 0;
  globalThis.fetch = (async (input: unknown) => {
    if (String(input).includes('/api/v1/display/brightness')) brightnessWrites += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({ brightness: 30, requestedBrightness: 30 })
    } as Response;
  }) as typeof fetch;
  try {
    harness.setState({ startupPhase: 'connected', gatewayLinkDown: false, demo: false });
    const occupying = harness.gatewayMutations.latest(
      'display',
      'brightness',
      async () => laneGate
    );
    await flushAsync();
    const automatic = harness.setGatewayBrightnessLatest(30, {
      requiresConnectedAuthority: true
    });
    harness.startupAuthorityRevision += 1;
    harness.setState({ startupPhase: 'offline-cache', gatewayLinkDown: true });
    releaseLane();
    await occupying;
    equal(await automatic, null);
    equal(brightnessWrites, 0);
  } finally {
    globalThis.fetch = nativeFetch;
    app.dispose();
  }
});

await run('staging an edited recipe synchronously replaces desired recipe identity', () => {
  const root = new FakeElement();
  const app = new BeanieApp(root as unknown as HTMLElement);
  const harness = app as unknown as {
    setState(next: Record<string, unknown>): void;
    scheduleApply(): void;
    recipeApply: {
      snapshot: { stagedFingerprint: string | null; scheduled: boolean };
    };
    machineWorkflowCommands: { snapshot: { desired: { profile?: { steps?: Array<{ pressure?: number }> } } | null } };
  };
  harness.setState({
    settingsLoaded: true,
    loading: false,
    demo: true,
    startupPhase: 'demo',
    beans: [{ id: 'bean-new', roaster: 'Kawa', name: 'Bourbon' }],
    selectedBeanId: 'bean-new',
    batchesByBean: {
      'bean-new': [{ id: 'batch-new', beanId: 'bean-new' }]
    },
    selectedBatchId: 'batch-new',
    profiles: [],
    grinders: [],
    workflow: {
      profile: { title: 'Old title', steps: [{ pressure: 8 }] },
      context: { beanId: 'bean-old', targetDoseWeight: 17, targetYield: 34 }
    },
    draft: {
      profileTitle: 'New title',
      profile: { title: 'New title', steps: [{ pressure: 9 }] },
      brewTemp: 93,
      dose: 18,
      yield: 40,
      grinderId: 'grinder-new',
      grinderModel: 'DF64',
      grinderSetting: '5.5'
    }
  });
  harness.scheduleApply();
  const firstFingerprint = harness.recipeApply.snapshot.stagedFingerprint;
  harness.setState({
    draft: {
      profileTitle: 'New title',
      profile: { title: 'New title', steps: [{ pressure: 10 }] },
      brewTemp: 93,
      dose: 18,
      yield: 40,
      grinderId: 'grinder-new',
      grinderModel: 'DF64',
      grinderSetting: '5.5'
    }
  });
  harness.scheduleApply();

  equal(harness.recipeApply.snapshot.stagedFingerprint === firstFingerprint, false);
  equal(harness.recipeApply.snapshot.scheduled, true);
  equal(harness.machineWorkflowCommands.snapshot.desired?.profile?.steps?.[0]?.pressure, 10);
  app.dispose();
});

await run('an offline Wake rejection keeps the sleeping presentation intact', async () => {
  const root = new FakeElement();
  const app = new BeanieApp(root as unknown as HTMLElement);
  const harness = app as unknown as {
    setState(next: Record<string, unknown>): void;
    machineClickActions(): Record<string, () => void | Promise<void>>;
  };
  const hostWindow = window as typeof window & { __DECENT_HOST__?: unknown };

  hostWindow.__DECENT_HOST__ = {};
  harness.setState({
    settingsLoaded: true,
    startupPhase: 'offline-cache',
    gatewayLinkDown: true,
    demo: false,
    asleep: true,
    appAwake: false,
    loading: false
  });
  includes(root.innerHTML, 'aria-label="Wake machine"');

  await harness.machineClickActions().wake?.();

  includes(root.innerHTML, 'aria-label="Wake machine"');
  includes(root.innerHTML, 'Machine controls are read-only until live data reconnects');
  delete hostWindow.__DECENT_HOST__;
  app.dispose();
});

await run('an observed physical wake resumes a recipe deferred by sleep', async () => {
  const root = new FakeElement();
  const app = new BeanieApp(root as unknown as HTMLElement);
  let resumes = 0;
  const harness = app as unknown as {
    setState(next: Record<string, unknown>): void;
    applyLiveTelemetryIdleDecision(decision: { type: 'set-asleep'; asleep: boolean }): boolean;
    recipeApply: {
      resumeAfterWake(): Promise<{ type: 'no-candidate' }>;
    };
  };
  harness.recipeApply.resumeAfterWake = async () => {
    resumes += 1;
    return { type: 'no-candidate' };
  };
  harness.setState({ asleep: true, appAwake: false });

  harness.applyLiveTelemetryIdleDecision({ type: 'set-asleep', asleep: true });
  equal(resumes, 0);
  harness.applyLiveTelemetryIdleDecision({ type: 'set-asleep', asleep: false });
  await flushAsync();

  equal(resumes, 1);
  app.dispose();
});

await run('a direct sleep to espresso wake defers recipe resume until post-shot idle', async () => {
  const root = new FakeElement();
  const app = new BeanieApp(root as unknown as HTMLElement);
  let resumes = 0;
  const machine = (state: string, substate?: string) => ({
    timestamp: '2026-07-12T14:46:28.000Z',
    state: { state, ...(substate ? { substate } : {}) },
    flow: 1,
    pressure: 2,
    targetFlow: 2,
    targetPressure: 6,
    mixTemperature: 930,
    groupTemperature: 930,
    targetMixTemperature: 930,
    targetGroupTemperature: 930,
    profileFrame: 0,
    steamTemperature: 120
  });
  const sleeping = machine('sleeping');
  const pouring = machine('espresso', 'pouring');
  const idle = machine('idle');
  const harness = app as unknown as {
    state: { asleep: boolean; liveActive: boolean };
    setState(next: Record<string, unknown>): void;
    ingestLiveFrame(
      machineFrame: unknown,
      scaleFrame: null,
      atMs: number,
      currentMachine: unknown,
      currentScale: null
    ): void;
    onShotEnded(): void;
    recipeApply: {
      snapshot: { deferredUntilWake: boolean };
      resumeAfterWake(): Promise<{ type: 'no-candidate' }>;
    };
  };
  Object.defineProperty(harness.recipeApply, 'snapshot', {
    configurable: true,
    value: { deferredUntilWake: true }
  });
  harness.recipeApply.resumeAfterWake = async () => {
    resumes += 1;
    return { type: 'no-candidate' };
  };
  harness.onShotEnded = () => {
    harness.setState({ liveActive: false, liveFinalizing: false });
  };
  harness.setState({
    demo: true,
    startupPhase: 'demo',
    asleep: true,
    appAwake: false,
    machine: sleeping,
    scale: null,
    liveActive: false,
    liveFinalizing: false
  });

  harness.ingestLiveFrame(pouring, null, 1_000, sleeping, null);
  equal(harness.state.asleep, false);
  equal(harness.state.liveActive, true);
  equal(resumes, 0);

  harness.ingestLiveFrame(idle, null, 2_000, pouring, null);
  equal(resumes, 0);
  harness.ingestLiveFrame(idle, null, 3_000, idle, null);
  await flushAsync();

  equal(resumes, 1);
  app.dispose();
});

await run('a workflow resync that finishes after a shot starts cannot change coffee selection', async () => {
  const root = new FakeElement();
  const app = new BeanieApp(root as unknown as HTMLElement);
  const oldBean = { id: 'old-bean', roaster: 'Old', name: 'Coffee' };
  const newBean = { id: 'new-bean', roaster: 'New', name: 'Coffee' };
  const workflowGate: { finish?: (response: Response) => void } = {};
  let selectionCalls = 0;
  const nativeFetch = globalThis.fetch;
  const harness = app as unknown as {
    state: { workflow: { context?: { beanId?: string | null } } | null };
    setState(next: Record<string, unknown>): void;
    selectBean(beanId: string, options: unknown): Promise<void>;
    resyncWorkflowAndBean(): Promise<void>;
  };
  harness.selectBean = async () => {
    selectionCalls += 1;
  };
  globalThis.fetch = (async (input: unknown) => {
    if (!String(input).includes('/api/v1/workflow')) return nativeFetch(input as RequestInfo | URL);
    return new Promise<Response>((resolve) => {
      workflowGate.finish = resolve;
    });
  }) as typeof fetch;

  try {
    harness.setState({
      settingsLoaded: true,
      loading: false,
      startupPhase: 'connected',
      gatewayLinkDown: false,
      demo: false,
      busy: false,
      liveActive: false,
      applyState: 'idle',
      modal: null,
      beans: [oldBean, newBean],
      selectedBeanId: oldBean.id,
      batchesByBean: {
        [oldBean.id]: [{ id: 'old-batch', beanId: oldBean.id }],
        [newBean.id]: [{ id: 'new-batch', beanId: newBean.id }]
      },
      selectedBatchId: 'old-batch',
      workflow: {
        name: 'Old workflow',
        profile: { title: 'Old profile', steps: [] },
        context: { beanId: oldBean.id, beanBatchId: 'old-batch' }
      }
    });

    const resync = harness.resyncWorkflowAndBean();
    await flushAsync();
    harness.setState({ liveActive: true });
    const workflowResponse = workflowGate.finish;
    if (!workflowResponse) throw new Error('Expected workflow request to be pending');
    workflowResponse({
      ok: true,
      status: 200,
      json: async () => ({
        name: 'New workflow',
        profile: { title: 'New profile', steps: [] },
        context: { beanId: newBean.id, beanBatchId: 'new-batch' }
      })
    } as Response);
    await resync;

    equal(selectionCalls, 0);
    equal(harness.state.workflow?.context?.beanId, oldBean.id);
  } finally {
    globalThis.fetch = nativeFetch;
    app.dispose();
  }
});

await run('live attribution follows the confirmed machine workflow instead of the visible draft', () => {
  const root = new FakeElement();
  const app = new BeanieApp(root as unknown as HTMLElement);
  const alchemist = { id: 'alchemist', roaster: 'DAK', name: 'The Alchemist' };
  const purple = { id: 'purple', roaster: 'DAK', name: 'Purple Rain' };
  const alchemistBatch = { id: 'alchemist-batch', beanId: alchemist.id };
  const purpleBatch = { id: 'purple-batch', beanId: purple.id };
  const confirmedWorkflow = {
    name: 'DAK The Alchemist',
    profile: { title: 'Gentle and sweet', steps: [] },
    context: {
      beanBatchId: alchemistBatch.id,
      grinderSetting: '2',
      targetDoseWeight: 18,
      targetYield: 38
    }
  };
  const harness = app as unknown as {
    setState(next: Record<string, unknown>): void;
    machineWorkflowCommands: { synchronizeAuthoritative(workflow: unknown): void };
    currentLiveShotAttribution(): {
      source: string;
      bean: { id: string } | null;
      batch: { id: string } | null;
      draft: { grinderSetting?: string | null };
    };
  };
  harness.setState({
    startupPhase: 'connected',
    beans: [alchemist, purple],
    batchesByBean: {
      [alchemist.id]: [alchemistBatch],
      [purple.id]: [purpleBatch]
    },
    selectedBeanId: purple.id,
    selectedBatchId: purpleBatch.id,
    workflow: confirmedWorkflow,
    draft: {
      profileTitle: 'Gentle and sweet',
      profile: { title: 'Gentle and sweet', steps: [] },
      grinderSetting: '4',
      dose: 18,
      yield: 38
    }
  });
  harness.machineWorkflowCommands.synchronizeAuthoritative(confirmedWorkflow);

  const attribution = harness.currentLiveShotAttribution();

  equal(attribution.source, 'confirmed-batch');
  equal(attribution.bean?.id, alchemist.id);
  equal(attribution.batch?.id, alchemistBatch.id);
  equal(attribution.draft.grinderSetting, '2');
  app.dispose();
});

await run('offline cached workflow shadow is not treated as confirmed live attribution', () => {
  const root = new FakeElement();
  const app = new BeanieApp(root as unknown as HTMLElement);
  const cachedBean = { id: 'cached', roaster: 'Old', name: 'Cached' };
  const selectedBean = { id: 'selected', roaster: 'Live', name: 'Selection' };
  const cachedBatch = { id: 'cached-batch', beanId: cachedBean.id };
  const selectedBatch = { id: 'selected-batch', beanId: selectedBean.id };
  const cachedWorkflow = { context: { beanBatchId: cachedBatch.id } };
  const harness = app as unknown as {
    setState(next: Record<string, unknown>): void;
    machineWorkflowCommands: { synchronizeAuthoritative(workflow: unknown): void };
    currentLiveShotAttribution(): {
      source: string;
      bean: { id: string } | null;
      batch: { id: string } | null;
    };
  };
  harness.setState({
    startupPhase: 'offline-cache',
    demo: false,
    beans: [cachedBean, selectedBean],
    batchesByBean: {
      [cachedBean.id]: [cachedBatch],
      [selectedBean.id]: [selectedBatch]
    },
    selectedBeanId: selectedBean.id,
    selectedBatchId: selectedBatch.id,
    workflow: cachedWorkflow,
    draft: {}
  });
  harness.machineWorkflowCommands.synchronizeAuthoritative(cachedWorkflow);

  const attribution = harness.currentLiveShotAttribution();

  equal(attribution.source, 'ui-fallback');
  equal(attribution.bean?.id, selectedBean.id);
  equal(attribution.batch?.id, selectedBatch.id);
  app.dispose();
});

await run('BeanieApp projects settings mutation outcomes through the extracted flow', async () => {
  const root = new FakeElement();
  const app = new BeanieApp(root as unknown as HTMLElement);
  const harness = app as unknown as {
    state: { settingsBundle: ReturnType<typeof demoSettingsBundle>; modal: string | null };
    setState(next: Record<string, unknown>): void;
    setNoScaleBlock(enabled: boolean): Promise<void>;
  };
  const bundle = demoSettingsBundle();
  harness.setState({
    demo: true,
    settingsSource: 'demo',
    settingsBundle: {
      ...bundle,
      rea: { ...bundle.rea, blockOnNoScale: true }
    },
    modal: 'no-scale-shot'
  });

  await harness.setNoScaleBlock(false);

  equal(harness.state.settingsBundle.rea.blockOnNoScale, false);
  equal(harness.state.modal, null);
  app.dispose();
});

await run('BeanieApp applies the no-scale escape hatch before the settings bundle loads', async () => {
  const root = new FakeElement();
  const app = new BeanieApp(root as unknown as HTMLElement);
  const harness = app as unknown as {
    state: {
      settingsBundle: ReturnType<typeof demoSettingsBundle> | null;
      modal: string | null;
    };
    setState(next: Record<string, unknown>): void;
    setNoScaleBlock(enabled: boolean): Promise<void>;
  };
  harness.setState({
    settingsLoaded: true,
    demo: true,
    settingsSource: 'demo',
    settingsBundle: null,
    modal: 'no-scale-shot'
  });
  includes(root.innerHTML, 'data-action="no-scale-block-toggle" checked');

  await harness.setNoScaleBlock(false);

  equal(harness.state.settingsBundle, null);
  equal(harness.state.modal, null);
  app.dispose();
});

await run('BeanieApp projects local shot completion and dose inventory together', async () => {
  const root = new FakeElement();
  const app = new BeanieApp(root as unknown as HTMLElement);
  const bean = { id: 'bean-1', roaster: 'Test', name: 'Coffee' };
  const batch = { id: 'batch-1', beanId: bean.id, weight: 100, weightRemaining: 100 };
  const optimisticShot = {
    id: 'pending-live-1',
    timestamp: '2026-07-12T10:00:00.000Z',
    workflow: null,
    annotations: { actualDoseWeight: 18, actualYield: 36 },
    metadata: null,
    measurements: []
  };
  const harness = app as unknown as {
    state: {
      shots: Array<{ id: string }>;
      batchesByBean: Record<string, Array<{ id: string; weightRemaining?: number | null }>>;
      liveActive: boolean;
      liveFinalizing: boolean;
    };
    setState(next: Record<string, unknown>): void;
    liveShotCompletion: {
      complete(request: Record<string, unknown>): Promise<{ type: string }>;
    };
  };
  harness.setState({
    demo: true,
    selectedBeanId: bean.id,
    selectedBatchId: batch.id,
    beans: [bean],
    batchesByBean: { [bean.id]: [batch] },
    shots: [],
    shotsTotal: 0,
    detailShotId: null,
    liveActive: true,
    liveFinalizing: false
  });

  const outcome = await harness.liveShotCompletion.complete({
    cleaningInProgress: false,
    noScaleBlockedAbort: false,
    selection: { bean, batch },
    demo: true,
    currentShots: [],
    currentShotsTotal: 0,
    currentDetailShotId: null,
    shotWindow: { startMs: Date.parse(optimisticShot.timestamp), lastActiveMs: null },
    optimisticShot,
    completionReason: 'target weight',
    nowMs: Date.parse(optimisticShot.timestamp) + 30_000,
    pageLimit: 12
  });
  await flushAsync();

  equal(outcome.type, 'local-complete');
  equal(harness.state.shots[0]?.id, optimisticShot.id);
  equal(harness.state.batchesByBean[bean.id]?.[0]?.weightRemaining, 82);
  equal(harness.state.liveActive, false);
  equal(harness.state.liveFinalizing, false);
  app.dispose();
});

await run('completion for a different confirmed coffee cannot overwrite visible history', () => {
  const root = new FakeElement();
  const app = new BeanieApp(root as unknown as HTMLElement);
  const alchemist = { id: 'alchemist', roaster: 'DAK', name: 'The Alchemist' };
  const purple = { id: 'purple', roaster: 'DAK', name: 'Purple Rain' };
  const purpleShot = {
    id: 'purple-existing',
    timestamp: '2026-07-12T14:00:00.000Z',
    workflow: { context: { beanId: purple.id, beanBatchId: 'purple-batch' } },
    annotations: null,
    metadata: null,
    measurements: []
  };
  const alchemistShot = {
    id: 'alchemist-saved',
    timestamp: '2026-07-12T14:46:28.000Z',
    workflow: { context: { beanId: alchemist.id, beanBatchId: 'alchemist-batch' } },
    annotations: { actualDoseWeight: 18, actualYield: 18.6 },
    metadata: null,
    measurements: []
  };
  const harness = app as unknown as {
    state: { shots: Array<{ id: string }>; liveFinalizing: boolean; status: string };
    setState(next: Record<string, unknown>): void;
    handleLiveShotCompletionEvent(event: unknown): void;
  };
  harness.setState({
    beans: [purple, alchemist],
    selectedBeanId: purple.id,
    selectedBatchId: 'purple-batch',
    batchesByBean: {
      [purple.id]: [{ id: 'purple-batch', beanId: purple.id }],
      [alchemist.id]: [{ id: 'alchemist-batch', beanId: alchemist.id }]
    },
    shots: [purpleShot],
    shotsTotal: 1,
    detailShotId: purpleShot.id,
    liveActive: false,
    liveFinalizing: true
  });

  harness.handleLiveShotCompletionEvent({
    type: 'settled',
    request: {},
    outcome: {
      type: 'remote-complete',
      beanId: alchemist.id,
      batchId: 'alchemist-batch',
      shot: alchemistShot,
      history: {
        records: [alchemistShot],
        total: 1,
        detailShotId: alchemistShot.id,
        status: 'Shot saved'
      },
      contextPersistence: 'unchanged'
    }
  });

  equal(harness.state.shots[0]?.id, purpleShot.id);
  equal(harness.state.liveFinalizing, false);
  equal(harness.state.status, 'Shot saved under DAK The Alchemist');
  app.dispose();
});

await run('a delayed dose settlement merges only remaining weight into newer batch edits', () => {
  const root = new FakeElement();
  const app = new BeanieApp(root as unknown as HTMLElement);
  const harness = app as unknown as {
    state: {
      batchesByBean: Record<string, Array<{ id: string; roastLevel?: string | null; weightRemaining?: number | null }>>;
    };
    setState(next: Record<string, unknown>): void;
    adoptSettledDoseAdjustment(settlement: Record<string, unknown>): void;
  };
  harness.setState({
    batchesByBean: {
      'bean-1': [{ id: 'batch-1', roastLevel: 'dark', weightRemaining: 82 }]
    }
  });

  harness.adoptSettledDoseAdjustment({
    entry: {
      adjustment: 'deduction',
      batchId: 'batch-1',
      beanId: 'bean-1',
      dose: 18,
      expectedRemaining: 82,
      at: '2026-07-12T10:00:00.000Z'
    },
    outcome: 'committed',
    batch: {
      id: 'batch-1',
      beanId: 'bean-1',
      roastLevel: 'light',
      weightRemaining: 102
    },
    resolvedRemaining: 102,
    projectionRevision: 0
  });

  equal(harness.state.batchesByBean['bean-1']?.[0]?.roastLevel, 'dark');
  equal(harness.state.batchesByBean['bean-1']?.[0]?.weightRemaining, 102);
  app.dispose();
});

await run('volatile dose promotion rebases the optimistic scalar to first-admission metadata', () => {
  const root = new FakeElement();
  const app = new BeanieApp(root as unknown as HTMLElement);
  const harness = app as unknown as {
    state: {
      batchesByBean: Record<string, Array<{ id: string; beanId: string; weightRemaining?: number | null }>>;
    };
    setState(next: Record<string, unknown>): void;
    adoptCanonicalDoseAdjustment(canonicalization: Record<string, unknown>): void;
    beanInventory: {
      reservePendingRemainingWeight(input: Record<string, unknown>): boolean;
      retainPendingRemainingWeight(input: Record<string, unknown>): boolean;
      overlayPendingRemainingWeights(beanId: string, batches: Array<Record<string, unknown>>): Array<Record<string, unknown>>;
    };
  };
  const batch = { id: 'batch-1', beanId: 'bean-1', weightRemaining: 64 };
  harness.setState({ batchesByBean: { 'bean-1': [batch] } });
  harness.beanInventory.reservePendingRemainingWeight({
    idempotencyKey: 'dose-canonical', beanId: 'bean-1', batchId: 'batch-1', fieldRevision: 0
  });
  harness.beanInventory.retainPendingRemainingWeight({
    idempotencyKey: 'dose-canonical',
    beanId: 'bean-1',
    batchId: 'batch-1',
    expectedRemaining: 64,
    fieldRevision: 0
  });

  harness.adoptCanonicalDoseAdjustment({
    idempotencyKey: 'dose-canonical',
    entry: {
      adjustment: 'deduction',
      beanId: 'bean-1',
      batchId: 'batch-1',
      dose: 18,
      expectedRemaining: 82,
      at: '2026-07-12T10:00:00.000Z'
    },
    projectedExpectedRemaining: 64,
    projectionRevision: 0
  });

  equal(harness.state.batchesByBean['bean-1']?.[0]?.weightRemaining, 82);
  equal(
    harness.beanInventory.overlayPendingRemainingWeights('bean-1', [batch])[0]?.weightRemaining,
    82
  );
  app.dispose();
});

await run('dose journal latency cannot overwrite a newer remaining-weight intent', async () => {
  const root = new FakeElement();
  const app = new BeanieApp(root as unknown as HTMLElement);
  const bean = { id: 'bean-1', roaster: 'Test', name: 'Coffee' };
  const batch = { id: 'batch-1', beanId: bean.id, weight: 100, weightRemaining: 100 };
  let finishEnqueue!: (result: DoseMutationEnqueueResult) => void;
  const enqueueGate = new Promise<DoseMutationEnqueueResult>(
    (resolve) => { finishEnqueue = resolve; }
  );
  let revision = 0;
  let releases = 0;
  const harness = app as unknown as {
    state: {
      batchesByBean: Record<string, Array<{ id: string; weightRemaining?: number | null }>>;
    };
    inventoryReviewBeanIds: Set<string>;
    setState(next: Record<string, unknown>): void;
    consumeBatchDoseForShot(
      bean: { id: string; roaster: string; name: string },
      batchId: string,
      dose: number,
      shotId: string,
      demo: boolean
    ): Promise<void>;
    beanInventory: { remainingWeightRevision(): number };
    doseMutationReconciler: { enqueue(): Promise<Awaited<typeof enqueueGate>> };
  };
  harness.beanInventory.remainingWeightRevision = () => revision;
  harness.doseMutationReconciler.enqueue = async () => enqueueGate;
  harness.setState({ batchesByBean: { [bean.id]: [batch] } });

  const consuming = harness.consumeBatchDoseForShot(bean, batch.id, 18, 'shot-1', false);
  await flushAsync();
  revision = 1;
  harness.setState({
    batchesByBean: {
      [bean.id]: [{ ...batch, weightRemaining: 90 }]
    }
  });
  finishEnqueue({
    inserted: true,
    idempotencyKey: 'dose-1',
    settlementPending: true,
    expectedRemaining: 82,
    durability: 'indexeddb',
    releaseProjection: () => { releases += 1; }
  });
  await consuming;

  equal(harness.state.batchesByBean[bean.id]?.[0]?.weightRemaining, 90);
  equal(harness.inventoryReviewBeanIds.has(bean.id), true);
  equal(releases, 1);
  app.dispose();
});

await run('graceful disposal drains a dose admission without publishing stale cache state', async () => {
  const root = new FakeElement();
  const app = new BeanieApp(root as unknown as HTMLElement);
  const bean = { id: 'bean-1', roaster: 'Test', name: 'Coffee' };
  const batch = { id: 'batch-1', beanId: bean.id, weight: 100, weightRemaining: 100 };
  let finishEnqueue!: (result: DoseMutationEnqueueResult) => void;
  const enqueueGate = new Promise<DoseMutationEnqueueResult>(
    (resolve) => { finishEnqueue = resolve; }
  );
  let cacheWrites = 0;
  let releases = 0;
  let disposed = false;
  const harness = app as unknown as {
    setState(next: Record<string, unknown>): void;
    consumeBatchDoseForShot(
      bean: { id: string; roaster: string; name: string },
      batchId: string,
      dose: number,
      shotId: string,
      demo: boolean
    ): Promise<void>;
    beanInventory: {
      cacheProjection(): Promise<void>;
    };
    doseMutationReconciler: { enqueue(): Promise<Awaited<typeof enqueueGate>> };
  };
  harness.doseMutationReconciler.enqueue = async () => enqueueGate;
  harness.beanInventory.cacheProjection = async () => { cacheWrites += 1; };
  harness.setState({ batchesByBean: { [bean.id]: [batch] } });

  const consuming = harness.consumeBatchDoseForShot(bean, batch.id, 18, 'shot-1', false);
  await flushAsync();
  const disposing = app.disposeAsync().then(() => { disposed = true; });
  await flushAsync();
  equal(disposed, false);
  finishEnqueue({
    inserted: true,
    idempotencyKey: 'dose-1',
    settlementPending: true,
    expectedRemaining: 82,
    durability: 'indexeddb',
    releaseProjection: () => { releases += 1; }
  });
  await Promise.all([consuming, disposing]);

  equal(cacheWrites, 0);
  equal(releases, 1);
  equal(disposed, true);
});

await run('BeanieApp deletion adapter journals and projects a remote dose reclaim', async () => {
  const root = new FakeElement();
  const app = new BeanieApp(root as unknown as HTMLElement);
  const bean = { id: 'bean-1', roaster: 'Test', name: 'Coffee' };
  const batch = { id: 'batch-1', beanId: bean.id, weight: 100, weightRemaining: 82 };
  const shot = {
    id: 'shot-1',
    timestamp: '2026-07-12T10:00:00.000Z',
    workflow: { context: { beanId: bean.id, beanBatchId: batch.id } },
    annotations: { actualDoseWeight: 18 },
    measurements: []
  };
  const queued: Array<Record<string, unknown>> = [];
  const harness = app as unknown as {
    state: {
      shots: Array<{ id: string }>;
      shotsTotal: number;
      batchesByBean: Record<string, Array<{ id: string; weightRemaining?: number | null }>>;
    };
    setState(next: Record<string, unknown>): void;
    performDeleteShot(reclaim: boolean): Promise<void>;
    runExactCommand<T>(key: string, run: () => T | PromiseLike<T>): Promise<T | undefined>;
    doseMutationReconciler: {
      enqueueReclaim(input: Record<string, unknown>): Promise<DoseMutationEnqueueResult>;
    };
  };
  harness.runExactCommand = async () => undefined;
  harness.doseMutationReconciler.enqueueReclaim = async (input) => {
    queued.push(input);
    return {
      inserted: true,
      idempotencyKey: 'reclaim-1',
      settlementPending: true,
      expectedRemaining: Number(input.expectedRemaining),
      durability: 'indexeddb',
      releaseProjection: () => {}
    };
  };
  harness.setState({
    settingsLoaded: true,
    loading: false,
    startupPhase: 'connected',
    demo: false,
    beans: [bean],
    batchesByBean: { [bean.id]: [batch] },
    shots: [shot],
    shotsTotal: 1,
    detailShotId: shot.id,
    deleteShotTarget: {
      shotId: shot.id,
      reclaim: {
        intent: { beanId: bean.id, batchId: batch.id, dose: 18 },
        preview: { dose: 18, remaining: 82, next: 100 }
      }
    }
  });

  await harness.performDeleteShot(true);

  equal(queued[0]?.expectedRemaining, 100);
  equal(queued[0]?.shotId, shot.id);
  equal(harness.state.batchesByBean[bean.id]?.[0]?.weightRemaining, 100);
  equal(harness.state.shots.length, 0);
  equal(harness.state.shotsTotal, 0);
  app.dispose();
});

await run('a stale 404 row cannot create a new reclaim or double-decrement total', async () => {
  const root = new FakeElement();
  const app = new BeanieApp(root as unknown as HTMLElement);
  const bean = { id: 'bean-1', roaster: 'Test', name: 'Coffee' };
  const batch = { id: 'batch-1', beanId: bean.id, weight: 100, weightRemaining: 82 };
  const shot = {
    id: 'shot-1',
    timestamp: '2026-07-12T10:00:00.000Z',
    workflow: { context: { beanId: bean.id, beanBatchId: batch.id } },
    annotations: { actualDoseWeight: 18 },
    measurements: []
  };
  let enqueueCalls = 0;
  const harness = app as unknown as {
    state: {
      shots: Array<{ id: string }>;
      shotsTotal: number;
      status: string;
      batchesByBean: Record<string, Array<{ id: string; weightRemaining?: number | null }>>;
    };
    setState(next: Record<string, unknown>): void;
    performDeleteShot(reclaim: boolean): Promise<void>;
    runExactCommand<T>(key: string, run: () => T | PromiseLike<T>): Promise<T>;
    shotRefreshTask: { trigger(): void };
    doseMutationReconciler: {
      existingReclaim(): Promise<null>;
      enqueueReclaim(): Promise<never>;
    };
  };
  harness.runExactCommand = async () => {
    throw new GatewayRequestError({
      resource: 'shot',
      kind: 'http',
      message: 'not found',
      statusCode: 404
    });
  };
  harness.shotRefreshTask.trigger = () => {};
  harness.doseMutationReconciler.existingReclaim = async () => null;
  harness.doseMutationReconciler.enqueueReclaim = async () => {
    enqueueCalls += 1;
    throw new Error('unexpected enqueue');
  };
  harness.setState({
    settingsLoaded: true,
    loading: false,
    startupPhase: 'connected',
    demo: false,
    beans: [bean],
    batchesByBean: { [bean.id]: [batch] },
    shots: [shot],
    shotsTotal: 1,
    detailShotId: shot.id,
    deleteShotTarget: {
      shotId: shot.id,
      reclaim: {
        intent: { beanId: bean.id, batchId: batch.id, dose: 18 },
        preview: { dose: 18, remaining: 82, next: 100 }
      }
    }
  });

  await harness.performDeleteShot(true);

  equal(enqueueCalls, 0);
  equal(harness.state.batchesByBean[bean.id]?.[0]?.weightRemaining, 82);
  equal(harness.state.shots.length, 0);
  equal(harness.state.shotsTotal, 1);
  equal(harness.state.status, 'Shot already deleted · Bag unchanged');
  app.dispose();
});

await run('terminal not-applicable reclaim corrects optimistic inventory and requests refresh', () => {
  const root = new FakeElement();
  const app = new BeanieApp(root as unknown as HTMLElement);
  const batch = { id: 'batch-1', beanId: 'bean-1', weight: 100, weightRemaining: 100 };
  const harness = app as unknown as {
    state: {
      batchesByBean: Record<string, Array<{ id: string; weightRemaining?: number | null }>>;
    };
    inventoryReviewBeanIds: Set<string>;
    setState(next: Record<string, unknown>): void;
    adoptSettledDoseAdjustment(settlement: Record<string, unknown>): void;
  };
  harness.setState({
    settingsLoaded: true,
    batchesByBean: { 'bean-1': [batch] }
  });

  harness.adoptSettledDoseAdjustment({
    entry: {
      adjustment: 'reclaim',
      shotId: 'shot-1',
      beanId: 'bean-1',
      batchId: batch.id,
      dose: 18,
      expectedRemaining: 100,
      at: '2026-07-12T10:00:00.000Z'
    },
    outcome: 'not-applicable',
    batch: null,
    resolvedRemaining: null,
    projectionRevision: 0
  });

  equal(harness.state.batchesByBean['bean-1']?.[0]?.weightRemaining, null);
  equal(harness.inventoryReviewBeanIds.has('bean-1'), true);
  app.dispose();
});

await run('graceful disposal drains DELETE into the reclaim journal before closing it', async () => {
  const root = new FakeElement();
  const app = new BeanieApp(root as unknown as HTMLElement);
  const bean = { id: 'bean-1', roaster: 'Test', name: 'Coffee' };
  const batch = { id: 'batch-1', beanId: bean.id, weight: 100, weightRemaining: 82 };
  const shot = {
    id: 'shot-1',
    timestamp: '2026-07-12T10:00:00.000Z',
    workflow: { context: { beanId: bean.id, beanBatchId: batch.id } },
    annotations: { actualDoseWeight: 18 },
    measurements: []
  };
  let releaseDelete!: () => void;
  const deleteGate = new Promise<void>((resolve) => {
    releaseDelete = resolve;
  });
  let deleteStarted!: () => void;
  const deleteStart = new Promise<void>((resolve) => {
    deleteStarted = resolve;
  });
  let enqueueCalls = 0;
  let disposedAtEnqueue = true;
  const harness = app as unknown as {
    setState(next: Record<string, unknown>): void;
    performDeleteShot(reclaim: boolean): Promise<void>;
    runExactCommand<T>(key: string, run: () => T | PromiseLike<T>): Promise<T>;
    doseMutationReconciler: {
      disposed: boolean;
      enqueueReclaim(): Promise<DoseMutationEnqueueResult>;
    };
  };
  harness.runExactCommand = async <T>() => {
    deleteStarted();
    await deleteGate;
    return undefined as T;
  };
  harness.doseMutationReconciler.enqueueReclaim = async () => {
    enqueueCalls += 1;
    disposedAtEnqueue = harness.doseMutationReconciler.disposed;
    return {
      inserted: true,
      idempotencyKey: 'reclaim-1',
      settlementPending: true,
      expectedRemaining: 100,
      durability: 'indexeddb',
      releaseProjection: () => {}
    };
  };
  harness.setState({
    settingsLoaded: true,
    loading: false,
    demo: false,
    beans: [bean],
    batchesByBean: { [bean.id]: [batch] },
    shots: [shot],
    shotsTotal: 1,
    detailShotId: shot.id,
    deleteShotTarget: {
      shotId: shot.id,
      reclaim: {
        intent: { beanId: bean.id, batchId: batch.id, dose: 18 },
        preview: { dose: 18, remaining: 82, next: 100 }
      }
    }
  });

  const deleting = harness.performDeleteShot(true);
  await deleteStart;
  const disposing = app.disposeAsync();
  releaseDelete();
  await Promise.all([deleting, disposing]);

  equal(enqueueCalls, 1);
  equal(disposedAtEnqueue, false);
});

await run('a delayed demo delete cannot remove shots from the replacement live runtime', async () => {
  const root = new FakeElement();
  const app = new BeanieApp(root as unknown as HTMLElement);
  const demoShot = {
    id: 'demo-shot',
    timestamp: '2026-07-12T10:00:00.000Z',
    workflow: { context: {} },
    measurements: []
  };
  const liveShot = { ...demoShot, id: 'live-shot' };
  const workflow = { profile: { title: 'Live workflow' }, context: {} };
  let finishDelete!: (result: Record<string, unknown>) => void;
  const deleteGate = new Promise<Record<string, unknown>>((resolve) => {
    finishDelete = resolve;
  });
  const harness = app as unknown as {
    state: { shots: Array<{ id: string }>; busy: boolean };
    setState(next: Record<string, unknown>): void;
    performDeleteShot(reclaim: boolean): Promise<void>;
    commitStartupProjection(projection: Record<string, unknown>): void;
    shotDeletionFlow: { execute(): Promise<Record<string, unknown>> };
  };
  harness.shotDeletionFlow.execute = async () => deleteGate;
  harness.setState({
    settingsLoaded: true,
    demo: true,
    startupPhase: 'demo',
    shots: [demoShot],
    shotsTotal: 1,
    detailShotId: demoShot.id,
    deleteShotTarget: { shotId: demoShot.id, reclaim: null }
  });

  const deleting = harness.performDeleteShot(false);
  await flushAsync();
  harness.commitStartupProjection({
    type: 'gateway',
    authoritativeWorkflow: workflow,
    resetDemoSettings: true,
    settingsRecoveryPending: false,
    patch: {
      workflow,
      demo: false,
      startupPhase: 'offline-cache',
      gatewayLinkDown: true,
      loading: false,
      shots: [liveShot],
      shotsTotal: 1,
      detailShotId: liveShot.id
    }
  });
  finishDelete({
    type: 'deleted',
    shotId: demoShot.id,
    remote: false,
    deleteAlreadyAbsent: false,
    reclaim: null,
    status: 'Shot deleted (demo)',
    inventoryReviewBeanId: null,
    shotProjection: {
      shots: [],
      shotsTotal: 0,
      detailShotId: null,
      compareShotId: null,
      removedCurrentDetail: true
    }
  });
  await deleting;

  equal(harness.state.shots[0]?.id, liveShot.id);
  equal(harness.state.busy, false);
  app.dispose();
});

await run('an older shot refresh cannot resurrect a shot mutation', async () => {
  const root = new FakeElement();
  const app = new BeanieApp(root as unknown as HTMLElement);
  const bean = { id: 'bean-1', roaster: 'Test', name: 'Coffee' };
  const staleShot = {
    id: 'shot-deleted',
    timestamp: '2026-07-12T10:00:00.000Z',
    workflow: { context: { beanId: bean.id } },
    measurements: []
  };
  let resolvePage!: (page: { records: typeof staleShot[]; total: number }) => void;
  const pageGate = new Promise<{ records: typeof staleShot[]; total: number }>((resolve) => {
    resolvePage = resolve;
  });
  const harness = app as unknown as {
    state: { shots: Array<{ id: string }>; shotsTotal: number };
    shotCacheGeneration: number;
    setState(next: Record<string, unknown>): void;
    refreshVisibleShots(): Promise<void>;
    fetchShotPage(): Promise<{ records: typeof staleShot[]; total: number }>;
  };
  const previousVisibility = document.visibilityState;
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  harness.fetchShotPage = async () => pageGate;
  harness.setState({
    settingsLoaded: true,
    loading: false,
    startupPhase: 'connected',
    demo: false,
    view: 'workbench',
    modal: null,
    beans: [bean],
    selectedBeanId: bean.id,
    selectedBatchId: null,
    batchesByBean: { [bean.id]: [] },
    shots: [],
    shotsTotal: 0,
    liveActive: false,
    liveFinalizing: false,
    shotsLoadingMore: false
  });

  const refreshing = harness.refreshVisibleShots();
  await flushAsync();
  harness.shotCacheGeneration += 1;
  resolvePage({ records: [staleShot], total: 1 });
  await refreshing;

  equal(harness.state.shots.length, 0);
  equal(harness.state.shotsTotal, 0);
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: previousVisibility
  });
  app.dispose();
});

await run('shot refresh stays blocked through the entire DELETE workflow', async () => {
  const root = new FakeElement();
  const app = new BeanieApp(root as unknown as HTMLElement);
  const bean = { id: 'bean-1', roaster: 'Test', name: 'Coffee' };
  const staleShot = {
    id: 'shot-deleted',
    timestamp: '2026-07-12T10:00:00.000Z',
    workflow: { context: { beanId: bean.id } },
    measurements: []
  };
  let releaseDelete!: () => void;
  const deleteGate = new Promise<void>((resolve) => {
    releaseDelete = resolve;
  });
  let deleteStarted!: () => void;
  const deleteStart = new Promise<void>((resolve) => {
    deleteStarted = resolve;
  });
  let refreshCalls = 0;
  const harness = app as unknown as {
    state: { shots: Array<{ id: string }>; shotsTotal: number };
    shotCacheGeneration: number;
    setState(next: Record<string, unknown>): void;
    performDeleteShot(reclaim: boolean): Promise<void>;
    refreshVisibleShots(): Promise<void>;
    fetchShotPage(): Promise<{ records: typeof staleShot[]; total: number }>;
    runExactCommand<T>(key: string, run: () => T | PromiseLike<T>): Promise<T>;
  };
  harness.runExactCommand = async <T>() => {
    deleteStarted();
    await deleteGate;
    return undefined as T;
  };
  harness.fetchShotPage = async () => {
    refreshCalls += 1;
    return { records: [staleShot], total: 1 };
  };
  const previousVisibility = document.visibilityState;
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  harness.setState({
    settingsLoaded: true,
    loading: false,
    startupPhase: 'connected',
    demo: false,
    view: 'workbench',
    modal: 'delete-shot',
    beans: [bean],
    selectedBeanId: bean.id,
    selectedBatchId: null,
    batchesByBean: { [bean.id]: [] },
    shots: [staleShot],
    shotsTotal: 1,
    detailShotId: staleShot.id,
    liveActive: false,
    liveFinalizing: false,
    shotsLoadingMore: false,
    deleteShotTarget: { shotId: staleShot.id, reclaim: null }
  });

  const deleting = harness.performDeleteShot(false);
  await deleteStart;
  await harness.refreshVisibleShots();
  equal(refreshCalls, 0);
  const generationDuringDelete = harness.shotCacheGeneration;
  releaseDelete();
  await flushAsync();
  if (harness.shotCacheGeneration <= generationDuringDelete) {
    throw new Error('Expected the settled DELETE to fence reads started during the request');
  }
  await deleting;

  equal(harness.state.shots.length, 0);
  equal(harness.state.shotsTotal, 0);
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: previousVisibility
  });
  app.dispose();
});

await run('an ambiguous picker create retries the exact full submitted bag draft', async () => {
  const root = new FakeElement();
  const app = new BeanieApp(root as unknown as HTMLElement);
  const bean = { id: 'bean-retry', roaster: 'Test', name: 'Retry Coffee' };
  const submissions = [
    {
      beanId: bean.id,
      roastDate: '2026-01-02',
      roastLevel: 'Ultra light',
      weight: 333,
      weightRemaining: 321
    },
    {
      beanId: bean.id,
      roastDate: null,
      roastLevel: null,
      weight: null,
      weightRemaining: null
    }
  ];
  const calls: Array<{ batch: Record<string, unknown> }> = [];
  const harness = app as unknown as {
    state: { beanPickerDraftBatch: Record<string, unknown> | null };
    inventoryJournalReady: boolean;
    beanInventory: {
      createBatch(request: { beanId: string; batch: Record<string, unknown> }): Promise<unknown>;
    };
    setState(next: Record<string, unknown>): void;
    submitBeanPickerBatch(form: HTMLFormElement): Promise<void>;
  };
  harness.inventoryJournalReady = true;
  harness.beanInventory.createBatch = async (request) => {
    calls.push({ batch: { ...request.batch } });
    if (calls.length % 2 === 1) {
      return {
        type: 'reconciliation-required',
        phase: 'create',
        candidates: [],
        projection: { beanId: bean.id, batches: [], shouldScheduleApply: false },
        status: 'Stock may have been added - review stock',
        error: new Error('response lost')
      };
    }
    const batch = { id: `batch-recovered-${calls.length}`, ...request.batch, beanId: bean.id };
    return {
      type: 'created',
      batch,
      projection: { beanId: bean.id, batches: [batch], shouldScheduleApply: false },
      recovered: true,
      status: 'Batch added (response recovered)'
    };
  };
  const nativeFormData = globalThis.FormData;
  globalThis.FormData = FakeFormData as unknown as typeof FormData;
  try {
    for (const submitted of submissions) {
      const callOffset = calls.length;
      harness.setState({
        settingsLoaded: true,
        loading: false,
        demo: false,
        startupPhase: 'connected',
        modal: 'bean-picker',
        beanPickerBeanId: bean.id,
        beanPickerMode: 'inspect',
        beanPickerDraftBatchBeanId: bean.id,
        beanPickerDraftBatch: null,
        busy: false,
        beans: [bean],
        batchesByBean: { [bean.id]: [] }
      });
      const firstForm = new FakeFormElement(
        { beanId: bean.id },
        {
          roastDate: submitted.roastDate ?? '',
          roastLevel: submitted.roastLevel ?? '',
          weight: submitted.weight == null ? '' : String(submitted.weight),
          weightRemaining: submitted.weightRemaining == null ? '' : String(submitted.weightRemaining)
        }
      );
      await harness.submitBeanPickerBatch(firstForm as unknown as HTMLFormElement);

      equal(calls.length, callOffset + 1);
      equal(JSON.stringify(calls[callOffset]?.batch), JSON.stringify(submitted));
      equal(JSON.stringify(harness.state.beanPickerDraftBatch), JSON.stringify(submitted));

      const restoredValues = {
        roastDate: renderedInputValue(root.innerHTML, 'roastDate'),
        roastLevel: renderedInputValue(root.innerHTML, 'roastLevel'),
        weight: renderedInputValue(root.innerHTML, 'weight'),
        weightRemaining: renderedInputValue(root.innerHTML, 'weightRemaining')
      };
      const retryForm = new FakeFormElement({ beanId: bean.id }, restoredValues);
      await harness.submitBeanPickerBatch(retryForm as unknown as HTMLFormElement);

      equal(calls.length, callOffset + 2);
      equal(JSON.stringify(calls[callOffset + 1]?.batch), JSON.stringify(submitted));
      equal(harness.state.beanPickerDraftBatch, null);
    }
  } finally {
    globalThis.FormData = nativeFormData;
    app.dispose();
  }
});

await run('startup projection synchronizes machine workflow authority before state commit', () => {
  const root = new FakeElement();
  const app = new BeanieApp(root as unknown as HTMLElement);
  const nextWorkflow = {
    profile: { title: 'Startup authority' },
    context: { beanId: 'bean-startup', targetDoseWeight: 18 }
  };
  const harness = app as unknown as {
    setState(next: Record<string, unknown>): void;
    commitStartupProjection(projection: Record<string, unknown>): void;
    machineWorkflowCommands: {
      snapshot: { desired: unknown };
    };
  };
  const originalSetState = harness.setState.bind(app);
  let desiredAtCommit: unknown = null;
  harness.setState = (next) => {
    desiredAtCommit = harness.machineWorkflowCommands.snapshot.desired;
    originalSetState(next);
  };

  harness.commitStartupProjection({
    type: 'cached',
    authoritativeWorkflow: nextWorkflow,
    patch: { workflow: nextWorkflow }
  });

  equal(desiredAtCommit, nextWorkflow);
  app.dispose();
});

await run('offline demo recovery clears write authority and stale destructive intent', async () => {
  const root = new FakeElement();
  const app = new BeanieApp(root as unknown as HTMLElement);
  const workflow = { profile: { title: 'Cached workflow' }, context: {} };
  const harness = app as unknown as {
    state: {
      settingsLoaded: boolean;
      settingsStoreAvailable: boolean;
      deleteShotTarget: unknown;
    };
    setState(next: Record<string, unknown>): void;
    commitStartupProjection(projection: Record<string, unknown>): void;
    performDeleteShot(reclaim: boolean): Promise<void>;
    runExactCommand<T>(key: string, run: () => T | PromiseLike<T>): Promise<T>;
  };
  let deleteCalls = 0;
  harness.runExactCommand = async <T>() => {
    deleteCalls += 1;
    return undefined as T;
  };
  harness.setState({
    settingsLoaded: true,
    settingsStoreAvailable: true,
    demo: true,
    settingsSource: 'demo',
    modal: 'delete-shot',
    deleteShotTarget: { shotId: 'demo-shot', reclaim: null }
  });

  harness.commitStartupProjection({
    type: 'gateway',
    authoritativeWorkflow: workflow,
    resetDemoSettings: true,
    patch: { workflow, demo: false, startupPhase: 'offline-cache' }
  });

  equal(harness.state.settingsLoaded, true);
  equal(harness.state.settingsStoreAvailable, false);
  equal(harness.state.deleteShotTarget, null);
  await harness.performDeleteShot(false);
  equal(deleteCalls, 0);
  app.dispose();
});

await run('live demo recovery gates settings and revokes simulated runtime provenance', () => {
  const root = new FakeElement();
  const app = new BeanieApp(root as unknown as HTMLElement);
  const workflow = { profile: { title: 'Live workflow' }, context: {} };
  const harness = app as unknown as {
    state: {
      settingsLoaded: boolean;
      settingsStoreAvailable: boolean;
      startupPhase: string;
      view: string;
      liveActive: boolean;
      liveFinalizing: boolean;
      scale: unknown;
    };
    simTimer: number | null;
    cleaningInProgress: boolean;
    setState(next: Record<string, unknown>): void;
    startSimulatedShot(): void;
    commitStartupProjection(projection: Record<string, unknown>): void;
  };
  harness.setState({
    settingsLoaded: true,
    settingsStoreAvailable: true,
    demo: true,
    startupPhase: 'demo',
    view: 'profile-editor',
    liveActive: true,
    liveFinalizing: true,
    scale: { status: 'connected', weight: 18 },
    waterLevel: 42
  });
  harness.cleaningInProgress = true;
  harness.startSimulatedShot();
  equal(harness.simTimer == null, false);

  harness.commitStartupProjection({
    type: 'gateway',
    authoritativeWorkflow: workflow,
    resetDemoSettings: true,
    settingsRecoveryPending: true,
    patch: {
      workflow,
      demo: false,
      startupPhase: 'retrying',
      gatewayLinkDown: false,
      loading: true,
      status: 'Refreshing settings from Decent.app…'
    }
  });

  equal(harness.state.settingsLoaded, false);
  equal(harness.state.settingsStoreAvailable, false);
  equal(harness.state.startupPhase, 'retrying');
  equal(harness.state.view, 'workbench');
  equal(harness.state.liveActive, false);
  equal(harness.state.liveFinalizing, false);
  equal(harness.state.scale, null);
  equal(harness.cleaningInProgress, false);
  equal(harness.simTimer, null);

  harness.commitStartupProjection({
    type: 'retained-fallback',
    releaseSettingsGate: true,
    patch: {
      loading: false,
      startupPhase: 'offline-cache',
      gatewayLinkDown: true,
      status: 'Offline — showing cached data · retrying automatically'
    }
  });
  equal(harness.state.settingsLoaded, true);
  equal(harness.state.settingsStoreAvailable, false);
  equal(harness.state.startupPhase, 'offline-cache');
  app.dispose();
});

await run('startup effect adapter keeps offline and limited plans read-only', () => {
  const root = new FakeElement();
  const app = new BeanieApp(root as unknown as HTMLElement);
  const calls: string[] = [];
  const harness = app as unknown as {
    applyStartupEffects(plan: { type: string }): void;
    startLiveStreams(): void;
    clearAutomaticWriteTimers(): void;
    shotRefreshTask: { start(): void; stop(): void };
    beanRefreshTask: { start(): void; stop(): void };
    startupRetryTask: { start(): void };
    refreshBeanUsage(): Promise<void>;
    noteUserActivity(): void;
    enforceGatewayTrackingMode(): Promise<void>;
    loadMachineControlState(): Promise<void>;
    migrateStorageEventsOnce(): Promise<void>;
  };
  harness.startLiveStreams = () => { calls.push('streams'); };
  harness.shotRefreshTask.start = () => { calls.push('shots'); };
  harness.shotRefreshTask.stop = () => { calls.push('shots-stop'); };
  harness.beanRefreshTask.start = () => { calls.push('beans'); };
  harness.beanRefreshTask.stop = () => { calls.push('beans-stop'); };
  harness.clearAutomaticWriteTimers = () => { calls.push('write-timers-stop'); };
  harness.startupRetryTask.start = () => { calls.push('retry'); };
  harness.refreshBeanUsage = async () => { calls.push('usage'); };
  harness.noteUserActivity = () => { calls.push('heartbeat'); };
  harness.enforceGatewayTrackingMode = async () => { calls.push('tracking-write'); };
  harness.loadMachineControlState = async () => { calls.push('machine-settings'); };
  harness.migrateStorageEventsOnce = async () => { calls.push('migration-write'); };

  harness.applyStartupEffects({ type: 'offline' });
  equal(JSON.stringify(calls), JSON.stringify([
    'shots-stop', 'beans-stop', 'write-timers-stop', 'streams', 'retry'
  ]));
  calls.length = 0;
  harness.applyStartupEffects({ type: 'limited' });
  equal(JSON.stringify(calls), JSON.stringify([
    'write-timers-stop', 'streams', 'shots', 'beans', 'retry'
  ]));

  app.dispose();
});

await run('limited bean inspection inherits no-maintenance-write authority', async () => {
  const root = new FakeElement();
  const app = new BeanieApp(root as unknown as HTMLElement);
  const bean = { id: 'bean-limited', roaster: 'Test', name: 'Limited' };
  let allowMaintenanceWrites: boolean | null = null;
  const harness = app as unknown as {
    setState(next: Record<string, unknown>): void;
    selectBean(
      beanId: string,
      options: { apply: boolean; preferWorkflow: boolean }
    ): Promise<void>;
    loadBatches(bean: unknown, allow: boolean): Promise<unknown[]>;
    loadFirstShots(): Promise<{ records: unknown[]; total: number }>;
  };
  harness.loadBatches = async (_bean, allow) => {
    allowMaintenanceWrites = allow;
    return [];
  };
  harness.loadFirstShots = async () => ({ records: [], total: 0 });
  harness.setState({
    settingsLoaded: true,
    startupPhase: 'limited',
    demo: false,
    beans: [bean],
    profiles: [],
    grinders: [],
    batchesByBean: {},
    workflow: { profile: { title: 'Limited' }, context: { beanId: bean.id } }
  });

  await harness.selectBean(bean.id, { apply: false, preferWorkflow: true });

  equal(allowMaintenanceWrites, false);
  app.dispose();
});

await run('a delayed batch read preserves a newer inventory projection in memory', async () => {
  const root = new FakeElement();
  const app = new BeanieApp(root as unknown as HTMLElement);
  const bean = { id: 'bean-1', roaster: 'Test', name: 'Coffee' };
  const oldBatch = { id: 'batch-1', beanId: bean.id, weightRemaining: 100 };
  const newBatch = { ...oldBatch, weightRemaining: 80 };
  let finishRead!: () => void;
  const readGate = new Promise<void>((resolve) => { finishRead = resolve; });
  const nativeFetch = globalThis.fetch;
  const harness = app as unknown as {
    setState(next: Record<string, unknown>): void;
    loadBatches(
      bean: { id: string; roaster: string; name: string },
      allowMaintenanceWrites: boolean
    ): Promise<typeof oldBatch[]>;
    beanInventory: {
      cacheProjection(projection: Record<string, unknown>): Promise<void>;
    };
  };
  globalThis.fetch = (async (input: unknown) => {
    if (String(input).includes('/api/v1/beans/bean-1/batches')) {
      await readGate;
      return { ok: true, status: 200, json: async () => [oldBatch] } as Response;
    }
    return nativeFetch(input as RequestInfo | URL);
  }) as typeof fetch;
  try {
    harness.setState({
      demo: false,
      startupPhase: 'connected',
      gatewayLinkDown: false,
      beans: [bean],
      batchesByBean: { [bean.id]: [oldBatch] }
    });
    const loading = harness.loadBatches(bean, false);
    await flushAsync();
    harness.setState({ batchesByBean: { [bean.id]: [newBatch] } });
    await harness.beanInventory.cacheProjection({
      beanId: bean.id,
      batches: [newBatch],
      shouldScheduleApply: false
    });
    finishRead();
    const loaded = await loading;

    equal(loaded[0]?.weightRemaining, 80);
  } finally {
    globalThis.fetch = nativeFetch;
    app.dispose();
  }
});

await run('a delayed batch cache merge cannot publish after runtime disposal', async () => {
  const root = new FakeElement();
  const app = new BeanieApp(root as unknown as HTMLElement);
  const bean = { id: 'bean-dispose', roaster: 'Test', name: 'Coffee' };
  const batch = { id: 'batch-dispose', beanId: bean.id, weightRemaining: 100 };
  let releaseCacheRead!: () => void;
  const cacheReadGate = new Promise<void>((resolve) => { releaseCacheRead = resolve; });
  let cacheReadStarted = false;
  let cacheWrites = 0;
  const nativeFetch = globalThis.fetch;
  const nativeGetBatches = beanieCache.getBeanBatches.bind(beanieCache);
  const nativePutBatches = beanieCache.putBeanBatches.bind(beanieCache);
  const harness = app as unknown as {
    setState(next: Record<string, unknown>): void;
    loadBatches(
      selectedBean: { id: string; roaster: string; name: string },
      allowMaintenanceWrites: boolean
    ): Promise<typeof batch[]>;
  };
  globalThis.fetch = (async (input: unknown) => {
    if (String(input).includes(`/api/v1/beans/${bean.id}/batches`)) {
      return { ok: true, status: 200, json: async () => [batch] } as Response;
    }
    return nativeFetch(input as RequestInfo | URL);
  }) as typeof fetch;
  beanieCache.getBeanBatches = async () => {
    cacheReadStarted = true;
    await cacheReadGate;
    return [batch];
  };
  beanieCache.putBeanBatches = async () => { cacheWrites += 1; };
  try {
    harness.setState({
      demo: false,
      startupPhase: 'connected',
      gatewayLinkDown: false,
      beans: [bean],
      batchesByBean: { [bean.id]: [batch] }
    });
    const loading = harness.loadBatches(bean, false);
    for (let attempt = 0; attempt < 10 && !cacheReadStarted; attempt += 1) await flushAsync();
    equal(cacheReadStarted, true);
    const disposing = app.disposeAsync();
    releaseCacheRead();
    await Promise.all([loading, disposing]);

    equal(cacheWrites, 0);
  } finally {
    globalThis.fetch = nativeFetch;
    beanieCache.getBeanBatches = nativeGetBatches;
    beanieCache.putBeanBatches = nativePutBatches;
  }
});

await run('delayed shot reads cannot write cache after runtime disposal', async () => {
  const root = new FakeElement();
  const app = new BeanieApp(root as unknown as HTMLElement);
  const bean = { id: 'bean-shot-dispose', roaster: 'Test', name: 'Coffee' };
  const shot = {
    id: 'shot-dispose',
    timestamp: '2026-07-12T10:00:00.000Z',
    workflow: { context: { beanId: bean.id } },
    measurements: []
  };
  let releasePage!: () => void;
  const pageGate = new Promise<void>((resolve) => { releasePage = resolve; });
  let pageStarted = false;
  let cacheWrites = 0;
  const nativeFetch = globalThis.fetch;
  const nativePutPage = beanieCache.putShotPage.bind(beanieCache);
  const nativePutRecord = beanieCache.putShotRecord.bind(beanieCache);
  const harness = app as unknown as {
    setState(next: Record<string, unknown>): void;
    fetchShotPage(
      selectedBean: { id: string; roaster: string; name: string },
      batch: null,
      offset: number
    ): Promise<unknown>;
  };
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    if (url.includes('/api/v1/shots?')) {
      pageStarted = true;
      await pageGate;
      return {
        ok: true,
        status: 200,
        json: async () => ({ items: [shot], total: 1, limit: 12, offset: 0 })
      } as Response;
    }
    if (url.includes(`/api/v1/shots/${shot.id}`)) {
      return { ok: true, status: 200, json: async () => shot } as Response;
    }
    return nativeFetch(input as RequestInfo | URL);
  }) as typeof fetch;
  beanieCache.putShotPage = async () => { cacheWrites += 1; };
  beanieCache.putShotRecord = async () => { cacheWrites += 1; };
  try {
    harness.setState({ demo: false, startupPhase: 'connected', gatewayLinkDown: false });
    const loading = harness.fetchShotPage(bean, null, 0);
    for (let attempt = 0; attempt < 10 && !pageStarted; attempt += 1) await flushAsync();
    equal(pageStarted, true);
    const disposing = app.disposeAsync();
    releasePage();
    await Promise.all([loading, disposing]);

    equal(cacheWrites, 0);
  } finally {
    globalThis.fetch = nativeFetch;
    beanieCache.putShotPage = nativePutPage;
    beanieCache.putShotRecord = nativePutRecord;
  }
});

await run('shot loading cannot settle an older batch scalar over a newer projection', async () => {
  const root = new FakeElement();
  const app = new BeanieApp(root as unknown as HTMLElement);
  const bean = { id: 'bean-1', roaster: 'Test', name: 'Coffee' };
  const oldBatch = { id: 'batch-1', beanId: bean.id, weightRemaining: 100 };
  const newBatch = { ...oldBatch, weightRemaining: 80 };
  let finishShots!: () => void;
  const shotsGate = new Promise<void>((resolve) => { finishShots = resolve; });
  const harness = app as unknown as {
    state: {
      batchesByBean: Record<string, Array<{ id: string; weightRemaining?: number | null }>>;
    };
    setState(next: Record<string, unknown>): void;
    selectBean(id: string, options: { apply: false; preferWorkflow: true }): Promise<void>;
    loadBatches(): Promise<typeof oldBatch[]>;
    loadFirstShots(): Promise<{ records: unknown[]; total: number }>;
    beanInventory: { cacheProjection(projection: Record<string, unknown>): Promise<void> };
  };
  harness.loadBatches = async () => [oldBatch];
  harness.loadFirstShots = async () => {
    await shotsGate;
    return { records: [], total: 0 };
  };
  harness.setState({
    settingsLoaded: true,
    demo: false,
    startupPhase: 'connected',
    gatewayLinkDown: false,
    beans: [bean],
    profiles: [],
    grinders: [],
    batchesByBean: { [bean.id]: [oldBatch] },
    workflow: { profile: { title: 'Test' }, context: { beanId: bean.id, beanBatchId: oldBatch.id } }
  });

  const selecting = harness.selectBean(bean.id, { apply: false, preferWorkflow: true });
  await flushAsync();
  harness.setState({ batchesByBean: { [bean.id]: [newBatch] } });
  await harness.beanInventory.cacheProjection({
    beanId: bean.id,
    batches: [newBatch],
    shouldScheduleApply: false
  });
  finishShots();
  await selecting;

  equal(harness.state.batchesByBean[bean.id]?.[0]?.weightRemaining, 80);
  app.dispose();
});

await run('a bag change during shot loading restarts selection with matching shot provenance', async () => {
  const root = new FakeElement();
  const app = new BeanieApp(root as unknown as HTMLElement);
  const bean = { id: 'bean-1', roaster: 'Test', name: 'Coffee' };
  const oldBatch = {
    id: 'batch-old',
    beanId: bean.id,
    roastDate: '2026-07-10',
    weightRemaining: 100
  };
  const nextBatch = {
    id: 'batch-next',
    beanId: bean.id,
    roastDate: '2026-07-01',
    weightRemaining: 100
  };
  let finishFirstShots!: () => void;
  const firstShotsGate = new Promise<void>((resolve) => { finishFirstShots = resolve; });
  const loadedShotBatches: Array<string | null> = [];
  const harness = app as unknown as {
    state: { selectedBatchId: string | null };
    setState(next: Record<string, unknown>): void;
    selectBean(id: string, options: { apply: false; preferWorkflow: true }): Promise<void>;
    loadBatches(): Promise<Array<typeof oldBatch>>;
    loadFirstShots(_bean: unknown, batch: { id: string } | null): Promise<{ records: unknown[]; total: number }>;
    beanInventory: { cacheProjection(projection: Record<string, unknown>): Promise<void> };
  };
  harness.loadBatches = async () => [oldBatch, nextBatch];
  harness.loadFirstShots = async (_bean, batch) => {
    loadedShotBatches.push(batch?.id ?? null);
    if (loadedShotBatches.length === 1) await firstShotsGate;
    return { records: [], total: 0 };
  };
  harness.setState({
    settingsLoaded: true,
    demo: false,
    startupPhase: 'connected',
    gatewayLinkDown: false,
    beans: [bean],
    profiles: [],
    grinders: [],
    batchesByBean: { [bean.id]: [oldBatch, nextBatch] },
    workflow: { profile: { title: 'Test' }, context: { beanId: bean.id, beanBatchId: oldBatch.id } }
  });

  const selecting = harness.selectBean(bean.id, { apply: false, preferWorkflow: true });
  await flushAsync();
  await harness.beanInventory.cacheProjection({
    beanId: bean.id,
    batches: [{ ...oldBatch, weightRemaining: 0 }, nextBatch],
    selectedBatchId: nextBatch.id,
    shouldScheduleApply: false
  });
  finishFirstShots();
  await selecting;

  equal(loadedShotBatches.join(','), `${oldBatch.id},${nextBatch.id}`);
  equal(harness.state.selectedBatchId, nextBatch.id);
  app.dispose();
});

await run('finishing the last bag preserves automatic selection mode and shot provenance', async () => {
  const root = new FakeElement();
  const app = new BeanieApp(root as unknown as HTMLElement);
  const bean = { id: 'bean-1', roaster: 'Test', name: 'Coffee' };
  const batch = {
    id: 'batch-only',
    beanId: bean.id,
    roastDate: '2026-07-10',
    weightRemaining: 100
  };
  let finishShots!: () => void;
  const shotsGate = new Promise<void>((resolve) => { finishShots = resolve; });
  const loadedShotBatches: Array<string | null> = [];
  const harness = app as unknown as {
    state: { selectedBatchId: string | null };
    setState(next: Record<string, unknown>): void;
    selectBean(id: string, options: { apply: false; preferWorkflow: true }): Promise<void>;
    loadBatches(): Promise<Array<typeof batch>>;
    loadFirstShots(_bean: unknown, selected: { id: string } | null): Promise<{ records: unknown[]; total: number }>;
    beanInventory: { cacheProjection(projection: Record<string, unknown>): Promise<void> };
  };
  harness.loadBatches = async () => [batch];
  harness.loadFirstShots = async (_bean, selected) => {
    loadedShotBatches.push(selected?.id ?? null);
    await shotsGate;
    return { records: [], total: 0 };
  };
  harness.setState({
    settingsLoaded: true,
    demo: false,
    startupPhase: 'connected',
    gatewayLinkDown: false,
    beans: [bean],
    profiles: [],
    grinders: [],
    batchesByBean: { [bean.id]: [batch] },
    workflow: { profile: { title: 'Test' }, context: { beanId: bean.id, beanBatchId: batch.id } }
  });

  const selecting = harness.selectBean(bean.id, { apply: false, preferWorkflow: true });
  await flushAsync();
  await harness.beanInventory.cacheProjection({
    beanId: bean.id,
    batches: [{ ...batch, weightRemaining: 0 }],
    selectedBatchId: null,
    shouldScheduleApply: false
  });
  finishShots();
  await selecting;

  equal(loadedShotBatches.join(','), batch.id);
  equal(harness.state.selectedBatchId, null);
  app.dispose();
});

await run('an earlier capped settlement cannot overwrite a later pending scalar', () => {
  const root = new FakeElement();
  const app = new BeanieApp(root as unknown as HTMLElement);
  const batch = { id: 'batch-1', beanId: 'bean-1', weight: 100, weightRemaining: 100 };
  const harness = app as unknown as {
    state: { batchesByBean: Record<string, Array<{ weightRemaining: number }>> };
    setState(next: Record<string, unknown>): void;
    adoptSettledDoseAdjustment(settlement: Record<string, unknown>): void;
    beanInventory: {
      reservePendingRemainingWeight(reservation: Record<string, unknown>): void;
      retainPendingRemainingWeight(adjustment: Record<string, unknown>): void;
    };
  };
  harness.setState({ batchesByBean: { 'bean-1': [batch] } });
  for (const idempotencyKey of ['dose-1', 'dose-2']) {
    harness.beanInventory.reservePendingRemainingWeight({
      idempotencyKey,
      beanId: 'bean-1',
      batchId: batch.id,
      fieldRevision: 0
    });
    harness.beanInventory.retainPendingRemainingWeight({
      idempotencyKey,
      beanId: 'bean-1',
      batchId: batch.id,
      expectedRemaining: 100,
      fieldRevision: 0
    });
  }
  const entry = {
    adjustment: 'reclaim',
    beanId: 'bean-1',
    batchId: batch.id,
    dose: 18,
    expectedRemaining: 100,
    at: '2026-07-12T10:00:00.000Z'
  };

  harness.adoptSettledDoseAdjustment({
    idempotencyKey: 'dose-1',
    entry,
    outcome: 'committed',
    resolvedRemaining: 98,
    projectionRevision: 0
  });
  equal(harness.state.batchesByBean['bean-1']?.[0]?.weightRemaining, 100);
  harness.adoptSettledDoseAdjustment({
    idempotencyKey: 'dose-2',
    entry,
    outcome: 'committed',
    resolvedRemaining: 100,
    projectionRevision: 0
  });
  equal(harness.state.batchesByBean['bean-1']?.[0]?.weightRemaining, 100);
  app.dispose();
});

await run('connected startup effect adapter activates the normal live owners in order', () => {
  const root = new FakeElement();
  const app = new BeanieApp(root as unknown as HTMLElement);
  const calls: string[] = [];
  const harness = app as unknown as {
    setState(next: Record<string, unknown>): void;
    applyStartupEffects(plan: { type: string; beans: unknown[]; machine: null }): void;
    startLiveStreams(): void;
    shotRefreshTask: { start(): void };
    beanRefreshTask: { start(): void };
    startupRetryTask: { stop(): void };
    refreshBeanUsage(beans: unknown[]): Promise<void>;
    noteUserActivity(): void;
    enforceGatewayTrackingMode(): Promise<void>;
    loadMachineControlState(): Promise<void>;
    migrateStorageEventsOnce(): Promise<void>;
  };
  harness.refreshBeanUsage = async () => { calls.push('usage'); };
  harness.noteUserActivity = () => { calls.push('heartbeat'); };
  harness.enforceGatewayTrackingMode = async () => { calls.push('tracking'); };
  harness.loadMachineControlState = async () => { calls.push('machine-settings'); };
  harness.startLiveStreams = () => { calls.push('streams'); };
  harness.shotRefreshTask.start = () => { calls.push('shots'); };
  harness.beanRefreshTask.start = () => { calls.push('beans'); };
  harness.startupRetryTask.stop = () => { calls.push('retry-stop'); };
  harness.migrateStorageEventsOnce = async () => { calls.push('migration'); };
  harness.setState({ startupPhase: 'connected', gatewayLinkDown: false, demo: false });

  harness.applyStartupEffects({ type: 'connected', beans: [], machine: null });

  equal(
    JSON.stringify(calls),
    JSON.stringify([
      'usage',
      'heartbeat',
      'tracking',
      'machine-settings',
      'streams',
      'shots',
      'beans',
      'retry-stop',
      'migration'
    ])
  );
  app.dispose();
});

await run('a stale connected effect plan converges to retry-only ownership', () => {
  const root = new FakeElement();
  const app = new BeanieApp(root as unknown as HTMLElement);
  const calls: string[] = [];
  const harness = app as unknown as {
    setState(next: Record<string, unknown>): void;
    applyStartupEffects(plan: { type: string; beans: unknown[]; machine: null }): void;
    clearAutomaticWriteTimers(): void;
    shotRefreshTask: { stop(): void };
    beanRefreshTask: { stop(): void };
    startupRetryTask: { start(): void };
    noteUserActivity(): void;
  };
  harness.shotRefreshTask.stop = () => { calls.push('shots-stop'); };
  harness.beanRefreshTask.stop = () => { calls.push('beans-stop'); };
  harness.clearAutomaticWriteTimers = () => { calls.push('write-timers-stop'); };
  harness.startupRetryTask.start = () => { calls.push('retry'); };
  harness.noteUserActivity = () => { calls.push('unexpected-heartbeat'); };
  harness.setState({ startupPhase: 'offline-cache', gatewayLinkDown: true, demo: false });

  harness.applyStartupEffects({ type: 'connected', beans: [], machine: null });

  equal(JSON.stringify(calls), JSON.stringify([
    'shots-stop', 'beans-stop', 'write-timers-stop', 'retry'
  ]));
  app.dispose();
});

await run('a rejected settings gate is not memoized across startup retries', async () => {
  const root = new FakeElement();
  const app = new BeanieApp(root as unknown as HTMLElement);
  let attempts = 0;
  const harness = app as unknown as {
    loadSettings(): Promise<void>;
    runLoadSettings(): Promise<void>;
  };
  harness.runLoadSettings = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('unexpected settings rejection');
  };

  let rejected = false;
  try {
    await harness.loadSettings();
  } catch {
    rejected = true;
  }
  equal(rejected, true);
  await harness.loadSettings();
  equal(attempts, 2);

  app.dispose();
});

await run('demo recovery forces an authoritative settings-store reload', async () => {
  const root = new FakeElement();
  const app = new BeanieApp(root as unknown as HTMLElement);
  let reloadCalls = 0;
  const harness = app as unknown as {
    state: { settingsLoaded: boolean; settingsStoreAvailable: boolean };
    settingsRecoveryRequired: boolean;
    recoverSettingsFromDemo(): Promise<void>;
    settingsStoreSync: {
      discardAndReload(): Promise<{ type: 'reloaded'; changedKeys: string[] }>;
    };
  };
  harness.settingsRecoveryRequired = true;
  harness.settingsStoreSync.discardAndReload = async () => {
    reloadCalls += 1;
    return { type: 'reloaded', changedKeys: ['last-bean-id'] };
  };

  await harness.recoverSettingsFromDemo();

  equal(reloadCalls, 1);
  equal(harness.state.settingsLoaded, true);
  equal(harness.state.settingsStoreAvailable, true);
  equal(harness.settingsRecoveryRequired, false);
  app.dispose();
});

await run('offline demo replacement restores the pre-demo settings cache generation', () => {
  const originalCache = captureSyncedCache();
  clearSyncedCache();
  setSyncedItem(uiScaleKey, 'compact');
  setSyncedItem(favoriteBeansKey, JSON.stringify(['real-favorite']));
  const root = new FakeElement();
  const app = new BeanieApp(root as unknown as HTMLElement);
  const workflow = { profile: { title: 'Cached workflow' }, context: {} };
  const harness = app as unknown as {
    state: {
      settingsPreferences: { uiScale: string };
      favoriteBeans: string[];
    };
    setState(next: Record<string, unknown>): void;
    applyLoadedSettings(available: boolean): void;
    loadDemo(): void;
    updateSettingsPreferences(next: Record<string, unknown>): void;
    commitStartupProjection(projection: Record<string, unknown>): void;
  };
  try {
    harness.applyLoadedSettings(false);
    harness.loadDemo();
    harness.updateSettingsPreferences({ uiScale: 'large' });
    setSyncedItem(favoriteBeansKey, JSON.stringify(['demo-favorite']));
    harness.setState({ favoriteBeans: ['demo-favorite'] });

    harness.commitStartupProjection({
      type: 'gateway',
      authoritativeWorkflow: workflow,
      resetDemoSettings: true,
      settingsRecoveryPending: false,
      patch: {
        workflow,
        beans: [],
        grinders: [],
        profiles: [],
        machineInfo: null,
        machine: null,
        asleep: false,
        demo: false,
        startupPhase: 'offline-cache',
        gatewayLinkDown: true,
        loading: false,
        status: 'Offline — showing cached data while reconnecting'
      }
    });

    equal(harness.state.settingsPreferences.uiScale, 'compact');
    equal(harness.state.favoriteBeans.join(','), 'real-favorite');
    equal(getSyncedItem(uiScaleKey), 'compact');
    equal(getSyncedItem(favoriteBeansKey), JSON.stringify(['real-favorite']));
  } finally {
    app.dispose();
    restoreSyncedCache(originalCache);
  }
});

await run('socket demotion fences an in-flight forced settings reload', async () => {
  const root = new FakeElement();
  const app = new BeanieApp(root as unknown as HTMLElement);
  let finishReload!: (result: { type: 'reloaded'; changedKeys: string[] }) => void;
  const reloadGate = new Promise<{ type: 'reloaded'; changedKeys: string[] }>((resolve) => {
    finishReload = resolve;
  });
  let canCommit: (() => boolean) | null = null;
  const harness = app as unknown as {
    state: { settingsLoaded: boolean; settingsStoreAvailable: boolean };
    settingsRecoveryRequired: boolean;
    startupAuthorityRevision: number;
    setState(next: Record<string, unknown>): void;
    recoverSettingsFromDemo(): Promise<void>;
    settingsStoreSync: {
      discardAndReload(fence: () => boolean): Promise<{ type: 'reloaded'; changedKeys: string[] }>;
    };
  };
  harness.settingsRecoveryRequired = true;
  harness.setState({
    settingsLoaded: false,
    settingsStoreAvailable: false,
    gatewayLinkDown: false,
    startupPhase: 'retrying',
    demo: false
  });
  harness.settingsStoreSync.discardAndReload = async (fence) => {
    canCommit = fence;
    return reloadGate;
  };

  const recovering = harness.recoverSettingsFromDemo();
  await flushAsync();
  harness.startupAuthorityRevision += 1;
  harness.setState({ gatewayLinkDown: true, startupPhase: 'offline-cache' });
  equal((canCommit as unknown as () => boolean)(), false);
  finishReload({ type: 'reloaded', changedKeys: [] });
  await recovering;

  equal(harness.settingsRecoveryRequired, true);
  equal(harness.state.settingsLoaded, false);
  equal(harness.state.settingsStoreAvailable, false);
  app.dispose();
});

await run('a stale demo settings bundle cannot settle after live recovery', async () => {
  const root = new FakeElement();
  const app = new BeanieApp(root as unknown as HTMLElement);
  let finishLoad!: (result: {
    bundle: ReturnType<typeof demoSettingsBundle>;
    source: 'demo';
    resources: Record<string, unknown>;
    status: null;
  }) => void;
  const loadGate = new Promise<{
    bundle: ReturnType<typeof demoSettingsBundle>;
    source: 'demo';
    resources: Record<string, unknown>;
    status: null;
  }>((resolve) => {
    finishLoad = resolve;
  });
  const workflow = { profile: { title: 'Live workflow' }, context: {} };
  const harness = app as unknown as {
    state: { settingsBundle: unknown; settingsSource: unknown };
    setState(next: Record<string, unknown>): void;
    loadReaSettings(): Promise<void>;
    commitStartupProjection(projection: Record<string, unknown>): void;
    settingsController: { loadSettingsBundle(): Promise<unknown> };
  };
  harness.settingsController.loadSettingsBundle = async () => loadGate;
  harness.setState({ demo: true, settingsBundle: null, settingsSource: null });

  const loading = harness.loadReaSettings();
  await flushAsync();
  harness.commitStartupProjection({
    type: 'gateway',
    authoritativeWorkflow: workflow,
    resetDemoSettings: true,
    patch: { workflow, demo: false, startupPhase: 'connected' }
  });
  finishLoad({
    bundle: demoSettingsBundle(),
    source: 'demo',
    resources: {},
    status: null
  });
  await loading;

  equal(harness.state.settingsBundle, null);
  equal(harness.state.settingsSource, null);
  app.dispose();
});

await run('BeanieApp plugin save adapter preserves draft intent created while saving', async () => {
  const root = new FakeElement();
  const app = new BeanieApp(root as unknown as HTMLElement);
  let finishSave!: (result: { status: string; ok: boolean }) => void;
  const saveGate = new Promise<{ status: string; ok: boolean }>((resolve) => {
    finishSave = resolve;
  });
  const harness = app as unknown as {
    state: {
      pluginConfig: {
        draft: Record<string, string | number | boolean>;
        settings: { values: Record<string, string | number | boolean> };
        dirty: boolean;
        saving: boolean;
      } | null;
    };
    setState(next: Record<string, unknown>): void;
    makePluginConfig(id: string, settings: {
      values: Record<string, string | number | boolean>;
      secretsSet: Record<string, boolean>;
    }): unknown;
    updatePluginField(key: string, value: string | boolean): void;
    savePluginConfig(id: string): Promise<void>;
    settingsController: {
      savePluginSettings(input: unknown): Promise<{ status: string; ok: boolean }>;
    };
  };
  harness.settingsController.savePluginSettings = async () => saveGate;
  harness.setState({
    demo: true,
    settingsSource: 'demo',
    pluginConfig: harness.makePluginConfig('visualizer', {
      values: { Username: 'old@example.com', AutoUpload: false },
      secretsSet: { Password: true }
    })
  });
  harness.updatePluginField('Username', 'submitted@example.com');

  const saving = harness.savePluginConfig('visualizer');
  await flushAsync();
  equal(harness.state.pluginConfig?.saving, true);
  harness.updatePluginField('Username', 'newer@example.com');
  finishSave({ status: 'Plugin settings saved (demo)', ok: true });
  await saving;

  equal(harness.state.pluginConfig?.draft.Username, 'newer@example.com');
  equal(harness.state.pluginConfig?.settings.values.Username, 'submitted@example.com');
  equal(harness.state.pluginConfig?.dirty, true);
  equal(harness.state.pluginConfig?.saving, false);
  app.dispose();
});

await run('plugin config loading is latest-session-wins', async () => {
  const root = new FakeElement();
  const app = new BeanieApp(root as unknown as HTMLElement);
  const resolvers: Array<(result: {
    settings: { values: Record<string, string | number | boolean>; secretsSet: Record<string, boolean> };
    source: 'demo';
  }) => void> = [];
  const harness = app as unknown as {
    state: { pluginConfig: { settings: { values: Record<string, unknown> } } | null };
    setState(next: Record<string, unknown>): void;
    togglePluginConfig(id: string): Promise<void>;
    settingsController: {
      loadPluginSettings(): Promise<{
        settings: { values: Record<string, string | number | boolean>; secretsSet: Record<string, boolean> };
        source: 'demo';
      }>;
    };
  };
  harness.settingsController.loadPluginSettings = () => new Promise((resolve) => {
    resolvers.push(resolve);
  });
  harness.setState({ demo: true, settingsSource: 'demo' });

  const first = harness.togglePluginConfig('visualizer.reaplugin');
  const second = harness.togglePluginConfig('visualizer.reaplugin');
  resolvers[1]!({
    settings: { values: { Username: 'second@example.com' }, secretsSet: {} },
    source: 'demo'
  });
  await second;
  resolvers[0]!({
    settings: { values: { Username: 'first@example.com' }, secretsSet: {} },
    source: 'demo'
  });
  await first;

  equal(harness.state.pluginConfig?.settings.values.Username, 'second@example.com');
  app.dispose();
});

await run('remote plugin config reads share the exact save lane', async () => {
  const root = new FakeElement();
  const app = new BeanieApp(root as unknown as HTMLElement);
  const laneKeys: string[] = [];
  const harness = app as unknown as {
    state: { pluginConfig: unknown };
    setState(next: Record<string, unknown>): void;
    togglePluginConfig(id: string): Promise<void>;
    runExactCommand<T>(key: string, run: () => T | PromiseLike<T>): Promise<T>;
  };
  harness.runExactCommand = async <T>(key: string) => {
    laneKeys.push(key);
    return {
      values: { Username: 'lane@example.com', Password: 'transient-secret' },
      secretsSet: {}
    } as T;
  };
  harness.setState({
    demo: false,
    startupPhase: 'connected',
    gatewayLinkDown: false,
    settingsSource: 'gateway',
    settingsResources: {
      plugins: { source: 'gateway', writable: true, message: null }
    }
  });

  await harness.togglePluginConfig('visualizer.reaplugin');

  equal(JSON.stringify(laneKeys), JSON.stringify(['plugin:visualizer.reaplugin']));
  equal(harness.state.pluginConfig == null, false);
  app.dispose();
});

await run('settings resources and queued writes lose capability on gateway demotion', async () => {
  const root = new FakeElement();
  const app = new BeanieApp(root as unknown as HTMLElement);
  let releaseLane!: () => void;
  const laneGate = new Promise<void>((resolve) => { releaseLane = resolve; });
  let fetchCalls = 0;
  const nativeFetch = globalThis.fetch;
  const harness = app as unknown as {
    setState(next: Record<string, unknown>): void;
    settingsResourceWritable(resource: string): boolean;
    effectiveSettingsResourceStates(): Record<string, { writable: boolean }>;
    gatewayMutations: {
      exact<T>(key: string, run: () => Promise<T>): Promise<unknown>;
    };
    settingsController: {
      savePluginSettings(input: {
        local: false;
        id: string;
        payload: Record<string, string>;
      }): Promise<unknown>;
    };
  };
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error('queued setting transport should not dispatch after demotion');
  }) as typeof fetch;
  try {
    harness.setState({
      demo: false,
      startupPhase: 'connected',
      gatewayLinkDown: false,
      settingsSource: 'gateway',
      settingsResources: {
        plugins: { source: 'gateway', writable: true, message: null }
      }
    });
    equal(harness.settingsResourceWritable('plugins'), true);

    const blocker = harness.gatewayMutations.exact('plugin:test.reaplugin', async () => {
      await laneGate;
    });
    await flushAsync();
    const saving = harness.settingsController.savePluginSettings({
      local: false,
      id: 'test.reaplugin',
      payload: { Username: 'test@example.com' }
    });
    await flushAsync();
    harness.setState({
      startupPhase: 'offline-cache',
      gatewayLinkDown: true
    });
    equal(harness.settingsResourceWritable('plugins'), false);
    equal(harness.effectiveSettingsResourceStates().plugins?.writable, false);

    releaseLane();
    await blocker;
    await saving;
    equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = nativeFetch;
    app.dispose();
  }
});

await run('plugin verification cannot settle over a newer draft revision', async () => {
  const root = new FakeElement();
  const app = new BeanieApp(root as unknown as HTMLElement);
  let finishVerify!: (result: { tone: 'good'; message: string }) => void;
  const verifyGate = new Promise<{ tone: 'good'; message: string }>((resolve) => {
    finishVerify = resolve;
  });
  const harness = app as unknown as {
    state: {
      pluginConfig: {
        verify: { tone: string; message: string } | null;
        revision: number;
      } | null;
    };
    setState(next: Record<string, unknown>): void;
    makePluginConfig(id: string, settings: {
      values: Record<string, string | number | boolean>;
      secretsSet: Record<string, boolean>;
    }): unknown;
    updatePluginField(key: string, value: string | boolean): void;
    verifyPluginConfig(id: string): Promise<void>;
    settingsController: {
      verifyPluginSettings(): Promise<{ tone: 'good'; message: string }>;
    };
  };
  harness.settingsController.verifyPluginSettings = async () => verifyGate;
  harness.setState({
    demo: true,
    settingsSource: 'demo',
    pluginConfig: harness.makePluginConfig('visualizer', {
      values: { Username: 'old@example.com' },
      secretsSet: { Password: true }
    })
  });

  const verifying = harness.verifyPluginConfig('visualizer');
  await flushAsync();
  harness.updatePluginField('Username', 'new@example.com');
  finishVerify({ tone: 'good', message: 'Verified.' });
  await verifying;

  equal(harness.state.pluginConfig?.revision, 1);
  equal(harness.state.pluginConfig?.verify, null);
  app.dispose();
});

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

function includes(text: string, expected: string): void {
  if (!text.includes(expected)) {
    throw new Error(`Expected ${JSON.stringify(text.slice(0, 200))} to include ${expected}`);
  }
}

function renderedInputValue(html: string, name: string): string {
  const match = html.match(new RegExp(`<input[^>]*name="${name}"[^>]*value="([^"]*)"`));
  if (!match) throw new Error(`Expected rendered input ${name}`);
  return match[1]!;
}

function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
