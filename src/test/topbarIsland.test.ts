import { TopbarIsland } from '../render/topbarIsland';
import { TopbarProjector } from '../render/topbarPresentation';

class FakeElement {
  parentElement: FakeElement | null = null;
  textWrites = 0;
  classWrites = 0;
  attributeWrites = 0;
  private text = '';
  private classes = '';
  private readonly attributes = new Map<string, string>();
  private readonly matches = new Map<string, FakeElement>();

  get textContent(): string {
    return this.text;
  }

  set textContent(value: string) {
    this.text = value;
    this.textWrites += 1;
  }

  get className(): string {
    return this.classes;
  }

  set className(value: string) {
    this.classes = value;
    this.classWrites += 1;
  }

  querySelector(selector: string): FakeElement | null {
    return this.matches.get(selector) ?? null;
  }

  setMatch(selector: string, element: FakeElement): void {
    this.matches.set(selector, element);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    this.attributeWrites += 1;
  }

  removeAttribute(name: string): void {
    if (this.attributes.delete(name)) this.attributeWrites += 1;
  }
}

run('topbar island commits complete stat metadata and gates repeated models', () => {
  const root = new FakeElement();
  const owner = new FakeElement();
  root.setMatch('#top-stats-island', owner);
  const stats = ['machine', 'group', 'steam', 'water', 'scale'] as const;
  const containers: FakeElement[] = [];
  const values: FakeElement[] = [];
  for (const name of stats) {
    const container = new FakeElement();
    const value = new FakeElement();
    value.parentElement = container;
    owner.setMatch(`#stat-${name}`, value);
    containers.push(container);
    values.push(value);
  }

  const island = new TopbarIsland();
  island.bind(root as unknown as HTMLElement);
  const model = new TopbarProjector().project({
    status: { label: 'Ready', tone: 'ready' },
    groupTemperatureC: 92.4,
    steamTemperatureC: 120,
    waterLevelMm: 50,
    waterAlert: 'hard',
    scale: { status: 'connected', weight: 18.24, batteryLevel: 0.12 }
  });
  island.offer(model);

  equal(values[4]!.textContent, '18.2 g · 12%');
  equal(containers[4]!.className, 'top-stat top-stat-button top-stat-divide stat-warn');
  equal(containers[4]!.getAttribute('title'), 'Tare scale · battery 12%');
  equal(
    containers[4]!.getAttribute('aria-label'),
    'Scale: 18.2 g · 12%. Tare scale · battery 12%'
  );
  equal(containers[3]!.className, 'top-stat top-stat-button stat-alert');

  const writes = writeCount(containers, values);
  island.bind(root as unknown as HTMLElement);
  island.offer(model);
  equal(writeCount(containers, values), writes);
  island.dispose();
});

run('topbar remount applies the latest offered model instead of cached state', () => {
  const first = topbarFixture();
  const island = new TopbarIsland();
  const projector = new TopbarProjector();
  island.bind(first.root as unknown as HTMLElement);
  island.offer(projector.project({
    status: { label: 'Ready', tone: 'ready' },
    groupTemperatureC: 92,
    steamTemperatureC: 120,
    waterLevelMm: 50,
    scale: null
  }));

  const second = topbarFixture();
  const current = projector.project({
    status: { label: 'Offline', tone: 'alert' },
    groupTemperatureC: 92,
    steamTemperatureC: 120,
    waterLevelMm: 50,
    scale: null
  });
  island.offer(current);
  island.bind(second.root as unknown as HTMLElement);

  equal(second.values[0]!.textContent, 'Offline');
  equal(second.containers[0]!.className, 'top-stat stat-tone-alert');
  island.dispose();
});

run('topbar suspension keeps hidden DOM silent and reconciles the latest model on resume', () => {
  const fixture = topbarFixture();
  const island = new TopbarIsland();
  const projector = new TopbarProjector();
  island.bind(fixture.root as unknown as HTMLElement);
  island.offer(projector.project({
    status: { label: 'Ready', tone: 'ready' },
    groupTemperatureC: 92,
    steamTemperatureC: 120,
    waterLevelMm: 50,
    scale: null
  }));
  const beforeSuspend = writeCount(fixture.containers, fixture.values);

  island.suspend();
  island.offer(projector.project({
    status: { label: 'Offline', tone: 'alert' },
    groupTemperatureC: 90,
    steamTemperatureC: 110,
    waterLevelMm: 48,
    scale: null
  }));
  equal(writeCount(fixture.containers, fixture.values), beforeSuspend);

  island.resume();
  equal(fixture.values[0]!.textContent, 'Offline');
  island.dispose();
});

function topbarFixture(): {
  root: FakeElement;
  containers: FakeElement[];
  values: FakeElement[];
} {
  const root = new FakeElement();
  const owner = new FakeElement();
  root.setMatch('#top-stats-island', owner);
  const containers: FakeElement[] = [];
  const values: FakeElement[] = [];
  for (const name of ['machine', 'group', 'steam', 'water', 'scale']) {
    const container = new FakeElement();
    const value = new FakeElement();
    value.parentElement = container;
    owner.setMatch(`#stat-${name}`, value);
    containers.push(container);
    values.push(value);
  }
  return { root, containers, values };
}

function writeCount(containers: FakeElement[], values: FakeElement[]): number {
  return containers.reduce(
    (sum, element, index) =>
      sum + element.classWrites + element.attributeWrites + values[index]!.textWrites,
    0
  );
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
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  }
}
