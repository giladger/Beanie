import type { Bean, Profile, ProfileRecord, ShotRecord, Workflow } from '../api/types';
import {
  buildWorkflowUpdate,
  profileBaseTemperature,
  ratioFor,
  recipeFromShot,
  selectInitialBean,
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

run('builds bean shot filters from batch id when possible', () => {
  const query = shotFilterForBean(beans[0]!, { id: 'batch-a', beanId: 'a' });
  equal(query.get('beanBatchId'), 'batch-a');
  equal(query.get('coffeeName'), null);
});

run('falls back to coffee roaster and name filters without a batch', () => {
  const query = shotFilterForBean(beans[0]!, null);
  equal(query.get('coffeeRoaster'), 'Kawa');
  equal(query.get('coffeeName'), 'Pink Bourbon');
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
