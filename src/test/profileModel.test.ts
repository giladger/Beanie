import type { Profile } from '../api/types';
import {
  decodeProfile,
  encodeProfile,
  legacyProfileTypeFromType,
  profileTypeFromLegacy
} from '../domain/profileModel';

run('profile codec creates a valid canonical default without optional targets', () => {
  const model = decodeProfile(null);
  equal(model.title, 'New profile');
  equal(model.type, 'advanced');
  equal(model.legacyProfileType, 'settings_2c');
  equal(model.steps.length, 1);
  equal(model.steps[0]?.name, 'Pressure');
  equal(model.tankTemperature, 0);
  equal(model.targetVolumeCountStart, 0);

  const encoded = encodeProfile({
    ...model,
    tankTemperature: null,
    targetVolumeCountStart: null,
    targetWeight: null,
    targetVolume: null
  }) as Record<string, unknown>;
  equal(encoded.tank_temperature, 0);
  equal(encoded.target_volume_count_start, 0);
  equal('target_weight' in encoded, false);
  equal('target_volume' in encoded, false);
});

run('canonical steps take precedence over the Tcl fallback even when empty', () => {
  const canonical = decodeProfile(withExtra({
    steps: [step({ name: 'canonical', pump: 'flow', pressure: 0, flow: 3 })],
    advanced_shot: [step({ name: 'legacy' })]
  }));
  equal(canonical.steps[0]?.name, 'canonical');
  equal(canonical.type, 'flow');

  const emptyCanonical = decodeProfile(withExtra({
    steps: [],
    advanced_shot: [step({ name: 'must-not-load' })]
  }));
  equal(emptyCanonical.steps.length, 1);
  equal(emptyCanonical.steps[0]?.name, 'Pressure');
});

run('profile codec consumes Tcl aliases and writes canonical nested step data', () => {
  const decoded = decodeProfile(withExtra({
    profile_title: 'Blooming Allonge',
    profile_notes: 'tablet note',
    tank_desired_water_temperature: 1,
    final_desired_shot_weight_advanced: 135,
    final_desired_shot_volume_advanced: 150,
    final_desired_shot_volume_advanced_count_start: 2,
    custom_profile_flag: 'keep',
    advanced_shot: [{
      ...step({ name: 'fast pre', pump: 'flow', pressure: 0, flow: 4 }),
      exit_if: 1,
      exit_type: 'pressure_over',
      exit_pressure_over: 3.5,
      max_flow_or_pressure: 8,
      max_flow_or_pressure_range: 0.7,
      popup: '$weight'
    }]
  }));

  equal(decoded.title, 'Blooming Allonge');
  equal(decoded.notes, 'tablet note');
  equal(decoded.tankTemperature, 1);
  equal(decoded.targetWeight, 135);
  equal(decoded.targetVolume, 150);
  equal(decoded.targetVolumeCountStart, 2);
  equal(decoded.steps[0]?.exit?.value, 3.5);
  equal(decoded.steps[0]?.limiter?.value, 8);
  equal(decoded.steps[0]?.limiter?.range, 0.7);
  equal(decoded.steps[0]?.extra.popup, '$weight');
  equal(decoded.extra.custom_profile_flag, 'keep');
  equal('profile_title' in decoded.extra, false);
  equal('advanced_shot' in decoded.extra, false);

  const encoded = encodeProfile(decoded) as Record<string, unknown>;
  const encodedStep = (encoded.steps as Record<string, unknown>[])[0]!;
  equal(encoded.title, 'Blooming Allonge');
  equal(encoded.custom_profile_flag, 'keep');
  equal('profile_title' in encoded, false);
  equal('advanced_shot' in encoded, false);
  equal('exit_if' in encodedStep, false);
  equal('max_flow_or_pressure' in encodedStep, false);
  deepEqual(encodedStep.exit, { type: 'pressure', condition: 'over', value: 3.5 });
  deepEqual(encodedStep.limiter, { value: 8, range: 0.7 });
  equal(encodedStep.popup, '$weight');
});

run('nested exit and limiter data take precedence over legacy flat aliases', () => {
  const model = decodeProfile({
    steps: [{
      ...step(),
      exit: { type: 'flow', condition: 'under', value: 2.5 },
      exit_if: 1,
      exit_type: 'pressure_over',
      exit_pressure_over: 10,
      limiter: { value: 7, range: 0.4 },
      max_flow_or_pressure: 4,
      max_flow_or_pressure_range: 1.2
    }]
  });

  deepEqual(model.steps[0]?.exit, { type: 'flow', condition: 'under', value: 2.5 });
  deepEqual(model.steps[0]?.limiter, { value: 7, range: 0.4 });
});

run('unknown profile and step fields survive a canonical round trip', () => {
  const profile = withExtra({
    title: 'Custom',
    read_only: 1,
    profile_editor: 'external',
    steps: [{
      ...step({ name: 'Custom step' }),
      weird_custom_key: { keep: true }
    }]
  });
  const encoded = encodeProfile(decodeProfile(profile)) as Record<string, unknown>;
  const encodedStep = (encoded.steps as Record<string, unknown>[])[0]!;

  equal(encoded.read_only, 1);
  equal(encoded.profile_editor, 'external');
  deepEqual(encodedStep.weird_custom_key, { keep: true });
});

run('legacy profile type aliases retain their exact conversion policy', () => {
  equal(profileTypeFromLegacy(undefined), undefined);
  equal(profileTypeFromLegacy('settings_2a'), 'pressure');
  equal(profileTypeFromLegacy('settings_2b'), 'flow');
  equal(profileTypeFromLegacy('settings_2c'), 'advanced');
  equal(legacyProfileTypeFromType('pressure'), 'settings_2a');
  equal(legacyProfileTypeFromType('flow'), 'settings_2b');
  equal(legacyProfileTypeFromType('advanced'), 'settings_2c');
});

function step(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'step',
    temperature: 92,
    sensor: 'coffee',
    pump: 'pressure',
    pressure: 9,
    flow: 0,
    transition: 'fast',
    seconds: 10,
    volume: 0,
    weight: 0,
    ...patch
  };
}

function withExtra(value: Record<string, unknown>): Profile {
  return value as Profile;
}

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
  if (!Object.is(actual, expected)) {
    throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  }
}

function deepEqual(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}
