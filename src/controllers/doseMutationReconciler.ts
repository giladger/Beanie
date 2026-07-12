import type { BeanBatch } from '../api/types';
import {
  DurableMutationOutbox,
  IdempotencyConflictError,
  legacyPendingDoseIdempotencyKey,
  pendingDoseIdempotencyKey,
  type DurableMutationOutboxOptions,
  type MutationOutboxDurability
} from '../domain/mutationOutbox';
import { resolvePendingDose, type PendingDose } from '../domain/pendingDoses';
import { BackgroundTask, type BackgroundTaskScheduler } from '../runtime/backgroundTask';
import { beanInventoryMutationKey } from './beanInventoryController';

export const PENDING_DOSE_MUTATION_KIND = 'pending-dose-deduction';
export const DOSE_MUTATION_LEASE_MS = 5 * 60 * 1000;
export const DOSE_MUTATION_RECONCILE_INTERVAL_MS = 60_000;
export const DOSE_MUTATION_TOMBSTONE_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const DOSE_MUTATION_WORKER_ID = 'beanie-dose-reconciler';
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 60 * 60 * 1000;
const TOMBSTONE_PRUNE_LIMIT = 500;
const MAX_VOLATILE_ENQUEUES = 100;

export interface EnqueueDoseMutationInput extends PendingDose {
  shotId: string;
  /** Process-local optimistic field revision; deliberately not journal payload. */
  projectionRevision?: number;
}

export interface DoseMutationEnqueueResult {
  inserted: boolean;
  /** `volatile` means accepted in the bounded live intake but not yet persistent. */
  durability: MutationOutboxDurability | 'volatile';
}

export interface DoseMutationRetry {
  entry: PendingDose;
  error: unknown;
  attemptCount: number;
  retryAt: Date;
}

export interface DoseMutationReconcilerDependencies {
  readBatch(id: string): Promise<BeanBatch | null>;
  updateBatch(
    id: string,
    patch: Partial<BeanBatch>,
    options: { idempotencyKey: string }
  ): Promise<BeanBatch>;
  runExactAggregate<Value>(
    aggregateKey: string,
    run: () => Value | PromiseLike<Value>
  ): Promise<Value>;
  readLegacy(): readonly PendingDose[];
  clearLegacy(): void;
  now(): Date;
  onBatchSaved(
    batch: BeanBatch,
    entry: PendingDose,
    resolvedRemaining: number,
    projectionRevision: number | null
  ): void;
  onRetryScheduled(retry: DoseMutationRetry): void;
  onWorkerError?(error: unknown): void;
}

export interface DoseMutationReconcilerOptions {
  outbox?: Omit<DurableMutationOutboxOptions, 'now'>;
  scheduler?: BackgroundTaskScheduler;
}

interface ReconciledDose {
  batch: BeanBatch | null;
  saved: BeanBatch | null;
  outcome: 'committed' | 'already-applied' | 'not-applicable';
  weightRemaining: number | null;
}

/**
 * Durable, one-at-a-time reconciliation for post-shot bag deductions.
 *
 * The outbox is written before any gateway work starts. Its aggregate heads
 * preserve FIFO per bean inventory, while the injected exact runner serializes
 * the fresh read and conditional update with every local inventory mutation
 * for that bean.
 */
export class DoseMutationReconciler {
  private readonly outbox: DurableMutationOutbox;
  private readonly task: BackgroundTask;
  private activeRun: Promise<void> | null = null;
  private readonly volatileEnqueues = new Map<string, EnqueueDoseMutationInput>();
  private readonly projectionRevisions = new Map<string, number>();
  private disposePromise: Promise<void> | null = null;
  private prunedTombstones = false;
  private disposed = false;

  constructor(
    private readonly deps: DoseMutationReconcilerDependencies,
    options: DoseMutationReconcilerOptions = {}
  ) {
    this.outbox = new DurableMutationOutbox({
      ...options.outbox,
      now: deps.now
    });
    this.task = new BackgroundTask({
      intervalMs: DOSE_MUTATION_RECONCILE_INTERVAL_MS,
      scheduler: options.scheduler,
      run: () => this.runTracked(),
      onError: (error) => this.deps.onWorkerError?.(error)
    });
  }

