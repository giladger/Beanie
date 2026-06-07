export type StepSensor = 'coffee' | 'water';
export type StepPump = 'pressure' | 'flow';
export type StepTransition = 'fast' | 'smooth';
export type StepExitType = 'pressure' | 'flow';
export type StepExitCondition = 'over' | 'under';

export interface StepExit {
  type: StepExitType;
  condition: StepExitCondition;
  value: number;
}

export interface StepLimiter {
  value: number;
  range: number;
}

export interface EditorStep {
  name: string;
  temperature: number;
  sensor: StepSensor;
  pump: StepPump;
  pressure: number;
  flow: number;
  transition: StepTransition;
  seconds: number;
  volume: number;
  weight: number;
  exit: StepExit | null;
  limiter: StepLimiter | null;
  extra: Record<string, unknown>;
}

export type ProfileMetaKey =
  | 'title'
  | 'author'
  | 'notes'
  | 'beverage_type'
  | 'type'
  | 'legacy_profile_type'
  | 'tank_temperature'
  | 'target_weight'
  | 'target_volume'
  | 'target_volume_count_start';

export type StepFieldKey =
  | 'name'
  | 'popup'
  | 'temperature'
  | 'sensor'
  | 'pressure'
  | 'flow'
  | 'seconds'
  | 'volume'
  | 'weight'
  | 'limiter_value'
  | 'limiter_range';

export const PROFILE_BEVERAGE_TYPES = [
  'espresso',
  'filter',
  'pour_over',
  'tea_portafilter',
  'cleaning',
  'calibrate',
  'manual'
] as const;

// de1app caps advanced profiles at 20 steps.
export const MAX_STEPS = 20;

/**
 * Canonical field ranges, mirrored from de1app `machine.tcl` / `vars.tcl` so the
 * editor's limits match the Decent tablet exactly. Single source of truth for
 * min/max/step/default/unit.
 */
export interface FieldSpec {
  min: number;
  max: number;
  step: number;
  default: number;
  unit: string;
}

export const FIELD_SPECS = {
  // Advanced step fields (settings_2c)
  stepTemperature: { min: -30, max: 105, step: 0.5, default: 90, unit: '°C' },
  stepPressure: { min: 0, max: 11, step: 0.1, default: 9, unit: 'bar' },
  stepFlow: { min: 0, max: 8, step: 0.1, default: 6, unit: 'ml/s' },
  stepSeconds: { min: 0, max: 127, step: 0.2, default: 30, unit: 's' },
  stepVolume: { min: 0, max: 2000, step: 1, default: 0, unit: 'ml' },
  stepWeight: { min: 0, max: 2000, step: 0.1, default: 0, unit: 'g' },
  exitPressure: { min: 0, max: 11, step: 0.1, default: 4, unit: 'bar' },
  exitFlow: { min: 0, max: 6, step: 0.1, default: 6, unit: 'ml/s' },
  limiterValue: { min: 0, max: 11, step: 0.1, default: 0, unit: '' },
  limiterRange: { min: 0.1, max: 8, step: 0.1, default: 0.6, unit: '' },
  // Simple editors (settings_2a / settings_2b)
  preinfusionTime: { min: 0, max: 60, step: 1, default: 20, unit: 's' },
  preinfusionFlow: { min: 1, max: 8, step: 0.1, default: 4, unit: 'ml/s' },
  preinfusionStopPressure: { min: 1, max: 12, step: 0.1, default: 4, unit: 'bar' },
  espressoPressure: { min: 1, max: 12, step: 0.1, default: 8.6, unit: 'bar' },
  pressureEnd: { min: 1, max: 12, step: 0.1, default: 6, unit: 'bar' },
  holdTime: { min: 0, max: 60, step: 1, default: 4, unit: 's' },
  declineTime: { min: 0, max: 60, step: 1, default: 30, unit: 's' },
  maximumPressure: { min: 0, max: 12, step: 0.1, default: 0, unit: 'bar' },
  maximumFlow: { min: 0, max: 8, step: 0.1, default: 0, unit: 'ml/s' },
  // Limits tab (settings_2c2)
  tankTemperature: { min: 0, max: 45, step: 1, default: 0, unit: '°C' },
  targetWeight: { min: 0, max: 2000, step: 0.1, default: 36, unit: 'g' },
  targetVolume: { min: 0, max: 2000, step: 1, default: 36, unit: 'ml' },
  targetVolumeCountStart: { min: 0, max: 10, step: 1, default: 0, unit: '' }
} as const satisfies Record<string, FieldSpec>;
