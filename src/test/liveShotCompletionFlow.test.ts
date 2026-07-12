import type { Bean, BeanBatch, ShotRecord, ShotUpdate } from '../api/types';
import {
  LiveShotCompletionFlow,
  type LiveShotCompletionDependencies,
  type LiveShotCompletionEvent,
  type LiveShotCompletionRequest
} from '../controllers/liveShotCompletionFlow';

const START_MS = Date.parse('2026-06-07T10:00:00.000Z');
type PageResolver = (value: { records: ShotRecord[]; total: number }) => void;

await run('live shot completion routes cleaning without polling, counting, or consuming beans', async () => {
  const calls: string[] = [];
  const events: LiveShotCompletionEvent[] = [];
  const flow = new LiveShotCompletionFlow(dependencies(calls));
  flow.subscribe((event) => events.push(event));

  const outcome = await flow.complete(request({ cleaningInProgress: true }));

  equal(outcome.type, 'cleaning');
  deepEqual(events.map((event) => event.type), ['routed', 'settled']);
  equal(events[0]?.type === 'routed' ? events[0].decision.type : null, 'cleaning');
  deepEqual(calls, []);
});

await run('live shot completion routes no-scale abort ahead of local completion', async () => {
  const calls: string[] = [];
  const events: LiveShotCompletionEvent[] = [];
  const flow = new LiveShotCompletionFlow(dependencies(calls));
  flow.subscribe((event) => events.push(event));

  const outcome = await flow.complete(request({ noScaleBlockedAbort: true }));

  equal(outcome.type, 'no-scale-abort');
  equal(events[0]?.type === 'routed' ? events[0].decision.type : null, 'no-scale-abort');
  deepEqual(calls, []);
});

await run('local completion projects optimistic history and starts dose consumption without waiting', async () => {
  const calls: string[] = [];
  let finishDose: (() => void) | null = null;
  const deps = dependencies(calls, {
    consumeDose: (input) => {
      calls.push(`dose:${input.bean.id}:${input.batch.id}:${input.shotId}:${input.doseWeight}`);
      return new Promise<boolean>((resolve) => {
        finishDose = () => resolve(true);
      });
    }
  });
  const flow = new LiveShotCompletionFlow(deps);
  const optimistic = shot('pending', START_MS, { actualDoseWeight: 18 });

  const outcome = await flow.complete(request({
    demo: true,
    optimisticShot: optimistic,
    currentShots: [shot('old', START_MS - 60_000)],
    currentShotsTotal: 7,
    currentDetailShotId: 'old'
  }));

  equal(outcome.type, 'local-complete');
  if (outcome.type === 'local-complete') {
    deepEqual(outcome.history.records.map((item) => item.id), ['pending', 'old']);
    equal(outcome.history.total, 7);
    equal(outcome.history.detailShotId, 'pending');
    equal(outcome.history.status, 'Shot complete (target weight)');
  }
  deepEqual(calls, ['dose:bean-1:batch-1:pending:18']);
  requiredCallback<() => void>(finishDose)();
});

await run('confirmed machine attribution starts dose acceptance before polling without a retry', async () => {
  const calls: string[] = [];
  let releasePage: PageResolver | null = null;
  const completed = shot('saved', START_MS + 12_000, { actualDoseWeight: 18, actualYield: 36 });
  const flow = new LiveShotCompletionFlow(dependencies(calls, {
    loadFirstShots: () => new Promise((resolve) => {
      calls.push('page:bean-1:batch-1');
      releasePage = resolve;
    }),
    consumeDose: async (input) => {
      calls.push(`dose:${input.shotId}`);
      return true;
    }
  }));

  const completion = flow.complete(request({
    selection: { bean: bean(), batch: batch(), source: 'confirmed-batch' }
  }));
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  includes(calls, 'dose:pending');
  requiredCallback<PageResolver>(releasePage)({ records: [completed], total: 1 });
  const outcome = await completion;

  equal(outcome.type, 'remote-complete');
  equal(calls.indexOf('dose:pending') < calls.indexOf('page:bean-1:batch-1'), true);
  equal(calls.filter((call) => call.startsWith('dose:')).length, 1);
  notIncludes(calls, 'dose:saved');
});

