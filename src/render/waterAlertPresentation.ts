import { SourceHysteresis } from '../domain/sourceHysteresis';
import {
  waterAlertLevel,
  type WaterAlertInput,
  type WaterAlertLevel
} from '../domain/waterAlert';

/** Display-only stabilization before the discontinuous tank lookup. */
export const WATER_ALERT_HYSTERESIS_MM = 0.5;

/**
 * Stateful presentation projector for the soft alert band. The machine's hard
 * block remains immediate, while sub-millimetre water noise is stabilized
 * before the calibration lookup can turn it into repeated shell transitions.
 */
export class WaterAlertProjector {
  private readonly level = new SourceHysteresis(WATER_ALERT_HYSTERESIS_MM);

  project(input: WaterAlertInput): WaterAlertLevel {
    const levelMm = this.level.update(input.levelMm);
    return waterAlertLevel({ ...input, levelMm });
  }

  reset(): void {
    this.level.reset();
  }
}
