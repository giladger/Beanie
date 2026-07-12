import type { Bean, BeanBatch, Profile, RecipeDraft, Workflow } from '../api/types';
import { buildWorkflowUpdate } from '../domain/beanWorkflow';
import {
  createRecipeCandidate,
  draftRecipeFingerprint,
  recipeFingerprint,
  recipeIdentity
} from '../domain/recipeIdentity';

const bean: Bean = { id: 'bean-a', roaster: 'Kawa', name: 'Bourbon' };
const batch: BeanBatch = { id: 'batch-a', beanId: bean.id };
const profile: Profile = {
  title: 'Same title',
  tank_temperature: 92,
  steps: [
    { name: 'Bloom', temperature: 90, pressure: 3 },
    { name: 'Pour', temperature: 94, pressure: 8 }
  ]
};
const draft: RecipeDraft = {
  profile,
  profileTitle: profile.title,
  brewTemp: 93,
  dose: 18,
  yield: 40,
  grinderId: 'grinder-a',
  grinderModel: 'DF64',
  grinderSetting: '5.5'
};

run('recipe identity fingerprints the concrete workflow recipe', () => {
  const workflow = buildWorkflowUpdate(bean, batch, draft, draft.profile);
  const candidate = createRecipeCandidate(workflow);

  equal(candidate.workflow, workflow);
  deepEqual(candidate.identity, recipeIdentity(workflow));
  equal(candidate.fingerprint, recipeFingerprint(workflow));
  equal(candidate.identity.beanId, 'bean-a');
  equal(candidate.identity.beanBatchId, 'batch-a');
  equal(candidate.identity.brewTemperature, 93);
  equal(candidate.identity.dose, 18);
  equal(candidate.identity.yield, 40);
  equal(candidate.identity.grinderId, 'grinder-a');
});

run('every recipe-bearing edit changes the canonical fingerprint', () => {
  const base = buildWorkflowUpdate(bean, batch, draft, draft.profile);
  const baseFingerprint = recipeFingerprint(base);
  const differs = (workflow: Workflow, label: string): void => {
    if (recipeFingerprint(workflow) === baseFingerprint) {
      throw new Error(`${label} did not change recipe identity`);
    }
  };

  differs(buildWorkflowUpdate(bean, batch, { ...draft, brewTemp: 94 }, draft.profile), 'temperature');
  differs(buildWorkflowUpdate(bean, batch, { ...draft, dose: 18.5 }, draft.profile), 'dose');
  differs(buildWorkflowUpdate(bean, batch, { ...draft, yield: 41 }, draft.profile), 'yield');
  differs(buildWorkflowUpdate(bean, batch, { ...draft, grinderId: 'grinder-b' }, draft.profile), 'grinder id');
  differs(buildWorkflowUpdate(bean, batch, { ...draft, grinderModel: 'Lagom' }, draft.profile), 'grinder model');
  differs(buildWorkflowUpdate(bean, batch, { ...draft, grinderSetting: '6' }, draft.profile), 'grinder setting');
  differs(
    buildWorkflowUpdate({ ...bean, id: 'bean-b' }, { ...batch, beanId: 'bean-b' }, draft, draft.profile),
    'bean'
  );
  differs(buildWorkflowUpdate(bean, { ...batch, id: 'batch-b' }, draft, draft.profile), 'batch');

  const changedProfile: Profile = {
    ...profile,
    steps: [
      { name: 'Bloom', temperature: 90, pressure: 4 },
      { name: 'Pour', temperature: 94, pressure: 8 }
    ]
  };
  differs(
    buildWorkflowUpdate(bean, batch, { ...draft, profile: changedProfile }, changedProfile),
    'same-title profile content'
  );
});

run('profile object key order does not change recipe identity', () => {
  const first: Workflow = {
    profile: {
      title: 'Stable',
      steps: [{ name: 'Pour', pressure: 8, flow: 2 }]
    },
    context: {
      beanId: 'bean-a',
      beanBatchId: 'batch-a',
      targetDoseWeight: 18,
      targetYield: 40,
      grinderId: 'grinder-a',
      grinderModel: 'DF64',
      grinderSetting: '5.5'
    }
  };
  const second: Workflow = {
    context: {
      grinderSetting: '5.5',
      grinderModel: 'DF64',
      grinderId: 'grinder-a',
      targetYield: 40,
      targetDoseWeight: 18,
      beanBatchId: 'batch-a',
      beanId: 'bean-a'
    },
    profile: {
      steps: [{ flow: 2, pressure: 8, name: 'Pour' }],
      title: 'Stable'
    }
  };

  equal(recipeFingerprint(first), recipeFingerprint(second));
});

run('draft compatibility fingerprints temperature and full profile content', () => {
  const base = draftRecipeFingerprint(draft);
  notEqual(draftRecipeFingerprint({ ...draft, brewTemp: 94 }), base);
  notEqual(
    draftRecipeFingerprint({
      ...draft,
      profile: { ...profile, steps: [{ name: 'Bloom', temperature: 90, pressure: 4 }] }
    }),
    base
  );
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
    throw new Error(`Expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`);
  }
}

function notEqual<T>(actual: T, expected: T): void {
  if (actual === expected) throw new Error(`Expected ${JSON.stringify(actual)} to differ`);
}

function deepEqual(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`);
  }
}
