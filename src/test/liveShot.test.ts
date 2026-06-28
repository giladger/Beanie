import type { MachineSnapshot, ScaleSnapshot } from '../api/types';
import {
  LiveShotSession,
  liveShotDurationMs,
  simulateShotFrames,
  type LiveFrame
} from '../domain/liveShot';

run('shot start detection sets t=0 at the first active frame', () => {
  const session = new LiveShotSession();
  session.ingest(idleFrame(1000));
  session.ingest(pourFrame(2000, { pressure: 4, weight: 0 }));
  session.ingest(pourFrame(3000, { pressure: 9, weight: 10 }));

  equal(session.isActive, true);
  equal(seriesValue(session, 'pressure', 0).t, 0);
  equal(seriesValue(session, 'pressure', 1).t, 1);
});

run('points accumulate with correct elapsed time and scaled values', () => {
  const session = new LiveShotSession();
  session.ingest(pourFrame(0, { groupTemperature: 92, weight: 20, weightFlow: 1.1 }));
  session.ingest(pourFrame(2000, { groupTemperature: 93, weight: 36, weightFlow: 1.3 }));

  equal(seriesValue(session, 'groupTemperature', 0).value, 9.2);
  equal(seriesValue(session, 'groupTemperature', 1).value, 9.3);
  equal(seriesValue(session, 'weightFlow', 0).value, 1.1);
  equal(seriesValue(session, 'weightFlow', 1).value, 1.3);
  equal(seriesValue(session, 'weightFlow', 1).t, 2);
});

run('idle frames before the shot starts are ignored', () => {
  const session = new LiveShotSession();
  session.ingest(idleFrame(0));
  session.ingest(idleFrame(500));
  equal(session.isActive, false);
  equal(session.model().series.length, 0);

  session.ingest(pourFrame(1000, { pressure: 9 }));
  equal(seriesValue(session, 'pressure', 0).t, 0);
  equal(session.model().series[0]!.points.length, 1);
});

run('flush frames with pour substates do not start a shot', () => {
  const session = new LiveShotSession();
  session.ingest({
    tMs: 0,
    machine: machineSnapshot({
      state: { state: 'flush', substate: 'pouring' },
      pressure: 2,
      flow: 6
    }),
    scale: scaleSnapshot({ weight: 0, weightFlow: 0 })
  });

  equal(session.isActive, false);
  equal(session.model().series.length, 0);
});

run('gateway brewing state starts a live shot immediately', () => {
  const session = new LiveShotSession();
  session.ingest({
    tMs: 1000,
    machine: machineSnapshot({ state: { state: 'brewing' }, pressure: 2 }),
    scale: scaleSnapshot({ weight: 0 })
  });

  equal(session.isActive, true);
  equal(seriesValue(session, 'pressure', 0).t, 0);
});

run('leaving espresso ends the session and sets a completion reason', () => {
  const session = new LiveShotSession();
  session.ingest(pourFrame(0, { weight: 5 }));
  session.ingest(pourFrame(1000, { weight: 12 }));
  session.ingest(idleFrame(2000));

  equal(session.isActive, false);
  equal(session.phase, 'ended');
  equal(session.completionReason, 'manual-stop');
});

run('live shot duration spans the active brewing window', () => {
  const session = new LiveShotSession();
  session.ingest(pourFrame(5000, { pressure: 2 }));
  session.ingest(pourFrame(6200, { pressure: 6 }));
  session.ingest(idleFrame(7000));

  equal(liveShotDurationMs(session.snapshot), 1200);
});

run('reaching target weight reports a target-weight completion reason', () => {
  const session = new LiveShotSession();
  session.ingest(pourFrame(0, { weight: 10 }));
  session.ingest(pourFrame(1000, { weight: 36 }));
  session.ingest(idleFrame(2000));

  equal(session.completionReason, 'target-weight');
});

run('re-entering espresso after end starts a new session and resets points', () => {
  const session = new LiveShotSession();
  session.ingest(pourFrame(0, { weight: 5 }));
  session.ingest(pourFrame(1000, { weight: 12 }));
  session.ingest(idleFrame(2000));
  equal(session.phase, 'ended');

  session.ingest(pourFrame(5000, { weight: 0, pressure: 3 }));
  equal(session.isActive, true);
  equal(session.completionReason, null);
  equal(seriesValue(session, 'pressure', 0).t, 0);
  equal(session.model().series.find((series) => series.key === 'pressure')!.points.length, 1);
});

