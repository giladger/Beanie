import type { ShotRecord, ShotSummary } from '../api/types';
import { mergeShotSummaryIntoRecord } from '../domain/shotRecord';

interface TestCase {
  name: string;
  fn: () => void | Promise<void>;
}

const tests: TestCase[] = [];

run('keeps cached measurements while applying fresh summary metadata', () => {
  const cached: ShotRecord = {
    id: 'shot-1',
    timestamp: '2026-06-05T10:00:00.000Z',
    workflow: {
      context: {
        grinderSetting: '1.0',
        targetYield: 40
      }
    },
    annotations: {
      actualDoseWeight: 18,
      actualYield: 207.8,
      enjoyment: 20
    },
    shotNotes: 'old note',
    metadata: { local: true },
    measurements: [
      {
        machine: { timestamp: '2026-06-05T10:00:01.000Z', pressure: 9 },
        scale: { weight: 207.8 }
      }
    ]
  };
  const summary: ShotSummary = {
    id: 'shot-1',
    timestamp: '2026-06-05T10:00:00.000Z',
    workflow: {
      context: {
        grinderSetting: '10',
        targetYield: 11
      }
    },
    annotations: {
      actualDoseWeight: 180,
      actualYield: 110,
      enjoyment: 100
    },
    shotNotes: 'fresh note',
    metadata: { visualizer: true }
  };

  const merged = mergeShotSummaryIntoRecord(cached, summary);

  equal(merged.annotations?.actualDoseWeight, 180);
  equal(merged.annotations?.actualYield, 110);
  equal(merged.annotations?.enjoyment, 100);
  equal(merged.workflow?.context?.grinderSetting, '10');
  equal(merged.workflow?.context?.targetYield, 11);
  equal(merged.shotNotes, 'fresh note');
  equal(merged.metadata?.visualizer, true);
  equal(merged.measurements, cached.measurements);
});

for (const test of tests) {
  try {
    await test.fn();
    console.log(`ok - ${test.name}`);
  } catch (error) {
    console.error(`not ok - ${test.name}`);
    throw error;
  }
}

function run(name: string, fn: () => void | Promise<void>): void {
  tests.push({ name, fn });
}

function equal<T>(actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  }
}
