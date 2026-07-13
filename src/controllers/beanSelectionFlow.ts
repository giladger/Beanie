import type {
  Bean,
  BeanBatch,
  Grinder,
  ProfileRecord,
  RecipeDraft,
  ShotRecord,
  Workflow
} from '../api/types';
import { latestBatch } from '../domain/beanWorkflow';
import type {
  BeanInventoryController,
  LatestInventoryProjection
} from './beanInventoryController';
import type {
  BeanSelectionStart,
  BeanWorkflowController
} from './beanWorkflowController';

export interface BeanSelectionOptions {
  readonly apply: boolean;
  readonly preferWorkflow: boolean;
  readonly preferredBatchId?: string | null;
  readonly remember?: boolean;
  readonly allowMaintenanceWrites?: boolean;
}

interface BeanSelectionRunOptions extends BeanSelectionOptions {
  /** Preserve automatic selection while reloading a changed effective bag. */
  readonly selectedBatchIdOverride?: string | null;
}

export interface BeanSelectionSnapshot {
  readonly beans: readonly Bean[];
  readonly workflow: Workflow | null;
  readonly profiles: readonly ProfileRecord[];
  readonly grinders: readonly Grinder[];
  readonly draft: RecipeDraft;
  readonly selectedBeanId: string | null;
  readonly busy: boolean;
  readonly demo: boolean;
  readonly connected: boolean;
  readonly inventoryJournalReady: boolean;
  readonly disposed: boolean;
  readonly authorityRevision: number;
  readonly provenanceRevision: number;
}

export type BeanSelectionEvent =
  | {
      readonly type: 'started';
      readonly state: BeanSelectionStart['state'];
    }
  | {
      readonly type: 'released';
    }
  | {
      readonly type: 'selected';
      readonly beanId: string;
      readonly batches: readonly BeanBatch[];
      readonly beanUsageAt: Readonly<Record<string, number>>;
      readonly state: {
        readonly selectedBatchId: string | null;
        readonly shots: ShotRecord[];
        readonly shotsTotal: number;
        readonly shotsLoadingMore: false;
        readonly compareShotId: null;
        readonly comparePicking: false;
        readonly draft: RecipeDraft;
        readonly busy: false;
        readonly applyState: 'idle';
        readonly status: string;
      };
    };

export interface BeanSelectionHost {
  snapshot(): BeanSelectionSnapshot;
  commit(event: BeanSelectionEvent): void;
}

type SelectionWorkflow = Pick<
  BeanWorkflowController,
  'beginBeanSelection' | 'completeBeanSelection' | 'isCurrentBeanSelection'
>;

type SelectionInventory = Pick<
  BeanInventoryController,
  'cacheRevision' | 'latestProjection' | 'rememberSelectionProjection'
>;

export interface BeanSelectionDependencies {
  readonly workflow: SelectionWorkflow;
  readonly inventory: SelectionInventory;
  writeLastBeanId(beanId: string): void;
  cancelRecipeApply(reason: unknown): void;
  loadBatches(
    bean: Bean,
    allowMaintenanceWrites: boolean,
    resolveProjectionRevision: (revision: number) => void
  ): Promise<BeanBatch[]>;
  loadFirstShots(
    bean: Bean,
    batch: BeanBatch | null
  ): Promise<{ records: ShotRecord[]; total: number }>;
  workflowMatchesBean(bean: Bean, batches: BeanBatch[]): boolean;
  applyDraft(): Promise<void>;
}

export type BeanSelectionOutcome =
  | { readonly type: 'selected'; readonly beanId: string }
  | {
      readonly type: 'ignored';
      readonly reason: 'missing-bean' | 'superseded' | 'runtime-replaced' | 'disposed';
    };

/**
 * Owns acquisition, stale fencing, effective-bag reconciliation, and optional
 * recipe application for one bean selection. BeanWorkflowController remains
 * the sole selection-token owner; this flow deliberately has no request id or
 * second state machine of its own.
 */
export class BeanSelectionFlow {
  constructor(
    private readonly deps: BeanSelectionDependencies,
    private readonly host: BeanSelectionHost
  ) {}

