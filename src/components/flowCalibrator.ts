import type { ShotRecord } from '../api/types';
import { icon } from './icons';

export const FLOW_CALIBRATION_MIN = 0.13;
export const FLOW_CALIBRATION_MAX = 2;
export const FLOW_CALIBRATION_STEP = 0.01;

// Per-shot flow calibration, modelled on the DE1 app's Graphical Flow Calibrator
// (GFC): the machine estimates how much water it pushed, and we compare that to
// what actually landed in the cup. If the machine consistently reads high or low,
// the global `calibration_flow_multiplier` nudges its flow estimate back in line.
//
// machineVolume = integral of the machine's reported flow over the shot (mL).
// cupWeight     = what the cup actually weighed (g) — a scale trace if the shot
//                 has one, otherwise the recorded yield.
// suggested     = baseMultiplier * (cupWeight / machineVolume), clamped to the
//                 DE1's slider bounds. The recorded flow already reflects whatever
//                 multiplier was active when the shot was pulled, so we scale
//                 relative to that base — captured before any change this visit so
//                 applying a shot doesn't shift the other shots' suggestions.
export interface ShotCalibration {
  machineVolume: number | null;
  cupWeight: number | null;
  weightSource: 'scale' | 'yield' | null;
  ratio: number | null;
  baseMultiplier: number;
  suggestedMultiplier: number | null;
  durationSeconds: number | null;
}

export function analyzeShotCalibration(
  shot: ShotRecord | null,
  baseMultiplier: number
): ShotCalibration {
  const base = roundCalibration(
    Number.isFinite(baseMultiplier) && baseMultiplier > 0 ? baseMultiplier : 1
  );
  const { volume, duration } = machineFlowVolume(shot);
  const { weight, source } = cupWeight(shot);
  const ratio =
    volume != null && volume > 0 && weight != null && weight > 0 ? weight / volume : null;
  const suggestedMultiplier = ratio == null ? null : roundCalibration(clampCalibration(base * ratio));
  return {
    machineVolume: volume,
    cupWeight: weight,
    weightSource: source,
    ratio,
    baseMultiplier: base,
    suggestedMultiplier,
    durationSeconds: duration
  };
}

// Trapezoidal integral of machine flow against real wall-clock time. Gaps in the
// trace (a dropped sample, a paused shot) are skipped rather than bridged so a
// missing chunk doesn't inflate the estimate.
function machineFlowVolume(shot: ShotRecord | null): {
  volume: number | null;
  duration: number | null;
} {
  const measurements = shot?.measurements ?? [];
  let volume = 0;
  let intervals = 0;
  let firstT: number | null = null;
  let lastT: number | null = null;
  let prevT: number | null = null;
  let prevFlow: number | null = null;
  for (const measurement of measurements) {
    const t = parseMs(measurement.machine?.timestamp);
    const flow = numberFrom(measurement.machine, 'flow');
    if (t == null || flow == null) {
      prevT = null;
      prevFlow = null;
      continue;
    }
    if (firstT == null) firstT = t;
    lastT = t;
    if (prevT != null && prevFlow != null) {
      const dt = (t - prevT) / 1000;
      if (dt > 0 && dt < 30) {
        volume += ((flow + prevFlow) / 2) * dt;
        intervals += 1;
      }
    }
    prevT = t;
    prevFlow = flow;
  }
  const duration = firstT != null && lastT != null ? (lastT - firstT) / 1000 : null;
  return { volume: intervals > 0 ? volume : null, duration };
}

function cupWeight(shot: ShotRecord | null): {
  weight: number | null;
  source: 'scale' | 'yield' | null;
} {
  let maxWeight: number | null = null;
  for (const measurement of shot?.measurements ?? []) {
    const weight = measurement.scale ? numberFrom(measurement.scale, 'weight') : null;
    if (weight != null && (maxWeight == null || weight > maxWeight)) maxWeight = weight;
  }
  if (maxWeight != null && maxWeight > 0) return { weight: roundTenth(maxWeight), source: 'scale' };
  const yieldWeight = shot?.annotations?.actualYield;
  if (typeof yieldWeight === 'number' && Number.isFinite(yieldWeight) && yieldWeight > 0) {
    return { weight: roundTenth(yieldWeight), source: 'yield' };
  }
  return { weight: null, source: null };
}

export function renderFlowCalibrator(
  shots: ShotRecord[],
  savedMultiplier: number,
  baseMultiplier: number,
  draftMultiplier: number,
  selectedShotId: string | null,
  busy: boolean
): string {
  const saved = roundCalibration(savedMultiplier);
  const base = roundCalibration(baseMultiplier);
  const draft = roundCalibration(draftMultiplier);
  const dirty = draft !== saved;
  const selected = shots.find((shot) => shot.id === selectedShotId) ?? shots[0] ?? null;

  return `
    <main class="page-body flow-cal-page">
      <header class="flow-cal-head">
        <div class="flow-cal-current">
          <span class="flow-cal-current-label">Flow calibration</span>
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
            ><span>${escapeHtml(formatMultiplier(draft))}</span></button>
            <button type="button" data-action="flow-cal-adjust" data-delta="0.01" aria-label="Increase flow calibration">${icon('plus')}</button>
          </div>
          ${
            dirty
              ? `<button type="button" class="text-button flow-cal-save" data-action="flow-cal-save-preview" data-value="${draft}" ${busy ? 'disabled' : ''}>${icon('save')}<span>Save ${escapeHtml(formatMultiplier(draft))}</span></button>`
              : '<small class="flow-cal-control-note">Active on the machine</small>'
          }
        </div>
        <p class="flow-cal-explain">Each shot weighs what the machine measured against what reached the cup. Apply a shot to correct the flow reading.</p>
      </header>
      <div class="flow-cal-split">
        <div class="flow-cal-list">
          ${
            shots.length === 0
              ? '<p class="flow-cal-empty-list">No shots yet for this bean.</p>'
              : shots.map((shot) => renderShotRow(shot, saved, base, shot.id === selected?.id, busy)).join('')
          }
        </div>
        <div class="flow-cal-detail">
          ${selected ? renderShotDetail(selected, saved, base, busy) : '<p class="flow-cal-empty">Select a shot to calibrate from.</p>'}
        </div>
      </div>
    </main>
  `;
}

