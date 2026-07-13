import type { Bean, BeanBatch } from '../api/types';
import { readBeanInventoryForm } from '../components/beanInventoryForm';
import {
  BeanInventoryBrowserFlow,
  type BeanInventoryBrowserHost
} from '../controllers/beanInventoryBrowserFlow';
import {
  projectBeanInventoryBrowserEvent,
  type BeanInventoryBrowserEvent,
  type BeanInventoryBrowserSnapshot
} from '../controllers/beanInventoryBrowserProjection';
import type { BeanInventoryController } from '../controllers/beanInventoryController';
import { BeanWorkflowController } from '../controllers/beanWorkflowController';

class FakeFormData {
  private readonly values: Readonly<Record<string, string>>;

  constructor(form?: HTMLFormElement) {
    this.values = (form as unknown as { values?: Readonly<Record<string, string>> })?.values ?? {};
  }

  get(name: string): FormDataEntryValue | null {
    return Object.prototype.hasOwnProperty.call(this.values, name) ? this.values[name]! : null;
  }

  has(name: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.values, name);
  }

  entries(): FormDataIterator<[string, FormDataEntryValue]> {
    return Object.entries(this.values)[Symbol.iterator]() as FormDataIterator<[
      string,
      FormDataEntryValue
    ]>;
  }
}

await run('browser projection merges inventory into the latest shell snapshot', () => {
  const projection = projectBeanInventoryBrowserEvent({
    batchesByBean: { other: [batch('other-batch', 'other', 50)] },
    formNumbers: { keep: '1', remove: '2' }
  }, {
    type: 'inventory-projected',
    projection: {
      beanId: 'bean-1',
      batches: [batch('batch-1', 'bean-1', 80)],
      selectedBatchId: 'batch-1',
      shouldScheduleApply: true
    },
    removeFormKeys: ['remove'],
    status: 'Bag saved'
  });

  equal(projection.batchesByBean?.other?.[0]?.id, 'other-batch');
  equal(projection.batchesByBean?.['bean-1']?.[0]?.weightRemaining, 80);
  equal(projection.selectedBatchId, 'batch-1');
  equal(projection.formNumbers?.keep, '1');
  equal(projection.formNumbers?.remove, undefined);
});

await run('browser owns picker presentation and preferred-bag selection actions', async () => {
  const harness = createHarness();
  harness.state.favoriteBeans = ['bean-2'];

  await harness.flow.open('bean-1');
  const presentation = harness.flow.presentation();
  equal(harness.state.modal, 'bean-picker');
  equal(presentation.focusedBean?.id, 'bean-1');
  equal(presentation.prefillBeans[0]?.id, 'bean-2');
  equal(harness.refreshBeans, 1);
  equal(harness.refreshUsage, 1);

  await harness.flow.clickActions()['focus-batch']!({
    id: 'batch-1',
    el: { dataset: { beanId: 'bean-1' } } as unknown as HTMLElement
  });
  equal(harness.selections.length, 1);
  equal(harness.selections[0]?.beanId, 'bean-1');
  equal(harness.selections[0]?.preferredBatchId, 'batch-1');
});

await run('browser routes an inline bag edit through the inventory facade', async () => {
  const harness = createHarness();
  await harness.flow.saveBatchValue('bean-1', 'batch-1', 'weightRemaining', '75');

  equal(harness.inventoryRequests.length, 1);
  equal(harness.inventoryRequests[0]?.patch.weightRemaining, 75);
  equal(harness.state.batchesByBean['bean-1']?.[0]?.weightRemaining, 75);
  equal(harness.state.status, 'Batch saved');
});

await run('bean inventory form adapter produces a typed, trimmed bean submission', () => {
  const NativeFormData = globalThis.FormData;
  globalThis.FormData = FakeFormData as unknown as typeof FormData;
  try {
    const form = {
      dataset: { form: 'bean-picker-bean', id: 'bean-1' },
      values: {
        roaster: '  Friedhats ',
        name: ' Purple Rain ',
        country: ' Ethiopia ',
        weight: '250',
        weightRemaining: '240'
      }
    } as unknown as HTMLFormElement;
    const submission = readBeanInventoryForm(form);
    equal(submission?.type, 'bean');
    if (submission?.type !== 'bean') return;
    equal(submission.editingId, 'bean-1');
    equal(submission.fields.roaster, 'Friedhats');
    equal(submission.fields.name, 'Purple Rain');
    equal(submission.firstStock.weight.value, 250);
    equal(submission.firstStock.weightRemaining.value, 240);
  } finally {
    globalThis.FormData = NativeFormData;
  }
});

