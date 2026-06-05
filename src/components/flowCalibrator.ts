import type { ShotMeasurement, ShotRecord } from '../api/types';
import { icon } from './icons';

export const FLOW_CALIBRATION_MIN = 0.13;
export const FLOW_CALIBRATION_MAX = 2;
export const FLOW_CALIBRATION_STEP = 0.01;

export interface FlowCalibrationSample {
  t: number;
  machineFlow: number | null;
  scaleFlow: number | null;
}

export interface FlowCalibrationAnalysis {
  shot: ShotRecord | null;
  samples: FlowCalibrationSample[];
  tailStart: number | null;
  averageMachineFlow: number | null;
  averageScaleFlow: number | null;
  ratio: number | null;
  suggestedMultiplier: number | null;
  confidence: 'none' | 'low' | 'medium' | 'high';
  message: string;
}

const FLOW_COLOR = '#7ca8ff';
const SCALE_FLOW_COLOR = '#8a6d1c';

export function calibrationShotCandidate(shot: ShotRecord): boolean {
  return analyzeFlowCalibration(shot, 1).suggestedMultiplier != null;
}

export function analyzeFlowCalibration(
  shot: ShotRecord | null,
  baseMultiplier: number,
  previewMultiplier = baseMultiplier,
  tailSeconds = 8
): FlowCalibrationAnalysis {
  const scale = multiplierScale(baseMultiplier, previewMultiplier);
  const samples = calibrationSamples(shot?.measurements ?? []).map((sample) => ({
    ...sample,
    machineFlow: sample.machineFlow == null ? null : sample.machineFlow * scale
  }));
  const paired = pairedSamples(samples);
  const maxTime = Math.max(0, ...paired.map((sample) => sample.t));
  const tailStart = paired.length ? Math.max(0, maxTime - tailSeconds) : null;
  const tailPaired = tailStart == null ? [] : paired.filter((sample) => sample.t >= tailStart);
  const stablePaired = tailPaired.length >= 3 ? tailPaired : paired;
  const averageMachineFlow = average(stablePaired.map((sample) => sample.machineFlow!));
  const averageScaleFlow = average(stablePaired.map((sample) => sample.scaleFlow!));
  const ratio =
    averageMachineFlow != null && averageMachineFlow > 0 && averageScaleFlow != null
      ? averageScaleFlow / averageMachineFlow
      : null;
  const suggestedMultiplier =
    ratio == null ? null : roundCalibration(clampCalibration(previewMultiplier * ratio));
  const confidence = confidenceFor(stablePaired.length, ratio);
  return {
    shot,
    samples,
    tailStart,
    averageMachineFlow,
    averageScaleFlow,
    ratio,
    suggestedMultiplier,
    confidence,
    message: analysisMessage(confidence, ratio)
  };
}

function pairedSamples(samples: FlowCalibrationSample[]): FlowCalibrationSample[] {
  return samples.filter(
    (sample) =>
      sample.machineFlow != null &&
      sample.scaleFlow != null &&
      sample.machineFlow >= 0.1 &&
      sample.scaleFlow >= 0.1
  );
}

function multiplierScale(baseMultiplier: number, previewMultiplier: number): number {
  if (!Number.isFinite(baseMultiplier) || baseMultiplier <= 0) return 1;
  return previewMultiplier / baseMultiplier;
}

