import type { ShotStateEvent } from '../api/types';

// Pure accumulator over the gateway's /ws/v1/machine/shotState feed. The
// gateway's shot sequencer is the authority on WHY things happened — which
// stage advances were app-issued weight skips vs firmware-natural exits, and
// what actually stopped the pour — so this log replaces client-side guessing
// from raw telemetry. It is keyed by the gateway-minted shotId (one per shot,
// equal to the persisted ShotRecord id) and resets itself when a new shot's
// id appears; between-shots idle frames (null shotId) leave it untouched so
// the ended-shot panel can still read the stop reason after the feed idles.

export interface StageAdvanceDecision {
  /** `profileSkip` (app weight skip) / `profileAdvance` (firmware exit) / future values. */
  reason: string;
  /** Projected weight that tripped an app-issued skip; null for firmware advances. */
  weight: number | null;
}

export interface StopDecision {
  kind: 'stop' | 'abort' | 'terminal';
  /** Open set: targetWeight, targetVolume, apiStop, appStop, machineEnded, error, ... */
  reason: string;
}

export interface ShotDecisionLog {
  shotId: string | null;
  /** Advance decisions keyed by the vacated (ended) profile frame index. */
  advances: ReadonlyMap<number, StageAdvanceDecision>;
  /** The decision that ended the pour; the first stop/abort/terminal wins. */
  stop: StopDecision | null;
}

export function emptyDecisionLog(): ShotDecisionLog {
  return { shotId: null, advances: new Map(), stop: null };
}

// Pure reducer: folds one shotState event into the log. Never mutates input.
export function nextDecisionLog(log: ShotDecisionLog, event: ShotStateEvent): ShotDecisionLog {
  // A new shot's id starts a fresh log — decisions never leak across shots.
  const base = event.shotId != null && event.shotId !== log.shotId ? emptyDecisionLog() : log;
  const withId =
    event.shotId != null && event.shotId !== base.shotId ? { ...base, shotId: event.shotId } : base;

  const decision = event.decision;
  if (!decision) return withId;

  if (decision.kind === 'advance') {
    const frame = advanceFrame(decision.data);
    if (frame == null) return withId;
    const advances = new Map(withId.advances);
    advances.set(frame, {
      reason: decision.reason,
      weight: numericField(decision.data, 'projectedWeight')
    });
    return { ...withId, advances };
  }

  if (decision.kind === 'stop' || decision.kind === 'abort' || decision.kind === 'terminal') {
    // The first pour-ending decision is why the shot stopped; a later terminal
    // or bookkeeping frame must not overwrite it.
    if (withId.stop) return withId;
    return { ...withId, stop: { kind: decision.kind, reason: decision.reason } };
  }

  // `finalize` (e.g. the stopping backstop) closes the post-stop settling
  // window — it is not why the shot stopped, so it never touches the log.
  return withId;
}

// The vacated frame an advance decision describes: app skips carry it as
// `frame`, firmware advances as `fromFrame`.
function advanceFrame(data: Record<string, unknown> | null): number | null {
  return numericField(data, 'frame') ?? numericField(data, 'fromFrame');
}

function numericField(data: Record<string, unknown> | null, key: string): number | null {
  const value = data?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// Short human label for the shot-complete status line. Known reasons get a
// friendly phrasing; unknown ones (open set) pass through verbatim rather
// than being dropped.
export function stopReasonLabel(stop: StopDecision | null): string | null {
  if (!stop) return null;
  switch (stop.reason) {
    case 'targetWeight':
      return 'target weight';
    case 'targetVolume':
      return 'target volume';
    case 'apiStop':
      return 'stopped via API';
    case 'appStop':
      return 'stopped from app';
    case 'machineEnded':
      return 'machine stop';
    case 'noScale':
      return 'no scale connected';
    case 'error':
      return 'machine error';
    case 'disconnected':
      return 'machine disconnected';
    default:
      return stop.reason;
  }
}
