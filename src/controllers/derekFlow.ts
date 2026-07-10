import type { AppState, ClickActionHandler } from '../app';
import {
  DerekRequestError,
  DerekStallError,
  DerekUnavailableError,
  probeDerekRelay,
  streamDerekAnswer,
  type DerekEvent,
  type DerekRelayAvailability
} from '../api/derek';
import { gateway } from '../api/gateway';
import { beanieCache } from '../domain/cache';
import { round } from '../appShell';
import {
  beginAsk,
  beginFollowUp,
  canAskDerek,
  downgradeUntweakableSuggestions,
  failAsk,
  finishAsk,
  markUnavailable,
  reduceDerekEvent,
  restoreSavedAnswer,
  selectSuggestion,
  selectedSuggestion,
  startDerek,
  toggleTasteChip,
  visiblePartial,
  partialReachedSuggestions,
  type DerekState
} from './derekController';
import {
  TASTE_CHIPS,
  buildDialInContext,
  composeDialInQuery,
  suggestionTitle,
  type DialInContext,
  type DialInSuggestion
} from '../domain/dialIn';
import {
  annotationsWithAppliedTip,
  annotationsWithDerekAnswer,
  latestDerekAnswer,
  readShotDerek,
  type AppliedDerekTip
} from '../domain/derekShot';
import { renderAnswerMarkdown } from '../domain/answerMarkdown';
import { applyProfileTweak } from '../domain/profileTweaks';
import { clearPendingDerekTweak, writePendingDerekTweak } from '../domain/storage';
import { saveProfile, selectProfileForDraft } from './profileEditorController';
import { saveShotUpdate } from './shotMetadataController';
import { phaseLabel, renderTweakPreview } from '../views/derekView';
import type { DerekStreamViewModel } from '../render/derekStreamIsland';
import type { Profile, ProfileRecord, ShotAnnotations, ShotRecord } from '../api/types';
import { OperationEpoch } from './operationEpoch';

// Derek, the dial-in assistant: modal lifecycle, query composition, the SSE
// ask stream (published to a bounded presentation island), and applying/reverting the
// suggestions. Extracted vertically from app.ts — the host interface below is
// the full coupling surface back into the app.
export interface DerekFlowHost {
  state(): AppState;
  setState(next: Partial<AppState>): void;
  /** Assign state.derek in place without a render (per-token hot path). */
  patchStateDerek(derek: DerekState): void;
  /** Publish one complete frame to the bounded Derek presentation island. */
  patchDerekStream(model: DerekStreamViewModel): void;
  disposed(): boolean;
  brewTempValue(): number | null;
  scheduleApply(): void;
  bumpShotCacheGeneration(): void;
  loadShotRecipe(shotId: string, opts?: { skipDerekTip?: boolean }): void;
  findProfileByTitle(title: string): ProfileRecord | null;
}

export class DerekFlow {
  private abort: AbortController | null = null;
  private readonly askEpoch = new OperationEpoch();
  private readonly applyEpoch = new OperationEpoch();
  /** Once probed, remembered for the session (the gateway rarely changes). */
  private relay: DerekRelayAvailability = 'unknown';
  /** Context snapshot the open Derek modal composes queries from. */
  private context: DialInContext | null = null;

  constructor(private readonly host: DerekFlowHost) {}

  dispose(): void {
    this.abort?.abort();
    this.abort = null;
    this.askEpoch.invalidate();
    this.applyEpoch.invalidate();
  }

