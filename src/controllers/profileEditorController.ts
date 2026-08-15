import type { Grinder, Profile, ProfileRecord, RecipeDraft } from '../api/types';
import type { NewProfileKind } from '../domain/simpleProfile';
import { profileExecutionSignature } from '../domain/profileModel';
import { normalizeDraft } from '../domain/beanWorkflow';

export interface SaveProfileInput {
  profiles: ProfileRecord[];
  editingId: string | null;
  profile: Profile;
  demo: boolean;
  nowMs: number;
  /**
   * What the user pressed. `save` writes the profile they opened — in place for
   * their own, and for one of Decent's built-ins (which reaprime will not write
   * in place at all) by storing the edit and retiring the original, so that
   * "save" means what it says. `copy` always creates a separate profile and
   * always leaves the source exactly where it is.
   */
  intent: 'save' | 'copy';
}

export interface SaveProfileDeps {
  createProfile(input: { profile: Profile; parentId?: string }): Promise<ProfileRecord>;
  updateProfile(id: string, input: { profile: Profile }): Promise<ProfileRecord>;
  loadProfiles(): Promise<ProfileRecord[]>;
  invalidateProfileMutation(profileId: string): Promise<void>;
  putProfiles(profiles: ProfileRecord[]): Promise<void>;
  /** Un-hide / un-delete a profile (PUT .../visibility {visible}). */
  restoreProfile(id: string): Promise<void>;
  /** Take a profile out of the visible list (PUT .../visibility {hidden}). */
  hideProfile(id: string): Promise<void>;
}

export interface ToggleFavoriteProfileInput {
  favoriteProfileIds: readonly string[];
  profileId: string;
}

export interface ToggleFavoriteProfileDeps {
  writeFavoriteProfiles(profileIds: string[]): void;
}

export interface ToggleFavoriteProfileResult {
  favoriteProfileIds: string[];
  favorite: boolean;
}

export interface SelectProfileForDraftInput {
  draft: RecipeDraft;
  profiles: ProfileRecord[];
  grinders: Grinder[];
  profileId: string;
}

export interface SelectProfileForDraftResult {
  draft: RecipeDraft;
  selected: boolean;
  status: 'Profile selected';
}

export type ProfileEditorOpenInput =
  | { type: 'new'; editingProfileId: null; profile: null; kind: NewProfileKind }
  | { type: 'edit'; editingProfileId: string; profile: Profile }
  | { type: 'missing' };

export type SaveProfileResult =
  | {
      type: 'saved';
      profileId: string;
      profiles: ProfileRecord[];
      editingId: string | null;
      cloneOfDefault: boolean;
      /**
       * The gateway content-hash-dedupes profiles (ignoring title), so creating
       * a profile whose brew settings match an existing one returns that
       * existing id instead of adding a new record — true means no new profile
       * was created and the caller should say so rather than imply success.
       */
      deduped: boolean;
      /** The profile this save retired, when it superseded one. */
      supersededId: string | null;
      status: string;
    }
  | {
      type: 'failed';
      cloneOfDefault: boolean;
      status: 'Save profile failed';
      error: unknown;
    }
  | {
      /**
       * Refused before it could be sent: these settings already belong to a
       * different profile, and reaprime cannot hold two profiles with the same
       * settings. See `conflictingProfile` for why this must never be attempted.
       */
      type: 'blocked';
      conflictId: string;
      conflictTitle: string;
      cloneOfDefault: boolean;
      status: 'Save profile blocked';
      message: string;
    };

export interface OriginalProfileDeps {
  /** Read one profile by id — the visible list alone can't be trusted to hold it. */
  loadProfile(id: string): Promise<ProfileRecord>;
}

/**
 * The profile this one was saved from, if any. Editing a bundled default saves
 * a copy rather than writing the default in place (see `profileSaveMode`), and
 * reaprime records that copy's `parentId` — so a profile with a parent is one
 * whose settings can be put back the way they shipped.
 */
export function originalProfileId(
  profiles: ProfileRecord[],
  editingId: string | null
): string | null {
  if (!editingId) return null;
  return profiles.find((item) => item.id === editingId)?.parentId ?? null;
}

// A chain this long is already pathological; the cap just stops a cycle or a
// runaway ancestry from spinning the editor.
const MAX_PROFILE_ANCESTRY = 8;

/**
 * Walk up the parent chain to the profile a derived one ultimately came from —
 * normally the bundled default it was first saved off, which is where the walk
 * stops. Returns null only when the chain yields nothing.
 */
