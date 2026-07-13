import {
  ScreensaverIsland,
  type ScreensaverHost,
  type ScreensaverResources,
  type ScreensaverSnapshot,
  type ScreensaverTimer
} from '../render/screensaverIsland';

class FakeTimer implements ScreensaverTimer {
  private nowMs = 0;
  private nextId = 1;
  private readonly tasks = new Map<number, { due: number; callback: () => void }>();

  schedule(callback: () => void, delayMs: number): unknown {
    const id = this.nextId++;
    this.tasks.set(id, { due: this.nowMs + delayMs, callback });
    return id;
  }

  cancel(handle: unknown): void {
    if (typeof handle === 'number') this.tasks.delete(handle);
  }

  advance(ms: number): void {
    this.nowMs += ms;
    for (const [id, task] of [...this.tasks]) {
      if (task.due > this.nowMs) continue;
      this.tasks.delete(id);
      task.callback();
    }
  }
}

class FakeClassList {
  private readonly names = new Set<string>();
  writes = 0;

  contains(name: string): boolean {
    return this.names.has(name);
  }

  toggle(name: string, force?: boolean): boolean {
    const next = force ?? !this.names.has(name);
    if (next === this.names.has(name)) return next;
    if (next) this.names.add(name);
    else this.names.delete(name);
    this.writes += 1;
    return next;
  }

  seed(name: string): void {
    this.names.add(name);
  }
}

class FakeElement {
  readonly classList = new FakeClassList();
  readonly style = { left: '', top: '' };
  textWrites = 0;
  private text = '';
  private readonly ids = new Map<string, FakeElement>();

  get textContent(): string {
    return this.text;
  }

  set textContent(value: string) {
    this.text = value;
    this.textWrites += 1;
  }

  setId(id: string, value: FakeElement): void {
    this.ids.set(id, value);
  }

  querySelector(selector: string): FakeElement | null {
    return selector.startsWith('#') ? (this.ids.get(selector.slice(1)) ?? null) : null;
  }
}

class FakeImage extends FakeElement {
  onload: (() => void) | null = null;
  private readonly attributes = new Map<string, string>();

  get src(): string {
    return this.attributes.get('src') ?? '';
  }

