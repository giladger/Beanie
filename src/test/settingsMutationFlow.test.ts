import type { DisplayState } from '../api/settings';
import {
  SettingsMutationFlow,
  applySettingsMutationOutcome,
  type SettingsMutationRemotePort,
  type SettingsMutationStart
} from '../controllers/settingsMutationFlow';
import {
  applySettingsBundleMutation,
  type SettingsFieldValue,
  type WakeSchedulePatch
} from '../domain/settingsBundleMutation';
import {
  demoSettingsBundle,
  type SettingsBundle,
  type SettingsGroup
} from '../domain/settingsModel';

await run('field failure rolls back only its scalar and preserves concurrent fields', async () => {
  const remote = fakeRemote();
  remote.persistFieldImpl = async () => {
    throw new Error('settings unavailable');
  };
  const flow = new SettingsMutationFlow(remote);
  const original = demoSettingsBundle();
  const started = requireStarted(flow.setField({
    bundle: original,
    field: { group: 'rea', key: 'logLevel', label: 'Log level' },
    value: 'FINE',
    local: false,
    writable: true
  }));
  let bundle = applySettingsBundleMutation(original, started.optimistic);
  bundle = applySettingsBundleMutation(bundle, {
    type: 'set-field',
    field: { group: 'rea', key: 'automaticUpdateCheck' },
    value: false
  });

  const outcome = await started.completion;
  bundle = applySettingsMutationOutcome(bundle, outcome);

  equal(outcome.type, 'failed');
  equal(bundle.rea.logLevel, original.rea.logLevel);
  equal(bundle.rea.automaticUpdateCheck, false);
  flow.dispose();
});

await run('a stale field failure cannot roll back the latest optimistic revision', async () => {
  const remote = fakeRemote();
  const firstWrite = deferred<void>();
  const secondWrite = deferred<void>();
  let calls = 0;
  remote.persistFieldImpl = () => (++calls === 1 ? firstWrite.promise : secondWrite.promise);
  const flow = new SettingsMutationFlow(remote);
  let bundle = demoSettingsBundle();

  const first = requireStarted(flow.setField({
    bundle,
    field: { group: 'rea', key: 'logLevel', label: 'Log level' },
    value: 'FINE',
    local: false,
    writable: true
  }));
  bundle = applySettingsBundleMutation(bundle, first.optimistic);
  const second = requireStarted(flow.setField({
    bundle,
    field: { group: 'rea', key: 'logLevel', label: 'Log level' },
    value: 'SEVERE',
    local: false,
    writable: true
  }));
  bundle = applySettingsBundleMutation(bundle, second.optimistic);
  await settle();

  firstWrite.reject(new Error('old write failed'));
  const stale = await first.completion;
  bundle = applySettingsMutationOutcome(bundle, stale);

  equal(stale.type, 'discarded');
  equal(stale.type === 'discarded' ? stale.reason : null, 'stale');
  equal(bundle.rea.logLevel, 'SEVERE');
  secondWrite.resolve(undefined);
  equal((await second.completion).type, 'saved');
  flow.dispose();
});

await run('two failed revisions restore the last confirmed value, not an earlier optimistic value', async () => {
  const remote = fakeRemote();
  const firstWrite = deferred<void>();
  const secondWrite = deferred<void>();
  let calls = 0;
  remote.persistFieldImpl = () => (++calls === 1 ? firstWrite.promise : secondWrite.promise);
  const flow = new SettingsMutationFlow(remote);
  const original = demoSettingsBundle();
  let bundle = original;

  const first = requireStarted(flow.setField({
    bundle,
    field: { group: 'rea', key: 'logLevel', label: 'Log level' },
    value: 'FINE',
    local: false,
    writable: true
  }));
  bundle = applySettingsBundleMutation(bundle, first.optimistic);
  const second = requireStarted(flow.setField({
    bundle,
    field: { group: 'rea', key: 'logLevel', label: 'Log level' },
    value: 'SEVERE',
    local: false,
    writable: true
  }));
  bundle = applySettingsBundleMutation(bundle, second.optimistic);
  await settle();

  firstWrite.reject(new Error('first failed'));
  await first.completion;
  secondWrite.reject(new Error('second failed'));
  const failure = await second.completion;
  bundle = applySettingsMutationOutcome(bundle, failure);

  equal(failure.type, 'failed');
  equal(bundle.rea.logLevel, original.rea.logLevel);
  flow.dispose();
});

