import type {
  Bean,
  BeanBatch,
  ShotRecord,
  ShotUpdate
} from '../api/types';
import { shotMetadataWithFreshness } from '../domain/liveShotRecord';
import { rebaseChangedFields } from '../domain/rebaseMutation';
import type { PendingDerekTweak } from '../domain/storage';
import { OperationAuthority, type OperationLease } from '../runtime/operationAuthority';
import {
  includeShotInHistory,
  liveShotEndDecision,
  waitForCompletedLiveShot,
  type LiveShotCompletionContext,
  type LiveShotEndDecision,
  type LiveShotWindow
} from './liveShotController';
import {
  shotCoffeeLabel,
  shotSelectionCompatibility,
  type LiveShotSelection
} from './liveShotAttribution';

export type { LiveShotSelection } from './liveShotAttribution';

export interface LiveShotCompletionRequest {
  readonly cleaningInProgress: boolean;
  readonly noScaleBlockedAbort: boolean;
  readonly selection: LiveShotSelection;
  readonly demo: boolean;
  readonly currentShots: readonly ShotRecord[];
  readonly currentShotsTotal: number;
  readonly currentDetailShotId: string | null;
  readonly shotWindow: LiveShotWindow;
  readonly optimisticShot: ShotRecord | null;
  readonly completionReason: string | null;
  readonly nowMs: number;
  readonly pageLimit: number;
}

export interface LiveShotPollingTarget {
  readonly bean: Bean;
  readonly batch: BeanBatch | null;
}

export interface LiveShotDoseConsumption {
  readonly bean: Bean;
  readonly batch: BeanBatch;
  readonly doseWeight: number | null | undefined;
  readonly shotId: string | null;
  readonly demo: boolean;
}

export type LiveShotAuxiliaryOperation =
  | 'clear-pending-tweak'
  | 'invalidate-shot-cache'
  | 'cache-shot'
  | 'notify-subscriber';

export interface LiveShotCompletionDependencies {
  delay(ms: number): Promise<void>;
  invalidateShotPages(): Promise<void>;
  loadFirstShots(target: LiveShotPollingTarget): Promise<{ records: ShotRecord[]; total: number }>;
  loadLatestShotCandidates(): Promise<ShotRecord[]>;
  isRelevant(target: LiveShotPollingTarget): boolean;
  resolveShotSelection(shot: ShotRecord): LiveShotSelection | null;
  /** Resolves true after the reconciler accepts the dose command or finds it acknowledged. */
  consumeDose(input: LiveShotDoseConsumption): Promise<boolean>;
  readPendingTweak(): PendingDerekTweak | null;
  clearPendingTweak(): void;
  serializeShotMutation<Value>(
    shotId: string,
    run: () => Value | PromiseLike<Value>
  ): Promise<Value>;
  loadShot(shotId: string): Promise<ShotRecord>;
  updateShot(shotId: string, update: ShotUpdate): Promise<ShotRecord>;
  invalidateShotMutation(shotId: string): Promise<void>;
  putShotRecord(shot: ShotRecord): Promise<void>;
  onAuxiliaryFailure?(operation: LiveShotAuxiliaryOperation, error: unknown): void;
}

export interface LiveShotHistoryProjection {
  readonly records: ShotRecord[];
  readonly total: number;
  readonly detailShotId: string | null;
  readonly status: string;
}

export type CompletedShotContextPersistence = 'unchanged' | 'saved' | 'local-fallback';

export type LiveShotCompletionOutcome =
  | { type: 'cleaning' }
  | { type: 'no-scale-abort' }
  | {
      type: 'local-complete';
      beanId: string | null;
      optimisticShot: ShotRecord | null;
      history: LiveShotHistoryProjection;
    }
  | {
      type: 'remote-complete';
      beanId: string;
      batchId: string | null;
      shot: ShotRecord;
      history: LiveShotHistoryProjection;
      contextPersistence: CompletedShotContextPersistence;
      contextError?: unknown;
    }
  | {
      type: 'remote-mismatch';
      expectedBeanId: string;
      expectedBatchId: string | null;
      actualBeanId: string | null;
      actualBatchId: string | null;
      inventoryReviewBeanIds: readonly string[];
      shot: ShotRecord;
      history: LiveShotHistoryProjection;
      contextPersistence: CompletedShotContextPersistence;
      contextError?: unknown;
    }
  | {
      type: 'remote-fallback';
      beanId: string;
      batchId: string | null;
      optimisticShot: ShotRecord | null;
      history: LiveShotHistoryProjection;
    }
  | {
      type: 'aborted';
      reason: 'irrelevant' | 'superseded' | 'disposed';
      closeFinalizing: boolean;
    }
  | {
      type: 'failed';
      error: unknown;
      status: 'Shot list update failed';
      closeFinalizing: true;
    }
  | { type: 'disposed' };

