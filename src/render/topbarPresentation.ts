import { waterTankMlFromMm } from '../domain/waterTank';
import { SourceHysteresis } from '../domain/sourceHysteresis';

export type TopbarStatusTone =
  | 'ready'
  | 'heating'
  | 'active'
  | 'asleep'
  | 'alert'
  | '';

export type TopbarWaterAlert = 'none' | 'soft' | 'hard';

export interface TopbarStatusInput {
  label: string;
  tone?: TopbarStatusTone | null;
}

/** The scale fields needed to project its complete topbar presentation. */
export interface TopbarScaleInput {
  weight: number | null | undefined;
  batteryLevel?: number | null;
  status?: 'connected' | 'disconnected';
}

export interface TopbarPresentationInput {
  /** App-specific overrides (offline, no-scale warning) are resolved upstream. */
  status: TopbarStatusInput;
  groupTemperatureC: number | null | undefined;
  steamTemperatureC: number | null | undefined;
  waterLevelMm: number | null | undefined;
  waterAlert?: TopbarWaterAlert;
  scale: TopbarScaleInput | null;
}

/** Every dynamic property that the stat's DOM owner must commit atomically. */
export interface StatViewModel {
  readonly text: string;
  readonly className: string;
  readonly title: string;
  readonly ariaLabel: string;
}

export interface TopbarViewModel {
  readonly machine: StatViewModel;
  readonly group: StatViewModel;
  readonly steam: StatViewModel;
  readonly water: StatViewModel;
  readonly scale: StatViewModel;
}

export interface TopbarHysteresisThresholds {
  /** Degrees Celsius from the last accepted source reading. */
  groupTemperatureC: number;
  /** Degrees Celsius from the last accepted source reading. */
  steamTemperatureC: number;
  /** Raw tank height millimetres, before the discontinuous ml lookup. */
  waterLevelMm: number;
}

export const DEFAULT_TOPBAR_HYSTERESIS: Readonly<TopbarHysteresisThresholds> = {
  groupTemperatureC: 1.2,
  steamTemperatureC: 4,
  waterLevelMm: 0.5
};

const WATER_SETTINGS_TITLE = 'Water level alert settings';
const SCALE_LOW_BATTERY_PERCENT = 20;

/**
 * Projects raw topbar sources into one complete, stable display model.
 *
 * Numeric stabilization deliberately happens in each sensor's continuous
 * source unit. In particular, water is stabilized in millimetres before the
 * integer-indexed tank calibration is applied, so 49.9999/50.0001 mm noise
 * cannot become a 1420/1450 ml repaint loop.
 */
export class TopbarProjector {
  private readonly group: SourceHysteresis;
  private readonly steam: SourceHysteresis;
  private readonly water: SourceHysteresis;
  private lastModel: TopbarViewModel | null = null;

  constructor(thresholds: Partial<TopbarHysteresisThresholds> = {}) {
    const resolved = { ...DEFAULT_TOPBAR_HYSTERESIS, ...thresholds };
    validateThresholds(resolved);
    this.group = new SourceHysteresis(resolved.groupTemperatureC);
    this.steam = new SourceHysteresis(resolved.steamTemperatureC);
    this.water = new SourceHysteresis(resolved.waterLevelMm);
  }

