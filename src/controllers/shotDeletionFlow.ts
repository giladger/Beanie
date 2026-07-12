import type { BeanBatch } from '../api/types';
import { doseReclaimRemaining } from '../domain/doseReclaim';
import { pendingDoseReclaimIdempotencyKey } from '../domain/mutationOutbox';
import type {
  BeanInventoryProjection,
  DemoDoseReclaimOutcome,
  PendingRemainingWeightAdjustment,
  PendingRemainingWeightReservation
} from './beanInventoryController';
import type {
  DoseReclaimEnqueueResult,
  EnqueueDoseReclaimInput,
  ExistingDoseReclaim
} from './doseMutationReconciler';
import {
  executeShotDeletion,
  projectDeletedShot,
  type DeleteShotInput,
  type DeleteShotResult,
  type ShotDeletionListProjection,
  type ShotDeletionListSnapshot,
  type ShotDoseReclaimIntent,
  type ShotDoseReclaimSettlement
} from './shotMetadataController';

export interface ShotDeletionFlowSnapshot extends ShotDeletionListSnapshot {
  readonly batchesByBean: Readonly<Record<string, readonly BeanBatch[]>>;
}

export interface ShotDeletionFlowDependencies {
  snapshot(): ShotDeletionFlowSnapshot;
  runtimeRevision(): number;
  deleteShot(shotId: string): Promise<void>;
  isAlreadyDeleted(error: unknown): boolean;
  /** Fence list reads synchronously after the remote DELETE settles. */
  onRemoteDeleteSettled(): void;
  invalidateShotMutation(shotId: string): Promise<void>;
  reclaimDemo(intent: ShotDoseReclaimIntent): Promise<DemoDoseReclaimOutcome>;
  existingReclaim(shotId: string, batchId: string): Promise<ExistingDoseReclaim | null>;
  enqueueReclaim(input: EnqueueDoseReclaimInput): Promise<DoseReclaimEnqueueResult>;
  remainingWeightRevision(batchId: string): number;
  reservePendingRemainingWeight(reservation: PendingRemainingWeightReservation): boolean;
  retainPendingRemainingWeight(adjustment: PendingRemainingWeightAdjustment): boolean;
  releasePendingRemainingWeight(idempotencyKey: string): void;
  commitInventoryProjection(projection: BeanInventoryProjection): void;
  wakeReconciliation(): void;
  now(): Date;
}

type DeletedShotResult = Extract<DeleteShotResult, { type: 'deleted' }>;
type FailedShotResult = Extract<DeleteShotResult, { type: 'failed' }>;

export type ShotDeletionFlowResult =
  | FailedShotResult
  | {
      readonly type: 'superseded';
      readonly shotId: string;
      readonly status: 'Delete result belongs to a previous runtime';
    }
  | (DeletedShotResult & {
      readonly shotProjection: ShotDeletionListProjection;
      readonly inventoryReviewBeanId: string | null;
    });

interface DeletionEffects {
  inventoryProjection: BeanInventoryProjection | null;
  inventoryReviewBeanId: string | null;
  optimisticInventory: {
    readonly intent: ShotDoseReclaimIntent;
    readonly admittedRemaining: number;
    readonly expectedRemaining: number;
    readonly projectionRevision: number;
    readonly idempotencyKey: string;
  } | null;
  releaseProjection: (() => void) | null;
  reservationId: string | null;
  reservationCreated: boolean;
  reservationRetained: boolean;
  reclaimAdmission: {
    readonly intent: ShotDoseReclaimIntent;
    readonly admittedRemaining: number | null;
    readonly expectedRemaining: number | null;
    readonly projectionRevision: number;
  } | null;
}

/**
 * Owns the cross-resource policy for deleting a shot and returning its dose.
 * App supplies snapshots and adapters, then commits the typed projections.
 */
export class ShotDeletionFlow {
  private readonly active = new Set<Promise<ShotDeletionFlowResult>>();
  private accepting = true;

  constructor(private readonly deps: ShotDeletionFlowDependencies) {}

