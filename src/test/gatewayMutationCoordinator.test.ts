import { GatewayMutationCoordinator } from '../runtime/gatewayMutationCoordinator';

await run('gateway mutations preserve latest-wins boundaries around exact FIFO work', async () => {
  const coordinator = new GatewayMutationCoordinator<string>();
  const gate = deferred<void>();
  const starts: string[] = [];

  const blocking = coordinator.exact('machine', () => {
    starts.push('blocking');
    return gate.promise;
  });
  const staleBefore = coordinator.latest('machine', 'recipe', () => starts.push('stale-before'));
  const beforeBarrier = coordinator.latest('machine', 'recipe', () => starts.push('before-barrier'));
  const barrier = coordinator.exact('machine', () => starts.push('physical'));
  const staleAfter = coordinator.latest('machine', 'recipe', () => starts.push('stale-after'));
  const afterBarrier = coordinator.latest('machine', 'recipe', () => starts.push('after-barrier'));

  equal((await staleBefore).status, 'superseded');
  equal((await staleAfter).status, 'superseded');
  equal(coordinator.isPending('machine'), true);
  deepEqual(
    coordinator.snapshot.resources[0]?.queued.map((command) => command.coalesceKey),
    ['recipe', null, 'recipe']
  );

  gate.resolve(undefined);
  await blocking;
  await beforeBarrier;
  await barrier;
  await afterBarrier;

  deepEqual(starts, ['blocking', 'before-barrier', 'physical', 'after-barrier']);
  equal(coordinator.isPending('machine'), false);
});

await run('gateway mutation owner disposes queued work and drains work already in flight', async () => {
  const coordinator = new GatewayMutationCoordinator<string>();
  const gate = deferred<string>();
  const inFlight = coordinator.exact('machine', () => gate.promise);
  const queued = coordinator.exact('machine', () => 'must-not-run');
  let drained = false;

  const drain = coordinator.disposeAndWait().then(() => {
    drained = true;
  });
  equal((await queued).status, 'disposed');
  equal((await coordinator.latest('machine', 'recipe', () => 'late')).status, 'disposed');
  await settle();
  equal(drained, false);
  equal(coordinator.snapshot.inFlightCount, 1);

  gate.resolve('settled');
  deepEqual(await inFlight, { status: 'completed', value: 'settled' });
  await drain;
  equal(drained, true);
  equal(coordinator.snapshot.pendingCount, 0);
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
