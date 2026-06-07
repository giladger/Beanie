import {
  renderNoScaleShotModal,
  renderWaterAlert,
  renderWaterWarningBanner
} from '../views/alertsView';

run('no-scale modal reflects whether blocking is enabled', () => {
  includes(renderNoScaleShotModal(true), 'checked');
  excludes(renderNoScaleShotModal(false), 'checked');
  includes(renderNoScaleShotModal(true), 'Connect a scale to start');
});

run('water warning banner renders with and without a water amount', () => {
  includes(renderWaterWarningBanner('410 ml'), 'About 410 ml left');
  includes(renderWaterWarningBanner(null), 'Refill soon');
});

run('water alert distinguishes machine block and escapes tank labels', () => {
  const blocked = renderWaterAlert({ machineBlocked: true, mlLabel: '<400 ml>' });
  includes(blocked, 'has paused shots');
  includes(blocked, '&lt;400 ml&gt;');

  const soft = renderWaterAlert({ machineBlocked: false, mlLabel: null });
  includes(soft, 'keep pulling shots');
  excludes(soft, 'Tank is at about');
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
    throw new Error(`Expected ${JSON.stringify(text.slice(0, 240))} to include ${expected}`);
  }
}

function excludes(text: string, expected: string): void {
  if (text.includes(expected)) {
    throw new Error(`Expected rendered output not to include ${expected}`);
  }
}
