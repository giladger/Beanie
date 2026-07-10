/**
 * Explicitly-scoped browser image transcoding.
 *
 * A transcode owns two native resources: a decoded image and a canvas backing
 * store. Both are leases and are released in `finally`, independently of
 * decode, draw, or encode failures. Batch work is bounded so a multi-file
 * picker cannot create one full-size canvas per selected photo at once.
 */

export const DEFAULT_IMAGE_MAX_EDGE = 2_000;
export const DEFAULT_IMAGE_MAX_PIXELS = 4_000_000;
export const DEFAULT_BATCH_MAX_PIXELS = 16_000_000;
export const DEFAULT_BATCH_CONCURRENCY = 1;
export const MAX_BATCH_CONCURRENCY = 4;

export interface ImageTranscodeOptions {
  maxEdge?: number;
  /** Maximum output-canvas pixels for this image. Aspect ratio is preserved. */
  maxPixels?: number;
  mimeType?: string;
  quality?: number;
}

export interface ImageTranscodeBatchOptions extends ImageTranscodeOptions {
  /** Maximum successful output pixels retained by the whole batch. */
  maxTotalPixels?: number;
  /** Number of simultaneous decode/encode leases; clamped to 1..4. */
  concurrency?: number;
}

export interface ImageTranscoderHostOptions extends ImageTranscodeOptions {
  /** Global cap shared by direct calls and every batch using this host. */
  maxConcurrency?: number;
}

export interface ImageTranscoder {
  transcode(file: Blob, options?: ImageTranscodeOptions): Promise<ImageTranscodeResult>;
  transcodeBatch(
    files: readonly Blob[],
    options?: ImageTranscodeBatchOptions
  ): Promise<PromiseSettledResult<ImageTranscodeResult>[]>;
}

export interface ImageTranscodeResult {
  mime: string;
  dataUrl: string;
  width: number;
  height: number;
  pixels: number;
}

export interface DecodedImageLease {
  source: CanvasImageSource;
  width: number;
  height: number;
  release(): void;
}

export interface TranscodeCanvasLease {
  draw(source: CanvasImageSource, width: number, height: number): void;
  encode(mimeType: string, quality: number): string;
  /** Must release the backing store, normally by resizing to 1x1. */
  release(): void;
}

/** Browser work is behind this adapter so cleanup is directly testable. */
export interface ImageTranscoderAdapter {
  decode(file: Blob): Promise<DecodedImageLease>;
  createCanvas(width: number, height: number): TranscodeCanvasLease;
}

export interface BrowserImagePrimitives {
  createBitmap(file: Blob): Promise<ImageBitmap>;
  createObjectUrl(file: Blob): string;
  revokeObjectUrl(url: string): void;
  createImage(): HTMLImageElement;
  clearImageSource(image: HTMLImageElement): void;
  createCanvas(): HTMLCanvasElement;
}

export class ImageBatchPixelLimitError extends Error {
  constructor(
    readonly index: number,
    readonly requestedPixels: number,
    readonly usedPixels: number,
    readonly maxTotalPixels: number
  ) {
    super(
      `Image ${index + 1} would exceed the batch pixel limit ` +
        `(${usedPixels} + ${requestedPixels} > ${maxTotalPixels})`
    );
    this.name = 'ImageBatchPixelLimitError';
  }
}

/**
 * Fit an image within both an edge and a pixel budget without upscaling.
 * Invalid source dimensions produce {0,0}; limits are normalized by callers.
 */
export function boundedImageDimensions(
  width: number,
  height: number,
  maxEdge: number,
  maxPixels: number
): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: 0, height: 0 };
  }
  const edgeScale = maxEdge / Math.max(width, height);
  const pixelScale = Math.sqrt(maxPixels / (width * height));
  const scale = Math.min(1, edgeScale, pixelScale);
  if (scale >= 1) return { width: Math.round(width), height: Math.round(height) };

  // Flooring guarantees the integral backing store cannot cross either limit
  // because of rounding at the boundary.
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale))
  };
}

export class BoundedImageTranscoder implements ImageTranscoder {
  private readonly adapter: ImageTranscoderAdapter;
  private readonly defaults: ImageTranscoderHostOptions;
  private readonly maxConcurrency: number;
  private active = 0;
  private readonly waiters: Array<{ resolve(): void; reject(error: Error): void }> = [];
  private disposed = false;

  constructor(
    adapter: ImageTranscoderAdapter = createBrowserImageTranscoderAdapter(),
    defaults: ImageTranscoderHostOptions = {}
  ) {
    this.adapter = adapter;
    this.defaults = defaults;
    this.maxConcurrency = Math.min(
      MAX_BATCH_CONCURRENCY,
      positiveInteger(defaults.maxConcurrency, DEFAULT_BATCH_CONCURRENCY)
    );
  }