  execute(input: DeleteShotInput): Promise<ShotDeletionFlowResult> {
    if (!this.accepting) {
      return Promise.resolve({
        type: 'failed',
        shotId: input.shotId,
        error: new Error('Shot deletion flow has been disposed'),
        status: 'Delete shot failed'
      });
    }
    const execution = this.runExecution(input);
    let tracked: Promise<ShotDeletionFlowResult>;
    tracked = execution.then(
      (result) => {
        this.active.delete(tracked);
        return result;
      },
      (error: unknown) => {
        this.active.delete(tracked);
        throw error;
      }
    );
    this.active.add(tracked);
    return tracked;
  }

  /** Stop new deletions and wait until every admitted delete/reclaim continuation settles. */
  async disposeAndWait(): Promise<void> {
    this.accepting = false;
    await Promise.allSettled([...this.active]);
  }

  private async runExecution(input: DeleteShotInput): Promise<ShotDeletionFlowResult> {
    const runtimeRevision = this.deps.runtimeRevision();
    const effects: DeletionEffects = {
      inventoryProjection: null,
      inventoryReviewBeanId: null,
      optimisticInventory: null,
      releaseProjection: null,
      reservationId: null,
      reservationCreated: false,
      reservationRetained: false,
      reclaimAdmission: null
    };
    if (!input.demo && input.reclaim) {
      const batch = this.deps.snapshot().batchesByBean[input.reclaim.beanId]
        ?.find((candidate) => candidate.id === input.reclaim?.batchId);
      const remaining = typeof batch?.weightRemaining === 'number' &&
        Number.isFinite(batch.weightRemaining) && batch.weightRemaining >= 0
        ? batch.weightRemaining
        : null;
      const projectionRevision = this.deps.remainingWeightRevision(input.reclaim.batchId);
      effects.reclaimAdmission = {
        intent: input.reclaim,
        admittedRemaining: remaining,
        expectedRemaining: remaining == null
          ? null
          : doseReclaimRemaining(remaining, input.reclaim.dose, batch?.weight),
        projectionRevision
      };
      const idempotencyKey = pendingDoseReclaimIdempotencyKey(
        input.shotId,
        input.reclaim.batchId
      );
      effects.reservationId = idempotencyKey;
      effects.reservationCreated = this.deps.reservePendingRemainingWeight({
        idempotencyKey,
        beanId: input.reclaim.beanId,
        batchId: input.reclaim.batchId,
        fieldRevision: projectionRevision
      });
    }
    try {
      const result = await executeShotDeletion(input, {
        deleteShot: (shotId) => this.deps.deleteShot(shotId),
        isAlreadyDeleted: (error) => this.deps.isAlreadyDeleted(error),
        onRemoteDeleteSettled: () => this.deps.onRemoteDeleteSettled(),
        invalidateShotMutation: (shotId) => this.deps.invalidateShotMutation(shotId),
        reclaimDose: (intent, context) => this.reclaimDose(
          input,
          intent,
          context.deleteAlreadyAbsent,
          effects
        )
      });
      if (result.type === 'failed') return result;
      if (this.deps.runtimeRevision() !== runtimeRevision) {
        return {
          type: 'superseded',
          shotId: input.shotId,
          status: 'Delete result belongs to a previous runtime'
        };
      }

      // Cache invalidation is allowed to yield after reclaim admission. Recheck
      // the scalar and its ABA-safe field revision at the actual commit boundary.
      const optimistic = effects.optimisticInventory;
      if (optimistic) {
        if (
          this.deps.remainingWeightRevision(optimistic.intent.batchId) ===
            optimistic.projectionRevision
        ) {
          effects.inventoryProjection = this.optimisticProjection(
            optimistic.intent,
            optimistic.admittedRemaining,
            optimistic.expectedRemaining
          );
        }
        if (!effects.inventoryProjection) {
          effects.inventoryReviewBeanId = optimistic.intent.beanId;
        }
      }
      if (effects.inventoryProjection) {
        if (optimistic) {
          this.deps.retainPendingRemainingWeight({
            idempotencyKey: optimistic.idempotencyKey,
            beanId: optimistic.intent.beanId,
            batchId: optimistic.intent.batchId,
            expectedRemaining: optimistic.expectedRemaining,
            fieldRevision: optimistic.projectionRevision
          });
        }
        this.deps.commitInventoryProjection(effects.inventoryProjection);
      }

      const latest = this.deps.snapshot();
      return {
        ...result,
        shotProjection: projectDeletedShot(latest, input.shotId, {
          decrementTotal: !result.deleteAlreadyAbsent
        }),
        inventoryReviewBeanId: effects.inventoryReviewBeanId
      };
    } finally {
      // A claimed worker may be waiting on this admission hand-off. Release it
      // after projection commit (or after deciding a newer intent owns state).
      effects.releaseProjection?.();
      if (
        effects.reservationId &&
        effects.reservationCreated &&
        !effects.reservationRetained
      ) {
        this.deps.releasePendingRemainingWeight(effects.reservationId);
      }
    }
  }

