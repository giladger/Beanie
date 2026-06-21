import type { HotWaterData, RinseData, SteamSettings, Workflow } from '../api/types';
import {
  applyMachinePresetPlan,
  applyMachineValuePlan,
  buildMachineWorkflowPlan,
  machineSettingsFromWorkflow,
  machineSettingsPatchFromWorkflow,
  persistMachineWorkflowPlan,
  steamPurgeModePlan,
  updateSteamPurgeModeAndReadBack
} from '../controllers/machineSettingsWorkflowController';
import { demoSettingsBundle } from '../domain/settingsModel';
import { waterControlCapabilities } from '../domain/waterSettings';

await run('machine workflow plan builds app workflow gateway workflow and machine patch', () => {
  const plan = buildMachineWorkflowPlan({
    workflow: workflow(),
    steamSettings: steam({ flow: 1.1 }),
    hotWaterData: water({ volume: 120, flow: 6, duration: 20 }),
    rinseData: rinse({ duration: 8, flow: 4 }),
    currentMachineSettings: { usb: true },
    hotWaterStopMode: 'volume',
    status: 'Machine setting saved'
  });

  equal(plan.workflow.hotWaterData?.volume, 120);
  // Weight mode keeps the real volume target (reaprime stops at weight); only the
  // DE1 time stop is padded so it stays a backstop. 120 g at 6 ml/s + 30 s = 50 s.
  equal(plan.workflowForGateway.hotWaterData?.volume, 120);
  equal(plan.workflowForGateway.hotWaterData?.duration, 50);
  equal(plan.machineSettings.usb, true);
  equal(plan.machineSettings.steamFlow, 1.1);
  equal(plan.machinePatch.flushTimeout, 8);
  equal(plan.savingStatus, 'Machine setting saved...');
});

await run('machine settings helpers derive full settings and direct patch', () => {
  const settings = machineSettingsFromWorkflow(steam({ flow: 1.2 }), water({ flow: 7 }), rinse({ duration: 9 }), {
    usb: false,
    steamFlow: 0.5
  });
  equal(settings.usb, false);
  equal(settings.steamFlow, 1.2);
  equal(settings.hotWaterFlow, 7);
  equal(settings.flushTimeout, 9);

  const patch = machineSettingsPatchFromWorkflow(steam({ flow: 1.3 }), water({ flow: 8 }), rinse({ flow: 5 }));
  equal(patch.steamFlow, 1.3);
  equal(patch.hotWaterFlow, 8);
  equal(patch.flushFlow, 5);
});

await run('machine preset planning applies custom preset overrides and clamps values', () => {
  const plan = applyMachinePresetPlan({
    name: 'waterPreset',
    presetId: 'tea',
    machinePresetValues: { 'waterPreset:tea': { flow: 99, volume: 240 } },
    capabilities: caps(),
    steamSettings: steam(),
    hotWaterData: water({ flow: 5, volume: 100 }),
    rinseData: rinse()
  });

  equal(plan.applied, true);
  equal(plan.status, 'Machine preset saved');
  equal(plan.hotWaterData.volume, 240);
  equal(plan.hotWaterData.flow, 12);
});

await run('machine preset planning ignores unknown presets', () => {
  const plan = applyMachinePresetPlan({
    name: 'steamPreset',
    presetId: 'missing',
    machinePresetValues: {},
    capabilities: caps(),
    steamSettings: steam({ flow: 1.4 }),
    hotWaterData: water(),
    rinseData: rinse()
  });

  equal(plan.applied, false);
  equal(plan.steamSettings.flow, 1.4);
});

await run('machine value planning updates fields and stores selected preset overrides', () => {
  const plan = applyMachineValuePlan({
    name: 'steamDuration',
    value: 45,
    machinePresetValues: {},
    capabilities: caps(),
    steamSettings: steam({ duration: 50 }),
    hotWaterData: water(),
    rinseData: rinse()
  });

  equal(plan.applied, true);
  equal(plan.status, 'Machine setting saved');
  equal(plan.steamSettings.duration, 45);
  equal(plan.machinePresetValues?.['steamPreset:medium-jug']?.duration, 45);
});

