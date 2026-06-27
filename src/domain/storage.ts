import {
  favoriteBeansKey,
  favoriteProfilesKey,
  geminiApiKeyKey,
  getSyncedItem,
  lastBeanKey,
  removeSyncedItem,
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

// The user's own (free-tier) Gemini key for the AI label scanner — synced
// across devices through the gateway store like every other setting.
export function readGeminiApiKey(): string | null {
  const value = getSyncedItem(geminiApiKeyKey);
  return value && value.trim() ? value : null;
}

export function writeGeminiApiKey(key: string): void {
  const trimmed = key.trim();
  if (trimmed) setSyncedItem(geminiApiKeyKey, trimmed);
  else removeSyncedItem(geminiApiKeyKey);
}

export function clearGeminiApiKey(): void {
  removeSyncedItem(geminiApiKeyKey);
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
