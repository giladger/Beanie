import type { Bean, BeanBatch, Grinder, ShotRecord, ShotUpdate } from '../api/types';
import {
  projectShotEditorEvent,
  ShotEditorFlow,
  type ShotEditorEvent,
  type ShotEditorSnapshot
} from '../controllers/shotEditorFlow';
import { applyShotUpdate } from '../controllers/shotMetadataController';
import { scoreValueFromTap } from '../components/shotScore';

await run('shot editor flow opens and edits through explicit feature events', () => {
  const harness = createHarness();

  harness.flow.open();
  equal(harness.events[0]?.type, 'opened');
  if (harness.events[0]?.type !== 'opened') throw new Error('Expected opened event');
  equal(harness.events[0].shotId, 'shot-1');
  equal(harness.events[0].draft.coffeeName, 'Purple Rain');

  harness.snapshot.draft = harness.events[0].draft;
  harness.flow.commitField('grinderId', 'grinder-2');
  const changed = harness.events[1];
  equal(changed?.type, 'draft-changed');
  if (changed?.type !== 'draft-changed') throw new Error('Expected draft event');
  equal(changed.draft.grinderId, 'grinder-2');
  equal(changed.draft.grinderModel, 'Lagom P64');
  equal(changed.closeField, true);
});

await run('shot editor flow rebases interactive annotation changes in the exact shot lane', async () => {
  const harness = createHarness();
  const latest = {
    ...harness.snapshot.shots[0]!,
    annotations: { actualDoseWeight: 18, drinkTds: 10.2, enjoyment: 60 }
  };
  harness.readShot = latest;

  await harness.flow.updateEnjoyment('shot-1', 80);

  deepEqual(harness.calls, [
    'begin-mutation',
    'lane:shot-1',
    'read:shot-1',
    'update:shot-1',
    'invalidate:shot-1',
    'cache:shot-1'
  ]);
  equal(harness.savedUpdate?.annotations?.drinkTds, 10.2);
  equal(harness.savedUpdate?.annotations?.enjoyment, 80);
  equal(harness.events[0]?.type, 'saving');
  equal(harness.events[1]?.type, 'shot-saved');
});

await run('shot editor projection settles a saved shot against the latest shell list', () => {
  const original = shot('shot-1');
  const concurrent = shot('shot-2');
  const saved = { ...original, annotations: { enjoyment: 100 } };
  const projection = projectShotEditorEvent([concurrent, original], {
    type: 'shot-saved',
    shot: saved,
    status: 'Shot saved'
  });

  equal(projection.shots?.length, 2);
  equal(projection.shots?.[0]?.id, 'shot-2');
  equal(projection.shots?.[1]?.annotations?.enjoyment, 100);
  equal(projection.modal, null);
  equal(projection.busy, false);
});

function createHarness(): {
  snapshot: MutableSnapshot;
  flow: ShotEditorFlow;
  events: ShotEditorEvent[];
  calls: string[];
  savedUpdate: ShotUpdate | null;
  readShot: ShotRecord;
} {
  const beans: Bean[] = [{ id: 'bean-1', roaster: 'Friedhats', name: 'Purple Rain' }];
  const batches: BeanBatch[] = [{
    id: 'batch-1',
    beanId: 'bean-1',
    roastDate: '2026-07-01',
    weight: 250,
    weightRemaining: 180
  }];
  const grinders: Grinder[] = [
    { id: 'grinder-1', model: 'Niche Zero' },
    { id: 'grinder-2', model: 'Lagom P64' }
  ];
  const snapshot: MutableSnapshot = {
    shots: [shot('shot-1')],
    selectedShotId: 'shot-1',
    draft: null,
    beanDialog: null,
    beans,
    batchesByBean: { 'bean-1': batches },
    grinders,
    demo: false,
    busy: false
  };
  const events: ShotEditorEvent[] = [];
  const calls: string[] = [];
  const result = {
    snapshot,
    flow: null as unknown as ShotEditorFlow,
    events,
    calls,
    savedUpdate: null as ShotUpdate | null,
    readShot: snapshot.shots[0]!
  };
  result.flow = new ShotEditorFlow({
    snapshot: () => snapshot,
    emit: (event) => events.push(event),
    beginRemoteShotMutation: () => calls.push('begin-mutation'),
    runExactShotMutation: async (id, run) => {
      calls.push(`lane:${id}`);
      return run();
    },
    readShot: async (id) => {
      calls.push(`read:${id}`);
      return result.readShot;
    },
    updateShot: async (id, update) => {
      calls.push(`update:${id}`);
      result.savedUpdate = update;
      return applyShotUpdate(result.readShot, update);
    },
    invalidateShotMutation: async (id) => {
      calls.push(`invalidate:${id}`);
    },
    putShotRecord: async (saved) => {
      calls.push(`cache:${saved.id}`);
    },
    ensureBatchesLoaded: async () => {},
    saveBean: async () => ({ type: 'failed', status: 'Save bean failed', error: new Error('unused') }),
    putBeans: async () => {},
    scoreValueFromTap
  });
  return result;
}

interface MutableSnapshot extends ShotEditorSnapshot {
  draft: ShotEditorSnapshot['draft'];
}

function shot(id: string): ShotRecord {
  return {
    id,
    timestamp: '2026-07-14T08:00:00.000Z',
    workflow: {
      context: {
        beanId: 'bean-1',
        beanBatchId: 'batch-1',
        coffeeRoaster: 'Friedhats',
        coffeeName: 'Purple Rain',
        grinderId: 'grinder-1',
        grinderModel: 'Niche Zero',
        targetDoseWeight: 18,
        targetYield: 40
      }
    },
    annotations: { actualDoseWeight: 18, drinkTds: 9.1, enjoyment: 60 },
    measurements: []
  };
}

async function run(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

function equal<T>(actual: T, expected: T): void {
  if (actual !== expected) throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
}

function deepEqual(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}
