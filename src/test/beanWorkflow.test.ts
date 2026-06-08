import type { Bean, Profile, ProfileRecord, ShotRecord, Workflow } from '../api/types';
import {
  buildWorkflowUpdate,
  appendBatchStorageEvent,
  compareBeansForPicker,
  computeBeanFreshness,
  editLastBatchStorageEventDate,
  legacyShotFilterForBean,
  profileBaseTemperature,
  ratioFor,
  recipeFromShot,
  roastFreshnessLabel,
  selectInitialBean,
  shotFreshnessBadgeLabel,
  shotFilterForBean,
  withProfileTemperature,
  yieldForRatio
} from '../domain/beanWorkflow';

const beans: Bean[] = [
  { id: 'a', roaster: 'Kawa', name: 'Pink Bourbon' },
  { id: 'b', roaster: 'Tsukcafe', name: 'Tore Badiya' }
];

const workflow: Workflow = {
  profile: { title: 'Default' },
  context: {
    coffeeRoaster: 'Tsukcafe',
    coffeeName: 'Tore Badiya',
    targetDoseWeight: 18,
    targetYield: 40
  }
};

run('selects the current workflow bean first', () => {
  equal(selectInitialBean(beans, workflow, 'a')?.id, 'b');
});

run('selects the latest shot bean before stale workflow or local storage', () => {
  equal(
    selectInitialBean(beans, workflow, 'a', {
      id: 'shot-latest',
      timestamp: new Date().toISOString(),
      workflow: {
        context: {
          coffeeName: 'Pink Bourbon',
          coffeeRoaster: 'Kawa'
        }
      }
    })?.id,
    'a'
  );
});

run('builds bean shot filters by stable bean id', () => {
  const query = shotFilterForBean(beans[0]!, { id: 'batch-a', beanId: 'a' });
  equal(query.get('beanBatchId'), null);
  equal(query.get('coffeeRoaster'), null);
  equal(query.get('coffeeName'), null);
  equal(query.get('beanId'), 'a');
});

run('builds legacy bean shot filters by coffee roaster and name', () => {
  const query = legacyShotFilterForBean(beans[0]!);
  equal(query.get('coffeeRoaster'), 'Kawa');
  equal(query.get('coffeeName'), 'Pink Bourbon');
  equal(query.get('beanId'), null);
});

run('sorts bean list by shot or add recency before name', () => {
  const sorted = [
    { id: 'old-used', roaster: 'A', name: 'Used' },
    { id: 'new-empty', roaster: 'B', name: 'New', createdAt: '2026-06-08T10:00:00.000Z' },
    { id: 'old-empty', roaster: 'C', name: 'Old', createdAt: '2026-06-01T10:00:00.000Z' }
  ].sort((a, b) =>
    compareBeansForPicker(a, b, { 'old-used': Date.parse('2026-06-07T10:00:00.000Z') }, null)
  );

  equal(sorted[0]?.id, 'new-empty');
  equal(sorted[1]?.id, 'old-used');
  equal(sorted[2]?.id, 'old-empty');
});

run('hydrates recipe values from a shot', () => {
  const shot: ShotRecord = {
    id: 'shot-1',
    timestamp: '2026-06-01T10:00:00Z',
    workflow: {
      profile: { title: 'Blooming' },
      context: {
        targetDoseWeight: 18,
        targetYield: 42,
        grinderModel: 'DF64',
        grinderSetting: '5.7'
      }
    },
    annotations: { actualDoseWeight: 18.2, actualYield: 41.8 },
    measurements: []
  };

  match(recipeFromShot(shot), {
    profileTitle: 'Blooming',
    dose: 18.2,
    yield: 41.8,
    grinderModel: 'DF64',
    grinderSetting: '5.7'
  });
});

run('loads planned dose and yield when preferring planned', () => {
  const shot: ShotRecord = {
    id: 'shot-planned',
    timestamp: '2026-06-01T10:00:00Z',
    workflow: {
      profile: { title: 'Blooming' },
      context: { targetDoseWeight: 18, targetYield: 42 }
    },
    annotations: { actualDoseWeight: 18.2, actualYield: 41.8 },
    measurements: []
  };
  // Loading into the dial-in repeats the planned recipe, not the pour's actuals.
  match(recipeFromShot(shot, 'planned'), { dose: 18, yield: 42 });
});

