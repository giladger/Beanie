import type { RecipeDraft, ShotRecord } from '../api/types';
import { formatGrams, recipeFromShot } from '../domain/beanWorkflow';
import { isServiceShot } from '../domain/shotRecord';
import { icon } from '../components/icons';
import { enjoymentBadge, shotScoreControl } from '../components/shotScore';
import { escapeAttr, escapeHtml } from '../components/html';

export interface HistoryViewModel {
  shots: ShotRecord[];
  detailShotId: string | null;
  demo: boolean;
  shotsTotal: number;
  shotsLoadingMore: boolean;
  secondTapHint: { kind: 'shot' | 'bean'; id: string } | null;
}

export function renderHistoryView(model: HistoryViewModel): string {
  const shots = historyShots(model.shots);
  const selected = selectedHistoryShot(model.shots, model.detailShotId);
  return `
    <section class="history-panel panel">
      <div class="history-split">
        <div class="shot-list">
          ${
            shots.length === 0
              ? '<p class="empty-history">No shots found for this bean.</p>'
              : shots.map((shot) => renderShotListItem(shot, shot.id === selected?.id, model.secondTapHint)).join('')
          }
          ${renderLoadMore(model)}
        </div>
        <div class="shot-detail-pane">
          ${selected ? renderShotDetailPane(selected) : '<p class="empty-history">Select a shot to inspect.</p>'}
        </div>
      </div>
    </section>
  `;
}

export function selectedHistoryShot(shots: ShotRecord[], detailShotId: string | null): ShotRecord | null {
  const history = historyShots(shots);
  return history.find((shot) => shot.id === detailShotId) ?? history[0] ?? null;
}

function historyShots(shots: ShotRecord[]): ShotRecord[] {
  return shots.filter((shot) => !isServiceShot(shot));
}

function renderShotListItem(
  shot: ShotRecord,
  active: boolean,
  secondTapHint: HistoryViewModel['secondTapHint']
): string {
  const recipe = recipeFromShot(shot);
  const duration = shotDurationLabel(shot);
  const recipeText = shotRecipeDisplay(shot, recipe);
  const date = shotDateShortLabel(shot.timestamp);
  const hint = renderSecondTapHint('shot', shot.id, secondTapHint);
  return `
    <button class="shot-item ${active ? 'active' : ''} ${hint ? 'has-second-tap-hint' : ''}" data-action="select-history-shot" data-id="${escapeAttr(shot.id)}">
      <span class="shot-item-info">
        <span class="shot-item-recipe">${escapeHtml(recipeText)}${duration ? ` @ ${escapeHtml(duration)}` : ''}</span>
        ${enjoymentBadge(shot)}
      </span>
      <span class="shot-item-profile">${escapeHtml([recipe.profileTitle ?? 'No profile', date].filter(Boolean).join(' · '))}</span>
      ${hint}
    </button>
  `;
}

function renderSecondTapHint(
  kind: 'shot' | 'bean',
  id: string,
  secondTapHint: HistoryViewModel['secondTapHint']
): string {
  if (!secondTapHint || secondTapHint.kind !== kind || secondTapHint.id !== id) return '';
  return '<span class="second-tap-tooltip">Tap again to load</span>';
}

function renderShotDetailPane(shot: ShotRecord): string {
  const recipe = recipeFromShot(shot);
  const date = new Date(shot.timestamp);
  const dateLabel = Number.isNaN(date.valueOf())
    ? shot.timestamp
    : date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const duration = shotDurationLabel(shot);
  const grinder = recipe.grinderModel
    ? `${recipe.grinderModel}${recipe.grinderSetting ? ` ${recipe.grinderSetting}` : ''}`
    : recipe.grinderSetting
      ? `grind ${recipe.grinderSetting}`
      : '';
  return `
    <div class="pane-head">
      <span class="pane-stat pane-lead">${escapeHtml(shotRecipeDisplay(shot, recipe)).replace(' → ', ' <span class="io-arrow">→</span> ')}</span>
      ${duration ? `<span class="pane-stat">@ ${escapeHtml(duration)}</span>` : ''}
      ${grinder ? `<span class="pane-stat">${escapeHtml(grinder)}</span>` : ''}
      <span class="pane-profile">${escapeHtml(recipe.profileTitle ?? 'No profile')}</span>
      <span class="pane-time">${escapeHtml(dateLabel)}</span>
      ${shotScoreControl(shot.annotations?.enjoyment ?? null, {
        action: 'set-shot-score',
        shotId: shot.id,
        variant: 'detail'
      })}
      <button class="icon-button shot-edit-button" data-action="edit-shot" aria-label="Edit shot fields" title="Edit shot fields">${icon('pencil')}</button>
    </div>
    <div class="detail-chart">
      <canvas id="detail-canvas" class="live-canvas detail-canvas"></canvas>
    </div>
  `;
}

function renderLoadMore(model: HistoryViewModel): string {
  if (model.demo || model.shots.length >= model.shotsTotal) return '';
  const remaining = model.shotsTotal - model.shots.length;
  return `
    <button class="command load-more" data-action="load-more-shots" ${model.shotsLoadingMore ? 'disabled' : ''}>
      ${model.shotsLoadingMore ? 'Loading…' : `Load ${remaining} more`}
    </button>
  `;
}

function shotDurationLabel(shot: ShotRecord): string | null {
  const all = shot.measurements;
  if (!Array.isArray(all) || all.length < 2) return null;
  // Mirror the chart's window: prefer the espresso pour (preinfusion/pouring)
  // span when substates are present, else the full measurement span.
  const pour = all.filter((m) => {
    const sub = (m.machine as { state?: { substate?: string } } | undefined)?.state?.substate;
    return sub === 'preinfusion' || sub === 'pouring';
  });
  const series = pour.length > 1 ? pour : all;
  const first = Date.parse(series[0]!.machine.timestamp);
  const last = Date.parse(series[series.length - 1]!.machine.timestamp);
  if (!Number.isFinite(first) || !Number.isFinite(last) || last <= first) return null;
  return `${Math.round((last - first) / 1000)}s`;
}

function shotRecipeDisplay(shot: ShotRecord, recipe: RecipeDraft): string {
  const yieldText = shotYieldDisplay(shot, recipe.yield);
  return `${formatGrams(recipe.dose)} → ${yieldText}`;
}

function shotYieldDisplay(shot: ShotRecord, fallbackYield: number | null | undefined): string {
  const actual = shot.annotations?.actualYield;
  if (typeof actual === 'number' && Number.isFinite(actual) && actual > 0) {
    return formatGrams(actual);
  }
  const target = shot.workflow?.context?.targetYield;
  if (typeof target === 'number' && Number.isFinite(target) && target > 0 && fallbackYield === target) {
    return `target ${formatGrams(target)}`;
  }
  return formatGrams(fallbackYield);
}

function shotDateShortLabel(timestamp: string): string | null {
  const date = new Date(timestamp);
  if (Number.isNaN(date.valueOf())) return null;
  return date.toLocaleString([], { month: 'short', day: 'numeric' });
}
