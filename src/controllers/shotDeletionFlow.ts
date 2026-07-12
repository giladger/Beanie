import type { BeanBatch } from '../api/types';
import { doseReclaimRemaining } from '../domain/doseReclaim';
import {
  IdempotencyConflictError,
  pendingDoseReclaimIdempotencyKey,
  type MutationReceiptOutcome
} from '../domain/mutationOutbox';
import { BackgroundTask, type BackgroundTaskScheduler } from '../runtime/backgroundTask';
import type {
  BeanInventoryProjection,
  DemoDoseReclaimOutcome,
  PendingRemainingWeightAdjustment,
  PendingRemainingWeightReservation
} from './beanInventoryController';
import {
  shotDeleteReclaimIdempotencyKey,
  type DoseReclaimEnqueueResult,
  type ExistingDoseReclaim,
  type PendingShotDeleteReclaimReservation,
  type PreparedShotDeleteReclaim,
  type PrepareShotDeleteReclaimInput,
  type ShotDeleteReclaimClaim,
  type ShotDeleteReclaimRetry,
  type ShotDeleteReclaimTransaction
} from './doseMutationReconciler';
import {
  executeShotDeletion,
  projectDeletedShot,
  shotDeletionStatus,
  type DeleteShotInput,
  type DeleteShotResult,
  type ShotDeletionListProjection,
  type ShotDeletionListSnapshot,
  type ShotDoseReclaimIntent,
  type ShotDoseReclaimSettlement
} from './shotMetadataController';

export const SHOT_DELETE_RECLAIM_RECONCILE_INTERVAL_MS = 60_000;

export interface ShotDeletionFlowSnapshot extends ShotDeletionListSnapshot {
  readonly batchesByBean: Readonly<Record<string, readonly BeanBatch[]>>;
}

export interface ShotDeletionFlowDependencies {
  snapshot(): ShotDeletionFlowSnapshot;
  runtimeRevision(): number;
  /**
   * Enter the canonical shot lane, then let the flow claim its journal record
   * immediately before invoking the supplied remote DELETE capability.
   */
  runDeleteShotTransaction<Value>(
    shotId: string,
    run: (deleteRemote: () => Promise<void>) => Value | PromiseLike<Value>
  ): Promise<Value>;
  isAlreadyDeleted(error: unknown): boolean;
  /** Fence list reads synchronously after the remote DELETE settles. */
  onRemoteDeleteSettled(): void;
  invalidateShotMutation(shotId: string): Promise<void>;
  reclaimDemo(intent: ShotDoseReclaimIntent): Promise<DemoDoseReclaimOutcome>;
  prepareShotDeleteReclaim(
    input: PrepareShotDeleteReclaimInput
  ): Promise<PreparedShotDeleteReclaim>;
  pendingShotDeleteReclaims(): Promise<readonly PendingShotDeleteReclaimReservation[]>;
  claimShotDeleteReclaim(idempotencyKey: string): Promise<ShotDeleteReclaimClaim | null>;
  retryShotDeleteReclaim(
    claim: ShotDeleteReclaimClaim,
    error: unknown
  ): Promise<ShotDeleteReclaimRetry>;
  terminateShotDeleteReclaim(
    claim: ShotDeleteReclaimClaim,
    reason: 'reclaim-idempotency-conflict',
    deleteOutcome: Extract<MutationReceiptOutcome, 'committed' | 'already-applied'>
  ): Promise<boolean>;
  handoffShotDeleteReclaim(
    claim: ShotDeleteReclaimClaim,
    outcome: Extract<MutationReceiptOutcome, 'committed' | 'already-applied'>
  ): Promise<DoseReclaimEnqueueResult | null>;
  existingReclaim(
    shotId: string,
    batchId: string,
    projectionRevision?: number
  ): Promise<ExistingDoseReclaim | null>;
  remainingWeightRevision(batchId: string): number;
  reservePendingRemainingWeight(reservation: PendingRemainingWeightReservation): boolean;
  retainPendingRemainingWeight(adjustment: PendingRemainingWeightAdjustment): boolean;
  releasePendingRemainingWeight(idempotencyKey: string): void;
  commitInventoryProjection(projection: BeanInventoryProjection): void;
  wakeReconciliation(): void;
  onRecoveredDeletion(result: CompletedShotDeletionFlowResult): void;
  onTransactionRetry(error: unknown, retryAt: Date | null): void;
  onAuxiliaryFailure(operation: 'cache-invalidation' | 'recovered-projection', error: unknown): void;
  now(): Date;
}

