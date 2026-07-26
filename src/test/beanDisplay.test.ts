import type { Bean, BeanBatch } from '../api/types';
import {
  batchOptionLabel,
  dateInputValue,
  recentBatches,
  rotationBeans,
  type RotationInput
} from '../domain/beanDisplay';

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

run('rotationBeans pins favorites in star order before recency fill', () => {
  const result = rotationBeans(rotation({
    favoriteBeanIds: ['fav-old', 'fav-new'],
    recentBeanIds: ['recent', 'fav-new', 'other']
  }));

  equal(result.map((bean) => bean.id).join(','), 'fav-old,fav-new');
});

run('rotationBeans excludes the selected bean and fills from selection history', () => {
  const result = rotationBeans(rotation({
    selectedBeanId: 'fav-old',
    favoriteBeanIds: ['fav-old'],
    recentBeanIds: ['fav-old', 'recent', 'other']
  }));

  // Recency chooses the fills; display order is by name ("Bean other" sorts
  // before "Bean recent") so slots don't trade places after every switch.
  equal(result.map((bean) => bean.id).join(','), 'other,recent');
});

run('rotationBeans drops beans whose known bags are all finished, keeps unknown stock', () => {
  const result = rotationBeans(rotation({
    favoriteBeanIds: ['fav-old', 'fav-new'],
    recentBeanIds: ['recent'],
    batchesByBean: {
      // Every known bag finished: the pinned bean leaves its slot.
      'fav-old': [batch('a', null, 2)],
      // A live bag keeps the slot; no data at all also keeps it.
      'fav-new': [batch('b', null, 2), batch('c', null, 180)]
    }
  }));

  equal(result.map((bean) => bean.id).join(','), 'fav-new,recent');
});

run('rotationBeans falls back to shot usage when the selection history is empty', () => {
  const result = rotationBeans(rotation({
    recentBeanIds: [],
    beanUsageAt: { other: 30, recent: 20, 'fav-old': 10 }
  }));

  equal(result.map((bean) => bean.id).join(','), 'other,recent');
});

run('rotationBeans skips archived or unknown beans and honors the limit', () => {
  const result = rotationBeans(rotation({
    favoriteBeanIds: ['gone', 'archived', 'fav-new'],
    recentBeanIds: ['recent', 'other'],
    limit: 3
  }));

  equal(result.map((bean) => bean.id).join(','), 'fav-new,other,recent');
});

run('rotationBeans keeps fill slots in name order even when recency reshuffles', () => {
  const onZebra = rotationBeans(rotation({
    beans: [bean('alpha'), bean('mid'), bean('zebra')],
    selectedBeanId: 'zebra',
    recentBeanIds: ['zebra', 'mid', 'alpha']
  }));
  equal(onZebra.map((item) => item.id).join(','), 'alpha,mid');

  // Switch to mid: alpha keeps its first slot; zebra takes the freed one.
  const onMid = rotationBeans(rotation({
    beans: [bean('alpha'), bean('mid'), bean('zebra')],
    selectedBeanId: 'mid',
    recentBeanIds: ['mid', 'zebra', 'alpha']
  }));
  equal(onMid.map((item) => item.id).join(','), 'alpha,zebra');
});

function rotation(overrides: Partial<RotationInput>): RotationInput {
  return {
    beans: [
      bean('fav-old'),
      bean('fav-new'),
      bean('recent'),
      bean('other'),
      { ...bean('archived'), archived: true }
    ],
    selectedBeanId: 'selected',
    favoriteBeanIds: [],
    recentBeanIds: [],
    beanUsageAt: {},
    batchesByBean: {},
    ...overrides
  };
}

function bean(id: string): Bean {
  return { id, roaster: 'Roaster', name: `Bean ${id}` };
}

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
