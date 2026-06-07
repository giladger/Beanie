import type { ProfileRecord } from '../api/types';
import {
  displayProfileType,
  profileShortTitle,
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
    cleaningMode: false
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
    cleaningMode: false
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
    cleaningMode: true
  });

  includes(html, 'Cleaning profile');
  includes(html, 'data-value="machine"');
  excludes(html, 'data-action="new-profile"');
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
