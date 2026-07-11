// Client for Derek, Decent's RAG knowledge-base assistant, via the reaprime
// relay (`POST /api/v1/derek/answers/stream` → derek.decentespresso.com). The
// relay exists because Derek's server doesn't answer CORS preflight, so a
// browser can't call it directly; reaprime pipes the SSE response back
// unbuffered so the answer renders as it streams.
//
// The stream's event vocabulary (probed live against Derek):
//   queue  {"position": 0, "queued": false}
//   phase  {"phase": "searching_database" | "evidence_found" (+hit_count)
//           | "answering"}
//   delta  {"text": "..."}            — markdown answer tokens
//   result {"mode", "answer_text", "citations": [...], "answer_id"}
//   error  {...}                      — Derek-side failure
import { gatewayHttpOrigin, withSkinProxyToken } from './gateway';

export type DerekEvent =
  | { type: 'queue'; position: number; queued: boolean }
  | { type: 'phase'; phase: string; hitCount: number | null }
  | { type: 'delta'; text: string }
  | { type: 'result'; result: DerekResult }
  | { type: 'error'; message: string };

export interface DerekCitation {
  url: string;
  sectionTitle: string;
  sourceType: string | null;
  date: string | null;
  /** The `[n]` markers in the answer text this citation backs. */
  sourceNumbers: number[];
}

export interface DerekResult {
  mode: string;
  answerText: string;
  citations: DerekCitation[];
  answerId: string | null;
}

/** The gateway answered 404: this reaprime build has no Derek relay yet. */
export class DerekUnavailableError extends Error {
  constructor() {
    super('The Derek relay is not available on this gateway');
    this.name = 'DerekUnavailableError';
  }
}

export class DerekRequestError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'DerekRequestError';
  }
}

/** The stream went silent (no event of any kind) for longer than the budget. */
export class DerekStallError extends Error {
  constructor() {
    super('Derek stopped responding mid-answer');
    this.name = 'DerekStallError';
  }
}

/** The request stayed active but exceeded the absolute end-to-end budget. */
export class DerekDeadlineError extends DerekRequestError {
  constructor() {
    super(0, 'Derek took too long to finish the answer');
    this.name = 'DerekDeadlineError';
  }
}

/** A malformed or unexpectedly large relay response crossed a memory bound. */
export class DerekResponseLimitError extends DerekRequestError {
  constructor(message = "Derek's answer was larger than Beanie can safely display") {
    super(0, message);
    this.name = 'DerekResponseLimitError';
  }
}

// Raw `event:`/`data:` pair as it appears on the wire.
export interface SseMessage {
  event: string;
  data: string;
}

// Incremental SSE decoder. Feed it decoded text chunks as they arrive (chunks
// can split events, lines, even UTF-8-decoded characters anywhere) and it
// yields complete messages. Handles CRLF, multi-line `data:` (joined with
// newlines per the SSE spec), and ignores comment lines and fields we don't
// use (`id:`, `retry:`).
export interface SseDecoderOptions {
  /** Maximum characters retained for one incomplete SSE event. */
  maxBufferChars?: number;
}

const DEFAULT_MAX_EVENT_CHARS = 256 * 1024;

export function createSseDecoder(options: SseDecoderOptions = {}): { push(chunk: string): SseMessage[] } {
  let buffer = '';
  const maxBufferChars = positiveLimit(options.maxBufferChars, DEFAULT_MAX_EVENT_CHARS);
  return {
    push(chunk: string): SseMessage[] {
      buffer += chunk;
      const messages: SseMessage[] = [];
      // An event ends at a blank line. Normalizing CRLF up front keeps the
      // boundary scan simple.
      buffer = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        if (boundary > maxBufferChars) {
          throw new DerekResponseLimitError('Derek returned an oversized streaming event');
        }
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const message = readSseBlock(block);
        if (message) messages.push(message);
        boundary = buffer.indexOf('\n\n');
      }
      if (buffer.length > maxBufferChars) {
        throw new DerekResponseLimitError('Derek returned an oversized streaming event');
      }
      return messages;
    }
  };
}

