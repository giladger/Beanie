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
  includes(html, 'Milky &amp; Cake');
  includes(html, 'Dak &lt;Roasters&gt;');
  includes(html, 'data-action="open-bean-picker"');
  includes(html, '118g');
  includes(html, '~6 shots');
  includes(html, '3 days off roast');
  includes(html, 'data-field="dose" data-delta="-0.5"');
  includes(html, 'data-field="grinderSetting" data-delta="-0.25"');
  includes(html, '&lt;history&gt;');
  excludes(html, '<history>');
});

run('workbench marks the status stat with the alert tone when the gateway link is down', () => {
  const html = renderWorkbench(
    model({ topbar: { ...model().topbar, machineStatus: 'Offline', machineTone: 'stat-alert' } })
  );

  includes(html, 'id="stat-machine">Offline</strong>');
  includes(html, 'class="top-stat stat-alert"');
});

run('workbench hides remaining/age chips and machine commands when model says unavailable', () => {
  const html = renderWorkbench(
    model({
      hero: { beanName: 'Pick a bag', roaster: null, age: null, remaining: null, shotsLeft: null, beanId: null },
      topbar: {
        ...model().topbar,
        cleaningDue: false,
        machineCommands: { available: false, current: 'idle', busy: false }
      }
    })
  );

  includes(html, 'Pick a bag');
  excludes(html, 'hero-remaining');
  excludes(html, 'hero-roast');
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
  equal(renderLivePanel({ active: false, finalizing: false, busy: false, ghost: null, stages: null }), '');

  const stages = {
    steps: [
      { name: 'Preinfusion', reason: { text: 'pressure 4.2 bar', kind: 'pressure' as const } },
      { name: 'Pour', reason: { text: '9.8s elapsed', kind: 'time' as const } },
      { name: 'Decline', reason: null }
    ],
    currentIndex: 1
  };
  const active = renderLivePanel({ active: true, finalizing: false, busy: true, ghost: { enabled: true, title: 'Hide reference overlay (18g → 36g)' }, stages });
  // The "Live shot" eyebrow was removed; the stage rail names the shot now.
  excludes(active, 'Live shot');
  includes(active, 'data-action="stop"');
  includes(active, 'disabled');
  includes(active, 'id="live-pressure"');

  includes(active, 'data-action="live-ghost-toggle"');
  includes(active, 'live-ghost-button active');
  includes(active, 'Hide reference overlay (18g → 36g)');

  // Stage rail is a timeline: stages before the current one are done, the
  // current one highlighted, later ones upcoming.
  includes(active, 'id="live-stage-rail"');
  includes(active, 'Preinfusion');
  includes(active, 'Pour');
  includes(active, 'Decline');
  includes(active, 'live-stage-item done" data-index="0"');
  includes(active, 'live-stage-item current" data-index="1"');
  includes(active, 'live-stage-item upcoming" data-index="2"');

  // Each advanced stage shows its reason as a chip tinted by kind; a null
  // reason renders an empty span (kept for live patching, hidden by :empty).
  includes(active, 'data-kind="pressure">pressure 4.2 bar<');
  includes(active, 'data-kind="time">9.8s elapsed<');
  includes(active, 'live-stage-reason" data-index="2"></span>');

  // No stages known: the rail is still present (for live patching) but hidden.
  const noStages = renderLivePanel({ active: true, finalizing: false, busy: false, ghost: null, stages: null });
  includes(noStages, 'id="live-stage-rail"');
  includes(noStages, 'hidden');

  const finalizing = renderLivePanel({ active: false, finalizing: true, busy: false, ghost: null, stages });
  includes(finalizing, 'Saving shot');
  includes(finalizing, 'Saving…');
  excludes(finalizing, 'data-action="stop"');
  // The stage rail stays visible while finalizing so the steps don't disappear
  // out from under the "Saving…" state.
  includes(finalizing, 'id="live-stage-rail"');
  includes(finalizing, 'Decline');
});

function model(overrides: Partial<WorkbenchViewModel> = {}): WorkbenchViewModel {
  const base: WorkbenchViewModel = {
    topbar: {
      machineStatus: 'Ready',
      machineTone: '' as const,
      groupTemperature: '93°C',
      steamTemperature: '140°C',
      water: '820 ml',
      waterTone: 'stat-warn',
      scale: {
        label: '18.2 g',
        title: 'Tare scale',
        tone: '' as const
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
      beanName: 'Milky & Cake',
      roaster: 'Dak <Roasters>',
      age: '3 days off roast',
      remaining: '118g',
      shotsLeft: '~6 shots',
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
