import type { Bean, BeanBatch } from '../api/types';
import {
  renderBatchStorageModal,
  renderBeanPickerModal,
  type BeanPickerViewModel
} from '../views/beanPickerView';

const beans: Bean[] = [
  {
    id: 'bean-1',
    roaster: 'Dak',
    name: 'Milky Cake',
    country: 'Ethiopia',
    region: 'Sidama',
    processing: 'Washed',
    notes: 'Sweet'
  },
  {
    id: 'bean-2',
    roaster: 'April',
    name: 'Pink Bourbon'
  }
];

const batches: BeanBatch[] = [
  {
    id: 'batch-1',
    beanId: 'bean-1',
    roastDate: '2026-06-05T10:00:00.000Z',
    roastLevel: 'Light',
    weight: 250,
    weightRemaining: 125,
    frozen: true,
    storageEvents: [{ type: 'frozen', at: '2026-06-06T08:00:00.000Z' }]
  },
  {
    id: 'batch-older',
    beanId: 'bean-1',
    roastDate: '2026-05-01',
    roastLevel: 'Medium',
    weight: 250,
    weightRemaining: 50
  }
];

run('bean picker renders matched beans, current bean, focused inspector, and latest batch', () => {
  const html = renderBeanPickerModal(model());

  includes(html, 'Pick a bag');
  includes(html, 'value="dak"');
  includes(html, 'autofocus');
  includes(html, 'Milky Cake');
  includes(html, 'In use');
  includes(html, 'data-form="bean-picker-bean" data-id="bean-1"');
  includes(html, 'Edit bean details');
  includes(html, 'Latest stock');
  includes(html, 'data-batch-id="batch-1"');
  includes(html, 'data-action="open-batch-storage"');
  includes(html, 'In freezer');
});

run('bean picker create mode renders new bean form and prefill choices', () => {
  const html = renderBeanPickerModal(
    model({
      mode: 'create',
      focusedBean: null,
      matches: []
    })
  );

  includes(html, 'bean-picker-modal create-mode');
  includes(html, 'Add a bag');
  includes(html, 'Save bean + stock');
  includes(html, 'First stock');
  includes(html, 'Starting grams');
  includes(html, 'Available now');
  includes(html, 'Starts in freezer');
  includes(html, 'name="prefillBeanId"');
  includes(html, 'Copy from');
  includes(html, 'Dak Milky Cake');
  notIncludes(html, 'bean-picker-list-panel');
  notIncludes(html, 'data-action="open-label-scanner"');
});

run('bean picker renders second tap hint for matching bean only', () => {
  const html = renderBeanPickerModal(
    model({
      secondTapHint: { kind: 'bean', id: 'bean-2' }
    })
  );

  includes(html, 'Tap again to load');
  includes(html, 'has-second-tap-hint');
});

run('batch storage modal renders compact freeze/thaw actions', () => {
  const html = renderBatchStorageModal(beans[0]!, batches[0]!);

  includes(html, 'Stock location');
  includes(html, 'Current stock');
  includes(html, 'Mark thawed');
  includes(html, 'Correct freeze date');
  includes(html, 'Frozen on');
  includes(html, 'Roast age');
  includes(html, 'Active age');
  includes(html, 'Storage timeline');
  includes(html, 'data-form="batch-storage-date"');
  includes(html, 'Shots save the freshness at pull time');
  notIncludes(html, 'Storage date');
});

run('batch storage modal exposes freezing a portion for shelf batches', () => {
  const html = renderBatchStorageModal(beans[0]!, batches[1]!);

  includes(html, 'Move all to freezer');
  includes(html, 'Move part to freezer');
  includes(html, 'Grams to move');
  includes(html, 'data-action="open-number-edit"');
  includes(html, 'data-return-modal="batch-storage"');
  includes(html, 'Preview split');
  includes(html, 'data-form="batch-freeze-portion"');
});

run('batch storage modal previews split stock before committing', () => {
  const html = renderBatchStorageModal(beans[0]!, batches[1]!, { 'batch-storage:batch-older:amount': '25' }, true);

  includes(html, 'Shelf stock: 25g on shelf');
  includes(html, 'New freezer stock: 25g frozen today');
  includes(html, 'Move 25g to freezer');
  includes(html, 'data-confirm="true"');
});

run('batch storage modal backfills the freeze date for legacy frozen batches', () => {
  const html = renderBatchStorageModal(beans[0]!, {
    id: 'legacy-frozen',
    beanId: 'bean-1',
    roastDate: '2026-06-05T10:00:00.000Z',
    frozen: true
  });

  includes(html, 'Add freeze date');
  includes(html, 'Frozen on');
  includes(html, 'name="type" value="frozen"');
});

function model(overrides: Partial<BeanPickerViewModel> = {}): BeanPickerViewModel {
  return {
    search: 'dak',
    autofocusSearch: true,
    matches: beans,
    focusedBean: beans[0]!,
    mode: 'inspect',
    selectedBeanId: 'bean-1',
    batchesByBean: {
      'bean-1': batches
    },
    prefillBeans: beans,
    secondTapHint: null,
    ...overrides
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
    throw new Error(`Expected ${JSON.stringify(text.slice(0, 280))} to include ${expected}`);
  }
}

function notIncludes(text: string, unexpected: string): void {
  if (text.includes(unexpected)) {
    throw new Error(`Expected rendered output not to include ${unexpected}`);
  }
}
