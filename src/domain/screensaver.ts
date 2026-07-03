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

/** Parse the photo-URL setting: one http(s) URL per line, blanks ignored. */
export function parseScreensaverPhotoUrls(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^https?:\/\//i.test(line));
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
