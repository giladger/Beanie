import type { BeanBatch } from '../api/types';
import {
  BeanInventoryController,
  type BeanInventoryCommandPort,
  type BeanInventoryProjection,
  type BeanInventoryRepository,
  type BeanInventorySnapshot,
  type BeanInventoryStatePort
} from '../controllers/beanInventoryController';
import type { GatewayMutationOutcome } from '../runtime/gatewayMutationCoordinator';

const BEAN_ID = 'bean-1';
const NOW_MS = Date.parse('2026-07-12T10:00:00.000Z');
const NOW_ISO = '2026-07-12T10:00:00.000Z';

async function main(): Promise<void> {
await run('batch updates expose an immediate optimistic projection and preserve later unrelated edits', async () => {
  const harness = createHarness([batch('source', { weightRemaining: 200, roastLevel: 'light' })]);
  const started = harness.controller.startBatchUpdate({
    beanId: BEAN_ID,
    batchId: 'source',
    patch: { beanId: BEAN_ID, weightRemaining: 180 },
    demo: false
  });

  equal(started.type, 'optimistic');
  if (started.type !== 'optimistic' || !started.completion) return;
  equal(weight(started.projection, 'source'), 180);
  equal(started.projection.shouldScheduleApply, true);
  equal(harness.commands.submissions[0]?.key, `bean-inventory:${BEAN_ID}`);
  harness.state.adopt(started.projection);
  harness.state.patch('source', { roastLevel: 'dark' });

  await harness.commands.complete(0, {
    ...batch('source', { weightRemaining: 180, roastLevel: 'light' }),
    weightRemaining: 179.5
  });
  const outcome = await started.completion;

  equal(outcome.type, 'saved');
  equal(weight(outcome.projection, 'source'), 179.5);
  equal(find(outcome.projection, 'source')?.roastLevel, 'dark');
  equal(harness.repository.cached.at(-1)?.find((item) => item.id === 'source')?.roastLevel, 'dark');
});

await run('later foreground weight edits wait for an earlier physical adjustment reservation', async () => {
  const harness = createHarness([batch('source', { weightRemaining: 82 })]);
  harness.controller.reservePendingRemainingWeight({
    idempotencyKey: 'pending-dose-1',
    beanId: BEAN_ID,
    batchId: 'source',
    fieldRevision: 0
  });
  const started = requiredUpdate(harness.controller.startBatchUpdate({
    beanId: BEAN_ID,
    batchId: 'source',
    patch: { weightRemaining: 80 },
    demo: false
  }));
  harness.state.adopt(started.projection);
  await flushAsync();

  equal(harness.commands.submissions.length, 0);
  const read = harness.controller.beginCacheRead(BEAN_ID);
  const protectedRead = await harness.controller.cacheProjectionFromRead({
    beanId: BEAN_ID,
    batches: [batch('source', { weightRemaining: 100 })],
    shouldScheduleApply: false
  }, read);
  equal(protectedRead?.projection.batches[0]?.weightRemaining, 80);
  equal(harness.repository.cached.length, 0);
  harness.controller.releasePendingRemainingWeight('pending-dose-1');
  await flushAsync();
  equal(harness.commands.submissions.length, 1);

  await harness.commands.complete(0, batch('source', { weightRemaining: 80 }));
  equal((await requiredCompletion(started)).type, 'saved');
});

await run('editing an explicitly selected older bag re-applies its recipe identity', () => {
  const harness = createHarness([
    batch('source', { roastDate: '2026-05-01', weightRemaining: 200 }),
    batch('newer', { roastDate: '2026-06-01', weightRemaining: 200 })
  ], { selectedBatchId: 'source' });

  const started = requiredUpdate(harness.controller.startBatchUpdate({
    beanId: BEAN_ID,
    batchId: 'source',
    patch: { weightRemaining: 180 },
    demo: true
  }));

  equal(started.projection.shouldScheduleApply, true);
});

await run('failed updates roll back only fields still owned by that optimistic mutation', async () => {
  const harness = createHarness([
    batch('source', { weightRemaining: 200, roastLevel: 'light' }),
    batch('other', { roastDate: '2026-05-01', weightRemaining: 100 })
  ]);
  const started = requiredUpdate(harness.controller.startBatchUpdate({
    beanId: BEAN_ID,
    batchId: 'source',
    patch: { beanId: BEAN_ID, weightRemaining: 180 },
    demo: false
  }));
  harness.state.adopt(started.projection);
  harness.state.patch('source', { roastLevel: 'dark' });
  harness.state.patch('other', { weightRemaining: 75 });

  harness.commands.fail(0, new Error('offline'));
  const outcome = await requiredCompletion(started);

  equal(outcome.type, 'failed');
  equal(weight(outcome.projection, 'source'), 200);
  equal(find(outcome.projection, 'source')?.roastLevel, 'dark');
  equal(weight(outcome.projection, 'other'), 75);
  equal(outcome.projection.shouldScheduleApply, true);
});

await run('an older failure never rolls back a newer optimistic value for the same field', async () => {
  const harness = createHarness([batch('source', { weightRemaining: 200 })]);
  const first = requiredUpdate(harness.controller.startBatchUpdate({
    beanId: BEAN_ID,
    batchId: 'source',
    patch: { weightRemaining: 180 },
    demo: false
  }));
  harness.state.adopt(first.projection);
  const second = requiredUpdate(harness.controller.startBatchUpdate({
    beanId: BEAN_ID,
    batchId: 'source',
    patch: { weightRemaining: 160 },
    demo: false
  }));
  harness.state.adopt(second.projection);

  harness.commands.fail(0, new Error('first failed'));
  const firstOutcome = await requiredCompletion(first);
  equal(firstOutcome.type, 'failed');
  equal(weight(firstOutcome.projection, 'source'), 160);
  equal(firstOutcome.projection.shouldScheduleApply, false);

  await harness.commands.complete(1, batch('source', { weightRemaining: 160 }));
  const secondOutcome = await requiredCompletion(second);
  equal(secondOutcome.type, 'saved');
  equal(weight(secondOutcome.projection, 'source'), 160);
});

await run('cache publication replaces a later unconfirmed field with its confirmed baseline', async () => {
  const harness = createHarness([batch('source', { weightRemaining: 100 })]);
  const first = requiredUpdate(harness.controller.startBatchUpdate({
    beanId: BEAN_ID,
    batchId: 'source',
    patch: { weightRemaining: 80 },
    demo: false
  }));
  harness.state.adopt(first.projection);
  const second = requiredUpdate(harness.controller.startBatchUpdate({
    beanId: BEAN_ID,
    batchId: 'source',
    patch: { weightRemaining: 60 },
    demo: false
  }));
  harness.state.adopt(second.projection);

  await harness.commands.complete(0, batch('source', { weightRemaining: 80 }));
  equal((await requiredCompletion(first)).type, 'saved');
  await flushAsync();
  equal(harness.repository.cached.at(-1)?.[0]?.weightRemaining, 80);
  equal(harness.state.snapshot().batchesByBean[BEAN_ID]?.[0]?.weightRemaining, 60);

  harness.commands.fail(1, new Error('second failed'));
  const failed = await requiredCompletion(second);
  equal(failed.type, 'failed');
  harness.state.adopt(failed.projection);
  await flushAsync();
  equal(harness.repository.cached.at(-1)?.[0]?.weightRemaining, 80);
});

await run('field revisions fence an older failure across an A to B to A edit sequence', async () => {
  const harness = createHarness([batch('source', { weightRemaining: 200 })]);
  const first = requiredUpdate(harness.controller.startBatchUpdate({
    beanId: BEAN_ID,
    batchId: 'source',
    patch: { weightRemaining: 180 },
    demo: false
  }));
  harness.state.adopt(first.projection);
  const second = requiredUpdate(harness.controller.startBatchUpdate({
    beanId: BEAN_ID,
    batchId: 'source',
    patch: { weightRemaining: 200 },
    demo: false
  }));
  harness.state.adopt(second.projection);

  harness.commands.fail(0, new Error('stale failure'));
  const outcome = await requiredCompletion(first);
  equal(outcome.type, 'failed');
  equal(weight(outcome.projection, 'source'), 200);
  equal(outcome.projection.shouldScheduleApply, false);

  await harness.commands.complete(1, batch('source', { weightRemaining: 200 }));
  equal((await requiredCompletion(second)).type, 'saved');
});

await run('finishing selected stock optimistically selects the next usable bag and restores selection on failure', async () => {
  const harness = createHarness([
    batch('source', { roastDate: '2026-06-10', weightRemaining: 20 }),
    batch('next', { roastDate: '2026-06-01', weightRemaining: 100 })
  ], { selectedBatchId: 'source' });
  const started = requiredUpdate(harness.controller.startBatchUpdate({
    beanId: BEAN_ID,
    batchId: 'source',
    patch: { weightRemaining: 0 },
    purpose: 'finish',
    demo: false
  }));

  equal(started.projection.selectedBatchId, 'next');
  equal(started.status, 'Bag finished');
  harness.state.adopt(started.projection);
  harness.commands.cancel(0);
  const outcome = await requiredCompletion(started);

  equal(outcome.type, 'failed');
  equal(outcome.type === 'failed' ? outcome.reason : null, 'canceled');
  equal(outcome.projection.selectedBatchId, 'source');
  equal(weight(outcome.projection, 'source'), 20);
});

await run('a failed finish cannot overwrite a later A-to-B-to-A selection intent', async () => {
  const harness = createHarness([
    batch('source', { roastDate: '2026-06-10', weightRemaining: 20 }),
    batch('next', { roastDate: '2026-06-01', weightRemaining: 100 })
  ], { selectedBatchId: 'source' });
  const started = requiredUpdate(harness.controller.startBatchUpdate({
    beanId: BEAN_ID,
    batchId: 'source',
    patch: { weightRemaining: 0 },
    purpose: 'finish',
    demo: false
  }));
  harness.state.adopt(started.projection);
  harness.state.selectedBatchId = 'source';
  harness.state.selectedBatchId = 'next';

  harness.commands.fail(0, new Error('offline'));
  const outcome = await requiredCompletion(started);
  equal(outcome.type, 'failed');
  equal(Object.prototype.hasOwnProperty.call(outcome.projection, 'selectedBatchId'), false);
});

await run('demo updates complete synchronously without command or cache ownership', () => {
  const harness = createHarness([batch('source', { weightRemaining: 200 })]);
  const started = requiredUpdate(harness.controller.startBatchUpdate({
    beanId: BEAN_ID,
    batchId: 'source',
    patch: { weightRemaining: 150 },
    demo: true
  }));

  equal(started.complete, true);
  equal(started.completion, null);
  equal(weight(started.projection, 'source'), 150);
  equal(harness.commands.submissions.length, 0);
  equal(harness.repository.cached.length, 0);
});

await run('created stock merges into the latest inventory and selects only the current bean', async () => {
  const harness = createHarness([batch('old', { roastDate: '2026-05-01' })]);
  const creating = harness.controller.createBatch({
    beanId: BEAN_ID,
    batch: { roastDate: '2026-06-01', weight: 250, weightRemaining: 250 },
    demo: false,
    nowMs: NOW_MS
  });
  harness.state.add(batch('concurrent', { roastDate: '2026-05-20' }));
  await harness.commands.completeNext();
  const outcome = await creating;

  equal(outcome.type, 'created');
  if (outcome.type !== 'created') return;
  equal(outcome.projection.batches.length, 3);
  equal(outcome.projection.batches[0]?.id, outcome.batch.id);
  equal(outcome.projection.batches.some((item) => item.id === 'concurrent'), true);
  equal(outcome.projection.selectedBatchId, outcome.batch.id);
  equal(outcome.projection.shouldScheduleApply, true);
});

await run('create completion never overrides a later selected-batch intent', async () => {
  const harness = createHarness([batch('old'), batch('other')], { selectedBatchId: 'old' });
  const creating = harness.controller.createBatch({
    beanId: BEAN_ID,
    batch: { weight: 100, weightRemaining: 100 },
    demo: false,
    nowMs: NOW_MS
  });
  harness.state.selectedBatchId = 'other';

  await harness.commands.completeNext();
  const outcome = await creating;
  equal(outcome.type, 'created');
  if (outcome.type !== 'created') return;
  equal(Object.prototype.hasOwnProperty.call(outcome.projection, 'selectedBatchId'), false);
  equal(outcome.projection.shouldScheduleApply, false);
});

await run('create completion never overrides later bean navigation', async () => {
  const harness = createHarness([batch('old')]);
  const creating = harness.controller.createBatch({
    beanId: BEAN_ID,
    batch: { weight: 100, weightRemaining: 100 },
    demo: false,
    nowMs: NOW_MS
  });
  harness.state.selectedBeanId = 'bean-2';

  await harness.commands.completeNext();
  const outcome = await creating;
  equal(outcome.type, 'created');
  if (outcome.type !== 'created') return;
  equal(Object.prototype.hasOwnProperty.call(outcome.projection, 'selectedBatchId'), false);
  equal(outcome.projection.shouldScheduleApply, false);
});

await run('selection revision fences create completion across an A-to-B-to-A intent', async () => {
  const harness = createHarness([batch('old'), batch('other')], { selectedBatchId: 'old' });
  const creating = harness.controller.createBatch({
    beanId: BEAN_ID,
    batch: { weight: 100, weightRemaining: 100 },
    demo: false,
    nowMs: NOW_MS
  });
  harness.state.selectedBatchId = 'other';
  harness.state.selectedBatchId = 'old';

  await harness.commands.completeNext();
  const outcome = await creating;
  equal(outcome.type, 'created');
  if (outcome.type !== 'created') return;
  equal(Object.prototype.hasOwnProperty.call(outcome.projection, 'selectedBatchId'), false);
  equal(outcome.projection.shouldScheduleApply, false);
});

await run('creating frozen stock repairs storage state dropped by the create endpoint', async () => {
  const harness = createHarness([]);
  harness.repository.dropStorageOnCreate = true;
  const creating = harness.controller.createBatch({
    beanId: BEAN_ID,
    batch: {
      weight: 100,
      weightRemaining: 100,
      frozen: true,
      storageEvents: [{ type: 'frozen', at: NOW_ISO }]
    },
    demo: false,
    nowMs: NOW_MS
  });

  await harness.commands.completeNext();
  const outcome = await creating;
  equal(outcome.type, 'created');
  equal(harness.repository.calls.map((call) => call.type).join(','), 'read,create,update');
  equal(outcome.type === 'created' ? outcome.batch.frozen : null, true);
  equal(outcome.type === 'created' ? outcome.batch.storageEvents?.[0]?.at : null, NOW_ISO);
});

await run('a failed freezer-state repair still publishes the known created stock', async () => {
  const harness = createHarness([]);
  harness.repository.dropStorageOnCreate = true;
  harness.repository.failUpdate('remote-1', { apply: false, error: new Error('repair rejected') });
  const creating = harness.controller.createBatch({
    beanId: BEAN_ID,
    batch: {
      weight: 100,
      weightRemaining: 100,
      frozen: true,
      storageEvents: [{ type: 'frozen', at: NOW_ISO }]
    },
    demo: false,
    nowMs: NOW_MS
  });

  await harness.commands.completeNext();
  const outcome = await creating;
  equal(outcome.type, 'reconciliation-required');
  if (outcome.type !== 'reconciliation-required' || outcome.phase !== 'persist-storage') return;
  equal(outcome.phase, 'persist-storage');
  equal(outcome.batch.id, 'remote-1');
  equal(outcome.projection.batches[0]?.id, 'remote-1');
  equal(harness.repository.calls.at(-1)?.type, 'read');
});

await run('whole-stock freezing uses the optimistic update path and deterministic event time', async () => {
  const harness = createHarness([batch('source', { weightRemaining: 80 })]);
  const started = harness.controller.startFreezeStock({
    beanId: BEAN_ID,
    batchId: 'source',
    amountGrams: null,
    demo: false,
    nowMs: NOW_MS
  });

  equal(started.type, 'optimistic');
  if (started.type !== 'optimistic' || !started.completion) return;
  equal(find(started.projection, 'source')?.frozen, true);
  equal(find(started.projection, 'source')?.storageEvents?.[0]?.at, NOW_ISO);
  harness.state.adopt(started.projection);
  await harness.commands.completeNext();
  const outcome = await started.completion;
  equal(outcome.type, 'frozen');
  equal(outcome.type === 'frozen' ? outcome.mode : null, 'whole');
});

await run('split freezing serializes create, freezer-state repair, and source update in one command', async () => {
  const harness = createHarness([
    batch('source', { weight: 100, weightRemaining: 100, roastDate: '2026-06-01' }),
    batch('other', { weightRemaining: 30 })
  ]);
  harness.repository.dropStorageOnCreate = true;
  const started = harness.controller.startFreezeStock({
    beanId: BEAN_ID,
    batchId: 'source',
    amountGrams: 40,
    demo: false,
    nowMs: NOW_MS
  });

  equal(started.type, 'queued');
  if (started.type !== 'queued') return;
  harness.state.patch('other', { roastLevel: 'dark' });
  await harness.commands.completeNext();
  const outcome = await started.completion;

  equal(outcome.type, 'frozen');
  if (outcome.type !== 'frozen') return;
  equal(outcome.mode, 'split');
  equal(weight(outcome.projection, 'source'), 60);
  equal(outcome.frozenBatch?.weightRemaining, 40);
  equal(outcome.frozenBatch?.frozen, true);
  equal(find(outcome.projection, 'other')?.roastLevel, 'dark');
  equal(harness.repository.calls.map((call) => `${call.type}:${call.id ?? ''}`).join(','),
    'read:,create:,update:remote-1,update:source');
});

await run('partial split fences dose projection and rebases source weight inside the lane', async () => {
  const harness = createHarness([
    batch('source', { weight: 120, weightRemaining: 82, roastLevel: 'dark' })
  ]);
  const doseRevision = harness.controller.remainingWeightRevision('source');
  const started = harness.controller.startFreezeStock({
    beanId: BEAN_ID,
    batchId: 'source',
    amountGrams: 40,
    demo: false,
    nowMs: NOW_MS
  });
  if (started.type !== 'queued') throw new Error('expected queued split');
  const splitRevision = harness.controller.remainingWeightRevision('source');
  equal(splitRevision === doseRevision, false);

  const blocked = harness.controller.reconcileRemainingWeight({
    beanId: BEAN_ID,
    batchId: 'source',
    expectedCurrent: 82,
    resolvedRemaining: 102,
    fieldRevision: splitRevision
  });
  equal(blocked, null);
  harness.repository.patchRemote('source', { weightRemaining: 102 });

  await harness.commands.completeNext();
  const outcome = await started.completion;
  equal(outcome.type, 'frozen');
  if (outcome.type !== 'frozen') return;
  equal(outcome.grams, 40);
  equal(outcome.frozenBatch?.weightRemaining, 40);
  equal(outcome.sourceBatch.weightRemaining, 62);
  equal(weight(outcome.projection, 'source'), 62);
  equal(find(outcome.projection, 'source')?.roastLevel, 'dark');
  await flushAsync();
  equal(harness.repository.cached.at(-1)?.find((item) => item.id === 'source')?.weightRemaining, 62);

  harness.state.adopt(outcome.projection);
  const afterRelease = harness.controller.reconcileRemainingWeight({
    beanId: BEAN_ID,
    batchId: 'source',
    expectedCurrent: 62,
    resolvedRemaining: 61,
    fieldRevision: splitRevision
  });
  equal(weight(required(afterRelease), 'source'), 61);
});

await run('partial split completion cannot clobber a newer A-to-B-to-A source intent', async () => {
  const harness = createHarness([batch('source', { weight: 120, weightRemaining: 82 })]);
  const started = harness.controller.startFreezeStock({
    beanId: BEAN_ID,
    batchId: 'source',
    amountGrams: 40,
    demo: false,
    nowMs: NOW_MS
  });
  if (started.type !== 'queued') throw new Error('expected queued split');
  const splitRevision = harness.controller.remainingWeightRevision('source');

  const first = requiredUpdate(harness.controller.startBatchUpdate({
    beanId: BEAN_ID,
    batchId: 'source',
    patch: { weightRemaining: 90 },
    demo: true
  }));
  harness.state.adopt(first.projection);
  const second = requiredUpdate(harness.controller.startBatchUpdate({
    beanId: BEAN_ID,
    batchId: 'source',
    patch: { weightRemaining: 82 },
    demo: true
  }));
  harness.state.adopt(second.projection);
  equal(harness.controller.remainingWeightRevision('source') === splitRevision, false);

  await harness.commands.completeNext();
  const outcome = await started.completion;
  equal(outcome.type, 'frozen');
  if (outcome.type !== 'frozen') return;
  equal(outcome.frozenBatch?.weightRemaining, 40);
  equal(weight(outcome.projection, 'source'), 82);
  equal(outcome.sourceBatch.weightRemaining, 82);
});

await run('a newer source edit failure rolls back to the split-confirmed weight', async () => {
  const harness = createHarness([batch('source', { weight: 120, weightRemaining: 82 })]);
  const started = harness.controller.startFreezeStock({
    beanId: BEAN_ID,
    batchId: 'source',
    amountGrams: 40,
    demo: false,
    nowMs: NOW_MS
  });
  if (started.type !== 'queued') throw new Error('expected queued split');
  const edit = requiredUpdate(harness.controller.startBatchUpdate({
    beanId: BEAN_ID,
    batchId: 'source',
    patch: { weightRemaining: 90 },
    demo: false
  }));
  harness.state.adopt(edit.projection);

  await harness.commands.complete(0);
  const splitOutcome = await started.completion;
  equal(splitOutcome.type, 'frozen');
  if (splitOutcome.type !== 'frozen') return;
  equal(weight(splitOutcome.projection, 'source'), 90);
  harness.state.adopt(splitOutcome.projection);

  harness.commands.fail(1, new Error('newer edit rejected'));
  const editOutcome = await requiredCompletion(edit);
  equal(editOutcome.type, 'failed');
  equal(weight(editOutcome.projection, 'source'), 42);
});

await run('split preflight failure is explicit, performs no POST, and releases source ownership', async () => {
  const harness = createHarness([batch('source', { weight: 100, weightRemaining: 100 })]);
  harness.repository.readError = new Error('offline before preflight');
  const started = harness.controller.startFreezeStock({
    beanId: BEAN_ID,
    batchId: 'source',
    amountGrams: 40,
    demo: false,
    nowMs: NOW_MS
  });
  if (started.type !== 'queued') throw new Error('expected queued split');
  const splitRevision = harness.controller.remainingWeightRevision('source');

  await harness.commands.completeNext();
  const outcome = await started.completion;
  equal(outcome.type, 'failed');
  equal(outcome.type === 'failed' ? outcome.reason : null, 'gateway');
  equal(harness.repository.calls.map((call) => call.type).join(','), 'read');
  equal(harness.repository.physicalCreateCount, 0);

  const afterRelease = harness.controller.reconcileRemainingWeight({
    beanId: BEAN_ID,
    batchId: 'source',
    expectedCurrent: 100,
    resolvedRemaining: 90,
    fieldRevision: splitRevision
  });
  equal(weight(required(afterRelease), 'source'), 90);
});

await run('a source-update failure publishes the created remote portion instead of losing it', async () => {
  const harness = createHarness([batch('source', { weight: 100, weightRemaining: 100 })]);
  harness.repository.failUpdate('source', { apply: false, error: new Error('source rejected') });
  const started = harness.controller.startFreezeStock({
    beanId: BEAN_ID,
    batchId: 'source',
    amountGrams: 40,
    demo: false,
    nowMs: NOW_MS
  });
  if (started.type !== 'queued') throw new Error('expected queued split');

  await harness.commands.completeNext();
  const outcome = await started.completion;

  equal(outcome.type, 'reconciliation-required');
  if (outcome.type !== 'reconciliation-required' || outcome.phase === 'create-portion') return;
  equal(outcome.phase, 'update-source');
  equal(outcome.createdBatch.id, 'remote-1');
  equal(outcome.projection.batches.some((item) => item.id === 'remote-1'), true);
  equal(weight(outcome.projection, 'source'), 100);
  equal(harness.repository.calls.at(-1)?.type, 'read');
  equal(harness.repository.cached.at(-1)?.some((item) => item.id === 'remote-1'), true);
});

await run('a frozen-portion repair failure is explicit and never updates the source bag', async () => {
  const harness = createHarness([batch('source', { weight: 100, weightRemaining: 100 })]);
  harness.repository.dropStorageOnCreate = true;
  harness.repository.failUpdate('remote-1', { apply: false, error: new Error('repair rejected') });
  const started = harness.controller.startFreezeStock({
    beanId: BEAN_ID,
    batchId: 'source',
    amountGrams: 30,
    demo: false,
    nowMs: NOW_MS
  });
  if (started.type !== 'queued') throw new Error('expected queued split');

  await harness.commands.completeNext();
  const outcome = await started.completion;
  equal(outcome.type, 'reconciliation-required');
  if (outcome.type !== 'reconciliation-required' || outcome.phase === 'create-portion') return;
  equal(outcome.phase, 'persist-freezer-state');
  equal(weight(outcome.projection, 'source'), 100);
  equal(harness.repository.calls.some((call) => call.type === 'update' && call.id === 'source'), false);
});

await run('known created stock remains visible even when post-failure reconciliation is offline', async () => {
  const harness = createHarness([batch('source', { weight: 100, weightRemaining: 100 })]);
  harness.repository.failUpdate('source', { apply: false, error: new Error('source rejected') });
  const readError = new Error('still offline');
  harness.repository.failReadsAfter(1, readError);
  const started = harness.controller.startFreezeStock({
    beanId: BEAN_ID,
    batchId: 'source',
    amountGrams: 25,
    demo: false,
    nowMs: NOW_MS
  });
  if (started.type !== 'queued') throw new Error('expected queued split');

  await harness.commands.completeNext();
  const outcome = await started.completion;

  equal(outcome.type, 'reconciliation-required');
  if (outcome.type !== 'reconciliation-required' || outcome.phase === 'create-portion') return;
  equal(outcome.createdBatch.id, 'remote-1');
  equal(outcome.projection.batches[0]?.id, 'remote-1');
  equal(outcome.reconciliationError, readError);
});

await run('a lost source response is recovered when the authoritative read proves the split committed', async () => {
  const harness = createHarness([batch('source', { weight: 100, weightRemaining: 100 })]);
  harness.repository.failUpdate('source', { apply: true, error: new Error('response lost') });
  const started = harness.controller.startFreezeStock({
    beanId: BEAN_ID,
    batchId: 'source',
    amountGrams: 35,
    demo: false,
    nowMs: NOW_MS
  });
  if (started.type !== 'queued') throw new Error('expected queued split');

  await harness.commands.completeNext();
  const outcome = await started.completion;

  equal(outcome.type, 'frozen');
  equal(outcome.type === 'frozen' ? outcome.recovered : null, true);
  equal(outcome.type === 'frozen' ? weight(outcome.projection, 'source') : null, 65);
});

await run('zero split amounts are rejected before gateway scheduling', () => {
  const harness = createHarness([batch('source', { weightRemaining: 100 })]);
  const started = harness.controller.startFreezeStock({
    beanId: BEAN_ID,
    batchId: 'source',
    amountGrams: 0,
    demo: false,
    nowMs: NOW_MS
  });
  equal(started.type, 'nothing-to-freeze');
  equal(harness.commands.submissions.length, 0);
});

await run('chained failures restore the last confirmed field value', async () => {
  const harness = createHarness([batch('source', { weightRemaining: 100 })]);
  const first = requiredUpdate(harness.controller.startBatchUpdate({
    beanId: BEAN_ID,
    batchId: 'source',
    patch: { weightRemaining: 90 },
    demo: false
  }));
  harness.state.adopt(first.projection);
  const second = requiredUpdate(harness.controller.startBatchUpdate({
    beanId: BEAN_ID,
    batchId: 'source',
    patch: { weightRemaining: 80 },
    demo: false
  }));
  harness.state.adopt(second.projection);

  harness.commands.fail(0, new Error('first failed'));
  harness.state.adopt(awaitProjection(await requiredCompletion(first)));
  harness.commands.fail(1, new Error('second failed'));
  const outcome = await requiredCompletion(second);

  equal(outcome.type, 'failed');
  equal(weight(outcome.projection, 'source'), 100);
});

await run('a canonical older success rebases a newer failure rollback', async () => {
  const harness = createHarness([batch('source', { weightRemaining: 100 })]);
  const first = requiredUpdate(harness.controller.startBatchUpdate({
    beanId: BEAN_ID,
    batchId: 'source',
    patch: { weightRemaining: 90 },
    demo: false
  }));
  harness.state.adopt(first.projection);
  const second = requiredUpdate(harness.controller.startBatchUpdate({
    beanId: BEAN_ID,
    batchId: 'source',
    patch: { weightRemaining: 80 },
    demo: false
  }));
  harness.state.adopt(second.projection);

  await harness.commands.complete(0, batch('source', { weightRemaining: 89 }));
  harness.state.adopt(awaitProjection(await requiredCompletion(first)));
  harness.commands.fail(1, new Error('second failed'));
  const outcome = await requiredCompletion(second);

  equal(outcome.type, 'failed');
  equal(weight(outcome.projection, 'source'), 89);
});

await run('a confirmed null remains the rollback baseline across chained failures', async () => {
  const harness = createHarness([batch('source', { roastLevel: 'medium' })]);
  const first = requiredUpdate(harness.controller.startBatchUpdate({
    beanId: BEAN_ID,
    batchId: 'source',
    patch: { roastLevel: null },
    demo: false
  }));
  harness.state.adopt(first.projection);
  const second = requiredUpdate(harness.controller.startBatchUpdate({
    beanId: BEAN_ID,
    batchId: 'source',
    patch: { roastLevel: 'light' },
    demo: false
  }));
  harness.state.adopt(second.projection);
  const third = requiredUpdate(harness.controller.startBatchUpdate({
    beanId: BEAN_ID,
    batchId: 'source',
    patch: { roastLevel: 'dark' },
    demo: false
  }));
  harness.state.adopt(third.projection);

  await harness.commands.complete(0, batch('source', { roastLevel: null }));
  harness.state.adopt(awaitProjection(await requiredCompletion(first)));
  harness.commands.fail(1, new Error('middle failed'));
  harness.state.adopt(awaitProjection(await requiredCompletion(second)));
  harness.commands.fail(2, new Error('latest failed'));
  const outcome = await requiredCompletion(third);

  equal(outcome.type, 'failed');
  equal(find(outcome.projection, 'source')?.roastLevel, null);
});

await run('a failed finish cannot restore another bean selection after navigation', async () => {
  const harness = createHarness([batch('source', { weightRemaining: 20 })]);
  const started = requiredUpdate(harness.controller.startBatchUpdate({
    beanId: BEAN_ID,
    batchId: 'source',
    patch: { weightRemaining: 0 },
    purpose: 'finish',
    demo: false
  }));
  harness.state.adopt(started.projection);
  harness.state.selectedBeanId = 'bean-2';
  harness.state.selectedBatchId = null;

  harness.commands.fail(0, new Error('offline'));
  const outcome = await requiredCompletion(started);

  equal(outcome.type, 'failed');
  equal(Object.prototype.hasOwnProperty.call(outcome.projection, 'selectedBatchId'), false);
  equal(outcome.projection.shouldScheduleApply, false);
});

await run('cache latency never delays a completion projection or overwrites later host state', async () => {
  const harness = createHarness([batch('source', { weightRemaining: 100 })]);
  const cacheGate = deferred<void>();
  harness.repository.cacheGate = cacheGate.promise;
  const started = requiredUpdate(harness.controller.startBatchUpdate({
    beanId: BEAN_ID,
    batchId: 'source',
    patch: { weightRemaining: 90 },
    demo: false
  }));
  harness.state.adopt(started.projection);

  await harness.commands.complete(0, batch('source', { weightRemaining: 90 }));
  let settled = false;
  void requiredCompletion(started).then(() => { settled = true; });
  await flushAsync();
  equal(settled, true);
  const outcome = await requiredCompletion(started);
  harness.state.adopt(outcome.projection);
  harness.state.patch('source', { weightRemaining: 72 });
  cacheGate.resolve();
  await flushAsync();

  equal(harness.state.snapshot().batchesByBean[BEAN_ID]?.[0]?.weightRemaining, 72);
});

await run('adjacent workflow projections share the controller cache tail', async () => {
  const harness = createHarness([batch('source', { weightRemaining: 100 })]);
  const cacheGate = deferred<void>();
  harness.repository.cacheGate = cacheGate.promise;
  const older = harness.controller.cacheProjection({
    beanId: BEAN_ID,
    batches: [batch('source', { weightRemaining: 90 })],
    shouldScheduleApply: false
  });
  const newer = harness.controller.cacheProjection({
    beanId: BEAN_ID,
    batches: [batch('source', { weightRemaining: 80 })],
    shouldScheduleApply: false
  });

  await flushAsync();
  equal(harness.repository.cached.length, 1);
  cacheGate.resolve();
  await Promise.all([older, newer]);

  equal(harness.repository.cached.length, 2);
  equal(harness.repository.cached.at(-1)?.[0]?.weightRemaining, 80);
});

await run('a stale repository read cannot publish after a newer inventory projection', async () => {
  const harness = createHarness([batch('source', { weightRemaining: 100 })]);
  const admittedRevision = harness.controller.cacheRevision(BEAN_ID);
  await harness.controller.cacheProjection({
    beanId: BEAN_ID,
    batches: [batch('source', { weightRemaining: 80 })],
    shouldScheduleApply: false
  });
  await harness.controller.cacheProjectionIfCurrent({
    beanId: BEAN_ID,
    batches: [batch('source', { weightRemaining: 100 })],
    shouldScheduleApply: false
  }, admittedRevision);

  equal(harness.repository.cached.length, 1);
  equal(harness.repository.cached[0]?.[0]?.weightRemaining, 80);
});

await run('concurrent inventory reads publish only the latest admitted snapshot', async () => {
  const harness = createHarness([batch('source', { weightRemaining: 100 })]);
  const first = harness.controller.beginCacheRead(BEAN_ID);
  const second = harness.controller.beginCacheRead(BEAN_ID);

  const stale = await harness.controller.cacheProjectionFromRead({
    beanId: BEAN_ID,
    batches: [batch('source', { weightRemaining: 90 })],
    shouldScheduleApply: false
  }, first);
  const latest = await harness.controller.cacheProjectionFromRead({
    beanId: BEAN_ID,
    batches: [batch('source', { weightRemaining: 80 })],
    shouldScheduleApply: false
  }, second);

  equal(stale, null);
  equal(latest?.projection.batches[0]?.weightRemaining, 80);
  equal(harness.repository.cached.length, 1);
  equal(harness.repository.cached[0]?.[0]?.weightRemaining, 80);
});

await run('a read cannot omit a locally owned batch while its edit is pending', async () => {
  const harness = createHarness([batch('source', { weightRemaining: 100 })]);
  const edit = requiredUpdate(harness.controller.startBatchUpdate({
    beanId: BEAN_ID,
    batchId: 'source',
    patch: { weightRemaining: 80 },
    demo: false
  }));
  harness.state.adopt(edit.projection);
  const read = harness.controller.beginCacheRead(BEAN_ID);
  const publication = await harness.controller.cacheProjectionFromRead({
    beanId: BEAN_ID,
    batches: [],
    shouldScheduleApply: false
  }, read);

  equal(publication?.projection.batches[0]?.id, 'source');
  equal(publication?.projection.batches[0]?.weightRemaining, 80);
  equal(harness.repository.cached.length, 0);
  await harness.commands.complete(0, batch('source', { weightRemaining: 80 }));
  equal((await requiredCompletion(edit)).type, 'saved');
});

await run('a lane-winning read refreshes rollback truth without replacing current optimism', async () => {
  const harness = createHarness([batch('source', { weightRemaining: 100 })]);
  const read = harness.controller.beginCacheRead(BEAN_ID);
  const edit = requiredUpdate(harness.controller.startBatchUpdate({
    beanId: BEAN_ID,
    batchId: 'source',
    patch: { weightRemaining: 80 },
    demo: false
  }));
  harness.state.adopt(edit.projection);
  const publication = await harness.controller.cacheProjectionFromRead({
    beanId: BEAN_ID,
    batches: [batch('source', { weightRemaining: 90 })],
    shouldScheduleApply: false
  }, read);
  equal(publication, null);
  equal(harness.state.snapshot().batchesByBean[BEAN_ID]?.[0]?.weightRemaining, 80);

  harness.commands.fail(0, new Error('update failed'));
  const failed = await requiredCompletion(edit);
  equal(failed.type, 'failed');
  equal(failed.projection.batches[0]?.weightRemaining, 90);
});

await run('a stale read cannot replace a confirmation newer than its mutation boundary', async () => {
  const harness = createHarness([batch('source', { weightRemaining: 100 })]);
  const staleRead = harness.controller.beginCacheRead(BEAN_ID);
  const first = requiredUpdate(harness.controller.startBatchUpdate({
    beanId: BEAN_ID,
    batchId: 'source',
    patch: { weightRemaining: 90 },
    demo: false
  }));
  harness.state.adopt(first.projection);
  await harness.commands.complete(0, batch('source', { weightRemaining: 90 }));
  const firstOutcome = await requiredCompletion(first);
  harness.state.adopt(firstOutcome.projection);

  const second = requiredUpdate(harness.controller.startBatchUpdate({
    beanId: BEAN_ID,
    batchId: 'source',
    patch: { weightRemaining: 80 },
    demo: false
  }));
  harness.state.adopt(second.projection);
  equal(await harness.controller.cacheProjectionFromRead({
    beanId: BEAN_ID,
    batches: [batch('source', { weightRemaining: 100 })],
    shouldScheduleApply: false
  }, staleRead), null);

  harness.commands.fail(1, new Error('second failed'));
  const failed = await requiredCompletion(second);
  equal(failed.type, 'failed');
  equal(failed.projection.batches[0]?.weightRemaining, 90);
});

await run('a read admitted under an existing owner cannot later rewrite that field baseline', async () => {
  const harness = createHarness([batch('source', { weightRemaining: 100 })]);
  const first = requiredUpdate(harness.controller.startBatchUpdate({
    beanId: BEAN_ID,
    batchId: 'source',
    patch: { weightRemaining: 90 },
    demo: false
  }));
  harness.state.adopt(first.projection);
  const readDuringFirst = harness.controller.beginCacheRead(BEAN_ID);
  const second = requiredUpdate(harness.controller.startBatchUpdate({
    beanId: BEAN_ID,
    batchId: 'source',
    patch: { weightRemaining: 80 },
    demo: false
  }));
  harness.state.adopt(second.projection);

  await harness.commands.complete(0, batch('source', { weightRemaining: 90 }));
  equal((await requiredCompletion(first)).type, 'saved');
  equal(await harness.controller.cacheProjectionFromRead({
    beanId: BEAN_ID,
    batches: [batch('source', { weightRemaining: 100 })],
    shouldScheduleApply: false
  }, readDuringFirst), null);

  harness.commands.fail(1, new Error('second failed'));
  const failed = await requiredCompletion(second);
  equal(failed.type, 'failed');
  equal(failed.projection.batches[0]?.weightRemaining, 90);
});

await run('a read cannot omit a batch protected by a pending physical adjustment', async () => {
  const harness = createHarness([batch('source', { weightRemaining: 100 })]);
  harness.controller.reservePendingRemainingWeight({
    idempotencyKey: 'dose-protected', beanId: BEAN_ID, batchId: 'source', fieldRevision: 0
  });
  harness.controller.retainPendingRemainingWeight({
    idempotencyKey: 'dose-protected',
    beanId: BEAN_ID,
    batchId: 'source',
    expectedRemaining: 82,
    fieldRevision: 0
  });
  const read = harness.controller.beginCacheRead(BEAN_ID);
  const publication = await harness.controller.cacheProjectionFromRead({
    beanId: BEAN_ID,
    batches: [],
    shouldScheduleApply: false
  }, read);

  equal(publication?.projection.batches[0]?.id, 'source');
  equal(publication?.projection.batches[0]?.weightRemaining, 82);
  equal(harness.repository.cached.at(-1)?.[0]?.weightRemaining, 82);
  harness.controller.releasePendingRemainingWeight('dose-protected');
});

await run('fresh reads retain the latest still-pending physical weight scalar', async () => {
  const harness = createHarness([batch('source', { weightRemaining: 100 })]);
  harness.controller.reservePendingRemainingWeight({
    idempotencyKey: 'dose-1', beanId: BEAN_ID, batchId: 'source', fieldRevision: 0
  });
  harness.controller.retainPendingRemainingWeight({
    idempotencyKey: 'dose-1',
    beanId: BEAN_ID,
    batchId: 'source',
    expectedRemaining: 82,
    fieldRevision: 0
  });
  harness.controller.reservePendingRemainingWeight({
    idempotencyKey: 'dose-2', beanId: BEAN_ID, batchId: 'source', fieldRevision: 0
  });
  harness.controller.retainPendingRemainingWeight({
    idempotencyKey: 'dose-2',
    beanId: BEAN_ID,
    batchId: 'source',
    expectedRemaining: 64,
    fieldRevision: 0
  });
  const read = harness.controller.beginCacheRead(BEAN_ID);
  const publication = await harness.controller.cacheProjectionFromRead({
    beanId: BEAN_ID,
    batches: [batch('source', { weightRemaining: 100 })],
    shouldScheduleApply: false
  }, read);

  equal(publication?.projection.batches[0]?.weightRemaining, 64);
  equal(harness.controller.hasPendingRemainingWeightAfter('dose-1', BEAN_ID, 'source'), true);
  harness.controller.releasePendingRemainingWeight('dose-1');
  equal(
    harness.controller.overlayPendingRemainingWeights(
      BEAN_ID,
      [batch('source', { weightRemaining: 82 })]
    )[0]?.weightRemaining,
    64
  );
  harness.controller.releasePendingRemainingWeight('dose-2');
  equal(
    harness.controller.overlayPendingRemainingWeights(
      BEAN_ID,
      [batch('source', { weightRemaining: 64 })]
    )[0]?.weightRemaining,
    64
  );
});

await run('late physical retention cannot resurrect a reservation after settlement', () => {
  const harness = createHarness([batch('source', { weightRemaining: 82 })]);
  harness.controller.reservePendingRemainingWeight({
    idempotencyKey: 'settled-dose', beanId: BEAN_ID, batchId: 'source', fieldRevision: 0
  });
  harness.controller.releasePendingRemainingWeight('settled-dose');
  equal(harness.controller.retainPendingRemainingWeight({
    idempotencyKey: 'settled-dose',
    beanId: BEAN_ID,
    batchId: 'source',
    expectedRemaining: 100,
    fieldRevision: 0
  }), false);
  equal(
    harness.controller.overlayPendingRemainingWeights(
      BEAN_ID,
      [batch('source', { weightRemaining: 82 })]
    )[0]?.weightRemaining,
    82
  );
});

await run('double-submitted split freezes share one transaction and one created portion', async () => {
  const harness = createHarness([batch('source', { weight: 100, weightRemaining: 100 })]);
  const request = {
    beanId: BEAN_ID,
    batchId: 'source',
    amountGrams: 40,
    demo: false,
    nowMs: NOW_MS
  } as const;
  const first = harness.controller.startFreezeStock(request);
  const second = harness.controller.startFreezeStock(request);
  if (first.type !== 'queued' || second.type !== 'queued') throw new Error('expected queued split');

  equal(first.completion, second.completion);
  equal(harness.commands.submissions.length, 1);
  await harness.commands.completeNext();
  equal((await first.completion).type, 'frozen');
  equal(harness.repository.calls.filter((call) => call.type === 'create').length, 1);
});

await run('double-submitted identical creates share one command and one completion', async () => {
  const harness = createHarness([]);
  const request = {
    beanId: BEAN_ID,
    batch: { roastDate: '2026-06-01', weight: 250, weightRemaining: 250 },
    demo: false,
    nowMs: NOW_MS
  } as const;
  const first = harness.controller.createBatch(request);
  const second = harness.controller.createBatch({ ...request, nowMs: NOW_MS + 1 });

  equal(first, second);
  equal(harness.commands.submissions.length, 1);
  await harness.commands.completeNext();
  equal((await first).type, 'created');
  equal(harness.repository.physicalCreateCount, 1);
});

await run('different same-millisecond create intents receive different idempotency keys', async () => {
  const harness = createHarness([]);
  const first = harness.controller.createBatch({
    beanId: BEAN_ID,
    batch: { roastDate: '2026-06-01', weight: 250, weightRemaining: 250 },
    demo: false,
    nowMs: NOW_MS
  });
  const second = harness.controller.createBatch({
    beanId: BEAN_ID,
    batch: { roastDate: '2026-06-01', weight: 500, weightRemaining: 500 },
    demo: false,
    nowMs: NOW_MS
  });

  equal(harness.commands.submissions.length, 2);
  await harness.commands.complete(0);
  await harness.commands.complete(1);
  equal((await first).type, 'created');
  equal((await second).type, 'created');
  const keys = harness.repository.calls
    .filter((call): call is Extract<RepositoryCall, { type: 'create' }> => call.type === 'create')
    .map((call) => call.idempotencyKey);
  equal(keys.length, 2);
  equal(keys[0] === keys[1], false);
});

await run('a lost create response stays uncertain until the same idempotency key returns a receipt', async () => {
  const harness = createHarness([]);
  harness.repository.failCreate({ apply: true, error: new Error('response lost') });
  const request = {
    beanId: BEAN_ID,
    batch: { roastDate: '2026-06-01', weight: 250, weightRemaining: 250 },
    demo: false,
    nowMs: NOW_MS
  } as const;
  const creating = harness.controller.createBatch(request);

  await harness.commands.completeNext();
  const outcome = await creating;

  equal(outcome.type, 'reconciliation-required');
  if (outcome.type !== 'reconciliation-required' || outcome.phase !== 'create') return;
  equal(outcome.candidates[0]?.id, 'remote-1');
  equal(harness.repository.calls.map((call) => call.type).join(','), 'read,create,read');
  const firstKey = harness.repository.calls.find((call) => call.type === 'create')?.idempotencyKey;
  equal(firstKey?.startsWith(`bean-batch-create:v1:${BEAN_ID}:${NOW_MS}:1:`), true);

  const retry = harness.controller.createBatch({ ...request, nowMs: NOW_MS + 60_000 });
  await harness.commands.completeNext();
  const retried = await retry;
  equal(retried.type, 'created');
  equal(retried.type === 'created' ? retried.recovered : null, true);
  equal(retried.type === 'created' ? retried.batch.id : null, 'remote-1');
  const createCalls = harness.repository.calls.filter(
    (call): call is Extract<RepositoryCall, { type: 'create' }> => call.type === 'create'
  );
  equal(createCalls.length, 2);
  equal(createCalls[1]?.idempotencyKey, firstKey);
  equal(harness.repository.physicalCreateCount, 1);
});

await run('an unloaded pre-existing matching batch is never mistaken for a failed create', async () => {
  const harness = createHarness([]);
  harness.repository.addRemote(batch('old-remote', {
    roastDate: '2026-06-01',
    weight: 250,
    weightRemaining: 250
  }));
  harness.repository.failCreate({ apply: false, error: new Error('create rejected') });
  const creating = harness.controller.createBatch({
    beanId: BEAN_ID,
    batch: { roastDate: '2026-06-01', weight: 250, weightRemaining: 250 },
    demo: false,
    nowMs: NOW_MS
  });

  await harness.commands.completeNext();
  const outcome = await creating;
  equal(outcome.type, 'reconciliation-required');
  if (outcome.type !== 'reconciliation-required' || outcome.phase !== 'create') return;
  equal(outcome.candidates.length, 0);
  equal(outcome.projection.batches.length, 0);
  equal(harness.repository.physicalCreateCount, 0);
});

await run('a concurrent post-preflight candidate remains explicit uncertainty', async () => {
  const harness = createHarness([batch('old')]);
  harness.repository.failCreate({
    apply: false,
    error: new Error('create rejected'),
    afterFailure: batch('concurrent', { weight: 250, weightRemaining: 250 })
  });
  const creating = harness.controller.createBatch({
    beanId: BEAN_ID,
    batch: { roastDate: '2026-06-01', weight: 250, weightRemaining: 250 },
    demo: false,
    nowMs: NOW_MS
  });

  await harness.commands.completeNext();
  const outcome = await creating;
  equal(outcome.type, 'reconciliation-required');
  if (outcome.type !== 'reconciliation-required' || outcome.phase !== 'create') return;
  equal(outcome.candidates.map((item) => item.id).join(','), 'concurrent');
  equal(outcome.projection.selectedBatchId, undefined);
  equal(outcome.projection.shouldScheduleApply, false);
});

await run('a lost split-create response stops before mutation and resumes only from an idempotent receipt', async () => {
  const harness = createHarness([batch('source', { weight: 100, weightRemaining: 100 })]);
  harness.repository.failCreate({ apply: true, error: new Error('response lost') });
  const request = {
    beanId: BEAN_ID,
    batchId: 'source',
    amountGrams: 40,
    demo: false,
    nowMs: NOW_MS
  } as const;
  const started = harness.controller.startFreezeStock(request);
  if (started.type !== 'queued') throw new Error('expected queued split');

  await harness.commands.completeNext();
  const outcome = await started.completion;

  equal(outcome.type, 'reconciliation-required');
  if (outcome.type !== 'reconciliation-required' || outcome.phase !== 'create-portion') return;
  equal(outcome.candidates[0]?.id, 'remote-1');
  equal(weight(outcome.projection, 'source'), 100);
  equal(harness.repository.calls.some((call) => call.type === 'update'), false);
  const firstKey = harness.repository.calls.find((call) => call.type === 'create')?.idempotencyKey;

  harness.repository.readError = new Error('retry preflight offline');
  const blockedRetry = harness.controller.startFreezeStock({ ...request, nowMs: NOW_MS + 30_000 });
  if (blockedRetry.type !== 'queued') throw new Error('expected queued split retry');
  await harness.commands.completeNext();
  const stillUncertain = await blockedRetry.completion;
  equal(stillUncertain.type, 'reconciliation-required');
  equal(
    stillUncertain.type === 'reconciliation-required' ? stillUncertain.phase : null,
    'create-portion'
  );
  equal(harness.repository.calls.filter((call) => call.type === 'create').length, 1);

  harness.repository.readError = undefined;
  const retry = harness.controller.startFreezeStock({ ...request, nowMs: NOW_MS + 60_000 });
  if (retry.type !== 'queued') throw new Error('expected queued split retry');
  await harness.commands.completeNext();
  const retried = await retry.completion;
  equal(retried.type, 'frozen');
  equal(retried.type === 'frozen' ? retried.recovered : null, true);
  equal(retried.type === 'frozen' ? weight(retried.projection, 'source') : null, 60);
  const createCalls = harness.repository.calls.filter(
    (call): call is Extract<RepositoryCall, { type: 'create' }> => call.type === 'create'
  );
  equal(createCalls.length, 2);
  equal(createCalls[1]?.idempotencyKey, firstKey);
  equal(harness.repository.physicalCreateCount, 1);
});

await run('external dose reconciliation publishes a fresh scalar without replacing batch metadata', () => {
  const harness = createHarness([
    batch('source', { roastLevel: 'dark', weightRemaining: 82 })
  ]);
  const projection = harness.controller.reconcileRemainingWeight({
    beanId: BEAN_ID,
    batchId: 'source',
    expectedCurrent: 82,
    resolvedRemaining: 102,
    fieldRevision: harness.controller.remainingWeightRevision('source')
  });

  equal(weight(required(projection), 'source'), 102);
  equal(find(required(projection), 'source')?.roastLevel, 'dark');
});

await run('A-to-B-to-A field intent fences a delayed external dose settlement', () => {
  const harness = createHarness([batch('source', { weightRemaining: 82 })]);
  const doseRevision = harness.controller.remainingWeightRevision('source');
  const first = requiredUpdate(harness.controller.startBatchUpdate({
    beanId: BEAN_ID,
    batchId: 'source',
    patch: { weightRemaining: 90 },
    demo: true
  }));
  harness.state.adopt(first.projection);
  const second = requiredUpdate(harness.controller.startBatchUpdate({
    beanId: BEAN_ID,
    batchId: 'source',
    patch: { weightRemaining: 82 },
    demo: true
  }));
  harness.state.adopt(second.projection);

  const projection = harness.controller.reconcileRemainingWeight({
    beanId: BEAN_ID,
    batchId: 'source',
    expectedCurrent: 82,
    resolvedRemaining: 102,
    fieldRevision: doseRevision
  });

  equal(projection, null);
  equal(harness.state.snapshot().batchesByBean[BEAN_ID]?.[0]?.weightRemaining, 82);
});

await run('demo dose reclaim computes from current local state without gateway work', async () => {
  const harness = createHarness([batch('source', { weight: 100, weightRemaining: 120 })]);
  const outcome = harness.controller.reclaimDemoDose({
    beanId: BEAN_ID,
    batchId: 'source',
    dose: 15
  });

  equal(outcome.type, 'reclaimed');
  if (outcome.type !== 'reclaimed') return;
  equal(outcome.previousRemaining, 120);
  equal(outcome.resolvedRemaining, 135);
  equal(weight(required(outcome.projection), 'source'), 135);
  equal(harness.commands.submissions.length, 0);
  equal(harness.repository.calls.length, 0);
});

await run('demo dose reclaim is local-only for missing and untracked stock', () => {
  const missing = createHarness([]).controller.reclaimDemoDose({
    beanId: BEAN_ID,
    batchId: 'missing',
    dose: 10
  });
  equal(missing.type === 'not-applicable' ? missing.reason : null, 'missing-batch');

  const untracked = createHarness([batch('source', { weightRemaining: null })]);
  const outcome = untracked.controller.reclaimDemoDose({
    beanId: BEAN_ID,
    batchId: 'source',
    dose: 10
  });
  equal(outcome.type === 'not-applicable' ? outcome.reason : null, 'untracked-remaining');
  equal(untracked.commands.submissions.length, 0);
  equal(untracked.repository.calls.length, 0);
});
}

