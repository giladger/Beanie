import type { Bean, BeanBatch } from '../api/types';

/**
 * AI bag-label scanner — domain core (Phase 1).
 *
 * A scan reads photos of a coffee bag and extracts the printed data into the
 * shape Beanie already stores: a {@link Bean} (identity, stable across bags) and
 * a {@link BeanBatch} (this specific bag). The structured fields mirror the
 * existing bean/batch create forms exactly, so the review step can reuse that
 * UI; richer origin detail (producer, variety, altitude, tasting notes) is
 * folded into `notes` rather than adding new form fields.
 *
 * Everything here is pure and provider-neutral. The Gemini transport and its
 * wire response-schema live in `api/gemini.ts`; this module owns the prompt, the
 * extracted shape, the mapping to Beanie's fields, and the new-bean-vs-new-batch
 * decision. Nothing commits without the human confirming the draft.
 */

/** Bean-level fields a scan extracts — mirrors `beanFieldsFromForm`. */
export interface LabelScanBean {
  roaster: string | null;
  name: string | null;
  country: string | null;
  region: string | null;
  processing: string | null;
  /** Description + tasting notes, plus any producer/variety/altitude detail. */
  notes: string | null;
}

/** Batch-level fields a scan extracts — mirrors `batchFieldsFromForm`. */
export interface LabelScanBatch {
  /** ISO `YYYY-MM-DD`. */
  roastDate: string | null;
  roastLevel: string | null;
  /** Net coffee weight in grams. */
  weight: number | null;
}

export interface LabelScanMeta {
  /** Field paths the model was unsure about, e.g. `"batch.roastDate"`. */
  lowConfidenceFields: string[];
  /** The raw text the model read off the bag (for trust/debugging). */
  rawText: string | null;
}

/** A complete extraction from one or more bag photos. */
export interface LabelScan {
  bean: LabelScanBean;
  batch: LabelScanBatch;
  meta: LabelScanMeta;
}

/**
 * The editable draft shown in the review step — all inputs are strings so they
 * prefill `<input>`s directly; weight is parsed back to a number on commit.
 */
export interface LabelScanDraft {
  roaster: string;
  name: string;
  country: string;
  region: string;
  processing: string;
  notes: string;
  roastDate: string;
  roastLevel: string;
  weight: string;
}

export type LabelScanDraftField = keyof LabelScanDraft;

/**
 * Instruction sent with the bag photos. Descriptive only — extract what is
 * printed, never infer or invent (matches Beanie's no-silent-magic stance: the
 * scan fills a draft, the human confirms it).
 *
 * Split into rules + response shape so {@link buildLabelScanPrompt} can slot the
 * user's bean library between them — the shape must stay last, closest to where
 * the model starts writing JSON.
 */
const LABEL_SCAN_RULES = [
  'You are reading photos of a coffee bag (possibly several angles of the same bag).',
  'Extract ONLY what is actually printed on the bag. Do not infer, guess, or invent —',
  'if a value is not visible, return null for it.',
  'Merge information across the photos; if they disagree, prefer the clearer photo.',
  'Bags often print names in ALL CAPS or all lowercase for style — write values with natural',
  'capitalization instead (e.g. "ETHIOPIA GUJI" -> "Ethiopia Guji"), keeping unusual casing only',
  'when it is clearly the brand\'s own styling.',
  'Normalize the roast date to ISO YYYY-MM-DD (e.g. "Roasted 03.06.26" or "Roasted 3 June 2026" -> "2026-06-03").',
  'Give the net coffee weight in grams (convert other units, e.g. 12 oz -> 340, 1 lb -> 454).',
  'In `notes`, capture the roaster\'s description / tasting notes and any producer, farm, variety/varietal,',
  'and altitude details that are printed on the bag.',
  'In meta.lowConfidenceFields list the dotted paths of any fields you are unsure about,',
  'e.g. "bean.name" or "batch.roastDate". Put the full text you read in meta.rawText.'
].join(' ');

const LABEL_SCAN_SHAPE = [
  'Respond with ONLY a JSON object of exactly this shape, using null for anything not printed on the bag:',
  '{ "bean": { "roaster", "name", "country", "region", "processing", "notes" },',
  '"batch": { "roastDate" (YYYY-MM-DD), "roastLevel", "weight" (grams, a number) },',
  '"meta": { "lowConfidenceFields" (array of strings), "rawText" } }'
].join(' ');

/** Library-blind prompt — the transport's fallback when no beans are supplied. */
export const LABEL_SCAN_PROMPT = `${LABEL_SCAN_RULES} ${LABEL_SCAN_SHAPE}`;

// Enough library for spelling matches without bloating the prompt; a scan of a
// bag you already have almost always involves a recently added bean.
const PROMPT_LIBRARY_LIMIT = 60;

/**
 * Build the scan prompt with the user's bean library folded in, so the model
 * reuses the library's exact spellings when the bag matches a known roaster or
 * bean, and follows its naming style for new ones.
 */
