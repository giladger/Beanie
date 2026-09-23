import type {
  De1MachineSettings,
  HotWaterData,
  MachineCapabilities,
  RinseData,
  SteamSettings,
  Workflow
} from '../api/types';

export interface NumberSpec {
  min: number;
  max: number;
  step: number;
  unit: string;
  enabled: boolean;
  reason?: string;
  /** When set, a value below `min` means "off"; the tile and editor show this label for it. */
  offLabel?: string;
}

export interface WaterSectionSpecs {
  targetTemperature: NumberSpec;
  duration: NumberSpec;
  flow: NumberSpec;
  volume?: NumberSpec;
  stopAtTemperature?: NumberSpec;
}

export interface WaterControlCapabilities {
  hardware: string[];
  source: 'machine' | 'workflow' | 'demo';
  steam: WaterSectionSpecs;
  hotWater: WaterSectionSpecs;
  flush: WaterSectionSpecs;
}

export interface WaterPreset<T> {
  id: string;
  label: string;
  summary: string;
  values: T;
}

export const DEFAULT_STEAM: Required<SteamSettings> = {
  targetTemperature: 150,
  duration: 50,
  flow: 0.8,
  stopAtTemperature: 0
};

/**
 * The DE1 turns its steam heater off when the target steam temperature it is
 * sent is below this (de1app and reaprime both use 135). Beanie stores "off"
 * as 0, so a steam preset whose Temp is Off keeps the heater cold until a
 * preset with a real temperature is applied.
 */
export const STEAM_HEATER_MIN_TEMPERATURE = 135;

export function steamHeaterOn(settings: SteamSettings | null | undefined): boolean {
  return (settings?.targetTemperature ?? DEFAULT_STEAM.targetTemperature) >= STEAM_HEATER_MIN_TEMPERATURE;
}

export const DEFAULT_HOT_WATER: Required<HotWaterData> = {
  targetTemperature: 75,
  duration: 30,
  volume: 50,
  flow: 10
};

export const DEFAULT_RINSE: Required<RinseData> = {
  targetTemperature: 90,
  duration: 10,
  flow: 6
};

export const STEAM_PRESETS: WaterPreset<SteamSettings>[] = [
  {
    id: 'small-jug',
    label: 'Small jug',
    summary: '120-180 ml milk',
    values: { targetTemperature: 145, duration: 35, flow: 0.7, stopAtTemperature: 0 }
  },
  {
    id: 'medium-jug',
    label: 'Medium jug',
    summary: '180-300 ml milk',
    values: { targetTemperature: 150, duration: 50, flow: 0.8, stopAtTemperature: 0 }
  },
  {
    id: 'large-jug',
    label: 'Large jug',
    summary: '300-450 ml milk',
    values: { targetTemperature: 155, duration: 70, flow: 0.95, stopAtTemperature: 0 }
  }
];

export const HOT_WATER_PRESETS: WaterPreset<HotWaterData>[] = [
  {
    id: 'americano',
    label: 'Americano',
    summary: 'Fast cup fill',
    values: { targetTemperature: 75, duration: 30, volume: 120, flow: 10 }
  },
  {
    id: 'tea',
    label: 'Tea',
    summary: 'Hotter, gentler flow',
    values: { targetTemperature: 90, duration: 35, volume: 180, flow: 7 }
  },
  {
    id: 'preheat',
    label: 'Preheat',
    summary: 'Small warming dose',
    values: { targetTemperature: 80, duration: 12, volume: 60, flow: 6 }
  }
];

export const FLUSH_PRESETS: WaterPreset<RinseData>[] = [
  {
    id: 'quick',
    label: 'Quick',
    summary: 'Short screen rinse',
    values: { targetTemperature: 90, duration: 4, flow: 6 }
  },
  {
    id: 'standard',
    label: 'Standard',
    summary: 'Daily cleanup',
    values: { targetTemperature: 90, duration: 10, flow: 6 }
  },
  {
    id: 'long',
    label: 'Long',
    summary: 'After milk drinks',
    values: { targetTemperature: 92, duration: 20, flow: 7 }
  }
];

const SUPPORTED_BY_WORKFLOW = 'Saved to Reaprime workflow and applied by the machine when connected';
const STOP_AT_TEMP_UNSUPPORTED =
  'Reaprime currently round-trips this target, but no production probe capability is exposed yet';

export function steamValues(workflow: Workflow | null | undefined, settings?: De1MachineSettings | null): SteamSettings {
  return {
    ...DEFAULT_STEAM,
    ...workflow?.steamSettings,
    flow: settings?.steamFlow ?? workflow?.steamSettings?.flow ?? DEFAULT_STEAM.flow
  };
}

export function hotWaterValues(
  workflow: Workflow | null | undefined,
  settings?: De1MachineSettings | null
): HotWaterData {
  return {
    ...DEFAULT_HOT_WATER,
    ...workflow?.hotWaterData,
    flow: settings?.hotWaterFlow ?? workflow?.hotWaterData?.flow ?? DEFAULT_HOT_WATER.flow
  };
}

