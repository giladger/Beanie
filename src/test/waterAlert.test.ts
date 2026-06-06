import { waterAlertLevel, waterLevelMl } from '../domain/waterAlert';

// Tank readings are in mm; the de1app calibration table maps e.g.
// 4mm→97ml, 40mm→1104ml, 50mm→1453ml (see waterTank.test.ts).

run('needsWater (the machine block) is always hard, even with a full tank', () => {
  equal(waterAlertLevel({ levelMm: 50, machineState: 'needsWater', softLimitMl: 0 }), 'hard');
});

run('hard is driven only by the machine, never by the water level', () => {
  // 4mm → ~97ml, very low, but the machine has not flagged a refill → not hard.
  equal(waterAlertLevel({ levelMm: 4, machineState: 'idle', softLimitMl: 400 }), 'soft');
});

run('an unknown tank level reports no alert', () => {
  equal(waterAlertLevel({ levelMm: null, machineState: 'idle', softLimitMl: 400 }), 'none');
});

run('a level at/below the soft threshold is soft', () => {
  // 40mm → ~1104ml: <= 1200.
  equal(waterAlertLevel({ levelMm: 40, machineState: 'idle', softLimitMl: 1200 }), 'soft');
});

run('a level above the soft threshold is none', () => {
  // 50mm → ~1453ml.
  equal(waterAlertLevel({ levelMm: 50, machineState: 'idle', softLimitMl: 400 }), 'none');
});

run('soft threshold 0 disables the warning', () => {
  equal(waterAlertLevel({ levelMm: 4, machineState: 'idle', softLimitMl: 0 }), 'none');
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
