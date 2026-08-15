import type { AppModal, ClickActionHandler } from './actionContract';
import { gateway } from '../api/gateway';
import type { Grinder, Profile, ProfileRecord, RecipeDraft } from '../api/types';
import { defaultExitValueForApp } from '../appShell';
import { createInputDialog } from '../components/InputDialog';
import {
  addStep,
  createProfileEditorState,
  duplicateStep,
  moveStep,
  nudgeSimpleProfileField,
  nudgeStepField,
  profileFromEditorState,
  rebaseProfileEditor,
  removeStep,
  selectStep,
  setAdvancedTab,
  setProfileMeta,
  setStepExit,
  setStepField,
  setStepPump,
  setStepTransition,
  type ProfileEditorState,
  type SimpleProfileField
} from '../components/profileEditor';
import {
  editProfileEditorInput,
  newProfileEditorInput,
  restoreOriginalProfile,
  saveProfile,
  selectProfileForDraft,
  supersededOriginalId,
  uniqueProfileTitle
} from './profileEditorController';
import type { ProfileIdentityMove } from '../domain/profileIdentity';
import { beanieCache } from '../domain/cache';
import type { StepFieldKey } from '../domain/profileModel';
import type { NewProfileKind } from '../domain/simpleProfile';
import { OperationEpoch } from './operationEpoch';

export interface ProfileEditTarget {
  target: 'step-field' | 'simple-field' | 'exit' | 'meta' | 'limiter-range';
  key?: string;
  index?: number;
  type?: 'pressure' | 'flow';
  condition?: 'over' | 'under';
}

export interface ProfileImportState {
  code: string;
  busy: boolean;
  error: string | null;
}

export interface ProfileEditorFlowState {
  busy: boolean;
  demo: boolean;
  draft: RecipeDraft;
  editingProfileId: string | null;
  grinders: Grinder[];
  /** Retired profiles, where a superseded built-in lives until it is restored. */
  hiddenProfiles: ProfileRecord[];
  modal: AppModal;
  profileEditor: ProfileEditorState | null;
  profileFocusId: string | null;
  profileImport: ProfileImportState | null;
  profiles: ProfileRecord[];
}

export type ProfileEditorFlowPatch = Partial<ProfileEditorFlowState & {
  derekTweakChip: null;
  editDialog: ReturnType<typeof createInputDialog> | null;
  machineEdit: null;
  profileEdit: ProfileEditTarget | null;
  profileSearch: string;
  status: string;
  view: 'workbench' | 'profile-editor';
}>;

// The profile editor's app glue: the pe-* dispatch table, open/import/submit,
// the tap-to-edit value dialog, and the notes modal commit. The editor's
// domain logic stays in profileEditorController / components/profileEditor;
// ProfileEditorFlowHost below is the full coupling surface into the app.
export interface ProfileEditorFlowHost {
  state(): ProfileEditorFlowState;
  setState(next: ProfileEditorFlowPatch): void;
  scheduleApply(): void;
  /** Focus the notes textarea on the render right after the notes modal opens. */
  requestNotesFocus(): void;
  /**
   * Re-point the markers that name a profile by id — its favourite star — after
   * a save landed the profile on a new id. See domain/profileIdentity.
   */
  carryProfileIdentity(move: ProfileIdentityMove): void;
}

// Turn a gateway failure into a short, user-facing import error. fetchJson
// formats HTTP errors as "POST /path returned 500: <detail>"; the plugin's
// detail is usually a JSON body like {"error":"..."}. Pull out the useful part.
function importErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const http = raw.match(/returned (\d+)(?::\s*([\s\S]*))?$/);
  if (http) {
    const detail = (http[2] ?? '').trim();
    if (!detail) return `Import failed (HTTP ${http[1]})`;
    try {
      const parsed = JSON.parse(detail) as { error?: unknown };
      if (parsed && typeof parsed.error === 'string') return parsed.error;
    } catch {
      // detail isn't JSON — use it verbatim
    }
    return detail;
  }
  return raw.trim() || 'Import failed';
}
// Pull the gateway's own explanation out of a failed save so the editor banner
// can show *why* (e.g. 'Profile must have "tank_temperature"') rather than a
// bare 'POST /api/v1/profiles returned 400'.
function profileSaveErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const detail = raw.match(/returned \d+:\s*([\s\S]+)$/);
  if (detail) return detail[1]!.trim();
  return raw.trim() || 'Save failed';
}

