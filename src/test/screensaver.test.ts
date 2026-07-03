import {
  MAX_SCREENSAVER_PHOTOS,
  isScreensaverMode,
  mergeScreensaverPhotos,
  nextScreensaverPhotoIndex,
  screensaverClockPosition,
  screensaverDimBrightness,
  screensaverShowsClock,
  screensaverShowsPhotos
} from '../domain/screensaver';

run('mode guard accepts the four modes and rejects others', () => {
  equal(isScreensaverMode('black'), true);
  equal(isScreensaverMode('clock'), true);
  equal(isScreensaverMode('photos'), true);
  equal(isScreensaverMode('photos-clock'), true);
  equal(isScreensaverMode('video'), false);
  equal(isScreensaverMode(undefined), false);
});

run('content selection: photos modes show photos, clock shows when asked or as empty-photos fallback', () => {
  equal(screensaverShowsPhotos('photos'), true);
  equal(screensaverShowsPhotos('photos-clock'), true);
  equal(screensaverShowsPhotos('clock'), false);
  equal(screensaverShowsPhotos('black'), false);

  equal(screensaverShowsClock('clock', 0), true);
  equal(screensaverShowsClock('photos-clock', 3), true);
  equal(screensaverShowsClock('photos', 3), false);
  // Photos mode with no configured photos falls back to the clock so the
  // screen isn't silently black.
  equal(screensaverShowsClock('photos', 0), true);
  equal(screensaverShowsClock('black', 0), false);
});

run('dim brightness: black always turns the screen off, others use the clamped setting', () => {
  equal(screensaverDimBrightness('black', 80), 0);
  equal(screensaverDimBrightness('clock', 25), 25);
  equal(screensaverDimBrightness('photos', 140), 100);
  equal(screensaverDimBrightness('photos-clock', -5), 0);
  equal(screensaverDimBrightness('clock', Number.NaN), 25);
});

run('photo merge appends new imports and drops the oldest past the cap', () => {
  const merged = mergeScreensaverPhotos(['a', 'b'], ['c']);
  equal(merged.join(','), 'a,b,c');

  const full = Array.from({ length: MAX_SCREENSAVER_PHOTOS }, (_, i) => `p${i}`);
  const capped = mergeScreensaverPhotos(full, ['new']);
  equal(capped.length, MAX_SCREENSAVER_PHOTOS);
  equal(capped[capped.length - 1], 'new');
  equal(capped[0], 'p1');
});

run('slideshow index wraps around and survives an empty list', () => {
  equal(nextScreensaverPhotoIndex(0, 3), 1);
  equal(nextScreensaverPhotoIndex(2, 3), 0);
  equal(nextScreensaverPhotoIndex(5, 0), 0);
});

run('clock position stays comfortably inside the screen for any random input', () => {
  const center = screensaverClockPosition(0.5, 0.5);
  equal(center.leftPct, 50);
  equal(center.topPct, 50);
  const min = screensaverClockPosition(0, 0);
  equal(min.leftPct, 25);
  equal(min.topPct, 20);
  const max = screensaverClockPosition(1, 1);
  equal(max.leftPct, 75);
  equal(max.topPct, 80);
  // Out-of-range and non-finite inputs clamp instead of flying off screen.
  equal(screensaverClockPosition(7, -3).leftPct, 75);
  equal(screensaverClockPosition(7, -3).topPct, 20);
  equal(screensaverClockPosition(Number.NaN, Number.NaN).leftPct, 50);
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
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}
