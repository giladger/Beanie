import type { RecipeDraft, ShotRecord } from '../api/types';
import {
  FlowCalibratorFlow,
  type FlowCalibratorHost,
  type FlowCalibratorMachinePort,
  type FlowCalibratorRuntimeSnapshot
} from '../controllers/flowCalibratorFlow';
import type {
  MachineWorkflowCommandOutcome,
  OwnedMachineLane
} from '../controllers/machineWorkflowCommands';
import {
  readFlowCalibrationGlobal,
  readFlowCalibrationOverrides,
  writeFlowCalibrationGlobal,
  writeFlowCalibrationOverrides
} from '../domain/flowCalibration';
import { clearSyncedCache, setStorePushHandler } from '../domain/settingsStore';

async function main(): Promise<void> {
await run('flow calibrator owns page opening and widens the seeded shot list', async () => {
  const seed = shot('seed', 'Seed profile');
  const loaded = shot('loaded', 'Loaded profile');
  const host = new Host({ currentShots: [seed] });
  host.latestShots = Promise.resolve([loaded]);
  const flow = new FlowCalibratorFlow(host, new MachinePort());

  flow.open();
  equal(host.showPageCalls, 1);
  equal(host.loadSettingsCalls, 1);
  equal(flow.pageProjection().shots[0]?.id, 'seed');
  await settle();
  equal(flow.pageProjection().shots[0]?.id, 'loaded');
  equal(host.renderCalls, 1);
});

await run('a reset fences a stale all-shot result', async () => {
  const host = new Host({ currentShots: [shot('current', 'Current')] });
  const pending = deferred<readonly ShotRecord[]>();
  host.latestShots = pending.promise;
  const flow = new FlowCalibratorFlow(host, new MachinePort());

  flow.open();
  flow.reset();
  pending.resolve([shot('stale', 'Stale')]);
  await settle();
  equal(flow.pageProjection().shots[0]?.id, 'current');
  equal(host.renderCalls, 0);
});

await run('the chart base freezes on the first preview edit', async () => {
  const host = new Host({
    currentCalibration: 1.1,
    currentShots: [shot('one', 'Profile')]
  });
  const flow = new FlowCalibratorFlow(host, new MachinePort());
  flow.open();
  flow.setDraft(1.2);
  host.state.currentCalibration = 1.5;

  const chart = flow.chartProjection();
  equal(chart.base, 1.1);
  equal(chart.draft, 1.2);
});

await run('read-only calibration rejects a save before storage or machine work', async () => {
  resetCalibrationStore();
  const host = new Host({
    settingsStoreAvailable: false,
    calibrationWritable: false,
    currentShots: [shot('one', 'Profile')]
  });
  const machine = new MachinePort();
  const flow = new FlowCalibratorFlow(host, machine);

  await flow.clickActions()['flow-cal-save-global']!({ value: '1.2' } as never);
  equal(readFlowCalibrationGlobal(), null);
  equal(machine.calibrations.length, 0);
  equal(host.statuses.at(-1), 'Flow calibration is read-only until live settings are available');
});

await run('saving the default projects and applies the active profile through the machine owner', async () => {
  resetCalibrationStore();
  const host = new Host({
    settingsStoreAvailable: true,
    calibrationWritable: true,
    currentCalibration: 1,
    activeProfileTitle: 'Active',
    currentShots: [shot('one', 'Active')]
  });
  const machine = new MachinePort();
  const flow = new FlowCalibratorFlow(host, machine);

  await flow.clickActions()['flow-cal-save-global']!({ value: '1.2' } as never);
  equal(readFlowCalibrationGlobal(), 1.2);
  equal(host.projectedCalibrations.join(','), '1.2');
  equal(machine.calibrations.join(','), '1.2');
  equal(host.statuses.at(-1), 'Default flow calibration saved');
});

await run('saving for a shot profile preserves an override and recipe projection', async () => {
  resetCalibrationStore();
  writeFlowCalibrationGlobal(1);
  const host = new Host({
    settingsStoreAvailable: true,
    calibrationWritable: true,
    currentCalibration: 1,
    activeProfileTitle: 'Other',
    currentShots: [shot('one', 'Selected')]
  });
  const flow = new FlowCalibratorFlow(host, new MachinePort());
  flow.open();

  await flow.clickActions()['flow-cal-save-profile']!({ value: '1.15' } as never);
  equal(readFlowCalibrationOverrides().Selected, 1.15);
  const recipe = flow.recipeCalibration({ profileTitle: 'Selected', profile: null } as RecipeDraft);
  equal(recipe?.target, 1.15);
  equal(recipe?.persistToMachine, true);
  equal(host.statuses.at(-1), 'Flow calibration saved for Selected');
});
}

function resetCalibrationStore(): void {
  setStorePushHandler(null);
  clearSyncedCache();
  writeFlowCalibrationOverrides({});
  clearSyncedCache();
}

class Host implements FlowCalibratorHost {
  readonly state: {
    demo: boolean;
    settingsLocal: boolean;
    settingsStoreAvailable: boolean;
    calibrationWritable: boolean;
    busy: boolean;
    currentCalibration: number | null;
    activeProfileTitle: string | null;
    currentShots: readonly ShotRecord[];
  };
  pageOpen = false;
  showPageCalls = 0;
  loadSettingsCalls = 0;
  renderCalls = 0;
  readonly statuses: string[] = [];
  readonly projectedCalibrations: number[] = [];
  latestShots: Promise<readonly ShotRecord[]> = Promise.resolve([]);

  constructor(overrides: Partial<FlowCalibratorRuntimeSnapshot> = {}) {
    this.state = {
      demo: false,
      settingsLocal: false,
      settingsStoreAvailable: true,
      calibrationWritable: true,
      busy: false,
      currentCalibration: 1,
      activeProfileTitle: null,
      currentShots: [],
      ...overrides
    };
  }

  runtime(): FlowCalibratorRuntimeSnapshot {
    return this.state;
  }

  isPageOpen(): boolean {
    return this.pageOpen;
  }

  showPage(): void {
    this.showPageCalls += 1;
    this.pageOpen = true;
  }

  showStatus(status: string): void {
    this.statuses.push(status);
  }

  requestRender(): void {
    this.renderCalls += 1;
  }

  projectMachineCalibration(value: number): void {
    this.projectedCalibrations.push(value);
    this.state.currentCalibration = value;
  }

  async loadSettings(): Promise<void> {
    this.loadSettingsCalls += 1;
  }

  loadLatestShots(): Promise<readonly ShotRecord[]> {
    return this.latestShots;
  }
}

class MachinePort implements FlowCalibratorMachinePort {
  readonly calibrations: number[] = [];

  async runExact<Value>(
    run: (lane: OwnedMachineLane) => Value | PromiseLike<Value>
  ): Promise<MachineWorkflowCommandOutcome<Value>> {
    const lane = {
      updateCalibration: async (value: number) => {
        this.calibrations.push(value);
      }
    } as OwnedMachineLane;
    return { status: 'completed', value: await run(lane) };
  }
}

function shot(id: string, profileTitle: string): ShotRecord {
  return {
    id,
    timestamp: '2026-07-14T10:00:00.000Z',
    measurements: [],
    workflow: {
      name: profileTitle,
      profile: { title: profileTitle }
    }
  } as ShotRecord;
}

function deferred<Value>(): {
  promise: Promise<Value>;
  resolve(value: Value): void;
} {
  let resolve!: (value: Value) => void;
  return {
    promise: new Promise<Value>((done) => {
      resolve = done;
    }),
    resolve
  };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
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

function equal<Value>(actual: Value, expected: Value): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  }
}

await main();
