import type { Bean, BeanBatch, ShotRecord, ShotUpdate, Workflow } from '../api/types';
import { formatGrams } from '../domain/beanWorkflow';
import { doseReclaimRemaining } from '../domain/doseReclaim';
import { isServiceShot } from '../domain/shotRecord';

/** Immutable mutation authority; intentionally contains no shot or preview fields. */
export interface ShotDoseReclaimIntent {
  readonly beanId: string;
  readonly batchId: string;
  readonly dose: number;
}

/** Display-only before/after values captured when the confirmation dialog opens. */
export interface ShotDoseReclaimPreview {
  readonly dose: number;
  readonly remaining: number;
  readonly next: number;
}

export interface ShotDoseReclaimPlan {
  readonly intent: ShotDoseReclaimIntent;
  readonly preview: ShotDoseReclaimPreview;
}

export type ShotDoseReclaimDurability = 'indexeddb' | 'local-storage' | 'memory' | 'volatile';

export type ShotDoseReclaimSettlement =
  | { type: 'reclaimed'; resolvedRemaining: number }
  | {
      type: 'queued';
      expectedRemaining: number;
      durability: ShotDoseReclaimDurability;
    }
  | { type: 'not-applicable'; reason: string }
  | { type: 'failed'; reason: string; error?: unknown };

export interface DeleteShotInput {
  shotId: string;
  /** Immutable mutation intent only; confirmation previews never cross this boundary. */
  reclaim: ShotDoseReclaimIntent | null;
  demo: boolean;
}

export interface DeleteShotDeps {
  deleteShot(shotId: string): Promise<void>;
  isAlreadyDeleted?(error: unknown): boolean;
  /**
   * Synchronous projection fence after DELETE has settled, including a 404
   * retry, and before reclaim/cache work can yield again.
   */
  onRemoteDeleteSettled?(): void;
  invalidateShotMutation(shotId: string): Promise<void>;
  reclaimDose(
    intent: ShotDoseReclaimIntent,
    context: { readonly deleteAlreadyAbsent: boolean }
  ): Promise<ShotDoseReclaimSettlement>;
}

export type DeleteShotResult =
  | {
      type: 'deleted';
      shotId: string;
      remote: boolean;
      deleteAlreadyAbsent: boolean;
      reclaim: ShotDoseReclaimSettlement | null;
      cacheWarning?: unknown;
      reclaimWarning?: unknown;
      status: string;
    }
  | {
      type: 'failed';
      shotId: string;
      error: unknown;
      status: 'Delete shot failed';
    };

export function shotDoseReclaimPlan(
  shot: ShotRecord,
  beans: Bean[],
  batchesByBean: Record<string, BeanBatch[]>
): ShotDoseReclaimPlan | null {
  const dose = positiveFinite(shot.annotations?.actualDoseWeight);
  const batchId = shot.workflow?.context?.beanBatchId;
  if (dose == null || !batchId) return null;

  for (const bean of beans) {
    const batch = batchesByBean[bean.id]?.find((candidate) => candidate.id === batchId);
    if (!batch) continue;
    const remaining = nonNegativeFinite(batch.weightRemaining);
    if (remaining == null) return null;
    const next = doseReclaimRemaining(remaining, dose, batch.weight);
    return {
      intent: { beanId: bean.id, batchId: batch.id, dose },
      preview: { dose, remaining, next }
    };
  }

  return null;
}

/**
 * Owns deletion sequencing and its partial-success semantics. Once the remote
 * delete succeeds, cache or inventory maintenance cannot turn the result back
 * into a reported delete failure.
 */
export async function executeShotDeletion(
  input: DeleteShotInput,
  deps: DeleteShotDeps
): Promise<DeleteShotResult> {
  let deleteAlreadyAbsent = false;
  if (!input.demo) {
    try {
      await deps.deleteShot(input.shotId);
    } catch (error) {
      if (!deps.isAlreadyDeleted?.(error)) {
        return { type: 'failed', shotId: input.shotId, error, status: 'Delete shot failed' };
      }
      deleteAlreadyAbsent = true;
    }
    deps.onRemoteDeleteSettled?.();
  }

  let reclaim: ShotDoseReclaimSettlement | null = null;
  let reclaimWarning: unknown;
  if (input.reclaim) {
    try {
      reclaim = await deps.reclaimDose(input.reclaim, { deleteAlreadyAbsent });
    } catch (error) {
      reclaimWarning = error;
    }
  }

  // Secure the inverse inventory intent before optional cache maintenance so
  // cache latency cannot widen the post-DELETE durability gap.
  let cacheWarning: unknown;
  if (!input.demo) {
    try {
      await deps.invalidateShotMutation(input.shotId);
    } catch (error) {
      cacheWarning = error;
    }
  }

  const baseStatus = input.demo
    ? 'Shot deleted (demo)'
    : deleteAlreadyAbsent ? 'Shot already deleted' : 'Shot deleted';
  const status = shotDeletionStatus(baseStatus, reclaim, reclaimWarning);

  return {
    type: 'deleted',
    shotId: input.shotId,
    remote: !input.demo,
    deleteAlreadyAbsent,
    reclaim,
    ...(cacheWarning === undefined ? {} : { cacheWarning }),
    ...(reclaimWarning === undefined ? {} : { reclaimWarning }),
    status
  };
}

