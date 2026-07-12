import type { Bean, BeanBatch, Grinder, ShotRecord, Workflow } from '../api/types';
import {
  BeanWorkflowController,
  beanIdForContext,
  beanUsageFromShots
} from '../controllers/beanWorkflowController';

await run('bean workflow controller begins selection with loading state', () => {
  const controller = new BeanWorkflowController();
  let persisted: string | null = null;
  const selection = controller.beginBeanSelection('bean-1', [bean('bean-1')], {
    writeLastBeanId: (beanId) => {
      persisted = beanId;
    }
  });

  equal(selection?.requestId, 1);
  equal(selection?.bean.id, 'bean-1');
  equal(selection?.state.selectedBeanId, 'bean-1');
  equal(selection?.state.busy, true);
  equal(selection?.state.status, 'Loading Test Roaster Espresso');
  equal(persisted, 'bean-1');
});

await run('bean workflow controller ignores stale selection after batches load', async () => {
  const controller = new BeanWorkflowController();
  const first = controller.beginBeanSelection('bean-1', [bean('bean-1'), bean('bean-2')]);
  controller.beginBeanSelection('bean-2', [bean('bean-1'), bean('bean-2')]);
  let loadedShots = false;

  const result = await controller.completeBeanSelection({
    selection: required(first),
    options: { preferWorkflow: false },
    beans: [bean('bean-1'), bean('bean-2')],
    workflow: null,
    profiles: [],
    grinders: [],
    loadBatches: async () => [batch('batch-1', 'bean-1', '2026-06-01')],
    loadFirstShots: async () => {
      loadedShots = true;
      return { records: [], total: 0 };
    },
    isCurrent: (selection) => controller.isCurrentBeanSelection(selection),
    workflowMatchesBean: () => false
  });

  equal(result.type, 'stale');
  equal(loadedShots, false);
});

await run('bean workflow controller completes selection with latest batch, shots, usage, and draft', async () => {
  const selectedBean = bean('bean-1');
  const controller = new BeanWorkflowController();
  const selection = required(controller.beginBeanSelection(selectedBean.id, [selectedBean]));
  const older = batch('older', selectedBean.id, '2026-05-01');
  const latest = batch('latest', selectedBean.id, '2026-06-01');
  const selectedShot = shot('shot-1', '2026-06-07T10:00:00.000Z', selectedBean);

  const result = await controller.completeBeanSelection({
    selection,
    options: { preferWorkflow: false },
    beans: [selectedBean],
    workflow: null,
    profiles: [],
    grinders: [],
    loadBatches: async () => [older, latest],
    loadFirstShots: async (_bean, selectedBatch) => {
      equal(selectedBatch?.id, latest.id);
      return { records: [selectedShot], total: 4 };
    },
    isCurrent: (current) => controller.isCurrentBeanSelection(current),
    workflowMatchesBean: () => false
  });

  equal(result.type, 'selected');
  equal(result.type === 'selected' ? result.selectedBatch?.id : null, 'latest');
  equal(result.type === 'selected' ? result.shotsTotal : null, 4);
  equal(result.type === 'selected' ? result.beanUsageAt[selectedBean.id] : null, Date.parse(selectedShot.timestamp));
  equal(result.type === 'selected' ? result.draft.dose : null, 18);
  equal(result.type === 'selected' ? result.draft.yield : null, 42);
  equal(result.type === 'selected' ? result.status : null, '1 shots loaded');
});

await run('bean workflow controller can select a preferred batch', async () => {
  const selectedBean = bean('bean-1');
  const controller = new BeanWorkflowController();
  const selection = required(controller.beginBeanSelection(selectedBean.id, [selectedBean]));
  const older = batch('older', selectedBean.id, '2026-05-01', { weightRemaining: 100 });
  const latest = batch('latest', selectedBean.id, '2026-06-01', { weightRemaining: 100 });

  const result = await controller.completeBeanSelection({
    selection,
    options: { preferWorkflow: false, preferredBatchId: older.id },
    beans: [selectedBean],
    workflow: null,
    profiles: [],
    grinders: [],
    loadBatches: async () => [older, latest],
    loadFirstShots: async (_bean, selectedBatch) => {
      equal(selectedBatch?.id, older.id);
      return { records: [], total: 0 };
    },
    isCurrent: (current) => controller.isCurrentBeanSelection(current),
    workflowMatchesBean: () => false
  });

  equal(result.type === 'selected' ? result.selectedBatch?.id : null, older.id);
});

