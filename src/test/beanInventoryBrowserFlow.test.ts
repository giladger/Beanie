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

// Adding a coffee ends in a render that removes the create form, and the blur
// that removal fires re-offers the same filled form. Acting on that volunteered
// commit added the coffee and its bag a second time.
await run('browser adds a coffee only for its own submit, never a volunteered commit', async () => {
  const harness = createHarness();
  const submission = {
    type: 'bean' as const,
    editingId: null,
    prefillBeanId: null,
    fields: { roaster: 'Friedhats', name: 'Kilimbi' },
    firstStock: {
      roastDate: '2026-08-08',
      roastLevel: null,
      weight: { present: true, value: 250 },
      weightRemaining: { present: true, value: 250 }
    }
  };

  await harness.flow.submit(submission, { autosave: true });
  equal(harness.beanCreates.length, 0);
  equal(harness.batchCreates.length, 0);

  await harness.flow.submit(submission);
  equal(harness.beanCreates.length, 1);
  equal(harness.batchCreates.length, 1);

  // The same blur arriving after the save must not add the coffee again.
  await harness.flow.submit(submission, { autosave: true });
  equal(harness.beanCreates.length, 1);
  equal(harness.batchCreates.length, 1);
});

await run('browser still saves an edited coffee from a volunteered commit', async () => {
  const harness = createHarness();
  await harness.flow.submit({
    type: 'bean',
    editingId: 'bean-1',
    prefillBeanId: null,
    fields: { roaster: 'Friedhats', name: 'Purple Rain', notes: 'Blackcurrant' },
    firstStock: {
      roastDate: null,
      roastLevel: null,
      weight: { present: false, value: null },
      weightRemaining: { present: false, value: null }
    }
  }, { autosave: true });

  equal(harness.beanUpdates.length, 1);
  equal(harness.beanUpdates[0]?.id, 'bean-1');
  equal(harness.state.beans[0]?.notes, 'Blackcurrant');
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
  beanCreates: Array<Partial<Bean>>;
  beanUpdates: Array<{ id: string; fields: Partial<Bean> }>;
  batchCreates: Array<{ beanId: string }>;
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
  const beanCreates: Array<Partial<Bean>> = [];
  const beanUpdates: Array<{ id: string; fields: Partial<Bean> }> = [];
  const batchCreates: Array<{ beanId: string }> = [];
  const result = {
    state,
    flow: null as unknown as BeanInventoryBrowserFlow,
    inventoryRequests,
    selections,
    beanCreates,
    beanUpdates,
    batchCreates,
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
    createBatch: async (request: { beanId: string; batch: Partial<BeanBatch> }) => {
      batchCreates.push({ beanId: request.beanId });
      const created = {
        ...request.batch,
        id: `batch-new-${batchCreates.length}`,
        beanId: request.beanId
      } as BeanBatch;
      return {
        type: 'created',
        batch: created,
        projection: {
          beanId: request.beanId,
          batches: [...(state.batchesByBean[request.beanId] ?? []), created],
          selectedBatchId: created.id,
          shouldScheduleApply: false
        },
        recovered: false,
        status: 'Stock added'
      };
    },
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
      createBean: async (fields) => {
        beanCreates.push(fields);
        return { id: `bean-new-${beanCreates.length}`, ...fields } as Bean;
      },
      updateBean: async (id, fields) => {
        beanUpdates.push({ id, fields });
        const existing = state.beans.find((bean) => bean.id === id);
        return { ...(existing ?? { id }), ...fields } as Bean;
      },
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
