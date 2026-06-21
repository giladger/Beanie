import type { HotWaterData, MachineSnapshot, RinseData, SteamSettings, Workflow } from '../api/types';
import {
  captureMachineServiceWorkflowRestore,
  extendedMachineServiceWorkflow,
  hotWaterBackstopDuration,
  hotWaterDataForGateway,
  machineActionPreflight,
  machineActionStatus,
  optimisticMachineSnapshot,
  prepareTimedSteamHeadroom,
  restoreMachineServiceWorkflowAfterEnd,
  restoredMachineServiceWorkflow,
  sendMachineActionCommand,
  timedSteamHeadroomPlan
} from '../controllers/machineExecutionController';

run('machine execution preflight blocks espresso on no-scale before water checks', () => {
  const result = machineActionPreflight({
    state: 'espresso',
    skipScaleCheck: false,
    noScaleBlocked: true,
    waterAlertHard: true
  });

  equal(result.type, 'blocked-no-scale');
});

run('machine execution preflight blocks espresso on hard water alert', () => {
  const result = machineActionPreflight({
    state: 'espresso',
    skipScaleCheck: true,
    noScaleBlocked: true,
    waterAlertHard: true
  });

  equal(result.type, 'blocked-water');
});

run('machine execution preflight is ready for hot water', () => {
  const result = machineActionPreflight({
    state: 'hotWater',
    skipScaleCheck: false,
    noScaleBlocked: false,
    waterAlertHard: false
  });

  equal(result.type, 'ready');
  equal(result.type === 'ready' ? result.service : null, 'hotWater');
  equal(result.type === 'ready' ? result.status : null, 'Starting water');
});

run('hot water backstop duration projects the pour time with headroom', () => {
  // 120 g at 6 ml/s ≈ 20 s + 30 s headroom = 50 s.
  equal(hotWaterBackstopDuration(water({ volume: 120, flow: 6 })), 50);
  // No usable target → no backstop (DE1's stored duration governs).
  equal(hotWaterBackstopDuration(water({ volume: 0, flow: 6 })), null);
});

run('hot water gateway data keeps the real volume and pads the time backstop in weight mode', () => {
  // reaprime stops at weight (volume as grams); the DE1 time stop only needs to
  // sit far enough back to not pre-empt it, so the volume is left untouched.
  const padded = hotWaterDataForGateway(water({ volume: 120, flow: 6, duration: 20 }), 'volume');
  equal(padded.volume, 120);
  equal(padded.duration, 50);

  const longer = hotWaterDataForGateway(water({ volume: 120, flow: 6, duration: 70 }), 'volume');
  equal(longer.volume, 120);
  equal(longer.duration, 70);
});

run('hot water gateway data disables the volume stop in time mode', () => {
  // volume 0 turns off the DE1 volume target so the pour stops on duration, and
  // keeps reaprime's stop-at-weight inert (it skips targets <= 0).
  const timed = hotWaterDataForGateway(water({ volume: 120, flow: 6, duration: 25 }), 'time');
  equal(timed.volume, 0);
  equal(timed.duration, 25);
});

run('machine action statuses preserve user-facing labels', () => {
  equal(machineActionStatus('espresso', 'sending'), 'Starting shot');
  equal(machineActionStatus('hotWater', 'sent'), 'water started');
  equal(machineActionStatus('idle', 'demo'), 'Demo stopped');
});

run('optimistic machine snapshot preserves current readings while switching state', () => {
  const snapshot = optimisticMachineSnapshot(machine(), 'steam');
  equal(snapshot.state.state, 'steam');
  equal(snapshot.flow, 1.2);
  equal(snapshot.steamTemperature, 135);
});

run('timed steam headroom plan pads one-tap steam and captures restore values', () => {
  const plan = timedSteamHeadroomPlan({
    workflow: workflow(),
    twoTapStop: false,
    steamSettings: steam({ duration: 12 }),
    hotWaterData: water({ duration: 30 }),
    rinseData: rinse({ duration: 8 })
  });

  equal(plan.type, 'pad');
  equal(plan.type === 'pad' ? plan.paddedDuration : null, 15);
  equal(plan.type === 'pad' ? plan.workflow.steamSettings?.duration : null, 15);
  equal(plan.type === 'pad' ? plan.restore.steamSettings.duration : null, 12);
});

