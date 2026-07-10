import {
  ScreensaverIsland,
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

run('screensaver island gates clocks and releases faded image resources', () => {
  const timer = new FakeTimer();
  const island = new ScreensaverIsland(timer);
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

run('screensaver island reconciles a changed single-photo model on surviving nodes', () => {
  const island = new ScreensaverIsland(new FakeTimer());
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

function run(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

function equal<T>(actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  }
}
