import type { Profile } from '../api/types';
import { escapeAttr, escapeHtml } from '../components/html';
import { icon } from '../components/icons';
import { profileStepTargets, type ProfileStepTarget } from '../components/profilePreview';
import { renderAnswerMarkdown } from '../domain/answerMarkdown';
import { TASTE_CHIPS, suggestionTitle, type DialInSuggestion } from '../domain/dialIn';
import {
  canAskDerek,
  partialReachedSuggestions,
  visiblePartial,
  type DerekState
} from '../controllers/derekController';

export interface DerekViewModel {
  state: DerekState;
  /** Short context facts shown as chips: bean, grinder, recipe, shot. */
  contextChips: string[];
  /** Per-suggestion before/after SVG (profile-tweak cards only), by index. */
  tweakPreviews?: ReadonlyArray<string | null>;
}

export function renderDerekModal(model: DerekViewModel): string {
  const { state } = model;
  return `
    <div class="modal-backdrop derek-backdrop">
      <section class="modal panel derek-modal" role="dialog" aria-modal="true" aria-labelledby="derek-title">
        <div class="modal-head derek-head">
          <h2 id="derek-title">${icon('sparkles')} ${state.source === 'shot' ? 'Dial in with Derek' : 'Ask Derek'}</h2>
          <button class="icon-button" data-action="derek-close" aria-label="Close">${icon('x')}</button>
        </div>
        <div class="derek-body">
          ${renderBody(model)}
        </div>
      </section>
    </div>
  `;
}

function renderBody(model: DerekViewModel): string {
  const { state } = model;
  switch (state.step) {
    case 'unavailable':
      return `
        <div class="derek-empty">
          <p>Derek needs a newer Decent.app: this gateway doesn't have the assistant relay yet.</p>
          <p class="derek-fineprint">Update Decent.app on the tablet, then try again.</p>
        </div>
      `;
    case 'compose':
      return renderCompose(model);
    case 'asking':
      return renderAsking(state);
    case 'failed':
      return `
        <div class="derek-empty">
          <p>${escapeHtml(state.error ?? "Derek isn't reachable right now.")}</p>
          <div class="modal-actions derek-actions">
            <button class="secondary-button" data-action="derek-back">Back</button>
            <button class="primary-button" data-action="derek-ask">Retry</button>
          </div>
        </div>
      `;
    case 'done':
      return renderAnswer(state, model.tweakPreviews);
  }
}

function renderCompose(model: DerekViewModel): string {
  const { state } = model;
  const chips = model.contextChips
    .map((chip) => `<span class="derek-context-chip">${escapeHtml(chip)}</span>`)
    .join('');
  const taste =
    state.source === 'shot'
      ? `
        <p class="derek-prompt">What was wrong with it?</p>
        <div class="derek-taste-chips">
          ${TASTE_CHIPS.map(
            (chip) => `
              <button
                class="derek-taste-chip ${state.tasteChipIds.includes(chip.id) ? 'active' : ''}"
                data-action="derek-taste"
                data-id="${escapeAttr(chip.id)}"
                aria-pressed="${state.tasteChipIds.includes(chip.id)}"
              >${escapeHtml(chip.label)}</button>
            `
          ).join('')}
        </div>
        <input
          class="derek-note"
          data-action="derek-note"
          placeholder="Anything else? (optional)"
          value="${escapeAttr(state.note)}"
          autocomplete="off"
        />
      `
      : `
        <textarea
          class="derek-question"
          data-action="derek-question"
          placeholder="Ask anything about espresso, profiles, or your machine…"
          rows="3"
        >${escapeHtml(state.question)}</textarea>
      `;

  return `
    ${chips ? `<div class="derek-context-chips">${chips}</div>` : ''}
    ${taste}
    ${state.contextText || state.source === 'shot' ? renderContextDisclosure(state) : ''}
    <div class="modal-actions derek-actions">
      <button class="secondary-button" data-action="derek-close">Cancel</button>
      <button class="primary-button derek-ask-button" data-action="derek-ask" ${canAskDerek(state) ? '' : 'disabled'}>
        ${icon('sparkles')} Ask Derek
      </button>
    </div>
    <p class="derek-fineprint">Answers come from Derek, Decent's assistant, using the community knowledge base. Your bean, recipe, and this shot's curve are included so the advice fits.</p>
  `;
}