export type LiveShotCompletionEvent =
  | {
      type: 'routed';
      request: LiveShotCompletionRequest;
      decision: LiveShotEndDecision;
    }
  | {
      type: 'settled';
      request: LiveShotCompletionRequest;
      outcome: LiveShotCompletionOutcome;
    }
  | {
      type: 'dose-failed';
      request: LiveShotCompletionRequest;
      dose: LiveShotDoseConsumption;
      error: unknown;
    }
  | { type: 'disposed' };

export interface LiveShotCompletionSubscription {
  dispose(): void;
}

interface CompletedShotContextResult {
  readonly shot: ShotRecord;
  readonly persistence: CompletedShotContextPersistence;
  readonly error?: unknown;
}

interface DoseAdmission {
  state: 'pending' | 'admitted' | 'failed';
  settled: Promise<boolean>;
}

/**
 * Owns shot-end routing and the low-frequency completion/reconciliation flow.
 *
 * Live telemetry and canvas projection deliberately stay outside this class.
 * A host subscribes once to immediate `routed` events and terminal `settled`
 * events, then projects those explicit decisions into its feature state.
 */
export class LiveShotCompletionFlow {
  private readonly authority = new OperationAuthority();
  private readonly listeners = new Set<(event: LiveShotCompletionEvent) => void>();
  private latestRunGeneration: number | null = null;
  private disposed = false;

  constructor(private readonly deps: LiveShotCompletionDependencies) {}

  subscribe(listener: (event: LiveShotCompletionEvent) => void): LiveShotCompletionSubscription {
    if (!this.disposed) this.listeners.add(listener);
    let active = true;
    return {
      dispose: () => {
        if (!active) return;
        active = false;
        this.listeners.delete(listener);
      }
    };
  }

  /**
   * Route a shot end immediately and, for remote shots, reconcile the persisted
   * record asynchronously. Calling this again supersedes publication from the
   * previous run; already-started physical writes are allowed to finish.
   */
  async complete(request: LiveShotCompletionRequest): Promise<LiveShotCompletionOutcome> {
    if (this.disposed) return { type: 'disposed' };
    validateRequest(request);
    const operation = this.authority.begin(subjectFor(request));
    this.latestRunGeneration = operation.generation;
    const bean = request.selection.bean;
    const batch = batchForBean(bean, request.selection.batch);
    const decision = liveShotEndDecision({
      cleaningInProgress: request.cleaningInProgress,
      noScaleBlockedAbort: request.noScaleBlockedAbort,
      beanId: bean?.id ?? null,
      beanBatchId: batch?.id ?? null,
      demo: request.demo,
      currentShots: [...request.currentShots],
      shotWindow: request.shotWindow,
      optimisticShot: request.optimisticShot,
      completionReason: request.completionReason,
      nowMs: request.nowMs
    });

    this.publish(operation, { type: 'routed', request, decision });

    switch (decision.type) {
      case 'cleaning':
        return this.settleImmediate(operation, request, { type: 'cleaning' });
      case 'no-scale-abort':
        return this.settleImmediate(operation, request, { type: 'no-scale-abort' });
      case 'local-complete': {
        if (bean && batch) void this.startDoseConsumption(operation, request, bean, batch, decision.optimisticShot);
        const records = decision.optimisticShot
          ? includeShotInHistory([...request.currentShots], decision.optimisticShot, request.pageLimit)
          : [...request.currentShots];
        return this.settleImmediate(operation, request, {
          type: 'local-complete',
          beanId: decision.beanId,
          optimisticShot: decision.optimisticShot,
          history: {
            records,
            total: decision.optimisticShot
              ? Math.max(request.currentShotsTotal, request.currentShots.length + 1)
              : request.currentShotsTotal,
            detailShotId: decision.optimisticShot?.id ?? request.currentDetailShotId,
            status: request.selection.source === 'explicit-unresolved' && !request.demo
              ? 'Shot complete — machine coffee identity unavailable; bag unchanged'
              : decision.status
          }
        });
      }
      case 'remote-save':
        if (!bean) {
          return this.settleImmediate(operation, request, {
            type: 'aborted',
            reason: 'irrelevant',
            closeFinalizing: true
          });
        }
        const doseAdmission =
          batch && isConfirmedAttribution(request.selection)
            ? this.startDoseConsumption(
                operation,
                request,
                bean,
                batch,
                decision.context.optimisticShot
              )
            : null;
        return this.reconcileRemote(
          operation,
          request,
          { bean, batch },
          decision.context,
          doseAdmission
        );
    }
  }

