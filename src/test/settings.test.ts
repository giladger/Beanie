import {
  STEAM_PURGE_MODES,
  de1MachineSettingsPatchBody,
  readDisplayState,
  readReaSettings,
  readSkins
} from '../api/settings';
import { SETTINGS_SPEC, coerceFieldValue } from '../domain/settingsModel';

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

run('readDisplayState clamps brightness and fills support defaults', () => {
  const display = readDisplayState({
    wakeLockEnabled: 'true',
    brightness: '27.6',
    requestedBrightness: 205,
    lowBatteryBrightnessActive: 1,
    platformSupported: { brightness: false }
  });
  equal(display.wakeLockEnabled, true);
  equal(display.brightness, 28);
  equal(display.requestedBrightness, 100);
  equal(display.lowBatteryBrightnessActive, true);
  equal(display.platformSupported.brightness, false);
  equal(display.platformSupported.wakeLock, true);
});

run('de1MachineSettingsPatchBody converts usb boolean to enable/disable', () => {
  equal((de1MachineSettingsPatchBody({ usb: true }).usb as string), 'enable');
  equal((de1MachineSettingsPatchBody({ usb: false }).usb as string), 'disable');
  equal('usb' in de1MachineSettingsPatchBody({ fan: 40 }), false);
  equal(de1MachineSettingsPatchBody({ fan: 40 }).fan as number, 40);
});

run('steam purge mode exposes Reaprime-supported numeric options', () => {
  const field = SETTINGS_SPEC.flatMap((section) => section.fields)
    .find((candidate) => candidate.group === 'de1' && candidate.key === 'steamPurgeMode');
  if (!field) throw new Error('Missing steamPurgeMode field');

  equal(field.type, 'select');
  equal(field.options?.length, STEAM_PURGE_MODES.length);
  equal(field.options?.[0]?.value, '0');
  equal(field.options?.[1]?.value, '1');
  equal(coerceFieldValue(field, '1'), 1);
});

run('readSkins normalizes id/name from a few shapes', () => {
  const skins = readSkins([{ id: 'beanie', name: 'Beanie' }, { name: 'streamline.js' }, { id: '' }]);
  equal(skins.length, 2);
  equal(skins[0]!.id, 'beanie');
  equal(skins[1]!.id, 'streamline.js');
  equal(skins[1]!.name, 'streamline.js');
});

run('settings model exposes every currently editable backend setting', () => {
  const keys = new Set(SETTINGS_SPEC.flatMap((section) => section.fields.map((field) => `${field.group}.${field.key}`)));
  [
    'rea.gatewayMode',
    'rea.defaultSkinId',
    'rea.automaticUpdateCheck',
    'rea.themeMode',
    'rea.logLevel',
    'rea.blockOnNoScale',
    'rea.weightFlowMultiplier',
    'rea.volumeFlowMultiplier',
    'rea.scalePowerMode',
    'rea.chargingMode',
    'rea.nightModeEnabled',
    'rea.nightModeSleepTime',
    'rea.nightModeMorningTime',
    'rea.lowBatteryBrightnessLimit',
    'de1.usb',
    'de1.tankTemp',
    'de1.steamFlow',
    'de1.steamPurgeMode',
    'de1.hotWaterFlow',
    'de1.flushTemp',
    'de1.flushFlow',
    'de1.flushTimeout',
    'de1.fan',
    'presence.userPresenceEnabled',
    'presence.sleepTimeoutMinutes',
    'advanced.heaterVoltage',
    'advanced.heaterIdleTemp',
    'advanced.heaterPh1Flow',
    'advanced.heaterPh2Flow',
    'advanced.heaterPh2Timeout',
    'advanced.refillKitSetting',
    'calibration.flowMultiplier'
  ].forEach((key) => equal(keys.has(key), true));
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
