import type { Grinder, Profile, ProfileRecord, RecipeDraft } from '../api/types';
import { normalizeDraft } from '../domain/beanWorkflow';

export interface SaveProfileInput {
  profiles: ProfileRecord[];
  editingId: string | null;
  profile: Profile;
  demo: boolean;
  nowMs: number;
}

export interface SaveProfileDeps {
  createProfile(input: { profile: Profile; parentId?: string }): Promise<ProfileRecord>;
  updateProfile(id: string, input: { profile: Profile }): Promise<ProfileRecord>;
  loadProfiles(): Promise<ProfileRecord[]>;
  invalidateProfileMutation(profileId: string): Promise<void>;
  putProfiles(profiles: ProfileRecord[]): Promise<void>;
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
  | { type: 'new'; editingProfileId: null; profile: null }
  | { type: 'edit'; editingProfileId: string; profile: Profile }
  | { type: 'missing' };

export type SaveProfileResult =
  | {
      type: 'saved';
      profileId: string;
      profiles: ProfileRecord[];
      editingId: string | null;
      cloneOfDefault: boolean;
      status: string;
    }
  | {
      type: 'failed';
      cloneOfDefault: boolean;
      status: 'Save profile failed';
      error: unknown;
    };

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

export function newProfileEditorInput(): ProfileEditorOpenInput {
  return { type: 'new', editingProfileId: null, profile: null };
}

export function editProfileEditorInput(
  profiles: ProfileRecord[],
  profileId: string
): ProfileEditorOpenInput {
  const record = profiles.find((profile) => profile.id === profileId);
  if (!record) return { type: 'missing' };
  return { type: 'edit', editingProfileId: profileId, profile: record.profile };
}

export async function saveProfile(
  input: SaveProfileInput,
  deps: SaveProfileDeps
): Promise<SaveProfileResult> {
  const mode = profileSaveMode(input.profiles, input.editingId);

  if (input.demo) {
    const record: ProfileRecord = {
      id: mode.update ? input.editingId! : `demo-profile-${input.nowMs}`,
      profile: input.profile
    };
    const profiles = mode.update
      ? input.profiles.map((item) => (item.id === input.editingId ? record : item))
      : [record, ...input.profiles];
    return {
      type: 'saved',
      profileId: record.id,
      profiles,
      editingId: null,
      cloneOfDefault: mode.cloneOfDefault,
      status: mode.cloneOfDefault ? 'Saved a copy (demo)' : 'Profile saved (demo)'
    };
  }

  try {
    const saved = mode.update
      ? await deps.updateProfile(input.editingId!, { profile: input.profile })
      : await deps.createProfile({ profile: input.profile, parentId: input.editingId ?? undefined });
    await deps.invalidateProfileMutation(saved.id).catch(() => {});

    let profiles: ProfileRecord[];
    try {
      profiles = await deps.loadProfiles();
    } catch {
      profiles = input.profiles.some((item) => item.id === saved.id)
        ? input.profiles.map((item) => (item.id === saved.id ? saved : item))
        : [saved, ...input.profiles];
    }

    await deps.putProfiles(profiles).catch(() => {});
    return {
      type: 'saved',
      profileId: saved.id,
      profiles,
      editingId: null,
      cloneOfDefault: mode.cloneOfDefault,
      status: mode.cloneOfDefault ? 'Saved a copy' : 'Profile saved'
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
