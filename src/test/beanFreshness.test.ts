import type { BeanBatch, BeanBatchStorageEvent } from '../api/types';
import {
  appendBatchStorageEvent,
  batchStorageEvents,
  batchStorageState,
  computeBeanFreshness,
  editLastBatchStorageEventDate,
  freshnessBadgeLabel,
  freshnessSnapshotForShot,
  shotFreshnessBadgeLabel,
  storageStatusLabel
} from '../domain/beanFreshness';
import { dateInputValue } from '../domain/beanDisplay';

const ROAST = '2026-01-01T00:00:00.000Z';
const NOW = new Date('2026-01-31T00:00:00.000Z'); // 30 days off roast

await run('compute bean freshness requires a parseable, non-future roast date', () => {
  equal(computeBeanFreshness(null, NOW), null);
  equal(computeBeanFreshness(batch(), NOW), null);
  equal(computeBeanFreshness(batch({ roastDate: 'not-a-date' }), NOW), null);
  equal(computeBeanFreshness(batch({ roastDate: '2026-02-15T00:00:00.000Z' }), NOW), null);
});

await run('compute bean freshness reports ambient batches with equal roast and active ages', () => {
  const freshness = computeBeanFreshness(batch({ roastDate: ROAST }), NOW);

  equal(freshness?.roastDate, ROAST);
  equal(freshness?.roastAgeDays, 30);
  equal(freshness?.activeAgeDays, 30);
  equal(freshness?.storageState, 'ambient');
  equal(freshness?.frozenIntervals.length, 0);
  equal(freshness?.thawedAt, null);
  equal(typeof freshness?.dateText, 'string');
});

await run('compute bean freshness subtracts a simple freeze-thaw interval', () => {
  const freshness = computeBeanFreshness(
    batch({
      roastDate: ROAST,
      storageEvents: [frozen('2026-01-11T00:00:00.000Z'), thawed('2026-01-21T00:00:00.000Z')]
    }),
    NOW
  );

  equal(freshness?.roastAgeDays, 30);
  equal(freshness?.activeAgeDays, 20);
  equal(freshness?.storageState, 'thawed');
  equal(freshness?.thawedAt, '2026-01-21T00:00:00.000Z');
  equal(freshness?.frozenIntervals.length, 1);
  equal(freshness?.frozenIntervals[0]?.frozenAt, '2026-01-11T00:00:00.000Z');
  equal(freshness?.frozenIntervals[0]?.thawedAt, '2026-01-21T00:00:00.000Z');
});

await run('compute bean freshness keeps the earlier start for double-frozen events', () => {
  // Other gateway clients can write frozen→frozen without a thaw in between;
  // the first freeze must not be discarded.
  const freshness = computeBeanFreshness(
    batch({
      roastDate: ROAST,
      storageEvents: [
        frozen('2026-01-11T00:00:00.000Z'),
        frozen('2026-01-16T00:00:00.000Z'),
        thawed('2026-01-21T00:00:00.000Z')
      ]
    }),
    NOW
  );

  equal(freshness?.frozenIntervals.length, 1);
  equal(freshness?.frozenIntervals[0]?.frozenAt, '2026-01-11T00:00:00.000Z');
  equal(freshness?.frozenIntervals[0]?.thawedAt, '2026-01-21T00:00:00.000Z');
  equal(freshness?.activeAgeDays, 20);
});

await run('compute bean freshness keeps an open freeze interval running until now', () => {
  const freshness = computeBeanFreshness(
    batch({ roastDate: ROAST, storageEvents: [frozen('2026-01-11T00:00:00.000Z')] }),
    NOW
  );

  equal(freshness?.roastAgeDays, 30);
  equal(freshness?.activeAgeDays, 10);
  equal(freshness?.storageState, 'frozen');
  equal(freshness?.frozenIntervals.length, 1);
  equal(freshness?.frozenIntervals[0]?.thawedAt, null);
  equal(freshness?.thawedAt, null);
});

