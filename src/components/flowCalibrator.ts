import type { ShotRecord } from '../api/types';
import { icon } from './icons';

export const FLOW_CALIBRATION_MIN = 0.13;
export const FLOW_CALIBRATION_MAX = 2;
export const FLOW_CALIBRATION_STEP = 0.01;

// The flow calibration is a fully manual tool, modelled on the DE1 app's
// Graphical Flow Calibrator (GFC): pick a past shot pulled on a scale, then use
// −/+ to scale the machine's flow trace until the blue machine-flow line sits on
// top of the brown scale-flow line ("until the blue and brown lines follow each
// other"). There is no automatic suggestion — the machine's estimated volume
// can't be compared against the cup weight, since some water stays in the puck.
// Only the flow *rates* are comparable, which is what the chart shows.

// Factor the displayed machine-flow trace is multiplied by. The recorded flow
// already embeds the multiplier the shot was pulled under (base), so previewing
// at `draft` means drawing recorded * (draft / base).
export function calibrationPreviewFactor(baseMultiplier: number, draftMultiplier: number): number {
  const base = Number.isFinite(baseMultiplier) && baseMultiplier > 0 ? baseMultiplier : 1;
  const draft = Number.isFinite(draftMultiplier) && draftMultiplier > 0 ? draftMultiplier : base;
  return draft / base;
}

export function renderFlowCalibrator(
  shots: ShotRecord[],
  savedMultiplier: number,
  draftMultiplier: number,
  selectedShotId: string | null,
  busy: boolean
): string {
  const saved = roundCalibration(savedMultiplier);
  const draft = roundCalibration(draftMultiplier);
  const dirty = draft !== saved;
  const selected = shots.find((shot) => shot.id === selectedShotId) ?? shots[0] ?? null;

  return `
    <main class="page-body flow-cal-page">
      <header class="flow-cal-head">
        <p class="flow-cal-explain">Pick a shot pulled on a scale, then use −/+ to scale the <b class="flow-cal-ink-machine">machine flow</b> line until it sits on the <b class="flow-cal-ink-scale">scale flow</b> line. Fully manual — there's no auto-suggestion, since some water stays in the puck.</p>
      </header>
      <div class="flow-cal-split">
        <div class="flow-cal-list">
          ${
            shots.length === 0
              ? '<p class="flow-cal-empty-list">No shots yet for this bean.</p>'
              : shots.map((shot) => renderShotRow(shot, shot.id === selected?.id)).join('')
          }
        </div>
        <div class="flow-cal-detail">
          ${selected ? renderShotDetail(selected, saved, draft, dirty, busy) : '<p class="flow-cal-empty">Select a shot to calibrate against.</p>'}
        </div>
      </div>
    </main>
  `;
}

function renderShotRow(shot: ShotRecord, active: boolean): string {
  const recorded = recordedFlowMultiplier(shot);
  const tags = [
    recorded == null
      ? ''
      : `<span class="flow-cal-shot-base" title="Flow calibration active when this shot was pulled">${escapeHtml(formatMultiplier(recorded))}</span>`,
    hasScaleFlow(shot) ? '' : '<span class="flow-cal-shot-noscale">no scale</span>'
  ]
    .filter(Boolean)
    .join('');
  return `
    <article class="flow-cal-shot ${active ? 'active' : ''}">
      <button type="button" class="flow-cal-shot-pick" data-action="flow-cal-shot" data-id="${escapeAttr(shot.id)}" aria-pressed="${active}">
        <span class="flow-cal-shot-meta">
          <span>${escapeHtml(dateLabel(shot.timestamp))}</span>
          <strong>${escapeHtml(recipeLabel(shot))}</strong>
          <small>${escapeHtml(profileTitle(shot))}</small>
        </span>
        ${tags ? `<span class="flow-cal-shot-tags">${tags}</span>` : ''}
      </button>
    </article>
  `;
}

