import type { BeanBatch } from '../api/types';
import {
  appendPendingDose,
  readPendingDoses,
  resolvePendingDose,
  writePendingDoses,
  type PendingDose
} from '../domain/pendingDoses';

function entry(overrides: Partial<PendingDose> = {}): PendingDose {
  return {
    batchId: 'batch-1',
    beanId: 'bean-1',
    dose: 18,
    expectedRemaining: 82,
    at: '2026-07-06T08:00:00.000Z',
    ...overrides
  };
}

function batch(weightRemaining: number | null | undefined): BeanBatch {
  return { id: 'batch-1', beanId: 'bean-1', weightRemaining };
}

class FakeStorage {
  private items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
  get size(): number {
    return this.items.size;
  }
}

run('pending doses round-trip through storage and drop malformed entries', () => {
  const storage = new FakeStorage();
  writePendingDoses([entry()], storage);
  const read = readPendingDoses(storage);
  equal(read.length, 1);
  equal(read[0]!.batchId, 'batch-1');
  equal(read[0]!.dose, 18);

  storage.setItem(
    'beanie:pending-dose-deductions-v1',
    JSON.stringify([entry(), { batchId: 'x' }, 'junk'])
  );
  equal(readPendingDoses(storage).length, 1);

  storage.setItem('beanie:pending-dose-deductions-v1', 'not json');
  equal(readPendingDoses(storage).length, 0);
});

run('writing an empty queue removes the storage key', () => {
  const storage = new FakeStorage();
  writePendingDoses([entry()], storage);
  writePendingDoses([], storage);
  equal(storage.size, 0);
});

run('appendPendingDose prunes stale entries and caps the queue', () => {
  const now = new Date('2026-07-06T10:00:00.000Z');
  const stale = entry({ at: '2026-06-01T10:00:00.000Z' });
  const fresh = entry({ at: '2026-07-05T10:00:00.000Z', batchId: 'batch-2' });
  const appended = appendPendingDose([stale, fresh], entry({ batchId: 'batch-3' }), now);
  equal(appended.length, 2);
  equal(appended[0]!.batchId, 'batch-2');
  equal(appended[1]!.batchId, 'batch-3');

  const many = Array.from({ length: 25 }, (_, index) =>
    entry({ batchId: `batch-${index}`, at: now.toISOString() })
  );
  const capped = appendPendingDose(many, entry({ batchId: 'batch-newest' }), now);
  equal(capped.length, 20);
  equal(capped[capped.length - 1]!.batchId, 'batch-newest');
});

run('resolvePendingDose deducts from the batch as the gateway has it now', () => {
  const resolution = resolvePendingDose(entry({ dose: 18, expectedRemaining: 82 }), batch(200));
  equal(resolution.action, 'apply');
  if (resolution.action === 'apply') equal(resolution.weightRemaining, 182);
});

run('resolvePendingDose never deducts below zero and rounds to a decigram', () => {
  const floored = resolvePendingDose(entry({ dose: 18, expectedRemaining: 82 }), batch(10));
  if (floored.action === 'apply') equal(floored.weightRemaining, 0);
  else throw new Error('expected apply');

  const rounded = resolvePendingDose(entry({ dose: 18.25, expectedRemaining: 82 }), batch(100.5));
  if (rounded.action === 'apply') equal(rounded.weightRemaining, 82.3);
  else throw new Error('expected apply');
});

run('resolvePendingDose drops a deduction whose write actually landed', () => {
  equal(resolvePendingDose(entry({ expectedRemaining: 82 }), batch(82)).action, 'drop');
  equal(resolvePendingDose(entry({ expectedRemaining: 82 }), batch(82.04)).action, 'drop');
});

run('resolvePendingDose drops deleted and untracked bags', () => {
  equal(resolvePendingDose(entry(), null).action, 'drop');
  equal(resolvePendingDose(entry(), batch(null)).action, 'drop');
  equal(resolvePendingDose(entry(), batch(undefined)).action, 'drop');
});

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
