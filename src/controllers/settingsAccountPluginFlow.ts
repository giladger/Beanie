import type { DecentAccountStatus } from '../api/settings';
import {
  buildPluginSettingsSavePlan,
  createPluginConfigState,
  normalizePluginId,
  pluginSettingsSpec,
  settlePluginSettingsSave,
  type PluginConfigState,
  type SanitizedPluginSettings
} from '../domain/pluginSettings';
import type { SettingsBundle } from '../domain/settingsModel';
import type { SettingsController } from './settingsController';
import type {
  SettingsMutationFlow,
  SettingsMutationOutcome,
  SettingsMutationStart
} from './settingsMutationFlow';

export type DecentAccountSource = 'loading' | 'gateway' | 'demo' | 'unavailable' | null;
export type DecentAccountMessage = {
  readonly tone: 'good' | 'warn' | 'muted';
  readonly text: string;
};

export interface SettingsAccountPluginSnapshot {
  readonly demo: boolean;
  readonly settingsSource: 'gateway' | 'degraded' | 'demo' | 'loading' | null;
  readonly settingsBundle: SettingsBundle | null;
  readonly pluginConfig: PluginConfigState | null;
  readonly decentAccount: DecentAccountStatus | null;
  readonly decentAccountSource: DecentAccountSource;
  readonly decentAccountEmail: string;
  readonly decentAccountPassword: string;
}

export interface SettingsAccountPluginPatch {
  readonly pluginConfig?: PluginConfigState | null;
  readonly decentAccount?: DecentAccountStatus | null;
  readonly decentAccountSource?: DecentAccountSource;
  readonly decentAccountEmail?: string;
  readonly decentAccountPassword?: string;
  readonly decentAccountSaving?: boolean;
  readonly decentAccountMessage?: DecentAccountMessage | null;
  readonly status?: string;
}

export interface SettingsAccountPluginHost {
  snapshot(): SettingsAccountPluginSnapshot;
  commit(patch: SettingsAccountPluginPatch): void;
  pluginsWritable(): boolean;
  applyMutation(start: SettingsMutationStart): Promise<SettingsMutationOutcome | null>;
  accountLoginErrorMessage(error: unknown): string;
}

/**
 * Owns the Decent-account and plugin-settings sessions shown inside Settings.
 * The shell supplies state projection and capabilities; this flow owns async
 * session fencing, draft revisions, credential sanitation, and save settlement.
 */
export class SettingsAccountPluginFlow {
  private pluginSession = 0;

  constructor(
    private readonly controller: SettingsController,
    private readonly mutations: SettingsMutationFlow,
    private readonly host: SettingsAccountPluginHost
  ) {}

  invalidate(): void {
    this.pluginSession += 1;
  }

  async loadAccount(): Promise<void> {
    const state = this.host.snapshot();
    if (state.decentAccountSource === 'gateway' || state.decentAccountSource === 'demo') return;
    if (!this.local(state)) this.host.commit({ decentAccountSource: 'loading' });
    const result = await this.controller.loadDecentAccount({
      local: this.local(state),
      currentEmail: state.decentAccountEmail
    });
    this.host.commit({
      decentAccount: result.account,
      decentAccountSource: result.source,
      decentAccountEmail: result.email,
      decentAccountPassword: '',
      decentAccountSaving: false,
      decentAccountMessage: result.message
    });
  }

  async refreshAccount(): Promise<void> {
    const source = this.host.snapshot().decentAccountSource;
    this.host.commit({
      decentAccountSaving: true,
      decentAccountSource: source === 'gateway' || source === 'demo' ? null : source,
      decentAccountMessage: { tone: 'muted', text: 'Refreshing Decent account status...' }
    });
    await this.loadAccount();
  }

  updateAccountField(key: string, value: string): void {
    if (key === 'email') {
      this.host.commit({ decentAccountEmail: value, decentAccountMessage: null });
    } else if (key === 'password') {
      this.host.commit({ decentAccountPassword: value, decentAccountMessage: null });
    }
  }

  async loginAccount(): Promise<void> {
    const state = this.host.snapshot();
    const email = state.decentAccountEmail.trim();
    const password = state.decentAccountPassword;
    if (!email || !password) {
      this.host.commit({
        decentAccountMessage: { tone: 'warn', text: 'Enter both email and password.' }
      });
      return;
    }
    this.host.commit({
      decentAccountSaving: true,
      decentAccountMessage: { tone: 'muted', text: 'Linking Decent account...' }
    });
    try {
      const result = await this.controller.loginDecentAccount({
        local: this.local(state),
        email,
        password
      });
      this.host.commit({
        decentAccount: result.account,
        decentAccountSource: result.source,
        decentAccountEmail: result.email,
        decentAccountPassword: '',
        decentAccountSaving: false,
        decentAccountMessage: result.message
      });
    } catch (error) {
      console.error('[Beanie] Decent account login failed', error);
      const current = this.host.snapshot();
      this.host.commit({
        decentAccountSaving: false,
        decentAccountSource: current.decentAccountSource === 'loading'
          ? 'unavailable'
          : current.decentAccountSource,
        decentAccountMessage: {
          tone: 'warn',
          text: this.host.accountLoginErrorMessage(error)
        }
      });
    }
  }

