import type { ShotRecord } from '../api/types';
import {
  applyShotUpdate,
  executeShotDeletion,
  projectDeletedShot,
  saveShotUpdate,
  shotDoseReclaimPlan,
  shotEnjoymentUpdate
} from '../controllers/shotMetadataController';

await run('shot enjoyment update preserves existing annotations', () => {
  const update = shotEnjoymentUpdate({
    ...shot('shot-1'),
    annotations: { drinkTds: 9.1, enjoyment: 60 }
  }, 80);

  equal(update.annotations?.drinkTds, 9.1);
  equal(update.annotations?.enjoyment, 80);
});

await run('apply shot update preserves workflow fields unless context is replaced', () => {
  const original = shot('shot-1');
  const merged = applyShotUpdate(original, {
    workflow: {
      profile: { title: 'Updated profile', steps: [] }
    }
  });
  equal(merged.workflow?.profile?.title, 'Updated profile');
  equal(merged.workflow?.context?.coffeeName, 'Old coffee');

  const replaced = applyShotUpdate(original, {
    workflow: {
      context: { coffeeName: 'New coffee' }
    }
  });
  equal(replaced.workflow?.profile?.title, 'Old profile');
  equal(replaced.workflow?.context?.coffeeName, 'New coffee');
});

await run('shot metadata controller saves demo updates locally without gateway calls', async () => {
  const result = await saveShotUpdate({
    shot: shot('shot-1'),
    update: { annotations: { enjoyment: 80 } },
    demo: true,
    successStatus: 'Shot saved',
    demoStatus: 'Shot saved (demo)',
    failureStatus: 'Save shot failed'
  }, failingDeps());

  equal(result.type, 'saved');
  equal(result.type === 'saved' ? result.remote : null, false);
  equal(result.type === 'saved' ? result.status : null, 'Shot saved (demo)');
  equal(result.type === 'saved' ? result.shot.annotations?.enjoyment : null, 80);
});

await run('shot metadata controller saves remote updates and writes cache', async () => {
  const calls: string[] = [];
  const result = await saveShotUpdate({
    shot: shot('shot-1'),
    update: { annotations: { enjoyment: 90 } },
    demo: false,
    successStatus: 'Score saved',
    demoStatus: 'Score saved (demo)',
    failureStatus: 'Save score failed'
  }, {
    updateShot: async (id, update) => {
      calls.push(`update:${id}`);
      return applyShotUpdate(shot(id), update);
    },
    invalidateShotMutation: async (id) => {
      calls.push(`invalidate:${id}`);
    },
    putShotRecord: async (saved) => {
      calls.push(`cache:${saved.id}`);
    }
  });

  equal(result.type, 'saved');
  equal(result.type === 'saved' ? result.remote : null, true);
  equal(result.type === 'saved' ? result.status : null, 'Score saved');
  equal(result.type === 'saved' ? result.shot.annotations?.enjoyment : null, 90);
  equal(calls.join(','), 'update:shot-1,invalidate:shot-1,cache:shot-1');
});

await run('shot metadata controller reports update and cache failures', async () => {
  const gatewayFailure = await saveShotUpdate({
    shot: shot('shot-1'),
    update: { annotations: { enjoyment: 90 } },
    demo: false,
    successStatus: 'Score saved',
    demoStatus: 'Score saved (demo)',
    failureStatus: 'Save score failed'
  }, {
    updateShot: async () => {
      throw new Error('gateway');
    },
    invalidateShotMutation: async () => {},
    putShotRecord: async () => {}
  });

  equal(gatewayFailure.type, 'failed');
  equal(gatewayFailure.type === 'failed' ? gatewayFailure.status : null, 'Save score failed');

  const cacheFailure = await saveShotUpdate({
    shot: shot('shot-1'),
    update: { annotations: { enjoyment: 90 } },
    demo: false,
    successStatus: 'Shot saved',
    demoStatus: 'Shot saved (demo)',
    failureStatus: 'Save shot failed'
  }, {
    updateShot: async (id, update) => applyShotUpdate(shot(id), update),
    invalidateShotMutation: async () => {},
    putShotRecord: async () => {
      throw new Error('cache');
    }
  });

  equal(cacheFailure.type, 'failed');
  equal(cacheFailure.type === 'failed' ? cacheFailure.status : null, 'Save shot failed');
});

await run('shot reclaim planning captures a capped preview but retains delta authority', () => {
  const reclaimShot: ShotRecord = {
    ...shot('shot-1'),
    workflow: {
      ...shot('shot-1').workflow,
      context: { beanBatchId: 'batch-1' }
    },
    annotations: { actualDoseWeight: 18.4 }
  };
  const plan = shotDoseReclaimPlan(
    reclaimShot,
    [{ id: 'bean-1', roaster: 'Acme', name: 'Lot' }],
    {
      'bean-1': [{ id: 'batch-1', beanId: 'bean-1', weight: 100, weightRemaining: 95 }]
    }
  );

  equal(plan?.intent.beanId, 'bean-1');
  equal(plan?.intent.batchId, 'batch-1');
  equal(plan?.intent.dose, 18.4);
  equal(plan?.preview.dose, 18.4);
  equal(plan?.preview.remaining, 95);
  equal(plan?.preview.next, 100);
  equal(Object.prototype.hasOwnProperty.call(plan?.intent ?? {}, 'shotId'), false);
  equal(Object.prototype.hasOwnProperty.call(plan?.intent ?? {}, 'remaining'), false);
  equal(Object.prototype.hasOwnProperty.call(plan?.intent ?? {}, 'next'), false);
});

