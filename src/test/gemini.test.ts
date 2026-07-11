import {
  buildEnrichRequest,
  buildGeminiRequest,
  coerceEnrichment,
  coerceLabelScan,
  enrichLabel,
  extractJsonObject,
  GeminiError,
  isGeminiKeyError,
  parseGeminiResponse,
  scanLabel,
  verifyGeminiKey
} from '../api/gemini';

run('builds a generateContent body with image parts before the text prompt', () => {
  const body = buildGeminiRequest(
    [
      { mime: 'image/jpeg', base64: 'AAA' },
      { mime: 'image/png', base64: 'BBB' }
    ],
    'read this'
  );

  const parts = body.contents[0]!.parts;
  equal(parts.length, 3);
  equal((parts[0] as { inline_data: { mime_type: string; data: string } }).inline_data.mime_type, 'image/jpeg');
  equal((parts[1] as { inline_data: { mime_type: string; data: string } }).inline_data.data, 'BBB');
  equal((parts[2] as { text: string }).text, 'read this');
  equal(body.generationConfig.responseMimeType, 'application/json');
  equal(body.generationConfig.temperature, 0.2);
  // Thinking is disabled for plain extraction — it adds latency and can yield empty candidates.
  equal(body.generationConfig.thinkingConfig.thinkingBudget, 0);
});

run('parses the JSON text out of a generateContent response', () => {
  const scan = parseGeminiResponse(
    okResponse(
      JSON.stringify({
        bean: { roaster: 'Onyx', name: 'Geometry' },
        batch: { weight: 250 },
        meta: { lowConfidenceFields: ['batch.roastDate'], rawText: 'Onyx Geometry' }
      })
    )
  );

  equal(scan.bean.roaster, 'Onyx');
  equal(scan.bean.name, 'Geometry');
  equal(scan.bean.country, null);
  equal(scan.batch.weight, 250);
  equal(scan.meta.lowConfidenceFields[0], 'batch.roastDate');
});

run('coerceLabelScan tolerates junk types and stringy numbers', () => {
  const scan = coerceLabelScan({
    bean: { roaster: 42, name: '  Geometry  ', notes: '' },
    batch: { weight: '250', roastLevel: 'Light' },
    meta: { lowConfidenceFields: ['name', 7] }
  });

  equal(scan.bean.roaster, null); // number -> null
  equal(scan.bean.name, 'Geometry'); // trimmed
  equal(scan.bean.notes, null); // empty -> null
  equal(scan.batch.weight, 250); // "250" -> 250
  equal(scan.meta.lowConfidenceFields.length, 1); // 7 filtered out
});

run('throws a GeminiError on an API error payload', () => {
  throwsMessage(() => parseGeminiResponse({ error: { message: 'API key not valid' } }), 'API key not valid');
});

run('throws when there are no candidates', () => {
  throwsMessage(() => parseGeminiResponse({ candidates: [] }), 'no result');
});

run('builds a grounded enrich request with the google_search tool', () => {
  const body = buildEnrichRequest('look up this coffee');
  equal(body.tools[0]!.google_search != null, true);
  equal(body.contents[0]!.parts[0]!.text, 'look up this coffee');
});

run('extracts a JSON object from grounded prose', () => {
  equal(extractJsonObject('Sure! Here: {"country":"Colombia"} (per the roaster)'), '{"country":"Colombia"}');
  equal(extractJsonObject('no json here'), null);
});

run('prefers a fenced JSON block over braces in the surrounding prose', () => {
  const text = 'Found it {on the site}!\n```json\n{"country":"Colombia"}\n```\nEnjoy {your brew}.';
  equal(extractJsonObject(text), '{"country":"Colombia"}');
});

run('coerces literal "null"-ish strings the model writes out to real nulls', () => {
  const enrichment = coerceEnrichment({ country: 'null', region: 'Unknown', processing: 'N/A', notes: 'Floral.' });
  equal(enrichment.country, null);
  equal(enrichment.region, null);
  equal(enrichment.processing, null);
  equal(enrichment.notes, 'Floral.');
});

run('coerces enrichment JSON, defaulting junk to null', () => {
  const enrichment = coerceEnrichment({ country: 'Colombia', region: 42, processing: '  Washed ', notes: null });
  equal(enrichment.country, 'Colombia');
  equal(enrichment.region, null);
  equal(enrichment.processing, 'Washed');
  equal(enrichment.notes, null);
});

await runAsync('scanLabel re-throws an abort instead of mapping it to a network GeminiError', async () => {
  const error = await withAbortingFetch((signal) =>
    scanLabel([{ mime: 'image/jpeg', base64: 'AAA' }], 'key', { signal })
  );
  equal(error instanceof GeminiError, false);
  equal(error instanceof Error && error.name, 'AbortError');
});

await runAsync('enrichLabel re-throws an abort instead of mapping it to a network GeminiError', async () => {
  const error = await withAbortingFetch((signal) =>
    enrichLabel({ roaster: 'Onyx', name: 'Geometry' }, 'key', { signal })
  );
  equal(error instanceof GeminiError, false);
  equal(error instanceof Error && error.name, 'AbortError');
});

