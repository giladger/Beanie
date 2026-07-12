import type { BeanBatch } from '../api/types';
import {
  DurableMutationOutbox,
  doseAdjustmentPhysicalIdentity,
  IdempotencyConflictError,
  legacyPendingDoseIdempotencyKey,
  pendingDoseIdempotencyKey,
  pendingDoseReclaimIdempotencyKey,
  type DurableMutationRecord,
  type DurableMutationOutboxOptions,
  type MutationOutboxDurability,
  type MutationReceiptOutcome
} from '../domain/mutationOutbox';
import { resolvePendingDose, type PendingDose } from '../domain/pendingDoses';
import { doseReclaimRemaining } from '../domain/doseReclaim';
import { BackgroundTask, type BackgroundTaskScheduler } from '../runtime/backgroundTask';
import { beanInventoryMutationKey } from './beanInventoryController';

export const PENDING_DOSE_MUTATION_KIND = 'pending-dose-deduction';
export const PENDING_DOSE_RECLAIM_MUTATION_KIND = 'pending-dose-reclaim';
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

export interface EnqueueDoseReclaimInput extends PendingDose {
  shotId: string;
  /** Process-local optimistic field revision; deliberately not journal payload. */
  projectionRevision?: number;
}

export interface DoseMutationEnqueueResult {
  inserted: boolean;
  /** Stable physical-command identity used to retain/release local projection ownership. */
  idempotencyKey: string;
  /** False only when the durable record is already an acknowledged tombstone. */
  settlementPending: boolean;
  /** Replay heuristic owned by the first admission for this physical command. */
  expectedRemaining: number;
  /** `volatile` means accepted in the bounded live intake but not yet persistent. */
  durability: MutationOutboxDurability | 'volatile';
  /**
   * Release execution only after the matching optimistic projection is visible.
   * Idempotent and mandatory even when `inserted` is false.
   */
  releaseProjection(): void;
}

export type DoseReclaimEnqueueResult = DoseMutationEnqueueResult;

export type ExistingDoseReclaim = {
  readonly beanId: string;
  readonly batchId: string;
  readonly dose: number;
} & (
  | {
      readonly state: 'pending';
      readonly expectedRemaining: number;
      readonly durability: MutationOutboxDurability | 'volatile';
    }
  | {
      readonly state: 'acknowledged';
      readonly outcome: MutationReceiptOutcome;
      readonly resolvedRemaining: number | null;
      readonly durability: MutationOutboxDurability;
    }
);

export interface DoseMutationAdjustmentEntry extends PendingDose {
  readonly adjustment: 'deduction' | 'reclaim';
}

export interface DoseMutationRetry {
  entry: DoseMutationAdjustmentEntry;
  error: unknown;
  attemptCount: number;
  retryAt: Date;
}

export interface DoseMutationSettlement {
  readonly idempotencyKey: string;
  readonly entry: DoseMutationAdjustmentEntry;
  readonly outcome: MutationReceiptOutcome;
  /** Authoritative scalar from the fresh read/write; null means unavailable/absent. */
  readonly resolvedRemaining: number | null;
  readonly projectionRevision: number | null;
}

export interface DoseMutationCanonicalization {
  readonly idempotencyKey: string;
  readonly entry: DoseMutationAdjustmentEntry;
  /** Optimistic scalar published by the volatile caller. */
  readonly projectedExpectedRemaining: number;
  readonly projectionRevision: number | null;
}

