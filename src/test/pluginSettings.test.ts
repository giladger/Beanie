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
import { renderSettingsShell, type DecentAccountPanelState } from '../components/SettingsShell';
import { demoSettingsBundle } from '../domain/settingsModel';
import type { SettingsShellModel } from '../domain/settings';
import { settingsResourceStates } from '../domain/resourceState';

run('readPluginSettings keeps scalar values and boolean secret flags', () => {
  const parsed = readPluginSettings({
    values: { Username: 'a@b.com', AutoUpload: true, LengthThreshold: 6, junk: { nested: 1 } },
    secretsSet: { Password: true, other: 'nope' }
  });
  equal(parsed.values.Username, 'a@b.com');
  equal(parsed.values.AutoUpload, true);
  equal(parsed.values.LengthThreshold, 6);
  equal('junk' in parsed.values, false); // non-scalar dropped
  equal(parsed.secretsSet.Password, true);
  equal(parsed.secretsSet.other, false); // anything but true -> false
});

run('readPluginSettings accepts a flat settings map (reaprime shape)', () => {
  const parsed = readPluginSettings({ Username: 'x@y.com', AutoUpload: false, LengthThreshold: 8 });
  equal(parsed.values.Username, 'x@y.com');
  equal(parsed.values.AutoUpload, false);
  equal(parsed.values.LengthThreshold, 8);
  equal(Object.keys(parsed.secretsSet).length, 0);
});

run('readPluginSettings tolerates malformed and empty input', () => {
  equal(Object.keys(readPluginSettings(null).values).length, 0);
  equal(Object.keys(readPluginSettings({}).values).length, 0);
  equal(Object.keys(readPluginSettings({}).secretsSet).length, 0);
});

run('readPluginVerify reads ok + message with fallbacks', () => {
  equal(readPluginVerify({ ok: true }).ok, true);
  equal(readPluginVerify({ valid: true }).ok, true);
  equal(readPluginVerify({ ok: true }).message, 'Credentials verified');
  equal(readPluginVerify({ ok: false, message: 'Bad password' }).message, 'Bad password');
  equal(readPluginVerify('garbage').ok, false);
});

run('visualizer spec exposes credential + option fields and is verifiable', () => {
  const spec = pluginSettingsSpec('visualizer');
  if (!spec) throw new Error('expected a visualizer spec');
  const keys = spec.fields.map((field) => field.key);
  equal(keys.includes('Username'), true);
  equal(keys.includes('Password'), true);
  equal(keys.includes('AutoUpload'), true);
  equal(keys.includes('LengthThreshold'), true);
  equal(keys.includes('BackSync'), true);
  equal(keys.includes('BackSyncIntervalSeconds'), true);
  equal(keys.includes('visibility'), false);
  equal(spec.supportsVerify, true);
  const password = spec.fields.find((field) => field.key === 'Password');
  equal(password?.secret, true); // password must be write-only
  equal(spec.fields.find((field) => field.key === 'BackSync')?.type, 'toggle');
  const interval = spec.fields.find((field) => field.key === 'BackSyncIntervalSeconds');
  equal(interval?.type, 'number');
  equal(interval?.default, 300);
  equal(pluginSettingsSpec('does-not-exist'), null);
});

run('pluginFieldDefault returns type-appropriate blanks', () => {
  const spec = PLUGIN_SETTINGS_SPECS.visualizer!;
  const byKey = (key: string): PluginSettingField =>
    spec.fields.find((field) => field.key === key)!;
  equal(pluginFieldDefault(byKey('AutoUpload')), false);
  equal(pluginFieldDefault(byKey('LengthThreshold')), 0);
  equal(pluginFieldDefault(byKey('Password')), ''); // secret default stays blank
  equal(pluginFieldDefault(byKey('BackSync')), false);
  equal(pluginFieldDefault(byKey('BackSyncIntervalSeconds')), 300); // explicit default wins
});