export class ProfileEditorFlow {
  private readonly editorEpoch = new OperationEpoch();
  private readonly importEpoch = new OperationEpoch();
  private activeEditorSave: number | null = null;
  private activeEditorRestore: number | null = null;

  constructor(
    private readonly host: ProfileEditorFlowHost,
    private readonly root: HTMLElement
  ) {}

  dispose(): void {
    this.editorEpoch.invalidate();
    this.importEpoch.invalidate();
    this.activeEditorSave = null;
    this.activeEditorRestore = null;
  }

  profileEditorClickActions(): Record<string, ClickActionHandler> {
    return {
      'pe-edit-value': ({ el }) => {
        this.openProfileValueDialog(el);
      },
      'pe-edit-notes': () => {
        if (this.host.state().profileEditor) {
          this.host.requestNotesFocus();
          this.host.setState({ modal: 'notes-editor' });
        }
      },
      'pe-notes-save': () => {
        this.commitProfileNotes();
      },
      // "New profile" asks what kind first — the one moment a profile's kind is
      // chosen, since nothing afterwards can change it (de1app's New Preset page).
      'new-profile': () => {
        this.host.setState({ modal: 'new-profile-kind' });
      },
      'new-profile-kind': ({ value }) => {
        this.openNewProfileEditor(
          value === 'flow' ? 'flow' : value === 'advanced' ? 'advanced' : 'pressure'
        );
      },
      'open-import-profile': () => {
        this.openImportProfile();
      },
      'import-profile-submit': () => {
        void this.submitImportProfile();
      },
      'edit-profile': ({ id }) => {
        if (id) this.openProfileEditor(id);
      },
      'save-profile': async () => {
        await this.submitProfileEditor();
      },
      'save-profile-copy': async () => {
        await this.submitProfileEditor('copy');
      },
      'pe-restore-original': () => {
        this.openRestoreOriginal();
      },
      'pe-restore-confirm': async () => {
        await this.restoreProfileOriginal();
      },
      'pe-add-step': () => {
        this.editorDispatch(addStep);
      },
      'pe-duplicate-step': ({ index }) => {
        if (index != null) this.editorDispatch((pe) => duplicateStep(pe, Number(index)));
      },
      'pe-remove-step': ({ index }) => {
        if (index != null) this.editorDispatch((pe) => removeStep(pe, Number(index)));
      },
      'pe-move-step': ({ index, value }) => {
        if (index != null) this.editorDispatch((pe) => moveStep(pe, Number(index), value === '1' ? 1 : -1));
      },
      'pe-select-step': ({ index }) => {
        if (index != null) this.editorDispatch((pe) => selectStep(pe, Number(index)));
      },
      'pe-step-pump': ({ index, value }) => {
        if (index != null) this.editorDispatch((pe) => setStepPump(pe, Number(index), value === 'flow' ? 'flow' : 'pressure'));
      },
      'pe-step-transition': ({ index, value }) => {
        if (index != null) this.editorDispatch((pe) => setStepTransition(pe, Number(index), value === 'smooth' ? 'smooth' : 'fast'));
      },
      'pe-step-sensor-toggle': ({ index }) => {
        if (index != null) {
          this.editorDispatch((pe) => {
            const step = pe.steps[Number(index)];
            return setStepField(pe, Number(index), 'sensor', step?.sensor === 'water' ? 'coffee' : 'water');
          });
        }
      },
      'pe-step-transition-toggle': ({ index }) => {
        if (index != null) {
          this.editorDispatch((pe) => {
            const step = pe.steps[Number(index)];
            return setStepTransition(pe, Number(index), step?.transition === 'smooth' ? 'fast' : 'smooth');
          });
        }
      },
      'pe-step-nudge': ({ el, index }) => {
        if (index != null && el.dataset.key) {
          this.editorDispatch((pe) =>
            nudgeStepField(pe, Number(index), el.dataset.key as StepFieldKey, Number(el.dataset.delta ?? '0'))
          );
        }
      },
      'pe-simple-nudge': ({ el }) => {
        if (el.dataset.key) {
          this.editorDispatch((pe) =>
            nudgeSimpleProfileField(pe, el.dataset.key as SimpleProfileField, Number(el.dataset.delta ?? '0'))
          );
        }
      },
      'pe-advanced-tab': ({ value }) => {
        this.editorDispatch((pe) => setAdvancedTab(pe, value === 'limits' ? 'limits' : 'steps'));
      },
      'pe-step-exit-nudge': ({ el, index }) => {
        if (index != null) {
          this.editorDispatch((pe) => {
            const step = pe.steps[Number(index)];
            const type = el.dataset.type === 'flow' ? 'flow' : 'pressure';
            const condition = el.dataset.condition === 'under' ? 'under' : 'over';
            const current = step?.exit?.type === type && step.exit.condition === condition
              ? step.exit.value
              : defaultExitValueForApp(type, condition);
            return setStepExit(pe, Number(index), {
              type,
              condition,
              value: Math.max(0, Number((current + Number(el.dataset.delta ?? '0')).toFixed(1)))
            });
          });
        }
      },
      'pe-step-exit-preset': ({ el, index }) => {
        if (index != null) {
          this.editorDispatch((pe) =>
            setStepExit(pe, Number(index), {
              type: el.dataset.type === 'flow' ? 'flow' : 'pressure',
              condition: el.dataset.condition === 'under' ? 'under' : 'over',
              value: Number(el.dataset.value ?? '0') || 0
            })
          );
        }
      },
      'pe-step-exit-clear': ({ index }) => {
        if (index != null) this.editorDispatch((pe) => setStepExit(pe, Number(index), null));
      },
    };
  }

