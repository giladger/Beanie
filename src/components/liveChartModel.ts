import type { ShotRecord } from '../api/types';
import type { LiveChartModel, LiveChartSeries, ShotGraphSeriesKey } from '../domain/liveChartModel';
import { buildShotGraphModel } from './shotGraphModel';

// Adapts a stored shot into the canvas chart model so the historical detail
// chart and the live chart share one renderer. Reuses buildShotGraphModel (the
// tested SVG model) and maps its samples onto canvas points.
export function chartModelFromShot(shot: ShotRecord | null): LiveChartModel {
  const model = buildShotGraphModel(shot);
  const series: LiveChartSeries[] = model.series.map((item) => ({
    key: item.key,
    label: item.label,
    shortLabel: item.shortLabel,
    color: item.color,
    dashArray: item.dashArray,
    points: item.samples.map((sample) => ({ t: sample.t, value: sample.value }))
  }));
  return {
    series,
    markers: model.markers.map((marker) => ({ t: marker.t, label: marker.label })),
    maxTime: model.maxTime,
    // Fixed 0-12 bar pressure axis, like the Decent app's espresso graph. Flow,
    // weight flow and temp/10 all fall under 12, so they share the scale cleanly.
    maxY: 12
  };
}

// Only the measured curves are overlaid; adding the comparison's dashed target
// lines as well would put up to fourteen lines on one plot.
const OVERLAY_SERIES_KEYS: ReadonlySet<ShotGraphSeriesKey> = new Set([
  'pressure',
  'flow',
  'weightFlow',
  'groupTemperature'
]);

/** Alpha suffix appended to 6-digit hex colors for overlay traces (~35%). */
const OVERLAY_ALPHA = '5a';

/**
 * Lay a second shot's measured curves underneath the primary model so the two
 * pulls can be read against each other: same colors, but faded, thinner, and
 * kept out of the legend. The time axis stretches to whichever shot ran longer.
 */
export function overlayComparisonModel(
  primary: LiveChartModel,
  comparison: LiveChartModel
): LiveChartModel {
  const overlay = comparison.series
    .filter((series) => OVERLAY_SERIES_KEYS.has(series.key))
    .map((series) => ({
      ...series,
      color: fadeColor(series.color),
      width: 1.4,
      legend: false
    }));
  return {
    series: [...overlay, ...primary.series],
    markers: primary.markers,
    maxTime: Math.max(primary.maxTime, comparison.maxTime),
    maxY: Math.max(primary.maxY, comparison.maxY)
  };
}

function fadeColor(color: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(color) ? `${color}${OVERLAY_ALPHA}` : color;
}
