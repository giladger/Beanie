import type { Profile, ShotMeasurement, ShotRecord } from '../api/types';
import {
  LiveChart,
  type LiveChartInvalidation
} from '../components/LiveChart';
import { chartModelFromShot } from '../components/liveChartModel';
import {
  calibrationPreviewFactor,
  recordedFlowMultiplier
} from '../domain/flowCalibration';
import type { LiveChartModel } from '../domain/liveChartModel';

export interface FlowCalibratorChartModel {
  readonly active: boolean;
  readonly shot: ShotRecord | null;
  readonly base: number;
  readonly draft: number;
}

/** Browser owner for the calibrator canvas, model cache, and chart lifetime. */
export class FlowCalibratorChartSurface {
  private canvas: HTMLCanvasElement | null = null;
  private chart: LiveChart | null = null;
  private shotId: string | null = null;
  private measurements: readonly ShotMeasurement[] | null = null;
  private profile: Profile | null = null;
  private factor: number | null = null;
  private modelCache: {
    readonly shotId: string;
    readonly measurements: readonly ShotMeasurement[];
    readonly profile: Profile | null;
    readonly model: LiveChartModel;
  } | null = null;
  private suspended = false;
  private disposed = false;

  bind(root: HTMLElement, projection: FlowCalibratorChartModel): void {
    if (this.disposed || !projection.active) {
      this.releaseChart();
      return;
    }
    const canvas = root.querySelector<HTMLCanvasElement>('#flow-cal-canvas');
    const shot = projection.shot;
    if (!canvas || !shot) {
      this.releaseChart();
      return;
    }

    const base = recordedFlowMultiplier(shot) ?? projection.base;
    const factor = calibrationPreviewFactor(base, projection.draft);
    const profile = shot.workflow?.profile ?? null;
    const reuse = canvas === this.canvas && this.chart != null;
    if (
      reuse &&
      this.shotId === shot.id &&
      this.measurements === shot.measurements &&
      this.profile === profile &&
      this.factor === factor
    ) return;

    const source = this.chartModel(shot);
    const series = source.series
      .filter((item) => item.key === 'flow' || item.key === 'weightFlow' || item.key === 'pressure')
      .map((item) => {
        if (item.key === 'flow') {
          return {
            ...item,
            label: 'Machine flow',
            shortLabel: 'Machine flow',
            points: item.points.map((point) => ({
              t: point.t,
              value: point.value * factor
            }))
          };
        }
        if (item.key === 'weightFlow') {
          return { ...item, label: 'Scale flow', shortLabel: 'Scale flow' };
        }
        return item;
      });

    if (!reuse) this.chart?.dispose();
    const chart = reuse
      ? this.chart!
      : new LiveChart(canvas, { detailed: true, pixelScale: 3, hover: true });
    this.chart = chart;
    this.canvas = canvas;
    this.shotId = shot.id;
    this.measurements = shot.measurements;
    this.profile = profile;
    this.factor = factor;
    chart.setModel({ ...source, series });
    if (this.suspended) chart.suspend();
    else chart.invalidate(reuse ? 'model' : 'layout');
  }

  invalidate(reason: LiveChartInvalidation): void {
    this.chart?.invalidate(reason);
  }

  suspend(): void {
    this.suspended = true;
    this.chart?.suspend();
  }

  resume(): void {
    this.suspended = false;
    this.chart?.resume();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.releaseChart();
    this.modelCache = null;
  }

  private chartModel(shot: ShotRecord): LiveChartModel {
    const profile = shot.workflow?.profile ?? null;
    const cached = this.modelCache;
    if (
      cached?.shotId === shot.id &&
      cached.measurements === shot.measurements &&
      cached.profile === profile
    ) return cached.model;
    const model = chartModelFromShot(shot);
    this.modelCache = {
      shotId: shot.id,
      measurements: shot.measurements,
      profile,
      model
    };
    return model;
  }

  private releaseChart(): void {
    this.chart?.dispose();
    this.chart = null;
    this.canvas = null;
    this.shotId = null;
    this.measurements = null;
    this.profile = null;
    this.factor = null;
  }
}
