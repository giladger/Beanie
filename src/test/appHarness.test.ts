type Listener = (event: Event) => void | Promise<void>;

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
const { demoSettingsBundle } = await import('../domain/settingsModel');

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

await run('a delayed dose settlement merges only remaining weight into newer batch edits', () => {
  const root = new FakeElement();
  const app = new BeanieApp(root as unknown as HTMLElement);
  const harness = app as unknown as {
    state: {
      batchesByBean: Record<string, Array<{ id: string; roastLevel?: string | null; weightRemaining?: number | null }>>;
    };
    setState(next: Record<string, unknown>): void;
    adoptFlushedBatch(
      saved: { id: string; beanId: string; roastLevel?: string | null; weightRemaining?: number | null },
      expectedRemaining: number,
      resolvedRemaining: number,
      projectionRevision: number | null
    ): void;
  };
  harness.setState({
    batchesByBean: {
      'bean-1': [{ id: 'batch-1', roastLevel: 'dark', weightRemaining: 82 }]
    }
  });

  harness.adoptFlushedBatch({
    id: 'batch-1',
    beanId: 'bean-1',
    roastLevel: 'light'
  }, 82, 102, 0);

  equal(harness.state.batchesByBean['bean-1']?.[0]?.roastLevel, 'dark');
  equal(harness.state.batchesByBean['bean-1']?.[0]?.weightRemaining, 102);
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
    beanInventory: {
      createBatch(request: { beanId: string; batch: Record<string, unknown> }): Promise<unknown>;
    };
    setState(next: Record<string, unknown>): void;
    submitBeanPickerBatch(form: HTMLFormElement): Promise<void>;
  };
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