  set src(value: string) {
    this.attributes.set('src', value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
}

function createIsland(
  timer: ScreensaverTimer,
  initial: Partial<ScreensaverSnapshot> = {},
  resourceOverrides: Partial<ScreensaverResources> = {}
): {
  island: ScreensaverIsland;
  snapshot: ScreensaverSnapshot & { status?: string };
} {
  const snapshot: ScreensaverSnapshot & { status?: string } = {
    demo: false,
    asleep: true,
    appAwake: false,
    saverPreview: false,
    wakeZonePreview: null,
    screensaverPhotos: [],
    screensaverMode: 'photos-clock',
    screensaverBrightness: 25,
    sleepOverlay: {
      showOverlay: true,
      showWakeAppZone: false,
      zonePosition: 'top'
    },
    ...initial
  };
  const host: ScreensaverHost = {
    snapshot: () => snapshot,
    patch: (patch) => Object.assign(snapshot, patch),
    hasConnectedAuthority: () => true,
    machineIsSleeping: () => snapshot.asleep,
    clockLabel: () => '14:05'
  };
  const resources: ScreensaverResources = {
    loadPhotos: async () => [],
    storePhotos: async () => {},
    deletePhotos: async () => {},
    transcode: async () => ({
      mime: 'image/jpeg',
      dataUrl: 'photo',
      width: 1,
      height: 1,
      pixels: 1
    }),
    setBrightness: async () => true,
    readRequestedBrightness: async () => 100,
    refreshDisplayState: async () => {},
    ...resourceOverrides
  };
  return { island: new ScreensaverIsland(host, resources, timer), snapshot };
}

await run('screensaver island gates clocks and releases faded image resources', () => {
  const timer = new FakeTimer();
  const { island } = createIsland(timer, { screensaverPhotos: ['first-photo'] });
  const root = new FakeElement();
  const topClock = new FakeElement();
  const saverClock = new FakeElement();
  const photoA = new FakeImage();
  const photoB = new FakeImage();
  photoA.classList.seed('active');
  photoA.src = 'first-photo';
  root.setId('top-clock', topClock);
  root.setId('saver-clock', saverClock);
  root.setId('saver-photo-a', photoA);
  root.setId('saver-photo-b', photoB);

  island.bind(root as unknown as HTMLElement);
  island.updateClock('14:05', { leftPct: 23, topPct: 42 });
  island.setClockOnPhoto(true);
  const clockWrites = topClock.textWrites + saverClock.textWrites + saverClock.classList.writes;
  island.updateClock('14:05', { leftPct: 23, topPct: 42 });
  island.setClockOnPhoto(true);
  equal(topClock.textWrites + saverClock.textWrites + saverClock.classList.writes, clockWrites);

  equal(island.advancePhoto('second-photo'), true);
  equal(photoB.src, 'second-photo');
  photoB.onload?.();
  equal(photoB.classList.contains('active'), true);
  equal(photoA.classList.contains('active'), false);
  timer.advance(1499);
  equal(photoA.src, 'first-photo');
  timer.advance(1);
  equal(photoA.hasAttribute('src'), false);

  island.dispose();
  equal(photoB.hasAttribute('src'), false);
});

await run('screensaver island reconciles a changed single-photo model on surviving nodes', () => {
  const { island } = createIsland(new FakeTimer(), { screensaverPhotos: ['old-photo'] });
  const root = new FakeElement();
  const photoA = new FakeImage();
  const photoB = new FakeImage();
  photoA.classList.seed('active');
  photoA.src = 'old-photo';
  root.setId('saver-photo-a', photoA);
  root.setId('saver-photo-b', photoB);
  island.bind(root as unknown as HTMLElement);

  equal(island.syncPhoto('new-photo'), true);
  equal(photoA.src, 'new-photo');
  equal(photoB.hasAttribute('src'), false);
  island.dispose();
});

await run('screensaver island renders the complete sleep surface and owns wake-zone preview expiry', () => {
  const timer = new FakeTimer();
  const { island, snapshot } = createIsland(timer, {
    screensaverPhotos: ['data:image/jpeg;base64,a&b'],
    sleepOverlay: {
      showOverlay: true,
      showWakeAppZone: true,
      zonePosition: 'right'
    }
  });

  const sleeping = island.renderOverlay();
  includes(sleeping, 'data-action="wake"');
  includes(sleeping, 'sleep-wake-app-zone-right');
  includes(sleeping, 'data:image/jpeg;base64,a&amp;b');
  includes(sleeping, '>14:05</span>');

  island.previewWakeZone('left');
  equal(snapshot.wakeZonePreview, 'left');
  includes(island.renderOverlay(), 'sleep-wake-app-zone-left wake-zone-preview');
  timer.advance(2000);
  equal(snapshot.wakeZonePreview, null);
  island.dispose();
});

await run('screensaver island imports photos through its narrow native-resource and cache ports', async () => {
  const stored: string[][] = [];
  const { island, snapshot } = createIsland(
    new FakeTimer(),
    { screensaverPhotos: ['old'] },
    {
      transcode: async (_file, options) => {
        equal(options.maxEdge, 1600);
        equal(options.mimeType, 'image/jpeg');
        return {
          mime: 'image/jpeg',
          dataUrl: 'new',
          width: 10,
          height: 10,
          pixels: 100
        };
      },
      storePhotos: async (photos) => {
        stored.push([...photos]);
      }
    }
  );

  await island.addPhotos([{ type: 'image/jpeg', name: 'new.jpg' } as File]);
  equal(stored.length, 1);
  equal(stored[0]?.join(','), 'old,new');
  equal(snapshot.screensaverPhotos.join(','), 'old,new');
  equal(snapshot.status, '2 screensaver photos stored');
  island.dispose();
});

await run('screensaver island owns sleep dim and delayed wake brightness restoration', async () => {
  const timer = new FakeTimer();
  const brightnessWrites: number[] = [];
  const { island, snapshot } = createIsland(
    timer,
    {
      asleep: true,
      screensaverMode: 'clock',
      screensaverBrightness: 30
    },
    {
      setBrightness: async (brightness) => {
        brightnessWrites.push(brightness);
        return true;
      },
      readRequestedBrightness: async () => 30
    }
  );

  island.scheduleSleepDim(1000);
  timer.advance(1000);
  await flushPromises();
  equal(brightnessWrites.join(','), '30');

  Object.assign(snapshot, { asleep: false });
  island.observeSleepState(false);
  timer.advance(1500);
  await flushPromises();
  equal(brightnessWrites.join(','), '30,100');
  island.dispose();
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

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function equal<T>(actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  }
}

function includes(value: string, expected: string): void {
  if (!value.includes(expected)) {
    throw new Error(`Expected ${JSON.stringify(value)} to include ${JSON.stringify(expected)}`);
  }
}
