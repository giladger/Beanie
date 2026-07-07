import {
  createSseDecoder,
  readDerekEvent,
  streamDerekAnswer,
  DerekRequestError,
  DerekStallError,
  DerekUnavailableError,
  type DerekEvent
} from '../api/derek';

run('SSE decoder yields complete events across arbitrary chunk boundaries', () => {
  const decoder = createSseDecoder();
  const wire = 'event: delta\ndata: {"text":"He"}\n\nevent: delta\ndata: {"text":"llo"}\n\n';
  // Feed one character at a time — nothing may be lost or duplicated.
  const messages = [...wire].flatMap((char) => decoder.push(char));
  equal(messages.length, 2);
  equal(messages[0]!.event, 'delta');
  equal(messages[0]!.data, '{"text":"He"}');
  equal(messages[1]!.data, '{"text":"llo"}');
});

run('SSE decoder handles CRLF, comments, multi-line data, and unknown fields', () => {
  const decoder = createSseDecoder();
  const messages = decoder.push(
    ': keepalive\r\n\r\nid: 7\r\nevent: result\r\ndata: {"a":\r\ndata: 1}\r\nretry: 100\r\n\r\n'
  );
  equal(messages.length, 1);
  equal(messages[0]!.event, 'result');
  equal(messages[0]!.data, '{"a":\n1}');
});

run('SSE decoder buffers an incomplete trailing event until it completes', () => {
  const decoder = createSseDecoder();
  equal(decoder.push('event: delta\ndata: {"text":"x"}').length, 0);
  const done = decoder.push('\n\n');
  equal(done.length, 1);
  equal(done[0]!.data, '{"text":"x"}');
});

run('readDerekEvent maps the live event vocabulary', () => {
  const queue = readDerekEvent({ event: 'queue', data: '{"position":2,"queued":true}' });
  if (queue?.type !== 'queue') throw new Error('expected queue');
  equal(queue.position, 2);
  equal(queue.queued, true);

  const phase = readDerekEvent({ event: 'phase', data: '{"phase":"evidence_found","hit_count":15}' });
  if (phase?.type !== 'phase') throw new Error('expected phase');
  equal(phase.phase, 'evidence_found');
  equal(phase.hitCount, 15);

  const delta = readDerekEvent({ event: 'delta', data: '{"text":"try"}' });
  if (delta?.type !== 'delta') throw new Error('expected delta');
  equal(delta.text, 'try');

  const result = readDerekEvent({
    event: 'result',
    data: JSON.stringify({
      mode: 'answer',
      answer_text: 'Grind finer. [1]',
      answer_id: 'abc',
      citations: [
        {
          citation_url: 'https://example.com/thread',
          section_title: 'Sour shots',
          source_type: 'comment',
          citation_date: '2026-05-31',
          source_numbers: [1]
        },
        { no_url: true }
      ]
    })
  });
  if (result?.type !== 'result') throw new Error('expected result');
  equal(result.result.answerText, 'Grind finer. [1]');
  equal(result.result.answerId, 'abc');
  equal(result.result.citations.length, 1);
  equal(result.result.citations[0]!.sectionTitle, 'Sour shots');
  equal(result.result.citations[0]!.sourceNumbers[0], 1);
});

run('readDerekEvent tolerates unknown events and bad payloads', () => {
  equal(readDerekEvent({ event: 'telemetry', data: '{}' }), null);
  equal(readDerekEvent({ event: 'delta', data: 'not json' }), null);
  equal(readDerekEvent({ event: 'delta', data: '{"no_text":1}' }), null);
  const error = readDerekEvent({ event: 'error', data: '{}' });
  if (error?.type !== 'error') throw new Error('expected error');
  equal(error.message, 'Derek reported an error');
});

// streamDerekAnswer reads the gateway origin from `window`; give Node a stub
// with an explicit override so `location` is never consulted.
(globalThis as unknown as { window: { BEANIE_GATEWAY?: string } }).window = {
  BEANIE_GATEWAY: 'http://gateway.test'
};

