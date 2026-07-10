import {
  LiveChart,
  buildHoverRows,
  clamp01,
  computeCanvasBackingStoreSize,
  computePlotArea,
  formatTick,
  hoverValueText,
  niceStep,
  projectX,
  projectY,
  seriesValueAt,
  tickValues,
  type PlotArea
} from '../components/LiveChart';
import type { LiveChartModel } from '../domain/liveChartModel';

run('computePlotArea respects detailed margins', () => {
  const plot = computePlotArea(920, 340, true);
  equal(plot.x, 42);
  equal(plot.y, 18);
  equal(plot.width, 920 - 42 - 22);
  equal(plot.height, 340 - 18 - 58);
});

run('computePlotArea uses compact margins when not detailed', () => {
  const plot = computePlotArea(360, 120, false);
  equal(plot.x, 7);
  equal(plot.y, 7);
  equal(plot.width, 360 - 14);
  equal(plot.height, 120 - 14);
});

run('projectX maps time start to left edge and maxTime to right edge', () => {
  const plot: PlotArea = { x: 42, y: 42, width: 600, height: 260 };
  equal(projectX(0, 30, plot), plot.x);
  equal(projectX(30, 30, plot), plot.x + plot.width);
  equal(projectX(15, 30, plot), plot.x + plot.width / 2);
});

run('projectY maps zero to bottom and maxY to top', () => {
  const plot: PlotArea = { x: 42, y: 42, width: 600, height: 260 };
  equal(projectY(0, 12, plot), plot.y + plot.height);
  equal(projectY(12, 12, plot), plot.y);
  equal(projectY(6, 12, plot), plot.y + plot.height / 2);
});

run('projectY clamps values above maxY to the top edge', () => {
  const plot: PlotArea = { x: 0, y: 0, width: 100, height: 100 };
  equal(projectY(99, 10, plot), plot.y);
});

run('projectY clamps negative values to the bottom edge', () => {
  const plot: PlotArea = { x: 0, y: 0, width: 100, height: 100 };
  equal(projectY(-5, 10, plot), plot.y + plot.height);
});

run('projectX guards against a zero maxTime', () => {
  const plot: PlotArea = { x: 10, y: 0, width: 100, height: 100 };
  equal(projectX(0, 0, plot), plot.x);
});

run('clamp01 bounds values to the unit interval', () => {
  equal(clamp01(-1), 0);
  equal(clamp01(0.5), 0.5);
  equal(clamp01(2), 1);
});

run('niceStep snaps raw steps to friendly increments', () => {
  equal(niceStep(0.4), 1);
  equal(niceStep(1.5), 2);
  equal(niceStep(3), 5);
  equal(niceStep(8), 10);
  equal(niceStep(23), 30);
});

run('tickValues produces ascending ticks ending at the max', () => {
  const ticks = tickValues(12, 5);
  equal(ticks[0], 0);
  equal(ticks[ticks.length - 1], 12);
  for (let i = 1; i < ticks.length; i += 1) {
    if (ticks[i]! <= ticks[i - 1]!) throw new Error('Ticks must strictly ascend');
  }
});

run('formatTick keeps integers clean and trims decimals', () => {
  equal(formatTick(5), '5');
  equal(formatTick(2.5), '2.5');
});

run('seriesValueAt interpolates between surrounding samples', () => {
  const points = [
    { t: 0, value: 0 },
    { t: 2, value: 4 },
    { t: 4, value: 4 }
  ];
  equal(seriesValueAt(points, 0), 0);
  equal(seriesValueAt(points, 1), 2);
  equal(seriesValueAt(points, 2), 4);
  equal(seriesValueAt(points, 3), 4);
  equal(seriesValueAt(points, 4), 4);
});

run('seriesValueAt returns null outside the recorded range', () => {
  const points = [
    { t: 1, value: 3 },
    { t: 2, value: 5 }
  ];
  equal(seriesValueAt(points, 0.5), null);
  equal(seriesValueAt(points, 2.5), null);
  equal(seriesValueAt([], 1), null);
});

run('hoverValueText prints real units and unscales the temp series', () => {
  equal(hoverValueText('pressure', 8.25), '8.3 bar');
  equal(hoverValueText('targetFlow', 2), '2.0 ml/s');
  equal(hoverValueText('weightFlow', 1.8), '1.8 g/s');
  equal(hoverValueText('groupTemperature', 8.53), '85.3°C');
  equal(hoverValueText('targetTemperature', 8.8), '88.0°C');
});

