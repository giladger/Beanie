import type { Bean, BeanBatch } from '../api/types';
import type {
  BeanInventoryProjection,
  PendingRemainingWeightAdjustment,
  PendingRemainingWeightReservation,
  RemainingWeightReconciliation
} from '../controllers/beanInventoryController';
import {
  DoseDeductionAdmissionFlow,
  type DoseDeductionEvent,
  type DoseDeductionSnapshot
} from '../controllers/doseDeductionAdmissionFlow';
import type {
  DoseMutationCanonicalization,
  DoseMutationEnqueueResult,
  DoseMutationSettlement,
  EnqueueDoseMutationInput
} from '../controllers/doseMutationReconciler';

async function main(): Promise<void> {
await run('dose admission reserves synchronously and journals an absolute base and target', async () => {
  const harness = new DoseHarness();
  harness.revision = 7;
  const gate = deferred<DoseMutationEnqueueResult>();
  let barrierReleases = 0;
  harness.enqueue = () => gate.promise;

  const admitting = harness.flow.admit(request());
  equal(harness.order.slice(0, 2).join(','), 'reserve,enqueue');
  equal(harness.reservations[0]?.fieldRevision, 7);
  equal(harness.enqueueInputs[0]?.baseRemaining, 100);
  equal(harness.enqueueInputs[0]?.expectedRemaining, 82);
  gate.resolve(queued(
    { expectedRemaining: 81.5 },
    () => { barrierReleases += 1; }
  ));
  equal(await admitting, true);

  const projection = harness.event('projection');
  equal(projection?.projection.batches[0]?.weightRemaining, 81.5);
  equal(projection?.status, 'Bag: 81.5g left');
  equal(harness.retained[0]?.expectedRemaining, 81.5);
  equal(barrierReleases, 1);
});

await run('dose admission preserves demo behavior without touching the journal', async () => {
  const harness = new DoseHarness(batch(10));
  equal(await harness.flow.admit(request({ demo: true, doseWeight: 18 })), true);
  equal(harness.demoRemaining, 0);
  equal(harness.demoStatus, 'Bag: 0g left');
  equal(harness.reservations.length, 0);
  equal(harness.enqueueInputs.length, 0);
});

await run('dose admission cannot overwrite a newer remaining-weight intent', async () => {
  const harness = new DoseHarness();
  const gate = deferred<DoseMutationEnqueueResult>();
  let barrierReleases = 0;
  harness.enqueue = () => gate.promise;

  const admitting = harness.flow.admit(request());
  harness.revision = 1;
  harness.state.batchesByBean['bean-1'] = [{ ...batch(), weightRemaining: 90 }];
  gate.resolve(queued({}, () => { barrierReleases += 1; }));
  equal(await admitting, true);

  equal(harness.event('projection'), undefined);
  equal(harness.event('review-required')?.beanId, 'bean-1');
  equal(harness.cached.length, 0);
  equal(barrierReleases, 1);
});

await run('dose admission failure releases its unsettled reservation', async () => {
  const harness = new DoseHarness();
  harness.enqueue = async () => { throw new Error('storage unavailable'); };

  equal(await harness.flow.admit(request()), false);
  equal(harness.released.length, 1);
  equal(harness.event('admission-failed')?.status, 'Bag update could not be queued');
  equal(harness.event('projection'), undefined);
});

await run('dose settlement preserves current review and later-adjustment semantics', () => {
  const projected = new DoseHarness(batch(82));
  projected.flow.adoptSettlement(settlement());
  equal(projected.reconcileRequests[0]?.expectedCurrent, 82);
  equal(projected.event('projection')?.projection.batches[0]?.weightRemaining, 81.5);
  equal(projected.order.join(','), 'has-later,reconcile,release,commit:projection');

  const later = new DoseHarness(batch(82));
  later.hasLaterPending = true;
  later.flow.adoptSettlement(settlement());
  equal(later.reconcileRequests.length, 0);
  equal(later.event('review-required'), undefined);

  const terminal = new DoseHarness(batch(82));
  terminal.hasLaterPending = true;
  terminal.flow.adoptSettlement(settlement({ outcome: 'not-applicable' }));
  equal(terminal.event('review-required')?.beanId, 'bean-1');
});

await run('dose canonicalization rebases to first-admission metadata', () => {
  const harness = new DoseHarness(batch(64));
  harness.revision = 9;
  harness.flow.adoptCanonicalization(canonicalization());

  equal(harness.reconcileRequests[0]?.expectedCurrent, 64);
  equal(harness.reconcileRequests[0]?.resolvedRemaining, 82);
  equal(harness.retained[0]?.expectedRemaining, 82);
  equal(harness.retained[0]?.fieldRevision, 9);
  equal(harness.order.join(','), 'reconcile,retain,commit:projection');
});

await run('dose admission disposal drains accepted work without stale projection', async () => {
  const harness = new DoseHarness();
  const gate = deferred<DoseMutationEnqueueResult>();
  let barrierReleases = 0;
  harness.enqueue = () => gate.promise;
  const admitting = harness.flow.admit(request());
  const draining = harness.flow.disposeAndWait();
  let drained = false;
  void draining.then(() => { drained = true; });
  await Promise.resolve();
  equal(drained, false);

  gate.resolve(queued({}, () => { barrierReleases += 1; }));
  equal(await admitting, true);
  await draining;
  equal(harness.event('projection'), undefined);
  equal(harness.event('review-required'), undefined);
  equal(barrierReleases, 1);
  equal(await harness.flow.admit(request()), false);
});
}

