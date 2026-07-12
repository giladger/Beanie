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

export interface LiveShotSelection {
  readonly bean: Bean | null;
  readonly batch: BeanBatch | null;
}

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
  consumeDose(input: LiveShotDoseConsumption): Promise<void>;
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
        if (bean && batch) this.startDoseConsumption(operation, request, bean, batch, decision.optimisticShot);
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
            status: decision.status
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
        if (batch) this.startDoseConsumption(operation, request, bean, batch, decision.context.optimisticShot);
        return this.reconcileRemote(operation, request, { bean, batch }, decision.context);
    }
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
    context: LiveShotCompletionContext
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
        const records = context.optimisticShot
          ? includeShotInHistory(result.records, context.optimisticShot, request.pageLimit)
          : result.records;
        return this.settle(operation, request, {
          type: 'remote-fallback',
          beanId: target.bean.id,
          batchId: target.batch?.id ?? null,
          optimisticShot: context.optimisticShot,
          history: {
            records,
            total: Math.max(result.total, records.length),
            detailShotId:
              context.optimisticShot?.id ?? result.records[0]?.id ?? request.currentDetailShotId,
            status: 'Shot list updated'
          }
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
  ): void {
    const dose: LiveShotDoseConsumption = {
      bean,
      batch,
      doseWeight: shot?.annotations?.actualDoseWeight,
      shotId: shot?.id ?? null,
      demo: request.demo
    };
    // Bean usage is a physical consequence of the shot and must not wait for
    // gateway shot persistence. Its failure is observable but never changes
    // the completion result or leaves the live screen finalizing.
    try {
      void Promise.resolve(this.deps.consumeDose(dose)).catch((error) => {
        if (!this.disposed && this.latestRunGeneration === operation.generation) {
          this.emit({ type: 'dose-failed', request, dose, error });
        }
      });
    } catch (error) {
      if (!this.disposed && this.latestRunGeneration === operation.generation) {
        this.emit({ type: 'dose-failed', request, dose, error });
      }
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
