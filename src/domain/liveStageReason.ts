import type { EditorStep } from './profileModel';

// Telemetry captured at the instant a stage handed off (the ending stage's last
// readouts), used to report the measured value that tripped its advance.
export interface StageAdvanceTelemetry {
  pressure: number | null;
  flow: number | null;
  weight: number | null;
}

// The ACTUAL reason a stage advanced, inferred from telemetry at the transition
// (the DE1 doesn't report the trigger). A step advances when a target fires — a
// pressure/flow exit, or a weight/volume goal — or when its time cap elapses,
// whichever comes first. So if the stage ended well before its cap, name the
// target the step uses and its measured value; otherwise it ran out its time.
export function liveStageAdvanceReason(
  step: EditorStep | undefined,
  elapsed: number,
  at: StageAdvanceTelemetry
): string {
  const cap = step?.seconds ?? 0;
  const advancedEarly = cap <= 0 || elapsed < cap - 0.6;
  if (advancedEarly && step) {
    // A profile stores a placeholder exit (e.g. `flow under 0`, which can never
    // fire) for a step whose real move-on is weight/volume/time. Only treat the
    // exit as the trigger when it's a genuine condition (positive threshold).
    if (step.exit && step.exit.value > 0) {
      const measured = step.exit.type === 'flow' ? at.flow : at.pressure;
      const unit = step.exit.type === 'flow' ? 'ml/s' : 'bar';
      const sensor = step.exit.type === 'flow' ? 'flow' : 'pressure';
      return measured != null
        ? `${sensor} ${formatStageNumber(measured)} ${unit}`
        : `${sensor} exit`;
    }
    if (step.weight > 0) {
      return at.weight != null
        ? `weight ${formatStageNumber(at.weight)} g`
        : `weight ${formatStageNumber(step.weight)} g`;
    }
    if (step.volume > 0) return `volume ${formatStageNumber(step.volume)} ml`;
  }
  return `${formatStageNumber(elapsed)}s elapsed`;
}

export function formatStageNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
