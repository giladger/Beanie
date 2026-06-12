import type { BeanBatch, RecipeDraft, ShotRecord } from '../api/types';
import { batchForShotFreshness, formatGrams, recipeFromShot, shotFreshnessBadgeForShot } from '../domain/beanWorkflow';
import { isServiceShot } from '../domain/shotRecord';
import { buildShotStats, hasShotStats, type ShotStats } from '../domain/shotStats';
import { buildShotTrends, shotDurationSeconds, type ShotTrendRow } from '../domain/shotTrends';
import { icon } from '../components/icons';
import { enjoymentBadge, shotScoreControl } from '../components/shotScore';
import { escapeAttr, escapeHtml } from '../components/html';

export interface HistoryViewModel {
  shots: ShotRecord[];
  detailShotId: string | null;
  /** Shot overlaid on the detail chart for comparison, if any. */
  compareShotId: string | null;
  /** The next list tap picks the comparison shot instead of selecting. */
  comparePicking: boolean;
  showTrends: boolean;
  demo: boolean;
  shotsTotal: number;
  shotsLoadingMore: boolean;
  secondTapHint: { kind: 'shot' | 'bean'; id: string } | null;
  batchesByBean: Record<string, BeanBatch[]>;
}

export function renderHistoryView(model: HistoryViewModel): string {
  const shots = historyShots(model.shots);
  const selected = selectedHistoryShot(model.shots, model.detailShotId);
  const compare = compareHistoryShot(model.shots, model.detailShotId, model.compareShotId);
  return `
    <section class="history-panel panel ${model.showTrends ? 'with-trends' : ''}">
      ${model.showTrends ? renderTrendStrip(model.shots) : ''}
      <div class="history-split">
        <div class="shot-list">
          ${model.comparePicking ? '<p class="compare-hint">Tap a shot to overlay it on the chart.</p>' : ''}
          ${
            shots.length === 0
              ? '<p class="empty-history">No shots found for this bean.</p>'
              : shots
                  .map((shot) =>
                    renderShotListItem(shot, shot.id === selected?.id, shot.id === compare?.id, model.secondTapHint, model.batchesByBean)
                  )
                  .join('')
          }
          ${renderLoadMore(model)}
        </div>
        <div class="shot-detail-pane">
          ${selected ? renderShotDetailPane(selected, compare, model, model.batchesByBean) : '<p class="empty-history">Select a shot to inspect.</p>'}
        </div>
      </div>
    </section>
  `;
}

export function compareHistoryShot(
  shots: ShotRecord[],
  detailShotId: string | null,
  compareShotId: string | null
): ShotRecord | null {
  if (!compareShotId) return null;
  const selected = selectedHistoryShot(shots, detailShotId);
  if (selected?.id === compareShotId) return null;
  return historyShots(shots).find((shot) => shot.id === compareShotId) ?? null;
}

/**
 * The shot a live pull is read against: the explicit comparison shot when one
 * is set, else the shot open in the detail pane — and only if it actually has
 * measurements to draw.
 */
export function liveGhostReference(
  shots: ShotRecord[],
  detailShotId: string | null,
  compareShotId: string | null
): ShotRecord | null {
  const reference =
    compareHistoryShot(shots, detailShotId, compareShotId) ?? selectedHistoryShot(shots, detailShotId);
  if (!reference || !Array.isArray(reference.measurements) || reference.measurements.length === 0) return null;
  return reference;
}

export function selectedHistoryShot(shots: ShotRecord[], detailShotId: string | null): ShotRecord | null {
  const history = historyShots(shots);
  return history.find((shot) => shot.id === detailShotId) ?? history[0] ?? null;
}

// Shot records are replaced (never mutated) when they change, so per-shot
// rendering can be memoized by object identity. With paginated histories the
// list grows into the hundreds, and recomputing recipe, freshness, and the
// duration (a walk over every measurement) for each row on every re-render is
// the main thing that makes render cost scale with history size.
let historyShotsCache: { source: ShotRecord[]; result: ShotRecord[] } | null = null;

function historyShots(shots: ShotRecord[]): ShotRecord[] {
  if (historyShotsCache?.source === shots) return historyShotsCache.result;
  const result = shots.filter((shot) => !isServiceShot(shot));
  historyShotsCache = { source: shots, result };
  return result;
}

interface ShotListItemCacheEntry {
  html: string;
  active: boolean;
  comparing: boolean;
  hint: string;
  batchesByBean: Record<string, BeanBatch[]>;
}

const shotListItemCache = new WeakMap<ShotRecord, ShotListItemCacheEntry>();

