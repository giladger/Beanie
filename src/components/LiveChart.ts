import type {
  LiveChartModel,
  LiveChartPoint,
  LiveChartSeries,
  ShotGraphSeriesKey
} from '../domain/liveChartModel';

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
  /**
   * Maximum number of pixels retained by this chart's canvas backing store.
   * The effective DPR is reduced isotropically when DPR * pixelScale would
   * exceed the budget. This bounds the GPU allocation without changing the
   * canvas' CSS size.
   */
  maxBackingStorePixels?: number;
  /**
   * Follow the mouse with a crosshair + per-series values tooltip. Only ever
   * attached on devices with a hovering fine pointer (i.e. desktops), so the
   * tablet/touch paths never pay for the listeners or redraws.
   */
  hover?: boolean;
}

export type LiveChartInvalidation = 'model' | 'layout' | 'theme' | 'interaction';

/** Four megapixels is roughly a 16 MiB RGBA backing store per mounted chart. */
export const DEFAULT_MAX_BACKING_STORE_PIXELS = 4 * 1024 * 1024;

export interface CanvasBackingStoreSize {
  width: number;
  height: number;
  scale: number;
  capped: boolean;
}

/**
 * Compute a bounded canvas backing store while preserving a single X/Y scale.
 * CSS client dimensions are integral in browsers; normalizing them here also
 * makes this helper safe for synthetic callers and unit tests.
 */
export function computeCanvasBackingStoreSize(
  cssWidthValue: number,
  cssHeightValue: number,
  devicePixelRatioValue: number,
  pixelScaleValue: number,
  maxBackingStorePixelsValue = DEFAULT_MAX_BACKING_STORE_PIXELS
): CanvasBackingStoreSize {
  const cssWidth = finiteNonNegativeInteger(cssWidthValue);
  const cssHeight = finiteNonNegativeInteger(cssHeightValue);
  const devicePixelRatio = finitePositive(devicePixelRatioValue, 1);
  const pixelScale = Math.max(1, finitePositive(pixelScaleValue, 1));
  const maxBackingStorePixels = Math.max(
    1,
    finitePositiveInteger(maxBackingStorePixelsValue, DEFAULT_MAX_BACKING_STORE_PIXELS)
  );
  const requestedScale = devicePixelRatio * pixelScale;

  if (cssWidth === 0 || cssHeight === 0) {
    return { width: 1, height: 1, scale: 1, capped: false };
  }

  const cssPixels = cssWidth * cssHeight;
  const maximumScale = Math.sqrt(maxBackingStorePixels / cssPixels);
  const scale = Math.min(requestedScale, maximumScale);

  // Flooring, rather than rounding, guarantees the integer backing store does
  // not cross the budget due to rounding at the cap boundary.
  const width = Math.max(1, Math.floor(cssWidth * scale));
  const height = Math.max(1, Math.floor(cssHeight * scale));
  return {
    width,
    height,
    scale,
    capped: scale < requestedScale
  };
}

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function finitePositiveInteger(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.max(1, Math.floor(value)) : fallback;
}

function finiteNonNegativeInteger(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

const MARGIN_DETAILED = { top: 18, right: 22, bottom: 58, left: 42 };
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
let TOOLTIP_BG = 'rgba(17, 23, 28, 0.95)';
let TOOLTIP_BORDER = 'rgba(255,255,255,0.22)';
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
  TOOLTIP_BG = read('--panel', TOOLTIP_BG);
  TOOLTIP_BORDER = read('--line-strong', TOOLTIP_BORDER);
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

/**
 * Value of a series at time t, linearly interpolated between the surrounding
 * samples. Null when t falls outside the series' recorded time range (e.g.
 * hovering past the end of the shorter shot in a comparison).
 */
export function seriesValueAt(points: LiveChartPoint[], t: number): number | null {
  if (points.length === 0) return null;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (t < first.t || t > last.t) return null;
  // Binary search for the first sample at or after t.
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.t < t) lo = mid + 1;
    else hi = mid;
  }
  const after = points[lo]!;
  if (lo === 0 || after.t === t) return after.value;
  const before = points[lo - 1]!;
  const span = after.t - before.t;
  if (span <= 0) return after.value;
  return before.value + ((after.value - before.value) * (t - before.t)) / span;
}

export interface HoverRow {
  color: string;
  dashed: boolean;
  label: string;
  /** Value as plotted (temp series are stored /10 to share the pressure axis). */
  plottedValue: number;
  text: string;
}

