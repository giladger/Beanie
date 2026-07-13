import type { Bean, BeanBatch } from '../api/types';
import {
  appendBatchStorageEvent,
  batchStorageEvents,
  beanLabel,
  compareBeansForPicker,
  latestBatch,
  setBatchStorageEventDates
} from '../domain/beanWorkflow';
import { dateInputValue } from '../domain/beanDisplay';
import {
  batchInputFromSubmission,
  beanFieldsUnchanged,
  beanSubmissionIsComplete,
  clampRemainingToWeight,
  createStockFormKey,
  freezeAmountFormKey,
  newStockFormKey,
  numberOrNullInput,
  type BatchStorageDatesSubmission,
  type BeanBatchFormSubmission,
  type BeanFormSubmission,
  type BeanInventoryFormSubmission
} from '../domain/beanForm';
import type { ClickActionHandler } from './actionContract';
import {
  BeanInventoryController,
  type BatchUpdateRequest,
  type BeanInventoryProjection
} from './beanInventoryController';
import { BeanWorkflowController } from './beanWorkflowController';
import type {
  BeanInventoryBrowserEvent,
  BeanInventoryBrowserSnapshot
} from './beanInventoryBrowserProjection';

export type BeanInventoryBrowserMode = 'inspect' | 'create';

export interface BeanInventoryBrowserHost {
  snapshot(): BeanInventoryBrowserSnapshot;
  emit(event: BeanInventoryBrowserEvent): void;
  requestRender(): void;
  scheduleApply(): void;
  refreshBeans(): void;
  refreshBeanUsage(): void;
  loadBatches(bean: Bean): Promise<BeanBatch[]>;
  inventoryNeedsReview(beanId: string): boolean;
  markInventoryReview(beanId: string, unresolved: boolean): void;
  selectBean(
    beanId: string,
    options: {
      readonly apply: boolean;
      readonly preferWorkflow: boolean;
      readonly preferredBatchId?: string | null;
    }
  ): Promise<void>;
  nextBeanHint(beanId: string): BeanInventoryBrowserSnapshot['secondTapHint'];
  completeBeanHint(): void;
  toggleFavoriteBean(beanId: string): void;
  confirmArchiveBean(): boolean;
}

export interface BeanInventoryBeanPort {
  createBean(fields: Partial<Bean>): Promise<Bean>;
  updateBean(id: string, fields: Partial<Bean>): Promise<Bean>;
  invalidateBeanMutation(beanId: string): Promise<void>;
  putBeans(beans: Bean[]): Promise<void>;
}

export interface BeanInventoryBrowserPresentation {
  readonly search: string;
  readonly autofocusSearch: boolean;
  readonly matches: Bean[];
  readonly focusedBean: Bean | null;
  readonly mode: BeanInventoryBrowserMode;
  readonly selectedBeanId: string | null;
  readonly selectedBatchId: string | null;
  readonly favoriteBeanIds: readonly string[];
  readonly focusedBatchId: string | null;
  readonly freezeStepperBatchId: string | null;
  readonly batchesByBean: Record<string, BeanBatch[]>;
  readonly prefillBeans: Bean[];
  readonly draftBatchBeanId: string | null;
  readonly draftBatch: Partial<BeanBatch> | null;
  readonly editingBeanDetailsId: string | null;
  readonly editingBatchId: string | null;
  readonly showAllBags: boolean;
  readonly formNumbers: Record<string, string>;
  readonly secondTapHint: BeanInventoryBrowserSnapshot['secondTapHint'];
}

interface BeanInventoryBrowserSession {
  readonly focusedBeanId: string | null;
  readonly mode: BeanInventoryBrowserMode;
  readonly autofocusSearch: boolean;
  readonly draftBatchBeanId: string | null;
  readonly draftBatch: Partial<BeanBatch> | null;
  readonly editingBeanId: string | null;
  readonly editingBatchId: string | null;
  readonly showAllBags: boolean;
  readonly focusedBatchId: string | null;
  readonly freezeBatchId: string | null;
  readonly storageTarget: { readonly beanId: string; readonly batchId: string } | null;
}

const EMPTY_SESSION: BeanInventoryBrowserSession = Object.freeze({
  focusedBeanId: null,
  mode: 'inspect',
  autofocusSearch: false,
  draftBatchBeanId: null,
  draftBatch: null,
  editingBeanId: null,
  editingBatchId: null,
  showAllBags: false,
  focusedBatchId: null,
  freezeBatchId: null,
  storageTarget: null
});