export interface PendingDoseAdjustmentReservation {
  readonly idempotencyKey: string;
  readonly entry: DoseMutationAdjustmentEntry;
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
  onAdjustmentCanonicalized?(canonicalization: DoseMutationCanonicalization): void;
  onAdjustmentSettled?(settlement: DoseMutationSettlement): void;
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

type DoseMutationKind =
  | typeof PENDING_DOSE_MUTATION_KIND
  | typeof PENDING_DOSE_RECLAIM_MUTATION_KIND;

interface VolatileDoseAdjustment {
  readonly kind: DoseMutationKind;
  readonly input: EnqueueDoseMutationInput | EnqueueDoseReclaimInput;
}

interface ProjectionBarrier {
  holders: number;
  readonly settled: Promise<void>;
  readonly resolve: () => void;
}

/**
 * Durable, one-at-a-time reconciliation for post-shot bag adjustments.
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
  private readonly volatileEnqueues = new Map<string, VolatileDoseAdjustment>();
  private readonly projectionRevisions = new Map<string, number>();
  private readonly projectionBarriers = new Map<string, ProjectionBarrier>();
  private readonly awaitedSettlements = new Map<
    string,
    { readonly kind: DoseMutationKind; readonly fallback: PendingDose }
  >();
  private admissionTail: Promise<void> = Promise.resolve();
  private disposePromise: Promise<void> | null = null;
  private prunedTombstones = false;
  private legacyMigrationComplete = false;
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
      onError: (error) => this.notifyWorkerError(error)
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
    return this.serializeAdmission(() =>
      this.enqueueAfterLegacyGate(
        input,
        PENDING_DOSE_MUTATION_KIND,
        pendingDoseIdempotencyKey(input.shotId, input.batchId)
      )
    );
  }

  /** Durably journal the inverse +grams adjustment for one deleted shot. */
  async enqueueReclaim(input: EnqueueDoseReclaimInput): Promise<DoseReclaimEnqueueResult> {
    return this.serializeAdmission(() =>
      this.enqueueAfterLegacyGate(
        input,
        PENDING_DOSE_RECLAIM_MUTATION_KIND,
        pendingDoseReclaimIdempotencyKey(input.shotId, input.batchId)
      )
    );
  }

  /**
   * A 404 DELETE may resume only a reclaim this client journaled previously;
   * absence cannot prove whether another client already returned the dose.
   */
  async existingReclaim(
    shotId: string,
    batchId: string
  ): Promise<ExistingDoseReclaim | null> {
    this.assertOpen();
    await this.admissionTail;
    const key = pendingDoseReclaimIdempotencyKey(shotId, batchId);
    const volatile = this.volatileEnqueues.get(key);
    if (
      volatile?.kind === PENDING_DOSE_RECLAIM_MUTATION_KIND &&
      Number.isFinite(volatile.input.expectedRemaining)
    ) {
      return {
        beanId: volatile.input.beanId,
        batchId: volatile.input.batchId,
        dose: volatile.input.dose,
        state: 'pending',
        expectedRemaining: volatile.input.expectedRemaining,
        durability: 'volatile'
      };
    }
    const record = await this.outbox.get<PendingDose>(key);
    if (
      record?.kind !== PENDING_DOSE_RECLAIM_MUTATION_KIND ||
      !isPendingDosePayload(record.payload)
    ) return null;
    const durability = await this.outbox.durability();
    if (record.state !== 'acknowledged') {
      return {
        beanId: record.payload.beanId,
        batchId: record.payload.batchId,
        dose: record.payload.dose,
        state: 'pending',
        expectedRemaining: record.payload.expectedRemaining,
        durability
      };
    }
    return {
      beanId: record.payload.beanId,
      batchId: record.payload.batchId,
      dose: record.payload.dose,
      state: 'acknowledged',
      outcome: record.receipt?.outcome ?? 'not-applicable',
      resolvedRemaining: receiptRemaining(record.receipt?.details),
      durability
    };
  }

  /** Discover durable work before foreground inventory controls become writable. */
  pendingAdjustments(): Promise<readonly PendingDoseAdjustmentReservation[]> {
    return this.serializeAdmission(async () => {
      this.assertOpen();
      await this.ensureLegacyMigrated();
      const records = await this.outbox.list<PendingDose>([
        'pending',
        'in-flight',
        'retry-wait'
      ]);
      const pending: PendingDoseAdjustmentReservation[] = [];
      for (const record of records) {
        if (!isDoseMutationKind(record.kind) || !isPendingDosePayload(record.payload)) continue;
        this.awaitedSettlements.set(record.idempotencyKey, {
          kind: record.kind,
          fallback: record.payload
        });
        pending.push({
          idempotencyKey: record.idempotencyKey,
          entry: adjustmentEntry(record.kind, record.payload)
        });
      }
      return pending;
    });
  }

