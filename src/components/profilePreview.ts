import type { Profile } from '../api/types';

export interface ProfileStepTarget {
  pressure: number | null;
  flow: number | null;
  temperature: number | null;
  seconds: number;
}

export function profileStepTargets(profile: Profile | null | undefined): ProfileStepTarget[] {
  if (!profile || !Array.isArray(profile.steps)) return [];
  return profile.steps.map((step) => ({
    pressure: stepNumber(step, 'pressure'),
    flow: stepNumber(step, 'flow'),
    temperature: stepNumber(step, 'temperature'),
    seconds: Math.max(1, stepNumber(step, 'seconds') ?? 1)
  }));
}

export function renderProfilePreview(profile: Profile | null | undefined): string {
  const targets = profileStepTargets(profile);
  const width = 760;
  const height = 320;
  const plot = { x: 82, y: 38, w: 478, h: 178 };
  if (targets.length === 0) {
    return `<svg class="profile-preview" viewBox="0 0 ${width} ${height}" role="img" aria-label="No profile preview"></svg>`;
  }

  const totalSeconds = Math.max(1, targets.reduce((sum, target) => sum + target.seconds, 0));
  const pressurePath = steppedPath(targets, (t) => t.pressure, totalSeconds, plot);
  const flowPath = steppedPath(targets, (t) => t.flow, totalSeconds, plot);
  const temperaturePath = steppedPath(
    targets,
    (t) => (t.temperature == null ? null : t.temperature / 10),
    totalSeconds,
    plot
  );
  const displayTemperature = firstNumber(targets.map((target) => target.temperature));
  const gauge = temperatureGauge(displayTemperature, { x: 640, y: 40, h: 176 });

  return `<svg class="profile-preview" viewBox="0 0 ${width} ${height}" role="img" aria-label="Profile target preview">
    <rect class="profile-preview-plot" x="${plot.x}" y="${plot.y}" width="${plot.w}" height="${plot.h}" rx="5" />
    ${[1, 3, 5, 7, 9, 11].map((tick) => {
      const y = yFor(tick, plot);
      return `<line class="profile-preview-grid" x1="${plot.x}" x2="${plot.x + plot.w}" y1="${y}" y2="${y}" />
        <text class="profile-preview-axis" x="${plot.x - 12}" y="${y + 4}" text-anchor="end">${tick}</text>`;
    }).join('')}
    ${[0, 15, 30, 45, 60].map((tick) => {
      const x = plot.x + (tick / 60) * plot.w;
      return `<line class="profile-preview-grid vertical" x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${plot.y}" y2="${plot.y + plot.h}" />`;
    }).join('')}
    <text class="profile-preview-y-title" x="22" y="${plot.y + plot.h / 2}" transform="rotate(-90 22 ${plot.y + plot.h / 2})">pressure (bar)</text>
    ${flowPath ? `<path class="profile-preview-flow" d="${flowPath}" fill="none" />` : ''}
    ${pressurePath ? `<path class="profile-preview-pressure" d="${pressurePath}" fill="none" />` : ''}
    ${temperaturePath ? `<path class="profile-preview-temp" d="${temperaturePath}" fill="none" />` : ''}
    ${gauge}
    <text x="${plot.x}" y="${plot.y + plot.h + 34}" class="profile-preview-label pressure">pressure</text>
    <text x="${plot.x + 118}" y="${plot.y + plot.h + 34}" class="profile-preview-label flow">flow</text>
    <text x="${plot.x + 198}" y="${plot.y + plot.h + 34}" class="profile-preview-label temp">temp /10</text>
  </svg>`;
}

function steppedPath(
  targets: ProfileStepTarget[],
  pick: (target: ProfileStepTarget) => number | null,
  totalSeconds: number,
  plot: { x: number; y: number; w: number; h: number }
): string {
  let path = '';
  let open = false;
  let elapsed = 0;
  for (let i = 0; i < targets.length; i += 1) {
    const target = targets[i]!;
    const value = pick(target);
    const x0 = plot.x + (elapsed / totalSeconds) * plot.w;
    elapsed += target.seconds;
    const x1 = plot.x + (elapsed / totalSeconds) * plot.w;
    if (value == null) {
      open = false;
      continue;
    }
    const y = yFor(value, plot);
    path += `${open ? 'L' : 'M'}${x0.toFixed(1)} ${y.toFixed(1)}L${x1.toFixed(1)} ${y.toFixed(1)}`;
    open = true;
  }
  return path;
}

function stepNumber(step: unknown, key: string): number | null {
  if (step == null || typeof step !== 'object') return null;
  const value = (step as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function firstNumber(values: Array<number | null>): number | null {
  return values.find((value): value is number => value != null) ?? null;
}

function temperatureGauge(value: number | null, gauge: { x: number; y: number; h: number }): string {
  const bulbR = 18;
  const tubeW = 12;
  const tubeX = gauge.x + bulbR - tubeW / 2;
  const tubeY = gauge.y;
  const tubeH = gauge.h - bulbR * 1.55;
  const normalized = value == null ? 0 : Math.max(0, Math.min(1, (value - 60) / 45));
  const fillH = Math.max(8, tubeH * normalized);
  const fillY = tubeY + tubeH - fillH + 4;
  const label = value == null ? '--' : `${Math.round(value)}°C`;
  return `
    <g class="profile-preview-thermo" aria-label="Temperature ${label}">
      <rect class="profile-preview-thermo-tube" x="${tubeX}" y="${tubeY}" width="${tubeW}" height="${tubeH + 10}" rx="${tubeW / 2}" />
      <rect class="profile-preview-thermo-fill" x="${tubeX + 2}" y="${fillY.toFixed(1)}" width="${tubeW - 4}" height="${fillH.toFixed(1)}" rx="${(tubeW - 4) / 2}" />
      <circle class="profile-preview-thermo-fill" cx="${gauge.x + bulbR}" cy="${gauge.y + tubeH + bulbR}" r="${bulbR}" />
      <text class="profile-preview-temp-readout" x="${gauge.x + bulbR}" y="${gauge.y + gauge.h + 20}" text-anchor="middle">${label}</text>
    </g>
  `;
}

function yFor(value: number, plot: { y: number; h: number }): number {
  const normalized = Math.max(0, Math.min(1, value / 11.5));
  return Number((plot.y + plot.h - normalized * plot.h).toFixed(1));
}
