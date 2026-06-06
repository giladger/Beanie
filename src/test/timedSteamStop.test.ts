import {
  MAX_STEAM_DURATION_SECONDS,
  STEAM_DURATION_MACHINE_HEADROOM_SECONDS,
  paddedSteamDurationSeconds,
  timedSteamStopDelayMs
} from '../domain/timedSteamStop';

run('schedules idle stop at the configured actual-steam duration', () => {
  equal(
    timedSteamStopDelayMs({
      service: 'steam',
      phase: 'active',
      startedAtMs: 1_000,
      stopRequested: false,
      targetSeconds: 30,
      nowMs: 10_000
    }),
    30_000 - 9_000
  );
});

run('fires immediately when Beanie notices steam after the deadline', () => {
  equal(
    timedSteamStopDelayMs({
      service: 'steam',
      phase: 'active',
      startedAtMs: 1_000,
      stopRequested: false,
      targetSeconds: 30,
      nowMs: 31_000
    }),
    0
  );
});

run('does not schedule when Beanie already requested the stop', () => {
  equal(
    timedSteamStopDelayMs({
      service: 'steam',
      phase: 'active',
      startedAtMs: 1_000,
      stopRequested: true,
      targetSeconds: 30,
      nowMs: 10_000
    }),
    null
  );
});

run('does not schedule disabled or non-steam services', () => {
  equal(
    timedSteamStopDelayMs({
      service: 'hotWater',
      phase: 'active',
      startedAtMs: 1_000,
      stopRequested: false,
      targetSeconds: 30,
      nowMs: 10_000
    }),
    null
  );
  equal(
    timedSteamStopDelayMs({
      service: 'steam',
      phase: 'active',
      startedAtMs: 1_000,
      stopRequested: false,
      targetSeconds: 0,
      nowMs: 10_000
    }),
    null
  );
});

run('does not schedule while steam is still heating or already purging', () => {
  equal(
    timedSteamStopDelayMs({
      service: 'steam',
      phase: 'starting',
      startedAtMs: null,
      stopRequested: false,
      targetSeconds: 30,
      nowMs: 10_000
    }),
    null
  );
  equal(
    timedSteamStopDelayMs({
      service: 'steam',
      phase: 'purging',
      startedAtMs: 1_000,
      stopRequested: false,
      targetSeconds: 30,
      nowMs: 10_000
    }),
    null
  );
});

run('pads the machine steam max duration without changing the Beanie target', () => {
  equal(paddedSteamDurationSeconds(50), 50 + STEAM_DURATION_MACHINE_HEADROOM_SECONDS);
  equal(paddedSteamDurationSeconds(MAX_STEAM_DURATION_SECONDS - 1), MAX_STEAM_DURATION_SECONDS);
  equal(paddedSteamDurationSeconds(0), null);
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
