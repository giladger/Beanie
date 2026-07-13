// Owns the sleep/screensaver surface as one browser runtime: clock and photo
// timers, decoded image resources, device-local photo imports, wake-app idle
// handling, and the brightness ordering needed around sleep/wake transitions.
// The application shell supplies a narrow feature snapshot and capabilities;
// this island never reaches into AppState, the gateway, or the cache directly.

import { escapeAttr, escapeHtml } from '../components/html';
import type { WakeAppZonePosition } from '../domain/settings';
import {
  MAX_SCREENSAVER_PHOTOS,
  SCREENSAVER_CLOCK_MOVE_INTERVAL_MS,
  SCREENSAVER_PHOTO_INTERVAL_MS,
  SCREENSAVER_PHOTO_JPEG_QUALITY,
  SCREENSAVER_PHOTO_MAX_DIMENSION,
  mergeScreensaverPhotos,
  nextScreensaverPhotoIndex,
  screensaverClockPosition,
  screensaverDimBrightness,
  screensaverShowsClock,
  screensaverShowsPhotos,
  type ScreensaverMode
} from '../domain/screensaver';
import type {
  ImageTranscodeOptions,
  ImageTranscodeResult
} from '../platform/imageTranscoder';

export interface SaverClockPosition {
  leftPct: number;
  topPct: number;
}

export interface ScreensaverTimer {
  schedule(callback: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

export interface ScreensaverSnapshot {
  readonly demo: boolean;
  readonly asleep: boolean;
  readonly appAwake: boolean;
  readonly saverPreview: boolean;
  readonly wakeZonePreview: WakeAppZonePosition | null;
  readonly screensaverPhotos: readonly string[];
  readonly screensaverMode: ScreensaverMode;
  readonly screensaverBrightness: number;
  readonly sleepOverlay: {
    readonly showOverlay: boolean;
    readonly showWakeAppZone: boolean;
    readonly zonePosition: WakeAppZonePosition;
  };
}

export interface ScreensaverPatch {
  readonly appAwake?: boolean;
  readonly wakeZonePreview?: WakeAppZonePosition | null;
  readonly screensaverPhotos?: string[];
  readonly status?: string;
}

export interface ScreensaverHost {
  snapshot(): ScreensaverSnapshot;
  patch(patch: ScreensaverPatch): void;
  hasConnectedAuthority(): boolean;
  machineIsSleeping(): boolean;
  clockLabel(at: Date): string;
}

export interface ScreensaverResources {
  loadPhotos(): Promise<string[]>;
  storePhotos(photos: readonly string[]): Promise<void>;
  deletePhotos(): Promise<void>;
  transcode(
    file: Blob,
    options: ImageTranscodeOptions
  ): Promise<ImageTranscodeResult>;
  /** Applies brightness through the shell's one display command lane. */
  setBrightness(brightness: number): Promise<boolean>;
  /** Reads and publishes the authoritative display state, returning its target. */
  readRequestedBrightness(): Promise<number>;
  refreshDisplayState(): Promise<void>;
}

const browserTimer: ScreensaverTimer = {
  schedule: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  cancel: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>)
};

const WAKE_APP_IDLE_SCREEN_OFF_MS = 5 * 60 * 1000;

export class ScreensaverIsland {
  private topClock: HTMLElement | null = null;
  private saverClock: HTMLElement | null = null;
  private photoA: HTMLImageElement | null = null;
  private photoB: HTMLImageElement | null = null;
  private releaseTimer: unknown = null;
  private clockTimer: unknown = null;
  private photoTimer: unknown = null;
  private sleepBrightnessTimer: unknown = null;
  private sleepWakeRestoreTimer: unknown = null;
  private wakeZonePreviewTimer: unknown = null;
  private wakeAppIdleTimer: unknown = null;
  private generation = 0;
  private importGeneration = 0;
  private photoIndex = 0;
  private clockPosition = screensaverClockPosition(0.5, 0.5);
  private clockMovedAtMs = Date.now();
  private sleepBrightnessDimmed = false;
  private lastSleepDimLevel: number | null = null;
  private wakeAppRestoreBrightness = 100;
  private sleepDimPromise: Promise<void> | null = null;
  private started = false;
  private disposed = false;
  private currentPhotoUrl: string | null = null;

