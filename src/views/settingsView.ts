import type { MachineSnapshot, ScaleSnapshot } from '../api/types';
import {
  renderSettingsShell,
  type DecentAccountPanelState,
  type FlowCalibrationDisplay
} from '../components/SettingsShell';
import { buildSettingsShellModel, type SettingsPreferences } from '../domain/settings';
import type { SettingsBundle } from '../domain/settingsModel';
import type { PluginConfigState } from '../domain/pluginSettings';
import type { SettingsResourceStates } from '../domain/resourceState';

export interface SettingsViewModel {
  readonly query: string;
  readonly preferences: SettingsPreferences;
  readonly demo: boolean;
  readonly connected: boolean;
  readonly loading: boolean;
  readonly status: string;
  readonly gatewayHost: string;
  readonly machine: MachineSnapshot | null;
  readonly scale: ScaleSnapshot | null;
  readonly machineRefillLevelMm: number | null;
  readonly screensaverPhotoCount: number;
  readonly activeSection: string;
  readonly bundle: SettingsBundle | null;
  readonly pluginConfig: PluginConfigState | null;
  readonly account: DecentAccountPanelState;
  readonly flowCalibration: FlowCalibrationDisplay;
  readonly resourceStates: SettingsResourceStates | null;
  readonly syncedPreferencesWritable: boolean;
  readonly gatewayActionsWritable: boolean;
  readonly machineActionsWritable: boolean;
  readonly scannerKeySet: boolean;
  readonly phone?: boolean;
}

const phoneSections = [
  'app',
  'brew',
  'machine',
  'power',
  'account',
  'plugins',
  'connection',
  'danger'
];

/** Pure renderer for the shared tablet/phone settings surface. */
export function renderSettingsView(model: SettingsViewModel): string {
  return renderSettingsShell(
    buildSettingsShellModel({
      query: model.query,
      preferences: model.preferences,
      demo: model.demo,
      connected: model.connected,
      loading: model.loading,
      status: model.status,
      gatewayHost: model.gatewayHost,
      machine: model.machine,
      scale: model.scale,
      machineRefillLevelMm: model.machineRefillLevelMm,
      screensaverPhotoCount: model.screensaverPhotoCount
    }),
    model.activeSection,
    model.bundle,
    model.pluginConfig,
    model.account,
    model.phone ? phoneSections : undefined,
    {
      ...(model.phone ? { phone: true } : {}),
      flowCalibration: model.flowCalibration,
      resourceStates: model.resourceStates,
      syncedPreferencesWritable: model.syncedPreferencesWritable,
      gatewayActionsWritable: model.gatewayActionsWritable,
      machineActionsWritable: model.machineActionsWritable,
      scannerKeySet: model.scannerKeySet
    }
  );
}