// Tooltip rows show real units — the temperature series are unscaled back from
// the /10 representation they use to share the 0-12 Y axis.
export function hoverValueText(key: ShotGraphSeriesKey, value: number): string {
  switch (key) {
    case 'pressure':
    case 'targetPressure':
      return `${value.toFixed(1)} bar`;
    case 'flow':
    case 'targetFlow':
      return `${value.toFixed(1)} ml/s`;
    case 'weightFlow':
      return `${value.toFixed(1)} g/s`;
    case 'groupTemperature':
    case 'targetTemperature':
      return `${(value * 10).toFixed(1)}°C`;
    default:
      return value.toFixed(1);
  }
}

function hoverRowLabel(series: LiveChartSeries): string {
  // The legend says "Temp / 10" because the plotted line is scaled; the
  // tooltip prints the real temperature, so drop the divisor from the name.
  if (series.key === 'groupTemperature') return 'Temp';
  if (series.key === 'targetTemperature') return 'Target temp';
  return series.shortLabel;
}

/** One tooltip row per legend-worthy series that has a sample at time t. */
export function buildHoverRows(model: LiveChartModel, t: number): HoverRow[] {
  const rows: HoverRow[] = [];
  for (let i = 0; i < model.series.length; i += 1) {
    const series = model.series[i]!;
    if (series.legend === false) continue;
    const value = seriesValueAt(series.points, t);
    if (value == null) continue;
    rows.push({
      color: series.color,
      dashed: series.dashArray != null,
      label: hoverRowLabel(series),
      plottedValue: value,
      text: hoverValueText(series.key, value)
    });
  }
  return rows;
}

function hasData(model: LiveChartModel): boolean {
  for (let i = 0; i < model.series.length; i += 1) {
    if (model.series[i]!.points.length > 0) return true;
  }
  return false;
}