  derekClickActions(): Record<string, ClickActionHandler> {
    return {
      'derek-dial-in': ({ id }) => {
        this.openDerek('shot', id ?? this.host.state().detailShotId);
      },
      'derek-open': () => {
        this.openDerek('general', null);
      },
      'derek-taste': ({ id }) => {
        const derek = this.host.state().derek;
        if (derek && id) this.host.setState({ derek: toggleTasteChip(derek, id) });
      },
      'derek-toggle-context': () => {
        const derek = this.host.state().derek;
        if (derek) this.host.setState({ derek: { ...derek, showContext: !derek.showContext } });
      },
      'derek-ask': () => {
        void this.askDerek();
      },
      'derek-cancel': () => {
        this.abort?.abort();
        const derek = this.host.state().derek;
        if (derek) this.host.setState({ derek: { ...derek, step: 'compose' } });
      },
      'derek-back': () => {
        const derek = this.host.state().derek;
        if (derek) this.host.setState({ derek: { ...derek, step: 'compose' } });
      },
      'derek-close': () => {
        this.closeDerek();
      },
      'derek-pick-suggestion': ({ id }) => {
        const index = Number(id);
        const derek = this.host.state().derek;
        if (derek && Number.isInteger(index)) {
          this.host.setState({ derek: selectSuggestion(derek, index) });
        }
      },
      'derek-apply': () => {
        void this.applyDerekSuggestion();
      },
      'derek-follow-up': () => {
        const derek = this.host.state().derek;
        if (derek) this.host.setState({ derek: beginFollowUp(derek) });
      },
      'derek-revert-tweak': () => {
        this.revertDerekTweak();
      }
    };
  }

  derekEnabled(): boolean {
    return !this.host.state().demo && this.relay !== 'missing';
  }

  private openDerek(source: 'shot' | 'general', shotId: string | null): void {
    this.abort?.abort();
    this.abort = null;
    this.askEpoch.invalidate();
    this.applyEpoch.invalidate();
    if (this.host.state().demo) {
      this.host.setState({ status: 'Derek needs a live gateway — not available in demo' });
      return;
    }
    this.context = this.buildDerekContext(source, shotId);
    let derek = startDerek(source, shotId);
    if (this.relay === 'missing') {
      derek = markUnavailable(derek);
    } else if (source === 'shot' && shotId) {
      // Reopen straight onto the answer saved on this shot, if there is one —
      // "Ask again" starts a fresh compose.
      const shot = this.host.state().shots.find((item) => item.id === shotId) ?? null;
      const saved = latestDerekAnswer(shot);
      if (saved) {
        const restored = restoreSavedAnswer(derek, saved, readShotDerek(shot).applied?.summary ?? null);
        derek = downgradeUntweakableSuggestions(restored, this.currentDerekProfile());
      }
    }
    this.host.setState({ modal: 'derek', derek });
    if (this.relay === 'unknown') {
      void probeDerekRelay().then((availability) => {
        this.relay = availability;
        const current = this.host.state().derek;
        if (availability === 'missing' && this.host.state().modal === 'derek' && current) {
          this.host.setState({ derek: markUnavailable(current) });
        }
      });
    }
  }

  private closeDerek(): void {
    this.abort?.abort();
    this.abort = null;
    this.askEpoch.invalidate();
    this.applyEpoch.invalidate();
    this.context = null;
    this.host.setState({ modal: null, derek: null });
  }

  // A shot-sourced ask describes THAT shot (its own recipe and telemetry); a
  // general ask carries the current bean/recipe as background context.
  private buildDerekContext(source: 'shot' | 'general', shotId: string | null): DialInContext {
    const shot = shotId ? (this.host.state().shots.find((item) => item.id === shotId) ?? null) : null;
    const beanId = shot?.workflow?.context?.beanId ?? this.host.state().selectedBeanId;
    const bean = this.host.state().beans.find((item) => item.id === beanId) ?? null;
    const batchId = shot?.workflow?.context?.beanBatchId ?? this.host.state().selectedBatchId;
    const batch = bean
      ? ((this.host.state().batchesByBean[bean.id] ?? []).find((item) => item.id === batchId) ?? null)
      : null;
    const grinderId = shot?.workflow?.context?.grinderId ?? this.host.state().draft.grinderId;
    const grinder = this.host.state().grinders.find((item) => item.id === grinderId) ?? null;
    return buildDialInContext({
      shot,
      bean,
      batch,
      grinder,
      recipe:
        source === 'general'
          ? {
              doseG: this.host.state().draft.dose,
              yieldG: this.host.state().draft.yield,
              temperatureC: this.host.brewTempValue()
            }
          : null,
      profileTitle: source === 'general' ? (this.host.state().draft.profileTitle ?? null) : null
    });
  }

