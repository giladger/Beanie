import type { BeanBatch } from '../api/types';
import { appendBatchStorageEvent } from '../domain/beanFreshness';
import { doseReclaimRemaining } from '../domain/doseReclaim';
import type {
  BatchUpdateOutcome,
  BatchUpdateRequest,
  BatchUpdateStart,
  BeanInventoryCommandPort,
  BeanInventoryProjection,
  BeanInventoryRepository,
  BeanInventoryStatePort,
  CreateBatchOutcome,
  CreateBatchRequest,
  DemoDoseReclaimOutcome,
  DemoDoseReclaimRequest,
  FreezeStockOutcome,
  FreezeStockRequest,
  FreezeStockStart,
  RemainingWeightReconciliation
} from './beanInventoryContract';
import {
  batchCreateIdempotencyKey,
  batchFromProjection,
  beanInventoryMutationKey,
  captureFields,
  commandFailureReason,
  copyBatches,
  createCommandFailure,
  createIntentKey,
  createRemainsUnresolved,
  fieldOwnerKey,
  finiteNumber,
  formatGrams,
  isFrozenPortion,
  makeProjection,
  mergePatchedFields,
  needsStorageFollowUp,
  newCreationCandidates,
  nonNegativeNumber,
  normalizedPatch,
  optimisticSelection,
  positiveNumber,
  prependUnique,
  reconcileSavedBatch,
  replaceBatch,
  rollbackBatch,
  rollbackSelection,
  roundGrams,
  sameBatchList,
  shouldScheduleOptimisticApply,
  splitCreateIdempotencyKey,
  splitCreateIntentKey,
  splitCreateRemainsUnresolved,
  splitPlan,
  storagePatch,
  updateStatus,
  type BatchUpdateToken,
  type ConfirmedBatchField,
  type SplitPlan
} from './beanInventoryPolicy';

export type {
  BatchUpdateOutcome,
  BatchUpdatePurpose,
  BatchUpdateRequest,
  BatchUpdateStart,
  BeanInventoryCommandPort,
  BeanInventoryProjection,
  BeanInventoryRepository,
  BeanInventorySnapshot,
  BeanInventoryStatePort,
  CreateBatchOutcome,
  CreateBatchRequest,
  DemoDoseReclaimOutcome,
  DemoDoseReclaimRequest,
  DoseReclaimNotApplicableReason,
  FreezeFailurePhase,
  FreezeStockOutcome,
  FreezeStockRequest,
  FreezeStockStart,
  RemainingWeightReconciliation
} from './beanInventoryContract';
export { beanInventoryMutationKey } from './beanInventoryPolicy';

interface CreateSelectionSnapshot {
  readonly selectedBeanId: string | null;
  readonly selectedBatchId: string | null;
  readonly revision: number;
}

interface UnresolvedSplitCreate {
  readonly idempotencyKey: string;
  readonly operationStartedAtMs: number;
}

interface SplitSourceIntent {
  readonly key: string;
  readonly revision: number;
}

interface RemainingWeightIntent {
  readonly key: string;
  readonly revision: number;
}

export interface InventoryCacheReadToken {
  readonly beanId: string;
  readonly readRevision: number;
  readonly projectionRevision: number;
  /** Foreground mutation generation at lane admission. */
  readonly mutationRevision: number;
  /** Fields already owned when this read entered ordering. */
  readonly ownedFieldKeys: ReadonlySet<string>;
}

export interface LatestInventoryProjection {
  readonly revision: number;
  /** Projection revision that last explicitly changed selectedBatchId, if any. */
  readonly selectionRevision: number | null;
  readonly projection: BeanInventoryProjection;
}

export interface PendingRemainingWeightReservation {
  readonly idempotencyKey: string;
  readonly beanId: string;
  readonly batchId: string;
  /** Field generation captured before this physical adjustment was admitted. */
  readonly fieldRevision: number;
}

export interface PendingRemainingWeightAdjustment
  extends PendingRemainingWeightReservation {
  readonly expectedRemaining: number;
}

export interface InventoryCacheReadPublication {
  readonly revision: number;
  readonly projection: BeanInventoryProjection;
}

interface AuthoritativeRead {
  readonly batches: BeanBatch[] | null;
  readonly error?: unknown;
}

interface ConfirmedSelection {
  readonly revision: number;
  readonly value: string | null;
}

type CreateExecution =
  | { type: 'created'; batch: BeanBatch; recovered: boolean }
  | {
      type: 'uncertain';
      /** Null when the authoritative preflight could not establish a baseline. */
      knownBatchIds: readonly string[] | null;
      authoritative: BeanBatch[] | null;
      error: unknown;
      reconciliationError?: unknown;
    }
  | {
      type: 'incomplete';
      phase: 'persist-storage';
      knownBatch: BeanBatch;
      authoritative: BeanBatch[] | null;
      error: unknown;
      reconciliationError?: unknown;
    };

type SplitExecution =
  | { type: 'committed'; plan: SplitPlan; created: BeanBatch; source: BeanBatch; recovered: boolean }
  | {
      type: 'source-precondition-failed';
      plan: SplitPlan;
      reason: 'gateway' | 'superseded';
      error: unknown;
    }
  | {
      type: 'create-uncertain';
      plan: SplitPlan;
      knownBatchIds: readonly string[] | null;
      authoritative: BeanBatch[] | null;
      error: unknown;
      reconciliationError?: unknown;
    }
  | {
      type: 'post-create-failure';
      plan: SplitPlan;
      phase: 'persist-freezer-state' | 'update-source';
      knownCreated: BeanBatch;
      authoritative: BeanBatch[] | null;
      error: unknown;
      reconciliationError?: unknown;
    };

/**
 * Owns bean-batch mutation policy without knowing AppState, DOM forms, or the
 * concrete gateway/cache singletons. The host synchronously adopts a start
 * projection before awaiting its completion, then adopts the completion
 * projection. Completion reconciliation always reads the latest host state.
 */
export class BeanInventoryController {
  private readonly fieldOwners = new Map<string, number>();
  private readonly fieldIntentRevisions = new Map<string, number>();
  private readonly confirmedFields = new Map<string, ConfirmedBatchField>();
  private mutationRevision = 0;
  private readonly selectionOwners = new Map<string, number>();
  private readonly confirmedSelections = new Map<string, ConfirmedSelection>();
  private readonly splitCompletions = new Map<
    string,
    { readonly grams: number; readonly completion: Promise<FreezeStockOutcome> }
  >();
  private readonly createCompletions = new Map<string, Promise<CreateBatchOutcome>>();
  private readonly unresolvedCreateKeys = new Map<string, string>();
  private readonly unresolvedSplitKeys = new Map<string, UnresolvedSplitCreate>();
  private readonly cacheTails = new Map<string, Promise<void>>();
  private readonly cacheRevisions = new Map<string, number>();
  private readonly cacheReadRevisions = new Map<string, number>();
  private readonly latestCacheProjections = new Map<string, LatestInventoryProjection>();
  private readonly pendingRemainingAdjustments = new Map<
    string,
    PendingRemainingWeightReservation & {
      readonly sequence: number;
      readonly settled: Promise<void>;
      readonly resolve: () => void;
      readonly expectedRemaining: number | null;
    }
  >();
  private pendingRemainingSequence = 0;
  private createOperationSequence = 0;