export function buildLabelScanPrompt(beans: Bean[]): string {
  const active = beans.filter((bean) => !bean.archived);
  if (active.length === 0) return LABEL_SCAN_PROMPT;
  const listed = active.slice(-PROMPT_LIBRARY_LIMIT);
  return [
    LABEL_SCAN_RULES,
    'The user\'s bean library already contains ("roaster" | "bean name"):',
    ...listed.map((bean) => `"${bean.roaster}" | "${bean.name}"`),
    'If the bag is one of these beans or from one of these roasters, copy the spelling and',
    'capitalization EXACTLY as listed (the print on the bag may style it differently).',
    'For anything not in the list, follow the list\'s general naming style.',
    LABEL_SCAN_SHAPE
  ].join('\n');
}

/** Build the editable review draft from a raw scan. Tolerant of partial scans. */
export function labelScanToDraft(scan: LabelScan): LabelScanDraft {
  const bean = scan?.bean ?? {};
  const batch = scan?.batch ?? {};
  const weight = positiveWeight((batch as LabelScanBatch).weight);
  return {
    roaster: cleanText((bean as LabelScanBean).roaster) ?? '',
    name: cleanText((bean as LabelScanBean).name) ?? '',
    country: cleanText((bean as LabelScanBean).country) ?? '',
    region: cleanText((bean as LabelScanBean).region) ?? '',
    processing: cleanText((bean as LabelScanBean).processing) ?? '',
    notes: cleanText((bean as LabelScanBean).notes) ?? '',
    roastDate: normalizeIsoDate((batch as LabelScanBatch).roastDate) ?? '',
    roastLevel: cleanText((batch as LabelScanBatch).roastLevel) ?? '',
    weight: weight == null ? '' : String(weight)
  };
}

/** Bean fields for persistence — same shape as `beanFieldsFromForm`. */
export function draftToBeanFields(
  draft: LabelScanDraft
): Pick<Bean, 'roaster' | 'name' | 'country' | 'region' | 'processing' | 'notes'> {
  return {
    roaster: draft.roaster.trim(),
    name: draft.name.trim(),
    country: cleanText(draft.country),
    region: cleanText(draft.region),
    processing: cleanText(draft.processing),
    notes: cleanText(draft.notes)
  };
}

/** Batch fields for persistence — weightRemaining starts full. */
export function draftToBatchFields(
  draft: LabelScanDraft
): Pick<BeanBatch, 'roastDate' | 'roastLevel' | 'weight' | 'weightRemaining'> {
  const weight = positiveWeight(Number(draft.weight));
  return {
    roastDate: normalizeIsoDate(draft.roastDate),
    roastLevel: cleanText(draft.roastLevel),
    weight,
    weightRemaining: weight
  };
}

/**
 * Find an existing bean matching the scanned roaster + name (trimmed,
 * case-insensitive), so a scan of a coffee you already have routes to a new
 * batch instead of a duplicate bean. Archived beans are ignored.
 */
export function findExistingBean(beans: Bean[], roaster: string, name: string): Bean | null {
  const r = roaster.trim().toLowerCase();
  const n = name.trim().toLowerCase();
  if (!r || !n) return null;
  return (
    beans.find(
      (bean) =>
        !bean.archived &&
        bean.roaster.trim().toLowerCase() === r &&
        bean.name.trim().toLowerCase() === n
    ) ?? null
  );
}

/**
 * Deterministic follow-up to the prompt's library hints: when a scanned value
 * matches something already in the library (trimmed, case-insensitive), adopt
 * the library's spelling, so one roaster never splinters into "ONYX", "Onyx"
 * and "onyx". The bean name only snaps within the matched roaster — different
 * roasters can reuse a name with different styling. Origin fields (country,
 * region, processing) snap across the whole library. Archived beans still
 * count: their spellings are as much "yours" as active ones.
 */
export function canonicalizeDraft(draft: LabelScanDraft, beans: Bean[]): LabelScanDraft {
  const next = { ...draft };
  next.roaster = librarySpelling(beans.map((bean) => bean.roaster), next.roaster);
  const roasterKey = matchKey(next.roaster);
  next.name = librarySpelling(
    beans.filter((bean) => matchKey(bean.roaster) === roasterKey).map((bean) => bean.name),
    next.name
  );
  next.country = librarySpelling(beans.map((bean) => bean.country ?? ''), next.country);
  next.region = librarySpelling(beans.map((bean) => bean.region ?? ''), next.region);
  next.processing = librarySpelling(beans.map((bean) => bean.processing ?? ''), next.processing);
  return next;
}

/**
 * How many beans the library already holds from this roaster. Archived beans
 * count — a finished bag is still part of your history with the roaster.
 */
export function countRoasterBeans(beans: Bean[], roaster: string): number {
  const key = matchKey(roaster);
  if (!key) return 0;
  return beans.filter((bean) => matchKey(bean.roaster) === key).length;
}