await run('blocked dose acceptance never wedges persisted shot projection', async () => {
  const calls: string[] = [];
  const completed = shot('saved', START_MS + 12_000, { actualDoseWeight: 18 });
  const flow = new LiveShotCompletionFlow(dependencies(calls, {
    loadFirstShots: async () => ({ records: [completed], total: 1 }),
    consumeDose: () => new Promise<boolean>(() => {})
  }));

  const outcome = await flow.complete(request({
    selection: { bean: bean(), batch: batch(), source: 'confirmed-batch' }
  }));

  equal(outcome.type, 'remote-complete');
  equal(outcome.type === 'remote-complete' ? outcome.shot.id : null, completed.id);
});

await run('a failed pending dose acceptance cannot retry after flow disposal', async () => {
  const calls: string[] = [];
  let finishDose: ((accepted: boolean) => void) | null = null;
  const completed = shot('saved', START_MS + 12_000, { actualDoseWeight: 18 });
  const flow = new LiveShotCompletionFlow(dependencies(calls, {
    loadFirstShots: async () => ({ records: [completed], total: 1 }),
    consumeDose: (input) => {
      calls.push(`dose:${input.shotId}`);
      return new Promise<boolean>((resolve) => {
        finishDose = resolve;
      });
    }
  }));

  const outcome = await flow.complete(request({
    selection: { bean: bean(), batch: batch(), source: 'confirmed-batch' }
  }));
  equal(outcome.type, 'remote-complete');

  flow.dispose();
  requiredCallback<(accepted: boolean) => void>(finishDose)(false);
  await Promise.resolve();
  await Promise.resolve();

  deepEqual(calls.filter((call) => call.startsWith('dose:')), ['dose:pending']);
});

await run('failed early dose acceptance retries once with persisted shot identity', async () => {
  const calls: string[] = [];
  const completed = shot('saved', START_MS + 12_000, { actualDoseWeight: 18 });
  let admissions = 0;
  const flow = new LiveShotCompletionFlow(dependencies(calls, {
    loadFirstShots: async () => ({ records: [completed], total: 1 }),
    consumeDose: async (input) => {
      calls.push(`dose:${input.shotId}`);
      admissions += 1;
      return admissions > 1;
    }
  }));

  const outcome = await flow.complete(request({
    selection: { bean: bean(), batch: batch(), source: 'confirmed-batch' }
  }));
  await Promise.resolve();

  equal(outcome.type, 'remote-complete');
  deepEqual(calls.filter((call) => call.startsWith('dose:')), ['dose:pending', 'dose:saved']);
});

