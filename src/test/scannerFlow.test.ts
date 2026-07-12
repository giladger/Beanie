import type { Bean, BeanBatch } from '../api/types';
import type {
  CreateBatchOutcome,
  CreateBatchRequest
} from '../controllers/beanInventoryController';
import { BeanWorkflowController } from '../controllers/beanWorkflowController';
import { ScannerFlow, type ScannerFlowHost } from '../controllers/scannerFlow';
import type {
  LabelScannerState,
  ScannerFlowState,
  ScannerFlowStatePatch
} from '../controllers/scannerFlowContract';
import type { ImageTranscoder } from '../platform/imageTranscoder';

class TestForm {
  constructor(readonly values: Readonly<Record<string, string>>) {}
}

class TestFormData {
  private readonly values: Readonly<Record<string, string>>;

  constructor(form?: HTMLFormElement) {
    this.values = (form as unknown as TestForm | undefined)?.values ?? {};
  }

  get(name: string): FormDataEntryValue | null {
    return Object.prototype.hasOwnProperty.call(this.values, name) ? this.values[name]! : null;
  }

  has(name: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.values, name);
  }
}

async function main(): Promise<void> {
  const originalFormData = globalThis.FormData;
  (globalThis as unknown as { FormData: typeof FormData }).FormData = TestFormData as unknown as typeof FormData;
  await run('scanner save preserves inventory updates and the active coffee while batch creation is pending', async () => {
    const harness = createHarness();
    const saving = harness.flow.submitScannerReview(form());
    await flushAsync();

    const concurrent = batch('other-new', 'other', 72);
    harness.host.current.beans = [
      ...harness.host.current.beans,
      { id: 'late-bean', roaster: 'Late', name: 'Arrival' }
    ];
    harness.host.current.batchesByBean = {
      ...harness.host.current.batchesByBean,
      other: [concurrent]
    };

    const created = batch('created', 'target', 250);
    harness.creation.resolve({
      type: 'created',
      batch: created,
      recovered: false,
      projection: {
        beanId: 'target',
        batches: [created, batch('target-old', 'target', 100)],
        selectedBatchId: created.id,
        shouldScheduleApply: true
      },
      status: 'Batch added'
    });
    await saving;

    equal(harness.host.current.batchesByBean.other?.[0]?.id, concurrent.id);
    equal(harness.host.current.batchesByBean.target?.[0]?.id, created.id);
    equal(harness.host.current.beans.some((bean) => bean.id === 'late-bean'), true);
    equal(harness.host.current.selectedBeanId, 'other');
    equal(harness.host.current.selectedBatchId, 'other-old');
    equal(harness.host.current.status, 'Added a bag for Test Coffee — select it to brew');
    deepEqual(harness.host.selections, []);
  });

  await run('scanner save adds a new bean without silently making it active', async () => {
    const target: Bean = { id: 'target', roaster: 'New', name: 'Coffee' };
    const other: Bean = { id: 'other', roaster: 'Other', name: 'Coffee' };
    const host = new HostHarness({
      demo: false,
      scanner: scannerState(null),
      beans: [other],
      batchesByBean: { other: [batch('other-old', 'other', 100)] },
      selectedBeanId: 'other',
      selectedBatchId: 'other-old',
      modal: 'label-scanner',
      status: ''
    });
    const created = batch('created', 'target', 250);
    const flow = new ScannerFlow(
      host,
      {
        saveBean: async () => ({
          type: 'saved',
          bean: target,
          beans: [target, other],
          batchesByBean: { other: [batch('other-old', 'other', 100)], target: [] },
          editing: false,
          selectBeanId: target.id,
          status: 'Bean added'
        })
      },
      {
        createBatch: async () => ({
          type: 'created',
          batch: created,
          recovered: false,
          projection: {
            beanId: target.id,
            batches: [created],
            shouldScheduleApply: false
          },
          status: 'Batch added'
        })
      },
      unusedTranscoder
    );

    await flow.submitScannerReview(new TestForm({
      roaster: target.roaster,
      name: target.name,
      roastDate: '2026-07-01',
      roastLevel: 'medium',
      weight: '250'
    }) as unknown as HTMLFormElement);

    equal(host.current.beans[0]?.id, target.id);
    equal(host.current.batchesByBean.target?.[0]?.id, created.id);
    equal(host.current.selectedBeanId, other.id);
    equal(host.current.selectedBatchId, 'other-old');
    equal(host.current.status, 'Added New Coffee — select it to brew');
    deepEqual(host.selections, []);
  });

  await run('scanner batch failure does not restore its stale inventory snapshot', async () => {
    const harness = createHarness();
    const saving = harness.flow.submitScannerReview(form());
    await flushAsync();

    const concurrent = batch('other-new', 'other', 64);
    harness.host.current.batchesByBean = {
      ...harness.host.current.batchesByBean,
      other: [concurrent]
    };

    const previousConsoleError = console.error;
    console.error = () => {};
    try {
      harness.creation.resolve({
        type: 'failed',
        reason: 'gateway',
        status: 'Add batch failed',
        error: new Error('offline')
      });
      await saving;
    } finally {
      console.error = previousConsoleError;
    }

    equal(harness.host.current.batchesByBean.other?.[0]?.id, concurrent.id);
    equal(harness.host.current.scanner?.step, 'error');
    equal(harness.host.current.scanner?.saving, false);
    equal(harness.host.selections.length, 0);
  });

  await run('scanner keeps an uncertain create recoverable instead of closing review', async () => {
    const harness = createHarness();
    const saving = harness.flow.submitScannerReview(form());
    await flushAsync();
    const candidate = batch('candidate', 'target', 250);
    const previousConsoleError = console.error;
    console.error = () => {};
    try {
      harness.creation.resolve({
        type: 'reconciliation-required',
        phase: 'create',
        candidates: [candidate],
        projection: {
          beanId: 'target',
          batches: [candidate, batch('target-old', 'target', 100)],
          shouldScheduleApply: false
        },
        status: 'Stock may have been added - review stock',
        error: new Error('response lost')
      });
      await saving;
    } finally {
      console.error = previousConsoleError;
    }

    equal(harness.host.current.scanner?.step, 'review');
    equal(harness.host.current.modal, 'label-scanner');
    equal(harness.host.current.batchesByBean.target?.[0]?.id, candidate.id);
    equal(harness.host.inventoryReviews.get('target'), true);
    equal(harness.host.selections.length, 0);
  });

  await run('scanner retries an uncertain create with the exact normalized submitted intent', async () => {
    const target: Bean = { id: 'target', roaster: 'Test', name: 'Coffee' };
    const host = new HostHarness({
      demo: false,
      scanner: scannerState('target'),
      beans: [target],
      batchesByBean: { target: [batch('target-old', 'target', 100)] },
      selectedBeanId: null,
      selectedBatchId: null,
      modal: 'label-scanner',
      status: ''
    });
    const requests: CreateBatchRequest[] = [];
    const candidate = batch('candidate', 'target', 250.5);
    const inventory = {
      async createBatch(request: CreateBatchRequest): Promise<CreateBatchOutcome> {
        requests.push(request);
        if (requests.length === 1) {
          return {
            type: 'reconciliation-required',
            phase: 'create',
            candidates: [candidate],
            projection: {
              beanId: 'target',
              batches: [candidate, batch('target-old', 'target', 100)],
              shouldScheduleApply: false
            },
            status: 'Stock may have been added - review stock',
            error: new Error('response lost')
          };
        }
        return {
          type: 'created',
          batch: candidate,
          recovered: true,
          projection: {
            beanId: 'target',
            batches: [candidate, batch('target-old', 'target', 100)],
            selectedBatchId: candidate.id,
            shouldScheduleApply: true
          },
          status: 'Batch added'
        };
      }
    };
    const flow = new ScannerFlow(host, new BeanWorkflowController(), inventory, unusedTranscoder);
    const submitted = new TestForm({
      roaster: '  Test  ',
      name: ' Coffee ',
      country: ' Ethiopia ',
      region: ' Guji ',
      processing: ' Washed ',
      notes: ' Peach and tea ',
      roastDate: ' 2026-07-01 ',
      roastLevel: ' ultra light ',
      weight: '250.50'
    }) as unknown as HTMLFormElement;
    const previousConsoleError = console.error;
    console.error = () => {};
    try {
      await flow.submitScannerReview(submitted);
    } finally {
      console.error = previousConsoleError;
    }

    const retryDraft = host.current.scanner?.draft;
    deepEqual(retryDraft, {
      roaster: 'Test',
      name: 'Coffee',
      country: 'Ethiopia',
      region: 'Guji',
      processing: 'Washed',
      notes: 'Peach and tea',
      roastDate: '2026-07-01',
      roastLevel: 'ultra light',
      weight: '250.5'
    });
    equal(host.current.scanner?.step, 'review');
    equal(host.current.scanner?.existingBeanId, 'target');
    equal(host.current.scanner?.existingBeanLabel, 'Test Coffee');

    await flow.submitScannerReview(formFromDraft(retryDraft!));

    deepEqual(requests[0]?.batch, {
      beanId: 'target',
      roastDate: '2026-07-01',
      roastLevel: 'ultra light',
      weight: 250.5,
      weightRemaining: 250.5
    });
    deepEqual(requests[1]?.batch, requests[0]?.batch);
  });
  (globalThis as unknown as { FormData: typeof FormData }).FormData = originalFormData;
}

