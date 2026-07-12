import type { Bean, BeanBatch, ShotRecord, Workflow } from '../api/types';
import {
  resolveLiveShotAttribution,
  resolvePersistedShotSelection,
  shotCoffeeLabel,
  shotSelectionCompatibility
} from '../controllers/liveShotAttribution';

run('confirmed workflow batch wins over a newer mutable UI selection', () => {
  const alchemist = bean('alchemist', 'DAK', 'The Alchemist');
  const purple = bean('purple', 'DAK', 'Purple Rain');
  const alchemistBatch = batch('alchemist-batch', alchemist.id);
  const purpleBatch = batch('purple-batch', purple.id);
  const workflow: Workflow = {
    name: 'DAK The Alchemist',
    context: {
      // Reaprime commonly omits beanId from workflow responses.
      beanBatchId: alchemistBatch.id,
      coffeeRoaster: alchemist.roaster,
      coffeeName: alchemist.name
    }
  };

  const resolved = resolveLiveShotAttribution(
    workflow,
    {
      beans: [alchemist, purple],
      batchesByBean: {
        [alchemist.id]: [alchemistBatch],
        [purple.id]: [purpleBatch]
      }
    },
    { bean: purple, batch: purpleBatch }
  );

  equal(resolved.source, 'confirmed-batch');
  equal(resolved.bean?.id, alchemist.id);
  equal(resolved.batch?.id, alchemistBatch.id);
  equal(resolved.workflow, workflow);
});

run('unidentified confirmed workflow falls back without crossing bean ownership', () => {
  const purple = bean('purple', 'DAK', 'Purple Rain');
  const foreignBatch = batch('foreign-batch', 'other');
  const resolved = resolveLiveShotAttribution(
    { name: 'Legacy workflow', context: {} },
    { beans: [purple], batchesByBean: {} },
    { bean: purple, batch: foreignBatch }
  );

  equal(resolved.source, 'ui-fallback');
  equal(resolved.bean?.id, purple.id);
  equal(resolved.batch, null);
});

run('explicit but locally unloaded workflow batch fails closed instead of using UI selection', () => {
  const purple = bean('purple', 'DAK', 'Purple Rain');
  const purpleBatch = batch('purple-batch', purple.id);
  const resolved = resolveLiveShotAttribution(
    { context: { beanBatchId: 'unloaded-machine-batch' } },
    { beans: [purple], batchesByBean: { [purple.id]: [purpleBatch] } },
    { bean: purple, batch: purpleBatch }
  );

  equal(resolved.source, 'explicit-unresolved');
  equal(resolved.bean, null);
  equal(resolved.batch, null);
});

run('persisted shot selection resolves from batch identity without beanId', () => {
  const purple = bean('purple', 'DAK', 'Purple Rain');
  const purpleBatch = batch('purple-batch', purple.id);
  const resolved = resolvePersistedShotSelection(
    shot({ beanBatchId: purpleBatch.id, coffeeRoaster: 'DAK', coffeeName: 'Purple Rain' }),
    { beans: [purple], batchesByBean: { [purple.id]: [purpleBatch] } }
  );

  equal(resolved?.bean?.id, purple.id);
  equal(resolved?.batch?.id, purpleBatch.id);
});

run('shot compatibility rejects explicit batch conflicts and distinguishes weak identity', () => {
  const expected = { beanId: 'bean-1', batchId: 'batch-1' };

  equal(shotSelectionCompatibility(shot({ beanBatchId: 'batch-1' }), expected), 'batch-match');
  equal(shotSelectionCompatibility(shot({ beanBatchId: 'batch-2' }), expected), 'conflict');
  equal(shotSelectionCompatibility(shot({ beanId: 'bean-1' }), expected), 'bean-match');
  equal(shotSelectionCompatibility(shot({}), expected), 'unknown');
  equal(
    shotSelectionCompatibility(shot({ beanId: 'bean-2', beanBatchId: 'batch-1' }), expected),
    'conflict'
  );
});

run('persisted coffee label is derived without inventing missing parts', () => {
  equal(shotCoffeeLabel(shot({ coffeeRoaster: 'DAK', coffeeName: 'Purple Rain' })), 'DAK Purple Rain');
  equal(shotCoffeeLabel(shot({ coffeeName: 'Purple Rain' })), 'Purple Rain');
  equal(shotCoffeeLabel(shot({})), null);
});

function bean(id: string, roaster: string, name: string): Bean {
  return { id, roaster, name };
}

function batch(id: string, beanId: string): BeanBatch {
  return { id, beanId, weight: 250, weightRemaining: 250 };
}

function shot(context: NonNullable<NonNullable<ShotRecord['workflow']>['context']>): ShotRecord {
  return {
    id: 'shot-1',
    timestamp: '2026-07-12T14:46:28.618Z',
    workflow: { context },
    annotations: { actualDoseWeight: 18, actualYield: 18.6 },
    metadata: null,
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

function equal<T>(actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(`Expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`);
  }
}
