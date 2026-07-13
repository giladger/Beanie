import type { ShotRecord } from '../api/types';
import {
  renderFlowCalibrator,
  type FlowCalibratorModel
} from '../components/flowCalibrator';
import { renderPageHeader } from './workbenchView';

export interface FlowCalibratorPageModel {
  readonly shots: readonly ShotRecord[];
  readonly calibration: FlowCalibratorModel;
  readonly busy: boolean;
  readonly writable: boolean;
}

export function renderFlowCalibratorPage(model: FlowCalibratorPageModel): string {
  return `
    ${renderPageHeader('Flow Calibrator', 'workbench')}
    ${renderFlowCalibrator(
      model.shots,
      model.calibration,
      model.busy,
      model.writable
    )}
  `;
}