run('demoPluginSettings provides visualizer demo values', () => {
  const demo = demoPluginSettings('visualizer');
  equal(demo.values.Username, 'demo@visualizer.coffee');
  equal(demo.secretsSet.Password, true);
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
      values: { Username: 'user@example.com', AutoUpload: true, LengthThreshold: 6 },
      secretsSet: {}
    },
    draft: {
      Username: 'user@example.com',
      Password: 'new-password',
      AutoUpload: true,
      LengthThreshold: 6
    },
    secretEdited: { Password: true },
    dirty: true,
    saving: false,
    verify: null
  };
  const html = renderSettingsShell(settingsModel(), 'plugins', bundle, config, accountPanel());

  equal(html.includes('data-action="settings-plugin-save" data-id="visualizer.reaplugin"'), true);
  equal(html.includes('data-action="settings-plugin-verify" data-id="visualizer.reaplugin"'), true);
  equal(html.includes('data-key="Password" data-type="password" value="new-password"'), true);
});

run('phone settings use native number inputs and expose scanner key setup', () => {
  const bundle = demoSettingsBundle();
  const html = renderSettingsShell(settingsModel(), 'app', bundle, null, accountPanel(), ['app'], { phone: true });

  equal(html.includes('data-action="settings-change-scanner-key"'), true);
  equal(html.includes('data-action="settings-remove-scanner-key"'), true);
  equal(html.includes('data-action="settings-display-brightness"'), true);
  equal(html.includes('data-action="open-number-edit"'), false);

  // Water level alerts now live under Machine; still native number inputs on phone.
  const machineHtml = renderSettingsShell(settingsModel(), 'machine', bundle, null, accountPanel(), ['machine'], { phone: true });
  equal(machineHtml.includes('data-action="settings-water-soft"'), true);
  equal(machineHtml.includes('data-action="settings-machine-refill"'), true);
  equal(machineHtml.includes('data-action="open-number-edit"'), false);
});

run('fallback settings name their provenance and disable only unavailable resources', () => {
  const bundle = demoSettingsBundle();
  const resources = settingsResourceStates('gateway');
  resources.presence = { source: 'default', writable: false, message: 'read failed' };
  const html = renderSettingsShell(settingsModel(), 'power', bundle, null, accountPanel(), ['power'], {
    resourceStates: resources
  });

  equal(html.includes('Some settings could not be loaded.'), true);
  equal(html.includes('data-action="settings-reload-resources"'), true);
  equal(html.includes('presence values shown below are safe defaults and are read-only'), true);
  equal(html.includes('data-group="presence" data-key="userPresenceEnabled"'), true);
  equal(html.includes('data-group="presence" data-key="userPresenceEnabled" data-type="toggle" aria-labelledby="settings-control-field-presence-userpresenceenabled-label" disabled'), true);
  equal(html.includes('data-group="rea" data-key="chargingMode" data-type="select" aria-labelledby="settings-control-field-rea-chargingmode-label" disabled'), false);
});

run('unavailable synced preferences are named and disabled while local theme remains usable', () => {
  const html = renderSettingsShell(settingsModel(), 'app', demoSettingsBundle(), null, accountPanel(), ['app'], {
    syncedPreferencesWritable: false
  });

  equal(html.includes('synced Beanie preferences values shown below are safe defaults and are read-only'), true);
  equal(html.includes('data-action="settings-reload-resources"'), true);
  equal(html.includes('data-action="settings-ui-scale" data-value="standard" aria-pressed="true" disabled'), true);
  equal(html.includes('data-action="settings-topbar-clock"'), true);
  equal(html.includes('data-action="settings-topbar-clock" checked aria-labelledby="settings-control-appearance-topbar-clock-label" aria-describedby="settings-control-appearance-topbar-clock-description" disabled'), true);
  equal(html.includes('data-action="settings-theme" data-value="system" aria-pressed="true" disabled'), false);
});