type DeletedShotResult = Extract<DeleteShotResult, { type: 'deleted' }>;
type FailedShotResult = Extract<DeleteShotResult, { type: 'failed' }>;

export type CompletedShotDeletionFlowResult = DeletedShotResult & {
  readonly shotProjection: ShotDeletionListProjection;
  readonly inventoryReviewBeanId: string | null;
};

export type ShotDeletionFlowResult =
  | FailedShotResult
  | {
      readonly type: 'queued';
      readonly shotId: string;
      readonly status: 'Delete queued — will retry';
    }
  | {
      readonly type: 'superseded';
      readonly shotId: string;
      readonly status: 'Delete result belongs to a previous runtime';
    }
  | CompletedShotDeletionFlowResult;

export interface ShotDeletionFlowOptions {
  readonly scheduler?: BackgroundTaskScheduler;
}

interface DeletionEffects {
  inventoryProjection: BeanInventoryProjection | null;
  inventoryReviewBeanId: string | null;
  releaseProjection: (() => void) | null;
  optimisticInventory: {
    readonly transaction: ShotDeleteReclaimTransaction;
    readonly admittedExpectedRemaining: number;
    readonly canonicalExpectedRemaining: number;
    readonly projectionRevision: number;
  } | null;
}

type TransactionDispatch =
  | {
      readonly type: 'queued';
      readonly error: unknown;
    }
  | {
      readonly type: 'deleted';
      readonly deleteAlreadyAbsent: boolean;
      readonly reclaim: DoseReclaimEnqueueResult;
    }
  | {
      readonly type: 'manual-review';
      readonly deleteAlreadyAbsent: boolean;
      readonly error: unknown;
    };

/**
 * Owns the two-resource shot-delete transaction.
 *
 * A reclaiming remote deletion first occupies the bean's durable causal slot.
 * Only the owner of that record may issue DELETE; a successful response (or
 * owned 404 replay) atomically turns the record into the ordinary reclaim
 * command consumed by DoseMutationReconciler.
 */
export class ShotDeletionFlow {
  private readonly active = new Set<Promise<ShotDeletionFlowResult>>();
  private readonly activeTransactionIds = new Set<string>();
  /** Includes work another browser context may acknowledge between discovery passes. */
  private readonly knownTransactions = new Map<string, ShotDeleteReclaimTransaction>();
  private readonly task: BackgroundTask;
  private recoveryRun: Promise<void> | null = null;
  private disposePromise: Promise<void> | null = null;
  private accepting = true;

  constructor(
    private readonly deps: ShotDeletionFlowDependencies,
    options: ShotDeletionFlowOptions = {}
  ) {
    this.task = new BackgroundTask({
      intervalMs: SHOT_DELETE_RECLAIM_RECONCILE_INTERVAL_MS,
      scheduler: options.scheduler,
      run: () => this.runRecoveryTracked(),
      onError: (error) => this.deps.onTransactionRetry(error, null)
    });
  }

  start(
    discovered: readonly PendingShotDeleteReclaimReservation[] = []
  ): Promise<void> {
    if (!this.accepting) return Promise.resolve();
    for (const reservation of discovered) {
      this.knownTransactions.set(reservation.idempotencyKey, reservation.transaction);
    }
    this.task.start();
    return this.runRecoveryTracked();
  }

  trigger(): Promise<void> {
    if (!this.accepting) return Promise.resolve();
    this.task.start();
    this.task.trigger();
    return this.recoveryRun ?? Promise.resolve();
  }

