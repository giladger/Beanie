import { rebaseChangedFields } from '../domain/rebaseMutation';

run('rebases only locally changed fields onto the latest authoritative object', () => {
  const base = { enjoyment: 3, notes: 'base', extras: { derek: 'old' } };
  const desired = { ...base, enjoyment: 4 };
  const latest = { ...base, notes: 'remote', extras: { derek: 'new' } };

  deepEqual(rebaseChangedFields(base, desired, latest), {
    enjoyment: 4,
    notes: 'remote',
    extras: { derek: 'new' }
  });
});

run('new local fields apply while new remote fields survive', () => {
  deepEqual(
    rebaseChangedFields(
      { score: 1 },
      { score: 1, barista: 'Gilad' },
      { score: 2, remoteRevision: 7 }
    ),
    { score: 2, remoteRevision: 7, barista: 'Gilad' }
  );
});

run('without an authoritative latest object the desired snapshot is returned', () => {
  const desired = { score: 5 };
  equal(rebaseChangedFields({ score: 1 }, desired, null), desired);
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

function equal<Value>(actual: Value, expected: Value): void {
  if (actual !== expected) throw new Error('Expected the same value');
}

function deepEqual(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}
