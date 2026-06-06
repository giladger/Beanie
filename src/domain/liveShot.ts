import type { MachineSnapshot, ScaleSnapshot } from '../api/types';
import type { LiveChartModel, LiveChartSeries, LiveChartPoint } from '../components/liveChartModel';
import { LIVE_SERIES } from '../components/liveChartModel';

// Pure live-shot data layer. Ingests live machine + scale WebSocket snapshots,
// runs a small shot-detection state machine, and accumulates telemetry into a
// LiveChartModel that mirrors the historical shotGraphModel conventions
// (temp/10 scaling, max(10, ceil(/2)*2) Y flooring). The two sockets tick at
// different rates, so each frame samples only the series its own snapshot
// carries (machine frame -> pressure/flow/temp; scale frame -> weight flow);
// holding the other source's last value would draw a flat-segment staircase.
// All heavy logic lives in pure functions; the LiveShotSession class is a thin
// mutable wrapper over them.

export interface LiveFrame {
  // Wall-clock millisecond timestamp the frame arrived. Passed in by the caller
  // so this module stays pure / deterministic (never calls Date.now()).
  tMs: number;
  machine?: MachineSnapshot | null;
  scale?: ScaleSnapshot | null;
}

export type LiveShotPhase = 'idle' | 'active' | 'ended';

export type LiveShotCompletionReason = 'manual-stop' | 'target-weight';

export interface LiveSeriesAccumulator {
  key: LiveChartSeries['key'];
  label: string;
  shortLabel: string;
  color: string;
  dashArray?: string;
  points: LiveChartPoint[];
}

export interface LiveShotState {
  phase: LiveShotPhase;
  // Wall-clock ms of the first active frame; null until a shot starts.
  startMs: number | null;
  // Wall-clock ms of the most recent active frame seen.
  lastActiveMs: number | null;
  series: LiveSeriesAccumulator[];
  // Monotonic non-shrinking Y peak (in scaled units) for the current session.
  maxScaledValue: number;
  completionReason: LiveShotCompletionReason | null;
  // Latest readouts (by-value snapshots for the DOM readouts the app shows).
  latest: LiveShotReadouts;
}

export interface LiveShotReadouts {
  weight: number | null;
  pressure: number | null;
  flow: number | null;
  // Scaled group/mix temperature (raw / 10) to match the chart axis.
  scaledTemperature: number | null;
}

const ESPRESSO_SUBSTATES = new Set(['preinfusion', 'pouring']);

// Default target-weight detection threshold (grams) used only when a frame does
// not carry an explicit machine-side target hit. We key the completion reason on
// the weight crossing this floor while the machine leaves the pour.
const DEFAULT_TARGET_WEIGHT = 36;

export interface LiveShotOptions {
  // When the scale weight at end time is at/above this value, the completion
  // reason is reported as 'target-weight' rather than the coarse 'manual-stop'.
  targetWeight?: number;
}

export interface LiveChartModelOptions {
  // Keeps the chart window at least this wide from shot start. The model still
  // expands if a shot runs longer, so plotted points never clip off the right.
  minTime?: number;
}

export function createLiveShotState(): LiveShotState {
  return {
    phase: 'idle',
    startMs: null,
    lastActiveMs: null,
    series: emptySeries(),
    maxScaledValue: 0,
    completionReason: null,
    latest: emptyReadouts()
  };
}

function emptySeries(): LiveSeriesAccumulator[] {
  return LIVE_SERIES.map((definition) => ({
    key: definition.key,
    label: definition.label,
    shortLabel: definition.shortLabel,
    color: definition.color,
    dashArray: definition.dashArray,
    points: []
  }));
}

function emptyReadouts(): LiveShotReadouts {
  return { weight: null, pressure: null, flow: null, scaledTemperature: null };
}

// Pure reducer: returns the next session state for a frame. Never mutates input.
export function nextLiveShotState(
  state: LiveShotState,
  frame: LiveFrame,
  options?: LiveShotOptions
): LiveShotState {
  // A frame with no machine snapshot is a scale-only update: it carries no phase
  // signal and none of the machine series. Sampling it through the normal path
  // would re-read the *held* machine values (pressure/flow/temp) and append them
  // again at a new timestamp — the flat-segment "staircase". So it must not start
  // or end a shot; just fold its scale sample (weight flow) in while one is live.
  if (frame.machine == null) {
    return state.phase === 'active' ? accumulate(state, frame) : state;
  }

  const pouring = isEspressoPour(frame.machine);

  if (state.phase === 'idle') {
    if (!pouring) return state;
    return accumulate(startSession(frame), frame);
  }

  if (state.phase === 'active') {
    if (pouring) return accumulate(state, frame);
    return endSession(state, options);
  }

  // phase === 'ended'
  if (pouring) {
    // Re-entering espresso starts a brand new session (reset points).
    return accumulate(startSession(frame), frame);
  }
  return state;
}

