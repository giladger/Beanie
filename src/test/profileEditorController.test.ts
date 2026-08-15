import type { Profile, ProfileRecord } from '../api/types';
import {
  conflictingProfile,
  isSupersededOriginal,
  editProfileEditorInput,
  loadOriginalProfile,
  newProfileEditorInput,
  originalProfileId,
  restoreOriginalProfile,
  profileSaveMode,
  saveProfile,
  selectProfileForDraft,
  supersededOriginalId,
  toggleFavoriteProfile,
  toggleFavoriteProfileIds,
  uniqueProfileTitle
} from '../controllers/profileEditorController';
import { carryProfileFavorite } from '../domain/profileIdentity';

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
  // A new profile carries the kind it was created as — the only point one is chosen.
  deepEqual(newProfileEditorInput('flow'), {
    type: 'new',
    editingProfileId: null,
    profile: null,
    kind: 'flow'
  });
  deepEqual(newProfileEditorInput('advanced'), {
    type: 'new',
    editingProfileId: null,
    profile: null,
    kind: 'advanced'
  });

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
      nowMs: 123,
      intent: 'save' as const
    },
    failingProfileDeps()
  );

  equal(result.type, 'saved');
  equal(result.type === 'saved' ? result.profileId : null, 'demo-profile-123');
  // A plain Save over a built-in replaces it: the copy stands where it stood.
  equal(result.type === 'saved' ? result.profiles.length : null, 1);
  equal(result.type === 'saved' ? result.profiles[0]?.id : null, 'demo-profile-123');
  equal(result.type === 'saved' ? result.profiles[0]?.parentId : null, 'default');
  equal(result.type === 'saved' ? result.status : null, 'Profile saved (demo)');
  equal(result.type === 'saved' ? result.supersededId : null, 'default');
});

await run('undoing a replacement puts the original back and drops the copy', async () => {
  const original = record('orig', 'Gentle and sweet', true);
  const mine = { ...record('mine', 'Gentle and sweet (copy)'), parentId: 'orig' };

  const calls: string[] = [];
  const result = await restoreOriginalProfile(
    { profiles: [mine], hiddenProfiles: [original], editingId: 'mine', originalId: 'orig', demo: false },
    {
      // un-hiding comes first: a failure there must leave the copy untouched
      unhideProfile: async (id) => { calls.push(`unhide:${id}`); },
      deleteProfile: async (id) => { calls.push(`delete:${id}`); },
      loadProfiles: async () => [original],
      invalidateProfileMutation: async () => {},
      putProfiles: async () => {}
    }
  );
  equal(result.type, 'restored');
  equal(result.type === 'restored' ? result.original.id : null, 'orig');
  deepEqual(calls, ['unhide:orig', 'delete:mine']);

  // if un-hiding fails, nothing is deleted
  const aborted: string[] = [];
  const failed = await restoreOriginalProfile(
    { profiles: [mine], hiddenProfiles: [original], editingId: 'mine', originalId: 'orig', demo: false },
    {
      unhideProfile: async () => { throw new Error('offline'); },
      deleteProfile: async (id) => { aborted.push(id); },
      loadProfiles: async () => [],
      invalidateProfileMutation: async () => {},
      putProfiles: async () => {}
    }
  );
  equal(failed.type, 'failed');
  deepEqual(aborted, []);
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
      nowMs: 123,
      intent: 'save' as const
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
      },
      restoreProfile: async () => {},
      hideProfile: async () => {}
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
      nowMs: 123,
      intent: 'save' as const
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
      putProfiles: async () => {},
      restoreProfile: async () => {},
      hideProfile: async () => {}
    }
  );

  equal(result.type, 'saved');
  equal(result.type === 'saved' ? result.profiles[0]?.profile.title : null, 'Updated');
});

await run('profile editor controller flags a content-hash-deduped create', async () => {
  // The gateway returns an existing id when the new profile's settings match
  // one already in the list — no new profile was created.
  const result = await saveProfile(
    {
      profiles: [record('existing', 'Existing')],
      editingId: null,
      profile: profile('Different name, same settings'),
      demo: false,
      nowMs: 123,
      intent: 'save' as const
    },
    {
      createProfile: async () => ({ id: 'existing', profile: profile('Existing') }),
      updateProfile: async () => {
        throw new Error('unexpected update');
      },
      loadProfiles: async () => [record('existing', 'Existing')],
      invalidateProfileMutation: async () => {},
      putProfiles: async () => {},
      restoreProfile: async () => {},
      hideProfile: async () => {}
    }
  );

  equal(result.type, 'saved');
  equal(result.type === 'saved' ? result.deduped : null, true);
});

