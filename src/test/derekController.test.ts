import type { DerekResult } from '../api/derek';
import {
  beginAsk,
  beginFollowUp,
  canAskDerek,
  failAsk,
  finishAsk,
  knownCitationNumbers,
  markUnavailable,
  partialReachedSuggestions,
  reduceDerekEvent,
  selectSuggestion,
  selectedSuggestion,
  startDerek,
  toggleTasteChip,
  visiblePartial
} from '../controllers/derekController';
import type { DialInContext } from '../domain/dialIn';

const context: DialInContext = {
  profileTitle: null,
  bean: null,
  grinder: null,
  recipe: { doseG: null, yieldG: null, temperatureC: null },
  shot: null,
  telemetry: []
};

function resultWith(answerText: string): DerekResult {
  return { mode: 'answer', answerText, citations: [], answerId: 'a1' };
}

run('compose gating: shot asks need a chip or note; general asks need a question', () => {
  let state = startDerek('shot', 'shot-1');
  equal(canAskDerek(state), false);
  state = toggleTasteChip(state, 'sour');
  equal(canAskDerek(state), true);
  state = toggleTasteChip(state, 'sour');
  equal(canAskDerek(state), false);
  state = { ...state, note: 'tastes thin' };
  equal(canAskDerek(state), true);

  let general = startDerek('general', null);
  equal(canAskDerek(general), false);
  general = { ...general, question: 'How do I descale?' };
  equal(canAskDerek(general), true);
});

run('the ask lifecycle folds stream events and finishes with suggestions', () => {
  let state = beginAsk(toggleTasteChip(startDerek('shot', 's1'), 'sour'), 'the query');
  equal(state.step, 'asking');
  equal(state.contextText, 'the query');

  state = reduceDerekEvent(state, { type: 'queue', position: 2, queued: true });
  equal(state.queuePosition, 2);
  state = reduceDerekEvent(state, { type: 'phase', phase: 'evidence_found', hitCount: 12 });
  equal(state.phase, 'evidence_found');
  equal(state.hitCount, 12);
  equal(state.queuePosition, null);
  state = reduceDerekEvent(state, { type: 'delta', text: 'Grind ' });
  state = reduceDerekEvent(state, { type: 'delta', text: 'finer.' });
  equal(state.partialText, 'Grind finer.');

  const answer =
    'Grind finer.\n```json\n{"suggestions":[{"parameter":"grind","direction":"decrease","current":null,"target":"14.0","unit":null,"why":"Slows the shot."}]}\n```';
  state = finishAsk(state, resultWith(answer), context);
  equal(state.step, 'done');
  equal(state.displayText, 'Grind finer.');
  equal(state.suggestions.length, 1);
  // The first applicable suggestion is pre-selected.
  equal(state.selectedSuggestion, 0);
  equal(selectedSuggestion(state)?.parameter, 'grind');
});

run('a stream that ends without a result keeps the partial text as interrupted', () => {
  let state = beginAsk({ ...startDerek('general', null), question: 'q' }, 'ctx');
  state = reduceDerekEvent(state, { type: 'delta', text: 'Half an answer' });
  state = finishAsk(state, null, context);
  equal(state.step, 'done');
  equal(state.interrupted, true);
  equal(state.displayText, 'Half an answer');

  let empty = beginAsk({ ...startDerek('general', null), question: 'q' }, 'ctx');
  empty = finishAsk(empty, null, context);
  equal(empty.step, 'failed');
});

run('error events and failures land in the failed step; unavailable is sticky', () => {
  let state = beginAsk({ ...startDerek('general', null), question: 'q' }, 'ctx');
  state = reduceDerekEvent(state, { type: 'error', message: 'boom' });
  equal(state.step, 'failed');
  equal(state.error, 'boom');

  equal(failAsk(state, 'again').error, 'again');
  equal(markUnavailable(state).step, 'unavailable');
});

run('suggestion selection is radio-style and skips manual cards', () => {
  const answer =
    '```json\n{"suggestions":[{"parameter":"wdt","target":"deep","why":"prep"},{"parameter":"grind","target":"14","why":"slower"}]}\n```';
  let state = finishAsk(
    { ...beginAsk({ ...startDerek('general', null), question: 'q' }, 'ctx') },
    resultWith(answer),
    context
  );
  // Pre-selected: the first APPLICABLE card (index 1 — index 0 is manual).
  equal(state.selectedSuggestion, 1);
  state = selectSuggestion(state, 0); // manual — refused
  equal(state.selectedSuggestion, 1);
  state = selectSuggestion(state, 99); // out of range — refused
  equal(state.selectedSuggestion, 1);
});

run('follow-up returns to compose and clears the question', () => {
  let state = finishAsk(
    beginAsk({ ...startDerek('shot', 's1'), question: 'why sour?' }, 'ctx'),
    resultWith('Because.'),
    context
  );
  state = beginFollowUp(state);
  equal(state.step, 'compose');
  equal(state.question, '');
  // The previous answer survives until the next ask begins.
  equal(state.displayText, 'Because.');
});

run('visiblePartial cuts streamed text at the JSON fence', () => {
  let state = beginAsk({ ...startDerek('general', null), question: 'q' }, 'ctx');
  state = reduceDerekEvent(state, { type: 'delta', text: 'Advice.\n```json\n{"sugg' });
  equal(visiblePartial(state), 'Advice.');
  equal(partialReachedSuggestions(state), true);
});

run('knownCitationNumbers flattens source numbers', () => {
  const numbers = knownCitationNumbers([
    { url: 'u', sectionTitle: 't', sourceType: null, date: null, sourceNumbers: [1, 3] },
    { url: 'u2', sectionTitle: 't2', sourceType: null, date: null, sourceNumbers: [2] }
  ]);
  equal(numbers.size, 3);
  equal(numbers.has(3), true);
});

function run(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

function equal<T>(actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  }
}
