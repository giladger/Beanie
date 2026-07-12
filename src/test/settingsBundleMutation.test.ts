import type { DisplayState, PluginInfo, WakeSchedule } from '../api/settings';
import {
  applySettingsBundleMutation,
  applySettingsBundleMutations
} from '../domain/settingsBundleMutation';
import { demoSettingsBundle, type SettingsBundle } from '../domain/settingsModel';

await run('field mutations clone only the targeted settings group', () => {
  const bundle = demoSettingsBundle();
  const next = applySettingsBundleMutation(bundle, {
    type: 'set-field',
    field: { group: 'advanced', key: 'heaterVoltage' },
    value: 120
  });

  equal(next.advanced.heaterVoltage, 120);
  equal(bundle.advanced.heaterVoltage, 230);
  equal(next === bundle, false);
  equal(next.advanced === bundle.advanced, false);
  equal(next.rea === bundle.rea, true);
  equal(next.display === bundle.display, true);
  equal(next.schedules === bundle.schedules, true);
  equal(next.plugins === bundle.plugins, true);
});

await run('field mutations return the original bundle when the value is unchanged', () => {
  const bundle = demoSettingsBundle();
  const next = applySettingsBundleMutation(bundle, {
    type: 'set-field',
    field: { group: 'rea', key: 'blockOnNoScale' },
    value: bundle.rea.blockOnNoScale
  });

  equal(next === bundle, true);
});

await run('targeted field rollback preserves a concurrent field in the same group', () => {
  const bundle = demoSettingsBundle();
  const optimistic = applySettingsBundleMutation(bundle, {
    type: 'set-field',
    field: { group: 'rea', key: 'blockOnNoScale' },
    value: true
  });
  const concurrent = applySettingsBundleMutation(optimistic, {
    type: 'set-field',
    field: { group: 'rea', key: 'logLevel' },
    value: 'FINE'
  });
  const rolledBack = applySettingsBundleMutation(concurrent, {
    type: 'set-field',
    field: { group: 'rea', key: 'blockOnNoScale' },
    value: bundle.rea.blockOnNoScale
  });

  equal(rolledBack.rea.blockOnNoScale, bundle.rea.blockOnNoScale);
  equal(rolledBack.rea.logLevel, 'FINE');
});

await run('display patches merge nested platform support without replacing other resources', () => {
  const bundle = demoSettingsBundle();
  const next = applySettingsBundleMutation(bundle, {
    type: 'patch-display',
    patch: {
      brightness: 35,
      requestedBrightness: 35,
      platformSupported: { brightness: false }
    }
  });

  equal(next.display.brightness, 35);
  equal(next.display.requestedBrightness, 35);
  equal(next.display.platformSupported.brightness, false);
  equal(next.display.platformSupported.wakeLock, bundle.display.platformSupported.wakeLock);
  equal(bundle.display.brightness, 100);
  equal(next.rea === bundle.rea, true);
  equal(next.schedules === bundle.schedules, true);
});

await run('display replacement copies the value and treats an equal replacement as a no-op', () => {
  const bundle = demoSettingsBundle();
  const display: DisplayState = {
    ...bundle.display,
    brightness: 42,
    requestedBrightness: 42,
    platformSupported: { ...bundle.display.platformSupported }
  };
  const next = applySettingsBundleMutation(bundle, { type: 'replace-display', display });

  equal(next.display.brightness, 42);
  equal(next.display === display, false);
  equal(next.display.platformSupported === display.platformSupported, false);
  display.platformSupported.brightness = false;
  equal(next.display.platformSupported.brightness, true);

  const unchanged = applySettingsBundleMutation(next, {
    type: 'replace-display',
    display: { ...next.display, platformSupported: { ...next.display.platformSupported } }
  });
  equal(unchanged === next, true);
});

await run('targeted display rollback preserves concurrent display fields', () => {
  const bundle = demoSettingsBundle();
  const optimistic = applySettingsBundleMutation(bundle, {
    type: 'patch-display',
    patch: { brightness: 25, requestedBrightness: 25 }
  });
  const concurrent = applySettingsBundleMutation(optimistic, {
    type: 'patch-display',
    patch: { wakeLockOverride: true }
  });
  const rolledBack = applySettingsBundleMutation(concurrent, {
    type: 'patch-display',
    patch: {
      brightness: bundle.display.brightness,
      requestedBrightness: bundle.display.requestedBrightness
    }
  });

  equal(rolledBack.display.brightness, bundle.display.brightness);
  equal(rolledBack.display.requestedBrightness, bundle.display.requestedBrightness);
  equal(rolledBack.display.wakeLockOverride, true);
});