  private async reclaimDose(
    input: DeleteShotInput,
    intent: ShotDoseReclaimIntent,
    deleteAlreadyAbsent: boolean,
    effects: DeletionEffects
  ): Promise<ShotDoseReclaimSettlement> {
    if (input.demo) return this.reclaimDemo(intent, effects);
    if (deleteAlreadyAbsent) {
      return this.resumeExistingReclaim(input.shotId, intent, effects);
    }
    return this.enqueueRemoteReclaim(input, intent, effects);
  }

  private async reclaimDemo(
    intent: ShotDoseReclaimIntent,
    effects: DeletionEffects
  ): Promise<ShotDoseReclaimSettlement> {
    const outcome = await this.deps.reclaimDemo(intent);
    switch (outcome.type) {
      case 'reclaimed':
        effects.inventoryProjection = outcome.projection;
        return { type: 'reclaimed', resolvedRemaining: outcome.resolvedRemaining };
      case 'not-applicable':
        return { type: 'not-applicable', reason: outcome.reason };
    }
  }

  private async resumeExistingReclaim(
    shotId: string,
    intent: ShotDoseReclaimIntent,
    effects: DeletionEffects
  ): Promise<ShotDoseReclaimSettlement> {
    let existing: ExistingDoseReclaim | null;
    try {
      existing = await this.deps.existingReclaim(shotId, intent.batchId);
    } catch (error) {
      effects.inventoryReviewBeanId = intent.beanId;
      throw error;
    }
    if (!existing) return { type: 'not-applicable', reason: 'already-deleted' };
    if (
      existing.beanId !== intent.beanId ||
      existing.batchId !== intent.batchId ||
      existing.dose !== intent.dose
    ) {
      // The owned journal is authoritative on a retry; never redirect it from
      // a changed/corrupt shot annotation captured by the confirmation modal.
      effects.inventoryReviewBeanId = existing.beanId;
      return { type: 'not-applicable', reason: 'existing-command-mismatch' };
    }
    if (existing.state === 'acknowledged') {
      // Tombstones are not claimed/emitted again after restart. Force the next
      // inventory inspection to hydrate the receipt's remote scalar instead
      // of leaving an older cached projection indefinitely.
      effects.inventoryReviewBeanId = intent.beanId;
      if (existing.outcome !== 'not-applicable' && existing.resolvedRemaining != null) {
        return { type: 'reclaimed', resolvedRemaining: existing.resolvedRemaining };
      }
      return { type: 'not-applicable', reason: 'already-settled' };
    }
    const currentRemaining = this.deps.snapshot().batchesByBean[intent.beanId]
      ?.find((batch) => batch.id === intent.batchId)?.weightRemaining;
    if (
      !isDurable(existing.durability) ||
      currentRemaining !== existing.expectedRemaining
    ) effects.inventoryReviewBeanId = intent.beanId;
    effects.reservationRetained = true;
    if (currentRemaining === existing.expectedRemaining && effects.reservationId) {
      const projectionRevision = effects.reclaimAdmission?.projectionRevision ??
        this.deps.remainingWeightRevision(intent.batchId);
      effects.reservationRetained = this.deps.retainPendingRemainingWeight({
        idempotencyKey: effects.reservationId,
        beanId: intent.beanId,
        batchId: intent.batchId,
        expectedRemaining: existing.expectedRemaining,
        fieldRevision: projectionRevision
      });
    }
    this.deps.wakeReconciliation();
    return {
      type: 'queued',
      expectedRemaining: existing.expectedRemaining,
      durability: existing.durability
    };
  }