  select(beanId: string, options: BeanSelectionOptions): Promise<BeanSelectionOutcome> {
    return this.run(beanId, options);
  }

  private async run(
    beanId: string,
    options: BeanSelectionRunOptions
  ): Promise<BeanSelectionOutcome> {
    const admission = this.host.snapshot();
    if (admission.disposed) return { type: 'ignored', reason: 'disposed' };

    const authorityRevision = admission.authorityRevision;
    const provenanceRevision = admission.provenanceRevision;
    const selectionProjectionRevisionAtStart =
      this.deps.inventory.latestProjection(beanId)?.selectionRevision ?? 0;
    let loadedProjectionRevision = this.deps.inventory.cacheRevision(beanId);
    const canApply = options.apply && (admission.demo || admission.connected);
    const canPersistSelection = options.remember ?? admission.connected;
    const allowMaintenanceWrites =
      (options.allowMaintenanceWrites ?? admission.connected) && admission.inventoryJournalReady;
    const selection = this.deps.workflow.beginBeanSelection(
      beanId,
      [...admission.beans],
      { writeLastBeanId: canPersistSelection ? this.deps.writeLastBeanId : () => {} }
    );
    if (!selection) return { type: 'ignored', reason: 'missing-bean' };

    this.deps.cancelRecipeApply(new Error(`Superseded by bean selection ${beanId}`));
    this.host.commit({ type: 'started', state: selection.state });

    // Match the shell's prior ordering: recipe inputs are captured immediately
    // after the synchronous selection-start projection has committed.
    const recipeInputs = this.host.snapshot();
    const result = await this.deps.workflow.completeBeanSelection({
      selection,
      options: {
        preferWorkflow: options.preferWorkflow,
        ...(Object.prototype.hasOwnProperty.call(options, 'preferredBatchId')
          ? { preferredBatchId: options.preferredBatchId }
          : {})
      },
      beans: [...recipeInputs.beans],
      workflow: recipeInputs.workflow,
      profiles: [...recipeInputs.profiles],
      grinders: [...recipeInputs.grinders],
      fallbackDraft: recipeInputs.draft,
      loadBatches: (bean) => this.deps.loadBatches(
        bean,
        allowMaintenanceWrites,
        (revision) => { loadedProjectionRevision = revision; }
      ),
      loadFirstShots: (bean, batch) => this.deps.loadFirstShots(bean, batch),
      isCurrent: (current) => this.isCurrent(current),
      workflowMatchesBean: (bean, batches) => this.deps.workflowMatchesBean(bean, batches)
    });
    if (result.type === 'stale') return { type: 'ignored', reason: 'superseded' };

    const settlement = this.host.snapshot();
    if (
      settlement.disposed ||
      provenanceRevision !== settlement.provenanceRevision ||
      (!admission.demo && authorityRevision !== settlement.authorityRevision)
    ) {
      if (this.isCurrent(selection) && settlement.busy) {
        this.host.commit({ type: 'released' });
      }
      return {
        type: 'ignored',
        reason: settlement.disposed ? 'disposed' : 'runtime-replaced'
      };
    }

    const winning = winningInventoryProjection(
      result.batches,
      result.selectedBatch,
      options,
      this.deps.inventory.latestProjection(result.bean.id),
      loadedProjectionRevision,
      selectionProjectionRevisionAtStart
    );
    if (winning.effectiveBatchId !== (result.selectedBatch?.id ?? null)) {
      // A finish/create projection changed the effective bag while shots for
      // the prior bag were loading. Reload so shots and draft share its origin.
      return this.run(result.bean.id, {
        ...options,
        preferredBatchId: winning.effectiveBatchId,
        ...(winning.selectionMode === undefined
          ? {}
          : { selectedBatchIdOverride: winning.selectionMode }),
        remember: false,
        allowMaintenanceWrites
      });
    }

    const selectedBatchId = winning.selectionMode !== undefined
      ? winning.selectionMode
      : Object.prototype.hasOwnProperty.call(options, 'selectedBatchIdOverride')
        ? options.selectedBatchIdOverride ?? null
        : result.selectedBatch &&
            winning.batches.some((candidate) => candidate.id === result.selectedBatch?.id)
          ? result.selectedBatch.id
          : null;
    this.host.commit({
      type: 'selected',
      beanId: result.bean.id,
      batches: winning.batches,
      beanUsageAt: result.beanUsageAt,
      state: {
        selectedBatchId,
        shots: result.shots,
        shotsTotal: result.shotsTotal,
        shotsLoadingMore: false,
        compareShotId: null,
        comparePicking: false,
        draft: result.draft,
        busy: false,
        applyState: 'idle',
        status: options.apply && !canApply
          ? 'Coffee selected; recipe is read-only until live data reconnects'
          : result.status
      }
    });
    this.deps.inventory.rememberSelectionProjection(
      result.bean.id,
      winning.batches,
      selectedBatchId
    );
    if (canApply) await this.deps.applyDraft();
    return { type: 'selected', beanId: result.bean.id };
  }