  private editorDispatch(fn: (pe: ProfileEditorState) => ProfileEditorState): void {
    if (this.host.state().busy) return;
    const pe = this.host.state().profileEditor;
    if (!pe) return;
    this.host.setState({ profileEditor: fn(pe) });
  }

  private openProfileEditor(id: string): void {
    const input = editProfileEditorInput(this.host.state().profiles, id);
    if (input.type === 'missing') return;
    this.openProfileEditorInput(input.editingProfileId, input.profile);
  }

  private openNewProfileEditor(kind: NewProfileKind): void {
    const input = newProfileEditorInput(kind);
    if (input.type !== 'new') return;
    this.openProfileEditorInput(input.editingProfileId, input.profile, input.kind);
  }

  private openImportProfile(): void {
    this.importEpoch.invalidate();
    this.host.setState({ modal: 'import-profile', profileImport: { code: '', busy: false, error: null } });
  }

  // Import a profile from a Visualizer share code via the bundled plugin, then
  // refresh the list and focus the new profile so it shows in the preview pane.
  // Importing does not select it onto the machine — the user presses Select.
  async submitImportProfile(): Promise<void> {
    const current = this.host.state().profileImport;
    if (!current || current.busy) return;
    const input = this.root.querySelector<HTMLInputElement>('[data-action="import-profile-input"]');
    const code = (input?.value ?? '').trim();
    if (!code) {
      this.host.setState({ profileImport: { code: '', busy: false, error: 'Enter a share code.' } });
      return;
    }
    const operation = this.importEpoch.begin();
    this.host.setState({ profileImport: { code, busy: true, error: null } });
    try {
      const result = await gateway.importProfileFromVisualizer(code);
      if (!this.importCurrent(operation, code)) return;
      await beanieCache.invalidateProfileMutation(result.profileId ?? undefined);
      if (!this.importCurrent(operation, code)) return;
      const profiles = await gateway.profiles();
      if (!this.importCurrent(operation, code)) return;
      await beanieCache.putProfiles(profiles);
      if (!this.importCurrent(operation, code)) return;
      this.host.setState({
        profiles,
        modal: null,
        profileImport: null,
        profileFocusId: result.profileId ?? this.host.state().profileFocusId,
        status: result.profileTitle ? `Imported ${result.profileTitle}` : 'Profile imported'
      });
    } catch (err) {
      if (!this.importCurrent(operation, code)) return;
      this.host.setState({ profileImport: { code, busy: false, error: importErrorMessage(err) } });
    }
  }

  private importCurrent(operation: number, code: string): boolean {
    const current = this.host.state().profileImport;
    return (
      this.importEpoch.owns(operation) &&
      this.host.state().modal === 'import-profile' &&
      current?.busy === true &&
      current.code === code
    );
  }

