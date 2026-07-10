import type { AppState, ClickActionHandler, ProfileEditTarget } from '../app';
import { gateway } from '../api/gateway';
import type { Profile } from '../api/types';
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
  removeStep,
  selectStep,
  setAdvancedTab,
  setEditorMode,
  setProfileMeta,
  setSimpleProfileType,
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
  saveProfile,
  selectProfileForDraft
} from './profileEditorController';
import { beanieCache } from '../domain/cache';
import type { StepFieldKey } from '../domain/profileModel';

// The profile editor's app glue: the pe-* dispatch table, open/import/submit,
// the tap-to-edit value dialog, and the notes modal commit. The editor's
// domain logic stays in profileEditorController / components/profileEditor;
// ProfileEditorFlowHost below is the full coupling surface into the app.
export interface ProfileEditorFlowHost {
  state(): AppState;
  setState(next: Partial<AppState>): void;
  scheduleApply(): void;
  /** Focus the notes textarea on the render right after the notes modal opens. */
  requestNotesFocus(): void;
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
  constructor(
    private readonly host: ProfileEditorFlowHost,
    private readonly root: HTMLElement
  ) {}

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
      'new-profile': () => {
        this.openNewProfileEditor();
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
      'pe-set-mode': ({ value }) => {
        this.editorDispatch((pe) => setEditorMode(pe, value === 'basic' ? 'basic' : 'advanced'));
      },
      'pe-set-simple-type': ({ value }) => {
        this.editorDispatch((pe) => setSimpleProfileType(pe, value === 'flow' ? 'flow' : 'pressure'));
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
    const pe = this.host.state().profileEditor;
    if (!pe) return;
    this.host.setState({ profileEditor: fn(pe) });
  }

  private openProfileEditor(id: string): void {
    const input = editProfileEditorInput(this.host.state().profiles, id);
    if (input.type === 'missing') return;
    this.openProfileEditorInput(input.editingProfileId, input.profile);
  }

  private openNewProfileEditor(): void {
    const input = newProfileEditorInput();
    if (input.type === 'missing') return;
    this.openProfileEditorInput(input.editingProfileId, input.profile);
  }

  private openImportProfile(): void {
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
    this.host.setState({ profileImport: { code, busy: true, error: null } });
    try {
      const result = await gateway.importProfileFromVisualizer(code);
      await beanieCache.invalidateProfileMutation(result.profileId ?? undefined);
      const profiles = await gateway.profiles();
      await beanieCache.putProfiles(profiles);
      this.host.setState({
        profiles,
        modal: null,
        profileImport: null,
        profileFocusId: result.profileId ?? this.host.state().profileFocusId,
        status: result.profileTitle ? `Imported ${result.profileTitle}` : 'Profile imported'
      });
    } catch (err) {
      this.host.setState({ profileImport: { code, busy: false, error: importErrorMessage(err) } });
    }
  }

  private openProfileEditorInput(editingProfileId: string | null, profile: Profile | null): void {
    this.host.setState({
      view: 'profile-editor',
      editingProfileId,
      profileEditor: createProfileEditorState(profile),
      profileEdit: null
    });
  }

  private validateProfileEditor(pe: ProfileEditorState): string | null {
    if (!pe.title.trim()) return 'Add a preset name before saving';
    if (pe.steps.length === 0) return 'Profile needs at least one step';
    return null;
  }

  async submitProfileEditor(): Promise<void> {
    const pe = this.host.state().profileEditor;
    if (!pe) return;
    const problem = this.validateProfileEditor(pe);
    if (problem) {
      this.host.setState({ status: problem, profileEditor: { ...pe, saveNotice: { tone: 'error', message: problem } } });
      return;
    }
    const profile = profileFromEditorState(pe);
    const editingId = this.host.state().editingProfileId;
    const cloneOfDefault = Boolean(editingId) && this.host.state().profiles.find((item) => item.id === editingId)?.isDefault === true;
    this.host.setState({
      busy: true,
      status: cloneOfDefault ? 'Saving a copy' : 'Saving profile',
      profileEditor: { ...pe, saveNotice: null }
    });

    const result = await saveProfile({
      profiles: this.host.state().profiles,
      editingId,
      profile,
      demo: this.host.state().demo,
      nowMs: Date.now()
    }, {
      createProfile: (input) => gateway.createProfile(input),
      updateProfile: (id, input) => gateway.updateProfile(id, input),
      loadProfiles: () => gateway.profiles(),
      invalidateProfileMutation: (profileId) => beanieCache.invalidateProfileMutation(profileId),
      putProfiles: (profiles) => beanieCache.putProfiles(profiles),
      restoreProfile: (id) => gateway.setProfileVisibility(id, 'visible').then(() => {})
    });

    if (result.type === 'failed') {
      console.error('[Beanie] Save profile failed', result.error);
      const editor = this.host.state().profileEditor;
      this.host.setState({
        busy: false,
        status: result.status,
        profileEditor: editor
          ? { ...editor, saveNotice: { tone: 'error', message: profileSaveErrorMessage(result.error) } }
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
      const notice = {
        tone: 'error' as const,
        message: savedTitle
          ? `These settings already match the existing profile "${savedTitle}". Change a setting to save a separate profile.`
          : 'These settings already match an existing profile. Change a setting to save a separate profile.'
      };
      this.host.setState({
        profiles: result.profiles,
        editingProfileId: result.profileId,
        profileFocusId: result.profileId,
        busy: false,
        status: result.status,
        profileEditor: editor ? { ...editor, dirty: false, saveNotice: notice } : editor
      });
      return;
    }

    // A successful save loads the profile straight away and returns to the
    // workbench: edits to the active profile go live immediately, and a freshly
    // created one is ready to brew without a separate load step.
    const selection = selectProfileForDraft({
      draft: this.host.state().draft,
      profiles: result.profiles,
      grinders: this.host.state().grinders,
      profileId: result.profileId
    });
    this.host.setState({
      profiles: result.profiles,
      draft: selection.draft,
      view: 'workbench',
      profileEditor: null,
      editingProfileId: null,
      profileFocusId: result.profileId,
      profileSearch: '',
      // Loading a profile replaces whatever Derek tweak was staged (matches pickProfile).
      derekTweakChip: null,
      busy: false,
      status: result.status
    });
    this.host.scheduleApply();
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
