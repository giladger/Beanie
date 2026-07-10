/**
 * A clock/timer boundary for render channels. Production uses the browser
 * clock; tests can supply a deterministic scheduler without installing fake
 * globals.
 */
export interface RenderChannelScheduler {
  now(): number;
  schedule(callback: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

export interface RenderChannelOptions<Model> {
  /** Minimum time between actual commits. The first offered model is immediate. */
  minIntervalMs: number;
  /** The sole side-effect boundary: normally an island renderer's DOM commit. */
  commit(model: Model): void;
  /** Models equal to the last commit do not consume the render budget. */
  equals?: (previous: Model, next: Model) => boolean;
  scheduler?: RenderChannelScheduler;
}

const browserScheduler: RenderChannelScheduler = {
  now: () => globalThis.performance?.now() ?? Date.now(),
  schedule: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  cancel: (handle) => {
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
  }
};

/**
 * Bounds a stream of offered models to one commit per interval.
 *
 * The channel has a single pending slot, so producers can never create a
 * queue: a newer offer replaces an older pending model. A trailing commit
 * makes the latest model observable, while equality gating avoids touching
 * the owned render target when presentation state is unchanged.
 */
export class RenderChannel<Model> {
  private readonly minIntervalMs: number;
  private readonly commitModel: (model: Model) => void;
  private readonly equals: (previous: Model, next: Model) => boolean;
  private readonly scheduler: RenderChannelScheduler;

  private disposed = false;
  private timerArmed = false;
  private timerHandle: unknown;
  private hasPending = false;
  private pendingModel: Model | undefined;
  private hasCommitted = false;
  private committedModel: Model | undefined;
  private lastCommitMs: number | null = null;
  private committing = false;
  private revision = 0;

  constructor(options: RenderChannelOptions<Model>) {
    if (!Number.isFinite(options.minIntervalMs) || options.minIntervalMs <= 0) {
      throw new Error('RenderChannel minIntervalMs must be a finite positive number');
    }
    this.minIntervalMs = options.minIntervalMs;
    this.commitModel = options.commit;
    this.equals = options.equals ?? Object.is;
    this.scheduler = options.scheduler ?? browserScheduler;
  }

  /**
   * Offers the latest complete model. The first offer commits immediately;
   * subsequent offers coalesce behind the interval boundary.
   */
  offer(model: Model): void {
    if (this.disposed) return;

    // A commit sink may synchronously publish a newer model. Keep it in the
    // pending slot; comparing it with the previously visible model here would
    // be wrong because the in-progress commit is about to replace that model.
    if (this.committing) {
      this.pendingModel = model;
      this.hasPending = true;
      return;
    }

    // If the stream reverts to what is already visible, it supersedes any
    // intermediate pending model. There is then nothing useful to wake for.
    if (
      this.hasCommitted &&
      this.equals(this.committedModel as Model, model)
    ) {
      this.hasPending = false;
      this.pendingModel = undefined;
      this.cancelTimer();
      return;
    }

    this.pendingModel = model;
    this.hasPending = true;

    if (this.lastCommitMs == null) {
      this.flush();
      return;
    }

    const elapsedMs = this.scheduler.now() - this.lastCommitMs;
    if (elapsedMs >= this.minIntervalMs) {
      this.flush();
      return;
    }
    this.armTimer(this.minIntervalMs - elapsedMs);
  }

  /** Immediately commits the pending latest model, if it differs. */
  flush(): void {
    if (this.disposed || this.committing || !this.hasPending) return;
    this.cancelTimer();

    const model = this.pendingModel as Model;
    this.pendingModel = undefined;
    this.hasPending = false;

    if (
      this.hasCommitted &&
      this.equals(this.committedModel as Model, model)
    ) {
      return;
    }

    const commitMs = this.scheduler.now();
    const revision = this.revision;
    this.committing = true;
    try {
      this.commitModel(model);
    } catch (error) {
      // A failed sink did not make this model visible. Preserve it for an
      // explicit retry unless the sink synchronously offered something newer.
      if (!this.disposed && revision === this.revision && !this.hasPending) {
        this.pendingModel = model;
        this.hasPending = true;
      }
      throw error;
    } finally {
      this.committing = false;
    }

    // A sink is allowed to dispose its owner while committing. Do not retain
    // the model or revive pending work after that lifecycle boundary.
    if (this.disposed) return;
    if (revision !== this.revision) {
      this.schedulePending();
      return;
    }
    this.committedModel = model;
    this.hasCommitted = true;
    this.lastCommitMs = commitMs;
    this.schedulePending();
  }

  /** Permanently cancels pending work. Offers and timer callbacks become no-ops. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.revision += 1;
    this.hasPending = false;
    this.pendingModel = undefined;
    this.hasCommitted = false;
    this.committedModel = undefined;
    this.lastCommitMs = null;
    this.cancelTimer();
  }

  /**
   * Starts a fresh semantic stream without disposing the reusable channel.
   * Pending and equality history from the old session cannot cross the reset.
   */
  reset(): void {
    if (this.disposed) return;
    this.revision += 1;
    this.hasPending = false;
    this.pendingModel = undefined;
    this.hasCommitted = false;
    this.committedModel = undefined;
    this.lastCommitMs = null;
    this.cancelTimer();
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  private armTimer(delayMs: number): void {
    if (this.timerArmed) return;
    this.timerArmed = true;
    this.timerHandle = this.scheduler.schedule(() => {
      this.timerArmed = false;
      this.timerHandle = undefined;
      if (this.disposed || !this.hasPending || this.lastCommitMs == null) return;

      // A custom scheduler is allowed to wake early. Preserve the rate bound
      // instead of assuming every timer has browser-perfect timing.
      const elapsedMs = this.scheduler.now() - this.lastCommitMs;
      if (elapsedMs < this.minIntervalMs) {
        this.armTimer(this.minIntervalMs - elapsedMs);
        return;
      }
      this.flush();
    }, Math.max(0, delayMs));
  }

  private schedulePending(): void {
    if (!this.hasPending) return;
    if (this.lastCommitMs == null) {
      this.flush();
      return;
    }
    const pending = this.pendingModel as Model;
    if (
      this.hasCommitted &&
      this.equals(this.committedModel as Model, pending)
    ) {
      this.hasPending = false;
      this.pendingModel = undefined;
      this.cancelTimer();
      return;
    }
    const elapsedMs = this.scheduler.now() - this.lastCommitMs;
    if (elapsedMs >= this.minIntervalMs) {
      this.flush();
    } else {
      this.armTimer(this.minIntervalMs - elapsedMs);
    }
  }

  private cancelTimer(): void {
    if (!this.timerArmed) return;
    this.scheduler.cancel(this.timerHandle);
    this.timerArmed = false;
    this.timerHandle = undefined;
  }
}
