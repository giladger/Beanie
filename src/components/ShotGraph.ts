import type { ShotRecord } from '../api/types';
import { buildShotGraphModel, type ShotGraphModel, type ShotGraphSeries } from './shotGraphModel';

interface GraphOptions {
  detailed?: boolean;
  width?: number;
  height?: number;
}

interface PlotArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function renderShotGraph(shot: ShotRecord | null, options: GraphOptions = {}): string {
  const detailed = options.detailed ?? false;
  const width = options.width ?? (detailed ? 920 : 360);
  const height = options.height ?? (detailed ? 340 : 120);
  const margin = detailed
    ? { top: 42, right: 22, bottom: 38, left: 42 }
    : { top: 7, right: 7, bottom: 7, left: 7 };
  const className = detailed ? 'shot-graph shot-graph-large' : 'shot-graph';
  const model = buildShotGraphModel(shot);
  const ariaLabel = graphAriaLabel(model);

  if (!model.hasData) {
    return `<svg class="${className}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeAttr(ariaLabel)}">
      ${renderNoData(width, height, detailed)}
    </svg>`;
  }

  const plot = {
    x: margin.left,
    y: margin.top,
    width: width - margin.left - margin.right,
    height: height - margin.top - margin.bottom
  };

  const xFor = (value: number) => plot.x + (value / model.maxTime) * plot.width;
  const yFor = (value: number) => plot.y + (1 - clamp(value / model.maxY)) * plot.height;
  const grid = detailed ? renderGrid(height, plot, model.maxTime, model.maxY, xFor, yFor) : '';
  const markers = renderStepMarkers(model, plot, detailed, xFor);
  const traces = model.series
    .map((series) => renderTrace(series, plot, xFor, yFor))
    .join('');
  const legend = detailed ? renderLegend(width, model.series) : '';
  const missing = detailed ? renderMissingNotice(model, plot) : '';

  return `<svg class="${className}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeAttr(ariaLabel)}">
    ${grid}
    ${markers}
    ${traces}
    ${legend}
    ${missing}
  </svg>`;
}

function renderTrace(
  series: ShotGraphSeries,
  plot: PlotArea,
  xFor: (value: number) => number,
  yFor: (value: number) => number
): string {
  const strokeAttrs = traceStrokeAttrs(series);
  if (series.samples.length === 1) {
    const sample = series.samples[0]!;
    return `<circle class="trace-point ${series.className}" cx="${xFor(sample.t).toFixed(1)}" cy="${yFor(sample.value).toFixed(1)}" r="2.4" ${strokeAttrs} fill="${series.color}" />`;
  }
  if (series.dashArray != null) return renderDashedTrace(series, plot, xFor, yFor);

  const points = series.samples
    .map((sample) => `${xFor(sample.t).toFixed(1)},${yFor(sample.value).toFixed(1)}`)
    .join(' ');
  return `<polyline class="trace ${series.className}" ${strokeAttrs} points="${points}" />`;
}

function renderDashedTrace(
  series: ShotGraphSeries,
  plot: PlotArea,
  xFor: (value: number) => number,
  yFor: (value: number) => number
): string {
  const segments: string[] = [];
  const [dash = 6, gap = 5] = dashValues(series.dashArray);
  const run: Array<{ x: number; y: number }> = [];
  for (let i = 1; i < series.samples.length; i += 1) {
    const previous = series.samples[i - 1]!;
    const current = series.samples[i]!;
    const x1 = xFor(previous.t);
    const x2 = xFor(current.t);
    const y1 = yFor(previous.value);
    const y2 = yFor(current.value);
    const vertical = Math.abs(x1 - x2) < 0.75;
    if (vertical) {
      segments.push(renderDashedRun(series, run));
      run.length = 0;
      segments.push(
        `<path class="trace ${series.className}" d="${verticalDashPath((x1 + x2) / 2, y1, y2, dash, gap, plot.y)}" stroke="${series.color}" fill="none" stroke-linecap="butt" />`
      );
      continue;
    }
    if (run.length === 0) run.push({ x: x1, y: y1 });
    run.push({ x: x2, y: y2 });
  }
  segments.push(renderDashedRun(series, run));
  return segments.join('');
}

function renderDashedRun(series: ShotGraphSeries, points: Array<{ x: number; y: number }>): string {
  if (points.length < 2) return '';
  const pointList = points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
  return `<polyline class="trace ${series.className}" points="${pointList}" stroke="${series.color}" stroke-dasharray="${escapeAttr(series.dashArray!)}" />`;
}

function traceStrokeAttrs(series: ShotGraphSeries): string {
  const dash = series.dashArray ? ` stroke-dasharray="${series.dashArray}"` : '';
  return `stroke="${series.color}"${dash}`;
}

function renderStepMarkers(
  model: ShotGraphModel,
  plot: PlotArea,
  detailed: boolean,
  xFor: (value: number) => number
): string {
  if (model.markers.length === 0) return '';
  const labelLimit = 6;
  return `<g class="chart-step-markers">
    ${model.markers
      .map((marker, index) => {
        const x = xFor(marker.t);
        const label =
          detailed && index < labelLimit
            ? `<text class="chart-axis-label" x="${(x + 4).toFixed(1)}" y="${(plot.y + 13 + (index % 2) * 14).toFixed(1)}">${escapeHtml(marker.label)}</text>`
            : '';
        return `<path class="chart-step-marker" d="${verticalDashPath(x, plot.y, plot.y + plot.height, 5, 5, plot.y)}" stroke="rgba(255,255,255,0.44)" stroke-width="${detailed ? 1.4 : 1}" fill="none" />
          ${label}`;
      })
      .join('')}
  </g>`;
}

