export type SettingsStoreWriteValue = string | null;

export type SettingsStoreCommandOutcome<Value> =
  | { status: 'completed'; value: Value }
  | { status: 'failed'; error: unknown }
  | { status: 'superseded' }
  | { status: 'canceled' }
  | { status: 'disposed' };

/** Structural subset implemented by GatewayMutationCoordinator. */
export interface SettingsStoreCommandPort {
  latest<Value>(
    resourceKey: string,
    coalesceKey: string,
    run: () => Value | PromiseLike<Value>
  ): Promise<SettingsStoreCommandOutcome<Value>>;
}

/**
 * Cache/store boundary. `load` and `poll` must call `canCommit` immediately
 * before changing their synchronous cache and return false/null when fenced.
 */
export interface SettingsStoreSyncRepository {
  load(canCommit: () => boolean): Promise<boolean>;
  poll(canCommit: () => boolean): Promise<readonly string[] | null>;
  write(key: string, value: SettingsStoreWriteValue): Promise<void>;
}

export type SettingsStoreSyncPhase = 'idle' | 'loading' | 'ready' | 'reloading' | 'disposed';

export interface SettingsStoreWriteSnapshot {
  key: string;
  value: SettingsStoreWriteValue;
  revision: number;
}

export interface SettingsStoreSyncSnapshot {
  mode: 'local' | 'remote';
  phase: SettingsStoreSyncPhase;
  available: boolean;
  polling: boolean;
  storeError: boolean;
  mutationGeneration: number;
  desiredWrites: readonly SettingsStoreWriteSnapshot[];
  pendingWrites: readonly SettingsStoreWriteSnapshot[];
  failedWrites: readonly SettingsStoreWriteSnapshot[];
}

interface SettingsStoreSyncEventBase {
  state: SettingsStoreSyncSnapshot;
}

export type SettingsStoreSyncEvent =
  | ({ type: 'snapshot' } & SettingsStoreSyncEventBase)
  | ({ type: 'load-started' } & SettingsStoreSyncEventBase)
  | ({ type: 'load-succeeded' } & SettingsStoreSyncEventBase)
  | ({ type: 'load-failed'; error: unknown } & SettingsStoreSyncEventBase)
  | ({ type: 'load-fenced' } & SettingsStoreSyncEventBase)
  | ({
      type: 'write-rejected';
      key: string;
      value: SettingsStoreWriteValue;
      reason: 'unavailable' | 'busy' | 'disposed' | 'scheduler';
      error?: unknown;
    } & SettingsStoreSyncEventBase)
  | ({ type: 'local-write-admitted'; key: string; value: SettingsStoreWriteValue } & SettingsStoreSyncEventBase)
  | ({ type: 'write-accepted'; write: SettingsStoreWriteSnapshot; source: 'change' | 'retry' } & SettingsStoreSyncEventBase)
  | ({ type: 'write-succeeded'; write: SettingsStoreWriteSnapshot } & SettingsStoreSyncEventBase)
  | ({ type: 'write-failed'; write: SettingsStoreWriteSnapshot; error: unknown } & SettingsStoreSyncEventBase)
  | ({
      type: 'write-stale';
      write: SettingsStoreWriteSnapshot;
      outcome: SettingsStoreCommandOutcome<void>;
    } & SettingsStoreSyncEventBase)
  | ({ type: 'poll-started' } & SettingsStoreSyncEventBase)
  | ({ type: 'poll-succeeded'; changedKeys: readonly string[] } & SettingsStoreSyncEventBase)
  | ({ type: 'poll-failed'; error: unknown } & SettingsStoreSyncEventBase)
  | ({ type: 'poll-fenced' } & SettingsStoreSyncEventBase)
  | ({
      type: 'poll-skipped';
      reason: 'local' | 'not-ready' | 'pending-writes' | 'disposed';
    } & SettingsStoreSyncEventBase)
  | ({ type: 'retry-started'; keys: readonly string[] } & SettingsStoreSyncEventBase)
  | ({ type: 'reload-started' } & SettingsStoreSyncEventBase)
  | ({ type: 'reload-succeeded'; changedKeys: readonly string[] } & SettingsStoreSyncEventBase)
  | ({ type: 'reload-failed'; error: unknown } & SettingsStoreSyncEventBase)
  | ({ type: 'reload-fenced' } & SettingsStoreSyncEventBase)
  | ({
      type: 'reload-skipped';
      reason: 'local' | 'not-ready' | 'pending-writes' | 'disposed';
    } & SettingsStoreSyncEventBase)
  | ({ type: 'disposed' } & SettingsStoreSyncEventBase);

export type SettingsStoreInitialLoadResult =
  | { type: 'loaded' }
  | { type: 'failed'; error: unknown }
  | { type: 'fenced' }
  | { type: 'disposed' };

