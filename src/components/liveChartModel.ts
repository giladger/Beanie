import type { MachineSnapshot, ScaleSnapshot, ShotRecord } from '../api/types';
import type { ShotGraphSeriesKey } from './shotGraphModel';
import { buildShotGraphModel } from './shotGraphModel';

// Shared contract between the live-shot data layer (domain/liveShot.ts) and the
// canvas renderer (components/LiveChart.ts). Mirrors ShotGraphModel but uses a
// canvas-friendly point list instead of SVG samples, and reads live machine /
// scale snapshots instead of stored ShotMeasurement records.

export interface LiveChartPoint {
  t: number;
  value: number;
}

export interface LiveChartSeries {
  key: ShotGraphSeriesKey;
  label: string;
  shortLabel: string;
  color: string;
  dashArray?: string;
  points: LiveChartPoint[];
}

export interface LiveChartMarker {
  t: number;
  label: string;
}

export interface LiveChartModel {
  series: LiveChartSeries[];
  markers: LiveChartMarker[];
  maxTime: number;
  maxY: number;
}

export interface LiveSeriesDefinition {
  key: ShotGraphSeriesKey;
  label: string;
  shortLabel: string;
  color: string;
  dashArray?: string;
  // Pull the raw value for this series from the latest machine / scale frame.
  value: (
    machine: MachineSnapshot | null | undefined,
    scale: ScaleSnapshot | null | undefined
  ) => number | null;
  // Optional display scaling so heterogeneous units share one Y axis.
  scale?: (value: number) => number;
}

// Colors, labels and scaling match shotGraphModel.ts so the live chart and the
// historical SVG chart read identically.
export const LIVE_SERIES: LiveSeriesDefinition[] = [
  {
    key: 'pressure',
    label: 'Pressure',
    shortLabel: 'Pressure',
    color: '#d85f5f',
    value: (machine) => numeric(machine?.pressure)
  },
  {
    key: 'flow',
    label: 'Flow',
    shortLabel: 'Flow',
    color: '#4f8bd9',
    value: (machine) => numeric(machine?.flow)
  },
  {
    key: 'targetPressure',
    label: 'Target pressure',
    shortLabel: 'Target P',
    color: '#efaaa1',
    dashArray: '6 5',
    value: (machine) => numeric(machine?.targetPressure)
  },
  {
    key: 'targetFlow',
    label: 'Target flow',
    shortLabel: 'Target F',
    color: '#9fc0ee',
    dashArray: '6 5',
    value: (machine) => numeric(machine?.targetFlow)
  },
  {
    key: 'groupTemperature',
    label: 'Group temp /10',
    shortLabel: 'Temp',
    color: '#d8a63f',
    value: (machine) => numeric(machine?.groupTemperature) ?? numeric(machine?.mixTemperature),
    scale: (value) => value / 10
  },
  {
    key: 'targetTemperature',
    label: 'Target temp /10',
    shortLabel: 'Target temp',
    color: '#eacb75',
    dashArray: '6 5',
    value: (machine) =>
      numeric(machine?.targetGroupTemperature) ?? numeric(machine?.targetMixTemperature),
    scale: (value) => value / 10
  },
  {
    key: 'weight',
    label: 'Weight /5',
    shortLabel: 'Weight',
    color: '#5fa66f',
    value: (_machine, scale) => numeric(scale?.weight),
    scale: (value) => value / 5
  },
  {
    key: 'weightFlow',
    label: 'Weight flow',
    shortLabel: 'Weight flow',
    color: '#69c7b8',
    value: (_machine, scale) => numeric(scale?.weightFlow)
  }
];

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
    maxY: model.maxY
  };
}

function numeric(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