function renderContextDisclosure(state: DerekState): string {
  if (!state.showContext) {
    return `<button class="derek-context-toggle" data-action="derek-toggle-context">${icon('eye')} What Derek is told</button>`;
  }
  return `
    <button class="derek-context-toggle" data-action="derek-toggle-context">${icon('eye-off')} Hide</button>
    <pre class="derek-context-preview">${escapeHtml(state.contextText ?? '(composed when you ask)')}</pre>
  `;
}

function renderAsking(state: DerekState): string {
  const partial = visiblePartial(state);
  return `
    <div class="derek-stream">
      <p class="derek-phase" id="derek-phase">${escapeHtml(phaseLabel(state))}</p>
      <div class="derek-answer" id="derek-answer-stream">${renderAnswerMarkdown(partial)}</div>
      ${partialReachedSuggestions(state) ? shimmer() : ''}
    </div>
    <div class="modal-actions derek-actions">
      <button class="secondary-button" data-action="derek-cancel">Cancel</button>
    </div>
  `;
}

function shimmer(): string {
  return '<p class="derek-shimmer">Preparing suggestions…</p>';
}

export function phaseLabel(state: DerekState): string {
  if (state.queuePosition != null && state.queuePosition > 0) {
    return `In line behind ${state.queuePosition} other question${state.queuePosition === 1 ? '' : 's'}…`;
  }
  switch (state.phase) {
    case 'searching_database':
      return 'Searching the knowledge base…';
    case 'evidence_found':
      return state.hitCount != null ? `Found ${state.hitCount} sources` : 'Found sources';
    case 'answering':
      return 'Answering…';
    default:
      return 'Asking Derek…';
  }
}

function renderAnswer(state: DerekState, previews?: ReadonlyArray<string | null>): string {
  return `
    <div class="derek-answer-wrap">
      ${state.savedAt ? `<p class="derek-saved-note">${icon('history')} Saved answer · ${escapeHtml(savedAtLabel(state.savedAt))}</p>` : ''}
      ${state.interrupted ? '<p class="derek-interrupted">The answer was interrupted — this is what arrived.</p>' : ''}
      <div class="derek-answer">${renderAnswerMarkdown(state.displayText ?? '')}</div>
      ${renderSuggestions(state, previews)}
    </div>
    <div class="modal-actions derek-actions">
      <button class="secondary-button" data-action="derek-follow-up">${state.savedAt ? 'Ask again' : 'Ask a follow-up'}</button>
      ${renderApplyButton(state)}
    </div>
  `;
}

