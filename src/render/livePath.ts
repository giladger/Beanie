import type { MachineStatusView } from '../appShell';
import type { StageReason } from '../domain/liveStageReason';

// The telemetry hot path: DOM written directly on machine/scale frames,
// bypassing render(). Every write here MUST be (a) gated on a real value
// change and (b) throttled if it's fed by a streaming value — in the
// in-process Android WebView each redundant text repaint churns GPU
// compositor tiles Chromium never reclaims (unbounded, it grew the app to
// ~2.3GB / LOW_MEMORY over a day of idle streaming — see
// docs/webview-gpu-oom-investigation.md). Any future per-frame DOM write
// belongs in this module, under the same two rules.

export interface TopbarStatsValues {
  status: MachineStatusView;
  /** Formatted text plus the raw value it was formatted from (null = unknown). */
  group: { text: string; raw: number | null };
  steam: { text: string; raw: number | null };
  water: { text: string; raw: number | null };
  scale: string;
}

// Display hysteresis per readout: the write is skipped unless the raw value
// moved at least this far from the one that produced the text on screen.
// Sensor noise that straddles a display-rounding boundary otherwise flaps the
// string on every throttle tick (measured: the water readout at ~69 writes/min
// while the machine slept), and each flap is a real repaint — GPU memory the
// in-process WebView never reclaims. Each threshold exceeds its sensor's
// measured idle noise: group is clean (±0.05°C), water is clean in mm but
// displays in 10ml steps, and steam is integer-quantized with ~3°C of idle
// bounce (measured 36–39 over 15s), so its band is the widest — the shown
// steam value may lag truth by up to 4°C, which heating crosses in seconds.
const DEADBANDS = { group: 1.2, steam: 4, water: 12 } as const;

// The five top-bar readouts. They update on every machine/scale snapshot
// frame (~4-10Hz, continuously — even while the machine sleeps, since the top
// bar stays mounted beneath the screensaver). Two layers keep them from
// leaking GPU memory:
//   1. write() gates each DOM write on a real value change, so an idle
//      machine (stable temps, no scale) repaints nothing at all. Measured
//      on-device: unconditional ≈ 421 top-bar DOM mutations/min while the
//      machine sleeps; change-gated ≈ 0 once temperatures are stable.
//   2. update() caps the repaint rate at ~4Hz, because the scale streams live
//      weight (0.1g) every frame — so while a scale is awake the change gate
//      alone would still repaint per frame. A trailing run guarantees the
//      latest values always land.
export class TopbarStats {
  private lastMs = 0;
  private timer: number | null = null;
  private disposed = false;
  /** Raw value behind each currently displayed numeric readout. */
  private shown: { group: number | null; steam: number | null; water: number | null } = {
    group: null,
    steam: null,
    water: null
  };

  constructor(
    private readonly root: HTMLElement,
    private readonly values: () => TopbarStatsValues
  ) {}