  private async enqueueRemoteReclaim(
    input: DeleteShotInput,
    intent: ShotDoseReclaimIntent,
    effects: DeletionEffects
  ): Promise<ShotDoseReclaimSettlement> {
    const admission = effects.reclaimAdmission;
    const ownsAdmission = admission != null &&
      admission.intent.beanId === intent.beanId &&
      admission.intent.batchId === intent.batchId &&
      admission.intent.dose === intent.dose;
    const admittedRemaining = ownsAdmission ? admission.admittedRemaining : null;
    const expectedRemaining = ownsAdmission ? admission.expectedRemaining : null;
    const tracked = admittedRemaining != null && expectedRemaining != null;
    if (expectedRemaining == null) {
      // A replay-safe reclaim needs a client-side lost-response heuristic.
      // The modal preview is display-only and may be stale, so refuse to
      // journal an unbounded +dose and force authoritative inventory review.
      effects.inventoryReviewBeanId = intent.beanId;
      return { type: 'not-applicable', reason: 'untracked-remaining' };
    }

    const projectionRevision = admission!.projectionRevision;
    try {
      const queued = await this.deps.enqueueReclaim({
        shotId: input.shotId,
        beanId: intent.beanId,
        batchId: intent.batchId,
        dose: intent.dose,
        expectedRemaining,
        projectionRevision,
        at: this.deps.now().toISOString()
      });
      effects.releaseProjection = queued.releaseProjection;
      effects.reservationRetained = queued.settlementPending;
      const queuedExpectedRemaining = queued.expectedRemaining;
      if (!isDurable(queued.durability)) effects.inventoryReviewBeanId = intent.beanId;
      if (
        !queued.inserted &&
        queued.settlementPending &&
        admittedRemaining === queuedExpectedRemaining
      ) {
        effects.reservationRetained = this.deps.retainPendingRemainingWeight({
          idempotencyKey: queued.idempotencyKey,
          beanId: intent.beanId,
          batchId: intent.batchId,
          expectedRemaining: queuedExpectedRemaining,
          fieldRevision: projectionRevision
        });
      }
      if (queued.inserted && tracked) {
        effects.optimisticInventory = {
          intent,
          admittedRemaining,
          expectedRemaining: queuedExpectedRemaining,
          projectionRevision,
          idempotencyKey: queued.idempotencyKey
        };
      }
      return {
        type: 'queued',
        expectedRemaining: queuedExpectedRemaining,
        durability: queued.durability
      };
    } catch (error) {
      effects.inventoryReviewBeanId = intent.beanId;
      throw error;
    }
  }

  private optimisticProjection(
    intent: ShotDoseReclaimIntent,
    admittedRemaining: number,
    expectedRemaining: number
  ): BeanInventoryProjection | null {
    const current = this.deps.snapshot().batchesByBean[intent.beanId] ?? [];
    const currentBatch = current.find((batch) => batch.id === intent.batchId);
    if (currentBatch?.weightRemaining !== admittedRemaining) return null;
    return {
      beanId: intent.beanId,
      batches: current.map((batch) => batch.id === intent.batchId
        ? { ...batch, weightRemaining: expectedRemaining }
        : batch),
      shouldScheduleApply: false
    };
  }
}

function isDurable(durability: DoseReclaimEnqueueResult['durability']): boolean {
  return durability === 'indexeddb' || durability === 'local-storage';
}
