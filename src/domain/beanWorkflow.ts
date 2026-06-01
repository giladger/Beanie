import type {
  Bean,
  BeanBatch,
  BeanPreset,
  Grinder,
  Profile,
  ProfileRecord,
  RecipeDraft,
  ShotRecord,
  ShotSummary,
  Workflow,
  WorkflowContext
} from '../api/types';

export function beanLabel(bean: Bean): string {
  return `${bean.roaster} ${bean.name}`.trim();
}

export function formatGrams(value?: number | null): string {
  if (value == null || Number.isNaN(value)) return '--';
  return `${Number.isInteger(value) ? value : value.toFixed(1)}g`;
}

export function parseNumberInput(value: string): number | null {
  const parsed = Number.parseFloat(value.replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

export function latestBatch(batches: BeanBatch[]): BeanBatch | null {
  if (batches.length === 0) return null;
  return [...batches].sort((a, b) => {
    const ad = a.roastDate ? Date.parse(a.roastDate) : 0;
    const bd = b.roastDate ? Date.parse(b.roastDate) : 0;
    return bd - ad;
  })[0] ?? null;
}

export function shotFilterForBean(bean: Bean, batch?: BeanBatch | null): URLSearchParams {
  const query = new URLSearchParams({ limit: '24', offset: '0', order: 'desc' });
  if (batch?.id) {
    query.set('beanBatchId', batch.id);
  } else {
    query.set('coffeeRoaster', bean.roaster);
    query.set('coffeeName', bean.name);
  }
  return query;
}

export function selectInitialBean(
  beans: Bean[],
  workflow: Workflow | null,
  storedBeanId?: string | null,
  latestShot?: ShotSummary | null
): Bean | null {
  if (beans.length === 0) return null;

  const byLatestShot = beanForContext(beans, latestShot?.workflow?.context);
  if (byLatestShot) return byLatestShot;

  const byWorkflow = beanForContext(beans, workflow?.context);
  if (byWorkflow) return byWorkflow;

  if (storedBeanId) {
    const stored = beans.find((bean) => bean.id === storedBeanId);
    if (stored) return stored;
  }
  return beans[0] ?? null;
}

function beanForContext(beans: Bean[], ctx?: WorkflowContext | null): Bean | null {
  if (!ctx) return null;
  if (ctx.beanBatchId) {
    const byName = beans.find(
      (bean) => bean.name === ctx.coffeeName && bean.roaster === ctx.coffeeRoaster
    );
    if (byName) return byName;
  }
  if (ctx.coffeeName || ctx.coffeeRoaster) {
    const byContext = beans.find(
      (bean) => bean.name === ctx.coffeeName && bean.roaster === ctx.coffeeRoaster
    );
    if (byContext) return byContext;
  }
  return null;
}

export function recipeFromWorkflow(workflow: Workflow | null): RecipeDraft {
  const ctx = workflow?.context;
  return {
    profileTitle: workflow?.profile?.title ?? null,
    profile: workflow?.profile ?? null,
    dose: numberOrNull(ctx?.targetDoseWeight),
    yield: numberOrNull(ctx?.targetYield),
    grinderId: ctx?.grinderId ?? null,
    grinderModel: ctx?.grinderModel ?? null,
    grinderSetting: stringOrNull(ctx?.grinderSetting),
    sourceLabel: 'Current workflow'
  };
}

export function recipeFromShot(shot: ShotSummary | ShotRecord | null): RecipeDraft {
  const workflow = shot?.workflow ?? null;
  const ctx = workflow?.context;
  const annotations = shot?.annotations;
  return {
    profileTitle: workflow?.profile?.title ?? null,
    profile: workflow?.profile ?? null,
    dose: numberOrNull(annotations?.actualDoseWeight) ?? numberOrNull(ctx?.targetDoseWeight),
    yield: numberOrNull(annotations?.actualYield) ?? numberOrNull(ctx?.targetYield),
    grinderId: ctx?.grinderId ?? null,
    grinderModel: ctx?.grinderModel ?? null,
    grinderSetting: stringOrNull(ctx?.grinderSetting),
    sourceShotId: shot?.id ?? null,
    sourceLabel: shot ? `Shot ${shortDate(shot.timestamp)}` : null
  };
}

export function emptyRecipe(): RecipeDraft {
  return {
    profileTitle: null,
    profile: null,
    dose: null,
    yield: null,
    grinderId: null,
    grinderModel: null,
    grinderSetting: null,
    sourceLabel: 'Cleared'
  };
}

export function normalizeDraft(
  draft: RecipeDraft,
  profiles: ProfileRecord[],
  grinders: Grinder[]
): RecipeDraft {
  const profile =
    draft.profileId != null
      ? profiles.find((record) => record.id === draft.profileId)?.profile
      : draft.profileTitle
        ? profiles.find((record) => record.profile.title === draft.profileTitle)?.profile
        : draft.profile;
  const grinder =
    draft.grinderId != null
      ? grinders.find((item) => item.id === draft.grinderId)
      : draft.grinderModel
        ? grinders.find((item) => item.model === draft.grinderModel)
        : null;

  return {
    ...draft,
    profile: profile ?? draft.profile ?? null,
    profileTitle: profile?.title ?? draft.profileTitle ?? null,
    grinderId: grinder?.id ?? draft.grinderId ?? null,
    grinderModel: grinder?.model ?? draft.grinderModel ?? null
  };
}

export function buildWorkflowUpdate(
  bean: Bean,
  batch: BeanBatch | null,
  draft: RecipeDraft,
  profileOverride?: Profile | null,
  base?: Workflow | null
): Workflow {
  // Spread the existing workflow so unknown fields (id, description,
  // steamSettings, hotWaterData, rinseData, and any context keys Beanie does not
  // model) survive the round-trip instead of being dropped by the PUT.
  const context: WorkflowContext = {
    ...(base?.context ?? {}),
    coffeeName: bean.name,
    coffeeRoaster: bean.roaster,
    beanBatchId: batch?.id ?? null,
    targetDoseWeight: draft.dose ?? null,
    targetYield: draft.yield ?? null,
    grinderId: draft.grinderId ?? null,
    grinderModel: draft.grinderModel ?? null,
    grinderSetting: draft.grinderSetting ?? null,
    finalBeverageType: base?.context?.finalBeverageType ?? 'espresso'
  };
  let profile = profileOverride ?? draft.profile ?? null;
  if (profile && draft.brewTemp != null) {
    profile = withProfileTemperature(profile, draft.brewTemp);
  }
  return {
    ...(base ?? {}),
    name: beanLabel(bean),
    profile,
    context
  };
}

export function ratioFor(dose?: number | null, yieldValue?: number | null): number | null {
  if (dose == null || yieldValue == null || dose <= 0) return null;
  if (!Number.isFinite(dose) || !Number.isFinite(yieldValue)) return null;
  return yieldValue / dose;
}

export function yieldForRatio(dose: number | null | undefined, ratio: number): number | null {
  if (dose == null || dose <= 0 || !Number.isFinite(dose) || !Number.isFinite(ratio)) return null;
  return Math.round(dose * ratio * 10) / 10;
}

export function formatRatio(ratio: number | null | undefined): string {
  if (ratio == null || !Number.isFinite(ratio)) return '--';
  return `1:${ratio.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}`;
}

// Brew temperature lives in the profile, not the workflow context. We surface the
// profile's base temperature on the dial-in surface and, when the barista adjusts
// it, shift every step temperature by the same delta so the working profile sent
// with the next shot reflects the new target without a full profile editor.
export function profileBaseTemperature(profile: Profile | null | undefined): number | null {
  if (!profile) return null;
  if (typeof profile.tank_temperature === 'number' && Number.isFinite(profile.tank_temperature)) {
    return profile.tank_temperature;
  }
  const temps = stepTemperatures(profile);
  return temps.length === 0 ? null : Math.max(...temps);
}

export function withProfileTemperature(profile: Profile, targetBase: number): Profile {
  const current = profileBaseTemperature(profile);
  if (current == null) {
    return { ...profile, tank_temperature: targetBase };
  }
  const delta = targetBase - current;
  if (delta === 0) return profile;
  const steps = Array.isArray(profile.steps)
    ? profile.steps.map((step) => shiftStepTemperature(step, delta))
    : profile.steps;
  const tank =
    typeof profile.tank_temperature === 'number' ? profile.tank_temperature + delta : targetBase;
  return { ...profile, tank_temperature: tank, steps };
}

function stepTemperatures(profile: Profile): number[] {
  if (!Array.isArray(profile.steps)) return [];
  return profile.steps.flatMap((step) => {
    const value = stepTemperature(step);
    return value == null ? [] : [value];
  });
}

function stepTemperature(step: unknown): number | null {
  if (step == null || typeof step !== 'object') return null;
  const value = (step as Record<string, unknown>).temperature;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function shiftStepTemperature(step: unknown, delta: number): unknown {
  if (step == null || typeof step !== 'object') return step;
  const record = step as Record<string, unknown>;
  const value = record.temperature;
  if (typeof value !== 'number' || !Number.isFinite(value)) return step;
  return { ...record, temperature: value + delta };
}

export function presetName(draft: RecipeDraft): string {
  const profile = draft.profileTitle ?? 'No profile';
  const dose = formatGrams(draft.dose);
  const out = formatGrams(draft.yield);
  const grind = draft.grinderSetting ? ` / ${draft.grinderSetting}` : '';
  return `${profile} ${dose} -> ${out}${grind}`;
}

export function newestPreset(presets: BeanPreset[]): BeanPreset | null {
  return [...presets].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] ?? null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  if (value == null) return null;
  return String(value);
}

function shortDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.valueOf())) return value;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