  constructor(
    private readonly state: BeanInventoryStatePort,
    private readonly commands: BeanInventoryCommandPort,
    private readonly repository: BeanInventoryRepository
  ) {}

  remainingWeightRevision(batchId: string): number {
    return this.fieldIntentRevisions.get(fieldOwnerKey(batchId, 'weightRemaining')) ?? 0;
  }

  /**
   * Serialize cache publication for projections owned by adjacent workflows
   * (durable dose settlement/deletion) with this controller's own writes.
   */
  cacheProjection(projection: BeanInventoryProjection): Promise<void> {
    return this.cache(projection);
  }

  /** Record selection provenance without persisting possibly optimistic batches. */
  rememberSelectionProjection(
    beanId: string,
    batches: readonly BeanBatch[],
    selectedBatchId: string | null
  ): void {
    this.rememberProjection({
      beanId,
      batches: [...batches],
      selectedBatchId,
      shouldScheduleApply: false
    });
  }

  cacheRevision(beanId: string): number {
    return this.cacheRevisions.get(beanId) ?? 0;
  }

  latestProjectionBatches(beanId: string): readonly BeanBatch[] | null {
    return this.latestCacheProjections.get(beanId)?.projection.batches ?? null;
  }

  latestProjection(beanId: string): LatestInventoryProjection | null {
    return this.latestCacheProjections.get(beanId) ?? null;
  }

  beginCacheRead(beanId: string): InventoryCacheReadToken {
    const readRevision = (this.cacheReadRevisions.get(beanId) ?? 0) + 1;
    this.cacheReadRevisions.set(beanId, readRevision);
    return {
      beanId,
      readRevision,
      projectionRevision: this.cacheRevision(beanId),
      mutationRevision: this.mutationRevision,
      ownedFieldKeys: new Set(this.fieldOwners.keys())
    };
  }

  cacheReadIsCurrent(token: InventoryCacheReadToken): boolean {
    return this.cacheReadRevisions.get(token.beanId) === token.readRevision;
  }

  async cacheProjectionFromRead(
    projection: BeanInventoryProjection,
    token: InventoryCacheReadToken
  ): Promise<InventoryCacheReadPublication | null> {
    if (!this.cacheReadIsCurrent(token)) return null;
    this.refreshOwnedConfirmedFields(projection.batches, token);
    const local = copyBatches(this.state.snapshot(), projection.beanId);
    const locallyProtected = local.filter((batch) =>
      this.batchHasOwnedFields(batch.id) || this.hasPendingRemainingWeight(batch.id)
    );
    const withOwnedBatches = [...projection.batches];
    for (const batch of locallyProtected) {
      if (!withOwnedBatches.some((candidate) => candidate.id === batch.id)) {
        withOwnedBatches.push(batch);
      }
    }
    const protectedProjection = {
      ...projection,
      batches: this.overlayPendingRemainingWeights(projection.beanId, withOwnedBatches)
    };
    const hasUnconfirmedFieldOwner = locallyProtected.some((batch) =>
      this.batchHasOwnedFields(batch.id)
    );
    if (hasUnconfirmedFieldOwner) {
      return this.cacheRevision(projection.beanId) === token.projectionRevision
        ? { revision: token.projectionRevision, projection: protectedProjection }
        : null;
    }
    const revision = await this.cacheProjectionIfCurrent(
      protectedProjection,
      token.projectionRevision
    );
    return revision == null ? null : { revision, projection: protectedProjection };
  }

  /**
   * A fresh GET that won the bean lane before a queued edit is the rollback
   * baseline for that edit, even though UI publication keeps its optimism.
   */
  private refreshOwnedConfirmedFields(
    batches: readonly BeanBatch[],
    token: InventoryCacheReadToken
  ): void {
    for (const batch of batches) {
      const prefix = `${batch.id}:`;
      for (const ownerKey of this.fieldOwners.keys()) {
        if (!ownerKey.startsWith(prefix)) continue;
        const confirmed = this.confirmedFields.get(ownerKey);
        const ownerRevision = this.fieldOwners.get(ownerKey);
        if (
          !confirmed ||
          ownerRevision == null ||
          ownerRevision <= token.mutationRevision ||
          token.ownedFieldKeys.has(ownerKey) ||
          confirmed.revision > token.mutationRevision
        ) continue;
        const field = ownerKey.slice(prefix.length) as keyof BeanBatch;
        this.confirmedFields.set(ownerKey, {
          ...confirmed,
          hadValue: Object.prototype.hasOwnProperty.call(batch, field),
          value: batch[field]
        });
      }
    }
  }

  /**
   * Reserve physical ordering synchronously, before durable journal admission
   * yields. Later foreground remaining-weight commands wait outside the
   * gateway lane until this earlier adjustment settles.
   */
  reservePendingRemainingWeight(reservation: PendingRemainingWeightReservation): boolean {
    if (this.pendingRemainingAdjustments.has(reservation.idempotencyKey)) return false;
    let resolve!: () => void;
    const settled = new Promise<void>((done) => { resolve = done; });
    this.pendingRemainingAdjustments.set(reservation.idempotencyKey, {
      ...reservation,
      sequence: ++this.pendingRemainingSequence,
      expectedRemaining: null,
      settled,
      resolve
    });
    return true;
  }

  /**
   * Retain an optimistic physical scalar while its durable command is pending.
   * Fresh reads may update every other batch field, but cannot resurrect the
   * pre-adjustment remaining weight owned by this process.
   */
  retainPendingRemainingWeight(adjustment: PendingRemainingWeightAdjustment): boolean {
    const current = this.pendingRemainingAdjustments.get(adjustment.idempotencyKey);
    // Retention may refine only a synchronously admitted reservation. Never
    // resurrect one after settlement won the race and released it.
    if (!current) return false;
    this.pendingRemainingAdjustments.set(adjustment.idempotencyKey, {
      ...current,
      ...adjustment,
      expectedRemaining: adjustment.expectedRemaining
    });
    return true;
  }

