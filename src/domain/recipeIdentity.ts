import type { Profile, RecipeDraft, Workflow } from '../api/types';
import { profileBaseTemperature } from './beanWorkflow';

/**
 * The recipe-bearing subset of a workflow.
 *
 * Identity deliberately follows the concrete workflow that will be written to
 * the gateway, rather than the UI controls used to produce it. This captures
 * profile edits whose title did not change and temperature edits that were
 * materialized into the profile steps by buildWorkflowUpdate().
 */
export interface RecipeIdentity {
  readonly profile: Profile | null;
  readonly brewTemperature: number | null;
  readonly beanId: string | null;
  readonly beanBatchId: string | null;
  readonly dose: number | null;
  readonly yield: number | null;
  readonly grinderId: string | null;
  readonly grinderModel: string | null;
  readonly grinderSetting: string | null;
}

export interface RecipeCandidate {
  readonly workflow: Workflow;
  readonly identity: RecipeIdentity;
  readonly fingerprint: string;
}

export function createRecipeCandidate(workflow: Workflow): RecipeCandidate {
  const identity = recipeIdentity(workflow);
  return {
    workflow,
    identity,
    fingerprint: stableJson(identity)
  };
}

export function recipeFingerprint(workflow: Workflow | null): string {
  return stableJson(recipeIdentity(workflow));
}

export function recipeOperationSubject(fingerprint: string): string {
  return `recipe:${fingerprint}`;
}

export function recipeIdentity(workflow: Workflow | null): RecipeIdentity {
  const context = workflow?.context;
  const profile = workflow?.profile ?? null;
  return {
    profile,
    brewTemperature: profileBaseTemperature(profile),
    beanId: stringOrNull(context?.beanId),
    beanBatchId: stringOrNull(context?.beanBatchId),
    dose: finiteNumberOrNull(context?.targetDoseWeight),
    yield: finiteNumberOrNull(context?.targetYield),
    grinderId: stringOrNull(context?.grinderId),
    grinderModel: stringOrNull(context?.grinderModel),
    grinderSetting: context?.grinderSetting == null ? null : String(context.grinderSetting)
  };
}

/** Compatibility identity for callers that only have a draft. New apply code
 * should fingerprint the workflow produced by buildWorkflowUpdate(), because a
 * draft alone cannot carry bean, batch, or inherited profile context. */
export function draftRecipeFingerprint(draft: RecipeDraft): string {
  const profile = draft.profile ?? (draft.profileTitle ? { title: draft.profileTitle } : null);
  const identity: RecipeIdentity = {
    profile,
    brewTemperature: finiteNumberOrNull(draft.brewTemp) ?? profileBaseTemperature(profile),
    beanId: null,
    beanBatchId: null,
    dose: finiteNumberOrNull(draft.dose),
    yield: finiteNumberOrNull(draft.yield),
    grinderId: stringOrNull(draft.grinderId),
    grinderModel: stringOrNull(draft.grinderModel),
    grinderSetting: stringOrNull(draft.grinderSetting)
  };
  return stableJson(identity);
}

function stringOrNull(value: string | null | undefined): string | null {
  return typeof value === 'string' ? value : null;
}

function finiteNumberOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Stable JSON preserves JSON-array order while ignoring object key order. */
function stableJson(value: unknown): string {
  return JSON.stringify(canonicalJson(value, new Set()));
}

function canonicalJson(value: unknown, ancestors: Set<object>): unknown {
  if (value == null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'object') return undefined;
  if (ancestors.has(value)) throw new TypeError('Recipe identity cannot contain circular data');

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => canonicalJson(item, ancestors) ?? null);
    }
    const record = value as Record<string, unknown>;
    const canonical: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const item = canonicalJson(record[key], ancestors);
      if (item !== undefined) canonical[key] = item;
    }
    return canonical;
  } finally {
    ancestors.delete(value);
  }
}
