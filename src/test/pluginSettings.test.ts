import {
  demoPluginSettings,
  readPluginSettings,
  readPluginVerify
} from '../api/settings';
import {
  PLUGIN_SETTINGS_SPECS,
  pluginFieldDefault,
  pluginSettingsSpec,
  type PluginConfigState,
  type PluginSettingField
} from '../domain/pluginSettings';
import { renderSettingsShell } from '../components/SettingsShell';
import { demoSettingsBundle } from '../domain/settingsModel';
import type { SettingsShellModel } from '../domain/settings';

run('readPluginSettings keeps scalar values and boolean secret flags', () => {
  const parsed = readPluginSettings({
    values: { username: 'a@b.com', autoUpload: true, minUploadSeconds: 6, junk: { nested: 1 } },
    secretsSet: { password: true, other: 'nope' }
  });
  equal(parsed.values.username, 'a@b.com');
  equal(parsed.values.autoUpload, true);
  equal(parsed.values.minUploadSeconds, 6);
  equal('junk' in parsed.values, false); // non-scalar dropped
  equal(parsed.secretsSet.password, true);
  equal(parsed.secretsSet.other, false); // anything but true -> false
});

run('readPluginSettings accepts a flat settings map (reaprime shape)', () => {
  const parsed = readPluginSettings({ username: 'x@y.com', autoUpload: false, minUploadSeconds: 8 });
  equal(parsed.values.username, 'x@y.com');
  equal(parsed.values.autoUpload, false);
  equal(parsed.values.minUploadSeconds, 8);
  equal(Object.keys(parsed.secretsSet).length, 0);
});

run('readPluginSettings tolerates malformed and empty input', () => {
  equal(Object.keys(readPluginSettings(null).values).length, 0);
  equal(Object.keys(readPluginSettings({}).values).length, 0);
  equal(Object.keys(readPluginSettings({}).secretsSet).length, 0);
});

run('readPluginVerify reads ok + message with fallbacks', () => {
  equal(readPluginVerify({ ok: true }).ok, true);
  equal(readPluginVerify({ ok: true }).message, 'Credentials verified');
  equal(readPluginVerify({ ok: false, message: 'Bad password' }).message, 'Bad password');
  equal(readPluginVerify('garbage').ok, false);
});

run('visualizer spec exposes credential + option fields and is verifiable', () => {
  const spec = pluginSettingsSpec('visualizer');
  if (!spec) throw new Error('expected a visualizer spec');
  const keys = spec.fields.map((field) => field.key);
  equal(keys.includes('username'), true);
  equal(keys.includes('password'), true);
  equal(keys.includes('autoUpload'), true);
  equal(spec.supportsVerify, true);
  const password = spec.fields.find((field) => field.key === 'password');
  equal(password?.secret, true); // password must be write-only
  equal(pluginSettingsSpec('does-not-exist'), null);
});

run('pluginFieldDefault returns type-appropriate blanks', () => {
  const spec = PLUGIN_SETTINGS_SPECS.visualizer!;
  const byKey = (key: string): PluginSettingField =>
    spec.fields.find((field) => field.key === key)!;
  equal(pluginFieldDefault(byKey('autoUpload')), false);
  equal(pluginFieldDefault(byKey('visibility')), 'unlisted');
  equal(pluginFieldDefault(byKey('minUploadSeconds')), 0);
  equal(pluginFieldDefault(byKey('password')), ''); // secret default stays blank
});

run('demoPluginSettings provides visualizer demo values', () => {
  const demo = demoPluginSettings('visualizer');
  equal(demo.values.username, 'demo@visualizer.coffee');
  equal(demo.secretsSet.password, true);
  equal(Object.keys(demoPluginSettings('unknown').values).length, 0);
});

run('visualizer password draft survives render and saves with real plugin id', () => {
  const bundle = demoSettingsBundle();
  bundle.plugins = [
    { id: 'visualizer.reaplugin', name: 'Visualizer upload', author: 'Decent', version: '1.0.0', loaded: true, autoLoad: true }
  ];
  const config: PluginConfigState = {
    id: 'visualizer.reaplugin',
    settings: {
      values: { username: 'user@example.com', autoUpload: true, visibility: 'unlisted', minUploadSeconds: 6 },
      secretsSet: {}
    },
    draft: {
      username: 'user@example.com',
      password: 'new-password',
      autoUpload: true,
      visibility: 'unlisted',
      minUploadSeconds: 6
    },
    secretEdited: { password: true },
    dirty: true,
    saving: false,
    verify: null
  };
  const html = renderSettingsShell(settingsModel(), 'plugins', bundle, config);

  equal(html.includes('data-action="settings-plugin-save" data-id="visualizer.reaplugin"'), true);
  equal(html.includes('data-action="settings-plugin-verify" data-id="visualizer.reaplugin"'), true);
  equal(html.includes('data-key="password" data-type="password" value="new-password"'), true);
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

function settingsModel(): SettingsShellModel {
  return {
    query: '',
    preferences: { theme: 'dark', uiScale: 'standard' },
    gateway: {
      label: 'Connected',
      detail: 'Test gateway',
      host: 'localhost',
      tone: 'good',
      machine: 'Idle',
      scale: '0 g'
    },
    version: {
      version: 'test',
      gitCommit: 'test',
      buildTime: 'test',
      defaultSkinStatus: 'test'
    },
    cacheKeyCount: 0
  };
}
