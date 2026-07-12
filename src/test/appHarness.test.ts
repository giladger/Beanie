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
      run: () => T | PromiseLike<T>,
      options?: { allowOfflineStop?: boolean }
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

  let stopRuns = 0;
  await harness.runExactMachineCommand(() => { stopRuns += 1; }, { allowOfflineStop: true });
  equal(stopRuns, 1);
  app.dispose();
});

await run('staging an edited recipe immediately revokes the older apply lease', () => {
  const root = new FakeElement();
  const app = new BeanieApp(root as unknown as HTMLElement);
  const harness = app as unknown as {
    setState(next: Record<string, unknown>): void;
    scheduleApply(): void;
    applyAuthority: {
      begin(subjectKey: string): { signal: AbortSignal; isCurrent: boolean };
      currentSubjectKey: string | null;
    };
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
  const olderApply = harness.applyAuthority.begin('recipe:old-fingerprint');

  harness.scheduleApply();

  // No timer tick or promise turn is needed: revocation happens while staging.
  equal(olderApply.signal.aborted, true);
  equal(olderApply.isCurrent, false);
  equal(harness.applyAuthority.currentSubjectKey, null);
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

function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
