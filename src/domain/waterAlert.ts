import type { MachineState } from '../api/types';
import { waterTankMlFromMm } from './waterTank';

// Water-tank low-level alerting.
//
//  - `hard`: the machine itself refuses shots (state `needsWater`), or the tank
//    is at/below the user's configured hard threshold. The UI shows a
//    screen-blocking refill popup.
//  - `soft`: the tank is at/below the configured soft threshold but still above
//    the hard one — a non-blocking heads-up so you can refill before it stops.
//
// Thresholds are expressed in millilitres (matching the topbar readout); the raw
// tank reading from reaprime is a height in mm, converted via de1app's table.

export type WaterAlertLevel = 'none' | 'soft' | 'hard';

export interface WaterAlertInput {
  /** Raw tank height in mm (reaprime `currentLevel`), or null if unknown. */
  levelMm: number | null;
  /** Current machine state — `needsWater` always forces a hard alert. */
  machineState?: MachineState | null;
  /** Soft warning threshold in ml; 0 disables the soft warning. */
  softLimitMl: number;
  /** Hard block threshold in ml; 0 = rely solely on the machine's own block. */
  hardLimitMl: number;
}

/** Reminder threshold presets (ml) offered in Settings. 0 = off / machine-only. */
export const WATER_SOFT_OPTIONS_ML = [0, 250, 400, 600] as const;
export const WATER_HARD_OPTIONS_ML = [0, 100, 150, 200] as const;
export const DEFAULT_WATER_SOFT_ML = 400;
export const DEFAULT_WATER_HARD_ML = 0;

/** Tank reading converted to millilitres, or null when unknown. */
export function waterLevelMl(levelMm: number | null): number | null {
  return levelMm == null ? null : waterTankMlFromMm(levelMm);
}

export function waterAlertLevel(input: WaterAlertInput): WaterAlertLevel {
  if (input.machineState === 'needsWater') return 'hard';
  const ml = waterLevelMl(input.levelMm);
  if (ml == null) return 'none';
  if (input.hardLimitMl > 0 && ml <= input.hardLimitMl) return 'hard';
  if (input.softLimitMl > 0 && ml <= input.softLimitMl) return 'soft';
  return 'none';
}
