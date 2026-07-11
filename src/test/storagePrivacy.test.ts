import {
  clearGeminiApiKey,
  migrateLegacyGeminiApiKey,
  readGeminiApiKey,
  writeGeminiApiKey
} from '../domain/storage';

await run('Gemini credentials stay in device localStorage', () => {
  const values = installStorage();
  writeGeminiApiKey('  device-secret  ');
  equal(readGeminiApiKey(), 'device-secret');
  equal(values.get('beanie:gemini-api-key'), 'device-secret');
  clearGeminiApiKey();
  equal(readGeminiApiKey(), null);
  uninstallStorage();
});

await run('legacy synced Gemini credentials migrate locally and are deleted remotely', async () => {
  const values = installStorage();
  const deletes: Array<[string, string]> = [];
  const migrated = await migrateLegacyGeminiApiKey({
    storeGet: async () => 'legacy-secret',
    storeDelete: async (namespace, key) => {
      deletes.push([namespace, key]);
    }
  });
  equal(migrated, true);
  equal(values.get('beanie:gemini-api-key'), 'legacy-secret');
  equal(JSON.stringify(deletes), JSON.stringify([['beanie', 'geminiApiKey']]));
  uninstallStorage();
});

await run('a device key wins migration while the obsolete remote copy is still removed', async () => {
  const values = installStorage(new Map([['beanie:gemini-api-key', 'device-secret']]));
  let deleted = false;
  await migrateLegacyGeminiApiKey({
    storeGet: async () => 'remote-secret',
    storeDelete: async () => {
      deleted = true;
    }
  });
  equal(readGeminiApiKey(), 'device-secret');
  equal(values.get('beanie:gemini-api-key'), 'device-secret');
  equal(deleted, true);
  uninstallStorage();
});

await run('migration keeps the remote key when device storage cannot accept it', async () => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => null,
      setItem: () => {
        throw new Error('storage blocked');
      },
      removeItem: () => {}
    }
  });
  let deleted = false;
  let failed = false;
  try {
    await migrateLegacyGeminiApiKey({
      storeGet: async () => 'remote-secret',
      storeDelete: async () => {
        deleted = true;
      }
    });
  } catch {
    failed = true;
  }
  equal(failed, true);
  equal(deleted, false);
  uninstallStorage();
});

function installStorage(values = new Map<string, string>()): Map<string, string> {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key)
    }
  });
  return values;
}

function uninstallStorage(): void {
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
  if (actual !== expected) throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
}