run('planned preference falls back to actuals when no target is set', () => {
  const shot: ShotRecord = {
    id: 'shot-planned-fallback',
    timestamp: '2026-06-01T10:00:00Z',
    workflow: { profile: { title: 'Blooming' }, context: {} },
    annotations: { actualDoseWeight: 18.2, actualYield: 41.8 },
    measurements: []
  };
  match(recipeFromShot(shot, 'planned'), { dose: 18.2, yield: 41.8 });
});

run('falls back to target yield when the recorded actual yield is 0', () => {
  const shot: ShotRecord = {
    id: 'shot-zero-yield',
    timestamp: '2026-05-22T16:22:09Z',
    workflow: {
      profile: { title: 'Rao Allongé' },
      context: { targetDoseWeight: 18, targetYield: 135 }
    },
    annotations: { actualDoseWeight: 18, actualYield: 0 },
    measurements: []
  };
  // An imported shot with drink_weight 0 should show the planned 135 g, not 0.
  match(recipeFromShot(shot), { dose: 18, yield: 135 });
});

run('creates a workflow patch with bean context and selected profile', () => {
  const profiles: ProfileRecord[] = [{ id: 'p1', profile: { title: 'Default' } }];
  const update = buildWorkflowUpdate(
    beans[0]!,
    { id: 'batch-a', beanId: 'a' },
    {
      profileId: 'p1',
      profileTitle: 'Default',
      profile: profiles[0]!.profile,
      dose: 18,
      yield: 40,
      grinderId: 'g1',
      grinderModel: 'DF64',
      grinderSetting: '5.5'
    }
  );

  match(update.context, {
    coffeeRoaster: 'Kawa',
    coffeeName: 'Pink Bourbon',
    beanBatchId: 'batch-a',
    targetDoseWeight: 18,
    targetYield: 40,
    grinderModel: 'DF64'
  });
  equal(update.profile?.title, 'Default');
});

run('preserves unknown workflow fields and context keys when applying', () => {
  const base: Workflow = {
    id: 'wf-1',
    description: 'keep me',
    steamSettings: { flow: 1.2 },
    context: { finalBeverageType: 'espresso', region: 'Huila' } as Record<string, unknown>
  };
  const update = buildWorkflowUpdate(
    beans[0]!,
    null,
    { dose: 18, yield: 40 },
    null,
    base
  );

  equal(update.id, 'wf-1');
  equal(update.description, 'keep me');
  equal((update.steamSettings as { flow: number }).flow, 1.2);
  equal((update.context as Record<string, unknown>).region, 'Huila');
  equal(update.context?.coffeeName, 'Pink Bourbon');
});

run('derives and inverts brew ratio', () => {
  equal(ratioFor(18, 45), 2.5);
  equal(ratioFor(0, 45), null);
  equal(yieldForRatio(18, 2.5), 45);
  equal(yieldForRatio(null, 2.5), null);
});

run('shifts every profile temperature by the same delta', () => {
  const profile: Profile = {
    title: 'Temp test',
    tank_temperature: 92,
    steps: [{ temperature: 90 }, { temperature: 94 }] as unknown[]
  };
  equal(profileBaseTemperature(profile), 92);
  const shifted = withProfileTemperature(profile, 93);
  equal(shifted.tank_temperature, 93);
  const steps = shifted.steps as Array<{ temperature: number }>;
  equal(steps[0]!.temperature, 91);
  equal(steps[1]!.temperature, 95);
});

run('treats tank_temperature 0 as off and uses step temps as the base', () => {
  const profile: Profile = {
    title: 'Tank off',
    tank_temperature: 0,
    steps: [{ temperature: 90 }, { temperature: 90 }] as unknown[]
  };
  // 0 means preheat off, so the base is the brew (step) temperature, not 0.
  equal(profileBaseTemperature(profile), 90);
  const shifted = withProfileTemperature(profile, 92);
  // Steps move with the new target; the off tank stays off (still 0).
  equal(shifted.tank_temperature, 0);
  const steps = shifted.steps as Array<{ temperature: number }>;
  equal(steps[0]!.temperature, 92);
  equal(steps[1]!.temperature, 92);
});

