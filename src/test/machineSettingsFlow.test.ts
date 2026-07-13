import type { MachineState } from '../api/types';
import {
  MachineSettingsFlow,
  type MachineSettingsFlowCommands,
  type MachineSettingsFlowHost,
  type MachineSettingsFlowPatch,
  type MachineSettingsFlowSnapshot,
  type SettingsPresentationInvalidation
} from '../controllers/machineSettingsFlow';
import type { SettingsController } from '../controllers/settingsController';
import { SettingsMutationFlow } from '../controllers/settingsMutationFlow';
import { settingsResourceStates } from '../domain/resourceState';
import type { SettingsPreferences } from '../domain/settings';
import { demoSettingsBundle } from '../domain/settingsModel';

await run('machine settings shares bundle loading and fences a demoted result', async () => {
  const loaded = deferred<Awaited<ReturnType<SettingsController['loadSettingsBundle']>>>();
  const harness = createHarness({ loadBundle: () => loaded.promise });

  const first = harness.flow.loadBundle();
  const second = harness.flow.loadBundle();
  equal(first, second);
  harness.authorityRevision += 1;
  harness.connected = false;
  loaded.resolve(gatewayBundleResult());
  await first;

  equal(harness.state.bundle, null);
  equal(harness.groundedCalibrations.length, 0);
});

await run('preferred-device actions load provenance before deciding writability', async () => {
  const resources = settingsResourceStates('gateway');
  resources.devices = { source: 'default', writable: false, message: 'unavailable' };
  let connects = 0;
  const harness = createHarness({
    loadBundle: async () => ({ ...gatewayBundleResult(), source: 'degraded', resources }),
    connectPreferredDevices: async () => {
      connects += 1;
      return { devices: [], status: 'Auto-connect complete' };
    }
  });

  await harness.flow.connectPreferredDevices();

  equal(connects, 0);
  equal(harness.state.status, 'Preferred devices are unavailable — reconnect and reload Settings');
});

await run('an older refill failure cannot roll back newer optimistic intent', async () => {
  const first = deferred<void>();
  const second = deferred<void>();
  const harness = createHarness({ refillWrites: [first.promise, second.promise] });
  harness.state.machineRefillLevel = 10;

  const oldWrite = harness.flow.setMachineRefillLevel(20);
  const latestWrite = harness.flow.setMachineRefillLevel(30);
  await settle();
  await quietFailure(async () => {
    first.reject(new Error('old write failed'));
    await oldWrite;
  });

  equal(harness.state.machineRefillLevel, 30);
  equal(harness.state.status, 'Updating machine refill level…');
  second.resolve(undefined);
  await latestWrite;
  equal(harness.state.machineRefillLevel, 30);
  equal(harness.state.status, 'Machine refill level set');
});

await run('each concurrent refill intent dispatches exactly one physical command', async () => {
  const first = deferred<void>();
  const second = deferred<void>();
  const harness = createHarness();
  const dispatched: number[] = [];
  const completions = [first.promise, second.promise];
  harness.commands.setRefillLevel = async (mm) => {
    dispatched.push(mm);
    await completions[dispatched.length - 1];
  };

  const oldWrite = harness.flow.setMachineRefillLevel(20);
  const latestWrite = harness.flow.setMachineRefillLevel(30);
  await settle();
  equal(JSON.stringify(dispatched), JSON.stringify([20, 30]));

  first.resolve(undefined);
  second.resolve(undefined);
  await Promise.all([oldWrite, latestWrite]);
  equal(dispatched.length, 2);
});

await run('a stale refill success becomes the confirmed rollback for a newer failure', async () => {
  const first = deferred<void>();
  const second = deferred<void>();
  const harness = createHarness({ refillWrites: [first.promise, second.promise] });
  harness.state.machineRefillLevel = 10;

  const oldWrite = harness.flow.setMachineRefillLevel(20);
  const latestWrite = harness.flow.setMachineRefillLevel(30);
  await settle();
  first.resolve(undefined);
  await oldWrite;
  await quietFailure(async () => {
    second.reject(new Error('latest write failed'));
    await latestWrite;
  });

  equal(harness.state.machineRefillLevel, 20);
  equal(harness.state.status, 'Set refill level failed');
});

