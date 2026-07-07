import type { ShotMeasurement, ShotRecord } from '../api/types';
import {
  buildDialInContext,
  composeDialInQuery,
  downsampleTelemetry,
  extractDialInSuggestions,
  jsonFenceCutoff,
  suggestionTitle,
  type DialInContext
} from '../domain/dialIn';

function measurement(tS: number, pressure: number, flow: number, weight: number): ShotMeasurement {
  return {
    machine: {
      timestamp: new Date(1_700_000_000_000 + tS * 1000).toISOString(),
      pressure,
      flow,
      state: { state: 'espresso', substate: 'pouring' }
    } as ShotMeasurement['machine'],
    scale: { weight }
  };
}

function shotWith(measurements: ShotMeasurement[]): ShotRecord {
  return {
    id: 'shot-1',
    timestamp: '2026-07-01T08:00:00.000Z',
    measurements,
    stopReason: 'targetWeight',
    workflow: {
      profile: { title: 'Extractamundo Dos!', steps: [{ temperature: 92 }] },
      context: {
        targetDoseWeight: 18,
        targetYield: 40,
        grinderModel: 'Niche Zero',
        grinderSetting: 14.5
      }
    },
    annotations: { actualDoseWeight: 18.1, actualYield: 38, drinkTds: 8.5, enjoyment: 40 }
  };
}

const emptyContext: DialInContext = {
  profileTitle: null,
  bean: null,
  grinder: null,
  recipe: { doseG: null, yieldG: null, temperatureC: null },
  shot: null,
  telemetry: []
};

run('buildDialInContext assembles bean, grinder, recipe, and shot facts', () => {
  const shot = shotWith([measurement(0, 1, 0.5, 0), measurement(10, 8.9, 2.1, 12), measurement(22, 8.4, 2.0, 38)]);
  const context = buildDialInContext({
    shot,
    bean: { id: 'b', name: 'Chelchele', roaster: 'Roastery', processing: 'washed', country: 'Ethiopia' },
    batch: { id: 'ba', beanId: 'b', roastDate: '2026-06-25T00:00:00.000Z', roastLevel: 'light' },
    grinder: { id: 'g', model: 'Niche Zero' },
    now: new Date('2026-07-07T00:00:00.000Z')
  });
  equal(context.profileTitle, 'Extractamundo Dos!');
  equal(context.bean?.name, 'Chelchele');
  equal(context.bean?.roastLevel, 'light');
  equal(context.bean?.roastAgeDays, 12);
  equal(context.grinder?.model, 'Niche Zero');
  equal(context.grinder?.setting, '14.5');
  equal(context.recipe.doseG, 18.1);
  equal(context.recipe.yieldG, 40);
  equal(context.recipe.temperatureC, 92);
  equal(context.shot?.peakPressureBar, 8.9);
  equal(context.shot?.stopReason, 'targetWeight');
  equal(context.shot?.enjoymentLabel, 'meh (40/100)');
  equal(context.telemetry.length, 3);
});

run('downsampleTelemetry keeps full resolution and thins only past the cap', () => {
  const short = shotWith(
    Array.from({ length: 50 }, (_, index) => measurement(index * 0.2, 8, 2, index))
  );
  const shortRows = downsampleTelemetry(short);
  // A typical shot fits whole: every 5Hz sample is passed through.
  equal(shortRows.length, 50);
  equal(shortRows[0]!.t, 0);

  const long = shotWith(Array.from({ length: 900 }, (_, index) => measurement(index * 0.2, 8, 2, index)));
  const longRows = downsampleTelemetry(long);
  equal(longRows.length <= 300, true);
  // The final sample survives thinning — the end of the shot matters.
  equal(longRows[longRows.length - 1]!.t, 179.8);
});

run('composeDialInQuery reads naturally and carries the contract', () => {
  const shot = shotWith([measurement(0, 1, 0.5, 0), measurement(22, 8.9, 2.1, 38)]);
  const context = buildDialInContext({
    shot,
    bean: { id: 'b', name: 'Chelchele', roaster: 'Roastery' },
    batch: { id: 'ba', beanId: 'b', roastLevel: 'light' },
    grinder: null
  });
  const query = composeDialInQuery(context, { tasteChipIds: ['sour', 'fast'], note: 'Second bag.' });
  contains(query, 'profile "Extractamundo Dos!"');
  contains(query, 'Bean: Chelchele by Roastery, light roast.');
  contains(query, 'Grinder: Niche Zero at setting 14.5.');
  contains(query, '18.1g in 40g out target (1:2.2)');
  contains(query, 'stopped at target weight');
  contains(query, 'Full shot telemetry (t_s, pressure_bar, flow_mls, weight_g, group_temp_c, weight_flow_gs):');
  contains(query, 'The shot tasted sour, and ran too fast.');
  contains(query, 'Second bag.');
  contains(query, 'What should I change for the next shot?');
  contains(query, '```json');
  contains(query, 'exactly ONE parameter');
});

run('a previous Derek tweak stamped on the shot feeds back into the next ask', () => {
  const shot = shotWith([measurement(0, 1, 0.5, 0), measurement(22, 8.9, 2.1, 38)]);
  shot.annotations = {
    ...shot.annotations,
    extras: { derekTweak: 'Preinfusion time 8s → 13s' }
  };
  const context = buildDialInContext({ shot, bean: null, batch: null, grinder: null });
  equal(context.previousTweak, 'Preinfusion time 8s → 13s');
  const query = composeDialInQuery(context, { tasteChipIds: ['bitter'], note: '' });
  contains(query, 'this shot was pulled after making this change');
  contains(query, 'Preinfusion time 8s → 13s');
});