  private async enqueueAdjustment(
    input: EnqueueDoseMutationInput | EnqueueDoseReclaimInput,
    kind: DoseMutationKind,
    idempotencyKey: string,
    releaseProjection: () => void
  ): Promise<DoseMutationEnqueueResult> {
    this.assertOpen();
    validateEnqueueInput(input);
    const entry = adjustmentPayload(input);
    if (this.hasVolatileAggregate(input.beanId)) {
      return this.acceptVolatile(
        input,
        kind,
        idempotencyKey,
        releaseProjection,
        new Error('Earlier physical adjustment is still awaiting durable promotion')
      );
    }
    try {
      const createdAt = new Date(input.at);
      const queued = await this.outbox.enqueue({
        idempotencyKey,
        kind,
        aggregateKey: beanInventoryMutationKey(input.beanId),
        payload: entry,
        physicalIdentity: doseAdjustmentPhysicalIdentity(entry),
        createdAt,
        causalOrder: 'aggregate',
        canonicalAggregateKey: canonicalDoseAggregateKey
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
      if (queued.record.state !== 'acknowledged') {
        this.awaitedSettlements.set(idempotencyKey, {
          kind,
          fallback: isPendingDosePayload(queued.record.payload)
            ? queued.record.payload
            : entry
        });
      }
      if (!this.disposed) {
        this.task.start();
        void this.trigger();
      }
      return {
        inserted: queued.inserted,
        idempotencyKey,
        settlementPending: queued.record.state !== 'acknowledged',
        expectedRemaining: isPendingDosePayload(queued.record.payload)
          ? queued.record.payload.expectedRemaining
          : entry.expectedRemaining,
        durability: queued.durability,
        releaseProjection
      };
    } catch (error) {
      // A payload conflict is an application invariant violation, not a
      // storage outage. Never hide it in the volatile fallback under the same
      // physical-command identity.
      if (error instanceof IdempotencyConflictError) {
        releaseProjection();
        throw error;
      }
      return this.acceptVolatile(input, kind, idempotencyKey, releaseProjection, error);
    }
  }

  private async enqueueAfterLegacyGate(
    input: EnqueueDoseMutationInput | EnqueueDoseReclaimInput,
    kind: DoseMutationKind,
    idempotencyKey: string
  ): Promise<DoseMutationEnqueueResult> {
    this.assertOpen();
    validateEnqueueInput(input);
    const releaseProjection = this.holdProjection(idempotencyKey);
    try {
      await this.ensureLegacyMigrated();
    } catch (error) {
      // Preserve bounded current-process intake, but never promote it ahead of
      // the older legacy queue. Reconciliation retries the gate first.
      return this.acceptVolatile(input, kind, idempotencyKey, releaseProjection, error);
    }
    return this.enqueueAdjustment(input, kind, idempotencyKey, releaseProjection);
  }

  private hasVolatileAggregate(beanId: string): boolean {
    return [...this.volatileEnqueues.values()].some(
      (pending) => pending.input.beanId === beanId
    );
  }

  private acceptVolatile(
    input: EnqueueDoseMutationInput | EnqueueDoseReclaimInput,
    kind: DoseMutationKind,
    idempotencyKey: string,
    releaseProjection: () => void,
    cause: unknown
  ): DoseMutationEnqueueResult {
    const existing = this.volatileEnqueues.get(idempotencyKey);
    if (existing && (existing.kind !== kind || !sameDoseMutationInput(existing.input, input))) {
      releaseProjection();
      throw new IdempotencyConflictError(idempotencyKey);
    }
    const inserted = existing == null;
    if (inserted && this.volatileEnqueues.size >= MAX_VOLATILE_ENQUEUES) {
      releaseProjection();
      throw new Error('Dose mutation volatile retry buffer is full', { cause });
    }
    if (inserted) {
      this.volatileEnqueues.set(idempotencyKey, { kind, input: { ...input } });
      if (input.projectionRevision != null) {
        this.projectionRevisions.set(idempotencyKey, input.projectionRevision);
      }
    }
    this.awaitedSettlements.set(idempotencyKey, {
      kind,
      fallback: adjustmentPayload(existing?.input ?? input)
    });
    this.task.start();
    this.task.trigger();
    this.notifyWorkerError(new Error(
      'Dose mutation accepted in volatile intake; persistent journal unavailable',
      { cause }
    ));
    return {
      inserted,
      idempotencyKey,
      settlementPending: true,
      expectedRemaining: existing?.input.expectedRemaining ?? input.expectedRemaining,
      durability: 'volatile',
      releaseProjection
    };
  }

  private serializeAdmission<Value>(operation: () => Promise<Value>): Promise<Value> {
    const result = this.admissionTail.then(operation, operation);
    this.admissionTail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
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
    this.releaseAllProjectionBarriers();
    this.task.dispose();
    const active = this.activeRun;
    this.disposePromise = Promise.all([
      this.admissionTail,
      active ? active.catch(() => undefined) : Promise.resolve()
    ]).then(() => this.admissionTail)
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
    // Promotion and the entire older legacy queue form one admission epoch.
    // A live deduction/reclaim cannot splice itself between legacy records and
    // acquire an earlier causal position for the same bean.
    await this.serializeAdmission(async () => {
      await this.ensureLegacyMigrated();
      await this.flushVolatileEnqueues();
    });
    await this.settleAcknowledgedAwaiters();
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
        kinds: [PENDING_DOSE_MUTATION_KIND, PENDING_DOSE_RECLAIM_MUTATION_KIND],
        now,
        canonicalAggregateKey: (record) =>
          canonicalDoseAggregateKey(record)
      });
      const claim = claims[0];
      if (!claim) return;
      const payload = claim.record.payload;
      const entry = isPendingDosePayload(payload) && isDoseMutationKind(claim.record.kind)
        ? adjustmentEntry(claim.record.kind, payload)
        : null;

      try {
        if (!entry) {
          await this.outbox.acknowledge({
            idempotencyKey: claim.record.idempotencyKey,
            leaseToken: claim.leaseToken,
            outcome: 'not-applicable',
            details: { reason: 'invalid-payload' },
            now: this.deps.now()
          });
          continue;
        }

        // Admission and optimistic projection are one local hand-off. A fast
        // worker may claim the durable record, but it cannot read/write remote
        // inventory until the caller has committed (or deliberately skipped)
        // that projection.
        await this.waitForProjection(claim.record.idempotencyKey);

        const reconciled = await this.deps.runExactAggregate(
          // Inventory edits, split-freeze transactions, and durable dose
          // adjustments share the per-bean lane canonicalized atomically
          // before the outbox selected this aggregate head.
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
        const projectionRevision =
          this.projectionRevisions.get(claim.record.idempotencyKey) ?? null;
        this.notifyAdjustmentSettled({
          idempotencyKey: claim.record.idempotencyKey,
          entry,
          outcome: reconciled.outcome,
          resolvedRemaining: reconciled.weightRemaining,
          projectionRevision
        });
        this.awaitedSettlements.delete(claim.record.idempotencyKey);
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
        if (retained && entry) {
          this.notifyRetry({ entry, error, attemptCount: claim.record.attemptCount, retryAt });
        }
        return;
      }
    }
  }

