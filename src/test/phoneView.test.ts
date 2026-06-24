import type { Bean, BeanBatch, ShotRecord } from '../api/types';
import { renderPhoneShell, type PhoneShellModel } from '../views/phoneView';

run('phone shell exposes helper workflows without machine service controls', () => {
  const html = [
    renderPhoneShell(model()),
    renderPhoneShell({ ...model(), activeTab: 'scan' }),
    renderPhoneShell({ ...model(), activeTab: 'beans' }),
    renderPhoneShell({ ...model(), activeTab: 'shots' })
  ].join('');

  includes(html, 'data-action="open-label-scanner"');
  includes(html, 'data-action="phone-select-bean"');
  includes(html, 'data-action="open-edit-bean"');
  includes(html, 'data-action="phone-select-shot"');
  includes(html, 'data-action="phone-shot-field"');
  includes(html, 'data-action="phone-save-shot"');
  includes(html, 'data-action="phone-recipe-field"');
  includes(html, 'data-action="sleep"');
  includes(html, 'class="phone-tabs"');
  excludes(html, '<header class="phone-head">');
  excludes(html, 'class="phone-nav-button"');
  excludes(html, 'class="phone-back-home"');
  excludes(html, 'data-action="machine-command"');
  excludes(html, 'data-action="open-cleaning-wizard"');
  excludes(html, 'data-action="open-machine-settings"');
  excludes(html, 'data-action="machine-extend-service"');
  excludes(html, 'data-action="stop"');
  excludes(html, 'data-action="select-history-shot"');
  excludes(html, 'data-action="edit-field"');
  excludes(html, 'data-action="phone-edit-shot"');
  excludes(html, 'data-action="open-batch-storage"');
});

run('phone home hero opens the bean picker and shows bag facts', () => {
  const html = renderPhoneShell(model());

  includes(html, 'phone-home-hero" data-action="open-bean-picker"');
  includes(html, '180g left');
  includes(html, '~10 shots');
});

run('phone bean rows carry the picker stock facts and favorites', () => {
  const html = renderPhoneShell({ ...model(), activeTab: 'beans' });

  includes(html, 'phone-row-fav');
  includes(html, 'd active');
  includes(html, '~10 shots');
});

run('phone bean rows fall back to origin facts without bags', () => {
  const base = model();
  const html = renderPhoneShell({
    ...base,
    activeTab: 'beans',
    batchesByBean: {},
    beans: [{ ...base.beans[0]!, country: 'Colombia', processing: 'washed' }]
  });

  includes(html, 'Colombia · washed');
  excludes(html, 'shots ·');
});

run('phone shots render selected shot as an accordion below the row', () => {
  const html = renderPhoneShell({ ...model(), activeTab: 'shots' });
  const rowIndex = html.indexOf('data-action="phone-select-shot" data-id="shot-1"');
  const detailIndex = html.indexOf('class="phone-card phone-shot-card"');

  includes(html, 'data-action="phone-shot-field"');
  equal(rowIndex >= 0, true);
  equal(detailIndex > rowIndex, true);
});

run('phone shot rows show computed age for unstamped shots', () => {
  const html = renderPhoneShell({ ...model(), activeTab: 'shots' });

  includes(html, '4d · Profile shot-1 · Jun 5');
  includes(html, '4d · Profile shot-1 · 1:2.2 · Jun 5');
});

run('phone home places machine power above the coffee card', () => {
  const html = renderPhoneShell(model());
  const powerIndex = html.indexOf('class="phone-wake');
  const cardIndex = html.indexOf('class="phone-card phone-home-hero"');
  const titleIndex = html.indexOf('Kawa Pink Bourbon');

  equal(powerIndex >= 0, true);
  equal(cardIndex > powerIndex, true);
  equal(titleIndex > powerIndex, true);
  excludes(html, 'phone-home-controls');
});

run('phone scan tab keeps only the scanner workflow', () => {
  const html = renderPhoneShell({ ...model(), activeTab: 'scan' });

  includes(html, 'data-action="open-label-scanner"');
  excludes(html, 'Manual fallback');
  excludes(html, 'data-action="open-add-bean"');
  excludes(html, 'data-action="open-bean-picker"');
});

run('phone settings renders filtered settings content inside the tab', () => {
  const html = renderPhoneShell({
    ...model(),
    activeTab: 'settings',
    settingsHtml: '<main class="settings-page"><button data-action="settings-section" data-value="app">App</button></main>'
  });

  includes(html, 'phone-settings');
  includes(html, 'data-value="app"');
});

function model(): PhoneShellModel {
  const bean: Bean = { id: 'bean-1', roaster: 'Kawa', name: 'Pink Bourbon' };
  const batch: BeanBatch = { id: 'batch-1', beanId: bean.id, roastDate: '2026-06-01T00:00:00.000Z', weightRemaining: 180 };
  return {
    activeTab: 'home',
    status: 'Ready',
    machineStatus: 'Ready',
    asleep: false,
    selectedBean: bean,
    selectedBatch: batch,
    batchesByBean: { [bean.id]: [batch] },
    beans: [bean],
    beanSearch: '',
    favoriteBeanIds: [bean.id],
    averageDoseIn: 18,
    applyState: 'idle',
    shots: [shot('shot-1', 'espresso', batch.id), shot('flush-1', 'flush')],
    selectedShot: shot('shot-1', 'espresso', batch.id),
    selectedShotDraft: {
      shotId: 'shot-1',
      coffeeRoaster: 'Kawa',
      coffeeName: 'Pink Bourbon',
      beanBatchId: batch.id,
      finalBeverageType: 'espresso',
      baristaName: null,
      drinkerName: null,
      targetDoseWeight: 18,
      targetYield: 40,
      actualDoseWeight: 18,
      actualYield: 40,
      grinderId: null,
      grinderModel: null,
      grinderSetting: '12',
      drinkTds: null,
      drinkEy: null,
      enjoyment: 80,
      espressoNotes: 'Sweet and clean',
      contextExtras: null,
      annotationExtras: null
    },
    selectedShotDirty: false,
    shotsTotal: 2,
    shotsLoadingMore: false,
    demo: false,
    draft: {
      dose: 18,
      yield: 40,
      grinderSetting: '12',
      brewTemp: 93,
      profileTitle: 'Blooming espresso'
    },
    ratioLabel: '1:2.2',
    brewTempLabel: '93.0',
    settingsHtml: ''
  };
}

function shot(id: string, beverageType: string, beanBatchId: string | null = null): ShotRecord {
  return {
    id,
    timestamp: '2026-06-05T10:00:00.000Z',
    workflow: {
      profile: { title: `Profile ${id}`, beverage_type: beverageType },
      context: {
        targetDoseWeight: 18,
        targetYield: 40,
        finalBeverageType: beverageType,
        beanBatchId
      }
    },
    annotations: { enjoyment: 80 },
    measurements: []
  };
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
    throw new Error(`Expected ${JSON.stringify(text.slice(0, 240))} to include ${expected}`);
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
