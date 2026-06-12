import type { BeanBatch, ShotRecord } from '../api/types';
import { renderHistoryView, selectedHistoryShot } from '../views/historyView';

run('history view hides service shots while keeping pagination based on raw shots', () => {
  const html = renderHistoryView({
    shots: [shot('flush-shot', 'flush'), shot('espresso-shot', 'espresso')],
    detailShotId: null,
    compareShotId: null,
    comparePicking: false,
    showTrends: false,
    demo: false,
    shotsTotal: 3,
    shotsLoadingMore: false,
    secondTapHint: null,
    batchesByBean: {}
  });

  excludes(html, 'flush-shot');
  includes(html, 'espresso-shot');
  includes(html, 'Load 1 more');
});

run('history view selects the requested shot and renders score controls', () => {
  const html = renderHistoryView({
    shots: [shot('shot-a', 'espresso', 80), shot('shot-b', 'espresso', 20)],
    detailShotId: 'shot-b',
    compareShotId: null,
    comparePicking: false,
    showTrends: false,
    demo: false,
    shotsTotal: 2,
    shotsLoadingMore: false,
    secondTapHint: null,
    batchesByBean: {}
  });

  includes(html, 'data-id="shot-b"');
  includes(html, 'shot-score-word bad active');
  includes(html, 'id="detail-canvas"');
});

run('history view suppresses load more in demo or when all raw shots are loaded', () => {
  const base = {
    shots: [shot('shot-a', 'espresso')],
    detailShotId: null,
    compareShotId: null,
    comparePicking: false,
    showTrends: false,
    shotsTotal: 1,
    shotsLoadingMore: false,
    secondTapHint: null,
    batchesByBean: {}
  };

  excludes(renderHistoryView({ ...base, demo: false }), 'load-more-shots');
  excludes(renderHistoryView({ ...base, demo: true, shotsTotal: 2 }), 'load-more-shots');
  includes(renderHistoryView({ ...base, demo: false, shotsTotal: 2, shotsLoadingMore: true }), 'Loading');
});

run('history view renders second tap hint for the matching shot only', () => {
  const html = renderHistoryView({
    shots: [shot('shot-a', 'espresso'), shot('shot-b', 'espresso')],
    detailShotId: null,
    compareShotId: null,
    comparePicking: false,
    showTrends: false,
    demo: false,
    shotsTotal: 2,
    shotsLoadingMore: false,
    secondTapHint: { kind: 'shot', id: 'shot-b' },
    batchesByBean: {}
  });

  includes(html, 'Tap again to load');
  includes(html, 'has-second-tap-hint');
});

run('history view computes age for shots without stored freshness metadata', () => {
  const batch: BeanBatch = {
    id: 'batch-1',
    beanId: 'bean-1',
    roastDate: '2026-06-01T00:00:00.000Z'
  };
  const html = renderHistoryView({
    shots: [shot('shot-a', 'espresso', null, batch.id)],
    detailShotId: 'shot-a',
    compareShotId: null,
    comparePicking: false,
    showTrends: false,
    demo: false,
    shotsTotal: 1,
    shotsLoadingMore: false,
    secondTapHint: null,
    batchesByBean: { [batch.beanId]: [batch] }
  });

  includes(html, '4d · Profile shot-a · Jun 5');
  includes(html, '<span class="pane-stat">4d</span>');
});

run('history view marks the comparison shot and renders the compare chip', () => {
  const html = renderHistoryView({
    shots: [shot('shot-a', 'espresso'), shot('shot-b', 'espresso')],
    detailShotId: 'shot-a',
    compareShotId: 'shot-b',
    comparePicking: false,
    showTrends: false,
    demo: false,
    shotsTotal: 2,
    shotsLoadingMore: false,
    secondTapHint: null,
    batchesByBean: {}
  });

  includes(html, 'comparing');
  includes(html, 'compare-badge');
  includes(html, 'compare-chip');
  includes(html, 'data-action="clear-compare-shot"');
});

run('history view shows the compare picking hint and no chip while picking', () => {
  const html = renderHistoryView({
    shots: [shot('shot-a', 'espresso'), shot('shot-b', 'espresso')],
    detailShotId: 'shot-a',
    compareShotId: null,
    comparePicking: true,
    showTrends: false,
    demo: false,
    shotsTotal: 2,
    shotsLoadingMore: false,
    secondTapHint: null,
    batchesByBean: {}
  });

  includes(html, 'Tap a shot to overlay it on the chart.');
  excludes(html, 'compare-chip');
});