  releasePendingRemainingWeight(idempotencyKey: string): void {
    const reservation = this.pendingRemainingAdjustments.get(idempotencyKey);
    if (!reservation) return;
    this.pendingRemainingAdjustments.delete(idempotencyKey);
    reservation.resolve();
  }

  releaseAllPendingRemainingWeights(): void {
    const reservations = [...this.pendingRemainingAdjustments.values()];
    this.pendingRemainingAdjustments.clear();
    for (const reservation of reservations) reservation.resolve();
  }

  hasPendingRemainingWeightAfter(
    idempotencyKey: string,
    beanId: string,
    batchId: string
  ): boolean {
    const settled = this.pendingRemainingAdjustments.get(idempotencyKey);
    if (!settled) return false;
    return [...this.pendingRemainingAdjustments.values()].some((candidate) =>
      candidate.idempotencyKey !== idempotencyKey &&
      candidate.beanId === beanId &&
      candidate.batchId === batchId &&
      candidate.sequence > settled.sequence &&
      this.remainingWeightRevision(batchId) === candidate.fieldRevision
    );
  }

  overlayPendingRemainingWeights(
    beanId: string,
    batches: readonly BeanBatch[]
  ): BeanBatch[] {
    const localBatches = this.state.snapshot().batchesByBean[beanId] ?? [];
    const latestByBatch = new Map<
      string,
      PendingRemainingWeightReservation & {
        readonly sequence: number;
        readonly expectedRemaining: number;
      }
    >();
    for (const adjustment of this.pendingRemainingAdjustments.values()) {
      if (
        adjustment.beanId !== beanId ||
        adjustment.expectedRemaining == null ||
        this.remainingWeightRevision(adjustment.batchId) !== adjustment.fieldRevision
      ) continue;
      const candidate = {
        ...adjustment,
        expectedRemaining: adjustment.expectedRemaining
      };
      const previous = latestByBatch.get(adjustment.batchId);
      if (!previous || candidate.sequence > previous.sequence) {
        latestByBatch.set(adjustment.batchId, candidate);
      }
    }
    const hasOwnedFields = batches.some((batch) => this.batchHasOwnedFields(batch.id));
    if (latestByBatch.size === 0 && !hasOwnedFields) return [...batches];
    return batches.map((batch) => {
      const local = localBatches.find((candidate) => candidate.id === batch.id);
      let protectedBatch = batch;
      if (local) {
        for (const key of Object.keys(local) as Array<keyof BeanBatch>) {
          if (key === 'id' || key === 'beanId') continue;
          if (!this.fieldOwners.has(fieldOwnerKey(batch.id, key))) continue;
          protectedBatch = { ...protectedBatch, [key]: local[key] } as BeanBatch;
        }
      }
      if (this.fieldOwners.has(fieldOwnerKey(batch.id, 'weightRemaining'))) {
        return protectedBatch;
      }
      const adjustment = latestByBatch.get(batch.id);
      return adjustment
        ? { ...protectedBatch, weightRemaining: adjustment.expectedRemaining }
        : protectedBatch;
    });
  }

  /** A read admitted before any newer inventory projection cannot publish last. */
  cacheProjectionIfCurrent(
    projection: BeanInventoryProjection,
    admittedRevision: number
  ): Promise<number | null> {
    if (this.cacheRevision(projection.beanId) !== admittedRevision) {
      return Promise.resolve(null);
    }
    const publishedRevision = admittedRevision + 1;
    return this.cache(projection).then(() => publishedRevision);
  }

  /** Wait until every serialized per-bean cache publication has settled. */
  async drainCache(): Promise<void> {
    while (this.cacheTails.size > 0) {
      await Promise.allSettled([...this.cacheTails.values()]);
    }
  }

  reconcileRemainingWeight(
    request: RemainingWeightReconciliation
  ): BeanInventoryProjection | null {
    const key = fieldOwnerKey(request.batchId, 'weightRemaining');
    const currentRevision = this.fieldIntentRevisions.get(key) ?? 0;
    // A missing token means the durable command came from an earlier app
    // generation. It may publish only while this generation has no newer field
    // intent at all. Current-generation tokens must match exactly, fencing ABA.
    if (
      this.fieldOwners.has(key) ||
      (request.fieldRevision == null
        ? currentRevision !== 0
        : currentRevision !== request.fieldRevision)
    ) return null;

    const current = copyBatches(this.state.snapshot(), request.beanId);
    const batch = current.find((item) => item.id === request.batchId);
    if (batch?.weightRemaining !== request.expectedCurrent) return null;
    const batches = replaceBatch(current, {
      ...batch,
      weightRemaining: request.resolvedRemaining
    });
    const projection = makeProjection(request.beanId, batches, undefined, false);
    void this.cache(projection);
    return projection;
  }

  reclaimDemoDose(request: DemoDoseReclaimRequest): DemoDoseReclaimOutcome {
    const dose = positiveNumber(request.dose);
    if (dose == null) {
      return {
        type: 'not-applicable',
        reason: 'invalid-dose',
        status: 'Dose reclaim not applicable'
      };
    }

    const local = copyBatches(this.state.snapshot(), request.beanId)
      .find((batch) => batch.id === request.batchId);
    if (!local) {
      return {
        type: 'not-applicable',
        reason: 'missing-batch',
        status: 'Dose reclaim not applicable'
      };
    }
    const localRemaining = nonNegativeNumber(local.weightRemaining);
    if (localRemaining == null) {
      return {
        type: 'not-applicable',
        reason: 'untracked-remaining',
        status: 'Dose reclaim not applicable'
      };
    }

    const intent = this.claimRemainingWeightIntent(local);
    try {
      const resolvedRemaining = doseReclaimRemaining(localRemaining, dose, local.weight);
      const batch = { ...local, weightRemaining: resolvedRemaining };
      this.recordConfirmedRemainingWeight(intent, batch);
      return {
        type: 'reclaimed',
        batch,
        projection: makeProjection(
          request.beanId,
          replaceBatch(copyBatches(this.state.snapshot(), request.beanId), batch),
          undefined,
          false
        ),
        previousRemaining: localRemaining,
        resolvedRemaining,
        reclaimedDose: resolvedRemaining - localRemaining,
        status: 'Dose reclaimed (demo)'
      };
    } finally {
      this.releaseRemainingWeightIntent(intent);
    }
  }

