import type { Disposable } from './disposableScope';

export interface PresentationActivityTarget {
  suspend(): void;
  resume(): void;
}

export interface PresentationActivityOptions {
  onTargetError?: (error: unknown) => void;
}

class ActivityRegistration implements Disposable {
  private active = true;

  constructor(private readonly release: () => void) {}

  dispose(): void {
    if (!this.active) return;
    this.active = false;
    this.release();
  }
}

/**
 * Semantic visibility for application surfaces. DOM connectivity is not
 * enough: Beanie keeps the workbench mounted beneath its sleep overlay. This
 * coordinator makes hidden work explicitly suspendable without destroying the
 * latest in-memory presentation model.
 */
export class PresentationActivityCoordinator implements Disposable {
  private readonly targets = new Set<PresentationActivityTarget>();
  private suspended = false;
  private disposed = false;
  private readonly onTargetError: (error: unknown) => void;

  constructor(options: PresentationActivityOptions = {}) {
    this.onTargetError = options.onTargetError ?? ((error) => {
      console.error('[Beanie] Presentation activity target failed', error);
    });
  }

  get isSuspended(): boolean {
    return this.suspended;
  }

  add(target: PresentationActivityTarget): Disposable {
    if (this.disposed) {
      target.suspend();
      return new ActivityRegistration(() => undefined);
    }
    this.targets.add(target);
    if (this.suspended) this.callTarget(() => target.suspend());
    return new ActivityRegistration(() => this.targets.delete(target));
  }

  setSuspended(suspended: boolean): void {
    if (this.disposed || suspended === this.suspended) return;
    this.suspended = suspended;
    const targets = [...this.targets];
    if (suspended) {
      for (let index = targets.length - 1; index >= 0; index -= 1) {
        this.callTarget(() => targets[index]!.suspend());
      }
      return;
    }
    for (const target of targets) this.callTarget(() => target.resume());
  }

  dispose(): void {
    if (this.disposed) return;
    if (!this.suspended) {
      const targets = [...this.targets];
      for (let index = targets.length - 1; index >= 0; index -= 1) {
        this.callTarget(() => targets[index]!.suspend());
      }
    }
    this.suspended = true;
    this.disposed = true;
    this.targets.clear();
  }

  private callTarget(action: () => void): void {
    try {
      action();
    } catch (error) {
      this.onTargetError(error);
    }
  }
}