function createHarness(): {
  state: MutableSnapshot;
  flow: BeanInventoryBrowserFlow;
  inventoryRequests: Array<{ patch: Partial<BeanBatch> }>;
  selections: Array<{ beanId: string; preferredBatchId: string | null }>;
  refreshBeans: number;
  refreshUsage: number;
} {
  const state: MutableSnapshot = {
    beans: [
      { id: 'bean-1', roaster: 'Friedhats', name: 'Purple Rain' },
      { id: 'bean-2', roaster: 'Manhattan', name: 'Shoondhisa' }
    ],
    batchesByBean: { 'bean-1': [batch('batch-1', 'bean-1', 100)] },
    selectedBeanId: 'bean-1',
    selectedBatchId: 'batch-1',
    favoriteBeans: [],
    beanUsageAt: {},
    formNumbers: {},
    search: '',
    secondTapHint: null,
    busy: false,
    demo: false,
    modal: null,
    inventoryJournalReady: true,
    status: ''
  };
  const inventoryRequests: Array<{ patch: Partial<BeanBatch> }> = [];
  const selections: Array<{ beanId: string; preferredBatchId: string | null }> = [];
  const result = {
    state,
    flow: null as unknown as BeanInventoryBrowserFlow,
    inventoryRequests,
    selections,
    refreshBeans: 0,
    refreshUsage: 0
  };
  const host: BeanInventoryBrowserHost = {
    snapshot: () => state,
    emit: (event: BeanInventoryBrowserEvent) => {
      Object.assign(state, projectBeanInventoryBrowserEvent(state, event));
    },
    requestRender: () => {},
    scheduleApply: () => {},
    refreshBeans: () => { result.refreshBeans += 1; },
    refreshBeanUsage: () => { result.refreshUsage += 1; },
    loadBatches: async (bean) => state.batchesByBean[bean.id] ?? [],
    inventoryNeedsReview: () => false,
    markInventoryReview: () => {},
    selectBean: async (beanId, options) => {
      selections.push({ beanId, preferredBatchId: options.preferredBatchId ?? null });
    },
    nextBeanHint: (beanId) => ({ kind: 'bean', id: beanId }),
    completeBeanHint: () => {},
    toggleFavoriteBean: () => {},
    confirmArchiveBean: () => true
  };
  const inventory = {
    startBatchUpdate: (request: { patch: Partial<BeanBatch>; beanId: string }) => {
      inventoryRequests.push({ patch: request.patch });
      const current = state.batchesByBean[request.beanId] ?? [];
      const batches = current.map((item) => item.id === 'batch-1'
        ? { ...item, ...request.patch }
        : item);
      return {
        type: 'optimistic',
        projection: {
          beanId: request.beanId,
          batches,
          shouldScheduleApply: false
        },
        status: 'Batch saved',
        complete: true,
        completion: null
      };
    }
  } as unknown as BeanInventoryController;
  result.flow = new BeanInventoryBrowserFlow(
    host,
    new BeanWorkflowController(),
    inventory,
    {
      createBean: async () => { throw new Error('unused'); },
      updateBean: async () => { throw new Error('unused'); },
      invalidateBeanMutation: async () => {},
      putBeans: async () => {}
    }
  );
  return result;
}

interface MutableSnapshot extends BeanInventoryBrowserSnapshot {
  beans: Bean[];
  batchesByBean: Record<string, BeanBatch[]>;
  selectedBeanId: string | null;
  selectedBatchId: string | null;
  favoriteBeans: string[];
  beanUsageAt: Record<string, number>;
  formNumbers: Record<string, string>;
  search: string;
  secondTapHint: BeanInventoryBrowserSnapshot['secondTapHint'];
  busy: boolean;
  demo: boolean;
  modal: BeanInventoryBrowserSnapshot['modal'];
  inventoryJournalReady: boolean;
  status: string;
}

function batch(id: string, beanId: string, remaining: number): BeanBatch {
  return { id, beanId, weight: 250, weightRemaining: remaining };
}

async function run(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

function equal<Value>(actual: Value, expected: Value): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  }
}