export type SettingsStorePollResult =
  | { type: 'polled'; changedKeys: readonly string[] }
  | { type: 'failed'; error: unknown }
  | { type: 'fenced' }
  | { type: 'skipped'; reason: 'local' | 'not-ready' | 'pending-writes' | 'disposed' }
  | { type: 'disposed' };

export type SettingsStoreReloadResult =
  | { type: 'reloaded'; changedKeys: readonly string[] }
  | { type: 'failed'; error: unknown }
  | { type: 'fenced' }
  | { type: 'skipped'; reason: 'local' | 'not-ready' | 'pending-writes' | 'disposed' }
  | { type: 'disposed' };

export interface SettingsStoreSyncOptions {
  local?: boolean;
}

export interface SettingsStoreSyncSubscription {
  dispose(): void;
}

interface TrackedWrite extends SettingsStoreWriteSnapshot {}

interface FailedWrite extends TrackedWrite {
  error: unknown;
}

/**
 * Owns the concurrency and lifecycle policy around Beanie's synced KV cache.
 * The synchronous `admitWrite` result is intentionally separate from cache
 * mutation: domain writers call it first and change their cache only on true.
 */
export class SettingsStoreSync {
  private readonly listeners = new Set<(event: SettingsStoreSyncEvent) => void>();
  private readonly desired = new Map<string, TrackedWrite>();
  private readonly pending = new Map<string, TrackedWrite>();
  private readonly failed = new Map<string, FailedWrite>();
  private readonly local: boolean;
  private phase: SettingsStoreSyncPhase = 'idle';
  private available = false;
  private polling = false;
  private mutationGeneration = 0;
  private writeRevision = 0;
  private initialLoadPromise: Promise<SettingsStoreInitialLoadResult> | null = null;
  private pollPromise: Promise<SettingsStorePollResult> | null = null;

  constructor(
    private readonly repository: SettingsStoreSyncRepository,
    private readonly commands: SettingsStoreCommandPort,
    options: SettingsStoreSyncOptions = {}
  ) {
    this.local = options.local === true;
  }

  get snapshot(): SettingsStoreSyncSnapshot {
    return {
      mode: this.local ? 'local' : 'remote',
      phase: this.phase,
      available: this.available,
      polling: this.polling,
      storeError: this.failed.size > 0,
      mutationGeneration: this.mutationGeneration,
      desiredWrites: sortedWrites(this.desired.values()),
      pendingWrites: sortedWrites(this.pending.values()),
      failedWrites: sortedWrites(this.failed.values())
    };
  }

  subscribe(listener: (event: SettingsStoreSyncEvent) => void): SettingsStoreSyncSubscription {
    if (this.phase !== 'disposed') this.listeners.add(listener);
    this.notify(listener, { type: 'snapshot', state: this.snapshot });
    let active = true;
    return {
      dispose: () => {
        if (!active) return;
        active = false;
        this.listeners.delete(listener);
      }
    };
  }

  loadInitial(): Promise<SettingsStoreInitialLoadResult> {
    if (this.phase === 'disposed') return Promise.resolve({ type: 'disposed' });
    if (!this.initialLoadPromise) this.initialLoadPromise = this.runInitialLoad();
    return this.initialLoadPromise;
  }

  /**
   * Synchronous write-through admission. Callers must not update their cache
   * when this returns false.
   */
  admitWrite(key: string, value: SettingsStoreWriteValue): boolean {
    if (this.phase === 'disposed') {
      this.emit({ type: 'write-rejected', key, value, reason: 'disposed', state: this.snapshot });
      return false;
    }
    if (this.local) {
      this.emit({ type: 'local-write-admitted', key, value, state: this.snapshot });
      return true;
    }
    if (this.phase !== 'ready') {
      this.emit({ type: 'write-rejected', key, value, reason: 'busy', state: this.snapshot });
      return false;
    }
    if (!this.available) {
      this.emit({ type: 'write-rejected', key, value, reason: 'unavailable', state: this.snapshot });
      return false;
    }
    return this.submitWrite(key, value, 'change');
  }

  pollNow(): Promise<SettingsStorePollResult> {
    const skipped = this.pollSkipReason();
    if (skipped) {
      const result = skipped === 'disposed'
        ? { type: 'disposed' as const }
        : { type: 'skipped' as const, reason: skipped };
      this.emit({ type: 'poll-skipped', reason: skipped, state: this.snapshot });
      return Promise.resolve(result);
    }
    if (this.pollPromise) return this.pollPromise;
    const poll = this.runPoll();
    this.pollPromise = poll;
    void poll.finally(() => {
      if (this.pollPromise === poll) this.pollPromise = null;
    });
    return poll;
  }