  constructor(
    private readonly host: ScreensaverHost,
    private readonly resources: ScreensaverResources,
    private readonly timer: ScreensaverTimer = browserTimer
  ) {}

  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    this.armClockTimer();
    this.syncPhotoTimer();
    void this.loadPhotos();
  }

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

    const snapshot = this.host.snapshot();
    this.photoIndex = normalizedPhotoIndex(this.photoIndex, snapshot.screensaverPhotos.length);
    this.updateClock(this.host.clockLabel(new Date()), this.clockPosition);
    this.setClockOnPhoto(
      screensaverShowsPhotos(snapshot.screensaverMode) &&
        snapshot.screensaverPhotos.length > 0
    );
    this.syncPhoto(snapshot.screensaverPhotos[this.photoIndex] ?? null);
    this.syncPhotoTimer();
  }

  renderOverlay(): string {
    const snapshot = this.host.snapshot();
    const overlay = snapshot.sleepOverlay;
    const preview = snapshot.saverPreview;
    let html = '';
    if (overlay.showOverlay || preview) {
      // The wake-app zone layers on top of (and is rendered after) the
      // wake-machine overlay so its tap does not wake the machine.
      const zone = !preview && overlay.showWakeAppZone
        ? `<button type="button" class="sleep-wake-app-zone sleep-wake-app-zone-${overlay.zonePosition}" data-action="wake-app" aria-label="Open app without waking the machine"></button>`
        : '';
      const action = preview ? 'saver-preview-end' : 'wake';
      const label = preview ? 'End screensaver preview' : 'Wake machine';
      html = `
        <button type="button" class="sleep-overlay" data-action="${action}" aria-label="${label}">
          ${this.renderContent(snapshot)}
        </button>
        ${zone}
      `;
    }
    if (snapshot.wakeZonePreview) {
      html += `<div class="sleep-wake-app-zone sleep-wake-app-zone-${snapshot.wakeZonePreview} wake-zone-preview" aria-hidden="true"></div>`;
    }
    return html;
  }

  visibilityChanged(): void {
    if (this.disposed) return;
    this.syncPhotoTimer();
  }

  noteUserActivity(): void {
    if (this.disposed) return;
    const snapshot = this.host.snapshot();
    if (snapshot.demo) return;
    if (snapshot.appAwake) this.armWakeAppIdleTimer();
    else this.clearWakeAppIdleTimer();
  }

  observeSleepState(sleeping: boolean): void {
    if (this.disposed) return;
    if (!this.host.hasConnectedAuthority()) {
      this.clearSleepBrightnessTimer();
      return;
    }
    if (sleeping) {
      if (!this.host.snapshot().appAwake) this.scheduleSleepDim(0);
      return;
    }
    const hadSleepDim = this.sleepBrightnessDimmed || this.sleepBrightnessTimer != null;
    this.clearSleepBrightnessTimer();
    this.sleepBrightnessDimmed = false;
    if (hadSleepDim) this.verifySleepBrightnessRestored();
  }

  scheduleSleepDim(delayMs: number): void {
    if (
      this.disposed ||
      !this.host.hasConnectedAuthority() ||
      this.sleepBrightnessDimmed ||
      this.host.snapshot().appAwake
    ) return;
    if (this.sleepBrightnessTimer != null) {
      if (delayMs > 0) return;
      this.clearSleepBrightnessTimer();
    }
    this.sleepBrightnessTimer = this.timer.schedule(() => {
      this.sleepBrightnessTimer = null;
      void this.dimDisplayForSleep();
    }, delayMs);
  }

  observeDisplayBrightness(requestedBrightness: number): void {
    if (this.disposed) return;
    const dimActive = this.sleepBrightnessDimmed || this.sleepBrightnessTimer != null;
    if (requestedBrightness > 0 && !dimActive) {
      this.wakeAppRestoreBrightness = requestedBrightness;
    }
  }

  noteUserBrightness(brightness: number): void {
    if (this.disposed) return;
    if (brightness !== 0) this.sleepBrightnessDimmed = false;
  }

  async wakeAppWithoutMachine(): Promise<void> {
    if (this.disposed) return;
    const wasDimmed = this.sleepBrightnessDimmed;
    this.clearSleepBrightnessTimer();
    this.sleepBrightnessDimmed = false;
    this.lastSleepDimLevel = null;
    this.host.patch({ appAwake: true, status: 'App awake — machine still asleep' });
    this.armWakeAppIdleTimer();
    if (!this.host.hasConnectedAuthority() || !wasDimmed) return;
    try {
      // Wait out any dim PUT already in flight so this restore is the last write.
      if (this.sleepDimPromise) await this.sleepDimPromise;
      if (!this.disposed && this.host.hasConnectedAuthority()) {
        await this.resources.setBrightness(this.wakeAppRestoreBrightness);
      }
    } catch (error) {
      console.warn('[Beanie] Wake-app brightness restore failed', error);
    }
  }

  previewWakeZone(position: WakeAppZonePosition): void {
    if (this.disposed) return;
    this.cancelTimer('wakeZonePreviewTimer');
    this.host.patch({ wakeZonePreview: position });
    this.wakeZonePreviewTimer = this.timer.schedule(() => {
      this.wakeZonePreviewTimer = null;
      if (!this.disposed) this.host.patch({ wakeZonePreview: null });
    }, 2000);
  }

  async addPhotos(files: readonly File[]): Promise<void> {
    if (this.disposed) return;
    const allImages = files.filter((file) => file.type.startsWith('image/'));
    // Only the newest bounded window can survive persistence, so do not decode
    // older selected files that would immediately be dropped.
    const images = allImages.slice(-MAX_SCREENSAVER_PHOTOS);
    if (images.length === 0) {
      this.host.patch({ status: 'No images in the selection' });
      return;
    }
    const generation = ++this.importGeneration;
    this.host.patch({
      status: allImages.length > images.length
        ? `Importing newest ${images.length} of ${allImages.length} photos…`
        : `Importing ${images.length} photo${images.length === 1 ? '' : 's'}…`
    });
    const added: string[] = [];
    for (const file of images) {
      if (this.disposed || generation !== this.importGeneration) return;
      const compressed = await this.compressPhoto(file);
      if (compressed) added.push(compressed);
    }
    if (this.disposed || generation !== this.importGeneration) return;
    if (added.length === 0) {
      this.host.patch({ status: 'Could not read those images' });
      return;
    }
    const photos = mergeScreensaverPhotos(
      this.host.snapshot().screensaverPhotos,
      added
    );
    await this.resources.storePhotos(photos);
    if (this.disposed || generation !== this.importGeneration) return;
    this.photoIndex = 0;
    this.host.patch({
      screensaverPhotos: photos,
      status: `${photos.length} screensaver photo${photos.length === 1 ? '' : 's'} stored`
    });
  }

  async clearPhotos(): Promise<void> {
    if (this.disposed) return;
    this.importGeneration += 1;
    await this.resources.deletePhotos();
    if (this.disposed) return;
    this.photoIndex = 0;
    this.host.patch({
      screensaverPhotos: [],
      status: 'Screensaver photos cleared'
    });
  }

  async restorePhotosAfterCacheClear(): Promise<void> {
    if (this.disposed) return;
    const photos = this.host.snapshot().screensaverPhotos;
    if (photos.length > 0) await this.resources.storePhotos(photos);
  }

  clearAutomaticWriteTimers(): void {
    this.clearSleepBrightnessTimer();
    this.cancelTimer('sleepWakeRestoreTimer');
    this.clearWakeAppIdleTimer();
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
    this.importGeneration += 1;
    this.cancelTimer('clockTimer');
    this.cancelTimer('photoTimer');
    this.clearAutomaticWriteTimers();
    this.cancelTimer('wakeZonePreviewTimer');
    this.clear();
  }

  private renderContent(snapshot: ScreensaverSnapshot): string {
    const photos = snapshot.screensaverPhotos;
    const showPhotos = screensaverShowsPhotos(snapshot.screensaverMode) && photos.length > 0;
    const showClock = screensaverShowsClock(snapshot.screensaverMode, photos.length);
    if (!showPhotos && !showClock) return '';
    const photoIndex = normalizedPhotoIndex(this.photoIndex, photos.length);
    const photoLayers = showPhotos
      ? `<img id="saver-photo-a" class="saver-photo active" data-morph-skip="screensaver-photo" alt="" src="${escapeAttr(photos[photoIndex]!)}" />
         <img id="saver-photo-b" class="saver-photo" data-morph-skip="screensaver-photo" alt="" />`
      : '';
    const clock = showClock
      ? `<span id="saver-clock" class="saver-clock ${showPhotos ? 'on-photo' : ''}" data-morph-skip="screensaver-clock" style="left: ${this.clockPosition.leftPct}%; top: ${this.clockPosition.topPct}%;">${escapeHtml(this.host.clockLabel(new Date()))}</span>`
      : '';
    return `${photoLayers}${clock}`;
  }

  private armClockTimer(): void {
    this.cancelTimer('clockTimer');
    if (this.disposed || !this.started) return;
    const msToNextMinute = 60_000 - (Date.now() % 60_000);
    this.clockTimer = this.timer.schedule(() => {
      this.clockTimer = null;
      if (this.disposed) return;
      const now = Date.now();
      if (now - this.clockMovedAtMs >= SCREENSAVER_CLOCK_MOVE_INTERVAL_MS) {
        this.clockMovedAtMs = now;
        this.clockPosition = screensaverClockPosition(Math.random(), Math.random());
      }
      this.updateClock(this.host.clockLabel(new Date(now)), this.clockPosition);
      this.armClockTimer();
    }, msToNextMinute + 250);
  }

  private syncPhotoTimer(): void {
    const snapshot = this.host.snapshot();
    const visible =
      typeof document === 'undefined' ||
      !document.visibilityState ||
      document.visibilityState === 'visible';
    const overlayActive =
      (snapshot.asleep && !snapshot.appAwake) || snapshot.saverPreview;
    const shouldRun =
      this.started &&
      !this.disposed &&
      visible &&
      overlayActive &&
      this.hasPhotoSurface &&
      screensaverShowsPhotos(snapshot.screensaverMode) &&
      snapshot.screensaverPhotos.length > 1;
    if (!shouldRun) {
      this.cancelTimer('photoTimer');
      return;
    }
    if (this.photoTimer != null) return;
    this.photoTimer = this.timer.schedule(() => {
      this.photoTimer = null;
      if (this.disposed) return;
      this.advanceSlideshow();
      this.syncPhotoTimer();
    }, SCREENSAVER_PHOTO_INTERVAL_MS);
  }

  private advanceSlideshow(): void {
    const snapshot = this.host.snapshot();
    const overlayActive =
      (snapshot.asleep && !snapshot.appAwake) || snapshot.saverPreview;
    if (
      this.disposed ||
      (typeof document !== 'undefined' &&
        document.visibilityState &&
        document.visibilityState !== 'visible') ||
      !overlayActive
    ) return;
    const photos = snapshot.screensaverPhotos;
    if (photos.length < 2) return;
    const nextIndex = nextScreensaverPhotoIndex(this.photoIndex, photos.length);
    if (this.advancePhoto(photos[nextIndex]!)) this.photoIndex = nextIndex;
  }

  private async loadPhotos(): Promise<void> {
    try {
      const photos = await this.resources.loadPhotos();
      if (this.disposed || photos.length === 0) return;
      this.photoIndex = normalizedPhotoIndex(this.photoIndex, photos.length);
      this.host.patch({ screensaverPhotos: photos });
    } catch (error) {
      if (!this.disposed) console.warn('[Beanie] Could not load screensaver photos', error);
    }
  }

  private async compressPhoto(file: File): Promise<string | null> {
    try {
      const result = await this.resources.transcode(file, {
        maxEdge: SCREENSAVER_PHOTO_MAX_DIMENSION,
        maxPixels: SCREENSAVER_PHOTO_MAX_DIMENSION ** 2,
        mimeType: 'image/jpeg',
        quality: SCREENSAVER_PHOTO_JPEG_QUALITY
      });
      return result.dataUrl;
    } catch (error) {
      console.warn('[Beanie] Could not import screensaver photo', file.name, error);
      return null;
    }
  }

  private verifySleepBrightnessRestored(): void {
    if (this.disposed) return;
    const dimLevel = this.lastSleepDimLevel;
    this.lastSleepDimLevel = null;
    if (!this.host.hasConnectedAuthority() || dimLevel == null) {
      void this.resources.refreshDisplayState();
      return;
    }
    this.cancelTimer('sleepWakeRestoreTimer');
    this.sleepWakeRestoreTimer = this.timer.schedule(() => {
      this.sleepWakeRestoreTimer = null;
      void (async () => {
        if (this.disposed || !this.host.hasConnectedAuthority()) return;
        try {
          if (this.sleepDimPromise) await this.sleepDimPromise;
          if (this.disposed || !this.host.hasConnectedAuthority()) return;
          const requestedBrightness = await this.resources.readRequestedBrightness();
          if (
            this.disposed ||
            !this.host.hasConnectedAuthority() ||
            requestedBrightness > dimLevel
          ) return;
          await this.resources.setBrightness(this.wakeAppRestoreBrightness);
        } catch (error) {
          console.warn('[Beanie] Wake brightness restore check failed', error);
        }
      })();
    }, 1500);
  }

  private clearSleepBrightnessTimer(): void {
    this.cancelTimer('sleepBrightnessTimer');
  }

  private async dimDisplayForSleep(): Promise<void> {
    const snapshot = this.host.snapshot();
    if (
      this.disposed ||
      !this.host.hasConnectedAuthority() ||
      this.sleepBrightnessDimmed ||
      snapshot.appAwake ||
      !this.host.machineIsSleeping()
    ) return;
    this.sleepBrightnessDimmed = true;
    const level = screensaverDimBrightness(
      snapshot.screensaverMode,
      snapshot.screensaverBrightness
    );
    this.lastSleepDimLevel = level;
    const dim = (async () => {
      let applied = false;
      try {
        applied = await this.resources.setBrightness(level);
      } catch (error) {
        console.warn('[Beanie] Sleep brightness dim failed', error);
      } finally {
        if (!applied) {
          this.sleepBrightnessDimmed = false;
          this.lastSleepDimLevel = null;
        }
      }
    })();
    this.sleepDimPromise = dim;
    await dim;
    if (this.sleepDimPromise === dim) this.sleepDimPromise = null;
  }

  private armWakeAppIdleTimer(): void {
    if (this.host.snapshot().demo) return;
    this.clearWakeAppIdleTimer();
    this.wakeAppIdleTimer = this.timer.schedule(() => {
      this.wakeAppIdleTimer = null;
      this.wakeAppIdleScreenOff();
    }, WAKE_APP_IDLE_SCREEN_OFF_MS);
  }

  private clearWakeAppIdleTimer(): void {
    this.cancelTimer('wakeAppIdleTimer');
  }

  private wakeAppIdleScreenOff(): void {
    const snapshot = this.host.snapshot();
    if (snapshot.demo || !snapshot.appAwake || !this.host.machineIsSleeping()) return;
    this.host.patch({ appAwake: false });
    this.scheduleSleepDim(0);
  }

  private cancelRelease(): void {
    this.cancelTimer('releaseTimer');
  }

  private cancelTimer(
    field:
      | 'releaseTimer'
      | 'clockTimer'
      | 'photoTimer'
      | 'sleepBrightnessTimer'
      | 'sleepWakeRestoreTimer'
      | 'wakeZonePreviewTimer'
      | 'wakeAppIdleTimer'
  ): void {
    const handle = this[field];
    if (handle == null) return;
    this.timer.cancel(handle);
    this[field] = null;
  }

  private releasePhoto(photo: HTMLImageElement | null): void {
    if (!photo) return;
    photo.onload = null;
    photo.onerror = null;
    if (photo.hasAttribute('src')) photo.removeAttribute('src');
  }
}

function normalizedPhotoIndex(current: number, photoCount: number): number {
  if (photoCount <= 0) return 0;
  return Math.max(0, current) % photoCount;
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
