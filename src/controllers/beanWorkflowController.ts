import type {
  Bean,
  BeanBatch,
  Grinder,
  ProfileRecord,
  RecipeDraft,
  ShotRecord,
  ShotSummary,
  Workflow,
  WorkflowContext
} from '../api/types';
import {
  beanLabel,
  latestBatch,
  normalizeDraft,
  recipeFromShot,
  recipeFromWorkflow
} from '../domain/beanWorkflow';
import { isServiceShot } from '../domain/shotRecord';

export type BatchesByBean = Record<string, BeanBatch[]>;

export interface BeanSelectionStart {
  requestId: number;
  bean: Bean;
  state: {
    selectedBeanId: string;
    busy: true;
    status: string;
  };
}

export interface BeginBeanSelectionDeps {
  writeLastBeanId(beanId: string): void;
}

export interface CompleteBeanSelectionInput {
  selection: BeanSelectionStart;
  options: { preferWorkflow: boolean; preferredBatchId?: string | null };
  beans: Bean[];
  workflow: Workflow | null;
  profiles: ProfileRecord[];
  grinders: Grinder[];
  fallbackDraft?: RecipeDraft | null;
  loadBatches(bean: Bean): Promise<BeanBatch[]>;
  loadFirstShots(bean: Bean, batch: BeanBatch | null): Promise<{ records: ShotRecord[]; total: number }>;
  isCurrent(selection: BeanSelectionStart): boolean;
  workflowMatchesBean(bean: Bean, batches: BeanBatch[]): boolean;
}

export type BeanSelectionCompleteResult =
  | {
      type: 'selected';
      bean: Bean;
      batches: BeanBatch[];
      selectedBatch: BeanBatch | null;
      shots: ShotRecord[];
      shotsTotal: number;
      beanUsageAt: Record<string, number>;
      draft: RecipeDraft;
      status: string;
    }
  | {
      type: 'stale';
  };

export interface SaveBeanInput {
  beans: Bean[];
  batchesByBean: BatchesByBean;
  editingId: string | null;
  fields: Partial<Bean>;
  demo: boolean;
  nowMs: number;
}

export interface SaveBeanDeps {
  createBean(fields: Partial<Bean>): Promise<Bean>;
  updateBean(id: string, fields: Partial<Bean>): Promise<Bean>;
  putBeans(beans: Bean[]): Promise<void>;
  putBeanBatches(beanId: string, batches: BeanBatch[]): Promise<void>;
}

export type SaveBeanResult =
  | {
      type: 'saved';
      bean: Bean;
      beans: Bean[];
      batchesByBean: BatchesByBean;
      editing: boolean;
      selectBeanId: string | null;
      status: string;
    }
  | {
      type: 'failed';
      status: 'Save bean failed';
      error: unknown;
    };

export interface ArchiveBeanInput {
  beans: Bean[];
  id: string;
  selectedBeanId: string | null;
  demo: boolean;
}

export interface ArchiveBeanDeps {
  updateBean(id: string, fields: Partial<Bean>): Promise<Bean>;
  invalidateBeanMutation(beanId: string): Promise<void>;
  putBeans(beans: Bean[]): Promise<void>;
}

export type ArchiveBeanResult =
  | {
      type: 'archived';
      beans: Bean[];
      nextSelectedBeanId: string | null;
      archivedSelectedBean: boolean;
      status: 'Bag deleted';
    }
  | {
      type: 'failed';
      status: 'Delete failed';
      error: unknown;
    };

export interface CreateBatchInput {
  bean: Bean;
  batchesByBean: BatchesByBean;
  selectedBeanId: string | null;
  selectedBatchId: string | null;
  batchInput: Partial<BeanBatch>;
  demo: boolean;
  nowMs: number;
}

export interface CreateBatchDeps {
  createBatch(beanId: string, batch: Partial<BeanBatch>): Promise<BeanBatch>;
  putBeanBatches(beanId: string, batches: BeanBatch[]): Promise<void>;
}

