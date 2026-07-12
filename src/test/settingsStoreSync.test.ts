import {
  SettingsStoreSync,
  type SettingsStoreCommandOutcome,
  type SettingsStoreCommandPort,
  type SettingsStoreSyncEvent,
  type SettingsStoreSyncRepository,
  type SettingsStoreWriteValue
} from '../controllers/settingsStoreSync';

async function main(): Promise<void> {
await run('remote writes are rejected before the caller changes an unavailable cache', async () => {
  const harness = createHarness();
  harness.repository.cache.set('size', 'large');

  equal(writeThrough(harness.sync, harness.repository.cache, 'size', 'compact'), false);
  equal(harness.repository.cache.get('size'), 'large');
  equal(lastEvent(harness.events, 'write-rejected')?.reason, 'busy');

  const loading = harness.sync.loadInitial();
  harness.repository.rejectLoad(0, new Error('offline'));
  const result = await loading;
  equal(result.type, 'failed');
  equal(harness.sync.snapshot.available, false);

  equal(writeThrough(harness.sync, harness.repository.cache, 'size', 'compact'), false);
  equal(harness.repository.cache.get('size'), 'large');
  equal(lastEvent(harness.events, 'write-rejected')?.reason, 'unavailable');
  equal(harness.commands.submissions.length, 0);
});

await run('a failed initial load releases its memoized attempt for recovery', async () => {
  const harness = createHarness();
  const first = harness.sync.loadInitial();
  harness.repository.rejectLoad(0, new Error('offline'));
  equal((await first).type, 'failed');

  harness.repository.remote.set('size', 'large');
  const retry = harness.sync.loadInitial();
  equal(harness.repository.loadCalls.length, 2);
  harness.repository.commitLoad(1);
  equal((await retry).type, 'loaded');
  equal(harness.sync.snapshot.available, true);
  equal(harness.repository.cache.get('size'), 'large');
});

await run('external startup authority fences the initial cache publication', async () => {
  const harness = createHarness();
  harness.repository.remote.set('size', 'large');
  let current = true;
  const load = harness.sync.loadInitial(() => current);
  current = false;
  equal(harness.repository.loadCalls[0]?.canCommit(), false);
  harness.repository.commitLoad(0);

  equal((await load).type, 'fenced');
  equal(harness.repository.cache.has('size'), false);
  equal(harness.sync.snapshot.available, false);
});

await run('local mode admits cache changes without loading or submitting remote writes', async () => {
  const harness = createHarness({ local: true });
  const result = await harness.sync.loadInitial();

  equal(result.type, 'loaded');
  equal(harness.sync.snapshot.mode, 'local');
  equal(harness.sync.snapshot.available, true);
  equal(harness.repository.loadCalls.length, 0);
  equal(writeThrough(harness.sync, harness.repository.cache, 'size', 'compact'), true);
  equal(harness.repository.cache.get('size'), 'compact');
  equal(harness.commands.submissions.length, 0);
  includesEvent(harness.events, 'local-write-admitted');
});

await run('accepted writes use a per-key latest lane and publish explicit lifecycle state', async () => {
  const harness = await readyHarness();
  equal(writeThrough(harness.sync, harness.repository.cache, 'size', 'compact'), true);

  equal(harness.commands.submissions.length, 1);
  equal(harness.commands.submissions[0]?.resourceKey, 'store:size');
  equal(harness.commands.submissions[0]?.coalesceKey, 'value');
  equal(harness.sync.snapshot.pendingWrites.length, 1);
  equal(harness.sync.snapshot.desiredWrites[0]?.value, 'compact');
  equal(lastEvent(harness.events, 'write-accepted')?.source, 'change');

  await harness.commands.runAndComplete(0);
  await flushAsync();
  equal(harness.repository.remote.get('size'), 'compact');
  equal(harness.sync.snapshot.pendingWrites.length, 0);
  equal(harness.sync.snapshot.desiredWrites.length, 0);
  equal(harness.sync.snapshot.failedWrites.length, 0);
  includesEvent(harness.events, 'write-succeeded');
});

await run('null writes use the same lane and delete the remote value', async () => {
  const harness = await readyHarness();
  harness.repository.remote.set('size', 'large');
  harness.repository.cache.set('size', 'large');
  equal(harness.sync.admitWrite('size', null), true);
  harness.repository.cache.delete('size');
  await harness.commands.runAndComplete(0);
  await flushAsync();

  equal(harness.repository.remote.has('size'), false);
  equal(harness.repository.writes.length, 1);
  equal(harness.repository.writes[0]?.[1], null);
  equal(harness.sync.snapshot.pendingWrites.length, 0);
});

await run('write revisions reject stale A to B to A completions even when values match again', async () => {
  const harness = await readyHarness();
  writeThrough(harness.sync, harness.repository.cache, 'key', 'A');
  writeThrough(harness.sync, harness.repository.cache, 'key', 'B');
  writeThrough(harness.sync, harness.repository.cache, 'key', 'A');

  equal(harness.sync.snapshot.pendingWrites.length, 1);
  const currentRevision = harness.sync.snapshot.pendingWrites[0]?.revision;
  equal(currentRevision, 3);

  harness.commands.resolve(0, { status: 'failed', error: new Error('old A failed') });
  harness.commands.resolve(1, { status: 'superseded' });
  await flushAsync();
  equal(harness.sync.snapshot.pendingWrites[0]?.revision, currentRevision);
  equal(harness.sync.snapshot.failedWrites.length, 0);
  equal(harness.events.filter((event) => event.type === 'write-stale').length, 2);

  await harness.commands.runAndComplete(2);
  await flushAsync();
  equal(harness.sync.snapshot.pendingWrites.length, 0);
  equal(harness.sync.snapshot.failedWrites.length, 0);
  equal(harness.repository.remote.get('key'), 'A');
});

await run('current failures remain retryable and a successful retry clears the error', async () => {
  const harness = await readyHarness();
  writeThrough(harness.sync, harness.repository.cache, 'size', 'compact');
  harness.commands.resolve(0, { status: 'failed', error: new Error('network') });
  await flushAsync();

  equal(harness.sync.snapshot.storeError, true);
  equal(harness.sync.snapshot.failedWrites[0]?.key, 'size');
  equal(harness.sync.snapshot.failedWrites[0]?.value, 'compact');
  includesEvent(harness.events, 'write-failed');

  equal(harness.sync.retryFailedWrites(), 1);
  equal(harness.commands.submissions.length, 2);
  equal(harness.sync.snapshot.failedWrites.length, 0);
  equal(harness.sync.snapshot.pendingWrites.length, 1);
  equal(lastEvent(harness.events, 'write-accepted')?.source, 'retry');

  await harness.commands.runAndComplete(1);
  await flushAsync();
  equal(harness.sync.snapshot.storeError, false);
  equal(harness.sync.snapshot.pendingWrites.length, 0);
  equal(harness.repository.remote.get('size'), 'compact');
});

await run('canceled current writes fail visibly instead of remaining pending forever', async () => {
  const harness = await readyHarness();
  writeThrough(harness.sync, harness.repository.cache, 'size', 'compact');
  harness.commands.resolve(0, { status: 'canceled' });
  await flushAsync();

  equal(harness.sync.snapshot.pendingWrites.length, 0);
  equal(harness.sync.snapshot.failedWrites.length, 1);
  equal(harness.sync.snapshot.storeError, true);
});

await run('a write fences an in-flight poll and pending writes skip new polls', async () => {
  const harness = await readyHarness();
  harness.repository.remote.set('remote-only', 'fresh');
  const poll = harness.sync.pollNow();
  equal(harness.repository.pollCalls.length, 1);
  equal(harness.repository.pollCalls[0]?.canCommit(), true);

  writeThrough(harness.sync, harness.repository.cache, 'local', 'pending');
  equal(harness.repository.pollCalls[0]?.canCommit(), false);
  harness.repository.commitPoll(0);
  const result = await poll;
  equal(result.type, 'fenced');
  equal(harness.repository.cache.has('remote-only'), false);
  includesEvent(harness.events, 'poll-fenced');
  await flushAsync();

  const skipped = await harness.sync.pollNow();
  equal(skipped.type, 'skipped');
  equal(skipped.type === 'skipped' ? skipped.reason : null, 'pending-writes');
  equal(harness.repository.pollCalls.length, 1);

  await harness.commands.runAndComplete(0);
  await flushAsync();
  const recoveredPoll = harness.sync.pollNow();
  harness.repository.commitPoll(1);
  const recovered = await recoveredPoll;
  equal(recovered.type, 'polled');
  equal(harness.repository.cache.get('remote-only'), 'fresh');
});

await run('concurrent poll callers share one repository read', async () => {
  const harness = await readyHarness();
  const first = harness.sync.pollNow();
  const second = harness.sync.pollNow();
  equal(first === second, true);
  equal(harness.repository.pollCalls.length, 1);
  harness.repository.commitPoll(0);
  equal((await first).type, 'polled');
  equal((await second).type, 'polled');
});

await run('a current poll failure is explicit and retains prior availability', async () => {
  const harness = await readyHarness();
  const poll = harness.sync.pollNow();
  harness.repository.rejectPoll(0, new Error('read failed'));
  const result = await poll;

  equal(result.type, 'failed');
  equal(harness.sync.snapshot.available, true);
  equal(harness.sync.snapshot.polling, false);
  includesEvent(harness.events, 'poll-failed');
});

await run('external transport authority fences a poll and demotes availability', async () => {
  const harness = await readyHarness();
  harness.repository.remote.set('remote-only', 'fresh');
  let current = true;
  const poll = harness.sync.pollNow(() => current);
  current = false;
  harness.repository.commitPoll(0);

  equal((await poll).type, 'fenced');
  equal(harness.repository.cache.has('remote-only'), false);
  equal(harness.sync.snapshot.available, false);
});

await run('a successful poll recovers availability after the initial load failed', async () => {
  const harness = createHarness();
  const load = harness.sync.loadInitial();
  harness.repository.rejectLoad(0, new Error('offline'));
  equal((await load).type, 'failed');
  equal(harness.sync.snapshot.available, false);

  harness.repository.remote.set('size', 'large');
  const poll = harness.sync.pollNow();
  harness.repository.commitPoll(0);
  const result = await poll;
  equal(result.type, 'polled');
  equal(harness.sync.snapshot.available, true);
  equal(harness.repository.cache.get('size'), 'large');
  includesEvent(harness.events, 'poll-succeeded');
});

await run('discard and reload blocks writes, adopts authority, and clears failed ownership only on success', async () => {
  const harness = await readyHarness();
  harness.repository.cache.set('size', 'compact');
  harness.repository.remote.set('size', 'large');
  harness.sync.admitWrite('size', 'compact');
  harness.commands.resolve(0, { status: 'failed', error: new Error('offline') });
  await flushAsync();
  equal(harness.sync.snapshot.failedWrites.length, 1);

  const reload = harness.sync.discardAndReload();
  equal(harness.sync.snapshot.phase, 'reloading');
  equal(writeThrough(harness.sync, harness.repository.cache, 'other', 'local-change'), false);
  equal(harness.repository.cache.has('other'), false);
  equal(lastEvent(harness.events, 'write-rejected')?.reason, 'busy');
  harness.repository.commitPoll(0);
  const result = await reload;

  equal(result.type, 'reloaded');
  equal(harness.repository.cache.get('size'), 'large');
  equal(harness.sync.snapshot.available, true);
  equal(harness.sync.snapshot.phase, 'ready');
  equal(harness.sync.snapshot.desiredWrites.length, 0);
  equal(harness.sync.snapshot.failedWrites.length, 0);
  equal(harness.sync.snapshot.storeError, false);
  includesEvent(harness.events, 'reload-succeeded');
});

await run('an external authority fence prevents reload cache publication and write admission', async () => {
  const harness = await readyHarness();
  harness.repository.cache.set('size', 'safe-cache');
  harness.repository.remote.set('size', 'stale-response');
  let authority = true;

  const reload = harness.sync.discardAndReload(() => authority);
  authority = false;
  harness.repository.commitPoll(0);
  const result = await reload;

  equal(result.type, 'fenced');
  equal(harness.repository.cache.get('size'), 'safe-cache');
  equal(harness.sync.snapshot.available, false);
  equal(harness.sync.admitWrite('size', 'offline-change'), false);
  includesEvent(harness.events, 'reload-fenced');
});

await run('discard and reload refuses pending writes and retains failures after a read error', async () => {
  const pendingHarness = await readyHarness();
  pendingHarness.sync.admitWrite('size', 'compact');
  const blocked = await pendingHarness.sync.discardAndReload();
  equal(blocked.type, 'skipped');
  equal(blocked.type === 'skipped' ? blocked.reason : null, 'pending-writes');
  equal(pendingHarness.repository.pollCalls.length, 0);

  const failedHarness = await readyHarness();
  failedHarness.sync.admitWrite('size', 'compact');
  failedHarness.commands.resolve(0, { status: 'failed', error: new Error('write failed') });
  await flushAsync();
  const reload = failedHarness.sync.discardAndReload();
  failedHarness.repository.rejectPoll(0, new Error('read failed'));
  const failed = await reload;
  equal(failed.type, 'failed');
  equal(failedHarness.sync.snapshot.phase, 'ready');
  equal(failedHarness.sync.snapshot.failedWrites.length, 1);
  equal(failedHarness.sync.snapshot.storeError, true);
  includesEvent(failedHarness.events, 'reload-failed');
});

await run('a synchronous scheduler rejection restores ownership and rejects before cache mutation', async () => {
  const harness = await readyHarness();
  harness.commands.throwNext = new Error('scheduler closed');
  equal(writeThrough(harness.sync, harness.repository.cache, 'size', 'compact'), false);
  equal(harness.repository.cache.has('size'), false);
  equal(harness.sync.snapshot.desiredWrites.length, 0);
  equal(harness.sync.snapshot.pendingWrites.length, 0);
  equal(lastEvent(harness.events, 'write-rejected')?.reason, 'scheduler');
});

await run('disposal fences initial load and publishes no later completion events', async () => {
  const harness = createHarness();
  harness.repository.remote.set('size', 'large');
  const load = harness.sync.loadInitial();
  const eventsBeforeDispose = harness.events.length;
  harness.sync.dispose();
  equal(harness.events.length, eventsBeforeDispose + 1);
  equal(harness.events.at(-1)?.type, 'disposed');
  equal(harness.sync.snapshot.phase, 'disposed');
  equal(harness.sync.snapshot.available, false);

  harness.repository.commitLoad(0);
  const result = await load;
  equal(result.type, 'disposed');
  equal(harness.repository.cache.has('size'), false);
  equal(harness.events.length, eventsBeforeDispose + 1);
  equal(harness.sync.admitWrite('size', 'compact'), false);
  equal(harness.events.length, eventsBeforeDispose + 1);
});

await run('disposal clears write ownership and ignores an in-flight command completion', async () => {
  const harness = await readyHarness();
  harness.sync.admitWrite('size', 'compact');
  const eventCount = harness.events.length;
  harness.sync.dispose();
  equal(harness.sync.snapshot.pendingWrites.length, 0);
  equal(harness.sync.snapshot.desiredWrites.length, 0);
  equal(harness.sync.snapshot.failedWrites.length, 0);
  equal(harness.events.length, eventCount + 1);

  harness.commands.resolve(0, { status: 'failed', error: new Error('late') });
  await flushAsync();
  equal(harness.events.length, eventCount + 1);
  equal(harness.sync.snapshot.storeError, false);
});
}

