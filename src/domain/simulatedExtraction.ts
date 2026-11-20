// Deterministic espresso extraction model for demo data and the simulated live
// shot. It is deliberately small but shaped like a real DE1 shot: the pump fills
// the headspace, the puck wets and builds pressure, each profile step controls
// flow or pressure (with a limiter), the puck erodes so flow climbs late in the
// shot, and the cup weight lags the water through the puck. Seeded noise keeps
// the traces from looking machine-drawn. Pure: no Date.now(), no Math.random().

export type SimulatedProfileKind = 'pressure' | 'blooming' | 'lever';

export interface SimulatedExtractionOptions {
  kind?: SimulatedProfileKind;
  /** Dry dose in grams; sets how much water the puck soaks up before dripping. */
  dose?: number;
  /** The machine stops the pour once the scale reads this many grams. */
  stopWeight?: number;
  /** Target group temperature (°C). */
  temperature?: number;
  /** Puck resistance multiplier: >1 is a finer grind (slower), <1 coarser. */
  resistance?: number;
  /** Noise seed; the same seed always yields the same shot. */
  seed?: number;
  /** Seconds between recorded samples. */
  sampleSeconds?: number;
}

export interface SimulatedSample {
  seconds: number;
  frame: number;
  substate: 'preinfusion' | 'pouring';
  pressure: number;
  flow: number;
  targetPressure: number;
  targetFlow: number;
  groupTemperature: number;
  mixTemperature: number;
  targetTemperature: number;
  weight: number;
  weightFlow: number;
  volume: number;
}

interface Control {
  frame: number;
  mode: 'flow' | 'pressure';
  target: number;
  /** Pressure limit on a flow step, flow limit on a pressure step. */
  limit: number;
}

interface ModelState {
  t: number;
  pressure: number;
  saturation: number;
  weight: number;
  frame: number;
  frameStart: number;
  frameEntryPressure: number;
  bloomRestStart: number | null;
}

const TICK = 0.05;
const HEADSPACE_ML = 16;
const MAX_PUMP_FLOW = 6;
const MAX_SECONDS = 75;

export function simulateExtraction(options?: SimulatedExtractionOptions): SimulatedSample[] {
  const kind = options?.kind ?? 'pressure';
  const dose = options?.dose ?? 18;
  const stopWeight = options?.stopWeight ?? 38;
  const temperature = options?.temperature ?? 93;
  const resistance = (options?.resistance ?? 1) * (dose / 18);
  const sampleEvery = Math.max(1, Math.round((options?.sampleSeconds ?? 0.25) / TICK));
  const random = mulberry32(options?.seed ?? 1);
  const noise = (amplitude: number) => (random() - 0.5) * 2 * amplitude;

  const absorbMl = dose * 1.2;
  const baseResistance = 5.4 * resistance;

  const state: ModelState = {
    t: 0,
    pressure: 0,
    saturation: 0,
    weight: 0,
    frame: 0,
    frameStart: 0,
    frameEntryPressure: 0,
    bloomRestStart: null
  };
  let flow = 0;
  let filled = 0;
  let absorbed = 0;
  let weightFlow = 0;
  let volume = 0;
  let reportedWeight = 0;
  // Sensor jitter evolves per model tick (not per sample), so a 25 Hz live
  // stream and a 4 Hz stored shot look equally smooth.
  const jitter = { pressure: 0, flow: 0, weightFlow: 0, weight: 0, group: 0, mix: 0 };
  const jitterAmplitude: Record<keyof typeof jitter, number> = {
    pressure: 0.08,
    flow: 0.06,
    weightFlow: 0.3,
    weight: 0.1,
    group: 0.1,
    mix: 0.2
  };
  const samples: SimulatedSample[] = [];

  for (let tick = 0; state.t <= MAX_SECONDS; tick += 1) {
    let control = controlFor(kind, state);
    if (control.frame !== state.frame) {
      state.frame = control.frame;
      state.frameStart = state.t;
      state.frameEntryPressure = state.pressure;
      // Re-read the step now that it has started, so its ramp begins at zero.
      control = controlFor(kind, state);
    }

    const headspaceFull = filled >= HEADSPACE_ML;
    // A dry puck lets water through easily; it tightens as it swells, then
    // erodes as the shot extracts.
    const erosion = 1 - 0.42 * clamp01(state.weight / Math.max(1, stopWeight));
    const puckResistance = 0.35 + baseResistance * erosion * Math.pow(state.saturation, 1.5);

    let desiredPressure: number;
    if (control.mode === 'flow') {
      flow += ((control.target - flow) * TICK) / 0.35;
      desiredPressure = headspaceFull ? flow * puckResistance : headspacePressure(filled);
      if (headspaceFull && desiredPressure > control.limit) {
        desiredPressure = control.limit;
        flow = control.limit / puckResistance;
      }
    } else if (!headspaceFull) {
      flow += ((MAX_PUMP_FLOW - flow) * TICK) / 0.35;
      desiredPressure = headspacePressure(filled);
    } else {
      desiredPressure = control.target;
      flow = state.pressure / puckResistance;
      if (flow > control.limit) {
        flow = control.limit;
        desiredPressure = control.limit * puckResistance;
      }
    }
    // The puck holds pressure: it builds quickly but bleeds off slowly.
    const pressureLag = desiredPressure >= state.pressure ? 0.25 : 2.5;
    state.pressure += ((desiredPressure - state.pressure) * TICK) / pressureLag;
    if (control.mode === 'pressure' && headspaceFull) {
      flow = Math.min(control.limit, state.pressure / puckResistance);
    }
    flow = Math.max(0, flow);

    const inflow = flow * TICK;
    volume += inflow;
    let passthrough = 0;
    if (!headspaceFull) {
      filled += inflow;
    } else {
      const soak = Math.min(absorbMl - absorbed, inflow * (1 - Math.pow(state.saturation, 3)));
      absorbed += soak;
      passthrough = inflow - soak;
    }
    // A bloom rest still seeps a little through the saturated puck.
    if (headspaceFull && state.saturation > 0.6) passthrough += state.pressure * 0.02 * TICK;
    state.saturation = clamp01(absorbed / absorbMl);
    weightFlow += ((passthrough / TICK - weightFlow) * TICK) / 1.1;
    state.weight += weightFlow * TICK;

    for (const key of Object.keys(jitter) as (keyof typeof jitter)[]) {
      jitter[key] += (noise(jitterAmplitude[key]) - jitter[key]) * 0.3;
    }

    const pouring = control.frame > 0;
    if (tick % sampleEvery === 0 || state.weight >= stopWeight) {
      reportedWeight = Math.max(reportedWeight, state.weight + jitter.weight);
      const live = state.pressure > 0.3;
      samples.push({
        seconds: round2(state.t),
        frame: control.frame,
        substate: pouring ? 'pouring' : 'preinfusion',
        pressure: round2(Math.max(0, state.pressure + (live ? jitter.pressure : 0))),
        flow: round2(Math.max(0, flow + (flow > 0.05 ? jitter.flow : 0))),
        targetPressure: control.mode === 'pressure' ? round2(control.target) : 0,
        targetFlow: control.mode === 'flow' ? round2(control.target) : 0,
        groupTemperature: round2(groupTemperature(state.t, temperature) + jitter.group),
        mixTemperature: round2(mixTemperature(state.t, temperature) + jitter.mix),
        targetTemperature: temperature,
        weight: round2(Math.max(0, reportedWeight < 0.15 ? 0 : reportedWeight)),
        weightFlow: round2(Math.max(0, weightFlow + (weightFlow > 0.05 ? jitter.weightFlow : 0))),
        volume: round2(volume)
      });
    }
    if (state.weight >= stopWeight) break;
    state.t += TICK;
  }

  return samples;
}