export function flushValues(workflow: Workflow | null | undefined, settings?: De1MachineSettings | null): RinseData {
  return {
    ...DEFAULT_RINSE,
    ...workflow?.rinseData,
    targetTemperature: settings?.flushTemp ?? workflow?.rinseData?.targetTemperature ?? DEFAULT_RINSE.targetTemperature,
    duration: settings?.flushTimeout ?? workflow?.rinseData?.duration ?? DEFAULT_RINSE.duration,
    flow: settings?.flushFlow ?? workflow?.rinseData?.flow ?? DEFAULT_RINSE.flow
  };
}

export function waterControlCapabilities(options: {
  capabilities?: MachineCapabilities | null;
  settings?: De1MachineSettings | null;
  demo?: boolean;
}): WaterControlCapabilities {
  const hasMachineSettings = options.settings != null;
  const source = hasMachineSettings ? 'machine' : options.demo === true ? 'demo' : 'workflow';
  const machineReason = hasMachineSettings || options.demo === true ? undefined : SUPPORTED_BY_WORKFLOW;
  const steamStopSupported = false;

  return {
    hardware: options.capabilities?.capabilities ?? [],
    source,
    steam: {
      targetTemperature: { ...spec(STEAM_HEATER_MIN_TEMPERATURE, 170, 1, 'C', true, machineReason), offLabel: 'Off' },
      duration: spec(0, 180, 1, 's', true),
      flow: spec(0.1, 2, 0.05, 'ml/s', true, machineReason),
      stopAtTemperature: spec(0, 80, 0.5, 'C', steamStopSupported, STOP_AT_TEMP_UNSUPPORTED)
    },
    hotWater: {
      targetTemperature: spec(0, 100, 1, 'C', true),
      duration: spec(0, 180, 1, 's', true),
      volume: spec(0, 500, 1, 'ml', true),
      flow: spec(0.1, 12, 0.1, 'ml/s', true, machineReason)
    },
    flush: {
      targetTemperature: spec(0, 100, 1, 'C', true, machineReason),
      duration: spec(0, 120, 1, 's', true),
      flow: spec(0.1, 12, 0.1, 'ml/s', true, machineReason)
    }
  };
}

export function clampSteam(settings: SteamSettings, caps: WaterControlCapabilities): SteamSettings {
  return {
    targetTemperature: clampSteamTemperature(settings.targetTemperature, caps.steam.targetTemperature),
    duration: clampNumber(settings.duration, caps.steam.duration, DEFAULT_STEAM.duration),
    flow: clampNumber(settings.flow, caps.steam.flow, DEFAULT_STEAM.flow),
    stopAtTemperature: clampNumber(settings.stopAtTemperature, caps.steam.stopAtTemperature!, 0)
  };
}

export function clampHotWater(settings: HotWaterData, caps: WaterControlCapabilities): HotWaterData {
  return {
    targetTemperature: clampNumber(settings.targetTemperature, caps.hotWater.targetTemperature, DEFAULT_HOT_WATER.targetTemperature),
    duration: clampNumber(settings.duration, caps.hotWater.duration, DEFAULT_HOT_WATER.duration),
    volume: clampNumber(settings.volume, caps.hotWater.volume!, DEFAULT_HOT_WATER.volume),
    flow: clampNumber(settings.flow, caps.hotWater.flow, DEFAULT_HOT_WATER.flow)
  };
}

export function clampFlush(settings: RinseData, caps: WaterControlCapabilities): RinseData {
  return {
    targetTemperature: clampNumber(settings.targetTemperature, caps.flush.targetTemperature, DEFAULT_RINSE.targetTemperature),
    duration: clampNumber(settings.duration, caps.flush.duration, DEFAULT_RINSE.duration),
    flow: clampNumber(settings.flow, caps.flush.flow, DEFAULT_RINSE.flow)
  };
}

export function matchingPreset<T extends object>(
  values: T,
  presets: WaterPreset<T>[]
): string {
  const found = presets.find((preset) => valuesMatch(values, preset.values));
  return found?.id ?? 'custom';
}

function spec(min: number, max: number, step: number, unit: string, enabled: boolean, reason?: string): NumberSpec {
  return { min, max, step, unit, enabled, reason };
}

// Below the heater minimum means "off": normalize to 0 instead of clamping up
// to the minimum, which would silently turn the heater back on.
function clampSteamTemperature(value: number | null | undefined, field: NumberSpec): number {
  const numeric = Number(value ?? DEFAULT_STEAM.targetTemperature);
  if (!Number.isFinite(numeric)) return DEFAULT_STEAM.targetTemperature;
  if (numeric < field.min) return 0;
  return clampNumber(numeric, field, DEFAULT_STEAM.targetTemperature);
}

function clampNumber(value: number | null | undefined, field: NumberSpec, fallback: number): number {
  const numeric = Number(value ?? fallback);
  if (!Number.isFinite(numeric)) return fallback;
  return Number(Math.min(field.max, Math.max(field.min, numeric)).toFixed(2));
}

function valuesMatch<T extends object>(a: T, b: T): boolean {
  const leftValues = a as Record<string, number | undefined>;
  const rightValues = b as Record<string, number | undefined>;
  return Object.keys(b).every((key) => {
    const left = Number(leftValues[key]);
    const right = Number(rightValues[key]);
    return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) < 0.001;
  });
}
