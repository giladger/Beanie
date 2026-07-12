import type { De1MachineSettings, MachineState } from '../api/types';
import type {
  De1AdvancedSettings,
  De1AdvancedSettingsPatch,
  De1Calibration,
  DecentAccountStatus,
  RawPluginSettings,
  PluginVerifyResult,
  PresenceSettingsPatch,
  ReaSettingsPatch,
  WakeSchedule
} from '../api/settings';
import { demoDecentAccountStatus, demoPluginSettings } from '../api/settings';
import { demoSettingsBundle } from '../domain/settingsModel';
import type { SettingsBundle, SettingsGroup } from '../domain/settingsModel';
import {
  sanitizePluginSettings,
  type SanitizedPluginSettings
} from '../domain/pluginSettings';
import {
  settingsResourceStates,
  unavailableSettingsResources,
  type SettingsResourceKey,
  type SettingsResourceStates
} from '../domain/resourceState';

export interface SettingsControllerGateway {
  settings(): Promise<SettingsBundle['rea']>;
  scanDevices(): Promise<SettingsBundle['devices']>;
  presenceSettings(): Promise<SettingsBundle['presence']>;
  displayState(): Promise<SettingsBundle['display']>;
  skins(): Promise<SettingsBundle['skins']>;
  plugins(): Promise<SettingsBundle['plugins']>;
  connectPreferredDevices(): Promise<SettingsBundle['devices']>;
  connectDevice(id: string): Promise<void>;
  disconnectDevice(id: string): Promise<void>;
  devices(): Promise<SettingsBundle['devices']>;
  requestState(state: MachineState): Promise<void>;
  addWakeSchedule(schedule: { time: string; daysOfWeek: number[]; enabled: boolean }): Promise<void>;
  updateWakeSchedule(id: string, body: Partial<WakeSchedule>): Promise<void>;
  deleteWakeSchedule(id: string): Promise<void>;
  wakeSchedules(): Promise<WakeSchedule[]>;
  decentAccount(): Promise<DecentAccountStatus>;
  loginDecentAccount(email: string, password: string): Promise<DecentAccountStatus>;
  logoutDecentAccount(): Promise<void>;
  pluginSettings(id: string): Promise<RawPluginSettings>;
  /** Persist a changes-only patch; the adapter must fresh-read/rebase before replacement APIs. */
  savePluginSettingsChanges(id: string, values: Record<string, string | number | boolean>): Promise<void>;
  /** Verify freshly-read saved credentials inside the plugin mutation lane. */
  verifyStoredPluginSettings(id: string): Promise<PluginVerifyResult>;
  updateSettings(patch: ReaSettingsPatch): Promise<void>;
  updateMachineSettings(patch: Partial<De1MachineSettings>): Promise<void>;
  updateMachineAdvancedSettings(patch: De1AdvancedSettingsPatch): Promise<void>;
  updateCalibration(value: number): Promise<void>;
  updatePresenceSettings(patch: PresenceSettingsPatch): Promise<void>;
  resetMachineSettings(): Promise<void>;
  machineSettings(): Promise<De1MachineSettings>;
  machineAdvancedSettings(): Promise<De1AdvancedSettings>;
  calibration(): Promise<De1Calibration>;
}