await run('profile editor controller marks a genuinely new create as not deduped', async () => {
  const result = await saveProfile(
    {
      profiles: [record('existing', 'Existing')],
      editingId: null,
      profile: profile('Brand new'),
      demo: false,
      nowMs: 123,
      intent: 'save' as const
    },
    {
      createProfile: async () => ({ id: 'fresh', profile: profile('Brand new') }),
      updateProfile: async () => {
        throw new Error('unexpected update');
      },
      loadProfiles: async () => [record('fresh', 'Brand new'), record('existing', 'Existing')],
      invalidateProfileMutation: async () => {},
      putProfiles: async () => {},
      restoreProfile: async () => {},
      hideProfile: async () => {}
    }
  );

  equal(result.type, 'saved');
  equal(result.type === 'saved' ? result.deduped : null, false);
});

await run('profile editor controller restores a create that matched a hidden/deleted record', async () => {
  // The gateway content-hash-matched a soft-deleted profile and returned it
  // (201) without making it visible, so it's absent from the first reload. The
  // controller must restore it and re-apply the user's title so it appears.
  let restored: string | null = null;
  let updatedTitle: string | null = null;
  let loads = 0;
  const result = await saveProfile(
    {
      profiles: [record('other', 'Other')],
      editingId: null,
      profile: profile('Resurrected'),
      demo: false,
      nowMs: 123,
      intent: 'save' as const
    },
    {
      createProfile: async () => ({ id: 'ghost', profile: profile('Old deleted title') }),
      updateProfile: async (id, input) => {
        updatedTitle = input.profile.title ?? null;
        return { id, profile: input.profile };
      },
      loadProfiles: async () => {
        loads += 1;
        // First reload: ghost still hidden/deleted. After restore+update: visible.
        return loads === 1
          ? [record('other', 'Other')]
          : [record('ghost', 'Resurrected'), record('other', 'Other')];
      },
      invalidateProfileMutation: async () => {},
      putProfiles: async () => {},
      restoreProfile: async (id) => {
        restored = id;
      },
      hideProfile: async () => {}
    }
  );

  equal(result.type, 'saved');
  equal(result.type === 'saved' ? result.profileId : null, 'ghost');
  equal(restored, 'ghost');
  equal(updatedTitle, 'Resurrected');
  equal(result.type === 'saved' ? result.deduped : null, false);
  equal(result.type === 'saved' ? result.profiles.some((p) => p.id === 'ghost') : null, true);
});

await run('profile editor controller reports gateway save failures', async () => {
  const result = await saveProfile(
    {
      profiles: [],
      editingId: null,
      profile: profile('New'),
      demo: false,
      nowMs: 123,
      intent: 'save' as const
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
      putProfiles: async () => {},
      restoreProfile: async () => {},
      hideProfile: async () => {}
    }
  );

  equal(result.type, 'failed');
  equal(result.type === 'failed' ? result.status : null, 'Save profile failed');
});

await run('only a profile saved off another one offers an original to restore', () => {
  const profiles = [
    record('default', 'Default', true),
    { ...record('copy', 'Default'), parentId: 'default' },
    record('scratch', 'Scratch')
  ];

  equal(originalProfileId(profiles, 'copy'), 'default');
  equal(originalProfileId(profiles, 'default'), null); // a bundled default is the original
  equal(originalProfileId(profiles, 'scratch'), null); // never saved off anything
  equal(originalProfileId(profiles, 'missing'), null);
  equal(originalProfileId(profiles, null), null);
});

await run('restoring an original walks up to the bundled default it came from', async () => {
  const chain: Record<string, ProfileRecord> = {
    root: record('root', 'Bundled', true),
    mid: { ...record('mid', 'Mid'), parentId: 'root' }
  };
  const asked: string[] = [];
  const original = await loadOriginalProfile('mid', {
    loadProfile: async (id) => {
      asked.push(id);
      return chain[id]!;
    }
  });

  equal(original?.id, 'root');
  equal(asked.join(','), 'mid,root');
});

await run('restoring an original stops at a parentless profile and survives a cycle', async () => {
  const orphan = await loadOriginalProfile('lone', {
    loadProfile: async () => record('lone', 'Lone')
  });
  equal(orphan?.id, 'lone');

  // A parent chain that points back at itself must terminate, not spin.
  let reads = 0;
  const cyclic: Record<string, ProfileRecord> = {
    a: { ...record('a', 'A'), parentId: 'b' },
    b: { ...record('b', 'B'), parentId: 'a' }
  };
  const looped = await loadOriginalProfile('a', {
    loadProfile: async (id) => {
      reads += 1;
      if (reads > 8) throw new Error('unbounded ancestry walk');
      return cyclic[id]!;
    }
  });
  equal(looped != null, true);
  equal(reads, 2);
});

