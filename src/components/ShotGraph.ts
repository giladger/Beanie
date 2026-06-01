import type { ShotMeasurement, ShotRecord } from '../api/types';

interface GraphOptions {
  detailed?: boolean;
}

interface GraphPoint {
  t: number;
  pressure: number | null;
  flow: number | null;
  weight: number | null;
  temp: number | null;
}

const SERIES = [
  ['pressure', 'Pressure', 'trace-pressure'],
  ['flow', 'Flow', 'trace-flow'],
  ['weight', 'Weight /5', 'trace-weight'],
  ['temp', 'Temp /10', 'trace-temp']
] as const;

export function renderShotGraph(shot: ShotRecord | null, options: GraphOptions = {}): string {
  const measurements = shot?.measurements ?? [];
  const detailed = options.detailed ?? false;
  const width = detailed ? 920 : 360;
  const height = detailed ? 340 : 120;
  const margin = detailed
    ? { top: 34, right: 22, bottom: 36, left: 42 }
    : { top: 7, right: 7, bottom: 7, left: 7 };
  const className = detailed ? 'shot-graph shot-graph-large' : 'shot-graph';

  if (measurements.length < 2) {
    return `<svg class="${className}" viewBox="0 0 ${width} ${height}" role="img" aria-label="No graph data"></svg>`;
  }

  const graphPoints = buildPoints(measurements);
  const maxTime = Math.max(1, ...graphPoints.map((point) => point.t));
  const allValues = graphPoints.flatMap((point) =>
    SERIES.map(([key]) => point[key]).filter((value): value is number => value != null)
  );
  const maxY = Math.max(10, Math.ceil(Math.max(...allValues, 10) / 2) * 2);
  const plot = {
    x: margin.left,
    y: margin.top,
    width: width - margin.left - margin.right,
    height: height - margin.top - margin.bottom
  };

  const xFor = (value: number) => plot.x + (value / maxTime) * plot.width;
  const yFor = (value: number) => plot.y + (1 - clamp(value / maxY)) * plot.height;
  const grid = detailed ? renderGrid(height, plot, maxTime, maxY, xFor, yFor) : '';
  const traces = SERIES.map(([key, , className]) =>
    renderTrace(graphPoints, key, className, xFor, yFor)
  ).join('');
  const legend = detailed ? renderLegend(width) : '';

  return `<svg class="${className}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Shot graph">
    ${grid}
    ${traces}
    ${legend}
  </svg>`;
}

function buildPoints(measurements: ShotMeasurement[]): GraphPoint[] {
  const firstTime = firstTimestamp(measurements);
  return measurements.map((measurement, index) => {
    const timestamp = timestampFor(measurement);
    const fallbackTime = index * 0.5;
    const t =
      firstTime != null && timestamp != null
        ? Math.max(0, (timestamp - firstTime) / 1000)
        : fallbackTime;
    const temperature = numeric(measurement.machine.groupTemperature) ?? numeric(measurement.machine.mixTemperature);
    return {
      t,
      pressure: numeric(measurement.machine.pressure),
      flow: numeric(measurement.machine.flow),
      weight: scaleWeight(measurement),
      temp: temperature == null ? null : temperature / 10
    };
  });
}

function firstTimestamp(measurements: ShotMeasurement[]): number | null {
  for (const measurement of measurements) {
    const timestamp = timestampFor(measurement);
    if (timestamp != null) return timestamp;
  }
  return null;
}

function timestampFor(measurement: ShotMeasurement): number | null {
  const value = measurement.machine.timestamp ?? measurement.scale?.timestamp;
  const timestamp = value == null ? Number.NaN : Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function scaleWeight(measurement: ShotMeasurement): number | null {
  const weight = numeric(measurement.scale?.weight);
  return weight == null ? null : weight / 5;
}

function renderTrace(
  graphPoints: GraphPoint[],
  key: keyof Omit<GraphPoint, 't'>,
  className: string,
  xFor: (value: number) => number,
  yFor: (value: number) => number
): string {
  const points = graphPoints
    .filter((point) => point[key] != null)
    .map((point) => `${xFor(point.t).toFixed(1)},${yFor(point[key]!).toFixed(1)}`)
    .join(' ');
  return points ? `<polyline class="trace ${className}" points="${points}" />` : '';
}

function renderGrid(
  height: number,
  plot: { x: number; y: number; width: number; height: number },
  maxTime: number,
  maxY: number,
  xFor: (value: number) => number,
  yFor: (value: number) => number
): string {
  const xTicks = tickValues(maxTime, 5);
  const yTicks = tickValues(maxY, 5);
  const vertical = xTicks
    .map((tick) => `<line class="chart-grid-line" x1="${xFor(tick).toFixed(1)}" y1="${plot.y}" x2="${xFor(tick).toFixed(1)}" y2="${plot.y + plot.height}" />`)
    .join('');
  const horizontal = yTicks
    .map((tick) => `<line class="chart-grid-line" x1="${plot.x}" y1="${yFor(tick).toFixed(1)}" x2="${plot.x + plot.width}" y2="${yFor(tick).toFixed(1)}" />`)
    .join('');
  const xLabels = xTicks
    .map((tick) => `<text class="chart-axis-label" x="${xFor(tick).toFixed(1)}" y="${height - 12}" text-anchor="middle">${formatTick(tick)}s</text>`)
    .join('');
  const yLabels = yTicks
    .map((tick) => `<text class="chart-axis-label" x="${plot.x - 10}" y="${(yFor(tick) + 4).toFixed(1)}" text-anchor="end">${formatTick(tick)}</text>`)
    .join('');

  return `<g class="chart-grid">
    <rect class="chart-plot" x="${plot.x}" y="${plot.y}" width="${plot.width}" height="${plot.height}" />
    ${vertical}
    ${horizontal}
    ${xLabels}
    ${yLabels}
  </g>`;
}

function renderLegend(width: number): string {
  const itemWidth = 118;
  const start = Math.max(48, width - itemWidth * SERIES.length - 12);
  return `<g class="chart-legend">
    ${SERIES.map(([, label, className], index) => {
      const x = start + index * itemWidth;
      return `<line class="legend-line ${className}" x1="${x}" y1="16" x2="${x + 24}" y2="16" />
        <text class="legend-label" x="${x + 31}" y="20">${label}</text>`;
    }).join('')}
  </g>`;
}

function tickValues(max: number, count: number): number[] {
  const step = niceStep(max / Math.max(1, count - 1));
  const ticks: number[] = [];
  for (let value = 0; value < max - step * 0.45 && ticks.length < count - 1; value += step) {
    ticks.push(value);
  }
  if (ticks[ticks.length - 1] !== max) ticks.push(max);
  return [...new Set(ticks.map((value) => round(value, 1)))];
}

function niceStep(raw: number): number {
  if (raw <= 1) return 1;
  if (raw <= 2) return 2;
  if (raw <= 5) return 5;
  if (raw <= 10) return 10;
  return Math.ceil(raw / 10) * 10;
}

function formatTick(value: number): string {
  return Number.isInteger(value) ? value.toString() : value.toFixed(1);
}

function numeric(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