await run('a late older refill success cannot replace a newer confirmed baseline', async () => {
  const first = deferred<void>();
  const second = deferred<void>();
  const third = deferred<void>();
  const harness = createHarness({ refillWrites: [first.promise, second.promise, third.promise] });
  harness.state.machineRefillLevel = 10;

  const oldWrite = harness.flow.setMachineRefillLevel(20);
  const newerWrite = harness.flow.setMachineRefillLevel(30);
  await settle();
  second.resolve(undefined);
  await newerWrite;
  first.resolve(undefined);
  await oldWrite;
  const latestWrite = harness.flow.setMachineRefillLevel(40);
  await quietFailure(async () => {
    third.reject(new Error('latest write failed'));
    await latestWrite;
  });

  equal(harness.state.machineRefillLevel, 30);
});

await run('refill telemetry advances rollback truth without erasing pending intent', async () => {
  const write = deferred<void>();
  const harness = createHarness({ refillWrites: [write.promise] });
  harness.state.machineRefillLevel = 10;

  const pending = harness.flow.setMachineRefillLevel(20);
  harness.flow.observeRefillLevel(15);
  equal(harness.state.machineRefillLevel, 20);
  await quietFailure(async () => {
    write.reject(new Error('write failed'));
    await pending;
  });

  equal(harness.state.machineRefillLevel, 15);
});

await run('firmware decoding does not dispatch after connected authority is lost', async () => {
  const bytes = deferred<ArrayBuffer>();
  const harness = createHarness();
  let uploads = 0;
  harness.commands.uploadFirmware = async () => {
    uploads += 1;
  };

  const upload = harness.flow.uploadFirmware({
    name: 'machine.bin',
    arrayBuffer: () => bytes.promise
  });
  harness.authorityRevision += 1;
  harness.connected = false;
  bytes.resolve(new ArrayBuffer(4));
  await upload;

  equal(uploads, 0);
  equal(harness.state.busy, false);
});

interface HarnessOverrides {
  readonly loadBundle?: SettingsController['loadSettingsBundle'];
  readonly connectPreferredDevices?: SettingsController['connectPreferredDevices'];
  readonly refillWrites?: readonly Promise<void>[];
}

function createHarness(overrides: HarnessOverrides = {}) {
  const state: MutableSnapshot & { status: string; busy: boolean } = {
    demo: false,
    bundle: null,
    source: null,
    resources: null,
    settingsStoreAvailable: true,
    preferences: preferences(),
    scaleConnected: false,
    machineRefillLevel: null,
    status: 'Ready',
    busy: false
  };
  const harness = {
    state,
    authorityRevision: 0,
    connected: true,
    liveMachine: true,
    groundedCalibrations: [] as number[],
    commands: null as unknown as MutableCommands,
    flow: null as unknown as MachineSettingsFlow
  };
  let refillCall = 0;
  const commands: MutableCommands = {
    tareScale: async () => {},
    uploadFirmware: async () => {},
    setRefillLevel: async () => {
      const write = overrides.refillWrites?.[refillCall++];
      if (write) await write;
    }
  };
  const host: MachineSettingsFlowHost = {
    snapshot: () => state,
    commit: (patch) => applyPatch(state, patch),
    authorityRevision: () => harness.authorityRevision,
    hasConnectedGatewayAuthority: () => harness.connected,
    hasLiveMachineAuthority: () => harness.liveMachine,
    reloadSyncedSettings: async () => {},
    groundGlobalFlowCalibration: (value) => harness.groundedCalibrations.push(value),
    noteUserBrightness: () => {},
    refreshDisplayState: async () => {},
    clearNoScaleBlockWarning: () => {},
    machineSleepRequested: () => {},
    machineWakeRequested: () => {},
    applyPreferencePresentation: (
      _preferences: SettingsPreferences,
      _invalidation: SettingsPresentationInvalidation
    ) => {},
    isPhoneLayout: () => false,
    openSettingsSurface: () => {},
    loadAccount: () => {}
  };
  harness.commands = commands;
  harness.flow = new MachineSettingsFlow(
    controller(overrides),
    mutations(),
    host,
    commands
  );
  return harness;
}