  /** Start periodic reconciliation and perform one immediate pass. */
  start(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.task.start();
    return this.trigger();
  }

  /**
   * Durably journal a physical shot deduction before waking the worker.
   * Duplicate shot/batch pairs return the existing record and never reapply.
   */
  async enqueue(input: EnqueueDoseMutationInput): Promise<DoseMutationEnqueueResult> {
    this.assertOpen();
    validateEnqueueInput(input);
    const entry: PendingDose = {
      batchId: input.batchId,
      beanId: input.beanId,
      dose: input.dose,
      expectedRemaining: input.expectedRemaining,
      at: input.at
    };
    const idempotencyKey = pendingDoseIdempotencyKey(input.shotId, input.batchId);
    try {
      const queued = await this.outbox.enqueue({
        idempotencyKey,
        kind: PENDING_DOSE_MUTATION_KIND,
        aggregateKey: beanInventoryMutationKey(input.beanId),
        payload: entry,
        createdAt: new Date(input.at)
      });
      // A process-local projection token belongs only to the call that
      // actually admitted this physical command. A duplicate tombstone has no
      // future claim, while a pending command from an older process must keep
      // its null/old-generation semantics.
      if (queued.record.state === 'acknowledged') {
        this.projectionRevisions.delete(idempotencyKey);
      } else if (
        queued.inserted &&
        input.projectionRevision != null &&
        !this.projectionRevisions.has(idempotencyKey)
      ) {
        this.projectionRevisions.set(idempotencyKey, input.projectionRevision);
      }
      if (!this.disposed) {
        this.task.start();
        void this.trigger();
      }
      return { inserted: queued.inserted, durability: queued.durability };
    } catch (error) {
      // A payload conflict is an application invariant violation, not a
      // storage outage. Never hide it in the volatile fallback under the same
      // physical-command identity.
      if (error instanceof IdempotencyConflictError) throw error;
      // IDB remains authoritative and fail-closed. Retain a bounded in-memory
      // retry for this live process rather than silently forgetting beans. The
      // explicit volatile result lets the caller preserve projection order and
      // surface that persistent durability is not yet secured.
      const existing = this.volatileEnqueues.get(idempotencyKey);
      if (existing && !sameDoseMutationInput(existing, input)) {
        throw new IdempotencyConflictError(idempotencyKey);
      }
      const inserted = existing == null;
      if (inserted &&
          this.volatileEnqueues.size >= MAX_VOLATILE_ENQUEUES) {
        throw new Error('Dose mutation volatile retry buffer is full', { cause: error });
      }
      if (inserted) {
        this.volatileEnqueues.set(idempotencyKey, { ...input });
        if (input.projectionRevision != null) {
          this.projectionRevisions.set(idempotencyKey, input.projectionRevision);
        }
      }
      this.task.start();
      this.task.trigger();
      this.deps.onWorkerError?.(new Error(
        'Dose mutation accepted in volatile intake; persistent journal unavailable',
        { cause: error }
      ));
      return { inserted, durability: 'volatile' };
    }
  }

  /** Wake the single-flight worker; concurrent triggers collapse to one rerun. */
  trigger(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.task.trigger();
    return this.activeRun ?? Promise.resolve();
  }