await run('compute bean freshness sorts out-of-order storage events chronologically', () => {
  const freshness = computeBeanFreshness(
    batch({
      roastDate: ROAST,
      storageEvents: [thawed('2026-01-21T00:00:00.000Z'), frozen('2026-01-11T00:00:00.000Z')]
    }),
    NOW
  );

  equal(freshness?.activeAgeDays, 20);
  equal(freshness?.storageState, 'thawed');
  equal(freshness?.frozenIntervals[0]?.frozenAt, '2026-01-11T00:00:00.000Z');
  equal(freshness?.frozenIntervals[0]?.thawedAt, '2026-01-21T00:00:00.000Z');
});

await run('compute bean freshness ignores future and unparseable events', () => {
  const freshness = computeBeanFreshness(
    batch({
      roastDate: ROAST,
      storageEvents: [
        { type: 'frozen', at: 'not-a-date' } as BeanBatchStorageEvent,
        frozen('2026-01-11T00:00:00.000Z'),
        thawed('2026-02-10T00:00:00.000Z') // after `now` — not yet effective
      ]
    }),
    NOW
  );

  equal(freshness?.activeAgeDays, 10);
  equal(freshness?.frozenIntervals.length, 1);
  equal(freshness?.frozenIntervals[0]?.thawedAt, null);
});

await run('compute bean freshness clamps freezes that started before roast', () => {
  const freshness = computeBeanFreshness(
    batch({
      roastDate: ROAST,
      storageEvents: [frozen('2025-12-25T00:00:00.000Z'), thawed('2026-01-11T00:00:00.000Z')]
    }),
    NOW
  );

  // Frozen time only counts from the roast date onward (10 days, not 17).
  equal(freshness?.activeAgeDays, 20);
});

await run('batch storage state derives from events with legacy frozen-flag fallback', () => {
  equal(batchStorageState(batch()), 'ambient');
  equal(batchStorageState(batch({ frozen: true })), 'frozen');
  equal(batchStorageState(batch({ storageEvents: [frozen('2026-01-11T00:00:00.000Z')] })), 'frozen');
  equal(
    batchStorageState(
      batch({ storageEvents: [frozen('2026-01-11T00:00:00.000Z'), thawed('2026-01-21T00:00:00.000Z')] })
    ),
    'thawed'
  );
  equal(batchStorageState(batch({ storageEvents: 'junk' as unknown as BeanBatchStorageEvent[] })), 'ambient');
});

await run('append batch storage event collapses repeated event types', () => {
  const once = appendBatchStorageEvent(batch(), 'frozen', new Date('2026-01-11T00:00:00.000Z'));
  equal(once.storageEvents?.length, 1);
  equal(once.frozen, true);

  const repeated = appendBatchStorageEvent(
    batch({ storageEvents: once.storageEvents }),
    'frozen',
    new Date('2026-01-12T00:00:00.000Z')
  );
  equal(repeated.storageEvents?.length, 1);
  equal(repeated.storageEvents?.[0]?.at, '2026-01-12T00:00:00.000Z');

  const thawedNext = appendBatchStorageEvent(
    batch({ storageEvents: repeated.storageEvents }),
    'thawed',
    new Date('2026-01-21T00:00:00.000Z')
  );
  equal(thawedNext.storageEvents?.length, 2);
  equal(thawedNext.frozen, false);
});

await run('edit last batch storage event date keeps the event type and time of day', () => {
  const source = batch({ storageEvents: [frozen('2026-01-11T08:30:00.000Z')] });
  const edited = editLastBatchStorageEventDate(source, '2026-01-05');

  equal(edited.frozen, true);
  equal(edited.storageEvents?.length, 1);
  // The typed day is applied in UTC and the original UTC time of day is kept,
  // so the stored instant's calendar date matches exactly what was typed.
  equal(edited.storageEvents![0]!.at, '2026-01-05T08:30:00.000Z');

  equal(Object.keys(editLastBatchStorageEventDate(batch(), '2026-01-05')).length, 0);
});

