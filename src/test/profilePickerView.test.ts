import type { ProfileRecord } from '../api/types';
import {
  displayProfileType,
  profileShortTitle,
  renderPhoneProfilesPage,
  renderProfilesPage
} from '../views/profilePickerView';
import { renderDeleteProfileModal } from '../views/alertsView';

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
    hiddenProfiles: []
  });

  includes(html, 'Profiles');
  includes(html, 'Favorites');
  includes(html, 'Sweet');
  includes(html, 'Classic');
  includes(html, 'Selected');
  equal(html.indexOf('Sweet') < html.indexOf('Classic'), true);
});

run('profile picker arms the focused-but-unselected row with a tap-again cue and no Select button', () => {
  const html = renderProfilesPage({
    profiles,
    search: '',
    favoriteProfileIds: [],
    selectedId: 'profile-pressure',
    focusId: 'profile-flow',
    cleaningMode: false,
    showHidden: false,
    hiddenProfiles: []
  });

  // The armed row invites a second tap; selection no longer uses a Select button.
  includes(html, 'Tap again');
  excludes(html, 'class="pa-select');
  includes(html, 'data-action="focus-profile" data-id="profile-flow"');
  // The still-loaded profile keeps its status pill.
  includes(html, 'Selected');
  // The preview caption stands in for the removed button.
  includes(html, 'Tap the profile again to load it');
});

run('profile picker shows the suggestion tooltip on the armed row while the hint budget lasts', () => {
  const html = renderProfilesPage({
    profiles,
    search: '',
    favoriteProfileIds: [],
    selectedId: 'profile-pressure',
    focusId: 'profile-flow',
    cleaningMode: false,
    showHidden: false,
    hiddenProfiles: [],
    showLoadHint: true
  });

  includes(html, 'second-tap-tooltip');
  includes(html, 'Tap again to load');
  includes(html, 'has-second-tap-hint');
  // While the tooltip is teaching the gesture, the plain pill stays hidden.
  excludes(html, '>Tap again</span>');
});

run('profile picker falls back to the inline pill once the hint budget is spent', () => {
  const html = renderProfilesPage({
    profiles,
    search: '',
    favoriteProfileIds: [],
    selectedId: 'profile-pressure',
    focusId: 'profile-flow',
    cleaningMode: false,
    showHidden: false,
    hiddenProfiles: [],
    showLoadHint: false
  });

  // The armed row still invites a second tap, just without the floating tooltip.
  includes(html, 'Tap again');
  excludes(html, 'second-tap-tooltip');
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
    hiddenProfiles: []
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
    hiddenProfiles: []
  });

  includes(html, 'Cleaning profile');
  includes(html, 'data-value="machine"');
  excludes(html, 'data-action="new-profile"');
  // Browser-management actions stay out of the cleaning-profile picker.
  excludes(html, 'data-action="hide-profile"');
  excludes(html, 'data-action="toggle-show-hidden"');
});

run('phone profile picker renders search and metadata tap targets', () => {
  const html = renderPhoneProfilesPage({
    profiles,
    search: '',
    favoriteProfileIds: ['profile-flow'],
    selectedId: 'profile-pressure',
    focusId: null,
    cleaningMode: false,
    showHidden: false,
    hiddenProfiles: []
  });

  includes(html, 'phone-profile-title');
  includes(html, 'data-action="pick-profile"');
  includes(html, 'Sweet');
  includes(html, 'Classic');
  // Search and per-row metadata (type · author) are part of the phone picker now.
  includes(html, 'data-action="profile-search"');
  includes(html, 'phone-profile-meta');
  includes(html, 'Bob');
  includes(html, 'Ada');
  // Favourites still sort to the top.
  equal(html.indexOf('Sweet') < html.indexOf('Classic'), true);
  // Still a lightweight list, not the tablet two-pane preview.
  excludes(html, 'profile-preview-pane');
  excludes(html, 'data-action="focus-profile"');
  excludes(html, 'Flow profile');
});

run('phone profile picker filters by search', () => {
  const html = renderPhoneProfilesPage({
    profiles,
    search: 'ada',
    favoriteProfileIds: [],
    selectedId: 'profile-pressure',
    focusId: null,
    cleaningMode: false,
    showHidden: false,
    hiddenProfiles: []
  });

  includes(html, 'Classic');
  excludes(html, 'Sweet');
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
    hiddenProfiles: [] as ProfileRecord[]
  };

  const userHtml = renderProfilesPage({ ...base, focusId: 'user-prof' });
  includes(userHtml, 'data-action="hide-profile" data-id="user-prof"');
  includes(userHtml, 'data-action="delete-profile" data-id="user-prof"');

  const defaultHtml = renderProfilesPage({ ...base, focusId: 'default-prof' });
  includes(defaultHtml, 'data-action="hide-profile" data-id="default-prof"');
  excludes(defaultHtml, 'data-action="delete-profile" data-id="default-prof"');
});

run('profile picker hidden section lists hidden profiles with unhide and gated delete', () => {
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
    hiddenProfiles: hidden
  });

  includes(html, 'Hidden');
  includes(html, 'Old Experiment');
  includes(html, 'data-action="unhide-profile" data-id="hidden-user"');
  includes(html, 'data-action="unhide-profile" data-id="hidden-default"');
  // User profile gets a delete trigger; the default offers no delete at all.
  includes(html, 'data-action="delete-profile" data-id="hidden-user"');
  excludes(html, 'data-action="delete-profile" data-id="hidden-default"');
  // Delete sits left of Unhide so Unhide stays anchored to the right edge.
  equal(
    html.indexOf('data-action="delete-profile" data-id="hidden-user"') <
      html.indexOf('data-action="unhide-profile" data-id="hidden-user"'),
    true
  );
});

run('delete-profile dialog warns it cannot be undone and offers hide instead', () => {
  const html = renderDeleteProfileModal('My Profile');
  includes(html, 'My Profile');
  includes(html, 'undone');
  includes(html, 'data-action="confirm-delete-profile"');
  includes(html, 'data-action="hide-instead-delete"');
  includes(html, 'Hide instead');
  includes(html, 'data-action="close-modal"');
});

run('profile picker show-hidden toggle is a header eye icon: crossed when hidden, uncrossed when shown', () => {
  const base = {
    profiles,
    search: '',
    favoriteProfileIds: [] as string[],
    selectedId: null,
    focusId: null,
    cleaningMode: false,
    hiddenProfiles: [] as ProfileRecord[]
  };

  const off = renderProfilesPage({ ...base, showHidden: false });
  includes(off, 'data-action="toggle-show-hidden"');
  includes(off, 'Show hidden');
  includes(off, 'data-lucide="eye-off"');

  const on = renderProfilesPage({ ...base, showHidden: true });
  includes(on, 'Hide hidden profiles');
  includes(on, 'data-lucide="eye"');
  excludes(on, 'data-lucide="eye-off"');
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
