import type { Profile } from '../api/types';
import { profileStepTargets, renderProfilePreview } from '../components/profilePreview';

run('extracts per-step pressure, flow, temperature, and duration targets', () => {
  const profile: Profile = {
    title: 'Stepped',
    steps: [
      { pressure: 3, flow: 4, temperature: 93, seconds: 8 },
      { pressure: 9, seconds: 12 },
      { flow: 2 }
    ] as unknown[]
  };
  const targets = profileStepTargets(profile);
  equal(targets.length, 3);
  equal(targets[0]!.pressure, 3);
  equal(targets[0]!.flow, 4);
  equal(targets[0]!.temperature, 93);
  equal(targets[0]!.seconds, 8);
  equal(targets[1]!.flow, null);
  equal(targets[2]!.pressure, null);
});

run('returns no targets for a profile without steps', () => {
  equal(profileStepTargets({ title: 'Empty' }).length, 0);
  equal(profileStepTargets(null).length, 0);
});

run('renders an svg preview with pressure, flow, and temperature paths when data exists', () => {
  const svg = renderProfilePreview({
    title: 'Stepped',
    steps: [{ pressure: 6, flow: 2, temperature: 92 }, { pressure: 9, flow: 1.5, temperature: 94 }] as unknown[]
  });
  includes(svg, 'profile-preview-pressure');
  includes(svg, 'profile-preview-flow');
  includes(svg, 'profile-preview-temp');
  includes(svg, 'profile-preview-grid');
  includes(svg, '<path');
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

function includes(value: string, expected: string): void {
  if (!value.includes(expected)) {
    throw new Error(`Expected output to include ${expected}`);
  }
}
