import type { MachineState } from '../api/types';
import { waterTankMlFromMm } from './waterTank';

// Water-tank low-level alerting.
//
//  - `hard`: the machine itself reports it needs a refill (state `needsWater`)
//    and is refusing shots. This is driven entirely by the machine — when the
//    tank reaches the DE1's own refill threshold — and shows a blocking popup.
//    The threshold is configured on the machine via gateway.setRefillLevel().
//  - `soft`: an app-side early warning. When the tank drops to/below the user's
//    configured soft level (ml) we flag it in the UI so they can refill before
//    the machine stops them.

export type WaterAlertLevel = 'none' | 'soft' | 'hard';

export interface WaterAlertInput {
  /** Raw tank height in mm (reaprime `currentLevel`), or null if unknown. */
  levelMm: number | null;
  /** Current machine state — `needsWater` is the machine's own refill block. */
  machineState?: MachineState | null;
  /** Soft warning threshold in ml; 0 disables the soft warning. */
  softLimitMl: number;
}

export const DEFAULT_WATER_SOFT_ML = 400;
/** Bounds for the soft-warning numpad control (ml). */
export const WATER_SOFT_MIN_ML = 0;
export const WATER_SOFT_MAX_ML = 1500;
export const WATER_SOFT_STEP_ML = 10;
/** Bounds for the machine refill-level numpad control (mm). */
export const MACHINE_REFILL_MIN_MM = 0;
export const MACHINE_REFILL_MAX_MM = 25;
export const MACHINE_REFILL_STEP_MM = 1;

/** Tank reading converted to millilitres, or null when unknown. */
export function waterLevelMl(levelMm: number | null): number | null {
  return levelMm == null ? null : waterTankMlFromMm(levelMm);
}

export function waterAlertLevel(input: WaterAlertInput): WaterAlertLevel {
  // The hard block is the machine's call, not ours.
  if (input.machineState === 'needsWater') return 'hard';
  const ml = waterLevelMl(input.levelMm);
  if (ml == null) return 'none';
  if (input.softLimitMl > 0 && ml <= input.softLimitMl) return 'soft';
  return 'none';
}