function renderShotDetail(
  shot: ShotRecord,
  savedMultiplier: number,
  draftMultiplier: number,
  dirty: boolean,
  busy: boolean
): string {
  const recorded = recordedFlowMultiplier(shot);
  return `
    <div class="flow-cal-detail-head">
      <strong>${escapeHtml(recipeLabel(shot))}</strong>
      <span>${escapeHtml(profileTitle(shot))}</span>
      <span>${escapeHtml(dateLabel(shot.timestamp))}</span>
      ${recorded == null ? '' : `<span class="flow-cal-detail-base" title="The machine's flow calibration when this shot was pulled — the chart scales the machine line from here">pulled at ${escapeHtml(formatMultiplier(recorded))}</span>`}
    </div>
    <div class="flow-cal-detail-chart">
      <canvas id="flow-cal-canvas" class="live-canvas detail-canvas"></canvas>
    </div>
    <div class="flow-cal-controls">
      <div class="flow-cal-stepper" aria-label="Flow calibration multiplier">
        <button type="button" data-action="flow-cal-adjust" data-delta="-0.01" aria-label="Decrease flow calibration">${icon('minus')}</button>
        <button
          type="button"
          class="settings-input number-edit-button flow-cal-number"
          data-action="open-number-edit"
          data-target="flow-calibration"
          data-title="Flow calibration"
          data-value="${escapeAttr(String(draftMultiplier))}"
          data-min="${FLOW_CALIBRATION_MIN}"
          data-max="${FLOW_CALIBRATION_MAX}"
          data-step="${FLOW_CALIBRATION_STEP}"
          data-unit="x"
        ><span>${escapeHtml(formatMultiplierPlain(draftMultiplier))}</span></button>
        <button type="button" data-action="flow-cal-adjust" data-delta="0.01" aria-label="Increase flow calibration">${icon('plus')}</button>
      </div>
      ${
        dirty
          ? `<button type="button" class="flow-cal-save" data-action="flow-cal-save-preview" data-value="${draftMultiplier}" ${busy ? 'disabled' : ''}>${icon('save')}<span>Save ${escapeHtml(formatMultiplierPlain(draftMultiplier))}</span></button>`
          : `<small class="flow-cal-control-note">${escapeHtml(formatMultiplier(savedMultiplier))} active on the machine</small>`
      }
    </div>
  `;
}

export function clampCalibration(value: number): number {
  return Math.max(FLOW_CALIBRATION_MIN, Math.min(FLOW_CALIBRATION_MAX, value));
}

export function roundCalibration(value: number): number {
  return Number(clampCalibration(value).toFixed(2));
}

// The flow calibration the machine was running when this shot was pulled, if it
// was recorded. Reaprime stamps it into annotations.extras (and, via its legacy
// fallback, top-level metadata) as `flowCalibrationMultiplier`. Returns null for
// shots from a reaprime without that patch — callers fall back to an estimate.
export function recordedFlowMultiplier(shot: ShotRecord): number | null {
  return (
    coerceMultiplier(shot.annotations?.extras?.['flowCalibrationMultiplier']) ??
    coerceMultiplier(shot.metadata?.['flowCalibrationMultiplier'])
  );
}

function coerceMultiplier(value: unknown): number | null {
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function hasScaleFlow(shot: ShotRecord): boolean {
  return (shot.measurements ?? []).some((measurement) => numberFrom(measurement.scale, 'weightFlow') != null);
}

function recipeLabel(shot: ShotRecord): string {
  const context = shot.workflow?.context;
  const dose = firstNumber(shot.annotations?.actualDoseWeight, context?.targetDoseWeight);
  const yieldWeight = firstNumber(shot.annotations?.actualYield, context?.targetYield);
  const duration = shotDurationSeconds(shot);
  const recipe = `${formatGrams(dose)} → ${formatGrams(yieldWeight)}`;
  return duration ? `${recipe} @ ${Math.round(duration)}s` : recipe;
}

function shotDurationSeconds(shot: ShotRecord): number | null {
  let first: number | null = null;
  let last: number | null = null;
  for (const measurement of shot.measurements ?? []) {
    const t = parseMs(measurement.machine?.timestamp);
    if (t == null) continue;
    if (first == null) first = t;
    last = t;
  }
  return first != null && last != null && last > first ? (last - first) / 1000 : null;
}

function profileTitle(shot: ShotRecord): string {
  return shot.workflow?.profile?.title ?? shot.workflow?.name ?? 'No profile';
}

function firstNumber(...values: Array<number | null | undefined>): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

function formatGrams(value: number | null): string {
  return value == null ? '—' : `${value.toFixed(1)}g`;
}

function formatMultiplier(value: number): string {
  return `${roundCalibration(value).toFixed(2)}×`;
}

function formatMultiplierPlain(value: number): string {
  return roundCalibration(value).toFixed(2);
}

function parseMs(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function numberFrom(record: Record<string, unknown> | null | undefined, key: string): number | null {
  if (!record) return null;
  const value = record[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function dateLabel(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}
