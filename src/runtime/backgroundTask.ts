import type { Disposable } from './disposableScope';
import type { PresentationActivityTarget } from './presentationActivity';

export interface BackgroundTaskScheduler {
  schedule(callback: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

export interface BackgroundTaskOptions {
  intervalMs: number;
  run(): void | Promise<void>;
  scheduler?: BackgroundTaskScheduler;
  onError?: (error: unknown) => void;
}

const browserScheduler: BackgroundTaskScheduler = {
  schedule: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  cancel: (handle) => {
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
  }
};

/**
 * A lifecycle-aware, self-scheduling single-flight task. Unlike setInterval,
 * the next wake is armed only after the current run settles, so slow gateway
 * work can never overlap itself. Resuming performs one catch-up run.
 */
export class BackgroundTask implements Disposable, PresentationActivityTarget {
  private readonly intervalMs: number;
  private readonly runTask: () => void | Promise<void>;
  private readonly scheduler: BackgroundTaskScheduler;
  private readonly onError: (error: unknown) => void;
  private started = false;
  private suspended = false;
  private running = false;
  private runQueued = false;
  private disposed = false;
  private timerArmed = false;
  private timerHandle: unknown;

  constructor(options: BackgroundTaskOptions) {
    if (!Number.isFinite(options.intervalMs) || options.intervalMs <= 0) {
      throw new Error('BackgroundTask intervalMs must be a finite positive number');
    }
    this.intervalMs = options.intervalMs;
    this.runTask = options.run;
    this.scheduler = options.scheduler ?? browserScheduler;
    this.onError = options.onError ?? ((error) => console.warn('[Beanie] Background task failed', error));
  }

  get isRunning(): boolean {
    return this.running;
  }

  get isSuspended(): boolean {
    return this.suspended;
  }

  start(): void {
    if (this.disposed || this.started) return;
    this.started = true;
    if (!this.suspended) this.scheduleNext();
  }

  /** Stop scheduling without disposing, so a later outage can restart it. */
  stop(): void {
    if (this.disposed || !this.started) return;
    this.started = false;
    this.runQueued = false;
    this.cancelTimer();
  }

  /** Request a run; concurrent requests collapse into one trailing catch-up. */
  trigger(): void {
    if (this.disposed || !this.started || this.suspended) return;
    this.cancelTimer();
    if (this.running) {
      this.runQueued = true;
      return;
    }
    void this.execute();
  }

  suspend(): void {
    if (this.disposed || this.suspended) return;
    this.suspended = true;
    this.runQueued = false;
    this.cancelTimer();
  }

  resume(): void {
    if (this.disposed || !this.suspended) return;
    this.suspended = false;
    if (this.started) this.trigger();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.started = false;
    this.suspended = true;
    this.runQueued = false;
    this.cancelTimer();
  }

  private async execute(): Promise<void> {
    if (this.running || this.disposed || this.suspended || !this.started) return;
    this.running = true;
    try {
      await this.runTask();
    } catch (error) {
      this.onError(error);
    } finally {
      this.running = false;
      if (this.disposed || this.suspended || !this.started) return;
      if (this.runQueued) {
        this.runQueued = false;
        void this.execute();
      } else {
        this.scheduleNext();
      }
    }
  }

  private scheduleNext(): void {
    if (this.timerArmed || this.disposed || this.suspended || !this.started) return;
    try {
      this.timerArmed = true;
      this.timerHandle = this.scheduler.schedule(() => {
        this.timerArmed = false;
        this.timerHandle = undefined;
        if (this.disposed || this.suspended || !this.started) return;
        void this.execute();
      }, this.intervalMs);
    } catch (error) {
      this.timerArmed = false;
      this.timerHandle = undefined;
      this.onError(error);
    }
  }

  private cancelTimer(): void {
    if (!this.timerArmed) return;
    this.scheduler.cancel(this.timerHandle);
    this.timerArmed = false;
    this.timerHandle = undefined;
  }
}