await run('a stale successful revision becomes the rollback baseline for a newer failure', async () => {
  const remote = fakeRemote();
  const firstWrite = deferred<void>();
  const secondWrite = deferred<void>();
  let calls = 0;
  remote.persistFieldImpl = () => (++calls === 1 ? firstWrite.promise : secondWrite.promise);
  const flow = new SettingsMutationFlow(remote);
  let bundle = demoSettingsBundle();

  const first = requireStarted(flow.setField({
    bundle,
    field: { group: 'rea', key: 'logLevel', label: 'Log level' },
    value: 'FINE',
    local: false,
    writable: true
  }));
  bundle = applySettingsBundleMutation(bundle, first.optimistic);
  const second = requireStarted(flow.setField({
    bundle,
    field: { group: 'rea', key: 'logLevel', label: 'Log level' },
    value: 'SEVERE',
    local: false,
    writable: true
  }));
  bundle = applySettingsBundleMutation(bundle, second.optimistic);
  await settle();

  firstWrite.resolve(undefined);
  equal((await first.completion).type, 'discarded');
  secondWrite.reject(new Error('latest failed'));
  const failure = await second.completion;
  bundle = applySettingsMutationOutcome(bundle, failure);

  equal(bundle.rea.logLevel, 'FINE');
  flow.dispose();
});

await run('a late older success cannot replace a newer confirmed rollback baseline', async () => {
  const remote = fakeRemote();
  const firstWrite = deferred<void>();
  const secondWrite = deferred<void>();
  const thirdWrite = deferred<void>();
  let calls = 0;
  remote.persistFieldImpl = () => {
    calls += 1;
    return calls === 1 ? firstWrite.promise : calls === 2 ? secondWrite.promise : thirdWrite.promise;
  };
  const flow = new SettingsMutationFlow(remote);
  let bundle = demoSettingsBundle();
  const field = { group: 'rea' as const, key: 'logLevel', label: 'Log level' };

  const first = requireStarted(flow.setField({
    bundle,
    field,
    value: 'FINE',
    local: false,
    writable: true
  }));
  bundle = applySettingsBundleMutation(bundle, first.optimistic);
  const second = requireStarted(flow.setField({
    bundle,
    field,
    value: 'SEVERE',
    local: false,
    writable: true
  }));
  bundle = applySettingsBundleMutation(bundle, second.optimistic);
  await settle();

  secondWrite.resolve(undefined);
  equal((await second.completion).type, 'saved');
  const third = requireStarted(flow.setField({
    bundle,
    field,
    value: 'WARNING',
    local: false,
    writable: true
  }));
  bundle = applySettingsBundleMutation(bundle, third.optimistic);
  await settle();

  firstWrite.resolve(undefined);
  equal((await first.completion).type, 'discarded');
  thirdWrite.reject(new Error('latest failed'));
  bundle = applySettingsMutationOutcome(bundle, await third.completion);

  equal(bundle.rea.logLevel, 'SEVERE');
  flow.dispose();
});