  private async flushVolatileEnqueues(): Promise<void> {
    for (const [idempotencyKey, pending] of this.volatileEnqueues) {
      const { kind, input } = pending;
      const entry = adjustmentPayload(input);
      const queued = await this.outbox.enqueue({
        idempotencyKey,
        kind,
        aggregateKey: beanInventoryMutationKey(input.beanId),
        payload: entry,
        physicalIdentity: doseAdjustmentPhysicalIdentity(entry),
        createdAt: new Date(input.at),
        causalOrder: 'aggregate',
        canonicalAggregateKey: canonicalDoseAggregateKey
      });
      this.volatileEnqueues.delete(idempotencyKey);
      const canonicalPayload = isPendingDosePayload(queued.record.payload)
        ? queued.record.payload
        : entry;
      const canonical = adjustmentEntry(kind, canonicalPayload);
      if (
        !queued.inserted &&
        canonical.expectedRemaining !== input.expectedRemaining
      ) {
        // The caller has already been told to project its volatile replay
        // heuristic. Wait for that mandatory hand-off, then rebase it to the
        // first admission's canonical scalar before claim/settlement continues.
        await this.waitForProjection(idempotencyKey);
        this.notifyAdjustmentCanonicalized({
          idempotencyKey,
          entry: canonical,
          projectedExpectedRemaining: input.expectedRemaining,
          projectionRevision: this.projectionRevisions.get(idempotencyKey) ?? null
        });
      }
      if (queued.record.state === 'acknowledged') {
        this.awaitedSettlements.set(idempotencyKey, { kind, fallback: canonicalPayload });
      }
    }
  }

