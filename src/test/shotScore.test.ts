import type { ShotRecord } from '../api/types';
import {
  enjoymentBadge,
  scoreOptionForValue,
  scoreValueFromTap,
  shotScoreControl
} from '../components/shotScore';

run('scoreOptionForValue maps stored 0-10 ratings to the nearest label', () => {
  equal(scoreOptionForValue(null), null);
  equal(scoreOptionForValue(0), null);
  equal(scoreOptionForValue(2)?.label, 'Bad');
  equal(scoreOptionForValue(7.4)?.label, 'Good');
  equal(scoreOptionForValue(10)?.label, 'Great');
});

run('scoreOptionForValue reads 0-100 ratings from gateways older than Decaid 0.8.7', () => {
  equal(scoreOptionForValue(20)?.label, 'Bad');
  equal(scoreOptionForValue(74)?.label, 'Good');
  equal(scoreOptionForValue(99)?.label, 'Great');
});

run('scoreValueFromTap toggles the active score and ignores bad input', () => {
  equal(scoreValueFromTap('8', null), 8);
  equal(scoreValueFromTap('8', 8), null);
  // A legacy 0-100 rating with the same word toggles off too.
  equal(scoreValueFromTap('8', 80), null);
  equal(scoreValueFromTap('nope', 8), null);
});

run('shotScoreControl escapes shot ids and marks the active word', () => {
  const html = shotScoreControl(8, {
    action: 'set-shot-score',
    shotId: 'shot-"1"',
    variant: 'detail'
  });

  includes(html, 'data-id="shot-&quot;1&quot;"');
  includes(html, 'shot-score-word good active');
});

run('enjoymentBadge renders empty row placeholders for unrated shots', () => {
  includes(enjoymentBadge(shot(null)), 'enjoyment-badge empty');
  equal(enjoymentBadge(shot(null), 'detail'), '');
  includes(enjoymentBadge(shot(10)), 'Great');
  includes(enjoymentBadge(shot(2)), 'Bad');
  includes(enjoymentBadge(shot(100)), 'Great');
});

function shot(enjoyment: number | null): ShotRecord {
  return {
    id: 'shot-1',
    timestamp: '2026-06-05T10:00:00.000Z',
    annotations: { enjoyment },
    measurements: []
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
