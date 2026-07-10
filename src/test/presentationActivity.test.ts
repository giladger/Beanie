import { PresentationActivityCoordinator } from '../runtime/presentationActivity';

run('presentation activity suspends in reverse order and resumes in mount order', () => {
  const activity = new PresentationActivityCoordinator();
  const calls: string[] = [];
  activity.add({ suspend: () => calls.push('suspend:first'), resume: () => calls.push('resume:first') });
  activity.add({ suspend: () => calls.push('suspend:second'), resume: () => calls.push('resume:second') });

  activity.setSuspended(true);
  activity.setSuspended(true);
  activity.setSuspended(false);

  deepEqual(calls, ['suspend:second', 'suspend:first', 'resume:first', 'resume:second']);
});

run('presentation activity applies current state to late targets and releases registrations', () => {
  const activity = new PresentationActivityCoordinator();
  const calls: string[] = [];
  activity.setSuspended(true);
  const registration = activity.add({
    suspend: () => calls.push('suspend'),
    resume: () => calls.push('resume')
  });
  registration.dispose();
  activity.setSuspended(false);

  deepEqual(calls, ['suspend']);
});

run('presentation activity disposal leaves every target suspended', () => {
  const activity = new PresentationActivityCoordinator();
  const calls: string[] = [];
  activity.add({ suspend: () => calls.push('suspend'), resume: () => calls.push('resume') });
  activity.dispose();
  activity.dispose();
  activity.setSuspended(false);

  deepEqual(calls, ['suspend']);
  equal(activity.isSuspended, true);
});

run('one broken target cannot strand the remaining lifecycle owners', () => {
  const calls: string[] = [];
  const errors: unknown[] = [];
  const activity = new PresentationActivityCoordinator({ onTargetError: (error) => errors.push(error) });
  activity.add({
    suspend: () => calls.push('suspend:first'),
    resume: () => calls.push('resume:first')
  });
  activity.add({
    suspend: () => {
      calls.push('suspend:broken');
      throw new Error('broken suspend');
    },
    resume: () => {
      calls.push('resume:broken');
      throw new Error('broken resume');
    }
  });
  activity.add({
    suspend: () => calls.push('suspend:last'),
    resume: () => calls.push('resume:last')
  });

  activity.setSuspended(true);
  activity.setSuspended(false);

  deepEqual(calls, [
    'suspend:last',
    'suspend:broken',
    'suspend:first',
    'resume:first',
    'resume:broken',
    'resume:last'
  ]);
  equal(errors.length, 2);
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
  if (actual !== expected) throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
}

function deepEqual(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}
