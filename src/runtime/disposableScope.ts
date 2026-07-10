export interface Disposable {
  dispose(): void;
}

export interface DisposableScopeRuntime {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(callback: () => void, intervalMs: number): unknown;
  clearInterval(handle: unknown): void;
  requestAnimationFrame(callback: FrameRequestCallback): unknown;
  cancelAnimationFrame(handle: unknown): void;
}

interface BrowserAnimationHandle {
  kind: 'animation-frame' | 'timeout';
  handle: unknown;
}

const browserRuntime: DisposableScopeRuntime = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
  setInterval: (callback, intervalMs) => globalThis.setInterval(callback, intervalMs),
  clearInterval: (handle) => globalThis.clearInterval(handle as ReturnType<typeof globalThis.setInterval>),
  requestAnimationFrame: (callback): BrowserAnimationHandle => {
    if (typeof globalThis.requestAnimationFrame === 'function') {
      return { kind: 'animation-frame', handle: globalThis.requestAnimationFrame(callback) };
    }
    return {
      kind: 'timeout',
      handle: globalThis.setTimeout(() => callback(globalThis.performance?.now() ?? Date.now()), 16)
    };
  },
  cancelAnimationFrame: (opaqueHandle) => {
    const { kind, handle } = opaqueHandle as BrowserAnimationHandle;
    if (kind === 'animation-frame') {
      globalThis.cancelAnimationFrame(handle as number);
    } else {
      globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
    }
  }
};

class CleanupRegistration implements Disposable {
  private active = true;

  constructor(
    private readonly cleanup: () => void,
    private readonly releaseFromScope: () => void
  ) {}

  get isActive(): boolean {
    return this.active;
  }

  dispose(): void {
    if (!this.release()) return;
    this.cleanup();
  }

  /** Complete a one-shot resource without invoking its cancellation callback. */
  release(): boolean {
    if (!this.active) return false;
    this.active = false;
    this.releaseFromScope();
    return true;
  }
}

/**
 * Hierarchical ownership for browser work with a finite lifetime.
 *
 * Disposing a scope invalidates and aborts it first, then releases its own
 * resources before recursively disposing child scopes. This outside-in order
 * guarantees that no outer callback remains live while descendants tear down.
 */
export class DisposableScope implements Disposable {
  private readonly controller = new AbortController();
  private readonly resources = new Set<CleanupRegistration>();
  private readonly children = new Set<DisposableScope>();
  private disposed = false;
  private detachFromParent: (() => void) | null = null;

  constructor(private readonly runtime: DisposableScopeRuntime = browserRuntime) {}

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  child(): DisposableScope {
    const child = new DisposableScope(this.runtime);
    if (this.disposed) {
      child.dispose();
      return child;
    }
    this.children.add(child);
    child.detachFromParent = () => this.children.delete(child);
    return child;
  }

  /** Own a cleanup function or disposable, returning an idempotent release. */
  own(resource: Disposable | (() => void)): Disposable {
    return this.register(typeof resource === 'function' ? resource : () => resource.dispose());
  }

  setTimeout(callback: () => void, delayMs: number): Disposable {
    let scheduled = false;
    let handle: unknown;
    const registration = this.register(() => {
      if (scheduled) this.runtime.clearTimeout(handle);
    });
    if (!registration.isActive) return registration;

    try {
      handle = this.runtime.setTimeout(() => {
        if (!registration.release() || this.disposed) return;
        callback();
      }, delayMs);
      scheduled = true;
      return registration;
    } catch (error) {
      registration.release();
      throw error;
    }
  }

  setInterval(callback: () => void, intervalMs: number): Disposable {
    let scheduled = false;
    let handle: unknown;
    const registration = this.register(() => {
      if (scheduled) this.runtime.clearInterval(handle);
    });
    if (!registration.isActive) return registration;

    try {
      handle = this.runtime.setInterval(() => {
        if (!registration.isActive || this.disposed) return;
        callback();
      }, intervalMs);
      scheduled = true;
      return registration;
    } catch (error) {
      registration.release();
      throw error;
    }
  }

  requestAnimationFrame(callback: FrameRequestCallback): Disposable {
    let scheduled = false;
    let handle: unknown;
    const registration = this.register(() => {
      if (scheduled) this.runtime.cancelAnimationFrame(handle);
    });
    if (!registration.isActive) return registration;

    try {
      handle = this.runtime.requestAnimationFrame((timestamp) => {
        if (!registration.release() || this.disposed) return;
        callback(timestamp);
      });
      scheduled = true;
      return registration;
    } catch (error) {
      registration.release();
      throw error;
    }
  }

  listen(
    target: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ): Disposable {
    const guardedListener: EventListener = (event) => {
      if (this.disposed) return;
      if (typeof listener === 'function') listener.call(target, event);
      else listener.handleEvent(event);
    };
    let attached = false;
    const registration = this.register(() => {
      if (attached) target.removeEventListener(type, guardedListener, options);
    });
    if (!registration.isActive) return registration;

    try {
      target.addEventListener(type, guardedListener, options);
      attached = true;
      return registration;
    } catch (error) {
      registration.release();
      throw error;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    const errors: unknown[] = [];
    const disposeSafely = (disposable: Disposable): void => {
      try {
        disposable.dispose();
      } catch (error) {
        errors.push(error);
      }
    };

    try {
      this.controller.abort();
    } catch (error) {
      errors.push(error);
    }

    for (const resource of [...this.resources].reverse()) disposeSafely(resource);
    for (const child of [...this.children].reverse()) disposeSafely(child);
    this.detachFromParent?.();
    this.detachFromParent = null;

    if (errors.length > 0) throw errors[0];
  }

  private register(cleanup: () => void): CleanupRegistration {
    let registration: CleanupRegistration;
    registration = new CleanupRegistration(cleanup, () => this.resources.delete(registration));
    if (this.disposed) registration.dispose();
    else this.resources.add(registration);
    return registration;
  }
}
