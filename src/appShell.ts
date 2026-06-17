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

export const SCALE_BATTERY_LOW_PERCENT = 20;

/**
 * Scale battery as a 0-100 percentage. Scales report either a fraction (0-1)
 * or a percentage depending on firmware; values at or below 1 are read as a
 * fraction.
 */
export function scaleBatteryPercent(scale: ScaleSnapshot | null): number | null {
  const raw = scale?.batteryLevel;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return null;
  const percent = raw <= 1 ? raw * 100 : raw;
  return Math.min(100, Math.round(percent));
}

/** Topbar scale readout: weight, plus the battery while it is running low. */
export function scaleStatLabel(scale: ScaleSnapshot | null): string {
  if (scale?.status === 'disconnected') return 'offline';
  const weight = `${formatNumber(scale?.weight, 1)} g`;
  const battery = scaleBatteryPercent(scale);
  if (battery != null && battery <= SCALE_BATTERY_LOW_PERCENT) return `${weight} · ${battery}%`;
  return weight;
}

export function scaleBatteryLow(scale: ScaleSnapshot | null): boolean {
  if (!scaleConnected(scale)) return false;
  const battery = scaleBatteryPercent(scale);
  return battery != null && battery <= SCALE_BATTERY_LOW_PERCENT;
}

export function scaleStatTitle(scale: ScaleSnapshot | null): string {
  const base = scaleConnected(scale) ? 'Tare scale' : 'Search for preferred scale';
  const battery = scaleBatteryPercent(scale);
  return battery == null ? base : `${base} · battery ${battery}%`;
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

export function liveChartModelOptions(
  mode: LiveChartMode,
  ghostMaxTime?: number | null
): { minTime?: number } {
  // A ghost overlay frames the live pull against the reference shot, so anchor
  // the time axis to the ghost's length rather than the mode default. The axis
  // still grows past it if the live pull runs longer (buildLiveChartModel maxes
  // elapsed time against minTime).
  if (ghostMaxTime != null && ghostMaxTime > 0) return { minTime: ghostMaxTime };
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

// reaprime hosts Beanie inside a flutter_inappwebview pointed at localhost:3000
// and overrides the webview user agent to the bare string "Decent". The very
// same origin is reachable from an ordinary browser on the tablet's :3000 port,
// where we want the on-screen power buttons rather than the full-screen
// tap-to-wake overlay — so we must tell "inside reaprime" apart from "a browser
// hitting :3000".
//
// Detecting this turned out to be fragile, so we layer three signals weakest-last:
//
// 1. window.__DECENT_HOST__ — a beacon reaprime injects via a document-start user
//    script in the page content world (see skin_view.dart). This is the
//    deterministic signal: visible to our code regardless of UA or webview
//    internals, and absent in a plain browser because it isn't part of the
//    served HTML. Requires a reaprime build new enough to inject it.
// 2. window.flutter_inappwebview — the plugin's JS bridge. Works on some setups
//    but isn't dependable: flutter_inappwebview v6 gates the bridge behind a
//    bridge secret/origin allow-list and doesn't reliably expose it as a plain
//    page global, so this is false even inside reaprime on some Android builds.
// 3. UA token "Decent" — reaprime's userAgent override. Unreliable too: some
//    Android System WebView builds drop setUserAgentString on first load. Matched
//    leniently (case/whitespace/version-suffix) as a last resort.
//
// Older reaprime builds that predate __DECENT_HOST__ still fall through to 2/3.
export function detectDecentAppWebView(
  decentHost: unknown,
  hasInAppWebViewBridge: boolean,
  userAgent: string | null | undefined
): boolean {
  if (decentHost != null && typeof decentHost === 'object') return true;
  if (hasInAppWebViewBridge) return true;
  return /\bdecent\b/i.test(userAgent ?? '');
}

export function isDecentAppWebView(): boolean {
  const win =
    typeof window !== 'undefined'
      ? (window as { __DECENT_HOST__?: unknown; flutter_inappwebview?: unknown })
      : undefined;
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : null;
  return detectDecentAppWebView(
    win?.__DECENT_HOST__,
    win?.flutter_inappwebview != null,
    userAgent
  );
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
