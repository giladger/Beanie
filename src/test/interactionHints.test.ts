import {
  markSecondTapHintUsed,
  secondTapHintUsesBeforeHiding,
  shouldShowSecondTapHint
} from '../domain/interactionHints';
import { clearSyncedCache, setSyncedItem } from '../domain/settingsStore';

run('second tap hints show by default', () => {
  clearSyncedCache();

  equal(shouldShowSecondTapHint('bean'), true);
  equal(shouldShowSecondTapHint('shot'), true);
});

run('hint stays visible until used the configured number of times', () => {
  clearSyncedCache();

  for (let i = 0; i < secondTapHintUsesBeforeHiding - 1; i += 1) {
    markSecondTapHintUsed('bean');
    equal(shouldShowSecondTapHint('bean'), true);
  }

  markSecondTapHintUsed('bean');
  equal(shouldShowSecondTapHint('bean'), false);
});

run('counting one hint up does not affect the other', () => {
  clearSyncedCache();

  for (let i = 0; i < secondTapHintUsesBeforeHiding; i += 1) {
    markSecondTapHintUsed('bean');
  }

  equal(shouldShowSecondTapHint('bean'), false);
  equal(shouldShowSecondTapHint('shot'), true);
});

run('malformed hint preferences recover to defaults', () => {
  clearSyncedCache();
  setSyncedItem('beanie.second-tap-hint-v3', '{');

  equal(shouldShowSecondTapHint('bean'), true);
  equal(shouldShowSecondTapHint('shot'), true);
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