  execute(input: DeleteShotInput): Promise<ShotDeletionFlowResult> {
    if (!this.accepting) {
      return Promise.resolve(failedResult(
        input.shotId,
        new Error('Shot deletion flow has been disposed')
      ));
    }
    const execution = this.runExecution(input).catch((error) =>
      failedResult(input.shotId, error)
    );
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

  /** Stop new recovery/admission and drain every already-owned continuation. */
  disposeAndWait(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.accepting = false;
    this.task.dispose();
    const recovery = this.recoveryRun;
    this.disposePromise = Promise.allSettled([
      ...this.active,
      ...(recovery ? [recovery] : [])
    ]).then(() => undefined);
    return this.disposePromise;
  }

  private async runExecution(input: DeleteShotInput): Promise<ShotDeletionFlowResult> {
    if (!input.demo && input.reclaim) return this.runJournaledExecution(input, input.reclaim);
    if (!input.demo && await this.hasPendingDeleteIntent(input.shotId)) {
      this.task.start();
      this.task.trigger();
      return queuedResult(input.shotId);
    }
    return this.runSimpleExecution(input);
  }

  private async runSimpleExecution(input: DeleteShotInput): Promise<ShotDeletionFlowResult> {
    const runtimeRevision = this.deps.runtimeRevision();
    const effects: DeletionEffects = {
      inventoryProjection: null,
      inventoryReviewBeanId: null,
      releaseProjection: null,
      optimisticInventory: null
    };
    const result = await executeShotDeletion(input, {
      deleteShot: (shotId) =>
        this.deps.runDeleteShotTransaction(shotId, (deleteRemote) => deleteRemote()),
      isAlreadyDeleted: (error) => this.deps.isAlreadyDeleted(error),
      onRemoteDeleteSettled: () => this.deps.onRemoteDeleteSettled(),
      invalidateShotMutation: (shotId) => this.deps.invalidateShotMutation(shotId),
      reclaimDose: (intent) => this.reclaimDemo(intent, effects)
    });
    if (result.type === 'failed') return result;
    if (this.deps.runtimeRevision() !== runtimeRevision) {
      return supersededResult(input.shotId);
    }
    if (effects.inventoryProjection) {
      this.deps.commitInventoryProjection(effects.inventoryProjection);
    }
    return this.completedResult(input.shotId, result, effects.inventoryReviewBeanId);
  }

  private async runJournaledExecution(
    input: DeleteShotInput,
    intent: ShotDoseReclaimIntent
  ): Promise<ShotDeletionFlowResult> {
    const runtimeRevision = this.deps.runtimeRevision();
    const admission = this.captureAdmission(intent);
    if (!admission) {
      return failedResult(
        input.shotId,
        new Error('Cannot safely return this dose because remaining bag weight is unavailable')
      );
    }

    const idempotencyKey = shotDeleteReclaimIdempotencyKey(input.shotId);
    const sourceReservationCreated = this.deps.reservePendingRemainingWeight({
      idempotencyKey,
      beanId: intent.beanId,
      batchId: intent.batchId,
      fieldRevision: admission.projectionRevision
    });
    let retainSourceReservation = false;
    try {
      let prepared: PreparedShotDeleteReclaim;
      try {
        prepared = await this.deps.prepareShotDeleteReclaim({
          shotId: input.shotId,
          beanId: intent.beanId,
          batchId: intent.batchId,
          dose: intent.dose,
          expectedRemaining: admission.expectedRemaining,
          projectionRevision: admission.projectionRevision,
          at: this.deps.now().toISOString()
        });
      } catch (error) {
        return failedResult(input.shotId, error);
      }

      this.knownTransactions.set(prepared.idempotencyKey, prepared.transaction);
      retainSourceReservation = true;
      if (prepared.state === 'acknowledged') {
        let completed: CompletedShotDeletionFlowResult;
        try {
          completed = await this.resumeAcknowledgedTransaction(
            input.shotId,
            prepared.transaction,
            prepared.deleteOutcome !== 'committed'
          );
        } catch (error) {
          this.deps.onTransactionRetry(error, null);
          this.task.start();
          return queuedResult(input.shotId);
        }
        this.knownTransactions.delete(prepared.idempotencyKey);
        this.deps.releasePendingRemainingWeight(prepared.idempotencyKey);
        retainSourceReservation = false;
        if (this.deps.runtimeRevision() !== runtimeRevision) {
          return supersededResult(input.shotId);
        }
        return completed;
      }

      let result: TransactionDispatch | null;
      try {
        result = await this.withTransaction(
          prepared.idempotencyKey,
          () => this.dispatchPreparedTransaction(
            prepared.idempotencyKey,
            prepared.transaction,
            admission,
            true
          )
        );
      } catch (error) {
        this.deps.onTransactionRetry(error, null);
        this.task.start();
        return queuedResult(input.shotId);
      }
      if (!result || result.type === 'queued') {
        this.task.start();
        return queuedResult(input.shotId);
      }
      this.knownTransactions.delete(prepared.idempotencyKey);
      retainSourceReservation = false;
      if (result.type === 'manual-review') {
        this.deps.releasePendingRemainingWeight(prepared.idempotencyKey);
        const completed = await this.finishManualReviewDeletion(
          input.shotId,
          result.deleteAlreadyAbsent,
          prepared.transaction,
          result.error
        );
        return this.deps.runtimeRevision() === runtimeRevision
          ? completed
          : supersededResult(input.shotId);
      }
      const effects = this.adoptHandoff(
        result.reclaim,
        prepared.transaction,
        admission,
        prepared.inserted
      );
      // Install the child reservation before resolving waiters on the source;
      // both calls are synchronous, so no foreground stock write can enter
      // between the two durable phases.
      this.deps.releasePendingRemainingWeight(prepared.idempotencyKey);
      try {
        const completed = await this.finishJournaledDeletion(
          input.shotId,
          result.deleteAlreadyAbsent,
          result.reclaim,
          prepared.transaction,
          effects,
          runtimeRevision
        );
        if (this.deps.runtimeRevision() !== runtimeRevision) {
          return supersededResult(input.shotId);
        }
        return completed;
      } finally {
        effects.releaseProjection?.();
      }
    } finally {
      if (sourceReservationCreated && !retainSourceReservation) {
        this.deps.releasePendingRemainingWeight(idempotencyKey);
      }
    }
  }

  private async dispatchPreparedTransaction(
    idempotencyKey: string,
    transaction: ShotDeleteReclaimTransaction,
    _admission: { readonly projectionRevision: number; readonly expectedRemaining: number },
    foreground: boolean
  ): Promise<TransactionDispatch> {
    return this.deps.runDeleteShotTransaction(transaction.shotId, async (deleteRemote) => {
      const claim = await this.deps.claimShotDeleteReclaim(idempotencyKey);
      if (!claim) {
        return { type: 'queued', error: new Error('Delete transaction is not due or is owned elsewhere') };
      }
      if (!sameTransaction(claim.transaction, transaction)) {
        const error = new Error('Claimed delete transaction does not match its admitted intent');
        await this.retainForRetry(claim, error);
        return { type: 'queued', error };
      }
      let deleteAlreadyAbsent = false;
      try {
        await deleteRemote();
      } catch (error) {
        if (!this.deps.isAlreadyDeleted(error)) {
          await this.retainForRetry(claim, error);
          return { type: 'queued', error };
        }
        deleteAlreadyAbsent = true;
      }
      this.deps.onRemoteDeleteSettled();

      try {
        const reclaim = await this.deps.handoffShotDeleteReclaim(
          claim,
          deleteAlreadyAbsent ? 'already-applied' : 'committed'
        );
        if (!reclaim) {
          const error = new Error('Delete transaction lease expired before reclaim handoff');
          this.deps.onTransactionRetry(error, null);
          return { type: 'queued', error };
        }
        return { type: 'deleted', deleteAlreadyAbsent, reclaim };
      } catch (error) {
        if (error instanceof IdempotencyConflictError) {
          try {
            const terminated = await this.deps.terminateShotDeleteReclaim(
              claim,
              'reclaim-idempotency-conflict',
              deleteAlreadyAbsent ? 'already-applied' : 'committed'
            );
            if (terminated) {
              return { type: 'manual-review', deleteAlreadyAbsent, error };
            }
          } catch (terminationError) {
            this.deps.onTransactionRetry(terminationError, null);
          }
          return { type: 'queued', error };
        }
        await this.retainForRetry(claim, error);
        return { type: 'queued', error };
      } finally {
        if (!foreground && this.accepting) this.task.start();
      }
    });
  }

  private async retainForRetry(
    claim: ShotDeleteReclaimClaim,
    error: unknown
  ): Promise<void> {
    try {
      const retry = await this.deps.retryShotDeleteReclaim(claim, error);
      this.deps.onTransactionRetry(error, retry.retained ? retry.retryAt : null);
    } catch (retryError) {
      this.deps.onTransactionRetry(new Error(
        'Delete transaction retry could not be persisted',
        { cause: retryError }
      ), null);
    }
  }

  private adoptHandoff(
    reclaim: DoseReclaimEnqueueResult,
    transaction: ShotDeleteReclaimTransaction,
    admission: { readonly projectionRevision: number; readonly expectedRemaining: number },
    allowOptimism: boolean
  ): DeletionEffects {
    const effects: DeletionEffects = {
      inventoryProjection: null,
      inventoryReviewBeanId: reclaim.settlementPending ? null : transaction.beanId,
      releaseProjection: reclaim.releaseProjection,
      optimisticInventory: null
    };
    if (reclaim.settlementPending) {
      this.deps.reservePendingRemainingWeight({
        idempotencyKey: reclaim.idempotencyKey,
        beanId: transaction.beanId,
        batchId: transaction.batchId,
        fieldRevision: admission.projectionRevision
      });
      const retained = this.deps.retainPendingRemainingWeight({
        idempotencyKey: reclaim.idempotencyKey,
        beanId: transaction.beanId,
        batchId: transaction.batchId,
        expectedRemaining: reclaim.expectedRemaining,
        fieldRevision: admission.projectionRevision
      });
      if (!retained) effects.inventoryReviewBeanId = transaction.beanId;
    }
    if (
      allowOptimism &&
      reclaim.inserted &&
      this.deps.remainingWeightRevision(transaction.batchId) === admission.projectionRevision
    ) {
      effects.optimisticInventory = {
        transaction,
        admittedExpectedRemaining: admission.expectedRemaining,
        canonicalExpectedRemaining: reclaim.expectedRemaining,
        projectionRevision: admission.projectionRevision
      };
    }
    if (!effects.optimisticInventory && reclaim.settlementPending) {
      effects.inventoryReviewBeanId = transaction.beanId;
    }
    this.deps.wakeReconciliation();
    return effects;
  }

  private async finishJournaledDeletion(
    shotId: string,
    deleteAlreadyAbsent: boolean,
    reclaim: DoseReclaimEnqueueResult,
    transaction: ShotDeleteReclaimTransaction,
    effects: DeletionEffects,
    runtimeRevision: number
  ): Promise<CompletedShotDeletionFlowResult> {
    let cacheWarning: unknown;
    try {
      await this.deps.invalidateShotMutation(shotId);
    } catch (error) {
      cacheWarning = error;
    }

    const optimistic = effects.optimisticInventory;
    if (
      optimistic &&
      this.deps.runtimeRevision() === runtimeRevision &&
      this.deps.remainingWeightRevision(optimistic.transaction.batchId) ===
        optimistic.projectionRevision
    ) {
      effects.inventoryProjection = this.optimisticProjection(
        optimistic.transaction,
        optimistic.admittedExpectedRemaining,
        optimistic.canonicalExpectedRemaining
      );
    }
    if (effects.inventoryProjection) {
      this.deps.commitInventoryProjection(effects.inventoryProjection);
    } else if (optimistic) {
      effects.inventoryReviewBeanId = optimistic.transaction.beanId;
    }
    const reclaimSettlement = await this.handoffSettlement(
      reclaim,
      transaction,
      this.deps.remainingWeightRevision(transaction.batchId)
    );
    const baseStatus = deleteAlreadyAbsent ? 'Shot already deleted' : 'Shot deleted';
    const result: DeletedShotResult = {
      type: 'deleted',
      shotId,
      remote: true,
      deleteAlreadyAbsent,
      reclaim: reclaimSettlement,
      ...(cacheWarning === undefined ? {} : { cacheWarning }),
      status: shotDeletionStatus(baseStatus, reclaimSettlement, undefined)
    };
    return this.completedResult(shotId, result, effects.inventoryReviewBeanId);
  }

  private async resumeAcknowledgedTransaction(
    shotId: string,
    transaction: ShotDeleteReclaimTransaction,
    deleteAlreadyAbsent: boolean
  ): Promise<CompletedShotDeletionFlowResult> {
    this.deps.onRemoteDeleteSettled();
    const effects: DeletionEffects = {
      inventoryProjection: null,
      inventoryReviewBeanId: transaction.beanId,
      releaseProjection: null,
      optimisticInventory: null
    };
    let reclaim: ShotDoseReclaimSettlement = {
      type: 'not-applicable',
      reason: 'already-settled'
    };
    const projectionRevision = this.deps.remainingWeightRevision(transaction.batchId);
    const existing = await this.deps.existingReclaim(
      shotId,
      transaction.batchId,
      projectionRevision
    );
    if (existing && sameReclaim(existing, transaction)) {
      if (existing.state === 'pending') {
        const childId = pendingDoseReclaimIdempotencyKey(shotId, transaction.batchId);
        this.deps.reservePendingRemainingWeight({
          idempotencyKey: childId,
          beanId: transaction.beanId,
          batchId: transaction.batchId,
          fieldRevision: projectionRevision
        });
        this.deps.retainPendingRemainingWeight({
          idempotencyKey: childId,
          beanId: transaction.beanId,
          batchId: transaction.batchId,
          expectedRemaining: existing.expectedRemaining,
          fieldRevision: projectionRevision
        });
        this.deps.wakeReconciliation();
        reclaim = {
          type: 'queued',
          expectedRemaining: existing.expectedRemaining,
          durability: existing.durability
        };
      } else if (
        existing.outcome !== 'not-applicable' &&
        existing.resolvedRemaining != null
      ) {
        reclaim = { type: 'reclaimed', resolvedRemaining: existing.resolvedRemaining };
      }
    }

    let cacheWarning: unknown;
    try {
      await this.deps.invalidateShotMutation(shotId);
    } catch (error) {
      cacheWarning = error;
    }
    const result: DeletedShotResult = {
      type: 'deleted',
      shotId,
      remote: true,
      deleteAlreadyAbsent,
      reclaim,
      ...(cacheWarning === undefined ? {} : { cacheWarning }),
      status: shotDeletionStatus(
        deleteAlreadyAbsent ? 'Shot already deleted' : 'Shot deleted',
        reclaim,
        undefined
      )
    };
    return this.completedResult(shotId, result, effects.inventoryReviewBeanId);
  }

  private async reclaimDemo(
    intent: ShotDoseReclaimIntent,
    effects: DeletionEffects
  ): Promise<ShotDoseReclaimSettlement> {
    const outcome = await this.deps.reclaimDemo(intent);
    if (outcome.type === 'reclaimed') {
      effects.inventoryProjection = outcome.projection;
      return { type: 'reclaimed', resolvedRemaining: outcome.resolvedRemaining };
    }
    return { type: 'not-applicable', reason: outcome.reason };
  }

  private captureAdmission(intent: ShotDoseReclaimIntent): {
    readonly projectionRevision: number;
    readonly expectedRemaining: number;
  } | null {
    const batch = this.deps.snapshot().batchesByBean[intent.beanId]
      ?.find((candidate) => candidate.id === intent.batchId);
    const remaining = finiteNonNegative(batch?.weightRemaining);
    if (remaining == null) return null;
    return {
      projectionRevision: this.deps.remainingWeightRevision(intent.batchId),
      expectedRemaining: doseReclaimRemaining(remaining, intent.dose, batch?.weight)
    };
  }

  private optimisticProjection(
    transaction: ShotDeleteReclaimTransaction,
    admittedExpectedRemaining: number,
    canonicalExpectedRemaining: number
  ): BeanInventoryProjection | null {
    const current = this.deps.snapshot().batchesByBean[transaction.beanId] ?? [];
    const batch = current.find((candidate) => candidate.id === transaction.batchId);
    const admittedRemaining = finiteNonNegative(batch?.weightRemaining);
    if (admittedRemaining == null) return null;
    // The expected scalar was computed from this exact admission. If a later
    // edit changed the bag, the recomputation no longer matches and optimism
    // must yield to authoritative settlement.
    if (
      doseReclaimRemaining(admittedRemaining, transaction.dose, batch?.weight) !==
      admittedExpectedRemaining
    ) return null;
    return {
      beanId: transaction.beanId,
      batches: current.map((candidate) => candidate.id === transaction.batchId
        ? { ...candidate, weightRemaining: canonicalExpectedRemaining }
        : candidate),
      shouldScheduleApply: false
    };
  }

  private completedResult(
    shotId: string,
    result: DeletedShotResult,
    inventoryReviewBeanId: string | null
  ): CompletedShotDeletionFlowResult {
    const latest = this.deps.snapshot();
    return {
      ...result,
      shotProjection: projectDeletedShot(latest, shotId, {
        decrementTotal: !result.deleteAlreadyAbsent
      }),
      inventoryReviewBeanId
    };
  }

  private runRecoveryTracked(): Promise<void> {
    if (this.recoveryRun) return this.recoveryRun;
    let tracked: Promise<void>;
    tracked = this.recoverPendingTransactions().finally(() => {
      if (this.recoveryRun === tracked) this.recoveryRun = null;
    });
    this.recoveryRun = tracked;
    return tracked;
  }

  private async recoverPendingTransactions(): Promise<void> {
    const pending = await this.deps.pendingShotDeleteReclaims();
    for (const reservation of pending) {
      this.knownTransactions.set(reservation.idempotencyKey, reservation.transaction);
    }
    for (const [idempotencyKey, discovered] of [...this.knownTransactions]) {
      if (!this.accepting) return;
      const runtimeRevision = this.deps.runtimeRevision();
      const projectionRevision = this.deps.remainingWeightRevision(discovered.batchId);
      let prepared: PreparedShotDeleteReclaim;
      try {
        prepared = await this.deps.prepareShotDeleteReclaim({
          ...discovered,
          projectionRevision
        });
      } catch (error) {
        this.deps.onTransactionRetry(error, null);
        continue;
      }
      const transaction = prepared.transaction;
      this.knownTransactions.set(idempotencyKey, transaction);
      this.deps.reservePendingRemainingWeight({
        idempotencyKey,
        beanId: transaction.beanId,
        batchId: transaction.batchId,
        fieldRevision: projectionRevision
      });
      if (prepared.state === 'acknowledged') {
        try {
          const result = await this.resumeAcknowledgedTransaction(
            transaction.shotId,
            transaction,
            prepared.deleteOutcome !== 'committed'
          );
          this.knownTransactions.delete(idempotencyKey);
          this.deps.releasePendingRemainingWeight(idempotencyKey);
          if (this.deps.runtimeRevision() === runtimeRevision) {
            this.publishRecoveredDeletion(result);
          }
        } catch (error) {
          this.deps.onTransactionRetry(error, null);
        }
        continue;
      }
      const dispatch = await this.withTransaction(
        idempotencyKey,
        () => this.dispatchPreparedTransaction(
          idempotencyKey,
          transaction,
          {
            projectionRevision,
            expectedRemaining: transaction.expectedRemaining
          },
          false
        )
      );
      if (!dispatch || dispatch.type === 'queued') continue;

      this.knownTransactions.delete(idempotencyKey);
      if (dispatch.type === 'manual-review') {
        this.deps.releasePendingRemainingWeight(idempotencyKey);
        const result = await this.finishManualReviewDeletion(
          transaction.shotId,
          dispatch.deleteAlreadyAbsent,
          transaction,
          dispatch.error
        );
        if (this.deps.runtimeRevision() === runtimeRevision) {
          this.publishRecoveredDeletion(result);
        }
        continue;
      }
      const effects = this.adoptHandoff(
        dispatch.reclaim,
        transaction,
        {
          projectionRevision,
          expectedRemaining: transaction.expectedRemaining
        },
        false
      );
      this.deps.releasePendingRemainingWeight(idempotencyKey);
      try {
        const result = await this.finishJournaledDeletion(
          transaction.shotId,
          dispatch.deleteAlreadyAbsent,
          dispatch.reclaim,
          transaction,
          effects,
          runtimeRevision
        );
        if (this.deps.runtimeRevision() === runtimeRevision) {
          this.publishRecoveredDeletion(result);
        }
      } finally {
        effects.releaseProjection?.();
      }
    }
  }

  private publishRecoveredDeletion(result: CompletedShotDeletionFlowResult): void {
    try {
      this.deps.onRecoveredDeletion(result);
    } catch (error) {
      this.deps.onAuxiliaryFailure('recovered-projection', error);
    }
  }

  private async finishManualReviewDeletion(
    shotId: string,
    deleteAlreadyAbsent: boolean,
    transaction: ShotDeleteReclaimTransaction,
    error: unknown
  ): Promise<CompletedShotDeletionFlowResult> {
    let cacheWarning: unknown;
    try {
      await this.deps.invalidateShotMutation(shotId);
    } catch (caught) {
      cacheWarning = caught;
    }
    const reclaim: ShotDoseReclaimSettlement = {
      type: 'failed',
      reason: 'reclaim-idempotency-conflict',
      error
    };
    const baseStatus = deleteAlreadyAbsent ? 'Shot already deleted' : 'Shot deleted';
    return this.completedResult(shotId, {
      type: 'deleted',
      shotId,
      remote: true,
      deleteAlreadyAbsent,
      reclaim,
      ...(cacheWarning === undefined ? {} : { cacheWarning }),
      status: shotDeletionStatus(baseStatus, reclaim, undefined)
    }, transaction.beanId);
  }

  private async handoffSettlement(
    handoff: DoseReclaimEnqueueResult,
    transaction: ShotDeleteReclaimTransaction,
    projectionRevision: number
  ): Promise<ShotDoseReclaimSettlement> {
    if (handoff.settlementPending) {
      return {
        type: 'queued',
        expectedRemaining: handoff.expectedRemaining,
        durability: handoff.durability
      };
    }
    const existing = await this.deps.existingReclaim(
      transaction.shotId,
      transaction.batchId,
      projectionRevision
    );
    if (
      existing?.state === 'acknowledged' &&
      existing.outcome !== 'not-applicable' &&
      existing.resolvedRemaining != null
    ) {
      return { type: 'reclaimed', resolvedRemaining: existing.resolvedRemaining };
    }
    return { type: 'not-applicable', reason: 'already-settled' };
  }

  private async withTransaction<Value>(
    idempotencyKey: string,
    run: () => Promise<Value>
  ): Promise<Value | null> {
    if (this.activeTransactionIds.has(idempotencyKey)) return null;
    this.activeTransactionIds.add(idempotencyKey);
    try {
      return await run();
    } finally {
      this.activeTransactionIds.delete(idempotencyKey);
    }
  }

  private async hasPendingDeleteIntent(shotId: string): Promise<boolean> {
    const idempotencyKey = shotDeleteReclaimIdempotencyKey(shotId);
    if (this.knownTransactions.has(idempotencyKey)) return true;
    const pending = await this.deps.pendingShotDeleteReclaims();
    for (const reservation of pending) {
      this.knownTransactions.set(reservation.idempotencyKey, reservation.transaction);
    }
    return this.knownTransactions.has(idempotencyKey);
  }
}

function sameTransaction(
  left: ShotDeleteReclaimTransaction,
  right: ShotDeleteReclaimTransaction
): boolean {
  return left.shotId === right.shotId &&
    left.beanId === right.beanId &&
    left.batchId === right.batchId &&
    left.dose === right.dose;
}

function sameReclaim(
  existing: ExistingDoseReclaim,
  transaction: ShotDeleteReclaimTransaction
): boolean {
  return existing.beanId === transaction.beanId &&
    existing.batchId === transaction.batchId &&
    existing.dose === transaction.dose;
}

function finiteNonNegative(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function failedResult(shotId: string, error: unknown): FailedShotResult {
  return { type: 'failed', shotId, error, status: 'Delete shot failed' };
}

function queuedResult(shotId: string): Extract<ShotDeletionFlowResult, { type: 'queued' }> {
  return { type: 'queued', shotId, status: 'Delete queued — will retry' };
}

function supersededResult(
  shotId: string
): Extract<ShotDeletionFlowResult, { type: 'superseded' }> {
  return {
    type: 'superseded',
    shotId,
    status: 'Delete result belongs to a previous runtime'
  };
}
