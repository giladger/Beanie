import type { Bean, BeanBatch, Grinder, ShotRecord } from '../api/types';
import { stripCitationMarkers } from './answerMarkdown';
import { buildShotStats, shotDurationSeconds } from './shotStats';
import { computeBeanFreshness } from './beanFreshness';
import { FIELD_SPECS } from './profileModel';

// The dial-in helper's pure core: turn a shot + its context into the question
// Beanie asks Derek (Decent's RAG assistant), and turn Derek's answer back
// into validated single-parameter suggestions Beanie can apply.

// ---------------------------------------------------------------------------
// Taste chips

export interface TasteChip {
  id: string;
  label: string;
  /** How the chip reads inside the composed question. */
  phrase: string;
}

export const TASTE_CHIPS: readonly TasteChip[] = [
  { id: 'sour', label: 'Sour', phrase: 'sour' },
  { id: 'bitter', label: 'Bitter', phrase: 'bitter' },
  { id: 'harsh', label: 'Harsh / astringent', phrase: 'harsh and astringent' },
  { id: 'weak', label: 'Weak / watery', phrase: 'weak and watery' },
  { id: 'hollow', label: 'Hollow', phrase: 'hollow and lacking body' },
  { id: 'fast', label: 'Too fast', phrase: 'ran too fast' },
  { id: 'slow', label: 'Too slow', phrase: 'ran too slow' },
  { id: 'choked', label: 'Choked', phrase: 'choked with barely any flow' },
  { id: 'channeled', label: 'Channeled', phrase: 'channeled' }
] as const;

// ---------------------------------------------------------------------------
// Context assembly

export interface DialInTelemetryRow {
  t: number;
  pressure: number | null;
  flow: number | null;
  weight: number | null;
  temperature: number | null;
  weightFlow: number | null;
}

export interface DialInContext {
  profileTitle: string | null;
  bean: {
    name: string | null;
    roaster: string | null;
    roastLevel: string | null;
    roastAgeDays: number | null;
    processing: string | null;
    origin: string | null;
  } | null;
  grinder: { model: string | null; setting: string | null } | null;
  recipe: {
    doseG: number | null;
    yieldG: number | null;
    temperatureC: number | null;
  };
  shot: {
    durationS: number | null;
    actualYieldG: number | null;
    firstDropsS: number | null;
    peakPressureBar: number | null;
    avgFlowMls: number | null;
    avgTemperatureC: number | null;
    stopReason: string | null;
    tds: number | null;
    ey: number | null;
    enjoymentLabel: string | null;
  } | null;
  telemetry: DialInTelemetryRow[];
  /** The change applied after the previous Derek ask, when known (V2 loop). */
  previousTweak?: string | null;
}

export interface DialInContextSources {
  shot: ShotRecord | null;
  bean: Bean | null;
  batch: BeanBatch | null;
  grinder: Grinder | null;
  /** Recipe as Beanie currently holds it (falls back to the shot's workflow). */
  recipe?: { doseG?: number | null; yieldG?: number | null; temperatureC?: number | null } | null;
  profileTitle?: string | null;
  now?: Date;
}