  /**
   * Revoke publication from the current completion without disposing the
   * reusable flow. Physical work already admitted may finish, but it can no
   * longer project results into a different runtime provenance/session.
   */
  cancelCurrent(reason: unknown = new Error('Live shot completion canceled')): void {
    if (this.disposed) return;
    this.latestRunGeneration = null;
    this.authority.invalidate(reason);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.latestRunGeneration = null;
    this.authority.dispose();
    this.emit({ type: 'disposed' });
    this.listeners.clear();
  }

  private async reconcileRemote(
    operation: OperationLease,
    request: LiveShotCompletionRequest,
    target: LiveShotPollingTarget,
    context: LiveShotCompletionContext,
    doseAdmission: DoseAdmission | null
  ): Promise<LiveShotCompletionOutcome> {
    try {
      const result = await waitForCompletedLiveShot(context, {
        delay: this.deps.delay,
        invalidateShotMutation: () => this.deps.invalidateShotPages(),
        loadFirstShots: () => this.deps.loadFirstShots(target),
        loadLatestShotCandidates: () => this.deps.loadLatestShotCandidates(),
        stillRelevant: () => operation.isCurrent && this.deps.isRelevant(target)
      });

      if (!operation.isCurrent) return this.staleOutcome();
      if (result.type === 'aborted') {
        return this.settle(operation, request, {
          type: 'aborted',
          reason: 'irrelevant',
          closeFinalizing: true
        });
      }
      if (result.type === 'fallback') {
        return this.settle(operation, request, {
          type: 'remote-fallback',
          beanId: target.bean.id,
          batchId: target.batch?.id ?? null,
          optimisticShot: context.optimisticShot,
          history: {
            records: result.records,
            total: result.total,
            detailShotId: result.records[0]?.id ?? request.currentDetailShotId,
            status: doseAdmission?.state === 'admitted'
              ? 'Shot record delayed — bag updated from the confirmed machine workflow'
              : doseAdmission?.state === 'pending'
                ? 'Shot record delayed — bag update is still being journaled'
                : 'Shot record delayed — bag unchanged until its coffee is confirmed'
          }
        });
      }

      if (result.type === 'mismatch') {
        return await this.reconcileMismatchedRemote(
          operation,
          request,
          target,
          result.shot,
          result.records,
          result.total,
          doseAdmission?.state !== 'failed' && doseAdmission != null
        );
      }

      if (
        (!doseAdmission || doseAdmission.state === 'failed') &&
        target.batch &&
        shotSelectionCompatibility(result.shot, {
          beanId: target.bean.id,
          batchId: target.batch.id
        }) === 'batch-match'
      ) {
        void this.startDoseConsumption(
          operation,
          request,
          target.bean,
          target.batch,
          result.shot
        );
      } else if (doseAdmission?.state === 'pending' && target.batch) {
        // Never wedge shot projection on blocked storage. If acceptance later
        // proves it did not queue anything, retry with the persisted shot
        // identity while this completion still owns the live runtime.
        void doseAdmission.settled.then((admitted) => {
          if (
            admitted ||
            this.disposed ||
            this.latestRunGeneration !== operation.generation ||
            !this.deps.isRelevant(target)
          ) return;
          void this.startDoseConsumption(
            operation,
            request,
            target.bean,
            target.batch!,
            result.shot
          );
        });
      }
      const contextualized = await this.saveCompletedShotContext(result.shot, target.batch);
      if (!operation.isCurrent) return this.staleOutcome();
      if (!this.deps.isRelevant(target)) {
        return this.settle(operation, request, {
          type: 'aborted',
          reason: 'irrelevant',
          closeFinalizing: true
        });
      }
      const records = result.records.map((shot) =>
        shot.id === contextualized.shot.id ? contextualized.shot : shot
      );
      const visibleRecords = includeShotInHistory(
        records,
        contextualized.shot,
        request.pageLimit
      );
      return this.settle(operation, request, {
        type: 'remote-complete',
        beanId: target.bean.id,
        batchId: target.batch?.id ?? null,
        shot: contextualized.shot,
        history: {
          records: visibleRecords,
          total: Math.max(result.total, visibleRecords.length),
          detailShotId: contextualized.shot.id,
          status: 'Shot saved'
        },
        contextPersistence: contextualized.persistence,
        ...(contextualized.error === undefined ? {} : { contextError: contextualized.error })
      });
    } catch (error) {
      if (!operation.isCurrent) return this.staleOutcome();
      return this.settle(operation, request, {
        type: 'failed',
        error,
        status: 'Shot list update failed',
        closeFinalizing: true
      });
    } finally {
      operation.finish();
    }
  }