export type CreateBatchResult =
  | {
      type: 'created';
      batch: BeanBatch;
      batches: BeanBatch[];
      batchesByBean: BatchesByBean;
      selectedBatchId: string | null;
      selectedCurrentBean: boolean;
      status: string;
    }
  | {
      type: 'failed';
      status: 'Add batch failed';
      error: unknown;
    };

export interface DeleteBatchInput {
  bean: Bean;
  batchesByBean: BatchesByBean;
  selectedBeanId: string | null;
  selectedBatchId: string | null;
  batchId: string;
  demo: boolean;
}

export interface DeleteBatchDeps {
  deleteBatch(batchId: string): Promise<void>;
  putBeanBatches(beanId: string, batches: BeanBatch[]): Promise<void>;
}

export type DeleteBatchResult =
  | {
      type: 'deleted';
      batches: BeanBatch[];
      batchesByBean: BatchesByBean;
      selectedBatchId: string | null;
      selectedCurrentBean: boolean;
      status: 'Batch deleted';
    }
  | {
      type: 'failed';
      status: 'Delete batch failed';
      error: unknown;
    };

export interface BeginBatchUpdateInput {
  bean: Bean;
  batchesByBean: BatchesByBean;
  selectedBeanId: string | null;
  batchId: string;
  batchInput: Partial<BeanBatch>;
  demo: boolean;
}

export type BeginBatchUpdateResult =
  | {
      type: 'optimistic';
      previousBatches: BeanBatch[];
      optimisticBatch: BeanBatch;
      optimisticBatches: BeanBatch[];
      batchesByBean: BatchesByBean;
      selectedCurrentBean: boolean;
      shouldScheduleApply: boolean;
      complete: boolean;
      status: 'Batch saved';
    }
  | {
      type: 'missing';
    };

export interface FinishBatchUpdateInput {
  bean: Bean;
  batchId: string;
  batchInput: Partial<BeanBatch>;
  latestBatchesByBean: BatchesByBean;
  previousBatches: BeanBatch[];
}

export interface FinishBatchUpdateDeps {
  updateBatch(batchId: string, batch: Partial<BeanBatch>): Promise<BeanBatch>;
  putBeanBatches(beanId: string, batches: BeanBatch[]): Promise<void>;
}

export type FinishBatchUpdateResult =
  | {
      type: 'saved';
      batches: BeanBatch[];
      batchesByBean: BatchesByBean;
      status: 'Batch saved';
    }
  | {
      type: 'failed';
      batchesByBean: BatchesByBean;
      status: 'Save batch failed';
      error: unknown;
    };

export interface SaveGrinderInput {
  grinders: Grinder[];
  editingId: string | null;
  grinderInput: Partial<Grinder>;
  demo: boolean;
  nowMs: number;
}

export interface SaveGrinderDeps {
  createGrinder(input: Partial<Grinder>): Promise<Grinder>;
  updateGrinder(id: string, input: Partial<Grinder>): Promise<Grinder>;
  putGrinders(grinders: Grinder[]): Promise<void>;
}

export type SaveGrinderResult =
  | {
      type: 'saved';
      grinder: Grinder;
      grinders: Grinder[];
      editing: boolean;
      status: string;
    }
  | {
      type: 'failed';
      status: 'Save grinder failed';
      error: unknown;
    };

export class BeanWorkflowController {
  private beanSelectionRequestId = 0;

  beginBeanSelection(
    beanId: string,
    beans: Bean[],
    deps?: BeginBeanSelectionDeps
  ): BeanSelectionStart | null {
    const bean = beans.find((item) => item.id === beanId);
    if (!bean) return null;
    const requestId = ++this.beanSelectionRequestId;
    deps?.writeLastBeanId(bean.id);
    return {
      requestId,
      bean,
      state: {
        selectedBeanId: bean.id,
        busy: true,
        status: `Loading ${beanLabel(bean)}`
      }
    };
  }

  isCurrentBeanSelection(selection: BeanSelectionStart): boolean {
    return selection.requestId === this.beanSelectionRequestId;
  }