run('timed steam headroom plan skips two-tap steam and already-padded durations', () => {
  equal(timedSteamHeadroomPlan({
    workflow: workflow(),
    twoTapStop: true,
    steamSettings: steam({ duration: 12 }),
    hotWaterData: water(),
    rinseData: rinse()
  }).type, 'none');

  equal(timedSteamHeadroomPlan({
    workflow: workflow(),
    twoTapStop: false,
    steamSettings: steam({ duration: 180 }),
    hotWaterData: water(),
    rinseData: rinse()
  }).type, 'none');
});

run('extended machine service workflow pads steam unless two-tap stop is enabled', () => {
  const padded = extendedMachineServiceWorkflow({
    workflow: workflow(),
    service: 'steam',
    steamSettings: steam({ duration: 10 }),
    hotWaterData: water(),
    rinseData: rinse(),
    nextTargetSeconds: 20,
    twoTapSteamStop: false
  });
  equal(padded.steamSettings?.duration, 23);

  const twoTap = extendedMachineServiceWorkflow({
    workflow: workflow(),
    service: 'steam',
    steamSettings: steam({ duration: 10 }),
    hotWaterData: water(),
    rinseData: rinse(),
    nextTargetSeconds: 20,
    twoTapSteamStop: true
  });
  equal(twoTap.steamSettings?.duration, 20);
});

run('extended machine service workflow applies hot water and flush target durations', () => {
  const hotWater = extendedMachineServiceWorkflow({
    workflow: workflow(),
    service: 'hotWater',
    steamSettings: steam(),
    hotWaterData: water({ duration: 30 }),
    rinseData: rinse({ duration: 8 }),
    nextTargetSeconds: 44,
    twoTapSteamStop: false
  });
  equal(hotWater.hotWaterData?.duration, 44);

  const flush = extendedMachineServiceWorkflow({
    workflow: workflow(),
    service: 'flush',
    steamSettings: steam(),
    hotWaterData: water({ duration: 30 }),
    rinseData: rinse({ duration: 8 }),
    nextTargetSeconds: 11,
    twoTapSteamStop: false
  });
  equal(flush.rinseData?.duration, 11);
});

run('machine service workflow restore replaces service settings without dropping workflow context', () => {
  const restore = captureMachineServiceWorkflowRestore({
    steamSettings: steam({ duration: 9 }),
    hotWaterData: water({ duration: 10 }),
    rinseData: rinse({ duration: 11 })
  });
  const restored = restoredMachineServiceWorkflow(workflow(), restore);
  equal(restored.context?.coffeeName, 'Test');
  equal(restored.steamSettings?.duration, 9);
  equal(restored.hotWaterData?.duration, 10);
  equal(restored.rinseData?.duration, 11);
});

await runAsync('prepare timed steam headroom updates workflow and returns restore on success', async () => {
  let saved: Workflow | null = null;
  const result = await prepareTimedSteamHeadroom({
    workflow: workflow(),
    twoTapStop: false,
    steamSettings: steam({ duration: 12 }),
    hotWaterData: water(),
    rinseData: rinse()
  }, {
    updateWorkflow: async (next) => {
      saved = next;
      return next;
    }
  });

  equal(result.type, 'prepared');
  const savedWorkflow = requireSavedWorkflow(saved);
  equal(savedWorkflow.steamSettings?.duration, 15);
  equal(result.type === 'prepared' ? result.restore.steamSettings.duration : null, 12);
});

await runAsync('prepare timed steam headroom reports update failures without a restore', async () => {
  const result = await prepareTimedSteamHeadroom({
    workflow: workflow(),
    twoTapStop: false,
    steamSettings: steam({ duration: 12 }),
    hotWaterData: water(),
    rinseData: rinse()
  }, {
    updateWorkflow: async () => {
      throw new Error('nope');
    }
  });

  equal(result.type, 'failed');
});

await runAsync('restore machine service workflow after end skips demo and reports failures', async () => {
  const restore = captureMachineServiceWorkflowRestore({
    steamSettings: steam({ duration: 9 }),
    hotWaterData: water({ duration: 10 }),
    rinseData: rinse({ duration: 11 })
  });

  const skipped = await restoreMachineServiceWorkflowAfterEnd({
    restore,
    workflow: workflow(),
    demo: true
  }, {
    updateWorkflow: async () => {
      throw new Error('unexpected update');
    }
  });
  equal(skipped.type, 'skipped');

  const failed = await restoreMachineServiceWorkflowAfterEnd({
    restore,
    workflow: workflow(),
    demo: false
  }, {
    updateWorkflow: async () => {
      throw new Error('restore failed');
    }
  });
  equal(failed.type, 'failed');
  equal(failed.type === 'failed' ? failed.status : null, 'Machine service restore failed');
});

