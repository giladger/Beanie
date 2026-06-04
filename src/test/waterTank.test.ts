import { waterTankMlFromMm } from '../domain/waterTank';

run('waterTankMlFromMm matches the de1app calibration table', () => {
  equal(waterTankMlFromMm(0), 0);
  equal(waterTankMlFromMm(4), 97);
  equal(waterTankMlFromMm(40), 1104);
  equal(waterTankMlFromMm(50), 1453); // the mock's 50mm reading
  equal(waterTankMlFromMm(67), 2058);
});

run('waterTankMlFromMm truncates fractional millimetres', () => {
  equal(waterTankMlFromMm(50.0), 1453);
  equal(waterTankMlFromMm(50.9), 1453); // floor to index 50
});

run('waterTankMlFromMm clamps out-of-range readings to the table max', () => {
  equal(waterTankMlFromMm(100), 2058);
  equal(waterTankMlFromMm(-5), 2058); // de1app's lindex-returns-empty quirk
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
