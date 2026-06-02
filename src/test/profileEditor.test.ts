import type { Profile } from '../api/types';
import {
  addStep,
  createProfileEditorState,
  duplicateStep,
  moveStep,
  profileFromEditorState,
  removeStep,
  renderProfileEditor,
  setSimpleProfileField,
  setStepField,
  setStepPump,
  PROFILE_BEVERAGE_TYPES
} from '../components/profileEditor';
import {
  addProfileStep,
  deleteProfileStep,
  duplicateProfileStep,
  moveProfileStep,
  normalizeProfileForEditing,
  serializeProfileEditor,
  updateProfileMetadata,
  updateProfileStepField,
  validateProfileEditor
} from '../domain/profileEditor';

run('domain normalizes canonical and Tcl-derived metadata and steps', () => {
  const state = normalizeProfileForEditing(tclDerivedProfile());

  equal(state.metadata.title, 'Blooming Allonge');
  equal(state.metadata.notes, 'keep the aliases alive');
  equal(state.metadata.targetWeight, 135);
  equal(state.metadata.tankTemperature, 0);
  equal(state.steps.length, 2);
  equal(state.steps[0].name, 'fast pre');
  equal(state.steps[0].durationSeconds, 3);
  equal(state.steps[0].exit?.enabled, true);
  equal(state.steps[0].exit?.type, 'pressure_over');
  equal(state.steps[0].extra.popup, '$weight');
});

run('domain preserves unknown profile and step fields through a round-trip', () => {
  const state = normalizeProfileForEditing(tclDerivedProfile());
  const profile = serializeProfileEditor(state) as Record<string, unknown>;
  const steps = profile.advanced_shot as Record<string, unknown>[];

  equal(profile.profile_editor, 'demo');
  equal(profile.read_only, 1);
  equal(profile.profile_title, 'Blooming Allonge');
  equal(profile.title, 'Blooming Allonge');
  equal(steps[0].popup, '$weight');
  equal(steps[0].exit_if, 1);
  equal(steps[1].legacy_flag, 'preserve-me');
});

run('domain updates metadata without dropping Tcl aliases', () => {
  const state = updateProfileMetadata(normalizeProfileForEditing(tclDerivedProfile()), 'title', 'Edited');
  const profile = serializeProfileEditor(state) as Record<string, unknown>;

  equal(profile.title, 'Edited');
  equal(profile.profile_title, 'Edited');
  equal(profile.profile_editor, 'demo');
});

run('domain adds, duplicates, deletes, and moves ordered steps', () => {
  const original = normalizeProfileForEditing(tclDerivedProfile());
  const added = addProfileStep(original, { name: 'Finish', pressure: 5 });
  equal(added.steps.length, 3);
  equal(added.steps[2].name, 'Finish');

  const duplicated = duplicateProfileStep(added, 0);
  equal(duplicated.steps.length, 4);
  equal(duplicated.steps[1].name, 'fast pre');

  const deleted = deleteProfileStep(duplicated, 2);
  equal(deleted.steps.length, 3);
  equal(deleted.steps[2].name, 'Finish');

  const moved = moveProfileStep(deleted, 2, 0);
  equal(moved.steps[0].name, 'Finish');
  equal(moved.steps[1].name, 'fast pre');
});

run('domain updates known and unknown step fields and serializes duration alias', () => {
  const state = normalizeProfileForEditing({
    title: 'Duration aliases',
    steps: [{ name: 'Soak', duration: 12, mystery: 'stay' }]
  });

  const updated = updateProfileStepField(
    updateProfileStepField(
      updateProfileStepField(state, 0, 'durationSeconds', '16.5'),
      0,
      'temperature',
      '94'
    ),
    0,
    'custom_limiter',
    7
  );
  const profile = serializeProfileEditor(updated);
  const step = (profile.steps as Record<string, unknown>[])[0]!;

  equal(step.duration, 16.5);
  equal(step.temperature, 94);
  equal(step.mystery, 'stay');
  equal(step.custom_limiter, 7);
});

