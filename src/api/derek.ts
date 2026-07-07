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
export function createSseDecoder(): { push(chunk: string): SseMessage[] } {
  let buffer = '';
  return {
    push(chunk: string): SseMessage[] {
      buffer += chunk;
      const messages: SseMessage[] = [];
      // An event ends at a blank line. Normalizing CRLF up front keeps the
      // boundary scan simple.
      buffer = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const message = readSseBlock(block);
        if (message) messages.push(message);
        boundary = buffer.indexOf('\n\n');
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
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_STALL_MS = 45000;

// Ask Derek a question and stream the answer. Resolves with the final result,
// or null when the stream ended cleanly without one (treat as interrupted).
// Every event — including the result — is also delivered through `onEvent`.
export async function streamDerekAnswer(
  body: Record<string, unknown>,
  options: StreamDerekOptions
): Promise<DerekResult | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const stallMs = options.stallMs ?? DEFAULT_STALL_MS;

  // One internal controller aborts the fetch for both cancel reasons; `stalled`
  // disambiguates ours from the caller's.
  const controller = new AbortController();
  let stalled = false;
  const onCallerAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onCallerAbort, { once: true });

  let stallTimer: ReturnType<typeof setTimeout> | null = null;
  const armStallTimer = () => {
    if (stallTimer != null) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      stalled = true;
      controller.abort();
    }, stallMs);
  };

  try {
    let response: Response;
    armStallTimer();
    try {
      response = await fetchImpl(
        `${gatewayHttpOrigin()}/api/v1/derek/answers/stream`,
        withSkinProxyToken({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal
        })
      );
    } catch (cause) {
      if (stalled) throw new DerekStallError();
      throw cause;
    }

    if (response.status === 404) throw new DerekUnavailableError();
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new DerekRequestError(
        response.status,
        detail ? `Derek returned ${response.status}: ${detail.slice(0, 300)}` : `Derek returned ${response.status}`
      );
    }
    if (!response.body) throw new DerekRequestError(0, 'Derek returned no response stream');

    const reader = response.body.getReader();
    const textDecoder = new TextDecoder();
    const sse = createSseDecoder();
    let result: DerekResult | null = null;

    for (;;) {
      let read: ReadableStreamReadResult<Uint8Array>;
      try {
        read = await reader.read();
      } catch (cause) {
        if (stalled) throw new DerekStallError();
        throw cause;
      }
      if (read.done) break;
      armStallTimer();
      for (const message of sse.push(textDecoder.decode(read.value, { stream: true }))) {
        const event = readDerekEvent(message);
        if (!event) continue;
        options.onEvent(event);
        if (event.type === 'result') result = event.result;
      }
    }
    return result;
  } finally {
    if (stallTimer != null) clearTimeout(stallTimer);
    options.signal?.removeEventListener('abort', onCallerAbort);
  }
}
