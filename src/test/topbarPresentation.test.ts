import {
  TopbarProjector,
  topbarViewModelsEqual,
  type TopbarPresentationInput
} from '../render/topbarPresentation';

run('topbar projector emits complete atomic stat view models', () => {
  const projector = new TopbarProjector();
  const model = projector.project(input({
    status: { label: 'Ready', tone: 'ready' },
    groupTemperatureC: 92.4,
    steamTemperatureC: 120.4,
    waterLevelMm: 50,
    waterAlert: 'soft',
    scale: { status: 'connected', weight: 18.24, batteryLevel: 0.12 }
  }));

  deepEqual(model.machine, {
    text: 'Ready',
    className: 'top-stat stat-tone-ready',
    title: '',
    ariaLabel: 'Status: Ready'
  });
  deepEqual(model.group, {
    text: '92°C',
    className: 'top-stat',
    title: '',
    ariaLabel: 'Group: 92°C'
  });
  deepEqual(model.steam, {
    text: '120°C',
    className: 'top-stat',
    title: '',
    ariaLabel: 'Steam: 120°C'
  });
  deepEqual(model.water, {
    text: '1450 ml',
    className: 'top-stat top-stat-button stat-warn',
    title: 'Water level alert settings',
    ariaLabel: 'Water: 1450 ml. Water level alert settings'
  });
  deepEqual(model.scale, {
    text: '18.2 g · 12%',
    className: 'top-stat top-stat-button top-stat-divide stat-warn',
    title: 'Tare scale · battery 12%',
    ariaLabel: 'Scale: 18.2 g · 12%. Tare scale · battery 12%'
  });
});

run('water hysteresis rejects 49.9999/50.0001 mm lookup-boundary noise', () => {
  const projector = new TopbarProjector();
  const first = projector.project(input({ waterLevelMm: 49.9999 }));
  equal(first.water.text, '1420 ml');

  for (let index = 0; index < 1_000; index += 1) {
    const raw = index % 2 === 0 ? 50.0001 : 49.9999;
    const noisy = projector.project(input({ waterLevelMm: raw }));
    equal(noisy.water.text, '1420 ml');
    equal(noisy, first);
  }
});

run('water hysteresis accepts cumulative meaningful source movement', () => {
  const projector = new TopbarProjector();
  const first = projector.project(input({ waterLevelMm: 49.9999 }));

  equal(projector.project(input({ waterLevelMm: 50.1 })).water.text, '1420 ml');
  equal(projector.project(input({ waterLevelMm: 50.3 })).water.text, '1420 ml');
  equal(projector.project(input({ waterLevelMm: 50.4998 })).water.text, '1420 ml');

  const moved = projector.project(input({ waterLevelMm: 50.5 }));
  equal(moved.water.text, '1450 ml');
  notEqual(moved, first);
});

run('temperature hysteresis is anchored to accepted raw Celsius values', () => {
  const projector = new TopbarProjector();
  const first = projector.project(input({
    groupTemperatureC: 92.49,
    steamTemperatureC: 36
  }));
  equal(first.group.text, '92°C');
  equal(first.steam.text, '36°C');

  const noisy = projector.project(input({
    groupTemperatureC: 92.51,
    steamTemperatureC: 39.9
  }));
  equal(noisy.group.text, '92°C');
  equal(noisy.steam.text, '36°C');

  const moved = projector.project(input({
    groupTemperatureC: 93.7,
    steamTemperatureC: 40
  }));
  equal(moved.group.text, '94°C');
  equal(moved.steam.text, '40°C');
});

