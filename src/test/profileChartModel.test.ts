import { buildProfileChartModel, buildTrace, type ChartStepInput } from '../components/profileChartModel';

function step(partial: Partial<ChartStepInput>): ChartStepInput {
  return { seconds: 10, transition: 'fast', pressure: 0, flow: 0, temperature: 90, ...partial };
}

run('a fast step jumps to its target then holds it flat', () => {
  const points = buildTrace([step({ transition: 'fast', pressure: 9, seconds: 10 })], (s) => s.pressure);
  // start at 0, vertical jump to 9 at t=0, hold 9 until t=10
  equalPoints(points, [
    { t: 0, v: 0 },
    { t: 0, v: 9 },
    { t: 10, v: 9 }
  ]);
});

run('a smooth step ramps linearly from the previous value', () => {
  const points = buildTrace([step({ transition: 'smooth', pressure: 6, seconds: 10 })], (s) => s.pressure);
  // start at 0, single end point → the connecting line is the ramp 0 → 6
  equalPoints(points, [
    { t: 0, v: 0 },
    { t: 10, v: 6 }
  ]);
});

run('fast then smooth: hold, then ramp from the held value to the new target', () => {
  const points = buildTrace(
    [
      step({ transition: 'fast', pressure: 9, seconds: 5 }),
      step({ transition: 'smooth', pressure: 6, seconds: 10 })
    ],
    (s) => s.pressure
  );
  equalPoints(points, [
    { t: 0, v: 0 },
    { t: 0, v: 9 },
    { t: 5, v: 9 },
    { t: 15, v: 6 }
  ]);
});

run('model exposes per-step spans, total time, and all three traces', () => {
  const model = buildProfileChartModel([
    step({ transition: 'fast', pressure: 9, flow: 2, temperature: 92, seconds: 5 }),
    step({ transition: 'smooth', pressure: 6, flow: 1, temperature: 90, seconds: 25 })
  ]);
  equal(model.totalSeconds, 30);
  equal(model.spans.length, 2);
  equal(model.spans[0]!.start, 0);
  equal(model.spans[0]!.end, 5);
  equal(model.spans[1]!.end, 30);
  // pressure trace: jump+hold (3 pts) then a smooth end point → 4 points
  equal(model.pressure.length, 4);
  equal(model.flow.at(-1)!.v, 1);
  // temperature starts at the first step's target (92), not 0
  equal(model.temperature[0]!.v, 92);
});

run('empty steps produce empty traces and a non-zero total', () => {
  const model = buildProfileChartModel([]);
  equal(model.totalSeconds, 1);
  equal(model.pressure.length, 0);
  equal(model.spans.length, 0);
});

// --- harness ---

function run(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

function equal<T>(actual: T, expected: T): void {
  if (actual !== expected) throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
}

function equalPoints(actual: { t: number; v: number }[], expected: { t: number; v: number }[]): void {
  equal(actual.length, expected.length);
  actual.forEach((point, index) => {
    equal(point.t, expected[index]!.t);
    equal(point.v, expected[index]!.v);
  });
}