  private async settleAcknowledgedAwaiters(): Promise<void> {
    for (const [idempotencyKey, awaited] of [...this.awaitedSettlements]) {
      const record = await this.outbox.get<PendingDose>(idempotencyKey);
      if (record?.state !== 'acknowledged') continue;
      await this.waitForProjection(idempotencyKey);
      const payload = isPendingDosePayload(record.payload) ? record.payload : awaited.fallback;
      this.notifyAdjustmentSettled({
        idempotencyKey,
        entry: adjustmentEntry(awaited.kind, payload),
        outcome: record.receipt?.outcome ?? 'not-applicable',
        resolvedRemaining: receiptRemaining(record.receipt?.details),
        projectionRevision: this.projectionRevisions.get(idempotencyKey) ?? null
      });
      this.awaitedSettlements.delete(idempotencyKey);
      this.projectionRevisions.delete(idempotencyKey);
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
        createdAt: new Date(Number.isFinite(parsedAt) ? parsedAt : this.deps.now().getTime()),
        causalOrder: 'aggregate',
        canonicalAggregateKey: canonicalDoseAggregateKey
      });
    }
    // Never clear the legacy queue if even one durable enqueue above failed.
    if (legacy.length > 0) this.deps.clearLegacy();
  }

  private async ensureLegacyMigrated(): Promise<void> {
    if (this.legacyMigrationComplete) return;
    await this.migrateLegacy();
    this.legacyMigrationComplete = true;
  }

  private async reconcileClaim(
    entry: DoseMutationAdjustmentEntry,
    idempotencyKey: string,
    leaseToken: string
  ): Promise<ReconciledDose | null> {
    const batch = await this.deps.readBatch(entry.batchId);
    if (entry.adjustment === 'deduction') {
      const resolution = resolvePendingDose(entry, batch);
      if (resolution.action === 'drop') {
        return {
          batch,
          saved: null,
          outcome: batch ? 'already-applied' : 'not-applicable',
          weightRemaining: batch?.weightRemaining ?? null
        };
      }
      return this.commitAdjustment(
        entry,
        batch,
        resolution.weightRemaining,
        idempotencyKey,
        leaseToken
      );
    }

    if (!batch) {
      return {
        batch: null,
        saved: null,
        outcome: 'not-applicable',
        weightRemaining: null
      };
    }
    const currentRemaining = finiteNonNegative(batch.weightRemaining);
    if (currentRemaining == null) {
      return { batch, saved: null, outcome: 'not-applicable', weightRemaining: null };
    }
    if (approximatelyEqual(currentRemaining, entry.expectedRemaining)) {
      return {
        batch,
        saved: null,
        outcome: 'already-applied',
        weightRemaining: currentRemaining
      };
    }
    const resolvedRemaining = doseReclaimRemaining(currentRemaining, entry.dose, batch.weight);
    if (approximatelyEqual(resolvedRemaining, currentRemaining)) {
      return {
        batch,
        saved: null,
        outcome: 'already-applied',
        weightRemaining: currentRemaining
      };
    }
    return this.commitAdjustment(
      entry,
      batch,
      resolvedRemaining,
      idempotencyKey,
      leaseToken
    );
  }

  private async commitAdjustment(
    entry: DoseMutationAdjustmentEntry,
    batch: BeanBatch | null,
    resolvedRemaining: number,
    idempotencyKey: string,
    leaseToken: string
  ): Promise<ReconciledDose | null> {
    // Refresh once more after the GET and immediately before the remote delta.
    // The remaining I/O is bounded by the gateway timeout well below the lease.
    if (!await this.renewClaim(idempotencyKey, leaseToken)) return null;
    const saved = await this.deps.updateBatch(
      entry.batchId,
      { beanId: batch?.beanId ?? entry.beanId, weightRemaining: resolvedRemaining },
      { idempotencyKey }
    );
    return {
      batch,
      saved,
      outcome: 'committed',
      weightRemaining: finiteNonNegative(saved.weightRemaining) ?? resolvedRemaining
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

  private holdProjection(idempotencyKey: string): () => void {
    let barrier = this.projectionBarriers.get(idempotencyKey);
    if (!barrier) {
      let resolve!: () => void;
      const settled = new Promise<void>((done) => {
        resolve = done;
      });
      barrier = { holders: 0, settled, resolve };
      this.projectionBarriers.set(idempotencyKey, barrier);
    }
    barrier.holders += 1;
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      const current = this.projectionBarriers.get(idempotencyKey);
      if (!current) return;
      current.holders -= 1;
      if (current.holders > 0) return;
      this.projectionBarriers.delete(idempotencyKey);
      current.resolve();
    };
  }

  private waitForProjection(idempotencyKey: string): Promise<void> {
    return this.projectionBarriers.get(idempotencyKey)?.settled ?? Promise.resolve();
  }

  private releaseAllProjectionBarriers(): void {
    const barriers = [...this.projectionBarriers.values()];
    this.projectionBarriers.clear();
    for (const barrier of barriers) barrier.resolve();
  }

  private notifyAdjustmentSettled(settlement: DoseMutationSettlement): void {
    try {
      this.deps.onAdjustmentSettled?.(settlement);
    } catch (error) {
      this.notifyWorkerError(error);
    }
  }

  private notifyAdjustmentCanonicalized(
    canonicalization: DoseMutationCanonicalization
  ): void {
    try {
      this.deps.onAdjustmentCanonicalized?.(canonicalization);
    } catch (error) {
      this.notifyWorkerError(error);
    }
  }

  private notifyRetry(retry: DoseMutationRetry): void {
    try {
      this.deps.onRetryScheduled(retry);
    } catch (error) {
      this.notifyWorkerError(error);
    }
  }

  private notifyWorkerError(error: unknown): void {
    try {
      this.deps.onWorkerError?.(error);
    } catch {
      // Diagnostics cannot interrupt journal admission or settlement.
    }
  }

  private assertOpen(): void {
    if (this.disposed) throw new Error('Dose mutation reconciler has been disposed');
  }
}

