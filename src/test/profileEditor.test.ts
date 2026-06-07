import type { Profile } from '../api/types';
import {
  addStep,
  createProfileEditorState,
  duplicateStep,
  moveStep,
  profileFromEditorState,
  removeStep,
  renderEditorModeBar,
  renderProfileEditor,
  setEditorMode,
  setSimpleProfileField,
  setSimpleProfileType,
  setStepField,
  setStepPump
} from '../components/profileEditor';
import { PROFILE_BEVERAGE_TYPES } from '../domain/profileModel';
import { canEditAsBasic } from '../domain/simpleProfile';

run('reads de1app Tcl-derived metadata, steps, and flat exit conditions', () => {
  const state = createProfileEditorState(tclDerivedProfile());

  // Metadata aliases: profile_title / profile_notes / final_desired_* / tank_desired_*
  equal(state.title, 'Blooming Allonge');
  equal(state.notes, 'keep the aliases alive');
  equal(state.targetWeight, 135);
  equal(state.tankTemperature, 0);

  // Steps read from `advanced_shot` when canonical `steps` is absent
  equal(state.steps.length, 2);
  equal(state.steps[0].name, 'fast pre');
  equal(state.steps[0].seconds, 3);

  // Flat exit_if / exit_type / exit_pressure_over folded into the nested model
  equal(state.steps[0].exit?.type, 'pressure');
  equal(state.steps[0].exit?.condition, 'over');
  equal(state.steps[0].exit?.value, 3.5);

  // Genuinely-unknown step keys are preserved
  equal(state.steps[0].extra.popup, '$weight');
  equal(state.steps[1].extra.legacy_flag, 'preserve-me');
});

run('serializes Tcl-derived input to canonical reaprime v2 output', () => {
  const state = createProfileEditorState(tclDerivedProfile());
  const profile = profileFromEditorState(state) as Record<string, unknown>;
  const steps = profile.steps as Record<string, unknown>[];

  // Canonical shape: `steps`, not `advanced_shot`; nested `exit`, not flat keys
  equal(Array.isArray(profile.steps), true);
  equal('advanced_shot' in profile, false);
  equal('profile_title' in profile, false);
  equal(profile.title, 'Blooming Allonge');
  deepKeysEqual(steps[0].exit as Record<string, unknown>, {
    type: 'pressure',
    condition: 'over',
    value: 3.5
  });
  equal('exit_if' in steps[0], false);
  equal(steps[0].popup, '$weight');

  // Unknown top-level keys still survive the round-trip
  equal(profile.read_only, 1);
  equal(profile.profile_editor, 'demo');
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

run('caps advanced steps at 20 (de1app limit)', () => {
  let state = createProfileEditorState(null);
  for (let i = 0; i < 30; i += 1) state = addStep(state);
  equal(state.steps.length, 20);
  equal(duplicateStep(state, 0).steps.length, 20);
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

run('renders the basic pressure editor for normalized pressure profiles', () => {
  const state = createProfileEditorState(pressureProfile());
  const html = renderProfileEditor(state);

  equal(state.type, 'pressure');
  equal(state.legacyProfileType, 'settings_2a');
  equal(state.editorMode, 'basic');
  includes(html, '1 · Preinfuse');
  includes(html, 'Rise &amp; hold');
  includes(html, '4 · Finish');
  includes(html, 'data-action="pe-edit-value"');
  includes(html, 'data-action="pe-simple-nudge"');
  includes(html, 'data-action="pe-set-simple-type"');
});

run('updates pressure editor scalar fields without dropping profile steps', () => {
  const state = createProfileEditorState(pressureProfile());
  const next = setSimpleProfileField(state, 'pre_pressure', '4.5');

  equal(next.steps.length, 3);
  equal(next.steps[0].exit?.value, 4.5);
  equal(next.dirty, true);
});

run('opens a canonical simple profile in basic mode, advanced otherwise', () => {
  equal(createProfileEditorState(pressureProfile()).editorMode, 'basic');
  // sampleProfile is a 2-step advanced profile — not basic-editable
  equal(createProfileEditorState(sampleProfile()).editorMode, 'advanced');
});

run('switching to basic converts a non-simple profile into a simple one', () => {
  const advanced = createProfileEditorState(sampleProfile());
  const next = setEditorMode(advanced, 'basic');
  equal(next.editorMode, 'basic');
  equal(canEditAsBasic(next.steps), true); // now a canonical simple profile

  // a brand-new (1-step) profile can go basic too
  const fresh = setEditorMode(createProfileEditorState(null), 'basic');
  equal(fresh.editorMode, 'basic');
  equal(canEditAsBasic(fresh.steps), true);

  // a basic profile can always drop to advanced
  equal(setEditorMode(createProfileEditorState(pressureProfile()), 'advanced').editorMode, 'advanced');
});

run('switching simple type recompiles the knobs as flow', () => {
  const next = setSimpleProfileType(createProfileEditorState(pressureProfile()), 'flow');
  equal(next.type, 'flow');
  equal(next.editorMode, 'basic');
  equal(next.steps[1]!.pump, 'flow');
  equal(next.steps[2]!.pump, 'flow');
});

run('mode bar carries the Basic/Advanced toggle; body carries the kind toggle', () => {
  const state = createProfileEditorState(pressureProfile());
  const bar = renderEditorModeBar(state);
  includes(bar, 'data-action="pe-set-mode"');
  includes(bar, '>Advanced<');
  const body = renderProfileEditor(state);
  includes(body, 'data-action="pe-set-simple-type"');
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
        transition: 'smooth',
        seconds: 18,
        limiter: { value: 8, range: 0.6 }
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

function deepKeysEqual(actual: Record<string, unknown>, expected: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(expected)) {
    equal(actual?.[key], value);
  }
}