interface Harness {
  readonly state: StateHarness;
  readonly commands: CommandHarness;
  readonly repository: RepositoryHarness;
  readonly controller: BeanInventoryController;
}

function createHarness(
  batches: BeanBatch[],
  selection: { selectedBeanId?: string | null; selectedBatchId?: string | null } = {}
): Harness {
  const state = new StateHarness(batches, selection);
  const commands = new CommandHarness();
  const repository = new RepositoryHarness(batches);
  return {
    state,
    commands,
    repository,
    controller: new BeanInventoryController(state, commands, repository)
  };
}

class StateHarness implements BeanInventoryStatePort {
  private batches: BeanBatch[];
  private currentSelectedBeanId: string | null;
  private currentSelectedBatchId: string | null;
  private currentSelectionRevision = 0;

  constructor(
    batches: BeanBatch[],
    selection: { selectedBeanId?: string | null; selectedBatchId?: string | null }
  ) {
    this.batches = [...batches];
    this.currentSelectedBeanId = selection.selectedBeanId === undefined ? BEAN_ID : selection.selectedBeanId;
    this.currentSelectedBatchId = selection.selectedBatchId === undefined
      ? batches[0]?.id ?? null
      : selection.selectedBatchId;
  }

  get selectedBeanId(): string | null {
    return this.currentSelectedBeanId;
  }