await run('brightness reconciliation and rollback preserve concurrent wake-lock state', async () => {
  const remote = fakeRemote();
  remote.displayImpl = async () => display({ brightness: 38, requestedBrightness: 38 });
  const flow = new SettingsMutationFlow(remote);
  let bundle = demoSettingsBundle();
  const saved = requireStarted(flow.setDisplayBrightness({
    bundle,
    brightness: 40,
    local: false,
    writable: true
  }));
  bundle = applySettingsBundleMutation(bundle, saved.optimistic);
  bundle = applySettingsBundleMutation(bundle, {
    type: 'patch-display',
    patch: { wakeLockEnabled: false, wakeLockOverride: true }
  });
  const savedOutcome = await saved.completion;
  bundle = applySettingsMutationOutcome(bundle, savedOutcome);

  equal(bundle.display.brightness, 38);
  equal(bundle.display.requestedBrightness, 38);
  equal(bundle.display.wakeLockEnabled, false);
  equal(bundle.display.wakeLockOverride, true);

  remote.displayImpl = async () => {
    throw new Error('display failed');
  };
  const failed = requireStarted(flow.setDisplayBrightness({
    bundle,
    brightness: 20,
    local: false,
    writable: true
  }));
  bundle = applySettingsBundleMutation(bundle, failed.optimistic);
  bundle = applySettingsBundleMutation(bundle, {
    type: 'patch-display',
    patch: { wakeLockOverride: false }
  });
  bundle = applySettingsMutationOutcome(bundle, await failed.completion);

  equal(bundle.display.brightness, 38);
  equal(bundle.display.wakeLockOverride, false);
  flow.dispose();
});

await run('a null brightness result is explicitly superseded and never dereferenced or rolled back', async () => {
  const remote = fakeRemote();
  remote.displayImpl = async () => null;
  const flow = new SettingsMutationFlow(remote);
  let bundle = demoSettingsBundle();
  const started = requireStarted(flow.setDisplayBrightness({
    bundle,
    brightness: 25,
    local: false,
    writable: true
  }));
  bundle = applySettingsBundleMutation(bundle, started.optimistic);

  const outcome = await started.completion;
  const projected = applySettingsMutationOutcome(bundle, outcome);

  equal(outcome.type, 'discarded');
  equal(outcome.type === 'discarded' ? outcome.reason : null, 'superseded');
  equal(projected, bundle);
  equal(bundle.display.brightness, 25);
  flow.dispose();
});

await run('a rejected schedule deletion restores its item at the original index without dropping additions', async () => {
  const remote = fakeRemote();
  remote.deleteScheduleImpl = async () => false;
  const flow = new SettingsMutationFlow(remote);
  const target = schedule('target', '06:30', true);
  let bundle: SettingsBundle = {
    ...demoSettingsBundle(),
    schedules: [schedule('first', '06:00', true), target, schedule('last', '07:00', true)]
  };
  const started = requireStarted(flow.deleteSchedule({
    bundle,
    id: target.id,
    local: false,
    writable: true
  }));
  bundle = applySettingsBundleMutation(bundle, started.optimistic);
  bundle = applySettingsBundleMutation(bundle, {
    type: 'add-schedule',
    schedule: schedule('concurrent', '08:00', true)
  });

  const outcome = await started.completion;
  bundle = applySettingsMutationOutcome(bundle, outcome);

  equal(outcome.type, 'failed');
  equal(bundle.schedules.map((item) => item.id).join(','), 'first,target,last,concurrent');
  flow.dispose();
});

await run('a failed deletion restores its schedule while an earlier toggle is still settling', async () => {
  const remote = fakeRemote();
  const toggleWrite = deferred<void>();
  const deleteWrite = deferred<boolean>();
  remote.updateScheduleImpl = () => toggleWrite.promise;
  remote.deleteScheduleImpl = () => deleteWrite.promise;
  const flow = new SettingsMutationFlow(remote);
  let bundle: SettingsBundle = {
    ...demoSettingsBundle(),
    schedules: [schedule('target', '06:30', true)]
  };

  const toggle = requireStarted(flow.toggleSchedule({
    bundle,
    id: 'target',
    enabled: false,
    local: false,
    writable: true
  }));
  bundle = applySettingsBundleMutation(bundle, toggle.optimistic);
  const deletion = requireStarted(flow.deleteSchedule({
    bundle,
    id: 'target',
    local: false,
    writable: true
  }));
  bundle = applySettingsBundleMutation(bundle, deletion.optimistic);
  await settle();

  equal(toggle.key === deletion.key, false);
  toggleWrite.resolve(undefined);
  bundle = applySettingsMutationOutcome(bundle, await toggle.completion);
  deleteWrite.resolve(false);
  const failedDelete = await deletion.completion;
  bundle = applySettingsMutationOutcome(bundle, failedDelete);

  equal(failedDelete.type, 'failed');
  equal(bundle.schedules.length, 1);
  equal(bundle.schedules[0]?.id, 'target');
  equal(bundle.schedules[0]?.enabled, false);
  flow.dispose();
});

