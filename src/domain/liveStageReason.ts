import type { EditorStep } from './profileModel';
import type { StageAdvanceDecision, StopDecision } from './shotDecisions';
import { stopReasonLabel } from './shotDecisions';

// Telemetry captured at the instant a stage handed off (the ending stage's last
// readouts), used to report the measured value behind a firmware-side advance.
export interface StageAdvanceTelemetry {
  pressure: number | null;
  flow: number | null;
  weight: number | null;
}

// What caused a stage to end, as a visual category. The advance kinds mirror
// the chart's series colors (a pressure exit tints like the pressure curve),
// so the rail speaks the same color language as the graph; the stop kinds are
// semantic — `goal` for a target met, `warn` for an abnormal ending, `stop`
// for a plain manual/machine stop.
export type StageReasonKind =
  | 'weight'
  | 'pressure'
  | 'flow'
  | 'volume'
  | 'time'
  | 'goal'
  | 'stop'
  | 'warn';

export interface StageReason {
  text: string;
  kind: StageReasonKind;
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
): StageReason {
  if (decision?.reason === 'profileSkip') {
    const weight = decision.weight ?? at.weight ?? step?.weight ?? null;
    return {
      text:
        weight != null && weight > 0
          ? `weight ${formatStageNumber(weight)} g`
          : 'weight target',
      kind: 'weight'
    };
  }

  const cap = step?.seconds ?? 0;
  const advancedEarly = cap <= 0 || elapsed < cap - 0.6;
  if (advancedEarly && step) {
    // A profile stores a placeholder exit (e.g. `flow under 0`, which can never
    // fire) for a step whose real move-on lives elsewhere. Only treat the exit
    // as the trigger when it's a genuine condition (positive threshold).
    if (step.exit && step.exit.value > 0) {
      const isFlow = step.exit.type === 'flow';
      const measured = isFlow ? at.flow : at.pressure;
      const unit = isFlow ? 'ml/s' : 'bar';
      const sensor = isFlow ? 'flow' : 'pressure';
      return {
        text:
          measured != null
            ? `${sensor} ${formatStageNumber(measured)} ${unit}`
            : `${sensor} exit`,
        kind: isFlow ? 'flow' : 'pressure'
      };
    }
    // No decision on record at all — a historic shot (only the final stop
    // reason persists) or a transient live gap. An app weight skip is then a
    // real possibility, so the old placeholder-exit heuristic applies: a
    // weight-target step that advanced early most likely advanced on weight.
    // A KNOWN non-skip decision (profileAdvance) skips this — the firmware
    // advanced, so it cannot have been the app's weight exit.
    if (decision == null && step.weight > 0) {
      const weight = at.weight ?? step.weight;
      return { text: `weight ${formatStageNumber(weight)} g`, kind: 'weight' };
    }
    if (step.volume > 0) {
      return { text: `volume ${formatStageNumber(step.volume)} ml`, kind: 'volume' };
    }
  }
  return { text: `${formatStageNumber(elapsed)}s elapsed`, kind: 'time' };
}

// The reason chip for the FINAL stage: the shot's stop decision. Targets met
// read as a small win (`goal`); abnormal endings warn; everything else — a
// plain stop, whoever commanded it — stays neutral. Unknown reasons (open
// set) pass through as neutral stops.
export function stageStopReason(stop: StopDecision | null): StageReason | null {
  const text = stopReasonLabel(stop);
  if (!stop || text == null) return null;
  switch (stop.reason) {
    case 'targetWeight':
    case 'targetVolume':
      return { text, kind: 'goal' };
    case 'error':
    case 'disconnected':
    case 'noScale':
      return { text, kind: 'warn' };
    default:
      return { text, kind: 'stop' };
  }
}

export function formatStageNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
