import type { ShotRecord } from '../api/types';

export interface LiveShotCompletionContext {
  previousShotIds: Set<string>;
  startedAtMs: number | null;
  endedAtMs: number | null;
  optimisticShot: ShotRecord | null;
}

export interface LiveShotWindow {
  startMs: number | null;
  lastActiveMs: number | null;
}

export interface LiveShotEndInput {
  cleaningInProgress: boolean;
  noScaleBlockedAbort: boolean;
  beanId: string | null;
  demo: boolean;
  currentShots: ShotRecord[];
  shotWindow: LiveShotWindow;
  optimisticShot: ShotRecord | null;
  completionReason: string | null;
  nowMs: number;
}

export type LiveShotEndDecision =
  | {
      type: 'cleaning';
    }
  | {
      type: 'no-scale-abort';
    }
  | {
      type: 'remote-save';
      beanId: string;
      context: LiveShotCompletionContext;
      status: 'Saving shot…';
    }
  | {
      type: 'local-complete';
      beanId: string | null;
      optimisticShot: ShotRecord | null;
      status: string;
    };

export interface LiveShotRefreshDeps {
  delay(ms: number): Promise<void>;
  invalidateShotMutation(): Promise<void>;
  loadFirstShots(): Promise<{ records: ShotRecord[]; total: number }>;
  loadLatestShotCandidates(): Promise<ShotRecord[]>;
  stillRelevant(): boolean;
}

export type LiveShotRefreshResult =
  | {
      type: 'completed';
      shot: ShotRecord;
      records: ShotRecord[];
      total: number;
    }
  | {
      type: 'fallback';
      records: ShotRecord[];
      total: number;
    }
  | {
      type: 'aborted';
    };

const DEFAULT_REFRESH_DELAYS_MS = [0, 1000, 2000, 4000, 8000];

export function liveShotEndDecision(input: LiveShotEndInput): LiveShotEndDecision {
  if (input.cleaningInProgress) return { type: 'cleaning' };
  if (input.noScaleBlockedAbort) return { type: 'no-scale-abort' };

  if (input.beanId && !input.demo) {
    return {
      type: 'remote-save',
      beanId: input.beanId,
      context: {
        previousShotIds: new Set(input.currentShots.map((shot) => shot.id)),
        startedAtMs: input.shotWindow.startMs,
        endedAtMs: input.shotWindow.lastActiveMs ?? input.nowMs,
        optimisticShot: input.optimisticShot
      },
      status: 'Saving shot…'
    };
  }

  return {
    type: 'local-complete',
    beanId: input.beanId,
    optimisticShot: input.optimisticShot,
    status: input.completionReason ? `Shot complete (${input.completionReason})` : 'Shot complete'
  };
}

export async function waitForCompletedLiveShot(
  context: LiveShotCompletionContext,
  deps: LiveShotRefreshDeps,
  delaysMs: readonly number[] = DEFAULT_REFRESH_DELAYS_MS
): Promise<LiveShotRefreshResult> {
  let lastRecords: ShotRecord[] = [];
  let lastTotal = 0;

  for (let attempt = 0; attempt < delaysMs.length; attempt += 1) {
    const delayMs = delaysMs[attempt] ?? 0;
    if (delayMs > 0) await deps.delay(delayMs);
    if (!deps.stillRelevant()) return { type: 'aborted' };

    await deps.invalidateShotMutation();
    const [{ records, total }, latestRecords] = await Promise.all([
      deps.loadFirstShots(),
      deps.loadLatestShotCandidates()
    ]);
    lastRecords = records;
    lastTotal = total;

    const completedShot =
      completedLiveShot(records, context, false) ??
      completedLiveShot(latestRecords, context, attempt === delaysMs.length - 1);
    if (completedShot) {
      return { type: 'completed', shot: completedShot, records, total };
    }
  }

  if (!deps.stillRelevant()) return { type: 'aborted' };
  return { type: 'fallback', records: lastRecords, total: lastTotal };
}

export function completedLiveShot(
  records: ShotRecord[],
  context: { previousShotIds: Set<string>; startedAtMs: number | null; endedAtMs: number | null },
  allowFallback: boolean
): ShotRecord | null {
  const newShot = records.find(
    (shot) => !context.previousShotIds.has(shot.id) && shotMatchesLiveWindow(shot, context)
  );
  if (newShot) return newShot;

  const timeMatch = records.find((shot) => shotMatchesLiveWindow(shot, context));
  if (timeMatch) return timeMatch;

  if (!allowFallback) return null;
  const newest = records[0] ?? null;
  if (!newest || context.previousShotIds.has(newest.id)) return null;
  const timestamp = Date.parse(newest.timestamp);
  return context.startedAtMs == null || !Number.isFinite(timestamp) ? newest : null;
}

export function shotMatchesLiveWindow(
  shot: ShotRecord,
  context: { startedAtMs: number | null; endedAtMs: number | null }
): boolean {
  if (context.startedAtMs == null) return false;
  const timestamp = Date.parse(shot.timestamp);
  if (!Number.isFinite(timestamp)) return false;
  const start = context.startedAtMs - 10_000;
  const end = (context.endedAtMs ?? Date.now()) + 90_000;
  return timestamp >= start && timestamp <= end;
}

export function includeShotInHistory(records: ShotRecord[], shot: ShotRecord, limit: number): ShotRecord[] {
  const withoutDuplicate = records.filter((item) => item.id !== shot.id);
  return [shot, ...withoutDuplicate].slice(0, Math.max(1, limit));
}
