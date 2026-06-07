import type { ShotRecord } from '../api/types';
import { escapeAttr, escapeHtml } from './html';

export const SHOT_SCORE_OPTIONS = [
  { value: 20, label: 'Bad', tone: 'bad' },
  { value: 40, label: 'Meh', tone: 'meh' },
  { value: 60, label: 'OK', tone: 'ok' },
  { value: 80, label: 'Good', tone: 'good' },
  { value: 100, label: 'Great', tone: 'great' }
] as const;

export type ShotScoreOption = (typeof SHOT_SCORE_OPTIONS)[number];

export function enjoymentBadge(shot: ShotRecord, size: 'row' | 'detail' = 'row'): string {
  // Unrated shots (null, or the 0 that de1app imports use as "not rated")
  // get no badge - scoreOptionForValue treats both as no score.
  const score = scoreOptionForValue(shot.annotations?.enjoyment);
  if (!score) {
    if (size === 'row') return '<span class="enjoyment-badge empty" aria-hidden="true"></span>';
    return '';
  }
  return `<span class="enjoyment-badge ${score.tone} ${size === 'detail' ? 'large' : ''}" aria-label="Enjoyment ${escapeAttr(score.label)}">${escapeHtml(score.label)}</span>`;
}

export function shotScoreControl(
  value: number | null,
  options: { action: 'shot-edit-score' | 'set-shot-score' | 'phone-shot-score'; shotId?: string; variant: 'edit' | 'detail' }
): string {
  const current = scoreOptionForValue(value);
  const idAttr = options.shotId ? ` data-id="${escapeAttr(options.shotId)}"` : '';
  return `
    <div class="shot-score-control ${options.variant === 'detail' ? 'compact' : ''}" aria-label="Shot score">
      ${SHOT_SCORE_OPTIONS.map((item) => {
        const active = current?.value === item.value;
        return `<button type="button" class="shot-score-word ${item.tone} ${active ? 'active' : ''}" data-action="${options.action}"${idAttr} data-value="${item.value}" aria-label="${escapeAttr(item.label)}" aria-pressed="${active}" title="${escapeAttr(item.label)}">${escapeHtml(item.label)}</button>`;
      }).join('')}
    </div>
  `;
}

export function scoreOptionForValue(value: number | null | undefined): ShotScoreOption | null {
  if (value == null || value <= 0) return null;
  let closest: ShotScoreOption = SHOT_SCORE_OPTIONS[0]!;
  let distance = Math.abs(value - closest.value);
  for (const option of SHOT_SCORE_OPTIONS) {
    const nextDistance = Math.abs(value - option.value);
    if (nextDistance < distance) {
      closest = option;
      distance = nextDistance;
    }
  }
  return closest;
}

export function scoreValueFromTap(value: string | undefined, currentValue: number | null | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return scoreOptionForValue(currentValue)?.value === parsed ? null : parsed;
}