await run('streamDerekAnswer delivers events and resolves with the result', async () => {
  const wire =
    'event: phase\ndata: {"phase":"answering"}\n\n' +
    'event: delta\ndata: {"text":"Hi"}\n\n' +
    'event: result\ndata: {"mode":"answer","answer_text":"Hi. [1]","citations":[]}\n\n';
  const events: DerekEvent[] = [];
  const result = await streamDerekAnswer(
    { query: 'q' },
    { onEvent: (event) => events.push(event), fetchImpl: fakeSseFetch(200, [wire]) }
  );
  equal(events.length, 3);
  equal(result?.answerText, 'Hi. [1]');
});

await run('streamDerekAnswer posts the body to the relay path', async () => {
  let captured: { url: string; body: string } | null = null;
  await streamDerekAnswer(
    { query: 'sour shot', include_videos: true },
    {
      onEvent: () => {},
      fetchImpl: (input, init) => {
        captured = { url: String(input), body: String(init?.body) };
        return fakeSseFetch(200, [])(input, init);
      }
    }
  );
  if (!captured) throw new Error('fetch not called');
  const probe = captured as { url: string; body: string };
  if (!probe.url.endsWith('/api/v1/derek/answers/stream')) {
    throw new Error(`unexpected url ${probe.url}`);
  }
  equal(probe.body, '{"query":"sour shot","include_videos":true}');
});

await run('streamDerekAnswer maps 404 to DerekUnavailableError', async () => {
  await expectRejects(
    streamDerekAnswer({ query: 'q' }, { onEvent: () => {}, fetchImpl: fakeSseFetch(404, []) }),
    DerekUnavailableError
  );
});

await run('streamDerekAnswer maps other HTTP failures to DerekRequestError with status', async () => {
  const error = await expectRejects(
    streamDerekAnswer(
      { query: 'q' },
      { onEvent: () => {}, fetchImpl: fakeSseFetch(429, [], 'rate limited') }
    ),
    DerekRequestError
  );
  equal((error as DerekRequestError).status, 429);
});

await run('streamDerekAnswer resolves null when the stream ends without a result', async () => {
  const result = await streamDerekAnswer(
    { query: 'q' },
    { onEvent: () => {}, fetchImpl: fakeSseFetch(200, ['event: delta\ndata: {"text":"par"}\n\n']) }
  );
  equal(result, null);
});

await run('streamDerekAnswer throws DerekStallError when the stream goes silent', async () => {
  // A stream that never closes and never emits: the stall timer must fire.
  await expectRejects(
    streamDerekAnswer(
      { query: 'q' },
      { onEvent: () => {}, stallMs: 20, fetchImpl: silentSseFetch() }
    ),
    DerekStallError
  );
});

await run('streamDerekAnswer aborts when the caller signal fires', async () => {
  const controller = new AbortController();
  const pending = streamDerekAnswer(
    { query: 'q' },
    { onEvent: () => {}, signal: controller.signal, fetchImpl: silentSseFetch() }
  );
  controller.abort();
  let threw = false;
  try {
    await pending;
  } catch (error) {
    threw = true;
    if (error instanceof DerekStallError) throw new Error('caller abort must not read as a stall');
  }
  equal(threw, true);
});

// A stream that never emits and never closes, but — like real fetch — errors
// its pending read when the request's abort signal fires.
function silentSseFetch(): typeof fetch {
  return async (_input, init) => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const abort = () => controller.error(new DOMException('aborted', 'AbortError'));
        if (init?.signal?.aborted) return abort();
        init?.signal?.addEventListener('abort', abort, { once: true });
      }
    });
    return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };
}

function fakeSseFetch(status: number, chunks: string[], errorBody = ''): typeof fetch {
  return async (_input, init) => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const abort = () => controller.error(new DOMException('aborted', 'AbortError'));
        if (init?.signal?.aborted) return abort();
        init?.signal?.addEventListener('abort', abort, { once: true });
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      }
    });
    if (status !== 200) return new Response(errorBody, { status });
    return new Response(stream, { status, headers: { 'Content-Type': 'text/event-stream' } });
  };
}

async function expectRejects(
  promise: Promise<unknown>,
  errorClass: new (...args: never[]) => Error
): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof errorClass) return error;
    throw new Error(`Expected ${errorClass.name}, got ${String(error)}`);
  }
  throw new Error(`Expected ${errorClass.name}, but nothing was thrown`);
}

async function run(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

function equal<T>(actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  }
}