/**
 * Owns the bean picker and stock-browser session, its action table, typed form
 * submissions, and orchestration of the existing inventory facade. It cannot
 * access AppState, the DOM, gateway/cache singletons, or an untyped state setter.
 */
export class BeanInventoryBrowserFlow {
  private session: BeanInventoryBrowserSession = EMPTY_SESSION;

  constructor(
    private readonly host: BeanInventoryBrowserHost,
    private readonly beanWorkflow: BeanWorkflowController,
    private readonly inventory: BeanInventoryController,
    private readonly beans: BeanInventoryBeanPort
  ) {}

  reset(): void {
    this.session = EMPTY_SESSION;
  }

  close(): void {
    this.reset();
  }

  closeStorage(): void {
    this.session = { ...this.session, storageTarget: null };
    this.host.emit({ type: 'storage-closed' });
  }

  isCreateMode(): boolean {
    return this.session.mode === 'create';
  }

  reconcileBeans(beans: readonly Bean[], selectedBeanId: string | null): void {
    const ids = new Set(beans.map((bean) => bean.id));
    this.session = {
      ...this.session,
      focusedBeanId: this.session.focusedBeanId && ids.has(this.session.focusedBeanId)
        ? this.session.focusedBeanId
        : selectedBeanId,
      editingBeanId: this.session.editingBeanId && ids.has(this.session.editingBeanId)
        ? this.session.editingBeanId
        : null
    };
  }

  presentation(): BeanInventoryBrowserPresentation {
    const snapshot = this.host.snapshot();
    const beans = this.sortedBeans();
    const query = snapshot.search.trim().toLowerCase();
    const focusedId = this.session.focusedBeanId ?? snapshot.selectedBeanId;
    const focusedBean = this.session.mode === 'create'
      ? null
      : snapshot.beans.find((bean) => bean.id === focusedId) ??
        snapshot.beans.find((bean) => bean.id === snapshot.selectedBeanId) ??
        null;
    return {
      search: snapshot.search,
      autofocusSearch: this.session.autofocusSearch,
      matches: beans.filter((bean) => beanLabel(bean).toLowerCase().includes(query)),
      focusedBean,
      mode: this.session.mode,
      selectedBeanId: snapshot.selectedBeanId,
      selectedBatchId: snapshot.selectedBatchId,
      favoriteBeanIds: snapshot.favoriteBeans,
      focusedBatchId: this.session.focusedBatchId,
      freezeStepperBatchId: this.session.freezeBatchId,
      batchesByBean: mutableBatches(snapshot.batchesByBean),
      prefillBeans: beans,
      draftBatchBeanId: this.session.draftBatchBeanId,
      draftBatch: this.session.draftBatch,
      editingBeanDetailsId: this.session.editingBeanId,
      editingBatchId: this.session.editingBatchId,
      showAllBags: this.session.showAllBags,
      formNumbers: { ...snapshot.formNumbers },
      secondTapHint: snapshot.secondTapHint
    };
  }

  sortedBeans(): Bean[] {
    const snapshot = this.host.snapshot();
    const favorites = new Set(snapshot.favoriteBeans);
    return [...snapshot.beans].sort((a, b) => {
      const favoriteA = favorites.has(a.id) ? 0 : 1;
      const favoriteB = favorites.has(b.id) ? 0 : 1;
      if (favoriteA !== favoriteB) return favoriteA - favoriteB;
      return compareBeansForPicker(a, b, snapshot.beanUsageAt, snapshot.selectedBeanId);
    });
  }

  storageSelection(): { bean: Bean; batch: BeanBatch } | null {
    const target = this.session.storageTarget;
    return target ? this.batchAndBean(target.beanId, target.batchId) : null;
  }

  setSearch(search: string): void {
    this.host.emit({ type: 'search-changed', search });
  }

  captureDraftBatchField(
    beanId: string,
    name: 'roastDate' | 'roastLevel',
    value: string
  ): void {
    this.session = {
      ...this.session,
      draftBatch: {
        ...(this.session.draftBatch ?? { beanId }),
        beanId,
        [name]: value.trim() || null
      }
    };
  }

  async open(
    beanId: string | null,
    options: { readonly create?: boolean; readonly autofocusSearch?: boolean } = {}
  ): Promise<void> {
    const snapshot = this.host.snapshot();
    const id = beanId ?? snapshot.selectedBeanId;
    this.session = {
      ...EMPTY_SESSION,
      focusedBeanId: options.create ? null : id,
      mode: options.create ? 'create' : 'inspect',
      autofocusSearch: options.autofocusSearch ?? false
    };
    this.host.emit({ type: 'picker-opened', resetSearch: true });
    if (!options.create) {
      this.host.refreshBeans();
      this.host.refreshBeanUsage();
    }
    if (id && !options.create) await this.ensureBatchesLoaded(id);
  }