  private openProfileEditorInput(
    editingProfileId: string | null,
    profile: Profile | null,
    newProfileKind?: NewProfileKind
  ): void {
    const canceledEditorSave = this.activeEditorSave != null;
    this.editorEpoch.invalidate();
    this.activeEditorSave = null;
    this.activeEditorRestore = null;
    const base = createProfileEditorState(profile, newProfileKind);
    // Editing one of Decent's keeps its name: the user's version stands where
    // the original stood, so there is nothing to tell it apart from. Only a
    // brand-new profile needs a free name, so two unnamed ones don't collide.
    const profiles = this.host.state().profiles;
    const title = editingProfileId == null ? uniqueProfileTitle(profiles, base.title) : base.title;
    const editor = title === base.title ? base : rebaseProfileEditor({ ...base, title });
    this.host.setState({
      view: 'profile-editor',
      modal: null,
      editingProfileId,
      profileEditor: editor,
      profileEdit: null,
      busy: canceledEditorSave ? false : this.host.state().busy
    });
  }

  private validateProfileEditor(pe: ProfileEditorState): string | null {
    if (!pe.title.trim()) return 'Add a preset name before saving';
    if (pe.steps.length === 0) return 'Profile needs at least one step';
    return null;
  }

  async submitProfileEditor(intent: 'save' | 'copy' = 'save'): Promise<void> {
    const pe = this.host.state().profileEditor;
    if (!pe || this.host.state().busy) return;
    // A stored profile with nothing pending has nothing to write, and a copy of
    // one cannot exist beside it — a profile is known by its settings. Both
    // buttons are disabled for it; this keeps the rule true whatever reaches here.
    if (this.host.state().editingProfileId != null && !pe.dirty) return;
    const problem = this.validateProfileEditor(pe);
    if (problem) {
      this.host.setState({ status: problem, profileEditor: { ...pe, saveError: problem } });
      return;
    }
    const editingId = this.host.state().editingProfileId;
    // A copy keeps the source, so it needs a name of its own — checked against
    // every profile, the source included. The editor reopens on the saved
    // record, so the user sees the name it took.
    const listed = this.host.state().profiles;
    const profile =
      intent === 'copy' && listed.some((item) => (item.profile.title ?? '').trim() === pe.title.trim())
        ? profileFromEditorState({ ...pe, title: uniqueProfileTitle(listed, pe.title) })
        : profileFromEditorState(pe);
    const operation = this.editorEpoch.begin();
    this.activeEditorSave = operation;
    this.host.setState({
      busy: true,
      status: intent === 'copy' ? 'Saving a copy' : 'Saving profile',
      profileEditor: { ...pe, saveError: null }
    });

    const result = await saveProfile({
      profiles: this.host.state().profiles,
      editingId,
      profile,
      demo: this.host.state().demo,
      nowMs: Date.now(),
      intent
    }, {
      createProfile: (input) => gateway.createProfile(input),
      updateProfile: (id, input) => gateway.updateProfile(id, input),
      loadProfiles: () => gateway.profiles(),
      invalidateProfileMutation: (profileId) => beanieCache.invalidateProfileMutation(profileId),
      putProfiles: (profiles) => beanieCache.putProfiles(profiles),
      restoreProfile: (id) => gateway.setProfileVisibility(id, 'visible').then(() => {}),
      hideProfile: (id) => gateway.setProfileVisibility(id, 'hidden').then(() => {})
    });
    if (!this.editorCurrent(operation, editingId)) return;
    this.activeEditorSave = null;

    // Refused before it was sent: these settings already belong to another
    // profile, and reaprime would delete this one on its way to failing.
    if (result.type === 'blocked') {
      const editor = this.host.state().profileEditor;
      this.host.setState({
        busy: false,
        status: result.status,
        profileEditor: editor
          ? { ...editor, saveError: result.message }
          : editor
      });
      return;
    }

    if (result.type === 'failed') {
      console.error('[Beanie] Save profile failed', result.error);
      const editor = this.host.state().profileEditor;
      this.host.setState({
        busy: false,
        status: result.status,
        profileEditor: editor
          ? { ...editor, saveError: profileSaveErrorMessage(result.error) }
          : editor
      });
      return;
    }

    // A `deduped` save created nothing new — the gateway content-hash-dedupes by
    // brew settings (ignoring title), so the settings already match an existing
    // profile. Keep the editor open with the notice rather than implying a fresh
    // profile appeared or loading something the user didn't mean to create.
    if (result.deduped) {
      const editor = this.host.state().profileEditor;
      const savedTitle = result.profiles.find((item) => item.id === result.profileId)?.profile.title;
      const notice = savedTitle
        ? `These settings are identical to “${savedTitle}”. Change something to save this as its own profile.`
        : 'These settings are identical to a profile you already have. Change something to save this as its own profile.';
      this.host.setState({
        profiles: result.profiles,
        editingProfileId: result.profileId,
        profileFocusId: result.profileId,
        busy: false,
        status: result.status,
        profileEditor: editor ? { ...editor, saveError: notice } : editor
      });
      return;
    }

    // The saved profile usually lands on a *new* id — reaprime hashes brew
    // settings, so any change to them re-ids the record (and copying a default
    // creates one outright). Take the markers that name it by id along, or the
    // profile quietly loses its favourite star on the way through Save.
    if (editingId && result.profileId !== editingId) {
      this.host.carryProfileIdentity({
        from: editingId,
        to: result.profileId,
        replaced: !result.profiles.some((item) => item.id === editingId)
      });
    }

    // A successful save loads the profile straight away — edits to the active
    // profile go live immediately, and a freshly created one is ready to brew
    // without a separate load step.
    const selection = selectProfileForDraft({
      draft: this.host.state().draft,
      profiles: result.profiles,
      grinders: this.host.state().grinders,
      profileId: result.profileId
    });
    // The editor stays open on what was actually stored. Rebuilding it from the
    // saved record rather than keeping the draft means the numbers on screen are
    // the ones on the machine, and the header re-reads the saved profile — so a
    // copy of a default stops offering to copy itself again. The step in hand
    // and the open tab are carried across so saving doesn't lose the user's place.
    const editor = this.host.state().profileEditor;
    const saved = result.profiles.find((item) => item.id === result.profileId);
    const reopened = saved ? createProfileEditorState(saved.profile) : editor;
    // A retired original is hidden now, so keep the hidden list honest without
    // a refetch — and give the undo something to read the original back from.
    const retired = result.supersededId
      ? this.host.state().profiles.find((item) => item.id === result.supersededId)
      : null;
    this.host.setState({
      profiles: result.profiles,
      hiddenProfiles: retired
        ? [retired, ...this.host.state().hiddenProfiles.filter((item) => item.id !== retired.id)]
        : this.host.state().hiddenProfiles,
      draft: selection.draft,
      editingProfileId: result.profileId,
      profileFocusId: result.profileId,
      profileSearch: '',
      // Loading a profile replaces whatever Derek tweak was staged (matches pickProfile).
      derekTweakChip: null,
      busy: false,
      status: result.status,
      // No banner for a save that worked: the profile is on screen under its own
      // name with nothing left to save, which the Save button says by itself.
      profileEditor: reopened && editor
        ? {
            ...reopened,
            selectedStep: Math.min(editor.selectedStep, Math.max(0, reopened.steps.length - 1)),
            advancedTab: editor.advancedTab
          }
        : reopened
    });
    this.host.scheduleApply();
  }