interface Harness {
  repository: ControlledRepository;
  commands: ManualCommandPort;
  sync: SettingsStoreSync;
  events: SettingsStoreSyncEvent[];
}

function createHarness(options: { local?: boolean } = {}): Harness {
  const repository = new ControlledRepository();
  const commands = new ManualCommandPort();
  const sync = new SettingsStoreSync(repository, commands, options);
  const events: SettingsStoreSyncEvent[] = [];
  sync.subscribe((event) => events.push(event));
  return { repository, commands, sync, events };
}

async function readyHarness(): Promise<Harness> {
  const harness = createHarness();
  const load = harness.sync.loadInitial();
  harness.repository.commitLoad(0);
  const result = await load;
  equal(result.type, 'loaded');
  return harness;
}

function writeThrough(
  sync: SettingsStoreSync,
  cache: Map<string, string>,
  key: string,
  value: string
): boolean {
  if (!sync.admitWrite(key, value)) return false;
  cache.set(key, value);
  return true;
}

interface ControlledRead {
  canCommit: () => boolean;
  deferred: Deferred<boolean | readonly string[] | null>;
}

class ControlledRepository implements SettingsStoreSyncRepository {
  readonly cache = new Map<string, string>();
  readonly remote = new Map<string, string>();
  readonly writes: Array<[string, SettingsStoreWriteValue]> = [];
  readonly loadCalls: ControlledRead[] = [];
  readonly pollCalls: ControlledRead[] = [];

