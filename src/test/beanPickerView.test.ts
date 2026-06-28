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
  includes(html, 'data-action="focus-batch"');
  includes(html, 'data-id="batch-1"');
  notIncludes(html, 'data-action="select-batch"');
  notIncludes(html, 'Brew this');
  includes(html, 'data-action="toggle-batch-details"');
  includes(html, 'data-action="finish-batch"');
  includes(html, 'stock-list');
  notIncludes(html, 'stock-columns');
  notIncludes(html, 'data-action="open-batch-storage"');
  notIncludes(html, 'data-action="delete-batch"');
  notIncludes(html, 'data-action="bean-picker-batch-field"');
});

run('bean picker lists bags in one list and marks the frozen bag', () => {
  const html = renderBeanPickerModal(model());

  includes(html, 'stock-list');
  notIncludes(html, 'stock-columns');
  includes(html, 'stock-row-loc');
  includes(html, ' · frozen · ');
  // batch-1 is frozen and focused by default, so it offers thaw.
  includes(html, 'data-action="batch-storage-event" data-type="thawed" data-id="batch-1"');
  includes(html, 'Thaw');
});

run('bean list rows show active age and estimated shots left', () => {
  const html = renderBeanPickerModal(model({ averageDoseIn: 18 }));

  includes(html, 'bean-row-meta');
  // bean-1 has 125g + 50g across two active bags; floor(175 / 18) = 9.
  includes(html, '~9 shots');
  includes(html, 'active');
});

run('bean list hides the shots estimate when no dose average is known', () => {
  const html = renderBeanPickerModal(model({ averageDoseIn: null }));

  notIncludes(html, 'shots');
});

run('bean picker omits the frozen marker for a shelf-only bag', () => {
  const html = renderBeanPickerModal(
    model({
      batchesByBean: { 'bean-1': [batches[1]!] },
      selectedBatchId: 'batch-older'
    })
  );

  includes(html, 'stock-list');
  notIncludes(html, 'stock-row-loc');
  notIncludes(html, ' · frozen');
});

run('bean picker focused row carries the move and manage actions inline', () => {
  const html = renderBeanPickerModal(model());

  includes(html, 'stock-row-actions');
  notIncludes(html, 'stock-action-bar');
  notIncludes(html, 'Brew this');
  notIncludes(html, 'data-action="select-batch"');
  includes(html, 'Thaw');
  includes(html, 'data-action="toggle-batch-details" data-id="batch-1"');
  includes(html, 'data-action="finish-batch" data-id="batch-1"');
  notIncludes(html, 'data-action="toggle-freeze-stepper"');
});

run('bean picker focused shelf row offers freeze and opens the stepper', () => {
  const focusedShelf = model({ focusedBatchId: 'batch-older' });
  const html = renderBeanPickerModal(focusedShelf);

  includes(html, 'data-action="toggle-freeze-stepper" data-id="batch-older"');
  notIncludes(html, 'class="freeze-stepper"');

  const withStepper = renderBeanPickerModal(
    model({ focusedBatchId: 'batch-older', freezeStepperBatchId: 'batch-older' })
  );

  includes(withStepper, 'class="freeze-stepper"');
  // Defaults to freezing the whole bag, nothing kept on the shelf.
  includes(withStepper, 'keep <b>0g</b> on shelf');
  includes(withStepper, 'data-action="confirm-freeze-stock" data-id="batch-older"');
  includes(withStepper, 'Freeze 50g');
});

run('bean picker freeze stepper weighs what goes into the freezer', () => {
  const html = renderBeanPickerModal(
    model({
      focusedBatchId: 'batch-older',
      freezeStepperBatchId: 'batch-older',
      formNumbers: { 'freeze-amount:batch-older': '30' }
    })
  );

  // 30g into the freezer leaves 20g on the shelf as a calculated label.
  includes(html, 'keep <b>20g</b> on shelf');
  includes(html, 'Freeze 30g');
  includes(html, 'data-form-key="freeze-amount:batch-older"');
});

run('bean picker opens edit fields from the bean line without duplicating the title', () => {
  const html = renderBeanPickerModal(model({ editingBeanDetailsId: 'bean-1' }));

  includes(html, 'aria-expanded="true"');
  includes(html, 'data-form="bean-picker-bean" data-id="bean-1"');
  includes(html, 'name="roaster"');
  includes(html, 'name="notes"');
  equals(countOccurrences(html, '<strong>Dak Milky Cake</strong>'), 1);
});

