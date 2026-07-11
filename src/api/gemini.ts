import type { LabelScan, LabelScanEnrichment } from '../domain/labelScan';
import { buildEnrichPrompt, LABEL_SCAN_PROMPT } from '../domain/labelScan';

/**
 * Gemini transport for the bag-label scanner (Phase 1).
 *
 * Browser fetch straight to Google's Generative Language API with the user's own
 * (free-tier) key — no Beanie gateway, no proxy. The request/response *shaping*
 * is pure and unit-tested; only the thin `fetch` wrappers touch the network.
 *
 * The free tier sheds load constantly (429 rate limits, 503 overloads), so every
 * call retries transient failures on a short backoff and carries a per-attempt
 * deadline — a hung call must never spin the scanner UI forever.
 *
 * We deliberately drive structured output with `responseMimeType: application/json`
 * plus an explicit shape in the prompt, rather than a `responseSchema` — the
 * schema field's wire format has shifted across Gemini versions, and the parser
 * here is tolerant either way.
 */

/** Default free-tier multimodal model. Single knob — swap to taste. */
export const GEMINI_LABEL_MODEL = 'gemini-2.5-flash';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/** Backoff between retries of transient failures. */
const RETRY_DELAYS_MS = [750, 1500];

/** Per-attempt deadline; free-tier calls occasionally hang far past usefulness. */
const ATTEMPT_TIMEOUT_MS = 60_000;

export interface ScanImage {
  /** e.g. image/jpeg, image/png, image/webp. */
  mime: string;
  /** Base64-encoded image bytes (no `data:` prefix). */
  base64: string;
}

type GeminiPart = { text: string } | { inline_data: { mime_type: string; data: string } };

export interface GeminiRequest {
  contents: Array<{ parts: GeminiPart[] }>;
  generationConfig: {
    responseMimeType: string;
    temperature: number;
    thinkingConfig: { thinkingBudget: number };
  };
}

export class GeminiError extends Error {
  readonly status: number | null;
  /** Worth retrying automatically (rate limit, overload, network blip). */
  readonly transient: boolean;
  constructor(message: string, status: number | null = null, transient = false) {
    super(message);
    this.name = 'GeminiError';
    this.status = status;
    this.transient = transient;
  }
}

/** True when the failure means the stored API key is bad — re-onboard, don't retry. */
export function isGeminiKeyError(error: unknown): boolean {
  return (
    error instanceof GeminiError &&
    (error.status === 400 || error.status === 401 || error.status === 403) &&
    /api key/i.test(error.message)
  );
}