await run('toggle and delete failures restore the original remote-confirmed schedule', async () => {
  const remote = fakeRemote();
  const toggleWrite = deferred<void>();
  const deleteWrite = deferred<boolean>();
  remote.updateScheduleImpl = () => toggleWrite.promise;
  remote.deleteScheduleImpl = () => deleteWrite.promise;
  const flow = new SettingsMutationFlow(remote);
  let bundle: SettingsBundle = {
    ...demoSettingsBundle(),
    schedules: [schedule('target', '06:30', true)]
  };

  const toggle = requireStarted(flow.toggleSchedule({
    bundle,
    id: 'target',
    enabled: false,
    local: false,
    writable: true
  }));
  bundle = applySettingsBundleMutation(bundle, toggle.optimistic);
  const deletion = requireStarted(flow.deleteSchedule({
    bundle,
    id: 'target',
    local: false,
    writable: true
  }));
  bundle = applySettingsBundleMutation(bundle, deletion.optimistic);
  await settle();

  toggleWrite.reject(new Error('toggle failed'));
  const failedToggle = await toggle.completion;
  bundle = applySettingsMutationOutcome(bundle, failedToggle);
  deleteWrite.resolve(false);
  const failedDelete = await deletion.completion;
  bundle = applySettingsMutationOutcome(bundle, failedDelete);

  equal(failedToggle.type, 'failed');
  equal(failedDelete.type, 'failed');
  equal(bundle.schedules.length, 1);
  equal(bundle.schedules[0]?.id, 'target');
  equal(bundle.schedules[0]?.enabled, true);
  flow.dispose();
});

await run('schedule and plugin toggles roll back only their selected item', async () => {
  const remote = fakeRemote();
  remote.updateScheduleImpl = async () => {
    throw new Error('schedule failed');
  };
  remote.pluginImpl = async () => {
    throw new Error('plugin failed');
  };
  const flow = new SettingsMutationFlow(remote);
  let bundle: SettingsBundle = {
    ...demoSettingsBundle(),
    schedules: [schedule('target', '06:00', true), schedule('other', '07:00', false)]
  };

  const scheduleToggle = requireStarted(flow.toggleSchedule({
    bundle,
    id: 'target',
    enabled: false,
    local: false,
    writable: true
  }));
  bundle = applySettingsBundleMutation(bundle, scheduleToggle.optimistic);
  bundle = applySettingsBundleMutation(bundle, {
    type: 'update-schedule',
    id: 'other',
    patch: { time: '08:30', enabled: true }
  });
  bundle = applySettingsMutationOutcome(bundle, await scheduleToggle.completion);
  equal(bundle.schedules.find((item) => item.id === 'target')?.enabled, true);
  equal(bundle.schedules.find((item) => item.id === 'other')?.time, '08:30');

  const pluginToggle = requireStarted(flow.togglePlugin({
    bundle,
    id: 'visualizer',
    loaded: false,
    local: false,
    writable: true
  }));
  bundle = applySettingsBundleMutation(bundle, pluginToggle.optimistic);
  bundle = applySettingsBundleMutation(bundle, {
    type: 'update-plugin',
    id: 'time-to-ready',
    patch: { loaded: true, version: '2.0.0' }
  });
  bundle = applySettingsMutationOutcome(bundle, await pluginToggle.completion);
  equal(bundle.plugins.find((item) => item.id === 'visualizer')?.loaded, true);
  equal(bundle.plugins.find((item) => item.id === 'time-to-ready')?.version, '2.0.0');
  flow.dispose();
});