  startBatchUpdate(request: BatchUpdateRequest): BatchUpdateStart {
    const snapshot = this.state.snapshot();
    const current = copyBatches(snapshot, request.beanId);
    const previous = current.find((batch) => batch.id === request.batchId);
    if (!previous) return { type: 'missing' };

    const patch = normalizedPatch(request.beanId, request.patch);
    const optimistic = { ...previous, ...patch, id: previous.id, beanId: request.beanId };
    const batches = replaceBatch(current, optimistic);
    const purpose = request.purpose ?? 'edit';
    const selection = optimisticSelection(snapshot, request, current, batches);
    const projection = makeProjection(
      request.beanId,
      batches,
      selection.next,
      shouldScheduleOptimisticApply(snapshot, request, current, batches, selection.changed)
    );
    const fields = captureFields(previous, optimistic, patch);
    const revision = ++this.mutationRevision;
    const token: BatchUpdateToken = {
      request: { ...request, patch },
      fields,
      revision,
      optimisticSelection: selection.next,
      previousSelection: snapshot.selectedBatchId,
      selectionRevisionBeforeProjection: snapshot.selectionRevision
    };

    for (const field of fields) {
      this.fieldIntentRevisions.set(fieldOwnerKey(request.batchId, field.key), revision);
    }

    if (request.demo) {
      this.rememberProjection(projection);
      return {
        type: 'optimistic',
        projection,
        status: updateStatus(purpose, true, true),
        complete: true,
        completion: null
      };
    }

    for (const field of fields) {
      const key = fieldOwnerKey(request.batchId, field.key);
      if (!this.fieldOwners.has(key)) {
        this.confirmedFields.set(key, {
          revision: revision - 1,
          hadValue: field.hadValue,
          value: field.previous
        });
      }
      this.fieldOwners.set(key, revision);
    }
    if (selection.next !== undefined) {
      if (!this.selectionOwners.has(request.beanId)) {
        this.confirmedSelections.set(request.beanId, {
          revision: revision - 1,
          value: snapshot.selectedBatchId
        });
      }
      this.selectionOwners.set(request.beanId, revision);
    }

    // Publish the optimistic generation synchronously for read/selection
    // fencing, but do not persist an unconfirmed remote edit as offline truth.
    this.rememberProjection(projection);
    return {
      type: 'optimistic',
      projection,
      status: updateStatus(purpose, true, false),
      complete: false,
      completion: this.completeBatchUpdate(token)
    };
  }

  createBatch(request: CreateBatchRequest): Promise<CreateBatchOutcome> {
    const input = normalizedPatch(request.beanId, request.batch);
    const intentKey = createIntentKey(request.beanId, input, request.demo);
    const active = this.createCompletions.get(intentKey);
    if (active) return active;

    const snapshot = this.state.snapshot();
    const selection: CreateSelectionSnapshot = {
      selectedBeanId: snapshot.selectedBeanId,
      selectedBatchId: snapshot.selectedBatchId,
      revision: snapshot.selectionRevision
    };
    let retainedIdempotencyKey: string | null = null;
    let rawCompletion: Promise<CreateBatchOutcome>;
    if (request.demo) {
      const batch = {
        id: `demo-batch-${request.nowMs}`,
        ...input,
        beanId: request.beanId
      } as BeanBatch;
      rawCompletion = Promise.resolve({
        type: 'created',
        batch,
        projection: this.projectCreatedBatch(request.beanId, batch, selection),
        recovered: false,
        status: 'Batch added (demo)'
      });
    } else {
      const unresolvedKey = this.unresolvedCreateKeys.get(intentKey);
      retainedIdempotencyKey = unresolvedKey ?? batchCreateIdempotencyKey(
        request.beanId,
        request.nowMs,
        ++this.createOperationSequence,
        input
      );
      this.unresolvedCreateKeys.set(intentKey, retainedIdempotencyKey);
      rawCompletion = this.completeCreateBatch(
        request.beanId,
        input,
        selection,
        retainedIdempotencyKey,
        unresolvedKey !== undefined
      );
    }

    let completion: Promise<CreateBatchOutcome>;
    completion = rawCompletion.then((outcome) => {
      if (
        retainedIdempotencyKey !== null &&
        !createRemainsUnresolved(outcome) &&
        this.unresolvedCreateKeys.get(intentKey) === retainedIdempotencyKey
      ) {
        this.unresolvedCreateKeys.delete(intentKey);
      }
      return outcome;
    }).finally(() => {
      if (this.createCompletions.get(intentKey) === completion) {
        this.createCompletions.delete(intentKey);
      }
    });
    this.createCompletions.set(intentKey, completion);
    return completion;
  }

  private async completeCreateBatch(
    beanId: string,
    input: Partial<BeanBatch>,
    selection: CreateSelectionSnapshot,
    idempotencyKey: string,
    recoveredOnSuccess: boolean
  ): Promise<CreateBatchOutcome> {
    const coordinated = await this.commands.exact(beanInventoryMutationKey(beanId), async () => {
      const attempt = await this.createWithReconciliation(
        beanId,
        input,
        idempotencyKey,
        recoveredOnSuccess
      );
      if (attempt.type === 'uncertain') return attempt;
      const { batch: created, recovered } = attempt;
      if (!needsStorageFollowUp(input)) {
        return { type: 'created', batch: created, recovered } satisfies CreateExecution;
      }
      try {
        const saved = await this.repository.updateBatch(created.id, storagePatch(beanId, input));
        return { type: 'created', batch: saved, recovered } satisfies CreateExecution;
      } catch (error) {
        const reconciled = await this.tryReadAuthoritative(beanId);
        return {
          type: 'incomplete',
          phase: 'persist-storage',
          knownBatch: created,
          authoritative: reconciled.batches,
          error,
          ...(reconciled.error === undefined ? {} : { reconciliationError: reconciled.error })
        } satisfies CreateExecution;
      }
    });

    if (coordinated.status !== 'completed') return createCommandFailure(coordinated);
    if (coordinated.value.type === 'uncertain') {
      const execution = coordinated.value;
      const candidates = newCreationCandidates(execution.authoritative, execution.knownBatchIds);
      const projection = this.projectUncertainCreation(beanId, candidates);
      void this.cache(projection);
      return {
        type: 'reconciliation-required',
        phase: 'create',
        candidates,
        projection,
        status: 'Stock may have been added - review stock',
        error: execution.error,
        ...(execution.reconciliationError === undefined
          ? {}
          : { reconciliationError: execution.reconciliationError })
      };
    }
    if (coordinated.value.type === 'created') {
      const projection = this.projectCreatedBatch(beanId, coordinated.value.batch, selection);
      void this.cache(projection);
      return {
        type: 'created',
        batch: coordinated.value.batch,
        projection,
        recovered: coordinated.value.recovered,
        status: coordinated.value.recovered ? 'Batch added (response recovered)' : 'Batch added'
      };
    }

    const execution = coordinated.value;
    const batch = execution.authoritative?.find((item) => item.id === execution.knownBatch.id) ?? execution.knownBatch;
    const projection = this.projectCreatedBatch(beanId, batch, selection);
    void this.cache(projection);
    return {
      type: 'reconciliation-required',
      phase: execution.phase,
      batch,
      projection,
      status: 'Stock added, but freezer state needs review',
      error: execution.error,
      ...(execution.reconciliationError === undefined
        ? {}
        : { reconciliationError: execution.reconciliationError })
    };
  }