/** First library value equal to `value` ignoring case/whitespace, else `value` itself. */
function librarySpelling(values: string[], value: string): string {
  const key = matchKey(value);
  if (!key) return value;
  const match = values.find((candidate) => matchKey(candidate) === key);
  return match != null ? match.trim() : value;
}

function matchKey(value: string): string {
  return value.trim().toLowerCase();
}

/** The set of draft fields the model flagged as low-confidence, for UI highlighting. */
export function lowConfidenceFields(scan: LabelScan): Set<LabelScanDraftField> {
  const out = new Set<LabelScanDraftField>();
  for (const path of scan?.meta?.lowConfidenceFields ?? []) {
    const field = DRAFT_FIELD_BY_PATH[path];
    if (field) out.add(field);
  }
  return out;
}

/** Extra detail looked up from the roaster's website (Phase 2 enrich). */
export interface LabelScanEnrichment {
  country: string | null;
  region: string | null;
  processing: string | null;
  /** Tasting notes + producer / variety / altitude, appended to the draft notes. */
  notes: string | null;
}

// Identity (roaster/name) and the bag-specific batch fields are never changed by
// a web lookup — only these origin fields can be filled, and only when empty.
const ENRICHABLE_FIELDS = ['country', 'region', 'processing'] as const;

/**
 * Prompt for the roaster-website lookup. Asks the model to find the roaster's
 * page for this specific coffee and return only the extra detail — never the
 * roast date / weight, which belong to the bag in hand, not the coffee.
 */
export function buildEnrichPrompt(input: { roaster: string; name: string; country?: string | null }): string {
  const lines = [
    'Research this specialty coffee and return ONLY a JSON object — no prose, no markdown.',
    `Roaster: ${input.roaster}`,
    `Coffee: ${input.name}`
  ];
  if (input.country && input.country.trim()) lines.push(`Origin so far: ${input.country.trim()}`);
  lines.push(
    "Search the web for the roaster's official product page for THIS coffee. From it, extract details that are not obvious from the name:",
    'country, region, processing method, and a "notes" string combining the roaster\'s tasting notes / description with the',
    'producer / farm, variety / varietal, and altitude when listed.',
    "Use only facts from the roaster's site or reputable sources; if unsure use null. Do not invent or guess.",
    'Return ONLY: {"country": string|null, "region": string|null, "processing": string|null, "notes": string|null}'
  );
  return lines.join('\n');
}

/**
 * Merge web enrichment into the draft WITHOUT clobbering the label: empty origin
 * fields are filled, web notes are appended (deduped). Returns the merged draft
 * plus the fields that came from the web, for UI flagging.
 */
export function mergeEnrichment(
  draft: LabelScanDraft,
  enrichment: LabelScanEnrichment
): { draft: LabelScanDraft; webFields: LabelScanDraftField[] } {
  const next = { ...draft };
  const webFields: LabelScanDraftField[] = [];

  for (const field of ENRICHABLE_FIELDS) {
    const value = cleanText(enrichment[field]);
    if (value && !next[field].trim()) {
      next[field] = value;
      webFields.push(field);
    }
  }

  const extra = cleanText(enrichment.notes);
  if (extra) {
    const base = next.notes.trim();
    if (!base) {
      next.notes = extra;
      webFields.push('notes');
    } else if (!base.includes(extra)) {
      next.notes = `${base}\n${extra}`;
      webFields.push('notes');
    }
  }

  return { draft: next, webFields };
}

// Map the model's dotted paths onto draft fields. Accept both the dotted form
// ("bean.roaster") and the bare field ("roaster") since models vary.
const DRAFT_FIELD_BY_PATH: Record<string, LabelScanDraftField> = {
  'bean.roaster': 'roaster',
  roaster: 'roaster',
  'bean.name': 'name',
  name: 'name',
  'bean.country': 'country',
  country: 'country',
  'bean.region': 'region',
  region: 'region',
  'bean.processing': 'processing',
  processing: 'processing',
  'bean.notes': 'notes',
  notes: 'notes',
  'batch.roastDate': 'roastDate',
  roastDate: 'roastDate',
  'batch.roastLevel': 'roastLevel',
  roastLevel: 'roastLevel',
  'batch.weight': 'weight',
  weight: 'weight'
};

function cleanText(value: string | null | undefined): string | null {
  const text = (value ?? '').trim();
  return text ? text : null;
}

function positiveWeight(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Coerce a roast date to ISO `YYYY-MM-DD`, or null when it isn't a usable date.
 * Already-ISO values pass through; other parseable strings are reformatted in
 * UTC (so the date doesn't drift across timezones); junk becomes null so the
 * date input doesn't choke.
 */
export function normalizeIsoDate(value: string | null | undefined): string | null {
  const text = (value ?? '').trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const probe = new Date(`${text}T00:00:00Z`);
    return Number.isNaN(probe.getTime()) ? null : text;
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}
