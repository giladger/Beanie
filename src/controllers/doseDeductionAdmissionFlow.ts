import type { Bean, BeanBatch } from '../api/types';
import { formatGrams } from '../domain/beanWorkflow';
import { pendingDoseIdempotencyKey } from '../domain/mutationOutbox';
import type {
  BeanInventoryController,
  BeanInventoryProjection
} from './beanInventoryController';
import type {
  DoseMutationCanonicalization,
  DoseMutationEnqueueResult,
  DoseMutationSettlement,
  EnqueueDoseMutationInput
} from './doseMutationReconciler';

export interface DoseDeductionRequest {
  readonly bean: Bean;
  readonly batchId: string;
  readonly doseWeight: number | null | undefined;
  readonly shotId: string | null;
  readonly demo: boolean;
}

export interface DoseDeductionSnapshot {
  readonly batchesByBean: Readonly<Record<string, readonly BeanBatch[]>>;
  readonly disposed: boolean;
}

export type DoseDeductionEvent =
  | {
      readonly type: 'projection';
      readonly projection: BeanInventoryProjection;
      readonly status?: string;
    }
  | { readonly type: 'review-required'; readonly beanId: string }
  | {
      readonly type: 'admission-failed';
      readonly error: unknown;
      readonly status: 'Bag update could not be queued';
    };

export interface DoseDeductionHost {
  snapshot(): DoseDeductionSnapshot;
  commit(event: DoseDeductionEvent): void;
}

type DoseInventory = Pick<
  BeanInventoryController,
  | 'remainingWeightRevision'
  | 'reservePendingRemainingWeight'
  | 'retainPendingRemainingWeight'
  | 'releasePendingRemainingWeight'
  | 'hasPendingRemainingWeightAfter'
  | 'reconcileRemainingWeight'
  | 'cacheProjection'
>;

export interface DoseDeductionDependencies {
  readonly inventory: DoseInventory;
  now(): Date;
  enqueue(input: EnqueueDoseMutationInput): Promise<DoseMutationEnqueueResult>;
  applyDemoDeduction(input: {
    readonly bean: Bean;
    readonly batchId: string;
    readonly weightRemaining: number;
    readonly status: string;
  }): Promise<unknown>;
}

/**
 * Owns caller-side shot deduction admission and its optimistic scalar. The
 * injected reconciler remains the sole journal/worker owner and the injected
 * inventory controller remains the sole revision/reservation authority.
 */
export class DoseDeductionAdmissionFlow {
  private readonly activeAdmissions = new Set<Promise<boolean>>();
  private closing = false;
  private drainPromise: Promise<void> | null = null;

  constructor(
    private readonly deps: DoseDeductionDependencies,
    private readonly host: DoseDeductionHost
  ) {}

  admit(request: DoseDeductionRequest): Promise<boolean> {
    if (this.closing) return Promise.resolve(false);
    // run() reaches reservation before its first await. Foreground stock edits
    // must observe that physical ordering synchronously.
    const execution = this.run(request);
    let tracked: Promise<boolean>;
    tracked = execution.finally(() => this.activeAdmissions.delete(tracked));
    this.activeAdmissions.add(tracked);
    return tracked;
  }

  adoptSettlement(settlement: DoseMutationSettlement): void {
    if (this.closing || this.host.snapshot().disposed) {
      this.deps.inventory.releasePendingRemainingWeight(settlement.idempotencyKey);
      return;
    }
    const hasLaterPendingAdjustment = this.deps.inventory.hasPendingRemainingWeightAfter(
      settlement.idempotencyKey,
      settlement.entry.beanId,
      settlement.entry.batchId
    );
    const projection = hasLaterPendingAdjustment || settlement.entry.expectedRemaining == null
      ? null
      : this.deps.inventory.reconcileRemainingWeight({
          beanId: settlement.entry.beanId,
          batchId: settlement.entry.batchId,
          expectedCurrent: settlement.entry.expectedRemaining,
          resolvedRemaining: settlement.resolvedRemaining,
          fieldRevision: settlement.projectionRevision
        });
    this.deps.inventory.releasePendingRemainingWeight(settlement.idempotencyKey);
    if (projection) this.host.commit({ type: 'projection', projection });
    if (
      settlement.outcome === 'not-applicable' ||
      (!projection && !hasLaterPendingAdjustment)
    ) {
      this.host.commit({ type: 'review-required', beanId: settlement.entry.beanId });
    }
  }

  adoptCanonicalization(canonicalization: DoseMutationCanonicalization): void {
    if (this.closing || this.host.snapshot().disposed) return;
    const projection = this.deps.inventory.reconcileRemainingWeight({
      beanId: canonicalization.entry.beanId,
      batchId: canonicalization.entry.batchId,
      expectedCurrent: canonicalization.projectedExpectedRemaining,
      resolvedRemaining: canonicalization.entry.expectedRemaining,
      fieldRevision: canonicalization.projectionRevision
    });
    this.deps.inventory.retainPendingRemainingWeight({
      idempotencyKey: canonicalization.idempotencyKey,
      beanId: canonicalization.entry.beanId,
      batchId: canonicalization.entry.batchId,
      expectedRemaining: canonicalization.entry.expectedRemaining,
      fieldRevision: canonicalization.projectionRevision ??
        this.deps.inventory.remainingWeightRevision(canonicalization.entry.batchId)
    });
    if (projection) this.host.commit({ type: 'projection', projection });
    else this.host.commit({
      type: 'review-required',
      beanId: canonicalization.entry.beanId
    });
  }

