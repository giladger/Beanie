import type { Profile, ProfileRecord } from '../api/types';
import {
  editProfileEditorInput,
  newProfileEditorInput,
  profileSaveMode,
  saveProfile,
  selectProfileForDraft,
  toggleFavoriteProfile,
  toggleFavoriteProfileIds
} from '../controllers/profileEditorController';

await run('profile save mode updates custom profiles and clones defaults', () => {
  const profiles = [
    record('default', 'Default', true),
    record('custom', 'Custom', false)
  ];

  deepEqual(profileSaveMode(profiles, 'custom'), { cloneOfDefault: false, update: true });
  deepEqual(profileSaveMode(profiles, 'default'), { cloneOfDefault: true, update: false });
  deepEqual(profileSaveMode(profiles, null), { cloneOfDefault: false, update: false });
});

await run('profile favorite toggle preserves order and persists the next list', () => {
  deepEqual(toggleFavoriteProfileIds(['a', 'b'], 'b'), ['a']);
  deepEqual(toggleFavoriteProfileIds(['a'], 'b'), ['a', 'b']);

  let written: string[] = [];
  const result = toggleFavoriteProfile({
    favoriteProfileIds: ['a'],
    profileId: 'b'
  }, {
    writeFavoriteProfiles: (ids) => {
      written = ids;
    }
  });

  deepEqual(result.favoriteProfileIds, ['a', 'b']);
  equal(result.favorite, true);
  deepEqual(written, ['a', 'b']);
});

await run('profile selection updates the recipe draft and clears temperature offsets', () => {
  const selected = selectProfileForDraft({
    draft: {
      profileId: 'old',
      profile: profile('Old'),
      profileTitle: 'Old',
      brewTemp: 92,
      dose: 18,
      yield: 36
    },
    profiles: [record('new', 'New')],
    grinders: [],
    profileId: 'new'
  });

  equal(selected.selected, true);
  equal(selected.status, 'Profile selected');
  equal(selected.draft.profileId, 'new');
  equal(selected.draft.profile?.title, 'New');
  equal(selected.draft.profileTitle, 'New');
  equal(selected.draft.brewTemp, null);
});

await run('profile selection normalizes even when the profile id is missing', () => {
  const selected = selectProfileForDraft({
    draft: {
      profileId: null,
      profile: null,
      profileTitle: null,
      brewTemp: null,
      dose: 18,
      yield: null
    },
    profiles: [record('fallback', 'Fallback')],
    grinders: [],
    profileId: 'missing'
  });

  equal(selected.selected, false);
  equal(selected.draft.profileId, null);
  equal(selected.draft.profileTitle, null);
  equal(selected.draft.yield, null);
});

await run('profile editor open input models new edit and missing records', () => {
  deepEqual(newProfileEditorInput(), { type: 'new', editingProfileId: null, profile: null });

  const edit = editProfileEditorInput([record('custom', 'Custom')], 'custom');
  equal(edit.type, 'edit');
  equal(edit.type === 'edit' ? edit.editingProfileId : null, 'custom');
  equal(edit.type === 'edit' ? edit.profile.title : null, 'Custom');

  deepEqual(editProfileEditorInput([], 'missing'), { type: 'missing' });
});

await run('profile editor controller saves demo profile copies locally', async () => {
  const result = await saveProfile(
    {
      profiles: [record('default', 'Default', true)],
      editingId: 'default',
      profile: profile('Copy'),
      demo: true,
      nowMs: 123
    },
    failingProfileDeps()
  );

  equal(result.type, 'saved');
  equal(result.type === 'saved' ? result.profileId : null, 'demo-profile-123');
  equal(result.type === 'saved' ? result.profiles.length : null, 2);
  equal(result.type === 'saved' ? result.status : null, 'Saved a copy (demo)');
});

await run('profile editor controller updates remote profiles and caches loaded profiles', async () => {
  let invalidated: string | null = null;
  let cachedCount = 0;
  const result = await saveProfile(
    {
      profiles: [record('custom', 'Custom')],
      editingId: 'custom',
      profile: profile('Updated'),
      demo: false,
      nowMs: 123
    },
    {
      createProfile: async () => {
        throw new Error('unexpected create');
      },
      updateProfile: async (id, input) => ({ id, profile: input.profile }),
      loadProfiles: async () => [record('custom', 'Updated')],
      invalidateProfileMutation: async (id) => {
        invalidated = id;
      },
      putProfiles: async (profiles) => {
        cachedCount = profiles.length;
      }
    }
  );

  equal(result.type, 'saved');
  equal(result.type === 'saved' ? result.profileId : null, 'custom');
  equal(result.type === 'saved' ? result.status : null, 'Profile saved');
  equal(invalidated, 'custom');
  equal(cachedCount, 1);
});

await run('profile editor controller falls back to saved record when profile reload fails', async () => {
  const result = await saveProfile(
    {
      profiles: [record('custom', 'Custom')],
      editingId: 'custom',
      profile: profile('Updated'),
      demo: false,
      nowMs: 123
    },
    {
      createProfile: async () => {
        throw new Error('unexpected create');
      },
      updateProfile: async (id, input) => ({ id, profile: input.profile }),
      loadProfiles: async () => {
        throw new Error('offline');
      },
      invalidateProfileMutation: async () => {},
      putProfiles: async () => {}
    }
  );

  equal(result.type, 'saved');
  equal(result.type === 'saved' ? result.profiles[0]?.profile.title : null, 'Updated');
});

await run('profile editor controller reports gateway save failures', async () => {
  const result = await saveProfile(
    {
      profiles: [],
      editingId: null,
      profile: profile('New'),
      demo: false,
      nowMs: 123
    },
    {
      createProfile: async () => {
        throw new Error('nope');
      },
      updateProfile: async () => {
        throw new Error('unexpected update');
      },
      loadProfiles: async () => [],
      invalidateProfileMutation: async () => {},
      putProfiles: async () => {}
    }
  );

  equal(result.type, 'failed');
  equal(result.type === 'failed' ? result.status : null, 'Save profile failed');
});

function profile(title: string): Profile {
  return {
    title,
    steps: []
  };
}

function record(id: string, title: string, isDefault = false): ProfileRecord {
  return {
    id,
    profile: profile(title),
    isDefault
  };
}

function failingProfileDeps() {
  return {
    createProfile: async () => {
      throw new Error('unexpected create');
    },
    updateProfile: async () => {
      throw new Error('unexpected update');
    },
    loadProfiles: async () => {
      throw new Error('unexpected load');
    },
    invalidateProfileMutation: async () => {
      throw new Error('unexpected invalidate');
    },
    putProfiles: async () => {
      throw new Error('unexpected cache');
    }
  };
}

function run(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`ok - ${name}`);
    })
    .catch((error) => {
      console.error(`not ok - ${name}`);
      throw error;
    });
}

function equal<T>(actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(`Expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`);
  }
}

function deepEqual<T>(actual: T, expected: T): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`);
  }
}