await run('bean workflow controller skips nearly empty latest batches', async () => {
  const selectedBean = bean('bean-1');
  const controller = new BeanWorkflowController();
  const selection = required(controller.beginBeanSelection(selectedBean.id, [selectedBean]));
  const usable = batch('usable', selectedBean.id, '2026-05-01', { weightRemaining: 100 });
  const emptyLatest = batch('empty-latest', selectedBean.id, '2026-06-01', { weightRemaining: 3 });

  const result = await controller.completeBeanSelection({
    selection,
    options: { preferWorkflow: false },
    beans: [selectedBean],
    workflow: null,
    profiles: [],
    grinders: [],
    loadBatches: async () => [usable, emptyLatest],
    loadFirstShots: async (_bean, selectedBatch) => {
      equal(selectedBatch?.id, usable.id);
      return { records: [], total: 0 };
    },
    isCurrent: (current) => controller.isCurrentBeanSelection(current),
    workflowMatchesBean: () => false
  });

  equal(result.type === 'selected' ? result.selectedBatch?.id : null, usable.id);
});

await run('bean workflow controller skips service shots when deriving the recipe draft', async () => {
  const selectedBean = bean('bean-1');
  const controller = new BeanWorkflowController();
  const selection = required(controller.beginBeanSelection(selectedBean.id, [selectedBean]));
  const cleaningShot: ShotRecord = {
    ...shot('cleaning-shot', '2026-06-07T11:00:00.000Z', selectedBean),
    workflow: {
      profile: { title: 'Cleaning / forward flush x5' },
      context: {
        coffeeName: null,
        coffeeRoaster: null,
        finalBeverageType: 'cleaning',
        targetDoseWeight: 0,
        targetYield: 0
      }
    }
  };
  const realShot = shot('real-shot', '2026-06-07T10:00:00.000Z', selectedBean);

  const result = await controller.completeBeanSelection({
    selection,
    options: { preferWorkflow: false },
    beans: [selectedBean],
    workflow: null,
    profiles: [],
    grinders: [],
    loadBatches: async () => [],
    loadFirstShots: async () => ({ records: [cleaningShot, realShot], total: 2 }),
    isCurrent: (current) => controller.isCurrentBeanSelection(current),
    workflowMatchesBean: () => false
  });

  equal(result.type, 'selected');
  equal(result.type === 'selected' ? result.draft.dose : null, 18);
  equal(result.type === 'selected' ? result.draft.yield : null, 42);
  equal(result.type === 'selected' ? result.draft.profileTitle : null, 'Shot Profile');
});

await run('bean workflow controller prefers matching workflow when requested', async () => {
  const selectedBean = bean('bean-1');
  const controller = new BeanWorkflowController();
  const selection = required(controller.beginBeanSelection(selectedBean.id, [selectedBean]));
  const workflow: Workflow = {
    profile: { title: 'Workflow Profile' },
    context: {
      coffeeName: selectedBean.name,
      coffeeRoaster: selectedBean.roaster,
      targetDoseWeight: 19,
      targetYield: 38
    }
  };

  const result = await controller.completeBeanSelection({
    selection,
    options: { preferWorkflow: true },
    beans: [selectedBean],
    workflow,
    profiles: [],
    grinders: [],
    loadBatches: async () => [],
    loadFirstShots: async () => ({ records: [shot('shot-1', '2026-06-07T10:00:00.000Z', selectedBean)], total: 1 }),
    isCurrent: (current) => controller.isCurrentBeanSelection(current),
    workflowMatchesBean: () => true
  });

  equal(result.type, 'selected');
  equal(result.type === 'selected' ? result.draft.dose : null, 19);
  equal(result.type === 'selected' ? result.draft.yield : null, 38);
  equal(result.type === 'selected' ? result.draft.profileTitle : null, 'Workflow Profile');
});

await run('bean workflow controller keeps fallback recipe for beans without shots', async () => {
  const selectedBean = bean('bean-empty');
  const controller = new BeanWorkflowController();
  const selection = required(controller.beginBeanSelection(selectedBean.id, [selectedBean]));

  const result = await controller.completeBeanSelection({
    selection,
    options: { preferWorkflow: false },
    beans: [selectedBean],
    workflow: null,
    profiles: [],
    grinders: [],
    fallbackDraft: {
      dose: 19,
      yield: 41,
      grinderSetting: '7',
      brewTemp: 92,
      profileTitle: 'Previous shot'
    },
    loadBatches: async () => [],
    loadFirstShots: async () => ({ records: [], total: 0 }),
    isCurrent: (current) => controller.isCurrentBeanSelection(current),
    workflowMatchesBean: () => false
  });

  equal(result.type, 'selected');
  equal(result.type === 'selected' ? result.draft.dose : null, 19);
  equal(result.type === 'selected' ? result.draft.yield : null, 41);
  equal(result.type === 'selected' ? result.draft.grinderSetting : null, '7');
  equal(result.type === 'selected' ? result.status : null, '0 shots loaded');
});

