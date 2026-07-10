/**
 * Bag-photo preparation for the label scanner.
 *
 * Photos go straight to Gemini, so we downscale on-device first: a smaller
 * image means a faster, cheaper call. The long edge stays at 2000px — roast
 * dates are usually tiny stamped print, and 1280px (the original target)
 * regularly blurred them past reading. `scaledDimensions` is pure (and
 * tested); the actual decode + canvas encode is browser-only.
 */

import {
  BoundedImageTranscoder,
  DEFAULT_IMAGE_MAX_EDGE,
  DEFAULT_IMAGE_MAX_PIXELS,
  boundedImageDimensions
} from '../platform/imageTranscoder';

/** Long-edge target that keeps fine print (roast-date stamps) legible. */
const DEFAULT_MAX_EDGE = DEFAULT_IMAGE_MAX_EDGE;

const imageTranscoder = new BoundedImageTranscoder();

/** A downscaled photo ready to send (and to preview as a thumbnail). */
export interface CapturedImage {
  /** Always image/jpeg after re-encoding. */
  mime: string;
  /** Base64 bytes, no `data:` prefix — what Gemini's inline_data wants. */
  base64: string;
  /** Full `data:` URL, for an `<img>` thumbnail in the capture step. */
  dataUrl: string;
}

/**
 * Fit (width × height) within a maxEdge box, preserving aspect ratio and never
 * upscaling. Returns integer dimensions; {0,0} for non-positive input.
 */
export function scaledDimensions(
  width: number,
  height: number,
  maxEdge: number
): { width: number; height: number } {
  return boundedImageDimensions(width, height, maxEdge, Number.MAX_VALUE);
}

/** Browser-only: decode a picked file, downscale it, and re-encode as JPEG. */
export async function fileToScaledImage(
  file: Blob,
  maxEdge = DEFAULT_MAX_EDGE,
  quality = 0.85
): Promise<CapturedImage> {
  const edge = Number.isFinite(maxEdge) && maxEdge > 0 ? maxEdge : DEFAULT_MAX_EDGE;
  const result = await imageTranscoder.transcode(file, {
    maxEdge: edge,
    // Preserve the public helper's historical edge-only sizing while retaining
    // the shared host's explicit backing-store budget.
    maxPixels: Math.max(DEFAULT_IMAGE_MAX_PIXELS, Math.ceil(edge) ** 2),
    mimeType: 'image/jpeg',
    quality
  });
  return {
    mime: result.mime,
    base64: result.dataUrl.slice(result.dataUrl.indexOf(',') + 1),
    dataUrl: result.dataUrl
  };
}
