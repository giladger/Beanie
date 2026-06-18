import type { ShotRecord } from '../api/types';
import { escapeAttr, escapeHtml } from './html';
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

export interface FlowCalibratorModel {
  /** The previewed multiplier currently driving the chart. */
  draft: number;
  /** The global default — the value profiles without an override follow. */
  global: number;
  /** The machine's live multiplier right now. */
  active: number;
  /** The selected shot's profile title, or null when the shot has none. */
  profileTitle: string | null;
  /** This profile's stored override, or null when it follows the global. */
  profileOverride: number | null;
  selectedShotId: string | null;
}

export function renderFlowCalibrator(
  shots: ShotRecord[],
  model: FlowCalibratorModel,
  busy: boolean
): string {
  const selected = shots.find((shot) => shot.id === model.selectedShotId) ?? shots[0] ?? null;

  return `
    <main class="page-body flow-cal-page">
      <header class="flow-cal-head">
        <p class="flow-cal-explain">Pick a shot pulled on a scale, then use −/+ to scale the <b class="flow-cal-ink-machine">machine flow</b> line until it sits on the <b class="flow-cal-ink-scale">scale flow</b> line. Save it as the <b>default</b>, or just for <b>this shot's profile</b> — a per-profile value overrides the default whenever that profile is used. Changing the default leaves profiles with their own value untouched.</p>
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
          ${selected ? renderShotDetail(selected, model, busy) : '<p class="flow-cal-empty">Select a shot to calibrate against.</p>'}
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

function renderShotDetail(shot: ShotRecord, model: FlowCalibratorModel, busy: boolean): string {
  const recorded = recordedFlowMultiplier(shot);
  const draft = roundCalibration(model.draft);
  const global = roundCalibration(model.global);
  const active = roundCalibration(model.active);
  const title = model.profileTitle;
  const override = model.profileOverride == null ? null : roundCalibration(model.profileOverride);
  const effectiveProfile = override ?? global;
  const globalDirty = draft !== global;
  const profileDirty = title != null && draft !== effectiveProfile;
  // Saving the global value as this profile's override clears it (reverts to global).
  const clearsOverride = profileDirty && override != null && draft === global;
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
      <div class="flow-cal-scopes">
        <span class="flow-cal-scope"><small>default</small><strong>${escapeHtml(formatMultiplier(global))}</strong></span>
        ${
          title == null
            ? ''
            : `<span class="flow-cal-scope ${override == null ? '' : 'has-override'}"><small>${escapeHtml(title)}</small><strong>${override == null ? 'follows default' : escapeHtml(formatMultiplier(override))}</strong></span>`
        }
      </div>
      <div class="flow-cal-actions">
        <div class="flow-cal-stepper" aria-label="Flow calibration multiplier">
          <button type="button" data-action="flow-cal-adjust" data-delta="-0.01" aria-label="Decrease flow calibration">${icon('minus')}</button>
          <button
            type="button"
            class="settings-input number-edit-button flow-cal-number"
            data-action="open-number-edit"
            data-target="flow-calibration"
            data-title="Flow calibration"
            data-value="${escapeAttr(String(draft))}"
            data-min="${FLOW_CALIBRATION_MIN}"
            data-max="${FLOW_CALIBRATION_MAX}"
            data-step="${FLOW_CALIBRATION_STEP}"
            data-unit="x"
          ><span>${escapeHtml(formatMultiplierPlain(draft))}</span></button>
          <button type="button" data-action="flow-cal-adjust" data-delta="0.01" aria-label="Increase flow calibration">${icon('plus')}</button>
        </div>
        <div class="flow-cal-saves">
          <button type="button" class="flow-cal-save" data-action="flow-cal-save-global" data-value="${draft}" ${globalDirty && !busy ? '' : 'disabled'}>${icon('save')}<span>Save as default</span></button>
          ${
            title == null
              ? ''
              : `<button type="button" class="flow-cal-save flow-cal-save-profile" data-action="flow-cal-save-profile" data-value="${draft}" ${profileDirty && !busy ? '' : 'disabled'}>${icon('save')}<span>${clearsOverride ? 'Clear override for' : 'Save for'} ${escapeHtml(title)}</span></button>`
          }
        </div>
      </div>
      <small class="flow-cal-control-note">${escapeHtml(formatMultiplier(active))} active on the machine</small>
    </div>
  `;
}

// The profile title used to key a per-profile override — strictly the recorded
// profile title (no "No profile" / workflow-name fallback), so an override is
// only offered when there is a real title to key on and apply against later.
export function shotProfileTitle(shot: ShotRecord): string | null {
  const title = shot.workflow?.profile?.title;
  return typeof title === 'string' && title.trim() !== '' ? title.trim() : null;
}

export function clampCalibration(value: number): number {
  return Math.max(FLOW_CALIBRATION_MIN, Math.min(FLOW_CALIBRATION_MAX, value));
}

export function roundCalibration(value: number): number {
  return Number(clampCalibration(value).toFixed(2));
}

// The flow calibration the machine was running when this shot was pulled, if it
// was recorded. Reaprime snapshots it onto `workflow.machine.flowCalibration`.
// Returns null for shots without it — callers fall back to an estimate.
export function recordedFlowMultiplier(shot: ShotRecord): number | null {
  return coerceMultiplier(shot.workflow?.machine?.flowCalibration);
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
