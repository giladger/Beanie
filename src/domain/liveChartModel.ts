import type { MachineSnapshot, ScaleSnapshot } from '../api/types';

// Shared contract between the live-shot data layer and the canvas renderer.
// Mirrors ShotGraphModel but uses a canvas-friendly point list instead of SVG
// samples, and reads live machine / scale snapshots instead of stored
// ShotMeasurement records.

export type ShotGraphSeriesKey =
  | 'pressure'
  | 'flow'
  | 'targetPressure'
  | 'targetFlow'
  | 'groupTemperature'
  | 'targetTemperature'
  | 'weightFlow';

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
  /** Stroke width override; defaults to the renderer's solid/dashed widths. */
  width?: number;
  /** Set false to draw the series without a legend entry (e.g. overlays). */
  legend?: boolean;
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
    color: '#50c17b',
    value: (machine) => numeric(machine?.pressure)
  },
  {
    key: 'flow',
    label: 'Flow',
    shortLabel: 'Flow',
    color: '#7ca8ff',
    value: (machine) => numeric(machine?.flow)
  },
  {
    key: 'targetPressure',
    label: 'Target pressure',
    shortLabel: 'Target pressure',
    color: '#7fcf9f',
    dashArray: '6 5',
    value: (machine) => numeric(machine?.targetPressure)
  },
  {
    key: 'targetFlow',
    label: 'Target flow',
    shortLabel: 'Target flow',
    color: '#a9c6ff',
    dashArray: '6 5',
    value: (machine) => numeric(machine?.targetFlow)
  },
  {
    key: 'groupTemperature',
    label: 'Temp / 10',
    shortLabel: 'Temp / 10',
    color: '#ff5a67',
    value: (machine) => numeric(machine?.groupTemperature) ?? numeric(machine?.mixTemperature),
    scale: (value) => value / 10
  },
  {
    key: 'targetTemperature',
    label: 'Target temp /10',
    shortLabel: 'Target temp',
    color: '#ff97a0',
    dashArray: '6 5',
    value: (machine) =>
      numeric(machine?.targetGroupTemperature) ?? numeric(machine?.targetMixTemperature),
    scale: (value) => value / 10
  },
  {
    key: 'weightFlow',
    label: 'Weight flow',
    shortLabel: 'Weight flow',
    color: '#8a6d1c',
    value: (_machine, scale) => numeric(scale?.weightFlow)
  }
];

function numeric(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