  private async reconcileMismatchedRemote(
    operation: OperationLease,
    request: LiveShotCompletionRequest,
    expected: LiveShotPollingTarget,
    shot: ShotRecord,
    records: ShotRecord[],
    total: number,
    expectedDoseAlreadyAdmitted: boolean
  ): Promise<LiveShotCompletionOutcome> {
    const actual = this.deps.resolveShotSelection(shot);
    const actualBean = actual?.bean ?? null;
    const actualBatch = actual?.batch ?? null;
    if (!this.deps.isRelevant(expected)) {
      return this.settle(operation, request, {
        type: 'aborted',
        reason: 'irrelevant',
        closeFinalizing: true
      });
    }

    const inventoryReviewBeanIds = expectedDoseAlreadyAdmitted
      ? [expected.bean.id]
      : [];
    const label = shotCoffeeLabel(shot) ??
      (actualBean ? `${actualBean.roaster} ${actualBean.name}`.trim() : 'another coffee');
    return this.settle(operation, request, {
      type: 'remote-mismatch',
      expectedBeanId: expected.bean.id,
      expectedBatchId: expected.batch?.id ?? null,
      actualBeanId: actualBean?.id ?? null,
      actualBatchId: actualBatch?.id ?? null,
      inventoryReviewBeanIds,
      shot,
      history: {
        records,
        total,
        detailShotId: request.currentDetailShotId,
        status: expectedDoseAlreadyAdmitted
          ? `Conflicting ${label} shot detected — expected-bag inventory needs review`
          : `Conflicting ${label} shot detected — no history or inventory was changed`
      },
      contextPersistence: 'unchanged'
    });
  }

  private async saveCompletedShotContext(
    shot: ShotRecord,
    batch: BeanBatch | null
  ): Promise<CompletedShotContextResult> {
    const metadata = shotMetadataWithFreshness(shot.metadata, null, batch, shot.timestamp);
    const pendingTweak = this.deps.readPendingTweak();
    const beanId = batch?.beanId ?? shot.workflow?.context?.beanId ?? null;
    const annotations =
      pendingTweak && beanId && pendingTweak.beanId === beanId
        ? {
            ...shot.annotations,
            extras: { ...shot.annotations?.extras, derekTweak: pendingTweak.summary }
          }
        : null;
    const update: ShotUpdate = {};
    if (metadata?.freshness) update.metadata = metadata;
    if (annotations) update.annotations = annotations;
    if (!update.metadata && !update.annotations) {
      return { shot, persistence: 'unchanged' };
    }

    try {
      const saved = await this.deps.serializeShotMutation(shot.id, async () => {
        const latest = update.annotations ? await this.deps.loadShot(shot.id) : null;
        return this.deps.updateShot(shot.id, {
          ...update,
          ...(update.annotations && latest
            ? {
                annotations: rebaseChangedFields(
                  shot.annotations,
                  update.annotations,
                  latest.annotations
                )
              }
            : {})
        });
      });
      if (annotations) {
        try {
          this.deps.clearPendingTweak();
        } catch (error) {
          this.reportAuxiliary('clear-pending-tweak', error);
        }
      }
      await this.bestEffort(
        'invalidate-shot-cache',
        () => this.deps.invalidateShotMutation(saved.id)
      );
      await this.bestEffort('cache-shot', () => this.deps.putShotRecord(saved));
      return { shot: saved, persistence: 'saved' };
    } catch (error) {
      // Freshness is still trustworthy local data. Preserve the prior behavior
      // of publishing that stamp even when its best-effort remote write fails;
      // a Derek annotation is not claimed locally unless it was persisted.
      return {
        shot: { ...shot, ...(update.metadata ? { metadata: update.metadata } : {}) },
        persistence: 'local-fallback',
        error
      };
    }
  }