await run('local no-scale mutation skips remote I/O and exposes its semantic effect', async () => {
  const remote = fakeRemote();
  const flow = new SettingsMutationFlow(remote);
  let bundle = {
    ...demoSettingsBundle(),
    rea: { ...demoSettingsBundle().rea, blockOnNoScale: true }
  };
  const started = requireStarted(flow.setNoScaleBlock({
    bundle,
    enabled: false,
    previousKnown: true,
    local: true,
    writable: false
  }));
  bundle = applySettingsBundleMutation(bundle, started.optimistic);

  const outcome = await started.completion;

  equal(outcome.type, 'saved');
  equal(outcome.type === 'saved' ? outcome.source : null, 'local');
  equal(outcome.type === 'saved' ? outcome.effect?.noScaleBlock : null, 'disabled');
  equal(bundle.rea.blockOnNoScale, false);
  equal(remote.calls.persistField, 0);
  flow.dispose();
});

await run('an explicit no-scale disable is persisted even when the fallback bundle already reads disabled', async () => {
  const remote = fakeRemote();
  const flow = new SettingsMutationFlow(remote);
  const started = requireStarted(flow.setNoScaleBlock({
    bundle: demoSettingsBundle(),
    enabled: false,
    previousKnown: false,
    local: false,
    writable: true
  }));

  const outcome = await started.completion;

  equal(outcome.type, 'saved');
  equal(outcome.type === 'saved' ? outcome.effect?.noScaleBlock : null, 'disabled');
  equal(remote.calls.persistField, 1);
  flow.dispose();
});

await run('a successful no-scale write reconciles a bundle loaded while it was in flight', async () => {
  const remote = fakeRemote();
  const write = deferred<void>();
  remote.persistFieldImpl = () => write.promise;
  const flow = new SettingsMutationFlow(remote);
  const started = requireStarted(flow.setNoScaleBlock({
    bundle: demoSettingsBundle(),
    enabled: false,
    previousKnown: false,
    local: false,
    writable: true
  }));
  const loaded = demoSettingsBundle();
  const authoritative: SettingsBundle = {
    ...loaded,
    rea: { ...loaded.rea, blockOnNoScale: true }
  };
  await settle();

  write.resolve(undefined);
  const outcome = await started.completion;
  const projected = applySettingsMutationOutcome(authoritative, outcome);

  equal(outcome.type, 'saved');
  equal(outcome.type === 'saved' ? outcome.reconcile?.type : null, 'set-field');
  equal(projected.rea.blockOnNoScale, false);
  flow.dispose();
});

await run('a failed no-scale write from a fallback cannot overwrite a newly loaded bundle', async () => {
  const remote = fakeRemote();
  const write = deferred<void>();
  remote.persistFieldImpl = () => write.promise;
  const flow = new SettingsMutationFlow(remote);
  const started = requireStarted(flow.setNoScaleBlock({
    bundle: demoSettingsBundle(),
    enabled: false,
    previousKnown: false,
    local: false,
    writable: true
  }));
  const loaded = demoSettingsBundle();
  const authoritative: SettingsBundle = {
    ...loaded,
    rea: { ...loaded.rea, blockOnNoScale: true }
  };
  await settle();

  write.reject(new Error('write failed'));
  const outcome = await started.completion;
  const projected = applySettingsMutationOutcome(authoritative, outcome);

  equal(outcome.type, 'failed');
  equal(outcome.type === 'failed' ? outcome.rollback : 'not-failed', null);
  equal(projected, authoritative);
  equal(projected.rea.blockOnNoScale, true);
  flow.dispose();
});

await run('read-only resources reject before revision ownership or remote I/O', async () => {
  const remote = fakeRemote();
  const flow = new SettingsMutationFlow(remote);
  const result = flow.setField({
    bundle: demoSettingsBundle(),
    field: { group: 'rea', key: 'logLevel', label: 'Log level' },
    value: 'FINE',
    local: false,
    writable: false
  });

  equal(result.type, 'rejected');
  equal(result.type === 'rejected' ? result.reason : null, 'read-only');
  equal(Object.keys(flow.snapshot.revisions).length, 0);
  await settle();
  equal(remote.calls.persistField, 0);
  flow.dispose();
});