await run('re-saving a storage date without changing it does not drift the day', () => {
  // A late-UTC time of day is the case the old local/UTC mismatch shifted by a
  // day on each save. Re-save the same shown date repeatedly; it must stay put.
  let current = batch({ storageEvents: [frozen('2026-06-27T21:30:00.000Z')] });
  for (let i = 0; i < 5; i++) {
    const shown = dateInputValue(current.storageEvents![0]!.at);
    const next = editLastBatchStorageEventDate(current, shown);
    current = batch({ storageEvents: next.storageEvents });
  }
  equal(dateInputValue(current.storageEvents![0]!.at), '2026-06-27');
});

await run('freshness snapshot for shot drops the date text and uses the shot timestamp', () => {
  const snapshot = freshnessSnapshotForShot(
    batch({ roastDate: ROAST, storageEvents: [frozen('2026-01-11T00:00:00.000Z')] }),
    '2026-01-31T00:00:00.000Z'
  );

  equal(snapshot?.roastAgeDays, 30);
  equal(snapshot?.activeAgeDays, 10);
  equal(snapshot?.storageState, 'frozen');
  equal('dateText' in (snapshot ?? {}), false);
});

await run('freshness badge labels collapse to roast age for plain ambient batches', () => {
  equal(freshnessBadgeLabel(batch({ roastDate: ROAST }), NOW), '30d');
  equal(
    freshnessBadgeLabel(
      batch({
        roastDate: ROAST,
        storageEvents: [frozen('2026-01-11T00:00:00.000Z'), thawed('2026-01-21T00:00:00.000Z')]
      }),
      NOW
    ),
    '30d · 20a'
  );
});

await run('shot freshness badge reads stamped metadata defensively', () => {
  equal(shotFreshnessBadgeLabel(null), null);
  equal(shotFreshnessBadgeLabel({ freshness: 'oops' }), null);
  equal(shotFreshnessBadgeLabel({ freshness: { roastAgeDays: 12 } }), '12d');
  equal(shotFreshnessBadgeLabel({ freshness: { roastAgeDays: 12, activeAgeDays: 12 } }), '12d');
  equal(
    shotFreshnessBadgeLabel({ freshness: { roastAgeDays: 12, activeAgeDays: 12, storageState: 'frozen' } }),
    '12d · 12a'
  );
  equal(shotFreshnessBadgeLabel({ freshness: { roastAgeDays: 12, activeAgeDays: 5 } }), '12d · 5a');
});

await run('storage status label reports frozen and thawed recency', () => {
  equal(storageStatusLabel(batch(), NOW), null);
  equal(storageStatusLabel(batch({ frozen: true }), NOW), 'frozen');
  equal(
    storageStatusLabel(batch({ storageEvents: [frozen('2026-01-30T00:00:00.000Z')] }), NOW),
    'frozen 1d ago'
  );
  equal(
    storageStatusLabel(
      batch({ storageEvents: [frozen('2026-01-11T00:00:00.000Z'), thawed('2026-01-29T00:00:00.000Z')] }),
      NOW
    ),
    'thawed 2d ago'
  );
});

await run('batch storage events filter junk entries and sort by time', () => {
  const events = batchStorageEvents(
    batch({
      storageEvents: [
        thawed('2026-01-21T00:00:00.000Z'),
        { type: 'unknown', at: '2026-01-01T00:00:00.000Z' } as unknown as BeanBatchStorageEvent,
        { type: 'frozen', at: 12 } as unknown as BeanBatchStorageEvent,
        frozen('2026-01-11T00:00:00.000Z')
      ]
    })
  );

  deepEqual(events.map((event) => event.type), ['frozen', 'thawed']);
});

function batch(overrides: Partial<BeanBatch> = {}): BeanBatch {
  return {
    id: 'batch-1',
    beanId: 'bean-1',
    ...overrides
  };
}

function frozen(at: string): BeanBatchStorageEvent {
  return { type: 'frozen', at };
}

function thawed(at: string): BeanBatchStorageEvent {
  return { type: 'thawed', at };
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
