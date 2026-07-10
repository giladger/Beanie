import type { Disposable } from './disposableScope';

export type WorkflowCommandOptions =
  | { policy: 'exact-fifo' }
  | { policy: 'latest-wins'; coalesceKey: string };

export type WorkflowCommandOutcome<Value> =
  | { status: 'completed'; value: Value }
  | { status: 'failed'; error: unknown }
  | { status: 'superseded' }
  | { status: 'canceled' }
  | { status: 'disposed' };

export interface WorkflowCommandDescriptor {
  policy: WorkflowCommandOptions['policy'];
  coalesceKey: string | null;
}

export interface WorkflowCommandResourceSnapshot<ResourceKey> {
  key: ResourceKey;
  inFlight: WorkflowCommandDescriptor | null;
  queued: readonly WorkflowCommandDescriptor[];
}

export interface WorkflowCommandSnapshot<ResourceKey> {
  disposed: boolean;
  pendingCount: number;
  inFlightCount: number;
  queuedCount: number;
  resources: readonly WorkflowCommandResourceSnapshot<ResourceKey>[];
}

interface CommandEntry {
  options: WorkflowCommandOptions;
  run: () => unknown | PromiseLike<unknown>;
  resolve(outcome: WorkflowCommandOutcome<unknown>): void;
}

interface ResourceLane {
  inFlight: CommandEntry | null;
  queue: CommandEntry[];
}

/**
 * Serializes workflow mutations per resource without conflating two distinct
 * command semantics:
 *
 * - `exact-fifo` preserves every physical action in submission order.
 * - `latest-wins` keeps only the newest queued command for a coalescing key.
 *
 * Cancellation only removes queued work. Once a command is in flight its
 * underlying operation is allowed to settle and reports its real outcome.
 */
export class WorkflowCommandCoordinator<ResourceKey = string> implements Disposable {
  private readonly lanes = new Map<ResourceKey, ResourceLane>();
  private readonly listeners = new Set<(snapshot: WorkflowCommandSnapshot<ResourceKey>) => void>();
  private readonly idleWaiters = new Set<() => void>();
  private disposed = false;

  get snapshot(): WorkflowCommandSnapshot<ResourceKey> {
    const resources: WorkflowCommandResourceSnapshot<ResourceKey>[] = [];
    let inFlightCount = 0;
    let queuedCount = 0;
    for (const [key, lane] of this.lanes) {
      if (lane.inFlight) inFlightCount += 1;
      queuedCount += lane.queue.length;
      resources.push({
        key,
        inFlight: lane.inFlight ? descriptor(lane.inFlight.options) : null,
        queued: lane.queue.map((command) => descriptor(command.options))
      });
    }
    return {
      disposed: this.disposed,
      pendingCount: inFlightCount + queuedCount,
      inFlightCount,
      queuedCount,
      resources
    };
  }

  submit<Value>(
    resourceKey: ResourceKey,
    options: WorkflowCommandOptions,
    run: () => Value | PromiseLike<Value>
  ): Promise<WorkflowCommandOutcome<Value>> {
    if (this.disposed) return Promise.resolve({ status: 'disposed' });

    return new Promise<WorkflowCommandOutcome<Value>>((resolve) => {
      const command: CommandEntry = {
        options,
        run,
        resolve: (outcome) => resolve(outcome as WorkflowCommandOutcome<Value>)
      };
      const lane = this.lanes.get(resourceKey) ?? { inFlight: null, queue: [] };
      this.lanes.set(resourceKey, lane);

      if (options.policy === 'latest-wins') {
        for (let index = lane.queue.length - 1; index >= 0; index -= 1) {
          const queued = lane.queue[index]!;
          // Exact commands are ordering barriers. Coalescing across one could
          // move a desired setting from before a physical action to after it.
          if (queued.options.policy === 'exact-fifo') break;
          if (queued.options.policy !== 'latest-wins' || queued.options.coalesceKey !== options.coalesceKey) continue;
          lane.queue.splice(index, 1);
          queued.resolve({ status: 'superseded' });
        }
      }

      lane.queue.push(command);
      this.startNext(resourceKey, lane);
      this.emit();
    });
  }

  /** Cancel queued commands for a resource without touching its in-flight work. */
  cancelQueued(resourceKey: ResourceKey): number {
    const lane = this.lanes.get(resourceKey);
    if (!lane || lane.queue.length === 0) return 0;
    const canceled = lane.queue.splice(0);
    for (const command of canceled) command.resolve({ status: 'canceled' });
    if (!lane.inFlight) this.lanes.delete(resourceKey);
    this.emit();
    return canceled.length;
  }

  subscribe(listener: (snapshot: WorkflowCommandSnapshot<ResourceKey>) => void): Disposable {
    let active = true;
    if (!this.disposed) this.listeners.add(listener);
    this.notify(listener);
    return {
      dispose: () => {
        if (!active) return;
        active = false;
        this.listeners.delete(listener);
      }
    };
  }

  /**
   * Prevent all queued and future commands. In-flight commands remain visible
   * in `snapshot` and resolve with their actual completed/failed outcome.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [key, lane] of this.lanes) {
      const queued = lane.queue.splice(0);
      for (const command of queued) command.resolve({ status: 'disposed' });
      if (!lane.inFlight) this.lanes.delete(key);
    }
    this.emit();
    this.listeners.clear();
    this.resolveIdleWaitersIfIdle();
  }

  /** Dispose queued work and resolve once every already-started command settles. */
  disposeAndWait(): Promise<void> {
    this.dispose();
    if (this.snapshot.inFlightCount === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.add(resolve));
  }

  private startNext(resourceKey: ResourceKey, lane: ResourceLane): void {
    if (this.disposed || lane.inFlight || lane.queue.length === 0) return;
    const command = lane.queue.shift()!;
    lane.inFlight = command;

    let result: unknown | PromiseLike<unknown>;
    try {
      result = command.run();
    } catch (error) {
      this.finish(resourceKey, lane, command, { status: 'failed', error });
      return;
    }
    Promise.resolve(result).then(
      (value) => this.finish(resourceKey, lane, command, { status: 'completed', value }),
      (error: unknown) => this.finish(resourceKey, lane, command, { status: 'failed', error })
    );
  }

  private finish(
    resourceKey: ResourceKey,
    lane: ResourceLane,
    command: CommandEntry,
    outcome: WorkflowCommandOutcome<unknown>
  ): void {
    if (lane.inFlight !== command) return;
    lane.inFlight = null;
    command.resolve(outcome);
    if (!this.disposed) this.startNext(resourceKey, lane);
    if (!lane.inFlight && lane.queue.length === 0) this.lanes.delete(resourceKey);
    this.emit();
    this.resolveIdleWaitersIfIdle();
  }

  private emit(): void {
    if (this.listeners.size === 0) return;
    const snapshot = this.snapshot;
    for (const listener of [...this.listeners]) this.notify(listener, snapshot);
  }

  private notify(
    listener: (snapshot: WorkflowCommandSnapshot<ResourceKey>) => void,
    snapshot = this.snapshot
  ): void {
    try {
      listener(snapshot);
    } catch {
      // Observers must not be able to interrupt command execution or teardown.
    }
  }

  private resolveIdleWaitersIfIdle(): void {
    if ([...this.lanes.values()].some((lane) => lane.inFlight != null)) return;
    for (const resolve of this.idleWaiters) resolve();
    this.idleWaiters.clear();
  }
}

function descriptor(options: WorkflowCommandOptions): WorkflowCommandDescriptor {
  return {
    policy: options.policy,
    coalesceKey: options.policy === 'latest-wins' ? options.coalesceKey : null
  };
}
