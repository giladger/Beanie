import {
  buildEnrichRequest,
  buildGeminiRequest,
  coerceEnrichment,
  coerceLabelScan,
  extractJsonObject,
  GeminiError,
  parseGeminiResponse
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
  equal(body.generationConfig.temperature, 0);
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

run('coerces enrichment JSON, defaulting junk to null', () => {
  const enrichment = coerceEnrichment({ country: 'Colombia', region: 42, processing: '  Washed ', notes: null });
  equal(enrichment.country, 'Colombia');
  equal(enrichment.region, null);
  equal(enrichment.processing, 'Washed');
  equal(enrichment.notes, null);
});

function okResponse(text: string): unknown {
  return { candidates: [{ content: { parts: [{ text }] } }] };
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

function equal<T>(actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}