  set selectedBeanId(value: string | null) {
    this.currentSelectedBeanId = value;
    this.currentSelectionRevision += 1;
  }

  get selectedBatchId(): string | null {
    return this.currentSelectedBatchId;
  }

  set selectedBatchId(value: string | null) {
    this.currentSelectedBatchId = value;
    this.currentSelectionRevision += 1;
  }

  snapshot(): BeanInventorySnapshot {
    return {
      batchesByBean: { [BEAN_ID]: this.batches },
      selectedBeanId: this.selectedBeanId,
      selectedBatchId: this.selectedBatchId,
      selectionRevision: this.currentSelectionRevision
    };
  }

  adopt(projection: BeanInventoryProjection): void {
    this.batches = [...projection.batches];
    if (Object.prototype.hasOwnProperty.call(projection, 'selectedBatchId')) {
      this.selectedBatchId = projection.selectedBatchId ?? null;
    }
  }

  patch(batchId: string, patch: Partial<BeanBatch>): void {
    this.batches = this.batches.map((item) => item.id === batchId ? { ...item, ...patch } : item);
  }

  add(next: BeanBatch): void {
    this.batches = [next, ...this.batches];
  }
}

interface CommandSubmission {
  readonly key: string;
  readonly run: () => Promise<unknown>;
  readonly resolve: (outcome: GatewayMutationOutcome<unknown>) => void;
}