  /** Stop new claims, finish any claimed mutation, then close durable storage. */
  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.disposed = true;
    this.task.dispose();
    const active = this.activeRun;
    this.disposePromise = (active ? active.catch(() => undefined) : Promise.resolve())
      .then(() => this.outbox.dispose());
    return this.disposePromise;
  }

  private runTracked(): Promise<void> {
    const run = this.reconcile();
    let tracked: Promise<void>;
    tracked = run.finally(() => {
      if (this.activeRun === tracked) this.activeRun = null;
    });
    this.activeRun = tracked;
    return tracked;
  }

  private async reconcile(): Promise<void> {
    await this.flushVolatileEnqueues();
    await this.migrateLegacy();
    if (!this.prunedTombstones) {
      const cutoff = new Date(this.deps.now().getTime() - DOSE_MUTATION_TOMBSTONE_AGE_MS);
      await this.outbox.pruneAcknowledged({ before: cutoff, limit: TOMBSTONE_PRUNE_LIMIT });
      this.prunedTombstones = true;
    }

    while (!this.disposed) {
      const now = this.deps.now();
      const claims = await this.outbox.claimDue<PendingDose>({
        ownerId: DOSE_MUTATION_WORKER_ID,
        leaseMs: DOSE_MUTATION_LEASE_MS,
        limit: 1,
        kinds: [PENDING_DOSE_MUTATION_KIND],
        now,
        canonicalAggregateKey: (record) =>
          record.kind === PENDING_DOSE_MUTATION_KIND && isPendingDosePayload(record.payload)
            ? beanInventoryMutationKey(record.payload.beanId)
            : record.aggregateKey
      });
      const claim = claims[0];
      if (!claim) return;
      const entry = claim.record.payload;

      try {
        if (!isPendingDosePayload(entry)) {
          await this.outbox.acknowledge({
            idempotencyKey: claim.record.idempotencyKey,
            leaseToken: claim.leaseToken,
            outcome: 'not-applicable',
            details: { reason: 'invalid-payload' },
            now: this.deps.now()
          });
          continue;
        }

        const reconciled = await this.deps.runExactAggregate(
          // Inventory edits, split-freeze transactions, and delayed dose
          // deductions share the per-bean lane canonicalized atomically before
          // the outbox selected this aggregate head.
          beanInventoryMutationKey(entry.beanId),
          async () => {
            // A lane wait is intentionally unbounded. Renew only after this
            // callback actually acquires the lane; an expired/reclaimed worker
            // must leave without dispatching any remote write.
            if (!await this.renewClaim(claim.record.idempotencyKey, claim.leaseToken)) {
              return null;
            }
            return this.reconcileClaim(
              entry,
              claim.record.idempotencyKey,
              claim.leaseToken
            );
          }
        );
        if (!reconciled) return;
        const acknowledged = await this.outbox.acknowledge({
          idempotencyKey: claim.record.idempotencyKey,
          leaseToken: claim.leaseToken,
          outcome: reconciled.outcome,
          details: reconciled.weightRemaining == null
            ? undefined
            : { weightRemaining: reconciled.weightRemaining },
          now: this.deps.now()
        });
        if (!acknowledged) return;
        if (reconciled.saved && reconciled.weightRemaining != null) {
          this.notifyBatchSaved(
            reconciled.saved,
            entry,
            reconciled.weightRemaining,
            this.projectionRevisions.get(claim.record.idempotencyKey) ?? null
          );
        }
        this.projectionRevisions.delete(claim.record.idempotencyKey);
      } catch (error) {
        const exponent = Math.min(7, Math.max(0, claim.record.attemptCount - 1));
        const retryDelayMs = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** exponent);
        const now = this.deps.now();
        const retryAt = new Date(now.getTime() + retryDelayMs);
        const retained = await this.outbox.markRetry({
          idempotencyKey: claim.record.idempotencyKey,
          leaseToken: claim.leaseToken,
          retryAt,
          error,
          now
        });
        if (retained) {
          this.notifyRetry({ entry, error, attemptCount: claim.record.attemptCount, retryAt });
        }
        return;
      }
    }
  }

  private async flushVolatileEnqueues(): Promise<void> {
    for (const [idempotencyKey, input] of this.volatileEnqueues) {
      const entry: PendingDose = {
        batchId: input.batchId,
        beanId: input.beanId,
        dose: input.dose,
        expectedRemaining: input.expectedRemaining,
        at: input.at
      };
      await this.outbox.enqueue({
        idempotencyKey,
        kind: PENDING_DOSE_MUTATION_KIND,
        aggregateKey: beanInventoryMutationKey(input.beanId),
        payload: entry,
        createdAt: new Date(input.at)
      });
      this.volatileEnqueues.delete(idempotencyKey);
    }
  }

  private async migrateLegacy(): Promise<void> {
    const legacy = [...this.deps.readLegacy()];
    for (const entry of legacy) {
      const parsedAt = Date.parse(entry.at);
      await this.outbox.enqueue({
        idempotencyKey: legacyPendingDoseIdempotencyKey(entry),
        kind: PENDING_DOSE_MUTATION_KIND,
        aggregateKey: beanInventoryMutationKey(entry.beanId),
        payload: entry,
        createdAt: new Date(Number.isFinite(parsedAt) ? parsedAt : this.deps.now().getTime())
      });
    }
    // Never clear the legacy queue if even one durable enqueue above failed.
    if (legacy.length > 0) this.deps.clearLegacy();
  }

  private async reconcileClaim(
    entry: PendingDose,
    idempotencyKey: string,
    leaseToken: string
  ): Promise<ReconciledDose | null> {
    const batch = await this.deps.readBatch(entry.batchId);
    const resolution = resolvePendingDose(entry, batch);
    if (resolution.action === 'drop') {
      return {
        batch,
        saved: null,
        outcome: batch ? 'already-applied' : 'not-applicable',
        weightRemaining: batch?.weightRemaining ?? null
      };
    }

    // Refresh once more after the GET and immediately before the remote delta.
    // The remaining I/O is bounded by the gateway timeout well below the lease.
    if (!await this.renewClaim(idempotencyKey, leaseToken)) return null;
    const saved = await this.deps.updateBatch(
      entry.batchId,
      { beanId: batch?.beanId ?? entry.beanId, weightRemaining: resolution.weightRemaining },
      { idempotencyKey }
    );
    return {
      batch,
      saved,
      outcome: 'committed',
      weightRemaining: saved.weightRemaining ?? resolution.weightRemaining
    };
  }

  private renewClaim(idempotencyKey: string, leaseToken: string): Promise<boolean> {
    return this.outbox.renewLease({
      idempotencyKey,
      leaseToken,
      leaseMs: DOSE_MUTATION_LEASE_MS,
      now: this.deps.now()
    });
  }

  private notifyBatchSaved(
    batch: BeanBatch,
    entry: PendingDose,
    resolvedRemaining: number,
    projectionRevision: number | null
  ): void {
    try {
      this.deps.onBatchSaved(batch, entry, resolvedRemaining, projectionRevision);
    } catch (error) {
      this.deps.onWorkerError?.(error);
    }
  }

  private notifyRetry(retry: DoseMutationRetry): void {
    try {
      this.deps.onRetryScheduled(retry);
    } catch (error) {
      this.deps.onWorkerError?.(error);
    }
  }

  private assertOpen(): void {
    if (this.disposed) throw new Error('Dose mutation reconciler has been disposed');
  }
}

