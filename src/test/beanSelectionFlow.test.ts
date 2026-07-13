import type { Bean, BeanBatch, RecipeDraft, ShotRecord } from '../api/types';
import type { LatestInventoryProjection } from '../controllers/beanInventoryController';
import {
  BeanSelectionFlow,
  type BeanSelectionEvent,
  type BeanSelectionSnapshot
} from '../controllers/beanSelectionFlow';
import { BeanWorkflowController } from '../controllers/beanWorkflowController';

async function main(): Promise<void> {
await run('bean selection flow delegates token ownership and commits selection in order', async () => {
  const harness = new SelectionHarness();
  harness.onWrite = () => harness.order.push('write');
  harness.onCancel = () => harness.order.push('cancel');
  harness.onRemember = () => harness.order.push('remember');
  harness.onApply = () => harness.order.push('apply');

  const outcome = await harness.flow.select('bean-1', {
    apply: true,
    preferWorkflow: false
  });

  equal(outcome.type, 'selected');
  equal(harness.writtenBeanId, 'bean-1');
  equal(harness.selected()?.state.status, '0 shots loaded');
  equal(harness.state.busy, false);
  equal(harness.order.join(','), 'write,cancel,started,selected,remember,apply');
});

await run('bean selection flow rejects a superseded read through the workflow token', async () => {
  const harness = new SelectionHarness([coffee('bean-1'), coffee('bean-2', 'Filter')]);
  const firstBatches = deferred<BeanBatch[]>();
  const shotBeans: string[] = [];
  harness.loadBatches = async (bean, _allowWrites, resolveRevision) => {
    resolveRevision(0);
    return bean.id === 'bean-1' ? firstBatches.promise : [];
  };
  harness.loadFirstShots = async (bean) => {
    shotBeans.push(bean.id);
    return { records: [], total: 0 };
  };

  const first = harness.flow.select('bean-1', { apply: false, preferWorkflow: false });
  const second = harness.flow.select('bean-2', { apply: false, preferWorkflow: false });
  await second;
  firstBatches.resolve([bag('old', 'bean-1', '2026-05-01')]);
  const stale = await first;

  equal(stale.type, 'ignored');
  equal(stale.type === 'ignored' ? stale.reason : null, 'superseded');
  equal(shotBeans.join(','), 'bean-2');
  equal(harness.state.selectedBeanId, 'bean-2');
});

await run('bean selection flow reloads shots when inventory changes the effective bag', async () => {
  const harness = new SelectionHarness();
  const oldBag = bag('old', 'bean-1', '2026-05-01', { weightRemaining: 100 });
  const newBag = bag('new', 'bean-1', '2026-06-01', { weightRemaining: 100 });
  harness.batches.set('bean-1', [oldBag]);
  const oldShots = deferred<{ records: ShotRecord[]; total: number }>();
  const shotBatches: Array<string | null> = [];
  harness.loadFirstShots = async (_bean, selected) => {
    shotBatches.push(selected?.id ?? null);
    if (selected?.id === oldBag.id) return oldShots.promise;
    return { records: [shot('new-shot', newBag.id)], total: 1 };
  };

  const selecting = harness.flow.select('bean-1', { apply: false, preferWorkflow: false });
  harness.batches.set('bean-1', [{ ...oldBag, weightRemaining: 3 }, newBag]);
  harness.cacheRevisions.set('bean-1', 1);
  harness.projections.set('bean-1', {
    revision: 1,
    selectionRevision: 1,
    projection: {
      beanId: 'bean-1',
      batches: harness.batches.get('bean-1')!,
      selectedBatchId: null,
      shouldScheduleApply: false
    }
  });
  oldShots.resolve({ records: [shot('old-shot', oldBag.id)], total: 1 });
  await selecting;

  equal(shotBatches.join(','), 'old,new');
  equal(harness.selected()?.state.shots[0]?.id, 'new-shot');
  equal(harness.selected()?.state.selectedBatchId, null);
  equal(harness.remembered.at(-1)?.selectedBatchId, null);
});

await run('bean selection flow keeps offline selection read-only', async () => {
  const harness = new SelectionHarness();
  harness.state.connected = false;
  harness.state.inventoryJournalReady = true;

  await harness.flow.select('bean-1', { apply: true, preferWorkflow: false });

  equal(harness.writtenBeanId, null);
  equal(harness.maintenancePermissions.join(','), 'false');
  equal(harness.applyCount, 0);
  equal(
    harness.selected()?.state.status,
    'Coffee selected; recipe is read-only until live data reconnects'
  );
});

await run('bean selection flow releases busy state when runtime authority changes', async () => {
  const harness = new SelectionHarness();
  const shots = deferred<{ records: ShotRecord[]; total: number }>();
  harness.loadFirstShots = async () => shots.promise;

  const selecting = harness.flow.select('bean-1', { apply: true, preferWorkflow: false });
  harness.state.authorityRevision += 1;
  shots.resolve({ records: [], total: 0 });
  const outcome = await selecting;

  equal(outcome.type, 'ignored');
  equal(outcome.type === 'ignored' ? outcome.reason : null, 'runtime-replaced');
  equal(harness.events.at(-1)?.type, 'released');
  equal(harness.state.busy, false);
  equal(harness.applyCount, 0);
});
}