  private isCurrent(selection: BeanSelectionStart): boolean {
    return this.deps.workflow.isCurrentBeanSelection(selection) &&
      this.host.snapshot().selectedBeanId === selection.bean.id;
  }
}

function winningInventoryProjection(
  loadedBatches: readonly BeanBatch[],
  loadedSelectedBatch: BeanBatch | null,
  options: BeanSelectionRunOptions,
  latestProjection: LatestInventoryProjection | null,
  loadedProjectionRevision: number,
  selectionProjectionRevisionAtStart: number
): {
  readonly batches: BeanBatch[];
  readonly effectiveBatchId: string | null;
  readonly selectionMode: string | null | undefined;
} {
  const latestSelectedBatchId = latestProjection &&
    Object.prototype.hasOwnProperty.call(latestProjection.projection, 'selectedBatchId')
    ? latestProjection.projection.selectedBatchId ?? null
    : undefined;
  const latestBatchesWon = Boolean(
    latestProjection && latestProjection.revision > loadedProjectionRevision
  );
  const batches = latestBatchesWon
    ? [...latestProjection!.projection.batches]
    : [...loadedBatches];
  let effectiveBatchId = loadedSelectedBatch?.id ?? null;
  let selectionMode: string | null | undefined;

  if (
    latestProjection?.selectionRevision != null &&
    latestProjection.selectionRevision > selectionProjectionRevisionAtStart &&
    latestSelectedBatchId !== undefined
  ) {
    selectionMode = latestSelectedBatchId;
    const explicitlySelected = latestSelectedBatchId
      ? batches.find((batch) => batch.id === latestSelectedBatchId) ?? null
      : null;
    effectiveBatchId = explicitlySelected && !isFinishedBatch(explicitlySelected)
      ? explicitlySelected.id
      : latestUsableBatchId(batches);
  } else if (latestBatchesWon) {
    const selectedBatchInProjection = loadedSelectedBatch
      ? batches.find((batch) => batch.id === loadedSelectedBatch.id) ?? null
      : null;
    const selectionWasExplicit = Object.prototype.hasOwnProperty.call(
      options,
      'preferredBatchId'
    );
    if (
      (selectedBatchInProjection && isFinishedBatch(selectedBatchInProjection)) ||
      (loadedSelectedBatch && !selectedBatchInProjection) ||
      (!loadedSelectedBatch && !selectionWasExplicit && batches.length > 0)
    ) {
      effectiveBatchId = latestUsableBatchId(batches);
    }
  }
  return { batches, effectiveBatchId, selectionMode };
}

function latestUsableBatchId(batches: readonly BeanBatch[]): string | null {
  return latestBatch(batches.filter((batch) => !isFinishedBatch(batch)))?.id ??
    latestBatch([...batches])?.id ??
    null;
}

function isFinishedBatch(batch: BeanBatch): boolean {
  return typeof batch.weightRemaining === 'number' &&
    Number.isFinite(batch.weightRemaining) &&
    batch.weightRemaining < 5;
}