  load(canCommit: () => boolean): Promise<boolean> {
    const deferred = new Deferred<boolean | readonly string[] | null>();
    this.loadCalls.push({ canCommit, deferred });
    return deferred.promise as Promise<boolean>;
  }

  poll(canCommit: () => boolean): Promise<readonly string[] | null> {
    const deferred = new Deferred<boolean | readonly string[] | null>();
    this.pollCalls.push({ canCommit, deferred });
    return deferred.promise as Promise<readonly string[] | null>;
  }

  async write(key: string, value: SettingsStoreWriteValue): Promise<void> {
    this.writes.push([key, value]);
    if (value == null) this.remote.delete(key);
    else this.remote.set(key, value);
  }

  commitLoad(index: number): void {
    const call = required(this.loadCalls[index], `load ${index}`);
    const committed = call.canCommit();
    if (committed) replaceMap(this.cache, this.remote);
    call.deferred.resolve(committed);
  }

  rejectLoad(index: number, error: unknown): void {
    required(this.loadCalls[index], `load ${index}`).deferred.reject(error);
  }

  commitPoll(index: number): void {
    const call = required(this.pollCalls[index], `poll ${index}`);
    if (!call.canCommit()) {
      call.deferred.resolve(null);
      return;
    }
    const changed = changedKeys(this.cache, this.remote);
    replaceMap(this.cache, this.remote);
    call.deferred.resolve(changed);
  }