await run('remote completion polls, rebases shot context, caches it, and projects settled history', async () => {
  const calls: string[] = [];
  const events: LiveShotCompletionEvent[] = [];
  const completed = shot('saved', START_MS + 12_000, {
    actualDoseWeight: 18,
    actualYield: 36
  });
  const previous = shot('old', START_MS - 60_000);
  const captured: { update: ShotUpdate | null } = { update: null };
  let doseResolved = false;
  const deps = dependencies(calls, {
    consumeDose: async (input) => {
      calls.push(`dose:${input.shotId}`);
      await new Promise<boolean>(() => {});
      doseResolved = true;
      return true;
    },
    loadFirstShots: async (target) => {
      calls.push(`page:${target.bean.id}:${target.batch?.id}`);
      return { records: [completed, previous], total: 9 };
    },
    loadLatestShotCandidates: async () => {
      calls.push('latest');
      return [];
    },
    readPendingTweak: () => ({
      beanId: 'bean-1',
      summary: 'Grind finer',
      at: '2026-06-07T09:00:00.000Z'
    }),
    loadShot: async (id) => {
      calls.push(`read:${id}`);
      return {
        ...completed,
        annotations: {
          actualDoseWeight: 18,
          actualYield: 36,
          enjoyment: 91,
          extras: { concurrent: true }
        }
      };
    },
    updateShot: async (id, update) => {
      calls.push(`update:${id}`);
      captured.update = update;
      return { ...completed, ...update } as ShotRecord;
    }
  });
  const flow = new LiveShotCompletionFlow(deps);
  flow.subscribe((event) => events.push(event));

  const completion = flow.complete(request({
    currentShots: [previous],
    currentShotsTotal: 1,
    currentDetailShotId: 'old',
    optimisticShot: shot('pending', START_MS, { actualDoseWeight: 18 })
  }));

  // The route that keeps the chart frozen is published before any poll settles.
  equal(events[0]?.type, 'routed');
  equal(events[0]?.type === 'routed' ? events[0].decision.type : null, 'remote-save');
  const outcome = await completion;

  equal(outcome.type, 'remote-complete');
  if (outcome.type === 'remote-complete') {
    equal(outcome.shot.id, 'saved');
    equal(outcome.history.detailShotId, 'saved');
    equal(outcome.history.total, 9);
    deepEqual(outcome.history.records.map((item) => item.id), ['saved', 'old']);
    equal(outcome.contextPersistence, 'saved');
    equal(outcome.shot.metadata?.freshness != null, true);
  }
  equal(captured.update?.annotations?.enjoyment, 91);
  equal(captured.update?.annotations?.extras?.derekTweak, 'Grind finer');
  deepEqual(events.map((event) => event.type), ['routed', 'settled']);
  equal(doseResolved, false);
  includes(calls, 'dose:saved');
  equal(calls.indexOf('dose:saved') > calls.indexOf('page:bean-1:batch-1'), true);
  notIncludes(calls, 'dose:pending');
  includes(calls, 'invalidate-pages');
  includes(calls, 'serialize:saved');
  includes(calls, 'clear-tweak');
  includes(calls, 'invalidate-shot:saved');
  includes(calls, 'cache-shot:saved');
});

await run('conflicting persisted batch is surfaced without mutating a foreign shot or bag', async () => {
  const calls: string[] = [];
  const purpleBean: Bean = { id: 'bean-2', roaster: 'DAK', name: 'Purple Rain' };
  const purpleBatch: BeanBatch = {
    id: 'batch-2',
    beanId: purpleBean.id,
    weight: 250,
    weightRemaining: 250
  };
  const persisted: ShotRecord = {
    ...shot('saved-purple', START_MS + 12_000, { actualDoseWeight: 18, actualYield: 18.6 }),
    workflow: {
      context: {
        beanBatchId: purpleBatch.id,
        coffeeRoaster: purpleBean.roaster,
        coffeeName: purpleBean.name
      }
    }
  };
  const flow = new LiveShotCompletionFlow(dependencies(calls, {
    loadFirstShots: async () => ({ records: [], total: 0 }),
    loadLatestShotCandidates: async () => [persisted],
    resolveShotSelection: () => ({ bean: purpleBean, batch: purpleBatch }),
    consumeDose: async (input) => {
      calls.push(`dose:${input.bean.id}:${input.batch.id}:${input.shotId}`);
      return true;
    }
  }));

  const outcome = await flow.complete(request({ currentShots: [] }));

  equal(outcome.type, 'remote-mismatch');
  if (outcome.type === 'remote-mismatch') {
    equal(outcome.expectedBeanId, 'bean-1');
    equal(outcome.expectedBatchId, 'batch-1');
    equal(outcome.actualBeanId, purpleBean.id);
    equal(outcome.actualBatchId, purpleBatch.id);
    equal(outcome.shot.id, persisted.id);
    equal(outcome.history.records.length, 0);
    equal(
      outcome.history.status,
      'Conflicting DAK Purple Rain shot detected — no history or inventory was changed'
    );
    equal(outcome.contextPersistence, 'unchanged');
  }
  equal(calls.some((call) => call.startsWith('dose:')), false);
  equal(calls.some((call) => call.startsWith('update:')), false);
  notIncludes(calls, 'dose:pending');
});