interface TestState extends ScannerFlowState {
  modal: 'label-scanner' | null;
  status: string;
}

interface SelectionCall {
  beanId: string;
  options: { apply: boolean; preferWorkflow: boolean; preferredBatchId?: string | null };
}

class HostHarness implements ScannerFlowHost {
  readonly selections: SelectionCall[] = [];
  readonly inventoryReviews = new Map<string, boolean>();

  constructor(readonly current: TestState) {}

  state(): ScannerFlowState {
    return this.current;
  }

  setState(next: ScannerFlowStatePatch): void {
    Object.assign(this.current, next);
  }

  async selectBean(beanId: string, options: SelectionCall['options']): Promise<void> {
    this.selections.push({ beanId, options });
  }

  markInventoryReview(beanId: string, unresolved: boolean): void {
    this.inventoryReviews.set(beanId, unresolved);
  }

  async loadSettings(): Promise<void> {}
}

function createHarness(): {
  host: HostHarness;
  flow: ScannerFlow;
  creation: Deferred<CreateBatchOutcome>;
} {
  const target: Bean = { id: 'target', roaster: 'Test', name: 'Coffee' };
  const other: Bean = { id: 'other', roaster: 'Other', name: 'Coffee' };
  const host = new HostHarness({
    demo: false,
    scanner: scannerState('target'),
    beans: [target, other],
    batchesByBean: {
      target: [batch('target-old', 'target', 100)],
      other: [batch('other-old', 'other', 100)]
    },
    selectedBeanId: 'other',
    selectedBatchId: 'other-old',
    modal: 'label-scanner',
    status: ''
  });
  const creation = deferred<CreateBatchOutcome>();
  const inventory = {
    createBatch: (_request: CreateBatchRequest) => creation.promise
  };
  return {
    host,
    creation,
    flow: new ScannerFlow(host, new BeanWorkflowController(), inventory, unusedTranscoder)
  };
}