function startSession(frame: LiveFrame): LiveShotState {
  return {
    phase: 'active',
    startMs: frame.tMs,
    lastActiveMs: frame.tMs,
    series: emptySeries(),
    maxScaledValue: 0,
    completionReason: null,
    latest: emptyReadouts()
  };
}

function accumulate(state: LiveShotState, frame: LiveFrame): LiveShotState {
  const startMs = state.startMs ?? frame.tMs;
  const t = Math.max(0, (frame.tMs - startMs) / 1000);
  const machine = frame.machine ?? null;
  const scale = frame.scale ?? null;

  let maxScaledValue = state.maxScaledValue;
  const series = state.series.map((accumulator, index) => {
    const definition = LIVE_SERIES[index]!;
    const raw = definition.value(machine, scale);
    if (raw == null) return accumulator;
    const value = definition.scale ? definition.scale(raw) : raw;
    if (value > maxScaledValue) maxScaledValue = value;
    return { ...accumulator, points: [...accumulator.points, { t, value }] };
  });

  return {
    ...state,
    phase: 'active',
    startMs,
    lastActiveMs: frame.tMs,
    series,
    maxScaledValue,
    completionReason: null,
    latest: readoutsFor(machine, scale, state.latest)
  };
}

function endSession(state: LiveShotState, options?: LiveShotOptions): LiveShotState {
  return {
    ...state,
    phase: 'ended',
    completionReason: completionReasonFor(state, options)
  };
}

// We cannot see the machine's own stop trigger from a single leaving frame, so
// the reason is coarse: if the final weight reached the configured target the
// shot likely auto-stopped on weight; otherwise we report a manual stop.
function completionReasonFor(
  state: LiveShotState,
  options?: LiveShotOptions
): LiveShotCompletionReason {
  const target = options?.targetWeight ?? DEFAULT_TARGET_WEIGHT;
  const weight = state.latest.weight;
  if (weight != null && weight >= target) return 'target-weight';
  return 'manual-stop';
}

export function liveShotDurationMs(state: LiveShotState): number | null {
  if (state.startMs == null || state.lastActiveMs == null) return null;
  return Math.max(0, state.lastActiveMs - state.startMs);
}

function readoutsFor(
  machine: MachineSnapshot | null,
  scale: ScaleSnapshot | null,
  previous: LiveShotReadouts
): LiveShotReadouts {
  const weight = numeric(scale?.weight);
  const pressure = numeric(machine?.pressure);
  const flow = numeric(machine?.flow);
  const rawTemp = numeric(machine?.groupTemperature) ?? numeric(machine?.mixTemperature);
  return {
    weight: weight ?? previous.weight,
    pressure: pressure ?? previous.pressure,
    flow: flow ?? previous.flow,
    scaledTemperature: rawTemp != null ? rawTemp / 10 : previous.scaledTemperature
  };
}

function isEspressoPour(machine: MachineSnapshot | null | undefined): boolean {
  if (!machine) return false;
  const topState = machine.state?.state;
  if (topState !== 'espresso' && topState !== 'brewing') return false;
  const substate = stringValue(machine.state?.substate);
  if (substate != null && ESPRESSO_SUBSTATES.has(substate)) return true;
  // Treat a bare espresso/brewing state without an explicit non-pour substate
  // as pouring so the chart appears on the first brew transition.
  return substate == null;
}

// Builds the chart-ready model from accumulated session state. Only series that
// have at least one point are included. maxY uses the monotonic peak so the axis
// never shrinks mid-shot.
export function buildLiveChartModel(
  state: LiveShotState,
  options: LiveChartModelOptions = {}
): LiveChartModel {
  const presentSeries: LiveChartSeries[] = state.series
    .filter((accumulator) => accumulator.points.length > 0)
    .map((accumulator) => ({
      key: accumulator.key,
      label: accumulator.label,
      shortLabel: accumulator.shortLabel,
      color: accumulator.color,
      dashArray: accumulator.dashArray,
      points: accumulator.points
    }));

  const maxTime = Math.max(elapsedSecondsFor(state), options.minTime ?? 1, 1);
  const maxScaled = Math.max(10, state.maxScaledValue);

  return {
    series: presentSeries,
    markers: [],
    maxTime,
    maxY: Math.max(10, Math.ceil(maxScaled / 2) * 2)
  };
}

function elapsedSecondsFor(state: LiveShotState): number {
  return (liveShotDurationMs(state) ?? 0) / 1000;
}

// Thin mutable wrapper over the pure reducer for the app's by-reference usage.
export class LiveShotSession {
  private state: LiveShotState;
  private readonly options?: LiveShotOptions;

  constructor(options?: LiveShotOptions) {
    this.state = createLiveShotState();
    this.options = options;
  }

  ingest(frame: LiveFrame): void {
    this.state = nextLiveShotState(this.state, frame, this.options);
  }

  reset(): void {
    this.state = createLiveShotState();
  }

  model(options?: LiveChartModelOptions): LiveChartModel {
    return buildLiveChartModel(this.state, options);
  }