export function shotDeletionStatus(
  baseStatus: string,
  reclaim: ShotDoseReclaimSettlement | null,
  reclaimWarning: unknown
): string {
  if (!reclaim) return reclaimWarning ? `${baseStatus} · Bag reclaim failed` : baseStatus;
  switch (reclaim.type) {
    case 'reclaimed':
      return `${baseStatus} · Bag: ${formatGrams(reclaim.resolvedRemaining)} left`;
    case 'queued': {
      const storageWarning = isDurableReclaim(reclaim.durability)
        ? ''
        : ' · storage unavailable';
      return `${baseStatus} · Bag: ${formatGrams(reclaim.expectedRemaining)} left${storageWarning}`;
    }
    case 'not-applicable':
      return reclaim.reason === 'already-deleted' || reclaim.reason === 'already-settled'
        ? `${baseStatus} · Bag unchanged`
        : `${baseStatus} · Bag reclaim unavailable`;
    case 'failed':
      return `${baseStatus} · Bag reclaim failed`;
  }
}

function isDurableReclaim(durability: ShotDoseReclaimDurability): boolean {
  return durability === 'indexeddb' || durability === 'local-storage';
}

export interface ShotDeletionListSnapshot {
  readonly shots: ShotRecord[];
  readonly shotsTotal: number;
  readonly detailShotId: string | null;
  readonly compareShotId: string | null;
}

export interface ShotDeletionListProjection extends ShotDeletionListSnapshot {
  readonly removed: boolean;
  readonly removedCurrentDetail: boolean;
}

/** Targeted settlement against the latest shell snapshot, safe after refresh/navigation. */
export function projectDeletedShot(
  snapshot: ShotDeletionListSnapshot,
  shotId: string,
  options: { readonly decrementTotal?: boolean } = {}
): ShotDeletionListProjection {
  const removed = snapshot.shots.some((shot) => shot.id === shotId);
  const shots = removed
    ? snapshot.shots.filter((shot) => shot.id !== shotId)
    : snapshot.shots;
  const removedCurrentDetail = snapshot.detailShotId === shotId;
  const firstVisible = removedCurrentDetail
    ? shots.find((shot) => !isServiceShot(shot))?.id ?? null
    : snapshot.detailShotId;
  return {
    shots,
    shotsTotal: removed && options.decrementTotal !== false
      ? Math.max(0, snapshot.shotsTotal - 1)
      : snapshot.shotsTotal,
    detailShotId: firstVisible,
    compareShotId: snapshot.compareShotId === shotId ? null : snapshot.compareShotId,
    removed,
    removedCurrentDetail
  };
}

export interface SaveShotUpdateInput {
  shot: ShotRecord;
  update: ShotUpdate;
  demo: boolean;
  successStatus: string;
  demoStatus: string;
  failureStatus: string;
}

export interface SaveShotUpdateDeps {
  updateShot(shotId: string, update: ShotUpdate): Promise<ShotRecord>;
  invalidateShotMutation(shotId: string): Promise<void>;
  putShotRecord(shot: ShotRecord): Promise<void>;
}

export type SaveShotUpdateResult =
  | {
      type: 'saved';
      shot: ShotRecord;
      status: string;
      remote: boolean;
    }
  | {
      type: 'failed';
      status: string;
      error: unknown;
    };

export function shotEnjoymentUpdate(shot: ShotRecord, value: number | null): ShotUpdate {
  return {
    annotations: {
      ...(shot.annotations ?? {}),
      enjoyment: value
    }
  };
}

export async function saveShotUpdate(
  input: SaveShotUpdateInput,
  deps: SaveShotUpdateDeps
): Promise<SaveShotUpdateResult> {
  if (input.demo) {
    return {
      type: 'saved',
      shot: applyShotUpdate(input.shot, input.update),
      status: input.demoStatus,
      remote: false
    };
  }

  try {
    const saved = await deps.updateShot(input.shot.id, input.update);
    await deps.invalidateShotMutation(saved.id);
    await deps.putShotRecord(saved);
    return {
      type: 'saved',
      shot: saved,
      status: input.successStatus,
      remote: true
    };
  } catch (error) {
    return {
      type: 'failed',
      status: input.failureStatus,
      error
    };
  }
}

export function applyShotUpdate(shot: ShotRecord, update: ShotUpdate): ShotRecord {
  const workflow = update.workflow
    ? ({
        ...(shot.workflow ?? {}),
        ...update.workflow,
        context: Object.prototype.hasOwnProperty.call(update.workflow, 'context')
          ? update.workflow.context
          : shot.workflow?.context
      } as Workflow)
    : shot.workflow;
  return {
    ...shot,
    workflow,
    annotations: Object.prototype.hasOwnProperty.call(update, 'annotations')
      ? update.annotations
      : shot.annotations,
    shotNotes: Object.prototype.hasOwnProperty.call(update, 'shotNotes')
      ? update.shotNotes
      : shot.shotNotes,
    metadata: Object.prototype.hasOwnProperty.call(update, 'metadata')
      ? update.metadata
      : shot.metadata
  };
}

function positiveFinite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function nonNegativeFinite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}