  async ensureBatchesLoaded(beanId: string): Promise<void> {
    const snapshot = this.host.snapshot();
    if (snapshot.batchesByBean[beanId] && !this.host.inventoryNeedsReview(beanId)) return;
    const bean = snapshot.beans.find((item) => item.id === beanId);
    if (!bean) return;
    this.host.emit({ type: 'status-changed', status: 'Loading batches' });
    const batches = await this.host.loadBatches(bean);
    this.host.emit({
      type: 'batches-loaded',
      beanId: bean.id,
      batches,
      status: 'Batches loaded'
    });
  }

  clickActions(): Record<string, ClickActionHandler> {
    return {
      'select-bean': async ({ id }) => {
        if (!id) return;
        this.host.completeBeanHint();
        this.host.emit({ type: 'picker-closed' });
        await this.host.selectBean(id, { apply: true, preferWorkflow: false });
      },
      'inspect-bean': async ({ id }) => {
        if (!id) return;
        const snapshot = this.host.snapshot();
        const focusedId = this.session.focusedBeanId ?? snapshot.selectedBeanId;
        if (id === focusedId) {
          this.host.completeBeanHint();
          this.host.emit({ type: 'picker-closed' });
          if (id !== snapshot.selectedBeanId) {
            await this.host.selectBean(id, { apply: true, preferWorkflow: false });
          }
        } else {
          await this.inspect(id);
        }
      },
      'open-add-bean': async () => {
        if (this.host.snapshot().modal === 'bean-picker') {
          this.session = { ...EMPTY_SESSION, mode: 'create' };
          this.host.emit({
            type: 'picker-opened',
            resetSearch: false,
            status: 'Adding bean'
          });
        } else {
          await this.open(null, { create: true });
        }
      },
      'open-edit-bean': async ({ id }) => {
        await this.open(id ?? this.host.snapshot().selectedBeanId);
      },
      'open-bean-picker': async () => {
        await this.open(this.host.snapshot().selectedBeanId);
      },
      'archive-bean': async ({ id }) => {
        if (id) await this.archiveBean(id);
      },
      'toggle-bean-details': ({ id }) => {
        if (!id) return;
        this.session = {
          ...this.session,
          editingBeanId: this.session.editingBeanId === id ? null : id,
          editingBatchId: null,
          focusedBeanId: id,
          mode: 'inspect'
        };
        this.host.requestRender();
      },
      'toggle-batch-details': ({ id }) => {
        if (!id) return;
        this.session = {
          ...this.session,
          editingBatchId: this.session.editingBatchId === id ? null : id,
          editingBeanId: null,
          freezeBatchId: null
        };
        this.host.requestRender();
      },
      'focus-batch': async ({ el, id }) => {
        if (!id) return;
        const changed = this.session.focusedBatchId !== id;
        this.session = {
          ...this.session,
          focusedBatchId: id,
          freezeBatchId: changed ? null : this.session.freezeBatchId,
          editingBatchId: changed ? null : this.session.editingBatchId
        };
        this.host.requestRender();
        if (changed && el.dataset.beanId) {
          await this.selectBatch(el.dataset.beanId, id);
        }
      },
      'toggle-freeze-stepper': ({ id }) => {
        if (!id) return;
        this.session = {
          ...this.session,
          freezeBatchId: this.session.freezeBatchId === id ? null : id,
          editingBatchId: null
        };
        this.host.requestRender();
      },
      'confirm-freeze-stock': async ({ el, id }) => {
        if (id && el.dataset.beanId) await this.freezeStock(el.dataset.beanId, id);
      },
      'toggle-bean-picker-show-all': () => {
        this.session = { ...this.session, showAllBags: !this.session.showAllBags };
        this.host.requestRender();
      },
      'toggle-favorite-bean': ({ id }) => {
        if (id) this.host.toggleFavoriteBean(id);
      },
      'open-add-batch': async () => {
        await this.open(this.host.snapshot().selectedBeanId);
        this.startBatchDraft(this.host.snapshot().selectedBeanId);
      },
      'bean-picker-add-batch': () => {
        this.startBatchDraft(this.session.focusedBeanId ?? this.host.snapshot().selectedBeanId);
      },
      'cancel-batch-draft': () => {
        this.cancelBatchDraft();
      },
      'open-batch-storage': ({ el, id }) => {
        if (!id || !el.dataset.beanId) return;
        this.session = {
          ...this.session,
          storageTarget: { beanId: el.dataset.beanId, batchId: id }
        };
        this.host.emit({ type: 'storage-opened', status: 'Dates and history' });
      },
      'batch-storage-event': async ({ el, id }) => {
        if (el.dataset.type !== 'frozen' && el.dataset.type !== 'thawed') return;
        const target = id && el.dataset.beanId
          ? { beanId: el.dataset.beanId, batchId: id }
          : null;
        await this.saveStorageEvent(el.dataset.type, target);
      },
      'finish-batch': async ({ el, id }) => {
        if (id) await this.finishBatch(el.dataset.beanId ?? null, id);
      }
    };
  }

