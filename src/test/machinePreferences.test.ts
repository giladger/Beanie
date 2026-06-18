import {
  readHotWaterStopMode,
  readHotWaterWeightTarget,
  readMachinePresetLabels,
  readMachinePresetValues,
  writeHotWaterStopMode,
  writeHotWaterWeightTarget,
  writeMachinePresetLabels,
  writeMachinePresetValues
} from '../domain/machinePreferences';
import { clearSyncedCache, setSyncedItem } from '../domain/settingsStore';

run('machine preset labels default to empty and ignore malformed entries', () => {
  clearSyncedCache();
  equal(JSON.stringify(readMachinePresetLabels()), '{}');

  setSyncedItem('beanie.machine-preset-labels', JSON.stringify({
    'flush:short': 'Morning rinse',
    'flush:bad': 4
  }));

  equal(JSON.stringify(readMachinePresetLabels()), '{"flush:short":"Morning rinse"}');
});

run('machine preset labels round-trip through local storage', () => {
  clearSyncedCache();

  writeMachinePresetLabels({ 'steam:milk': 'Milk' });

  equal(JSON.stringify(readMachinePresetLabels()), '{"steam:milk":"Milk"}');
});

run('machine preset values keep finite numeric overrides only', () => {
  clearSyncedCache();
  setSyncedItem('beanie.machine-preset-values', JSON.stringify({
    'hot-water:tea': { volume: 240, seconds: '20', flow: Number.NaN },
    'flush:empty': { flow: 'fast' },
    'flush:short': { flow: 5.5 }
  }));

  equal(JSON.stringify(readMachinePresetValues()), '{"hot-water:tea":{"volume":240},"flush:short":{"flow":5.5}}');
});

run('machine preset values round-trip through local storage', () => {
  clearSyncedCache();

  writeMachinePresetValues({ 'flush:short': { flow: 5.5, seconds: 8 } });

  equal(JSON.stringify(readMachinePresetValues()), '{"flush:short":{"flow":5.5,"seconds":8}}');
});

run('hot water stop mode defaults to volume and accepts time', () => {
  clearSyncedCache();
  equal(readHotWaterStopMode(), 'volume');

  writeHotWaterStopMode('time');

  equal(readHotWaterStopMode(), 'time');
  setSyncedItem('beanie.hot-water-stop-mode', 'surprise');
  equal(readHotWaterStopMode(), 'volume');
});

run('hot water weight target persists positive finite values only', () => {
  clearSyncedCache();
  equal(readHotWaterWeightTarget(), null);

  writeHotWaterWeightTarget(175);
  equal(readHotWaterWeightTarget(), 175);

  writeHotWaterWeightTarget(0);
  writeHotWaterWeightTarget(Number.NaN);
  writeHotWaterWeightTarget(null);

  equal(readHotWaterWeightTarget(), 175);
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
    throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  }
}
