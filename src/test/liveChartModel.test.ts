import type { LiveChartModel, LiveChartSeries } from '../domain/liveChartModel';
import { overlayComparisonModel } from '../components/liveChartModel';

run('overlay keeps measured comparison curves faded, thin, and out of the legend', () => {
  const primary = model([series('pressure', '#50c17b'), series('targetPressure', '#7fcf9f', '6 5')], 30, 12);
  const comparison = model(
    [series('pressure', '#50c17b'), series('targetPressure', '#7fcf9f', '6 5'), series('weightFlow', '#8a6d1c')],
    25,
    12
  );

  const overlaid = overlayComparisonModel(primary, comparison);

  equal(overlaid.series.length, 4);
  const overlayPressure = overlaid.series[0]!;
  equal(overlayPressure.key, 'pressure');
  equal(overlayPressure.color, '#50c17b5a');
  equal(overlayPressure.width, 1.4);
  equal(overlayPressure.legend, false);
  // The comparison's dashed target series is not overlaid.
  equal(overlaid.series.filter((item) => item.key === 'targetPressure').length, 1);
  // Primary series stay on top (later in draw order) and unmodified.
  equal(overlaid.series[2]!.color, '#50c17b');
  equal(overlaid.series[2]!.legend, undefined);
});

run('overlay stretches the shared axes to the longer shot', () => {
  const primary = model([series('pressure', '#50c17b')], 24, 12);
  const comparison = model([series('pressure', '#50c17b')], 41, 14);

  const overlaid = overlayComparisonModel(primary, comparison);

  equal(overlaid.maxTime, 41);
  equal(overlaid.maxY, 14);
  // Markers come from the primary shot only.
  equal(overlaid.markers.length, 1);
  equal(overlaid.markers[0]!.label, 'primary-marker');
});

function model(seriesList: LiveChartSeries[], maxTime: number, maxY: number): LiveChartModel {
  return {
    series: seriesList,
    markers: [{ t: 0, label: 'primary-marker' }],
    maxTime,
    maxY
  };
}

function series(key: LiveChartSeries['key'], color: string, dashArray?: string): LiveChartSeries {
  return {
    key,
    label: key,
    shortLabel: key,
    color,
    dashArray,
    points: [
      { t: 0, value: 1 },
      { t: 1, value: 2 }
    ]
  };
}

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