await run('schedule add inserts a detached copy and ignores duplicate ids', () => {
  const bundle = demoSettingsBundle();
  const schedule = wakeSchedule('new', '07:15', false);
  const next = applySettingsBundleMutation(bundle, {
    type: 'add-schedule',
    schedule,
    index: 0
  });

  equal(next.schedules.map((item) => item.id).join(','), 'new,demo-1');
  equal(next.schedules[0] === schedule, false);
  schedule.daysOfWeek.push(7);
  equal(next.schedules[0]?.daysOfWeek.includes(7), false);
  equal(bundle.schedules.length, 1);

  const duplicate = applySettingsBundleMutation(next, {
    type: 'add-schedule',
    schedule: wakeSchedule('new', '08:00', true)
  });
  equal(duplicate === next, true);
});

await run('schedule removal and targeted restore preserve concurrent additions', () => {
  const bundle = withSchedules(
    wakeSchedule('first', '06:00', true),
    wakeSchedule('target', '06:30', true),
    wakeSchedule('last', '07:00', true)
  );
  const removed = applySettingsBundleMutation(bundle, { type: 'remove-schedule', id: 'target' });
  const withConcurrentAdd = applySettingsBundleMutation(removed, {
    type: 'add-schedule',
    schedule: wakeSchedule('concurrent', '08:00', true)
  });
  const restored = applySettingsBundleMutation(withConcurrentAdd, {
    type: 'restore-schedule',
    schedule: bundle.schedules[1]!,
    index: 1
  });

  equal(removed.schedules.map((item) => item.id).join(','), 'first,last');
  equal(restored.schedules.map((item) => item.id).join(','), 'first,target,last,concurrent');
  equal(restored.schedules.some((item) => item.id === 'concurrent'), true);
  equal(restored.plugins === withConcurrentAdd.plugins, true);
});

await run('schedule restore clamps its index and never duplicates an existing item', () => {
  const bundle = withSchedules(wakeSchedule('one', '06:00', true));
  const restored = applySettingsBundleMutation(bundle, {
    type: 'restore-schedule',
    schedule: wakeSchedule('two', '07:00', false),
    index: 99
  });
  equal(restored.schedules.map((item) => item.id).join(','), 'one,two');

  const duplicate = applySettingsBundleMutation(restored, {
    type: 'restore-schedule',
    schedule: wakeSchedule('two', '09:00', true),
    index: 0
  });
  equal(duplicate === restored, true);
});

await run('schedule toggles and updates touch only the selected item', () => {
  const first = wakeSchedule('first', '06:00', true);
  const second = wakeSchedule('second', '07:00', false);
  const bundle = withSchedules(first, second);
  const toggled = applySettingsBundleMutation(bundle, {
    type: 'set-schedule-enabled',
    id: 'second',
    enabled: true
  });
  const updated = applySettingsBundleMutation(toggled, {
    type: 'update-schedule',
    id: 'second',
    patch: { time: '07:30', daysOfWeek: [1, 3, 5], keepAwakeFor: 90 }
  });

  equal(updated.schedules[0] === first, true);
  equal(updated.schedules[1]?.enabled, true);
  equal(updated.schedules[1]?.time, '07:30');
  equal(updated.schedules[1]?.daysOfWeek.join(','), '1,3,5');
  equal(updated.schedules[1]?.keepAwakeFor, 90);
  equal(second.enabled, false);

  const missing = applySettingsBundleMutation(updated, {
    type: 'set-schedule-enabled',
    id: 'missing',
    enabled: false
  });
  equal(missing === updated, true);
});

