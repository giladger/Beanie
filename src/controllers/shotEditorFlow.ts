import type {
  Bean,
  BeanBatch,
  Grinder,
  ShotAnnotations,
  ShotRecord,
  ShotUpdate
} from '../api/types';
import { latestBatch } from '../domain/beanWorkflow';
import { rebaseChangedFields } from '../domain/rebaseMutation';
import { isServiceShot } from '../domain/shotRecord';
import {
  isShotEditField,
  shotEditDraftFromShot,
  shotEditDraftWithNumbers,
  shotUpdateFromDraft,
  updateShotEditDraftField,
  type ShotBeanEditState,
  type ShotEditorNumberValues,
  type ShotEditDraft,
  type ShotEditField
} from '../domain/shotEditModel';
import type {
  SaveBeanInput,
  SaveBeanResult
} from './beanWorkflowController';
import type { AppModal, ClickActionHandler } from './actionContract';
import {
  saveShotUpdate,
  shotEnjoymentUpdate
} from './shotMetadataController';

export interface ShotEditorSnapshot {
  readonly shots: ShotRecord[];
  readonly selectedShotId: string | null;
  readonly draft: ShotEditDraft | null;
  readonly beanDialog: ShotBeanEditState | null;
  readonly beans: Bean[];
  readonly batchesByBean: Record<string, BeanBatch[]>;
  readonly grinders: Grinder[];
  readonly demo: boolean;
  readonly busy: boolean;
}

export type ShotEditorEvent =
  | { type: 'opened'; shotId: string; draft: ShotEditDraft }
  | {
      type: 'draft-changed';
      draft: ShotEditDraft;
      closeField?: boolean;
      closeBeanDialog?: boolean;
    }
  | { type: 'field-dialog'; field: ShotEditField | null }
  | { type: 'bean-dialog'; dialog: ShotBeanEditState | null }
  | { type: 'saving'; status: string }
  | { type: 'shot-saved'; shot: ShotRecord; status: string }
  | { type: 'save-failed'; status: string; operation: string; error: unknown }
  | { type: 'bean-saving' }
  | {
      type: 'bean-saved';
      beans: Bean[];
      batchesByBean: Record<string, BeanBatch[]>;
      draft: ShotEditDraft | null;
      status: string;
    };

export interface ShotEditorShellProjection {
  readonly shots?: ShotRecord[];
  readonly detailShotId?: string | null;
  readonly secondTapHint?: null;
  readonly modal?: AppModal;
  readonly editDialog?: null;
  readonly shotEdit?: ShotEditDraft | null;
  readonly shotEditField?: ShotEditField | null;
  readonly shotBeanEdit?: ShotBeanEditState | null;
  readonly profileEdit?: null;
  readonly beans?: Bean[];
  readonly batchesByBean?: Record<string, BeanBatch[]>;
  readonly busy?: boolean;
  readonly status?: string;
}

/** Reduces a flow event against only the latest shot list needed for settlement. */
export function projectShotEditorEvent(
  shots: readonly ShotRecord[],
  event: ShotEditorEvent
): ShotEditorShellProjection {
  switch (event.type) {
    case 'opened':
      return {
        detailShotId: event.shotId,
        secondTapHint: null,
        modal: 'edit-shot',
        editDialog: null,
        shotEdit: event.draft,
        shotEditField: null,
        shotBeanEdit: null,
        profileEdit: null
      };
    case 'draft-changed':
      return {
        shotEdit: event.draft,
        ...(event.closeField ? { shotEditField: null } : {}),
        ...(event.closeBeanDialog ? { shotBeanEdit: null } : {}),
        status: 'Shot draft changed'
      };
    case 'field-dialog':
      return {
        shotEditField: event.field,
        ...(event.field ? { shotBeanEdit: null } : {})
      };
    case 'bean-dialog':
      return {
        shotBeanEdit: event.dialog,
        ...(event.dialog ? { shotEditField: null } : {})
      };
    case 'saving':
      return { busy: true, status: event.status };
    case 'shot-saved':
      return {
        shots: shots.map((shot) => shot.id === event.shot.id ? event.shot : shot),
        detailShotId: event.shot.id,
        modal: null,
        editDialog: null,
        shotEdit: null,
        shotEditField: null,
        shotBeanEdit: null,
        busy: false,
        status: event.status
      };
    case 'save-failed':
      return { busy: false, status: event.status };
    case 'bean-saving':
      return { busy: true, status: 'Adding bean' };
    case 'bean-saved':
      return {
        beans: event.beans,
        batchesByBean: event.batchesByBean,
        shotEdit: event.draft,
        shotBeanEdit: null,
        busy: false,
        status: event.status
      };
  }
}