export class LiveChart {
  private static readonly canvasOwners = new WeakMap<HTMLCanvasElement, LiveChart>();
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly detailed: boolean;
  private readonly pixelScale: number;
  private readonly maxBackingStorePixels: number;
  private hideMaxTimeLabel: boolean;
  private model: LiveChartModel | null = null;
  private cssWidth = 0;
  private cssHeight = 0;
  private dpr = 1;
  private disposed = false;
  private suspended = false;
  private hoverEnabled = false;
  private hoverProbeAttached = false;
  private animationFrame: number | null = null;
  private pendingResize = false;
  private pendingThemeRefresh = false;
  private pendingPaint = false;
  private resizeObserver: ResizeObserver | null = null;
  private themeMedia: MediaQueryList | null = null;
  private windowResizeAttached = false;
  private visibilityAttached = false;
  /** Mouse position in CSS pixels while a hover probe is active, else null. */
  private hoverPoint: { x: number; y: number } | null = null;

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse') return;
    const rect = this.canvas.getBoundingClientRect();
    this.setHoverPoint({ x: event.clientX - rect.left, y: event.clientY - rect.top });
  };

  private readonly handlePointerLeave = (): void => {
    this.setHoverPoint(null);
  };

  private readonly handleLayoutSource = (): void => {
    this.invalidate('layout');
  };

  private readonly handleThemeSource = (): void => {
    this.invalidate('theme');
  };

  private readonly handleVisibilitySource = (): void => {
    if (!this.documentVisible()) return;
    // DPR/layout and system theme may both have changed while backgrounded.
    this.invalidate('layout');
    this.invalidate('theme');
  };

  constructor(canvas: HTMLCanvasElement, options: LiveChartOptions = {}) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('LiveChart requires a 2D canvas context');
    // A canvas is an exclusive rendering resource. Replacing a chart on the
    // same element disposes the former owner before the new one takes over,
    // preventing orphaned hover listeners and stale scheduled draws.
    LiveChart.canvasOwners.get(canvas)?.dispose();
    this.canvas = canvas;
    this.ctx = ctx;
    this.detailed = options.detailed ?? false;
    this.pixelScale = Math.max(1, finitePositive(options.pixelScale ?? 1, 1));
    this.maxBackingStorePixels = finitePositiveInteger(
      options.maxBackingStorePixels ?? DEFAULT_MAX_BACKING_STORE_PIXELS,
      DEFAULT_MAX_BACKING_STORE_PIXELS
    );
    this.hideMaxTimeLabel = options.hideMaxTimeLabel ?? false;
    LiveChart.canvasOwners.set(canvas, this);
    this.hoverEnabled = options.hover ?? false;
    if (this.hoverEnabled) this.attachHoverProbe();
    this.attachInvalidationSources();
  }

  private attachInvalidationSources(): void {
    if (this.disposed || this.suspended) return;
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(this.handleLayoutSource);
      this.resizeObserver.observe(this.canvas);
    }
    if (typeof window !== 'undefined') {
      if (typeof window.addEventListener === 'function') {
        // Resize also covers DPR changes that do not alter the CSS box.
        window.addEventListener('resize', this.handleLayoutSource);
        this.windowResizeAttached = true;
      }
      if (typeof window.matchMedia === 'function') {
        this.themeMedia = window.matchMedia('(prefers-color-scheme: dark)');
        if (typeof this.themeMedia.addEventListener === 'function') {
          this.themeMedia.addEventListener('change', this.handleThemeSource);
        }
      }
    }
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', this.handleVisibilitySource);
      this.visibilityAttached = true;
    }
  }

  private detachInvalidationSources(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (
      this.windowResizeAttached &&
      typeof window !== 'undefined' &&
      typeof window.removeEventListener === 'function'
    ) {
      window.removeEventListener('resize', this.handleLayoutSource);
    }
    this.windowResizeAttached = false;
    if (this.themeMedia && typeof this.themeMedia.removeEventListener === 'function') {
      this.themeMedia.removeEventListener('change', this.handleThemeSource);
    }
    this.themeMedia = null;
    if (
      this.visibilityAttached &&
      typeof document !== 'undefined' &&
      typeof document.removeEventListener === 'function'
    ) {
      document.removeEventListener('visibilitychange', this.handleVisibilitySource);
    }
    this.visibilityAttached = false;
  }

  private documentVisible(): boolean {
    return !this.suspended &&
      (typeof document === 'undefined' || document.visibilityState !== 'hidden');
  }

  private attachHoverProbe(): void {
    if (this.disposed || this.suspended || this.hoverProbeAttached) return;
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    this.canvas.addEventListener('pointermove', this.handlePointerMove);
    this.canvas.addEventListener('pointerleave', this.handlePointerLeave);
    this.hoverProbeAttached = true;
  }

  private detachHoverProbe(): void {
    if (!this.hoverProbeAttached) return;
    this.canvas.removeEventListener('pointermove', this.handlePointerMove);
    this.canvas.removeEventListener('pointerleave', this.handlePointerLeave);
    this.hoverProbeAttached = false;
  }

  private setHoverPoint(point: { x: number; y: number } | null): void {
    if (this.disposed) return;
    const previous = this.hoverPoint;
    if (previous == null && point == null) return;
    this.hoverPoint = point;
    // Coalesce pointer events onto the display frame. Historic charts otherwise
    // only draw when their model changes, so interaction owns this invalidation.
    this.invalidate('interaction');
  }

  setModel(model: LiveChartModel): void {
    if (this.disposed) return;
    this.model = model;
  }

  setOptions(options: LiveChartOptions): void {
    if (this.disposed) return;
    if (options.hideMaxTimeLabel != null) this.hideMaxTimeLabel = options.hideMaxTimeLabel;
    if (options.hover === true) {
      this.hoverEnabled = true;
      this.attachHoverProbe();
    }
    if (options.hover === false) {
      this.hoverEnabled = false;
      const hadHoverPoint = this.hoverPoint != null;
      this.detachHoverProbe();
      this.hoverPoint = null;
      if (hadHoverPoint) this.invalidate('interaction');
    }
  }

  resize(): void {
    if (this.disposed) return;
    const cssWidth = finiteNonNegativeInteger(this.canvas.clientWidth);
    const cssHeight = finiteNonNegativeInteger(this.canvas.clientHeight);
    const deviceRatio =
      typeof window !== 'undefined' ? finitePositive(window.devicePixelRatio, 1) : 1;
    const backingStore = computeCanvasBackingStoreSize(
      cssWidth,
      cssHeight,
      deviceRatio,
      this.pixelScale,
      this.maxBackingStorePixels
    );
    if (
      cssWidth === this.cssWidth &&
      cssHeight === this.cssHeight &&
      backingStore.scale === this.dpr &&
      backingStore.width === this.canvas.width &&
      backingStore.height === this.canvas.height
    ) {
      return;
    }
    this.cssWidth = cssWidth;
    this.cssHeight = cssHeight;
    this.dpr = backingStore.scale;
    this.canvas.width = backingStore.width;
    this.canvas.height = backingStore.height;
    this.ctx.setTransform(backingStore.scale, 0, 0, backingStore.scale, 0, 0);
  }

  draw(): void {
    if (this.disposed || !this.documentVisible()) return;
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
    if (detailed) this.drawLegend(model.series, plot, width);
    this.drawHover(model, plot);
  }

  /**
   * Request one coalesced paint. Layout invalidations resize before painting;
   * theme invalidations force CSS token resolution. A host can therefore keep
   * a chart instance while invalidating its independent inputs explicitly.
   */
  invalidate(reason: LiveChartInvalidation = 'model'): void {
    if (this.disposed) return;
    this.pendingPaint = true;
    if (reason === 'layout') this.pendingResize = true;
    if (reason === 'theme') this.pendingThemeRefresh = true;
    if (!this.documentVisible()) return;
    if (this.animationFrame != null) return;

    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      this.flushInvalidation();
      return;
    }
    this.animationFrame = window.requestAnimationFrame(() => {
      this.animationFrame = null;
      this.flushInvalidation();
    });
  }

  private flushInvalidation(): void {
    if (this.disposed || !this.documentVisible() || !this.pendingPaint) return;
    const shouldResize = this.pendingResize;
    const shouldRefreshTheme = this.pendingThemeRefresh;
    this.pendingResize = false;
    this.pendingThemeRefresh = false;
    this.pendingPaint = false;
    if (shouldResize) this.resize();
    if (shouldRefreshTheme) themeCacheKey = '';
    this.draw();
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  get isSuspended(): boolean {
    return this.suspended;
  }

  /**
   * Stop all paints for a semantically hidden canvas and return its native
   * backing store immediately. The latest model is retained for resume.
   */
  suspend(): void {
    if (this.disposed || this.suspended) return;
    this.suspended = true;
    this.detachHoverProbe();
    this.detachInvalidationSources();
    if (this.animationFrame != null) {
      if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(this.animationFrame);
      }
      this.animationFrame = null;
    }
    this.pendingPaint = true;
    this.pendingResize = true;
    this.pendingThemeRefresh = true;
    this.hoverPoint = null;
    this.cssWidth = 0;
    this.cssHeight = 0;
    this.dpr = 1;
    if (LiveChart.canvasOwners.get(this.canvas) === this) {
      this.canvas.width = 1;
      this.canvas.height = 1;
    }
  }

  /** Reattach invalidation sources and schedule one complete layout repaint. */
  resume(): void {
    if (this.disposed || !this.suspended) return;
    this.suspended = false;
    this.attachInvalidationSources();
    if (this.hoverEnabled) this.attachHoverProbe();
    this.invalidate('layout');
    this.invalidate('theme');
  }

  /**
   * End this chart's ownership of the canvas and every resource associated
   * with it. Safe to call repeatedly. The 1x1 assignment releases a potentially
   * large GPU backing store while leaving the DOM element reusable.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.detachHoverProbe();
    this.detachInvalidationSources();
    if (this.animationFrame != null) {
      if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(this.animationFrame);
      }
      this.animationFrame = null;
    }
    this.pendingResize = false;
    this.pendingThemeRefresh = false;
    this.pendingPaint = false;
    this.hoverPoint = null;
    this.model = null;
    this.cssWidth = 0;
    this.cssHeight = 0;
    this.dpr = 1;

    if (LiveChart.canvasOwners.get(this.canvas) === this) {
      LiveChart.canvasOwners.delete(this.canvas);
      this.canvas.width = 1;
      this.canvas.height = 1;
    }
  }

  // Crosshair + values tooltip at the hovered time. Drawn last so it sits on
  // top of the curves; only present on charts constructed with hover enabled
  // (setHoverPoint is only ever called by the probe listeners).
  private drawHover(model: LiveChartModel, plot: PlotArea): void {
    const point = this.hoverPoint;
    if (!point) return;
    if (point.x < plot.x || point.x > plot.x + plot.width) return;
    if (point.y < plot.y || point.y > plot.y + plot.height) return;
    const t = ((point.x - plot.x) / plot.width) * model.maxTime;
    const rows = buildHoverRows(model, t);
    if (rows.length === 0) return;
    const ctx = this.ctx;

    ctx.strokeStyle = MARKER_LINE;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.lineCap = 'butt';
    const lineX = snapPixel(point.x);
    ctx.beginPath();
    ctx.moveTo(lineX, plot.y);
    ctx.lineTo(lineX, plot.y + plot.height);
    ctx.stroke();
    ctx.lineCap = 'round';

    // Dot on each solid curve at the interpolated value; the dashed target
    // lines stay unmarked so the plot doesn't get busy at step edges.
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i]!;
      if (row.dashed) continue;
      ctx.fillStyle = row.color;
      ctx.beginPath();
      ctx.arc(point.x, projectY(row.plottedValue, model.maxY, plot), 3, 0, Math.PI * 2);
      ctx.fill();
    }

    this.drawHoverTooltip(rows, `${t.toFixed(1)}s`, point, plot);
  }

  private drawHoverTooltip(
    rows: HoverRow[],
    title: string,
    point: { x: number; y: number },
    plot: PlotArea
  ): void {
    const ctx = this.ctx;
    const pad = 9;
    const swatch = 16;
    const swatchGap = 7;
    const labelValueGap = 14;
    const rowHeight = 16;

    ctx.font = '11px sans-serif';
    let contentWidth = ctx.measureText(title).width;
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i]!;
      const width =
        swatch + swatchGap + ctx.measureText(row.label).width + labelValueGap + ctx.measureText(row.text).width;
      if (width > contentWidth) contentWidth = width;
    }
    const boxWidth = Math.ceil(contentWidth) + pad * 2;
    const boxHeight = pad * 2 + rowHeight * (rows.length + 1);

    // To the right of the crosshair, flipped left when it would leave the
    // plot; clamped vertically so the box never spills outside the plot.
    let x = point.x + 14;
    if (x + boxWidth > plot.x + plot.width) x = point.x - 14 - boxWidth;
    x = Math.max(plot.x + 2, x);
    let y = point.y + 14;
    if (y + boxHeight > plot.y + plot.height) y = plot.y + plot.height - boxHeight - 2;
    y = Math.max(plot.y + 2, y);

    ctx.fillStyle = TOOLTIP_BG;
    ctx.strokeStyle = TOOLTIP_BORDER;
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, boxWidth, boxHeight, 6);
    else ctx.rect(x, y, boxWidth, boxHeight);
    ctx.fill();
    ctx.stroke();

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = TEXT_COLOR;
    let rowY = y + pad + rowHeight / 2;
    ctx.fillText(title, x + pad, rowY);
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i]!;
      rowY += rowHeight;
      ctx.strokeStyle = row.color;
      ctx.lineWidth = row.dashed ? 1.5 : 2.4;
      ctx.setLineDash(row.dashed ? [4, 3] : []);
      ctx.beginPath();
      ctx.moveTo(x + pad, rowY);
      ctx.lineTo(x + pad + swatch, rowY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = TEXT_COLOR;
      ctx.textAlign = 'left';
      ctx.fillText(row.label, x + pad + swatch + swatchGap, rowY);
      ctx.textAlign = 'right';
      ctx.fillText(row.text, x + boxWidth - pad, rowY);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
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
      // Phase labels are placed at their marker's x across two staggered rows.
      // On narrow (phone) charts those x positions bunch up and the long names
      // overprint into mush, so track the right edge of the last label drawn in
      // each row and skip any label that would overlap a neighbour or run past
      // the plot edge — legible-but-fewer beats an unreadable pile-up.
      const gap = 6;
      const plotRight = plot.x + plot.width;
      const rowRight = [-Infinity, -Infinity];
      for (let i = 0; i < limit; i += 1) {
        const marker = model.markers[i]!;
        const x = projectX(marker.t, model.maxTime, plot) + 4;
        const width = ctx.measureText(marker.label).width;
        if (x + width > plotRight + 2) continue;
        let row = i % 2;
        if (x < rowRight[row]! + gap) row ^= 1;
        if (x < rowRight[row]! + gap) continue;
        ctx.fillText(marker.label, x, plot.y + 13 + row * 14);
        rowRight[row] = x + width;
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
    ctx.lineWidth = series.width ?? (dashed ? 1.5 : 2.6);
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

  private drawLegend(allSeries: LiveChartSeries[], plot: PlotArea, width: number): void {
    const series = allSeries.filter((item) => item.legend !== false);
    if (series.length === 0) return;
    const ctx = this.ctx;
    const itemWidth = 124;
    const rowHeight = 15;
    const columns = Math.max(1, Math.min(series.length, Math.floor((width - 24) / itemWidth)));
    const start = Math.max(12, width - columns * itemWidth - 12);
    // Anchored just below the x-axis labels, which sit at plot bottom + 16.
    const firstRowY = plot.y + plot.height + 34;

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