await run('a built-in is superseded by the version saved over it, and only then', () => {
  const original = record('orig', 'Gentle and sweet', true);
  const mine = { ...record('mine', 'Gentle and sweet (copy)'), parentId: 'orig' };

  // The original is gone from the visible list, so the profile that replaced it
  // has something to put back.
  equal(supersededOriginalId([mine], 'mine'), 'orig');
  // Copied rather than replaced: the original is still listed, nothing to undo.
  equal(supersededOriginalId([original, mine], 'mine'), null);
  // Nothing was saved off anything.
  equal(supersededOriginalId([record('scratch', 'Scratch')], 'scratch'), null);
  equal(supersededOriginalId([mine], null), null);

  // The hidden original is filtered out of the hidden list while its
  // replacement stands, and reappears the moment that goes.
  equal(isSupersededOriginal(original, [mine]), true);
  equal(isSupersededOriginal(original, []), false);
  equal(isSupersededOriginal(original, [record('unrelated', 'Unrelated')]), false);
});

await run('Save a copy always creates, and never writes the profile it came from', async () => {
  // A user's own profile is normally written in place, but Save a copy must
  // create a separate one — otherwise "copy" quietly overwrites the source.
  const mine = record('mine', 'Mine');
  let updated = false;
  let createdParent: string | undefined;
  const result = await saveProfile(
    { profiles: [mine], editingId: 'mine', profile: profile('Mine v2'), demo: false, nowMs: 1, intent: 'copy' as const },
    {
      ...failingProfileDeps(),
      updateProfile: async () => { updated = true; throw new Error('must not update'); },
      createProfile: async (input) => { createdParent = input.parentId; return { id: 'fresh', profile: input.profile }; },
      loadProfiles: async () => [record('fresh', 'Mine v2'), mine],
      invalidateProfileMutation: async () => {},
      putProfiles: async () => {}
    }
  );
  equal(result.type, 'saved');
  equal(result.type === 'saved' ? result.profileId : null, 'fresh');
  equal(updated, false);
  equal(createdParent, 'mine');
  // the source is still listed
  equal(result.type === 'saved' ? result.profiles.some((p) => p.id === 'mine') : null, true);
});

await run('a plain save retires the built-in, a copy leaves it standing', async () => {
  const profiles = [record('default', 'Gentle and sweet', true)];
  const track = () => {
    const hidden: string[] = [];
    return {
      hidden,
      deps: {
        ...failingProfileDeps(),
        createProfile: async () => ({ id: 'copy', profile: profile('Gentle and sweet (copy)') }),
        loadProfiles: async () => [record('copy', 'Gentle and sweet (copy)'), ...profiles],
        invalidateProfileMutation: async () => {},
        putProfiles: async () => {},
        hideProfile: async (id: string) => { hidden.push(id); }
      }
    };
  };

  const save = track();
  const saved = await saveProfile(
    { profiles, editingId: 'default', profile: profile('Gentle and sweet (copy)'), demo: false, nowMs: 1, intent: 'save' as const },
    save.deps
  );
  equal(saved.type === 'saved' ? saved.supersededId : null, 'default');
  deepEqual(save.hidden, ['default']);

  const copy = track();
  const copied = await saveProfile(
    { profiles, editingId: 'default', profile: profile('Gentle and sweet (copy)'), demo: false, nowMs: 1, intent: 'copy' as const },
    copy.deps
  );
  equal(copied.type === 'saved' ? copied.supersededId : null, null);
  deepEqual(copy.hidden, []);
});

await run('an unchanged save over a built-in never retires it', async () => {
  // With nothing changed the "copy" dedupes straight back to the built-in, so
  // hiding it would retire the very profile just saved.
  const profiles = [record('default', 'Gentle and sweet', true)];
  const hidden: string[] = [];
  const result = await saveProfile(
    { profiles, editingId: 'default', profile: profile('Gentle and sweet'), demo: false, nowMs: 1, intent: 'save' as const },
    {
      ...failingProfileDeps(),
      createProfile: async () => ({ id: 'default', profile: profile('Gentle and sweet') }),
      loadProfiles: async () => profiles,
      invalidateProfileMutation: async () => {},
      putProfiles: async () => {},
      hideProfile: async (id: string) => { hidden.push(id); }
    }
  );
  equal(result.type === 'saved' ? result.deduped : null, true);
  equal(result.type === 'saved' ? result.supersededId : null, null);
  deepEqual(hidden, []);
});

