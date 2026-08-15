import type { Profile } from '../api/types';
import {
  addStep,
  setAdvancedTab,
  selectStep,
  createProfileEditorState,
  duplicateStep,
  moveStep,
  nudgeSimpleProfileField,
  nudgeStepField,
  profileFromEditorState,
  removeStep,
  renderEditorKindTag,
  renderProfileEditor,
  setProfileMeta,
  setSimpleProfileField,
  setStepExit,
  setStepField,
  setStepPump
} from '../components/profileEditor';
import { PROFILE_BEVERAGE_TYPES } from '../domain/profileModel';
import { canEditAsBasic, parseStepsToSimple } from '../domain/simpleProfile';

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

run('creates a usable simple pressure profile from null', () => {
  const state = createProfileEditorState(null);

  // A new profile starts as a canonical three-stage pressure profile, so the
  // basic editor is reachable without anything having to rewrite the steps to
  // get there (de1app likewise defaults a new preset to settings_2a).
  equal(state.steps.length, 3);
  equal(state.type, 'pressure');
  equal(state.legacyProfileType, 'settings_2a');
  equal(state.steps[1].pump, 'pressure');
  equal(canEditAsBasic(state.steps), true);
  equal(state.editorMode, 'basic');
  equal(state.selectedStep, 0);
  equal(state.dirty, false);
  equal(state.saveError, null);
});

run('prefills the reaprime-required meta fields on a new profile', () => {
  // reaprime rejects a profile that lacks tank_temperature or
  // target_volume_count_start; a new profile prefills their canonical defaults
  // (0) rather than leaving them unset.
  const state = createProfileEditorState(null);
  equal(state.tankTemperature, 0);
  equal(state.targetVolumeCountStart, 0);

  const profile = profileFromEditorState(state) as Record<string, unknown>;
  equal('tank_temperature' in profile, true);
  equal(profile.tank_temperature, 0);
  equal('target_volume_count_start' in profile, true);
  equal(profile.target_volume_count_start, 0);
});

run('always serializes the required meta fields even when cleared', () => {
  // Clearing the limits fields must not drop the keys and reintroduce the silent
  // save failure — they fall back to their defaults instead. target_weight /
  // target_volume stay optional and are omitted when unset.
  const state = {
    ...createProfileEditorState(null),
    tankTemperature: null,
    targetVolumeCountStart: null,
    targetWeight: null,
    targetVolume: null
  };
  const profile = profileFromEditorState(state) as Record<string, unknown>;
  equal(profile.tank_temperature, 0);
  equal(profile.target_volume_count_start, 0);
  equal('target_weight' in profile, false);
  equal('target_volume' in profile, false);
});

run('setStepField coerces numeric fields', () => {
  const state = createProfileEditorState(null);
  const next = setStepField(state, 0, 'temperature', '94.5');

  equal(next.steps[0].temperature, 94.5);
  equal(next.dirty, true);

  const cleared = setStepField(state, 0, 'pressure', '');
  equal(cleared.steps[0].pressure, 0);
});

run('nudgeStepField clamps to the same min/max the edit dialog enforces', () => {
  const state = createProfileEditorState(null);

  // pressure tops out at the dialog max (12 bar) no matter how often + is tapped
  let pressured = setStepField(state, 0, 'pressure', '11.9');
  pressured = nudgeStepField(pressured, 0, 'pressure', 0.1);
  equal(pressured.steps[0].pressure, 12);
  pressured = nudgeStepField(pressured, 0, 'pressure', 0.1);
  equal(pressured.steps[0].pressure, 12);

  // seconds cap at 127 — the DE1 step encoding can't represent more
  let timed = setStepField(state, 0, 'seconds', '126.5');
  timed = nudgeStepField(timed, 0, 'seconds', 1);
  equal(timed.steps[0].seconds, 127);
  timed = nudgeStepField(timed, 0, 'seconds', 1);
  equal(timed.steps[0].seconds, 127);

  // temperature stops at the dialog min (1 °C), not the old unconditional 0 floor
  let cooled = setStepField(state, 0, 'temperature', '1.4');
  cooled = nudgeStepField(cooled, 0, 'temperature', -0.5);
  equal(cooled.steps[0].temperature, 1);
  cooled = nudgeStepField(cooled, 0, 'temperature', -0.5);
  equal(cooled.steps[0].temperature, 1);
});

run('nudgeStepField keeps the limiter range at its non-zero floor', () => {
  let state = createProfileEditorState(sampleProfile()); // step 0 has limiter range 0.6
  for (let i = 0; i < 12; i += 1) state = nudgeStepField(state, 0, 'limiter_range', -0.1);
  equal(state.steps[0].limiter?.range, 0.1);
});