export interface ShotEditorFlowDeps {
  snapshot(): ShotEditorSnapshot;
  emit(event: ShotEditorEvent): void;
  beginRemoteShotMutation(): void;
  runExactShotMutation<T>(shotId: string, run: () => Promise<T>): Promise<T>;
  readShot(shotId: string): Promise<ShotRecord>;
  updateShot(shotId: string, update: ShotUpdate): Promise<ShotRecord>;
  invalidateShotMutation(shotId: string): Promise<void>;
  putShotRecord(shot: ShotRecord): Promise<void>;
  ensureBatchesLoaded(beanId: string): Promise<void>;
  saveBean(input: SaveBeanInput): Promise<SaveBeanResult>;
  putBeans(beans: Bean[]): Promise<void>;
  scoreValueFromTap(value: string | undefined, currentValue: number | null | undefined): number | null;
}

interface SaveLabels {
  readonly busyStatus: string;
  readonly successStatus: string;
  readonly demoStatus: string;
  readonly failureStatus: string;
}

const SHOT_SAVE_LABELS: SaveLabels = {
  busyStatus: 'Saving shot',
  successStatus: 'Shot saved',
  demoStatus: 'Shot saved (demo)',
  failureStatus: 'Save shot failed'
};

/**
 * Owns the shot editor session and metadata persistence orchestration. It sees
 * only the editor's state slice and reports explicit events to the app shell;
 * deletion remains owned by ShotDeletionFlow.
 */
export class ShotEditorFlow {
  constructor(private readonly deps: ShotEditorFlowDeps) {}

  open(shotId?: string): void {
    const snapshot = this.deps.snapshot();
    const history = snapshot.shots.filter((shot) => !isServiceShot(shot));
    const selectedId = shotId ?? snapshot.selectedShotId;
    const shot = history.find((item) => item.id === selectedId) ?? history[0] ?? null;
    if (!shot) return;
    this.deps.emit({ type: 'opened', shotId: shot.id, draft: shotEditDraftFromShot(shot) });
  }

  phoneClickActions(): Record<string, ClickActionHandler> {
    return {
      'phone-edit-shot': ({ id }) => {
        if (id) this.open(id);
      },
      'phone-shot-score': ({ id, value }) => {
        if (!id) return;
        this.applyPhoneScore(
          id,
          this.deps.scoreValueFromTap(value, this.currentEnjoyment(id))
        );
      },
      'phone-save-shot': async ({ id }) => {
        if (id) await this.savePhoneDraft(id);
      }
    };
  }

  editorClickActions(): Record<string, ClickActionHandler> {
    return {
      'edit-shot': () => this.open(),
      'open-shot-field': ({ field }) => {
        if (isShotEditField(field)) this.openField(field);
      },
      'close-shot-field': () => this.closeField(),
      'shot-field-option': ({ field, value }) => {
        if (isShotEditField(field)) this.commitField(field, value ?? '');
      },
      'open-shot-bean': () => this.openBeanDialog(),
      'close-shot-bean': () => this.closeBeanDialog(),
      'shot-bean-pick': async ({ id }) => this.pickBean(id ?? ''),
      'shot-bean-new': () => this.setBeanCreating(true),
      'shot-bean-cancel-new': () => this.setBeanCreating(false),
      'shot-edit-ey-calc': ({ value }) => this.setCalculatedEy(Number(value)),
      'shot-edit-score': ({ value }) => this.setEnjoyment(
        this.deps.scoreValueFromTap(value, this.deps.snapshot().draft?.enjoyment ?? null)
      ),
      'set-shot-score': async ({ id, value }) => {
        if (!id) return;
        const current = this.deps.snapshot().shots
          .find((shot) => shot.id === id)?.annotations?.enjoyment ?? null;
        await this.updateEnjoyment(
          id,
          this.deps.scoreValueFromTap(value, current)
        );
      }
    };
  }

  openField(field: ShotEditField): void {
    this.deps.emit({ type: 'field-dialog', field });
  }

  closeField(): void {
    this.deps.emit({ type: 'field-dialog', field: null });
  }

  draftWithField(field: ShotEditField, value: string): ShotEditDraft | null {
    const snapshot = this.deps.snapshot();
    return snapshot.draft
      ? updateShotEditDraftField(snapshot.draft, field, value, snapshot.grinders)
      : null;
  }

