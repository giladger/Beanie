import type { ProfileRecord, Workflow } from '../api/types';
import {
  bumpShots,
  markCleaned,
  resolveCleaningProfile,
  type CleaningState
} from '../domain/cleaning';
import type { WaterAlertLevel } from '../domain/waterAlert';

export type CleaningStartPlan =
  | { type: 'ignored' }
  | { type: 'missing-profile'; status: 'No cleaning profile installed' }
  | { type: 'sleeping'; status: 'Machine asleep — tap Wake first' }
  | { type: 'water-block'; status: 'Refill the water tank'; waterAlertDismissed: false }
  | { type: 'ready'; workflow: Workflow; status: 'Loading cleaning profile…' };

export type CleaningWorkflowLoadResult =
  | { type: 'demo'; workflow: Workflow }
  | { type: 'saved'; workflow: Workflow }
  | { type: 'failed'; error: unknown; status: 'Cleaning profile load failed' };

export interface CleaningStartInput {
  busy: boolean;
  liveActive: boolean;
  liveFinalizing: boolean;
  profiles: readonly ProfileRecord[];
  cleaningProfileOverride: string | null;
  workflow: Workflow | null;
  demo: boolean;
  machineSleeping: boolean;
  waterAlert: WaterAlertLevel;
}

export interface CleaningWorkflowLoadDeps {
  updateWorkflow(workflow: Workflow): Promise<Workflow>;
}

export interface CleaningFinishPlan {
  cleaning: CleaningState;
  status: 'Cleaning cycle complete';
}

export interface CleaningProfilePickPlan {
  override: string | null;
  cleaningProfilePicking: false;
  view: 'machine';
  status: 'Cleaning profile set';
}

export interface CleaningThresholdPlan {
  threshold: number;
  status: 'Cleaning reminder updated';
}

export function cleaningStartPlan(input: CleaningStartInput): CleaningStartPlan {
  if (input.busy || input.liveActive || input.liveFinalizing) return { type: 'ignored' };
  const record = resolveCleaningProfile(input.profiles, input.cleaningProfileOverride);
  if (!record?.profile) return { type: 'missing-profile', status: 'No cleaning profile installed' };
  if (!input.demo && input.machineSleeping) return { type: 'sleeping', status: 'Machine asleep — tap Wake first' };
  if (input.waterAlert === 'hard') {
    return { type: 'water-block', waterAlertDismissed: false, status: 'Refill the water tank' };
  }

  return {
    type: 'ready',
    workflow: cleaningWorkflow(input.workflow, record.profile),
    status: 'Loading cleaning profile…'
  };
}

export async function loadCleaningWorkflow(
  workflow: Workflow,
  demo: boolean,
  deps: CleaningWorkflowLoadDeps
): Promise<CleaningWorkflowLoadResult> {
  if (demo) return { type: 'demo', workflow };
  try {
    return { type: 'saved', workflow: await deps.updateWorkflow(workflow) };
  } catch (error) {
    return { type: 'failed', error, status: 'Cleaning profile load failed' };
  }
}

export function finishCleaningCyclePlan(nowIso: string): CleaningFinishPlan {
  return {
    cleaning: markCleaned(nowIso),
    status: 'Cleaning cycle complete'
  };
}

export function countShotForCleaningPlan(cleaning: CleaningState): CleaningState {
  return bumpShots(cleaning);
}

export function pickCleaningProfilePlan(
  profileId: string,
  profiles: readonly ProfileRecord[]
): CleaningProfilePickPlan {
  const autoResolved = resolveCleaningProfile(profiles, null);
  return {
    override: profileId && profileId !== autoResolved?.id ? profileId : null,
    cleaningProfilePicking: false,
    view: 'machine',
    status: 'Cleaning profile set'
  };
}

export function cleaningThresholdPlan(shots: number): CleaningThresholdPlan {
  return {
    threshold: shots,
    status: 'Cleaning reminder updated'
  };
}

function cleaningWorkflow(currentWorkflow: Workflow | null, profile: Workflow['profile']): Workflow {
  return {
    ...(currentWorkflow ?? {}),
    profile,
    context: {
      ...(currentWorkflow?.context ?? {}),
      coffeeName: null,
      coffeeRoaster: null,
      beanBatchId: null,
      finalBeverageType: 'cleaning'
    }
  };
}