export async function loadOriginalProfile(
  parentId: string,
  deps: OriginalProfileDeps
): Promise<ProfileRecord | null> {
  const seen = new Set<string>();
  let record: ProfileRecord | null = null;
  let id: string | null = parentId;
  while (id && !seen.has(id) && seen.size < MAX_PROFILE_ANCESTRY) {
    seen.add(id);
    record = await deps.loadProfile(id);
    if (record.isDefault) break;
    id = record.parentId ?? null;
  }
  return record;
}

export function profileSaveMode(
  profiles: ProfileRecord[],
  editingId: string | null
): { cloneOfDefault: boolean; update: boolean } {
  const editingRecord = editingId ? profiles.find((item) => item.id === editingId) : undefined;
  const cloneOfDefault = Boolean(editingId) && editingRecord?.isDefault === true;
  return {
    cloneOfDefault,
    update: Boolean(editingId) && !cloneOfDefault
  };
}

/**
 * The other profile these settings already belong to, or null.
 *
 * A profile's id IS the hash of its settings, so two profiles cannot both carry
 * the same ones. On an update that matters far beyond a rejected save:
 * reaprime's `ProfileController.update` deletes the old row and inserts the new
 * one as two separate, untransacted statements, so a colliding update DELETES
 * the profile being edited and then fails its INSERT on the unique index — the
 * edited profile is simply gone. Restoring a copy to its original is the easy
 * way to land there, since that makes the copy identical to its parent.
 *
 * Only the visible list can be checked, so a collision with a hidden or
 * soft-deleted profile still reaches the gateway.
 */
export function conflictingProfile(
  profiles: ProfileRecord[],
  profile: Profile,
  editingId: string | null
): ProfileRecord | null {
  const signature = profileExecutionSignature(profile);
  return (
    profiles.find(
      (item) => item.id !== editingId && profileExecutionSignature(item.profile) === signature
    ) ?? null
  );
}

/**
 * `base`, or the first free numbering of it — "Gentle and sweet 2".
 *
 * Two profiles carrying the same name are indistinguishable in the list, so
 * nothing is ever saved under a name that is already taken. A profile saved over
 * one of Decent's keeps its name outright, since the original leaves the list
 * and there is nothing left to tell it apart from.
 */
