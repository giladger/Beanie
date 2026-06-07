import type { HotWaterData, MachineSnapshot, RinseData, SteamSettings, Workflow } from '../api/types';
import {
  HOT_WATER_WEIGHT_NATIVE_VOLUME_ML,
  captureMachineServiceWorkflowRestore,
  createHotWaterWeightStopController,
  extendedMachineServiceWorkflow,
  hotWaterDataForNativeWorkflow,
  hotWaterWeightNativeDuration,
  hotWaterWeightStopTarget,
  machineActionPreflight,
  machineActionStatus,
  optimisticMachineSnapshot,
  prepareTimedSteamHeadroom,
  restoreMachineServiceWorkflowAfterEnd,
  restoredMachineServiceWorkflow,
  sendMachineActionCommand,
  stopHotWaterAtWeight,
  tareAndArmHotWaterWeightStop,
  timedSteamHeadroomPlan
} from '../controllers/machineExecutionController';

run('machine execution preflight blocks espresso on no-scale before water checks', () => {
  const result = machineActionPreflight({
    state: 'espresso',
    skipScaleCheck: false,
    noScaleBlocked: true,
    waterAlertHard: true,
    hotWaterStopMode: 'volume',
    scaleConnected: true,
    hotWaterData: water()
  });

  equal(result.type, 'blocked-no-scale');
});

run('machine execution preflight blocks espresso on hard water alert', () => {
  const result = machineActionPreflight({
    state: 'espresso',
    skipScaleCheck: true,
    noScaleBlocked: true,
    waterAlertHard: true,
    hotWaterStopMode: 'volume',
    scaleConnected: true,
    hotWaterData: water()
  });

  equal(result.type, 'blocked-water');
});

run('machine execution preflight arms hot water weight stop when scale volume mode is available', () => {
  const result = machineActionPreflight({
    state: 'hotWater',
    skipScaleCheck: false,
    noScaleBlocked: false,
    waterAlertHard: false,
    hotWaterStopMode: 'volume',
    scaleConnected: true,
    hotWaterData: water({ volume: 120, flow: 6 })
  });

  equal(result.type, 'ready');
  equal(result.type === 'ready' ? result.service : null, 'hotWater');
  equal(result.type === 'ready' ? result.status : null, 'Starting water');
  equal(result.type === 'ready' ? result.hotWaterWeightStop?.targetWeight : null, 120);
  equal(result.type === 'ready' ? result.hotWaterWeightStop?.configuredFlow : null, 6);
});

run('hot water target is not armed outside scale-backed volume mode', () => {
  equal(hotWaterWeightStopTarget(water({ volume: 100 }), 'time', true), null);
  equal(hotWaterWeightStopTarget(water({ volume: 100 }), 'volume', false), null);
  equal(hotWaterWeightStopTarget(water({ volume: 0 }), 'volume', true), null);
});

run('hot water native workflow pads duration for weight stop mode', () => {
  equal(hotWaterWeightNativeDuration(water({ volume: 120, flow: 6 })), 50);

  const native = hotWaterDataForNativeWorkflow(water({ volume: 120, flow: 6, duration: 20 }), 'volume', true);
  equal(native.volume, HOT_WATER_WEIGHT_NATIVE_VOLUME_ML);
  equal(native.duration, 50);
});