  derekContextChips(): string[] {
    const context = this.context;
    if (!context) return [];
    const chips: string[] = [];
    if (context.bean?.name) {
      chips.push([context.bean.name, context.bean.roastLevel].filter(Boolean).join(' · '));
    }
    if (context.grinder?.model || context.grinder?.setting) {
      chips.push(
        [context.grinder.model, context.grinder.setting ? `@ ${context.grinder.setting}` : null]
          .filter(Boolean)
          .join(' ')
      );
    }
    const recipe = context.recipe;
    if (recipe.doseG != null || recipe.yieldG != null) {
      chips.push(
        `${recipe.doseG ?? '?'}g → ${recipe.yieldG ?? '?'}g${recipe.temperatureC != null ? ` @ ${recipe.temperatureC}°C` : ''}`
      );
    }
    if (context.shot?.durationS != null) {
      chips.push(
        `shot: ${Math.round(context.shot.durationS)}s${context.shot.peakPressureBar != null ? `, ${round(context.shot.peakPressureBar, 1)} bar peak` : ''}`
      );
    }
    if (context.profileTitle) chips.push(context.profileTitle);
    return chips;
  }

  private async askDerek(): Promise<void> {
    const derek = this.host.state().derek;
    if (!derek || !canAskDerek(derek)) return;
    const context = this.context ?? this.buildDerekContext(derek.source, derek.shotId);
    this.context = context;
    const query = composeDialInQuery(context, {
      tasteChipIds: derek.tasteChipIds,
      note: derek.note,
      freeQuestion: derek.question.trim() ? derek.question : null
    });

    const asking = beginAsk(derek, query);
    const seq = asking.askSeq;
    this.abort?.abort();
    const abort = new AbortController();
    this.abort = abort;
    const request = { generation: this.askEpoch.begin(), seq, abort };
    this.host.setState({ derek: asking });
    try {
      const result = await streamDerekAnswer(
        { query },
        { signal: abort.signal, onEvent: (event) => this.handleDerekEvent(request, event) }
      );
      if (!this.derekAskCurrent(request)) return;
      const finished = finishAsk(this.host.state().derek!, result, context);
      const ready = downgradeUntweakableSuggestions(finished, this.currentDerekProfile());
      this.host.setState({ derek: ready });
      // Keep the answer on the shot it was asked about, so it can be reopened
      // later (and synced across devices with the shot itself).
      if (result && ready.source === 'shot' && ready.shotId && ready.displayText) {
        void this.saveDerekAnswerOnShot(ready.shotId, ready, this.derekAskedLabel(derek));
      }
    } catch (error) {
      if (!this.derekAskCurrent(request)) return;
      if (error instanceof DerekUnavailableError) {
        this.relay = 'missing';
        this.host.setState({ derek: markUnavailable(this.host.state().derek!) });
        return;
      }
      // The user closing/cancelling aborts the fetch — that's not a failure.
      if (abort.signal.aborted && !(error instanceof DerekStallError)) return;
      console.warn('[Beanie] Derek ask failed', error);
      const message =
        error instanceof DerekRequestError && error.status === 429
          ? 'Derek is busy — try again in a minute.'
          : error instanceof DerekStallError
            ? 'Derek stopped responding mid-answer.'
            : "Derek isn't reachable right now.";
      this.host.setState({ derek: failAsk(this.host.state().derek!, message) });
    } finally {
      if (this.abort === abort) this.abort = null;
    }
  }