  get phase(): LiveShotPhase {
    return this.state.phase;
  }

  get isActive(): boolean {
    return this.state.phase === 'active';
  }

  get elapsedSeconds(): number {
    return elapsedSecondsFor(this.state);
  }

  get latest(): LiveShotReadouts {
    return this.state.latest;
  }

  get completionReason(): LiveShotCompletionReason | null {
    return this.state.completionReason;
  }

  get snapshot(): LiveShotState {
    return this.state;
  }
}

export interface SimulateShotOptions {
  // Deterministic wall-clock start (ms). No Date.now() — defaults to 0.
  startMs?: number;
  // Frame rate of the generated stream (Hz). Default ~25 Hz.
  rateHz?: number;
  // Seconds of idle/preinfusion lead-in before the pour ramps.
  preinfusionSeconds?: number;
  // Total active pour duration in seconds (after lead-in).
  pourSeconds?: number;
  // Final dose weight in grams.
  targetWeight?: number;
}

// Pure simulated-shot generator. Produces a realistic ~30s espresso shot as a
// sequence of LiveFrames using smooth index-based math (no randomness), so the
// app can replay it on a timer to throttle-test the canvas without hardware.
export function simulateShotFrames(options?: SimulateShotOptions): LiveFrame[] {
  const startMs = options?.startMs ?? 0;
  const rateHz = options?.rateHz ?? 25;
  const preinfusionSeconds = options?.preinfusionSeconds ?? 5;
  const pourSeconds = options?.pourSeconds ?? 25;
  const targetWeight = options?.targetWeight ?? 36;

  const dt = 1 / rateHz;
  const totalSeconds = preinfusionSeconds + pourSeconds;
  const frameCount = Math.max(1, Math.round(totalSeconds * rateHz) + 1);

  const frames: LiveFrame[] = [];
  let weight = 0;

  for (let index = 0; index < frameCount; index += 1) {
    const seconds = index * dt;
    const tMs = startMs + Math.round(seconds * 1000);
    const inPreinfusion = seconds < preinfusionSeconds;
    const pourProgress = clamp01((seconds - preinfusionSeconds) / pourSeconds);

    // Pressure: low during preinfusion (~2 bar), ramp to ~9 bar, gentle decline.
    const pressure = inPreinfusion
      ? 2 + (seconds / preinfusionSeconds) * 0.5
      : 9 - 1.5 * pourProgress;

    // Flow: a brief fill spike during preinfusion, then declining from ~2.6.
    const flow = inPreinfusion
      ? 2 * Math.sin((seconds / preinfusionSeconds) * Math.PI)
      : 2.6 - 1.4 * pourProgress;

    // Group temperature: steady ~92C with a tiny dip under load.
    const groupTemperature = 92 - 0.8 * Math.sin(pourProgress * Math.PI);

    // Weight only grows during the pour; smooth rise to the target.
    const weightFlow = inPreinfusion ? 0 : Math.max(0, 2.4 - 1.6 * pourProgress);
    if (!inPreinfusion) {
      weight = Math.min(targetWeight, targetWeight * easeOut(pourProgress));
    }

    const substate = inPreinfusion ? 'preinfusion' : 'pouring';

    frames.push({
      tMs,
      machine: {
        timestamp: new Date(tMs).toISOString(),
        state: { state: 'espresso', substate },
        flow: round2(Math.max(0, flow)),
        pressure: round2(Math.max(0, pressure)),
        targetFlow: inPreinfusion ? 2 : 2.2,
        targetPressure: inPreinfusion ? 2 : 9,
        mixTemperature: round2(groupTemperature - 1),
        groupTemperature: round2(groupTemperature),
        targetMixTemperature: 92,
        targetGroupTemperature: 93,
        profileFrame: inPreinfusion ? 0 : 1,
        steamTemperature: 0
      },
      scale: {
        timestamp: new Date(tMs).toISOString(),
        weight: round2(weight),
        weightFlow: round2(weightFlow),
        status: 'connected'
      }
    });
  }

  // Trailing idle frame so the shot cleanly ends (machine leaves espresso pour).
  const endMs = startMs + Math.round(totalSeconds * 1000) + Math.round(dt * 1000);
  frames.push({
    tMs: endMs,
    machine: {
      timestamp: new Date(endMs).toISOString(),
      state: { state: 'idle' },
      flow: 0,
      pressure: 0,
      targetFlow: 0,
      targetPressure: 0,
      mixTemperature: 90,
      groupTemperature: 90,
      targetMixTemperature: 92,
      targetGroupTemperature: 93,
      profileFrame: 0,
      steamTemperature: 0
    },
    scale: {
      timestamp: new Date(endMs).toISOString(),
      weight: round2(weight),
      weightFlow: 0,
      status: 'connected'
    }
  });

  return frames;
}

function easeOut(progress: number): number {
  // Smooth deceleration: fast early extraction, tapering toward the target.
  return 1 - Math.pow(1 - clamp01(progress), 2);
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function numeric(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}