await run('a late conflict preserves one expected-bag admission and flags inventory review', async () => {
  const calls: string[] = [];
  const actualBean: Bean = { id: 'bean-2', roaster: 'DAK', name: 'Purple Rain' };
  const actualBatch: BeanBatch = {
    id: 'batch-2',
    beanId: actualBean.id,
    weight: 250,
    weightRemaining: 250
  };
  const persisted: ShotRecord = {
    ...shot('saved-other', START_MS + 12_000, { actualDoseWeight: 18 }),
    workflow: {
      context: {
        beanBatchId: actualBatch.id,
        coffeeRoaster: actualBean.roaster,
        coffeeName: actualBean.name
      }
    }
  };
  const flow = new LiveShotCompletionFlow(dependencies(calls, {
    loadFirstShots: async () => ({ records: [], total: 0 }),
    loadLatestShotCandidates: async () => [persisted],
    resolveShotSelection: () => ({ bean: actualBean, batch: actualBatch }),
    consumeDose: async (input) => {
      calls.push(`dose:${input.bean.id}:${input.batch.id}:${input.shotId}`);
      return true;
    }
  }));

  const outcome = await flow.complete(request({
    selection: { bean: bean(), batch: batch(), source: 'confirmed-batch' }
  }));

  equal(outcome.type, 'remote-mismatch');
  if (outcome.type === 'remote-mismatch') {
    deepEqual(outcome.inventoryReviewBeanIds, ['bean-1']);
    equal(
      outcome.history.status,
      'Conflicting DAK Purple Rain shot detected — expected-bag inventory needs review'
    );
  }
  includes(calls, 'dose:bean-1:batch-1:pending');
  equal(calls.some((call) => call.includes('bean-2:batch-2')), false);
  equal(calls.some((call) => call.startsWith('update:')), false);
});

await run('shot-context persistence failure keeps freshness local and does not fail completion', async () => {
  const calls: string[] = [];
  const completed = shot('saved', START_MS + 12_000, { actualDoseWeight: 18 });
  const updateError = new Error('gateway update failed');
  const deps = dependencies(calls, {
    loadFirstShots: async () => ({ records: [completed], total: 1 }),
    readPendingTweak: () => ({
      beanId: 'bean-1',
      summary: 'Raise temperature',
      at: '2026-06-07T09:00:00.000Z'
    }),
    updateShot: async () => {
      throw updateError;
    }
  });
  const flow = new LiveShotCompletionFlow(deps);

  const outcome = await flow.complete(request({
    currentShots: [],
    optimisticShot: shot('pending', START_MS, { actualDoseWeight: 18 })
  }));

  equal(outcome.type, 'remote-complete');
  if (outcome.type === 'remote-complete') {
    equal(outcome.contextPersistence, 'local-fallback');
    equal(outcome.contextError, updateError);
    equal(outcome.shot.metadata?.freshness != null, true);
    equal(outcome.shot.annotations?.extras?.derekTweak, undefined);
  }
  notIncludes(calls, 'clear-tweak');
  notIncludes(calls, 'invalidate-shot:saved');
  notIncludes(calls, 'cache-shot:saved');
});

await run('cache and observer failures stay auxiliary to a successful remote completion', async () => {
  const calls: string[] = [];
  const auxiliary: string[] = [];
  const completed = shot('saved', START_MS + 12_000);
  const flow = new LiveShotCompletionFlow(dependencies(calls, {
    loadFirstShots: async () => ({ records: [completed], total: 1 }),
    invalidateShotMutation: async () => {
      throw new Error('cache invalidation failed');
    },
    putShotRecord: async () => {
      throw new Error('cache write failed');
    },
    onAuxiliaryFailure: (operation) => auxiliary.push(operation)
  }));
  flow.subscribe(() => {
    throw new Error('broken observer');
  });
  const observed: string[] = [];
  flow.subscribe((event) => observed.push(event.type));

  const outcome = await flow.complete(request({ currentShots: [] }));

  equal(outcome.type, 'remote-complete');
  equal(outcome.type === 'remote-complete' ? outcome.contextPersistence : null, 'saved');
  deepEqual(observed, ['routed', 'settled']);
  deepEqual(auxiliary, [
    'notify-subscriber',
    'invalidate-shot-cache',
    'cache-shot',
    'notify-subscriber'
  ]);
});

