import type { ShotRecord } from '../api/types';
import { renderShotGraph } from '../components/ShotGraph';
import { buildShotGraphModel, type ShotGraphSeriesKey } from '../components/shotGraphModel';

run('builds all supported shot graph series when rich measurement data exists', () => {
  const model = buildShotGraphModel(richShot());

  arrayEqual(
    model.series.map((series) => series.key),
    [
      'pressure',
      'flow',
      'targetPressure',
      'targetFlow',
      'groupTemperature',
      'targetTemperature',
      'weightFlow'
    ]
  );
  equal(seriesValue(model, 'targetTemperature', 1), 9.3);
  equal(seriesValue(model, 'weightFlow', 1), 1.2);
  equal(model.missingSeries.length, 0);
});

run('marks optional shot graph series as missing without dropping present traces', () => {
  const shot = {
    id: 'sparse-shot',
    timestamp: '2026-06-01T10:00:00Z',
    measurements: [
      {
        machine: {
          timestamp: '2026-06-01T10:00:00.000Z',
          pressure: 0,
          flow: 0
        }
      },
      {
        machine: {
          timestamp: '2026-06-01T10:00:01.000Z',
          pressure: 3,
          flow: 1.2
        }
      }
    ]
  } as ShotRecord;
  const model = buildShotGraphModel(shot);

  arrayEqual(
    model.series.map((series) => series.key),
    ['pressure', 'flow']
  );
  equal(hasMissing(model, 'targetPressure'), true);
  equal(hasMissing(model, 'weightFlow'), true);
  equal(model.hasData, true);
});

run('adds profile step markers from historical profile frames', () => {
  const model = buildShotGraphModel(richShot());

  arrayEqual(
    model.markers.map((marker) => marker.label),
    ['Preinfusion', 'Ramp', 'Hold']
  );
  arrayEqual(
    model.markers.map((marker) => marker.t),
    [0, 1, 2]
  );
});

run('renders dashed target traces and profile markers in the SVG chart', () => {
  const svg = renderShotGraph(richShot(), { detailed: true });

  includes(svg, 'trace-target-pressure');
  includes(svg, 'stroke-dasharray="6 5"');
  includes(svg, 'chart-step-marker');
});

run('renders abrupt target jumps as horizontal runs plus vertical connectors', () => {
  const svg = renderShotGraph(targetJumpShot(), { detailed: true });

  includes(svg, 'points="42.0,250.0 127.6,250.0" stroke="#7fcf9f" stroke-dasharray="6 5"');
  includes(
    svg,
    'x1="128.5" y1="250.0" x2="128.5" y2="94.0" stroke="#7fcf9f" stroke-linecap="butt"'
  );
  notIncludes(svg, 'points="42.0,250.0 127.6,94.0"');
  notIncludes(svg, 'stroke-width="5"');
});

function richShot(): ShotRecord {
  return {
    id: 'rich-shot',
    timestamp: '2026-06-01T10:00:00Z',
    workflow: {
      profile: {
        title: 'Test profile',
        steps: [{ name: 'Preinfusion' }, { name: 'Ramp' }, { name: 'Hold' }]
      }
    },
    measurements: [
      richMeasurement('2026-06-01T10:00:00.000Z', 0, 0, 0, 0, 0),
      richMeasurement('2026-06-01T10:00:01.000Z', 1, 5, 2, 20, 1),
      richMeasurement('2026-06-01T10:00:02.000Z', 2, 8, 1.5, 32, 2)
    ]
  } as unknown as ShotRecord;
}

function targetJumpShot(): ShotRecord {
  return {
    id: 'target-jump-shot',
    timestamp: '2026-06-01T10:00:00Z',
    measurements: [
      targetJumpMeasurement('2026-06-01T10:00:00.000Z', 2),
      targetJumpMeasurement('2026-06-01T10:00:00.100Z', 8)
    ]
  } as unknown as ShotRecord;
}

function richMeasurement(
  timestamp: string,
  frame: number,
  pressure: number,
  flow: number,
  weight: number,
  second: number
): unknown {
  return {
    machine: {
      timestamp,
      state: { substate: second === 0 ? 'preinfusion' : 'pouring' },
      pressure,
      flow,
      targetPressure: second === 0 ? 2 : 8,
      targetFlow: second === 0 ? 1.5 : 2.3,
      groupTemperature: 92 + second,
      targetGroupTemperature: 93,
      profileFrame: frame
    },
    scale: {
      timestamp,
      weight,
      weightFlow: second === 0 ? 0 : 1.2
    }
  };
}

function targetJumpMeasurement(timestamp: string, targetPressure: number): unknown {
  return {
    machine: {
      timestamp,
      state: { substate: 'pouring' },
      pressure: 0,
      flow: 0,
      targetPressure
    }
  };
}

function seriesValue(
  model: ReturnType<typeof buildShotGraphModel>,
  key: ShotGraphSeriesKey,
  index: number
): number {
  const series = model.series.find((item) => item.key === key);
  if (!series) throw new Error(`Missing series ${key}`);
  return series.samples[index]?.value ?? Number.NaN;
}

function hasMissing(model: ReturnType<typeof buildShotGraphModel>, key: ShotGraphSeriesKey): boolean {
  return model.missingSeries.some((series) => series.key === key);
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

function arrayEqual<T>(actual: T[], expected: T[]): void {
  equal(actual.length, expected.length);
  for (let index = 0; index < expected.length; index += 1) {
    equal(actual[index], expected[index]);
  }
}

function includes(value: string, expected: string): void {
  if (!value.includes(expected)) {
    throw new Error(`Expected output to include ${expected}`);
  }
}

function notIncludes(value: string, expected: string): void {
  if (value.includes(expected)) {
    throw new Error(`Expected output not to include ${expected}`);
  }
}
