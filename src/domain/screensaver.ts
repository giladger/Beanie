// Screensaver shown over the sleeping machine, modelled on de1app's "saver"
// page (which Streamline and most Tcl skins reuse): pick content for the black
// wake-on-tap overlay, dim the tablet backlight to a configured level, and
// wander a clock around to avoid burn-in.

/** What the sleep screensaver shows. 'black' is the classic dim black screen. */
export type ScreensaverMode = 'black' | 'clock' | 'photos' | 'photos-clock';

export const SCREENSAVER_MODES: ScreensaverMode[] = ['black', 'clock', 'photos', 'photos-clock'];

export const DEFAULT_SCREENSAVER_BRIGHTNESS = 25;

/** How often the photo slideshow advances. */
export const SCREENSAVER_PHOTO_INTERVAL_MS = 60_000;

/**
 * How often the saver clock wanders to a new spot. Burn-in / image-persistence
 * stress builds on an hours scale, so a slow drift protects just as well as
 * de1app's per-minute hop without the fidgety motion.
 */
export const SCREENSAVER_CLOCK_MOVE_INTERVAL_MS = 30 * 60_000;

export function isScreensaverMode(value: string | undefined): value is ScreensaverMode {
  return (SCREENSAVER_MODES as string[]).includes(value ?? '');
}

export function screensaverShowsPhotos(mode: ScreensaverMode): boolean {
  return mode === 'photos' || mode === 'photos-clock';
}

/**
 * Whether the saver renders a clock. Photos mode with nothing to show falls
 * back to the clock so an empty URL list doesn't leave a silently black screen.
 */
export function screensaverShowsClock(mode: ScreensaverMode, photoCount: number): boolean {
  if (mode === 'clock' || mode === 'photos-clock') return true;
  return mode === 'photos' && photoCount === 0;
}

/**
 * Backlight level (0-100) while the saver shows. Mirrors de1app: the black
 * saver always turns the screen fully off; the others use the configured
 * saver brightness.
 */
export function screensaverDimBrightness(mode: ScreensaverMode, configured: number): number {
  if (mode === 'black') return 0;
  if (!Number.isFinite(configured)) return DEFAULT_SCREENSAVER_BRIGHTNESS;
  return Math.max(0, Math.min(100, Math.round(configured)));
}

// Photos are stored on this device (IndexedDB) as compressed JPEG data URLs —
// no network dependency while the tablet sleeps. The cap and target size keep
// the store bounded: ~100 photos at ≤1600px/0.8 quality is tens of MB.
export const SCREENSAVER_PHOTOS_CACHE_KEY = 'screensaver:photos';
export const MAX_SCREENSAVER_PHOTOS = 100;
export const SCREENSAVER_PHOTO_MAX_DIMENSION = 1600;
export const SCREENSAVER_PHOTO_JPEG_QUALITY = 0.8;

/** Merge newly imported photos onto the stored list, oldest dropped at the cap. */
export function mergeScreensaverPhotos(existing: readonly string[], added: readonly string[]): string[] {
  return [...existing, ...added].slice(-MAX_SCREENSAVER_PHOTOS);
}

export function nextScreensaverPhotoIndex(current: number, photoCount: number): number {
  if (photoCount <= 0) return 0;
  return (current + 1) % photoCount;
}

export interface ScreensaverClockPosition {
  /** CSS percentages of the overlay, for the clock element's center. */
  leftPct: number;
  topPct: number;
}

/**
 * Burn-in protection: a fresh clock position each minute, like de1app's
 * saver_clock_move. Random inputs are passed in so this stays testable; the
 * range keeps the (centered) clock comfortably inside the screen.
 */
export function screensaverClockPosition(randomX: number, randomY: number): ScreensaverClockPosition {
  return {
    leftPct: 25 + clamp01(randomX) * 50,
    topPct: 20 + clamp01(randomY) * 60
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}