await run('shot reclaim planning accepts an empty tracked bag and rejects missing tracking', () => {
  const reclaimShot: ShotRecord = {
    ...shot('shot-1'),
    workflow: { context: { beanBatchId: 'batch-1' } },
    annotations: { actualDoseWeight: 18 }
  };
  const beans = [{ id: 'bean-1', roaster: 'Acme', name: 'Lot' }];

  const empty = shotDoseReclaimPlan(reclaimShot, beans, {
    'bean-1': [{ id: 'batch-1', beanId: 'bean-1', weight: 250, weightRemaining: 0 }]
  });
  equal(empty?.preview.next, 18);

  const untracked = shotDoseReclaimPlan(reclaimShot, beans, {
    'bean-1': [{ id: 'batch-1', beanId: 'bean-1', weight: 250 }]
  });
  equal(untracked, null);
  equal(shotDoseReclaimPlan({ ...reclaimShot, annotations: {} }, beans, {}), null);
});

await run('shot reclaim preview shares the non-reducing policy for an inconsistent bag cap', () => {
  const reclaimShot: ShotRecord = {
    ...shot('shot-1'),
    workflow: { context: { beanBatchId: 'batch-1' } },
    annotations: { actualDoseWeight: 18 }
  };
  const plan = shotDoseReclaimPlan(
    reclaimShot,
    [{ id: 'bean-1', roaster: 'Acme', name: 'Lot' }],
    { 'bean-1': [{ id: 'batch-1', beanId: 'bean-1', weight: 100, weightRemaining: 120 }] }
  );

  equal(plan?.preview.remaining, 120);
  equal(plan?.preview.next, 138);
});

await run('shot deletion secures the reclaim before optional cache invalidation', async () => {
  const calls: string[] = [];
  const result = await executeShotDeletion({
    shotId: 'shot-1',
    reclaim: reclaimPlan(),
    demo: false
  }, {
    deleteShot: async (id) => {
      calls.push(`delete:${id}`);
    },
    onRemoteDeleteSettled: () => {
      calls.push('fence');
    },
    invalidateShotMutation: async (id) => {
      calls.push(`invalidate:${id}`);
    },
    reclaimDose: async (intent) => {
      calls.push(`reclaim:${intent.batchId}:+${intent.dose}`);
      equal(Object.prototype.hasOwnProperty.call(intent, 'preview'), false);
      equal(Object.prototype.hasOwnProperty.call(intent, 'shotId'), false);
      return { type: 'reclaimed', resolvedRemaining: 57.5 };
    }
  });

  equal(result.type, 'deleted');
  equal(result.type === 'deleted' ? result.status : null, 'Shot deleted · Bag: 57.5g left');
  equal(calls.join(','), 'delete:shot-1,fence,reclaim:batch-1:+18,invalidate:shot-1');
});

await run('durably queued shot reclaim reports its optimistic target', async () => {
  const result = await executeShotDeletion({
    shotId: 'shot-1',
    reclaim: reclaimPlan(),
    demo: false
  }, {
    deleteShot: async () => {},
    invalidateShotMutation: async () => {},
    reclaimDose: async () => ({
      type: 'queued',
      expectedRemaining: 60,
      durability: 'indexeddb'
    })
  });

  equal(result.type, 'deleted');
  equal(result.type === 'deleted' ? result.status : null, 'Shot deleted · Bag: 60g left');
});

await run('shot deletion never reclassifies a deleted shot when cache or reclaim fails', async () => {
  const result = await executeShotDeletion({
    shotId: 'shot-1',
    reclaim: reclaimPlan(),
    demo: false
  }, {
    deleteShot: async () => {},
    invalidateShotMutation: async () => {
      throw new Error('cache unavailable');
    },
    reclaimDose: async () => ({ type: 'failed', reason: 'gateway', error: new Error('inventory') })
  });

  equal(result.type, 'deleted');
  equal(result.type === 'deleted' ? result.status : null, 'Shot deleted · Bag reclaim failed');
  equal(result.type === 'deleted' ? result.cacheWarning instanceof Error : false, true);
});