function renderShotRow(
  shot: ShotRecord,
  savedMultiplier: number,
  baseMultiplier: number,
  active: boolean,
  busy: boolean
): string {
  const analysis = analyzeShotCalibration(shot, baseMultiplier);
  const suggested = analysis.suggestedMultiplier;
  const canApply = suggested != null && suggested !== savedMultiplier && !busy;
  return `
    <article class="flow-cal-shot ${active ? 'active' : ''}">
      <button type="button" class="flow-cal-shot-pick" data-action="flow-cal-shot" data-id="${escapeAttr(shot.id)}" aria-pressed="${active}">
        <span class="flow-cal-shot-meta">
          <span>${escapeHtml(dateLabel(shot.timestamp))}</span>
          <strong>${escapeHtml(recipeLabel(shot, analysis.durationSeconds))}</strong>
          <small>${escapeHtml(profileTitle(shot))}</small>
        </span>
        <span class="flow-cal-shot-cal">
          <small>suggested</small>
          <strong>${suggested == null ? '—' : escapeHtml(formatMultiplier(suggested))}</strong>
        </span>
      </button>
      <button
        type="button"
        class="flow-cal-apply"
        data-action="flow-cal-apply"
        data-value="${suggested ?? ''}"
        ${canApply ? '' : 'disabled'}
      >${suggested != null && suggested === savedMultiplier ? 'Active' : 'Apply'}</button>
    </article>
  `;
}

function renderShotDetail(
  shot: ShotRecord,
  savedMultiplier: number,
  baseMultiplier: number,
  busy: boolean
): string {
  const analysis = analyzeShotCalibration(shot, baseMultiplier);
  const suggested = analysis.suggestedMultiplier;
  const sourceLabel =
    analysis.weightSource === 'scale' ? 'scale' : analysis.weightSource === 'yield' ? 'yield' : '';
  return `
    <div class="flow-cal-detail-head">
      <strong>${escapeHtml(recipeLabel(shot, analysis.durationSeconds))}</strong>
      <span>${escapeHtml(profileTitle(shot))}</span>
      <span>${escapeHtml(dateLabel(shot.timestamp))}</span>
    </div>
    <div class="flow-cal-detail-chart">
      <canvas id="flow-cal-canvas" class="live-canvas detail-canvas"></canvas>
    </div>
    <dl class="flow-cal-breakdown">
      <div>
        <dt>Machine measured</dt>
        <dd>${analysis.machineVolume == null ? '—' : `${analysis.machineVolume.toFixed(1)} mL`}</dd>
      </div>
      <div>
        <dt>In the cup</dt>
        <dd>${analysis.cupWeight == null ? '—' : `${analysis.cupWeight.toFixed(1)} g`}${sourceLabel ? ` <small>(${sourceLabel})</small>` : ''}</dd>
      </div>
      <div>
        <dt>Current</dt>
        <dd>${escapeHtml(formatMultiplier(savedMultiplier))}</dd>
      </div>
      <div class="flow-cal-breakdown-suggest">
        <dt>Suggested</dt>
        <dd>${suggested == null ? '—' : escapeHtml(formatMultiplier(suggested))}</dd>
      </div>
    </dl>
    ${
      suggested == null
        ? '<p class="flow-cal-detail-note">Add a final weight (or pull this shot on a connected scale) to calibrate from it.</p>'
        : `<button type="button" class="command primary flow-cal-apply-big" data-action="flow-cal-apply" data-value="${suggested}" ${suggested === savedMultiplier || busy ? 'disabled' : ''}>${icon('check')}<span>${suggested === savedMultiplier ? 'Already applied' : `Apply ${formatMultiplier(suggested)}`}</span></button>`
    }
  `;
}

export function clampCalibration(value: number): number {
  return Math.max(FLOW_CALIBRATION_MIN, Math.min(FLOW_CALIBRATION_MAX, value));
}

export function roundCalibration(value: number): number {
  return Number(clampCalibration(value).toFixed(2));
}

function recipeLabel(shot: ShotRecord, durationSeconds: number | null): string {
  const context = shot.workflow?.context;
  const dose = firstNumber(shot.annotations?.actualDoseWeight, context?.targetDoseWeight);
  const yieldWeight = firstNumber(shot.annotations?.actualYield, context?.targetYield);
  const recipe = `${formatGrams(dose)} → ${formatGrams(yieldWeight)}`;
  return durationSeconds && durationSeconds > 0 ? `${recipe} @ ${Math.round(durationSeconds)}s` : recipe;
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

function roundTenth(value: number): number {
  return Math.round(value * 10) / 10;
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
