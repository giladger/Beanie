import type { EditorStep } from './profileModel';
import type { StageAdvanceDecision } from './shotDecisions';

// Telemetry captured at the instant a stage handed off (the ending stage's last
// readouts), used to report the measured value behind a firmware-side advance.
export interface StageAdvanceTelemetry {
  pressure: number | null;
  flow: number | null;
  weight: number | null;
}

// The reason a stage advanced, for the live rail.
//
// The gateway's shotState decision is authoritative for WHAT advanced the
// stage: `profileSkip` is an app-issued weight exit (the sequencer projected
// the step's weight target and skipped the frame), `profileAdvance` is the
// firmware moving on by itself. The firmware never reports why IT advanced,
// so for `profileAdvance` we describe the step's own trigger: a genuine
// programmed exit (pressure/flow) shows its measured value at the handoff, a
// volume goal shows the goal, and otherwise the frame ran out its time cap.
// A missing decision (only a transient socket-ordering gap mid-frame) falls
// back to the same firmware-advance description.
export function liveStageAdvanceReason(
  decision: StageAdvanceDecision | null,
  step: EditorStep | undefined,
  elapsed: number,
  at: StageAdvanceTelemetry
): string {
  if (decision?.reason === 'profileSkip') {
    const weight = decision.weight ?? at.weight ?? step?.weight ?? null;
    return weight != null && weight > 0
      ? `weight ${formatStageNumber(weight)} g`
      : 'weight target';
  }

  const cap = step?.seconds ?? 0;
  const advancedEarly = cap <= 0 || elapsed < cap - 0.6;
  if (advancedEarly && step) {
    // A profile stores a placeholder exit (e.g. `flow under 0`, which can never
    // fire) for a step whose real move-on lives elsewhere. Only treat the exit
    // as the trigger when it's a genuine condition (positive threshold).
    if (step.exit && step.exit.value > 0) {
      const measured = step.exit.type === 'flow' ? at.flow : at.pressure;
      const unit = step.exit.type === 'flow' ? 'ml/s' : 'bar';
      const sensor = step.exit.type === 'flow' ? 'flow' : 'pressure';
      return measured != null
        ? `${sensor} ${formatStageNumber(measured)} ${unit}`
        : `${sensor} exit`;
    }
    if (step.volume > 0) return `volume ${formatStageNumber(step.volume)} ml`;
  }
  return `${formatStageNumber(elapsed)}s elapsed`;
}

export function formatStageNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
