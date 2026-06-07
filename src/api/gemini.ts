import type { LabelScan, LabelScanEnrichment } from '../domain/labelScan';
import { buildEnrichPrompt, LABEL_SCAN_PROMPT } from '../domain/labelScan';

/**
 * Gemini transport for the bag-label scanner (Phase 1).
 *
 * Browser fetch straight to Google's Generative Language API with the user's own
 * (free-tier) key — no Beanie gateway, no proxy. The request/response *shaping*
 * is pure and unit-tested; only the thin `fetch` wrappers touch the network.
 *
 * We deliberately drive structured output with `responseMimeType: application/json`
 * plus an explicit shape in the prompt, rather than a `responseSchema` — the
 * schema field's wire format has shifted across Gemini versions, and the parser
 * here is tolerant either way.
 */

/** Default free-tier multimodal model. Single knob — swap to taste. */
export const GEMINI_LABEL_MODEL = 'gemini-2.5-flash';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export interface ScanImage {
  /** e.g. image/jpeg, image/png, image/webp. */
  mime: string;
  /** Base64-encoded image bytes (no `data:` prefix). */
  base64: string;
}

type GeminiPart = { text: string } | { inline_data: { mime_type: string; data: string } };

export interface GeminiRequest {
  contents: Array<{ parts: GeminiPart[] }>;
  generationConfig: { responseMimeType: string; temperature: number };
}

export class GeminiError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'GeminiError';
    this.status = status;
  }
}

/** Pure: build the generateContent request body from images + prompt. */
export function buildGeminiRequest(images: ScanImage[], prompt: string): GeminiRequest {
  const imageParts: GeminiPart[] = images.map((image) => ({
    inline_data: { mime_type: image.mime, data: image.base64 }
  }));
  return {
    contents: [{ parts: [...imageParts, { text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0 }
  };
}

/** Pure: pull the model's JSON out of a generateContent response and coerce it. */
export function parseGeminiResponse(payload: unknown): LabelScan {
  const root = asRecord(payload);
  const error = asRecord(root?.error);
  if (error) throw new GeminiError(stringOr(error.message, 'Gemini request failed'));

  const candidatesRaw = root?.candidates;
  const candidates = Array.isArray(candidatesRaw) ? candidatesRaw : [];
  const first = asRecord(candidates[0]);
  if (!first) {
    const block = asRecord(root?.promptFeedback)?.blockReason;
    throw new GeminiError(block ? `Blocked by Gemini (${String(block)})` : 'Gemini returned no result');
  }

  const parts = asRecord(first.content)?.parts;
  const text = Array.isArray(parts) ? parts.map((part) => stringOr(asRecord(part)?.text, '')).join('') : '';
  if (!text.trim()) throw new GeminiError('Gemini returned an empty result');

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new GeminiError('Could not read the label (Gemini did not return valid JSON)');
  }
  return coerceLabelScan(parsed);
}

/** Tolerantly coerce arbitrary JSON into a LabelScan, defaulting unknowns to null. */
export function coerceLabelScan(value: unknown): LabelScan {
  const root = asRecord(value) ?? {};
  const bean = asRecord(root.bean) ?? {};
  const batch = asRecord(root.batch) ?? {};
  const meta = asRecord(root.meta) ?? {};
  const lowConfidenceFields = Array.isArray(meta.lowConfidenceFields)
    ? meta.lowConfidenceFields.filter((entry): entry is string => typeof entry === 'string')
    : [];
  return {
    bean: {
      roaster: strOrNull(bean.roaster),
      name: strOrNull(bean.name),
      country: strOrNull(bean.country),
      region: strOrNull(bean.region),
      processing: strOrNull(bean.processing),
      notes: strOrNull(bean.notes)
    },
    batch: {
      roastDate: strOrNull(batch.roastDate),
      roastLevel: strOrNull(batch.roastLevel),
      weight: numOrNull(batch.weight)
    },
    meta: { lowConfidenceFields, rawText: strOrNull(meta.rawText) }
  };
}

/** Network: run a label scan via Gemini generateContent. */
export async function scanLabel(
  images: ScanImage[],
  apiKey: string,
  options: { model?: string; prompt?: string; signal?: AbortSignal } = {}
): Promise<LabelScan> {
  if (images.length === 0) throw new GeminiError('Add at least one photo of the bag');
  const model = options.model ?? GEMINI_LABEL_MODEL;
  const url = `${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(
    apiKey.trim()
  )}`;
  const body = buildGeminiRequest(images, options.prompt ?? LABEL_SCAN_PROMPT);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: options.signal
    });
  } catch {
    throw new GeminiError('Could not reach Gemini — check your connection');
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = stringOr(asRecord(asRecord(payload)?.error)?.message, `Gemini error ${response.status}`);
    throw new GeminiError(message, response.status);
  }
  return parseGeminiResponse(payload);
}