function renderShotListItem(
  shot: ShotRecord,
  active: boolean,
  comparing: boolean,
  secondTapHint: HistoryViewModel['secondTapHint'],
  batchesByBean: Record<string, BeanBatch[]>
): string {
  const hint = renderSecondTapHint('shot', shot.id, secondTapHint);
  const cached = shotListItemCache.get(shot);
  if (
    cached &&
    cached.active === active &&
    cached.comparing === comparing &&
    cached.hint === hint &&
    cached.batchesByBean === batchesByBean
  ) {
    return cached.html;
  }
  const recipe = recipeFromShot(shot);
  const duration = shotDurationLabel(shot);
  const recipeText = shotRecipeDisplay(shot, recipe);
  const date = shotDateShortLabel(shot.timestamp);
  const freshness = shotFreshnessBadgeForShot(shot, batchForShotFreshness(shot, batchesByBean));
  const html = `
    <button class="shot-item ${active ? 'active' : ''} ${comparing ? 'comparing' : ''} ${hint ? 'has-second-tap-hint' : ''}" data-action="select-history-shot" data-id="${escapeAttr(shot.id)}">
      <span class="shot-item-info">
        <span class="shot-item-recipe">${escapeHtml(recipeText)}${duration ? ` @ ${escapeHtml(duration)}` : ''}</span>
        ${comparing ? '<span class="compare-badge">overlay</span>' : ''}
        ${enjoymentBadge(shot)}
      </span>
      <span class="shot-item-profile">${escapeHtml([freshness, recipe.profileTitle ?? 'No profile', date].filter(Boolean).join(' · '))}</span>
      ${hint}
    </button>
  `;
  shotListItemCache.set(shot, { html, active, comparing, hint, batchesByBean });
  return html;
}

function renderSecondTapHint(
  kind: 'shot' | 'bean',
  id: string,
  secondTapHint: HistoryViewModel['secondTapHint']
): string {
  if (!secondTapHint || secondTapHint.kind !== kind || secondTapHint.id !== id) return '';
  return '<span class="second-tap-tooltip">Tap again to load</span>';
}

function renderShotDetailPane(
  shot: ShotRecord,
  compare: ShotRecord | null,
  model: HistoryViewModel,
  batchesByBean: Record<string, BeanBatch[]>
): string {
  const recipe = recipeFromShot(shot);
  const duration = shotDurationLabel(shot);
  const freshness = shotFreshnessBadgeForShot(shot, batchForShotFreshness(shot, batchesByBean));
  const grinder = recipe.grinderModel
    ? `${recipe.grinderModel}${recipe.grinderSetting ? ` ${recipe.grinderSetting}` : ''}`
    : recipe.grinderSetting
      ? `grind ${recipe.grinderSetting}`
      : '';
  return `
    <div class="pane-head">
      <span class="pane-stat pane-lead">${escapeHtml(shotRecipeDisplay(shot, recipe)).replace(' → ', ' <span class="io-arrow">→</span> ')}</span>
      ${duration ? `<span class="pane-stat">@ ${escapeHtml(duration)}</span>` : ''}
      ${freshness ? `<span class="pane-stat">${escapeHtml(freshness)}</span>` : ''}
      ${grinder ? `<span class="pane-stat">${escapeHtml(grinder)}</span>` : ''}
      <span class="pane-profile">${escapeHtml(recipe.profileTitle ?? 'No profile')}</span>
      ${shotScoreControl(shot.annotations?.enjoyment ?? null, {
        action: 'set-shot-score',
        shotId: shot.id,
        variant: 'detail'
      })}
      <button class="icon-button shot-edit-button history-tool ${model.showTrends ? 'active' : ''}" data-action="toggle-trends" aria-pressed="${model.showTrends}" aria-label="Show shot trends" title="Show shot trends">${icon('trending-up')}</button>
      <button class="icon-button shot-edit-button history-tool ${model.comparePicking || compare ? 'active' : ''}" data-action="toggle-compare-pick" aria-pressed="${model.comparePicking}" aria-label="Compare with another shot" title="Compare with another shot">${icon('git-compare-arrows')}</button>
      <button class="icon-button shot-edit-button" data-action="edit-shot" aria-label="Edit shot fields" title="Edit shot fields">${icon('pencil')}</button>
    </div>
    <div class="detail-chart">
      ${compare ? renderCompareChip(compare) : ''}
      <canvas id="detail-canvas" class="live-canvas detail-canvas"></canvas>
    </div>
    ${renderShotStats(shot, compare)}
  `;
}

interface ShotStatSpec {
  key: keyof ShotStats;
  label: string;
  format: (value: number) => string;
}