type MutableSnapshot = {
  -readonly [Key in keyof MachineSettingsFlowSnapshot]: MachineSettingsFlowSnapshot[Key]
};

type MutableCommands = {
  -readonly [Key in keyof MachineSettingsFlowCommands]: MachineSettingsFlowCommands[Key]
};

function applyPatch(
  state: MutableSnapshot & { status: string; busy: boolean },
  patch: MachineSettingsFlowPatch
): void {
  if (patch.bundle !== undefined) state.bundle = patch.bundle;
  if (patch.source !== undefined) state.source = patch.source;
  if (patch.resources !== undefined) state.resources = patch.resources;
  if (patch.preferences !== undefined) state.preferences = patch.preferences;
  if (patch.machineRefillLevel !== undefined) state.machineRefillLevel = patch.machineRefillLevel;
  if (patch.status !== undefined) state.status = patch.status;
  if (patch.busy !== undefined) state.busy = patch.busy;
}

function controller(overrides: HarnessOverrides): SettingsController {
  return {
    loadSettingsBundle: overrides.loadBundle ?? (async () => gatewayBundleResult()),
    scanDevices: async () => ({ devices: [], status: 'Found 0 devices' }),
    connectPreferredDevices: overrides.connectPreferredDevices ?? (async () => ({
      devices: [],
      status: 'Auto-connect complete'
    })),
    connectDevice: async () => ({ devices: [], status: 'Connected' }),
    requestMachineState: async ({ state }: { state: MachineState }) => ({
      status: `Machine → ${state}`,
      sleepRequested: state === 'sleeping'
    }),
    addWakeSchedule: async () => ({ schedules: [], status: 'Wake schedule added' }),
    deleteWakeSchedule: async () => ({ ok: true, status: null }),
    toggleWakeSchedule: async () => {},
    loadDecentAccount: async () => ({
      account: null,
      source: 'unavailable',
      email: '',
      message: null
    }),
    loginDecentAccount: async ({ email }) => ({
      account: { loggedIn: true, email },
      source: 'gateway',
      email,
      message: { tone: 'good', text: 'Linked' }
    }),
    logoutDecentAccount: async () => ({
      account: { loggedIn: false, email: null },
      source: 'gateway',
      message: { tone: 'good', text: 'Unlinked' }
    }),
    loadPluginSettings: async () => ({ settings: null, source: 'unavailable' }),
    savePluginSettings: async () => ({ status: 'Saved', ok: true }),
    verifyPluginSettings: async () => ({ tone: 'good', message: 'Verified' }),
    persistSetting: async () => {},
    resetMachineSettings: async ({ bundle }) => ({
      bundlePatch: {
        de1: bundle.de1,
        advanced: bundle.advanced,
        calibration: bundle.calibration
      },
      status: 'Machine settings reset'
    })
  };
}

function mutations(): SettingsMutationFlow {
  return new SettingsMutationFlow({
    persistField: async () => {},
    setDisplayBrightness: async () => demoSettingsBundle().display,
    deleteSchedule: async () => true,
    updateSchedule: async () => {},
    setPluginLoaded: async () => {}
  });
}

function gatewayBundleResult(): Awaited<ReturnType<SettingsController['loadSettingsBundle']>> {
  return {
    bundle: demoSettingsBundle(),
    source: 'gateway',
    resources: settingsResourceStates('gateway'),
    status: null
  };
}

function preferences(): SettingsPreferences {
  return {
    theme: 'dark',
    uiScale: 'standard',
    waterSoftLimitMl: 0,
    wakeAppZoneEnabled: false,
    wakeAppZonePosition: 'top',
    topbarClock: true,
    clockFormat: 'auto',
    screensaverMode: 'black',
    screensaverBrightness: 20
  };
}

async function quietFailure(runFailure: () => Promise<void>): Promise<void> {
  const original = console.error;
  console.error = () => {};
  try {
    await runFailure();
  } finally {
    console.error = original;
  }
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function run(name: string, test: () => void | Promise<void>): Promise<void> {
  try {
    await test();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

function equal<Value>(actual: Value, expected: Value): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  }
}