  // One line describing what was asked, for the saved-answer record.
  private derekAskedLabel(state: DerekState): string {
    const question = state.question.trim();
    if (question) return question;
    const labels = state.tasteChipIds
      .map((id) => TASTE_CHIPS.find((chip) => chip.id === id)?.label)
      .filter((label): label is string => Boolean(label));
    return [labels.join(', '), state.note.trim()].filter(Boolean).join(' · ') || 'Take a look at this shot';
  }

  private async saveDerekAnswerOnShot(
    shotId: string,
    derek: DerekState,
    asked: string
  ): Promise<void> {
    const shot = this.host.state().shots.find((item) => item.id === shotId);
    if (!shot || !derek.displayText) return;
    await this.persistShotDerekQuietly(
      shot,
      annotationsWithDerekAnswer(shot.annotations, {
        at: new Date().toISOString(),
        asked,
        answer: derek.displayText,
        suggestions: derek.suggestions
      }),
      'Save Derek answer failed'
    );
  }

  // Update a shot's Derek annotations without the modal-closing/busy side
  // effects of the interactive shot-save path — this runs behind the modal.
  private async persistShotDerekQuietly(
    shot: ShotRecord,
    annotations: ShotAnnotations,
    failureStatus: string
  ): Promise<void> {
    if (this.host.state().demo) return;
    this.host.bumpShotCacheGeneration();
    const result = await saveShotUpdate(
      {
        shot,
        update: { annotations },
        demo: false,
        successStatus: this.host.state().status,
        demoStatus: this.host.state().status,
        failureStatus
      },
      {
        updateShot: (id, update) => gateway.updateShot(id, update),
        invalidateShotMutation: (id) => beanieCache.invalidateShotMutation(id),
        putShotRecord: (saved) => beanieCache.putShotRecord(saved)
      }
    );
    if (result.type === 'saved') {
      this.host.setState({
        shots: this.host.state().shots.map((item) => (item.id === result.shot.id ? result.shot : item))
      });
    } else {
      console.warn('[Beanie]', failureStatus, result.error);
    }
  }

  private derekAskCurrent(request: DerekAskRequest): boolean {
    const derek = this.host.state().derek;
    return (
      !this.host.disposed() &&
      this.askEpoch.owns(request.generation) &&
      this.abort === request.abort &&
      this.host.state().modal === 'derek' &&
      derek?.askSeq === request.seq &&
      derek.step === 'asking'
    );
  }

  private handleDerekEvent(request: DerekAskRequest, event: DerekEvent): void {
    if (!this.derekAskCurrent(request)) return;
    const derek = this.host.state().derek!;
    if (event.type === 'delta') {
      // Hot path: fold the source frame into memory, then publish a complete
      // presentation frame. The controller never retains or mutates DOM nodes.
      const next = reduceDerekEvent(derek, event);
      this.host.patchStateDerek(next);
      this.host.patchDerekStream(derekStreamViewModel(next, request.generation));
      return;
    }
    if (event.type === 'result') return; // askDerek() folds the result in.
    const next = reduceDerekEvent(derek, event);
    if (event.type === 'error') {
      this.host.setState({ derek: next });
      return;
    }
    // Queue and evidence phases affect only the opaque stream island. Keep the
    // same bounded path as tokens instead of asking morphdom to update it.
    this.host.patchStateDerek(next);
    this.host.patchDerekStream(derekStreamViewModel(next, request.generation));
  }