function validateEnqueueInput(input: EnqueueDoseMutationInput): void {
  if (!input.shotId.trim()) throw new Error('shotId must not be empty');
  if (!input.batchId.trim()) throw new Error('batchId must not be empty');
  if (!input.beanId.trim()) throw new Error('beanId must not be empty');
  if (!Number.isFinite(input.dose) || input.dose <= 0) throw new Error('dose must be a finite positive number');
  if (!Number.isFinite(input.expectedRemaining)) throw new Error('expectedRemaining must be finite');
  if (
    input.projectionRevision != null &&
    (!Number.isInteger(input.projectionRevision) || input.projectionRevision < 0)
  ) throw new Error('projectionRevision must be a non-negative integer');
  if (!Number.isFinite(Date.parse(input.at))) throw new Error('at must be a valid ISO timestamp');
}

function sameDoseMutationInput(
  left: EnqueueDoseMutationInput,
  right: EnqueueDoseMutationInput
): boolean {
  return left.shotId === right.shotId &&
    left.batchId === right.batchId &&
    left.beanId === right.beanId &&
    left.dose === right.dose &&
    left.expectedRemaining === right.expectedRemaining &&
    left.at === right.at;
}

function isPendingDosePayload(value: unknown): value is PendingDose {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<PendingDose>;
  return typeof entry.batchId === 'string' && entry.batchId.length > 0 &&
    typeof entry.beanId === 'string' && entry.beanId.length > 0 &&
    typeof entry.dose === 'number' && Number.isFinite(entry.dose) && entry.dose > 0 &&
    typeof entry.expectedRemaining === 'number' && Number.isFinite(entry.expectedRemaining) &&
    typeof entry.at === 'string' && Number.isFinite(Date.parse(entry.at));
}