  async completeBeanSelection(input: CompleteBeanSelectionInput): Promise<BeanSelectionCompleteResult> {
    const { selection, options } = input;
    const { bean } = selection;
    const batches = await input.loadBatches(bean);
    if (!input.isCurrent(selection)) return { type: 'stale' };

    const preferredBatch = input.options.preferredBatchId
      ? batches.find((batch) => batch.id === input.options.preferredBatchId) ?? null
      : null;
    const selectedBatch = preferredBatch ?? latestBatch(batches.filter(isUsableBatch)) ?? latestBatch(batches);
    const { records: shots, total: shotsTotal } = await input.loadFirstShots(bean, selectedBatch);
    if (!input.isCurrent(selection)) return { type: 'stale' };

    const workflowMatches = input.workflowMatchesBean(bean, batches);
    const draftShot = shots.find((shot) => !isServiceShot(shot)) ?? null;
    const draft =
      options.preferWorkflow && workflowMatches
        ? recipeFromWorkflow(input.workflow)
        : draftShot
          ? recipeFromShot(draftShot, 'planned')
          : input.fallbackDraft ?? recipeFromShot(null, 'planned');

    return {
      type: 'selected',
      bean,
      batches,
      selectedBatch,
      shots,
      shotsTotal,
      beanUsageAt: beanUsageForBean(bean.id, shots),
      draft: normalizeDraft(draft, input.profiles, input.grinders),
      status: `${shots.length} shots loaded`
    };
  }

  async saveBean(input: SaveBeanInput, deps: SaveBeanDeps): Promise<SaveBeanResult> {
    const editing = input.editingId != null;
    if (input.demo) {
      const timestamp = new Date(input.nowMs).toISOString();
      const bean: Bean = editing
        ? { ...(input.beans.find((item) => item.id === input.editingId) as Bean), ...input.fields }
        : ({ id: `demo-${input.nowMs}`, createdAt: timestamp, updatedAt: timestamp, ...input.fields } as Bean);
      const beans = editing
        ? input.beans.map((item) => (item.id === input.editingId ? bean : item))
        : [bean, ...input.beans];
      return {
        type: 'saved',
        bean,
        beans,
        batchesByBean: editing ? input.batchesByBean : { ...input.batchesByBean, [bean.id]: [] },
        editing,
        selectBeanId: editing ? null : bean.id,
        status: editing ? 'Bean saved (demo)' : 'Bean added (demo)'
      };
    }

    try {
      const bean = editing
        ? await deps.updateBean(input.editingId!, input.fields)
        : await deps.createBean(input.fields);
      const timestamp = new Date(input.nowMs).toISOString();
      const savedBean = editing
        ? bean
        : { ...bean, createdAt: bean.createdAt ?? timestamp, updatedAt: bean.updatedAt ?? timestamp };
      const beans = editing
        ? input.beans.map((item) => (item.id === input.editingId ? savedBean : item))
        : [savedBean, ...input.beans];
      await deps.putBeans(beans).catch(() => {});
      if (!editing) await deps.putBeanBatches(bean.id, []).catch(() => {});
      return {
        type: 'saved',
        bean: savedBean,
        beans,
        batchesByBean: editing ? input.batchesByBean : { ...input.batchesByBean, [savedBean.id]: [] },
        editing,
        selectBeanId: editing ? null : bean.id,
        status: editing ? 'Bean saved' : 'Bean added'
      };
    } catch (error) {
      return { type: 'failed', status: 'Save bean failed', error };
    }
  }

  async archiveBean(input: ArchiveBeanInput, deps: ArchiveBeanDeps): Promise<ArchiveBeanResult> {
    if (!input.demo) {
      try {
        await deps.updateBean(input.id, { archived: true });
      } catch (error) {
        return { type: 'failed', status: 'Delete failed', error };
      }
    }

    const beans = input.beans.filter((bean) => bean.id !== input.id);
    if (!input.demo) {
      await deps.invalidateBeanMutation(input.id)
        .then(() => deps.putBeans(beans))
        .catch(() => {});
    }
    const archivedSelectedBean = input.selectedBeanId === input.id;
    return {
      type: 'archived',
      beans,
      nextSelectedBeanId: archivedSelectedBean ? beans[0]?.id ?? null : input.selectedBeanId,
      archivedSelectedBean,
      status: 'Bag deleted'
    };
  }