  retryFailedWrites(): number {
    if (this.phase === 'disposed' || this.local) return 0;
    const failures = [...this.failed.values()]
      .filter((failure) => this.desired.get(failure.key)?.revision === failure.revision);
    if (failures.length === 0) return 0;
    this.emit({
      type: 'retry-started',
      keys: failures.map((failure) => failure.key),
      state: this.snapshot
    });
    let accepted = 0;
    for (const failure of failures) {
      if (this.phase !== 'ready' || !this.available) break;
      if (this.submitWrite(failure.key, failure.value, 'retry')) accepted += 1;
    }
    return accepted;
  }

  async discardAndReload(): Promise<SettingsStoreReloadResult> {
    const skipped = this.reloadSkipReason();
    if (skipped) {
      this.emit({ type: 'reload-skipped', reason: skipped, state: this.snapshot });
      return skipped === 'disposed'
        ? { type: 'disposed' }
        : { type: 'skipped', reason: skipped };
    }

    this.phase = 'reloading';
    this.mutationGeneration += 1;
    const generation = this.mutationGeneration;
    const canCommit = () => this.reloadCanCommit(generation);
    this.emit({ type: 'reload-started', state: this.snapshot });
    try {
      const changed = await this.repository.poll(canCommit);
      if (this.isDisposed()) return { type: 'disposed' };
      if (changed == null || !canCommit()) {
        this.phase = 'ready';
        this.emit({ type: 'reload-fenced', state: this.snapshot });
        return { type: 'fenced' };
      }
      this.desired.clear();
      this.pending.clear();
      this.failed.clear();
      this.available = true;
      this.phase = 'ready';
      const changedKeys = [...changed];
      this.emit({ type: 'reload-succeeded', changedKeys, state: this.snapshot });
      return { type: 'reloaded', changedKeys };
    } catch (error) {
      if (this.isDisposed()) return { type: 'disposed' };
      if (!canCommit()) {
        this.phase = 'ready';
        this.emit({ type: 'reload-fenced', state: this.snapshot });
        return { type: 'fenced' };
      }
      this.phase = 'ready';
      this.emit({ type: 'reload-failed', error, state: this.snapshot });
      return { type: 'failed', error };
    }
  }

  /** Stop publishing state. The shared command coordinator remains app-owned. */
  dispose(): void {
    if (this.phase === 'disposed') return;
    this.phase = 'disposed';
    this.available = false;
    this.polling = false;
    this.mutationGeneration += 1;
    this.desired.clear();
    this.pending.clear();
    this.failed.clear();
    this.emit({ type: 'disposed', state: this.snapshot });
    this.listeners.clear();
  }

  private async runInitialLoad(): Promise<SettingsStoreInitialLoadResult> {
    if (this.local) {
      this.phase = 'ready';
      this.available = true;
      this.emit({ type: 'load-succeeded', state: this.snapshot });
      return { type: 'loaded' };
    }
    this.phase = 'loading';
    const generation = this.mutationGeneration;
    const canCommit = () => this.initialLoadCanCommit(generation);
    this.emit({ type: 'load-started', state: this.snapshot });
    try {
      const committed = await this.repository.load(canCommit);
      if (this.isDisposed()) return { type: 'disposed' };
      if (!committed || !canCommit()) {
        this.phase = 'ready';
        this.emit({ type: 'load-fenced', state: this.snapshot });
        return { type: 'fenced' };
      }
      this.available = true;
      this.phase = 'ready';
      this.emit({ type: 'load-succeeded', state: this.snapshot });
      return { type: 'loaded' };
    } catch (error) {
      if (this.isDisposed()) return { type: 'disposed' };
      if (!canCommit()) {
        this.phase = 'ready';
        this.emit({ type: 'load-fenced', state: this.snapshot });
        return { type: 'fenced' };
      }
      this.phase = 'ready';
      this.emit({ type: 'load-failed', error, state: this.snapshot });
      return { type: 'failed', error };
    }
  }

  private async runPoll(): Promise<SettingsStorePollResult> {
    this.polling = true;
    const generation = this.mutationGeneration;
    const canCommit = () => this.pollCanCommit(generation);
    this.emit({ type: 'poll-started', state: this.snapshot });
    try {
      const changed = await this.repository.poll(canCommit);
      if (this.phase === 'disposed') return { type: 'disposed' };
      const commitAllowed = canCommit();
      this.polling = false;
      if (changed == null || !commitAllowed) {
        this.emit({ type: 'poll-fenced', state: this.snapshot });
        return { type: 'fenced' };
      }
      this.available = true;
      const changedKeys = [...changed];
      this.emit({ type: 'poll-succeeded', changedKeys, state: this.snapshot });
      return { type: 'polled', changedKeys };
    } catch (error) {
      if (this.phase === 'disposed') return { type: 'disposed' };
      const commitAllowed = canCommit();
      this.polling = false;
      if (!commitAllowed) {
        this.emit({ type: 'poll-fenced', state: this.snapshot });
        return { type: 'fenced' };
      }
      this.emit({ type: 'poll-failed', error, state: this.snapshot });
      return { type: 'failed', error };
    }
  }

