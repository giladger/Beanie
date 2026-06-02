import type { Profile, ShotMeasurement, ShotRecord } from '../api/types';

export type ShotGraphSeriesKey =
  | 'pressure'
  | 'flow'
  | 'targetPressure'
  | 'targetFlow'
  | 'groupTemperature'
  | 'targetTemperature'
  | 'weight'
  | 'weightFlow';

export interface ShotGraphSample {
  t: number;
  value: number;
  rawValue: number;
}

export interface ShotGraphSeries {
  key: ShotGraphSeriesKey;
  label: string;
  shortLabel: string;
  className: string;
  color: string;
  dashArray?: string;
  samples: ShotGraphSample[];
}

export interface ShotGraphStepMarker {
  t: number;
  label: string;
  index: number;
}

export interface ShotGraphModel {
  series: ShotGraphSeries[];
  missingSeries: ShotGraphSeries[];
  markers: ShotGraphStepMarker[];
  maxTime: number;
  maxY: number;
  hasData: boolean;
}

interface ShotGraphSeriesDefinition {
  key: ShotGraphSeriesKey;
  label: string;
  shortLabel: string;
  className: string;
  color: string;
  dashArray?: string;
  value: (measurement: ShotMeasurement) => number | null;
  timestamp: (measurement: ShotMeasurement) => number | null;
  scale?: (value: number) => number;
}

interface ProfileStepInfo {
  label: string;
  duration: number | null;
}

const ESPRESSO_SUBSTATES = new Set(['preinfusion', 'pouring']);

const SERIES_DEFINITIONS: ShotGraphSeriesDefinition[] = [
  {
    key: 'pressure',
    label: 'Pressure',
    shortLabel: 'Pressure',
    className: 'trace-pressure',
    color: '#50c17b',
    value: (measurement) => machineNumber(measurement, 'pressure'),
    timestamp: machineTimestamp
  },
  {
    key: 'flow',
    label: 'Flow',
    shortLabel: 'Flow',
    className: 'trace-flow',
    color: '#7ca8ff',
    value: (measurement) => machineNumber(measurement, 'flow'),
    timestamp: machineTimestamp
  },
  {
    key: 'targetPressure',
    label: 'Target pressure',
    shortLabel: 'Target P',
    className: 'trace-target-pressure',
    color: '#7fcf9f',
    dashArray: '6 5',
    value: (measurement) => machineNumber(measurement, 'targetPressure'),
    timestamp: machineTimestamp
  },
  {
    key: 'targetFlow',
    label: 'Target flow',
    shortLabel: 'Target F',
    className: 'trace-target-flow',
    color: '#a9c6ff',
    dashArray: '6 5',
    value: (measurement) => machineNumber(measurement, 'targetFlow'),
    timestamp: machineTimestamp
  },
  {
    key: 'groupTemperature',
    label: 'Group temp /10',
    shortLabel: 'Temp',
    className: 'trace-temp',
    color: '#ff5a67',
    value: (measurement) =>
      machineNumber(measurement, 'groupTemperature') ?? machineNumber(measurement, 'mixTemperature'),
    timestamp: machineTimestamp,
    scale: (value) => value / 10
  },
  {
    key: 'targetTemperature',
    label: 'Target temp /10',
    shortLabel: 'Target temp',
    className: 'trace-target-temp',
    color: '#ff97a0',
    dashArray: '6 5',
    value: (measurement) =>
      machineNumber(measurement, 'targetGroupTemperature') ??
      machineNumber(measurement, 'targetMixTemperature'),
    timestamp: machineTimestamp,
    scale: (value) => value / 10
  },
  {
    key: 'weight',
    label: 'Weight /5',
    shortLabel: 'Weight',
    className: 'trace-weight',
    color: '#ffc260',
    value: (measurement) => scaleNumber(measurement, 'weight'),
    timestamp: scaleTimestamp,
    scale: (value) => value / 5
  },
  {
    key: 'weightFlow',
    label: 'Weight flow',
    shortLabel: 'Weight flow',
    className: 'trace-weight-flow',
    color: '#5bd8c8',
    value: (measurement) => scaleNumber(measurement, 'weightFlow'),
    timestamp: scaleTimestamp
  }
];

export function buildShotGraphModel(shot: ShotRecord | null): ShotGraphModel {
  const measurements = graphMeasurements(shot?.measurements ?? []);
  const firstTime = firstTimestamp(measurements);
  const maxSampleTime = maxTimeFromMeasurements(measurements, firstTime);

  const series = SERIES_DEFINITIONS.map((definition) => {
    const samples = measurements.flatMap((measurement, index) => {
      const rawValue = definition.value(measurement);
      if (rawValue == null) return [];
      const timestamp = definition.timestamp(measurement);
      const t = elapsedTime(timestamp, firstTime, index);
      const value = definition.scale ? definition.scale(rawValue) : rawValue;
      return [{ t, value, rawValue }];
    });
    return seriesFromDefinition(definition, samples);
  });

  const presentSeries = series.filter((item) => item.samples.length > 0);
  const missingSeries = series.filter((item) => item.samples.length === 0);
  const markers = stepMarkers(measurements, shot?.workflow?.profile ?? null, firstTime, maxSampleTime);
  const maxTime = Math.max(1, maxSampleTime, ...markers.map((marker) => marker.t));
  const maxSeriesValue = Math.max(
    10,
    ...presentSeries.flatMap((item) => item.samples.map((sample) => sample.value))
  );

  return {
    series: presentSeries,
    missingSeries,
    markers,
    maxTime,
    maxY: Math.max(10, Math.ceil(maxSeriesValue / 2) * 2),
    hasData: presentSeries.length > 0
  };
}