  startFreezeStock(request: FreezeStockRequest): FreezeStockStart {
    const snapshot = this.state.snapshot();
    const batches = copyBatches(snapshot, request.beanId);
    const source = batches.find((batch) => batch.id === request.batchId);
    if (!source) return { type: 'missing' };
    const remaining = positiveNumber(source.weightRemaining);
    const requested = request.amountGrams == null ? remaining : finiteNumber(request.amountGrams);
    const amount = remaining == null || requested == null
      ? remaining
      : Math.min(Math.max(requested, 0), remaining);
    const keep = remaining == null || amount == null ? 0 : roundGrams(remaining - amount);

    if (remaining != null && (amount == null || amount <= 0)) {
      return { type: 'nothing-to-freeze', status: 'Nothing left to freeze' };
    }
    if (remaining == null || keep <= 0) return this.startWholeFreeze(request, source, remaining);

    const grams = roundGrams(remaining - keep);
    if (grams <= 0) return { type: 'nothing-to-freeze', status: 'Nothing left to freeze' };
    const splitKey = `${request.beanId}:${request.batchId}`;
    const active = this.splitCompletions.get(splitKey);
    if (active) {
      return {
        type: 'queued',
        mode: 'split',
        grams: active.grams,
        status: 'Freezing stock',
        completion: active.completion
      };
    }
    const splitIntent = splitCreateIntentKey(request.beanId, source.id, grams);
    const unresolved = request.demo ? undefined : this.unresolvedSplitKeys.get(splitIntent);
    const splitCreate = unresolved ?? {
      idempotencyKey: splitCreateIdempotencyKey(
        request.beanId,
        source.id,
        grams,
        keep,
        request.nowMs
      ),
      operationStartedAtMs: request.nowMs
    };
    if (!request.demo) this.unresolvedSplitKeys.set(splitIntent, splitCreate);
    const plan = splitPlan(
      request.beanId,
      source,
      grams,
      keep,
      splitCreate.operationStartedAtMs,
      splitCreate.idempotencyKey,
      unresolved !== undefined
    );
    const sourceIntent = this.claimSplitSourceIntent(source);
    const rawCompletion = request.demo
      ? Promise.resolve().then(() => this.completeDemoSplit(request, plan, sourceIntent))
      : this.completeRemoteSplit(request, plan, sourceIntent);
    let completion: Promise<FreezeStockOutcome>;
    completion = rawCompletion.then((outcome) => {
      if (
        !request.demo &&
        !splitCreateRemainsUnresolved(outcome) &&
        this.unresolvedSplitKeys.get(splitIntent) === splitCreate
      ) {
        this.unresolvedSplitKeys.delete(splitIntent);
      }
      return outcome;
    }).finally(() => {
      if (this.splitCompletions.get(splitKey)?.completion === completion) {
        this.splitCompletions.delete(splitKey);
      }
      this.releaseSplitSourceIntent(sourceIntent);
    });
    this.splitCompletions.set(splitKey, { grams, completion });
    return {
      type: 'queued',
      mode: 'split',
      grams,
      status: 'Freezing stock',
      completion
    };
  }

  private async completeBatchUpdate(token: BatchUpdateToken): Promise<BatchUpdateOutcome> {
    const { request } = token;
    if (
      token.fields.some((field) => field.key === 'weightRemaining') &&
      this.hasPendingRemainingWeight(request.batchId)
    ) {
      await this.waitForPendingRemainingWeight(request.batchId);
    }
    const coordinated = await this.commands.exact(
      beanInventoryMutationKey(request.beanId),
      () => this.repository.updateBatch(request.batchId, request.patch)
    );
    const latest = this.state.snapshot();
    const current = copyBatches(latest, request.beanId);
    const ownedFields = token.fields.filter(
      (field) => this.fieldOwners.get(fieldOwnerKey(request.batchId, field.key)) === token.revision
    );
    if (coordinated.status === 'completed') {
      this.recordConfirmedUpdate(token, coordinated.value);
      const batches = reconcileSavedBatch(current, coordinated.value, ownedFields);
      const projection = makeProjection(request.beanId, batches, undefined, false);
      this.releaseUpdateOwnership(token);
      void this.cache(projection);
      return {
        type: 'saved',
        projection,
        saved: coordinated.value,
        status: updateStatus(request.purpose ?? 'edit', true, false)
      };
    }

    const rolledBack = rollbackBatch(
      current,
      request.batchId,
      ownedFields,
      this.confirmedFields
    );
    const selectedBatchId = latest.selectedBeanId === request.beanId &&
      latest.selectionRevision === token.selectionRevisionBeforeProjection + 1 &&
      this.selectionOwners.get(request.beanId) === token.revision
      ? rollbackSelection(
          latest.selectedBatchId,
          token,
          this.confirmedSelections.has(request.beanId)
            ? this.confirmedSelections.get(request.beanId)!.value
            : token.previousSelection
        )
      : undefined;
    const changed = !sameBatchList(current, rolledBack) || selectedBatchId !== undefined;
    const projection = makeProjection(
      request.beanId,
      rolledBack,
      selectedBatchId,
      latest.selectedBeanId === request.beanId && changed
    );
    this.releaseUpdateOwnership(token);
    void this.cache(projection);
    return {
      type: 'failed',
      projection,
      reason: commandFailureReason(coordinated.status),
      status: updateStatus(request.purpose ?? 'edit', false, false),
      ...(coordinated.status === 'failed' ? { error: coordinated.error } : {})
    };
  }

