import {
  ApiValidationError,
  readBeans,
  readMachineSnapshot,
  readProfiles,
  readScaleSnapshot
} from '../api/guards';

await run('readMachineSnapshot accepts a valid frame and keeps finite numerics', () => {
  const snapshot = readMachineSnapshot({
    timestamp: '2026-06-01T10:00:00.000Z',
    state: { state: 'espresso', substate: 'pouring' },
    flow: 2.1,
    pressure: 8.6,
    targetFlow: 2,
    targetPressure: 9,
    mixTemperature: 92.5,
    groupTemperature: 91.8,
    targetMixTemperature: 93,
    targetGroupTemperature: 92,
    profileFrame: 3,
    steamTemperature: 150
  });

  equal(snapshot.timestamp, '2026-06-01T10:00:00.000Z');
  equal(snapshot.state.state, 'espresso');
  equal(snapshot.state.substate, 'pouring');
  equal(snapshot.flow, 2.1);
  equal(snapshot.pressure, 8.6);
});

await run('readMachineSnapshot rejects a frame without a machine state', () => {
  throws(() => readMachineSnapshot({ flow: 1.2, pressure: 9 }));
  throws(() => readMachineSnapshot({ state: {} }));
  throws(() => readMachineSnapshot(null));
  throws(() => readMachineSnapshot('espresso'));
});

await run('readMachineSnapshot rejects an unknown machine state', () => {
  throws(() => readMachineSnapshot({ state: { state: 'definitely-not-a-state' } }));
});

await run('readMachineSnapshot normalizes non-finite numerics to zero', () => {
  const snapshot = readMachineSnapshot({
    state: { state: 'espresso' },
    flow: null,
    pressure: 'high',
    mixTemperature: Number.NaN,
    groupTemperature: Number.POSITIVE_INFINITY
  });

  equal(snapshot.flow, 0);
  equal(snapshot.pressure, 0);
  equal(snapshot.mixTemperature, 0);
  equal(snapshot.groupTemperature, 0);
  equal(snapshot.targetFlow, 0);
});

await run('readScaleSnapshot accepts a valid frame', () => {
  const snapshot = readScaleSnapshot({
    timestamp: '2026-06-01T10:00:01.000Z',
    weight: 18.4,
    weightFlow: 1.6,
    batteryLevel: 80,
    status: 'connected'
  });

  equal(snapshot.timestamp, '2026-06-01T10:00:01.000Z');
  equal(snapshot.weight, 18.4);
  equal(snapshot.weightFlow, 1.6);
  equal(snapshot.batteryLevel, 80);
  equal(snapshot.status, 'connected');
});

await run('readScaleSnapshot rejects a malformed frame', () => {
  throws(() => readScaleSnapshot(null));
  throws(() => readScaleSnapshot('18.4'));
  throws(() => readScaleSnapshot([18.4]));
});

await run('readScaleSnapshot normalizes non-finite numerics and drops bad optionals', () => {
  const snapshot = readScaleSnapshot({
    weight: null,
    weightFlow: 'fast',
    batteryLevel: Number.NaN,
    status: 'half-connected'
  });

  equal(snapshot.weight, 0);
  equal(snapshot.weightFlow, 0);
  equal(snapshot.batteryLevel, undefined);
  equal(snapshot.status, undefined);
  equal(typeof snapshot.timestamp, 'string');
});

await run('collection readers drop invalid items and keep the valid ones', () => {
  const warnings: unknown[][] = [];
  const restoreWarn = stubWarn(warnings);
  try {
    const beans = readBeans([
      { id: 'bean-1', roaster: 'Kawa', name: 'Pink Bourbon' },
      { id: 'bean-bad', roaster: 'Kawa', name: null },
      { id: 'bean-2', roaster: 'Tsukcafe', name: 'Tore Badiya' }
    ]);

    equal(beans.length, 2);
    equal(beans[0]?.id, 'bean-1');
    equal(beans[1]?.id, 'bean-2');
    equal(warnings.length, 1);
    equal(String(warnings[0]?.[0]), '[Beanie] Dropped invalid Bean');
  } finally {
    restoreWarn();
  }
});

await run('collection readers still reject payloads that are not arrays', () => {
  throws(() => readBeans({ items: [] }));
  throws(() => readBeans(null));
  throws(() => readProfiles('profiles'));
});

await run('profile records tolerate explicit null visibility', () => {
  const warnings: unknown[][] = [];
  const restoreWarn = stubWarn(warnings);
  try {
    const profiles = readProfiles([
      { id: 'profile-1', profile: { title: 'Default' }, visibility: null }
    ]);

    equal(profiles.length, 1);
    equal(profiles[0]?.id, 'profile-1');
    equal(warnings.length, 0);
  } finally {
    restoreWarn();
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

function stubWarn(captured: unknown[][]): () => void {
  const previous = console.warn;
  console.warn = (...args: unknown[]) => {
    captured.push(args);
  };
  return () => {
    console.warn = previous;
  };
}

function equal<T>(actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  }
}

function throws(fn: () => unknown): void {
  try {
    fn();
  } catch (error) {
    if (error instanceof ApiValidationError) return;
    throw new Error(`Expected an ApiValidationError, received ${String(error)}`);
  }
  throw new Error('Expected the reader to throw');
}
