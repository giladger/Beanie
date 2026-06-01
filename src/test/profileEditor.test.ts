import type { Profile } from '../api/types';
import {
  addStep,
  createProfileEditorState,
  moveStep,
  profileFromEditorState,
  removeStep,
  renderProfileEditor,
  setStepField,
  setStepPump,
  PROFILE_BEVERAGE_TYPES
} from '../components/profileEditor';

run('creates editor state from an existing profile preserving metadata and steps', () => {
  const state = createProfileEditorState(sampleProfile());

  equal(state.title, 'Sample');
  equal(state.author, 'Tester');
  equal(state.beverageType, 'espresso');
  equal(state.tankTemperature, 90);
  equal(state.targetWeight, 36);
  equal(state.steps.length, 2);
  equal(state.steps[0].name, 'Preinfusion');
  equal(state.steps[0].pump, 'flow');
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

run('addStep appends and selects the new step', () => {
  const state = createProfileEditorState(null);
  const next = addStep(state);
  equal(next.steps.length, 2);
  equal(next.selectedStep, 1);
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
  const profile = profileFromEditorState(state);
  const steps = profile.steps as Record<string, unknown>[];

  equal(steps[0].weird_custom_key, 'keepme');
  equal(steps[0].pump, 'flow');
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

function sampleProfile(): Profile {
  return {
    title: 'Sample',
    author: 'Tester',
    beverage_type: 'espresso',
    tank_temperature: 90,
    target_weight: 36,
    version: '2',
    steps: [
      {
        name: 'Preinfusion',
        pump: 'flow',
        flow: 4,
        temperature: 92,
        seconds: 10,
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
  };
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