  update(): void {
    const now = Date.now();
    const MIN_INTERVAL_MS = 250;
    const since = now - this.lastMs;
    if (since < MIN_INTERVAL_MS) {
      if (this.timer == null) {
        this.timer = window.setTimeout(() => {
          this.timer = null;
          if (!this.disposed) this.update();
        }, MIN_INTERVAL_MS - since);
      }
      return;
    }
    this.lastMs = now;
    if (this.timer != null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    this.write();
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer != null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private write(): void {
    const values = this.values();
    // Only touch the DOM when a readout actually changed.
    const set = (id: string, value: string) => {
      const el = this.root.querySelector<HTMLElement>(`#${id}`);
      if (el && el.textContent !== value) el.textContent = value;
    };
    // Numeric readouts additionally hold their text until the raw value moves
    // past the deadband, so boundary-straddling noise can't flap the string.
    const setNumeric = (id: string, key: keyof typeof DEADBANDS, value: { text: string; raw: number | null }) => {
      const el = this.root.querySelector<HTMLElement>(`#${id}`);
      if (!el) return;
      if (el.textContent === value.text) {
        this.shown[key] = value.raw;
        return;
      }
      const last = this.shown[key];
      if (value.raw != null && last != null && Math.abs(value.raw - last) < DEADBANDS[key]) return;
      el.textContent = value.text;
      this.shown[key] = value.raw;
    };
    set('stat-machine', values.status.label);
    // The tone class lives on the stat container; keep it in sync with the
    // label so e.g. Heating→Ready recolors without a full render.
    const statusEl = this.root.querySelector<HTMLElement>('#stat-machine');
    if (statusEl?.parentElement) {
      const cls = `top-stat${values.status.tone ? ` stat-tone-${values.status.tone}` : ''}`;
      if (statusEl.parentElement.className !== cls) statusEl.parentElement.className = cls;
    }
    setNumeric('stat-group', 'group', values.group);
    setNumeric('stat-steam', 'steam', values.steam);
    setNumeric('stat-water', 'water', values.water);
    set('stat-scale', values.scale);
  }
}

export interface LiveReadoutsModel {
  elapsedSeconds: number;
  latest: {
    weight: number | null;
    pressure: number | null;
    flow: number | null;
    scaledTemperature: number | null;
  };
  /** Stage index the machine is currently in, or null outside a profile. */
  currentStage: number | null;
  /** Count of stage markers seen so far; reasons are recomputed when it moves. */
  stageMarkerCount: number;
  /** Lazy: only called when the marker count changed. */
  stageReasons: () => (StageReason | null)[];
  formatNumber: (value: number | null | undefined, decimals: number) => string;
}

interface LiveReadoutEls {
  time: HTMLElement | null;
  weight: HTMLElement | null;
  pressure: HTMLElement | null;
  flow: HTMLElement | null;
  temp: HTMLElement | null;
  stageRail: HTMLElement | null;
}

// The live-shot readouts and stage rail, patched in place on every telemetry
// frame while a shot runs. Rebound after each render (the elements normally
// survive the morph, but a view change can rebuild them).
export class LiveReadouts {
  private els: LiveReadoutEls | null = null;
  private lastStageReasonCount = -1;
  private lastScrolledStage = -1;

  bind(root: HTMLElement): void {
    this.els = {
      time: root.querySelector<HTMLElement>('#live-time'),
      weight: root.querySelector<HTMLElement>('#live-weight'),
      pressure: root.querySelector<HTMLElement>('#live-pressure'),
      flow: root.querySelector<HTMLElement>('#live-flow'),
      temp: root.querySelector<HTMLElement>('#live-temp'),
      stageRail: root.querySelector<HTMLElement>('#live-stage-rail')
    };
    // The rail DOM may have just been (re)built, so force the next readout
    // tick to repopulate every stage reason and re-center the current stage
    // (a fresh rail starts scrolled to the top, hiding it on long profiles).
    this.lastStageReasonCount = -1;
    this.lastScrolledStage = -1;
  }

  clear(): void {
    this.els = null;
  }

  // An advance decision can land just after the frame change already patched
  // the rail (two sockets, no ordering guarantee) — force the next tick to
  // repopulate the stage reasons.
  forceStageRefresh(): void {
    this.lastStageReasonCount = -1;
  }

  update(model: LiveReadoutsModel): void {
    const els = this.els;
    if (!els) return;
    const { latest, formatNumber } = model;
    if (els.time) els.time.textContent = `${model.elapsedSeconds.toFixed(1)}s`;
    if (els.weight) els.weight.textContent = formatNumber(latest.weight, 1);
    if (els.pressure) els.pressure.textContent = formatNumber(latest.pressure, 1);
    if (els.flow) els.flow.textContent = formatNumber(latest.flow, 1);
    if (els.temp) {
      els.temp.textContent =
        latest.scaledTemperature == null ? '--' : (latest.scaledTemperature * 10).toFixed(1);
    }
    if (els.stageRail) {
      // Item names are static for the shot; the timeline states (done/current/
      // upcoming) move each frame, and a stage's actual advance reason fills
      // in as a tinted chip the moment the next stage begins.
      const current = model.currentStage;
      els.stageRail.querySelectorAll<HTMLElement>('.live-stage-item').forEach((item) => {
        const index = Number(item.dataset.index);
        item.classList.toggle('done', current != null && index < current);
        item.classList.toggle('current', current != null && index === current);
        item.classList.toggle('upcoming', current != null && index > current);
      });
      // Long profiles overflow the rail's height: fade the clipped edges and
      // keep the current stage centered, scrolling only when it changes so a
      // user peeking at other steps isn't fought over the scroll position.
      const rail = els.stageRail;
      rail.classList.toggle('scrollable', rail.scrollHeight > rail.clientHeight + 1);
      if (current != null && current !== this.lastScrolledStage) {
        // A freshly rebuilt rail (lastScrolledStage reset) starts at the top —
        // land on the current stage instantly; a visible smooth scroll on
        // every end-of-shot re-render reads as flicker. Live stage changes
        // still glide.
        const behavior: ScrollBehavior =
          this.lastScrolledStage === -1 ? 'auto' : 'smooth';
        this.lastScrolledStage = current;
        const item = rail.querySelector<HTMLElement>(
          `.live-stage-item[data-index="${current}"]`
        );
        if (item && typeof rail.scrollTo === 'function') {
          rail.scrollTo({
            top: item.offsetTop - (rail.clientHeight - item.clientHeight) / 2,
            behavior
          });
        }
      }
      if (model.stageMarkerCount !== this.lastStageReasonCount) {
        this.lastStageReasonCount = model.stageMarkerCount;
        const reasons = model.stageReasons();
        els.stageRail.querySelectorAll<HTMLElement>('.live-stage-reason').forEach((span) => {
          const reason = reasons[Number(span.dataset.index)] ?? null;
          // Animate only a chip that genuinely just appeared (empty → filled
          // during the live patch); rebuilt rails render their chips already
          // filled, so re-renders never replay the entrance.
          const appeared = span.textContent === '' && Boolean(reason?.text);
          span.textContent = reason?.text ?? '';
          if (reason) span.dataset.kind = reason.kind;
          else delete span.dataset.kind;
          if (appeared) span.classList.add('fresh');
        });
      }
    }
  }
}