type MutableSnapshot = {
  -readonly [Key in keyof BeanSelectionSnapshot]: BeanSelectionSnapshot[Key];
};

class SelectionHarness {
  readonly state: MutableSnapshot;
  readonly flow: BeanSelectionFlow;
  readonly events: BeanSelectionEvent[] = [];
  readonly order: string[] = [];
  readonly batches = new Map<string, BeanBatch[]>();
  readonly cacheRevisions = new Map<string, number>();
  readonly projections = new Map<string, LatestInventoryProjection>();
  readonly remembered: Array<{ beanId: string; selectedBatchId: string | null }> = [];
  readonly maintenancePermissions: boolean[] = [];
  writtenBeanId: string | null = null;
  applyCount = 0;
  onWrite = () => {};
  onCancel = () => {};
  onRemember = () => {};
  onApply = () => {};

  loadBatches = async (
    bean: Bean,
    allowMaintenanceWrites: boolean,
    resolveRevision: (revision: number) => void
  ): Promise<BeanBatch[]> => {
    this.maintenancePermissions.push(allowMaintenanceWrites);
    resolveRevision(this.cacheRevisions.get(bean.id) ?? 0);
    return this.batches.get(bean.id) ?? [];
  };

  loadFirstShots = async (
    _bean: Bean,
    _batch: BeanBatch | null
  ): Promise<{ records: ShotRecord[]; total: number }> => ({ records: [], total: 0 });

  constructor(beans: Bean[] = [coffee('bean-1')]) {
    this.state = {
      beans,
      workflow: null,
      profiles: [],
      grinders: [],
      draft: fallbackDraft(),
      selectedBeanId: null,
      busy: false,
      demo: false,
      connected: true,
      inventoryJournalReady: true,
      disposed: false,
      authorityRevision: 0,
      provenanceRevision: 0
    };
    const workflow = new BeanWorkflowController();
    this.flow = new BeanSelectionFlow(
      {
        workflow,
        inventory: {
          cacheRevision: (beanId) => this.cacheRevisions.get(beanId) ?? 0,
          latestProjection: (beanId) => this.projections.get(beanId) ?? null,
          rememberSelectionProjection: (beanId, _batches, selectedBatchId) => {
            this.remembered.push({ beanId, selectedBatchId });
            this.onRemember();
          }
        },
        writeLastBeanId: (beanId) => {
          this.writtenBeanId = beanId;
          this.onWrite();
        },
        cancelRecipeApply: () => this.onCancel(),
        loadBatches: (bean, allowWrites, resolveRevision) =>
          this.loadBatches(bean, allowWrites, resolveRevision),
        loadFirstShots: (bean, selectedBatch) => this.loadFirstShots(bean, selectedBatch),
        workflowMatchesBean: () => false,
        applyDraft: async () => {
          this.applyCount += 1;
          this.onApply();
        }
      },
      {
        snapshot: () => this.state,
        commit: (event) => {
          this.events.push(event);
          this.order.push(event.type);
          if (event.type === 'started') {
            this.state.selectedBeanId = event.state.selectedBeanId;
            this.state.busy = true;
          } else if (event.type === 'released') {
            this.state.busy = false;
          } else {
            this.state.busy = false;
            this.state.draft = event.state.draft;
          }
        }
      }
    );
  }

  selected(): Extract<BeanSelectionEvent, { type: 'selected' }> | undefined {
    return [...this.events].reverse().find(
      (event): event is Extract<BeanSelectionEvent, { type: 'selected' }> =>
        event.type === 'selected'
    );
  }
}

function coffee(id: string, name = 'Espresso'): Bean {
  return { id, roaster: 'Test Roaster', name };
}

function bag(
  id: string,
  beanId: string,
  roastDate: string,
  extra: Partial<BeanBatch> = {}
): BeanBatch {
  return { id, beanId, roastDate, ...extra };
}

function shot(id: string, batchId: string): ShotRecord {
  return {
    id,
    timestamp: '2026-07-13T10:00:00.000Z',
    workflow: {
      profile: { title: 'Test profile' },
      context: {
        coffeeName: 'Espresso',
        coffeeRoaster: 'Test Roaster',
        beanBatchId: batchId,
        targetDoseWeight: 18,
        targetYield: 40
      }
    },
    annotations: null,
    metadata: null,
    measurements: []
  };
}

function fallbackDraft(): RecipeDraft {
  return { dose: 18, yield: 40, grinderSetting: null, profileTitle: 'Fallback' };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function run(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve(fn()).then(() => console.log(`ok - ${name}`));
}

function equal<T>(actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(`Expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`);
  }
}

await main();
