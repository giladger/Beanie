import type { ShotRecord } from '../api/types';
import { renderHistoryView, selectedHistoryShot } from '../views/historyView';

run('history view hides service shots while keeping pagination based on raw shots', () => {
  const html = renderHistoryView({
    shots: [shot('flush-shot', 'flush'), shot('espresso-shot', 'espresso')],
    detailShotId: null,
    demo: false,
    shotsTotal: 3,
    shotsLoadingMore: false,
    secondTapHint: null
  });

  excludes(html, 'flush-shot');
  includes(html, 'espresso-shot');
  includes(html, 'Load 1 more');
});

run('history view selects the requested shot and renders score controls', () => {
  const html = renderHistoryView({
    shots: [shot('shot-a', 'espresso', 80), shot('shot-b', 'espresso', 20)],
    detailShotId: 'shot-b',
    demo: false,
    shotsTotal: 2,
    shotsLoadingMore: false,
    secondTapHint: null
  });

  includes(html, 'data-id="shot-b"');
  includes(html, 'shot-score-word bad active');
  includes(html, 'id="detail-canvas"');
});

run('history view suppresses load more in demo or when all raw shots are loaded', () => {
  const base = {
    shots: [shot('shot-a', 'espresso')],
    detailShotId: null,
    shotsTotal: 1,
    shotsLoadingMore: false,
    secondTapHint: null
  };

  excludes(renderHistoryView({ ...base, demo: false }), 'load-more-shots');
  excludes(renderHistoryView({ ...base, demo: true, shotsTotal: 2 }), 'load-more-shots');
  includes(renderHistoryView({ ...base, demo: false, shotsTotal: 2, shotsLoadingMore: true }), 'Loading');
});

run('history view renders second tap hint for the matching shot only', () => {
  const html = renderHistoryView({
    shots: [shot('shot-a', 'espresso'), shot('shot-b', 'espresso')],
    detailShotId: null,
    demo: false,
    shotsTotal: 2,
    shotsLoadingMore: false,
    secondTapHint: { kind: 'shot', id: 'shot-b' }
  });

  includes(html, 'Tap again to load');
  includes(html, 'has-second-tap-hint');
});

run('selectedHistoryShot skips service shots and falls back to the first visible shot', () => {
  equal(selectedHistoryShot([shot('steam-shot', 'steam'), shot('shot-a', 'espresso')], 'steam-shot')?.id, 'shot-a');
  equal(selectedHistoryShot([shot('steam-shot', 'steam')], null), null);
});

function shot(id: string, beverageType: string, enjoyment: number | null = null): ShotRecord {
  return {
    id,
    timestamp: '2026-06-05T10:00:00.000Z',
    workflow: {
      profile: { title: `Profile ${id}`, beverage_type: beverageType },
      context: {
        targetDoseWeight: 18,
        targetYield: 36,
        finalBeverageType: beverageType,
        grinderModel: 'Niche',
        grinderSetting: '12'
      }
    },
    annotations: {
      actualDoseWeight: 18,
      actualYield: 37,
      enjoyment
    },
    measurements: [
      {
        machine: {
          timestamp: '2026-06-05T10:00:00.000Z',
          state: { substate: 'preinfusion' }
        } as ShotRecord['measurements'][number]['machine']
      },
      {
        machine: {
          timestamp: '2026-06-05T10:00:28.000Z',
          state: { substate: 'pouring' }
        } as ShotRecord['measurements'][number]['machine']
      }
    ]
  };
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

function equal<T>(actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  }
}

function includes(text: string, expected: string): void {
  if (!text.includes(expected)) {
    throw new Error(`Expected ${JSON.stringify(text.slice(0, 240))} to include ${expected}`);
  }
}

function excludes(text: string, expected: string): void {
  if (text.includes(expected)) {
    throw new Error(`Expected rendered output not to include ${expected}`);
  }
}
