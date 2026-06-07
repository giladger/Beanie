import type { BeanBatch } from '../api/types';
import { batchOptionLabel, dateInputValue, recentBatches } from '../domain/beanDisplay';

run('batchOptionLabel formats roast date and remaining weight', () => {
  includes(batchOptionLabel(batch('batch-1', '2026-06-05T10:00:00.000Z', 125.5)), '125.5g');
  equal(batchOptionLabel(batch('batch-2', null, null)), 'Batch');
});

run('recentBatches sorts newest first and limits results', () => {
  const result = recentBatches(
    [
      batch('old', '2026-01-01', null),
      batch('new', '2026-06-01', null),
      batch('middle', '2026-03-01', null)
    ],
    2
  );

  equal(result.map((item) => item.id).join(','), 'new,middle');
});

run('dateInputValue preserves yyyy-mm-dd prefixes and rejects malformed dates', () => {
  equal(dateInputValue('2026-06-05T10:00:00.000Z'), '2026-06-05');
  equal(dateInputValue('not a date'), '');
  equal(dateInputValue(null), '');
});

function batch(id: string, roastDate: string | null, weightRemaining: number | null): BeanBatch {
  return {
    id,
    beanId: 'bean-1',
    roastDate,
    weightRemaining
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
    throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  }
}

function includes(text: string, expected: string): void {
  if (!text.includes(expected)) {
    throw new Error(`Expected ${JSON.stringify(text)} to include ${expected}`);
  }
}