export interface SettingsController {
  loadSettingsBundle(demo: boolean): Promise<{
    bundle: SettingsBundle;
    source: 'gateway' | 'degraded' | 'demo';
    resources: SettingsResourceStates;
    status: string | null;
  }>;
  scanDevices(local: boolean): Promise<{ devices: SettingsBundle['devices'] | null; status: string }>;
  connectPreferredDevices(input: {
    local: boolean;
    preferredScaleId: string | null;
  }): Promise<{ devices: SettingsBundle['devices'] | null; status: string }>;
  connectDevice(input: {
    id: string;
    connect: boolean;
    local: boolean;
    fallbackDevices: SettingsBundle['devices'];
  }): Promise<{ devices: SettingsBundle['devices'] | null; status: string | null }>;
  requestMachineState(input: { state: MachineState; local: boolean }): Promise<{ status: string; sleepRequested: boolean }>;
  addWakeSchedule(input: {
    time: string;
    local: boolean;
    current: WakeSchedule[];
  }): Promise<{ schedules: WakeSchedule[] | null; status: string | null }>;
  deleteWakeSchedule(input: { id: string; local: boolean }): Promise<{ ok: boolean; status: string | null }>;
  toggleWakeSchedule(input: { id: string; enabled: boolean; local: boolean }): Promise<void>;
  loadDecentAccount(input: {
    local: boolean;
    currentEmail: string;
  }): Promise<{ account: DecentAccountStatus | null; source: 'demo' | 'gateway' | 'unavailable'; email: string; message: null }>;
  loginDecentAccount(input: {
    local: boolean;
    email: string;
    password: string;
  }): Promise<{ account: DecentAccountStatus; source: 'demo' | 'gateway'; email: string; message: AccountMessage }>;
  logoutDecentAccount(input: {
    local: boolean;
  }): Promise<{ account: DecentAccountStatus; source: 'demo' | 'gateway'; message: AccountMessage }>;
  loadPluginSettings(input: { local: boolean; id: string }): Promise<{
    settings: SanitizedPluginSettings | null;
    source: 'gateway' | 'demo' | 'unavailable';
  }>;
  savePluginSettings(input: {
    local: boolean;
    id: string;
    payload: Record<string, string | number | boolean>;
  }): Promise<{ status: string; ok: boolean }>;
  verifyPluginSettings(input: {
    local: boolean;
    id: string;
    settings: SanitizedPluginSettings;
  }): Promise<{ tone: 'good' | 'warn'; message: string }>;
  persistSetting(group: SettingsGroup, key: string, value: string | number | boolean | null): Promise<void>;
  resetMachineSettings(input: {
    local: boolean;
    bundle: SettingsBundle;
  }): Promise<{ bundlePatch: Pick<SettingsBundle, 'de1' | 'advanced' | 'calibration'>; status: string }>;
}

export type AccountMessage = { tone: 'good' | 'warn'; text: string };