  async logoutAccount(): Promise<void> {
    const state = this.host.snapshot();
    this.host.commit({
      decentAccountSaving: true,
      decentAccountMessage: { tone: 'muted', text: 'Unlinking Decent account...' }
    });
    try {
      const result = await this.controller.logoutDecentAccount({ local: this.local(state) });
      this.host.commit({
        decentAccount: result.account,
        decentAccountSource: result.source,
        decentAccountPassword: '',
        decentAccountSaving: false,
        decentAccountMessage: result.message
      });
    } catch (error) {
      console.error('[Beanie] Decent account unlink failed', error);
      this.host.commit({
        decentAccountSaving: false,
        decentAccountMessage: { tone: 'warn', text: 'Could not unlink Decent account.' }
      });
    }
  }

  async togglePlugin(id: string, loaded: boolean): Promise<void> {
    const state = this.host.snapshot();
    if (!state.settingsBundle) return;
    if (!this.host.pluginsWritable()) {
      this.host.commit({ status: 'Plugin status is unavailable — no change was sent' });
      return;
    }
    await this.host.applyMutation(this.mutations.togglePlugin({
      bundle: state.settingsBundle,
      id,
      loaded,
      local: this.local(state),
      writable: true
    }));
  }

  async togglePluginConfig(id: string): Promise<void> {
    const state = this.host.snapshot();
    if (state.pluginConfig && normalizePluginId(state.pluginConfig.id) === normalizePluginId(id)) {
      this.pluginSession += 1;
      this.host.commit({ pluginConfig: null });
      return;
    }
    if (!pluginSettingsSpec(id)) return;
    if (!this.host.pluginsWritable()) {
      this.host.commit({ status: 'Plugin settings are unavailable — reconnect and try again' });
      return;
    }
    const session = ++this.pluginSession;
    const result = await this.controller.loadPluginSettings({ local: this.local(state), id });
    if (session !== this.pluginSession) return;
    if (!result.settings) {
      this.host.commit({
        pluginConfig: null,
        status: 'Plugin settings could not be loaded — nothing was changed'
      });
      return;
    }
    this.host.commit({ pluginConfig: this.makePluginConfig(id, result.settings, session) });
  }

  updatePluginField(key: string, raw: string | boolean): void {
    const config = this.host.snapshot().pluginConfig;
    if (!config) return;
    if (!this.host.pluginsWritable()) {
      this.host.commit({ status: 'Plugin settings are unavailable — no change was made' });
      return;
    }
    const field = pluginSettingsSpec(config.id)?.fields.find((candidate) => candidate.key === key);
    if (!field) return;
    let value: string | number | boolean;
    if (field.type === 'toggle') value = raw === true;
    else if (field.type === 'number') {
      const parsed = Number(raw);
      value = Number.isFinite(parsed) ? parsed : field.min ?? 0;
    } else value = String(raw);
    const revision = config.revision + 1;
    this.host.commit({
      pluginConfig: {
        ...config,
        revision,
        draft: { ...config.draft, [key]: value },
        touched: { ...config.touched, [key]: true },
        fieldRevisions: { ...config.fieldRevisions, [key]: revision },
        secretEdited: field.secret
          ? { ...config.secretEdited, [key]: String(value) !== '' }
          : config.secretEdited,
        dirty: true,
        verify: null
      }
    });
  }

  async savePluginConfig(id: string): Promise<void> {
    const state = this.host.snapshot();
    const config = state.pluginConfig;
    if (!config || config.saving || normalizePluginId(config.id) !== normalizePluginId(id)) return;
    if (!this.host.pluginsWritable()) {
      this.host.commit({ status: 'Plugin settings are unavailable — nothing was saved' });
      return;
    }
    const savePlan = buildPluginSettingsSavePlan(config);
    if (!savePlan) return;
    const local = this.local(state);
    this.host.commit({ pluginConfig: { ...config, saving: true } });
    const result = await this.controller.savePluginSettings({
      local,
      id: config.id,
      payload: savePlan.payload
    });
    let acceptedSettings: SanitizedPluginSettings | null = savePlan.settings;
    if (result.ok && !local) {
      const refreshed = await this.controller.loadPluginSettings({ local: false, id: config.id });
      acceptedSettings = refreshed.settings ?? acceptedSettings;
    }
    this.host.commit({
      pluginConfig: settlePluginSettingsSave(this.host.snapshot().pluginConfig, savePlan, {
        ok: result.ok,
        settings: acceptedSettings
      }),
      status: result.status
    });
  }

  async verifyPluginConfig(id: string): Promise<void> {
    const state = this.host.snapshot();
    const config = state.pluginConfig;
    if (!config || normalizePluginId(config.id) !== normalizePluginId(id)) return;
    if (!this.host.pluginsWritable()) {
      this.host.commit({ status: 'Plugin settings are unavailable — verification was not sent' });
      return;
    }
    if (config.dirty) {
      this.host.commit({
        pluginConfig: {
          ...config,
          verify: { tone: 'warn', message: 'Save your changes before verifying.' }
        }
      });
      return;
    }
    this.host.commit({
      pluginConfig: { ...config, verify: { tone: 'muted', message: 'Verifying…' } }
    });
    const result = await this.controller.verifyPluginSettings({
      local: this.local(state),
      id: config.id,
      settings: config.settings
    });
    const current = this.host.snapshot().pluginConfig;
    if (
      !current ||
      normalizePluginId(current.id) !== normalizePluginId(config.id) ||
      current.session !== config.session ||
      current.revision !== config.revision
    ) return;
    this.host.commit({ pluginConfig: { ...current, verify: result } });
  }

  private makePluginConfig(
    id: string,
    settings: SanitizedPluginSettings,
    session = ++this.pluginSession
  ): PluginConfigState {
    return createPluginConfigState(id, settings, session);
  }

  private local(state: SettingsAccountPluginSnapshot): boolean {
    return state.demo || state.settingsSource === 'demo';
  }
}
