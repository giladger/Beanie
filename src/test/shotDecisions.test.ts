import { readShotStateEvent } from '../api/guards';
import type { ShotStateEvent } from '../api/types';
import {
  emptyDecisionLog,
  nextDecisionLog,
  stopReasonLabel,
  type ShotDecisionLog
} from '../domain/shotDecisions';

function frame(overrides: Partial<ShotStateEvent>): ShotStateEvent {
  return {
    event: 'state',
    timestamp: '2026-07-02T10:00:00.000Z',
    shotId: 'shot-1',
    state: 'pouring',
    machineState: 'espresso',
    machineSubstate: 'pouring',
    profileFrame: 0,
    scaleConnected: true,
    scaleLost: false,
    machineHasAutonomousSAW: false,
    decision: null,
    ...overrides
  };
}

function fold(events: ShotStateEvent[]): ShotDecisionLog {
  return events.reduce(nextDecisionLog, emptyDecisionLog());
}

run('adopts the shot id from the first frame that carries one', () => {
  const log = fold([frame({})]);
  equal(log.shotId, 'shot-1');
  equal(log.stop, null);
});

run('a pure state frame leaves the log untouched (same reference)', () => {
  const log = fold([frame({})]);
  const next = nextDecisionLog(log, frame({ state: 'stopping' }));
  equal(next === log, true);
});

run('keys an app weight skip by its vacated frame with the projected weight', () => {
  const log = fold([
    frame({
      event: 'decision',
      decision: {
        kind: 'advance',
        reason: 'profileSkip',
        details: null,
        data: { frame: 1, stepExitWeight: 18, projectedWeight: 18.4 }
      }
    })
  ]);
  equal(log.advances.get(1)?.reason, 'profileSkip');
  equal(log.advances.get(1)?.weight, 18.4);
});

run('keys a firmware advance by its fromFrame', () => {
  const log = fold([
    frame({
      event: 'decision',
      decision: {
        kind: 'advance',
        reason: 'profileAdvance',
        details: null,
        data: { fromFrame: 2, toFrame: 3 }
      }
    })
  ]);
  equal(log.advances.get(2)?.reason, 'profileAdvance');
  equal(log.advances.get(2)?.weight, null);
});

run('captures the stop decision and refuses to overwrite it', () => {
  const log = fold([
    frame({
      event: 'decision',
      decision: { kind: 'stop', reason: 'targetWeight', details: null, data: null }
    }),
    frame({
      event: 'terminal',
      decision: { kind: 'terminal', reason: 'disconnected', details: null, data: null }
    })
  ]);
  equal(log.stop?.reason, 'targetWeight');
});

run('a finalize decision (stopping backstop) never becomes the stop reason', () => {
  const log = fold([
    frame({
      event: 'decision',
      decision: { kind: 'finalize', reason: 'stoppingBackstop', details: null, data: null }
    })
  ]);
  equal(log.stop, null);
});

run('a new shot id resets the log so decisions never leak across shots', () => {
  const log = fold([
    frame({
      event: 'decision',
      decision: { kind: 'stop', reason: 'targetWeight', details: null, data: null }
    }),
    frame({ shotId: 'shot-2', state: 'preheating' })
  ]);
  equal(log.shotId, 'shot-2');
  equal(log.stop, null);
  equal(log.advances.size, 0);
});

run('between-shots idle frames (null shotId) keep the ended shot readable', () => {
  const log = fold([
    frame({
      event: 'decision',
      decision: { kind: 'stop', reason: 'apiStop', details: null, data: null }
    }),
    frame({ shotId: null, state: 'idle', machineState: 'idle' })
  ]);
  equal(log.shotId, 'shot-1');
  equal(log.stop?.reason, 'apiStop');
});

run('stopReasonLabel maps known reasons and passes unknown ones through', () => {
  equal(stopReasonLabel({ kind: 'stop', reason: 'targetWeight' }), 'target weight');
  equal(stopReasonLabel({ kind: 'stop', reason: 'apiStop' }), 'stopped via API');
  equal(stopReasonLabel({ kind: 'stop', reason: 'appStop' }), 'stopped from app');
  equal(stopReasonLabel({ kind: 'stop', reason: 'machineEnded' }), 'machine stop');
  equal(stopReasonLabel({ kind: 'terminal', reason: 'disconnected' }), 'machine disconnected');
  equal(stopReasonLabel({ kind: 'stop', reason: 'someFutureReason' }), 'someFutureReason');
  equal(stopReasonLabel(null), null);
});

run('readShotStateEvent parses a gateway frame and tolerates unknown reasons', () => {
  const parsed = readShotStateEvent({
    event: 'decision',
    timestamp: '2026-07-02T10:00:00.000Z',
    shotId: 'abc',
    state: 'pouring',
    machineState: 'espresso',
    machineSubstate: 'pouring',
    profileFrame: 2,
    scaleConnected: true,
    scaleLost: false,
    machineHasAutonomousSAW: false,
    decision: { kind: 'stop', reason: 'someFutureReason', details: 'x', data: { a: 1 } }
  });
  equal(parsed.event, 'decision');
  equal(parsed.shotId, 'abc');
  equal(parsed.decision?.reason, 'someFutureReason');
  equal(parsed.decision?.data?.a, 1);
});

run('readShotStateEvent drops a malformed decision but keeps the frame', () => {
  const parsed = readShotStateEvent({
    event: 'state',
    state: 'idle',
    decision: { kind: 'not-a-kind', reason: 42 }
  });
  equal(parsed.state, 'idle');
  equal(parsed.decision, null);
  equal(parsed.shotId, null);
});

run('readShotStateEvent rejects frames without a valid event/state', () => {
  let threw = false;
  try {
    readShotStateEvent({ event: 'nonsense', state: 'pouring' });
  } catch {
    threw = true;
  }
  equal(threw, true);
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
