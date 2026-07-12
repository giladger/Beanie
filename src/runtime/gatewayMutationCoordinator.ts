import type { Disposable } from './disposableScope';
import {
  WorkflowCommandCoordinator,
  type WorkflowCommandOutcome,
  type WorkflowCommandSnapshot
} from './workflowCommandCoordinator';

export type GatewayMutationOutcome<Value> = WorkflowCommandOutcome<Value>;

/**
 * Submission-only view of the shared gateway mutation scheduler.
 *
 * Feature controllers depend on this port instead of knowing the lower-level
 * workflow-command policy objects. The application runtime owns the concrete
 * coordinator and its asynchronous drain.
 */
export interface GatewayMutationPort<ResourceKey = string> {
  exact<Value>(
    resourceKey: ResourceKey,
    run: () => Value | PromiseLike<Value>
  ): Promise<GatewayMutationOutcome<Value>>;

  latest<Value>(
    resourceKey: ResourceKey,
    coalesceKey: string,
    run: () => Value | PromiseLike<Value>
  ): Promise<GatewayMutationOutcome<Value>>;
}

/**
 * Application-facing owner of the one shared gateway mutation coordinator.
 *
 * Exact mutations remain FIFO barriers. Latest mutations may replace queued
 * work with the same coalescing key, but never across an exact mutation. The
 * wrapper deliberately does not expose the underlying `submit` method, so
 * feature code cannot construct new scheduling policies.
 */
export class GatewayMutationCoordinator<ResourceKey = string>
implements GatewayMutationPort<ResourceKey>, Disposable {
  private readonly commands = new WorkflowCommandCoordinator<ResourceKey>();

  get snapshot(): WorkflowCommandSnapshot<ResourceKey> {
    return this.commands.snapshot;
  }

  exact<Value>(
    resourceKey: ResourceKey,
    run: () => Value | PromiseLike<Value>
  ): Promise<GatewayMutationOutcome<Value>> {
    return this.commands.submit(resourceKey, { policy: 'exact-fifo' }, run);
  }

  latest<Value>(
    resourceKey: ResourceKey,
    coalesceKey: string,
    run: () => Value | PromiseLike<Value>
  ): Promise<GatewayMutationOutcome<Value>> {
    return this.commands.submit(resourceKey, { policy: 'latest-wins', coalesceKey }, run);
  }

  isPending(resourceKey: ResourceKey): boolean {
    return this.snapshot.resources.some((resource) => resource.key === resourceKey);
  }

  cancelQueued(resourceKey: ResourceKey): number {
    return this.commands.cancelQueued(resourceKey);
  }

  subscribe(listener: (snapshot: WorkflowCommandSnapshot<ResourceKey>) => void): Disposable {
    return this.commands.subscribe(listener);
  }

  /** Drop queued/future mutations while allowing already-started work to settle. */
  dispose(): void {
    this.commands.dispose();
  }

  /** Dispose and resolve only after all already-started gateway work has settled. */
  disposeAndWait(): Promise<void> {
    return this.commands.disposeAndWait();
  }
}