/** Pure: build the generateContent request body from images + prompt. */
export function buildGeminiRequest(images: ScanImage[], prompt: string): GeminiRequest {
  const imageParts: GeminiPart[] = images.map((image) => ({
    inline_data: { mime_type: image.mime, data: image.base64 }
  }));
  return {
    contents: [{ parts: [...imageParts, { text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      // The 2.5 family degenerates (loops, empty candidates) at exactly 0.
      temperature: 0.2,
      // Reading print needs no reasoning pass — disabling thinking is faster
      // and avoids the empty responses dynamic thinking sometimes produces.
      thinkingConfig: { thinkingBudget: 0 }
    }
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
  if (!text.trim()) throw new GeminiError('Gemini returned an empty result', null, true);

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

interface TransportOptions {
  signal?: AbortSignal;
  /** Per-attempt deadline override. */
  timeoutMs?: number;
  /** Backoff schedule override ([] disables retries) — mainly a test hook. */
  retryDelaysMs?: number[];
}

/** Network: run a label scan via Gemini generateContent. */
export async function scanLabel(
  images: ScanImage[],
  apiKey: string,
  options: { model?: string; prompt?: string } & TransportOptions = {}
): Promise<LabelScan> {
  if (images.length === 0) throw new GeminiError('Add at least one photo of the bag');
  if (!apiKey.trim()) throw new GeminiError('Add your Gemini API key first');
  const body = buildGeminiRequest(images, options.prompt ?? LABEL_SCAN_PROMPT);
  const payload = await postGenerateContent(modelUrl(options.model), apiKey, body, options);
  return parseGeminiResponse(payload);
}

/** Validate a key cheaply by listing models. Returns a tone-able result; never throws. */
export async function verifyGeminiKey(
  apiKey: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<{ ok: boolean; message: string }> {
  const trimmed = apiKey.trim();
  if (!trimmed) return { ok: false, message: 'Enter a key first.' };
  const attempt = requestDeadline(options.signal, options.timeoutMs ?? 15_000);
  try {
    const response = await fetch(`${GEMINI_BASE}/models`, {
      headers: { 'x-goog-api-key': trimmed },
      signal: attempt.signal
    });
    if (response.ok) return { ok: true, message: 'Key works.' };
    const payload = await response.json().catch(() => null);
    const message = stringOr(asRecord(asRecord(payload)?.error)?.message, `Key rejected (${response.status}).`);
    return { ok: false, message };
  } catch {
    return {
      ok: false,
      message: attempt.timedOut() ? 'Gemini key check timed out — try again.' : 'Could not reach Gemini — check your connection.'
    };
  } finally {
    attempt.done();
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
 * Thinking stays on: it measurably helps the model pick the right product page.
 */
export function buildEnrichRequest(prompt: string): EnrichRequest {
  return {
    contents: [{ parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }]
  };
}

/**
 * Pure: pull the JSON object out of grounded text. Grounded answers often wrap
 * the JSON in a ```json fence with prose around it — and the prose itself can
 * contain braces — so a fenced block wins over the bare first-{...last-} span.
 */
export function extractJsonObject(text: string): string | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const source = fenced ? fenced[1]! : text;
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  return source.slice(start, end + 1);
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
  options: { model?: string } & TransportOptions = {}
): Promise<LabelScanEnrichment> {
  if (!apiKey.trim()) throw new GeminiError('Add your Gemini API key first');
  const body = buildEnrichRequest(buildEnrichPrompt(input));
  const payload = await postGenerateContent(modelUrl(options.model), apiKey, body, options);

  const json = extractJsonObject(candidateText(payload));
  if (!json) throw new GeminiError("Couldn't find details for that coffee");
  try {
    return coerceEnrichment(JSON.parse(json));
  } catch {
    throw new GeminiError("Couldn't read the roaster's details");
  }
}

function modelUrl(model: string | undefined): string {
  return `${GEMINI_BASE}/models/${encodeURIComponent(model ?? GEMINI_LABEL_MODEL)}:generateContent`;
}

/** POST a generateContent body, retrying transient failures on the backoff schedule. */
async function postGenerateContent(
  url: string,
  apiKey: string,
  body: unknown,
  options: TransportOptions
): Promise<unknown> {
  const delays = options.retryDelaysMs ?? RETRY_DELAYS_MS;
  for (let attempt = 0; ; attempt++) {
    try {
      return await postOnce(url, apiKey, body, options);
    } catch (error) {
      if (!(error instanceof GeminiError) || !error.transient || attempt >= delays.length) throw error;
      await sleep(delays[attempt]!, options.signal);
    }
  }
}

/** One POST attempt with the caller's signal chained onto a local deadline. */
async function postOnce(url: string, apiKey: string, body: unknown, options: TransportOptions): Promise<unknown> {
  const attempt = requestDeadline(options.signal, options.timeoutMs ?? ATTEMPT_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      // Keep credentials out of URLs, browser history, logs, and error text.
      // Google's API reference specifies x-goog-api-key for every request.
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey.trim() },
      body: JSON.stringify(body),
      signal: attempt.signal
    });
    // Keep the same deadline and caller cancellation active through the body;
    // fetch resolves at headers, while response.json() can still stall.
    const payload = await response.json().catch((error: unknown) => {
      if (attempt.signal.aborted) throw error;
      return null;
    });
    if (!response.ok) throw statusError(payload, response.status);
    return payload;
  } catch (error) {
    // A caller-initiated abort is not a failure — let it propagate as-is.
    if (options.signal?.aborted) throw error;
    if (attempt.timedOut()) throw new GeminiError('Gemini took too long to answer — try again');
    if (error instanceof GeminiError) throw error;
    throw new GeminiError('Could not reach Gemini — check your connection', null, true);
  } finally {
    attempt.done();
  }
}

/** AbortSignal.any-compatible deadline for older tablet WebViews. */
function requestDeadline(caller: AbortSignal | undefined, timeoutMs: number): {
  signal: AbortSignal;
  timedOut(): boolean;
  done(): void;
} {
  const controller = new AbortController();
  let deadline = false;
  const onAbort = (): void => controller.abort(caller?.reason);
  if (caller?.aborted) onAbort();
  else caller?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => {
    deadline = true;
    controller.abort();
  }, timeoutMs);
  return {
    signal: controller.signal,
    timedOut: () => deadline,
    done: () => {
      clearTimeout(timer);
      caller?.removeEventListener('abort', onAbort);
    }
  };
}

/** Map an HTTP failure to a user-facing error; rate limits and overloads are transient. */
function statusError(payload: unknown, status: number): GeminiError {
  if (status === 429) return new GeminiError('Gemini is rate-limited right now — give it a minute', status, true);
  if (status >= 500) return new GeminiError('Gemini is overloaded — try again in a moment', status, true);
  const message = stringOr(asRecord(asRecord(payload)?.error)?.message, `Gemini error ${status}`);
  return new GeminiError(message, status);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function abortError(): Error {
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
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

// Models sometimes write the *word* null (or a cousin) instead of JSON null.
function strOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || /^(null|none|n\/a|unknown)$/i.test(text)) return null;
  return text;
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
