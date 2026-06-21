// Cross-device settings store.
//
// The gateway's KV store (/api/v1/store) is the ONLY home for user settings —
// there is no localStorage. Settings are held in an in-memory cache that the
// app loads from the store on boot (behind a spinner), writes through to the
// store on every change, and refreshes by polling so multiple live devices stay
// in sync. The in-memory cache exists only so the synchronous UI can read a
// setting without awaiting the network; it is never the source of truth.
//
// This module owns the canonical key constants so the domain modules import
// them from here (one direction only — no import back, which would cycle).

export const SETTINGS_STORE_NAMESPACE = 'beanie';

// --- synced setting keys ------------------------------------------------------
//
// Theme is deliberately absent — it stays per-browser in localStorage (see
// settings.ts). The Gemini key keeps a legacy store key (STORE_KEY_OVERRIDES)
// so its existing store value isn't orphaned.
export const uiScaleKey = 'beanie.settings.ui-scale';
export const waterSoftKey = 'beanie.settings.water-soft-ml';
export const wakeAppZoneEnabledKey = 'beanie.settings.wake-app-zone';
export const wakeAppZonePositionKey = 'beanie.settings.wake-app-zone-position';
export const favoriteProfilesKey = 'beanie.favorite-profiles';
export const favoriteBeansKey = 'beanie.favorite-beans';
export const lastBeanKey = 'beanie.last-bean-id';
export const flowCalGlobalKey = 'beanie.flow-cal.global';
export const flowCalOverridesKey = 'beanie.flow-cal.profile-overrides';
export const machinePresetLabelsKey = 'beanie.machine-preset-labels';
export const machinePresetValuesKey = 'beanie.machine-preset-values';
export const machinePresetSelectionKey = 'beanie.machine-preset-selection';
export const hotWaterStopModeKey = 'beanie.hot-water-stop-mode';
export const hotWaterWeightTargetKey = 'beanie.hot-water-weight-target';
export const cleaningStateKey = 'beanie.cleaning.state';
export const cleaningOverrideKey = 'beanie.cleaning.profile-id';
export const cleaningThresholdKey = 'beanie.cleaning.threshold';
export const secondTapHintKey = 'beanie.second-tap-hint-v3';
export const geminiApiKeyKey = 'beanie.gemini-api-key';

export const inputDialogRecentKinds = ['dose', 'yield', 'ratio', 'grind', 'temperature'] as const;
export const inputDialogRecentKeyPrefix = 'beanie.input-dialog-recents.';
const inputDialogRecentKeys = inputDialogRecentKinds.map((kind) => `${inputDialogRecentKeyPrefix}${kind}`);

export const SYNCED_SETTING_KEYS: readonly string[] = [
  uiScaleKey,
  waterSoftKey,
  wakeAppZoneEnabledKey,
  wakeAppZonePositionKey,
  favoriteProfilesKey,
  favoriteBeansKey,
  lastBeanKey,
  flowCalGlobalKey,
  flowCalOverridesKey,
  machinePresetLabelsKey,
  machinePresetValuesKey,
  machinePresetSelectionKey,
  hotWaterStopModeKey,
  hotWaterWeightTargetKey,
  cleaningStateKey,
  cleaningOverrideKey,
  cleaningThresholdKey,
  secondTapHintKey,
  geminiApiKeyKey,
  ...inputDialogRecentKeys
];

const syncedKeySet = new Set(SYNCED_SETTING_KEYS);

const STORE_KEY_OVERRIDES: Record<string, string> = {
  [geminiApiKeyKey]: 'geminiApiKey'
};

function storeKeyFor(localKey: string): string {
  return STORE_KEY_OVERRIDES[localKey] ?? localKey;
}

// --- in-memory cache + write-through -----------------------------------------

// The live settings, mirrored from the gateway store. Reads are synchronous off
// this map; it's populated by loadAllFromStore() / pollFromStore() and updated
// on every write.
const cache = new Map<string, string>();

/** Read a setting synchronously from the in-memory cache. */
export function getSyncedItem(key: string): string | null {
  return cache.has(key) ? (cache.get(key) as string) : null;
}