  async submit(submission: BeanInventoryFormSubmission): Promise<void> {
    if (submission.type === 'bean') {
      await this.submitBean(submission);
    } else if (submission.type === 'batch') {
      await this.submitBatch(submission);
    } else {
      await this.saveStorageDates(submission);
    }
  }

  async saveBatch(submission: BeanBatchFormSubmission): Promise<void> {
    if (!submission.batchId) return;
    const selection = this.batchAndBean(submission.beanId, submission.batchId);
    if (!selection) return;
    await this.updateBatch({
      beanId: selection.bean.id,
      batchId: selection.batch.id,
      patch: batchInputFromSubmission(submission.fields, selection.bean.id, selection.batch),
      purpose: 'edit',
      demo: this.host.snapshot().demo
    });
  }

  async saveBatchValue(
    beanId: string,
    batchId: string,
    name: string,
    value: string
  ): Promise<void> {
    const selection = this.batchAndBean(beanId, batchId);
    if (!selection) return;
    const nextValue = numberOrNullInput(value);
    const patch: Partial<BeanBatch> = { beanId };
    const weight = name === 'weight' ? nextValue : selection.batch.weight ?? null;
    if (name === 'weight') patch.weight = nextValue;
    const remaining = clampRemainingToWeight(
      name === 'weightRemaining' ? nextValue : selection.batch.weightRemaining ?? null,
      weight
    );
    if (
      name === 'weightRemaining' ||
      remaining !== (selection.batch.weightRemaining ?? null)
    ) {
      patch.weightRemaining = remaining;
    }
    await this.updateBatch({
      beanId,
      batchId,
      patch,
      purpose: 'edit',
      demo: this.host.snapshot().demo
    });
  }

  private async inspect(beanId: string): Promise<void> {
    this.session = {
      ...EMPTY_SESSION,
      focusedBeanId: beanId,
      mode: 'inspect'
    };
    this.host.emit({
      type: 'second-tap-changed',
      hint: this.host.nextBeanHint(beanId)
    });
    await this.ensureBatchesLoaded(beanId);
  }

  private startBatchDraft(beanId: string | null): void {
    if (!beanId) return;
    const snapshot = this.host.snapshot();
    const bean = snapshot.beans.find((item) => item.id === beanId);
    if (!bean) return;
    const latest = latestBatch(snapshot.batchesByBean[bean.id] ?? []);
    const weightKey = newStockFormKey(bean.id, 'weight');
    const remainingKey = newStockFormKey(bean.id, 'weightRemaining');
    const weight = inputValue(latest?.weight ?? 250);
    this.session = {
      ...this.session,
      focusedBeanId: bean.id,
      mode: 'inspect',
      draftBatchBeanId: bean.id,
      draftBatch: null,
      editingBatchId: null
    };
    this.host.emit({
      type: 'form-numbers-changed',
      values: {
        [weightKey]: snapshot.formNumbers[weightKey] ?? weight,
        [remainingKey]: snapshot.formNumbers[remainingKey] ?? weight
      },
      status: 'Adding stock'
    });
  }

  private cancelBatchDraft(): void {
    const beanId = this.session.draftBatchBeanId;
    if (!beanId) return;
    this.session = {
      ...this.session,
      draftBatchBeanId: null,
      draftBatch: null
    };
    this.host.emit({
      type: 'form-numbers-changed',
      removeKeys: [
        newStockFormKey(beanId, 'weight'),
        newStockFormKey(beanId, 'weightRemaining')
      ],
      status: 'Stock draft cancelled'
    });
  }