function savedAtLabel(at: string): string {
  const time = Date.parse(at);
  if (!Number.isFinite(time)) return '';
  return new Date(time).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function renderSuggestions(state: DerekState, previews?: ReadonlyArray<string | null>): string {
  if (state.suggestions.length === 0) return '';
  const cards = state.suggestions
    .map((suggestion, index) => renderSuggestionCard(suggestion, index, state, previews?.[index] ?? null))
    .join('');
  return `
    <div class="derek-suggestions">
      <p class="derek-suggestions-head">Try one change — pick which:</p>
      ${cards}
    </div>
  `;
}

function renderSuggestionCard(
  suggestion: DialInSuggestion,
  index: number,
  state: DerekState,
  preview: string | null
): string {
  const manual = suggestion.kind === 'manual';
  const selected = state.selectedSuggestion === index;
  return `
    <div
      class="derek-suggestion ${manual ? 'manual' : 'selectable'} ${selected ? 'selected' : ''}"
      ${manual ? '' : `data-action="derek-pick-suggestion" data-id="${index}" role="radio" aria-checked="${selected}"`}
    >
      <span class="derek-suggestion-radio">${manual ? '' : selected ? icon('circle-check') : '<span class="derek-radio-dot"></span>'}</span>
      <span class="derek-suggestion-body">
        <strong>${escapeHtml(suggestionTitle(suggestion))}${index === 0 ? ' <em class="derek-first">try first</em>' : ''}</strong>
        <small>${escapeHtml(suggestion.why)}</small>
        ${manual ? '<small class="derek-manual-tag">advice only — apply by hand</small>' : ''}
        ${suggestion.kind === 'profile' ? '<small class="derek-variant-tag">creates a tweaked copy of the profile</small>' : ''}
        ${preview ?? ''}
      </span>
    </div>
  `;
}

/**
 * Compact before/after sparkline for a profile tweak: the original's primary
 * trace faded and dashed under the tweaked one, both on a shared time/value
 * scale so a longer preinfusion or a lower peak is visible at a glance.
 * Returns '' when the traces don't visibly differ (e.g. a limiter-only tweak
 * that the step targets don't plot).
 */
export function renderTweakPreview(original: Profile, tweaked: Profile): string {
  const before = profileStepTargets(original);
  const after = profileStepTargets(tweaked);
  if (before.length === 0 || after.length === 0) return '';
  const usePressure =
    before.some((t) => t.pressure != null) || after.some((t) => t.pressure != null);
  const pick = (t: ProfileStepTarget) => (usePressure ? t.pressure : t.flow) ?? 0;
  const totalSeconds = Math.max(sumSeconds(before), sumSeconds(after), 1);
  const yMax = Math.max(...before.map(pick), ...after.map(pick), 1) * 1.15;

  const width = 220;
  const height = 52;
  const pad = 3;
  const path = (targets: ProfileStepTarget[]): string => {
    let elapsed = 0;
    let d = '';
    let previous: number | null = null;
    for (const target of targets) {
      const value = pick(target);
      const x0 = pad + (elapsed / totalSeconds) * (width - 2 * pad);
      elapsed += target.seconds;
      const x1 = pad + (elapsed / totalSeconds) * (width - 2 * pad);
      const y = height - pad - (Math.max(0, value) / yMax) * (height - 2 * pad);
      if (!d) d = `M${x0.toFixed(1)} ${y.toFixed(1)}`;
      else if (target.transition === 'fast' && previous !== value) d += `L${x0.toFixed(1)} ${y.toFixed(1)}`;
      d += `L${x1.toFixed(1)} ${y.toFixed(1)}`;
      previous = value;
    }
    return d;
  };

  const beforePath = path(before);
  const afterPath = path(after);
  if (beforePath === afterPath) return '';
  return `
    <svg class="derek-tweak-preview" viewBox="0 0 ${width} ${height}" role="img" aria-label="Profile before and after the tweak">
      <path class="derek-tweak-before" d="${beforePath}" fill="none" />
      <path class="derek-tweak-after" d="${afterPath}" fill="none" />
    </svg>
  `;
}

function sumSeconds(targets: ProfileStepTarget[]): number {
  return targets.reduce((sum, target) => sum + target.seconds, 0);
}

function renderApplyButton(state: DerekState): string {
  if (state.appliedSummary) {
    return `<span class="derek-applied">${icon('circle-check')} ${escapeHtml(state.appliedSummary)}</span>`;
  }
  const hasSelectable = state.suggestions.some((item) => item.kind !== 'manual');
  if (!hasSelectable) return '';
  const disabled = state.selectedSuggestion == null || state.applying;
  return `
    <button class="primary-button derek-apply-button" data-action="derek-apply" ${disabled ? 'disabled' : ''}>
      ${state.applying ? 'Applying…' : 'Use for next shot'}
    </button>
  `;
}