run('composeDialInQuery with nothing described asks Derek to read the shot', () => {
  const shot = shotWith([measurement(0, 1, 0.5, 0), measurement(22, 8.9, 2.1, 38)]);
  const context = buildDialInContext({ shot, bean: null, batch: null, grinder: null });
  const query = composeDialInQuery(context, { tasteChipIds: [], note: '' });
  contains(query, 'tell me how this shot looks');
  if (query.includes('What should I change for the next shot?')) {
    throw new Error('the described-shot question must be replaced by the read-the-shot ask');
  }
  contains(query, '```json'); // the output contract still applies
});

run('composeDialInQuery with a free question skips the taste sentence', () => {
  const query = composeDialInQuery(emptyContext, {
    tasteChipIds: ['sour'],
    note: '',
    freeQuestion: 'How do I clean the group head?'
  });
  contains(query, 'How do I clean the group head?');
  if (query.includes('tasted sour')) throw new Error('taste sentence must be omitted');
});

run('extractDialInSuggestions parses the fenced block and strips it from display', () => {
  const context: DialInContext = {
    ...emptyContext,
    recipe: { doseG: 18, yieldG: 40, temperatureC: 92 },
    shot: {
      durationS: 22,
      actualYieldG: 38,
      firstDropsS: 8,
      peakPressureBar: 8.9,
      avgFlowMls: 2.1,
      avgTemperatureC: 92,
      stopReason: null,
      tds: null,
      ey: null,
      enjoymentLabel: null
    }
  };
  const answer = [
    'Try a longer preinfusion first. [3]',
    '```json',
    JSON.stringify({
      suggestions: [
        { parameter: 'preinfusion_time', direction: 'increase', current: 8, target: 13, unit: 'seconds', why: 'Longer preinfusion. [3]' },
        { parameter: 'brew_temperature', direction: 'increase', current: 90, target: 95, unit: '°C', why: 'Hotter helps light roasts.' },
        { parameter: 'wdt', direction: null, current: null, target: 'full-depth', unit: null, why: 'Improve puck prep.' },
        { parameter: 'peak_pressure', direction: 'decrease', current: 8.9, target: 99, unit: 'bar', why: 'Out of range target.' }
      ]
    }),
    '```'
  ].join('\n');

  const { suggestions, displayText } = extractDialInSuggestions(answer, context);
  // Citation markers are stripped from both the prose and the why-lines.
  equal(displayText, 'Try a longer preinfusion first.');
  equal(suggestions[0]!.why, 'Longer preinfusion.');
  equal(suggestions.length, 4);
  equal(suggestions[0]!.kind, 'profile');
  equal(suggestions[0]!.parameter, 'preinfusion_time');
  equal(suggestions[0]!.target, 13);
  // Beanie's own current value beats Derek's readback.
  equal(suggestions[1]!.kind, 'recipe');
  equal(suggestions[1]!.current, 92);
  // Unknown parameter → manual card.
  equal(suggestions[2]!.kind, 'manual');
  // Absurd target → manual card, never applied.
  equal(suggestions[3]!.kind, 'manual');
});

run('extractDialInSuggestions survives missing and malformed blocks', () => {
  equal(extractDialInSuggestions('Just prose.', emptyContext).suggestions.length, 0);
  equal(extractDialInSuggestions('Just prose.', emptyContext).displayText, 'Just prose.');
  const malformed = extractDialInSuggestions('Text\n```json\n{oops\n```', emptyContext);
  equal(malformed.suggestions.length, 0);
  equal(malformed.displayText, 'Text');
});

run('a qualitative grind target is advice, not a settable value', () => {
  const answer =
    '```json\n{"suggestions":[{"parameter":"grind","direction":"decrease","current":null,"target":"finer","why":"Slow the shot."},{"parameter":"grind","target":"14.5","why":"Two notches finer."}]}\n```';
  const { suggestions } = extractDialInSuggestions(answer, emptyContext);
  equal(suggestions[0]!.kind, 'manual');
  equal(suggestions[1]!.kind, 'recipe');
});

run('extractDialInSuggestions maps profile switches', () => {
  const context = { ...emptyContext, profileTitle: 'Default' };
  const answer = '```json\n{"suggestions":[{"parameter":"profile","target":"Gentle & Sweet","why":"Better for light roasts."}]}\n```';
  const { suggestions } = extractDialInSuggestions(answer, context);
  equal(suggestions.length, 1);
  equal(suggestions[0]!.kind, 'recipe');
  equal(suggestions[0]!.direction, 'switch');
  equal(suggestions[0]!.current, 'Default');
  equal(suggestions[0]!.target, 'Gentle & Sweet');
});

run('jsonFenceCutoff hides a fence as it streams in', () => {
  equal(jsonFenceCutoff('No fence here.'), null);
  const text = 'Advice text.\n```json\n{"sugg';
  equal(jsonFenceCutoff(text), text.indexOf('```'));
  // A fence arriving token by token: hold back the suspicious tail.
  const partial = 'Advice text.\n``';
  equal(jsonFenceCutoff(partial), partial.indexOf('``'));
});

run('suggestionTitle renders current → target with units', () => {
  equal(
    suggestionTitle({
      kind: 'profile',
      parameter: 'preinfusion_time',
      direction: 'increase',
      current: 8,
      target: 13,
      unit: 's',
      why: ''
    }),
    'Preinfusion time: 8 → 13 s'
  );
  equal(
    suggestionTitle({ kind: 'manual', parameter: 'wdt', direction: null, current: null, target: null, unit: null, why: '' }),
    'Wdt'
  );
});

function contains(haystack: string, needle: string): void {
  if (!haystack.includes(needle)) {
    throw new Error(`Expected to find "${needle}" in:\n${haystack}`);
  }
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
    throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  }
}