await run('targeted schedule rollback retains changes to other schedules', () => {
  const bundle = withSchedules(
    wakeSchedule('target', '06:00', true),
    wakeSchedule('other', '07:00', false)
  );
  const optimistic = applySettingsBundleMutation(bundle, {
    type: 'set-schedule-enabled',
    id: 'target',
    enabled: false
  });
  const concurrent = applySettingsBundleMutation(optimistic, {
    type: 'update-schedule',
    id: 'other',
    patch: { time: '08:45', enabled: true }
  });
  const rolledBack = applySettingsBundleMutation(concurrent, {
    type: 'set-schedule-enabled',
    id: 'target',
    enabled: true
  });

  equal(rolledBack.schedules.find((item) => item.id === 'target')?.enabled, true);
  equal(rolledBack.schedules.find((item) => item.id === 'other')?.time, '08:45');
  equal(rolledBack.schedules.find((item) => item.id === 'other')?.enabled, true);
});

await run('plugin load toggles and updates preserve other plugin mutations', () => {
  const bundle = withPlugins(
    plugin('target', false),
    plugin('other', false)
  );
  const optimistic = applySettingsBundleMutation(bundle, {
    type: 'set-plugin-loaded',
    id: 'target',
    loaded: true
  });
  const concurrent = applySettingsBundleMutation(optimistic, {
    type: 'update-plugin',
    id: 'other',
    patch: { loaded: true, version: '2.0.0', name: 'Other updated' }
  });
  const rolledBack = applySettingsBundleMutation(concurrent, {
    type: 'set-plugin-loaded',
    id: 'target',
    loaded: false
  });

  equal(rolledBack.plugins.find((item) => item.id === 'target')?.loaded, false);
  equal(rolledBack.plugins.find((item) => item.id === 'other')?.loaded, true);
  equal(rolledBack.plugins.find((item) => item.id === 'other')?.version, '2.0.0');
  equal(rolledBack.plugins.find((item) => item.id === 'other')?.name, 'Other updated');
  equal(rolledBack.schedules === concurrent.schedules, true);

  const missing = applySettingsBundleMutation(rolledBack, {
    type: 'set-plugin-loaded',
    id: 'missing',
    loaded: true
  });
  equal(missing === rolledBack, true);
});

await run('plugin and schedule patches cannot replace stable ids at runtime', () => {
  const bundle = withSchedules(wakeSchedule('schedule-id', '06:00', true));
  const withPlugin = withPluginsFrom(bundle, plugin('plugin-id', false));
  const updated = applySettingsBundleMutations(withPlugin, [
    {
      type: 'update-schedule',
      id: 'schedule-id',
      patch: { id: 'replaced' } as never
    },
    {
      type: 'update-plugin',
      id: 'plugin-id',
      patch: { id: 'replaced' } as never
    }
  ]);

  equal(updated.schedules[0]?.id, 'schedule-id');
  equal(updated.plugins[0]?.id, 'plugin-id');
});

await run('multiple targeted mutations reduce in order without cloning untouched resources', () => {
  const bundle = withSchedules(wakeSchedule('morning', '06:00', true));
  const next = applySettingsBundleMutations(bundle, [
    {
      type: 'set-field',
      field: { group: 'presence', key: 'sleepTimeoutMinutes' },
      value: 45
    },
    { type: 'patch-display', patch: { brightness: 65, requestedBrightness: 65 } },
    { type: 'set-schedule-enabled', id: 'morning', enabled: false }
  ]);

  equal(next.presence.sleepTimeoutMinutes, 45);
  equal(next.display.brightness, 65);
  equal(next.schedules[0]?.enabled, false);
  equal(next.rea === bundle.rea, true);
  equal(next.plugins === bundle.plugins, true);
});

function withSchedules(...schedules: WakeSchedule[]): SettingsBundle {
  return { ...demoSettingsBundle(), schedules };
}

function withPlugins(...plugins: PluginInfo[]): SettingsBundle {
  return { ...demoSettingsBundle(), plugins };
}

function withPluginsFrom(bundle: SettingsBundle, ...plugins: PluginInfo[]): SettingsBundle {
  return { ...bundle, plugins };
}

function wakeSchedule(id: string, time: string, enabled: boolean): WakeSchedule {
  return { id, time, enabled, daysOfWeek: [1, 2, 3, 4, 5], keepAwakeFor: 60 };
}

function plugin(id: string, loaded: boolean): PluginInfo {
  return {
    id,
    name: id,
    author: 'Test',
    version: '1.0.0',
    loaded,
    autoLoad: false
  };
}

function run(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`ok - ${name}`);
    })
    .catch((error) => {
      console.error(`not ok - ${name}`);
      throw error;
    });
}

function equal<T>(actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(`Expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`);
  }
}