run('formats roast freshness as days off roast (date prefix is locale-formatted)', () => {
  // Asserting the suffix only: the day count is an absolute-time diff, so it is
  // timezone- and locale-independent, unlike the localized date prefix.
  const now = new Date('2026-06-05T12:00:00Z');
  equal(
    roastFreshnessLabel({ id: 'x', beanId: 'a', roastDate: '2026-06-01T00:00:00Z' }, now)?.endsWith(
      '· 4 days off roast'
    ),
    true
  );
});

run('computes active freshness by pausing frozen intervals', () => {
  const freshness = computeBeanFreshness({
    id: 'x',
    beanId: 'a',
    roastDate: '2026-05-01T00:00:00Z',
    storageEvents: [
      { type: 'frozen', at: '2026-05-10T00:00:00Z' },
      { type: 'thawed', at: '2026-06-01T00:00:00Z' }
    ]
  }, new Date('2026-06-08T00:00:00Z'));

  equal(freshness?.roastAgeDays, 38);
  equal(freshness?.activeAgeDays, 16);
  equal(freshness?.storageState, 'thawed');
});

run('formats frozen freshness with roast and active days', () => {
  const label = roastFreshnessLabel({
    id: 'x',
    beanId: 'a',
    roastDate: '2026-05-01T00:00:00Z',
    storageEvents: [
      { type: 'frozen', at: '2026-05-10T00:00:00Z' },
      { type: 'thawed', at: '2026-06-01T00:00:00Z' }
    ]
  }, new Date('2026-06-08T00:00:00Z'));

  equal(label?.includes('38 days off roast'), true);
  equal(label?.includes('16 active days'), true);
  equal(label?.includes('thawed 7d ago'), true);
});

run('appends storage events and edits the latest event date', () => {
  const batch = { id: 'x', beanId: 'a', roastDate: '2026-05-01T00:00:00Z' };
  const frozen = appendBatchStorageEvent(batch, 'frozen', new Date('2026-05-10T12:34:00Z'));
  equal(frozen.frozen, true);
  equal(frozen.storageEvents?.[0]?.type, 'frozen');

  const thawed = appendBatchStorageEvent({ ...batch, ...frozen }, 'thawed', new Date('2026-06-01T09:00:00Z'));
  equal(thawed.frozen, false);
  equal(thawed.storageEvents?.[1]?.type, 'thawed');

  const edited = editLastBatchStorageEventDate({ ...batch, ...thawed }, '2026-06-02', new Date('2026-06-08T00:00:00Z'));
  equal(edited.storageEvents?.[1]?.at.startsWith('2026-06-02'), true);
});

run('formats shot freshness badges from metadata snapshots', () => {
  equal(shotFreshnessBadgeLabel({ freshness: { roastAgeDays: 38, activeAgeDays: 16, storageState: 'thawed' } }), '38d · 16a');
  equal(shotFreshnessBadgeLabel({ freshness: { roastAgeDays: 4, activeAgeDays: 4, storageState: 'ambient' } }), '4d');
});

run('uses singular day and a "today" label for fresh roasts', () => {
  const now = new Date('2026-06-05T12:00:00Z');
  equal(
    roastFreshnessLabel({ id: 'x', beanId: 'a', roastDate: '2026-06-04T00:00:00Z' }, now)?.endsWith(
      '· 1 day off roast'
    ),
    true
  );
  equal(
    roastFreshnessLabel({ id: 'x', beanId: 'a', roastDate: '2026-06-05T00:00:00Z' }, now)?.endsWith(
      '· today'
    ),
    true
  );
});

run('returns null when a batch has no usable roast date', () => {
  equal(roastFreshnessLabel(null), null);
  equal(roastFreshnessLabel({ id: 'x', beanId: 'a' }), null);
  equal(roastFreshnessLabel({ id: 'x', beanId: 'a', roastDate: 'not-a-date' }), null);
});

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

function match(actual: unknown, expected: Record<string, unknown>): void {
  if (actual == null || typeof actual !== 'object') {
    throw new Error('Expected an object');
  }

  const obj = actual as Record<string, unknown>;
  for (const [key, value] of Object.entries(expected)) {
    if (obj[key] !== value) {
      throw new Error(`Expected ${key}=${String(value)}, received ${String(obj[key])}`);
    }
  }
}