  async createBatch(input: CreateBatchInput, deps: CreateBatchDeps): Promise<CreateBatchResult> {
    const current = input.batchesByBean[input.bean.id] ?? [];
    const selectedCurrentBean = input.bean.id === input.selectedBeanId;
    if (input.demo) {
      const batch: BeanBatch = { id: `demo-batch-${input.nowMs}`, ...input.batchInput } as BeanBatch;
      const batches = [batch, ...current];
      return {
        type: 'created',
        batch,
        batches,
        batchesByBean: { ...input.batchesByBean, [input.bean.id]: batches },
        selectedBatchId: selectedCurrentBean ? batch.id : input.selectedBatchId,
        selectedCurrentBean,
        status: 'Batch added (demo)'
      };
    }

    try {
      const batch = await deps.createBatch(input.bean.id, input.batchInput);
      const latest = input.batchesByBean[input.bean.id] ?? [];
      const batches = [batch, ...latest];
      await deps.putBeanBatches(input.bean.id, batches).catch(() => {});
      return {
        type: 'created',
        batch,
        batches,
        batchesByBean: { ...input.batchesByBean, [input.bean.id]: batches },
        selectedBatchId: selectedCurrentBean ? batch.id : input.selectedBatchId,
        selectedCurrentBean,
        status: 'Batch added'
      };
    } catch (error) {
      return { type: 'failed', status: 'Add batch failed', error };
    }
  }

  async deleteBatch(input: DeleteBatchInput, deps: DeleteBatchDeps): Promise<DeleteBatchResult> {
    const current = input.batchesByBean[input.bean.id] ?? [];
    const batches = current.filter((item) => item.id !== input.batchId);
    const selectedCurrentBean = input.bean.id === input.selectedBeanId;
    const selectedBatchId = selectedCurrentBean ? latestBatch(batches)?.id ?? null : input.selectedBatchId;

    if (!input.demo) {
      try {
        await deps.deleteBatch(input.batchId);
        await deps.putBeanBatches(input.bean.id, batches).catch(() => {});
      } catch (error) {
        return { type: 'failed', status: 'Delete batch failed', error };
      }
    }

    return {
      type: 'deleted',
      batches,
      batchesByBean: { ...input.batchesByBean, [input.bean.id]: batches },
      selectedBatchId,
      selectedCurrentBean,
      status: 'Batch deleted'
    };
  }

  beginBatchUpdate(input: BeginBatchUpdateInput): BeginBatchUpdateResult {
    const previousBatches = input.batchesByBean[input.bean.id] ?? [];
    const previous = previousBatches.find((item) => item.id === input.batchId);
    if (!previous) return { type: 'missing' };
    const optimisticBatch: BeanBatch = {
      ...previous,
      ...input.batchInput,
      id: input.batchId,
      beanId: input.bean.id
    };
    const optimisticBatches = previousBatches.map((item) =>
      item.id === input.batchId ? optimisticBatch : item
    );
    const selectedCurrentBean = input.bean.id === input.selectedBeanId;
    return {
      type: 'optimistic',
      previousBatches,
      optimisticBatch,
      optimisticBatches,
      batchesByBean: { ...input.batchesByBean, [input.bean.id]: optimisticBatches },
      selectedCurrentBean,
      shouldScheduleApply: selectedCurrentBean && latestBatch(optimisticBatches)?.id === input.batchId,
      complete: input.demo,
      status: 'Batch saved'
    };
  }

