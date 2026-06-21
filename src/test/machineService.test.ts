import {
  emptyMachineServiceProgress,
  machineServiceMeta,
  machineServicePrimaryTime,
  machineServiceState,
  machineServiceStats,
  machineServiceTargetSeconds,
  machineServiceTone,
  machineServiceVerb,
  nextMachineServiceProgress
} from '../domain/machineService';
import type { HotWaterData, MachineSnapshot, RinseData, ScaleSnapshot, SteamSettings } from '../api/types';

run('machine service state maps DE1 states to service lanes', () => {
  equal(machineServiceState('steam'), 'steam');
  equal(machineServiceState('steamRinse'), 'steam');
  equal(machineServiceState('flush'), 'flush');
  equal(machineServiceState('hotWater'), 'hotWater');
  equal(machineServiceState('idle'), null);
});

run('machine service progress starts active timing only once pouring begins', () => {
  const starting = nextMachineServiceProgress(emptyMachineServiceProgress(), 'steam', 'preparingForShot', 1_000);

  equal(starting.next.service, 'steam');
  equal(starting.next.phase, 'starting');
  equal(starting.next.startedAtMs, null);
  equal(starting.clearTimedSteamRequest, true);

  const active = nextMachineServiceProgress(starting.next, 'steam', 'pouring', 2_000);
  equal(active.next.phase, 'active');
  equal(active.next.startedAtMs, 2_000);

  const stillActive = nextMachineServiceProgress(active.next, 'steam', 'pouring', 3_000);
  equal(stillActive.next.startedAtMs, 2_000);
});

run('machine service progress moves active services to purging when flow stops', () => {
  const active = {
    service: 'steam' as const,
    phase: 'active' as const,
    startedAtMs: 2_000,
    targetOverrideSeconds: 45
  };

  const purging = nextMachineServiceProgress(active, 'steam', 'idle', 4_000);

  equal(purging.next.phase, 'purging');
  equal(purging.next.targetOverrideSeconds, 45);
});

run('steam rinse is treated as steam purging and clears the timed stop timer', () => {
  const transition = nextMachineServiceProgress(emptyMachineServiceProgress(), 'steamRinse', 'idle', 1_000);

  equal(transition.next.service, 'steam');
  equal(transition.next.phase, 'purging');
  equal(transition.clearTimedSteamTimer, true);
  equal(transition.updateTimedSteamStopTimer, false);
  equal(transition.clearTimedSteamRequest, false);
});

run('leaving hot water clears progress and restores the workflow', () => {
  const transition = nextMachineServiceProgress({
    service: 'hotWater',
    phase: 'active',
    startedAtMs: 1_000,
    targetOverrideSeconds: 30
  }, 'idle', undefined, 2_000);

  equal(transition.next.service, null);
  equal(transition.restoreWorkflowAfterEnd, true);
  equal(transition.clearMachineStopRequest, true);
  equal(transition.clearTimedSteamTimer, true);
});

run('changing service lanes resets timing and target overrides', () => {
  const transition = nextMachineServiceProgress({
    service: 'steam',
    phase: 'active',
    startedAtMs: 1_000,
    targetOverrideSeconds: 80
  }, 'flush', 'preparingForShot', 2_000);

  equal(transition.next.service, 'flush');
  equal(transition.next.phase, 'starting');
  equal(transition.next.startedAtMs, null);
  equal(transition.next.targetOverrideSeconds, null);
});

run('machine service target seconds chooses time, scale, or volume fallbacks', () => {
  equal(machineServiceTargetSeconds(
    'steam',
    { duration: 36, flow: 2, targetTemperature: 120, stopAtTemperature: 65 },
    { duration: 20, flow: 5, volume: 100, targetTemperature: 90 },
    { duration: 8, flow: 4, targetTemperature: 88 },
    'volume',
    false
  ), 36);

  equal(machineServiceTargetSeconds(
    'hotWater',
    { duration: 36, flow: 2, targetTemperature: 120, stopAtTemperature: 65 },
    { duration: 0, flow: 5, volume: 100, targetTemperature: 90 },
    { duration: 8, flow: 4, targetTemperature: 88 },
    'volume',
    false
  ), 20);

  equal(machineServiceTargetSeconds(
    'hotWater',
    { duration: 36, flow: 2, targetTemperature: 120, stopAtTemperature: 65 },
    { duration: 20, flow: 5, volume: 100, targetTemperature: 90 },
    { duration: 8, flow: 4, targetTemperature: 88 },
    'volume',
    true
  ), null);
});

run('machine service presentation helpers describe the active service', () => {
  equal(machineServiceTone('hotWater'), 'water');
  equal(machineServiceTone('flush'), 'flush');
  equal(machineServiceVerb('steam'), 'Steaming');
  equal(machineServiceVerb('hotWater'), 'Pouring hot water');
});

run('machine service primary time reports remaining, over-target, and elapsed states', () => {
  equal(JSON.stringify(machineServicePrimaryTime(12.4, 30)), '{"value":"18s","label":"remaining"}');
  equal(JSON.stringify(machineServicePrimaryTime(35.2, 30)), '{"value":"+5s","label":"over target"}');
  equal(JSON.stringify(machineServicePrimaryTime(12.4, null)), '{"value":"12s","label":"elapsed"}');
});

run('machine service stats expose target seconds or target weight', () => {
  equal(JSON.stringify(machineServiceStats(30)), '[{"label":"Target","value":"30","unit":"s"}]');
  equal(JSON.stringify(machineServiceStats(null, 150)), '[{"label":"Target","value":"150","unit":"g"}]');
  equal(JSON.stringify(machineServiceStats(null)), '[{"label":"Target","value":"--","unit":"s"}]');
});

run('machine service metadata includes mode-aware hot water labels', () => {
  const meta = machineServiceMeta(
    'hotWater',
    steam(),
    water(),
    flush(),
    machine(),
    scale(),
    'volume'
  );

  equal(JSON.stringify(meta), '["5.0 ml/s","120 g target","42.4 g scale","90 C target","87 C water"]');
});

run('machine service metadata includes steam and flush readouts', () => {
  equal(JSON.stringify(machineServiceMeta('steam', steam(), water(), flush(), machine(), scale(), 'time')), '["2.0 ml/s","120 C target","118 C steam"]');
  equal(JSON.stringify(machineServiceMeta('flush', steam(), water(), flush(), machine(), scale(), 'time')), '["4.0 ml/s","88 C target","91 C group"]');
});

function steam(): SteamSettings {
  return { duration: 36, flow: 2, targetTemperature: 120, stopAtTemperature: 65 };
}

function water(): HotWaterData {
  return { duration: 20, flow: 5, volume: 120, targetTemperature: 90 };
}

function flush(): RinseData {
  return { duration: 8, flow: 4, targetTemperature: 88 };
}

function scale(): ScaleSnapshot {
  return { timestamp: '2026-06-01T00:00:00.000Z', status: 'connected', weight: 42.4, weightFlow: 0 };
}

function machine(): MachineSnapshot {
  return {
    timestamp: '2026-06-01T00:00:00.000Z',
    state: { state: 'hotWater' },
    flow: 0,
    pressure: 0,
    targetFlow: 0,
    targetPressure: 0,
    mixTemperature: 87,
    groupTemperature: 91,
    targetMixTemperature: 90,
    targetGroupTemperature: 92,
    profileFrame: 0,
    steamTemperature: 118
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