await run('a failing diagnostic observer cannot interrupt completion delivery', async () => {
  const calls: string[] = [];
  const observed: string[] = [];
  const flow = new LiveShotCompletionFlow(dependencies(calls, {
    onAuxiliaryFailure: () => {
      throw new Error('broken diagnostics');
    }
  }));
  flow.subscribe(() => {
    throw new Error('broken observer');
  });
  flow.subscribe((event) => observed.push(event.type));

  const outcome = await flow.complete(request({ cleaningInProgress: true }));

  equal(outcome.type, 'cleaning');
  deepEqual(observed, ['routed', 'settled']);
});

await run('dose failure is observable and independent from an already-settled completion', async () => {
  const calls: string[] = [];
  const events: LiveShotCompletionEvent[] = [];
  const doseError = new Error('journal unavailable');
  const flow = new LiveShotCompletionFlow(dependencies(calls, {
    consumeDose: async () => {
      throw doseError;
    }
  }));
  flow.subscribe((event) => events.push(event));

  const outcome = await flow.complete(request({
    demo: true,
    optimisticShot: shot('pending', START_MS, { actualDoseWeight: 18 })
  }));
  await Promise.resolve();

  equal(outcome.type, 'local-complete');
  deepEqual(events.map((event) => event.type), ['routed', 'settled', 'dose-failed']);
  equal(events[2]?.type === 'dose-failed' ? events[2].error : null, doseError);
});

await run('exhausted UI-fallback polling neither publishes nor deducts an unconfirmed optimistic shot', async () => {
  const calls: string[] = [];
  const previous = shot('old', START_MS - 60_000);
  const optimistic = shot('pending', START_MS, { actualDoseWeight: 18 });
  const flow = new LiveShotCompletionFlow(dependencies(calls, {
    loadFirstShots: async () => ({ records: [previous], total: 4 }),
    loadLatestShotCandidates: async () => [previous]
  }));

  const outcome = await flow.complete(request({
    selection: { bean: bean(), batch: batch(), source: 'ui-fallback' },
    currentShots: [previous],
    currentShotsTotal: 4,
    optimisticShot: optimistic
  }));

  equal(outcome.type, 'remote-fallback');
  if (outcome.type === 'remote-fallback') {
    deepEqual(outcome.history.records.map((item) => item.id), ['old']);
    equal(outcome.history.total, 4);
    equal(outcome.history.detailShotId, 'old');
    equal(outcome.history.status, 'Shot record delayed — bag unchanged until its coffee is confirmed');
  }
  equal(calls.filter((call) => call === 'invalidate-pages').length, 5);
  equal(calls.some((call) => call.startsWith('dose:')), false);
});

await run('selection irrelevance aborts polling and publishes finalizing cleanup', async () => {
  const calls: string[] = [];
  const events: LiveShotCompletionEvent[] = [];
  const flow = new LiveShotCompletionFlow(dependencies(calls, {
    isRelevant: () => false
  }));
  flow.subscribe((event) => events.push(event));

  const outcome = await flow.complete(request());

  equal(outcome.type, 'aborted');
  if (outcome.type === 'aborted') {
    equal(outcome.reason, 'irrelevant');
    equal(outcome.closeFinalizing, true);
  }
  deepEqual(events.map((event) => event.type), ['routed', 'settled']);
  notIncludes(calls, 'invalidate-pages');
});

await run('selection loss during context persistence cannot publish over a newer live view', async () => {
  const calls: string[] = [];
  const events: LiveShotCompletionEvent[] = [];
  const completed = shot('saved', START_MS + 12_000);
  let relevant = true;
  let releaseUpdate: ((value: ShotRecord) => void) | null = null;
  let notifyUpdateStarted: (() => void) | null = null;
  const updateStarted = new Promise<void>((resolve) => {
    notifyUpdateStarted = resolve;
  });
  const flow = new LiveShotCompletionFlow(dependencies(calls, {
    loadFirstShots: async () => ({ records: [completed], total: 1 }),
    isRelevant: () => relevant,
    updateShot: () => new Promise((resolve) => {
      releaseUpdate = resolve;
      requiredCallback<() => void>(notifyUpdateStarted)();
    })
  }));
  flow.subscribe((event) => events.push(event));

  const completion = flow.complete(request({ currentShots: [] }));
  await updateStarted;
  // An autonomous new pull (or navigation) takes over while the old context
  // write is already physical and therefore allowed to finish.
  relevant = false;
  requiredCallback<(value: ShotRecord) => void>(releaseUpdate)(completed);
  const outcome = await completion;

  equal(outcome.type, 'aborted');
  if (outcome.type === 'aborted') {
    equal(outcome.reason, 'irrelevant');
    equal(outcome.closeFinalizing, true);
  }
  deepEqual(events.map((event) => event.type), ['routed', 'settled']);
  includes(calls, 'cache-shot:saved');
});

