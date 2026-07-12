import type { BeanBatch } from '../api/types';
import type { GatewayMutationPort } from '../runtime/gatewayMutationCoordinator';

export type BeanInventoryCommandPort = Pick<GatewayMutationPort<string>, 'exact'>;

/** The only application state visible to the inventory vertical. */
export interface BeanInventorySnapshot {
  readonly batchesByBean: Readonly<Record<string, readonly BeanBatch[]>>;
  readonly selectedBeanId: string | null;
  readonly selectedBatchId: string | null;
  /** Monotonically increments for every explicit bean/batch selection intent. */
  readonly selectionRevision: number;
}

export interface BeanInventoryStatePort {
  snapshot(): BeanInventorySnapshot;
}

/** Gateway/cache adapter. Cache writes are deliberately fail-soft. */
export interface BeanInventoryRepository {
  batches(beanId: string): Promise<BeanBatch[]>;
  createBatch(
    beanId: string,
    batch: Partial<BeanBatch>,
    options: { idempotencyKey: string }
  ): Promise<BeanBatch>;
  updateBatch(batchId: string, patch: Partial<BeanBatch>): Promise<BeanBatch>;
  putBeanBatches(beanId: string, batches: BeanBatch[]): Promise<void>;
}

export interface BeanInventoryProjection {
  readonly beanId: string;
  readonly batches: readonly BeanBatch[];
  /** Omitted when the projection must not change the current selection. */
  readonly selectedBatchId?: string | null;
  /** Re-apply recipe identity after this projection is adopted. */
  readonly shouldScheduleApply: boolean;
}

export interface RemainingWeightReconciliation {
  readonly beanId: string;
  readonly batchId: string;
  /** Local optimistic value that still has to own the projection. */
  readonly expectedCurrent: number;
  /** Fresh remote result to publish when ownership is unchanged. */
  readonly resolvedRemaining: number;
  /** Intent revision captured when the external projection was admitted. */
  readonly fieldRevision: number | null;
}

export type BatchUpdatePurpose = 'edit' | 'stock' | 'finish';

export interface BatchUpdateRequest {
  readonly beanId: string;
  readonly batchId: string;
  readonly patch: Partial<BeanBatch>;
  readonly purpose?: BatchUpdatePurpose;
  readonly demo: boolean;
}

export type BatchUpdateStart =
  | { type: 'missing' }
  | {
      type: 'optimistic';
      projection: BeanInventoryProjection;
      status: string;
      complete: boolean;
      completion: Promise<BatchUpdateOutcome> | null;
    };

export type BatchUpdateOutcome =
  | {
      type: 'saved';
      projection: BeanInventoryProjection;
      saved: BeanBatch;
      status: string;
    }
  | {
      type: 'failed';
      projection: BeanInventoryProjection;
      reason: 'gateway' | 'superseded' | 'canceled' | 'disposed';
      status: string;
      error?: unknown;
    };

export interface CreateBatchRequest {
  readonly beanId: string;
  readonly batch: Partial<BeanBatch>;
  readonly demo: boolean;
  readonly nowMs: number;
}

export type CreateBatchOutcome =
  | {
      type: 'created';
      batch: BeanBatch;
      projection: BeanInventoryProjection;
      /** True when a retry resolved a previously uncertain idempotent create. */
      recovered: boolean;
      status: string;
    }
  | {
      type: 'failed';
      reason: 'gateway' | 'superseded' | 'canceled' | 'disposed';
      status: 'Add batch failed';
      error?: unknown;
    }
  | {
      type: 'reconciliation-required';
      phase: 'persist-storage';
      batch: BeanBatch;
      projection: BeanInventoryProjection;
      status: 'Stock added, but freezer state needs review';
      error: unknown;
      reconciliationError?: unknown;
    }
  | {
      type: 'reconciliation-required';
      phase: 'create';
      candidates: readonly BeanBatch[];
      projection: BeanInventoryProjection;
      status: 'Stock may have been added - review stock';
      error: unknown;
      reconciliationError?: unknown;
    };

export interface FreezeStockRequest {
  readonly beanId: string;
  readonly batchId: string;
  /** Null means all remaining stock. Values are clamped to the current stock. */
  readonly amountGrams: number | null;
  readonly demo: boolean;
  readonly nowMs: number;
}

export type FreezeStockStart =
  | { type: 'missing' }
  | { type: 'nothing-to-freeze'; status: 'Nothing left to freeze' }
  | {
      type: 'optimistic';
      mode: 'whole';
      grams: number | null;
      projection: BeanInventoryProjection;
      status: 'Bag frozen';
      complete: boolean;
      completion: Promise<FreezeStockOutcome> | null;
    }
  | {
      type: 'queued';
      mode: 'split';
      grams: number;
      status: 'Freezing stock';
      completion: Promise<FreezeStockOutcome>;
    };

export type FreezeFailurePhase = 'create-portion' | 'persist-freezer-state' | 'update-source';

export type FreezeStockOutcome =
  | {
      type: 'frozen';
      mode: 'whole' | 'split';
      grams: number | null;
      sourceBatch: BeanBatch;
      frozenBatch: BeanBatch | null;
      projection: BeanInventoryProjection;
      /** True when a retry receipt or authoritative read proved the mutation. */
      recovered: boolean;
      status: string;
    }
  | {
      type: 'failed';
      mode: 'whole' | 'split';
      phase: FreezeFailurePhase | 'update-whole';
      reason: 'gateway' | 'superseded' | 'canceled' | 'disposed';
      projection?: BeanInventoryProjection;
      status: 'Freeze stock failed';
      error?: unknown;
    }
  | {
      type: 'reconciliation-required';
      mode: 'split';
      phase: Exclude<FreezeFailurePhase, 'create-portion'>;
      grams: number;
      createdBatch: BeanBatch;
      projection: BeanInventoryProjection;
      status: 'Freeze incomplete - review stock';
      error: unknown;
      reconciliationError?: unknown;
    }
  | {
      type: 'reconciliation-required';
      mode: 'split';
      phase: 'create-portion';
      grams: number;
      candidates: readonly BeanBatch[];
      projection: BeanInventoryProjection;
      status: 'Freeze result unknown - review stock';
      error: unknown;
      reconciliationError?: unknown;
    };