export function createSettingsController(gateway: SettingsControllerGateway): SettingsController {
  return {
    async loadSettingsBundle(demo) {
      const fallback = demoSettingsBundle();
      if (demo) {
        return { bundle: fallback, source: 'demo', resources: settingsResourceStates('demo'), status: null };
      }
      const resources = settingsResourceStates('gateway');
      const fallbackFor = <K extends SettingsResourceKey>(key: K, value: SettingsBundle[K]): SettingsBundle[K] => {
        resources[key] = {
          source: 'default',
          writable: false,
          message: 'Gateway read failed; showing a safe default'
        };
        return value;
      };
      const [rea, de1, advanced, calibration, presence, display, skins, devices, plugins, schedules] = await Promise.all([
        gateway.settings().catch(() => fallbackFor('rea', fallback.rea)),
        gateway.machineSettings().catch(() => fallbackFor('de1', fallback.de1)),
        gateway.machineAdvancedSettings().catch(() => fallbackFor('advanced', fallback.advanced)),
        gateway.calibration().catch(() => fallbackFor('calibration', fallback.calibration)),
        gateway.presenceSettings().catch(() => fallbackFor('presence', fallback.presence)),
        gateway.displayState().catch(() => fallbackFor('display', fallback.display)),
        gateway.skins().catch(() => fallbackFor('skins', fallback.skins)),
        gateway.devices().catch(() => fallbackFor('devices', fallback.devices)),
        gateway.plugins().catch(() => fallbackFor('plugins', fallback.plugins)),
        gateway.wakeSchedules().catch(() => fallbackFor('schedules', fallback.schedules))
      ]);
      const unavailable = unavailableSettingsResources(resources);
      return {
        bundle: { rea, de1, advanced, calibration, presence, display, skins, devices, plugins, schedules },
        source: unavailable.length === 0 ? 'gateway' : 'degraded',
        resources,
        status: unavailable.length === 0
          ? null
          : `${unavailable.length} settings ${unavailable.length === 1 ? 'section is' : 'sections are'} unavailable — defaults are read-only`
      };
    },

    async scanDevices(local) {
      if (local) return { devices: null, status: 'Scanning unavailable in demo mode' };
      try {
        const devices = await gateway.scanDevices();
        return { devices, status: `Found ${devices.length} device${devices.length === 1 ? '' : 's'}` };
      } catch {
        return { devices: null, status: 'Scan failed' };
      }
    },

    async connectPreferredDevices({ local, preferredScaleId }) {
      if (local) return { devices: null, status: 'Auto-connect unavailable in demo mode' };
      try {
        const devices = await gateway.connectPreferredDevices();
        const preferredScale = preferredScaleId
          ? devices.find((device) => device.id === preferredScaleId && device.type === 'scale')
          : null;
        const preferredScaleConnected = preferredScale?.state === 'connected';
        return {
          devices,
          status: preferredScaleId
            ? preferredScaleConnected
              ? 'Preferred scale connected'
              : 'Preferred scale not found'
            : 'Auto-connect complete'
        };
      } catch {
        return { devices: null, status: 'Auto-connect failed' };
      }
    },

    async connectDevice({ id, connect, local, fallbackDevices }) {
      if (!id || local) return { devices: null, status: null };
      try {
        await (connect ? gateway.connectDevice(id) : gateway.disconnectDevice(id));
        const devices = await gateway.devices().catch(() => fallbackDevices);
        return { devices, status: connect ? 'Connected' : 'Disconnected' };
      } catch {
        return { devices: null, status: connect ? 'Connect failed' : 'Disconnect failed' };
      }
    },

    async requestMachineState({ state, local }) {
      if (local) return { status: `${state} unavailable in demo mode`, sleepRequested: false };
      try {
        await gateway.requestState(state);
        return { status: `Machine → ${state}`, sleepRequested: state === 'sleeping' };
      } catch {
        return { status: 'Machine command failed', sleepRequested: false };
      }
    },

    async addWakeSchedule({ time, local, current }) {
      if (!time) return { schedules: null, status: null };
      if (local) {
        return {
          schedules: [...current, { id: `local-${time}`, time, daysOfWeek: [], enabled: true, keepAwakeFor: null }],
          status: null
        };
      }
      try {
        await gateway.addWakeSchedule({ time, daysOfWeek: [], enabled: true });
      } catch {
        return { schedules: null, status: 'Could not add schedule' };
      }
      try {
        return { schedules: await gateway.wakeSchedules(), status: 'Wake schedule added' };
      } catch {
        return { schedules: null, status: 'Wake schedule added — refresh unavailable' };
      }
    },

    async deleteWakeSchedule({ id, local }) {
      if (local) return { ok: true, status: null };
      try {
        await gateway.deleteWakeSchedule(id);
        return { ok: true, status: null };
      } catch {
        return { ok: false, status: 'Could not delete schedule' };
      }
    },

    async toggleWakeSchedule({ id, enabled, local }) {
      if (local) return;
      await gateway.updateWakeSchedule(id, { enabled });
    },

    async loadDecentAccount({ local, currentEmail }) {
      if (local) {
        const account = demoDecentAccountStatus();
        return {
          account,
          source: 'demo',
          email: account.email ?? currentEmail,
          message: null
        };
      }
      try {
        const account = await gateway.decentAccount();
        return {
          account,
          source: 'gateway',
          email: account.email ?? currentEmail,
          message: null
        };
      } catch {
        return { account: null, source: 'unavailable', email: currentEmail, message: null };
      }
    },

    async loginDecentAccount({ local, email, password }) {
      if (local) {
        return {
          account: { loggedIn: true, email },
          source: 'demo',
          email,
          message: { tone: 'good', text: 'Decent account linked (demo).' }
        };
      }
      const account = await gateway.loginDecentAccount(email, password);
      return {
        account,
        source: 'gateway',
        email: account.email ?? email,
        message: account.loggedIn
          ? { tone: 'good', text: 'Decent account linked.' }
          : { tone: 'warn', text: 'Login failed. Check your email and password.' }
      };
    },

    async logoutDecentAccount({ local }) {
      if (local) {
        return {
          account: { loggedIn: false, email: null },
          source: 'demo',
          message: { tone: 'good', text: 'Decent account unlinked (demo).' }
        };
      }
      await gateway.logoutDecentAccount();
      return {
        account: { loggedIn: false, email: null },
        source: 'gateway',
        message: { tone: 'good', text: 'Decent account unlinked.' }
      };
    },

    async loadPluginSettings({ local, id }) {
      if (local) {
        return {
          settings: sanitizePluginSettings(id, demoPluginSettings(id)),
          source: 'demo'
        };
      }
      try {
        return {
          settings: sanitizePluginSettings(id, await gateway.pluginSettings(id)),
          source: 'gateway'
        };
      } catch {
        return { settings: null, source: 'unavailable' };
      }
    },

    async savePluginSettings({ local, id, payload }) {
      if (local) return { status: 'Plugin settings saved (demo)', ok: true };
      try {
        await gateway.savePluginSettingsChanges(id, payload);
        return { status: 'Plugin settings saved', ok: true };
      } catch {
        return { status: 'Plugin settings save failed', ok: false };
      }
    },

    async verifyPluginSettings({ local, id, settings }) {
      if (local) {
        const hasUser = String(settings.values.Username ?? '') !== '';
        const ok = hasUser && settings.secretsSet.Password === true;
        return {
          tone: ok ? 'good' : 'warn',
          message: ok ? 'Credentials look valid (demo).' : 'Add an email and password first.'
        };
      }
      try {
        const result = await gateway.verifyStoredPluginSettings(id);
        return { tone: result.ok ? 'good' : 'warn', message: result.message };
      } catch {
        return { tone: 'warn', message: 'Verification failed.' };
      }
    },

    persistSetting(group, key, value) {
      const patch = { [key]: value };
      switch (group) {
        case 'rea':
          return gateway.updateSettings(patch as unknown as ReaSettingsPatch);
        case 'de1':
          return gateway.updateMachineSettings(patch as unknown as Partial<De1MachineSettings>);
        case 'advanced':
          return gateway.updateMachineAdvancedSettings(patch as unknown as De1AdvancedSettingsPatch);
        case 'calibration':
          return gateway.updateCalibration(Number(value));
        case 'presence':
          return gateway.updatePresenceSettings(patch as unknown as PresenceSettingsPatch);
      }
      const unsupported: never = group;
      return Promise.reject(new Error(`Unsupported settings group: ${String(unsupported)}`));
    },

    async resetMachineSettings({ local, bundle }) {
      if (local) {
        const fallback = demoSettingsBundle();
        return {
          bundlePatch: { de1: fallback.de1, advanced: fallback.advanced, calibration: fallback.calibration },
          status: 'Machine settings reset (demo)'
        };
      }
      await gateway.resetMachineSettings();
      try {
        const [de1, advanced, calibration] = await Promise.all([
          gateway.machineSettings(),
          gateway.machineAdvancedSettings(),
          gateway.calibration()
        ]);
        return { bundlePatch: { de1, advanced, calibration }, status: 'Machine settings reset' };
      } catch {
        return {
          bundlePatch: {
            de1: bundle.de1,
            advanced: bundle.advanced,
            calibration: bundle.calibration
          },
          status: 'Machine settings reset — refresh unavailable'
        };
      }
    }
  };
}
