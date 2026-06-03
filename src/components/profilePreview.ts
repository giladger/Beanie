import type { Profile } from '../api/types';

export interface ProfileStepTarget {
  pressure: number | null;
  flow: number | null;
  temperature: number | null;
  pump: string | null;
  transition: string | null;
  seconds: number;
}

type PreviewMode = 'pressure' | 'flow' | 'advanced';

export function profileStepTargets(profile: Profile | null | undefined): ProfileStepTarget[] {
  if (!profile) return [];
  const steps = profileSteps(profile);
  const mode = explicitPreviewMode(profile) ?? inferPreviewModeFromSteps(steps);
  if (mode === 'pressure' && hasScalarPressureProfile(profile)) return scalarPressureTargets(profile);
  if (mode === 'flow' && hasScalarFlowProfile(profile)) return scalarFlowTargets(profile);

  if (!steps.length) return [];
  if (mode === 'pressure') return pressureTargetsFromSteps(steps);
  if (mode === 'flow') return flowTargetsFromSteps(steps);

  return steps.map((step) => ({
    pressure: stepNumber(step, 'pressure'),
    flow: stepNumber(step, 'flow'),
    temperature: stepNumber(step, 'temperature'),
    pump: stepString(step, 'pump'),
    transition: stepString(step, 'transition'),
    seconds: Math.max(1, stepNumber(step, 'seconds') ?? 1)
  }));
}

export function renderProfilePreview(profile: Profile | null | undefined): string {
  const targets = profileStepTargets(profile);
  const width = 760;
  const height = 320;
  const plot = { x: 82, y: 38, w: 478, h: 178 };
  const mode = previewMode(profile, targets);
  const yMax = mode === 'flow' ? 10 : mode === 'advanced' ? 12 : 11.5;
  const yTicks = mode === 'flow' ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] : mode === 'advanced' ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] : [1, 3, 5, 7, 9, 11];
  if (targets.length === 0) {
    return `<svg class="profile-preview" viewBox="0 0 ${width} ${height}" role="img" aria-label="No profile preview"></svg>`;
  }

  const totalSeconds = Math.max(1, targets.reduce((sum, target) => sum + target.seconds, 0));
  // Continuous traces (no per-pump gaps) so mixed advanced profiles don't render
  // as disconnected fragments / isolated spikes; missing values read as 0.
  const pressurePath =
    mode !== 'flow' ? previewPath(targets, (t) => t.pressure ?? 0, totalSeconds, plot, yMax) : '';
  const flowPath =
    mode !== 'pressure' ? previewPath(targets, (t) => t.flow ?? 0, totalSeconds, plot, yMax) : '';
  const displayTemperature = firstNumber(targets.map((target) => target.temperature));
  const gauge = temperatureGauge(displayTemperature, { x: 640, y: 40, h: 176 });

  // Temperature is the gauge, not a line, so the only plotted lines (and the
  // legend) are the pressure/flow goals.
  const legendItems: { cls: string; label: string }[] = [];
  if (pressurePath) legendItems.push({ cls: 'pressure', label: 'pressure (bar)' });
  if (flowPath) legendItems.push({ cls: 'flow', label: 'flow (ml/s)' });
  const legend = legendItems
    .map((item, i) => {
      const lx = plot.x + i * 150;
      const ly = height - 16;
      return `<circle class="profile-preview-legend-dot ${item.cls}" cx="${lx}" cy="${ly - 4}" r="4" />
        <text class="profile-preview-legend" x="${lx + 11}" y="${ly}">${item.label}</text>`;
    })
    .join('');

  return `<svg class="profile-preview" viewBox="0 0 ${width} ${height}" role="img" aria-label="Profile target preview">
    <rect class="profile-preview-plot" x="${plot.x}" y="${plot.y}" width="${plot.w}" height="${plot.h}" rx="5" />
    ${yTicks.map((tick) => {
      const y = yFor(tick, plot, yMax);
      return `<line class="profile-preview-grid" x1="${plot.x}" x2="${plot.x + plot.w}" y1="${y}" y2="${y}" />
        <text class="profile-preview-axis" x="${plot.x - 12}" y="${y + 4}" text-anchor="end">${tick}</text>`;
    }).join('')}
    ${[0, 15, 30, 45, 60].map((tick) => {
      const x = plot.x + (tick / 60) * plot.w;
      return `<line class="profile-preview-grid vertical" x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${plot.y}" y2="${plot.y + plot.h}" />`;
    }).join('')}
    ${pressurePath ? `<path class="profile-preview-pressure" d="${pressurePath}" fill="none" />` : ''}
    ${flowPath ? `<path class="profile-preview-flow" d="${flowPath}" fill="none" />` : ''}
    ${gauge}
    ${legend}
  </svg>`;
}

function previewPath(
  targets: ProfileStepTarget[],
  pick: (target: ProfileStepTarget) => number | null,
  totalSeconds: number,
  plot: { x: number; y: number; w: number; h: number },
  yMax: number
): string {
  const segments: Array<Array<{ x: number; y: number }>> = [];
  let points: Array<{ x: number; y: number }> = [];
  let elapsed = 0;
  let previousValue: number | null = null;
  for (let i = 0; i < targets.length; i += 1) {
    const target = targets[i]!;
    const value = pick(target);
    if (value == null) {
      if (points.length > 0) segments.push(points);
      points = [];
      elapsed += target.seconds;
      previousValue = null;
      continue;
    }
    const x0 = plot.x + (elapsed / totalSeconds) * plot.w;
    if (points.length === 0) points.push({ x: x0, y: yFor(value, plot, yMax) });
    else if (target.transition === 'fast' && previousValue !== value) points.push({ x: x0, y: yFor(value, plot, yMax) });

    elapsed += target.seconds;
    points.push({ x: plot.x + (elapsed / totalSeconds) * plot.w, y: yFor(value, plot, yMax) });
    previousValue = value;
  }
  if (points.length > 0) segments.push(points);
  return segments.map(smoothPath).join('');
}

function smoothPath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M${points[0]!.x.toFixed(1)} ${points[0]!.y.toFixed(1)}`;
  let path = `M${points[0]!.x.toFixed(1)} ${points[0]!.y.toFixed(1)}`;
  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1]!;
    const current = points[i]!;
    const midX = (previous.x + current.x) / 2;
    if (previous.x === current.x || previous.y === current.y) {
      path += `L${current.x.toFixed(1)} ${current.y.toFixed(1)}`;
    } else {
      path += `Q${midX.toFixed(1)} ${previous.y.toFixed(1)} ${current.x.toFixed(1)} ${current.y.toFixed(1)}`;
    }
  }
  return path;
}

