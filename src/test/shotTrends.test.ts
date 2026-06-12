import type { ShotRecord } from '../api/types';
import { buildShotTrends, shotDurationSeconds } from '../domain/shotTrends';

run('shot trends sample metrics oldest-first across espresso shots only', () => {
  const shots = [
    shot('newest', { dose: 18, yieldOut: 40, enjoyment: 90 }),
    shot('flush', { dose: 18, yieldOut: 36, beverageType: 'flush' }),
    shot('oldest', { dose: 17, yieldOut: 34, enjoyment: 60 })
  ];

  const rows = buildShotTrends(shots);
  const dose = rows.find((row) => row.key === 'dose');
  if (!dose) throw new Error('Expected a dose row');
  equal(dose.points.length, 2);
  equal(dose.points[0]!.shotId, 'oldest');
  equal(dose.points[1]!.shotId, 'newest');
  equal(dose.min, 17);
  equal(dose.max, 18);
  equal(dose.latest, 18);

  const score = rows.find((row) => row.key === 'enjoyment');
  if (!score) throw new Error('Expected an enjoyment row');
  equal(score.points[0]!.value, 60);
  equal(score.latest, 90);
});

run('shot trends compute ratio from dose and yield and prefer actuals', () => {
  const shots = [
    shot('b', { dose: 18, yieldOut: 45, actualDose: 18.2, actualYield: 36.4 }),
    shot('a', { dose: 18, yieldOut: 36 })
  ];

  const ratio = buildShotTrends(shots).find((row) => row.key === 'ratio');
  if (!ratio) throw new Error('Expected a ratio row');
  equal(ratio.points[0]!.value, 2);
  equal(ratio.latest, 2);
});

run('shot trends drop rows with fewer than two measured points', () => {
  const shots = [
    shot('b', { dose: 18, yieldOut: 36, ey: 20.5 }),
    shot('a', { dose: 18, yieldOut: 36 })
  ];

  const rows = buildShotTrends(shots);
  equal(rows.some((row) => row.key === 'ey'), false);
  equal(rows.some((row) => row.key === 'enjoyment'), false);
  equal(rows.some((row) => row.key === 'dose'), true);
});

run('shot trends include duration from the pour window', () => {
  const shots = [shot('b', { dose: 18, yieldOut: 36 }), shot('a', { dose: 18, yieldOut: 36 })];
  const duration = buildShotTrends(shots).find((row) => row.key === 'duration');
  if (!duration) throw new Error('Expected a duration row');
  equal(duration.latest, 28);
});

run('shotDurationSeconds returns null without two parsable timestamps', () => {
  equal(shotDurationSeconds({ ...shot('a', {}), measurements: [] }), null);
  equal(shotDurationSeconds(shot('a', {})), 28);
});

interface ShotSpec {
  dose?: number;
  yieldOut?: number;
  actualDose?: number;
  actualYield?: number;
  ey?: number;
  enjoyment?: number;
  beverageType?: string;
}

function shot(id: string, spec: ShotSpec): ShotRecord {
  return {
    id,
    timestamp: '2026-06-05T10:00:00.000Z',
    workflow: {
      profile: { title: `Profile ${id}`, beverage_type: spec.beverageType ?? 'espresso' },
      context: {
        targetDoseWeight: spec.dose ?? null,
        targetYield: spec.yieldOut ?? null,
        finalBeverageType: spec.beverageType ?? 'espresso'
      }
    },
    annotations: {
      actualDoseWeight: spec.actualDose ?? null,
      actualYield: spec.actualYield ?? null,
      drinkEy: spec.ey ?? null,
      enjoyment: spec.enjoyment ?? null
    },
    measurements: [
      {
        machine: {
          timestamp: '2026-06-05T10:00:00.000Z',
          state: { substate: 'preinfusion' }
        } as ShotRecord['measurements'][number]['machine']
      },
      {
        machine: {
          timestamp: '2026-06-05T10:00:28.000Z',
          state: { substate: 'pouring' }
        } as ShotRecord['measurements'][number]['machine']
      }
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