  private async selectBatch(beanId: string, batchId: string): Promise<void> {
    await this.ensureBatchesLoaded(beanId);
    const selection = this.batchAndBean(beanId, batchId);
    if (!selection || isFinishedBatch(selection.batch)) return;
    this.host.completeBeanHint();
    this.host.emit({ type: 'second-tap-changed', hint: null });
    await this.host.selectBean(beanId, {
      apply: true,
      preferWorkflow: false,
      preferredBatchId: batchId
    });
  }

  private async submitBean(submission: BeanFormSubmission): Promise<void> {
    const snapshot = this.host.snapshot();
    if (snapshot.busy || !beanSubmissionIsComplete(submission)) return;
    const editingId = submission.editingId;
    if (!editingId && !this.requireWrite(snapshot.demo)) return;
    this.host.emit({
      type: 'status-changed',
      status: editingId ? 'Saving bean' : 'Adding bean',
      busy: true
    });

    if (!editingId && submission.prefillBeanId) {
      const continuingBean = this.host.snapshot().beans.find(
        (bean) => bean.id === submission.prefillBeanId
      );
      if (continuingBean && beanFieldsUnchanged(submission.fields, continuingBean)) {
        await this.addFirstStock(continuingBean, submission, 'Stock added');
        return;
      }
    }

    const current = this.host.snapshot();
    const result = await this.beanWorkflow.saveBean({
      beans: [...current.beans],
      batchesByBean: mutableBatches(current.batchesByBean),
      editingId,
      fields: submission.fields,
      demo: current.demo,
      nowMs: Date.now()
    }, {
      createBean: (fields) => this.beans.createBean(fields),
      updateBean: (id, fields) => this.beans.updateBean(id, fields),
      putBeans: (beans) => this.beans.putBeans(beans)
    });

    if (result.type === 'failed') {
      console.error('[Beanie] Save bean failed', result.error);
      this.host.emit({ type: 'status-changed', status: result.status, busy: false });
      return;
    }

    if (!editingId) {
      const batch = batchInputFromSubmission(submission.firstStock, result.bean.id);
      const created = await this.inventory.createBatch({
        beanId: result.bean.id,
        batch,
        demo: this.host.snapshot().demo,
        nowMs: Date.now()
      });
      const beans = mergeSavedBean(this.host.snapshot().beans, result.bean, false);
      void this.beans.putBeans(beans).catch(() => {});
      this.session = {
        ...this.session,
        focusedBeanId: result.bean.id,
        mode: 'inspect',
        editingBeanId: null,
        editingBatchId: null,
        draftBatchBeanId: created.type === 'failed' ||
          (created.type === 'reconciliation-required' && created.phase === 'create')
          ? result.bean.id
          : null,
        draftBatch: created.type === 'failed' ||
          (created.type === 'reconciliation-required' && created.phase === 'create')
          ? batch
          : null
      };
      if (created.type === 'failed') {
        console.error('[Beanie] Add first stock failed', created.error);
        this.host.emit({
          type: 'bean-created-without-stock',
          bean: result.bean,
          beans,
          status: created.status
        });
        return;
      }
      if (created.type === 'reconciliation-required' && created.phase === 'create') {
        this.host.markInventoryReview(result.bean.id, true);
        this.adoptInventory(created.projection, {
          beans,
          busy: false,
          status: created.status
        });
        return;
      }
      this.host.markInventoryReview(result.bean.id, false);
      this.adoptInventory(created.projection, {
        beans,
        busy: false,
        removeFormKeys: [
          createStockFormKey('weight'),
          createStockFormKey('weightRemaining')
        ],
        status: created.type === 'reconciliation-required'
          ? created.status
          : this.host.snapshot().demo
            ? 'Bean and stock added (demo)'
            : 'Bean and stock added'
      });
      return;
    }

    const beans = mergeSavedBean(this.host.snapshot().beans, result.bean, true);
    void this.beans.putBeans(beans).catch(() => {});
    this.session = {
      ...this.session,
      focusedBeanId: result.bean.id,
      mode: 'inspect',
      editingBatchId: null
    };
    this.host.emit({ type: 'bean-saved', beans, status: result.status });
  }