function verticalDashPath(
  x: number,
  y1: number,
  y2: number,
  dash = 5,
  gap = 5,
  anchorY = Math.min(y1, y2)
): string {
  const visibleStart = Math.round(Math.min(y1, y2));
  const visibleEnd = Math.round(Math.max(y1, y2));
  const step = dash + gap;
  const roundedX = snapSvgPixel(x);
  const commands: string[] = [];
  let y = Math.round(anchorY);
  while (y > visibleStart) y -= step;
  while (y + dash <= visibleStart) y += step;

  for (; y < visibleEnd; y += step) {
    const segmentStart = Math.max(y, visibleStart);
    const segmentEnd = Math.min(y + dash, visibleEnd);
    if (segmentEnd <= segmentStart) continue;
    commands.push(`M${roundedX} ${segmentStart}L${roundedX} ${segmentEnd}`);
  }
  return commands.join(' ');
}

function dashValues(dashArray: string | undefined): [number, number] {
  if (!dashArray) return [6, 5];
  const parts = dashArray
    .split(/[\s,]+/)
    .map((part) => Number.parseFloat(part))
    .filter((part) => Number.isFinite(part));
  return [parts[0] ?? 6, parts[1] ?? 5];
}

function snapSvgPixel(value: number): string {
  return (Math.round(value) + 0.5).toFixed(1);
}

function renderGrid(
  height: number,
  plot: PlotArea,
  maxTime: number,
  maxY: number,
  xFor: (value: number) => number,
  yFor: (value: number) => number
): string {
  const xTicks = tickValues(maxTime, 5);
  const yTicks = tickValues(maxY, 5);
  const vertical = xTicks
    .map(
      (tick) =>
        `<line class="chart-grid-line" x1="${xFor(tick).toFixed(1)}" y1="${plot.y}" x2="${xFor(tick).toFixed(1)}" y2="${plot.y + plot.height}" />`
    )
    .join('');
  const horizontal = yTicks
    .map(
      (tick) =>
        `<line class="chart-grid-line" x1="${plot.x}" y1="${yFor(tick).toFixed(1)}" x2="${plot.x + plot.width}" y2="${yFor(tick).toFixed(1)}" />`
    )
    .join('');
  const xLabels = xTicks
    .map(
      (tick) =>
        `<text class="chart-axis-label" x="${xFor(tick).toFixed(1)}" y="${height - 12}" text-anchor="middle">${formatTick(tick)}s</text>`
    )
    .join('');
  const yLabels = yTicks
    .map(
      (tick) =>
        `<text class="chart-axis-label" x="${plot.x - 10}" y="${(yFor(tick) + 4).toFixed(1)}" text-anchor="end">${formatTick(tick)}</text>`
    )
    .join('');

  return `<g class="chart-grid">
    <rect class="chart-plot" x="${plot.x}" y="${plot.y}" width="${plot.width}" height="${plot.height}" />
    ${vertical}
    ${horizontal}
    ${xLabels}
    ${yLabels}
  </g>`;
}

function renderLegend(width: number, series: ShotGraphSeries[]): string {
  const itemWidth = 108;
  const columns = Math.max(1, Math.min(series.length, Math.floor((width - 24) / itemWidth)));
  const start = Math.max(12, width - columns * itemWidth - 12);

  return `<g class="chart-legend">
    ${series
      .map((item, index) => {
        const x = start + (index % columns) * itemWidth;
        const y = 16 + Math.floor(index / columns) * 15;
        const dash = item.dashArray ? ` stroke-dasharray="${item.dashArray}"` : '';
        return `<line class="legend-line ${item.className}" x1="${x}" y1="${y}" x2="${x + 23}" y2="${y}" stroke="${item.color}"${dash} />
        <text class="legend-label" x="${x + 29}" y="${y + 4}">${escapeHtml(item.shortLabel)}</text>`;
      })
      .join('')}
  </g>`;
}

function renderMissingNotice(model: ShotGraphModel, plot: PlotArea): string {
  if (model.missingSeries.length === 0 || model.missingSeries.length === 8) return '';
  const missing = model.missingSeries.map((series) => series.shortLabel.toLowerCase()).join(', ');
  return `<text class="legend-label" x="${plot.x + 8}" y="${plot.y + plot.height - 9}" fill="rgba(255,255,255,0.5)">Missing: ${escapeHtml(missing)}</text>`;
}

function renderNoData(width: number, height: number, detailed: boolean): string {
  if (!detailed) {
    return `<line x1="16" y1="${height - 16}" x2="${width - 16}" y2="16" stroke="rgba(255,255,255,0.18)" stroke-width="2" />`;
  }
  return `<rect class="chart-plot" x="42" y="42" width="${width - 64}" height="${height - 80}" />
    <text class="legend-label" x="${width / 2}" y="${height / 2}" text-anchor="middle">No chart data</text>`;
}

function graphAriaLabel(model: ShotGraphModel): string {
  if (!model.hasData) return 'No graph data';
  const shown = model.series.map((series) => series.label).join(', ');
  const missing =
    model.missingSeries.length > 0
      ? `. Missing ${model.missingSeries.map((series) => series.label).join(', ')}`
      : '';
  const markers = model.markers.length > 0 ? `. ${model.markers.length} profile step markers` : '';
  return `Shot graph showing ${shown}${missing}${markers}`;
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

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
