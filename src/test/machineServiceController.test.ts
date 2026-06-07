import { MachineServiceController } from '../controllers/machineServiceController';

run('machine service controller tracks progress and clears stop requests when service ends', () => {
  const controller = new MachineServiceController();

  const starting = controller.track('steam', 'preparingForShot', 1_000);
  equal(starting.next.service, 'steam');
  equal(controller.service, 'steam');
  equal(controller.phase, 'starting');

  controller.markStopRequested('steam', 1_500);
  equal(controller.stopRequestedFor, 'steam');

  controller.track('idle', undefined, 2_000);
  equal(controller.service, null);
  equal(controller.stopRequestedFor, null);
});

run('machine service controller clears timed steam request on a fresh steam service', () => {
  const controller = new MachineServiceController();

  controller.track('steam', 'pouring', 1_000);
  controller.markTimedSteamStopRequested(2_000);
  equal(controller.timedSteamStopRequestedAtMs, 2_000);

  controller.track('flush', 'pouring', 3_000);
  controller.track('steam', 'preparingForShot', 4_000);
  equal(controller.timedSteamStopRequestedAtMs, null);
});

run('machine service controller computes timed steam delay from internal progress', () => {
  const controller = new MachineServiceController();

  controller.track('steam', 'pouring', 1_000);
  equal(controller.timedSteamStopDelay({
    disabled: false,
    twoTapStop: false,
    targetSeconds: 10,
    nowMs: 4_000
  }), 7_000);

  controller.markTimedSteamStopRequested(4_000);
  equal(controller.timedSteamStopDelay({
    disabled: false,
    twoTapStop: false,
    targetSeconds: 10,
    nowMs: 5_000
  }), null);
});

run('machine service controller extends target from override, target, or elapsed time', () => {
  const controller = new MachineServiceController();

  controller.track('flush', 'pouring', 10_000);
  equal(controller.extendTarget(5, 12_000, 20), 25);
  equal(controller.targetOverrideSeconds, 25);
  equal(controller.extendTarget(5, 13_000, 20), 30);

  const elapsedOnly = new MachineServiceController();
  elapsedOnly.track('hotWater', 'pouring', 10_000);
  equal(elapsedOnly.extendTarget(5, 12_100, null), 8);
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
    throw new Error(`Expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`);
  }
}