  private async addFirstStock(
    bean: Bean,
    submission: BeanFormSubmission,
    status: string
  ): Promise<void> {
    const batch = batchInputFromSubmission(submission.firstStock, bean.id);
    const result = await this.inventory.createBatch({
      beanId: bean.id,
      batch,
      demo: this.host.snapshot().demo,
      nowMs: Date.now()
    });
    this.session = {
      ...this.session,
      focusedBeanId: bean.id,
      mode: 'inspect',
      draftBatchBeanId: result.type === 'failed' ||
        (result.type === 'reconciliation-required' && result.phase === 'create')
        ? bean.id
        : null,
      draftBatch: result.type === 'failed' ||
        (result.type === 'reconciliation-required' && result.phase === 'create')
        ? batch
        : null,
      editingBeanId: null,
      editingBatchId: null
    };
    if (result.type === 'failed') {
      console.error('[Beanie] Add stock to existing bean failed', result.error);
      this.host.emit({ type: 'status-changed', status: result.status, busy: false });
      return;
    }
    const beans = promoteBean(this.host.snapshot().beans, bean.id);
    void this.beans.putBeans(beans).catch(() => {});
    if (result.type === 'reconciliation-required' && result.phase === 'create') {
      this.host.markInventoryReview(bean.id, true);
      this.adoptInventory(result.projection, {
        beans,
        busy: false,
        status: result.status
      });
      return;
    }
    this.host.markInventoryReview(bean.id, false);
    this.adoptInventory(result.projection, {
      beans,
      busy: false,
      removeFormKeys: [
        createStockFormKey('weight'),
        createStockFormKey('weightRemaining')
      ],
      status: result.type === 'reconciliation-required'
        ? result.status
        : this.host.snapshot().demo
          ? `${status} (demo)`
          : status
    });
  }

  private async archiveBean(id: string): Promise<void> {
    if (!this.host.confirmArchiveBean()) return;
    this.host.emit({ type: 'status-changed', status: 'Deleting coffee', busy: true });
    const before = this.host.snapshot();
    const result = await this.beanWorkflow.archiveBean({
      beans: [...before.beans],
      id,
      selectedBeanId: before.selectedBeanId,
      demo: before.demo
    }, {
      updateBean: (beanId, fields) => this.beans.updateBean(beanId, fields),
      invalidateBeanMutation: (beanId) => this.beans.invalidateBeanMutation(beanId),
      putBeans: (beans) => this.beans.putBeans(beans)
    });
    if (result.type === 'failed') {
      console.error('[Beanie] Delete bean failed', result.error);
      this.host.emit({ type: 'status-changed', status: result.status, busy: false });
      return;
    }

    const latest = this.host.snapshot();
    const stayInPicker = latest.modal === 'bean-picker';
    if (stayInPicker) {
      const previousIndex = latest.beans.findIndex((bean) => bean.id === id);
      const nextFocusId = result.beans[previousIndex]?.id ??
        result.beans[previousIndex - 1]?.id ??
        result.beans[0]?.id ??
        null;
      this.session = {
        ...this.session,
        focusedBeanId: nextFocusId,
        mode: nextFocusId ? 'inspect' : 'create',
        editingBeanId: null,
        editingBatchId: null
      };
    }
    this.host.emit({
      type: 'bean-archived',
      beans: result.beans,
      status: result.status,
      stayInPicker,
      clearSelectedBean: result.archivedSelectedBean && !result.nextSelectedBeanId
    });
    if (result.archivedSelectedBean && result.nextSelectedBeanId) {
      await this.host.selectBean(result.nextSelectedBeanId, {
        apply: false,
        preferWorkflow: false
      });
    }
  }

  private async submitBatch(submission: BeanBatchFormSubmission): Promise<void> {
    const snapshot = this.host.snapshot();
    if (snapshot.busy || !this.requireWrite(snapshot.demo)) return;
    const selection = submission.batchId
      ? this.batchAndBean(submission.beanId, submission.batchId)
      : null;
    const bean = snapshot.beans.find((item) => item.id === submission.beanId);
    if (!bean || (submission.batchId && !selection)) return;
    const batch = batchInputFromSubmission(
      submission.fields,
      bean.id,
      selection?.batch
    );
    if (!submission.batchId) {
      this.session = { ...this.session, draftBatch: batch };
    }
    this.host.emit({
      type: 'status-changed',
      status: submission.batchId ? 'Saving stock' : 'Adding stock',
      busy: true
    });
    if (!submission.batchId) {
      const result = await this.inventory.createBatch({
        beanId: bean.id,
        batch,
        demo: this.host.snapshot().demo,
        nowMs: Date.now()
      });
      if (result.type === 'failed') {
        console.error('[Beanie] Save batch failed', result.error);
        this.host.emit({ type: 'status-changed', status: result.status, busy: false });
        return;
      }
      if (result.type === 'reconciliation-required' && result.phase === 'create') {
        this.host.markInventoryReview(bean.id, true);
        this.adoptInventory(result.projection, { busy: false, status: result.status });
        return;
      }
      this.host.markInventoryReview(bean.id, false);
      this.session = {
        ...this.session,
        draftBatchBeanId: null,
        draftBatch: null,
        editingBatchId: null
      };
      this.adoptInventory(result.projection, {
        busy: false,
        removeFormKeys: [
          newStockFormKey(bean.id, 'weight'),
          newStockFormKey(bean.id, 'weightRemaining')
        ],
        status: result.status
      });
      return;
    }
    const outcome = await this.updateBatch({
      beanId: bean.id,
      batchId: submission.batchId,
      patch: batch,
      purpose: 'edit',
      demo: this.host.snapshot().demo
    }, { releaseBusy: true });
    if (outcome === 'skipped') {
      this.host.emit({ type: 'status-changed', status: 'Stock unchanged', busy: false });
    }
  }

