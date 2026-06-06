// Cleaning / backflush support. A cleaning cycle is a profile-driven espresso
// pull (the DE1 "Cleaning / forward flush ×5" profile) run with a blind basket;
// it is bean-independent, so its bookkeeping lives here rather than on a bean.
//
// The pure helpers (resolveCleaningProfile / bumpShots / markCleaned /
// cleaningDue) are unit-tested; the read*/write* wrappers are thin localStorage
// persistence used only in the browser.

/** Minimal shape of a profile list entry (matches app.ts state.profiles items). */
export interface CleaningProfileLike {
  id: string;
  profile: { title?: string | null; beverage_type?: string | null } | null;
}

export interface CleaningState {
  /** Espresso shots pulled since the last completed cleaning cycle. */
  shotsSinceClean: number;
  /** ISO timestamp of the last completed cleaning, or null if never. */
  lastCleanedAt: string | null;
}

/** Reminder threshold options (shots). 0 = reminder off. */
export const CLEANING_THRESHOLD_OPTIONS = [0, 40, 80, 120] as const;
export const DEFAULT_CLEANING_THRESHOLD = 80;

const EMPTY_STATE: CleaningState = { shotsSinceClean: 0, lastCleanedAt: null };

// Beverage types the DE1 / de1app tag cleaning profiles with.
const CLEANING_BEVERAGE_TYPES = new Set(['clean', 'cleaning']);
// Title fallback when a profile is not explicitly tagged.
const CLEANING_TITLE_RE = /clean|back\s*-?\s*flush|forward\s*-?\s*flush/i;

/**
 * Resolve which installed profile is the cleaning profile:
 *   1. an explicit user override (by id), if it still exists;
 *   2. else the first profile tagged beverage_type clean/cleaning;
 *   3. else the first profile whose title looks like a cleaning/flush profile.
 * Returns null when nothing matches (caller should disable the action).
 */
export function resolveCleaningProfile<T extends CleaningProfileLike>(
  profiles: readonly T[],
  overrideId: string | null
): T | null {
  if (overrideId) {
    const override = profiles.find((p) => p.id === overrideId);
    if (override) return override;
  }
  const tagged = profiles.find((p) => {
    const type = p.profile?.beverage_type;
    return type != null && CLEANING_BEVERAGE_TYPES.has(String(type).toLowerCase().trim());
  });
  if (tagged) return tagged;
  return profiles.find((p) => CLEANING_TITLE_RE.test(p.profile?.title ?? '')) ?? null;
}

/** Count one espresso pull toward the next cleaning. */
export function bumpShots(state: CleaningState): CleaningState {
  return { ...state, shotsSinceClean: state.shotsSinceClean + 1 };
}

/** Record a completed cleaning cycle (resets the counter). */
export function markCleaned(nowIso: string): CleaningState {
  return { shotsSinceClean: 0, lastCleanedAt: nowIso };
}

/** Whether a cleaning reminder is due. threshold <= 0 disables it. */
export function cleaningDue(state: CleaningState, threshold: number): boolean {
  return threshold > 0 && state.shotsSinceClean >= threshold;
}

// ---- persistence (browser only) -------------------------------------------

const stateKey = 'beanie:cleaning:state';
const overrideKey = 'beanie:cleaning:profile-id';
const thresholdKey = 'beanie:cleaning:threshold';

function storage(): Storage | null {
  return typeof localStorage !== 'undefined' ? localStorage : null;
}

export function readCleaningState(): CleaningState {
  const raw = storage()?.getItem(stateKey);
  if (!raw) return { ...EMPTY_STATE };
  try {
    const parsed = JSON.parse(raw) as Partial<CleaningState>;
    return {
      shotsSinceClean:
        typeof parsed.shotsSinceClean === 'number' && parsed.shotsSinceClean >= 0
          ? Math.floor(parsed.shotsSinceClean)
          : 0,
      lastCleanedAt: typeof parsed.lastCleanedAt === 'string' ? parsed.lastCleanedAt : null
    };
  } catch {
    return { ...EMPTY_STATE };
  }
}

export function writeCleaningState(state: CleaningState): void {
  storage()?.setItem(stateKey, JSON.stringify(state));
}

export function readCleaningProfileOverride(): string | null {
  return storage()?.getItem(overrideKey) ?? null;
}

export function writeCleaningProfileOverride(id: string | null): void {
  const store = storage();
  if (!store) return;
  if (id) store.setItem(overrideKey, id);
  else store.removeItem(overrideKey);
}

export function readCleaningThreshold(): number {
  const raw = storage()?.getItem(thresholdKey);
  if (raw == null) return DEFAULT_CLEANING_THRESHOLD;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : DEFAULT_CLEANING_THRESHOLD;
}

export function writeCleaningThreshold(shots: number): void {
  storage()?.setItem(thresholdKey, String(Math.max(0, Math.floor(shots))));
}