function controlFor(kind: SimulatedProfileKind, state: ModelState): Control {
  const inFrame = state.t - state.frameStart;
  switch (kind) {
    case 'blooming': {
      if (state.frame === 0) {
        // Fill and wet the puck, then rest with the pump off so it blooms.
        if (state.bloomRestStart == null && state.pressure >= 2.6) state.bloomRestStart = state.t;
        if (state.bloomRestStart == null) return { frame: 0, mode: 'flow', target: 4, limit: 3 };
        if (state.t - state.bloomRestStart < 14) return { frame: 0, mode: 'flow', target: 0, limit: 3 };
      }
      return { frame: 1, mode: 'pressure', target: ramp(state, 9, 3), limit: 2.6 };
    }
    case 'lever': {
      if (state.frame === 0 && state.saturation < 0.92 && state.t < 14) {
        return { frame: 0, mode: 'flow', target: 4.5, limit: 3 };
      }
      if (state.frame <= 1 && (state.frame === 0 || inFrame < 6)) {
        return { frame: 1, mode: 'pressure', target: ramp(state, 8.6, 3), limit: 4 };
      }
      const decline = state.frame === 2 ? clamp01(inFrame / 14) : 0;
      return { frame: 2, mode: 'pressure', target: 8.6 - 3.1 * decline, limit: 2.6 };
    }
    default: {
      if (state.frame === 0 && state.pressure < 3.9 && state.t < 10) {
        return { frame: 0, mode: 'flow', target: 4, limit: 4 };
      }
      if (state.frame <= 1 && (state.frame === 0 || inFrame < 4)) {
        return { frame: 1, mode: 'pressure', target: ramp(state, 9, 4), limit: 4.5 };
      }
      return { frame: 2, mode: 'pressure', target: 9, limit: 4.5 };
    }
  }
}

// A smooth step transition: the target glides from the pressure the step
// started at to its goal over `seconds`.
function ramp(state: ModelState, goal: number, seconds: number): number {
  const progress = clamp01((state.t - state.frameStart) / seconds);
  return state.frameEntryPressure + (goal - state.frameEntryPressure) * progress;
}

function headspacePressure(filled: number): number {
  return 0.1 + 1.4 * Math.pow(clamp01(filled / HEADSPACE_ML), 4);
}

// The group dips as the fill water hits it, then recovers just under target.
function groupTemperature(t: number, target: number): number {
  return target - 0.25 - 1.3 * bump(t, 3.5, 2.2) + 0.15 * clamp01(t / 20);
}

function mixTemperature(t: number, target: number): number {
  return target + 0.6 * bump(t, 6, 3) - 0.5 * bump(t, 2, 1.5);
}

function bump(t: number, center: number, width: number): number {
  const x = (t - center) / width;
  return Math.exp(-x * x);
}

function mulberry32(seed: number): () => number {
  let a = Math.floor(seed * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