run('domain validation flags unsafe values but allows real low/zero Decent values', () => {
  const validRealProfile = normalizeProfileForEditing({
    steps: [{ name: 'Pause', pressure: 0, flow: 0, temperature: 0, seconds: 0 }]
  });
  equal(validateProfileEditor(validRealProfile).length, 0);

  const unsafe = normalizeProfileForEditing({
    steps: [{ name: '', pressure: 18, flow: -2, temperature: 130, seconds: -1, sensor: 'tea' }]
  });
  const issues = validateProfileEditor(unsafe);
  equal(issues.some((issue) => issue.path.endsWith('.pressure')), true);
  equal(issues.some((issue) => issue.path.endsWith('.flow')), true);
  equal(issues.some((issue) => issue.path.endsWith('.temperature')), true);
  equal(issues.some((issue) => issue.path.endsWith('.durationSeconds')), true);
  equal(issues.some((issue) => issue.path.endsWith('.sensor')), true);
});

run('creates editor state from an existing profile preserving metadata and steps', () => {
  const state = createProfileEditorState(sampleProfile());

  equal(state.title, 'Sample');
  equal(state.author, 'Tester');
  equal(state.beverageType, 'espresso');
  equal(state.type, 'advanced');
  equal(state.legacyProfileType, 'settings_2c');
  equal(state.tankTemperature, 90);
  equal(state.targetWeight, 36);
  equal(state.targetVolumeCountStart, 1);
  equal(state.steps.length, 2);
  equal(state.steps[0].name, 'Preinfusion');
  equal(state.steps[0].pump, 'flow');
  equal(state.steps[0].weight, 5);
  equal(state.steps[0].limiter?.value, 8);
  equal(state.steps[1].pump, 'pressure');
  equal(state.steps[1].pressure, 9);
  equal(state.dirty, false);
});

run('creates a usable default from null', () => {
  const state = createProfileEditorState(null);

  equal(state.steps.length, 1);
  equal(state.steps[0].pump, 'pressure');
  equal(state.selectedStep, 0);
  equal(state.dirty, false);
});

run('setStepField coerces numeric fields', () => {
  const state = createProfileEditorState(null);
  const next = setStepField(state, 0, 'temperature', '94.5');

  equal(next.steps[0].temperature, 94.5);
  equal(next.dirty, true);

  const cleared = setStepField(state, 0, 'pressure', '');
  equal(cleared.steps[0].pressure, 0);
});

run('setStepPump switches the controlled target', () => {
  const state = createProfileEditorState(null);
  equal(state.steps[0].pump, 'pressure');
  const next = setStepPump(state, 0, 'flow');
  equal(next.steps[0].pump, 'flow');
  equal(state.steps[0].pump, 'pressure');
});

run('addStep inserts a copy after the selected step', () => {
  const state = createProfileEditorState(sampleProfile());
  const next = addStep(state);

  equal(next.steps.length, 3);
  equal(next.selectedStep, 1);
  equal(next.steps[1].name, 'Preinfusion copy');
  equal(next.steps[2].name, 'Pour');
});

run('duplicateStep copies a step and selects the copy', () => {
  const state = createProfileEditorState(sampleProfile());
  const next = duplicateStep(state, 0);

  equal(next.steps.length, 3);
  equal(next.selectedStep, 1);
  equal(next.steps[1].name, 'Preinfusion copy');
  equal(next.steps[1].limiter?.value, 8);
});

run('removeStep keeps at least one step and respects bounds', () => {
  const one = createProfileEditorState(null);
  equal(removeStep(one, 0).steps.length, 1);

  const two = addStep(one);
  const after = removeStep(two, 0);
  equal(after.steps.length, 1);
  equal(removeStep(two, 5).steps.length, 2);
});

run('moveStep reorders within bounds only', () => {
  const state = createProfileEditorState(sampleProfile());
  const moved = moveStep(state, 0, 1);
  equal(moved.steps[0].name, 'Pour');
  equal(moved.steps[1].name, 'Preinfusion');

  equal(moveStep(state, 0, -1).steps[0].name, 'Preinfusion');
  equal(moveStep(state, 1, 1).steps[1].name, 'Pour');
});

run('unknown step keys survive a round-trip through profileFromEditorState', () => {
  const state = createProfileEditorState(sampleProfile());
  const profile = profileFromEditorState(state) as Profile & Record<string, unknown>;
  const steps = profile.steps as Record<string, unknown>[];

  equal(steps[0].weird_custom_key, 'keepme');
  equal(profile.custom_profile_flag, 'round-trip');
  equal(profile.target_volume_count_start, 1);
  equal(steps[0].pump, 'flow');
  equal(steps[0].weight, 5);
  equal((steps[0].limiter as Record<string, unknown>).value, 8);
  equal(steps[1].pressure, 9);
  equal('exit' in steps[1], false);
});

