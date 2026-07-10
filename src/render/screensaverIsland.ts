// Owns the two clocks and the screensaver's decoded image resources. The app
// supplies values; this island is the only code allowed to mutate these nodes.
// Binding is idempotent across morphs and explicitly releases detached image
// resources so old data URLs cannot keep decoded GPU textures alive.

export interface SaverClockPosition {
  leftPct: number;
  topPct: number;
}

export interface ScreensaverTimer {
  schedule(callback: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

const browserTimer: ScreensaverTimer = {
  schedule: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  cancel: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>)
};

export class ScreensaverIsland {
  private topClock: HTMLElement | null = null;
  private saverClock: HTMLElement | null = null;
  private photoA: HTMLImageElement | null = null;
  private photoB: HTMLImageElement | null = null;
  private releaseTimer: unknown = null;
  private generation = 0;
  private disposed = false;
  private currentPhotoUrl: string | null = null;

  constructor(private readonly timer: ScreensaverTimer = browserTimer) {}

  bind(root: HTMLElement): void {
    if (this.disposed) return;
    const topClock = root.querySelector<HTMLElement>('#top-clock');
    const saverClock = root.querySelector<HTMLElement>('#saver-clock');
    const photoA = root.querySelector<HTMLImageElement>('#saver-photo-a');
    const photoB = root.querySelector<HTMLImageElement>('#saver-photo-b');
    const photosChanged = photoA !== this.photoA || photoB !== this.photoB;
    if (photosChanged) {
      this.generation += 1;
      this.cancelRelease();
      this.releasePhoto(this.photoA);
      this.releasePhoto(this.photoB);
    }
    this.topClock = topClock;
    this.saverClock = saverClock;
    this.photoA = photoA;
    this.photoB = photoB;
    if (photosChanged) {
      const active = photoB?.classList.contains('active') ? photoB : photoA;
      this.currentPhotoUrl = active?.getAttribute('src') ?? null;
    }
  }

  updateClock(label: string, position?: SaverClockPosition): void {
    setText(this.topClock, label);
    setText(this.saverClock, label);
    if (!this.saverClock || !position) return;
    setStyle(this.saverClock, 'left', `${position.leftPct}%`);
    setStyle(this.saverClock, 'top', `${position.topPct}%`);
  }

  setClockOnPhoto(onPhoto: boolean): void {
    if (this.saverClock) setClass(this.saverClock, 'on-photo', onPhoto);
  }

  /** Reconcile the shell's current photo model, including one-photo changes. */
  syncPhoto(url: string | null): boolean {
    if (this.disposed || !this.photoA || !this.photoB) return false;
    if (url === this.currentPhotoUrl) return true;
    this.currentPhotoUrl = url;
    this.generation += 1;
    this.cancelRelease();
    if (!url) {
      this.releasePhoto(this.photoA);
      this.releasePhoto(this.photoB);
      return true;
    }
    const active = this.photoB.classList.contains('active') ? this.photoB : this.photoA;
    const inactive = active === this.photoA ? this.photoB : this.photoA;
    active.onload = null;
    active.onerror = () => {
      if (this.currentPhotoUrl === url) this.currentPhotoUrl = null;
      this.releasePhoto(active);
    };
    if (active.getAttribute('src') !== url) active.src = url;
    setClass(active, 'active', true);
    setClass(inactive, 'active', false);
    this.releasePhoto(inactive);
    return true;
  }

  advancePhoto(url: string): boolean {
    if (this.disposed || !this.photoA || !this.photoB || !url) return false;
    const incoming = this.photoA.classList.contains('active') ? this.photoB : this.photoA;
    const outgoing = incoming === this.photoA ? this.photoB : this.photoA;
    this.currentPhotoUrl = url;
    const generation = ++this.generation;
    const activate = () => {
      incoming.onload = null;
      incoming.onerror = null;
      if (this.disposed || generation !== this.generation) return;
      setClass(incoming, 'active', true);
      setClass(outgoing, 'active', false);
      this.cancelRelease();
      this.releaseTimer = this.timer.schedule(() => {
        this.releaseTimer = null;
        if (
          !this.disposed &&
          generation === this.generation &&
          !outgoing.classList.contains('active')
        ) {
          this.releasePhoto(outgoing);
        }
      }, 1500);
    };
    incoming.onload = activate;
    incoming.onerror = () => {
      incoming.onload = null;
      incoming.onerror = null;
      if (!this.disposed && generation === this.generation) {
        if (this.currentPhotoUrl === url) this.currentPhotoUrl = outgoing.getAttribute('src');
        this.releasePhoto(incoming);
      }
    };
    if (incoming.getAttribute('src') !== url) incoming.src = url;
    else activate();
    return true;
  }

  clear(): void {
    this.generation += 1;
    this.cancelRelease();
    this.releasePhoto(this.photoA);
    this.releasePhoto(this.photoB);
    this.topClock = null;
    this.saverClock = null;
    this.photoA = null;
    this.photoB = null;
    this.currentPhotoUrl = null;
  }

  get hasPhotoSurface(): boolean {
    return !this.disposed && this.photoA != null && this.photoB != null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
  }

  private cancelRelease(): void {
    if (this.releaseTimer == null) return;
    this.timer.cancel(this.releaseTimer);
    this.releaseTimer = null;
  }

  private releasePhoto(photo: HTMLImageElement | null): void {
    if (!photo) return;
    photo.onload = null;
    photo.onerror = null;
    if (photo.hasAttribute('src')) photo.removeAttribute('src');
  }
}

function setText(el: HTMLElement | null, value: string): void {
  if (el && el.textContent !== value) el.textContent = value;
}

function setClass(el: HTMLElement, name: string, enabled: boolean): void {
  if (el.classList.contains(name) !== enabled) el.classList.toggle(name, enabled);
}

function setStyle(el: HTMLElement, property: 'left' | 'top', value: string): void {
  if (el.style[property] !== value) el.style[property] = value;
}
