import type { MachineInfo, MachineSnapshot, RecipeDraft, Workflow } from '../api/types';
import {
  clockLabel,
  detectDecentAppWebView,
  draftSignature,
  formatNumber,
  isMachineCommand,
  liveChartHideMaxTimeLabel,
  liveChartModelOptions,
  machineCommandsAvailable,
  machineStatus,
  scaleBatteryLow,
  scaleBatteryPercent,
  scaleConnected,
  scaleStatLabel,
  scaleStatTitle,
  sleepOverlayModel,
  temp,
  water,
  workflowSignature
} from '../appShell';

run('app shell status helpers format machine water scale and numbers', () => {
  equal(machineStatus(null, true), 'Connecting…');
  equal(machineStatus(machine({ state: { state: 'sleeping' } }), false), 'Asleep');
  equal(machineStatus(machine({ groupTemperature: 88, targetGroupTemperature: 93 }), false), 'Heating');
  equal(machineStatus(machine({ groupTemperature: 93, targetGroupTemperature: 93 }), false), 'Ready');
  equal(temp(92.4), '92°C');
  equal(water(0), '0 ml');
  equal(formatNumber(12.345, 1), '12.3');
  equal(formatNumber(null, 1), '--');
  equal(scaleConnected({ status: 'connected', weight: 1, weightFlow: 0, timestamp: 'now' }), true);
  equal(scaleConnected({ status: 'disconnected', weight: 1, weightFlow: 0, timestamp: 'now' }), false);
});

run('clock label formats hours and minutes for the current locale', () => {
  const label = clockLabel(new Date(2026, 6, 3, 14, 5));
  // Locale decides 24h vs AM/PM; either way both fields are present.
  if (!/\b(14|02|2)\D?05\b/.test(label.normalize('NFKC'))) {
    throw new Error(`Unexpected clock label: ${label}`);
  }
});

run('scale battery normalizes fractions and surfaces only when low', () => {
  const scale = (batteryLevel?: number, status: 'connected' | 'disconnected' = 'connected') => ({
    status,
    weight: 18.2,
    weightFlow: 0,
    timestamp: 'now',
    batteryLevel
  });

  equal(scaleBatteryPercent(scale(0.12)), 12);
  equal(scaleBatteryPercent(scale(85)), 85);
  equal(scaleBatteryPercent(scale(140)), 100);
  equal(scaleBatteryPercent(scale(undefined)), null);
  equal(scaleBatteryPercent(null), null);

  equal(scaleStatLabel(scale(0.12)), '18.2 g · 12%');
  equal(scaleStatLabel(scale(85)), '18.2 g');
  equal(scaleStatLabel(scale(0.12, 'disconnected')), 'offline');
  equal(scaleStatLabel(null), '-- g');

  equal(scaleBatteryLow(scale(0.12)), true);
  equal(scaleBatteryLow(scale(85)), false);
  equal(scaleBatteryLow(scale(0.12, 'disconnected')), false);

  equal(scaleStatTitle(scale(85)), 'Tare scale · battery 85%');
  equal(scaleStatTitle(scale(undefined)), 'Tare scale');
  equal(scaleStatTitle(null), 'Search for preferred scale');
});

run('detect Decent webview prefers the reaprime beacon, then bridge, then UA', () => {
  const browserUA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/120 Safari/537.36';
  const androidWvUA = 'Mozilla/5.0 (Linux; Android 10; wv) AppleWebKit/537.36';

  // 1. Deterministic signal: reaprime's injected window.__DECENT_HOST__ beacon wins
  //    even when the UA looks like a plain browser and the bridge is absent.
  equal(detectDecentAppWebView({ app: 'reaprime', platform: 'android' }, false, browserUA), true);
  equal(detectDecentAppWebView({}, false, androidWvUA), true);
  // A non-object beacon value is ignored (must be the injected object).
  equal(detectDecentAppWebView('reaprime', false, browserUA), false);

  // 2. Bridge fallback for older reaprime builds without the beacon.
  equal(detectDecentAppWebView(undefined, true, androidWvUA), true);

  // 3. UA fallback: the "Decent" override, matched leniently.
  equal(detectDecentAppWebView(undefined, false, 'Decent'), true);
  equal(detectDecentAppWebView(undefined, false, '  Decent  '), true);
  equal(detectDecentAppWebView(undefined, false, 'decent'), true);
  equal(detectDecentAppWebView(undefined, false, 'Decent/2.1'), true);
  equal(detectDecentAppWebView(undefined, false, 'Mozilla/5.0 (Linux; Android 10; wv) AppleWebKit Decent'), true);

  // None of the three signals present → a plain browser on :3000, use web controls.
  equal(detectDecentAppWebView(null, false, browserUA), false);
  equal(detectDecentAppWebView(undefined, false, ''), false);
  equal(detectDecentAppWebView(undefined, false, null), false);
  // Word-boundary match must not fire on "decent" embedded in another token.
  equal(detectDecentAppWebView(undefined, false, 'Mozilla/5.0 IndecentBrowser/1.0'), false);
});