run('renderProfileEditor includes metadata inputs and an add-step action', () => {
  const html = renderProfileEditor(createProfileEditorState(null));

  includes(html, 'data-action="pe-meta"');
  includes(html, 'data-key="title"');
  includes(html, 'data-action="pe-add-step"');
  includes(html, 'data-action="pe-step-field"');
  includes(html, PROFILE_BEVERAGE_TYPES[0]);
});

run('renders de1-style pressure editor for normalized pressure profiles', () => {
  const state = createProfileEditorState(pressureProfile());
  const html = renderProfileEditor(state);

  equal(state.type, 'pressure');
  equal(state.legacyProfileType, 'settings_2a');
  includes(html, 'pe-de1-tabs');
  includes(html, '1: preinfuse');
  includes(html, '2: rise and hold');
  includes(html, '4: stop at pour');
  includes(html, 'data-action="pe-simple-field"');
});

run('updates pressure editor scalar fields without dropping profile steps', () => {
  const state = createProfileEditorState(pressureProfile());
  const next = setSimpleProfileField(state, 'pre_pressure', '4.5');

  equal(next.steps.length, 3);
  equal(next.steps[0].exit?.value, 4.5);
  equal(next.dirty, true);
});

function sampleProfile(): Profile {
  return {
    title: 'Sample',
    author: 'Tester',
    beverage_type: 'espresso',
    type: 'advanced',
    legacy_profile_type: 'settings_2c',
    tank_temperature: 90,
    target_weight: 36,
    target_volume_count_start: 1,
    custom_profile_flag: 'round-trip',
    version: '2',
    steps: [
      {
        name: 'Preinfusion',
        pump: 'flow',
        flow: 4,
        temperature: 92,
        seconds: 10,
        weight: 5,
        limiter: { value: 8, range: 0.6 },
        weird_custom_key: 'keepme'
      },
      {
        name: 'Pour',
        pump: 'pressure',
        pressure: 9,
        temperature: 93,
        seconds: 25
      }
    ]
  } as Profile;
}

function pressureProfile(): Profile {
  return {
    title: 'Default',
    author: 'Decent',
    beverage_type: 'espresso',
    tank_temperature: 90,
    target_volume: 36,
    steps: [
      {
        name: 'preinfuse',
        pump: 'flow',
        flow: 4,
        pressure: 0,
        temperature: 90,
        seconds: 5,
        exit: { type: 'pressure', condition: 'over', value: 4 }
      },
      {
        name: 'rise and hold',
        pump: 'pressure',
        pressure: 9,
        flow: 0,
        temperature: 90,
        seconds: 10,
        limiter: { value: 8, range: 0.6 }
      },
      {
        name: 'decline',
        pump: 'pressure',
        pressure: 6,
        flow: 0,
        temperature: 90,
        seconds: 18
      }
    ]
  } as Profile;
}

function tclDerivedProfile(): Profile {
  return {
    profile_title: 'Blooming Allonge',
    profile_notes: 'keep the aliases alive',
    final_desired_shot_weight_advanced: 135,
    tank_desired_water_temperature: 0,
    profile_editor: 'demo',
    read_only: 1,
    advanced_shot: [
      {
        name: 'fast pre',
        flow: 4.5,
        pressure: 3.5,
        temperature: 95,
        seconds: 3,
        sensor: 'coffee',
        pump: 'flow',
        transition: 'fast',
        exit_if: 1,
        exit_type: 'pressure_over',
        exit_pressure_over: 3.5,
        exit_flow_over: 6,
        popup: '$weight'
      },
      {
        name: 'bloom',
        flow: 0,
        pressure: 0,
        temperature: 93,
        seconds: 30,
        sensor: 'coffee',
        pump: 'flow',
        transition: 'fast',
        legacy_flag: 'preserve-me'
      }
    ]
  } as Profile;
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
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  }
}

function includes(value: string, expected: string): void {
  if (!value.includes(expected)) {
    throw new Error(`Expected output to include ${expected}`);
  }
}
