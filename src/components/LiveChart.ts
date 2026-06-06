import type { LiveChartModel, LiveChartSeries } from './liveChartModel';

// Imperative canvas renderer for espresso-shot charts. It draws into a single
// <canvas> in one pass instead of rebuilding DOM for every frame,
// which is dramatically cheaper on slow Android tablets driving a coalesced
// requestAnimationFrame loop. The coordinate / scale math is extracted into the
// pure functions below so it can be unit-tested without a DOM.

export interface PlotArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ProjectedPoint {
  t: number;
  value: number;
  x: number;
  y: number;
}

export interface LiveChartOptions {
  detailed?: boolean;
  hideMaxTimeLabel?: boolean;
  pixelScale?: number;
}

const MARGIN_DETAILED = { top: 18, right: 22, bottom: 64, left: 42 };
const MARGIN_COMPACT = { top: 7, right: 7, bottom: 7, left: 7 };

// Chart chrome colors. These are resolved from CSS theme tokens at draw time
// (see refreshThemeColors) so the canvas tracks the active skin theme. The
// literals below are the dark-theme fallbacks used before the first resolve and
// in non-DOM (unit-test) environments.
let AXIS_LINE = 'rgba(255,255,255,0.22)';
let GRID_LINE = 'rgba(255,255,255,0.1)';
let MARKER_LINE = 'rgba(255,255,255,0.44)';
let TEXT_COLOR = 'rgba(245,247,248,0.82)';
let MUTED_TEXT = 'rgba(255,255,255,0.5)';
let NODATA_LINE = 'rgba(255,255,255,0.18)';
let themeCacheKey = '';

// Resolve the chart CSS custom properties (which are color-mix()/var()
// expressions) into concrete color strings the canvas understands, by letting
// the browser compute them on a throwaway probe element. Cached by the active
// theme so the DOM work runs once per theme switch rather than once per frame.
function refreshThemeColors(): void {
  if (typeof document === 'undefined' || document.body == null) return;
  const root = document.documentElement;
  const prefersDark =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : true;
  const key = `${root.dataset.theme ?? ''}|${prefersDark}`;
  if (key === themeCacheKey) return;

  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;opacity:0;pointer-events:none';
  document.body.appendChild(probe);
  const read = (token: string, fallback: string): string => {
    probe.style.color = `var(${token})`;
    const value = getComputedStyle(probe).color;
    return value ? value : fallback;
  };
  AXIS_LINE = read('--chart-axis', AXIS_LINE);
  GRID_LINE = read('--chart-grid', GRID_LINE);
  MARKER_LINE = read('--chart-marker', MARKER_LINE);
  TEXT_COLOR = read('--chart-text', TEXT_COLOR);
  MUTED_TEXT = read('--chart-text-muted', MUTED_TEXT);
  NODATA_LINE = read('--chart-nodata', NODATA_LINE);
  probe.remove();
  themeCacheKey = key;
}

const TARGET_JUMP_MIN_DELTA = 0.5;
const TARGET_JUMP_MAX_SECONDS = 0.35;

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function computePlotArea(width: number, height: number, detailed: boolean): PlotArea {
  const margin = detailed ? MARGIN_DETAILED : MARGIN_COMPACT;
  return {
    x: margin.left,
    y: margin.top,
    width: width - margin.left - margin.right,
    height: height - margin.top - margin.bottom
  };
}

export function projectX(t: number, maxTime: number, plot: PlotArea): number {
  const span = maxTime > 0 ? maxTime : 1;
  return plot.x + (t / span) * plot.width;
}

export function projectY(value: number, maxY: number, plot: PlotArea): number {
  const span = maxY > 0 ? maxY : 1;
  return plot.y + (1 - clamp01(value / span)) * plot.height;
}

export function niceStep(raw: number): number {
  if (raw <= 1) return 1;
  if (raw <= 2) return 2;
  if (raw <= 5) return 5;
  if (raw <= 10) return 10;
  return Math.ceil(raw / 10) * 10;
}

export function tickValues(max: number, count: number): number[] {
  const step = niceStep(max / Math.max(1, count - 1));
  const ticks: number[] = [];
  for (let value = 0; value < max - step * 0.45 && ticks.length < count - 1; value += step) {
    ticks.push(value);
  }
  if (ticks[ticks.length - 1] !== max) ticks.push(max);
  return [...new Set(ticks.map((value) => round(value, 1)))];
}

