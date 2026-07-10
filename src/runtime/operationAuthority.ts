import type { Disposable } from './disposableScope';

export type OperationCommitResult<Value> =
  | { status: 'committed'; value: Value }
  | { status: 'stale' };

type SynchronousResult<Value> = Value extends PromiseLike<unknown> ? never : Value;

export interface OperationLease {
  readonly generation: number;
  readonly subjectKey: string;
  readonly signal: AbortSignal;
  readonly isCurrent: boolean;
  /** Execute one synchronous state transition only if this lease still owns the lane. */
  commit<Value>(transition: () => SynchronousResult<Value>): OperationCommitResult<Value>;
  /** Release a successfully settled lease without invalidating a newer owner. */
  finish(): void;
}

interface CurrentOperation {
  readonly token: symbol;
  readonly generation: number;
  readonly subjectKey: string;
  readonly controller: AbortController;
}

/**
 * Semantic ownership for an async UI workflow.
 *
 * A lane has at most one current lease. Starting or invalidating a lease aborts
 * the previous signal for cleanup, but correctness comes from the unforgeable
 * token checked at `commit()`. Effects may ignore AbortSignal and still cannot
 * mutate state after they lose authority.
 */
export class OperationAuthority implements Disposable {
  private generation = 0;
  private current: CurrentOperation | null = null;
  private disposed = false;

  get currentSubjectKey(): string | null {
    return this.current?.subjectKey ?? null;
  }

  begin(subjectKey: string): OperationLease {
    if (this.disposed) return staleLease(subjectKey, this.generation);
    this.invalidateCurrent(new Error(`Superseded by ${subjectKey}`));
    const operation: CurrentOperation = {
      token: Symbol(subjectKey),
      generation: ++this.generation,
      subjectKey,
      controller: new AbortController()
    };
    this.current = operation;
    return new AuthorityLease(this, operation);
  }

  invalidate(reason: unknown = new Error('Operation invalidated')): void {
    if (this.disposed) return;
    this.invalidateCurrent(reason);
    this.generation += 1;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.invalidateCurrent(new Error('Operation authority disposed'));
    this.generation += 1;
  }

  owns(operation: CurrentOperation): boolean {
    return !this.disposed &&
      !operation.controller.signal.aborted &&
      this.current?.token === operation.token;
  }

  commit<Value>(
    operation: CurrentOperation,
    transition: () => SynchronousResult<Value>
  ): OperationCommitResult<Value> {
    if (!this.owns(operation)) return { status: 'stale' };
    // The conditional signature rejects async callbacks in TypeScript. Check
    // native async functions before invocation as a defensive runtime fence for
    // untyped/cast callers, so even their synchronous prefix cannot mutate.
    if (transition.constructor.name === 'AsyncFunction') {
      throw new Error('OperationAuthority commit transitions must be synchronous');
    }
    const value = transition();
    if (isPromiseLike(value)) {
      // A cast/non-async thenable factory bypassed the type fence. Observe any
      // rejection before reporting the contract violation.
      void Promise.resolve(value).catch(() => undefined);
      throw new Error('OperationAuthority commit transitions must be synchronous');
    }
    return { status: 'committed', value };
  }

  finish(operation: CurrentOperation): void {
    if (this.current?.token === operation.token) this.current = null;
  }

  private invalidateCurrent(reason: unknown): void {
    const current = this.current;
    this.current = null;
    if (!current || current.controller.signal.aborted) return;
    try {
      current.controller.abort(reason);
    } catch {
      current.controller.abort();
    }
  }
}

class AuthorityLease implements OperationLease {
  constructor(
    private readonly authority: OperationAuthority,
    private readonly operation: CurrentOperation
  ) {}

  get generation(): number {
    return this.operation.generation;
  }

  get subjectKey(): string {
    return this.operation.subjectKey;
  }

  get signal(): AbortSignal {
    return this.operation.controller.signal;
  }

  get isCurrent(): boolean {
    return this.authority.owns(this.operation);
  }

  commit<Value>(transition: () => SynchronousResult<Value>): OperationCommitResult<Value> {
    return this.authority.commit(this.operation, transition);
  }

  finish(): void {
    this.authority.finish(this.operation);
  }
}

function staleLease(subjectKey: string, generation: number): OperationLease {
  const controller = new AbortController();
  controller.abort(new Error('Operation authority disposed'));
  return {
    generation,
    subjectKey,
    signal: controller.signal,
    isCurrent: false,
    commit: () => ({ status: 'stale' }),
    finish: () => undefined
  };
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (typeof value === 'object' && value != null) || typeof value === 'function'
    ? typeof (value as { then?: unknown }).then === 'function'
    : false;
}
