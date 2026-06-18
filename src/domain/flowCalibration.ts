// Per-profile flow calibration.
//
// The DE1 holds a single global flow-estimation multiplier (its
// `calibration_flow_multiplier`), pushed via the gateway's
// /api/v1/machine/calibration endpoint. To get global + per-profile override
// behaviour — the model used by the old app's Graphical Flow Calibrator (GFC)
// plugin — beanie persists, device-locally:
//   - a GLOBAL DEFAULT multiplier (the fallback for profiles with no override), and
//   - a map of per-profile OVERRIDES keyed by profile title.
// Profile title is the only profile identity a recorded shot carries
// (workflow.profile.title) and is what the recipe draft tracks
// (draft.profileTitle), so it is the override key — matching the DE1 app, which
// keys its `calibration_flow_multiplier_profiles` list by profile_title.
//
// When a profile is used, the resolved value (override else global default) is
// pushed to the machine; the machine's live value is therefore the *active*
// multiplier, never the source of truth for the global default.

const globalKey = 'beanie:flow-cal:global';
const overridesKey = 'beanie:flow-cal:profile-overrides';

// Calibration keys that must survive a Beanie cache reset (re-export so the
// reset-preservation list stays in sync with the storage layer).
export const FLOW_CALIBRATION_STORAGE_KEYS = [globalKey, overridesKey] as const;

// A valid multiplier is any finite, positive number. Bounds-clamping to the
// DE1 slider range happens at the write site (clampCalibration); the store only
// guards against corrupt/non-numeric values, mirroring machinePreferences.ts.
function sanitizeMultiplier(value: unknown): number | null {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function readFlowCalibrationGlobal(): number | null {
  try {
    return sanitizeMultiplier(localStorage.getItem(globalKey));
  } catch {
    return null;
  }
}

export function writeFlowCalibrationGlobal(value: number): void {
  const sanitized = sanitizeMultiplier(value);
  if (sanitized == null) return;
  try {
    localStorage.setItem(globalKey, String(sanitized));
  } catch {
    // Best-effort: the live in-memory bundle remains authoritative this session.
  }
}

export function readFlowCalibrationOverrides(): Record<string, number> {
  try {
    const raw = localStorage.getItem(overridesKey);
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([title, value]) => {
        const sanitized = sanitizeMultiplier(value);
        return title.trim() !== '' && sanitized != null ? [[title, sanitized] as [string, number]] : [];
      })
    );
  } catch {
    return {};
  }
}

export function writeFlowCalibrationOverrides(overrides: Record<string, number>): void {
  try {
    localStorage.setItem(overridesKey, JSON.stringify(overrides));
  } catch {
    // Best-effort, as above.
  }
}

export interface ResolvedFlowCalibration {
  value: number;
  /** 'profile' when an override governs, 'global' when the default does. */
  source: 'profile' | 'global';
}

// The multiplier that should be active for a given profile: its override if one
// exists, otherwise the global default.
export function resolveFlowCalibration(input: {
  profileTitle: string | null | undefined;
  overrides: Record<string, number>;
  globalDefault: number;
}): ResolvedFlowCalibration {
  const title = input.profileTitle?.trim();
  if (title) {
    const override = sanitizeMultiplier(input.overrides[title]);
    if (override != null) return { value: override, source: 'profile' };
  }
  return { value: input.globalDefault, source: 'global' };
}

// Set or clear a profile's override. An override equal to the global default is
// removed, so the profile reverts to following the global — matching the DE1
// app, which drops a profile from its overrides list when it matches the
// default. Returns a new map; never mutates the input.
export function setProfileOverride(
  overrides: Record<string, number>,
  profileTitle: string | null | undefined,
  value: number,
  globalDefault: number
): Record<string, number> {
  const next = { ...overrides };
  const title = profileTitle?.trim();
  if (!title) return next;
  const sanitized = sanitizeMultiplier(value);
  if (sanitized == null || sanitized === globalDefault) {
    delete next[title];
  } else {
    next[title] = sanitized;
  }
  return next;
}
