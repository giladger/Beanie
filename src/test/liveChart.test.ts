import {
  clamp01,
  computePlotArea,
  formatTick,
  niceStep,
  projectX,
  projectY,
  tickValues,
  type PlotArea
} from '../components/LiveChart';

run('computePlotArea respects detailed margins', () => {
  const plot = computePlotArea(920, 340, true);
  equal(plot.x, 42);
  equal(plot.y, 42);
  equal(plot.width, 920 - 42 - 22);
  equal(plot.height, 340 - 42 - 38);
});

run('computePlotArea uses compact margins when not detailed', () => {
  const plot = computePlotArea(360, 120, false);
  equal(plot.x, 7);
  equal(plot.y, 7);
  equal(plot.width, 360 - 14);
  equal(plot.height, 120 - 14);
});

run('projectX maps time start to left edge and maxTime to right edge', () => {
  const plot: PlotArea = { x: 42, y: 42, width: 600, height: 260 };
  equal(projectX(0, 30, plot), plot.x);
  equal(projectX(30, 30, plot), plot.x + plot.width);
  equal(projectX(15, 30, plot), plot.x + plot.width / 2);
});

run('projectY maps zero to bottom and maxY to top', () => {
  const plot: PlotArea = { x: 42, y: 42, width: 600, height: 260 };
  equal(projectY(0, 12, plot), plot.y + plot.height);
  equal(projectY(12, 12, plot), plot.y);
  equal(projectY(6, 12, plot), plot.y + plot.height / 2);
});

run('projectY clamps values above maxY to the top edge', () => {
  const plot: PlotArea = { x: 0, y: 0, width: 100, height: 100 };
  equal(projectY(99, 10, plot), plot.y);
});

run('projectY clamps negative values to the bottom edge', () => {
  const plot: PlotArea = { x: 0, y: 0, width: 100, height: 100 };
  equal(projectY(-5, 10, plot), plot.y + plot.height);
});

run('projectX guards against a zero maxTime', () => {
  const plot: PlotArea = { x: 10, y: 0, width: 100, height: 100 };
  equal(projectX(0, 0, plot), plot.x);
});

run('clamp01 bounds values to the unit interval', () => {
  equal(clamp01(-1), 0);
  equal(clamp01(0.5), 0.5);
  equal(clamp01(2), 1);
});

run('niceStep snaps raw steps to friendly increments', () => {
  equal(niceStep(0.4), 1);
  equal(niceStep(1.5), 2);
  equal(niceStep(3), 5);
  equal(niceStep(8), 10);
  equal(niceStep(23), 30);
});

run('tickValues produces ascending ticks ending at the max', () => {
  const ticks = tickValues(12, 5);
  equal(ticks[0], 0);
  equal(ticks[ticks.length - 1], 12);
  for (let i = 1; i < ticks.length; i += 1) {
    if (ticks[i]! <= ticks[i - 1]!) throw new Error('Ticks must strictly ascend');
  }
});

run('formatTick keeps integers clean and trims decimals', () => {
  equal(formatTick(5), '5');
  equal(formatTick(2.5), '2.5');
});

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
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  }
}
