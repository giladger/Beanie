import { OperationEpoch } from '../controllers/operationEpoch';

run('operation epochs reject stale continuations across close and reopen', () => {
  const epoch = new OperationEpoch();
  const first = epoch.begin();
  equal(epoch.owns(first), true);

  epoch.invalidate();
  equal(epoch.owns(first), false);

  const reopened = epoch.begin();
  equal(epoch.owns(first), false);
  equal(epoch.owns(reopened), true);
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