  private startWholeFreeze(
    request: FreezeStockRequest,
    source: BeanBatch,
    grams: number | null
  ): FreezeStockStart {
    const update = this.startBatchUpdate({
      beanId: request.beanId,
      batchId: request.batchId,
      patch: {
        beanId: request.beanId,
        ...appendBatchStorageEvent(source, 'frozen', new Date(request.nowMs))
      },
      purpose: 'stock',
      demo: request.demo
    });
    if (update.type === 'missing') return update;
    const sourceBatch = update.projection.batches.find((batch) => batch.id === request.batchId)!;
    return {
      type: 'optimistic',
      mode: 'whole',
      grams,
      projection: update.projection,
      status: 'Bag frozen',
      complete: update.complete,
      completion: update.completion?.then((outcome): FreezeStockOutcome => {
        if (outcome.type === 'saved') {
          const saved = outcome.projection.batches.find((batch) => batch.id === request.batchId) ?? outcome.saved;
          return {
            type: 'frozen',
            mode: 'whole',
            grams,
            sourceBatch: saved,
            frozenBatch: null,
            projection: outcome.projection,
            recovered: false,
            status: 'Bag frozen'
          };
        }
        return {
          type: 'failed',
          mode: 'whole',
          phase: 'update-whole',
          reason: outcome.reason,
          projection: outcome.projection,
          status: 'Freeze stock failed',
          ...(outcome.error === undefined ? {} : { error: outcome.error })
        };
      }) ?? (request.demo
        ? null
        : Promise.resolve({
            type: 'frozen',
            mode: 'whole',
            grams,
            sourceBatch,
            frozenBatch: null,
            projection: update.projection,
            recovered: false,
            status: 'Bag frozen'
          }))
    };
  }

  private completeDemoSplit(
    request: FreezeStockRequest,
    plan: SplitPlan,
    sourceIntent: SplitSourceIntent
  ): FreezeStockOutcome {
    const created = {
      id: `demo-batch-${request.nowMs}`,
      ...plan.frozenBatch,
      beanId: request.beanId
    } as BeanBatch;
    const source = { ...plan.source, ...plan.sourcePatch };
    this.recordConfirmedSplitSource(sourceIntent, source);
    const projection = this.projectSplit(request.beanId, plan, created, source, sourceIntent);
    return {
      type: 'frozen',
      mode: 'split',
      grams: plan.grams,
      sourceBatch: batchFromProjection(projection, source.id, source),
      frozenBatch: created,
      projection,
      recovered: false,
      status: `Froze ${formatGrams(plan.grams)} (demo)`
    };
  }

  private async completeRemoteSplit(
    request: FreezeStockRequest,
    plan: SplitPlan,
    sourceIntent: SplitSourceIntent
  ): Promise<FreezeStockOutcome> {
    if (this.hasPendingRemainingWeight(request.batchId)) {
      await this.waitForPendingRemainingWeight(request.batchId);
    }
    const coordinated = await this.commands.exact(
      beanInventoryMutationKey(request.beanId),
      () => this.executeSplit(request.beanId, plan)
    );
    if (coordinated.status !== 'completed') {
      return {
        type: 'failed',
        mode: 'split',
        phase: 'create-portion',
        reason: commandFailureReason(coordinated.status),
        status: 'Freeze stock failed',
        ...(coordinated.status === 'failed' ? { error: coordinated.error } : {})
      };
    }
    const execution = coordinated.value;
    if (execution.type === 'source-precondition-failed') {
      return {
        type: 'failed',
        mode: 'split',
        phase: 'create-portion',
        reason: execution.reason,
        status: 'Freeze stock failed',
        error: execution.error
      };
    }
    if (execution.type === 'committed') {
      const settledPlan = execution.plan;
      this.recordConfirmedSplitSource(sourceIntent, execution.source);
      const projection = this.projectSplit(
        request.beanId,
        settledPlan,
        execution.created,
        execution.source,
        sourceIntent
      );
      void this.cache(projection);
      return {
        type: 'frozen',
        mode: 'split',
        grams: settledPlan.grams,
        sourceBatch: batchFromProjection(projection, settledPlan.source.id, execution.source),
        frozenBatch: batchFromProjection(projection, execution.created.id, execution.created),
        projection,
        recovered: execution.recovered,
        status: `Froze ${formatGrams(settledPlan.grams)}`
      };
    }
    if (execution.type === 'create-uncertain') {
      const failure = execution;
      const candidates = newCreationCandidates(failure.authoritative, failure.knownBatchIds);
      const projection = this.projectUncertainCreation(request.beanId, candidates);
      void this.cache(projection);
      return {
        type: 'reconciliation-required',
        mode: 'split',
        phase: 'create-portion',
        grams: failure.plan.grams,
        candidates,
        projection,
        status: 'Freeze result unknown - review stock',
        error: failure.error,
        ...(failure.reconciliationError === undefined
          ? {}
          : { reconciliationError: failure.reconciliationError })
      };
    }
    return this.resolveSplitFailure(request.beanId, execution, sourceIntent);
  }

  private async executeSplit(beanId: string, plan: SplitPlan): Promise<SplitExecution> {
    const preflight = await this.tryReadAuthoritative(beanId);
    if (!preflight.batches) {
      const error = preflight.error ?? new Error('Could not validate source stock before split freeze');
      // A prior POST with this key may already have succeeded. Until the
      // gateway replays its receipt, a retry-side read failure cannot turn
      // that physical uncertainty into a definitive no-create failure.
      if (plan.recoveredOnSuccess) {
        return {
          type: 'create-uncertain',
          plan,
          knownBatchIds: null,
          authoritative: null,
          error
        };
      }
      return {
        type: 'source-precondition-failed',
        plan,
        reason: 'gateway',
        error
      };
    }
    const authoritativeSource = preflight.batches.find((batch) => batch.id === plan.source.id);
    const authoritativeRemaining = positiveNumber(authoritativeSource?.weightRemaining);
    if (!authoritativeSource || authoritativeRemaining == null || authoritativeRemaining <= plan.grams) {
      const error = new Error('Source stock changed before split freeze');
      if (plan.recoveredOnSuccess) {
        return {
          type: 'create-uncertain',
          plan,
          knownBatchIds: null,
          authoritative: preflight.batches,
          error
        };
      }
      return {
        type: 'source-precondition-failed',
        plan,
        reason: 'superseded',
        error
      };
    }
    const keepGrams = roundGrams(authoritativeRemaining - plan.grams);
    const rebasedPlan = splitPlan(
      beanId,
      authoritativeSource,
      plan.grams,
      keepGrams,
      plan.operationStartedAtMs,
      plan.idempotencyKey,
      plan.recoveredOnSuccess,
      plan.admittedSourceWeightRemaining
    );
    const attempt = await this.createWithReconciliation(
      beanId,
      rebasedPlan.frozenBatch,
      rebasedPlan.idempotencyKey,
      rebasedPlan.recoveredOnSuccess,
      preflight
    );
    if (attempt.type === 'uncertain') {
      return {
        type: 'create-uncertain',
        plan: rebasedPlan,
        knownBatchIds: attempt.knownBatchIds,
        authoritative: attempt.authoritative,
        error: attempt.error,
        ...(attempt.reconciliationError === undefined
          ? {}
          : { reconciliationError: attempt.reconciliationError })
      };
    }
    const createdRaw = attempt.batch;

    let created: BeanBatch;
    try {
      created = await this.repository.updateBatch(
        createdRaw.id,
        storagePatch(beanId, rebasedPlan.frozenBatch)
      );
    } catch (error) {
      return this.postCreateFailure(
        beanId,
        rebasedPlan,
        'persist-freezer-state',
        createdRaw,
        error
      );
    }

    try {
      const source = await this.repository.updateBatch(rebasedPlan.source.id, rebasedPlan.sourcePatch);
      return { type: 'committed', plan: rebasedPlan, created, source, recovered: attempt.recovered };
    } catch (error) {
      return this.postCreateFailure(beanId, rebasedPlan, 'update-source', created, error);
    }
  }