class CommandHarness implements BeanInventoryCommandPort {
  readonly submissions: CommandSubmission[] = [];

  exact<Value>(key: string, run: () => Value | PromiseLike<Value>): Promise<GatewayMutationOutcome<Value>> {
    return new Promise((resolve) => {
      this.submissions.push({
        key,
        run: async () => await run(),
        resolve: resolve as (outcome: GatewayMutationOutcome<unknown>) => void
      });
    });
  }

  async complete(index: number, value?: unknown): Promise<void> {
    const submission = required(this.submissions[index]);
    this.resolved.add(submission);
    try {
      const result = arguments.length > 1 ? value : await submission.run();
      submission.resolve({ status: 'completed', value: result });
    } catch (error) {
      submission.resolve({ status: 'failed', error });
    }
    await flushAsync();
  }

  completeNext(): Promise<void> {
    const index = this.submissions.findIndex((submission) => !this.resolved.has(submission));
    if (index < 0) throw new Error('No pending command');
    this.resolved.add(this.submissions[index]!);
    return this.complete(index);
  }

  fail(index: number, error: unknown): void {
    const submission = required(this.submissions[index]);
    this.resolved.add(submission);
    submission.resolve({ status: 'failed', error });
  }

  cancel(index: number): void {
    const submission = required(this.submissions[index]);
    this.resolved.add(submission);
    submission.resolve({ status: 'canceled' });
  }

