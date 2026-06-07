import type { ShotRecord } from '../api/types';
import {
  completedLiveShot,
  includeShotInHistory,
  liveShotEndDecision,
  waitForCompletedLiveShot,
  type LiveShotCompletionContext
} from '../controllers/liveShotController';

await run('live shot end decision routes cleaning before save decisions', () => {
  const decision = liveShotEndDecision({
    cleaningInProgress: true,
    noScaleBlockedAbort: false,
    beanId: 'bean-1',
    demo: false,
    currentShots: [shot('previous', '2026-06-07T09:59:00.000Z')],
    shotWindow: { startMs: Date.parse('2026-06-07T10:00:00.000Z'), lastActiveMs: null },
    optimisticShot: shot('optimistic', '2026-06-07T10:00:00.000Z'),
    completionReason: 'target weight',
    nowMs: Date.parse('2026-06-07T10:00:30.000Z')
  });

  equal(decision.type, 'cleaning');
});

await run('live shot end decision routes no-scale abort before counting espresso shots', () => {
  const decision = liveShotEndDecision({
    cleaningInProgress: false,
    noScaleBlockedAbort: true,
    beanId: 'bean-1',
    demo: false,
    currentShots: [],
    shotWindow: { startMs: Date.parse('2026-06-07T10:00:00.000Z'), lastActiveMs: null },
    optimisticShot: null,
    completionReason: null,
    nowMs: Date.parse('2026-06-07T10:00:30.000Z')
  });

  equal(decision.type, 'no-scale-abort');
});

await run('live shot end decision prepares remote save context for real beans', () => {
  const startMs = Date.parse('2026-06-07T10:00:00.000Z');
  const optimistic = shot('optimistic', '2026-06-07T10:00:00.000Z');
  const decision = liveShotEndDecision({
    cleaningInProgress: false,
    noScaleBlockedAbort: false,
    beanId: 'bean-1',
    demo: false,
    currentShots: [shot('previous', '2026-06-07T09:59:00.000Z')],
    shotWindow: { startMs, lastActiveMs: null },
    optimisticShot: optimistic,
    completionReason: 'target weight',
    nowMs: startMs + 30_000
  });

  equal(decision.type, 'remote-save');
  equal(decision.type === 'remote-save' ? decision.beanId : null, 'bean-1');
  equal(decision.type === 'remote-save' ? decision.status : null, 'Saving shot…');
  equal(decision.type === 'remote-save' ? decision.context.previousShotIds.has('previous') : false, true);
  equal(decision.type === 'remote-save' ? decision.context.endedAtMs : null, startMs + 30_000);
  equal(decision.type === 'remote-save' ? decision.context.optimisticShot?.id : null, 'optimistic');
});

await run('live shot end decision completes locally for demo or missing bean', () => {
  const demoDecision = liveShotEndDecision({
    cleaningInProgress: false,
    noScaleBlockedAbort: false,
    beanId: 'bean-1',
    demo: true,
    currentShots: [],
    shotWindow: { startMs: Date.parse('2026-06-07T10:00:00.000Z'), lastActiveMs: null },
    optimisticShot: shot('optimistic', '2026-06-07T10:00:00.000Z'),
    completionReason: 'target weight',
    nowMs: Date.parse('2026-06-07T10:00:30.000Z')
  });
  const noBeanDecision = liveShotEndDecision({
    cleaningInProgress: false,
    noScaleBlockedAbort: false,
    beanId: null,
    demo: false,
    currentShots: [],
    shotWindow: { startMs: Date.parse('2026-06-07T10:00:00.000Z'), lastActiveMs: null },
    optimisticShot: null,
    completionReason: null,
    nowMs: Date.parse('2026-06-07T10:00:30.000Z')
  });

  equal(demoDecision.type, 'local-complete');
  equal(demoDecision.type === 'local-complete' ? demoDecision.status : null, 'Shot complete (target weight)');
  equal(noBeanDecision.type, 'local-complete');
  equal(noBeanDecision.type === 'local-complete' ? noBeanDecision.status : null, 'Shot complete');
});

await run('completed live shot prefers a new record inside the live window', () => {
  const startedAtMs = Date.parse('2026-06-07T10:00:00.000Z');
  const context = completionContext({
    previousShotIds: new Set(['old']),
    startedAtMs,
    endedAtMs: startedAtMs + 30_000
  });
  const oldMatch = shot('old', '2026-06-07T10:00:05.000Z');
  const newMatch = shot('new', '2026-06-07T10:00:10.000Z');

  equal(completedLiveShot([oldMatch, newMatch], context, false)?.id, 'new');
});