function readSseBlock(block: string): SseMessage | null {
  let event = 'message';
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    // Per spec a single leading space after the colon is not part of the value.
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  if (data.length === 0) return null;
  return { event, data: data.join('\n') };
}

// Map a wire message onto the typed event union. Unknown event names and
// unparseable payloads return null — the stream must survive vocabulary
// growth on Derek's side.
export function readDerekEvent(message: SseMessage): DerekEvent | null {
  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(message.data) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    payload = parsed as Record<string, unknown>;
  } catch {
    return null;
  }

  switch (message.event) {
    case 'queue':
      return {
        type: 'queue',
        position: typeof payload.position === 'number' ? payload.position : 0,
        queued: payload.queued === true
      };
    case 'phase':
      return {
        type: 'phase',
        phase: typeof payload.phase === 'string' ? payload.phase : '',
        hitCount: typeof payload.hit_count === 'number' ? payload.hit_count : null
      };
    case 'delta':
      return typeof payload.text === 'string' ? { type: 'delta', text: payload.text } : null;
    case 'result':
      return { type: 'result', result: readResult(payload) };
    case 'error':
      return {
        type: 'error',
        message:
          typeof payload.message === 'string'
            ? payload.message
            : typeof payload.detail === 'string'
              ? payload.detail
              : 'Derek reported an error'
      };
    default:
      return null;
  }
}

function readResult(payload: Record<string, unknown>): DerekResult {
  const rawCitations = Array.isArray(payload.citations) ? payload.citations : [];
  const citations: DerekCitation[] = [];
  for (const raw of rawCitations) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    if (typeof item.citation_url !== 'string') continue;
    citations.push({
      url: item.citation_url,
      sectionTitle: typeof item.section_title === 'string' ? item.section_title : '',
      sourceType: typeof item.source_type === 'string' ? item.source_type : null,
      date: typeof item.citation_date === 'string' ? item.citation_date : null,
      sourceNumbers: Array.isArray(item.source_numbers)
        ? item.source_numbers.filter((value): value is number => typeof value === 'number')
        : []
    });
  }
  return {
    mode: typeof payload.mode === 'string' ? payload.mode : 'answer',
    answerText: typeof payload.answer_text === 'string' ? payload.answer_text : '',
    citations,
    answerId: typeof payload.answer_id === 'string' ? payload.answer_id : null
  };
}

export type DerekRelayAvailability = 'available' | 'missing' | 'unknown';

// Cheap availability check: an invalid body costs Derek a fast validation 4xx
// (no model run), while a gateway without the relay route answers 404. Network
// failure is inconclusive — the gateway may just be rebooting — so the caller
// should keep the feature visible and let a real ask surface the error.
export async function probeDerekRelay(
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 10_000
): Promise<DerekRelayAvailability> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(
      `${gatewayHttpOrigin()}/api/v1/derek/answers/stream`,
      withSkinProxyToken({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        signal: controller.signal
      })
    );
    void response.body?.cancel().catch(() => {});
    return response.status === 404 ? 'missing' : 'available';
  } catch {
    return 'unknown';
  } finally {
    clearTimeout(timer);
  }
}

