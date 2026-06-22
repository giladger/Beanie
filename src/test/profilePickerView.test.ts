import type { ProfileRecord } from '../api/types';
import {
  displayProfileType,
  profileShortTitle,
  renderPhoneProfilesPage,
  renderProfilesPage
} from '../views/profilePickerView';

const profiles: ProfileRecord[] = [
  {
    id: 'profile-flow',
    profile: {
      title: 'B-Flow/Sweet',
      author: 'Bob',
      notes: 'Flow profile',
      legacy_profile_type: 'settings_2b',
      steps: [{ flow: 2, seconds: 8 }] as unknown[]
    }
  },
  {
    id: 'profile-pressure',
    profile: {
      title: 'A-Pressure/Classic',
      author: 'Ada',
      notes: 'Pressure profile',
      legacy_profile_type: 'settings_2a',
      steps: [{ pressure: 8, seconds: 8 }] as unknown[]
    }
  }
];

run('profile picker renders favorites first and groups by title prefix', () => {
  const html = renderProfilesPage({
    profiles,
    search: '',
    favoriteProfileIds: ['profile-flow'],
    selectedId: 'profile-pressure',
    focusId: null,
    cleaningMode: false,
    showHidden: false,
    hiddenProfiles: [],
    pendingDeleteId: null
  });

  includes(html, 'Profiles');
  includes(html, 'Favorites');
  includes(html, 'Sweet');
  includes(html, 'Classic');
  includes(html, 'Selected');
  equal(html.indexOf('Sweet') < html.indexOf('Classic'), true);
});

run('profile picker filters by search and focuses the selected profile by default', () => {
  const html = renderProfilesPage({
    profiles,
    search: 'ada',
    favoriteProfileIds: [],
    selectedId: 'profile-pressure',
    focusId: null,
    cleaningMode: false,
    showHidden: false,
    hiddenProfiles: [],
    pendingDeleteId: null
  });

  includes(html, 'Classic');
  excludes(html, 'Sweet');
  includes(html, 'Pressure profile');
});

run('profile picker cleaning mode returns to machine and hides create action', () => {
  const html = renderProfilesPage({
    profiles,
    search: '',
    favoriteProfileIds: [],
    selectedId: 'profile-pressure',
    focusId: 'profile-pressure',
    cleaningMode: true,
    showHidden: false,
    hiddenProfiles: [],
    pendingDeleteId: null
  });

  includes(html, 'Cleaning profile');
  includes(html, 'data-value="machine"');
  excludes(html, 'data-action="new-profile"');
  // Browser-management actions stay out of the cleaning-profile picker.
  excludes(html, 'data-action="hide-profile"');
  excludes(html, 'data-action="toggle-show-hidden"');
});

run('phone profile picker renders title-only tap targets', () => {
  const html = renderPhoneProfilesPage({
    profiles,
    search: '',
    favoriteProfileIds: ['profile-flow'],
    selectedId: 'profile-pressure',
    focusId: null,
    cleaningMode: false,
    showHidden: false,
    hiddenProfiles: [],
    pendingDeleteId: null
  });

  includes(html, 'phone-profile-title');
  includes(html, 'data-action="pick-profile"');
  includes(html, 'Sweet');
  includes(html, 'Classic');
  excludes(html, 'profile-preview-pane');
  excludes(html, 'data-action="focus-profile"');
  excludes(html, 'Flow profile');
  excludes(html, 'Favorites');
  excludes(html, 'Selected');
  excludes(html, 'data-action="profile-search"');
});

run('profile picker preview offers hide for all profiles and delete only for user profiles', () => {
  const withDefault: ProfileRecord[] = [
    {
      id: 'user-prof',
      profile: {
        title: 'My Profile',
        author: 'Me',
        legacy_profile_type: 'settings_2a',
        steps: [{ pressure: 8, seconds: 8 }] as unknown[]
      }
    },
    {
      id: 'default-prof',
      isDefault: true,
      profile: {
        title: 'Default Profile',
        author: 'Decent',
        legacy_profile_type: 'settings_2a',
        steps: [{ pressure: 8, seconds: 8 }] as unknown[]
      }
    }
  ];
  const base = {
    profiles: withDefault,
    search: '',
    favoriteProfileIds: [] as string[],
    selectedId: null,
    cleaningMode: false,
    showHidden: false,
    hiddenProfiles: [] as ProfileRecord[],
    pendingDeleteId: null
  };

  const userHtml = renderProfilesPage({ ...base, focusId: 'user-prof' });
  includes(userHtml, 'data-action="hide-profile" data-id="user-prof"');
  includes(userHtml, 'data-action="delete-profile" data-id="user-prof"');

  const defaultHtml = renderProfilesPage({ ...base, focusId: 'default-prof' });
  includes(defaultHtml, 'data-action="hide-profile" data-id="default-prof"');
  excludes(defaultHtml, 'data-action="delete-profile" data-id="default-prof"');
});

run('profile picker hidden section lists hidden profiles with unhide and a two-tap delete', () => {
  const hidden: ProfileRecord[] = [
    { id: 'hidden-user', profile: { title: 'Old Experiment', author: 'Me', steps: [] as unknown[] } },
    { id: 'hidden-default', isDefault: true, profile: { title: 'Bundled Thing', author: 'Decent', steps: [] as unknown[] } }
  ];
  const html = renderProfilesPage({
    profiles,
    search: '',
    favoriteProfileIds: [],
    selectedId: null,
    focusId: null,
    cleaningMode: false,
    showHidden: true,
    hiddenProfiles: hidden,
    pendingDeleteId: 'hidden-user'
  });

  includes(html, 'Hidden');
  includes(html, 'Old Experiment');
  includes(html, 'data-action="unhide-profile" data-id="hidden-user"');
  includes(html, 'data-action="unhide-profile" data-id="hidden-default"');
  // The armed user profile reads "Confirm"; the default offers no delete at all.
  includes(html, 'Confirm');
  includes(html, 'data-action="delete-profile" data-id="hidden-user"');
  excludes(html, 'data-action="delete-profile" data-id="hidden-default"');
});

run('profile picker show-hidden toggle appears when not in cleaning mode', () => {
  const html = renderProfilesPage({
    profiles,
    search: '',
    favoriteProfileIds: [],
    selectedId: null,
    focusId: null,
    cleaningMode: false,
    showHidden: false,
    hiddenProfiles: [],
    pendingDeleteId: null
  });
  includes(html, 'data-action="toggle-show-hidden"');
  includes(html, 'Show hidden');
});

run('profile picker helpers shorten folder titles and normalize profile types', () => {
  equal(profileShortTitle('Folder/Name'), 'Name');
  equal(profileShortTitle('Name'), 'Name');
  equal(displayProfileType('settings_2a'), 'Pressure');
  equal(displayProfileType('settings_2b'), 'Flow');
  equal(displayProfileType('settings_2c'), 'Advanced');
});

function run(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

function equal<T>(actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  }
}

function includes(text: string, expected: string): void {
  if (!text.includes(expected)) {
    throw new Error(`Expected ${JSON.stringify(text.slice(0, 240))} to include ${expected}`);
  }
}

function excludes(text: string, expected: string): void {
  if (text.includes(expected)) {
    throw new Error(`Expected rendered output not to include ${expected}`);
  }
}