run('nudgeSimpleProfileField clamps to the basic dialog ranges', () => {
  const state = createProfileEditorState(pressureProfile());

  // a pressure profile's target tops out at 12 bar
  let up = setSimpleProfileField(state, 'hold_target', '12');
  up = nudgeSimpleProfileField(up, 'hold_target', 0.1);
  equal(parseStepsToSimple(up.steps)?.hold.target, 12);

  // its cap is on the flow axis, so that one tops out at 8 ml/s
  let fast = setSimpleProfileField(state, 'limit', '8');
  fast = nudgeSimpleProfileField(fast, 'limit', 0.1);
  equal(parseStepsToSimple(fast.steps)?.limit, 8);

  // temperature stops at 1 °C, not 0
  let cooled = setSimpleProfileField(state, 'hold_temp', '1');
  cooled = nudgeSimpleProfileField(cooled, 'hold_temp', -0.5);
  equal(parseStepsToSimple(cooled.steps)?.hold.temperature, 1);

  // stop_volume lives on targetVolume and is clamped to 100 ml
  let vol = setSimpleProfileField(state, 'stop_volume', '99.5');
  vol = nudgeSimpleProfileField(vol, 'stop_volume', 1);
  equal(vol.targetVolume, 100);
  vol = nudgeSimpleProfileField(vol, 'stop_volume', 1);
  equal(vol.targetVolume, 100);
});

run('each stage keeps its own temperature in the basic editor', () => {
  const state = createProfileEditorState(pressureProfile());
  const next = setSimpleProfileField(setSimpleProfileField(state, 'pre_temp', '94'), 'decline_temp', '88');

  equal(next.steps[0].temperature, 94);
  equal(next.steps[2].temperature, 88);
  equal(canEditAsBasic(next.steps), true);
});

run('a simple profile chases one axis, with one cap on the other', () => {
  // de1app's simple editor has no per-stage pump: settings_2a is a pressure
  // profile, settings_2b a flow one. So a stage exposes its target, and the only
  // knob on the other axis is the profile's single cap.
  const state = createProfileEditorState(pressureProfile());
  equal(state.type, 'pressure');
  equal(state.steps[1].pump, 'pressure');
  equal(state.steps[2].pump, 'pressure');

  const capped = setSimpleProfileField(state, 'limit', '2.4');
  // one knob, both main stages — and never the preinfuse
  equal(capped.steps[0].limiter, null);
  equal(capped.steps[1].limiter?.value, 2.4);
  equal(capped.steps[2].limiter?.value, 2.4);
  equal(capped.type, 'pressure');
  equal(canEditAsBasic(capped.steps), true);

  // clearing it to 0 drops the limiter rather than leaving a dead one behind
  const uncapped = setSimpleProfileField(capped, 'limit', '0');
  equal(uncapped.steps[1].limiter, null);
  equal(uncapped.steps[2].limiter, null);
  equal(canEditAsBasic(uncapped.steps), true);

  // the editor offers no way to change which axis the profile chases
  const body = renderProfileEditor(state);
  equal(body.includes('pe-simple-pump'), false);
  equal(body.includes('pe-set-simple-type'), false);
});

run('setStepPump switches the controlled target', () => {
  // Step 1 is the hold stage; a new profile's preinfusion always pumps on flow.
  const state = createProfileEditorState(null);
  equal(state.steps[1].pump, 'pressure');
  const next = setStepPump(state, 1, 'flow');
  equal(next.steps[1].pump, 'flow');
  equal(state.steps[1].pump, 'pressure');
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
  const three = createProfileEditorState(null);
  equal(three.steps.length, 3);

  const one = removeStep(removeStep(three, 0), 0);
  equal(one.steps.length, 1);
  equal(removeStep(one, 0).steps.length, 1);

  equal(removeStep(three, 5).steps.length, 3);
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
  // A pressure/flow profile opens on the simple surface; the steps live in an
  // advanced profile, which is now a kind you choose at creation.
  const html = renderProfileEditor(createProfileEditorState(null, 'advanced'));

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
  // every stage carries its own time and temperature
  for (const stage of ['pre', 'hold', 'decline']) {
    includes(html, `data-key="${stage}_time"`);
    includes(html, `data-key="${stage}_temp"`);
  }
  // the main stages carry a target on the profile's axis, not a flow AND a pressure
  for (const stage of ['hold', 'decline']) {
    includes(html, `data-key="${stage}_target"`);
    equal(html.includes(`data-key="${stage}_flow"`), false);
    equal(html.includes(`data-key="${stage}_pressure"`), false);
  }
});

run('updates pressure editor scalar fields without dropping profile steps', () => {
  const state = createProfileEditorState(pressureProfile());
  const next = setSimpleProfileField(state, 'pre_until', '4.5');

  equal(next.steps.length, 3);
  equal(next.steps[0].exit?.value, 4.5);
  equal(next.dirty, true);

  // preinfusion's only pressure knob IS the exit — de1app puts no cap there
  equal(next.steps[0].limiter, null);
});