  rejectPoll(index: number, error: unknown): void {
    required(this.pollCalls[index], `poll ${index}`).deferred.reject(error);
  }
}

interface ManualSubmission {
  resourceKey: string;
  coalesceKey: string;
  run: () => unknown | PromiseLike<unknown>;
  deferred: Deferred<SettingsStoreCommandOutcome<unknown>>;
}

class ManualCommandPort implements SettingsStoreCommandPort {
  readonly submissions: ManualSubmission[] = [];
  throwNext: unknown = null;

  latest<Value>(
    resourceKey: string,
    coalesceKey: string,
    run: () => Value | PromiseLike<Value>
  ): Promise<SettingsStoreCommandOutcome<Value>> {
    if (this.throwNext != null) {
      const error = this.throwNext;
      this.throwNext = null;
      throw error;
    }
    const deferred = new Deferred<SettingsStoreCommandOutcome<unknown>>();
    this.submissions.push({ resourceKey, coalesceKey, run, deferred });
    return deferred.promise as Promise<SettingsStoreCommandOutcome<Value>>;
  }

  resolve(index: number, outcome: SettingsStoreCommandOutcome<void>): void {
    required(this.submissions[index], `submission ${index}`).deferred.resolve(outcome);
  }

  async runAndComplete(index: number): Promise<void> {
    const submission = required(this.submissions[index], `submission ${index}`);
    try {
      const value = await submission.run();
      submission.deferred.resolve({ status: 'completed', value });
    } catch (error) {
      submission.deferred.resolve({ status: 'failed', error });
    }
  }
}