function scannerState(existingBeanId: string | null): LabelScannerState {
  return {
    step: 'review',
    handoff: false,
    qrSvg: null,
    qrUrl: null,
    keyDraft: '',
    verifying: false,
    verifyMessage: null,
    images: [],
    scan: null,
    draft: null,
    lowConfidence: [],
    webFields: [],
    enriching: false,
    existingBeanId,
    existingBeanLabel: null,
    roasterBeanCount: 0,
    saving: false,
    error: null
  };
}

function form(): HTMLFormElement {
  return new TestForm({
    roaster: 'Test',
    name: 'Coffee',
    roastDate: '2026-07-01',
    roastLevel: 'medium',
    weight: '250'
  }) as unknown as HTMLFormElement;
}

function formFromDraft(draft: NonNullable<LabelScannerState['draft']>): HTMLFormElement {
  return new TestForm({ ...draft }) as unknown as HTMLFormElement;
}

function batch(id: string, beanId: string, weightRemaining: number): BeanBatch {
  return { id, beanId, weight: weightRemaining, weightRemaining };
}

const unusedTranscoder: ImageTranscoder = {
  async transcode() {
    return { mime: 'image/jpeg', dataUrl: '', width: 1, height: 1, pixels: 1 };
  },
  async transcodeBatch() {
    return [];
  }
};

interface Deferred<Value> {
  promise: Promise<Value>;
  resolve(value: Value): void;
}

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function equal(actual: unknown, expected: unknown): void {
  if (!Object.is(actual, expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function deepEqual(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
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

await main();