run('maxY never shrinks within a session', () => {
  const session = new LiveShotSession();
  session.ingest(pourFrame(0, { pressure: 24 }));
  const peak = session.model().maxY;
  equal(peak >= 24, true);

  session.ingest(pourFrame(1000, { pressure: 2 }));
  equal(session.model().maxY, peak);
});

run('model can begin with a preset x-axis duration', () => {
  const session = new LiveShotSession();
  session.ingest(pourFrame(0, { pressure: 6 }));

  equal(session.model({ minTime: 30 }).maxTime, 30);
  session.ingest(pourFrame(31000, { pressure: 7 }));
  equal(session.model({ minTime: 30 }).maxTime, 31);
});

run('model only includes series that have points', () => {
  const session = new LiveShotSession();
  // Machine-only frame: no scale, so weight / weightFlow series stay empty.
  session.ingest({
    tMs: 0,
    machine: machineSnapshot({ pressure: 9, flow: 2 }),
    scale: null
  });
  const keys = session.model().series.map((series) => series.key);
  equal(includesKey(keys, 'pressure'), true);
  equal(includesKey(keys, 'weightFlow'), false);
});

run('simulateShotFrames produces a plausible rising-then-ending sequence', () => {
  const frames = simulateShotFrames({ startMs: 0 });
  equal(frames.length > 0, true);

  const firstWeight = frames[0]!.scale!.weight;
  const peakWeight = Math.max(...frames.map((frame) => frame.scale!.weight));
  equal(peakWeight > firstWeight, true);
  equal(peakWeight >= 30, true);

  const lastFrame = frames[frames.length - 1]!;
  equal(lastFrame.machine!.state.state === 'espresso', false);
});

run('simulated frames feed the session to a completed shot', () => {
  const session = new LiveShotSession();
  for (const frame of simulateShotFrames({ startMs: 0 })) {
    session.ingest(frame);
  }
  equal(session.phase, 'ended');
  equal(session.completionReason, 'target-weight');
  equal(session.model().series.length > 0, true);
  equal(session.elapsedSeconds > 0, true);
});

run('faster scale frames do not duplicate the held machine series', () => {
  const session = new LiveShotSession();
  session.ingest(machineFrame(0, { pressure: 9, flow: 2 }));
  // The scale socket ticks several times between machine ticks.
  session.ingest(scaleFrame(100, { weightFlow: 1 }));
  session.ingest(scaleFrame(200, { weightFlow: 1.1 }));
  session.ingest(scaleFrame(300, { weightFlow: 1.2 }));
  session.ingest(machineFrame(400, { pressure: 8, flow: 2.4 }));

  // Pressure was sampled only on the two machine frames — the three scale frames
  // in between must not re-append the held pressure value (the staircase bug).
  equal(session.model().series.find((s) => s.key === 'pressure')!.points.length, 2);
  // Every scale tick still contributes a weight-flow point.
  equal(session.model().series.find((s) => s.key === 'weightFlow')!.points.length, 3);
});

run('a scale-only frame never starts or ends a shot', () => {
  const session = new LiveShotSession();
  // No machine pour yet: a scale update alone must not start a shot.
  session.ingest(scaleFrame(0, { weightFlow: 0.5 }));
  equal(session.isActive, false);
  equal(session.model().series.length, 0);

  // Mid-shot, scale updates keep it live (only a machine idle frame ends it).
  session.ingest(machineFrame(1000, { pressure: 6 }));
  session.ingest(scaleFrame(1100, { weightFlow: 1.4 }));
  equal(session.isActive, true);
  equal(session.model().series.find((s) => s.key === 'weightFlow')!.points.length, 1);
});