run('history view ignores a comparison id that matches the selected shot', () => {
  const html = renderHistoryView({
    shots: [shot('shot-a', 'espresso')],
    detailShotId: 'shot-a',
    compareShotId: 'shot-a',
    comparePicking: false,
    showTrends: false,
    demo: false,
    shotsTotal: 1,
    shotsLoadingMore: false,
    secondTapHint: null,
    batchesByBean: {}
  });

  excludes(html, 'compare-chip');
  excludes(html, 'compare-badge');
});

run('history view renders the trend strip only when enabled', () => {
  const model = {
    shots: [shot('shot-a', 'espresso', 80), shot('shot-b', 'espresso', 20)],
    detailShotId: null,
    compareShotId: null,
    comparePicking: false,
    showTrends: true,
    demo: false,
    shotsTotal: 2,
    shotsLoadingMore: false,
    secondTapHint: null,
    batchesByBean: {}
  };

  const withTrends = renderHistoryView(model);
  includes(withTrends, 'shot-trends');
  includes(withTrends, 'trend-spark');
  includes(withTrends, 'Oldest → newest · 2 loaded shots');
  includes(withTrends, 'with-trends');

  const withoutTrends = renderHistoryView({ ...model, showTrends: false });
  excludes(withoutTrends, 'shot-trends');
});

run('history view re-renders memoized rows when selection or compare flags change', () => {
  const shots = [shot('shot-a', 'espresso'), shot('shot-b', 'espresso')];
  const base = {
    shots,
    detailShotId: 'shot-a',
    compareShotId: null as string | null,
    comparePicking: false,
    showTrends: false,
    demo: false,
    shotsTotal: 2,
    shotsLoadingMore: false,
    secondTapHint: null,
    batchesByBean: {}
  };

  // Same model twice: the memoized rows must keep rendering correctly.
  renderHistoryView(base);
  const again = renderHistoryView(base);
  includes(again, 'data-id="shot-a"');

  // Selection moves: the active class must follow despite the row cache.
  const moved = renderHistoryView({ ...base, detailShotId: 'shot-b' });
  const activeIndex = moved.indexOf('shot-item active');
  const shotBIndex = moved.indexOf('data-id="shot-b"');
  if (activeIndex === -1 || shotBIndex === -1 || Math.abs(activeIndex - shotBIndex) > 120) {
    throw new Error('Expected the active class to move to shot-b');
  }

  // Compare flag set: the badge appears on the comparison row.
  includes(renderHistoryView({ ...base, compareShotId: 'shot-b' }), 'compare-badge');
});

run('history view renders raw shot stats under the chart, with compare values when overlaid', () => {
  const rich = (id: string): ShotRecord => ({
    ...shot(id, 'espresso'),
    measurements: [
      {
        machine: {
          timestamp: '2026-06-05T10:00:00.000Z',
          pressure: 8.6,
          flow: 2.2,
          groupTemperature: 92.6,
          state: { substate: 'pouring' }
        } as ShotRecord['measurements'][number]['machine'],
        scale: { timestamp: '2026-06-05T10:00:00.000Z', weight: 36, weightFlow: 1.5 }
      }
    ]
  });
  const base = {
    shots: [rich('shot-a'), rich('shot-b')],
    detailShotId: 'shot-a',
    compareShotId: null as string | null,
    comparePicking: false,
    showTrends: false,
    demo: false,
    shotsTotal: 2,
    shotsLoadingMore: false,
    secondTapHint: null,
    batchesByBean: {}
  };

  const alone = renderHistoryView(base);
  includes(alone, 'detail-stats');
  includes(alone, 'Peak pressure');
  includes(alone, '8.6 bar');
  excludes(alone, 'detail-stat-compare');

  const compared = renderHistoryView({ ...base, compareShotId: 'shot-b' });
  includes(compared, 'detail-stats with-compare');
  includes(compared, 'detail-stat-compare');
});

run('selectedHistoryShot skips service shots and falls back to the first visible shot', () => {
  equal(selectedHistoryShot([shot('steam-shot', 'steam'), shot('shot-a', 'espresso')], 'steam-shot')?.id, 'shot-a');
  equal(selectedHistoryShot([shot('steam-shot', 'steam')], null), null);
});

function shot(
  id: string,
  beverageType: string,
  enjoyment: number | null = null,
  beanBatchId: string | null = null
): ShotRecord {
  return {
    id,
    timestamp: '2026-06-05T10:00:00.000Z',
    workflow: {
      profile: { title: `Profile ${id}`, beverage_type: beverageType },
      context: {
        targetDoseWeight: 18,
        targetYield: 36,
        finalBeverageType: beverageType,
        beanBatchId,
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