  /**
   * Ask before undoing a replacement. It deletes the user's own profile, which
   * is not something to do on one tap of a header button.
   */
  private openRestoreOriginal(): void {
    const state = this.host.state();
    const originalId = supersededOriginalId(state.profiles, state.editingProfileId);
    if (!originalId || !state.profileEditor || state.busy) return;
    this.host.setState({ modal: 'restore-original' });
  }

  /**
   * Undo a replacement: delete the version saved over one of Decent's built-ins
   * and put the built-in back in the list. The editor then opens on the restored
   * original, so what is on screen is what is now installed.
   */
  async restoreProfileOriginal(): Promise<void> {
    const state = this.host.state();
    const editingId = state.editingProfileId;
    const originalId = supersededOriginalId(state.profiles, editingId);
    if (!originalId || !editingId || !state.profileEditor || state.busy) return;

    const operation = this.editorEpoch.begin();
    this.activeEditorRestore = operation;
    this.host.setState({ modal: null, busy: true, status: 'Restoring the original profile' });

    const result = await restoreOriginalProfile(
      { profiles: state.profiles, hiddenProfiles: state.hiddenProfiles, editingId, originalId, demo: state.demo },
      {
        unhideProfile: (id) => gateway.setProfileVisibility(id, 'visible').then(() => {}),
        deleteProfile: (id) => gateway.deleteProfile(id),
        loadProfiles: () => gateway.profiles(),
        invalidateProfileMutation: (id) => beanieCache.invalidateProfileMutation(id),
        putProfiles: (profiles) => beanieCache.putProfiles(profiles)
      }
    );
    if (!this.restoreCurrent(operation, editingId)) return;
    this.activeEditorRestore = null;

    if (result.type === 'failed') {
      if (result.error) console.error('[Beanie] Restore original profile failed', result.error);
      const editor = this.host.state().profileEditor;
      this.host.setState({
        busy: false,
        status: result.status,
        profileEditor: editor
          ? {
              ...editor,
              saveError: 'Couldn’t go back to Decent’s version. Nothing was lost — your profile is as you left it.'
            }
          : editor
      });
      return;
    }

    // The star follows the profile the user is left holding.
    this.host.carryProfileIdentity({ from: editingId, to: originalId, replaced: true });
    const selection = selectProfileForDraft({
      draft: this.host.state().draft,
      profiles: result.profiles,
      grinders: this.host.state().grinders,
      profileId: originalId
    });
    this.host.setState({
      profiles: result.profiles,
      hiddenProfiles: this.host.state().hiddenProfiles.filter((item) => item.id !== originalId),
      draft: selection.draft,
      busy: false,
      editingProfileId: originalId,
      profileFocusId: originalId,
      derekTweakChip: null,
      status: result.status,
      // No banner: the editor reopens on Decent's profile with Restore greyed
      // out, which is the whole of what happened.
      profileEditor: createProfileEditorState(result.original.profile)
    });
    this.host.scheduleApply();
  }