export function uniqueProfileTitle(profiles: ProfileRecord[], base: string): string {
  const taken = new Set(profiles.map((item) => (item.profile.title ?? '').trim()));
  const stem = base.trim() || 'Profile';
  if (!taken.has(stem)) return stem;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${stem} ${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return stem;
}

/**
 * The original this profile replaced, or null.
 *
 * Saving over one of Decent's built-ins stores the edit as a new profile and
 * retires the original, so what the user sees is their version standing where
 * the built-in stood. The trail is `parentId` plus the original's absence from
 * the visible list — no bookkeeping to drift out of step with the gateway. A
 * parent that is still listed was copied rather than replaced, and there is
 * nothing to put back.
 */
export function supersededOriginalId(
  profiles: ProfileRecord[],
  editingId: string | null
): string | null {
  const parentId = originalProfileId(profiles, editingId);
  if (!parentId) return null;
  return profiles.some((item) => item.id === parentId) ? null : parentId;
}

/**
 * Whether a hidden profile is one a user's own version has replaced, and so
 * should not be listed even among hidden profiles.
 *
 * reaprime will not let a bundled default be deleted or purged — `hidden` is
 * the furthest it can be pushed (`ProfileController.setVisibility`) — so the
 * last step of taking it out of sight is Beanie's to make. Derived from the
 * visible list rather than stored, so un-hiding the original or deleting the
 * replacement puts it straight back.
 */
export function isSupersededOriginal(
  hidden: ProfileRecord,
  visibleProfiles: ProfileRecord[]
): boolean {
  return visibleProfiles.some((item) => item.parentId === hidden.id);
}

export function toggleFavoriteProfileIds(
  favoriteProfileIds: readonly string[],
  profileId: string
): string[] {
  const favorites = new Set(favoriteProfileIds);
  if (favorites.has(profileId)) favorites.delete(profileId);
  else favorites.add(profileId);
  return [...favorites];
}

export function toggleFavoriteProfile(
  input: ToggleFavoriteProfileInput,
  deps: ToggleFavoriteProfileDeps
): ToggleFavoriteProfileResult {
  const favoriteProfileIds = toggleFavoriteProfileIds(input.favoriteProfileIds, input.profileId);
  deps.writeFavoriteProfiles(favoriteProfileIds);
  return {
    favoriteProfileIds,
    favorite: favoriteProfileIds.includes(input.profileId)
  };
}

export function selectProfileForDraft(input: SelectProfileForDraftInput): SelectProfileForDraftResult {
  const record = input.profiles.find((profile) => profile.id === input.profileId);
  const draft = { ...input.draft };
  if (record) {
    draft.profileId = record.id;
    draft.profile = record.profile;
    draft.profileTitle = record.profile.title ?? null;
    draft.brewTemp = null;
  }
  return {
    draft: normalizeDraft(draft, input.profiles, input.grinders),
    selected: record != null,
    status: 'Profile selected'
  };
}

/**
 * Start a new profile of a chosen kind. Creation is the only point a profile's
 * kind is picked — thereafter its steps say what it is, and the editor follows
 * (see createProfileEditorState).
 */
export function newProfileEditorInput(kind: NewProfileKind): ProfileEditorOpenInput {
  return { type: 'new', editingProfileId: null, profile: null, kind };
}

export function editProfileEditorInput(
  profiles: ProfileRecord[],
  profileId: string
): ProfileEditorOpenInput {
  const record = profiles.find((profile) => profile.id === profileId);
  if (!record) return { type: 'missing' };
  return { type: 'edit', editingProfileId: profileId, profile: record.profile };
}

export interface RestoreOriginalInput {
  profiles: ProfileRecord[];
  /** Retired profiles, where a superseded original now lives. */
  hiddenProfiles: ProfileRecord[];
  /** The profile saved over the original — the one that gets deleted. */
  editingId: string;
  originalId: string;
  demo: boolean;
}

export interface RestoreOriginalDeps {
  unhideProfile(id: string): Promise<void>;
  deleteProfile(id: string): Promise<void>;
  loadProfiles(): Promise<ProfileRecord[]>;
  invalidateProfileMutation(profileId: string): Promise<void>;
  putProfiles(profiles: ProfileRecord[]): Promise<void>;
}

export type RestoreOriginalResult =
  | { type: 'restored'; original: ProfileRecord; profiles: ProfileRecord[]; status: string }
  | { type: 'failed'; status: string; error: unknown };

/**
 * Undo a save made over one of Decent's built-ins: put the original back in the
 * list and delete the version that replaced it.
 *
 * The order is deliberate. Un-hiding comes first, so a failure leaves the user
 * holding their own profile with nothing lost; deleting first could leave them
 * with neither. The delete is reaprime's soft delete, so the replacement leaves
 * the list without being destroyed outright.
 */
export async function restoreOriginalProfile(
  input: RestoreOriginalInput,
  deps: RestoreOriginalDeps
): Promise<RestoreOriginalResult> {
  if (input.demo) {
    const original =
      input.profiles.find((item) => item.id === input.originalId)
      ?? input.hiddenProfiles.find((item) => item.id === input.originalId);
    if (!original) return { type: 'failed', status: 'Could not find the original profile', error: null };
    const profiles = [
      original,
      ...input.profiles.filter((item) => item.id !== input.editingId && item.id !== input.originalId)
    ];
    return { type: 'restored', original, profiles, status: 'Original profile restored (demo)' };
  }

  try {
    await deps.unhideProfile(input.originalId);
    await deps.deleteProfile(input.editingId);
    await deps.invalidateProfileMutation(input.editingId).catch(() => {});
    const profiles = await deps.loadProfiles();
    await deps.putProfiles(profiles).catch(() => {});
    const original = profiles.find((item) => item.id === input.originalId);
    if (!original) {
      return { type: 'failed', status: 'Could not find the original profile', error: null };
    }
    return { type: 'restored', original, profiles, status: 'Original profile restored' };
  } catch (error) {
    return { type: 'failed', status: 'Could not restore the original profile', error };
  }
}

export async function saveProfile(
  input: SaveProfileInput,
  deps: SaveProfileDeps
): Promise<SaveProfileResult> {
  const mode = profileSaveMode(input.profiles, input.editingId);
  // Save a copy never writes the source: it always creates, and never retires
  // what it came from — that being the whole point of it.
  const copying = input.intent === 'copy';
  const update = mode.update && !copying;
  const supersedes = !copying && mode.cloneOfDefault;

  // Only an update is destructive on collision — a create that matches simply
  // returns the existing record, which the `deduped` path already reports.
  if (update) {
    const conflict = conflictingProfile(input.profiles, input.profile, input.editingId);
    if (conflict) {
      const title = conflict.profile.title?.trim();
      return {
        type: 'blocked',
        conflictId: conflict.id,
        conflictTitle: title ?? '',
        cloneOfDefault: mode.cloneOfDefault,
        status: 'Save profile blocked',
        message: title
          ? `These settings are identical to “${title}”. Your machine can’t hold two profiles that brew the same, so change something here — or just use “${title}”.`
          : 'These settings are identical to another profile. Your machine can’t hold two profiles that brew the same, so change something before saving.'
      };
    }
  }

  if (input.demo) {
    const record: ProfileRecord = {
      id: update ? input.editingId! : `demo-profile-${input.nowMs}`,
      profile: input.profile,
      parentId: update ? undefined : (input.editingId ?? undefined)
    };
    const listed = update
      ? input.profiles.map((item) => (item.id === input.editingId ? record : item))
      : [record, ...input.profiles];
    // Demo stands in for the gateway hiding the original, so replacing a
    // built-in looks the same here as it does on a machine.
    const profiles = supersedes
      ? listed.map((item) => (item.id === input.editingId ? { ...item, parentId: item.parentId } : item))
          .filter((item) => item.id !== input.editingId)
      : listed;
    return {
      type: 'saved',
      profileId: record.id,
      profiles,
      editingId: null,
      cloneOfDefault: mode.cloneOfDefault,
      deduped: false,
      supersededId: supersedes ? input.editingId : null,
      status: supersedes ? 'Profile saved (demo)' : mode.cloneOfDefault ? 'Saved a copy (demo)' : 'Profile saved (demo)'
    };
  }

  try {
    let saved = update
      ? await deps.updateProfile(input.editingId!, { profile: input.profile })
      : await deps.createProfile({ profile: input.profile, parentId: input.editingId ?? undefined });
    // A create that returns an id already in our (visible) list means the gateway
    // matched an existing identical-settings profile rather than creating one.
    let deduped = !update && input.profiles.some((item) => item.id === saved.id);
    await deps.invalidateProfileMutation(saved.id).catch(() => {});

    let profiles: ProfileRecord[];
    try {
      profiles = await deps.loadProfiles();
    } catch {
      profiles = input.profiles.some((item) => item.id === saved.id)
        ? input.profiles.map((item) => (item.id === saved.id ? saved : item))
        : [saved, ...input.profiles];
      await deps.putProfiles(profiles).catch(() => {});
      return {
        type: 'saved',
        profileId: saved.id,
        profiles,
        editingId: null,
        cloneOfDefault: mode.cloneOfDefault,
        deduped,
        supersededId: null,
        status: mode.cloneOfDefault ? 'Saved a copy' : 'Profile saved'
      };
    }

    // The gateway content-hash-dedupes (ignoring title) and can match a hidden or
    // soft-deleted profile, returning it 201 *without* making it visible — so the
    // "new" profile never shows in the list. When the saved id is missing from the
    // freshly-loaded visible list, restore it and re-apply the user's edits (their
    // title) so the save actually appears as intended.
    if (!update && !deduped && !profiles.some((item) => item.id === saved.id)) {
      await deps.restoreProfile(saved.id).catch(() => {});
      saved = await deps.updateProfile(saved.id, { profile: input.profile });
      profiles = await deps.loadProfiles().catch(() => profiles);
      deduped = false;
    }

    // Retire the original only once the replacement is known to exist, and never
    // when the "copy" turned out to BE the original (an unchanged save dedupes
    // straight back to it) — hiding it then would retire the very profile just
    // saved. A failure here leaves both listed, which is recoverable by hand.
    let supersededId: string | null = null;
    if (supersedes && !deduped && saved.id !== input.editingId) {
      try {
        await deps.hideProfile(input.editingId!);
        supersededId = input.editingId;
        profiles = await deps.loadProfiles().catch(() => profiles);
        await deps.putProfiles(profiles).catch(() => {});
      } catch {
        supersededId = null;
      }
    }

    await deps.putProfiles(profiles).catch(() => {});
    return {
      type: 'saved',
      profileId: saved.id,
      profiles,
      editingId: null,
      cloneOfDefault: mode.cloneOfDefault,
      deduped,
      supersededId,
      status: supersededId ? 'Profile saved' : mode.cloneOfDefault ? 'Saved a copy' : 'Profile saved'
    };
  } catch (error) {
    return {
      type: 'failed',
      cloneOfDefault: mode.cloneOfDefault,
      status: 'Save profile failed',
      error
    };
  }
}