await run('bean usage helpers match shot context to known beans', () => {
  const beans = [bean('bean-1'), bean('bean-2', 'Other')];
  const batchesByBean = { 'bean-1': [batch('batch-1', 'bean-1', '2026-06-01')] };
  const usage = beanUsageFromShots(beans, [
    shot('shot-1', '2026-06-07T10:00:00.000Z', beans[0]!, 'batch-1'),
    shot('shot-2', '2026-06-07T11:00:00.000Z', beans[0]!, 'batch-1'),
    shot('shot-3', 'not-a-date', beans[1]!)
  ], batchesByBean);

  equal(beanIdForContext({ beanBatchId: 'batch-1' }, beans, batchesByBean), 'bean-1');
  equal(beanIdForContext({ coffeeName: beans[0]!.name, coffeeRoaster: beans[0]!.roaster }, beans), null);
  equal(usage['bean-1'], Date.parse('2026-06-07T11:00:00.000Z'));
  equal(usage['bean-2'], undefined);
});

await run('bean workflow controller saves demo beans without gateway calls', async () => {
  const controller = new BeanWorkflowController();
  const result = await controller.saveBean(
    {
      beans: [bean('bean-1')],
      batchesByBean: {},
      editingId: null,
      fields: { roaster: 'New Roaster', name: 'New Bean' },
      demo: true,
      nowMs: 123
    },
    failingBeanDeps()
  );

  equal(result.type, 'saved');
  equal(result.type === 'saved' ? result.bean.id : null, 'demo-123');
  equal(result.type === 'saved' ? result.bean.createdAt : null, '1970-01-01T00:00:00.123Z');
  equal(result.type === 'saved' ? result.beans.length : null, 2);
  equal(result.type === 'saved' ? result.batchesByBean['demo-123']?.length : null, 0);
  equal(result.type === 'saved' ? result.selectBeanId : null, 'demo-123');
  equal(result.type === 'saved' ? result.status : null, 'Bean added (demo)');
});

await run('bean workflow controller saves remote beans and writes cache', async () => {
  const controller = new BeanWorkflowController();
  let cachedBeans = 0;
  let cachedBatchesFor: string | null = null;
  const result = await controller.saveBean(
    {
      beans: [bean('bean-1')],
      batchesByBean: {},
      editingId: null,
      fields: { roaster: 'New Roaster', name: 'New Bean' },
      demo: false,
      nowMs: 123
    },
    {
      createBean: async (fields) => ({ id: 'remote-new', ...fields } as Bean),
      updateBean: async () => {
        throw new Error('unexpected update');
      },
      putBeans: async (beans) => {
        cachedBeans = beans.length;
      },
      putBeanBatches: async (beanId) => {
        cachedBatchesFor = beanId;
      }
    }
  );

  equal(result.type, 'saved');
  equal(result.type === 'saved' ? result.bean.id : null, 'remote-new');
  equal(result.type === 'saved' ? result.bean.createdAt : null, '1970-01-01T00:00:00.123Z');
  equal(cachedBeans, 2);
  equal(cachedBatchesFor, 'remote-new');
  equal(result.type === 'saved' ? result.status : null, 'Bean added');
});

await run('bean workflow controller reports remote save failures without changing beans', async () => {
  const controller = new BeanWorkflowController();
  const result = await controller.saveBean(
    {
      beans: [bean('bean-1')],
      batchesByBean: {},
      editingId: 'bean-1',
      fields: { name: 'Updated' },
      demo: false,
      nowMs: 123
    },
    {
      createBean: async () => {
        throw new Error('unexpected create');
      },
      updateBean: async () => {
        throw new Error('nope');
      },
      putBeans: async () => {},
      putBeanBatches: async () => {}
    }
  );

  equal(result.type, 'failed');
  equal(result.type === 'failed' ? result.status : null, 'Save bean failed');
});

