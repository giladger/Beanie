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

  includes(html, 'Choose coffee');
  includes(html, 'value="dak"');
  includes(html, 'autofocus');
  includes(html, 'Milky Cake');
  includes(html, 'Current');
  includes(html, 'bean-picker-edit-icon');
  includes(html, 'data-action="toggle-bean-details"');
  includes(html, 'aria-expanded="false"');
  includes(html, 'Selected coffee');
  includes(html, 'Bags on hand');
  notIncludes(html, 'bean-picker-stock-now');
  notIncludes(html, '<span class="eyebrow">Using now</span>');
  notIncludes(html, 'data-form="bean-picker-bean" data-id="bean-1"');
  notIncludes(html, 'data-action="select-bean"');
  notIncludes(html, '<span>Save</span>');
  notIncludes(html, 'Latest stock');
  includes(html, 'data-batch-id="batch-1"');
  includes(html, 'data-action="select-batch"');
  includes(html, 'data-action="open-batch-storage"');
  includes(html, 'data-action="toggle-batch-details"');
  includes(html, 'data-action="finish-batch"');
  includes(html, 'In freezer');
  notIncludes(html, 'data-action="delete-batch"');
  notIncludes(html, 'data-action="bean-picker-batch-field"');
});

run('bean picker opens edit fields from the bean line without duplicating the title', () => {
  const html = renderBeanPickerModal(model({ editingBeanDetailsId: 'bean-1' }));

  includes(html, 'aria-expanded="true"');
  includes(html, 'data-form="bean-picker-bean" data-id="bean-1"');
  includes(html, 'name="roaster"');
  includes(html, 'name="notes"');
  equals(countOccurrences(html, '<strong>Dak Milky Cake</strong>'), 1);
});

run('bean picker shows every bag on hand after adding beyond two bags', () => {
  const third: BeanBatch = {
    id: 'batch-new',
    beanId: 'bean-1',
    roastDate: '2026-06-10',
    roastLevel: 'Light',
    weight: 250,
    weightRemaining: 250
  };
  const html = renderBeanPickerModal(
    model({
      batchesByBean: {
        'bean-1': [third, ...batches]
      }
    })
  );

  includes(html, '3 bags');
  includes(html, 'data-batch-id="batch-new"');
  includes(html, 'data-batch-id="batch-1"');
  includes(html, 'data-batch-id="batch-older"');
  equals(countOccurrences(html, 'data-form="bean-picker-batch"'), 3);
});

run('bean picker hides nearly empty bags until show all is toggled', () => {
  const finished: BeanBatch = {
    id: 'batch-finished',
    beanId: 'bean-1',
    roastDate: '2026-06-10',
    weight: 250,
    weightRemaining: 3
  };
  const hiddenHtml = renderBeanPickerModal(
    model({
      batchesByBean: {
        'bean-1': [finished, ...batches]
      }
    })
  );

  includes(hiddenHtml, '2 active bags');
  includes(hiddenHtml, 'Show all');
  notIncludes(hiddenHtml, 'data-batch-id="batch-finished"');

  const shownHtml = renderBeanPickerModal(
    model({
      showAllBags: true,
      batchesByBean: {
        'bean-1': [finished, ...batches]
      }
    })
  );

  includes(shownHtml, '3 bags');
  includes(shownHtml, 'Hide finished');
  includes(shownHtml, 'data-batch-id="batch-finished"');
  includes(shownHtml, 'Finished');
  includes(shownHtml, 'disabled');
});

run('bean picker keeps all nearly empty bags hidden by default', () => {
  const finished: BeanBatch = {
    id: 'batch-finished',
    beanId: 'bean-1',
    roastDate: '2026-06-10',
    weight: 250,
    weightRemaining: 0
  };
  const html = renderBeanPickerModal(
    model({
      batchesByBean: {
        'bean-1': [finished]
      }
    })
  );

  includes(html, '0 active bags');
  includes(html, 'Show all');
  includes(html, 'No active bags.');
  notIncludes(html, 'data-batch-id="batch-finished"');
});

run('bean picker edits one bag only after opening the bag details', () => {
  const html = renderBeanPickerModal(model({ editingBatchId: 'batch-1' }));

  includes(html, 'bean-picker-batch stock-card current editing');
  includes(html, 'data-action="bean-picker-batch-field"');
  includes(html, 'name="roastDate"');
  includes(html, 'name="weightRemaining"');
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
  includes(html, 'Add coffee');
  notIncludes(html, 'Save bean + stock');
  includes(html, 'On hand');
  includes(html, 'Roast date');
  includes(html, 'Left');
  notIncludes(html, 'Starts in freezer');
  includes(html, 'name="prefillBeanId"');
  includes(html, 'Continue from');
  includes(html, 'New coffee');
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

  includes(html, 'Tap again to brew');
  includes(html, 'has-second-tap-hint');
});

run('batch storage modal renders compact freeze/thaw actions', () => {
  const html = renderBatchStorageModal(beans[0]!, batches[0]!);

  includes(html, 'Stock location');
  includes(html, 'Current stock');
  includes(html, 'Move stock');
  includes(html, 'Mark thawed');
  includes(html, 'Dates and history');
  includes(html, 'Correct freeze date');
  includes(html, 'Frozen on');
  includes(html, 'Roast age');
  includes(html, 'Active age');
  includes(html, 'Storage timeline');
  includes(html, 'data-form="batch-storage-date"');
  notIncludes(html, 'Location action');
  notIncludes(html, 'Storage date');
});

run('batch storage modal exposes freezing a portion for shelf batches', () => {
  const html = renderBatchStorageModal(beans[0]!, batches[1]!);

  includes(html, 'Move all to freezer');
  includes(html, 'Move part to freezer');
  includes(html, 'Leave some on the shelf and freeze the rest.');
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
    selectedBatchId: 'batch-1',
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

function countOccurrences(text: string, expected: string): number {
  return text.split(expected).length - 1;
}

function equals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`);
  }
}