await run('shot deletion stops before auxiliary work when the remote delete fails', async () => {
  const calls: string[] = [];
  const result = await executeShotDeletion({
    shotId: 'shot-1',
    reclaim: reclaimPlan(),
    demo: false
  }, {
    deleteShot: async () => {
      calls.push('delete');
      throw new Error('gateway');
    },
    invalidateShotMutation: async () => {
      calls.push('invalidate');
    },
    reclaimDose: async () => {
      calls.push('reclaim');
      return { type: 'reclaimed', resolvedRemaining: 60 };
    }
  });

  equal(result.type, 'failed');
  equal(result.status, 'Delete shot failed');
  equal(calls.join(','), 'delete');
});

await run('shot deletion treats a retry 404 as already deleted and finishes cleanup', async () => {
  const missing = new Error('404');
  const calls: string[] = [];
  const result = await executeShotDeletion({
    shotId: 'shot-1',
    reclaim: reclaimPlan(),
    demo: false
  }, {
    deleteShot: async () => {
      calls.push('delete');
      throw missing;
    },
    isAlreadyDeleted: (error) => error === missing,
    onRemoteDeleteSettled: () => {
      calls.push('fence');
    },
    invalidateShotMutation: async () => {
      calls.push('invalidate');
    },
    reclaimDose: async (_intent, context) => {
      equal(context.deleteAlreadyAbsent, true);
      calls.push('reclaim-check');
      return { type: 'not-applicable', reason: 'already-deleted' };
    }
  });

  equal(result.type, 'deleted');
  equal(result.type === 'deleted' ? result.status : null, 'Shot already deleted · Bag unchanged');
  equal(calls.join(','), 'delete,fence,reclaim-check,invalidate');
});

await run('demo shot deletion skips remote and cache work but still reclaims inventory', async () => {
  const calls: string[] = [];
  const result = await executeShotDeletion({
    shotId: 'shot-1',
    reclaim: reclaimPlan(),
    demo: true
  }, {
    deleteShot: async () => {
      calls.push('delete');
    },
    invalidateShotMutation: async () => {
      calls.push('invalidate');
    },
    reclaimDose: async () => {
      calls.push('reclaim');
      return { type: 'reclaimed', resolvedRemaining: 60 };
    }
  });

  equal(result.type, 'deleted');
  equal(result.type === 'deleted' ? result.status : null, 'Shot deleted (demo) · Bag: 60g left');
  equal(calls.join(','), 'reclaim');
});

await run('thrown reclaim errors remain truthful partial deletion successes', async () => {
  const result = await executeShotDeletion({
    shotId: 'shot-1',
    reclaim: reclaimPlan(),
    demo: false
  }, {
    deleteShot: async () => {},
    invalidateShotMutation: async () => {},
    reclaimDose: async () => {
      throw new Error('inventory crashed');
    }
  });

  equal(result.type, 'deleted');
  equal(result.type === 'deleted' ? result.status : null, 'Shot deleted · Bag reclaim failed');
  equal(result.type === 'deleted' ? result.reclaimWarning instanceof Error : false, true);
});

await run('deleted-shot projection settles against the latest refreshed list and navigation', () => {
  const alreadyRefreshed = projectDeletedShot({
    shots: [shot('shot-2')],
    shotsTotal: 1,
    detailShotId: 'shot-2',
    compareShotId: null
  }, 'shot-1');
  equal(alreadyRefreshed.shotsTotal, 1);
  equal(alreadyRefreshed.detailShotId, 'shot-2');
  equal(alreadyRefreshed.removed, false);
  equal(alreadyRefreshed.removedCurrentDetail, false);

  const navigated = projectDeletedShot({
    shots: [shot('shot-1'), shot('shot-2')],
    shotsTotal: 2,
    detailShotId: 'shot-2',
    compareShotId: 'shot-1'
  }, 'shot-1');
  equal(navigated.shots.length, 1);
  equal(navigated.shotsTotal, 1);
  equal(navigated.detailShotId, 'shot-2');
  equal(navigated.compareShotId, null);
  equal(navigated.removedCurrentDetail, false);

  const staleTailAfter404 = projectDeletedShot({
    shots: [shot('shot-1'), shot('shot-2')],
    shotsTotal: 1,
    detailShotId: 'shot-1',
    compareShotId: null
  }, 'shot-1', { decrementTotal: false });
  equal(staleTailAfter404.shots.length, 1);
  equal(staleTailAfter404.shotsTotal, 1);
  equal(staleTailAfter404.detailShotId, 'shot-2');
});

function shot(id: string): ShotRecord {
  return {
    id,
    timestamp: '2026-06-05T10:00:00.000Z',
    workflow: {
      profile: { title: 'Old profile', steps: [] },
      context: { coffeeName: 'Old coffee' }
    },
    annotations: { actualYield: 36 },
    shotNotes: 'Old notes',
    metadata: { imported: true },
    measurements: []
  };
}

function failingDeps() {
  return {
    updateShot: async () => {
      throw new Error('unexpected update');
    },
    invalidateShotMutation: async () => {
      throw new Error('unexpected invalidate');
    },
    putShotRecord: async () => {
      throw new Error('unexpected cache');
    }
  };
}

function reclaimPlan() {
  return {
    beanId: 'bean-1',
    batchId: 'batch-1',
    dose: 18
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