await run('a favourite follows its profile when a save re-ids it', () => {
  // A settings edit re-hashes the record and reaprime drops the old id: the
  // star moves with the profile, keeping its place in the list.
  deepEqual(
    carryProfileFavorite(['a', 'old', 'b'], { from: 'old', to: 'new', replaced: true }),
    ['a', 'new', 'b']
  );

  // A copy of a bundled default leaves the original standing, so the copy
  // inherits a star rather than stealing the original's.
  deepEqual(
    carryProfileFavorite(['default'], { from: 'default', to: 'copy', replaced: false }),
    ['default', 'copy']
  );

  // Nothing to carry: not a favourite, or the id never moved.
  deepEqual(carryProfileFavorite(['a'], { from: 'other', to: 'new', replaced: true }), ['a']);
  deepEqual(carryProfileFavorite(['a'], { from: 'a', to: 'a', replaced: true }), ['a']);

  // The destination already being a favourite must not duplicate it.
  deepEqual(
    carryProfileFavorite(['old', 'new'], { from: 'old', to: 'new', replaced: true }),
    ['new']
  );
});

await run('an update whose settings already belong to another profile is refused', async () => {
  // reaprime's update deletes the old row then inserts the new one, untransacted,
  // so a colliding update destroys the profile being edited and then fails its
  // INSERT on the unique index. Restoring a copy to its original lands exactly
  // there, since that makes the copy identical to its parent.
  const parent = { ...record('parent', 'Gentle and sweet', true), profile: brewProfile('Gentle and sweet', 6) };
  const copy = { ...record('copy', 'My gentle', false), parentId: 'parent', profile: brewProfile('My gentle', 9) };
  const profiles = [parent, copy];

  let touchedGateway = false;
  const deps = {
    ...failingProfileDeps(),
    updateProfile: async () => { touchedGateway = true; throw new Error('must not be called'); },
    createProfile: async () => { touchedGateway = true; throw new Error('must not be called'); }
  };
  // the user restored the original, so the copy now carries the parent's settings
  const result = await saveProfile(
    { profiles, editingId: 'copy', profile: brewProfile('My gentle', 6), demo: false, nowMs: 1, intent: 'save' as const },
    deps
  );
  equal(result.type, 'blocked');
  equal(result.type === 'blocked' ? result.conflictId : null, 'parent');
  equal(result.type === 'blocked' ? result.conflictTitle : null, 'Gentle and sweet');
  equal(touchedGateway, false);
  equal(result.type === 'blocked' ? /Gentle and sweet/.test(result.message) : false, true);

  // the title is not part of a profile's identity, so renaming alone still saves
  const renamed = await saveProfile(
    { profiles, editingId: 'copy', profile: brewProfile('Renamed', 9), demo: true, nowMs: 2, intent: 'save' as const },
    failingProfileDeps()
  );
  equal(renamed.type, 'saved');
});

await run('conflictingProfile ignores the profile being edited and the title', () => {
  const a = { ...record('a', 'A'), profile: brewProfile('A', 9) };
  const b = { ...record('b', 'B'), profile: brewProfile('B', 6) };
  const profiles = [a, b];
  // editing A and keeping its settings is not a conflict with itself
  equal(conflictingProfile(profiles, brewProfile('A renamed', 9), 'a'), null);
  // but taking B's settings is
  equal(conflictingProfile(profiles, brewProfile('A', 6), 'a')?.id, 'b');
  // a create (no editingId) sees A as a conflict, since nothing is excluded
  equal(conflictingProfile(profiles, brewProfile('C', 9), null)?.id, 'a');
});

await run('nothing is ever saved under a name that is already taken', () => {
  // A profile saved over one of Decent's keeps its name — the original leaves
  // the list, so there is nothing left to tell it apart from. Everything else
  // that would collide is numbered instead.
  equal(uniqueProfileTitle([], 'Gentle and sweet'), 'Gentle and sweet');
  equal(uniqueProfileTitle([record('a', 'Gentle and sweet')], 'Gentle and sweet'), 'Gentle and sweet 2');
  equal(
    uniqueProfileTitle(
      [record('a', 'Gentle and sweet'), record('b', 'Gentle and sweet 2')],
      'Gentle and sweet'
    ),
    'Gentle and sweet 3'
  );
  // an untaken name is left exactly as it is
  equal(uniqueProfileTitle([record('a', 'Other')], 'New profile'), 'New profile');
  equal(uniqueProfileTitle([], '  '), 'Profile');
});

function brewProfile(title: string, pressure: number): Profile {
  return {
    title,
    steps: [
      {
        name: 'hold',
        pump: 'pressure',
        pressure,
        temperature: 90,
        transition: 'fast',
        seconds: 20,
        volume: 0,
        weight: 0,
        sensor: 'coffee'
      }
    ],
    tank_temperature: 0,
    target_volume_count_start: 0
  } as unknown as Profile;
}

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
    },
    restoreProfile: async () => {
      throw new Error('unexpected restore');
    },
    hideProfile: async () => {
      throw new Error('unexpected hide');
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