await runAsync('restore machine service workflow after end updates restored service settings', async () => {
  const restore = captureMachineServiceWorkflowRestore({
    steamSettings: steam({ duration: 9 }),
    hotWaterData: water({ duration: 10 }),
    rinseData: rinse({ duration: 11 })
  });
  let saved: Workflow | null = null;
  const result = await restoreMachineServiceWorkflowAfterEnd({
    restore,
    workflow: workflow(),
    demo: false
  }, {
    updateWorkflow: async (next) => {
      saved = next;
      return next;
    }
  });

  equal(result.type, 'restored');
  const savedWorkflow = requireSavedWorkflow(saved);
  equal(savedWorkflow.steamSettings?.duration, 9);
  equal(savedWorkflow.hotWaterData?.duration, 10);
  equal(savedWorkflow.rinseData?.duration, 11);
});

await runAsync('send machine action command requests state for hot water without taring', async () => {
  // reaprime now owns the scale tare + stop-at-weight, so beanie just asks the
  // gateway to enter hotWater.
  const calls: string[] = [];
  const result = await sendMachineActionCommand({
    state: 'hotWater',
    workflow: workflow(),
    steamSettings: steam(),
    hotWaterData: water(),
    rinseData: rinse(),
    twoTapSteamStop: false
  }, {
    updateWorkflow: async (next) => next,
    requestState: async (state) => {
      calls.push(`state:${state}`);
    },
    isNoScaleShotBlockError: () => false
  });

  equal(result.type, 'sent');
  equal(calls.join(','), 'state:hotWater');
});

await runAsync('send machine action command prepares steam headroom and preserves restore on request failure', async () => {
  const result = await sendMachineActionCommand({
    state: 'steam',
    workflow: workflow(),
    steamSettings: steam({ duration: 12 }),
    hotWaterData: water(),
    rinseData: rinse(),
    twoTapSteamStop: false
  }, {
    updateWorkflow: async (next) => next,
    requestState: async () => {
      throw new Error('request failed');
    },
    isNoScaleShotBlockError: () => false
  });

  equal(result.type, 'failed');
  equal(result.type === 'failed' ? result.restore?.steamSettings.duration : null, 12);
  equal(result.type === 'failed' ? result.status : null, 'Machine command failed');
});

await runAsync('send machine action command maps espresso no-scale gateway blocks', async () => {
  const result = await sendMachineActionCommand({
    state: 'espresso',
    workflow: workflow(),
    steamSettings: steam(),
    hotWaterData: water(),
    rinseData: rinse(),
    twoTapSteamStop: false
  }, {
    updateWorkflow: async (next) => next,
    requestState: async () => {
      throw new Error('block_no_scale');
    },
    isNoScaleShotBlockError: () => true
  });

  equal(result.type, 'failed');
  equal(result.type === 'failed' ? result.noScaleBlocked : null, true);
});

function water(overrides: Partial<HotWaterData> = {}): HotWaterData {
  return {
    targetTemperature: 85,
    duration: 30,
    volume: 100,
    flow: 5,
    ...overrides
  };
}

function steam(overrides: Partial<SteamSettings> = {}): SteamSettings {
  return {
    targetTemperature: 130,
    duration: 10,
    flow: 1.5,
    stopAtTemperature: 60,
    ...overrides
  };
}

function rinse(overrides: Partial<RinseData> = {}): RinseData {
  return {
    targetTemperature: 90,
    duration: 6,
    flow: 5,
    ...overrides
  };
}

function workflow(): Workflow {
  return {
    profile: { title: 'Profile', steps: [] },
    context: { coffeeName: 'Test' },
    steamSettings: steam(),
    hotWaterData: water(),
    rinseData: rinse()
  };
}

function requireSavedWorkflow(value: Workflow | null): Workflow {
  if (value == null) throw new Error('Expected workflow to be saved');
  return value;
}

function machine(): MachineSnapshot {
  return {
    timestamp: '2026-01-01T00:00:00.000Z',
    state: { state: 'idle' },
    flow: 1.2,
    pressure: 2.3,
    targetFlow: 3.4,
    targetPressure: 4.5,
    mixTemperature: 90,
    groupTemperature: 91,
    targetMixTemperature: 92,
    targetGroupTemperature: 93,
    profileFrame: 7,
    steamTemperature: 135
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

function runAsync(name: string, fn: () => Promise<void>): Promise<void> {
  return fn()
    .then(() => {
      console.log(`ok - ${name}`);
    })
    .catch((error) => {
      console.error(`not ok - ${name}`);
      throw error;
    });
}

function equal<T>(actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(`Expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`);
  }
}