  private submitWrite(
    key: string,
    value: SettingsStoreWriteValue,
    source: 'change' | 'retry'
  ): boolean {
    const write: TrackedWrite = { key, value, revision: ++this.writeRevision };
    const previousDesired = this.desired.get(key);
    const previousPending = this.pending.get(key);
    const previousFailed = this.failed.get(key);
    const previousGeneration = this.mutationGeneration;
    this.mutationGeneration += 1;
    this.desired.set(key, write);
    this.pending.set(key, write);
    this.failed.delete(key);

    let submission: Promise<SettingsStoreCommandOutcome<void>>;
    try {
      submission = this.commands.latest(
        `store:${key}`,
        'value',
        () => this.repository.write(key, value)
      );
    } catch (error) {
      restoreMapEntry(this.desired, key, previousDesired);
      restoreMapEntry(this.pending, key, previousPending);
      restoreMapEntry(this.failed, key, previousFailed);
      this.mutationGeneration = previousGeneration;
      this.emit({ type: 'write-rejected', key, value, reason: 'scheduler', error, state: this.snapshot });
      return false;
    }

    this.emit({ type: 'write-accepted', write: copyWrite(write), source, state: this.snapshot });
    void submission.then(
      (outcome) => this.finishWrite(write, outcome),
      (error: unknown) => this.finishWrite(write, { status: 'failed', error })
    );
    return true;
  }

  private finishWrite(write: TrackedWrite, outcome: SettingsStoreCommandOutcome<void>): void {
    if (this.phase === 'disposed') return;
    const desired = this.desired.get(write.key);
    if (desired?.revision !== write.revision) {
      this.emit({ type: 'write-stale', write: copyWrite(write), outcome, state: this.snapshot });
      return;
    }
    if (this.pending.get(write.key)?.revision === write.revision) this.pending.delete(write.key);
    if (outcome.status === 'completed') {
      this.desired.delete(write.key);
      this.failed.delete(write.key);
      this.emit({ type: 'write-succeeded', write: copyWrite(write), state: this.snapshot });
      return;
    }
    const error = outcome.status === 'failed'
      ? outcome.error
      : new Error(`Settings store write ${outcome.status}`);
    this.failed.set(write.key, { ...write, error });
    this.emit({ type: 'write-failed', write: copyWrite(write), error, state: this.snapshot });
  }

  private initialLoadCanCommit(generation: number): boolean {
    return (
      this.phase === 'loading' &&
      this.mutationGeneration === generation &&
      this.pending.size === 0
    );
  }

  private pollCanCommit(generation: number): boolean {
    return (
      this.phase === 'ready' &&
      this.polling &&
      this.mutationGeneration === generation &&
      this.pending.size === 0
    );
  }

  private reloadCanCommit(generation: number): boolean {
    return (
      this.phase === 'reloading' &&
      this.mutationGeneration === generation &&
      this.pending.size === 0
    );
  }

  private isDisposed(): boolean {
    return this.phase === 'disposed';
  }

  private pollSkipReason(): 'local' | 'not-ready' | 'pending-writes' | 'disposed' | null {
    if (this.phase === 'disposed') return 'disposed';
    if (this.local) return 'local';
    if (this.phase !== 'ready') return 'not-ready';
    if (this.pending.size > 0) return 'pending-writes';
    return null;
  }

  private reloadSkipReason(): 'local' | 'not-ready' | 'pending-writes' | 'disposed' | null {
    if (this.phase === 'disposed') return 'disposed';
    if (this.local) return 'local';
    if (this.phase !== 'ready') return 'not-ready';
    if (this.pending.size > 0) return 'pending-writes';
    return null;
  }

  private emit(event: SettingsStoreSyncEvent): void {
    for (const listener of [...this.listeners]) this.notify(listener, event);
  }

  private notify(listener: (event: SettingsStoreSyncEvent) => void, event: SettingsStoreSyncEvent): void {
    try {
      listener(event);
    } catch {
      // Observers cannot interrupt store synchronization or lifecycle cleanup.
    }
  }
}

function sortedWrites(writes: Iterable<TrackedWrite>): SettingsStoreWriteSnapshot[] {
  return [...writes]
    .map(copyWrite)
    .sort((left, right) => left.key.localeCompare(right.key));
}

function copyWrite(write: TrackedWrite): SettingsStoreWriteSnapshot {
  return { key: write.key, value: write.value, revision: write.revision };
}

function restoreMapEntry<Value>(map: Map<string, Value>, key: string, value: Value | undefined): void {
  if (value === undefined) map.delete(key);
  else map.set(key, value);
}