run('bean picker edit fields offer a delete button for the coffee', () => {
  const html = renderBeanPickerModal(model({ editingBeanDetailsId: 'bean-1' }));

  includes(html, 'data-action="archive-bean" data-id="bean-1"');
  includes(html, 'Delete coffee');
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
  includes(html, 'data-id="batch-new"');
  includes(html, 'data-id="batch-1"');
  includes(html, 'data-id="batch-older"');
  equals(countOccurrences(html, 'data-action="focus-batch"'), 3);
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
  notIncludes(hiddenHtml, 'data-id="batch-finished"');

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
  includes(shownHtml, 'data-id="batch-finished"');
  includes(shownHtml, 'stock-row  finished');
});

run('bean picker focused row hides brew and freeze for finished bags', () => {
  const finished: BeanBatch = {
    id: 'batch-finished',
    beanId: 'bean-1',
    roastDate: '2026-06-10',
    weight: 250,
    weightRemaining: 3
  };
  const html = renderBeanPickerModal(
    model({
      showAllBags: true,
      focusedBatchId: 'batch-finished',
      batchesByBean: {
        'bean-1': [finished, ...batches]
      }
    })
  );

  includes(html, 'stock-row-actions');
  notIncludes(html, 'Brew this');
  notIncludes(html, 'data-action="toggle-freeze-stepper"');
  includes(html, 'data-action="toggle-batch-details"');
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
  notIncludes(html, 'data-id="batch-finished"');
});

run('bean picker edits one bag only after opening the bag details', () => {
  const html = renderBeanPickerModal(model({ editingBatchId: 'batch-1' }));

  includes(html, 'stock-edit-panel');
  includes(html, 'data-batch-id="batch-1"');
  includes(html, 'data-action="bean-picker-batch-field"');
  includes(html, 'name="roastDate"');
  includes(html, 'name="weightRemaining"');
  includes(html, 'data-action="open-batch-storage"');
  includes(html, 'Dates and history');
});

run('bean picker keeps the edit panel closed for unfocused bags', () => {
  const html = renderBeanPickerModal(model({ editingBatchId: 'batch-older' }));

  notIncludes(html, 'stock-edit-panel');
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

run('bean picker marks favorites with a star and offers a toggle', () => {
  const plain = renderBeanPickerModal(model());
  includes(plain, 'data-action="toggle-favorite-bean" data-id="bean-1"');
  includes(plain, 'aria-pressed="false"');
  notIncludes(plain, 'bean-row-fav');

  const favorited = renderBeanPickerModal(model({ favoriteBeanIds: ['bean-1'] }));
  includes(favorited, 'bean-row-fav');
  includes(favorited, 'class="bean-fav on"');
  includes(favorited, 'aria-pressed="true"');
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

run('batch storage modal shows bag details with an editable date for every event', () => {
  const html = renderBatchStorageModal(beans[0]!, batches[0]!);

  includes(html, 'Bag details');
  includes(html, 'Current stock');
  includes(html, 'Move stock');
  includes(html, 'Move to shelf');
  includes(html, 'data-type="thawed"');
  includes(html, 'Roast age');
  includes(html, 'Active age');
  // Every date is editable in one form: the roast date and each freeze/thaw event.
  includes(html, 'Correct dates');
  includes(html, 'Edit any date');
  includes(html, 'data-form="batch-storage-dates"');
  includes(html, 'name="roast"');
  includes(html, 'Moved to freezer');
  includes(html, 'name="event-0"');
  includes(html, 'Save dates');
  notIncludes(html, 'Mark thawed');
  notIncludes(html, 'data-form="batch-freeze-portion"');
  notIncludes(html, 'Preview split');
});

run('batch storage modal offers freezing for shelf batches without a split form', () => {
  const html = renderBatchStorageModal(beans[0]!, batches[1]!);

  includes(html, 'Move to freezer');
  includes(html, 'data-type="frozen"');
  notIncludes(html, 'Move part to freezer');
  notIncludes(html, 'Grams to move');
  notIncludes(html, 'data-form="batch-freeze-portion"');
});

run('batch storage modal backfills the freeze date for legacy frozen batches', () => {
  const html = renderBatchStorageModal(beans[0]!, {
    id: 'legacy-frozen',
    beanId: 'bean-1',
    roastDate: '2026-06-05T10:00:00.000Z',
    frozen: true
  });

  // No recorded history, but the flag says frozen — offer a first freeze date.
  includes(html, 'Edit any date');
  includes(html, 'Frozen on');
  includes(html, 'name="event-new"');
  // The roast date is still editable alongside it.
  includes(html, 'name="roast"');
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