  async finishBatchUpdate(
    input: FinishBatchUpdateInput,
    deps: FinishBatchUpdateDeps
  ): Promise<FinishBatchUpdateResult> {
    try {
      const saved = await deps.updateBatch(input.batchId, input.batchInput);
      const latest = input.latestBatchesByBean[input.bean.id] ?? [];
      const batches = latest.map((item) => (item.id === input.batchId ? saved : item));
      await deps.putBeanBatches(input.bean.id, batches).catch(() => {});
      return {
        type: 'saved',
        batches,
        batchesByBean: { ...input.latestBatchesByBean, [input.bean.id]: batches },
        status: 'Batch saved'
      };
    } catch (error) {
      return {
        type: 'failed',
        batchesByBean: { ...input.latestBatchesByBean, [input.bean.id]: input.previousBatches },
        status: 'Save batch failed',
        error
      };
    }
  }

  async saveGrinder(input: SaveGrinderInput, deps: SaveGrinderDeps): Promise<SaveGrinderResult> {
    const editing = input.editingId != null;
    if (input.demo) {
      const grinder: Grinder = editing
        ? ({ ...(input.grinders.find((item) => item.id === input.editingId) ?? { id: input.editingId! }), ...input.grinderInput } as Grinder)
        : ({ id: `demo-grinder-${input.nowMs}`, ...input.grinderInput } as Grinder);
      const grinders = editing
        ? input.grinders.map((item) => (item.id === input.editingId ? grinder : item))
        : [grinder, ...input.grinders];
      return {
        type: 'saved',
        grinder,
        grinders,
        editing,
        status: editing ? 'Grinder saved (demo)' : 'Grinder added (demo)'
      };
    }

    try {
      const grinder = editing
        ? await deps.updateGrinder(input.editingId!, input.grinderInput)
        : await deps.createGrinder(input.grinderInput);
      const grinders = editing
        ? input.grinders.map((item) => (item.id === input.editingId ? grinder : item))
        : [grinder, ...input.grinders];
      await deps.putGrinders(grinders).catch(() => {});
      return {
        type: 'saved',
        grinder,
        grinders,
        editing,
        status: editing ? 'Grinder saved' : 'Grinder added'
      };
    } catch (error) {
      return { type: 'failed', status: 'Save grinder failed', error };
    }
  }
}

function isUsableBatch(batch: BeanBatch): boolean {
  return !(typeof batch.weightRemaining === 'number' && Number.isFinite(batch.weightRemaining) && batch.weightRemaining < 5);
}

export function beanUsageFromShots(
  beans: Bean[],
  shots: Array<ShotSummary | ShotRecord>,
  batchesByBean: BatchesByBean = {}
): Record<string, number> {
  const usage: Record<string, number> = {};
  for (const shot of shots) {
    const beanId = beanIdForContext(shot.workflow?.context, beans, batchesByBean);
    if (!beanId) continue;
    const timestamp = Date.parse(shot.timestamp);
    if (!Number.isFinite(timestamp)) continue;
    usage[beanId] = Math.max(usage[beanId] ?? 0, timestamp);
  }
  return usage;
}

export function beanUsageForBean(beanId: string, shots: Array<ShotSummary | ShotRecord>): Record<string, number> {
  let latest = 0;
  for (const shot of shots) {
    const timestamp = Date.parse(shot.timestamp);
    if (Number.isFinite(timestamp)) latest = Math.max(latest, timestamp);
  }
  return latest > 0 ? { [beanId]: latest } : {};
}

export function beanIdForContext(
  ctx: WorkflowContext | null | undefined,
  beans: Bean[],
  batchesByBean: BatchesByBean = {}
): string | null {
  const directBeanId = contextBeanId(ctx);
  if (directBeanId && beans.some((bean) => bean.id === directBeanId)) return directBeanId;

  const batchId = ctx?.beanBatchId;
  if (!batchId) return null;
  for (const [beanId, batches] of Object.entries(batchesByBean)) {
    if (batches.some((batch) => batch.id === batchId)) return beanId;
  }
  return null;
}

function contextBeanId(ctx: WorkflowContext | null | undefined): string | null {
  const value = (ctx as (WorkflowContext & { beanId?: string | null }) | null | undefined)?.beanId;
  return typeof value === 'string' && value ? value : null;
}
