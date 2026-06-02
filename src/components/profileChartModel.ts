// Pure model for the profile "explanation" chart, mirroring de1app's curve
// semantics: a step with a `fast` transition jumps instantly to its target and
// holds it for the step's duration; a `smooth` step ramps linearly from the
// previous value to its target across its duration. (The crude prior version
// drew every step as a flat hold, so smooth ramps and the fast jumps were lost.)

export interface ChartStepInput {
  seconds: number;
  transition: 'fast' | 'smooth';
  pressure: number;
  flow: number;
  temperature: number;
}

export interface ChartPoint {
  t: number;
  v: number;
}

export interface ChartSpan {
  start: number;
  end: number;
}

export interface ProfileChartModel {
  totalSeconds: number;
  pressure: ChartPoint[];
  flow: ChartPoint[];
  temperature: ChartPoint[];
  spans: ChartSpan[];
}

/**
 * Build the polyline for one value series. Consecutive points are joined by
 * straight lines, so:
 * - `smooth` pushes only the step's end point → the line from the previous
 *   point ramps to it.
 * - `fast` pushes the target at the step start (a vertical jump from the
 *   previous value) and again at the step end (a flat hold).
 */
export function buildTrace(
  steps: ChartStepInput[],
  pick: (step: ChartStepInput) => number,
  start = 0
): ChartPoint[] {
  if (steps.length === 0) return [];
  const points: ChartPoint[] = [{ t: 0, v: start }];
  let elapsed = 0;
  for (const step of steps) {
    const duration = Math.max(0, step.seconds || 0);
    const target = pick(step);
    if (step.transition === 'smooth') {
      points.push({ t: elapsed + duration, v: target });
    } else {
      points.push({ t: elapsed, v: target });
      points.push({ t: elapsed + duration, v: target });
    }
    elapsed += duration;
  }
  return points;
}

export function buildProfileChartModel(steps: ChartStepInput[]): ProfileChartModel {
  const spans: ChartSpan[] = [];
  let elapsed = 0;
  for (const step of steps) {
    const duration = Math.max(0, step.seconds || 0);
    spans.push({ start: elapsed, end: elapsed + duration });
    elapsed += duration;
  }
  return {
    totalSeconds: Math.max(elapsed, 1),
    // Pressure and flow start from 0 (machine at rest); temperature starts at the
    // first step's target so the line doesn't dive to zero at t=0.
    pressure: buildTrace(steps, (step) => step.pressure),
    flow: buildTrace(steps, (step) => step.flow),
    temperature: buildTrace(steps, (step) => step.temperature, steps[0]?.temperature ?? 0),
    spans
  };
}