  commitField(field: ShotEditField, value: string): void {
    const snapshot = this.deps.snapshot();
    if (!snapshot.draft) return;
    this.deps.emit({
      type: 'draft-changed',
      draft: updateShotEditDraftField(snapshot.draft, field, value, snapshot.grinders),
      closeField: true
    });
  }

  applyPhoneField(shotId: string, field: ShotEditField, value: string): void {
    const snapshot = this.deps.snapshot();
    const shot = snapshot.shots.find((item) => item.id === shotId);
    if (!shot) return;
    const draft = snapshot.draft?.shotId === shotId
      ? snapshot.draft
      : shotEditDraftFromShot(shot);
    this.deps.emit({
      type: 'draft-changed',
      draft: updateShotEditDraftField(draft, field, value, snapshot.grinders)
    });
  }

  applyPhoneScore(shotId: string, value: number | null): void {
    const snapshot = this.deps.snapshot();
    const shot = snapshot.shots.find((item) => item.id === shotId);
    if (!shot) return;
    const draft = snapshot.draft?.shotId === shotId
      ? snapshot.draft
      : shotEditDraftFromShot(shot);
    this.deps.emit({ type: 'draft-changed', draft: { ...draft, enjoyment: value } });
  }

  setEnjoyment(value: number | null): void {
    const draft = this.deps.snapshot().draft;
    if (!draft) return;
    this.deps.emit({ type: 'draft-changed', draft: { ...draft, enjoyment: value } });
  }

  setCalculatedEy(value: number): void {
    const draft = this.deps.snapshot().draft;
    if (!draft || !Number.isFinite(value)) return;
    this.deps.emit({ type: 'draft-changed', draft: { ...draft, drinkEy: value } });
  }

  currentEnjoyment(shotId: string): number | null {
    const snapshot = this.deps.snapshot();
    if (snapshot.draft?.shotId === shotId) return snapshot.draft.enjoyment;
    return snapshot.shots.find((shot) => shot.id === shotId)?.annotations?.enjoyment ?? null;
  }

  openBeanDialog(): void {
    if (!this.deps.snapshot().draft) return;
    this.deps.emit({ type: 'bean-dialog', dialog: { creating: false } });
  }

  closeBeanDialog(): void {
    this.deps.emit({ type: 'bean-dialog', dialog: null });
  }

  setBeanCreating(creating: boolean): void {
    const snapshot = this.deps.snapshot();
    if (!snapshot.draft || !snapshot.beanDialog) return;
    this.deps.emit({ type: 'bean-dialog', dialog: { creating } });
  }

  async pickBean(beanId: string): Promise<void> {
    const snapshot = this.deps.snapshot();
    if (!snapshot.draft) return;
    if (!beanId) {
      this.deps.emit({
        type: 'draft-changed',
        draft: {
          ...snapshot.draft,
          coffeeRoaster: null,
          coffeeName: null,
          beanId: null,
          beanBatchId: null
        },
        closeBeanDialog: true
      });
      return;
    }
    const bean = snapshot.beans.find((item) => item.id === beanId);
    if (!bean) return;
    await this.deps.ensureBatchesLoaded(beanId);
    const current = this.deps.snapshot();
    if (!current.draft) return;
    const latest = latestBatch(current.batchesByBean[beanId] ?? []);
    this.deps.emit({
      type: 'draft-changed',
      draft: {
        ...current.draft,
        coffeeRoaster: bean.roaster,
        coffeeName: bean.name,
        beanId: bean.id,
        beanBatchId: latest?.id ?? null
      },
      closeBeanDialog: true
    });
  }

  async createBean(fields: Partial<Bean>): Promise<void> {
    const snapshot = this.deps.snapshot();
    if (snapshot.busy || !snapshot.draft || !fields.roaster || !fields.name) return;
    this.deps.emit({ type: 'bean-saving' });
    const result = await this.deps.saveBean({
      beans: snapshot.beans,
      batchesByBean: snapshot.batchesByBean,
      editingId: null,
      fields,
      demo: snapshot.demo,
      nowMs: Date.now()
    });
    if (result.type === 'failed') {
      this.deps.emit({
        type: 'save-failed',
        status: result.status,
        operation: 'Add bean failed',
        error: result.error
      });
      return;
    }
    const latest = this.deps.snapshot();
    const current = latest.draft;
    const beans = [result.bean, ...latest.beans.filter((bean) => bean.id !== result.bean.id)];
    const batchesByBean = Object.prototype.hasOwnProperty.call(
      latest.batchesByBean,
      result.bean.id
    )
      ? latest.batchesByBean
      : { ...latest.batchesByBean, [result.bean.id]: [] };
    void this.deps.putBeans(beans).catch(() => {});
    this.deps.emit({
      type: 'bean-saved',
      beans,
      batchesByBean,
      draft: current
        ? {
            ...current,
            coffeeRoaster: result.bean.roaster,
            coffeeName: result.bean.name,
            beanId: result.bean.id,
            beanBatchId: null
          }
        : null,
      status: result.status
    });
  }

