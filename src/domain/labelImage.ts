/**
 * Bag-photo preparation for the label scanner.
 *
 * Photos go straight to Gemini, so we downscale on-device first: a smaller
 * image means a faster, cheaper call. The long edge stays at 2000px — roast
 * dates are usually tiny stamped print, and 1280px (the original target)
 * regularly blurred them past reading. `scaledDimensions` is pure (and
 * tested); the actual decode + canvas encode is browser-only.
 */

/** Long-edge target that keeps fine print (roast-date stamps) legible. */
const DEFAULT_MAX_EDGE = 2000;

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
  maxEdge = DEFAULT_MAX_EDGE,
  quality = 0.85
): Promise<CapturedImage> {
  const decoded = await decodeImage(file);
  try {
    const { width, height } = scaledDimensions(decoded.width, decoded.height, maxEdge);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is not available');
    context.drawImage(decoded.source, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    return { mime: 'image/jpeg', base64: dataUrl.slice(dataUrl.indexOf(',') + 1), dataUrl };
  } finally {
    decoded.release();
  }
}

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

/**
 * Decode a picked file. `from-image` keeps the EXIF rotation — phone photos
 * are usually portrait only via EXIF, and sideways text scans badly. The
 * `<img>` fallback covers what `createImageBitmap` can't decode (notably HEIC
 * on Safari) and browsers that choke on the orientation option.
 */
async function decodeImage(file: Blob): Promise<DecodedImage> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      return {
        source: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        release: () => URL.revokeObjectURL(url)
      };
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
  }
}