  private restoreCurrent(operation: number, editingId: string | null): boolean {
    return (
      this.editorEpoch.owns(operation) &&
      this.activeEditorRestore === operation &&
      this.host.state().profileEditor != null &&
      this.host.state().editingProfileId === editingId
    );
  }

  private editorCurrent(operation: number, editingId: string | null): boolean {
    return (
      this.editorEpoch.owns(operation) &&
      this.activeEditorSave === operation &&
      this.host.state().busy &&
      this.host.state().profileEditor != null &&
      this.host.state().editingProfileId === editingId
    );
  }

  // Tap a control's value → numpad dialog bound to that editor field.
  openProfileValueDialog(el: HTMLElement): void {
    const target = el.dataset.target;
    if (!target) return;
    const value = el.dataset.value ?? '0';
    const title = el.dataset.title ?? 'Value';
    const unit = el.dataset.unit ?? '';
    const min = Number(el.dataset.min ?? '0');
    const max = Number(el.dataset.max ?? '100');
    const step = Number(el.dataset.step ?? '1');
    const digits = step < 1 ? 1 : 0;

    this.host.setState({
      modal: 'edit-number',
      machineEdit: null,
      profileEdit: {
        target: target as ProfileEditTarget['target'],
        key: el.dataset.key,
        index: el.dataset.index != null ? Number(el.dataset.index) : undefined,
        type: el.dataset.type === 'flow' ? 'flow' : el.dataset.type === 'pressure' ? 'pressure' : undefined,
        condition: el.dataset.condition === 'under' ? 'under' : el.dataset.condition === 'over' ? 'over' : undefined
      },
      editDialog: createInputDialog({
        field: 'temperature',
        kind: 'grind',
        title,
        value,
        unit,
        min,
        max,
        step,
        bigStep: step < 1 ? 1 : Math.max(5, step * 5),
        digits,
        helper: `Between ${min} and ${max}`,
        maxLength: 6,
        recentValues: []
      })
    });
  }

  // The notes modal is an uncontrolled textarea (read at save, like the machine
  // label modal), so its typed text lives only in the DOM until the user saves.
  commitProfileNotes(): void {
    const pe = this.host.state().profileEditor;
    if (!pe) {
      this.host.setState({ modal: null });
      return;
    }
    const input = this.root.querySelector<HTMLTextAreaElement>('[data-action="pe-notes-input"]');
    const notes = input?.value ?? pe.notes;
    this.host.setState({ profileEditor: setProfileMeta(pe, 'notes', notes), modal: null });
  }
}