  private async saveStorageEvent(
    type: 'frozen' | 'thawed',
    target: { readonly beanId: string; readonly batchId: string } | null
  ): Promise<void> {
    const selection = target
      ? this.batchAndBean(target.beanId, target.batchId)
      : this.storageSelection();
    if (!selection) return;
    await this.saveStoragePatch(selection.bean, selection.batch.id, {
      beanId: selection.bean.id,
      ...appendBatchStorageEvent(selection.batch, type, new Date())
    }, type === 'frozen' ? 'Bag frozen' : 'Bag moved to shelf');
  }

  private async saveStorageDates(
    submission: BatchStorageDatesSubmission
  ): Promise<void> {
    const selection = this.storageSelection();
    if (!selection) return;
    const events = batchStorageEvents(selection.batch);
    const patch: Partial<BeanBatch> = { beanId: selection.bean.id };
    let changed = false;
    if (Object.prototype.hasOwnProperty.call(submission.values, 'roast')) {
      const roast = submission.values.roast ?? '';
      if (roast && roast !== dateInputValue(selection.batch.roastDate)) {
        patch.roastDate = roast;
        changed = true;
      }
    }
    if (events.length === 0) {
      const firstFreeze = submission.values['event-new'] ?? '';
      if (firstFreeze) {
        const at = new Date(firstFreeze);
        if (Number.isNaN(at.valueOf())) {
          this.host.emit({ type: 'status-changed', status: 'Choose a valid date' });
          return;
        }
        Object.assign(patch, appendBatchStorageEvent(selection.batch, 'frozen', at));
        changed = true;
      }
    } else {
      const dates = events.map((_, index) => submission.values[`event-${index}`] ?? '');
      const rebuilt = setBatchStorageEventDates(selection.batch, dates, new Date());
      if (rebuilt.storageEvents) {
        Object.assign(patch, rebuilt);
        changed = true;
      }
    }
    if (!changed) {
      this.host.emit({ type: 'status-changed', status: 'No date changes' });
      return;
    }
    await this.saveStoragePatch(selection.bean, selection.batch.id, patch, 'Dates saved');
  }

  private async freezeStock(beanId: string, batchId: string): Promise<void> {
    const snapshot = this.host.snapshot();
    if (!this.requireWrite(snapshot.demo)) return;
    const formKey = freezeAmountFormKey(batchId);
    const amount = numberOrNullInput(snapshot.formNumbers[formKey] ?? null);
    const start = this.inventory.startFreezeStock({
      beanId,
      batchId,
      amountGrams: amount,
      demo: snapshot.demo,
      nowMs: Date.now()
    });
    if (start.type === 'missing') return;
    if (start.type === 'nothing-to-freeze') {
      this.host.emit({ type: 'status-changed', status: start.status });
      return;
    }
    this.session = { ...this.session, freezeBatchId: null };
    if (start.type === 'optimistic') {
      this.adoptInventory(start.projection, {
        removeFormKeys: [formKey],
        status: start.status
      });
      if (start.complete || !start.completion) return;
    } else {
      this.host.emit({
        type: 'form-numbers-changed',
        removeKeys: [formKey],
        status: start.status
      });
    }
    const outcome = await start.completion!;
    if (outcome.type === 'failed') {
      console.error('[Beanie] Freeze stock failed', outcome.error ?? outcome.reason);
      if (outcome.projection) {
        this.adoptInventory(outcome.projection, { status: outcome.status });
      } else {
        this.host.emit({ type: 'status-changed', status: outcome.status });
      }
      return;
    }
    if (outcome.type === 'reconciliation-required') {
      console.error('[Beanie] Freeze stock needs reconciliation', outcome.error);
    }
    this.adoptInventory(outcome.projection, {
      removeFormKeys: [formKey],
      status: outcome.status
    });
  }