function stepNumber(step: unknown, key: string): number | null {
  if (step == null || typeof step !== 'object') return null;
  const value = (step as Record<string, unknown>)[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function stepString(step: unknown, key: string): string | null {
  if (step == null || typeof step !== 'object') return null;
  const value = (step as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function profileSteps(profile: Profile): unknown[] {
  if (Array.isArray(profile.steps)) return profile.steps;
  const advancedShot = profileValue(profile, 'advanced_shot');
  return Array.isArray(advancedShot) ? advancedShot : [];
}

function pressureTargetsFromSteps(steps: unknown[]): ProfileStepTarget[] {
  const targets: ProfileStepTarget[] = [];
  let index = 0;
  let preinfusionSeconds = 0;
  let preinfusionPressure: number | null = null;
  let preinfusionStartTemperature: number | null = null;
  let preinfusionEndTemperature: number | null = null;
  while (index < steps.length && stepString(steps[index], 'pump') === 'flow' && stepExitNumber(steps[index], 'pressure') != null) {
    const step = steps[index];
    preinfusionSeconds += Math.max(0.01, stepNumber(step, 'seconds') ?? 1);
    preinfusionPressure = stepExitNumber(step, 'pressure');
    preinfusionStartTemperature ??= stepNumber(step, 'temperature');
    preinfusionEndTemperature = stepNumber(step, 'temperature');
    index += 1;
  }
  if (preinfusionPressure != null) {
    targets.push(target({ pressure: 0.1, temperature: preinfusionStartTemperature, seconds: 0.01 }));
    targets.push(target({ pressure: preinfusionPressure, temperature: preinfusionEndTemperature, seconds: preinfusionSeconds }));
  }

  for (; index < steps.length; index += 1) {
    const step = steps[index];
    const pressure = stepNumber(step, 'pressure') ?? stepExitNumber(step, 'pressure');
    if (pressure == null) continue;
    const temperature = stepNumber(step, 'temperature');
    if (targets.length === 0 && stepString(step, 'pump') === 'flow') {
      targets.push(target({ pressure: 0.1, temperature, seconds: 0.01 }));
    }
    targets.push(target({
      pressure,
      temperature,
      pump: 'pressure',
      transition: null,
      seconds: Math.max(0.01, stepNumber(step, 'seconds') ?? 1)
    }));
  }
  return targets;
}

function flowTargetsFromSteps(steps: unknown[]): ProfileStepTarget[] {
  return steps
    .map((step) => target({
      flow: stepNumber(step, 'flow'),
      temperature: stepNumber(step, 'temperature'),
      pump: 'flow',
      transition: null,
      seconds: Math.max(0.01, stepNumber(step, 'seconds') ?? 1)
    }))
    .filter((step) => step.flow != null);
}

function scalarPressureTargets(profile: Profile): ProfileStepTarget[] {
  const preinfusionTime = Math.max(0, profileNumber(profile, 'preinfusion_time') ?? 0);
  const preinfusionPressure = profileNumber(profile, 'preinfusion_stop_pressure') ?? 0.5;
  let espressoPressure = profileNumber(profile, 'espresso_pressure') ?? 0;
  let pressureEnd = profileNumber(profile, 'pressure_end') ?? 0;
  const holdTime = Math.max(0, profileNumber(profile, 'espresso_hold_time') ?? 0);
  const declineTime = Math.max(0, profileNumber(profile, 'espresso_decline_time') ?? 0);

  if (espressoPressure === 0) espressoPressure = 0.05;
  if (pressureEnd === 0) pressureEnd = 0.05;

  let rampTime = 0.01 + Math.abs(espressoPressure - preinfusionPressure) * 0.5;
  let pressureHoldTime = holdTime;
  if (rampTime > pressureHoldTime) espressoPressure = pressureHoldTime * 2;
  pressureHoldTime = Math.max(0, pressureHoldTime - rampTime);

  const targets: ProfileStepTarget[] = [];
  if (preinfusionTime > 0) {
    targets.push(target({ pressure: 0.1, temperature: profileTemperature(profile, 0), seconds: 0.01 }));
    targets.push(target({ pressure: preinfusionPressure, temperature: profileTemperature(profile, 1), seconds: preinfusionTime }));
  } else {
    targets.push(target({ pressure: 0, temperature: profileTemperature(profile, 0), seconds: 0.01 }));
  }
  targets.push(target({ pressure: espressoPressure, temperature: profileTemperature(profile, 2), seconds: rampTime }));
  if (pressureHoldTime > 0) {
    targets.push(target({ pressure: espressoPressure, temperature: profileTemperature(profile, 2), seconds: pressureHoldTime }));
  }
  if (declineTime > 0) {
    targets.push(target({ pressure: pressureEnd, temperature: profileTemperature(profile, 3), seconds: declineTime }));
  }
  return targets;
}

function scalarFlowTargets(profile: Profile): ProfileStepTarget[] {
  const preinfusionTime = Math.max(0, profileNumber(profile, 'preinfusion_time') ?? 0);
  const preinfusionFlow = profileNumber(profile, 'preinfusion_flow_rate') ?? 0;
  const holdTime = Math.max(0, profileNumber(profile, 'espresso_hold_time') ?? 0);
  const declineTime = Math.max(0, profileNumber(profile, 'espresso_decline_time') ?? 0);
  let flowHold = profileNumber(profile, 'flow_profile_hold') ?? 0;
  let flowDecline = profileNumber(profile, 'flow_profile_decline') ?? 0;

  if (flowHold === 0) flowHold = 0.05;
  if (flowDecline === 0) flowDecline = 0.05;

  const targets: ProfileStepTarget[] = [];
  if (preinfusionTime > 0) {
    targets.push(target({ flow: 0, temperature: profileTemperature(profile, 0), seconds: Math.max(0.01, preinfusionFlow / 4) }));
    targets.push(target({ flow: preinfusionFlow, temperature: profileTemperature(profile, 1), seconds: preinfusionTime }));
  } else {
    targets.push(target({ flow: 0, temperature: profileTemperature(profile, 0), seconds: Math.max(0.01, flowHold / 4) }));
  }
  if (holdTime > 0) {
    targets.push(target({ flow: flowHold, temperature: profileTemperature(profile, 2), seconds: 3 }));
    targets.push(target({ flow: flowHold, temperature: profileTemperature(profile, 2), seconds: holdTime }));
  }
  if (declineTime > 0) {
    targets.push(target({ flow: flowDecline, temperature: profileTemperature(profile, 3), seconds: declineTime }));
  }
  return targets;
}

function target(values: Partial<ProfileStepTarget>): ProfileStepTarget {
  return {
    pressure: values.pressure ?? null,
    flow: values.flow ?? null,
    temperature: values.temperature ?? null,
    pump: values.pump ?? null,
    transition: values.transition ?? null,
    seconds: Math.max(0.01, values.seconds ?? 1)
  };
}

function profileTemperature(profile: Profile, index: 0 | 1 | 2 | 3): number | null {
  return profileNumber(profile, `espresso_temperature_${index}`) ?? profileNumber(profile, 'espresso_temperature') ?? profileNumber(profile, 'tank_temperature');
}

function firstNumber(values: Array<number | null>): number | null {
  return values.find((value): value is number => value != null) ?? null;
}

function previewMode(profile: Profile | null | undefined, targets: ProfileStepTarget[]): PreviewMode {
  const explicit = explicitPreviewMode(profile);
  if (explicit) return explicit;
  const hasPressure = targets.some((target) => target.pressure != null || target.pump === 'pressure');
  const hasFlow = targets.some((target) => target.flow != null || target.pump === 'flow');
  if (hasPressure && !hasFlow) return 'pressure';
  if (hasFlow && !hasPressure) return 'flow';
  return 'advanced';
}

function inferPreviewModeFromSteps(steps: unknown[]): PreviewMode | null {
  if (steps.length === 0) return null;
  const firstPressureIndex = steps.findIndex((step) => stepString(step, 'pump') === 'pressure' || stepNumber(step, 'pressure') != null);
  const hasPressure = firstPressureIndex >= 0;
  const hasFlow = steps.some((step) => stepString(step, 'pump') === 'flow' || stepNumber(step, 'flow') != null);
  if (hasFlow && !hasPressure) return 'flow';
  if (hasPressure && !hasFlow) return 'pressure';
  if (hasPressure && hasFlow) {
    const hasFlowAfterPressure = steps.some((step, index) => index > firstPressureIndex && (stepString(step, 'pump') === 'flow' || stepNumber(step, 'flow') != null));
    if (!hasFlowAfterPressure) return 'pressure';
  }
  return null;
}

function explicitPreviewMode(profile: Profile | null | undefined): PreviewMode | null {
  const type = (
    profileString(profile, 'settings_profile_type') ??
    profileString(profile, 'profile_type') ??
    profileString(profile, 'legacy_profile_type') ??
    profileString(profile, 'type') ??
    ''
  ).toLowerCase();
  if (['pressure', 'settings_2a', 'settings_profile_pressure'].includes(type)) return 'pressure';
  if (['flow', 'settings_2b', 'settings_profile_flow'].includes(type)) return 'flow';
  if (['advanced', 'settings_2c', 'settings_2c2', 'settings_profile_advanced'].includes(type)) return 'advanced';
  return null;
}

function hasScalarPressureProfile(profile: Profile): boolean {
  return profileNumber(profile, 'espresso_pressure') != null || profileNumber(profile, 'pressure_end') != null;
}

function hasScalarFlowProfile(profile: Profile): boolean {
  return profileNumber(profile, 'flow_profile_hold') != null || profileNumber(profile, 'flow_profile_decline') != null;
}

function profileString(profile: Profile | null | undefined, key: string): string | null {
  if (!profile) return null;
  const value = profileValue(profile, key);
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function profileNumber(profile: Profile | null | undefined, key: string): number | null {
  if (!profile) return null;
  const value = profileValue(profile, key);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function profileValue(profile: Profile, key: string): unknown {
  return (profile as Record<string, unknown>)[key];
}

function stepExitNumber(step: unknown, type: string): number | null {
  if (step == null || typeof step !== 'object') return null;
  const exit = (step as Record<string, unknown>).exit;
  if (exit == null || typeof exit !== 'object') return null;
  const record = exit as Record<string, unknown>;
  return record.type === type ? stepNumber(exit, 'value') : null;
}

function temperatureGauge(value: number | null, gauge: { x: number; y: number; h: number }): string {
  const label = value == null ? '--' : `${Math.round(value)}°C`;
  // A small thermometer glyph captioned with the value — a read-only indicator.
  // (It used to be a full-height filled tube, which read as a draggable slider.)
  const cx = gauge.x + 20;
  const stemW = 12;
  const stemH = 34;
  const stemX = cx - stemW / 2;
  const stemTop = gauge.y + gauge.h / 2 - 42;
  const bulbR = 10;
  const bulbCy = stemTop + stemH + bulbR - 3;
  const normalized = value == null ? 0 : Math.max(0, Math.min(1, (value - 60) / 45));
  const mercuryTop = stemTop + 5 + (stemH - 5) * (1 - normalized);
  return `
    <g class="profile-preview-thermo" role="img" aria-label="Temperature ${label}">
      <text class="profile-preview-temp-cap" x="${cx}" y="${stemTop - 12}" text-anchor="middle">TEMP</text>
      <rect class="profile-preview-thermo-tube" x="${stemX}" y="${stemTop}" width="${stemW}" height="${stemH + 9}" rx="${stemW / 2}" />
      <rect class="profile-preview-thermo-fill" x="${stemX + 2.5}" y="${mercuryTop.toFixed(1)}" width="${stemW - 5}" height="${(bulbCy - mercuryTop).toFixed(1)}" rx="${(stemW - 5) / 2}" />
      <circle class="profile-preview-thermo-fill" cx="${cx}" cy="${bulbCy}" r="${bulbR}" />
      <text class="profile-preview-temp-value" x="${cx}" y="${bulbCy + 34}" text-anchor="middle">${label}</text>
    </g>
  `;
}

function yFor(value: number, plot: { y: number; h: number }, yMax: number): number {
  const normalized = Math.max(0, Math.min(1, value / yMax));
  return Number((plot.y + plot.h - normalized * plot.h).toFixed(1));
}