await run('a newer completion supersedes stale record publication', async () => {
  const calls: string[] = [];
  const events: LiveShotCompletionEvent[] = [];
  let releasePage: PageResolver | null = null;
  const flow = new LiveShotCompletionFlow(dependencies(calls, {
    loadFirstShots: () => new Promise((resolve) => {
      releasePage = resolve;
    })
  }));
  flow.subscribe((event) => events.push(event));

  const first = flow.complete(request({ currentShots: [] }));
  await Promise.resolve();
  const second = await flow.complete(request({
    demo: true,
    nowMs: START_MS + 60_000,
    shotWindow: { startMs: START_MS + 60_000, lastActiveMs: START_MS + 90_000 },
    optimisticShot: shot('new-local', START_MS + 60_000)
  }));
  requiredCallback<PageResolver>(releasePage)({
    records: [shot('stale-remote', START_MS + 12_000)],
    total: 1
  });
  const stale = await first;

  equal(second.type, 'local-complete');
  equal(stale.type, 'aborted');
  equal(stale.type === 'aborted' ? stale.reason : null, 'superseded');
  deepEqual(events.map((event) => event.type), ['routed', 'routed', 'settled']);
});

await run('dispose fences an in-flight run and emits no stale settlement', async () => {
  const calls: string[] = [];
  const events: LiveShotCompletionEvent[] = [];
  let releasePage: PageResolver | null = null;
  const flow = new LiveShotCompletionFlow(dependencies(calls, {
    loadFirstShots: () => new Promise((resolve) => {
      releasePage = resolve;
    })
  }));
  flow.subscribe((event) => events.push(event));

  const completion = flow.complete(request({ currentShots: [] }));
  await Promise.resolve();
  flow.dispose();
  requiredCallback<PageResolver>(releasePage)({
    records: [shot('late', START_MS + 12_000)],
    total: 1
  });
  const outcome = await completion;

  equal(outcome.type, 'aborted');
  equal(outcome.type === 'aborted' ? outcome.reason : null, 'disposed');
  deepEqual(events.map((event) => event.type), ['routed', 'disposed']);
  equal((await flow.complete(request())).type, 'disposed');
});

await run('polling failure is explicit and still instructs the host to close finalizing', async () => {
  const calls: string[] = [];
  const events: LiveShotCompletionEvent[] = [];
  const pollError = new Error('repository failed');
  const flow = new LiveShotCompletionFlow(dependencies(calls, {
    invalidateShotPages: async () => {
      throw pollError;
    }
  }));
  flow.subscribe((event) => events.push(event));

  const outcome = await flow.complete(request());

  equal(outcome.type, 'failed');
  if (outcome.type === 'failed') {
    equal(outcome.error, pollError);
    equal(outcome.closeFinalizing, true);
    equal(outcome.status, 'Shot list update failed');
  }
  deepEqual(events.map((event) => event.type), ['routed', 'settled']);
});

await run('invalid requests fail before replacing an in-flight authority lease', async () => {
  const calls: string[] = [];
  let releasePage: PageResolver | null = null;
  const completed = shot('saved', START_MS + 12_000);
  const flow = new LiveShotCompletionFlow(dependencies(calls, {
    loadFirstShots: () => new Promise((resolve) => {
      releasePage = resolve;
    })
  }));

  const valid = flow.complete(request({ currentShots: [] }));
  await Promise.resolve();
  await rejects(
    () => flow.complete(request({ pageLimit: 0 })),
    'positive integer'
  );
  requiredCallback<PageResolver>(releasePage)({ records: [completed], total: 1 });

  equal((await valid).type, 'remote-complete');
});