run('a value changed and changed back leaves nothing to save', () => {
  // Dirtiness is a comparison with the profile as opened, not a record of
  // having touched something — so a nudge up and back down is not an edit.
  const state = createProfileEditorState(pressureProfile());
  equal(state.dirty, false);

  const up = nudgeSimpleProfileField(state, 'hold_target', 0.1);
  equal(up.dirty, true);
  equal(nudgeSimpleProfileField(up, 'hold_target', -0.1).dirty, false);

  // the same through the numpad, and over several fields at once
  let edited = setSimpleProfileField(state, 'hold_target', '7');
  edited = setSimpleProfileField(edited, 'pre_time', '11');
  edited = setProfileMeta(edited, 'title', 'Something else');
  equal(edited.dirty, true);
  edited = setSimpleProfileField(edited, 'hold_target', String(state.steps[1]!.pressure));
  edited = setSimpleProfileField(edited, 'pre_time', String(state.steps[0]!.seconds));
  equal(edited.dirty, true); // the title is still changed
  equal(setProfileMeta(edited, 'title', state.title).dirty, false);

  // and in the advanced editor, including the fields that live off the steps
  const adv = createProfileEditorState(sampleProfile());
  const warmer = nudgeStepField(adv, 0, 'temperature', 0.5);
  equal(warmer.dirty, true);
  equal(nudgeStepField(warmer, 0, 'temperature', -0.5).dirty, false);
  equal(setProfileMeta(setProfileMeta(adv, 'notes', 'x'), 'notes', adv.notes).dirty, false);

  // a toggle flipped twice, and a step's message typed then cleared
  const sensor = setStepField(adv, 0, 'sensor', 'water');
  equal(sensor.dirty, true);
  equal(setStepField(sensor, 0, 'sensor', 'coffee').dirty, false);
  const popped = setStepField(adv, 1, 'popup', 'hi');
  equal(popped.dirty, true);
  equal(setStepField(popped, 1, 'popup', '').dirty, false);

  // looking around is never an edit
  equal(selectStep(adv, 1).dirty, false);
  equal(setAdvancedTab(adv, 'limits').dirty, false);
});

run('a step added and removed again leaves nothing to save', () => {
  const state = createProfileEditorState(sampleProfile());
  const added = addStep(state);
  equal(added.dirty, true);
  equal(added.steps.length, state.steps.length + 1);
  const removed = removeStep(added, added.selectedStep);
  equal(removed.steps.length, state.steps.length);
  equal(removed.dirty, false);

  // and a reorder undone the same way
  const moved = moveStep(state, 0, 1);
  equal(moved.dirty, true);
  equal(moveStep(moved, 1, -1).dirty, false);
});

run('setProfileMeta writes each field and marks the editor dirty', () => {
  const state = createProfileEditorState(pressureProfile());
  equal(state.dirty, false);

  // the text fields the identity panel edits
  const titled = setProfileMeta(state, 'title', 'My Default');
  equal(titled.title, 'My Default');
  equal(titled.dirty, true);
  equal(state.title, 'Default'); // the input is untouched
  equal(setProfileMeta(state, 'author', 'Gilad').author, 'Gilad');
  equal(setProfileMeta(state, 'notes', 'keeps its own notes').notes, 'keeps its own notes');
  equal(setProfileMeta(state, 'beverage_type', 'filter').beverageType, 'filter');

  // the Limits tab's numbers parse, and clearing one leaves it unset rather
  // than zero — encodeProfile is what falls back to a default on the way out
  equal(setProfileMeta(state, 'tank_temperature', '92.5').tankTemperature, 92.5);
  equal(setProfileMeta(state, 'target_weight', '36').targetWeight, 36);
  equal(setProfileMeta(state, 'target_volume', '40').targetVolume, 40);
  equal(setProfileMeta(state, 'target_volume_count_start', '2').targetVolumeCountStart, 2);
  equal(setProfileMeta(state, 'target_weight', '').targetWeight, null);
  equal(setProfileMeta(state, 'tank_temperature', 'not a number').tankTemperature, null);

  // none of it disturbs how the profile pours
  const before = JSON.stringify(state.steps);
  for (const key of ['title', 'author', 'notes', 'beverage_type', 'tank_temperature'] as const) {
    equal(JSON.stringify(setProfileMeta(state, key, '7').steps), before);
  }
});

run('opens a canonical simple profile in basic mode, advanced otherwise', () => {
  equal(createProfileEditorState(pressureProfile()).editorMode, 'basic');
  // sampleProfile is a 2-step advanced profile — not basic-editable
  equal(createProfileEditorState(sampleProfile()).editorMode, 'advanced');
});