run('hot water native workflow preserves larger existing duration and non-weight modes', () => {
  const long = hotWaterDataForNativeWorkflow(water({ volume: 120, flow: 6, duration: 70 }), 'volume', true);
  equal(long.volume, HOT_WATER_WEIGHT_NATIVE_VOLUME_ML);
  equal(long.duration, 70);

  const timed = water({ volume: 120, flow: 6, duration: 20 });
  equal(hotWaterDataForNativeWorkflow(timed, 'time', true), timed);
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

await runAsync('tare and arm hot water weight stop returns an armed controller after tare', async () => {
  const result = await tareAndArmHotWaterWeightStop({
    target: { targetWeight: 120, configuredFlow: 6 },
    shouldArm: () => true
  }, {
    tareScale: async () => {},
    nowMs: () => 1_000
  });

  equal(result.type, 'armed');
  equal(result.type === 'armed' ? result.controller.targetWeight : null, 120);
  equal(result.type === 'armed' ? result.controller.tareRequestedAtMs : null, 1_000);
  equal(result.type === 'armed' ? result.controller.armedAtMs : null, 1_000);
});

await runAsync('tare and arm hot water weight stop ignores stale services after tare', async () => {
  const result = await tareAndArmHotWaterWeightStop({
    target: { targetWeight: 120, configuredFlow: 6 },
    shouldArm: () => false
  }, {
    tareScale: async () => {},
    nowMs: () => 1_000
  });

  equal(result.type, 'ignored');
});

await runAsync('tare and arm hot water weight stop reports tare failures', async () => {
  const result = await tareAndArmHotWaterWeightStop({
    target: { targetWeight: 120, configuredFlow: 6 },
    shouldArm: () => true
  }, {
    tareScale: async () => {
      throw new Error('tare failed');
    },
    nowMs: () => 1_000
  });

  equal(result.type, 'failed');
  equal(result.type === 'failed' ? result.status : null, 'Hot water scale tare failed');
});

await runAsync('stop hot water at weight requests idle and formats projected status', async () => {
  let requested: string | null = null;
  const result = await stopHotWaterAtWeight({
    demo: false,
    weight: 118.25,
    projectedWeight: 120.75
  }, {
    requestState: async (state) => {
      requested = state;
    }
  });

  equal(result.type, 'requested');
  equal(requested, 'idle');
  equal(result.type === 'requested' ? result.status : null, 'Stopping at 118.3 g (120.8 g projected)');
});

await runAsync('stop hot water at weight handles demo and request failure paths', async () => {
  const demo = await stopHotWaterAtWeight({
    demo: true,
    weight: 1,
    projectedWeight: 1
  }, {
    requestState: async () => {
      throw new Error('unexpected request');
    }
  });
  equal(demo.type, 'demo');
  equal(demo.type === 'demo' ? demo.status : null, 'Demo water stopped');

  const failed = await stopHotWaterAtWeight({
    demo: false,
    weight: 1,
    projectedWeight: 1
  }, {
    requestState: async () => {
      throw new Error('stop failed');
    }
  });
  equal(failed.type, 'failed');
  equal(failed.type === 'failed' ? failed.status : null, 'Hot water stop failed');
});

run('create hot water weight stop controller initializes inactive state', () => {
  const controller = createHotWaterWeightStopController(
    { targetWeight: 120, configuredFlow: 6 },
    10,
    20
  );

  equal(controller.armedAtMs, 20);
  equal(controller.tareRequestedAtMs, 10);
  equal(controller.activeSeen, false);
  equal(controller.stopRequested, false);
});

await runAsync('send machine action command tares hot water before requesting state', async () => {
  const calls: string[] = [];
  const result = await sendMachineActionCommand({
    state: 'hotWater',
    hotWaterWeightStop: { targetWeight: 120, configuredFlow: 6 },
    workflow: workflow(),
    steamSettings: steam(),
    hotWaterData: water(),
    rinseData: rinse(),
    twoTapSteamStop: false
  }, {
    updateWorkflow: async (next) => next,
    tareScale: async () => {
      calls.push('tare');
    },
    requestState: async (state) => {
      calls.push(`state:${state}`);
    },
    nowMs: () => 1_000,
    isNoScaleShotBlockError: () => false
  });

  equal(result.type, 'sent');
  equal(calls.join(','), 'tare,state:hotWater');
  equal(result.type === 'sent' ? result.hotWaterWeightStop?.targetWeight : null, 120);
});

await runAsync('send machine action command prepares steam headroom and preserves restore on request failure', async () => {
  const result = await sendMachineActionCommand({
    state: 'steam',
    hotWaterWeightStop: null,
    workflow: workflow(),
    steamSettings: steam({ duration: 12 }),
    hotWaterData: water(),
    rinseData: rinse(),
    twoTapSteamStop: false
  }, {
    updateWorkflow: async (next) => next,
    tareScale: async () => {},
    requestState: async () => {
      throw new Error('request failed');
    },
    nowMs: () => 1_000,
    isNoScaleShotBlockError: () => false
  });

  equal(result.type, 'failed');
  equal(result.type === 'failed' ? result.restore?.steamSettings.duration : null, 12);
  equal(result.type === 'failed' ? result.status : null, 'Machine command failed');
});

await runAsync('send machine action command maps espresso no-scale gateway blocks', async () => {
  const result = await sendMachineActionCommand({
    state: 'espresso',
    hotWaterWeightStop: null,
    workflow: workflow(),
    steamSettings: steam(),
    hotWaterData: water(),
    rinseData: rinse(),
    twoTapSteamStop: false
  }, {
    updateWorkflow: async (next) => next,
    tareScale: async () => {},
    requestState: async () => {
      throw new Error('block_no_scale');
    },
    nowMs: () => 1_000,
    isNoScaleShotBlockError: () => true
  });

  equal(result.type, 'failed');
  equal(result.type === 'failed' ? result.noScaleBlocked : null, true);
  equal(result.type === 'failed' ? result.clearHotWaterWeightStop : null, false);
});

await runAsync('send machine action command clears hot water controller on request failure', async () => {
  const result = await sendMachineActionCommand({
    state: 'hotWater',
    hotWaterWeightStop: { targetWeight: 120, configuredFlow: 6 },
    workflow: workflow(),
    steamSettings: steam(),
    hotWaterData: water(),
    rinseData: rinse(),
    twoTapSteamStop: false
  }, {
    updateWorkflow: async (next) => next,
    tareScale: async () => {},
    requestState: async () => {
      throw new Error('request failed');
    },
    nowMs: () => 1_000,
    isNoScaleShotBlockError: () => false
  });

  equal(result.type, 'failed');
  equal(result.type === 'failed' ? result.clearHotWaterWeightStop : null, true);
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
