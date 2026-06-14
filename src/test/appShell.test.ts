import type { MachineInfo, MachineSnapshot, RecipeDraft, Workflow } from '../api/types';
import {
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

run('detect Decent webview tolerates UA quirks and falls back to the inappwebview bridge', () => {
  // The intended signal: reaprime overrides the UA to the bare token "Decent".
  equal(detectDecentAppWebView('Decent', false), true);
  equal(detectDecentAppWebView('  Decent  ', false), true);
  // Lenient: casing, a version suffix, or the override appended to a default
  // WebView UA must all still count as the Decent app.
  equal(detectDecentAppWebView('decent', false), true);
  equal(detectDecentAppWebView('Decent/2.1', false), true);
  equal(detectDecentAppWebView('Mozilla/5.0 (Linux; Android 10; wv) AppleWebKit Decent', false), true);
  // Tablets where setUserAgentString didn't take: default WebView UA, but the
  // flutter_inappwebview JS bridge is still injected — treat as the Decent app.
  equal(detectDecentAppWebView('Mozilla/5.0 (Linux; Android 10; wv) AppleWebKit/537.36', true), true);
  // A plain browser on :3000 has neither signal — use web sleep controls.
  equal(detectDecentAppWebView('Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/120 Safari/537.36', false), false);
  equal(detectDecentAppWebView('', false), false);
  equal(detectDecentAppWebView(null, false), false);
  // Word-boundary match must not fire on "decent" embedded in another token.
  equal(detectDecentAppWebView('Mozilla/5.0 IndecentBrowser/1.0', false), false);
});

run('app shell command and chart helpers preserve app decisions', () => {
  equal(isMachineCommand('espresso'), true);
  equal(isMachineCommand('sleeping'), false);
  equal(machineCommandsAvailable(true, null), true);
  equal(machineCommandsAvailable(false, null), false);
  equal(machineCommandsAvailable(false, machineInfo({ serialNumber: 'simulator-1' })), true);
  equal(liveChartModelOptions('preset30').minTime, 30);
  equal(JSON.stringify(liveChartModelOptions('auto')), '{}');
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