await run('bean workflow controller archives selected bean and selects the next one', async () => {
  const controller = new BeanWorkflowController();
  let invalidated: string | null = null;
  let cachedBeans = 0;
  const result = await controller.archiveBean(
    {
      beans: [bean('bean-1'), bean('bean-2')],
      id: 'bean-1',
      selectedBeanId: 'bean-1',
      demo: false
    },
    {
      updateBean: async (id, fields) => ({ ...bean(id), ...fields }),
      invalidateBeanMutation: async (beanId) => {
        invalidated = beanId;
      },
      putBeans: async (beans) => {
        cachedBeans = beans.length;
      }
    }
  );

  equal(result.type, 'archived');
  equal(result.type === 'archived' ? result.beans.length : null, 1);
  equal(result.type === 'archived' ? result.nextSelectedBeanId : null, 'bean-2');
  equal(result.type === 'archived' ? result.archivedSelectedBean : null, true);
  equal(invalidated, 'bean-1');
  equal(cachedBeans, 1);
});

await run('bean workflow controller saves demo grinders without gateway calls', async () => {
  const controller = new BeanWorkflowController();
  const result = await controller.saveGrinder(
    {
      grinders: [],
      editingId: null,
      grinderInput: { model: 'Demo Grinder' },
      demo: true,
      nowMs: 789
    },
    failingGrinderDeps()
  );

  equal(result.type, 'saved');
  equal(result.type === 'saved' ? result.grinder.id : null, 'demo-grinder-789');
  equal(result.type === 'saved' ? result.grinders.length : null, 1);
  equal(result.type === 'saved' ? result.status : null, 'Grinder added (demo)');
});

await run('bean workflow controller saves remote grinders and writes cache', async () => {
  const controller = new BeanWorkflowController();
  let cachedCount = 0;
  const result = await controller.saveGrinder(
    {
      grinders: [{ id: 'grinder-1', model: 'Old' }],
      editingId: 'grinder-1',
      grinderInput: { model: 'New' },
      demo: false,
      nowMs: 789
    },
    {
      createGrinder: async () => {
        throw new Error('unexpected create');
      },
      updateGrinder: async (id, input) => ({ id, ...input } as Grinder),
      putGrinders: async (grinders) => {
        cachedCount = grinders.length;
      }
    }
  );

  equal(result.type, 'saved');
  equal(result.type === 'saved' ? result.grinder.model : null, 'New');
  equal(result.type === 'saved' ? result.status : null, 'Grinder saved');
  equal(cachedCount, 1);
});

await run('bean workflow controller reports grinder save failures', async () => {
  const controller = new BeanWorkflowController();
  const result = await controller.saveGrinder(
    {
      grinders: [],
      editingId: null,
      grinderInput: { model: 'New' },
      demo: false,
      nowMs: 789
    },
    {
      createGrinder: async () => {
        throw new Error('nope');
      },
      updateGrinder: async () => {
        throw new Error('unexpected update');
      },
      putGrinders: async () => {}
    }
  );

  equal(result.type, 'failed');
  equal(result.type === 'failed' ? result.status : null, 'Save grinder failed');
});

function bean(id: string, name = 'Espresso'): Bean {
  return {
    id,
    roaster: 'Test Roaster',
    name
  };
}

function batch(id: string, beanId: string, roastDate: string, extra: Partial<BeanBatch> = {}): BeanBatch {
  return {
    id,
    beanId,
    roastDate,
    ...extra
  };
}

function shot(id: string, timestamp: string, owner: Bean, beanBatchId: string | null = null): ShotRecord {
  return {
    id,
    timestamp,
    workflow: {
      profile: { title: 'Shot Profile' },
      context: {
        coffeeName: owner.name,
        coffeeRoaster: owner.roaster,
        beanBatchId,
        targetDoseWeight: 18,
        targetYield: 42
      }
    },
    annotations: null,
    metadata: null,
    measurements: []
  };
}

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('Expected value');
  return value;
}

function failingBeanDeps() {
  return {
    createBean: async () => {
      throw new Error('unexpected create');
    },
    updateBean: async () => {
      throw new Error('unexpected update');
    },
    putBeans: async () => {
      throw new Error('unexpected cache write');
    },
    putBeanBatches: async () => {
      throw new Error('unexpected batch cache write');
    }
  };
}

function failingGrinderDeps() {
  return {
    createGrinder: async () => {
      throw new Error('unexpected create');
    },
    updateGrinder: async () => {
      throw new Error('unexpected update');
    },
    putGrinders: async () => {
      throw new Error('unexpected grinder cache write');
    }
  };
}

function run(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`ok - ${name}`);
    })
    .catch((error) => {
      console.error(`not ok - ${name}`);
      throw error;
    });
}

function equal<T>(actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(`Expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`);
  }
}
