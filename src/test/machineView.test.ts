import {
  hotWaterTargetSpec,
  machineHotWaterStopModeTile,
  machineSteamPurgeTile,
  machineValueTile,
  renderCleaningBar,
  renderMachinePage,
  renderMachineProgressPage
} from '../views/machineView';

const enabledSpec = { min: 0, max: 100, step: 1, unit: 's', enabled: true };
const disabledSpec = { min: 0, max: 100, step: 1, unit: 's', enabled: false, reason: 'Missing hardware' };

run('machine page renders lane presets, rename actions, graphics, and value tiles', () => {
  const html = renderMachinePage({
    headerHtml: '<header>Machine</header>',
    cleaningBarHtml: '<section class="cleaning-bar"></section>',
    lanes: [
      {
        tone: 'steam',
        eyebrow: 'Steam',
        title: 'Milk',
        presetName: 'steamPreset',
        presets: [{ id: 'small', label: 'Small jug' }],
        selectedPreset: 'small',
        labelOverrides: { 'steamPreset:small': 'Cortado milk' },
        values: [
          machineValueTile('steamDuration', 'Time', 35, enabledSpec),
          machineValueTile('steamFlow', 'Flow', undefined, disabledSpec),
          machineSteamPurgeTile(1)
        ]
      }
    ]
  });

  includes(html, '<header>Machine</header>');
  includes(html, 'machine-lane steam');
  includes(html, 'aria-label="Steam"');
  includes(html, 'Cortado milk');
  includes(html, 'data-action="machine-edit-label"');
  includes(html, 'data-action="machine-edit-value"');
  includes(html, 'Missing hardware');
  includes(html, 'Two tap stop');
});

run('machine value helpers adapt hot-water weight mode and stop mode tiles', () => {
  const weightSpec = hotWaterTargetSpec({ min: 0, max: 500, step: 1, unit: 'ml', enabled: true, reason: 'No scale' }, true);
  equal(weightSpec.unit, 'g');
  equal(weightSpec.reason, undefined);

  const stopTile = machineHotWaterStopModeTile('volume', true);
  equal(stopTile.value, 'Weight');
  equal(stopTile.actionValue, 'time');
});

run('cleaning bar renders due state, threshold choices, and enabled run action', () => {
  const html = renderCleaningBar({
    due: true,
    profileTitle: 'Cleaning / forward flush x5',
    profilesAvailable: true,
    shotsSinceClean: 12,
    lastCleanedAt: '2026-06-05T10:00:00.000Z',
    threshold: 40,
    canRun: true
  });

  includes(html, 'cleaning-bar due');
  includes(html, 'Cleaning / forward flush x5');
  includes(html, '12 shots since last clean');
  includes(html, 'data-value="40" aria-pressed="true"');
  excludes(html, 'data-action="run-cleaning" title="Insert a blind basket with detergent, then run a forward-flush cycle (no beans). Your recipe is restored afterwards." disabled');
});

run('cleaning bar explains missing profile and disables run action', () => {
  const html = renderCleaningBar({
    due: false,
    profileTitle: null,
    profilesAvailable: false,
    shotsSinceClean: 0,
    lastCleanedAt: null,
    threshold: 0,
    canRun: false
  });

  includes(html, 'No profiles loaded');
  includes(html, 'Install a');
  includes(html, 'disabled');
});

run('machine progress page renders stats and stop request state', () => {
  const html = renderMachineProgressPage({
    title: 'Steaming',
    tone: 'steam',
    primaryTime: { value: 'Heating', label: null },
    meta: ['140 C', '12s target'],
    stats: [{ label: 'Target', value: '12', unit: 's' }],
    busy: true,
    stopRequested: true,
    stopLabel: 'Stopping...'
  });

  includes(html, 'Steaming');
  includes(html, 'aria-label="Steam"');
  includes(html, 'machine-progress-stop stopping');
  includes(html, 'Stopping...');
  includes(html, 'disabled');
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

function includes(text: string, expected: string): void {
  if (!text.includes(expected)) {
    throw new Error(`Expected ${JSON.stringify(text.slice(0, 260))} to include ${expected}`);
  }
}

function excludes(text: string, expected: string): void {
  if (text.includes(expected)) {
    throw new Error(`Expected rendered output not to include ${expected}`);
  }
}

function equal<T>(actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  }
}