export function buildDialInContext(sources: DialInContextSources): DialInContext {
  const { shot, bean, batch, grinder } = sources;
  const workflowContext = shot?.workflow?.context ?? null;
  const profile = shot?.workflow?.profile ?? null;
  const stats = shot ? buildShotStats(shot) : null;
  const freshness = batch ? computeBeanFreshness(batch, sources.now ?? new Date()) : null;

  const doseG =
    numberOrNull(sources.recipe?.doseG) ??
    numberOrNull(shot?.annotations?.actualDoseWeight) ??
    numberOrNull(workflowContext?.targetDoseWeight);
  const yieldG = numberOrNull(sources.recipe?.yieldG) ?? numberOrNull(workflowContext?.targetYield);
  const temperatureC =
    numberOrNull(sources.recipe?.temperatureC) ?? firstStepTemperature(profile?.steps);

  const setting = workflowContext?.grinderSetting;
  return {
    profileTitle: sources.profileTitle ?? stringOrNull(profile?.title),
    bean: bean
      ? {
          name: stringOrNull(bean.name),
          roaster: stringOrNull(bean.roaster),
          roastLevel: stringOrNull(batch?.roastLevel),
          roastAgeDays: freshness ? freshness.activeAgeDays : null,
          processing: stringOrNull(bean.processing),
          origin: [bean.country, bean.region].filter(Boolean).join(', ') || null
        }
      : null,
    grinder:
      grinder || workflowContext?.grinderModel || setting != null
        ? {
            model: stringOrNull(grinder?.model) ?? stringOrNull(workflowContext?.grinderModel),
            setting: setting == null ? null : String(setting)
          }
        : null,
    recipe: { doseG, yieldG, temperatureC },
    shot: shot
      ? {
          durationS: shotDurationSeconds(shot),
          actualYieldG:
            numberOrNull(shot.annotations?.actualYield) ?? numberOrNull(stats?.endWeight),
          firstDropsS: numberOrNull(stats?.firstDropsSeconds),
          peakPressureBar: numberOrNull(stats?.peakPressure),
          avgFlowMls: numberOrNull(stats?.avgFlow),
          avgTemperatureC: numberOrNull(stats?.avgTemperature),
          stopReason: stringOrNull(shot.stopReason),
          tds: numberOrNull(shot.annotations?.drinkTds),
          ey: numberOrNull(shot.annotations?.drinkEy),
          enjoymentLabel: enjoymentLabel(shot.annotations?.enjoyment)
        }
      : null,
    telemetry: shot ? downsampleTelemetry(shot) : [],
    // A change applied from an earlier Derek suggestion is stamped onto the
    // shot pulled with it — feed it back so Derek knows what was already tried.
    previousTweak: shotDerekTweak(shot)
  };
}

function shotDerekTweak(shot: ShotRecord | null): string | null {
  const extras = shot?.annotations?.extras;
  if (!extras || typeof extras !== 'object') return null;
  const value = (extras as Record<string, unknown>).derekTweak;
  return typeof value === 'string' && value.trim() ? value : null;
}

// Enjoyment is stored 0-100; de1app imports use 0 for "not rated".
function enjoymentLabel(value: number | null | undefined): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  const label = value <= 20 ? 'bad' : value <= 40 ? 'meh' : value <= 60 ? 'OK' : value <= 80 ? 'good' : 'great';
  return `${label} (${Math.round(value)}/100)`;
}

function firstStepTemperature(steps: unknown[] | undefined): number | null {
  if (!Array.isArray(steps) || steps.length === 0) return null;
  const first = steps[0];
  if (!first || typeof first !== 'object') return null;
  return numberOrNull((first as Record<string, unknown>).temperature as number | undefined);
}

// ---------------------------------------------------------------------------
// Telemetry downsampling

const TELEMETRY_MAX_ROWS = 300;
const ESPRESSO_SUBSTATES = new Set(['preinfusion', 'pouring']);

