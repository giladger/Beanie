import { LiveReadouts, type LiveReadoutsModel } from '../render/livePath';

class FakeClassList {
  private readonly names = new Set<string>();
  writes = 0;

  contains(name: string): boolean {
    return this.names.has(name);
  }

  add(name: string): void {
    if (this.names.has(name)) return;
    this.names.add(name);
    this.writes += 1;
  }

  toggle(name: string, force?: boolean): boolean {
    const enabled = force ?? !this.names.has(name);
    if (enabled === this.names.has(name)) return enabled;
    if (enabled) this.names.add(name);
    else this.names.delete(name);
    this.writes += 1;
    return enabled;
  }
}

class FakeElement {
  readonly classList = new FakeClassList();
  readonly dataset: Record<string, string> = {};
  textWrites = 0;
  scrollWrites = 0;
  scrollHeight = 200;
  clientHeight = 100;
  offsetTop = 0;
  clientWidth = 0;
  private text = '';
  private html = '';
  private readonly matches = new Map<string, FakeElement[]>();

  get textContent(): string {
    return this.text;
  }

  set textContent(value: string) {
    this.text = value;
    this.textWrites += 1;
  }

  get innerHTML(): string {
    return this.html;
  }

  set innerHTML(value: string) {
    this.html = value;
  }

  setInitialText(value: string): this {
    this.text = value;
    return this;
  }

  setMatches(selector: string, values: FakeElement[]): void {
    this.matches.set(selector, values);
  }

  querySelectorAll(selector: string): FakeElement[] {
    return this.matches.get(selector) ?? [];
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  scrollTo(): void {
    this.scrollWrites += 1;
  }
}

class FakeRoot extends FakeElement {
  private readonly ids = new Map<string, FakeElement>();

  setId(id: string, value: FakeElement): void {
    this.ids.set(id, value);
  }