  private async postCreateFailure(
    beanId: string,
    plan: SplitPlan,
    phase: 'persist-freezer-state' | 'update-source',
    knownCreated: BeanBatch,
    error: unknown
  ): Promise<SplitExecution> {
    const reconciled = await this.tryReadAuthoritative(beanId);
    return {
      type: 'post-create-failure',
      plan,
      phase,
      knownCreated,
      authoritative: reconciled.batches,
      error,
      ...(reconciled.error === undefined ? {} : { reconciliationError: reconciled.error })
    };
  }

  private async resolveSplitFailure(
    beanId: string,
    failure: Extract<SplitExecution, { type: 'post-create-failure' }>,
    sourceIntent: SplitSourceIntent
  ): Promise<FreezeStockOutcome> {
    const plan = failure.plan;
    const actualCreated = failure.authoritative?.find((batch) => batch.id === failure.knownCreated.id)
      ?? failure.knownCreated;
    const actualSource = failure.authoritative?.find((batch) => batch.id === plan.source.id) ?? null;
    const sourceCommitted = actualSource?.weightRemaining === plan.keepGrams;
    if (sourceCommitted && actualSource) {
      this.recordConfirmedSplitSource(sourceIntent, actualSource);
    }
    const remotelyCommitted = sourceCommitted && isFrozenPortion(actualCreated);
    const projection = this.projectSplit(beanId, plan, actualCreated, actualSource, sourceIntent);
    void this.cache(projection);

    if (remotelyCommitted && actualSource) {
      return {
        type: 'frozen',
        mode: 'split',
        grams: plan.grams,
        sourceBatch: batchFromProjection(projection, plan.source.id, actualSource),
        frozenBatch: batchFromProjection(projection, actualCreated.id, actualCreated),
        projection,
        recovered: true,
        status: `Froze ${formatGrams(plan.grams)}`
      };
    }

    return {
      type: 'reconciliation-required',
      mode: 'split',
      phase: failure.phase,
      grams: plan.grams,
      createdBatch: actualCreated,
      projection,
      status: 'Freeze incomplete - review stock',
      error: failure.error,
      ...(failure.reconciliationError === undefined
        ? {}
        : { reconciliationError: failure.reconciliationError })
    };
  }

  private projectCreatedBatch(
    beanId: string,
    created: BeanBatch,
    selection: CreateSelectionSnapshot
  ): BeanInventoryProjection {
    const snapshot = this.state.snapshot();
    const batches = prependUnique(created, copyBatches(snapshot, beanId));
    const selectsCreated = selection.selectedBeanId === beanId &&
      snapshot.selectedBeanId === selection.selectedBeanId &&
      snapshot.selectedBatchId === selection.selectedBatchId &&
      snapshot.selectionRevision === selection.revision;
    return makeProjection(
      beanId,
      batches,
      selectsCreated ? created.id : undefined,
      selectsCreated && snapshot.selectedBatchId !== created.id
    );
  }

  private projectUncertainCreation(
    beanId: string,
    candidates: readonly BeanBatch[]
  ): BeanInventoryProjection {
    const latest = copyBatches(this.state.snapshot(), beanId);
    const batches = candidates.reduceRight<BeanBatch[]>(
      (current, candidate) => prependUnique(candidate, current),
      latest
    );
    return makeProjection(beanId, batches, undefined, false);
  }

  private projectSplit(
    beanId: string,
    plan: SplitPlan,
    created: BeanBatch,
    authoritativeSource: BeanBatch | null,
    sourceIntent: SplitSourceIntent
  ): BeanInventoryProjection {
    const latest = copyBatches(this.state.snapshot(), beanId);
    const currentSource = latest.find((batch) => batch.id === plan.source.id);
    const ownsSourceIntent = this.fieldOwners.get(sourceIntent.key) === sourceIntent.revision &&
      this.fieldIntentRevisions.get(sourceIntent.key) === sourceIntent.revision;
    const source = ownsSourceIntent && currentSource &&
      currentSource.weightRemaining === plan.admittedSourceWeightRemaining
      ? mergePatchedFields(currentSource, authoritativeSource ?? plan.source, plan.sourcePatch)
      : currentSource;
    const withSource = source ? replaceBatch(latest, source) : latest;
    return makeProjection(beanId, prependUnique(created, withSource), undefined, false);
  }

  private async tryReadAuthoritative(
    beanId: string
  ): Promise<AuthoritativeRead> {
    try {
      return { batches: await this.repository.batches(beanId) };
    } catch (error) {
      return { batches: null, error };
    }
  }

  private cache(projection: BeanInventoryProjection): Promise<void> {
    this.rememberProjection(projection);
    const persistentBatches = this.confirmedCacheBatches(projection.batches);
    // A missing confirmed baseline is an invariant breach. Keep the useful
    // process-local projection, but never persist a possibly optimistic field.
    if (!persistentBatches) return Promise.resolve();
    const previousTail = this.cacheTails.get(projection.beanId) ?? Promise.resolve();
    const write = previousTail.then(
      () => this.repository.putBeanBatches(projection.beanId, persistentBatches),
      () => this.repository.putBeanBatches(projection.beanId, persistentBatches)
    ).catch(() => {});
    let tracked: Promise<void>;
    tracked = write.finally(() => {
      if (this.cacheTails.get(projection.beanId) === tracked) {
        this.cacheTails.delete(projection.beanId);
      }
    });
    this.cacheTails.set(projection.beanId, tracked);
    return tracked;
  }