await run('optimistic patches are returned before the injected remote port starts', async () => {
  const remote = fakeRemote();
  const flow = new SettingsMutationFlow(remote);
  const started = requireStarted(flow.setField({
    bundle: demoSettingsBundle(),
    field: { group: 'rea', key: 'logLevel', label: 'Log level' },
    value: 'FINE',
    local: false,
    writable: true
  }));

  equal(remote.calls.persistField, 0);
  equal(flow.snapshot.pending[started.key], started.revision);
  await started.completion;
  equal(remote.calls.persistField, 1);
  equal(flow.snapshot.pending[started.key], undefined);
  flow.dispose();
});

await run('disposal fences a pending completion without canceling its remote side effect', async () => {
  const remote = fakeRemote();
  const write = deferred<void>();
  remote.persistFieldImpl = () => write.promise;
  const flow = new SettingsMutationFlow(remote);
  const started = requireStarted(flow.setField({
    bundle: demoSettingsBundle(),
    field: { group: 'rea', key: 'logLevel', label: 'Log level' },
    value: 'FINE',
    local: false,
    writable: true
  }));
  await settle();

  flow.dispose();
  write.resolve(undefined);
  const outcome = await started.completion;

  equal(outcome.type, 'discarded');
  equal(outcome.type === 'discarded' ? outcome.reason : null, 'disposed');
  equal(remote.calls.persistField, 1);
});

interface FakeRemote extends SettingsMutationRemotePort {
  calls: Record<'persistField' | 'display' | 'deleteSchedule' | 'updateSchedule' | 'plugin', number>;
  persistFieldImpl(group: SettingsGroup, key: string, value: SettingsFieldValue): Promise<void>;
  displayImpl(brightness: number): Promise<DisplayState | null>;
  deleteScheduleImpl(id: string): Promise<boolean>;
  updateScheduleImpl(id: string, patch: WakeSchedulePatch): Promise<void>;
  pluginImpl(id: string, loaded: boolean): Promise<void>;
}

function fakeRemote(): FakeRemote {
  const calls = { persistField: 0, display: 0, deleteSchedule: 0, updateSchedule: 0, plugin: 0 };
  const remote: FakeRemote = {
    calls,
    persistFieldImpl: async () => {},
    displayImpl: async (brightness) => display({ brightness, requestedBrightness: brightness }),
    deleteScheduleImpl: async () => true,
    updateScheduleImpl: async () => {},
    pluginImpl: async () => {},
    async persistField(group, key, value) {
      calls.persistField += 1;
      await remote.persistFieldImpl(group, key, value);
    },
    async setDisplayBrightness(brightness) {
      calls.display += 1;
      return await remote.displayImpl(brightness);
    },
    async deleteSchedule(id) {
      calls.deleteSchedule += 1;
      return await remote.deleteScheduleImpl(id);
    },
    async updateSchedule(id, patch) {
      calls.updateSchedule += 1;
      await remote.updateScheduleImpl(id, patch);
    },
    async setPluginLoaded(id, loaded) {
      calls.plugin += 1;
      await remote.pluginImpl(id, loaded);
    }
  };
  return remote;
}

function requireStarted(start: SettingsMutationStart): Extract<SettingsMutationStart, { type: 'started' }> {
  if (start.type !== 'started') throw new Error(`Expected started mutation, received ${start.type}`);
  return start;
}

function display(overrides: Partial<DisplayState> = {}): DisplayState {
  return {
    ...demoSettingsBundle().display,
    platformSupported: { ...demoSettingsBundle().display.platformSupported },
    ...overrides
  };
}

function schedule(id: string, time: string, enabled: boolean) {
  return { id, time, enabled, daysOfWeek: [1, 2, 3, 4, 5], keepAwakeFor: 60 };
}

interface Deferred<Value> {
  promise: Promise<Value>;
  resolve(value: Value): void;
  reject(error: unknown): void;
}

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Value>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function run(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

function equal<T>(actual: T, expected: T): void {
  if (actual !== expected) throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
}
