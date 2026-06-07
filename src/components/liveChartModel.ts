import type { ShotRecord } from '../api/types';
import type { LiveChartModel, LiveChartSeries } from '../domain/liveChartModel';
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
