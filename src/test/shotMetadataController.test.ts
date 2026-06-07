import type { ShotRecord } from '../api/types';
import {
  applyShotUpdate,
  saveShotUpdate,
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
