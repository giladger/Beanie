import { BackgroundTask, type BackgroundTaskScheduler } from '../runtime/backgroundTask';

class FakeScheduler implements BackgroundTaskScheduler {
  private nextId = 1;
  readonly pending = new Map<number, () => void>();

  schedule(callback: () => void): unknown {
    const id = this.nextId++;
    this.pending.set(id, callback);
    return id;
  }

  cancel(handle: unknown): void {
    this.pending.delete(handle as number);
  }

  fireNext(): void {
    const entry = this.pending.entries().next().value as [number, () => void] | undefined;
    if (!entry) throw new Error('Expected a scheduled task');
    this.pending.delete(entry[0]);
    entry[1]();
  }
}

await run('background task self-schedules only after the prior run settles', async () => {
  const scheduler = new FakeScheduler();
  const releases: Array<() => void> = [];
  let calls = 0;
  const task = new BackgroundTask({
    intervalMs: 10,
    scheduler,
    run: () => {
      calls += 1;
      return new Promise<void>((resolve) => {
        releases.push(resolve);
      });
    }
  });
  task.start();
  equal(scheduler.pending.size, 1);
  scheduler.fireNext();
  await tick();
  equal(calls, 1);
  equal(scheduler.pending.size, 0);

  task.trigger();
  task.trigger();
  equal(calls, 1);
  releases.shift()?.();
  await tick();
  equal(calls, 2);
  equal(scheduler.pending.size, 0);
  releases.shift()?.();
  await tick();
  equal(scheduler.pending.size, 1);
  task.dispose();
});

await run('suspension cancels wakes and resume performs one catch-up run', async () => {
  const scheduler = new FakeScheduler();
  let calls = 0;
  const task = new BackgroundTask({
    intervalMs: 10,
    scheduler,
    run: () => {
      calls += 1;
    }
  });
  task.start();
  task.suspend();
  equal(scheduler.pending.size, 0);
  task.resume();
  await tick();
  equal(calls, 1);
  equal(scheduler.pending.size, 1);
  task.dispose();
});

await run('background task reports failures and remains schedulable', async () => {
  const scheduler = new FakeScheduler();
  const errors: unknown[] = [];
  const task = new BackgroundTask({
    intervalMs: 10,
    scheduler,
    run: () => {
      throw new Error('offline');
    },
    onError: (error) => errors.push(error)
  });
  task.start();
  scheduler.fireNext();
  await tick();
  equal(errors.length, 1);
  equal(scheduler.pending.size, 1);
  task.dispose();
});

function tick(): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, 0));
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