  async submitEditor(shotId: string | null, numbers: ShotEditorNumberValues): Promise<void> {
    const snapshot = this.deps.snapshot();
    const resolvedId = shotId ?? snapshot.selectedShotId;
    const shot = resolvedId ? snapshot.shots.find((item) => item.id === resolvedId) : null;
    if (!shot) return;
    const baseDraft = snapshot.draft?.shotId === shot.id
      ? snapshot.draft
      : shotEditDraftFromShot(shot);
    const draft = shotEditDraftWithNumbers(baseDraft, numbers);
    await this.persistShotUpdate(
      shot,
      shotUpdateFromDraft(shot, draft, snapshot.grinders, snapshot.beans, snapshot.batchesByBean),
      SHOT_SAVE_LABELS
    );
  }

  async savePhoneDraft(shotId: string): Promise<void> {
    const snapshot = this.deps.snapshot();
    const shot = snapshot.shots.find((item) => item.id === shotId);
    const draft = snapshot.draft?.shotId === shotId ? snapshot.draft : null;
    if (!shot || !draft) return;
    await this.persistShotUpdate(
      shot,
      shotUpdateFromDraft(shot, draft, snapshot.grinders, snapshot.beans, snapshot.batchesByBean),
      SHOT_SAVE_LABELS
    );
  }

  async updateEnjoyment(shotId: string, value: number | null): Promise<void> {
    const shot = this.deps.snapshot().shots.find((item) => item.id === shotId);
    if (!shot) return;
    await this.persistShotUpdate(shot, shotEnjoymentUpdate(shot, value), {
      busyStatus: 'Saving score',
      successStatus: 'Score saved',
      demoStatus: 'Score saved (demo)',
      failureStatus: 'Save score failed'
    });
  }

  async updateAnnotationsExact(
    shotId: string,
    merge: (annotations: ShotAnnotations | null | undefined) => ShotAnnotations
  ): Promise<ShotRecord> {
    this.deps.beginRemoteShotMutation();
    const saved = await this.deps.runExactShotMutation(shotId, async () => {
      const latest = await this.deps.readShot(shotId);
      return this.deps.updateShot(shotId, { annotations: merge(latest.annotations) });
    });
    await this.deps.invalidateShotMutation(saved.id).catch(() => {});
    await this.deps.putShotRecord(saved).catch(() => {});
    return saved;
  }

  private async persistShotUpdate(
    shot: ShotRecord,
    update: ShotUpdate,
    labels: SaveLabels
  ): Promise<void> {
    const demo = this.deps.snapshot().demo;
    this.deps.emit({ type: 'saving', status: labels.busyStatus });
    if (!demo) this.deps.beginRemoteShotMutation();
    const result = await saveShotUpdate({
      shot,
      update,
      demo,
      successStatus: labels.successStatus,
      demoStatus: labels.demoStatus,
      failureStatus: labels.failureStatus
    }, {
      updateShot: (id, nextUpdate) => this.deps.runExactShotMutation(id, async () => {
        if (!nextUpdate.annotations) return this.deps.updateShot(id, nextUpdate);
        const latest = await this.deps.readShot(id);
        return this.deps.updateShot(id, {
          ...nextUpdate,
          annotations: rebaseChangedFields(
            shot.annotations,
            nextUpdate.annotations,
            latest.annotations
          )
        });
      }),
      invalidateShotMutation: (id) => this.deps.invalidateShotMutation(id),
      putShotRecord: (saved) => this.deps.putShotRecord(saved)
    });

    if (result.type === 'saved') {
      this.deps.emit({ type: 'shot-saved', shot: result.shot, status: result.status });
      return;
    }
    this.deps.emit({
      type: 'save-failed',
      status: result.status,
      operation: labels.failureStatus,
      error: result.error
    });
  }
}