  private readonly resolved = new Set<CommandSubmission>();
}

type RepositoryCall =
  | { type: 'read'; id?: undefined }
  | { type: 'create'; id?: undefined; idempotencyKey: string }
  | { type: 'update'; id: string; patch: Partial<BeanBatch> };

class RepositoryHarness implements BeanInventoryRepository {
  readonly calls: RepositoryCall[] = [];
  readonly cached: BeanBatch[][] = [];
  physicalCreateCount = 0;
  dropStorageOnCreate = false;
  readError: unknown;
  cacheGate: Promise<void> | null = null;
  sparseUpdateResponses = false;
  updateResponsePatch: Partial<BeanBatch> | null = null;
  private remote: BeanBatch[];
  private nextId = 1;
  private readCount = 0;
  private delayedReadFailure: { successfulReads: number; error: unknown } | null = null;
  private createFailure: { apply: boolean; error: unknown; afterFailure?: BeanBatch } | null = null;
  private readonly createReceipts = new Map<string, string>();
  private readonly updateFailures = new Map<string, { apply: boolean; error: unknown }>();

  constructor(batches: BeanBatch[]) {
    this.remote = batches.map((item) => ({ ...item }));
  }

  async batches(_beanId: string): Promise<BeanBatch[]> {
    this.calls.push({ type: 'read' });
    const readIndex = this.readCount++;
    if (this.readError !== undefined) throw this.readError;
    if (this.delayedReadFailure && readIndex >= this.delayedReadFailure.successfulReads) {
      throw this.delayedReadFailure.error;
    }
    return this.remote.map((item) => cloneBatch(item));
  }