run('a new profile is built as the kind that was chosen for it', () => {
  const pressure = createProfileEditorState(null, 'pressure');
  equal(pressure.editorMode, 'basic');
  equal(pressure.type, 'pressure');
  equal(pressure.legacyProfileType, 'settings_2a');
  equal(pressure.steps.length, 3);
  equal(pressure.steps[1]!.pump, 'pressure');
  equal(canEditAsBasic(pressure.steps), true);

  const flow = createProfileEditorState(null, 'flow');
  equal(flow.editorMode, 'basic');
  equal(flow.type, 'flow');
  equal(flow.legacyProfileType, 'settings_2b');
  equal(flow.steps[1]!.pump, 'flow');
  equal(flow.steps[2]!.pump, 'flow');
  equal(canEditAsBasic(flow.steps), true);

  // Advanced starts from a single step to build on, and opens on the steps.
  const advanced = createProfileEditorState(null, 'advanced');
  equal(advanced.editorMode, 'advanced');
  equal(advanced.steps.length, 1);

  // Pressure is the default when no kind is named.
  equal(createProfileEditorState(null).type, 'pressure');

  // Nothing is dirty on open — a new profile is a starting point, not an edit.
  for (const state of [pressure, flow, advanced]) equal(state.dirty, false);
});

run('the header tags which kind of profile is open, with no way to switch it', () => {
  const tag = (state: Parameters<typeof renderEditorKindTag>[0]) => renderEditorKindTag(state);

  includes(tag(createProfileEditorState(null, 'pressure')), 'Pressure profile');
  includes(tag(createProfileEditorState(null, 'flow')), 'Flow profile');
  includes(tag(createProfileEditorState(null, 'advanced')), 'Advanced profile');
  includes(tag(createProfileEditorState(sampleProfile())), 'Advanced profile');

  includes(tag(createProfileEditorState(pressureProfile())), 'Pressure profile');

  // A profile whose two main stages chase different axes is not a kind the
  // simple editor has — it opens on the steps, and says so.
  const mixed = createProfileEditorState(mixedAxisProfile());
  equal(mixed.editorMode, 'advanced');
  includes(tag(mixed), 'Advanced profile');

  // The tag is a label, not a control: no action wiring anywhere in it.
  equal(tag(createProfileEditorState(null)).includes('data-action'), false);
});

run('a step exit can be turned back off from the tile that set it', () => {
  // A step carries at most one exit, so if the lit tile only ever re-applied it
  // there would be no way to remove one — and 0 is no escape, since "pressure
  // over 0" fires the moment the step starts.
  const state = createProfileEditorState(sampleProfile());
  const off = renderProfileEditor(state);
  includes(off, 'data-action="pe-step-exit-preset"');

  const set = setStepExit(state, state.selectedStep, { type: 'flow', condition: 'over', value: 3 });
  const on = renderProfileEditor(set);
  includes(on, 'data-action="pe-step-exit-clear"');
  includes(on, 'turn off flow is over');

  const cleared = setStepExit(set, set.selectedStep, null);
  equal(cleared.steps[cleared.selectedStep]!.exit, null);
  equal(renderProfileEditor(cleared).includes('pe-step-exit-clear'), false);
});

run('the simple editor shows one axis and no pump choice', () => {
  const pressure = renderProfileEditor(createProfileEditorState(pressureProfile()));
  // the profile's own axis is the target; the other appears once, as the cap
  includes(pressure, 'data-key="hold_target"');
  includes(pressure, 'data-key="limit"');
  includes(pressure, '>limit flow<');
  equal(pressure.includes('data-action="pe-simple-pump"'), false);
  equal(pressure.includes('>pressure limit<'), false);

  // a flow profile mirrors it: flow targets, one pressure cap
  const flowState = createProfileEditorState(null, 'flow');
  const flowHtml = renderProfileEditor(flowState);
  includes(flowHtml, '>limit pressure<');
  equal(flowHtml.includes('>limit flow<'), false);

  // preinfusion is flow-pumped on both, and carries no cap of its own
  for (const html of [pressure, flowHtml]) {
    includes(html, 'data-key="pre_flow"');
    includes(html, 'data-key="pre_until"');
  }
});

// f / p / f — hold and decline chase different axes, which no de1app simple page
// can show, so it is an advanced profile.
function mixedAxisProfile(): Profile {
  const base = pressureProfile() as unknown as Record<string, unknown>;
  const steps = (base.steps as Record<string, unknown>[]).map((step, index) =>
    index === 2 ? { ...step, pump: 'flow', flow: 2, pressure: 0 } : step
  );
  return { ...base, steps } as unknown as Profile;
}

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
