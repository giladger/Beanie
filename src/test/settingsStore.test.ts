import {
  clearSyncedCache,
  geminiApiKeyKey,
  getSyncedItem,
  loadAllFromStore,
  pollFromStore,
  removeSyncedItem,
  setStorePushHandler,
  setSyncedItem,
  uiScaleKey,
  type SettingsStoreGateway
} from '../domain/settingsStore';
import { writeFlowCalibrationGlobal } from '../domain/flowCalibration';

// Records what the app's push handler would send to the gateway store.
const pushes: Array<[string, string | null]> = [];

function resetEnv(): void {
  clearSyncedCache();
  pushes.length = 0;
  setStorePushHandler((key, value) => pushes.push([key, value]));
}

class FakeGateway implements SettingsStoreGateway {
  readonly gets = new Map<string, unknown>();
  readonly sets: Array<[string, unknown]> = [];

  async storeGet(_namespace: string, key: string): Promise<unknown> {
    // Real gateway returns null for an absent key.
    return this.gets.has(key) ? this.gets.get(key) : null;
  }

  async storeSet(_namespace: string, key: string, value: unknown): Promise<void> {
    this.sets.push([key, value]);
  }
}

// A gateway that supports the ?full=1 bulk read; counts per-key gets so tests
// can assert the bulk path avoided them.
class FakeBulkGateway implements SettingsStoreGateway {
  storeGetCalls = 0;
  constructor(private readonly values: Record<string, unknown>) {}

  async storeGet(_namespace: string, key: string): Promise<unknown> {
    this.storeGetCalls += 1;
    return key in this.values ? this.values[key] : null;
  }

  async storeSet(): Promise<void> {}

  async storeGetAll(): Promise<Record<string, unknown> | null> {
    return this.values;
  }
}

await run('setSyncedItem caches the value and pushes it', () => {
  resetEnv();
  setSyncedItem(uiScaleKey, 'large');
  equal(getSyncedItem(uiScaleKey), 'large');
  equal(pushes.length, 1);
  equal(pushes[0]![0], uiScaleKey);
  equal(pushes[0]![1], 'large');
});

await run('removeSyncedItem clears the cache and pushes null', () => {
  resetEnv();
  setSyncedItem(uiScaleKey, 'large');
  pushes.length = 0;
  removeSyncedItem(uiScaleKey);
  equal(getSyncedItem(uiScaleKey), null);
  equal(pushes.length, 1);
  equal(pushes[0]![1], null);
});

await run('the Gemini key pushes under its legacy store key', () => {
  resetEnv();
  setSyncedItem(geminiApiKeyKey, 'abc');
  equal(getSyncedItem(geminiApiKeyKey), 'abc');
  equal(pushes[0]![0], 'geminiApiKey');
  equal(pushes[0]![1], 'abc');
});

await run('a non-synced key caches but never pushes', () => {
  resetEnv();
  setSyncedItem('beanie.not-a-synced-key', 'x');
  equal(getSyncedItem('beanie.not-a-synced-key'), 'x');
  equal(pushes.length, 0);
});

await run('clearSyncedCache empties the cache', () => {
  resetEnv();
  setSyncedItem(uiScaleKey, 'large');
  clearSyncedCache();
  equal(getSyncedItem(uiScaleKey), null);
});

await run('no pushes once the handler is detached', () => {
  resetEnv();
  setStorePushHandler(null);
  setSyncedItem(uiScaleKey, 'compact');
  equal(getSyncedItem(uiScaleKey), 'compact');
  equal(pushes.length, 0);
});

await run('a domain writer pushes through setSyncedItem', () => {
  resetEnv();
  writeFlowCalibrationGlobal(1.2);
  equal(pushes.length, 1);
  equal(pushes[0]![0], 'beanie.flow-cal.global');
  equal(pushes[0]![1], '1.2');
});

await run('loadAllFromStore fills the cache from the store', async () => {
  resetEnv();
  const gateway = new FakeGateway();
  gateway.gets.set(uiScaleKey, 'large');
  await loadAllFromStore(gateway);
  equal(getSyncedItem(uiScaleKey), 'large');
});

await run('loadAllFromStore seeds the store from a legacy localStorage value', async () => {
  resetEnv();
  // Pre-migration devices stored under the OLD colon key name.
  installFakeLocalStorage(new Map([['beanie:settings:ui-scale', 'compact']]));
  const gateway = new FakeGateway(); // store empty
  await loadAllFromStore(gateway);
  // Legacy value adopted into the cache (under the new key) and pushed up.
  equal(getSyncedItem(uiScaleKey), 'compact');
  equal(gateway.sets.some(([key, value]) => key === uiScaleKey && value === 'compact'), true);
  uninstallFakeLocalStorage();
});

await run('pollFromStore reports only the keys that changed', async () => {
  resetEnv();
  setSyncedItem(uiScaleKey, 'compact');
  const gateway = new FakeGateway();
  gateway.gets.set(uiScaleKey, 'large');
  const changed = await pollFromStore(gateway);
  equal(changed.includes(uiScaleKey), true);
  equal(changed.length, 1);
  equal(getSyncedItem(uiScaleKey), 'large');
});

await run('pollFromStore reports nothing when the store matches the cache', async () => {
  resetEnv();
  setSyncedItem(uiScaleKey, 'large');
  const gateway = new FakeGateway();
  gateway.gets.set(uiScaleKey, 'large');
  const changed = await pollFromStore(gateway);
  equal(changed.length, 0);
});

await run('loadAllFromStore uses the bulk endpoint and skips per-key gets', async () => {
  resetEnv();
  const gateway = new FakeBulkGateway({ [uiScaleKey]: 'large', geminiApiKey: 'abc' });
  await loadAllFromStore(gateway);
  equal(getSyncedItem(uiScaleKey), 'large');
  // The Gemini key is read from the bulk map under its legacy store key.
  equal(getSyncedItem(geminiApiKeyKey), 'abc');
  equal(gateway.storeGetCalls, 0);
});

await run('pollFromStore uses the bulk endpoint and reports changes', async () => {
  resetEnv();
  setSyncedItem(uiScaleKey, 'compact');
  const gateway = new FakeBulkGateway({ [uiScaleKey]: 'large' });
  const changed = await pollFromStore(gateway);
  equal(changed.includes(uiScaleKey), true);
  equal(getSyncedItem(uiScaleKey), 'large');
  equal(gateway.storeGetCalls, 0);
});

// Detach so the module-level handler can't leak into later-loading test files.
setStorePushHandler(null);

function installFakeLocalStorage(values: Map<string, string>): void {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: { getItem: (key: string) => values.get(key) ?? null }
  });
}

function uninstallFakeLocalStorage(): void {
  Reflect.deleteProperty(globalThis as unknown as Record<string, unknown>, 'localStorage');
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
    throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  }
}