await run('machine value planning clamps numeric edits and skips custom preset overrides', () => {
  const plan = applyMachineValuePlan({
    name: 'flushDuration',
    value: 999,
    machinePresetValues: {},
    capabilities: caps(),
    steamSettings: steam(),
    hotWaterData: water(),
    rinseData: rinse({ duration: 11 })
  });

  equal(plan.applied, true);
  equal(plan.rinseData.duration, 120);
  equal(plan.machinePresetValues, null);
});

await run('machine value planning ignores unknown fields', () => {
  const plan = applyMachineValuePlan({
    name: 'surpriseField',
    value: 4,
    machinePresetValues: {},
    capabilities: caps(),
    steamSettings: steam({ flow: 1.1 }),
    hotWaterData: water(),
    rinseData: rinse()
  });

  equal(plan.applied, false);
  equal(plan.steamSettings.flow, 1.1);
  equal(plan.machinePresetValues, null);
});

await run('steam purge planning normalizes mode and updates settings bundle optimistically', () => {
  const demoBundle = demoSettingsBundle();
  const bundle = { ...demoBundle, de1: { ...demoBundle.de1, usb: true, steamPurgeMode: 0 } };
  const plan = steamPurgeModePlan(7, { steamFlow: 0.7 }, bundle);

  equal(plan.nextMode, 0);
  equal(plan.machineSettings.steamFlow, 0.7);
  equal(plan.machineSettings.steamPurgeMode, 0);
  equal(plan.settingsBundle?.de1.steamPurgeMode, 0);
  equal(plan.savingStatus, 'Steam purge setting...');
});

await run('steam purge readback verifies gateway state', async () => {
  const calls: string[] = [];
  const settings = await updateSteamPurgeModeAndReadBack(1, {
    updateMachineSettings: async (patch) => {
      calls.push(`update:${patch.steamPurgeMode}`);
    },
    readMachineSettings: async () => ({ steamPurgeMode: 1, steamFlow: 0.8 })
  });

  equal(settings.steamPurgeMode, 1);
  equal(calls.join(','), 'update:1');
});

await run('steam purge readback reports mismatched gateway state', async () => {
  let failed = false;
  try {
    await updateSteamPurgeModeAndReadBack(1, {
      updateMachineSettings: async () => {},
      readMachineSettings: async () => ({ steamPurgeMode: 0 })
    });
  } catch {
    failed = true;
  }

  equal(failed, true);
});

await run('machine workflow plan disables the volume stop for time-based hot water', () => {
  const plan = buildMachineWorkflowPlan({
    workflow: workflow(),
    steamSettings: steam(),
    hotWaterData: water({ volume: 140, duration: 22 }),
    rinseData: rinse(),
    currentMachineSettings: null,
    hotWaterStopMode: 'time',
    status: 'Water stop mode saved'
  });

  // Time mode zeroes the gateway volume (DE1 stops on duration; reaprime stays
  // inert) while the local workflow keeps the real target for the UI.
  equal(plan.workflow.hotWaterData?.volume, 140);
  equal(plan.workflowForGateway.hotWaterData?.volume, 0);
  equal(plan.workflowForGateway.hotWaterData?.duration, 22);
  equal(plan.successStatus, 'Water stop mode saved');
});

await run('machine workflow persistence handles demo without gateway calls', async () => {
  let wroteTarget: number | null | undefined = null;
  const result = await persistMachineWorkflowPlan(plan(), true, {
    writeHotWaterWeightTarget: (value) => {
      wroteTarget = value;
    },
    updateWorkflow: async () => {
      throw new Error('unexpected workflow');
    },
    updateMachineSettings: async () => {
      throw new Error('unexpected machine settings');
    },
    logDirectMachineUpdateFailure: () => {}
  });

  equal(result.type, 'demo');
  equal(result.type === 'demo' ? result.status : null, 'Machine setting saved (demo)');
  equal(wroteTarget, 100);
});

