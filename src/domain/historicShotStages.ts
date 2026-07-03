import type { ShotMeasurement, ShotRecord } from '../api/types';
import type { EditorStep } from './profileModel';
import {
  liveStageAdvanceReason,
  stageStopReason,
  type StageReason
} from './liveStageReason';

// Rebuilds the live rail's stage view for a SAVED shot from its measurement
// trace. The gateway persists only the final stop reason (advance decisions
// live on the shotState WebSocket and are not stored), so per-stage advance
// reasons come from the same telemetry inference the live rail uses when no
// decision is on record: the handoff sample's pressure/flow for a genuine
// programmed exit, the scale weight for a weight-target step, volume, or the
// time cap. The last stage the pour reached carries the persisted stopReason
// as its chip.

export interface HistoricStageView {
  name: string;
  reason: StageReason | null;
}

export interface HistoricStagesView {
  steps: HistoricStageView[];
  /** The stage the pour ended in; null when the trace carries no frame data. */
  currentIndex: number | null;
}

interface Telemetry {
  pressure: number | null;
  flow: number | null;
  weight: number | null;
}

export function historicShotStages(
  shot: Pick<ShotRecord, 'measurements' | 'stopReason'>,
  steps: EditorStep[]
): HistoricStagesView | null {
  if (steps.length === 0) return null;

  const reasons: (StageReason | null)[] = new Array(steps.length).fill(null);
  let firstMs: number | null = null;
  let currentFrame: number | null = null;
  let frameStartT = 0;
  let reached: number | null = null;
  let previous: Telemetry = { pressure: null, flow: null, weight: null };

  for (const measurement of shot.measurements) {
    const ms = Date.parse(measurement.machine?.timestamp ?? '');
    if (!Number.isFinite(ms)) continue;
    if (firstMs == null) firstMs = ms;
    const t = Math.max(0, (ms - firstMs) / 1000);

    const frame = measurementFrame(measurement, steps.length);
    if (frame != null && frame !== currentFrame) {
      // A forward move vacates the previous frame — infer its advance reason
      // from the ENDING stage's last readouts (this sample's values belong to
      // the new stage, so fold them in only after). Regressions (BLE frame
      // reordering in the trace) are ignored, mirroring the live rail.
      if (
        currentFrame != null &&
        frame > currentFrame &&
        reasons[currentFrame] == null
      ) {
        reasons[currentFrame] = liveStageAdvanceReason(
          null,
          steps[currentFrame],
          Math.max(0, t - frameStartT),
          previous
        );
      }
      if (currentFrame == null || frame > currentFrame) {
        currentFrame = frame;
        frameStartT = t;
        reached = reached == null ? frame : Math.max(reached, frame);
      }
    }

    previous = {
      pressure: numeric(measurement.machine?.pressure) ?? previous.pressure,
      flow: numeric(measurement.machine?.flow) ?? previous.flow,
      weight: numeric(measurement.scale?.weight) ?? previous.weight
    };
  }

  // The stage the pour ended in has no successor frame; its chip is the
  // shot's persisted stop reason (null for legacy shots — no chip).
  if (reached != null && reasons[reached] == null) {
    reasons[reached] = stageStopReason(
      shot.stopReason ? { kind: 'stop', reason: shot.stopReason } : null
    );
  }

  return {
    steps: steps.map((step, index) => ({
      name: step.name,
      reason: reasons[index] ?? null
    })),
    currentIndex: reached
  };
}

function measurementFrame(measurement: ShotMeasurement, stepCount: number): number | null {
  // Persisted measurements carry profileFrame past the narrow ShotMeasurement
  // type (the reader validates shape but passes the raw object through).
  const raw = (measurement.machine as Record<string, unknown> | undefined)?.profileFrame;
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw < stepCount
    ? raw
    : null;
}

function numeric(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
