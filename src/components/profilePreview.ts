import type { Profile } from '../api/types';

// Compact stepped preview of a profile's pressure / flow targets. Profiles store
// their plan as a list of step objects (Decent JSON); we read the numeric
// pressure and flow targets per step and draw them as a small stepped sparkline
// so the picker can preview a profile before applying it.

export interface ProfileStepTarget {
  pressure: number | null;
  flow: number | null;
}

export function profileStepTargets(profile: Profile | null | undefined): ProfileStepTarget[] {
  if (!profile || !Array.isArray(profile.steps)) return [];
  return profile.steps.map((step) => ({
    pressure: stepNumber(step, 'pressure'),
    flow: stepNumber(step, 'flow')
  }));
}

export function renderProfilePreview(profile: Profile | null | undefined): string {
  const targets = profileStepTargets(profile);
  const width = 132;
  const height = 40;
  if (targets.length === 0) {
    return `<svg class="profile-preview" viewBox="0 0 ${width} ${height}" role="img" aria-label="No profile preview"></svg>`;
  }

  const maxPressure = Math.max(10, ...targets.map((t) => t.pressure ?? 0));
  const maxFlow = Math.max(6, ...targets.map((t) => t.flow ?? 0));
  const pressurePath = steppedPath(targets, (t) => t.pressure, maxPressure, width, height);
  const flowPath = steppedPath(targets, (t) => t.flow, maxFlow, width, height);

  return `<svg class="profile-preview" viewBox="0 0 ${width} ${height}" role="img" aria-label="Profile target preview">
    ${flowPath ? `<path class="profile-preview-flow" d="${flowPath}" fill="none" stroke="#4f8bd9" stroke-width="1.6" />` : ''}
    ${pressurePath ? `<path class="profile-preview-pressure" d="${pressurePath}" fill="none" stroke="#d85f5f" stroke-width="1.6" />` : ''}
  </svg>`;
}

function steppedPath(
  targets: ProfileStepTarget[],
  pick: (target: ProfileStepTarget) => number | null,
  max: number,
  width: number,
  height: number
): string {
  const slot = width / targets.length;
  let path = '';
  let open = false;
  for (let i = 0; i < targets.length; i += 1) {
    const value = pick(targets[i]!);
    if (value == null) {
      open = false;
      continue;
    }
    const y = height - (clamp01(value / max) * (height - 2)) - 1;
    const x0 = i * slot;
    const x1 = (i + 1) * slot;
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

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