/** Validate a key cheaply by listing models. Returns a tone-able result; never throws. */
export async function verifyGeminiKey(
  apiKey: string,
  options: { signal?: AbortSignal } = {}
): Promise<{ ok: boolean; message: string }> {
  const trimmed = apiKey.trim();
  if (!trimmed) return { ok: false, message: 'Enter a key first.' };
  try {
    const response = await fetch(`${GEMINI_BASE}/models?key=${encodeURIComponent(trimmed)}`, {
      signal: options.signal
    });
    if (response.ok) return { ok: true, message: 'Key works.' };
    const payload = await response.json().catch(() => null);
    const message = stringOr(asRecord(asRecord(payload)?.error)?.message, `Key rejected (${response.status}).`);
    return { ok: false, message };
  } catch {
    return { ok: false, message: 'Could not reach Gemini — check your connection.' };
  }
}

export interface EnrichRequest {
  contents: Array<{ parts: Array<{ text: string }> }>;
  tools: Array<{ google_search: Record<string, never> }>;
}

/**
 * Pure: build the grounded generateContent body. The Google Search tool lets the
 * model look up the roaster's site. No `responseMimeType` here — JSON mode is
 * incompatible with grounding on these models, so the prompt asks for JSON and
 * `extractJsonObject` pulls it back out of the (possibly prose-wrapped) answer.
 */
export function buildEnrichRequest(prompt: string): EnrichRequest {
  return {
    contents: [{ parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }]
  };
}

/** Pure: pull the first {...} JSON object out of grounded text. */
export function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  return text.slice(start, end + 1);
}

/** Pure: coerce arbitrary JSON into a LabelScanEnrichment. */
export function coerceEnrichment(value: unknown): LabelScanEnrichment {
  const root = asRecord(value) ?? {};
  return {
    country: strOrNull(root.country),
    region: strOrNull(root.region),
    processing: strOrNull(root.processing),
    notes: strOrNull(root.notes)
  };
}

/** Network: look up extra detail for a coffee on the roaster's site via grounding. */
export async function enrichLabel(
  input: { roaster: string; name: string; country?: string | null },
  apiKey: string,
  options: { model?: string; signal?: AbortSignal } = {}
): Promise<LabelScanEnrichment> {
  const model = options.model ?? GEMINI_LABEL_MODEL;
  const url = `${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(
    apiKey.trim()
  )}`;
  const body = buildEnrichRequest(buildEnrichPrompt(input));

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: options.signal
    });
  } catch {
    throw new GeminiError('Could not reach Gemini — check your connection');
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = stringOr(asRecord(asRecord(payload)?.error)?.message, `Gemini error ${response.status}`);
    throw new GeminiError(message, response.status);
  }

  const json = extractJsonObject(candidateText(payload));
  if (!json) throw new GeminiError("Couldn't find details for that coffee");
  try {
    return coerceEnrichment(JSON.parse(json));
  } catch {
    throw new GeminiError("Couldn't read the roaster's details");
  }
}

function candidateText(payload: unknown): string {
  const root = asRecord(payload);
  const candidatesRaw = root?.candidates;
  const candidates = Array.isArray(candidatesRaw) ? candidatesRaw : [];
  const parts = asRecord(asRecord(candidates[0])?.content)?.parts;
  return Array.isArray(parts) ? parts.map((part) => stringOr(asRecord(part)?.text, '')).join('') : '';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function strOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback;
}
