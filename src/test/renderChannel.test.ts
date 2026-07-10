import {
  RenderChannel,
  type RenderChannelScheduler
} from '../render/renderChannel';

interface ScheduledTask {
  id: number;
  dueMs: number;
  callback: () => void;
}

class FakeScheduler implements RenderChannelScheduler {
  private timeMs = 0;
  private nextId = 1;
  private readonly tasks = new Map<number, ScheduledTask>();

  now(): number {
    return this.timeMs;
  }

  schedule(callback: () => void, delayMs: number): unknown {
    const task: ScheduledTask = {
      id: this.nextId++,
      dueMs: this.timeMs + delayMs,
      callback
    };
    this.tasks.set(task.id, task);
    return task.id;
  }

  cancel(handle: unknown): void {
    if (typeof handle === 'number') this.tasks.delete(handle);
  }

  get pendingCount(): number {
    return this.tasks.size;
  }

  advance(deltaMs: number): void {
    const targetMs = this.timeMs + deltaMs;
    while (true) {
      const due = [...this.tasks.values()]
        .filter((task) => task.dueMs <= targetMs)
        .sort((a, b) => a.dueMs - b.dueMs || a.id - b.id)[0];
      if (!due) break;
      this.tasks.delete(due.id);
      this.timeMs = due.dueMs;
      due.callback();
    }
    this.timeMs = targetMs;
  }
}

run('render channel commits the first model immediately and latest pending value at the bound', () => {
  const scheduler = new FakeScheduler();
  const commits: Array<{ model: string; at: number }> = [];
  const channel = new RenderChannel<string>({
    minIntervalMs: 100,
    scheduler,
    commit: (model) => commits.push({ model, at: scheduler.now() })
  });

  channel.offer('first');
  scheduler.advance(10);
  channel.offer('superseded');
  scheduler.advance(40);
  channel.offer('latest');

  deepEqual(commits, [{ model: 'first', at: 0 }]);
  equal(scheduler.pendingCount, 1);
  scheduler.advance(49);
  equal(commits.length, 1);
  scheduler.advance(1);
  deepEqual(commits, [
    { model: 'first', at: 0 },
    { model: 'latest', at: 100 }
  ]);
});

run('render channel drops unchanged models without consuming a timer or commit', () => {
  const scheduler = new FakeScheduler();
  const commits: number[] = [];
  const channel = new RenderChannel<{ value: number }>({
    minIntervalMs: 100,
    scheduler,
    equals: (a, b) => a.value === b.value,
    commit: (model) => commits.push(model.value)
  });

  channel.offer({ value: 1 });
  scheduler.advance(10);
  channel.offer({ value: 1 });
  equal(scheduler.pendingCount, 0);

  channel.offer({ value: 2 });
  equal(scheduler.pendingCount, 1);
  // Latest-wins includes reverting to the already visible model: the pending
  // intermediate value is removed rather than flashing at the trailing edge.
  channel.offer({ value: 1 });
  equal(scheduler.pendingCount, 0);
  scheduler.advance(200);
  deepEqual(commits, [1]);
});

run('render channel flush commits the pending latest model immediately', () => {
  const scheduler = new FakeScheduler();
  const commits: Array<{ model: number; at: number }> = [];
  const channel = new RenderChannel<number>({
    minIntervalMs: 100,
    scheduler,
    commit: (model) => commits.push({ model, at: scheduler.now() })
  });

  channel.offer(1);
  scheduler.advance(20);
  channel.offer(2);
  channel.offer(3);
  channel.flush();

  deepEqual(commits, [
    { model: 1, at: 0 },
    { model: 3, at: 20 }
  ]);
  equal(scheduler.pendingCount, 0);
});

run('render channel safely coalesces an offer made synchronously by its commit', () => {
  const scheduler = new FakeScheduler();
  const commits: string[] = [];
  let channel: RenderChannel<string>;
  channel = new RenderChannel<string>({
    minIntervalMs: 100,
    scheduler,
    commit: (model) => {
      commits.push(model);
      if (model === 'first') channel.offer('second');
    }
  });

  channel.offer('first');
  deepEqual(commits, ['first']);
  equal(scheduler.pendingCount, 1);
  scheduler.advance(100);
  deepEqual(commits, ['first', 'second']);
});

run('render channel retries a failed sink instead of marking its model committed', () => {
  const scheduler = new FakeScheduler();
  const attempts: string[] = [];
  let fail = true;
  const channel = new RenderChannel<string>({
    minIntervalMs: 100,
    scheduler,
    commit: (model) => {
      attempts.push(model);
      if (fail) throw new Error('paint failed');
    }
  });

  throws(() => channel.offer('model'));
  fail = false;
  channel.flush();
  channel.offer('model');
  deepEqual(attempts, ['model', 'model']);
  equal(scheduler.pendingCount, 0);
});

run('render channel cancels pending work and never commits after disposal', () => {
  const scheduler = new FakeScheduler();
  const commits: string[] = [];
  const channel = new RenderChannel<string>({
    minIntervalMs: 100,
    scheduler,
    commit: (model) => commits.push(model)
  });

  channel.offer('visible');
  scheduler.advance(10);
  channel.offer('pending');
  equal(scheduler.pendingCount, 1);
  channel.dispose();
  equal(channel.isDisposed, true);
  equal(scheduler.pendingCount, 0);

  scheduler.advance(500);
  channel.offer('too late');
  channel.flush();
  deepEqual(commits, ['visible']);
});

run('render channel reset drops old-session work and makes the new session immediate', () => {
  const scheduler = new FakeScheduler();
  const commits: string[] = [];
  const channel = new RenderChannel<string>({
    minIntervalMs: 100,
    scheduler,
    commit: (model) => commits.push(model)
  });

  channel.offer('session-one');
  scheduler.advance(10);
  channel.offer('stale-pending');
  equal(scheduler.pendingCount, 1);
  channel.reset();
  equal(scheduler.pendingCount, 0);
  channel.offer('session-two');
  scheduler.advance(200);

  deepEqual(commits, ['session-one', 'session-two']);
});

run('render channel validates its interval', () => {
  throws(() => new RenderChannel({ minIntervalMs: 0, commit: () => undefined }));
  throws(() => new RenderChannel({ minIntervalMs: -1, commit: () => undefined }));
  throws(() => new RenderChannel({ minIntervalMs: Number.NaN, commit: () => undefined }));
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