  /** Replace every in-flight UI field with its last remotely confirmed value. */
  private confirmedCacheBatches(batches: readonly BeanBatch[]): BeanBatch[] | null {
    const owned = [...this.fieldOwners.keys()];
    const persistent: BeanBatch[] = [];
    for (const batch of batches) {
      const prefix = `${batch.id}:`;
      const keys = owned.filter((key) => key.startsWith(prefix));
      if (keys.length === 0) {
        persistent.push({ ...batch });
        continue;
      }
      const safe = { ...batch } as Record<string, unknown>;
      for (const ownerKey of keys) {
        const confirmed = this.confirmedFields.get(ownerKey);
        if (!confirmed) return null;
        const field = ownerKey.slice(prefix.length);
        if (confirmed.hadValue) safe[field] = confirmed.value;
        else delete safe[field];
      }
      persistent.push(safe as unknown as BeanBatch);
    }
    return persistent;
  }

  private rememberProjection(projection: BeanInventoryProjection): void {
    const previous = this.latestCacheProjections.get(projection.beanId);
    const revision = this.cacheRevision(projection.beanId) + 1;
    const explicitlySelects = Object.prototype.hasOwnProperty.call(projection, 'selectedBatchId');
    const previousExplicitlySelected = previous &&
      Object.prototype.hasOwnProperty.call(previous.projection, 'selectedBatchId');
    const previousSelection = previousExplicitlySelected
      ? previous!.projection.selectedBatchId ?? null
      : undefined;
    const rememberedSelection = explicitlySelects
      ? projection.selectedBatchId ?? null
      : previousSelection !== undefined
        ? previousSelection
        : undefined;
    const selectionChanged = explicitlySelects &&
      (previousSelection === undefined || previousSelection !== rememberedSelection);
    const latestProjection: BeanInventoryProjection = {
      ...projection,
      ...(rememberedSelection === undefined ? {} : { selectedBatchId: rememberedSelection })
    };
    this.latestCacheProjections.set(projection.beanId, {
      revision,
      selectionRevision: selectionChanged ? revision : previous?.selectionRevision ?? null,
      projection: latestProjection
    });
    this.cacheRevisions.set(projection.beanId, revision);
  }

  private hasPendingRemainingWeight(batchId: string): boolean {
    return [...this.pendingRemainingAdjustments.values()].some(
      (reservation) => reservation.batchId === batchId
    );
  }

  private batchHasOwnedFields(batchId: string): boolean {
    const prefix = `${batchId}:`;
    return [...this.fieldOwners.keys()].some((key) => key.startsWith(prefix));
  }

  private async waitForPendingRemainingWeight(batchId: string): Promise<void> {
    while (true) {
      const pending = [...this.pendingRemainingAdjustments.values()]
        .filter((reservation) => reservation.batchId === batchId)
        .map((reservation) => reservation.settled);
      if (pending.length === 0) return;
      await Promise.all(pending);
    }
  }

  private async createWithReconciliation(
    beanId: string,
    input: Partial<BeanBatch>,
    idempotencyKey: string,
    recoveredOnSuccess: boolean,
    authoritativePreflight?: AuthoritativeRead
  ): Promise<Extract<CreateExecution, { type: 'created' | 'uncertain' }>> {
    const preflight = authoritativePreflight ?? await this.tryReadAuthoritative(beanId);
    const knownBatchIds = preflight.batches?.map((batch) => batch.id) ?? null;
    try {
      return {
        type: 'created',
        batch: await this.repository.createBatch(beanId, input, { idempotencyKey }),
        recovered: recoveredOnSuccess
      };
    } catch (error) {
      const reconciled = await this.tryReadAuthoritative(beanId);
      const reconciliationError = reconciled.error ?? preflight.error;
      return {
        type: 'uncertain',
        knownBatchIds,
        authoritative: reconciled.batches,
        error,
        ...(reconciliationError === undefined ? {} : { reconciliationError })
      };
    }
  }

  private recordConfirmedUpdate(token: BatchUpdateToken, saved: BeanBatch): void {
    for (const field of token.fields) {
      const key = fieldOwnerKey(token.request.batchId, field.key);
      if (token.revision <= (this.confirmedFields.get(key)?.revision ?? -1)) continue;
      this.confirmedFields.set(key, {
        revision: token.revision,
        // The request itself confirms ownership of the patched key even when
        // a partial response omits it.
        hadValue: true,
        value: Object.prototype.hasOwnProperty.call(saved, field.key)
          ? saved[field.key]
          : field.optimistic
      });
    }
    if (
      token.optimisticSelection !== undefined &&
      token.revision > (this.confirmedSelections.get(token.request.beanId)?.revision ?? -1)
    ) {
      this.confirmedSelections.set(token.request.beanId, {
        revision: token.revision,
        value: token.optimisticSelection
      });
    }
  }

  private releaseUpdateOwnership(token: BatchUpdateToken): void {
    for (const field of token.fields) {
      const key = fieldOwnerKey(token.request.batchId, field.key);
      if (this.fieldOwners.get(key) !== token.revision) continue;
      this.fieldOwners.delete(key);
      this.confirmedFields.delete(key);
    }
    if (this.selectionOwners.get(token.request.beanId) === token.revision) {
      this.selectionOwners.delete(token.request.beanId);
      this.confirmedSelections.delete(token.request.beanId);
    }
  }

  private claimSplitSourceIntent(source: BeanBatch): SplitSourceIntent {
    return this.claimRemainingWeightIntent(source);
  }

  private claimRemainingWeightIntent(source: BeanBatch): RemainingWeightIntent {
    const key = fieldOwnerKey(source.id, 'weightRemaining');
    const revision = ++this.mutationRevision;
    if (!this.fieldOwners.has(key)) {
      this.confirmedFields.set(key, {
        revision: revision - 1,
        hadValue: Object.prototype.hasOwnProperty.call(source, 'weightRemaining'),
        value: source.weightRemaining
      });
    }
    this.fieldIntentRevisions.set(key, revision);
    this.fieldOwners.set(key, revision);
    return { key, revision };
  }

  private recordConfirmedSplitSource(intent: SplitSourceIntent, source: BeanBatch): void {
    this.recordConfirmedRemainingWeight(intent, source);
  }

  private recordConfirmedRemainingWeight(intent: RemainingWeightIntent, source: BeanBatch): void {
    if (intent.revision <= (this.confirmedFields.get(intent.key)?.revision ?? -1)) return;
    this.confirmedFields.set(intent.key, {
      revision: intent.revision,
      hadValue: Object.prototype.hasOwnProperty.call(source, 'weightRemaining'),
      value: source.weightRemaining
    });
  }

  private releaseSplitSourceIntent(intent: SplitSourceIntent): void {
    this.releaseRemainingWeightIntent(intent);
  }

  private releaseRemainingWeightIntent(intent: RemainingWeightIntent): void {
    if (this.fieldOwners.get(intent.key) !== intent.revision) return;
    this.fieldOwners.delete(intent.key);
    this.confirmedFields.delete(intent.key);
  }
}
