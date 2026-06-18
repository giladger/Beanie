import {
  readFlowCalibrationGlobal,
  readFlowCalibrationOverrides,
  resolveFlowCalibration,
  setProfileOverride,
  writeFlowCalibrationGlobal,
  writeFlowCalibrationOverrides
} from '../domain/flowCalibration';

class FakeStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value));
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  clear(): void {
    this.values.clear();
  }
}

const storage = new FakeStorage();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  writable: true,
  value: storage
});

run('global default is null until set, then round-trips', () => {
  storage.clear();
  equal(readFlowCalibrationGlobal(), null);

  writeFlowCalibrationGlobal(1.12);
  equal(readFlowCalibrationGlobal(), 1.12);
});

run('global default rejects non-positive / non-numeric stored values', () => {
  storage.clear();
  localStorage.setItem('beanie:flow-cal:global', 'n/a');
  equal(readFlowCalibrationGlobal(), null);
  localStorage.setItem('beanie:flow-cal:global', '0');
  equal(readFlowCalibrationGlobal(), null);
  // writeFlowCalibrationGlobal ignores invalid values rather than persisting them.
  storage.clear();
  writeFlowCalibrationGlobal(Number.NaN);
  equal(readFlowCalibrationGlobal(), null);
});

run('overrides default to empty and drop malformed entries', () => {
  storage.clear();
  equal(JSON.stringify(readFlowCalibrationOverrides()), '{}');

  localStorage.setItem(
    'beanie:flow-cal:profile-overrides',
    JSON.stringify({ 'Light Filter': 1.05, Broken: 'x', Zero: 0, '': 1.2 })
  );
  equal(JSON.stringify(readFlowCalibrationOverrides()), '{"Light Filter":1.05}');
});

run('overrides round-trip through local storage', () => {
  storage.clear();
  writeFlowCalibrationOverrides({ Espresso: 0.95 });
  equal(JSON.stringify(readFlowCalibrationOverrides()), '{"Espresso":0.95}');
});

run('resolveFlowCalibration prefers a profile override over the global', () => {
  const resolved = resolveFlowCalibration({
    profileTitle: 'Light Filter',
    overrides: { 'Light Filter': 1.05 },
    globalDefault: 1.0
  });
  equal(resolved.value, 1.05);
  equal(resolved.source, 'profile');
});

run('resolveFlowCalibration falls back to the global default', () => {
  const noOverride = resolveFlowCalibration({ profileTitle: 'Other', overrides: { 'Light Filter': 1.05 }, globalDefault: 1.1 });
  equal(noOverride.value, 1.1);
  equal(noOverride.source, 'global');

  const noTitle = resolveFlowCalibration({ profileTitle: null, overrides: { 'Light Filter': 1.05 }, globalDefault: 1.1 });
  equal(noTitle.value, 1.1);
  equal(noTitle.source, 'global');
});

run('resolveFlowCalibration trims the profile title before lookup', () => {
  const resolved = resolveFlowCalibration({ profileTitle: '  Light Filter  ', overrides: { 'Light Filter': 1.05 }, globalDefault: 1.0 });
  equal(resolved.value, 1.05);
  equal(resolved.source, 'profile');
});

run('setProfileOverride adds an override that differs from the global', () => {
  const next = setProfileOverride({}, 'Light Filter', 1.05, 1.0);
  equal(JSON.stringify(next), '{"Light Filter":1.05}');
});

run('setProfileOverride clears an override equal to the global default', () => {
  const next = setProfileOverride({ 'Light Filter': 1.05 }, 'Light Filter', 1.0, 1.0);
  equal(JSON.stringify(next), '{}');
});

run('setProfileOverride clears an override for an invalid value', () => {
  const next = setProfileOverride({ 'Light Filter': 1.05 }, 'Light Filter', 0, 1.0);
  equal(JSON.stringify(next), '{}');
});

run('setProfileOverride ignores an empty profile title and never mutates input', () => {
  const input = { 'Light Filter': 1.05 };
  const next = setProfileOverride(input, '   ', 1.2, 1.0);
  equal(JSON.stringify(next), '{"Light Filter":1.05}');
  // Adding a new override returns a fresh object, leaving the input untouched.
  const added = setProfileOverride(input, 'Espresso', 0.9, 1.0);
  equal(JSON.stringify(input), '{"Light Filter":1.05}');
  equal(JSON.stringify(added), '{"Light Filter":1.05,"Espresso":0.9}');
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