class DoseHarness {
  readonly state: {
    batchesByBean: Record<string, BeanBatch[]>;
    disposed: boolean;
  };
  readonly flow: DoseDeductionAdmissionFlow;
  readonly events: DoseDeductionEvent[] = [];
  readonly enqueueInputs: EnqueueDoseMutationInput[] = [];
  readonly reservations: PendingRemainingWeightReservation[] = [];
  readonly retained: PendingRemainingWeightAdjustment[] = [];
  readonly released: string[] = [];
  readonly reconcileRequests: RemainingWeightReconciliation[] = [];
  readonly cached: BeanInventoryProjection[] = [];
  readonly order: string[] = [];
  revision = 0;
  hasLaterPending = false;
  demoRemaining: number | null = null;
  demoStatus: string | null = null;
  enqueue = async (input: EnqueueDoseMutationInput): Promise<DoseMutationEnqueueResult> =>
    queued({ expectedRemaining: input.expectedRemaining });

  constructor(sourceBatch: BeanBatch = batch()) {
    this.state = {
      batchesByBean: { [sourceBatch.beanId!]: [sourceBatch] },
      disposed: false
    };
    this.flow = new DoseDeductionAdmissionFlow(
      {
        now: () => new Date('2026-07-13T10:00:00.000Z'),
        enqueue: (input) => {
          this.order.push('enqueue');
          this.enqueueInputs.push(input);
          return this.enqueue(input);
        },
        applyDemoDeduction: async ({ weightRemaining, status }) => {
          this.demoRemaining = weightRemaining;
          this.demoStatus = status;
        },
        inventory: {
          remainingWeightRevision: () => this.revision,
          reservePendingRemainingWeight: (reservation) => {
            this.order.push('reserve');
            this.reservations.push(reservation);
            return true;
          },
          retainPendingRemainingWeight: (adjustment) => {
            this.order.push('retain');
            this.retained.push(adjustment);
            return true;
          },
          releasePendingRemainingWeight: (idempotencyKey) => {
            this.order.push('release');
            this.released.push(idempotencyKey);
          },
          hasPendingRemainingWeightAfter: () => {
            this.order.push('has-later');
            return this.hasLaterPending;
          },
          reconcileRemainingWeight: (input) => this.reconcile(input),
          cacheProjection: async (projection) => {
            this.cached.push(projection);
          }
        }
      },
      {
        snapshot: (): DoseDeductionSnapshot => this.state,
        commit: (event) => {
          this.order.push(`commit:${event.type}`);
          this.events.push(event);
          if (event.type === 'projection') {
            this.state.batchesByBean[event.projection.beanId] = [...event.projection.batches];
          }
        }
      }
    );
  }

  reconcile(input: RemainingWeightReconciliation): BeanInventoryProjection | null {
    this.order.push('reconcile');
    this.reconcileRequests.push(input);
    const batches = this.state.batchesByBean[input.beanId] ?? [];
    const current = batches.find((candidate) => candidate.id === input.batchId);
    if (current?.weightRemaining !== input.expectedCurrent) return null;
    return {
      beanId: input.beanId,
      batches: batches.map((candidate) => candidate.id === input.batchId
        ? { ...candidate, weightRemaining: input.resolvedRemaining }
        : candidate),
      shouldScheduleApply: false
    };
  }

  event<Type extends DoseDeductionEvent['type']>(
    type: Type
  ): Extract<DoseDeductionEvent, { type: Type }> | undefined {
    return this.events.find(
      (event): event is Extract<DoseDeductionEvent, { type: Type }> => event.type === type
    );
  }
}

const bean: Bean = { id: 'bean-1', roaster: 'Test', name: 'Coffee' };

function batch(weightRemaining = 100): BeanBatch {
  return { id: 'batch-1', beanId: bean.id, weight: 250, weightRemaining };
}

function request(
  extra: Partial<Parameters<DoseDeductionAdmissionFlow['admit']>[0]> = {}
): Parameters<DoseDeductionAdmissionFlow['admit']>[0] {
  return {
    bean,
    batchId: 'batch-1',
    doseWeight: 18,
    shotId: 'shot-1',
    demo: false,
    ...extra
  };
}

function queued(
  extra: Partial<DoseMutationEnqueueResult> = {},
  releaseProjection: () => void = () => {}
): DoseMutationEnqueueResult {
  return {
    inserted: true,
    idempotencyKey: 'pending-dose:shot-1:batch-1',
    settlementPending: true,
    expectedRemaining: 82,
    durability: 'indexeddb',
    releaseProjection,
    ...extra
  };
}

function settlement(extra: Partial<DoseMutationSettlement> = {}): DoseMutationSettlement {
  return {
    idempotencyKey: 'dose-1',
    entry: {
      adjustment: 'deduction',
      beanId: bean.id,
      batchId: 'batch-1',
      dose: 18,
      baseRemaining: 100,
      expectedRemaining: 82,
      at: '2026-07-13T10:00:00.000Z'
    },
    outcome: 'committed',
    resolvedRemaining: 81.5,
    projectionRevision: 0,
    ...extra
  };
}

function canonicalization(): DoseMutationCanonicalization {
  return {
    idempotencyKey: 'dose-1',
    entry: {
      adjustment: 'deduction',
      beanId: bean.id,
      batchId: 'batch-1',
      dose: 18,
      baseRemaining: 100,
      expectedRemaining: 82,
      at: '2026-07-13T10:00:00.000Z'
    },
    projectedExpectedRemaining: 64,
    projectionRevision: null
  };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function run(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve().then(fn).then(() => console.log(`ok - ${name}`));
}

function equal<T>(actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(`Expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`);
  }
}

await main();
