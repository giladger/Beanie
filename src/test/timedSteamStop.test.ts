import {
  timedSteamAutoPurgeDelayMs,
  timedSteamTargetReached
} from '../domain/timedSteamStop';

run('schedules auto purge at the configured actual-steam duration', () => {
  equal(
    timedSteamAutoPurgeDelayMs({
      service: 'steam',
      phase: 'active',
      startedAtMs: 1_000,
      purgeRequested: false,
      targetSeconds: 30,
      nowMs: 10_000
    }),
    30_000 - 9_000
  );
});

run('fires immediately when Beanie notices steam after the deadline', () => {
  equal(
    timedSteamAutoPurgeDelayMs({
      service: 'steam',
      phase: 'active',
      startedAtMs: 1_000,
      purgeRequested: false,
      targetSeconds: 30,
      nowMs: 31_000
    }),
    0
  );
});

run('does not schedule when Beanie already requested the purge', () => {
  equal(
    timedSteamAutoPurgeDelayMs({
      service: 'steam',
      phase: 'active',
      startedAtMs: 1_000,
      purgeRequested: true,
      targetSeconds: 30,
      nowMs: 10_000
    }),
    null
  );
});

run('does not schedule disabled or non-steam services', () => {
  equal(
    timedSteamAutoPurgeDelayMs({
      service: 'hotWater',
      phase: 'active',
      startedAtMs: 1_000,
      purgeRequested: false,
      targetSeconds: 30,
      nowMs: 10_000
    }),
    null
  );
  equal(
    timedSteamAutoPurgeDelayMs({
      service: 'steam',
      phase: 'active',
      startedAtMs: 1_000,
      purgeRequested: false,
      targetSeconds: 0,
      nowMs: 10_000
    }),
    null
  );
});

run('does not schedule while steam is still heating or already purging', () => {
  equal(
    timedSteamAutoPurgeDelayMs({
      service: 'steam',
      phase: 'starting',
      startedAtMs: null,
      purgeRequested: false,
      targetSeconds: 30,
      nowMs: 10_000
    }),
    null
  );
  equal(
    timedSteamAutoPurgeDelayMs({
      service: 'steam',
      phase: 'purging',
      startedAtMs: 1_000,
      purgeRequested: false,
      targetSeconds: 30,
      nowMs: 10_000
    }),
    null
  );
});

run('detects when firmware ended steam after the Beanie target', () => {
  equal(
    timedSteamTargetReached({
      startedAtMs: 1_000,
      targetSeconds: 30,
      nowMs: 31_000
    }),
    true
  );
  equal(
    timedSteamTargetReached({
      startedAtMs: 1_000,
      targetSeconds: 30,
      nowMs: 30_500
    }),
    false
  );
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
