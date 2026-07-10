import {
  DisposableScope,
  type DisposableScopeRuntime
} from '../runtime/disposableScope';

class FakeRuntime implements DisposableScopeRuntime {
  private nextId = 1;
  readonly timeouts = new Map<number, () => void>();
  readonly intervals = new Map<number, () => void>();
  readonly frames = new Map<number, FrameRequestCallback>();
  private readonly allTimeouts = new Map<number, () => void>();
  private readonly allIntervals = new Map<number, () => void>();
  private readonly allFrames = new Map<number, FrameRequestCallback>();

  setTimeout(callback: () => void): unknown {
    const id = this.nextId++;
    this.timeouts.set(id, callback);
    this.allTimeouts.set(id, callback);
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timeouts.delete(handle as number);
  }

  setInterval(callback: () => void): unknown {
    const id = this.nextId++;
    this.intervals.set(id, callback);
    this.allIntervals.set(id, callback);
    return id;
  }

  clearInterval(handle: unknown): void {
    this.intervals.delete(handle as number);
  }

  requestAnimationFrame(callback: FrameRequestCallback): unknown {
    const id = this.nextId++;
    this.frames.set(id, callback);
    this.allFrames.set(id, callback);
    return id;
  }

  cancelAnimationFrame(handle: unknown): void {
    this.frames.delete(handle as number);
  }

  forceTimeout(id: number): void {
    this.timeouts.delete(id);
    this.allTimeouts.get(id)?.();
  }

  forceInterval(id: number): void {
    this.allIntervals.get(id)?.();
  }

  forceFrame(id: number, timestamp: number): void {
    this.frames.delete(id);
    this.allFrames.get(id)?.(timestamp);
  }
}

class FakeEventTarget implements EventTarget {
  private readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  lastAdded: EventListenerOrEventListenerObject | null = null;

  addEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null
  ): void {
    if (!callback) return;
    const listeners = this.listeners.get(type) ?? new Set<EventListenerOrEventListenerObject>();
    listeners.add(callback);
    this.listeners.set(type, listeners);
    this.lastAdded = callback;
  }

  removeEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null
  ): void {
    if (callback) this.listeners.get(type)?.delete(callback);
  }

  dispatchEvent(event: Event): boolean {
    for (const listener of this.listeners.get(event.type) ?? []) {
      if (typeof listener === 'function') listener.call(this, event);
      else listener.handleEvent(event);
    }
    return true;
  }

  get listenerCount(): number {
    return [...this.listeners.values()].reduce((count, listeners) => count + listeners.size, 0);
  }
}

run('scope disposal is outside-in, aborts signals, and is idempotent', () => {
  const root = new DisposableScope();
  const child = root.child();
  const grandchild = child.child();
  const order: string[] = [];

  root.own(() => order.push(`root:${root.signal.aborted}:${child.isDisposed}`));
  child.own(() => order.push(`child:${child.signal.aborted}:${grandchild.isDisposed}`));
  grandchild.own(() => order.push(`grandchild:${grandchild.signal.aborted}`));

  root.dispose();
  root.dispose();

  deepEqual(order, ['root:true:false', 'child:true:false', 'grandchild:true']);
  equal(root.isDisposed, true);
  equal(child.isDisposed, true);
  equal(grandchild.isDisposed, true);
});

run('owned cleanup and disposables run at most once', () => {
  const scope = new DisposableScope();
  let cleanupCalls = 0;
  let disposableCalls = 0;
  const cleanup = scope.own(() => cleanupCalls += 1);
  scope.own({ dispose: () => disposableCalls += 1 });

  cleanup.dispose();
  cleanup.dispose();
  scope.dispose();

  equal(cleanupCalls, 1);
  equal(disposableCalls, 1);
});

run('timers, intervals, and animation frames are canceled and guarded after disposal', () => {
  const runtime = new FakeRuntime();
  const scope = new DisposableScope(runtime);
  const calls: string[] = [];

  scope.setTimeout(() => calls.push('timeout'), 10);
  scope.setInterval(() => calls.push('interval'), 10);
  scope.requestAnimationFrame((timestamp) => calls.push(`frame:${timestamp}`));
  runtime.forceInterval(2);
  deepEqual(calls, ['interval']);

  scope.dispose();
  equal(runtime.timeouts.size, 0);
  equal(runtime.intervals.size, 0);
  equal(runtime.frames.size, 0);

  // A browser may already have queued a canceled callback. Its guard still
  // prevents it from crossing the disposed lifecycle boundary.
  runtime.forceTimeout(1);
  runtime.forceInterval(2);
  runtime.forceFrame(3, 42);
  deepEqual(calls, ['interval']);
});

run('completed one-shot callbacks release ownership and run once', () => {
  const runtime = new FakeRuntime();
  const scope = new DisposableScope(runtime);
  const calls: string[] = [];

  scope.setTimeout(() => calls.push('timeout'), 10);
  scope.requestAnimationFrame((timestamp) => calls.push(`frame:${timestamp}`));
  runtime.forceTimeout(1);
  runtime.forceTimeout(1);
  runtime.forceFrame(2, 12);
  runtime.forceFrame(2, 13);

  deepEqual(calls, ['timeout', 'frame:12']);
  scope.dispose();
});

run('event listeners are removed and guarded after disposal', () => {
  const scope = new DisposableScope();
  const target = new FakeEventTarget();
  let calls = 0;
  scope.listen(target, 'change', () => calls += 1);
  const queuedListener = target.lastAdded as EventListener;

  target.dispatchEvent(new Event('change'));
  scope.dispose();
  equal(target.listenerCount, 0);
  target.dispatchEvent(new Event('change'));
  queuedListener(new Event('change'));

  equal(calls, 1);
});

run('work registered after disposal is not started and owned resources release immediately', () => {
  const runtime = new FakeRuntime();
  const scope = new DisposableScope(runtime);
  const target = new FakeEventTarget();
  let cleanupCalls = 0;
  scope.dispose();

  const child = scope.child();
  scope.own(() => cleanupCalls += 1);
  scope.setTimeout(() => cleanupCalls += 10, 1);
  scope.setInterval(() => cleanupCalls += 10, 1);
  scope.requestAnimationFrame(() => cleanupCalls += 10);
  scope.listen(target, 'change', () => cleanupCalls += 10);

  equal(child.isDisposed, true);
  equal(child.signal.aborted, true);
  equal(cleanupCalls, 1);
  equal(runtime.timeouts.size + runtime.intervals.size + runtime.frames.size, 0);
  equal(target.listenerCount, 0);
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