await run('completed live shot uses newest unknown record only when fallback is allowed', () => {
  const context = completionContext({
    previousShotIds: new Set(['old']),
    startedAtMs: Date.parse('2026-06-07T10:00:00.000Z'),
    endedAtMs: Date.parse('2026-06-07T10:00:30.000Z')
  });
  const newest = shot('newest', '2026-06-07T09:00:00.000Z');

  equal(completedLiveShot([newest], context, false), null);
  equal(completedLiveShot([newest], context, true), null);

  const undated = shot('undated', 'not-a-date');
  equal(completedLiveShot([undated], context, true)?.id, 'undated');
});

await run('wait for completed live shot returns completed shot from first-page records', async () => {
  const startedAtMs = Date.parse('2026-06-07T10:00:00.000Z');
  const completed = shot('completed', '2026-06-07T10:00:12.000Z');
  const result = await waitForCompletedLiveShot(
    completionContext({ startedAtMs, endedAtMs: startedAtMs + 30_000 }),
    {
      delay: async () => {},
      invalidateShotMutation: async () => {},
      loadFirstShots: async () => ({ records: [completed], total: 1 }),
      loadLatestShotCandidates: async () => [],
      stillRelevant: () => true
    },
    [0]
  );

  equal(result.type, 'completed');
  equal(result.type === 'completed' ? result.shot.id : null, 'completed');
});

await run('wait for completed live shot falls back to latest candidates on final poll only', async () => {
  const fallback = shot('gateway-lagged', 'not-a-date');
  let latestLoads = 0;
  const result = await waitForCompletedLiveShot(
    completionContext({
      previousShotIds: new Set(['previous']),
      startedAtMs: Date.parse('2026-06-07T10:00:00.000Z')
    }),
    {
      delay: async () => {},
      invalidateShotMutation: async () => {},
      loadFirstShots: async () => ({ records: [], total: 0 }),
      loadLatestShotCandidates: async () => {
        latestLoads += 1;
        return [fallback];
      },
      stillRelevant: () => true
    },
    [0, 0]
  );

  equal(latestLoads, 2);
  equal(result.type, 'completed');
  equal(result.type === 'completed' ? result.shot.id : null, 'gateway-lagged');
});

await run('wait for completed live shot aborts stale polling before loading records', async () => {
  let loaded = false;
  const result = await waitForCompletedLiveShot(
    completionContext({ startedAtMs: Date.parse('2026-06-07T10:00:00.000Z') }),
    {
      delay: async () => {},
      invalidateShotMutation: async () => {},
      loadFirstShots: async () => {
        loaded = true;
        return { records: [], total: 0 };
      },
      loadLatestShotCandidates: async () => [],
      stillRelevant: () => false
    },
    [0]
  );

  equal(result.type, 'aborted');
  equal(loaded, false);
});

await run('wait for completed live shot returns fallback records after exhausted polling', async () => {
  const existing = shot('existing', '2026-06-07T09:58:00.000Z');
  const result = await waitForCompletedLiveShot(
    completionContext({
      previousShotIds: new Set(['existing']),
      startedAtMs: Date.parse('2026-06-07T10:00:00.000Z')
    }),
    {
      delay: async () => {},
      invalidateShotMutation: async () => {},
      loadFirstShots: async () => ({ records: [existing], total: 7 }),
      loadLatestShotCandidates: async () => [existing],
      stillRelevant: () => true
    },
    [0]
  );

  equal(result.type, 'fallback');
  equal(result.type === 'fallback' ? result.records[0]?.id : null, 'existing');
  equal(result.type === 'fallback' ? result.total : null, 7);
});

await run('include shot in history de-dupes and respects page limit', () => {
  const updated = shot('b', '2026-06-07T10:00:01.000Z');
  const history = includeShotInHistory([
    shot('a', '2026-06-07T10:00:00.000Z'),
    shot('b', '2026-06-07T09:59:00.000Z'),
    shot('c', '2026-06-07T09:58:00.000Z')
  ], updated, 2);

  deepEqual(history.map((item) => item.id), ['b', 'a']);
});

function completionContext(overrides: Partial<LiveShotCompletionContext> = {}): LiveShotCompletionContext {
  return {
    previousShotIds: new Set(),
    startedAtMs: null,
    endedAtMs: null,
    optimisticShot: null,
    ...overrides
  };
}

function shot(id: string, timestamp: string): ShotRecord {
  return {
    id,
    timestamp,
    workflow: null,
    annotations: null,
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

function deepEqual<T>(actual: T, expected: T): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`);
  }
}
