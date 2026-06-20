import {
  CLEANING_WIZARD_STEPS,
  cleaningWizardBack,
  cleaningWizardNext,
  cleaningWizardOnFlushComplete,
  cleaningWizardOnPullComplete,
  cleaningWizardStepIndex,
  cleaningWizardStepKind,
  startCleaningWizard,
  type CleaningWizardState
} from '../controllers/cleaningWizardController';

function state(
  step: CleaningWizardState['step'],
  actionPending: CleaningWizardState['actionPending'] = null
): CleaningWizardState {
  return { step, actionPending, note: null };
}

run('wizard starts on the solution step with nothing pending', () => {
  const wizard = startCleaningWizard();
  equal(wizard.step, 'solution');
  equal(wizard.actionPending, null);
  equal(wizard.note, null);
});

run('step kinds map pulls, flush, done, and instructions', () => {
  equal(cleaningWizardStepKind('solution'), 'instruction');
  equal(cleaningWizardStepKind('pull-1'), 'pull');
  equal(cleaningWizardStepKind('flush'), 'flush');
  equal(cleaningWizardStepKind('pull-2'), 'pull');
  equal(cleaningWizardStepKind('done'), 'done');
});

run('next walks the full sequence and clamps at done', () => {
  let wizard = startCleaningWizard();
  const visited = [wizard.step];
  for (let i = 0; i < CLEANING_WIZARD_STEPS.length + 2; i++) {
    wizard = cleaningWizardNext(wizard);
    visited.push(wizard.step);
  }
  // First eight entries are the canonical order; everything after clamps on done.
  equal(visited.slice(0, CLEANING_WIZARD_STEPS.length).join(','), CLEANING_WIZARD_STEPS.join(','));
  equal(wizard.step, 'done');
});

run('back steps in reverse and clamps at solution', () => {
  equal(cleaningWizardBack(state('remove')).step, 'pull-1');
  equal(cleaningWizardBack(state('pull-1')).step, 'solution');
  equal(cleaningWizardBack(state('solution')).step, 'solution');
});

run('next/back clear any pending action and note', () => {
  const pending: CleaningWizardState = { step: 'pull-1', actionPending: 'pull', note: 'Refill the water tank' };
  equal(cleaningWizardNext(pending).actionPending, null);
  equal(cleaningWizardNext(pending).note, null);
  equal(cleaningWizardBack(pending).actionPending, null);
});

run('pull completion advances only the pending pull steps', () => {
  const fromPull1 = cleaningWizardOnPullComplete(state('pull-1', 'pull'));
  equal(fromPull1.type, 'advance');
  equal(fromPull1.type === 'advance' ? fromPull1.next.step : null, 'remove');

  const fromPull2 = cleaningWizardOnPullComplete(state('pull-2', 'pull'));
  equal(fromPull2.type, 'advance');
  equal(fromPull2.type === 'advance' ? fromPull2.next.step : null, 'done');
});

run('pull completion is ignored when no pull is pending or step is wrong', () => {
  equal(cleaningWizardOnPullComplete(state('pull-1', null)).type, 'stay');
  equal(cleaningWizardOnPullComplete(state('flush', 'flush')).type, 'stay');
  equal(cleaningWizardOnPullComplete(state('remove', 'pull')).type, 'stay');
});

run('flush completion advances only the pending flush step', () => {
  const fromFlush = cleaningWizardOnFlushComplete(state('flush', 'flush'));
  equal(fromFlush.type, 'advance');
  equal(fromFlush.type === 'advance' ? fromFlush.next.step : null, 'rinse-refit');

  equal(cleaningWizardOnFlushComplete(state('flush', null)).type, 'stay');
  equal(cleaningWizardOnFlushComplete(state('pull-1', 'flush')).type, 'stay');
});

run('advanced states never leave an action pending', () => {
  const advance = cleaningWizardOnPullComplete(state('pull-1', 'pull'));
  equal(advance.type === 'advance' ? advance.next.actionPending : 'x', null);
});

run('step index reflects position in the sequence', () => {
  equal(cleaningWizardStepIndex('solution'), 0);
  equal(cleaningWizardStepIndex('flush'), 3);
  equal(cleaningWizardStepIndex('done'), 6);
});

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