const SHOT_STAT_SPECS: ShotStatSpec[] = [
  { key: 'peakPressure', label: 'Peak pressure', format: (v) => `${v.toFixed(1)} bar` },
  { key: 'avgFlow', label: 'Avg flow', format: (v) => `${v.toFixed(1)} ml/s` },
  { key: 'avgTemperature', label: 'Avg temp', format: (v) => `${v.toFixed(1)}°C` },
  { key: 'firstDropsSeconds', label: 'First drops', format: (v) => `${v.toFixed(1)}s` },
  { key: 'endWeight', label: 'End weight', format: (v) => `${v.toFixed(1)}g` },
  { key: 'postStopDrip', label: 'After stop', format: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}g` }
];

function renderShotStats(shot: ShotRecord, compare: ShotRecord | null): string {
  const stats = buildShotStats(shot);
  const compareStats = compare ? buildShotStats(compare) : null;
  if (!hasShotStats(stats) && (compareStats == null || !hasShotStats(compareStats))) return '';
  const cells = SHOT_STAT_SPECS.flatMap((spec) => {
    const value = stats[spec.key];
    const compareValue = compareStats?.[spec.key];
    if (value == null && compareValue == null) return [];
    return [
      `
      <div class="detail-stat">
        <label>${escapeHtml(spec.label)}</label>
        <strong>${value == null ? '--' : escapeHtml(spec.format(value))}</strong>
        ${compareStats ? `<span class="detail-stat-compare">${compareValue == null ? '--' : escapeHtml(spec.format(compareValue))}</span>` : ''}
      </div>
    `
    ];
  });
  if (cells.length === 0) return '';
  return `<div class="detail-stats ${compareStats ? 'with-compare' : ''}">${cells.join('')}</div>`;
}

function renderCompareChip(compare: ShotRecord): string {
  const recipe = recipeFromShot(compare);
  const duration = shotDurationLabel(compare);
  const date = shotDateShortLabel(compare.timestamp);
  const text = [shotRecipeDisplay(compare, recipe), duration ? `@ ${duration}` : null, date]
    .filter(Boolean)
    .join(' · ');
  return `
    <span class="compare-chip">
      <span class="compare-chip-text">vs ${escapeHtml(text)}</span>
      <button class="compare-chip-clear" data-action="clear-compare-shot" aria-label="Stop comparing" title="Stop comparing">${icon('x')}</button>
    </span>
  `;
}

// The strip only changes when the shots array is replaced; trend extraction
// walks every loaded shot, so cache the rendered strip by array identity.
let trendStripCache: { source: ShotRecord[]; html: string } | null = null;

function renderTrendStrip(shots: ShotRecord[]): string {
  if (trendStripCache?.source === shots) return trendStripCache.html;
  const rows = buildShotTrends(shots);
  const html =
    rows.length === 0
      ? '<div class="shot-trends"><p class="trend-note">Not enough recorded shots to chart trends.</p></div>'
      : `
    <div class="shot-trends">
      <div class="trend-grid">${rows.map(renderTrendRow).join('')}</div>
      <p class="trend-note">Oldest → newest · ${trendShotCount(rows)} loaded shot${trendShotCount(rows) === 1 ? '' : 's'}</p>
    </div>
  `;
  trendStripCache = { source: shots, html };
  return html;
}

function trendShotCount(rows: ShotTrendRow[]): number {
  return Math.max(...rows.map((row) => row.points.length));
}

function renderTrendRow(row: ShotTrendRow): string {
  const range =
    row.min === row.max
      ? `${trendValue(row.min, row.decimals)}${row.unit}`
      : `${trendValue(row.min, row.decimals)}–${trendValue(row.max, row.decimals)}${row.unit}`;
  return `
    <div class="trend-row">
      <span class="trend-label">${escapeHtml(row.label)}</span>
      ${trendSparkline(row)}
      <span class="trend-values">
        <strong class="trend-latest">${escapeHtml(`${trendValue(row.latest, row.decimals)}${row.unit}`)}</strong>
        <span class="trend-range">${escapeHtml(range)}</span>
      </span>
    </div>
  `;
}

const SPARK_WIDTH = 120;
const SPARK_HEIGHT = 30;
const SPARK_PAD = 3;

function trendSparkline(row: ShotTrendRow): string {
  const span = row.max - row.min;
  const innerWidth = SPARK_WIDTH - SPARK_PAD * 2;
  const innerHeight = SPARK_HEIGHT - SPARK_PAD * 2;
  const points = row.points
    .map((point, index) => {
      const x = SPARK_PAD + (row.points.length === 1 ? innerWidth / 2 : (index * innerWidth) / (row.points.length - 1));
      const y =
        span === 0 ? SPARK_HEIGHT / 2 : SPARK_PAD + innerHeight - ((point.value - row.min) / span) * innerHeight;
      return `${round1(x)},${round1(y)}`;
    })
    .join(' ');
  return `
    <svg class="trend-spark" viewBox="0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}" preserveAspectRatio="none" aria-hidden="true">
      <polyline points="${points}" vector-effect="non-scaling-stroke" />
    </svg>
  `;
}

function trendValue(value: number, decimals: number): string {
  const text = value.toFixed(decimals);
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
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
  const seconds = shotDurationSeconds(shot);
  return seconds == null ? null : `${Math.round(seconds)}s`;
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
