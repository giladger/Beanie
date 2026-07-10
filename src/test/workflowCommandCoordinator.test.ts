import {
  WorkflowCommandCoordinator,
  type WorkflowCommandSnapshot
} from '../runtime/workflowCommandCoordinator';

const fifo = { policy: 'exact-fifo' } as const;

await run('commands serialize per resource while independent resources run concurrently', async () => {
  const coordinator = new WorkflowCommandCoordinator<string>();
  const machineFirst = deferred<string>();
  const machineSecond = deferred<string>();
  const scale = deferred<string>();
  const starts: string[] = [];

  const first = coordinator.submit('machine', fifo, () => {
    starts.push('machine:first');
    return machineFirst.promise;
  });
  const second = coordinator.submit('machine', fifo, () => {
    starts.push('machine:second');
    return machineSecond.promise;
  });
  const independent = coordinator.submit('scale', fifo, () => {
    starts.push('scale');
    return scale.promise;
  });

  deepEqual(starts, ['machine:first', 'scale']);
  machineFirst.resolve('one');
  await settle();
  deepEqual(starts, ['machine:first', 'scale', 'machine:second']);

  machineSecond.resolve('two');
  scale.resolve('scale');
  deepEqual(await first, { status: 'completed', value: 'one' });
  deepEqual(await second, { status: 'completed', value: 'two' });
  deepEqual(await independent, { status: 'completed', value: 'scale' });
});

await run('latest-wins coalesces within FIFO barriers without reordering physical actions', async () => {
  const coordinator = new WorkflowCommandCoordinator<string>();
  const inFlight = deferred<string>();
  const starts: string[] = [];

  const first = coordinator.submit('machine', fifo, () => {
    starts.push('blocking');
    return inFlight.promise;
  });
  const supersededBefore = coordinator.submit(
    'machine',
    { policy: 'latest-wins', coalesceKey: 'brightness' },
    () => starts.push('brightness:superseded-before')
  );
  const beforePhysical = coordinator.submit(
    'machine',
    { policy: 'latest-wins', coalesceKey: 'brightness' },
    () => starts.push('brightness:before-physical')
  );
  const physical = coordinator.submit('machine', fifo, () => starts.push('tare'));
  const supersededAfter = coordinator.submit(
    'machine',
    { policy: 'latest-wins', coalesceKey: 'brightness' },
    () => starts.push('brightness:superseded-after')
  );
  const afterPhysical = coordinator.submit(
    'machine',
    { policy: 'latest-wins', coalesceKey: 'brightness' },
    () => starts.push('brightness:after-physical')
  );
  const otherSetting = coordinator.submit(
    'machine',
    { policy: 'latest-wins', coalesceKey: 'steam-purge' },
    () => starts.push('steam-purge')
  );

  equal((await supersededBefore).status, 'superseded');
  equal((await supersededAfter).status, 'superseded');
  deepEqual(
    coordinator.snapshot.resources[0]?.queued.map((command) => command.coalesceKey),
    ['brightness', null, 'brightness', 'steam-purge']
  );

  inFlight.resolve('first');
  await first;
  await beforePhysical;
  await physical;
  await afterPhysical;
  await otherSetting;
  deepEqual(starts, ['blocking', 'brightness:before-physical', 'tare', 'brightness:after-physical', 'steam-purge']);
});

await run('pending state is observable and describes in-flight and queued policy', async () => {
  const coordinator = new WorkflowCommandCoordinator<string>();
  const gate = deferred<void>();
  const snapshots: Array<WorkflowCommandSnapshot<string>> = [];
  const subscription = coordinator.subscribe((snapshot) => snapshots.push(snapshot));

  const first = coordinator.submit('machine', fifo, () => gate.promise);
  const second = coordinator.submit('machine', { policy: 'latest-wins', coalesceKey: 'workflow' }, () => undefined);
  const pending = coordinator.snapshot;
  equal(pending.pendingCount, 2);
  equal(pending.inFlightCount, 1);
  equal(pending.queuedCount, 1);
  equal(pending.resources[0]?.inFlight?.policy, 'exact-fifo');
  equal(pending.resources[0]?.queued[0]?.policy, 'latest-wins');
  equal(snapshots[0]?.pendingCount, 0);
  equal(snapshots.at(-1)?.pendingCount, 2);

  gate.resolve();
  await first;
  await second;
  equal(snapshots.at(-1)?.pendingCount, 0);
  subscription.dispose();
});

await run('cancel and dispose drop queued work without canceling an in-flight physical action', async () => {
  const coordinator = new WorkflowCommandCoordinator<string>();
  const physicalGate = deferred<string>();
  const starts: string[] = [];
  const physical = coordinator.submit('machine', fifo, () => {
    starts.push('physical');
    return physicalGate.promise;
  });
  const canceled = coordinator.submit('machine', fifo, () => starts.push('canceled'));

  equal(coordinator.cancelQueued('machine'), 1);
  equal((await canceled).status, 'canceled');
  equal(coordinator.snapshot.inFlightCount, 1);

  const disposedQueued = coordinator.submit('machine', fifo, () => starts.push('disposed'));
  coordinator.dispose();
  coordinator.dispose();
  equal((await disposedQueued).status, 'disposed');
  equal(coordinator.snapshot.disposed, true);
  equal(coordinator.snapshot.inFlightCount, 1);
  equal(coordinator.snapshot.queuedCount, 0);
  equal((await coordinator.submit('machine', fifo, () => starts.push('late'))).status, 'disposed');
  deepEqual(starts, ['physical']);

  physicalGate.resolve('landed');
  deepEqual(await physical, { status: 'completed', value: 'landed' });
  equal(coordinator.snapshot.pendingCount, 0);
});

await run('a failed command reports failure and does not block the resource lane', async () => {
  const coordinator = new WorkflowCommandCoordinator<string>();
  const expected = new Error('offline');
  const starts: string[] = [];
  const failed = coordinator.submit('machine', fifo, async () => {
    starts.push('failed');
    throw expected;
  });
  const next = coordinator.submit('machine', fifo, () => starts.push('next'));

  const failure = await failed;
  equal(failure.status, 'failed');
  if (failure.status === 'failed') equal(failure.error, expected);
  equal((await next).status, 'completed');
  deepEqual(starts, ['failed', 'next']);
});

await run('disposeAndWait drains an in-flight physical command after dropping its queue', async () => {
  const coordinator = new WorkflowCommandCoordinator<string>();
  const gate = deferred<void>();
  const physical = coordinator.submit('machine', fifo, () => gate.promise);
  const queued = coordinator.submit('machine', fifo, () => undefined);
  let drained = false;
  const draining = coordinator.disposeAndWait().then(() => {
    drained = true;
  });

  equal((await queued).status, 'disposed');
  await settle();
  equal(drained, false);
  gate.resolve();
  await physical;
  await draining;
  equal(drained, true);
});

interface Deferred<Value> {
  promise: Promise<Value>;
  resolve(value: Value): void;
}

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function run(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

function equal<T>(actual: T, expected: T): void {
  if (actual !== expected) throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
}

function deepEqual(actual: unknown, expected: unknown): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) throw new Error(`Expected ${expectedJson}, received ${actualJson}`);
}
