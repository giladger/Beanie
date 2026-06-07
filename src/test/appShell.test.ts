import type { MachineInfo, MachineSnapshot, RecipeDraft, Workflow } from '../api/types';
import {
  draftSignature,
  formatNumber,
  isMachineCommand,
  liveChartHideMaxTimeLabel,
  liveChartModelOptions,
  machineCommandsAvailable,
  machineStatus,
  scaleConnected,
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