  private async applyDerekSuggestion(): Promise<void> {
    const derek = this.host.state().derek;
    if (!derek || derek.applying) return;
    const suggestion = selectedSuggestion(derek);
    if (!suggestion) return;
    const operation = this.applyEpoch.begin();
    const source = derek.source;
    const sourceShotId = derek.shotId;
    const beanId = this.host.state().selectedBeanId;
    const revertProfileId = this.host.state().draft.profileId ?? null;
    this.host.setState({ derek: { ...derek, applying: true } });
    try {
      const applied = await this.performDerekApply(
        suggestion,
        () => this.derekApplyCurrent(operation),
        revertProfileId
      );
      if (!applied || !this.derekApplyCurrent(operation)) return;
      const derekState = this.host.state().derek;
      if (!derekState) return;
      // Remember the change so the shot pulled with it gets stamped — the next
      // ask then opens with "this shot was pulled after making this change".
      if (beanId) {
        writePendingDerekTweak({ beanId, summary: applied.summary, at: new Date().toISOString() });
      }
      this.host.setState({
        derek: { ...derekState, applying: false, appliedSummary: applied.summary },
        derekTweakChip: {
          summary: applied.summary,
          parameter: suggestion.parameter,
          revertProfileId: applied.revertProfileId ?? null,
          revertShotId: sourceShotId
        },
        status: `Next shot: ${applied.summary}`
      });
      this.host.scheduleApply();
      // Record the chosen tip on the shot it came from: loading that shot's
      // recipe later re-applies it.
      if (source === 'shot' && sourceShotId && suggestion.target != null) {
        const shot = this.host.state().shots.find((item) => item.id === sourceShotId);
        if (shot) {
          const tip: AppliedDerekTip = {
            parameter: suggestion.parameter,
            target: suggestion.target,
            unit: suggestion.unit,
            summary: applied.summary,
            at: new Date().toISOString(),
            ...(applied.appliedProfileId ? { profileId: applied.appliedProfileId } : {}),
            ...(applied.appliedProfileTitle ? { profileTitle: applied.appliedProfileTitle } : {})
          };
          void this.persistShotDerekQuietly(
            shot,
            annotationsWithAppliedTip(shot.annotations, tip),
            'Save Derek tip failed'
          );
        }
      }
    } catch (error) {
      if (!this.derekApplyCurrent(operation)) return;
      console.error('[Beanie] Apply Derek suggestion failed', error);
      const failed = this.host.state().derek;
      if (failed) {
        this.host.setState({
          derek: { ...failed, applying: false },
          status: error instanceof Error ? error.message : 'Could not apply the change'
        });
      }
    }
  }

  private derekApplyCurrent(operation: number): boolean {
    return (
      !this.host.disposed() &&
      this.applyEpoch.owns(operation) &&
      this.host.state().modal === 'derek' &&
      this.host.state().derek?.applying === true
    );
  }