class Deferred<Value> {
  readonly promise: Promise<Value>;
  private resolvePromise!: (value: Value) => void;
  private rejectPromise!: (error: unknown) => void;

  constructor() {
    this.promise = new Promise<Value>((resolve, reject) => {
      this.resolvePromise = resolve;
      this.rejectPromise = reject;
    });
  }

  resolve(value: Value): void {
    this.resolvePromise(value);
  }

  reject(error: unknown): void {
    this.rejectPromise(error);
  }
}

function changedKeys(current: Map<string, string>, next: Map<string, string>): string[] {
  const keys = new Set([...current.keys(), ...next.keys()]);
  return [...keys].filter((key) => current.get(key) !== next.get(key)).sort();
}

function replaceMap(target: Map<string, string>, source: Map<string, string>): void {
  target.clear();
  for (const [key, value] of source) target.set(key, value);
}

function lastEvent<Type extends SettingsStoreSyncEvent['type']>(
  events: readonly SettingsStoreSyncEvent[],
  type: Type
): Extract<SettingsStoreSyncEvent, { type: Type }> | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (event.type === type) return event as Extract<SettingsStoreSyncEvent, { type: Type }>;
  }
  return null;
}

function includesEvent(events: readonly SettingsStoreSyncEvent[], type: SettingsStoreSyncEvent['type']): void {
  equal(events.some((event) => event.type === type), true);
}

function required<Value>(value: Value | undefined, label: string): Value {
  if (value === undefined) throw new Error(`Missing ${label}`);
  return value;
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function run(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

function equal<T>(actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(`Expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`);
  }
}

await main();
