import type { ShotSummary } from '../api/types';
import { decentUploadFact, decentUploadLabel, decentUploadTitle } from '../domain/shotUpload';

interface TestCase {
  name: string;
  fn: () => void | Promise<void>;
}

const tests: TestCase[] = [];

run('reads an uploaded marker with its unix-seconds timestamp', () => {
  const fact = decentUploadFact(shotWithExtras({ uploaded_to_decent: 1_756_300_000 }));
  if (fact?.kind !== 'uploaded') throw new Error('expected an uploaded fact');
  equal(fact.at?.toISOString(), new Date(1_756_300_000 * 1000).toISOString());
  equal(decentUploadLabel(fact), 'Uploaded to Decent');
  equal(decentUploadTitle(fact).startsWith('Uploaded to Decent · '), true);
});

run('tolerates a millisecond timestamp and a truthy non-number marker', () => {
  const ms = decentUploadFact(shotWithExtras({ uploaded_to_decent: 1_756_300_000_000 }));
  if (ms?.kind !== 'uploaded') throw new Error('expected an uploaded fact');
  equal(ms.at?.toISOString(), new Date(1_756_300_000_000).toISOString());

  const junk = decentUploadFact(shotWithExtras({ uploaded_to_decent: 'yes' }));
  if (junk?.kind !== 'uploaded') throw new Error('truthy junk still marks uploaded');
  equal(junk.at, null);
  equal(decentUploadTitle(junk), 'Uploaded to Decent'); // no date claimed
});

run('reads a rejection with HTTP status and timestamp', () => {
  const fact = decentUploadFact(
    shotWithExtras({ decent_upload_rejected: { status: 422, timestamp: 1_756_200_000 } })
  );
  if (fact?.kind !== 'rejected') throw new Error('expected a rejected fact');
  equal(fact.httpStatus, 422);
  equal(fact.at?.toISOString(), new Date(1_756_200_000 * 1000).toISOString());
  equal(decentUploadLabel(fact), 'Decent upload rejected');
  equal(decentUploadTitle(fact).startsWith('Decent upload rejected (HTTP 422) · '), true);
});

run('rejection without a usable status or time still reports the fact', () => {
  const fact = decentUploadFact(shotWithExtras({ decent_upload_rejected: { status: 'bad' } }));
  if (fact?.kind !== 'rejected') throw new Error('expected a rejected fact');
  equal(fact.httpStatus, null);
  equal(fact.at, null);
  equal(decentUploadTitle(fact), 'Decent upload rejected');
});

run('uploaded wins over a stale rejection marker', () => {
  const fact = decentUploadFact(
    shotWithExtras({
      uploaded_to_decent: 1_756_300_000,
      decent_upload_rejected: { status: 400, timestamp: 1_756_200_000 }
    })
  );
  equal(fact?.kind, 'uploaded');
});

run('cleared or absent markers yield no fact', () => {
  equal(decentUploadFact(shotWithExtras({})), null);
  equal(decentUploadFact(shotWithExtras({ decent_upload_rejected: null })), null);
  equal(decentUploadFact(shotWithExtras({ uploaded_to_decent: 0 })), null);
  equal(decentUploadFact({ id: 's', timestamp: '2026-08-27T08:00:00.000Z' }), null);
  equal(
    decentUploadFact({ id: 's', timestamp: '2026-08-27T08:00:00.000Z', annotations: { extras: null } }),
    null
  );
});

for (const test of tests) {
  try {
    await test.fn();
    console.log(`ok - ${test.name}`);
  } catch (error) {
    console.error(`not ok - ${test.name}`);
    throw error;
  }
}

function run(name: string, fn: () => void | Promise<void>): void {
  tests.push({ name, fn });
}

function equal<T>(actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  }
}

function shotWithExtras(extras: Record<string, unknown>): ShotSummary {
  return {
    id: 'shot-upload-test',
    timestamp: '2026-08-27T08:00:00.000Z',
    annotations: { extras }
  };
}