  override querySelector(selector: string): FakeElement | null {
    return selector.startsWith('#') ? (this.ids.get(selector.slice(1)) ?? null) : super.querySelector(selector);
  }
}

run('live readouts write only changed formatted values', () => {
  const fixture = liveFixture();
  const readouts = new LiveReadouts();
  readouts.bind(fixture.root as unknown as HTMLElement);
  const model = liveModel();

  readouts.update(model);
  const afterFirst = fixture.values.map((el) => el.textWrites);
  readouts.update(model);

  deepEqual(fixture.values.map((el) => el.textWrites), afterFirst);
  readouts.dispose();
});

run('rebinding surviving live nodes preserves stage caches and user scroll', () => {
  const fixture = liveFixture();
  const readouts = new LiveReadouts();
  let reasonReads = 0;
  const model = liveModel({
    stageReasons: () => {
      reasonReads += 1;
      return [{ text: 'weight 18g', kind: 'goal' }];
    }
  });

  readouts.bind(fixture.root as unknown as HTMLElement);
  readouts.update(model);
  const classWrites = fixture.stage.classList.writes;
  const reasonWrites = fixture.reason.textWrites;
  const scrollWrites = fixture.rail.scrollWrites;

  readouts.bind(fixture.root as unknown as HTMLElement);
  readouts.update(model);

  equal(reasonReads, 1);
  equal(fixture.stage.classList.writes, classWrites);
  equal(fixture.reason.textWrites, reasonWrites);
  equal(fixture.rail.scrollWrites, scrollWrites);
  readouts.dispose();
});

run('live stage changes patch and center the rail once', () => {
  const fixture = liveFixture();
  const second = new FakeElement();
  second.dataset.index = '1';
  second.offsetTop = 120;
  fixture.rail.setMatches('.live-stage-item', [fixture.stage, second]);
  fixture.rail.setMatches('.live-stage-item[data-index="1"]', [second]);
  const readouts = new LiveReadouts();
  readouts.bind(fixture.root as unknown as HTMLElement);

  readouts.update(liveModel({ currentStage: 0 }));
  const firstScrolls = fixture.rail.scrollWrites;
  readouts.update(liveModel({ currentStage: 1 }));
  readouts.flush();
  const secondScrolls = fixture.rail.scrollWrites;
  readouts.update(liveModel({ currentStage: 1 }));

  equal(firstScrolls, 1);
  equal(secondScrolls, 2);
  equal(fixture.rail.scrollWrites, 2);
  ok(fixture.stage.classList.contains('done'));
  ok(second.classList.contains('current'));
  readouts.dispose();
});

run('a new live session cannot inherit a throttled final frame', () => {
  const fixture = liveFixture();
  const readouts = new LiveReadouts();
  readouts.bind(fixture.root as unknown as HTMLElement);
  readouts.update(liveModel({ elapsedSeconds: 42, latest: { weight: 38, pressure: 0, flow: 0, scaledTemperature: 9 } }));
  equal(fixture.values[0]!.textContent, '42.0s');

  readouts.beginSession();
  readouts.update(liveModel({ elapsedSeconds: 0.1, latest: { weight: 0.2, pressure: 2, flow: 1, scaledTemperature: 9 } }));
  equal(fixture.values[0]!.textContent, '0.1s');
  equal(fixture.values[1]!.textContent, '0.2');
  readouts.dispose();
});

run('the live owner rebuilds stage rows when a new profile reuses the rail', () => {
  const fixture = liveFixture();
  const readouts = new LiveReadouts();
  readouts.bind(fixture.root as unknown as HTMLElement);
  readouts.update(liveModel({ stageNames: ['Old stage'] }));
  includes(fixture.rail.innerHTML, 'Old stage');

  readouts.beginSession();
  readouts.update(liveModel({ stageNames: ['New & <safe>', 'Finish'] }));
  includes(fixture.rail.innerHTML, 'New &amp; &lt;safe&gt;');
  includes(fixture.rail.innerHTML, 'data-index="1"');
  readouts.dispose();
});

function liveFixture(): {
  root: FakeRoot;
  values: FakeElement[];
  rail: FakeElement;
  stage: FakeElement;
  reason: FakeElement;
} {
  const root = new FakeRoot();
  const time = new FakeElement().setInitialText('0.0s');
  const weight = new FakeElement().setInitialText('--');
  const pressure = new FakeElement().setInitialText('--');
  const flow = new FakeElement().setInitialText('--');
  const temp = new FakeElement().setInitialText('--');
  root.setId('live-time', time);
  root.setId('live-weight', weight);
  root.setId('live-pressure', pressure);
  root.setId('live-flow', flow);
  root.setId('live-temp', temp);

  const rail = new FakeElement();
  const stage = new FakeElement();
  stage.dataset.index = '0';
  stage.offsetTop = 40;
  const reason = new FakeElement();
  reason.dataset.index = '0';
  rail.setMatches('.live-stage-item', [stage]);
  rail.setMatches('.live-stage-item[data-index="0"]', [stage]);
  rail.setMatches('.live-stage-reason', [reason]);
  root.setId('live-stage-rail', rail);
  return { root, values: [time, weight, pressure, flow, temp], rail, stage, reason };
}

function liveModel(overrides: Partial<LiveReadoutsModel> = {}): LiveReadoutsModel {
  return {
    elapsedSeconds: 1,
    latest: { weight: 10, pressure: 9, flow: 2, scaledTemperature: 9.3 },
    currentStage: 0,
    stageNames: [],
    stageMarkerCount: 1,
    stageReasons: () => [{ text: 'weight 18g', kind: 'goal' }],
    formatNumber: (value, decimals) => (value == null ? '--' : value.toFixed(decimals)),
    ...overrides
  };
}

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
  if (actual !== expected) throw new Error(`Expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`);
}

function deepEqual(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`);
  }
}

function ok(value: unknown): void {
  if (!value) throw new Error(`Expected ${JSON.stringify(value)} to be truthy`);
}

function includes(value: string, expected: string): void {
  if (!value.includes(expected)) {
    throw new Error(`Expected ${JSON.stringify(value)} to include ${JSON.stringify(expected)}`);
  }
}