function graphMeasurements(measurements: ShotMeasurement[]): ShotMeasurement[] {
  const espressoMeasurements = measurements.filter((measurement) => {
    const substate = machineSubstate(measurement);
    return substate != null && ESPRESSO_SUBSTATES.has(substate);
  });
  return espressoMeasurements.length > 0 ? espressoMeasurements : measurements;
}

function seriesFromDefinition(
  definition: ShotGraphSeriesDefinition,
  samples: ShotGraphSample[]
): ShotGraphSeries {
  return {
    key: definition.key,
    label: definition.label,
    shortLabel: definition.shortLabel,
    className: definition.className,
    color: definition.color,
    dashArray: definition.dashArray,
    samples
  };
}

function stepMarkers(
  measurements: ShotMeasurement[],
  profile: Profile | null,
  firstTime: number | null,
  maxSampleTime: number
): ShotGraphStepMarker[] {
  const steps = profileSteps(profile);
  if (steps.length === 0) return [];

  const frameMarkers = profileFrameMarkers(measurements, steps, firstTime);
  if (frameMarkers.length > 0) return frameMarkers;

  return durationMarkers(steps, maxSampleTime);
}

function profileFrameMarkers(
  measurements: ShotMeasurement[],
  steps: ProfileStepInfo[],
  firstTime: number | null
): ShotGraphStepMarker[] {
  const markers: ShotGraphStepMarker[] = [];
  let previousFrame: number | null = null;

  measurements.forEach((measurement, index) => {
    const frame = integerNumber(machineNumber(measurement, 'profileFrame'));
    if (frame == null || frame < 0 || frame >= steps.length || frame === previousFrame) return;

    markers.push({
      t: elapsedTime(machineTimestamp(measurement), firstTime, index),
      label: steps[frame]!.label,
      index: frame
    });
    previousFrame = frame;
  });

  return markers;
}

function durationMarkers(steps: ProfileStepInfo[], maxSampleTime: number): ShotGraphStepMarker[] {
  if (!steps.some((step) => step.duration != null && step.duration > 0)) return [];

  const markers: ShotGraphStepMarker[] = [];
  let t = 0;
  steps.forEach((step, index) => {
    if (t <= maxSampleTime + 0.5) {
      markers.push({ t, label: step.label, index });
    }
    t += step.duration ?? 0;
  });
  return markers;
}

function profileSteps(profile: Profile | null): ProfileStepInfo[] {
  if (!Array.isArray(profile?.steps)) return [];
  return profile.steps.map((step, index) => {
    const record = objectRecord(step);
    const label = stringValue(record?.name) ?? stringValue(record?.title) ?? `Step ${index + 1}`;
    const duration =
      numeric(record?.seconds) ?? numeric(record?.duration) ?? numeric(record?.time) ?? null;
    return { label, duration };
  });
}

function firstTimestamp(measurements: ShotMeasurement[]): number | null {
  for (const measurement of measurements) {
    const timestamp = timestampFor(measurement.machine.timestamp) ?? scaleTimestamp(measurement);
    if (timestamp != null) return timestamp;
  }
  return null;
}

function maxTimeFromMeasurements(measurements: ShotMeasurement[], firstTime: number | null): number {
  return Math.max(
    0,
    ...measurements.flatMap((measurement, index) => {
      const timestamps = [machineTimestamp(measurement), scaleTimestamp(measurement)].filter(
        (timestamp): timestamp is number => timestamp != null
      );
      if (timestamps.length === 0) return [index * 0.5];
      return timestamps.map((timestamp) => elapsedTime(timestamp, firstTime, index));
    })
  );
}

function elapsedTime(timestamp: number | null, firstTime: number | null, index: number): number {
  if (firstTime != null && timestamp != null) {
    return Math.max(0, (timestamp - firstTime) / 1000);
  }
  return index * 0.5;
}

function machineTimestamp(measurement: ShotMeasurement): number | null {
  return timestampFor(measurement.machine.timestamp);
}

function scaleTimestamp(measurement: ShotMeasurement): number | null {
  return timestampFor(measurement.scale?.timestamp);
}

function timestampFor(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function machineNumber(measurement: ShotMeasurement, key: string): number | null {
  return numeric(objectRecord(measurement.machine)?.[key]);
}

function scaleNumber(measurement: ShotMeasurement, key: string): number | null {
  return numeric(objectRecord(measurement.scale)?.[key]);
}

function machineSubstate(measurement: ShotMeasurement): string | null {
  const machine = objectRecord(measurement.machine);
  const state = objectRecord(machine?.state);
  return stringValue(state?.substate);
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function numeric(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function integerNumber(value: number | null): number | null {
  return value == null || !Number.isInteger(value) ? null : value;
}
