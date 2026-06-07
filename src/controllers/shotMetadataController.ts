import type { ShotRecord, ShotUpdate, Workflow } from '../api/types';

export interface SaveShotUpdateInput {
  shot: ShotRecord;
  update: ShotUpdate;
  demo: boolean;
  successStatus: string;
  demoStatus: string;
  failureStatus: string;
}

export interface SaveShotUpdateDeps {
  updateShot(shotId: string, update: ShotUpdate): Promise<ShotRecord>;
  invalidateShotMutation(shotId: string): Promise<void>;
  putShotRecord(shot: ShotRecord): Promise<void>;
}

export type SaveShotUpdateResult =
  | {
      type: 'saved';
      shot: ShotRecord;
      status: string;
      remote: boolean;
    }
  | {
      type: 'failed';
      status: string;
      error: unknown;
    };

export function shotEnjoymentUpdate(shot: ShotRecord, value: number | null): ShotUpdate {
  return {
    annotations: {
      ...(shot.annotations ?? {}),
      enjoyment: value
    }
  };
}

export async function saveShotUpdate(
  input: SaveShotUpdateInput,
  deps: SaveShotUpdateDeps
): Promise<SaveShotUpdateResult> {
  if (input.demo) {
    return {
      type: 'saved',
      shot: applyShotUpdate(input.shot, input.update),
      status: input.demoStatus,
      remote: false
    };
  }

  try {
    const saved = await deps.updateShot(input.shot.id, input.update);
    await deps.invalidateShotMutation(saved.id);
    await deps.putShotRecord(saved);
    return {
      type: 'saved',
      shot: saved,
      status: input.successStatus,
      remote: true
    };
  } catch (error) {
    return {
      type: 'failed',
      status: input.failureStatus,
      error
    };
  }
}

export function applyShotUpdate(shot: ShotRecord, update: ShotUpdate): ShotRecord {
  const workflow = update.workflow
    ? ({
        ...(shot.workflow ?? {}),
        ...update.workflow,
        context: Object.prototype.hasOwnProperty.call(update.workflow, 'context')
          ? update.workflow.context
          : shot.workflow?.context
      } as Workflow)
    : shot.workflow;
  return {
    ...shot,
    workflow,
    annotations: Object.prototype.hasOwnProperty.call(update, 'annotations')
      ? update.annotations
      : shot.annotations,
    shotNotes: Object.prototype.hasOwnProperty.call(update, 'shotNotes')
      ? update.shotNotes
      : shot.shotNotes,
    metadata: Object.prototype.hasOwnProperty.call(update, 'metadata')
      ? update.metadata
      : shot.metadata
  };
}