  transcode(file: Blob, options: ImageTranscodeOptions = {}): Promise<ImageTranscodeResult> {
    return this.runBounded(() => this.transcodeOne(file, resolveOptions(this.defaults, options)));
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  /**
   * Reject queued and future acquisitions. A decode/canvas lease that already
   * acquired a slot is allowed to reach its `finally` cleanup.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const error = new Error('Image transcoder has been disposed');
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
  }

  /**
   * Transcode a batch with ordered results, bounded concurrency, and one shared
   * successful-output pixel budget. Failures are isolated like
   * `Promise.allSettled`, allowing callers to keep usable photos.
   */
  async transcodeBatch(
    files: readonly Blob[],
    options: ImageTranscodeBatchOptions = {}
  ): Promise<PromiseSettledResult<ImageTranscodeResult>[]> {
    const resolved = resolveOptions(this.defaults, options);
    const maxTotalPixels = positiveInteger(
      options.maxTotalPixels,
      DEFAULT_BATCH_MAX_PIXELS
    );
    const concurrency = Math.min(
      MAX_BATCH_CONCURRENCY,
      positiveInteger(options.concurrency, DEFAULT_BATCH_CONCURRENCY)
    );
    const results = new Array<PromiseSettledResult<ImageTranscodeResult>>(files.length);
    let nextIndex = 0;
    let usedPixels = 0;

    const worker = async (): Promise<void> => {
      for (;;) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= files.length) return;
        let reservedPixels = 0;
        try {
          const value = await this.runBounded(() =>
            this.transcodeOne(files[index]!, resolved, (pixels) => {
              if (usedPixels + pixels > maxTotalPixels) {
                throw new ImageBatchPixelLimitError(index, pixels, usedPixels, maxTotalPixels);
              }
              usedPixels += pixels;
              reservedPixels = pixels;
            })
          );
          results[index] = { status: 'fulfilled', value };
        } catch (reason) {
          // Failed draw/encode work must not consume the retained-output budget.
          usedPixels -= reservedPixels;
          results[index] = { status: 'rejected', reason };
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(concurrency, files.length) }, () => worker())
    );
    return results;
  }

  private async runBounded<Result>(operation: () => Promise<Result>): Promise<Result> {
    await this.acquire();
    try {
      return await operation();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Image transcoder has been disposed'));
    if (this.active < this.maxConcurrency) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }

  private release(): void {
    this.active -= 1;
    if (this.disposed) return;
    const waiter = this.waiters.shift();
    if (!waiter) return;
    this.active += 1;
    waiter.resolve();
  }

  private async transcodeOne(
    file: Blob,
    options: ResolvedImageTranscodeOptions,
    reservePixels?: (pixels: number) => void
  ): Promise<ImageTranscodeResult> {
    const decoded = await this.adapter.decode(file);
    try {
      const { width, height } = boundedImageDimensions(
        decoded.width,
        decoded.height,
        options.maxEdge,
        options.maxPixels
      );
      if (width === 0 || height === 0) throw new Error('Decoded image has no usable dimensions');
      const pixels = width * height;
      reservePixels?.(pixels);

      const canvas = this.adapter.createCanvas(width, height);
      try {
        canvas.draw(decoded.source, width, height);
        const dataUrl = canvas.encode(options.mimeType, options.quality);
        if (!dataUrl.includes(',')) throw new Error('Image encoder returned an invalid data URL');
        return { mime: options.mimeType, dataUrl, width, height, pixels };
      } finally {
        canvas.release();
      }
    } finally {
      decoded.release();
    }
  }
}

interface ResolvedImageTranscodeOptions {
  maxEdge: number;
  maxPixels: number;
  mimeType: string;
  quality: number;
}

function resolveOptions(
  defaults: ImageTranscodeOptions,
  options: ImageTranscodeOptions
): ResolvedImageTranscodeOptions {
  return {
    maxEdge: positiveInteger(options.maxEdge ?? defaults.maxEdge, DEFAULT_IMAGE_MAX_EDGE),
    maxPixels: positiveInteger(
      options.maxPixels ?? defaults.maxPixels,
      DEFAULT_IMAGE_MAX_PIXELS
    ),
    mimeType: options.mimeType ?? defaults.mimeType ?? 'image/jpeg',
    quality: normalizedQuality(options.quality ?? defaults.quality ?? 0.85)
  };
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.max(1, Math.floor(value))
    : fallback;
}

function normalizedQuality(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.85;
}

export function createBrowserImageTranscoderAdapter(
  primitives: BrowserImagePrimitives = defaultBrowserImagePrimitives()
): ImageTranscoderAdapter {
  return {
    decode: (file) => decodeBrowserImage(file, primitives),
    createCanvas: (width, height) => browserCanvasLease(width, height, primitives)
  };
}

function defaultBrowserImagePrimitives(): BrowserImagePrimitives {
  return {
    createBitmap: (file) => createImageBitmap(file, { imageOrientation: 'from-image' }),
    createObjectUrl: (file) => URL.createObjectURL(file),
    revokeObjectUrl: (url) => URL.revokeObjectURL(url),
    createImage: () => new Image(),
    // Removing the attribute drops the element's reference without resolving an
    // empty `src` against the page URL and accidentally starting another load.
    clearImageSource: (image) => image.removeAttribute('src'),
    createCanvas: () => document.createElement('canvas')
  };
}

async function decodeBrowserImage(
  file: Blob,
  primitives: BrowserImagePrimitives
): Promise<DecodedImageLease> {
  try {
    const bitmap = await primitives.createBitmap(file);
    let released = false;
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => {
        if (released) return;
        released = true;
        bitmap.close();
      }
    };
  } catch {
    const url = primitives.createObjectUrl(file);
    let image: HTMLImageElement | null = null;
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      if (image) primitives.clearImageSource(image);
      primitives.revokeObjectUrl(url);
    };
    try {
      image = primitives.createImage();
      image.src = url;
      await image.decode();
      return {
        source: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        release
      };
    } catch (error) {
      release();
      throw error;
    }
  }
}

function browserCanvasLease(
  width: number,
  height: number,
  primitives: BrowserImagePrimitives
): TranscodeCanvasLease {
  const canvas = primitives.createCanvas();
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    canvas.width = 1;
    canvas.height = 1;
    throw new Error('Canvas is not available');
  }
  let released = false;
  return {
    draw: (source, drawWidth, drawHeight) => {
      context.drawImage(source, 0, 0, drawWidth, drawHeight);
    },
    encode: (mimeType, quality) => canvas.toDataURL(mimeType, quality),
    release: () => {
      if (released) return;
      released = true;
      canvas.width = 1;
      canvas.height = 1;
    }
  };
}