  private startDoseConsumption(
    operation: OperationLease,
    request: LiveShotCompletionRequest,
    bean: Bean,
    batch: BeanBatch,
    shot: ShotRecord | null
  ): DoseAdmission | null {
    const doseWeight = shot?.annotations?.actualDoseWeight;
    if (
      !shot?.id ||
      typeof doseWeight !== 'number' ||
      !Number.isFinite(doseWeight) ||
      doseWeight <= 0
    ) return null;
    const dose: LiveShotDoseConsumption = {
      bean,
      batch,
      doseWeight,
      shotId: shot.id,
      demo: request.demo
    };
    // Once attribution admits the physical consequence, wait only for the
    // reconciler to accept it into its persistent journal or bounded volatile
    // intake; the worker itself remains independent. Failure resolves false so
    // a later persisted identity can retry while this completion still owns the
    // runtime.
    try {
      const admission = { state: 'pending' } as DoseAdmission;
      admission.settled = Promise.resolve(this.deps.consumeDose(dose))
        .then((admitted) => {
          admission.state = admitted ? 'admitted' : 'failed';
          return admitted;
        })
        .catch((error) => {
          admission.state = 'failed';
          if (!this.disposed && this.latestRunGeneration === operation.generation) {
            this.emit({ type: 'dose-failed', request, dose, error });
          }
          return false;
        });
      return admission;
    } catch (error) {
      if (!this.disposed && this.latestRunGeneration === operation.generation) {
        this.emit({ type: 'dose-failed', request, dose, error });
      }
      return { state: 'failed', settled: Promise.resolve(false) };
    }
  }

  private settleImmediate(
    operation: OperationLease,
    request: LiveShotCompletionRequest,
    outcome: LiveShotCompletionOutcome
  ): LiveShotCompletionOutcome {
    const settled = this.settle(operation, request, outcome);
    operation.finish();
    return settled;
  }

  private settle(
    operation: OperationLease,
    request: LiveShotCompletionRequest,
    outcome: LiveShotCompletionOutcome
  ): LiveShotCompletionOutcome {
    const committed = operation.commit(() => {
      this.emit({ type: 'settled', request, outcome });
      return outcome;
    });
    return committed.status === 'committed' ? committed.value : this.staleOutcome();
  }

  private publish(operation: OperationLease, event: LiveShotCompletionEvent): void {
    operation.commit(() => this.emit(event));
  }

  private staleOutcome(): LiveShotCompletionOutcome {
    return {
      type: 'aborted',
      reason: this.disposed ? 'disposed' : 'superseded',
      closeFinalizing: false
    };
  }

  private async bestEffort(
    operation: LiveShotAuxiliaryOperation,
    run: () => Promise<void>
  ): Promise<void> {
    try {
      await run();
    } catch (error) {
      this.reportAuxiliary(operation, error);
    }
  }

  private emit(event: LiveShotCompletionEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch (error) {
        this.reportAuxiliary('notify-subscriber', error);
      }
    }
  }

  private reportAuxiliary(operation: LiveShotAuxiliaryOperation, error: unknown): void {
    try {
      this.deps.onAuxiliaryFailure?.(operation, error);
    } catch {
      // Diagnostics must never become workflow authority or change the result.
    }
  }
}

function batchForBean(bean: Bean | null, batch: BeanBatch | null): BeanBatch | null {
  return bean && batch?.beanId === bean.id ? batch : null;
}

function isConfirmedAttribution(selection: LiveShotSelection): boolean {
  return selection.source === 'confirmed-batch' || selection.source === 'confirmed-bean';
}

function subjectFor(request: LiveShotCompletionRequest): string {
  return [
    'shot-completion',
    request.selection.bean?.id ?? 'none',
    request.selection.batch?.id ?? 'none',
    request.shotWindow.startMs ?? request.nowMs
  ].join(':');
}

function validateRequest(request: LiveShotCompletionRequest): void {
  if (!Number.isInteger(request.pageLimit) || request.pageLimit < 1) {
    throw new RangeError('Live shot completion page limit must be a positive integer');
  }
  if (!Number.isFinite(request.nowMs)) {
    throw new RangeError('Live shot completion time must be finite');
  }
}
