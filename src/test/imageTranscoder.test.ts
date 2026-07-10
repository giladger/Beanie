import {
  BoundedImageTranscoder,
  ImageBatchPixelLimitError,
  boundedImageDimensions,
  createBrowserImageTranscoderAdapter,
  type BrowserImagePrimitives,
  type DecodedImageLease,
  type ImageTranscoderAdapter,
  type TranscodeCanvasLease
} from '../platform/imageTranscoder';

await run('bounded dimensions enforce edge and per-image pixel budgets', async () => {
  deepEqual(boundedImageDimensions(4_000, 3_000, 2_000, 4_000_000), {
    width: 2_000,
    height: 1_500
  });
  const pixelBound = boundedImageDimensions(4_000, 4_000, 4_000, 1_000_000);
  equal(pixelBound.width, 1_000);
  equal(pixelBound.height, 1_000);
  equal(pixelBound.width * pixelBound.height <= 1_000_000, true);
});

await run('transcode releases decoded and canvas leases after success', async () => {
  const harness = adapterHarness([{ width: 4_000, height: 3_000 }]);
  const transcoder = new BoundedImageTranscoder(harness.adapter);
  const result = await transcoder.transcode(harness.files[0]!, {
    maxEdge: 2_000,
    maxPixels: 2_000_000
  });

  equal(result.width, 1_632);
  equal(result.height, 1_224);
  equal(result.pixels <= 2_000_000, true);
  equal(harness.decodedReleases, 1);
  equal(harness.canvasReleases, 1);
  equal(harness.activeDecodes, 0);
  equal(harness.activeCanvases, 0);
});

await run('draw and encode failures still release both native leases', async () => {
  for (const failAt of ['draw', 'encode'] as const) {
    const harness = adapterHarness([{ width: 800, height: 600 }], failAt);
    const transcoder = new BoundedImageTranscoder(harness.adapter);
    await rejects(() => transcoder.transcode(harness.files[0]!));
    equal(harness.decodedReleases, 1);
    equal(harness.canvasReleases, 1);
    equal(harness.activeDecodes, 0);
    equal(harness.activeCanvases, 0);
  }
});

await run('batch conversion is sequential by default and isolates failures', async () => {
  const harness = adapterHarness([
    { width: 10, height: 10 },
    { width: 10, height: 10 },
    { width: 10, height: 10 }
  ]);
  const transcoder = new BoundedImageTranscoder(harness.adapter);
  const results = await transcoder.transcodeBatch(harness.files, {
    maxEdge: 10,
    maxPixels: 100,
    maxTotalPixels: 200
  });

  equal(harness.maxActiveDecodes, 1);
  equal(harness.maxActiveCanvases, 1);
  equal(results[0]?.status, 'fulfilled');
  equal(results[1]?.status, 'fulfilled');
  equal(results[2]?.status, 'rejected');
  if (results[2]?.status !== 'rejected') throw new Error('Expected pixel-limit rejection');
  equal(results[2].reason instanceof ImageBatchPixelLimitError, true);
  // The rejected image was decoded for dimensions but never acquired a canvas.
  equal(harness.decodedReleases, 3);
  equal(harness.canvasReleases, 2);
});

await run('one host bounds otherwise-concurrent direct transcode calls', async () => {
  const harness = adapterHarness(
    Array.from({ length: 5 }, () => ({ width: 20, height: 20 })),
    null,
    true
  );
  const transcoder = new BoundedImageTranscoder(harness.adapter);
  await Promise.all(harness.files.map((file) => transcoder.transcode(file)));
  equal(harness.maxActiveDecodes, 1);
  equal(harness.maxActiveCanvases, 1);
});

await run('batch concurrency is bounded by the requested worker count', async () => {
  const harness = adapterHarness(
    Array.from({ length: 8 }, () => ({ width: 20, height: 20 })),
    null,
    true
  );
  const transcoder = new BoundedImageTranscoder(harness.adapter, { maxConcurrency: 2 });
  const results = await transcoder.transcodeBatch(harness.files, {
    concurrency: 2,
    maxEdge: 20,
    maxPixels: 400,
    maxTotalPixels: 3_200
  });
  equal(results.every((result) => result.status === 'fulfilled'), true);
  equal(harness.maxActiveDecodes <= 2, true);
  equal(harness.maxActiveDecodes, 2);
});

await run('disposing the host rejects queued and future image work', async () => {
  const harness = adapterHarness([
    { width: 20, height: 20 },
    { width: 20, height: 20 },
    { width: 20, height: 20 }
  ]);
  const transcoder = new BoundedImageTranscoder(harness.adapter);
  const active = transcoder.transcode(harness.files[0]!);
  const queuedRejection = rejects(() => transcoder.transcode(harness.files[1]!));

  transcoder.dispose();
  await active;
  await queuedRejection;
  await rejects(() => transcoder.transcode(harness.files[2]!));

  equal(transcoder.isDisposed, true);
  equal(harness.decodedReleases, 1);
  equal(harness.canvasReleases, 1);
});

await run('browser fallback clears img src and revokes its object URL', async () => {
  const resources = browserHarness({ bitmapFails: true });
  const transcoder = new BoundedImageTranscoder(
    createBrowserImageTranscoderAdapter(resources.primitives)
  );
  await transcoder.transcode(new Blob(['fallback']));

  equal(resources.imageSourceClears, 1);
  deepEqual(resources.revokedUrls, ['blob:test']);
  equal(resources.canvas.width, 1);
  equal(resources.canvas.height, 1);
});

