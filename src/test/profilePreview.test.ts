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
    legacy_profile_type: 'settings_2c',
    steps: [{ pressure: 6, flow: 2, temperature: 92 }, { pressure: 9, flow: 1.5, temperature: 94 }] as unknown[]
  });
  includes(svg, 'profile-preview-pressure');
  includes(svg, 'profile-preview-flow');
  includes(svg, 'profile-preview-temp');
  includes(svg, 'profile-preview-grid');
  includes(svg, '<path');
});

run('matches de1 pressure preview by hiding flow traces', () => {
  const svg = renderProfilePreview({
    title: 'Pressure',
    legacy_profile_type: 'settings_2a',
    steps: [{ pressure: 6, flow: 2, temperature: 92 }, { pressure: 9, flow: 1.5, temperature: 94 }] as unknown[]
  });
  includes(svg, 'pressure (bar)');
  includes(svg, 'profile-preview-pressure');
  includes(svg, 'profile-preview-temp');
  excludes(svg, 'profile-preview-flow');
});

run('uses Tcl settings_profile_type to render scalar pressure presets like de1app', () => {
  const profile = {
    title: 'Default',
    settings_profile_type: 'settings_2a',
    preinfusion_time: 20,
    preinfusion_stop_pressure: 4,
    espresso_pressure: 8.6,
    espresso_hold_time: 4,
    espresso_decline_time: 35,
    pressure_end: 6,
    espresso_temperature_0: 90,
    espresso_temperature_1: 88,
    espresso_temperature_2: 88,
    espresso_temperature_3: 88
  } as Profile;
  const targets = profileStepTargets(profile);
  equal(targets.length, 5);
  equal(targets[0]!.pressure, 0.1);
  equal(targets[1]!.pressure, 4);
  equal(targets[2]!.pressure, 8.6);
  equal(targets[4]!.pressure, 6);

  const svg = renderProfilePreview(profile);
  includes(svg, 'pressure (bar)');
  includes(svg, 'profile-preview-pressure');
  includes(svg, 'profile-preview-temp');
  excludes(svg, 'profile-preview-flow');
  excludes(svg, 'Advanced');
});

run('infers normalized pressure presets from flow preinfusion followed by pressure steps', () => {
  const profile = {
    title: 'Default',
    steps: [
      {
        pump: 'flow',
        transition: 'fast',
        exit: { type: 'pressure', condition: 'over', value: 4 },
        seconds: 2,
        temperature: 90,
        flow: 8
      },
      {
        pump: 'flow',
        transition: 'fast',
        exit: { type: 'pressure', condition: 'over', value: 4 },
        seconds: 18,
        temperature: 88,
        flow: 8
      },
      { pump: 'pressure', transition: 'fast', seconds: 3, temperature: 75, pressure: 8.6 },
      { pump: 'pressure', transition: 'smooth', seconds: 32, temperature: 54, pressure: 6 }
    ] as unknown[]
  };
  const targets = profileStepTargets(profile);
  equal(targets[0]!.pressure, 0.1);
  equal(targets[1]!.pressure, 4);
  equal(targets[2]!.pressure, 8.6);

  const svg = renderProfilePreview(profile);
  includes(svg, 'pressure (bar)');
  includes(svg, 'profile-preview-pressure');
  includes(svg, 'profile-preview-temp');
  excludes(svg, 'profile-preview-flow');
  excludes(svg, 'Advanced');
});

run('matches de1 flow preview by hiding pressure traces', () => {
  const svg = renderProfilePreview({
    title: 'Flow',
    legacy_profile_type: 'settings_2b',
    steps: [{ pressure: 6, flow: 2, temperature: 92 }, { pressure: 9, flow: 1.5, temperature: 94 }] as unknown[]
  });
  includes(svg, 'Flow rate');
  includes(svg, 'profile-preview-flow');
  includes(svg, 'profile-preview-temp');
  excludes(svg, 'profile-preview-pressure');
});

run('uses Tcl settings_profile_type to render scalar flow presets like de1app', () => {
  const profile = {
    title: 'Flow',
    settings_profile_type: 'settings_2b',
    preinfusion_time: 20,
    preinfusion_flow_rate: 8,
    espresso_hold_time: 4,
    espresso_decline_time: 35,
    flow_profile_hold: 2,
    flow_profile_decline: 1.2,
    espresso_temperature_0: 90,
    espresso_temperature_1: 88,
    espresso_temperature_2: 88,
    espresso_temperature_3: 88
  } as Profile;
  const targets = profileStepTargets(profile);
  equal(targets.length, 5);
  equal(targets[0]!.flow, 0);
  equal(targets[1]!.flow, 8);
  equal(targets[2]!.flow, 2);
  equal(targets[4]!.flow, 1.2);

  const svg = renderProfilePreview(profile);
  includes(svg, 'Flow rate');
  includes(svg, 'profile-preview-flow');
  includes(svg, 'profile-preview-temp');
  excludes(svg, 'profile-preview-pressure');
});

run('breaks advanced pressure and flow traces between pump modes', () => {
  const svg = renderProfilePreview({
    title: 'Advanced',
    legacy_profile_type: 'settings_2c',
    steps: [
      { pump: 'pressure', pressure: 8, temperature: 92, seconds: 8 },
      { pump: 'flow', flow: 2, temperature: 92, seconds: 8 },
      { pump: 'pressure', pressure: 6, temperature: 92, seconds: 8 }
    ] as unknown[]
  });
  includes(svg, 'profile-preview-pressure');
  includes(svg, 'profile-preview-flow');
  includes(svg, 'L');
  includes(svg, 'M');
});

run('reads advanced_shot when Tcl-derived profiles do not expose canonical steps', () => {
  const svg = renderProfilePreview({
    title: 'Advanced',
    settings_profile_type: 'settings_2c',
    advanced_shot: [
      { pump: 'pressure', pressure: '8', temperature: '92', seconds: '8' },
      { pump: 'flow', flow: '2', temperature: '92', seconds: '8' }
    ]
  } as Profile);
  includes(svg, 'Advanced');
  includes(svg, 'profile-preview-pressure');
  includes(svg, 'profile-preview-flow');
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

function excludes(value: string, expected: string): void {
  if (value.includes(expected)) {
    throw new Error(`Expected output not to include ${expected}`);
  }
}
