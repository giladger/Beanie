import { OperationAuthority } from '../runtime/operationAuthority';

await run('a newer semantic operation owns the only commit gate', () => {
  const authority = new OperationAuthority();
  const first = authority.begin('bean:a');
  const second = authority.begin('bean:b');
  const commits: string[] = [];

  equal(first.signal.aborted, true);
  equal(first.commit(() => commits.push('first')).status, 'stale');
  equal(second.commit(() => commits.push('second')).status, 'committed');
  deepEqual(commits, ['second']);
});

await run('finish cannot release a newer owner', () => {
  const authority = new OperationAuthority();
  const first = authority.begin('first');
  const second = authority.begin('second');
  first.finish();
  equal(second.isCurrent, true);
  second.finish();
  equal(second.isCurrent, false);
  equal(authority.currentSubjectKey, null);
});

await run('invalidation and disposal abort cleanup while token ownership guards correctness', () => {
  const authority = new OperationAuthority();
  const invalidated = authority.begin('scanner');
  authority.invalidate();
  equal(invalidated.signal.aborted, true);
  equal(invalidated.isCurrent, false);

  const disposed = authority.begin('profile');
  authority.dispose();
  equal(disposed.signal.aborted, true);
  equal(disposed.commit(() => 'late').status, 'stale');
  const late = authority.begin('late');
  equal(late.isCurrent, false);
  equal(late.signal.aborted, true);
});

await run('commit rejects async transitions before their synchronous prefix can mutate', () => {
  const authority = new OperationAuthority();
  const lease = authority.begin('atomic');
  let mutated = false;
  const asyncTransition = async (): Promise<void> => {
    mutated = true;
  };
  throws(
    () => lease.commit(asyncTransition as unknown as () => void),
    'must be synchronous'
  );
  equal(mutated, false);
});

async function run(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

function throws(fn: () => void, message: string): void {
  try {
    fn();
  } catch (error) {
    if (error instanceof Error && error.message.includes(message)) return;
    throw error;
  }
  throw new Error(`Expected error containing ${message}`);
}

function equal<T>(actual: T, expected: T): void {
  if (actual !== expected) throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
}

function deepEqual(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}