export function renderFlowCalibrator(
  analysis: FlowCalibrationAnalysis,
  savedMultiplier: number,
  previewMultiplier: number,
  referenceShots: ShotRecord[],
  busy: boolean
): string {
  const suggested = analysis.suggestedMultiplier;
  const saveDisabled = previewMultiplier === roundCalibration(savedMultiplier);
  const selectedShot = analysis.shot;
  const latestLabel = selectedShot
    ? `${dateLabel(selectedShot.timestamp)} · ${selectedShot.workflow?.profile?.title ?? 'Untitled shot'}`
    : 'No shot data yet';
  const tailLabel = analysis.tailStart == null ? '--' : `${analysis.tailStart.toFixed(1)}s → end`;

  return `
    <main class="page-body flow-cal-page">
      <section class="flow-cal-layout">
        <div class="flow-cal-main">
          <section class="flow-cal-chart-panel">
            <div class="flow-cal-chart-head">
              <div>
                <span class="eyebrow">Flow calibration</span>
                <h2>${escapeHtml(formatMultiplier(previewMultiplier))}</h2>
              </div>
              <div class="flow-cal-result ${analysis.confidence}">
                <span>tail match</span>
                <strong>${escapeHtml(suggested == null ? '--' : formatMultiplier(suggested))}</strong>
              </div>
            </div>
            ${renderFlowCalibrationSvg(analysis)}
            <div class="flow-cal-legend">
              <span><i class="machine"></i>Machine flow</span>
              <span><i class="scale"></i>Scale flow</span>
            </div>
          </section>
          <section class="flow-cal-readouts">
            ${readout('Reference shot', latestLabel, 'Selected from shot history')}
            ${readout('Tail window', tailLabel, 'Use the stable tail where flow should match weight flow')}
            ${readout('Machine tail', flowText(analysis.averageMachineFlow, 'ml/s'), 'Preview-adjusted DE1 flow')}
            ${readout('Scale tail', flowText(analysis.averageScaleFlow, 'g/s'), 'Bluetooth scale weight flow')}
          </section>
        </div>
        <aside class="flow-cal-side">
          <section class="flow-cal-reference">
            <h2>Reference shots</h2>
            <div class="flow-cal-shot-list">
              ${renderReferenceShots(referenceShots, selectedShot)}
            </div>
          </section>
          <section class="flow-cal-controls">
            <div class="flow-cal-stepper" aria-label="Flow calibration preview">
              <button type="button" data-action="flow-cal-adjust" data-delta="-0.01" aria-label="Decrease flow calibration">${icon('minus')}</button>
              <button
                type="button"
                class="settings-input number-edit-button flow-cal-number"
                data-action="open-number-edit"
                data-target="flow-calibration"
                data-title="Flow calibration preview"
                data-value="${escapeAttr(String(previewMultiplier))}"
                data-min="${FLOW_CALIBRATION_MIN}"
                data-max="${FLOW_CALIBRATION_MAX}"
                data-step="${FLOW_CALIBRATION_STEP}"
                data-unit="x"
              >
                <span>${escapeHtml(formatMultiplier(previewMultiplier))}</span>
              </button>
              <button type="button" data-action="flow-cal-adjust" data-delta="0.01" aria-label="Increase flow calibration">${icon('plus')}</button>
            </div>
            <button type="button" class="text-button" data-action="flow-cal-auto" data-value="${suggested ?? ''}" ${suggested == null || busy ? 'disabled' : ''}>
              ${icon('sliders-horizontal')}<span>Auto align</span>
            </button>
            <button type="button" class="text-button" data-action="flow-cal-save-preview" data-value="${previewMultiplier}" ${saveDisabled || busy ? 'disabled' : ''}>
              ${icon('save')}<span>Save preview</span>
            </button>
            <small class="flow-cal-control-note">Saved ${escapeHtml(formatMultiplier(savedMultiplier))} · preview only until saved</small>
          </section>
        </aside>
      </section>
    </main>
  `;
}

export function renderFlowCalibrationSvg(analysis: FlowCalibrationAnalysis): string {
  const width = 880;
  const height = 330;
  const plot = { x: 46, y: 24, width: width - 68, height: height - 70 };
  if (analysis.samples.length === 0) {
    return `<svg class="flow-cal-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="No flow calibration data">
      <rect class="flow-cal-plot" x="${plot.x}" y="${plot.y}" width="${plot.width}" height="${plot.height}" />
      <text class="flow-cal-empty" x="${width / 2}" y="${height / 2}">Choose a shot with machine and scale flow</text>
    </svg>`;
  }

  const maxTime = Math.max(1, ...analysis.samples.map((sample) => sample.t));
  const maxFlow = Math.max(
    4,
    ...analysis.samples.flatMap((sample) => [sample.machineFlow ?? 0, sample.scaleFlow ?? 0])
  );
  const xFor = (t: number) => plot.x + (t / maxTime) * plot.width;
  const yFor = (flow: number) => plot.y + (1 - Math.max(0, Math.min(1, flow / maxFlow))) * plot.height;
  const machine = tracePath(analysis.samples, 'machineFlow', xFor, yFor);
  const scale = tracePath(analysis.samples, 'scaleFlow', xFor, yFor);
  const xTicks = [0, maxTime / 4, maxTime / 2, (maxTime * 3) / 4, maxTime];
  const yTicks = [0, maxFlow / 4, maxFlow / 2, (maxFlow * 3) / 4, maxFlow];

  return `<svg class="flow-cal-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Flow calibration chart">
    <rect class="flow-cal-plot" x="${plot.x}" y="${plot.y}" width="${plot.width}" height="${plot.height}" />
    ${analysis.tailStart == null ? '' : `<rect class="flow-cal-tail" x="${xFor(analysis.tailStart).toFixed(1)}" y="${plot.y}" width="${(plot.x + plot.width - xFor(analysis.tailStart)).toFixed(1)}" height="${plot.height}" />`}
    ${xTicks.map((tick) => `<line class="flow-cal-grid" x1="${xFor(tick).toFixed(1)}" y1="${plot.y}" x2="${xFor(tick).toFixed(1)}" y2="${plot.y + plot.height}" />`).join('')}
    ${yTicks.map((tick) => `<line class="flow-cal-grid" x1="${plot.x}" y1="${yFor(tick).toFixed(1)}" x2="${plot.x + plot.width}" y2="${yFor(tick).toFixed(1)}" />`).join('')}
    ${xTicks.map((tick) => `<text class="flow-cal-axis" x="${xFor(tick).toFixed(1)}" y="${height - 18}" text-anchor="middle">${formatTick(tick)}s</text>`).join('')}
    ${yTicks.map((tick) => `<text class="flow-cal-axis" x="${plot.x - 10}" y="${(yFor(tick) + 4).toFixed(1)}" text-anchor="end">${formatTick(tick)}</text>`).join('')}
    ${machine ? `<path class="flow-cal-machine" d="${machine}" />` : ''}
    ${scale ? `<path class="flow-cal-scale" d="${scale}" />` : ''}
  </svg>`;
}