run('buildHoverRows skips legendless overlays and out-of-range series', () => {
  const model: LiveChartModel = {
    maxTime: 10,
    maxY: 12,
    markers: [],
    series: [
      {
        key: 'pressure',
        label: 'Pressure',
        shortLabel: 'Pressure',
        color: '#50c17b',
        points: [
          { t: 0, value: 0 },
          { t: 10, value: 9 }
        ]
      },
      {
        key: 'flow',
        label: 'Flow',
        shortLabel: 'Flow',
        color: '#7ca8ff',
        legend: false,
        points: [
          { t: 0, value: 1 },
          { t: 10, value: 1 }
        ]
      },
      {
        key: 'weightFlow',
        label: 'Weight flow',
        shortLabel: 'Weight flow',
        color: '#8a6d1c',
        points: [
          { t: 6, value: 2 },
          { t: 10, value: 2 }
        ]
      },
      {
        key: 'groupTemperature',
        label: 'Temp / 10',
        shortLabel: 'Temp / 10',
        color: '#ff5a67',
        points: [
          { t: 0, value: 9.2 },
          { t: 10, value: 9.2 }
        ]
      }
    ]
  };
  const rows = buildHoverRows(model, 5);
  equal(rows.length, 2);
  equal(rows[0]!.label, 'Pressure');
  equal(rows[0]!.text, '4.5 bar');
  equal(rows[1]!.label, 'Temp');
  equal(rows[1]!.text, '92.0°C');
});

run('canvas backing-store sizing caps DPR and pixelScale to a pixel budget', () => {
  const capped = computeCanvasBackingStoreSize(1000, 500, 2, 3, 2_000_000);
  equal(capped.scale, 2);
  equal(capped.width, 2000);
  equal(capped.height, 1000);
  equal(capped.width * capped.height <= 2_000_000, true);
  equal(capped.capped, true);

  const uncapped = computeCanvasBackingStoreSize(800, 400, 2, 1, 4_000_000);
  equal(uncapped.scale, 2);
  equal(uncapped.width, 1600);
  equal(uncapped.height, 800);
  equal(uncapped.capped, false);
});

run('LiveChart resize applies the bounded backing store and isotropic transform', () => {
  withFakeWindow({ devicePixelRatio: 2 }, () => {
    const harness = createCanvasHarness(1000, 500);
    const chart = new LiveChart(harness.canvas, {
      pixelScale: 3,
      maxBackingStorePixels: 2_000_000
    });

    chart.resize();

    equal(harness.canvas.width, 2000);
    equal(harness.canvas.height, 1000);
    equal(harness.transforms.length, 1);
    equal(harness.transforms[0]![0], 2);
    equal(harness.transforms[0]![3], 2);
    chart.dispose();
  });
});

run('LiveChart invalidation coalesces input reasons and resizes layout before drawing', () => {
  let scheduled: FrameRequestCallback | null = null;
  let requestCount = 0;
  withFakeWindow(
    {
      requestAnimationFrame: (callback: FrameRequestCallback): number => {
        requestCount += 1;
        scheduled = callback;
        return 17;
      },
      cancelAnimationFrame: (): void => undefined
    },
    () => {
      const harness = createCanvasHarness();
      const chart = new LiveChart(harness.canvas);
      let resizeCount = 0;
      let drawCount = 0;
      chart.resize = (): void => {
        resizeCount += 1;
      };
      chart.draw = (): void => {
        drawCount += 1;
      };

      chart.invalidate('model');
      chart.invalidate('layout');
      chart.invalidate('theme');

      equal(requestCount, 1);
      equal(resizeCount, 0);
      equal(drawCount, 0);
      if (scheduled == null) throw new Error('Expected a scheduled chart frame');
      scheduled(0);
      equal(resizeCount, 1);
      equal(drawCount, 1);
      chart.dispose();
    }
  );
});

run('LiveChart dispose cancels work, removes hover listeners, and releases the canvas', () => {
  let scheduled: FrameRequestCallback | null = null;
  const cancelled: number[] = [];
  let requestCount = 0;
  withFakeWindow(
    {
      matchMedia: (): MediaQueryList => ({ matches: true }) as MediaQueryList,
      requestAnimationFrame: (callback: FrameRequestCallback): number => {
        requestCount += 1;
        scheduled = callback;
        return 23;
      },
      cancelAnimationFrame: (handle: number): void => {
        cancelled.push(handle);
      }
    },
    () => {
      const harness = createCanvasHarness();
      const chart = new LiveChart(harness.canvas, { hover: true });
      let drawCount = 0;
      chart.draw = (): void => {
        drawCount += 1;
      };

      equal(harness.listenerCount('pointermove'), 1);
      equal(harness.listenerCount('pointerleave'), 1);
      harness.dispatch(
        'pointermove',
        { pointerType: 'mouse', clientX: 20, clientY: 30 } as unknown as PointerEvent
      );
      equal(requestCount, 1);

      chart.dispose();
      chart.dispose();

      equal(chart.isDisposed, true);
      equal(cancelled.length, 1);
      equal(cancelled[0], 23);
      equal(harness.listenerCount('pointermove'), 0);
      equal(harness.listenerCount('pointerleave'), 0);
      equal(harness.canvas.width, 1);
      equal(harness.canvas.height, 1);

      // A callback already dequeued by the browser is still harmless, and no
      // subsequent invalidation can schedule work after disposal.
      if (scheduled == null) throw new Error('Expected a scheduled hover frame');
      scheduled(0);
      chart.invalidate('layout');
      equal(drawCount, 0);
      equal(requestCount, 1);
    }
  );
});

