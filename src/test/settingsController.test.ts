import type { SettingsBundle } from '../domain/settingsModel';
import { demoSettingsBundle } from '../domain/settingsModel';
import {
  createSettingsController,
  type SettingsControllerGateway
} from '../controllers/settingsController';

await run('settings controller scans devices through the gateway and handles local mode', async () => {
  const gateway = fakeGateway();
  const controller = createSettingsController(gateway);

  equal((await controller.scanDevices(true)).status, 'Scanning unavailable in demo mode');

  const result = await controller.scanDevices(false);
  equal(result.status, 'Found 2 devices');
  equal(result.devices?.[0]?.id, 'scale-1');
});

await run('settings controller loads a full settings bundle with fallback status', async () => {
  const gateway = fakeGateway();
  const controller = createSettingsController(gateway);

  const demo = await controller.loadSettingsBundle(true);
  equal(demo.source, 'demo');
  equal(demo.status, null);

  const remote = await controller.loadSettingsBundle(false);
  equal(remote.source, 'gateway');
  equal(remote.bundle.devices.length, 2);

  gateway.failSettings = true;
  const fallback = await controller.loadSettingsBundle(false);
  equal(fallback.source, 'demo');
  equal(fallback.status, 'Settings unavailable — showing defaults');
});

await run('settings controller reports preferred scale connection status', async () => {
  const gateway = fakeGateway();
  const controller = createSettingsController(gateway);

  const connected = await controller.connectPreferredDevices({ local: false, preferredScaleId: 'scale-1' });
  equal(connected.status, 'Preferred scale connected');

  const missing = await controller.connectPreferredDevices({ local: false, preferredScaleId: 'scale-missing' });
  equal(missing.status, 'Preferred scale not found');
});

await run('settings controller handles demo and gateway account operations', async () => {
  const gateway = fakeGateway();
  const controller = createSettingsController(gateway);

  const demo = await controller.loadDecentAccount({ local: true, currentEmail: 'local@example.com' });
  equal(demo.source, 'demo');
  equal(demo.account?.loggedIn, false);

  const login = await controller.loginDecentAccount({
    local: false,
    email: 'person@example.com',
    password: 'secret'
  });
  equal(login.source, 'gateway');
  equal(login.account.loggedIn, true);
  equal(login.message.text, 'Decent account linked.');

  const logout = await controller.logoutDecentAccount({ local: false });
  equal(logout.account.loggedIn, false);
  equal(gateway.calls.logout, 1);
});

await run('settings controller persists setting groups to the right gateway endpoint', async () => {
  const gateway = fakeGateway();
  const controller = createSettingsController(gateway);

  await controller.persistSetting('rea', 'blockOnNoScale', true);
  await controller.persistSetting('de1', 'fan', 2);
  await controller.persistSetting('advanced', 'heaterVoltage', 230);
  await controller.persistSetting('calibration', 'flowMultiplier', 1.2);
  await controller.persistSetting('presence', 'sleepTimeoutMinutes', 20);

  equal(gateway.calls.settings, 1);
  equal(gateway.calls.machineSettings, 1);
  equal(gateway.calls.advancedSettings, 1);
  equal(gateway.calls.calibration, 1);
  equal(gateway.calls.presence, 1);
});

await run('settings controller resets machine settings locally or through the gateway', async () => {
  const gateway = fakeGateway();
  const controller = createSettingsController(gateway);
  const bundle = demoSettingsBundle();

  const local = await controller.resetMachineSettings({ local: true, bundle });
  equal(local.status, 'Machine settings reset (demo)');
  equal(local.bundlePatch.calibration.flowMultiplier, demoSettingsBundle().calibration.flowMultiplier);

  const remote = await controller.resetMachineSettings({ local: false, bundle });
  equal(remote.status, 'Machine settings reset');
  equal(gateway.calls.resetMachine, 1);
});

