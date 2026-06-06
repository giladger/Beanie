import { waterAlertLevel, waterLevelMl } from '../domain/waterAlert';

// Tank readings are in mm; the de1app calibration table maps e.g.
// 4mm→97ml, 40mm→1104ml, 50mm→1453ml (see waterTank.test.ts).

run('needsWater always forces a hard alert, even with a full tank', () => {
  equal(
    waterAlertLevel({ levelMm: 50, machineState: 'needsWater', softLimitMl: 0, hardLimitMl: 0 }),
    'hard'
  );
});

run('an unknown tank level reports no alert', () => {
  equal(
    waterAlertLevel({ levelMm: null, machineState: 'idle', softLimitMl: 400, hardLimitMl: 100 }),
    'none'
  );
});

run('a level at/below the soft (but above hard) threshold is soft', () => {
  // 40mm → ~1104ml: <= 1200 soft, > 100 hard.
  equal(
    waterAlertLevel({ levelMm: 40, machineState: 'idle', softLimitMl: 1200, hardLimitMl: 100 }),
    'soft'
  );
});

run('a level at/below the hard threshold is hard', () => {
  // 40mm → ~1104ml: <= 1150 hard.
  equal(
    waterAlertLevel({ levelMm: 40, machineState: 'idle', softLimitMl: 1200, hardLimitMl: 1150 }),
    'hard'
  );
  // 4mm → ~97ml: <= 100 hard.
  equal(
    waterAlertLevel({ levelMm: 4, machineState: 'idle', softLimitMl: 400, hardLimitMl: 100 }),
    'hard'
  );
});

run('a level above both thresholds is none', () => {
  // 50mm → ~1453ml.
  equal(
    waterAlertLevel({ levelMm: 50, machineState: 'idle', softLimitMl: 400, hardLimitMl: 100 }),
    'none'
  );
});

run('zero thresholds disable the app-side bands (machine only)', () => {
  equal(
    waterAlertLevel({ levelMm: 4, machineState: 'idle', softLimitMl: 0, hardLimitMl: 0 }),
    'none'
  );
});

run('waterLevelMl converts mm to ml and passes through null', () => {
  equal(waterLevelMl(null), null);
  equal(waterLevelMl(50), 1453);
});

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