// The whole pour, every chart series (pressure, flow, weight, group temp,
// weight flow), at full sample resolution up to 300 rows — a typical 5Hz shot
// fits without dropping a sample; only very long shots get evenly thinned to
// stay under the cap. This is the same data the shot chart plots, so Derek
// sees exactly what the user sees.
export function downsampleTelemetry(shot: ShotRecord): DialInTelemetryRow[] {
  const all = Array.isArray(shot.measurements) ? shot.measurements : [];
  const pour = all.filter((measurement) => {
    const machine = measurement.machine as { state?: { substate?: unknown } };
    const substate = machine?.state?.substate;
    return typeof substate === 'string' && ESPRESSO_SUBSTATES.has(substate);
  });
  const series = pour.length > 1 ? pour : all;
  if (series.length === 0) return [];

  const startMs = Date.parse(series[0]!.machine.timestamp);
  if (!Number.isFinite(startMs)) return [];
  const stride = Math.max(1, Math.ceil(series.length / TELEMETRY_MAX_ROWS));

  const rows: DialInTelemetryRow[] = [];
  for (let index = 0; index < series.length; index += stride) {
    // Always keep the final sample — the end of the shot matters.
    const measurement = index + stride >= series.length ? series[series.length - 1]! : series[index]!;
    const at = Date.parse(measurement.machine.timestamp);
    if (!Number.isFinite(at)) continue;
    rows.push({
      t: round1((at - startMs) / 1000),
      pressure: round2OrNull(measurement.machine.pressure),
      flow: round2OrNull(measurement.machine.flow),
      weight: round1OrNull(measurement.scale?.weight),
      temperature: round1OrNull(measurement.machine.groupTemperature ?? measurement.machine.mixTemperature),
      weightFlow: round2OrNull(measurement.scale?.weightFlow)
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Query composition

export const DIAL_IN_PARAMETERS = [
  'grind',
  'dose',
  'yield',
  'brew_temperature',
  'peak_pressure',
  'preinfusion_time',
  'preinfusion_flow',
  'profile'
] as const;

export type DialInParameter = (typeof DIAL_IN_PARAMETERS)[number];

export interface DialInAsk {
  tasteChipIds: string[];
  note: string;
  /** Free-form question replacing the taste sentence (workbench entry point). */
  freeQuestion?: string | null;
}

export function composeDialInQuery(context: DialInContext, ask: DialInAsk): string {
  const lines: string[] = [];

  lines.push(
    context.profileTitle
      ? `I'm pulling espresso on a Decent DE1 with the profile "${context.profileTitle}".`
      : `I'm pulling espresso on a Decent DE1.`
  );

  if (context.bean) {
    const bean = context.bean;
    const name = [bean.name, bean.roaster ? `by ${bean.roaster}` : null].filter(Boolean).join(' ');
    const facts = [
      bean.roastLevel ? `${bean.roastLevel} roast` : null,
      bean.roastAgeDays != null ? `${bean.roastAgeDays} days off roast (excluding frozen time)` : null,
      bean.processing,
      bean.origin
    ].filter(Boolean);
    if (name || facts.length > 0) {
      lines.push(`Bean: ${[name || null, ...facts].filter(Boolean).join(', ')}.`);
    }
  }

  if (context.grinder && (context.grinder.model || context.grinder.setting)) {
    const model = context.grinder.model ?? 'my grinder';
    lines.push(
      context.grinder.setting
        ? `Grinder: ${model} at setting ${context.grinder.setting}.`
        : `Grinder: ${model}.`
    );
  }

  const recipe = context.recipe;
  const recipeParts = [
    recipe.doseG != null ? `${recipe.doseG}g in` : null,
    recipe.yieldG != null ? `${recipe.yieldG}g out target` : null,
    recipe.doseG != null && recipe.yieldG != null && recipe.doseG > 0
      ? `(1:${round1(recipe.yieldG / recipe.doseG)})`
      : null,
    recipe.temperatureC != null ? `at ${recipe.temperatureC}°C` : null
  ].filter(Boolean);
  if (recipeParts.length > 0) lines.push(`Recipe: ${recipeParts.join(' ')}.`);

  if (context.shot) {
    const shot = context.shot;
    const parts = [
      shot.actualYieldG != null && shot.durationS != null
        ? `${shot.actualYieldG}g out in ${Math.round(shot.durationS)}s`
        : shot.durationS != null
          ? `ran ${Math.round(shot.durationS)}s`
          : null,
      shot.firstDropsS != null ? `first drops at ${Math.round(shot.firstDropsS)}s` : null,
      shot.peakPressureBar != null ? `peak pressure ${round1(shot.peakPressureBar)} bar` : null,
      shot.avgFlowMls != null ? `average pour flow ${round1(shot.avgFlowMls)} ml/s` : null,
      shot.avgTemperatureC != null ? `average temperature ${round1(shot.avgTemperatureC)}°C` : null,
      stopReasonText(shot.stopReason)
    ].filter(Boolean);
    if (parts.length > 0) lines.push(`The shot: ${parts.join('; ')}.`);
    const drink = [
      shot.tds != null ? `TDS ${shot.tds}%` : null,
      shot.ey != null ? `extraction yield ${shot.ey}%` : null,
      shot.enjoymentLabel ? `I rated it ${shot.enjoymentLabel}` : null
    ].filter(Boolean);
    if (drink.length > 0) lines.push(`${drink.join(', ')}.`);
  }

  if (context.telemetry.length > 0) {
    lines.push('Full shot telemetry (t_s, pressure_bar, flow_mls, weight_g, group_temp_c, weight_flow_gs):');
    for (const row of context.telemetry) {
      lines.push(
        `${row.t}, ${cell(row.pressure)}, ${cell(row.flow)}, ${cell(row.weight)}, ${cell(row.temperature)}, ${cell(row.weightFlow)}`
      );
    }
  }

  if (context.previousTweak) {
    lines.push(
      `Note: this shot was pulled after making this change from the previous one (based on earlier advice): ${context.previousTweak}.`
    );
  }

  const question = ask.freeQuestion?.trim();
  if (question) {
    lines.push(question);
  } else {
    const phrases = ask.tasteChipIds
      .map((id) => TASTE_CHIPS.find((chip) => chip.id === id)?.phrase)
      .filter((phrase): phrase is string => Boolean(phrase));
    if (phrases.length > 0) lines.push(`The shot ${joinPhrases(phrases)}.`);
    const note = ask.note.trim();
    if (note) lines.push(note);
    lines.push('What should I change for the next shot?');
  }

  lines.push(outputContract());
  return lines.join('\n');
}

// Taste phrases are adjectives ("sour") or behaviours ("ran too fast"); glue
// them into one readable sentence: "was sour and weak, and ran too fast".
function joinPhrases(phrases: string[]): string {
  const adjectives = phrases.filter((phrase) => !phrase.startsWith('ran ') && !phrase.startsWith('choked') && !phrase.startsWith('channeled'));
  const behaviours = phrases.filter((phrase) => !adjectives.includes(phrase));
  const tasteText = adjectives.length > 0 ? `tasted ${listText(adjectives)}` : '';
  const behaviourText = behaviours.length > 0 ? listText(behaviours) : '';
  if (tasteText && behaviourText) return `${tasteText}, and ${behaviourText}`;
  return tasteText || behaviourText;
}

function listText(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function stopReasonText(reason: string | null): string | null {
  if (!reason) return null;
  const known: Record<string, string> = {
    targetWeight: 'stopped at target weight',
    targetVolume: 'stopped at target volume',
    apiStop: 'stopped manually',
    machineEnded: 'ended by the machine'
  };
  return known[reason] ?? `stop reason: ${reason}`;
}

function outputContract(): string {
  return [
    'After a brief explanation, end your answer with a fenced ```json code block of this exact shape:',
    '{"suggestions": [{"parameter": "...", "direction": "increase|decrease|switch", "current": <number or string or null>, "target": <number or string>, "unit": "...", "why": "..."}]}',
    `Rules: 1 to 4 suggestions; each suggestion changes exactly ONE parameter; "parameter" must be one of: ${DIAL_IN_PARAMETERS.join(', ')}; order them by which to try first; "why" is one or two sentences; for parameter "profile" set "target" to the profile title. If none apply, use an empty suggestions array.`
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Suggestion extraction

export type DialInSuggestionKind = 'recipe' | 'profile' | 'manual';

export interface DialInSuggestion {
  kind: DialInSuggestionKind;
  /** One of DIAL_IN_PARAMETERS for recipe/profile kinds; raw text for manual. */
  parameter: string;
  direction: 'increase' | 'decrease' | 'switch' | null;
  current: number | string | null;
  target: number | string | null;
  unit: string | null;
  why: string;
}

const PARAMETER_KINDS: Record<DialInParameter, DialInSuggestionKind> = {
  grind: 'recipe',
  dose: 'recipe',
  yield: 'recipe',
  brew_temperature: 'recipe',
  peak_pressure: 'profile',
  preinfusion_time: 'profile',
  preinfusion_flow: 'profile',
  profile: 'recipe'
};

// Plausibility clamps for numeric targets. Machine-side ranges come from
// FIELD_SPECS (the de1app canon); dose/yield bounds are common-sense espresso
// ranges — a target outside its window means the model hallucinated, so the
// suggestion degrades to manual rather than risking a wild recipe change.
const TARGET_RANGES: Partial<Record<DialInParameter, { min: number; max: number }>> = {
  dose: { min: 5, max: 30 },
  yield: { min: 10, max: 150 },
  brew_temperature: { min: 70, max: FIELD_SPECS.stepTemperature.max },
  peak_pressure: { min: 1, max: FIELD_SPECS.stepPressure.max },
  preinfusion_time: { min: FIELD_SPECS.preinfusionTime.min, max: FIELD_SPECS.preinfusionTime.max },
  preinfusion_flow: { min: FIELD_SPECS.preinfusionFlow.min, max: FIELD_SPECS.preinfusionFlow.max }
};

/**
 * Find the fenced ```json block in Derek's answer and return the validated
 * suggestions plus the answer text with the block removed. Malformed blocks
 * cost cards, never the prose: on any parse failure the answer text is
 * returned intact with zero suggestions.
 */
export function extractDialInSuggestions(
  answerText: string,
  context: DialInContext
): { suggestions: DialInSuggestion[]; displayText: string } {
  const fence = findJsonFence(answerText);
  if (!fence) return { suggestions: [], displayText: stripCitationMarkers(answerText).trim() };

  const displayText = stripCitationMarkers(
    answerText.slice(0, fence.start) + answerText.slice(fence.end)
  ).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(fence.json);
  } catch {
    return { suggestions: [], displayText };
  }
  const rawList = (parsed as { suggestions?: unknown })?.suggestions;
  if (!Array.isArray(rawList)) return { suggestions: [], displayText };

  const suggestions: DialInSuggestion[] = [];
  for (const raw of rawList.slice(0, 6)) {
    const suggestion = readSuggestion(raw, context);
    if (suggestion) suggestions.push(suggestion);
  }
  return { suggestions, displayText };
}

function readSuggestion(raw: unknown, context: DialInContext): DialInSuggestion | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const parameter = typeof item.parameter === 'string' ? item.parameter.trim() : '';
  const why = typeof item.why === 'string' ? stripCitationMarkers(item.why).trim() : '';
  if (!parameter || !why) return null;

  const direction =
    item.direction === 'increase' || item.direction === 'decrease' || item.direction === 'switch'
      ? item.direction
      : null;
  const target = valueOrNull(item.target);
  const unit = typeof item.unit === 'string' && item.unit.trim() ? item.unit.trim() : null;

  const known = (DIAL_IN_PARAMETERS as readonly string[]).includes(parameter)
    ? (parameter as DialInParameter)
    : null;
  if (!known || target == null) {
    return { kind: 'manual', parameter, direction, current: valueOrNull(item.current), target, unit, why };
  }

  // Trust Beanie's own numbers over Derek's readback of them.
  const actualCurrent = currentValueFor(known, context);
  const current = actualCurrent ?? valueOrNull(item.current);

  if (known === 'profile') {
    return typeof target === 'string' && target.trim()
      ? { kind: 'recipe', parameter: known, direction: 'switch', current, target: target.trim(), unit: null, why }
      : { kind: 'manual', parameter, direction, current, target, unit, why };
  }

  if (known === 'grind') {
    // Grind settings are grinder-specific (numbers or notch names) — no clamp,
    // but a numeric current lets the card show a delta.
    return { kind: 'recipe', parameter: known, direction, current, target, unit, why };
  }

  const numericTarget = typeof target === 'number' ? target : Number(target);
  if (!Number.isFinite(numericTarget)) {
    return { kind: 'manual', parameter, direction, current, target, unit, why };
  }
  const range = TARGET_RANGES[known];
  if (range && (numericTarget < range.min || numericTarget > range.max)) {
    return { kind: 'manual', parameter, direction, current, target, unit, why };
  }
  return {
    kind: PARAMETER_KINDS[known],
    parameter: known,
    direction,
    current,
    target: numericTarget,
    unit,
    why
  };
}

function currentValueFor(parameter: DialInParameter, context: DialInContext): number | string | null {
  switch (parameter) {
    case 'grind':
      return context.grinder?.setting ?? null;
    case 'dose':
      return context.recipe.doseG;
    case 'yield':
      return context.recipe.yieldG;
    case 'brew_temperature':
      return context.recipe.temperatureC;
    case 'peak_pressure':
      return context.shot?.peakPressureBar ?? null;
    case 'preinfusion_time':
      return context.shot?.firstDropsS ?? null;
    case 'profile':
      return context.profileTitle;
    case 'preinfusion_flow':
      return null;
  }
}

/**
 * Streaming cutoff: the index in the partial answer where a ```json fence
 * starts (or a trailing partial fence marker that may become one), so the view
 * can stop rendering prose there and never flash raw JSON. Null while no fence
 * is in sight.
 */
export function jsonFenceCutoff(partialText: string): number | null {
  const fence = partialText.search(/```(?:json)?\s*\{/);
  if (fence !== -1) return fence;
  // A fence may be arriving token by token: hold back a suspicious tail.
  const tail = partialText.search(/`{1,3}(?:j(?:s(?:o(?:n)?)?)?)?\s*$/);
  return tail !== -1 ? tail : null;
}

function findJsonFence(text: string): { start: number; end: number; json: string } | null {
  const open = text.search(/```(?:json)?\s*\{/);
  if (open === -1) return null;
  const jsonStart = text.indexOf('{', open);
  const close = text.indexOf('```', jsonStart);
  const jsonEnd = close === -1 ? text.length : close;
  const end = close === -1 ? text.length : close + 3;
  return { start: open, end, json: text.slice(jsonStart, jsonEnd).trim() };
}

// ---------------------------------------------------------------------------
// Card labels

const PARAMETER_LABELS: Record<DialInParameter, string> = {
  grind: 'Grind',
  dose: 'Dose',
  yield: 'Yield',
  brew_temperature: 'Temperature',
  peak_pressure: 'Peak pressure',
  preinfusion_time: 'Preinfusion time',
  preinfusion_flow: 'Preinfusion flow',
  profile: 'Profile'
};

export function suggestionTitle(suggestion: DialInSuggestion): string {
  const label =
    PARAMETER_LABELS[suggestion.parameter as DialInParameter] ?? titleCase(suggestion.parameter);
  if (suggestion.target == null) return label;
  const unit = suggestion.unit ? ` ${suggestion.unit}` : '';
  if (suggestion.current != null && String(suggestion.current) !== String(suggestion.target)) {
    return `${label}: ${formatValue(suggestion.current)} → ${formatValue(suggestion.target)}${unit}`;
  }
  return `${label}: ${formatValue(suggestion.target)}${unit}`;
}

function formatValue(value: number | string): string {
  return typeof value === 'number' ? String(round1(value)) : value;
}

function titleCase(value: string): string {
  const text = value.replace(/[_-]+/g, ' ').trim();
  return text ? text[0]!.toUpperCase() + text.slice(1) : value;
}

// ---------------------------------------------------------------------------

function cell(value: number | null): string {
  return value == null ? '' : String(value);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round1OrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? round1(value) : null;
}

function round2OrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value * 100) / 100
    : null;
}

function numberOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function valueOrNull(value: unknown): number | string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) return value.trim();
  return null;
}