function validateEnqueueInput(
  input: EnqueueDoseMutationInput | EnqueueDoseReclaimInput
): void {
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

function adjustmentPayload(
  input: EnqueueDoseMutationInput | EnqueueDoseReclaimInput
): PendingDose {
  return {
    batchId: input.batchId,
    beanId: input.beanId,
    dose: input.dose,
    expectedRemaining: input.expectedRemaining,
    at: input.at
  };
}

function adjustmentEntry(
  kind: DoseMutationKind,
  payload: PendingDose
): DoseMutationAdjustmentEntry {
  return {
    ...payload,
    adjustment: kind === PENDING_DOSE_MUTATION_KIND ? 'deduction' : 'reclaim'
  };
}

function isDoseMutationKind(value: string): value is DoseMutationKind {
  return value === PENDING_DOSE_MUTATION_KIND || value === PENDING_DOSE_RECLAIM_MUTATION_KIND;
}

function canonicalDoseAggregateKey(record: Readonly<DurableMutationRecord>): string {
  return isDoseMutationKind(record.kind) && isPendingDosePayload(record.payload)
    ? beanInventoryMutationKey(record.payload.beanId)
    : record.aggregateKey;
}

function finiteNonNegative(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function approximatelyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) < 0.05;
}

function receiptRemaining(details: unknown): number | null {
  if (!details || typeof details !== 'object') return null;
  const value = (details as { weightRemaining?: unknown }).weightRemaining;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function sameDoseMutationInput(
  left: EnqueueDoseMutationInput | EnqueueDoseReclaimInput,
  right: EnqueueDoseMutationInput | EnqueueDoseReclaimInput
): boolean {
  return left.shotId === right.shotId &&
    left.batchId === right.batchId &&
    left.beanId === right.beanId &&
    left.dose === right.dose;
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
