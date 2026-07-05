import type { Bean } from '../api/types';
import {
  buildLabelScanPrompt,
  canonicalizeDraft,
  countRoasterBeans,
  draftToBatchFields,
  draftToBeanFields,
  findExistingBean,
  LABEL_SCAN_PROMPT,
  labelScanToDraft,
  lowConfidenceFields,
  normalizeIsoDate,
  type LabelScan,
  type LabelScanDraft
} from '../domain/labelScan';

run('maps a scan into an editable draft, normalizing date and weight', () => {
  const draft = labelScanToDraft(
    scan({
      bean: { roaster: '  Onyx  ', name: 'Geometry', country: 'Colombia', notes: 'stone fruit' },
      batch: { roastDate: '2026-06-01', roastLevel: 'Light', weight: 250 }
    })
  );

  equal(draft.roaster, 'Onyx');
  equal(draft.name, 'Geometry');
  equal(draft.country, 'Colombia');
  equal(draft.notes, 'stone fruit');
  equal(draft.roastDate, '2026-06-01');
  equal(draft.roastLevel, 'Light');
  equal(draft.weight, '250');
  // Unset fields become empty strings, not "null".
  equal(draft.region, '');
});

run('drops junk dates and non-positive weights when drafting', () => {
  const draft = labelScanToDraft(
    scan({ batch: { roastDate: 'sometime last week', roastLevel: null, weight: 0 } })
  );
  equal(draft.roastDate, '');
  equal(draft.weight, '');
});

run('draft -> bean fields trims and nulls empty optionals', () => {
  const fields = draftToBeanFields(
    draft({ roaster: '  Onyx ', name: ' Geometry ', country: '  ', notes: 'syrupy' })
  );
  equal(fields.roaster, 'Onyx');
  equal(fields.name, 'Geometry');
  equal(fields.country, null);
  equal(fields.notes, 'syrupy');
});

run('draft -> batch fields parses weight and mirrors it into weightRemaining', () => {
  const full = draftToBatchFields(draft({ roastDate: '2026-06-01', roastLevel: 'Medium', weight: '250' }));
  equal(full.weight, 250);
  equal(full.weightRemaining, 250);
  equal(full.roastDate, '2026-06-01');
  equal(full.roastLevel, 'Medium');

  const noWeight = draftToBatchFields(draft({ weight: '' }));
  equal(noWeight.weight, null);
  equal(noWeight.weightRemaining, null);
});

run('finds an existing bean by roaster + name, case-insensitively', () => {
  const beans: Bean[] = [
    { id: 'a', roaster: 'Onyx', name: 'Geometry' },
    { id: 'b', roaster: 'Sey', name: 'Hot Springs', archived: true }
  ];
  equal(findExistingBean(beans, '  onyx ', 'GEOMETRY')?.id, 'a');
  // Archived beans never match.
  equal(findExistingBean(beans, 'Sey', 'Hot Springs'), null);
  // No match, or missing identity, returns null.
  equal(findExistingBean(beans, 'Onyx', 'Mythology'), null);
  equal(findExistingBean(beans, '', 'Geometry'), null);
});

run('scan prompt folds in the active library; empty library falls back to the base prompt', () => {
  const beans: Bean[] = [
    { id: 'a', roaster: 'Onyx', name: 'Geometry' },
    { id: 'b', roaster: 'Sey', name: 'Hot Springs', archived: true }
  ];
  const prompt = buildLabelScanPrompt(beans);
  equal(prompt.includes('"Onyx" | "Geometry"'), true);
  // Archived beans stay out of the prompt (canonicalizeDraft still knows them).
  equal(prompt.includes('Hot Springs'), false);
  // The JSON shape instruction survives, still at the end.
  equal(prompt.includes('Respond with ONLY a JSON object'), true);
  equal(buildLabelScanPrompt([]), LABEL_SCAN_PROMPT);
});

run('canonicalizeDraft snaps scanned spellings to the library', () => {
  const beans: Bean[] = [
    { id: 'a', roaster: 'Onyx', name: 'Geometry', country: 'Colombia', processing: 'Washed' },
    { id: 'b', roaster: 'Sey', name: 'Geometria', archived: true }
  ];
  const snapped = canonicalizeDraft(
    draft({ roaster: 'ONYX', name: 'GEOMETRY', country: 'colombia', processing: 'washed', region: 'Huila' }),
    beans
  );
  equal(snapped.roaster, 'Onyx');
  equal(snapped.name, 'Geometry');
  equal(snapped.country, 'Colombia');
  equal(snapped.processing, 'Washed');
  // No library match — the scanned value stands.
  equal(snapped.region, 'Huila');
  // Archived beans still lend their spelling.
  equal(canonicalizeDraft(draft({ roaster: 'SEY' }), beans).roaster, 'Sey');
  // A bean name only snaps within its own roaster.
  equal(canonicalizeDraft(draft({ roaster: 'Onyx', name: 'geometria' }), beans).name, 'geometria');
});

run('countRoasterBeans counts case-insensitively, archived included', () => {
  const beans: Bean[] = [
    { id: 'a', roaster: 'Onyx', name: 'Geometry' },
    { id: 'b', roaster: 'ONYX', name: 'Monarch', archived: true },
    { id: 'c', roaster: 'Sey', name: 'Hot Springs' }
  ];
  equal(countRoasterBeans(beans, ' onyx '), 2);
  equal(countRoasterBeans(beans, 'Gardelli'), 0);
  equal(countRoasterBeans(beans, ''), 0);
});

run('collects low-confidence draft fields from dotted or bare paths', () => {
  const set = lowConfidenceFields(scan({ meta: { lowConfidenceFields: ['batch.roastDate', 'name'], rawText: null } }));
  equal(set.has('roastDate'), true);
  equal(set.has('name'), true);
  equal(set.has('weight'), false);
  // Missing meta yields an empty set rather than throwing.
  equal(lowConfidenceFields(scan({})).size, 0);
});

run('normalizeIsoDate passes ISO through, reformats UTC, nulls junk', () => {
  equal(normalizeIsoDate('2026-06-01'), '2026-06-01');
  equal(normalizeIsoDate('2026-06-01T08:00:00Z'), '2026-06-01');
  equal(normalizeIsoDate('not a date'), null);
  equal(normalizeIsoDate(''), null);
});

function scan(partial: {
  bean?: Partial<LabelScan['bean']>;
  batch?: Partial<LabelScan['batch']>;
  meta?: Partial<LabelScan['meta']>;
}): LabelScan {
  return {
    bean: {
      roaster: null,
      name: null,
      country: null,
      region: null,
      processing: null,
      notes: null,
      ...partial.bean
    },
    batch: { roastDate: null, roastLevel: null, weight: null, ...partial.batch },
    meta: { lowConfidenceFields: [], rawText: null, ...partial.meta }
  };
}

function draft(partial: Partial<LabelScanDraft>): LabelScanDraft {
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