await run('machine workflow persistence saves workflow and direct machine settings', async () => {
  const calls: string[] = [];
  const result = await persistMachineWorkflowPlan(plan(), false, {
    writeHotWaterWeightTarget: (value) => {
      calls.push(`target:${value}`);
    },
    updateWorkflow: async (next) => {
      calls.push(`workflow:${next.hotWaterData?.volume}`);
      return { ...next, context: { coffeeName: 'Saved' } };
    },
    updateMachineSettings: async (patch) => {
      calls.push(`machine:${patch.hotWaterFlow}`);
      return {};
    },
    logDirectMachineUpdateFailure: () => {}
  });

  equal(result.type, 'saved');
  equal(result.type === 'saved' ? result.status : null, 'Machine setting saved');
  equal(result.type === 'saved' ? result.workflow.context?.coffeeName : null, 'Saved');
  equal(result.type === 'saved' ? result.workflow.hotWaterData?.volume : null, 100);
  equal(calls.join(','), 'workflow:100,target:100,machine:5');
});

await run('machine workflow persistence reports direct machine update fallback', async () => {
  let logged = false;
  const result = await persistMachineWorkflowPlan(plan(), false, {
    writeHotWaterWeightTarget: () => {},
    updateWorkflow: async (next) => next,
    updateMachineSettings: async () => {
      throw new Error('direct failed');
    },
    logDirectMachineUpdateFailure: () => {
      logged = true;
    }
  });

  equal(result.type, 'saved');
  equal(result.type === 'saved' ? result.directMachineSaved : null, false);
  equal(result.type === 'saved' ? result.status : null, 'Machine setting saved; direct machine update failed');
  equal(logged, true);
});

await run('machine workflow persistence reports workflow failure without writing the weight target', async () => {
  let wroteTarget = false;
  const result = await persistMachineWorkflowPlan(plan(), false, {
    writeHotWaterWeightTarget: () => {
      wroteTarget = true;
    },
    updateWorkflow: async () => {
      throw new Error('workflow failed');
    },
    updateMachineSettings: async () => ({}),
    logDirectMachineUpdateFailure: () => {}
  });

  equal(result.type, 'failed');
  equal(result.type === 'failed' ? result.status : null, 'Machine settings save failed');
  equal(wroteTarget, false);
});

await run('machine workflow persistence skips the weight target preference in time stop mode', async () => {
  let wroteTarget = false;
  const deps = {
    writeHotWaterWeightTarget: () => {
      wroteTarget = true;
    },
    updateWorkflow: async (next: Workflow) => next,
    updateMachineSettings: async () => ({}),
    logDirectMachineUpdateFailure: () => {}
  };

  const demoResult = await persistMachineWorkflowPlan(plan('time'), true, deps);
  equal(demoResult.type, 'demo');
  equal(wroteTarget, false);

  const savedResult = await persistMachineWorkflowPlan(plan('time'), false, deps);
  equal(savedResult.type, 'saved');
  equal(wroteTarget, false);
});

function plan(hotWaterStopMode: 'volume' | 'time' = 'volume') {
  return buildMachineWorkflowPlan({
    workflow: workflow(),
    steamSettings: steam(),
    hotWaterData: water(),
    rinseData: rinse(),
    currentMachineSettings: null,
    hotWaterStopMode,
    status: 'Machine setting saved'
  });
}

function workflow(): Workflow {
  return {
    profile: { title: 'Profile', steps: [] },
    context: { coffeeName: 'Old' }
  };
}

function steam(overrides: Partial<SteamSettings> = {}): SteamSettings {
  return { targetTemperature: 150, duration: 50, flow: 0.8, stopAtTemperature: 0, ...overrides };
}

function water(overrides: Partial<HotWaterData> = {}): HotWaterData {
  return { targetTemperature: 75, duration: 30, volume: 100, flow: 5, ...overrides };
}

function rinse(overrides: Partial<RinseData> = {}): RinseData {
  return { targetTemperature: 90, duration: 10, flow: 6, ...overrides };
}

function caps() {
  return waterControlCapabilities({ demo: true });
}

function run(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
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