await run('settings controller loads, saves, and verifies plugin settings', async () => {
  const gateway = fakeGateway();
  const controller = createSettingsController(gateway);

  const loaded = await controller.loadPluginSettings({ local: false, id: 'visualizer' });
  equal(loaded.values.Username, 'person@example.com');

  const saved = await controller.savePluginSettings({
    local: false,
    id: 'visualizer',
    payload: { Username: 'person@example.com' }
  });
  equal(saved.ok, true);
  equal(gateway.calls.pluginSave, 1);

  const verified = await controller.verifyPluginSettings({
    local: false,
    id: 'visualizer',
    settings: loaded
  });
  equal(verified.tone, 'good');
  equal(verified.message, 'Credentials verified');

  const demoVerify = await controller.verifyPluginSettings({
    local: true,
    id: 'visualizer',
    settings: { values: { Username: '' }, secretsSet: {} }
  });
  equal(demoVerify.tone, 'warn');
});

await run('settings controller toggles wake schedules through the gateway only when remote', async () => {
  const gateway = fakeGateway();
  const controller = createSettingsController(gateway);

  await controller.toggleWakeSchedule({ local: true, id: 'wake-1', enabled: false });
  equal(gateway.calls.scheduleToggle, 0);

  await controller.toggleWakeSchedule({ local: false, id: 'wake-1', enabled: false });
  equal(gateway.calls.scheduleToggle, 1);
});

function fakeGateway(): SettingsControllerGateway & { calls: Record<string, number>; failSettings: boolean } {
  const devices: SettingsBundle['devices'] = [
    { id: 'scale-1', name: 'Scale', type: 'scale', state: 'connected' },
    { id: 'machine-1', name: 'DE1', type: 'machine', state: 'connected' }
  ];
  const calls: Record<string, number> = {
    settings: 0,
    machineSettings: 0,
    advancedSettings: 0,
    calibration: 0,
    presence: 0,
    resetMachine: 0,
    logout: 0,
    pluginSave: 0,
    pluginVerify: 0,
    scheduleToggle: 0
  };
  return {
    calls,
    failSettings: false,
    settings: async function (this: { failSettings: boolean }) {
      if (this.failSettings) throw new Error('settings unavailable');
      return demoSettingsBundle().rea;
    },
    scanDevices: async () => devices,
    presenceSettings: async () => demoSettingsBundle().presence,
    displayState: async () => demoSettingsBundle().display,
    skins: async () => demoSettingsBundle().skins,
    plugins: async () => demoSettingsBundle().plugins,
    connectPreferredDevices: async () => devices,
    connectDevice: async () => {},
    disconnectDevice: async () => {},
    devices: async () => devices,
    requestState: async () => {},
    addWakeSchedule: async () => {},
    updateWakeSchedule: async () => {
      calls.scheduleToggle += 1;
    },
    deleteWakeSchedule: async () => {},
    wakeSchedules: async () => [{ id: 'wake-1', time: '07:30', daysOfWeek: [], enabled: true, keepAwakeFor: null }],
    decentAccount: async () => ({ loggedIn: false, email: null }),
    loginDecentAccount: async (email) => ({ loggedIn: true, email }),
    logoutDecentAccount: async () => {
      calls.logout += 1;
    },
    pluginSettings: async () => ({
      values: { Username: 'person@example.com', Password: 'secret' },
      secretsSet: { Password: true }
    }),
    updatePluginSettings: async () => {
      calls.pluginSave += 1;
    },
    verifyPlugin: async () => {
      calls.pluginVerify += 1;
      return { ok: true, message: 'Credentials verified' };
    },
    updateSettings: async () => {
      calls.settings += 1;
    },
    updateMachineSettings: async () => {
      calls.machineSettings += 1;
    },
    updateMachineAdvancedSettings: async () => {
      calls.advancedSettings += 1;
    },
    updateCalibration: async () => {
      calls.calibration += 1;
    },
    updatePresenceSettings: async () => {
      calls.presence += 1;
    },
    resetMachineSettings: async () => {
      calls.resetMachine += 1;
    },
    machineSettings: async () => demoSettingsBundle().de1,
    machineAdvancedSettings: async () => demoSettingsBundle().advanced,
    calibration: async () => demoSettingsBundle().calibration
  };
}

async function run(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
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