run('stage markers record each new profileFrame, labelled from the profile', () => {
  const session = new LiveShotSession();
  const stageNames = ['Preinfusion', 'Pour', 'Decline'];
  session.ingest(stageFrame(0, 0)); // start in stage 0
  session.ingest(stageFrame(1000, 0)); // same stage: no new marker
  session.ingest(scaleFrame(1500, { weightFlow: 1 })); // scale-only: never moves the stage
  session.ingest(stageFrame(2000, 1)); // enters stage 1
  session.ingest(stageFrame(3000, 2)); // enters stage 2

  const markers = session.model({ stageNames }).markers;
  equal(markers.length, 3);
  equal(markers[0]!.t, 0);
  equal(markers[0]!.label, 'Preinfusion');
  equal(markers[1]!.t, 2);
  equal(markers[1]!.label, 'Pour');
  equal(markers[2]!.t, 3);
  equal(markers[2]!.label, 'Decline');

  // A frame index past the supplied names still marks the line, just generically.
  session.ingest(stageFrame(4000, 7));
  const extended = session.model({ stageNames }).markers;
  equal(extended[3]!.label, 'Step 8');

  // Without stage names there is nothing to label, so no markers are emitted.
  equal(session.model().markers.length, 0);
});

function machineSnapshot(overrides: Partial<MachineSnapshot>): MachineSnapshot {
  return {
    timestamp: '2026-06-01T10:00:00.000Z',
    state: { state: 'espresso', substate: 'pouring' },
    flow: 0,
    pressure: 0,
    targetFlow: 0,
    targetPressure: 0,
    mixTemperature: 0,
    groupTemperature: 0,
    targetMixTemperature: 0,
    targetGroupTemperature: 0,
    profileFrame: 0,
    steamTemperature: 0,
    ...overrides
  };
}

function scaleSnapshot(overrides: Partial<ScaleSnapshot>): ScaleSnapshot {
  return {
    timestamp: '2026-06-01T10:00:00.000Z',
    weight: 0,
    weightFlow: 0,
    status: 'connected',
    ...overrides
  };
}

function pourFrame(
  tMs: number,
  values: {
    pressure?: number;
    flow?: number;
    groupTemperature?: number;
    weight?: number;
    weightFlow?: number;
  }
): LiveFrame {
  return {
    tMs,
    machine: machineSnapshot({
      state: { state: 'espresso', substate: 'pouring' },
      pressure: values.pressure ?? 0,
      flow: values.flow ?? 0,
      groupTemperature: values.groupTemperature ?? 92
    }),
    scale: scaleSnapshot({ weight: values.weight ?? 0, weightFlow: values.weightFlow ?? 0 })
  };
}

function stageFrame(tMs: number, frame: number): LiveFrame {
  return {
    tMs,
    machine: machineSnapshot({
      state: { state: 'espresso', substate: 'pouring' },
      pressure: 6,
      profileFrame: frame
    }),
    scale: scaleSnapshot({ weight: 0 })
  };
}

function idleFrame(tMs: number): LiveFrame {
  return {
    tMs,
    machine: machineSnapshot({ state: { state: 'idle' } }),
    scale: scaleSnapshot({ weight: 0 })
  };
}

// Single-source frames, mirroring the real app: the machine and scale sockets
// each deliver their own snapshot with the other side absent.
function machineFrame(
  tMs: number,
  values: { pressure?: number; flow?: number; groupTemperature?: number }
): LiveFrame {
  return {
    tMs,
    machine: machineSnapshot({
      state: { state: 'espresso', substate: 'pouring' },
      pressure: values.pressure ?? 0,
      flow: values.flow ?? 0,
      groupTemperature: values.groupTemperature ?? 92
    }),
    scale: null
  };
}

function scaleFrame(tMs: number, values: { weight?: number; weightFlow?: number }): LiveFrame {
  return {
    tMs,
    machine: null,
    scale: scaleSnapshot({ weight: values.weight ?? 0, weightFlow: values.weightFlow ?? 0 })
  };
}

function seriesValue(
  session: LiveShotSession,
  key: string,
  index: number
): { t: number; value: number } {
  const series = session.model().series.find((item) => item.key === key);
  if (!series) throw new Error(`Missing series ${key}`);
  const point = series.points[index];
  if (!point) throw new Error(`Missing point ${index} on ${key}`);
  return point;
}

function includesKey(keys: string[], key: string): boolean {
  return keys.includes(key);
}

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
