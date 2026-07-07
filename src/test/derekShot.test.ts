import type { ShotRecord } from '../api/types';
import {
  annotationsWithAppliedTip,
  annotationsWithDerekAnswer,
  isDerekedShot,
  latestDerekAnswer,
  readShotDerek,
  type SavedDerekAnswer
} from '../domain/derekShot';

function shot(extras?: Record<string, unknown>): ShotRecord {
  return {
    id: 's1',
    timestamp: '2026-07-01T08:00:00.000Z',
    measurements: [],
    annotations: extras ? { enjoyment: 60, extras } : { enjoyment: 60 }
  };
}

function answer(at: string, text = 'Grind finer.'): SavedDerekAnswer {
  return { at, asked: 'Sour', answer: text, suggestions: [] };
}

run('answers round-trip through annotations and cap at three, newest last', () => {
  let annotations = annotationsWithDerekAnswer(shot().annotations, answer('t1'));
  annotations = annotationsWithDerekAnswer(annotations, answer('t2'));
  annotations = annotationsWithDerekAnswer(annotations, answer('t3'));
  annotations = annotationsWithDerekAnswer(annotations, answer('t4'));
  const record: ShotRecord = { ...shot(), annotations };
  const derek = readShotDerek(record);
  equal(derek.answers.length, 3);
  equal(derek.answers[0]!.at, 't2');
  equal(latestDerekAnswer(record)?.at, 't4');
  // Unrelated annotation fields survive the merge.
  equal(annotations.enjoyment, 60);
});

run('the applied tip is stored alongside answers without clobbering them', () => {
  let annotations = annotationsWithDerekAnswer(shot().annotations, answer('t1'));
  annotations = annotationsWithAppliedTip(annotations, {
    parameter: 'preinfusion_time',
    target: 13,
    unit: 's',
    summary: 'Preinfusion time 8s → 13s',
    at: 't2',
    profileId: 'p-variant'
  });
  const derek = readShotDerek({ ...shot(), annotations });
  equal(derek.answers.length, 1);
  equal(derek.applied?.parameter, 'preinfusion_time');
  equal(derek.applied?.profileId, 'p-variant');
});

run('malformed extras read as empty, never throw', () => {
  equal(readShotDerek(shot({ derek: 'junk' })).answers.length, 0);
  equal(readShotDerek(shot({ derek: { answers: [{ nope: 1 }, 'x'], applied: 7 } })).answers.length, 0);
  equal(readShotDerek(null).applied, null);
});

run('isDerekedShot spots answers, applied tips, and pulled-with tweaks', () => {
  equal(isDerekedShot(shot()), false);
  equal(isDerekedShot(shot({ derekTweak: 'Preinfusion 8s → 13s' })), true);
  const withAnswer = { ...shot(), annotations: annotationsWithDerekAnswer(shot().annotations, answer('t1')) };
  equal(isDerekedShot(withAnswer), true);
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