export interface StreamDerekOptions {
  onEvent: (event: DerekEvent) => void;
  signal?: AbortSignal;
  /**
   * Silence budget. Derek can queue and think for a long time, but it emits
   * queue/phase events while doing so — a stream with NO events for this long
   * is treated as dead. Deliberately not the app's 20s request timeout, which
   * would kill every answer.
   */
  stallMs?: number;
  /** Absolute end-to-end budget, even while the relay keeps emitting events. */
  totalMs?: number;
  /** Maximum characters retained for one incomplete SSE event. */
  maxEventChars?: number;
  /** Maximum cumulative streamed answer characters and final answer length. */
  maxAnswerChars?: number;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_STALL_MS = 45000;
const DEFAULT_TOTAL_MS = 3 * 60 * 1000;
const DEFAULT_MAX_ANSWER_CHARS = 100 * 1024;

// Ask Derek a question and stream the answer. Resolves with the final result,
// or null when the stream ended cleanly without one (treat as interrupted).
// Every event — including the result — is also delivered through `onEvent`.
export async function streamDerekAnswer(
  body: Record<string, unknown>,
  options: StreamDerekOptions
): Promise<DerekResult | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const stallMs = positiveLimit(options.stallMs, DEFAULT_STALL_MS);
  const totalMs = positiveLimit(options.totalMs, DEFAULT_TOTAL_MS);
  const maxAnswerChars = positiveLimit(options.maxAnswerChars, DEFAULT_MAX_ANSWER_CHARS);

  // One internal controller aborts the fetch for every stop reason. The flags
  // disambiguate our two deadlines from caller cancellation, whose original
  // rejection remains untouched.
  const controller = new AbortController();
  let stalled = false;
  let deadlineExceeded = false;
  const onCallerAbort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) onCallerAbort();
  else options.signal?.addEventListener('abort', onCallerAbort, { once: true });

  let stallTimer: ReturnType<typeof setTimeout> | null = null;
  const armStallTimer = () => {
    if (stallTimer != null) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      stalled = true;
      controller.abort();
    }, stallMs);
  };
  const deadlineTimer = setTimeout(() => {
    deadlineExceeded = true;
    controller.abort();
  }, totalMs);

  try {
    armStallTimer();
    const response = await fetchImpl(
      `${gatewayHttpOrigin()}/api/v1/derek/answers/stream`,
      withSkinProxyToken({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      })
    );

    if (response.status === 404) throw new DerekUnavailableError();
    if (!response.ok) {
      const detail = await response.text();
      throw new DerekRequestError(
        response.status,
        detail ? `Derek returned ${response.status}: ${detail.slice(0, 300)}` : `Derek returned ${response.status}`
      );
    }
    if (!response.body) throw new DerekRequestError(0, 'Derek returned no response stream');

    const reader = response.body.getReader();
    const textDecoder = new TextDecoder();
    const sse = createSseDecoder({ maxBufferChars: options.maxEventChars });
    let result: DerekResult | null = null;
    let streamedAnswerChars = 0;

    for (;;) {
      const read = await reader.read();
      if (read.done) break;
      for (const message of sse.push(textDecoder.decode(read.value, { stream: true }))) {
        // A complete relay event, including a future event we do not yet
        // understand, proves the stream is making semantic progress. Raw bytes
        // alone do not: an attacker cannot drip-feed one unbounded event.
        armStallTimer();
        const event = readDerekEvent(message);
        if (!event) continue;
        if (event.type === 'delta') {
          streamedAnswerChars += event.text.length;
          if (streamedAnswerChars > maxAnswerChars) throw new DerekResponseLimitError();
        } else if (event.type === 'result' && event.result.answerText.length > maxAnswerChars) {
          throw new DerekResponseLimitError();
        }
        options.onEvent(event);
        if (event.type === 'result') result = event.result;
      }
    }
    return result;
  } catch (cause) {
    // Locally detected protocol/consumer failures must also tear down the
    // network stream instead of leaving an unread response alive in the
    // background. Timer/caller aborts have already done so.
    if (!controller.signal.aborted) controller.abort();
    if (deadlineExceeded) throw new DerekDeadlineError();
    if (stalled) throw new DerekStallError();
    throw cause;
  } finally {
    if (stallTimer != null) clearTimeout(stallTimer);
    clearTimeout(deadlineTimer);
    options.signal?.removeEventListener('abort', onCallerAbort);
  }
}

function positiveLimit(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}
