/**
 * Bag-photo preparation for the label scanner.
 *
 * Photos go straight to Gemini, so we downscale on-device first: a label's text
 * is perfectly legible at ~1280px on the long edge, and a smaller image means a
 * faster, cheaper call. `scaledDimensions` is pure (and tested); the actual
 * canvas encode is browser-only.
 */

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
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: 0, height: 0 };
  }
  const longEdge = Math.max(width, height);
  if (longEdge <= maxEdge) return { width: Math.round(width), height: Math.round(height) };
  const scale = maxEdge / longEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

/** Browser-only: decode a picked file, downscale it, and re-encode as JPEG. */
export async function fileToScaledImage(
  file: Blob,
  maxEdge = 1280,
  quality = 0.85
): Promise<CapturedImage> {
  const bitmap = await createImageBitmap(file);
  try {
    const { width, height } = scaledDimensions(bitmap.width, bitmap.height, maxEdge);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is not available');
    context.drawImage(bitmap, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    return { mime: 'image/jpeg', base64: dataUrl.slice(dataUrl.indexOf(',') + 1), dataUrl };
  } finally {
    bitmap.close();
  }
}