  project(input: TopbarPresentationInput): TopbarViewModel {
    const groupC = this.group.update(input.groupTemperatureC);
    const steamC = this.steam.update(input.steamTemperatureC);
    const waterMm = this.water.update(input.waterLevelMm);

    const machineText = input.status.label;
    const machineTone = input.status.tone ?? '';
    const groupText = temperatureText(groupC);
    const steamText = temperatureText(steamC);
    const waterText = waterTextFromMm(waterMm);
    const scaleText = scaleTextFrom(input.scale);
    const scaleTitle = scaleTitleFrom(input.scale);

    const model: TopbarViewModel = {
      machine: {
        text: machineText,
        className: classNames('top-stat', machineTone && `stat-tone-${machineTone}`),
        title: '',
        ariaLabel: `Status: ${machineText}`
      },
      group: {
        text: groupText,
        className: 'top-stat',
        title: '',
        ariaLabel: `Group: ${groupText}`
      },
      steam: {
        text: steamText,
        className: 'top-stat',
        title: '',
        ariaLabel: `Steam: ${steamText}`
      },
      water: {
        text: waterText,
        className: classNames(
          'top-stat top-stat-button',
          input.waterAlert === 'hard'
            ? 'stat-alert'
            : input.waterAlert === 'soft'
              ? 'stat-warn'
              : ''
        ),
        title: WATER_SETTINGS_TITLE,
        ariaLabel: `Water: ${waterText}. ${WATER_SETTINGS_TITLE}`
      },
      scale: {
        text: scaleText,
        className: classNames(
          'top-stat top-stat-button top-stat-divide',
          scaleBatteryLow(input.scale) ? 'stat-warn' : ''
        ),
        title: scaleTitle,
        ariaLabel: `Scale: ${scaleText}. ${scaleTitle}`
      }
    };

    // Stable object identity lets a RenderChannel use its default Object.is
    // comparator while still suppressing unchanged presentation commits.
    if (this.lastModel && topbarViewModelsEqual(this.lastModel, model)) {
      return this.lastModel;
    }
    this.lastModel = model;
    return model;
  }

  /** Clears presentation history, e.g. when a topbar owner is remounted. */
  reset(): void {
    this.group.reset();
    this.steam.reset();
    this.water.reset();
    this.lastModel = null;
  }
}

export function statViewModelsEqual(a: StatViewModel, b: StatViewModel): boolean {
  return (
    a.text === b.text &&
    a.className === b.className &&
    a.title === b.title &&
    a.ariaLabel === b.ariaLabel
  );
}

export function topbarViewModelsEqual(a: TopbarViewModel, b: TopbarViewModel): boolean {
  return (
    statViewModelsEqual(a.machine, b.machine) &&
    statViewModelsEqual(a.group, b.group) &&
    statViewModelsEqual(a.steam, b.steam) &&
    statViewModelsEqual(a.water, b.water) &&
    statViewModelsEqual(a.scale, b.scale)
  );
}

function validateThresholds(thresholds: TopbarHysteresisThresholds): void {
  for (const [name, value] of Object.entries(thresholds)) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`Topbar hysteresis ${name} must be a finite positive number`);
    }
  }
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function temperatureText(valueC: number | null): string {
  return valueC == null ? '--' : `${Math.round(valueC)}°C`;
}

function waterTextFromMm(valueMm: number | null): string {
  if (valueMm == null) return '--';
  const roundedMl = Math.round(waterTankMlFromMm(valueMm) / 10) * 10;
  return `${roundedMl} ml`;
}

function scaleConnected(scale: TopbarScaleInput | null): boolean {
  return scale != null && scale.status !== 'disconnected';
}

function scaleBatteryPercent(scale: TopbarScaleInput | null): number | null {
  const raw = scale?.batteryLevel;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return null;
  const percent = raw <= 1 ? raw * 100 : raw;
  return Math.min(100, Math.round(percent));
}

function scaleBatteryLow(scale: TopbarScaleInput | null): boolean {
  if (!scaleConnected(scale)) return false;
  const battery = scaleBatteryPercent(scale);
  return battery != null && battery <= SCALE_LOW_BATTERY_PERCENT;
}

function scaleTextFrom(scale: TopbarScaleInput | null): string {
  if (!scaleConnected(scale)) return 'Connect';
  const weight = finiteOrNull(scale?.weight);
  const text = `${weight == null ? '--' : weight.toFixed(1)} g`;
  const battery = scaleBatteryPercent(scale);
  return battery != null && battery <= SCALE_LOW_BATTERY_PERCENT
    ? `${text} · ${battery}%`
    : text;
}

function scaleTitleFrom(scale: TopbarScaleInput | null): string {
  const base = scaleConnected(scale) ? 'Tare scale' : 'Search for preferred scale';
  const battery = scaleBatteryPercent(scale);
  return battery == null ? base : `${base} · battery ${battery}%`;
}

function classNames(base: string, modifier: string | null | undefined): string {
  return modifier ? `${base} ${modifier}` : base;
}