function calibrationSamples(measurements: ShotMeasurement[]): FlowCalibrationSample[] {
  const first = firstTimestamp(measurements);
  return measurements.flatMap((measurement, index) => {
    const timestamp = timestampFor(measurement.machine.timestamp) ?? first;
    const t = first == null || timestamp == null ? index : Math.max(0, (timestamp - first) / 1000);
    const machineFlow = numberFrom(measurement.machine, 'flow');
    const scaleFlow = measurement.scale ? numberFrom(measurement.scale, 'weightFlow') : null;
    if (machineFlow == null && scaleFlow == null) return [];
    return [{ t, machineFlow, scaleFlow }];
  });
}

function firstTimestamp(measurements: ShotMeasurement[]): number | null {
  for (const measurement of measurements) {
    const timestamp = timestampFor(measurement.machine.timestamp) ?? timestampFor(measurement.scale?.timestamp);
    if (timestamp != null) return timestamp;
  }
  return null;
}

function timestampFor(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function numberFrom(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const trim = Math.floor(sorted.length * 0.1);
  const kept = sorted.slice(trim, sorted.length - trim);
  const usable = kept.length ? kept : sorted;
  return usable.reduce((sum, value) => sum + value, 0) / usable.length;
}

function confidenceFor(sampleCount: number, ratio: number | null): FlowCalibrationAnalysis['confidence'] {
  if (ratio == null) return 'none';
  if (sampleCount < 8) return 'low';
  if (sampleCount < 30) return 'medium';
  return 'high';
}

function analysisMessage(confidence: FlowCalibrationAnalysis['confidence'], ratio: number | null): string {
  if (confidence === 'none') return 'Need a shot with both machine flow and scale flow.';
  if (confidence === 'low') return 'Only a small overlap was found; choose a longer shot if one is available.';
  if (ratio != null && Math.abs(1 - ratio) <= 0.03) return 'The two traces are already close.';
  return 'Suggested multiplier is current value adjusted by scale flow divided by machine flow.';
}

export function clampCalibration(value: number): number {
  return Math.max(FLOW_CALIBRATION_MIN, Math.min(FLOW_CALIBRATION_MAX, value));
}

export function roundCalibration(value: number): number {
  return Number(clampCalibration(value).toFixed(2));
}

function tracePath(
  samples: FlowCalibrationSample[],
  key: 'machineFlow' | 'scaleFlow',
  xFor: (value: number) => number,
  yFor: (value: number) => number
): string {
  const runs: string[] = [];
  let current: string[] = [];
  for (const sample of samples) {
    const value = sample[key];
    if (value == null) {
      if (current.length > 1) runs.push(`M${current.join('L')}`);
      current = [];
      continue;
    }
    current.push(`${xFor(sample.t).toFixed(1)} ${yFor(value).toFixed(1)}`);
  }
  if (current.length > 1) runs.push(`M${current.join('L')}`);
  return runs.join('');
}

function readout(label: string, value: string, detail: string): string {
  return `
    <div class="flow-cal-readout">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(detail)}</small>
    </div>`;
}

function renderReferenceShots(shots: ShotRecord[], selectedShot: ShotRecord | null): string {
  if (shots.length === 0) return '<p class="flow-cal-empty-list">No loaded shots have scale flow yet.</p>';
  return shots
    .map((shot) => {
      const active = shot.id === selectedShot?.id;
      const title = shot.workflow?.profile?.title ?? 'Untitled shot';
      const yieldText = shot.annotations?.actualYield == null ? '' : ` · ${shot.annotations.actualYield.toFixed(1)}g`;
      return `
        <button type="button" class="flow-cal-shot ${active ? 'active' : ''}" data-action="flow-cal-shot" data-id="${escapeAttr(shot.id)}" aria-pressed="${active}">
          <span>${escapeHtml(dateLabel(shot.timestamp))}</span>
          <strong>${escapeHtml(title)}</strong>
          <small>${escapeHtml(`${shot.measurements.length} frames${yieldText}`)}</small>
        </button>`;
    })
    .join('');
}

function flowText(value: number | null, unit: string): string {
  return value == null ? '--' : `${value.toFixed(2)} ${unit}`;
}

function formatMultiplier(value: number): string {
  return `${roundCalibration(value).toFixed(2)}x`;
}

function formatTick(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function dateLabel(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Date(timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
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

export const flowCalibrationColors = {
  machine: FLOW_COLOR,
  scale: SCALE_FLOW_COLOR
};
