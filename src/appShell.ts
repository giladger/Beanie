import type {
  GatewayStartupSnapshot,
  MachineInfo,
  MachineSnapshot,
  MachineState,
  RecipeDraft,
  ScaleSnapshot,
  Workflow
} from './api/types';
import { GatewayRequestError } from './api/gateway';
import { THEME_PREFERENCES, type ThemePreference, type UIScalePreference } from './domain/settings';
import { waterTankMlFromMm } from './domain/waterTank';

export type LiveChartMode = 'preset30' | 'auto';

export function startupStatusLabel(status: GatewayStartupSnapshot['status']): string {
  if (status === 'partial-failure') return 'Connected with limited data';
  if (status === 'gateway-unavailable') return 'Offline with cached data';
  return 'Connected';
}

export function temp(value: number | null | undefined): string {
  return value == null ? '--' : `${Math.round(value)}°C`;
}

export function water(value: number | null | undefined): string {
  // reaprime reports tank level as a height in mm; convert to ml via de1app's
  // calibration table and round to tens, the way de1app shows it (~X mL).
  if (value == null) return '--';
  const ml = Math.round(waterTankMlFromMm(value) / 10) * 10;
  return `${ml} ml`;
}

export function scaleConnected(scale: ScaleSnapshot | null): boolean {
  return scale != null && scale.status !== 'disconnected';
}

export function isNoScaleShotBlockError(error: unknown): boolean {
  if (!(error instanceof GatewayRequestError)) return false;
  const message = error.issue.message.toLowerCase();
  return error.issue.statusCode === 400 && (message.includes('block_no_scale') || message.includes('no scale'));
}

export function isBrewState(state: string | undefined): boolean {
  return state === 'espresso' || state === 'brewing';
}

// A friendly readiness label instead of the raw machine state. Heating shows
// while warming up (including idle-but-below-target); otherwise "Ready".
export function machineStatus(machine: MachineSnapshot | null, loading: boolean): string {
  if (!machine) return loading ? 'Connecting…' : 'Offline';
  switch (machine.state?.state) {
    case 'heating':
    case 'preheating':
      return 'Heating';
    case 'sleeping':
      return 'Asleep';
    case 'schedIdle':
      return 'Scheduled';
    case 'espresso':
      return 'Brewing';
    case 'steam':
      return 'Steaming';
    case 'steamRinse':
      return 'Steam rinse';
    case 'hotWater':
      return 'Hot water';
    case 'flush':
      return 'Flushing';
    case 'needsWater':
      return 'Add water';
    case 'cleaning':
      return 'Cleaning';
    case 'descaling':
      return 'Descaling';
    case 'booting':
      return 'Booting';
    case 'error':
      return 'Error';
    default: {
      const t = machine.groupTemperature;
      const target = machine.targetGroupTemperature;
      if (t != null && target != null && target > 0 && t < target - 2) return 'Heating';
      return 'Ready';
    }
  }
}

export function formatNumber(value: number | null | undefined, digits: number): string {
  return value == null || Number.isNaN(value) ? '--' : value.toFixed(digits);
}

export function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function isMachineCommand(value: string | undefined): value is MachineState {
  return value === 'espresso' || value === 'steam' || value === 'flush' || value === 'hotWater';
}

export function positiveNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

export function nonNegativeNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export function machineCommandsAvailable(demo: boolean, info: MachineInfo | null): boolean {
  if (demo) return true;
  if (!info) return false;
  return isSimulatorMachine(info) || hasGroupHeadController(info) === false;
}

export function liveChartModelOptions(mode: LiveChartMode): { minTime?: number } {
  return mode === 'preset30' ? { minTime: 30 } : {};
}

export function liveChartHideMaxTimeLabel(mode: LiveChartMode, maxTime: number): boolean {
  return mode === 'auto' || maxTime > 30;
}

export function draftSignature(draft: RecipeDraft): string {
  return signatureOf(
    draft.profileTitle ?? null,
    draft.dose ?? null,
    draft.yield ?? null,
    draft.grinderModel ?? null,
    draft.grinderSetting ?? null
  );
}

export function workflowSignature(workflow: Workflow | null): string {
  const ctx = workflow?.context;
  return signatureOf(
    workflow?.profile?.title ?? null,
    typeof ctx?.targetDoseWeight === 'number' ? ctx.targetDoseWeight : null,
    typeof ctx?.targetYield === 'number' ? ctx.targetYield : null,
    ctx?.grinderModel ?? null,
    ctx?.grinderSetting != null ? String(ctx.grinderSetting) : null
  );
}

export function isThemePreference(value: string | undefined): value is ThemePreference {
  return value != null && (THEME_PREFERENCES as string[]).includes(value);
}

export function isUIScalePreference(value: string | undefined): value is UIScalePreference {
  return value === 'compact' || value === 'standard' || value === 'large';
}

export function isDecentAppWebView(): boolean {
  return navigator.userAgent.trim() === 'Decent';
}

export function defaultExitValueForApp(type: 'pressure' | 'flow', condition: 'over' | 'under'): number {
  if (type === 'pressure') return condition === 'over' ? 11 : 0;
  return condition === 'over' ? 6 : 0;
}

function hasGroupHeadController(info: MachineInfo): boolean | null {
  if (typeof info.GHC === 'boolean') return info.GHC;
  if (typeof info.groupHeadControllerPresent === 'boolean') return info.groupHeadControllerPresent;
  return null;
}

function isSimulatorMachine(info: MachineInfo): boolean {
  const text = [info.model, info.serialNumber, info.version]
    .filter((part): part is string => typeof part === 'string')
    .join(' ')
    .toLowerCase();
  if (text.includes('mock') || text.includes('simulator') || text.includes('simulated')) return true;
  return info.extra?.simulated === true || info.extra?.simulation === true;
}

function signatureOf(
  profileTitle: string | null,
  dose: number | null,
  yieldValue: number | null,
  grinderModel: string | null,
  grind: string | null
): string {
  return JSON.stringify([profileTitle, dose, yieldValue, grinderModel, grind]);
}
