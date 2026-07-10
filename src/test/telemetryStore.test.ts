import type { MachineSnapshot, ScaleSnapshot } from '../api/types';
import {
  TelemetryStore,
  type AnyTelemetryFrame,
  type WaterLevelSnapshot
} from '../telemetry/telemetryStore';

run('telemetry store keeps independently revisioned latest snapshots', () => {
  const store = new TelemetryStore({ now: () => 999 });
  const initial = store.snapshot;
  equal(initial.revision, 0);
  equal(initial.revisions.machine, 0);
  equal(initial.revisions.scale, 0);
  equal(initial.machine, null);
  equal(Object.isFrozen(initial), true);

  const firstMachine = machine('idle');
  const machineFrame = store.ingest('machine', firstMachine, 100);
  equal(machineFrame?.channelRevision, 1);
  equal(store.snapshot.revision, 1);
  equal(store.snapshot.revisions.machine, 1);
  equal(store.snapshot.revisions.scale, 0);
  equal(store.snapshot.machine, firstMachine);
  equal(store.snapshot.observedAtMs.machine, 100);

  const scaleFrame = store.ingest('scale', scale(12.3), 110);
  equal(scaleFrame?.channelRevision, 1);
  equal(store.snapshot.revision, 2);
  equal(store.snapshot.revisions.machine, 1);
  equal(store.snapshot.revisions.scale, 1);
  equal(store.snapshot.machine, firstMachine);
  equal(store.snapshot.scale?.weight, 12.3);

  // Repeating the same normalized frame is still an observation: recording
  // gets it and the source revision advances.
  store.ingest('machine', firstMachine, 120);
  equal(store.snapshot.revision, 3);
  equal(store.snapshot.revisions.machine, 2);
  equal(store.snapshot.observedAtMs.machine, 120);
});

run('raw telemetry listeners receive every frame in arrival order', () => {
  const store = new TelemetryStore();
  const seen: string[] = [];
  const unsubscribe = store.subscribeRaw((frame) => {
    seen.push(`${frame.revision}:${frame.channel}:${frame.channelRevision}`);
  });
  const value = machine('espresso');
  store.ingest('machine', value, 1);
  store.ingest('machine', value, 2);
  store.ingest('scale', scale(1), 3);
  unsubscribe();
  store.ingest('scale', scale(2), 4);

  deepEqual(seen, ['1:machine:1', '2:machine:2', '3:scale:1']);
});

run('typed channel subscriptions are isolated and can replay current state', () => {
  const store = new TelemetryStore();
  const water: WaterLevelSnapshot = { currentLevelMm: 50, refillLevelMm: 20 };
  store.ingest('water', water, 10);
  const seen: string[] = [];
  const unsubscribe = store.subscribeChannel(
    'water',
    (frame) => seen.push(`${frame.value.currentLevelMm}:${frame.channelRevision}`),
    { emitCurrent: true }
  );

  store.ingest('machine', machine('idle'), 11);
  store.ingest('water', { currentLevelMm: 49.5, refillLevelMm: 20 }, 12);
  unsubscribe();
  store.ingest('water', { currentLevelMm: 49, refillLevelMm: 20 }, 13);

  deepEqual(seen, ['50:1', '49.5:2']);
});

run('selector subscriptions gate presentation-equal frames', () => {
  const store = new TelemetryStore();
  const seen: Array<string | null> = [];
  const unsubscribe = store.subscribe(
    (snapshot) => snapshot.machine?.state.state ?? null,
    (value) => seen.push(value),
    { emitCurrent: true }
  );

  store.ingest('machine', machine('idle'), 1);
  store.ingest('machine', machine('idle'), 2);
  store.ingest('scale', scale(3), 3);
  store.ingest('machine', machine('sleeping'), 4);
  unsubscribe();
  store.ingest('machine', machine('espresso'), 5);

  deepEqual(seen, [null, 'idle', 'sleeping']);
  equal(store.snapshot.revisions.machine, 4);
});

run('one failing telemetry listener does not block other owners', () => {
  const errors: unknown[] = [];
  const store = new TelemetryStore({ onListenerError: (error) => errors.push(error) });
  const seen: AnyTelemetryFrame[] = [];
  store.subscribeRaw(() => {
    throw new Error('listener failed');
  });
  store.subscribeRaw((frame) => seen.push(frame));
  store.ingest('scale', scale(4), 1);

  equal(errors.length, 1);
  equal(seen.length, 1);
});

run('disposing telemetry store is idempotent and rejects late frames', () => {
  const store = new TelemetryStore();
  let calls = 0;
  store.subscribeRaw(() => {
    calls += 1;
  });
  store.ingest('machine', machine('idle'), 1);
  const before = store.snapshot;
  store.dispose();
  store.dispose();
  const late = store.ingest('machine', machine('sleeping'), 2);

  equal(calls, 1);
  equal(late, null);
  equal(store.snapshot, before);
  equal(store.isDisposed, true);
});

function machine(state: MachineSnapshot['state']['state']): MachineSnapshot {
  return {
    timestamp: '2026-07-10T10:00:00.000Z',
    state: { state },
    flow: 0,
    pressure: 0,
    targetFlow: 0,
    targetPressure: 0,
    mixTemperature: 90,
    groupTemperature: 90,
    targetMixTemperature: 90,
    targetGroupTemperature: 90,
    profileFrame: 0,
    steamTemperature: 120
  };
}

function scale(weight: number): ScaleSnapshot {
  return {
    timestamp: '2026-07-10T10:00:00.000Z',
    weight,
    weightFlow: 0,
    status: 'connected'
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

function deepEqual(actual: unknown, expected: unknown): void {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`Expected ${right}, received ${left}`);
}