run('sleep overlay shows only in the webview and layers the wake-app zone when enabled', () => {
  const base = {
    asleep: true,
    appAwake: false,
    usesWebSleepControls: false,
    wakeAppZoneEnabled: false,
    wakeAppZonePosition: 'top' as const
  };

  // Awake machine → nothing.
  equal(sleepOverlayModel({ ...base, asleep: false }).showOverlay, false);
  // In a browser the app already shows while the machine sleeps → no overlay.
  equal(sleepOverlayModel({ ...base, usesWebSleepControls: true }).showOverlay, false);
  // Asleep inside the webview → the wake-machine overlay.
  equal(sleepOverlayModel(base).showOverlay, true);
  // Zone is off by default even when the overlay shows.
  equal(sleepOverlayModel(base).showWakeAppZone, false);

  // Enabling the zone layers it on top of the overlay, carrying the position.
  const withZone = sleepOverlayModel({ ...base, wakeAppZoneEnabled: true, wakeAppZonePosition: 'right' });
  equal(withZone.showOverlay, true);
  equal(withZone.showWakeAppZone, true);
  equal(withZone.zonePosition, 'right');

  // Once the app is woken, both the overlay and its zone disappear.
  const woken = sleepOverlayModel({ ...base, appAwake: true, wakeAppZoneEnabled: true });
  equal(woken.showOverlay, false);
  equal(woken.showWakeAppZone, false);

  // The zone never appears without the overlay (e.g. in a browser).
  equal(sleepOverlayModel({ ...base, usesWebSleepControls: true, wakeAppZoneEnabled: true }).showWakeAppZone, false);
});

run('app shell command and chart helpers preserve app decisions', () => {
  equal(isMachineCommand('espresso'), true);
  equal(isMachineCommand('sleeping'), false);
  equal(machineCommandsAvailable(true, null), true);
  equal(machineCommandsAvailable(false, null), false);
  equal(machineCommandsAvailable(false, machineInfo({ serialNumber: 'simulator-1' })), true);
  equal(liveChartModelOptions('preset30').minTime, 30);
  equal(JSON.stringify(liveChartModelOptions('auto')), '{}');
  // A ghost overlay anchors the time axis to the ghost's length, overriding the mode default.
  equal(liveChartModelOptions('preset30', 22).minTime, 22);
  equal(liveChartModelOptions('auto', 45).minTime, 45);
  equal(liveChartModelOptions('preset30', 0).minTime, 30);
  equal(JSON.stringify(liveChartModelOptions('auto', null)), '{}');
  equal(liveChartHideMaxTimeLabel('auto', 20), true);
  equal(liveChartHideMaxTimeLabel('preset30', 31), true);
  equal(liveChartHideMaxTimeLabel('preset30', 30), false);
});

run('app shell signatures compare draft and workflow recipe identity', () => {
  const draft: RecipeDraft = {
    profileId: 'profile',
    profileTitle: 'Profile',
    dose: 18,
    yield: 36,
    grinderId: null,
    grinderModel: 'Grinder',
    grinderSetting: '5.5',
    brewTemp: null
  };
  const workflow: Workflow = {
    profile: { title: 'Profile', steps: [] },
    context: {
      targetDoseWeight: 18,
      targetYield: 36,
      grinderModel: 'Grinder',
      grinderSetting: '5.5'
    }
  };

  equal(draftSignature(draft), workflowSignature(workflow));
  equal(draftSignature({ ...draft, yield: 40 }) === workflowSignature(workflow), false);
});

function machine(overrides: Partial<MachineSnapshot> = {}): MachineSnapshot {
  return {
    timestamp: 'now',
    state: { state: 'idle' },
    flow: 0,
    pressure: 0,
    targetFlow: 0,
    targetPressure: 0,
    mixTemperature: 0,
    groupTemperature: 93,
    targetMixTemperature: 0,
    targetGroupTemperature: 93,
    profileFrame: 0,
    steamTemperature: 0,
    ...overrides
  };
}

function machineInfo(overrides: Partial<MachineInfo> = {}): MachineInfo {
  return { model: 'DE1', serialNumber: '123', version: '1', GHC: false, extra: {}, ...overrides };
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
    throw new Error(`Expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`);
  }
}
