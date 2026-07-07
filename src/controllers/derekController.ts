import type { DerekCitation, DerekEvent, DerekResult } from '../api/derek';
import {
  extractDialInSuggestions,
  jsonFenceCutoff,
  type DialInContext,
  type DialInSuggestion
} from '../domain/dialIn';

// Pure state machine for the Derek dial-in modal. The app owns the streaming
// side effects; every transition here is a plain function so the whole flow is
// testable without a network.

export type DerekStep = 'compose' | 'asking' | 'done' | 'failed' | 'unavailable';

export interface DerekState {
  /** 'shot' opens from a shot with taste chips; 'general' is a free question. */
  source: 'shot' | 'general';
  shotId: string | null;
  step: DerekStep;
  tasteChipIds: string[];
  note: string;
  /** Free question (general source and follow-ups). */
  question: string;
  /** "What Derek is told" disclosure. */
  showContext: boolean;
  /** Composed query preview for the disclosure; set when asking starts. */
  contextText: string | null;
  /** Guards stale stream callbacks after a retry/cancel. */
  askSeq: number;
  phase: string | null;
  hitCount: number | null;
  queuePosition: number | null;
  /** Accumulated delta text while streaming. */
  partialText: string;
  /** Final prose (fenced JSON stripped). */
  displayText: string | null;
  citations: DerekCitation[];
  suggestions: DialInSuggestion[];
  selectedSuggestion: number | null;
  applying: boolean;
  appliedSummary: string | null;
  error: string | null;
  /** Stream ended without a result — partial text is shown as interrupted. */
  interrupted: boolean;
}

export function startDerek(source: 'shot' | 'general', shotId: string | null): DerekState {
  return {
    source,
    shotId,
    step: 'compose',
    tasteChipIds: [],
    note: '',
    question: '',
    showContext: false,
    contextText: null,
    askSeq: 0,
    phase: null,
    hitCount: null,
    queuePosition: null,
    partialText: '',
    displayText: null,
    citations: [],
    suggestions: [],
    selectedSuggestion: null,
    applying: false,
    appliedSummary: null,
    error: null,
    interrupted: false
  };
}

export function toggleTasteChip(state: DerekState, chipId: string): DerekState {
  const active = state.tasteChipIds.includes(chipId);
  return {
    ...state,
    tasteChipIds: active
      ? state.tasteChipIds.filter((id) => id !== chipId)
      : [...state.tasteChipIds, chipId]
  };
}

export function canAskDerek(state: DerekState): boolean {
  if (state.step === 'asking' || state.applying) return false;
  if (state.source === 'general') return state.question.trim().length > 0;
  return state.tasteChipIds.length > 0 || state.note.trim().length > 0 || state.question.trim().length > 0;
}

/** Move into the asking state, clearing any previous answer. */
export function beginAsk(state: DerekState, contextText: string): DerekState {
  return {
    ...state,
    step: 'asking',
    contextText,
    askSeq: state.askSeq + 1,
    phase: null,
    hitCount: null,
    queuePosition: null,
    partialText: '',
    displayText: null,
    citations: [],
    suggestions: [],
    selectedSuggestion: null,
    applying: false,
    appliedSummary: null,
    error: null,
    interrupted: false
  };
}

/**
 * Fold a stream event in. Deltas mutate nothing but the text; the caller may
 * choose to patch the DOM directly for them instead of re-rendering.
 */
export function reduceDerekEvent(state: DerekState, event: DerekEvent): DerekState {
  if (state.step !== 'asking') return state;
  switch (event.type) {
    case 'queue':
      return { ...state, queuePosition: event.queued ? event.position : null };
    case 'phase':
      return { ...state, phase: event.phase, hitCount: event.hitCount ?? state.hitCount, queuePosition: null };
    case 'delta':
      return { ...state, partialText: state.partialText + event.text };
    case 'error':
      return failAsk(state, event.message);
    case 'result':
      // finishAsk handles the result (it needs the dial-in context).
      return state;
  }
}

export function finishAsk(
  state: DerekState,
  result: DerekResult | null,
  context: DialInContext
): DerekState {
  if (!result) {
    // Stream ended cleanly but without a result: keep whatever streamed in.
    return {
      ...state,
      step: state.partialText ? 'done' : 'failed',
      displayText: cutPartial(state.partialText) || null,
      interrupted: true,
      error: state.partialText ? null : 'Derek stopped before answering. Try again.'
    };
  }
  const { suggestions, displayText } = extractDialInSuggestions(result.answerText, context);
  const firstApplicable = suggestions.findIndex((item) => item.kind !== 'manual');
  return {
    ...state,
    step: 'done',
    displayText,
    citations: result.citations,
    suggestions,
    selectedSuggestion: firstApplicable === -1 ? null : firstApplicable,
    interrupted: false,
    error: null
  };
}

export function failAsk(state: DerekState, message: string): DerekState {
  return { ...state, step: 'failed', error: message, applying: false };
}

export function markUnavailable(state: DerekState): DerekState {
  return { ...state, step: 'unavailable', error: null };
}

/** Radio semantics: one suggestion at a time; manual cards can't be selected. */
export function selectSuggestion(state: DerekState, index: number): DerekState {
  const suggestion = state.suggestions[index];
  if (!suggestion || suggestion.kind === 'manual' || state.applying) return state;
  return { ...state, selectedSuggestion: index };
}

export function selectedSuggestion(state: DerekState): DialInSuggestion | null {
  return state.selectedSuggestion == null
    ? null
    : (state.suggestions[state.selectedSuggestion] ?? null);
}

/** Prepare a follow-up: back to compose with the answer kept out of the way. */
export function beginFollowUp(state: DerekState): DerekState {
  return { ...state, step: 'compose', question: '', appliedSummary: null };
}

/** The streamed text safe to render: cut before any (partial) JSON fence. */
export function visiblePartial(state: DerekState): string {
  return cutPartial(state.partialText);
}

/** True when the stream has reached the suggestions block. */
export function partialReachedSuggestions(state: DerekState): boolean {
  return state.partialText.length > 0 && jsonFenceCutoff(state.partialText) != null;
}

function cutPartial(text: string): string {
  const cutoff = jsonFenceCutoff(text);
  return (cutoff == null ? text : text.slice(0, cutoff)).trimEnd();
}

/** The citation numbers the final answer actually maps — for marker filtering. */
export function knownCitationNumbers(citations: readonly DerekCitation[]): Set<number> {
  const numbers = new Set<number>();
  for (const citation of citations) {
    for (const value of citation.sourceNumbers) numbers.add(value);
  }
  return numbers;
}
