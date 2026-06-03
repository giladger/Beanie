import {
  de1MachineSettingsPatchBody,
  readReaSettings,
  readSkins
} from '../api/settings';

run('readReaSettings coerces wire values and fills defaults', () => {
  const s = readReaSettings({
    gatewayMode: 'tracking',
    weightFlowMultiplier: '1.4', // stringy number
    blockOnNoScale: 'true', // stringy bool
    nightModeSleepTime: 1320,
    themeMode: 'dark',
    simulatedDevices: ['machine', 5, 'scale'] // filters non-strings
  });
  equal(s.gatewayMode, 'tracking');
  equal(s.weightFlowMultiplier, 1.4);
  equal(s.blockOnNoScale, true);
  equal(s.themeMode, 'dark');
  equal(s.volumeFlowMultiplier, 0.3); // default
  equal(s.automaticUpdateCheck, true); // default
  equal(s.simulatedDevices.length, 2);
});

run('readReaSettings rejects bad enums back to a safe default', () => {
  const s = readReaSettings({ gatewayMode: 'bogus', scalePowerMode: 'nope', themeMode: 42 });
  equal(s.gatewayMode, 'disabled');
  equal(s.scalePowerMode, 'disconnect');
  equal(s.themeMode, 'system');
});

run('de1MachineSettingsPatchBody converts usb boolean to enable/disable', () => {
  equal((de1MachineSettingsPatchBody({ usb: true }).usb as string), 'enable');
  equal((de1MachineSettingsPatchBody({ usb: false }).usb as string), 'disable');
  equal('usb' in de1MachineSettingsPatchBody({ fan: 40 }), false);
  equal(de1MachineSettingsPatchBody({ fan: 40 }).fan as number, 40);
});

run('readSkins normalizes id/name from a few shapes', () => {
  const skins = readSkins([{ id: 'beanie', name: 'Beanie' }, { name: 'streamline.js' }, { id: '' }]);
  equal(skins.length, 2);
  equal(skins[0]!.id, 'beanie');
  equal(skins[1]!.id, 'streamline.js');
  equal(skins[1]!.name, 'streamline.js');
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
  if (actual !== expected) throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
}