// The app wires this to push a key's current value to the gateway store (and to
// hard-fail loudly when that push fails). Until it's set — before start() runs,
// or in demo mode — writes update the in-memory cache only.
export type StorePushHandler = (storeKey: string, value: string | null) => void;
let pushHandler: StorePushHandler | null = null;

export function setStorePushHandler(handler: StorePushHandler | null): void {
  pushHandler = handler;
}

function notifyStore(key: string, value: string | null): void {
  if (!syncedKeySet.has(key)) return;
  pushHandler?.(storeKeyFor(key), value);
}

/** Set a setting in the in-memory cache AND push it to the gateway store. */
export function setSyncedItem(key: string, value: string): void {
  cache.set(key, value);
  notifyStore(key, value);
}

/** Clear a setting from the in-memory cache AND delete it from the store. */
export function removeSyncedItem(key: string): void {
  cache.delete(key);
  notifyStore(key, null);
}

/** Keys currently held in the cache (for the settings "reset" action). */
export function syncedCacheKeys(): string[] {
  return [...cache.keys()];
}

/** Clear the in-memory cache without touching the store (tests / sign-out). */
export function clearSyncedCache(): void {
  cache.clear();
}

// --- load / poll from the store ----------------------------------------------

export interface SettingsStoreGateway {
  storeGet(namespace: string, key: string): Promise<unknown>;
  storeSet(namespace: string, key: string, value: unknown): Promise<void>;
  // Optional bulk read (?full=1). Returns the namespace map, or null when the
  // gateway doesn't support it — callers then fall back to per-key gets.
  storeGetAll?(namespace: string): Promise<Record<string, unknown> | null>;
}

// One bulk read of the namespace when the gateway supports ?full=1, else null.
// Keys are URL-safe (dot-separated), so there's no encoding/decoding involved.
async function fetchBulk(gateway: SettingsStoreGateway): Promise<Record<string, unknown> | null> {
  return gateway.storeGetAll ? await gateway.storeGetAll(SETTINGS_STORE_NAMESPACE) : null;
}

/**
 * Populate the in-memory cache from the gateway store. Run once at boot before
 * the app renders real content. Throws if the store is unreachable (the caller
 * falls back to defaults / demo).
 */
export async function loadAllFromStore(gateway: SettingsStoreGateway): Promise<void> {
  // One bulk request when supported; per-key gets otherwise.
  const bulk = await fetchBulk(gateway);
  await Promise.all(
    SYNCED_SETTING_KEYS.map(async (key) => {
      const storeKey = storeKeyFor(key);
      const remote = bulk ? bulk[storeKey] : await gateway.storeGet(SETTINGS_STORE_NAMESPACE, storeKey);
      if (typeof remote === 'string') {
        cache.set(key, remote);
        return;
      }
      // TRANSITIONAL (remove after rollout): seed the store from any value left
      // in this device's old localStorage so existing settings aren't lost when
      // moving off localStorage.
      const legacy = readLegacyLocal(key);
      if (legacy !== null) {
        cache.set(key, legacy);
        await gateway.storeSet(SETTINGS_STORE_NAMESPACE, storeKey, legacy);
      } else {
        cache.delete(key);
      }
    })
  );
}

/**
 * Re-fetch every key from the store and apply changes to the cache. Returns the
 * keys whose value actually changed, so the app can re-render only when needed.
 */
export async function pollFromStore(gateway: SettingsStoreGateway): Promise<string[]> {
  const bulk = await fetchBulk(gateway);
  const changed: string[] = [];
  await Promise.all(
    SYNCED_SETTING_KEYS.map(async (key) => {
      const remote = bulk ? bulk[storeKeyFor(key)] : await gateway.storeGet(SETTINGS_STORE_NAMESPACE, storeKeyFor(key));
      const next = typeof remote === 'string' ? remote : null;
      if (next === getSyncedItem(key)) return;
      if (next === null) cache.delete(key);
      else cache.set(key, next);
      changed.push(key);
    })
  );
  return changed;
}

// Existing devices stored settings in localStorage under the old colon-separated
// key names (`beanie:settings:theme`). The store keys are now dot-separated, so
// translate back to pick up a user's pre-migration value once.
function readLegacyLocal(key: string): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(key.split('.').join(':'));
  } catch {
    return null;
  }
}
