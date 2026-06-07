import {
  renderLivePanel,
  renderPageHeader,
  renderWorkbench,
  type WorkbenchViewModel
} from '../views/workbenchView';

run('workbench renders topbar metrics, hero bean actions, recipe controls, and history html', () => {
  const html = renderWorkbench(model());

  includes(html, 'class="topbar"');
  includes(html, 'id="stat-machine">Ready</strong>');
  includes(html, 'class="top-stat stat-warn"');
  includes(html, 'data-action="scale-stat"');
  includes(html, 'data-action="machine-command"');
  includes(html, 'data-value="steam"');
  includes(html, 'aria-pressed="true"');
  includes(html, 'Water - steam, water, flush (cleaning due)');
  includes(html, 'Dak &lt;Roasters&gt; Milky &amp; Cake');
  includes(html, 'data-action="open-edit-bean" data-id="bean-1"');
  includes(html, 'data-field="dose" data-delta="-0.5"');
  includes(html, 'data-field="grinderSetting" data-delta="-0.25"');
  includes(html, '&lt;history&gt;');
  excludes(html, '<history>');
});

run('workbench hides bean edit and machine commands when model says unavailable', () => {
  const html = renderWorkbench(
    model({
      hero: { beanTitle: 'Pick a bag', freshness: null, beanId: null },
      topbar: {
        ...model().topbar,
        cleaningDue: false,
        machineCommands: { available: false, current: 'idle', busy: false }
      }
    })
  );

  excludes(html, 'data-action="open-edit-bean"');
  excludes(html, 'data-action="machine-command"');
  excludes(html, 'has-badge');
});

run('page header escapes the title and back value while preserving action html', () => {
  const html = renderPageHeader('Settings <DE1>', 'profiles"bad', '<button data-action="save">Save</button>');

  includes(html, 'Settings &lt;DE1&gt;');
  includes(html, 'data-value="profiles&quot;bad"');
  includes(html, '<button data-action="save">Save</button>');
});

run('live panel renders inactive, active, and finalizing states', () => {
  equal(renderLivePanel({ active: false, finalizing: false, busy: false }), '');

  const active = renderLivePanel({ active: true, finalizing: false, busy: true });
  includes(active, 'Live shot');
  includes(active, 'data-action="stop"');
  includes(active, 'disabled');
  includes(active, 'id="live-pressure"');

  const finalizing = renderLivePanel({ active: false, finalizing: true, busy: false });
  includes(finalizing, 'Saving shot');
  includes(finalizing, 'Saving…');
  excludes(finalizing, 'data-action="stop"');
});

function model(overrides: Partial<WorkbenchViewModel> = {}): WorkbenchViewModel {
  const base: WorkbenchViewModel = {
    topbar: {
      machineStatus: 'Ready',
      groupTemperature: '93°C',
      steamTemperature: '140°C',
      water: '820 ml',
      waterTone: 'stat-warn',
      scale: {
        label: '18.2 g',
        title: 'Tare scale'
      },
      machineCommands: {
        available: true,
        current: 'steam',
        busy: false
      },
      cleaningDue: true,
      asleep: false
    },
    hero: {
      beanTitle: 'Dak <Roasters> Milky & Cake',
      freshness: '3 days off roast',
      beanId: 'bean-1'
    },
    recipe: {
      draft: {
        profileTitle: 'Bloom <profile>',
        dose: 18,
        yield: 42,
        grinderSetting: '7 <fine>'
      },
      grinderStep: 0.25,
      ratioLabel: '1:2.3',
      brewTempLabel: '93.0'
    },
    historyHtml: '&lt;history&gt;'
  };
  return { ...base, ...overrides };
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

function includes(text: string, expected: string): void {
  if (!text.includes(expected)) {
    throw new Error(`Expected ${JSON.stringify(text.slice(0, 300))} to include ${expected}`);
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