run('settings controls reference stable visible label and help ids', () => {
  const bundle = demoSettingsBundle();
  const powerHtml = renderSettingsShell(settingsModel(), 'power', bundle, null, accountPanel(), ['power']);

  const sleepLabel = 'settings-control-field-presence-sleeptimeoutminutes-label';
  const sleepDescription = 'settings-control-field-presence-sleeptimeoutminutes-description';
  const sleepValue = 'settings-control-field-presence-sleeptimeoutminutes-value';
  equal(powerHtml.includes(`id="${sleepLabel}">Sleep after`), true);
  equal(powerHtml.includes(`id="${sleepDescription}">0 = never`), true);
  equal(
    powerHtml.includes(`aria-labelledby="${sleepLabel} ${sleepValue}" aria-describedby="${sleepDescription}"`),
    true
  );
  equal(powerHtml.includes(`id="${sleepValue}"`), true);

  const timeLabel = 'settings-control-field-rea-nightmodesleeptime-label';
  equal(powerHtml.includes(`id="${timeLabel}">Night mode starts`), true);
  equal(powerHtml.includes(`aria-labelledby="${timeLabel}"`), true);

  const appHtml = renderSettingsShell(settingsModel(), 'app', bundle, null, accountPanel(), ['app']);
  const themeLabel = 'settings-control-appearance-theme-label';
  const themeDescription = 'settings-control-appearance-theme-description';
  equal(appHtml.includes(`id="${themeLabel}">Theme`), true);
  equal(
    appHtml.includes(`role="group" aria-labelledby="${themeLabel}" aria-describedby="${themeDescription}"`),
    true
  );
  const clockLabel = 'settings-control-appearance-topbar-clock-label';
  equal(appHtml.includes(`data-action="settings-topbar-clock" checked aria-labelledby="${clockLabel}"`), true);
});

run('account and plugin credentials reference their visible field copy', () => {
  const bundle = demoSettingsBundle();
  const accountHtml = renderSettingsShell(settingsModel(), 'account', bundle, null, accountPanel(), ['account']);
  equal(
    accountHtml.includes('data-key="email" value="" autocomplete="username" spellcheck="false" aria-labelledby="settings-control-account-email-label" aria-describedby="settings-control-account-email-description"'),
    true
  );

  bundle.plugins = [
    { id: 'visualizer.reaplugin', name: 'Visualizer upload', author: 'Decent', version: '1.0.0', loaded: true, autoLoad: true }
  ];
  const config: PluginConfigState = {
    id: 'visualizer.reaplugin',
    settings: { values: {}, secretsSet: { Password: true } },
    draft: { Password: '' },
    secretEdited: {},
    dirty: false,
    saving: false,
    verify: null
  };
  const pluginHtml = renderSettingsShell(settingsModel(), 'plugins', bundle, config, accountPanel(), ['plugins']);
  const passwordLabel = 'settings-control-plugin-visualizer-reaplugin-password-label';
  const passwordDescription = 'settings-control-plugin-visualizer-reaplugin-password-description';
  equal(pluginHtml.includes(`id="${passwordLabel}">Password`), true);
  equal(pluginHtml.includes(`id="${passwordDescription}">Leave blank to keep the saved password.`), true);
  equal(
    pluginHtml.includes(`aria-labelledby="${passwordLabel}" aria-describedby="${passwordDescription}"`),
    true
  );
});

run('phone plugin number fields use native inputs instead of the number dialog', () => {
  const bundle = demoSettingsBundle();
  bundle.plugins = [
    { id: 'visualizer.reaplugin', name: 'Visualizer upload', author: 'Decent', version: '1.0.0', loaded: true, autoLoad: true }
  ];
  const config: PluginConfigState = {
    id: 'visualizer.reaplugin',
    settings: {
      values: { Username: 'user@example.com', AutoUpload: true, LengthThreshold: 6, BackSyncIntervalSeconds: 300 },
      secretsSet: {}
    },
    draft: {
      Username: 'user@example.com',
      Password: '',
      AutoUpload: true,
      LengthThreshold: 6,
      BackSyncIntervalSeconds: 300
    },
    secretEdited: {},
    dirty: false,
    saving: false,
    verify: null
  };
  const html = renderSettingsShell(settingsModel(), 'plugins', bundle, config, accountPanel(), ['plugins'], { phone: true });

  equal(html.includes('class="settings-input settings-number-input"'), true);
  equal(html.includes('data-key="LengthThreshold" data-type="number"'), true);
  equal(html.includes('data-action="open-number-edit"'), false);
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
    preferences: {
      theme: 'dark',
      uiScale: 'standard',
      waterSoftLimitMl: 400,
      wakeAppZoneEnabled: false,
      wakeAppZonePosition: 'top',
      topbarClock: true,
      clockFormat: 'auto',
      screensaverMode: 'black',
      screensaverBrightness: 25
    },
    machineRefillLevelMm: null,
    screensaverPhotoCount: 0,
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

function accountPanel(): DecentAccountPanelState {
  return {
    status: { loggedIn: false, email: null },
    source: 'demo',
    emailDraft: '',
    passwordDraft: '',
    saving: false,
    message: null
  };
}
