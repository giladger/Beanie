import type { DerekResult } from '../api/derek';
import {
  beginAsk,
  finishAsk,
  reduceDerekEvent,
  startDerek,
  toggleTasteChip,
  type DerekState
} from '../controllers/derekController';
import type { DialInContext } from '../domain/dialIn';
import { renderDerekModal } from '../views/derekView';

const context: DialInContext = {
  profileTitle: null,
  bean: null,
  grinder: null,
  recipe: { doseG: null, yieldG: null, temperatureC: null },
  shot: null,
  telemetry: []
};

function render(state: DerekState, chips: string[] = []): string {
  return renderDerekModal({ state, contextChips: chips });
}

run('compose renders taste chips, context chips, and a gated ask button', () => {
  const html = render(startDerek('shot', 's1'), ['Chelchele · light', '18g → 40g']);
  contains(html, 'Dial in with Derek');
  contains(html, 'data-action="derek-taste"');
  contains(html, 'Chelchele · light');
  contains(html, 'data-action="derek-ask" disabled');

  const armed = render(toggleTasteChip(startDerek('shot', 's1'), 'sour'));
  contains(armed, 'aria-pressed="true"');
  if (armed.includes('data-action="derek-ask" disabled')) {
    throw new Error('ask must be enabled once a chip is active');
  }
});

run('asking renders the phase line and streamed text with the fence held back', () => {
  let state = beginAsk(toggleTasteChip(startDerek('shot', 's1'), 'sour'), 'ctx');
  state = reduceDerekEvent(state, { type: 'phase', phase: 'evidence_found', hitCount: 15 });
  state = reduceDerekEvent(state, { type: 'delta', text: '**Try** finer.\n```json\n{"s' });
  const html = render(state);
  contains(html, 'Found 15 sources');
  contains(html, '<strong>Try</strong> finer.');
  contains(html, 'Preparing suggestions…');
  if (html.includes('```json')) throw new Error('raw fence must never render');
});

run('done renders answer, cards with radio semantics, citations, and apply', () => {
  const result: DerekResult = {
    mode: 'answer',
    answerText:
      'Longer preinfusion. [1]\n```json\n{"suggestions":[{"parameter":"preinfusion_time","direction":"increase","current":8,"target":13,"unit":"s","why":"Saturates the puck."},{"parameter":"wdt","target":"deep","why":"Better prep."}]}\n```',
    citations: [
      {
        url: 'https://example.com/thread',
        sectionTitle: 'Sour light roasts',
        sourceType: 'comment',
        date: '2026-05-31',
        sourceNumbers: [1]
      }
    ],
    answerId: 'a1'
  };
  const state = finishAsk(
    beginAsk(toggleTasteChip(startDerek('shot', 's1'), 'sour'), 'ctx'),
    result,
    context
  );
  const html = render(state);
  contains(html, 'data-cite="1"');
  contains(html, 'Preinfusion time: 8 → 13 s');
  contains(html, 'try first');
  contains(html, 'creates a tweaked copy of the profile');
  contains(html, 'advice only');
  contains(html, 'data-action="derek-apply"');
  contains(html, 'href="https://example.com/thread"');
  contains(html, 'Sour light roasts');
  // Model output is escaped: the answer text goes through the safe renderer.
  if (html.includes('<script')) throw new Error('unescaped html');
});

run('unavailable and failed steps render their guidance', () => {
  const unavailable = render({ ...startDerek('shot', null), step: 'unavailable' });
  contains(unavailable, 'newer Decent.app');
  const failed = render({ ...startDerek('shot', null), step: 'failed', error: 'Derek is busy — try again in a minute.' });
  contains(failed, 'Derek is busy');
  contains(failed, 'data-action="derek-ask"');
});

function contains(haystack: string, needle: string): void {
  if (!haystack.includes(needle)) {
    throw new Error(`Expected to find "${needle}"`);
  }
}

function run(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}
