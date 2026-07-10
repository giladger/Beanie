import type { StageReason } from '../domain/liveStageReason';
import { escapeHtml } from '../components/html';
import { RenderChannel } from './renderChannel';

// The live-shot telemetry island. Every write here is gated on a changed
// presentation value; app.ts coalesces source frames onto animation frames.
// The continuously mounted topbar has its stricter 4 Hz budget in
// topbarIsland.ts. See docs/render-ownership-architecture.md.

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
  /** Static row definition; this owner rebuilds rows when the profile changes. */
  stageNames: readonly string[];
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
  private latest: LiveReadoutsModel | null = null;
  private lastStageReasonCount = -1;
  private lastScrolledStage = -1;
  private lastPaintedStage: number | null | undefined = undefined;
  private lastRailSize: { scrollHeight: number; clientHeight: number } | null = null;
  private lastStageNames: readonly string[] = [];
  private railObserver: ResizeObserver | null = null;
  private readonly channel = new RenderChannel<LiveReadoutsModel>({
    minIntervalMs: 100,
    commit: (model) => this.commit(model)
  });

  bind(root: HTMLElement): void {
    const next: LiveReadoutEls = {
      time: root.querySelector<HTMLElement>('#live-time'),
      weight: root.querySelector<HTMLElement>('#live-weight'),
      pressure: root.querySelector<HTMLElement>('#live-pressure'),
      flow: root.querySelector<HTMLElement>('#live-flow'),
      temp: root.querySelector<HTMLElement>('#live-temp'),
      stageRail: root.querySelector<HTMLElement>('#live-stage-rail')
    };
    const current = this.els;
    const sameNodes =
      current != null &&
      current.time === next.time &&
      current.weight === next.weight &&
      current.pressure === next.pressure &&
      current.flow === next.flow &&
      current.temp === next.temp &&
      current.stageRail === next.stageRail;
    const railChanged = current?.stageRail !== next.stageRail;
    this.els = next;
    if (sameNodes) return;
    if (railChanged) {
      this.railObserver?.disconnect();
      this.railObserver = null;
      if (next.stageRail && typeof ResizeObserver !== 'undefined') {
        this.railObserver = new ResizeObserver(() => this.refreshRailLayout(next.stageRail));
        this.railObserver.observe(next.stageRail);
      }
    }
    // The rail DOM may have just been (re)built, so force the next readout
    // tick to repopulate every stage reason and re-center the current stage
    // (a fresh rail starts scrolled to the top, hiding it on long profiles).
    this.lastStageReasonCount = -1;
    this.lastScrolledStage = -1;
    this.lastPaintedStage = undefined;
    this.lastRailSize = null;
    this.lastStageNames = next.stageRail
      ? [...next.stageRail.querySelectorAll<HTMLElement>('.live-stage-label')].map(
          (label) => label.textContent ?? ''
        )
      : [];
    this.refreshRailLayout(next.stageRail);
    if (this.latest) this.commit(this.latest);
  }

  clear(): void {
    this.channel.reset();
    this.railObserver?.disconnect();
    this.railObserver = null;
    this.els = null;
    this.latest = null;
    this.lastStageReasonCount = -1;
    this.lastScrolledStage = -1;
    this.lastPaintedStage = undefined;
    this.lastRailSize = null;
    this.lastStageNames = [];
  }

  // An advance decision can land just after the frame change already patched
  // the rail (two sockets, no ordering guarantee) — force the next tick to
  // repopulate the stage reasons.
  forceStageRefresh(): void {
    this.lastStageReasonCount = -1;
  }

  /** Prevent the final frame of one shot crossing into the next shot. */
  beginSession(): void {
    this.channel.reset();
    this.latest = null;
    this.lastStageReasonCount = -1;
    this.lastScrolledStage = -1;
    this.lastPaintedStage = undefined;
    this.lastRailSize = null;
  }

  update(model: LiveReadoutsModel): void {
    this.latest = model;
    this.channel.offer(model);
  }

  /** Force the latest offered frame visible at a lifecycle boundary. */
  flush(): void {
    this.channel.flush();
  }

  dispose(): void {
    this.channel.dispose();
    this.clear();
    this.latest = null;
  }

  private commit(model: LiveReadoutsModel): void {
    const els = this.els;
    if (!els) return;
    const { latest, formatNumber } = model;
    setText(els.time, `${model.elapsedSeconds.toFixed(1)}s`);
    setText(els.weight, formatNumber(latest.weight, 1));
    setText(els.pressure, formatNumber(latest.pressure, 1));
    setText(els.flow, formatNumber(latest.flow, 1));
    setText(
      els.temp,
      latest.scaledTemperature == null ? '--' : (latest.scaledTemperature * 10).toFixed(1)
    );
    if (els.stageRail) {
      this.reconcileStageStructure(els.stageRail, model.stageNames);
      // Item names are static for the shot; the timeline states (done/current/
      // upcoming) move each frame, and a stage's actual advance reason fills
      // in as a tinted chip the moment the next stage begins.
      const current = model.currentStage;
      if (current !== this.lastPaintedStage) {
        this.lastPaintedStage = current;
        els.stageRail.querySelectorAll<HTMLElement>('.live-stage-item').forEach((item) => {
          const index = Number(item.dataset.index);
          setClass(item, 'done', current != null && index < current);
          setClass(item, 'current', current != null && index === current);
          setClass(item, 'upcoming', current != null && index > current);
        });
        this.refreshRailLayout(els.stageRail);
      }
      // Long profiles overflow the rail's height: fade the clipped edges and
      // keep the current stage centered, scrolling only when it changes so a
      // user peeking at other steps isn't fought over the scroll position.
      const rail = els.stageRail;
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
          setText(span, reason?.text ?? '');
          if (reason && span.dataset.kind !== reason.kind) span.dataset.kind = reason.kind;
          else if (!reason && span.dataset.kind != null) delete span.dataset.kind;
          if (appeared) span.classList.add('fresh');
        });
        this.refreshRailLayout(rail);
      }
    }
  }

  private refreshRailLayout(rail: HTMLElement | null): void {
    if (!rail || rail !== this.els?.stageRail) return;
    const railSize = { scrollHeight: rail.scrollHeight, clientHeight: rail.clientHeight };
    if (
      this.lastRailSize != null &&
      railSize.scrollHeight === this.lastRailSize.scrollHeight &&
      railSize.clientHeight === this.lastRailSize.clientHeight
    ) return;
    this.lastRailSize = railSize;
    setClass(rail, 'scrollable', rail.scrollHeight > rail.clientHeight + 1);
  }

  private reconcileStageStructure(rail: HTMLElement, stageNames: readonly string[]): void {
    if (rail.hidden !== (stageNames.length === 0)) rail.hidden = stageNames.length === 0;
    if (sameStrings(this.lastStageNames, stageNames)) return;
    this.lastStageNames = [...stageNames];
    // Names are escaped before the intentional render-owner HTML sink.
    rail.innerHTML = stageNames
      .map(
        (name, index) => `
      <li class="live-stage-item" data-index="${index}">
        <span class="live-stage-num">${index + 1}</span>
        <span class="live-stage-text">
          <span class="live-stage-label">${escapeHtml(name)}</span>
          <span class="live-stage-reason" data-index="${index}"></span>
        </span>
      </li>`
      )
      .join('');
    this.lastStageReasonCount = -1;
    this.lastScrolledStage = -1;
    this.lastPaintedStage = undefined;
    this.lastRailSize = null;
    this.refreshRailLayout(rail);
  }
}

function sameStrings(previous: readonly string[], next: readonly string[]): boolean {
  return (
    previous.length === next.length &&
    previous.every((value, index) => value === next[index])
  );
}

function setText(el: HTMLElement | null, value: string): void {
  if (el && el.textContent !== value) el.textContent = value;
}

function setClass(el: HTMLElement, name: string, enabled: boolean): void {
  if (el.classList.contains(name) !== enabled) el.classList.toggle(name, enabled);
}