  async createBatch(
    beanId: string,
    input: Partial<BeanBatch>,
    options: { idempotencyKey: string }
  ): Promise<BeanBatch> {
    this.calls.push({ type: 'create', idempotencyKey: options.idempotencyKey });
    const receiptId = this.createReceipts.get(options.idempotencyKey);
    if (receiptId) return cloneBatch(required(this.remote.find((item) => item.id === receiptId)));

    const created = {
      id: `remote-${this.nextId++}`,
      ...input,
      beanId,
      ...(this.dropStorageOnCreate ? { storageEvents: null, frozen: false } : {})
    } as BeanBatch;
    if (!this.createFailure || this.createFailure.apply) {
      this.remote = [created, ...this.remote];
      this.createReceipts.set(options.idempotencyKey, created.id);
      this.physicalCreateCount += 1;
    }
    if (this.createFailure?.afterFailure) {
      const concurrent = cloneBatch(this.createFailure.afterFailure);
      this.remote = [concurrent, ...this.remote.filter((item) => item.id !== concurrent.id)];
    }
    if (this.createFailure) throw this.createFailure.error;
    return cloneBatch(created);
  }

  async updateBatch(batchId: string, patch: Partial<BeanBatch>): Promise<BeanBatch> {
    this.calls.push({ type: 'update', id: batchId, patch: { ...patch } });
    const previous = required(this.remote.find((item) => item.id === batchId));
    const saved = { ...previous, ...patch, id: previous.id, beanId: previous.beanId };
    const failure = this.updateFailures.get(batchId);
    if (!failure || failure.apply) {
      this.remote = this.remote.map((item) => item.id === batchId ? saved : item);
    }
    if (failure) throw failure.error;
    return this.sparseUpdateResponses
      ? { id: saved.id, beanId: saved.beanId } as BeanBatch
      : cloneBatch({ ...saved, ...(this.updateResponsePatch ?? {}) });
  }