  private async performDerekApply(
    suggestion: DialInSuggestion,
    isCurrent: () => boolean,
    revertProfileId: string | null
  ): Promise<{
    summary: string;
    revertProfileId?: string | null;
    appliedProfileId?: string | null;
    appliedProfileTitle?: string | null;
  } | null> {
    const { parameter, target } = suggestion;
    if (parameter === 'grind' && target != null) {
      this.host.setState({ draft: { ...this.host.state().draft, grinderSetting: String(target) } });
      return { summary: suggestionTitle(suggestion) };
    }
    if (parameter === 'dose' || parameter === 'yield' || parameter === 'brew_temperature') {
      const value = typeof target === 'number' ? target : Number(target);
      if (!Number.isFinite(value)) throw new Error('The suggested value is not a number');
      const patch =
        parameter === 'dose'
          ? { dose: value }
          : parameter === 'yield'
            ? { yield: value }
            : { brewTemp: value };
      this.host.setState({ draft: { ...this.host.state().draft, ...patch } });
      return { summary: suggestionTitle(suggestion) };
    }
    if (parameter === 'profile') {
      const record = this.host.findProfileByTitle(String(target ?? ''));
      if (!record) throw new Error(`"${String(target)}" isn't in your profile library`);
      const selection = selectProfileForDraft({
        draft: this.host.state().draft,
        profiles: this.host.state().profiles,
        grinders: this.host.state().grinders,
        profileId: record.id
      });
      this.host.setState({ draft: selection.draft });
      return {
        summary: `Profile → ${record.profile.title ?? 'profile'}`,
        appliedProfileId: record.id,
        appliedProfileTitle: record.profile.title ?? null
      };
    }

    // Profile-level knob: build the tweaked variant and point the recipe at it.
    const profile = this.currentDerekProfile();
    if (!profile) throw new Error('No profile loaded to tweak');
    const tweak = applyProfileTweak(profile, suggestion);
    if (!tweak) throw new Error("This profile can't take that change automatically");

    const saved = await saveProfile(
      {
        profiles: this.host.state().profiles,
        editingId: null,
        profile: tweak.profile,
        demo: this.host.state().demo,
        nowMs: Date.now()
      },
      {
        createProfile: (input) => gateway.createProfile(input),
        updateProfile: (id, input) => gateway.updateProfile(id, input),
        loadProfiles: () => gateway.profiles(),
        invalidateProfileMutation: (profileId) => beanieCache.invalidateProfileMutation(profileId),
        putProfiles: (profiles) => beanieCache.putProfiles(profiles),
        restoreProfile: (id) => gateway.setProfileVisibility(id, 'visible').then(() => {})
      }
    );
    if (!isCurrent()) return null;
    if (saved.type === 'failed') throw new Error('Saving the tweaked profile failed');
    const selection = selectProfileForDraft({
      draft: this.host.state().draft,
      profiles: saved.profiles,
      grinders: this.host.state().grinders,
      profileId: saved.profileId
    });
    this.host.setState({ profiles: saved.profiles, draft: selection.draft });
    return {
      summary: tweak.summary,
      revertProfileId,
      appliedProfileId: saved.profileId,
      appliedProfileTitle:
        saved.profiles.find((item) => item.id === saved.profileId)?.profile.title ??
        tweak.profile.title ??
        null
    };
  }

  private revertDerekTweak(): void {
    const chip = this.host.state().derekTweakChip;
    if (!chip) return;
    clearPendingDerekTweak();
    if (chip.revertProfileId) {
      const selection = selectProfileForDraft({
        draft: this.host.state().draft,
        profiles: this.host.state().profiles,
        grinders: this.host.state().grinders,
        profileId: chip.revertProfileId
      });
      this.host.setState({
        draft: selection.draft,
        derekTweakChip: null,
        status: 'Back to the original profile'
      });
      this.host.scheduleApply();
      return;
    }
    if (chip.revertShotId) {
      // Recipe-level tip: reload the source shot's recipe as it really was.
      this.host.loadShotRecipe(chip.revertShotId, { skipDerekTip: true });
      this.host.setState({ derekTweakChip: null, status: 'Back to the shot recipe' });
      return;
    }
    this.host.setState({ derekTweakChip: null, status: 'Derek change unpinned' });
  }

  private currentDerekProfile(): Profile | null {
    return this.host.state().draft.profile ?? this.host.state().workflow?.profile ?? null;
  }

  derekTweakPreviews(derek: DerekState): Array<string | null> {
    if (derek.step !== 'done' || derek.suggestions.length === 0) return [];
    const profile = this.currentDerekProfile();
    if (!profile) return [];
    return derek.suggestions.map((suggestion) => {
      if (suggestion.kind !== 'profile') return null;
      const tweak = applyProfileTweak(profile, suggestion);
      return tweak ? renderTweakPreview(profile, tweak.profile) : null;
    });
  }
}

interface DerekAskRequest {
  generation: number;
  seq: number;
  abort: AbortController;
}

function derekStreamViewModel(state: DerekState, sessionId: number): DerekStreamViewModel {
  const showShimmer = partialReachedSuggestions(state);
  return {
    sessionId,
    // renderAnswerMarkdown escapes model output and is the sole sanitizer for
    // the island's intentional innerHTML sink.
    answerHtml: renderAnswerMarkdown(visiblePartial(state)),
    phase: showShimmer ? 'Preparing suggestions…' : phaseLabel(state),
    showShimmer
  };
}