  async saveStoragePatch(
    bean: Bean,
    batchId: string,
    patch: Partial<BeanBatch>,
    status: string
  ): Promise<'saved' | 'failed' | 'skipped'> {
    return this.updateBatch({
      beanId: bean.id,
      batchId,
      patch,
      purpose: 'stock',
      demo: this.host.snapshot().demo
    }, { optimisticStatus: status, savedStatus: status });
  }

  private async finishBatch(beanId: string | null, batchId: string): Promise<void> {
    if (!beanId) return;
    const selection = this.batchAndBean(beanId, batchId);
    if (!selection || isFinishedBatch(selection.batch)) return;
    if (this.session.editingBatchId === batchId) {
      this.session = { ...this.session, editingBatchId: null };
    }
    await this.updateBatch({
      beanId,
      batchId,
      patch: { beanId, weightRemaining: 0 },
      purpose: 'finish',
      demo: this.host.snapshot().demo
    });
  }

  private async updateBatch(
    request: BatchUpdateRequest,
    options: {
      readonly optimisticStatus?: string;
      readonly savedStatus?: string;
      readonly releaseBusy?: boolean;
    } = {}
  ): Promise<'saved' | 'failed' | 'skipped'> {
    if (!this.requireWrite(request.demo)) return 'failed';
    const start = this.inventory.startBatchUpdate(request);
    if (start.type === 'missing') return 'skipped';
    this.adoptInventory(start.projection, {
      ...(options.releaseBusy ? { busy: false } : {}),
      status: options.optimisticStatus ?? start.status
    });
    if (start.complete || !start.completion) return 'saved';
    const outcome = await start.completion;
    if (outcome.type === 'failed') {
      console.error('[Beanie] Inventory update failed', outcome.error ?? outcome.reason);
    }
    this.adoptInventory(outcome.projection, {
      ...(options.releaseBusy ? { busy: false } : {}),
      status: outcome.type === 'saved'
        ? options.savedStatus ?? outcome.status
        : outcome.status
    });
    return outcome.type === 'saved' ? 'saved' : 'failed';
  }

  private adoptInventory(
    projection: BeanInventoryProjection,
    options: {
      readonly status: string;
      readonly busy?: boolean;
      readonly beans?: readonly Bean[];
      readonly removeFormKeys?: readonly string[];
    }
  ): void {
    this.host.emit({
      type: 'inventory-projected',
      projection,
      status: options.status,
      ...(options.busy == null ? {} : { busy: options.busy }),
      ...(options.beans ? { beans: options.beans } : {}),
      ...(options.removeFormKeys ? { removeFormKeys: options.removeFormKeys } : {})
    });
    if (projection.shouldScheduleApply) this.host.scheduleApply();
  }

  private requireWrite(demo: boolean): boolean {
    if (demo || this.host.snapshot().inventoryJournalReady) return true;
    this.host.emit({
      type: 'status-changed',
      status: 'Bag changes are read-only — local journal unavailable'
    });
    return false;
  }

  private batchAndBean(beanId: string, batchId: string): {
    bean: Bean;
    batch: BeanBatch;
  } | null {
    const snapshot = this.host.snapshot();
    const bean = snapshot.beans.find((item) => item.id === beanId);
    const batch = bean
      ? (snapshot.batchesByBean[bean.id] ?? []).find((item) => item.id === batchId)
      : null;
    return bean && batch ? { bean, batch } : null;
  }
}

function mergeSavedBean(
  latest: readonly Bean[],
  saved: Bean,
  editing: boolean
): Bean[] {
  return editing
    ? latest.map((bean) => bean.id === saved.id ? saved : bean)
    : [saved, ...latest.filter((bean) => bean.id !== saved.id)];
}

function promoteBean(beans: readonly Bean[], beanId: string): Bean[] {
  const bean = beans.find((item) => item.id === beanId);
  return bean ? [bean, ...beans.filter((item) => item.id !== beanId)] : [...beans];
}

function mutableBatches(
  batches: Readonly<Record<string, BeanBatch[]>>
): Record<string, BeanBatch[]> {
  return Object.fromEntries(
    Object.entries(batches).map(([beanId, values]) => [beanId, [...values]])
  );
}

function isFinishedBatch(batch: BeanBatch): boolean {
  return typeof batch.weightRemaining === 'number' &&
    Number.isFinite(batch.weightRemaining) &&
    batch.weightRemaining < 5;
}

function inputValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'number') {
    const rounded = Math.round(value * 1000) / 1000;
    return String(rounded);
  }
  return String(value);
}
