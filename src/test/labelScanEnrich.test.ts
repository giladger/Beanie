import {
  buildEnrichPrompt,
  mergeEnrichment,
  type LabelScanDraft,
  type LabelScanEnrichment
} from '../domain/labelScan';

run('enrich prompt names the roaster and coffee and asks for JSON only', () => {
  const prompt = buildEnrichPrompt({ roaster: 'Onyx', name: 'Geometry', country: 'Colombia' });
  includes(prompt, 'Roaster: Onyx');
  includes(prompt, 'Coffee: Geometry');
  includes(prompt, 'Origin so far: Colombia');
  includes(prompt, 'ONLY a JSON object');
});

run('merge fills empty origin fields and flags them as web-sourced', () => {
  const { draft, webFields } = mergeEnrichment(
    draftOf({ country: '', region: '', processing: 'Washed' }),
    enrichmentOf({ country: 'Colombia', region: 'Huila', processing: 'Natural' })
  );
  equal(draft.country, 'Colombia'); // was empty -> filled
  equal(draft.region, 'Huila'); // was empty -> filled
  equal(draft.processing, 'Washed'); // label value kept, not clobbered
  equal(webFields.includes('country'), true);
  equal(webFields.includes('region'), true);
  equal(webFields.includes('processing'), false);
});

run('merge appends web notes without duplicating', () => {
  const first = mergeEnrichment(draftOf({ notes: 'Stone fruit.' }), enrichmentOf({ notes: 'Producer: La Esperanza.' }));
  equal(first.draft.notes, 'Stone fruit.\nProducer: La Esperanza.');
  equal(first.webFields.includes('notes'), true);

  // Re-running with the same note doesn't append it again.
  const second = mergeEnrichment(first.draft, enrichmentOf({ notes: 'Producer: La Esperanza.' }));
  equal(second.draft.notes, 'Stone fruit.\nProducer: La Esperanza.');
  equal(second.webFields.includes('notes'), false);
});

run('merge ignores blank enrichment and leaves the draft untouched', () => {
  const { draft, webFields } = mergeEnrichment(
    draftOf({ country: 'Kenya' }),
    enrichmentOf({ country: '  ', notes: null })
  );
  equal(draft.country, 'Kenya');
  equal(webFields.length, 0);
});

function draftOf(partial: Partial<LabelScanDraft>): LabelScanDraft {
  return {
    roaster: '',
    name: '',
    country: '',
    region: '',
    processing: '',
    notes: '',
    roastDate: '',
    roastLevel: '',
    weight: '',
    ...partial
  };
}

function enrichmentOf(partial: Partial<LabelScanEnrichment>): LabelScanEnrichment {
  return { country: null, region: null, processing: null, notes: null, ...partial };
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

function includes(text: string, expected: string): void {
  if (!text.includes(expected)) {
    throw new Error(`Expected output to include ${JSON.stringify(expected)}`);
  }
}