  disposeAndWait(): Promise<void> {
    if (this.drainPromise) return this.drainPromise;
    this.closing = true;
    this.drainPromise = Promise.allSettled([...this.activeAdmissions]).then(() => {});
    return this.drainPromise;
  }

  private async run(request: DoseDeductionRequest): Promise<boolean> {
    const dose = positiveNumber(request.doseWeight);
    if (dose == null || !request.shotId) return false;
    const batch = (this.host.snapshot().batchesByBean[request.bean.id] ?? [])
      .find((candidate) => candidate.id === request.batchId);
    const remaining = positiveNumber(batch?.weightRemaining);
    if (!batch || remaining == null) return false;
    const next = Math.max(0, round1(remaining - dose));
    if (request.demo) {
      await this.deps.applyDemoDeduction({
        bean: request.bean,
        batchId: batch.id,
        weightRemaining: next,
        status: `Bag: ${formatGrams(next)} left`
      });
      return true;
    }

    const projectionRevision = this.deps.inventory.remainingWeightRevision(batch.id);
    const idempotencyKey = pendingDoseIdempotencyKey(request.shotId, batch.id);
    const reservationCreated = this.deps.inventory.reservePendingRemainingWeight({
      idempotencyKey,
      beanId: request.bean.id,
      batchId: batch.id,
      fieldRevision: projectionRevision
    });
    let settlementPending = false;
    try {
      const queued = await this.deps.enqueue({
        shotId: request.shotId,
        batchId: batch.id,
        beanId: request.bean.id,
        dose,
        // Absolute base/target evidence makes an ambiguous retry idempotent.
        baseRemaining: remaining,
        expectedRemaining: next,
        projectionRevision,
        at: this.deps.now().toISOString()
      });
      settlementPending = queued.settlementPending;
      if (!queued.settlementPending) {
        this.deps.inventory.releasePendingRemainingWeight(idempotencyKey);
        this.host.commit({ type: 'review-required', beanId: request.bean.id });
      }
      const admittedRemaining = queued.expectedRemaining;
      if (!queued.inserted && queued.settlementPending) {
        this.host.commit({ type: 'review-required', beanId: request.bean.id });
        if (remaining === admittedRemaining) {
          this.deps.inventory.retainPendingRemainingWeight({
            idempotencyKey: queued.idempotencyKey,
            beanId: request.bean.id,
            batchId: batch.id,
            expectedRemaining: admittedRemaining,
            fieldRevision: projectionRevision
          });
        }
      }
      try {
        const snapshot = this.host.snapshot();
        const currentBatches = snapshot.batchesByBean[request.bean.id] ?? [];
        const currentBatch = currentBatches.find((candidate) => candidate.id === batch.id);
        const stillOwnsProjection =
          !this.closing &&
          !snapshot.disposed &&
          this.deps.inventory.remainingWeightRevision(batch.id) === projectionRevision &&
          currentBatch?.weightRemaining === remaining;
        if (queued.inserted && stillOwnsProjection) {
          const batches = currentBatches.map((candidate) => candidate.id === batch.id
            ? { ...candidate, weightRemaining: admittedRemaining }
            : candidate);
          this.deps.inventory.retainPendingRemainingWeight({
            idempotencyKey: queued.idempotencyKey,
            beanId: request.bean.id,
            batchId: batch.id,
            expectedRemaining: admittedRemaining,
            fieldRevision: projectionRevision
          });
          const projection: BeanInventoryProjection = {
            beanId: request.bean.id,
            batches,
            shouldScheduleApply: false
          };
          this.host.commit({
            type: 'projection',
            projection,
            status: queued.durability === 'indexeddb' || queued.durability === 'local-storage'
              ? `Bag: ${formatGrams(admittedRemaining)} left`
              : `Bag: ${formatGrams(admittedRemaining)} left — device storage unavailable`
          });
          void this.deps.inventory.cacheProjection(projection);
        } else if (
          queued.inserted && !stillOwnsProjection && !this.closing && !snapshot.disposed
        ) {
          this.host.commit({ type: 'review-required', beanId: request.bean.id });
        }
      } finally {
        queued.releaseProjection();
      }
      return true;
    } catch (error) {
      if (reservationCreated && !settlementPending) {
        this.deps.inventory.releasePendingRemainingWeight(idempotencyKey);
      }
      this.host.commit({
        type: 'admission-failed',
        error,
        status: 'Bag update could not be queued'
      });
      return false;
    }
  }
}

function positiveNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
