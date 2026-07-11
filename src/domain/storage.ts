import {
  favoriteBeansKey,
  favoriteProfilesKey,
  getSyncedItem,
  lastBeanKey,
  setSyncedItem
} from './settingsStore';

export function readLastBeanId(): string | null {
  return getSyncedItem(lastBeanKey);
}

export function writeLastBeanId(beanId: string): void {
  setSyncedItem(lastBeanKey, beanId);
}

export function readFavoriteProfiles(): string[] {
  try {
    const raw = getSyncedItem(favoriteProfilesKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function writeFavoriteProfiles(ids: string[]): void {
  setSyncedItem(favoriteProfilesKey, JSON.stringify([...new Set(ids)]));
}

export function readFavoriteBeans(): string[] {
  try {
    const raw = getSyncedItem(favoriteBeansKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function writeFavoriteBeans(ids: string[]): void {
  setSyncedItem(favoriteBeansKey, JSON.stringify([...new Set(ids)]));
}

// The user's Gemini credential is deliberately device-local. API keys are not
// preferences and must never enter the gateway's cross-device settings store.
const geminiApiKeyDeviceKey = 'beanie:gemini-api-key';
const legacyGeminiStoreKey = 'geminiApiKey';

export function readGeminiApiKey(): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const value = localStorage.getItem(geminiApiKeyDeviceKey);
    return value && value.trim() ? value : null;
  } catch {
    return null;
  }
}

export function writeGeminiApiKey(key: string): void {
  const trimmed = key.trim();
  try {
    if (typeof localStorage === 'undefined') return;
    if (trimmed) localStorage.setItem(geminiApiKeyDeviceKey, trimmed);
    else localStorage.removeItem(geminiApiKeyDeviceKey);
  } catch {
    // The scanner will remain unconfigured when device storage is unavailable.
  }
}

export function clearGeminiApiKey(): void {
  writeGeminiApiKey('');
}

export interface LegacyGeminiKeyGateway {
  storeGet(namespace: string, key: string): Promise<unknown>;
  storeDelete(namespace: string, key: string): Promise<void>;
}

/**
 * Move the historic synced key onto this device, then remove the gateway copy.
 * A local value wins so migration never replaces a key chosen on this device.
 * Failures are allowed to bubble so startup can warn and a later launch retries.
 */
export async function migrateLegacyGeminiApiKey(gateway: LegacyGeminiKeyGateway): Promise<boolean> {
  const remote = await gateway.storeGet('beanie', legacyGeminiStoreKey);
  if (typeof remote !== 'string' || !remote.trim()) return false;
  if (readGeminiApiKey() == null) {
    writeGeminiApiKey(remote);
    if (readGeminiApiKey() !== remote.trim()) {
      throw new Error('Could not persist the migrated Gemini key on this device');
    }
  }
  await gateway.storeDelete('beanie', legacyGeminiStoreKey);
  return true;
}

// Whether this device should skip the phone hand-off and scan on-device. It's a
// per-device choice (a tablet the user has set up to scan its own labels), so it
// lives in localStorage rather than the synced store — every device keeps its
// own answer, like the theme.
const scanOnThisDeviceKey = 'beanie:scan-on-this-device';

export function readScanOnThisDevice(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(scanOnThisDeviceKey) === '1';
  } catch {
    return false;
  }
}

export function writeScanOnThisDevice(on: boolean): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (on) localStorage.setItem(scanOnThisDeviceKey, '1');
    else localStorage.removeItem(scanOnThisDeviceKey);
  } catch {
    // Best-effort; on failure the hand-off screen simply shows again next time.
  }
}

// The change the user just applied from a Derek suggestion, waiting for the
// next shot on that bean to be pulled so it can be stamped onto that shot's
// annotations (closing the advice → try → result loop). Per-device: the apply
// happened here, and the stamp happens where the shot ends.
const pendingDerekTweakKey = 'beanie:pending-derek-tweak';
const pendingDerekTweakMaxAgeMs = 48 * 60 * 60 * 1000;

export interface PendingDerekTweak {
  beanId: string;
  summary: string;
  at: string;
}

export function readPendingDerekTweak(): PendingDerekTweak | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(pendingDerekTweakKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingDerekTweak>;
    if (typeof parsed.beanId !== 'string' || typeof parsed.summary !== 'string' || typeof parsed.at !== 'string') {
      return null;
    }
    // A tweak applied days ago no longer explains the next shot pulled.
    const at = Date.parse(parsed.at);
    if (!Number.isFinite(at) || Date.now() - at > pendingDerekTweakMaxAgeMs) return null;
    return { beanId: parsed.beanId, summary: parsed.summary, at: parsed.at };
  } catch {
    return null;
  }
}

export function writePendingDerekTweak(tweak: PendingDerekTweak): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(pendingDerekTweakKey, JSON.stringify(tweak));
  } catch {
    // Best-effort; without it the next ask simply lacks the "previous change" line.
  }
}

export function clearPendingDerekTweak(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(pendingDerekTweakKey);
  } catch {
    // Best-effort.
  }
}

// One-time, per-device bookkeeping for the freeze/thaw history migration. The
// history used to live only in this device's IndexedDB cache, so each device has
// to copy its OWN cache up to the gateway exactly once — hence localStorage, not
// the synced store. Until the copy completes cleanly the flag stays unset, so an
// offline first launch simply retries on the next open.
const storageEventsMigratedKey = 'beanie:migrated:storage-events-v1';

export function readStorageEventsMigrated(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(storageEventsMigratedKey) === '1';
  } catch {
    return false;
  }
}

export function markStorageEventsMigrated(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(storageEventsMigratedKey, '1');
  } catch {
    // Best-effort; on failure the migration just runs again next open.
  }
}