  async putBeanBatches(_beanId: string, batches: BeanBatch[]): Promise<void> {
    this.cached.push(batches.map((item) => cloneBatch(item)));
    if (this.cacheGate) await this.cacheGate;
  }

  failUpdate(batchId: string, failure: { apply: boolean; error: unknown }): void {
    this.updateFailures.set(batchId, failure);
  }

  failCreate(failure: { apply: boolean; error: unknown; afterFailure?: BeanBatch }): void {
    this.createFailure = failure;
  }

  failReadsAfter(successfulReads: number, error: unknown): void {
    this.delayedReadFailure = { successfulReads, error };
  }

  patchRemote(batchId: string, patch: Partial<BeanBatch>): void {
    this.remote = this.remote.map((item) => item.id === batchId ? { ...item, ...patch } : item);
  }

  addRemote(next: BeanBatch): void {
    this.remote = [cloneBatch(next), ...this.remote.filter((item) => item.id !== next.id)];
  }
}

function batch(id: string, patch: Partial<BeanBatch> = {}): BeanBatch {
  return {
    id,
    beanId: BEAN_ID,
    roastDate: '2026-06-01',
    weight: 250,
    weightRemaining: 250,
    ...patch
  };
}

function cloneBatch(value: BeanBatch): BeanBatch {
  return {
    ...value,
    ...(value.storageEvents ? { storageEvents: value.storageEvents.map((event) => ({ ...event })) } : {})
  };
}