run('LiveChart suspension releases its backing store and resumes with one layout paint', () => {
  const scheduled: FrameRequestCallback[] = [];
  const cancelled: number[] = [];
  withFakeWindow(
    {
      matchMedia: (): MediaQueryList => ({ matches: true }) as MediaQueryList,
      requestAnimationFrame: (callback: FrameRequestCallback): number => {
        scheduled.push(callback);
        return scheduled.length;
      },
      cancelAnimationFrame: (handle: number): void => {
        cancelled.push(handle);
      }
    },
    () => {
      const harness = createCanvasHarness();
      const chart = new LiveChart(harness.canvas, { hover: true });
      let resizeCount = 0;
      let drawCount = 0;
      chart.resize = (): void => {
        resizeCount += 1;
      };
      chart.draw = (): void => {
        drawCount += 1;
      };

      chart.invalidate('model');
      equal(scheduled.length, 1);
      chart.suspend();
      equal(chart.isSuspended, true);
      equal(cancelled[0], 1);
      equal(harness.canvas.width, 1);
      equal(harness.canvas.height, 1);
      equal(harness.listenerCount('pointermove'), 0);

      // A dequeued pre-suspend callback cannot paint.
      scheduled[0]!(0);
      equal(drawCount, 0);

      chart.resume();
      equal(chart.isSuspended, false);
      equal(scheduled.length, 2);
      equal(harness.listenerCount('pointermove'), 1);
      scheduled[1]!(0);
      equal(resizeCount, 1);
      equal(drawCount, 1);
      chart.dispose();
    }
  );
});

run('LiveChart owns and disconnects its canvas resize observer', () => {
  let observed: Element | null = null;
  let disconnects = 0;
  withFakeResizeObserver(
    class {
      observe(element: Element): void {
        observed = element;
      }

      disconnect(): void {
        disconnects += 1;
      }
    },
    () => {
      const harness = createCanvasHarness();
      const chart = new LiveChart(harness.canvas);
      equal(observed, harness.canvas);
      chart.dispose();
      equal(disconnects, 1);
    }
  );
});

interface CanvasHarness {
  canvas: HTMLCanvasElement;
  transforms: number[][];
  listenerCount(type: string): number;
  dispatch(type: string, event: Event): void;
}

function createCanvasHarness(clientWidth = 640, clientHeight = 320): CanvasHarness {
  const listeners = new Map<string, Set<EventListener>>();
  const transforms: number[][] = [];
  const context = {
    setTransform: (...values: number[]): void => {
      transforms.push(values);
    }
  } as unknown as CanvasRenderingContext2D;
  const canvas = {
    width: 300,
    height: 150,
    clientWidth,
    clientHeight,
    getContext: (): CanvasRenderingContext2D => context,
    getBoundingClientRect: (): Pick<DOMRect, 'left' | 'top'> => ({ left: 0, top: 0 }),
    addEventListener: (type: string, listener: EventListener): void => {
      const registered = listeners.get(type) ?? new Set<EventListener>();
      registered.add(listener);
      listeners.set(type, registered);
    },
    removeEventListener: (type: string, listener: EventListener): void => {
      listeners.get(type)?.delete(listener);
    }
  } as unknown as HTMLCanvasElement;

  return {
    canvas,
    transforms,
    listenerCount: (type: string): number => listeners.get(type)?.size ?? 0,
    dispatch: (type: string, event: Event): void => {
      for (const listener of listeners.get(type) ?? []) listener(event);
    }
  };
}

function withFakeWindow<T>(value: Partial<Window>, fn: () => T): T {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value,
    writable: true
  });
  try {
    return fn();
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  }
}

function withFakeResizeObserver<T>(
  implementation: new () => Pick<ResizeObserver, 'observe' | 'disconnect'>,
  fn: () => T
): T {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: implementation,
    writable: true
  });
  try {
    return fn();
  } finally {
    if (previous) Object.defineProperty(globalThis, 'ResizeObserver', previous);
    else Reflect.deleteProperty(globalThis, 'ResizeObserver');
  }
}

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
    throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  }
}