await run('browser bitmap and canvas backing store release after encode failure', async () => {
  const resources = browserHarness({ encodeFails: true });
  const transcoder = new BoundedImageTranscoder(
    createBrowserImageTranscoderAdapter(resources.primitives)
  );
  await rejects(() => transcoder.transcode(new Blob(['bitmap'])));

  equal(resources.bitmapCloses, 1);
  equal(resources.canvas.width, 1);
  equal(resources.canvas.height, 1);
});

await run('missing 2D context shrinks the canvas and closes the decoded bitmap', async () => {
  const resources = browserHarness({ missingContext: true });
  const transcoder = new BoundedImageTranscoder(
    createBrowserImageTranscoderAdapter(resources.primitives)
  );
  await rejects(() => transcoder.transcode(new Blob(['no-context'])));
  equal(resources.bitmapCloses, 1);
  equal(resources.canvas.width, 1);
  equal(resources.canvas.height, 1);
});

await run('failed fallback decode clears img src and revokes before rejecting', async () => {
  const resources = browserHarness({ bitmapFails: true, imageDecodeFails: true });
  const adapter = createBrowserImageTranscoderAdapter(resources.primitives);
  await rejects(() => adapter.decode(new Blob(['bad'])));
  equal(resources.imageSourceClears, 1);
  deepEqual(resources.revokedUrls, ['blob:test']);
});

interface AdapterHarness {
  adapter: ImageTranscoderAdapter;
  files: Blob[];
  activeDecodes: number;
  maxActiveDecodes: number;
  activeCanvases: number;
  maxActiveCanvases: number;
  decodedReleases: number;
  canvasReleases: number;
}

function adapterHarness(
  dimensions: Array<{ width: number; height: number }>,
  failAt: 'draw' | 'encode' | null = null,
  yieldDecode = false
): AdapterHarness {
  const files = dimensions.map((_, index) => new Blob([String(index)]));
  const byFile = new Map(files.map((file, index) => [file, dimensions[index]!]));
  const harness: AdapterHarness = {
    adapter: null as unknown as ImageTranscoderAdapter,
    files,
    activeDecodes: 0,
    maxActiveDecodes: 0,
    activeCanvases: 0,
    maxActiveCanvases: 0,
    decodedReleases: 0,
    canvasReleases: 0
  };
  harness.adapter = {
    decode: async (file): Promise<DecodedImageLease> => {
      const size = byFile.get(file);
      if (!size) throw new Error('Unknown fixture file');
      harness.activeDecodes += 1;
      harness.maxActiveDecodes = Math.max(harness.maxActiveDecodes, harness.activeDecodes);
      if (yieldDecode) await Promise.resolve();
      let released = false;
      return {
        source: {} as CanvasImageSource,
        width: size.width,
        height: size.height,
        release: () => {
          if (released) return;
          released = true;
          harness.decodedReleases += 1;
          harness.activeDecodes -= 1;
        }
      };
    },
    createCanvas: (): TranscodeCanvasLease => {
      harness.activeCanvases += 1;
      harness.maxActiveCanvases = Math.max(harness.maxActiveCanvases, harness.activeCanvases);
      let released = false;
      return {
        draw: () => {
          if (failAt === 'draw') throw new Error('draw failed');
        },
        encode: () => {
          if (failAt === 'encode') throw new Error('encode failed');
          return 'data:image/jpeg;base64,fixture';
        },
        release: () => {
          if (released) return;
          released = true;
          harness.canvasReleases += 1;
          harness.activeCanvases -= 1;
        }
      };
    }
  };
  return harness;
}

interface BrowserHarness {
  primitives: BrowserImagePrimitives;
  canvas: HTMLCanvasElement;
  bitmapCloses: number;
  imageSourceClears: number;
  revokedUrls: string[];
}

function browserHarness(options: {
  bitmapFails?: boolean;
  imageDecodeFails?: boolean;
  encodeFails?: boolean;
  missingContext?: boolean;
}): BrowserHarness {
  let bitmapCloses = 0;
  let imageSourceClears = 0;
  const revokedUrls: string[] = [];
  const bitmap = {
    width: 640,
    height: 480,
    close: () => {
      bitmapCloses += 1;
    }
  } as unknown as ImageBitmap;
  const image = {
    src: '',
    naturalWidth: 640,
    naturalHeight: 480,
    decode: async () => {
      if (options.imageDecodeFails) throw new Error('image decode failed');
    }
  } as unknown as HTMLImageElement;
  const context = {
    drawImage: () => undefined
  } as unknown as CanvasRenderingContext2D;
  const canvas = {
    width: 300,
    height: 150,
    getContext: () => (options.missingContext ? null : context),
    toDataURL: () => {
      if (options.encodeFails) throw new Error('encode failed');
      return 'data:image/jpeg;base64,browser';
    }
  } as unknown as HTMLCanvasElement;

  const primitives: BrowserImagePrimitives = {
    createBitmap: async () => {
      if (options.bitmapFails) throw new Error('bitmap decode failed');
      return bitmap;
    },
    createObjectUrl: () => 'blob:test',
    revokeObjectUrl: (url) => revokedUrls.push(url),
    createImage: () => image,
    clearImageSource: (target) => {
      imageSourceClears += 1;
      target.src = '';
    },
    createCanvas: () => canvas
  };
  return {
    primitives,
    canvas,
    get bitmapCloses() {
      return bitmapCloses;
    },
    get imageSourceClears() {
      return imageSourceClears;
    },
    revokedUrls
  };
}

async function run(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

async function rejects(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch {
    return;
  }
  throw new Error('Expected promise to reject');
}

function equal<T>(actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  }
}

function deepEqual(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}