export function formatTick(value: number): string {
  return Number.isInteger(value) ? value.toString() : value.toFixed(1);
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function parseDashArray(dashArray: string): number[] {
  const parts = dashArray.split(/[\s,]+/);
  const dashes: number[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const value = Number.parseFloat(parts[i]!);
    if (Number.isFinite(value)) dashes.push(value);
  }
  return dashes;
}

function hasData(model: LiveChartModel): boolean {
  for (let i = 0; i < model.series.length; i += 1) {
    if (model.series[i]!.points.length > 0) return true;
  }
  return false;
}

export class LiveChart {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly detailed: boolean;
  private readonly pixelScale: number;
  private hideMaxTimeLabel: boolean;
  private model: LiveChartModel | null = null;
  private cssWidth = 0;
  private cssHeight = 0;
  private dpr = 1;

  constructor(canvas: HTMLCanvasElement, options: LiveChartOptions = {}) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('LiveChart requires a 2D canvas context');
    this.canvas = canvas;
    this.ctx = ctx;
    this.detailed = options.detailed ?? false;
    this.pixelScale = options.pixelScale ?? 1;
    this.hideMaxTimeLabel = options.hideMaxTimeLabel ?? false;
  }

  setModel(model: LiveChartModel): void {
    this.model = model;
  }

  setOptions(options: LiveChartOptions): void {
    if (options.hideMaxTimeLabel != null) this.hideMaxTimeLabel = options.hideMaxTimeLabel;
  }

  resize(): void {
    const cssWidth = this.canvas.clientWidth;
    const cssHeight = this.canvas.clientHeight;
    const deviceRatio = typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    const ratio = deviceRatio * Math.max(1, this.pixelScale);
    if (cssWidth === this.cssWidth && cssHeight === this.cssHeight && ratio === this.dpr) {
      return;
    }
    this.cssWidth = cssWidth;
    this.cssHeight = cssHeight;
    this.dpr = ratio;
    this.canvas.width = Math.max(1, Math.round(cssWidth * ratio));
    this.canvas.height = Math.max(1, Math.round(cssHeight * ratio));
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  draw(): void {
    refreshThemeColors();
    const ctx = this.ctx;
    const width = this.cssWidth;
    const height = this.cssHeight;
    ctx.clearRect(0, 0, width, height);

    const model = this.model;
    const detailed = this.detailed;
    const plot = computePlotArea(width, height, detailed);

    if (!model || !hasData(model)) {
      this.drawNoData(plot, width, height);
      return;
    }

    if (detailed) this.drawGrid(model, plot);
    this.drawMarkers(model, plot, detailed);
    for (let i = 0; i < model.series.length; i += 1) {
      this.drawSeries(model.series[i]!, model.maxTime, model.maxY, plot);
    }
    if (detailed) this.drawLegend(model.series, width, height);
  }

  private drawNoData(plot: PlotArea, width: number, height: number): void {
    const ctx = this.ctx;
    if (!this.detailed) {
      ctx.strokeStyle = NODATA_LINE;
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(16, height - 16);
      ctx.lineTo(width - 16, 16);
      ctx.stroke();
      return;
    }
    ctx.strokeStyle = AXIS_LINE;
    ctx.lineWidth = 1;
    ctx.strokeRect(plot.x, plot.y, plot.width, plot.height);
    ctx.fillStyle = MUTED_TEXT;
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('No chart data', width / 2, height / 2);
  }

  private drawGrid(model: LiveChartModel, plot: PlotArea): void {
    const ctx = this.ctx;
    const xTicks = tickValues(model.maxTime, 5);
    const yTicks = tickValues(model.maxY, 5);

    ctx.strokeStyle = AXIS_LINE;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.strokeRect(plot.x, plot.y, plot.width, plot.height);

    ctx.strokeStyle = GRID_LINE;
    ctx.beginPath();
    for (let i = 0; i < xTicks.length; i += 1) {
      const x = projectX(xTicks[i]!, model.maxTime, plot);
      ctx.moveTo(x, plot.y);
      ctx.lineTo(x, plot.y + plot.height);
    }
    for (let i = 0; i < yTicks.length; i += 1) {
      const y = projectY(yTicks[i]!, model.maxY, plot);
      ctx.moveTo(plot.x, y);
      ctx.lineTo(plot.x + plot.width, y);
    }
    ctx.stroke();

    ctx.fillStyle = TEXT_COLOR;
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    for (let i = 0; i < xTicks.length; i += 1) {
      if (this.hideMaxTimeLabel && i === xTicks.length - 1) continue;
      const x = projectX(xTicks[i]!, model.maxTime, plot);
      ctx.fillText(`${formatTick(xTicks[i]!)}s`, x, plot.y + plot.height + 16);
    }
    ctx.textAlign = 'right';
    for (let i = 0; i < yTicks.length; i += 1) {
      const y = projectY(yTicks[i]!, model.maxY, plot);
      ctx.fillText(formatTick(yTicks[i]!), plot.x - 10, y + 4);
    }
  }

  private drawMarkers(model: LiveChartModel, plot: PlotArea, detailed: boolean): void {
    if (model.markers.length === 0) return;
    const ctx = this.ctx;
    const labelLimit = 6;
    ctx.strokeStyle = MARKER_LINE;
    ctx.lineWidth = detailed ? 1.4 : 1;
    ctx.lineCap = 'butt';
    ctx.setLineDash([]);
    for (let i = 0; i < model.markers.length; i += 1) {
      const x = snapPixel(projectX(model.markers[i]!.t, model.maxTime, plot));
      drawVerticalDash(ctx, x, plot.y, plot.y + plot.height, 5, 5, plot.y);
    }
    ctx.setLineDash([]);
    ctx.lineCap = 'round';

    if (detailed) {
      ctx.fillStyle = TEXT_COLOR;
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      const limit = Math.min(labelLimit, model.markers.length);
      for (let i = 0; i < limit; i += 1) {
        const marker = model.markers[i]!;
        const x = projectX(marker.t, model.maxTime, plot);
        ctx.fillText(marker.label, x + 4, plot.y + 13 + (i % 2) * 14);
      }
    }
  }

  private drawSeries(series: LiveChartSeries, maxTime: number, maxY: number, plot: PlotArea): void {
    const points = series.points;
    if (points.length === 0) return;
    const ctx = this.ctx;
    // Decent app look: thick green/blue/red curves; thinner dashed target lines.
    const dashed = series.dashArray != null;
    ctx.strokeStyle = series.color;
    ctx.lineWidth = dashed ? 1.5 : 2.6;
    ctx.lineJoin = 'round';
    ctx.lineCap = dashed ? 'butt' : 'round';
    ctx.setLineDash([]);

    if (points.length === 1) {
      const point = points[0]!;
      const x = projectX(point.t, maxTime, plot);
      const y = projectY(point.value, maxY, plot);
      ctx.fillStyle = series.color;
      ctx.beginPath();
      ctx.arc(x, y, 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.setLineDash([]);
      ctx.lineCap = 'round';
      return;
    }

    const xy = points.map((point) => ({
      t: point.t,
      value: point.value,
      x: projectX(point.t, maxTime, plot),
      y: projectY(point.value, maxY, plot)
    }));

    if (dashed) {
      drawDashedSegments(ctx, xy, parseDashArray(series.dashArray!));
      ctx.lineCap = 'round';
      return;
    }

    ctx.beginPath();
    ctx.moveTo(xy[0]!.x, xy[0]!.y);
    if (xy.length === 2) {
      ctx.lineTo(xy[1]!.x, xy[1]!.y);
    } else {
      // Quadratic smoothing through midpoints, matching the Decent graph's
      // smooth curves rather than jagged polylines.
      let i = 1;
      for (; i < xy.length - 1; i += 1) {
        const xc = (xy[i]!.x + xy[i + 1]!.x) / 2;
        const yc = (xy[i]!.y + xy[i + 1]!.y) / 2;
        ctx.quadraticCurveTo(xy[i]!.x, xy[i]!.y, xc, yc);
      }
      ctx.quadraticCurveTo(xy[i]!.x, xy[i]!.y, xy[i]!.x, xy[i]!.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private drawLegend(series: LiveChartSeries[], width: number, height: number): void {
    if (series.length === 0) return;
    const ctx = this.ctx;
    const itemWidth = 124;
    const rowHeight = 15;
    const columns = Math.max(1, Math.min(series.length, Math.floor((width - 24) / itemWidth)));
    const rows = Math.ceil(series.length / columns);
    const start = Math.max(12, width - columns * itemWidth - 12);
    // Bottom-anchored: last row sits near the canvas bottom, below the x-axis labels.
    const firstRowY = height - 11 - (rows - 1) * rowHeight;

    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 1.6;
    for (let i = 0; i < series.length; i += 1) {
      const item = series[i]!;
      const x = start + (i % columns) * itemWidth;
      const y = firstRowY + Math.floor(i / columns) * rowHeight;
      ctx.strokeStyle = item.color;
      ctx.setLineDash(item.dashArray ? parseDashArray(item.dashArray) : []);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 23, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = TEXT_COLOR;
      ctx.fillText(item.shortLabel, x + 29, y);
    }
  }
}

function drawVerticalDash(
  ctx: CanvasRenderingContext2D,
  x: number,
  y1: number,
  y2: number,
  dash = 5,
  gap = 5,
  anchorY = Math.min(y1, y2)
): void {
  const visibleStart = Math.round(Math.min(y1, y2));
  const visibleEnd = Math.round(Math.max(y1, y2));
  const step = dash + gap;
  let y = Math.round(anchorY);
  while (y > visibleStart) y -= step;
  while (y + dash <= visibleStart) y += step;

  ctx.beginPath();
  for (; y < visibleEnd; y += step) {
    const segmentStart = Math.max(y, visibleStart);
    const segmentEnd = Math.min(y + dash, visibleEnd);
    if (segmentEnd <= segmentStart) continue;
    ctx.moveTo(x, segmentStart);
    ctx.lineTo(x, segmentEnd);
  }
  ctx.stroke();
}

function drawDashedSegments(
  ctx: CanvasRenderingContext2D,
  points: ProjectedPoint[],
  pattern: number[]
): void {
  const lineDash = pattern.length > 0 ? pattern : [6, 5];
  const run: ProjectedPoint[] = [];
  ctx.setLineDash([]);
  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1]!;
    const current = points[i]!;
    if (isTargetJump(previous, current)) {
      if (run.length === 0) run.push(previous);
      run.push({ ...previous, t: current.t, x: current.x });
      strokeDashedRun(ctx, run, lineDash);
      run.length = 0;
      strokeDashedConnector(ctx, snapPixel(current.x), previous.y, current.y, lineDash);
      run.push(current);
      continue;
    }
    if (run.length === 0) run.push(previous);
    run.push(current);
  }
  strokeDashedRun(ctx, run, lineDash);
  ctx.setLineDash([]);
}

function isTargetJump(previous: ProjectedPoint, current: ProjectedPoint): boolean {
  const valueDelta = Math.abs(previous.value - current.value);
  const timeDelta = Math.abs(current.t - previous.t);
  if (valueDelta < TARGET_JUMP_MIN_DELTA) return false;
  return timeDelta <= TARGET_JUMP_MAX_SECONDS || isVisuallyVertical(previous, current);
}

function isVisuallyVertical(previous: ProjectedPoint, current: ProjectedPoint): boolean {
  const dx = Math.abs(previous.x - current.x);
  const dy = Math.abs(previous.y - current.y);
  return dx < 0.75 || (dx <= 14 && dy >= dx * 2);
}

function strokeDashedConnector(
  ctx: CanvasRenderingContext2D,
  x: number,
  y1: number,
  y2: number,
  lineDash: number[]
): void {
  ctx.setLineDash([]);
  drawVerticalDash(ctx, x, y1, y2, lineDash[0] ?? 6, lineDash[1] ?? 5);
}

function strokeDashedRun(
  ctx: CanvasRenderingContext2D,
  points: ProjectedPoint[],
  lineDash: number[]
): void {
  if (points.length < 2) return;
  ctx.setLineDash(lineDash);
  ctx.beginPath();
  ctx.moveTo(points[0]!.x, points[0]!.y);
  for (let i = 1; i < points.length; i += 1) {
    ctx.lineTo(points[i]!.x, points[i]!.y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

function snapPixel(value: number): number {
  return Math.round(value) + 0.5;
}
