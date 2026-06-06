import {
  bumpShots,
  cleaningDue,
  markCleaned,
  resolveCleaningProfile,
  type CleaningProfileLike,
  type CleaningState
} from '../domain/cleaning';

const profile = (id: string, title: string, beverageType?: string): CleaningProfileLike => ({
  id,
  profile: { title, beverage_type: beverageType }
});

run('resolveCleaningProfile prefers an explicit override', () => {
  const profiles = [profile('a', 'Gentle and sweet'), profile('b', 'Cleaning x5', 'cleaning')];
  equal(resolveCleaningProfile(profiles, 'a')?.id, 'a');
});

run('resolveCleaningProfile falls back to beverage_type cleaning', () => {
  const profiles = [profile('a', 'Gentle and sweet'), profile('b', 'Daily flush', 'cleaning')];
  equal(resolveCleaningProfile(profiles, null)?.id, 'b');
  // A stale override id that no longer exists is ignored.
  equal(resolveCleaningProfile(profiles, 'gone')?.id, 'b');
});

run('resolveCleaningProfile falls back to a cleaning/flush title', () => {
  const profiles = [profile('a', 'Gentle and sweet'), profile('c', 'Cleaning / forward flush ×5')];
  equal(resolveCleaningProfile(profiles, null)?.id, 'c');
});

run('resolveCleaningProfile returns null when nothing matches', () => {
  const profiles = [profile('a', 'Gentle and sweet'), profile('b', 'Rao Allongé')];
  equal(resolveCleaningProfile(profiles, null), null);
  equal(resolveCleaningProfile([], null), null);
});

run('bumpShots increments without touching the timestamp', () => {
  const state: CleaningState = { shotsSinceClean: 4, lastCleanedAt: '2026-06-01T00:00:00.000Z' };
  const next = bumpShots(state);
  equal(next.shotsSinceClean, 5);
  equal(next.lastCleanedAt, '2026-06-01T00:00:00.000Z');
  // pure: original untouched
  equal(state.shotsSinceClean, 4);
});

run('markCleaned resets the counter and stamps the time', () => {
  const next = markCleaned('2026-06-06T10:00:00.000Z');
  equal(next.shotsSinceClean, 0);
  equal(next.lastCleanedAt, '2026-06-06T10:00:00.000Z');
});

run('cleaningDue respects the threshold and the off switch', () => {
  equal(cleaningDue({ shotsSinceClean: 79, lastCleanedAt: null }, 80), false);
  equal(cleaningDue({ shotsSinceClean: 80, lastCleanedAt: null }, 80), true);
  equal(cleaningDue({ shotsSinceClean: 200, lastCleanedAt: null }, 0), false);
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