function dependencies(
  calls: string[],
  overrides: Partial<LiveShotCompletionDependencies> = {}
): LiveShotCompletionDependencies {
  return {
    delay: async (ms) => {
      calls.push(`delay:${ms}`);
    },
    invalidateShotPages: async () => {
      calls.push('invalidate-pages');
    },
    loadFirstShots: async (target) => {
      calls.push(`page:${target.bean.id}:${target.batch?.id ?? 'all'}`);
      return { records: [], total: 0 };
    },
    loadLatestShotCandidates: async () => {
      calls.push('latest');
      return [];
    },
    isRelevant: () => true,
    resolveShotSelection: () => ({ bean: bean(), batch: batch() }),
    consumeDose: async (input) => {
      calls.push(`dose:${input.shotId}`);
      return true;
    },
    readPendingTweak: () => null,
    clearPendingTweak: () => {
      calls.push('clear-tweak');
    },
    serializeShotMutation: async <Value>(shotId: string, execute: () => Value | PromiseLike<Value>) => {
      calls.push(`serialize:${shotId}`);
      return execute();
    },
    loadShot: async (id) => {
      calls.push(`read:${id}`);
      return shot(id, START_MS + 12_000);
    },
    updateShot: async (id, update) => {
      calls.push(`update:${id}`);
      return { ...shot(id, START_MS + 12_000), ...update } as ShotRecord;
    },
    invalidateShotMutation: async (id) => {
      calls.push(`invalidate-shot:${id}`);
    },
    putShotRecord: async (saved) => {
      calls.push(`cache-shot:${saved.id}`);
    },
    ...overrides
  };
}

function request(overrides: Partial<LiveShotCompletionRequest> = {}): LiveShotCompletionRequest {
  return {
    cleaningInProgress: false,
    noScaleBlockedAbort: false,
    selection: { bean: bean(), batch: batch() },
    demo: false,
    currentShots: [shot('old', START_MS - 60_000)],
    currentShotsTotal: 1,
    currentDetailShotId: 'old',
    shotWindow: { startMs: START_MS, lastActiveMs: START_MS + 30_000 },
    optimisticShot: shot('pending', START_MS, { actualDoseWeight: 18 }),
    completionReason: 'target weight',
    nowMs: START_MS + 30_000,
    pageLimit: 12,
    ...overrides
  };
}

function bean(): Bean {
  return { id: 'bean-1', roaster: 'Test Roaster', name: 'Test Coffee' };
}

function batch(): BeanBatch {
  return {
    id: 'batch-1',
    beanId: 'bean-1',
    roastDate: '2026-05-28T10:00:00.000Z',
    weight: 250,
    weightRemaining: 180
  };
}

function shot(
  id: string,
  timestampMs: number,
  annotations: ShotRecord['annotations'] = null
): ShotRecord {
  return {
    id,
    timestamp: new Date(timestampMs).toISOString(),
    workflow: {
      context: { beanId: 'bean-1', beanBatchId: 'batch-1' }
    },
    annotations,
    metadata: null,
    measurements: []
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

function deepEqual(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(actual)} to deeply equal ${JSON.stringify(expected)}`);
  }
}

function includes(values: readonly string[], expected: string): void {
  if (!values.includes(expected)) {
    throw new Error(`Expected ${JSON.stringify(values)} to include ${JSON.stringify(expected)}`);
  }
}

function notIncludes(values: readonly string[], expected: string): void {
  if (values.includes(expected)) {
    throw new Error(`Expected ${JSON.stringify(values)} not to include ${JSON.stringify(expected)}`);
  }
}

async function rejects(runFailure: () => Promise<unknown>, message: string): Promise<void> {
  try {
    await runFailure();
  } catch (error) {
    if (error instanceof Error && error.message.includes(message)) return;
    throw error;
  }
  throw new Error(`Expected rejection containing ${JSON.stringify(message)}`);
}

function requiredCallback<Callback>(callback: Callback | null): NonNullable<Callback> {
  if (callback == null) throw new Error('Expected deferred callback to be assigned');
  return callback as NonNullable<Callback>;
}
