import type { Bean, BeanBatch } from '../api/types';
import type { AppModal } from './actionContract';
import type { BeanInventoryProjection } from './beanInventoryController';

export interface BeanInventoryBrowserSnapshot {
  readonly beans: readonly Bean[];
  readonly batchesByBean: Readonly<Record<string, BeanBatch[]>>;
  readonly selectedBeanId: string | null;
  readonly selectedBatchId: string | null;
  readonly favoriteBeans: readonly string[];
  readonly beanUsageAt: Readonly<Record<string, number>>;
  readonly formNumbers: Readonly<Record<string, string>>;
  readonly search: string;
  readonly secondTapHint: {
    readonly kind: 'shot' | 'bean' | 'profile';
    readonly id: string;
  } | null;
  readonly busy: boolean;
  readonly demo: boolean;
  readonly modal: AppModal;
  readonly inventoryJournalReady: boolean;
}

export type BeanInventoryBrowserEvent =
  | { readonly type: 'picker-opened'; readonly resetSearch: boolean; readonly status?: string }
  | { readonly type: 'picker-closed' }
  | { readonly type: 'storage-opened'; readonly status: string }
  | { readonly type: 'storage-closed' }
  | { readonly type: 'search-changed'; readonly search: string }
  | {
      readonly type: 'status-changed';
      readonly status: string;
      readonly busy?: boolean;
    }
  | {
      readonly type: 'second-tap-changed';
      readonly hint: BeanInventoryBrowserSnapshot['secondTapHint'];
    }
  | {
      readonly type: 'batches-loaded';
      readonly beanId: string;
      readonly batches: readonly BeanBatch[];
      readonly status: string;
    }
  | {
      readonly type: 'inventory-projected';
      readonly projection: BeanInventoryProjection;
      readonly status: string;
      readonly busy?: boolean;
      readonly beans?: readonly Bean[];
      readonly removeFormKeys?: readonly string[];
    }
  | {
      readonly type: 'bean-created-without-stock';
      readonly bean: Bean;
      readonly beans: readonly Bean[];
      readonly status: string;
    }
  | {
      readonly type: 'bean-saved';
      readonly beans: readonly Bean[];
      readonly status: string;
    }
  | {
      readonly type: 'bean-archived';
      readonly beans: readonly Bean[];
      readonly status: string;
      readonly stayInPicker: boolean;
      readonly clearSelectedBean: boolean;
    }
  | {
      readonly type: 'form-numbers-changed';
      readonly values?: Readonly<Record<string, string>>;
      readonly removeKeys?: readonly string[];
      readonly status?: string;
    };

export interface BeanInventoryBrowserShellProjection {
  readonly beans?: Bean[];
  readonly batchesByBean?: Record<string, BeanBatch[]>;
  readonly selectedBeanId?: string | null;
  readonly selectedBatchId?: string | null;
  readonly formNumbers?: Record<string, string>;
  readonly search?: string;
  readonly secondTapHint?: BeanInventoryBrowserSnapshot['secondTapHint'];
  readonly busy?: boolean;
  readonly status?: string;
  readonly modal?: AppModal;
  readonly view?: 'workbench';
}

/** Rebase feature events on the shell's latest collections at commit time. */
export function projectBeanInventoryBrowserEvent(
  snapshot: Pick<BeanInventoryBrowserSnapshot, 'batchesByBean' | 'formNumbers'>,
  event: BeanInventoryBrowserEvent
): BeanInventoryBrowserShellProjection {
  switch (event.type) {
    case 'picker-opened':
      return {
        modal: 'bean-picker',
        ...(event.resetSearch ? { search: '' } : {}),
        ...(event.status ? { status: event.status } : {})
      };
    case 'picker-closed':
      return { modal: null, secondTapHint: null };
    case 'storage-opened':
      return { modal: 'batch-storage', status: event.status };
    case 'storage-closed':
      return { modal: 'bean-picker' };
    case 'search-changed':
      return { search: event.search };
    case 'status-changed':
      return {
        status: event.status,
        ...(event.busy == null ? {} : { busy: event.busy })
      };
    case 'second-tap-changed':
      return { secondTapHint: event.hint };
    case 'batches-loaded':
      return {
        batchesByBean: {
          ...snapshot.batchesByBean,
          [event.beanId]: [...event.batches]
        },
        status: event.status
      };
    case 'inventory-projected':
      return {
        ...(event.beans ? { beans: [...event.beans] } : {}),
        batchesByBean: {
          ...snapshot.batchesByBean,
          [event.projection.beanId]: [...event.projection.batches]
        },
        ...(Object.prototype.hasOwnProperty.call(event.projection, 'selectedBatchId')
          ? { selectedBatchId: event.projection.selectedBatchId ?? null }
          : {}),
        ...(event.removeFormKeys
          ? { formNumbers: omitKeys(snapshot.formNumbers, event.removeFormKeys) }
          : {}),
        ...(event.busy == null ? {} : { busy: event.busy }),
        status: event.status
      };
    case 'bean-created-without-stock':
      return {
        beans: [...event.beans],
        batchesByBean: Object.prototype.hasOwnProperty.call(
          snapshot.batchesByBean,
          event.bean.id
        )
          ? { ...snapshot.batchesByBean }
          : { ...snapshot.batchesByBean, [event.bean.id]: [] },
        busy: false,
        status: event.status
      };
    case 'bean-saved':
      return { beans: [...event.beans], busy: false, status: event.status };
    case 'bean-archived':
      return {
        beans: [...event.beans],
        busy: false,
        status: event.status,
        ...(event.clearSelectedBean ? { selectedBeanId: null } : {}),
        ...(event.stayInPicker
          ? { modal: 'bean-picker' as const }
          : { view: 'workbench' as const })
      };
    case 'form-numbers-changed':
      return {
        formNumbers: {
          ...omitKeys(snapshot.formNumbers, event.removeKeys ?? []),
          ...(event.values ?? {})
        },
        ...(event.status ? { status: event.status } : {})
      };
  }
}

function omitKeys<Value>(
  record: Readonly<Record<string, Value>>,
  keys: readonly string[]
): Record<string, Value> {
  const removed = new Set(keys);
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => !removed.has(key))
  );
}
