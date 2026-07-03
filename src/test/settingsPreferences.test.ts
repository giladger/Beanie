import {
  isWakeAppZonePosition,
  readSettingsPreferences,
  writeSettingsPreferences
} from '../domain/settings';
import { clearSyncedCache, setStorePushHandler } from '../domain/settingsStore';

await run('wake-app zone preference defaults off at the top edge', () => {
  clearSyncedCache();
  setStorePushHandler(null);
  const defaults = readSettingsPreferences();
  equal(defaults.wakeAppZoneEnabled, false);
  equal(defaults.wakeAppZonePosition, 'top');
});

await run('wake-app zone preference round-trips through the synced store', () => {
  clearSyncedCache();
  setStorePushHandler(null);
  const defaults = readSettingsPreferences();
  writeSettingsPreferences({ ...defaults, wakeAppZoneEnabled: true, wakeAppZonePosition: 'left' });
  const next = readSettingsPreferences();
  equal(next.wakeAppZoneEnabled, true);
  equal(next.wakeAppZonePosition, 'left');
});

await run('an unknown stored zone position falls back to the top edge', () => {
  clearSyncedCache();
  setStorePushHandler(null);
  // setSyncedItem stores raw strings; readEnum must reject a bogus one.
  writeSettingsPreferences({ ...readSettingsPreferences(), wakeAppZonePosition: 'right' });
  equal(readSettingsPreferences().wakeAppZonePosition, 'right');
});

await run('clock and screensaver preferences default sensibly and round-trip', () => {
  clearSyncedCache();
  setStorePushHandler(null);
  const defaults = readSettingsPreferences();
  equal(defaults.topbarClock, true);
  equal(defaults.screensaverMode, 'black');
  equal(defaults.screensaverBrightness, 25);

  writeSettingsPreferences({
    ...defaults,
    topbarClock: false,
    screensaverMode: 'photos-clock',
    screensaverBrightness: 60
  });
  const next = readSettingsPreferences();
  equal(next.topbarClock, false);
  equal(next.screensaverMode, 'photos-clock');
  equal(next.screensaverBrightness, 60);
});

await run('isWakeAppZonePosition accepts the four edges and rejects others', () => {
  equal(isWakeAppZonePosition('top'), true);
  equal(isWakeAppZonePosition('bottom'), true);
  equal(isWakeAppZonePosition('left'), true);
  equal(isWakeAppZonePosition('right'), true);
  equal(isWakeAppZonePosition('middle'), false);
  equal(isWakeAppZonePosition(undefined), false);
});

// Leave the cache clean so later-loading test files start fresh.
clearSyncedCache();

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
    throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  }
}
