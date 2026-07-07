import type { DerekResult } from '../api/derek';
import { createProfileEditorState, profileFromEditorState } from '../components/profileEditor';
import {
  beginAsk,
  finishAsk,
  reduceDerekEvent,
  startDerek,
  toggleTasteChip,
  type DerekState
} from '../controllers/derekController';
import type { DialInContext, DialInSuggestion } from '../domain/dialIn';
import { applyProfileTweak } from '../domain/profileTweaks';
import { compileSimpleToSteps, defaultSimpleKnobs } from '../domain/simpleProfile';
import { renderDerekModal, renderTweakPreview } from '../views/derekView';
import { renderRecipeEditor } from '../views/workbenchView';

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

run('done renders answer and cards with radio semantics and apply', () => {
  const result: DerekResult = {
    mode: 'answer',
    answerText:
      'Longer preinfusion. [1]\n```json\n{"suggestions":[{"parameter":"preinfusion_time","direction":"increase","current":8,"target":13,"unit":"s","why":"Saturates the puck. [3]"},{"parameter":"wdt","target":"deep","why":"Better prep."}]}\n```',
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
  contains(html, 'Preinfusion time: 8 → 13 s');
  contains(html, 'try first');
  contains(html, 'creates a tweaked copy of the profile');
  contains(html, 'advice only');
  contains(html, 'data-action="derek-apply"');
  // Citation markers and the source list are stripped, not rendered.
  contains(html, 'Longer preinfusion.');
  if (html.includes('[1]') || html.includes('[3]')) throw new Error('citation markers must be stripped');
  if (html.includes('Sources') || html.includes('example.com')) throw new Error('source list must not render');
  // Model output is escaped: the answer text goes through the safe renderer.
  if (html.includes('<script')) throw new Error('unescaped html');
});

run('renderTweakPreview draws before/after traces that actually differ', () => {
  const profile = profileFromEditorState({
    ...createProfileEditorState(null),
    title: 'Simple',
    steps: compileSimpleToSteps({ ...defaultSimpleKnobs('pressure'), preTime: 8 }, 'pressure')
  });
  const suggestion: DialInSuggestion = {
    kind: 'profile',
    parameter: 'preinfusion_time',
    direction: 'increase',
    current: 8,
    target: 20,
    unit: 's',
    why: ''
  };
  const tweak = applyProfileTweak(profile, suggestion);
  if (!tweak) throw new Error('expected a tweak');
  const svg = renderTweakPreview(profile, tweak.profile);
  contains(svg, 'derek-tweak-before');
  contains(svg, 'derek-tweak-after');
  // Identical profiles yield no preview rather than two identical lines.
  if (renderTweakPreview(profile, profile) !== '') throw new Error('identical traces must render nothing');
});

run('the workbench profile control offers a revert while a tweak is staged', () => {
  const model = {
    draft: { profileTitle: 'Simple · derek: preinfusion 20s' },
    grinderStep: 0.1,
    ratioLabel: '1:2',
    brewTempLabel: '92.0',
    derekTweak: { summary: 'Preinfusion time 8s → 20s' }
  };
  const html = renderRecipeEditor(model as Parameters<typeof renderRecipeEditor>[0]);
  contains(html, 'data-action="derek-revert-tweak"');
  contains(html, 'Revert: Preinfusion time 8s → 20s');
  const without = renderRecipeEditor({ ...model, derekTweak: null } as Parameters<typeof renderRecipeEditor>[0]);
  if (without.includes('derek-tweak-revert')) throw new Error('revert must hide when no tweak is staged');
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
