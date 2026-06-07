import type { Profile, ProfileRecord, Workflow } from '../api/types';
import {
  cleaningStartPlan,
  cleaningThresholdPlan,
  countShotForCleaningPlan,
  finishCleaningCyclePlan,
  loadCleaningWorkflow,
  pickCleaningProfilePlan
} from '../controllers/cleaningWorkflowController';

await run('cleaning start ignores busy or live states', () => {
  equal(cleaningStartPlan({ ...startInput(), busy: true }).type, 'ignored');
  equal(cleaningStartPlan({ ...startInput(), liveActive: true }).type, 'ignored');
  equal(cleaningStartPlan({ ...startInput(), liveFinalizing: true }).type, 'ignored');
});

await run('cleaning start reports missing cleaning profile', () => {
  const plan = cleaningStartPlan({ ...startInput(), profiles: [profileRecord('espresso', 'Sweet shot')] });

  equal(plan.type, 'missing-profile');
  equal(plan.type === 'missing-profile' ? plan.status : null, 'No cleaning profile installed');
});

await run('cleaning start blocks sleeping machines outside demo', () => {
  const plan = cleaningStartPlan({ ...startInput(), demo: false, machineSleeping: true });

  equal(plan.type, 'sleeping');
  equal(plan.type === 'sleeping' ? plan.status : null, 'Machine asleep — tap Wake first');
});

await run('cleaning start blocks hard water alerts', () => {
  const plan = cleaningStartPlan({ ...startInput(), waterAlert: 'hard' });

  equal(plan.type, 'water-block');
  equal(plan.type === 'water-block' ? plan.waterAlertDismissed : null, false);
  equal(plan.type === 'water-block' ? plan.status : null, 'Refill the water tank');
});

await run('cleaning start builds bean-independent cleaning workflow', () => {
  const plan = cleaningStartPlan(startInput());
  if (plan.type !== 'ready') throw new Error(`Unexpected plan ${plan.type}`);

  equal(plan.status, 'Loading cleaning profile…');
  equal(plan.workflow.profile?.title, 'Cleaning / forward flush x5');
  equal(plan.workflow.context?.coffeeName, null);
  equal(plan.workflow.context?.coffeeRoaster, null);
  equal(plan.workflow.context?.beanBatchId, null);
  equal(plan.workflow.context?.finalBeverageType, 'cleaning');
});

await run('cleaning workflow load returns demo workflow without gateway calls', async () => {
  const workflow = startWorkflow();
  const result = await loadCleaningWorkflow(workflow, true, {
    updateWorkflow: async () => {
      throw new Error('unexpected gateway');
    }
  });

  equal(result.type, 'demo');
  equal(result.type === 'demo' ? result.workflow : null, workflow);
});

await run('cleaning workflow load saves through gateway', async () => {
  const result = await loadCleaningWorkflow(startWorkflow(), false, {
    updateWorkflow: async (workflow) => ({ ...workflow, profile: { title: 'Saved cleaning profile', steps: [] } })
  });

  equal(result.type, 'saved');
  equal(result.type === 'saved' ? result.workflow.profile?.title : null, 'Saved cleaning profile');
});

await run('cleaning workflow load reports gateway failure', async () => {
  const result = await loadCleaningWorkflow(startWorkflow(), false, {
    updateWorkflow: async () => {
      throw new Error('failed');
    }
  });

  equal(result.type, 'failed');
  equal(result.type === 'failed' ? result.status : null, 'Cleaning profile load failed');
});

await run('cleaning finish and shot count plans update counters', () => {
  const counted = countShotForCleaningPlan({ shotsSinceClean: 7, lastCleanedAt: 'old' });
  equal(counted.shotsSinceClean, 8);
  equal(counted.lastCleanedAt, 'old');

  const finished = finishCleaningCyclePlan('2026-06-07T12:00:00.000Z');
  equal(finished.cleaning.shotsSinceClean, 0);
  equal(finished.cleaning.lastCleanedAt, '2026-06-07T12:00:00.000Z');
  equal(finished.status, 'Cleaning cycle complete');
});

await run('cleaning profile pick clears auto override and stores custom override', () => {
  const profiles = [profileRecord('auto', 'Cleaning / forward flush x5'), profileRecord('custom', 'My clean')];
  const auto = pickCleaningProfilePlan('auto', profiles);
  const custom = pickCleaningProfilePlan('custom', profiles);

  equal(auto.override, null);
  equal(custom.override, 'custom');
  equal(custom.view, 'machine');
  equal(custom.status, 'Cleaning profile set');
});

await run('cleaning threshold plan preserves selected threshold', () => {
  const plan = cleaningThresholdPlan(120);

  equal(plan.threshold, 120);
  equal(plan.status, 'Cleaning reminder updated');
});

function startInput(): Parameters<typeof cleaningStartPlan>[0] {
  return {
    busy: false,
    liveActive: false,
    liveFinalizing: false,
    profiles: [profileRecord('cleaning', 'Cleaning / forward flush x5', 'cleaning')],
    cleaningProfileOverride: null,
    workflow: startWorkflow(),
    demo: false,
    machineSleeping: false,
    waterAlert: 'none'
  };
}

function startWorkflow(): Workflow {
  return {
    profile: { title: 'Current', steps: [] },
    context: {
      coffeeName: 'Bean',
      coffeeRoaster: 'Roaster',
      beanBatchId: 'batch-1',
      finalBeverageType: 'espresso'
    }
  };
}

function profileRecord(id: string, title: string, beverageType?: string): ProfileRecord {
  return {
    id,
    profile: { title, beverage_type: beverageType, steps: [] } as Profile
  };
}

function run(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`ok - ${name}`);
    })
    .catch((error) => {
      console.error(`not ok - ${name}`);
      throw error;
    });
}

function equal<T>(actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(`Expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`);
  }
}