await runAsync('scanLabel still maps plain network failures to a GeminiError', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch;
  try {
    await scanLabel([{ mime: 'image/jpeg', base64: 'AAA' }], 'key', { retryDelaysMs: [] });
    throw new Error('Expected scanLabel to reject');
  } catch (error) {
    if (!(error instanceof GeminiError)) throw new Error(`Expected GeminiError, got ${String(error)}`);
    equal(error.message.includes('Could not reach Gemini'), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await runAsync('scanLabel refuses an empty API key before touching the network', async () => {
  try {
    await scanLabel([{ mime: 'image/jpeg', base64: 'AAA' }], '   ');
    throw new Error('Expected scanLabel to reject');
  } catch (error) {
    if (!(error instanceof GeminiError)) throw new Error(`Expected GeminiError, got ${String(error)}`);
    equal(error.message.includes('API key'), true);
  }
});

await runAsync('Gemini authentication uses a header and never places the key in the URL', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    equal(url.includes('secret-key'), false);
    equal(url.includes('?key='), false);
    equal(new Headers(init?.headers).get('x-goog-api-key'), 'secret-key');
    return Promise.resolve(httpResponse(200, okResponse(JSON.stringify({ bean: {}, batch: {}, meta: {} }))));
  }) as typeof fetch;
  try {
    await scanLabel([{ mime: 'image/jpeg', base64: 'AAA' }], 'secret-key', { retryDelaysMs: [] });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await runAsync('scanLabel keeps its deadline active while reading the response body', async () => {
  const originalFetch = globalThis.fetch;
  let aborted = false;
  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
    const signal = init?.signal;
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          aborted = true;
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      })
    } as Response);
  }) as typeof fetch;
  try {
    await scanLabel([{ mime: 'image/jpeg', base64: 'AAA' }], 'key', { timeoutMs: 5, retryDelaysMs: [] });
    throw new Error('Expected scanLabel to time out');
  } catch (error) {
    if (!(error instanceof GeminiError)) throw new Error(`Expected GeminiError, got ${String(error)}`);
    equal(error.message.includes('too long'), true);
    equal(aborted, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await runAsync('Gemini key verification has an internal deadline', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    }, { once: true });
  })) as typeof fetch;
  try {
    const result = await verifyGeminiKey('key', { timeoutMs: 5 });
    equal(result.ok, false);
    equal(result.message.includes('timed out'), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await runAsync('scanLabel retries a transient 503 and succeeds on the next attempt', async () => {
  const payload = okResponse(JSON.stringify({ bean: { roaster: 'Onyx' }, batch: {}, meta: {} }));
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    calls++;
    return Promise.resolve(
      calls === 1 ? httpResponse(503, { error: { message: 'overloaded' } }) : httpResponse(200, payload)
    );
  }) as typeof fetch;
  try {
    const scan = await scanLabel([{ mime: 'image/jpeg', base64: 'AAA' }], 'key', { retryDelaysMs: [0, 0] });
    equal(calls, 2);
    equal(scan.bean.roaster, 'Onyx');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await runAsync('scanLabel does not retry a hard 400 (e.g. a bad key)', async () => {
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    calls++;
    return Promise.resolve(httpResponse(400, { error: { message: 'API key not valid' } }));
  }) as typeof fetch;
  try {
    await scanLabel([{ mime: 'image/jpeg', base64: 'AAA' }], 'key', { retryDelaysMs: [0, 0] });
    throw new Error('Expected scanLabel to reject');
  } catch (error) {
    if (!(error instanceof GeminiError)) throw new Error(`Expected GeminiError, got ${String(error)}`);
    equal(calls, 1);
    equal(error.status, 400);
    equal(isGeminiKeyError(error), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await runAsync('a 429 surfaces as a friendly transient rate-limit error', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(httpResponse(429, { error: { message: 'quota' } }))) as typeof fetch;
  try {
    await scanLabel([{ mime: 'image/jpeg', base64: 'AAA' }], 'key', { retryDelaysMs: [] });
    throw new Error('Expected scanLabel to reject');
  } catch (error) {
    if (!(error instanceof GeminiError)) throw new Error(`Expected GeminiError, got ${String(error)}`);
    equal(error.transient, true);
    equal(error.message.includes('rate-limited'), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

/** Run `fn` against a fetch fake that aborts the signal and rejects like the browser would. */
async function withAbortingFetch(fn: (signal: AbortSignal) => Promise<unknown>): Promise<unknown> {
  const controller = new AbortController();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    controller.abort();
    const abortError = new Error('The operation was aborted.');
    abortError.name = 'AbortError';
    return Promise.reject(abortError);
  }) as typeof fetch;
  try {
    await fn(controller.signal);
    throw new Error('Expected the request to reject');
  } catch (error) {
    return error;
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function okResponse(text: string): unknown {
  return { candidates: [{ content: { parts: [{ text }] } }] };
}

/** Minimal Response stand-in for the transport's fetch fakes. */
function httpResponse(status: number, payload: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(payload)
  } as unknown as Response;
}

function throwsMessage(fn: () => unknown, includes: string): void {
  try {
    fn();
  } catch (error) {
    if (!(error instanceof GeminiError)) throw new Error(`Expected GeminiError, got ${String(error)}`);
    if (!error.message.includes(includes)) {
      throw new Error(`Expected message to include "${includes}", got "${error.message}"`);
    }
    return;
  }
  throw new Error('Expected a GeminiError to be thrown');
}

function run(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

async function runAsync(name: string, fn: () => Promise<void>): Promise<void> {
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
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}
