import { escapeAttr, escapeHtml } from '../components/html';
import { icon } from '../components/icons';
import { renderAnswerMarkdown } from '../domain/answerMarkdown';
import { TASTE_CHIPS, suggestionTitle, type DialInSuggestion } from '../domain/dialIn';
import {
  canAskDerek,
  knownCitationNumbers,
  partialReachedSuggestions,
  visiblePartial,
  type DerekState
} from '../controllers/derekController';

export interface DerekViewModel {
  state: DerekState;
  /** Short context facts shown as chips: bean, grinder, recipe, shot. */
  contextChips: string[];
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
      return renderAnswer(state);
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

function renderAnswer(state: DerekState): string {
  const known = knownCitationNumbers(state.citations);
  return `
    <div class="derek-answer-wrap">
      ${state.interrupted ? '<p class="derek-interrupted">The answer was interrupted — this is what arrived.</p>' : ''}
      <div class="derek-answer">${renderAnswerMarkdown(state.displayText ?? '', known.size > 0 ? known : undefined)}</div>
      ${renderSuggestions(state)}
      ${renderCitations(state)}
    </div>
    <div class="modal-actions derek-actions">
      <button class="secondary-button" data-action="derek-follow-up">Ask a follow-up</button>
      ${renderApplyButton(state)}
    </div>
  `;
}

function renderSuggestions(state: DerekState): string {
  if (state.suggestions.length === 0) return '';
  const cards = state.suggestions
    .map((suggestion, index) => renderSuggestionCard(suggestion, index, state))
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
  state: DerekState
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
      </span>
    </div>
  `;
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

function renderCitations(state: DerekState): string {
  if (state.citations.length === 0) return '';
  const items = state.citations
    .map((citation, index) => {
      const number = citation.sourceNumbers[0] ?? index + 1;
      const meta = [citation.sourceType, citation.date].filter(Boolean).join(' · ');
      return `
        <a class="derek-citation" href="${escapeAttr(citation.url)}" target="_blank" rel="noopener noreferrer">
          <span class="derek-citation-number">[${number}]</span>
          <span class="derek-citation-body">
            <strong>${escapeHtml(citation.sectionTitle || citation.url)}</strong>
            ${meta ? `<small>${escapeHtml(meta)}</small>` : ''}
          </span>
        </a>
      `;
    })
    .join('');
  return `
    <div class="derek-citations">
      <p class="derek-citations-head">Sources</p>
      ${items}
    </div>
  `;
}