function requiredUpdate(
  value: ReturnType<BeanInventoryController['startBatchUpdate']>
): Extract<ReturnType<BeanInventoryController['startBatchUpdate']>, { type: 'optimistic' }> {
  if (value.type !== 'optimistic') throw new Error('Expected optimistic update');
  return value;
}

function requiredCompletion(
  value: Extract<ReturnType<BeanInventoryController['startBatchUpdate']>, { type: 'optimistic' }>
): NonNullable<typeof value.completion> {
  if (!value.completion) throw new Error('Expected remote completion');
  return value.completion;
}

function find(projection: BeanInventoryProjection, batchId: string): BeanBatch | undefined {
  return projection.batches.find((item) => item.id === batchId);
}

function weight(projection: BeanInventoryProjection, batchId: string): number | null | undefined {
  return find(projection, batchId)?.weightRemaining;
}

function awaitProjection(outcome: Awaited<ReturnType<typeof requiredCompletion>>): BeanInventoryProjection {
  return outcome.projection;
}

function deferred<Value>(): { promise: Promise<Value>; resolve(value: Value): void } {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function required<Value>(value: Value | null | undefined): Value {
  if (value == null) throw new Error('Expected value');
  return value;
}

function equal(actual: unknown, expected: unknown): void {
  if (!Object.is(actual, expected)) {
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