run('unknown and recovered sensor transitions are immediate', () => {
  const projector = new TopbarProjector();
  projector.project(input({
    groupTemperatureC: 92,
    steamTemperatureC: 120,
    waterLevelMm: 50
  }));

  const unknown = projector.project(input({
    groupTemperatureC: null,
    steamTemperatureC: Number.NaN,
    waterLevelMm: null
  }));
  equal(unknown.group.text, '--');
  equal(unknown.steam.text, '--');
  equal(unknown.water.text, '--');

  const stillUnknown = projector.project(input({
    groupTemperatureC: null,
    steamTemperatureC: null,
    waterLevelMm: null
  }));
  equal(stillUnknown, unknown);

  const recovered = projector.project(input({
    groupTemperatureC: 92.1,
    steamTemperatureC: 120.1,
    waterLevelMm: 50.1
  }));
  equal(recovered.group.text, '92°C');
  equal(recovered.steam.text, '120°C');
  equal(recovered.water.text, '1450 ml');
});

run('scale connection battery metadata and presentation update together', () => {
  const projector = new TopbarProjector();
  const disconnected = projector.project(input({
    scale: { status: 'disconnected', weight: 18.2, batteryLevel: 12 }
  }));
  equal(disconnected.scale.text, 'Connect');
  equal(disconnected.scale.className, 'top-stat top-stat-button top-stat-divide');
  equal(disconnected.scale.title, 'Search for preferred scale · battery 12%');
  equal(
    disconnected.scale.ariaLabel,
    'Scale: Connect. Search for preferred scale · battery 12%'
  );

  const connected = projector.project(input({
    scale: { status: 'connected', weight: 18.2, batteryLevel: 12 }
  }));
  equal(connected.scale.text, '18.2 g · 12%');
  equal(
    connected.scale.className,
    'top-stat top-stat-button top-stat-divide stat-warn'
  );
  equal(connected.scale.title, 'Tare scale · battery 12%');

  const healthy = projector.project(input({
    scale: { status: 'connected', weight: 18.2, batteryLevel: 85 }
  }));
  equal(healthy.scale.text, '18.2 g');
  equal(healthy.scale.className, 'top-stat top-stat-button top-stat-divide');
  equal(healthy.scale.title, 'Tare scale · battery 85%');
});

run('non-numeric stat metadata changes even while stabilized readings stay put', () => {
  const projector = new TopbarProjector();
  const ready = projector.project(input({ waterLevelMm: 49.9999 }));
  const alert = projector.project(input({
    status: { label: 'Add water', tone: 'alert' },
    waterLevelMm: 50.0001,
    waterAlert: 'hard'
  }));

  equal(alert.water.text, ready.water.text);
  equal(alert.water.className, 'top-stat top-stat-button stat-alert');
  equal(alert.machine.text, 'Add water');
  equal(alert.machine.className, 'top-stat stat-tone-alert');
  equal(topbarViewModelsEqual(ready, alert), false);
});

run('projector reuses model identity for unchanged presentation and reset clears history', () => {
  const projector = new TopbarProjector();
  const first = projector.project(input({ waterLevelMm: 49.9 }));
  const held = projector.project(input({ waterLevelMm: 50.1 }));
  equal(held, first);

  projector.reset();
  const afterReset = projector.project(input({ waterLevelMm: 50.1 }));
  equal(afterReset.water.text, '1450 ml');
  notEqual(afterReset, first);
});

run('projector validates source hysteresis thresholds', () => {
  throws(() => new TopbarProjector({ waterLevelMm: 0 }));
  throws(() => new TopbarProjector({ groupTemperatureC: Number.POSITIVE_INFINITY }));
});

function input(overrides: Partial<TopbarPresentationInput> = {}): TopbarPresentationInput {
  return {
    status: { label: 'Ready', tone: 'ready' },
    groupTemperatureC: 92,
    steamTemperatureC: 120,
    waterLevelMm: 50,
    waterAlert: 'none',
    scale: null,
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
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  }
}

function notEqual<T>(actual: T, expected: T): void {
  if (actual === expected) throw new Error('Expected values to differ');
}

function deepEqual(actual: unknown, expected: unknown): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`Expected ${expectedJson}, received ${actualJson}`);
  }
}

function throws(fn: () => unknown): void {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error('Expected function to throw');
}
