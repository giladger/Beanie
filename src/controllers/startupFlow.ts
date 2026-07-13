import type {
  Bean,
  BeanBatch,
  GatewayStartupSnapshot,
  Grinder,
  MachineInfo,
  MachineSnapshot,
  PaginatedShots,
  ProfileRecord,
  RecipeDraft,
  ShotRecord,
  Workflow
} from '../api/types';
import {
  normalizeDraft,
  recipeFromWorkflow,
  selectInitialBean
} from '../domain/beanWorkflow';
import { recipeFingerprint } from '../domain/recipeIdentity';
import { beanIdForContext, beanUsageFromShots } from './beanWorkflowController';

export type StartupPhase =
  | 'starting'
  | 'connecting'
  | 'connected'
  | 'limited'
  | 'offline-cache'
  | 'demo'
  | 'retrying';

export interface StartupHostSnapshot {
  readonly hasUsableData: boolean;
  readonly demo: boolean;
  readonly appliedSignature: string | null;
  readonly batchesByBean: Record<string, BeanBatch[]>;
  /** Demo-derived settings/cache must be replaced before connected effects. */
  readonly settingsRecoveryRequired: boolean;
  /** Invalidates an in-flight load when transport authority changes. */
  readonly authorityRevision: number;
}

export interface StartupSelectionOptions {
  readonly apply: boolean;
  readonly preferWorkflow: true;
  readonly remember: boolean;
  readonly allowMaintenanceWrites: boolean;
}

export interface StartupFlowDependencies {
  loadSettings(): Promise<void>;
  loadCached(query: URLSearchParams): Promise<GatewayStartupSnapshot['data']>;
  loadGateway(
    query: URLSearchParams,
    canCommit?: () => boolean
  ): Promise<GatewayStartupSnapshot>;
  loadMachineInfo(): Promise<MachineInfo>;
  loadMachineState(): Promise<MachineSnapshot>;
  readLastBeanId(): string | null;
  onAuxiliaryFailure?(operation: StartupAuxiliaryOperation, error: unknown): void;
  onFailure?(error: unknown): void;
}

export type StartupAuxiliaryOperation = 'machine-info' | 'machine-state';

export interface StartupFlowHost {
  snapshot(): StartupHostSnapshot;
  commit(projection: StartupProjection): void;
  workflowMatchesBean(bean: Bean): boolean;
  selectBean(beanId: string, options: StartupSelectionOptions): Promise<void>;
  scheduleApply(): void;
  recoverSettings(): Promise<void>;
  applyEffects(plan: StartupEffectPlan): void;
  enterDemo(): void;
}

export interface StartupLoadingPatch {
  readonly loading: true;
  readonly startupPhase: 'connecting' | 'retrying';
  readonly status: string;
}

export interface StartupCachedPatch {
  readonly workflow: Workflow;
  readonly beans: Bean[];
  readonly beanUsageAt: Record<string, number>;
  readonly grinders: Grinder[];
  readonly profiles: ProfileRecord[];
  readonly selectedBeanId: string | null;
  readonly shots: ShotRecord[];
  /** Count of records proven present in this cached page, not a remote total. */
  readonly shotsTotal: number;
  readonly shotsLoadingMore: false;
  readonly detailShotId: null;
  readonly compareShotId: null;
  readonly draft: RecipeDraft;
  readonly appliedSignature: string;
  readonly demo: false;
  readonly startupPhase: 'offline-cache';
  readonly gatewayLinkDown: true;
  readonly loading: false;
  readonly status: 'Offline — showing cached data while reconnecting';
}

export interface StartupGatewayPatch {
  readonly workflow: Workflow;
  readonly beans: Bean[];
  readonly beanUsageAt: Record<string, number>;
  readonly grinders: Grinder[];
  readonly profiles: ProfileRecord[];
  readonly machineInfo: MachineInfo | null;
  readonly machine: MachineSnapshot | null;
  readonly asleep: boolean;
  readonly demo: false;
  readonly startupPhase: 'connected' | 'limited' | 'offline-cache' | 'retrying';
  readonly gatewayLinkDown: boolean;
  readonly loading: boolean;
  readonly status: string;
  /** Present when prior bean-dependent state cannot belong to this snapshot. */
  readonly selectedBeanId?: string | null;
  readonly selectedBatchId?: null;
  readonly batchesByBean?: Record<string, BeanBatch[]>;
  readonly shots?: ShotRecord[];
  readonly shotsTotal?: number;
  readonly shotsLoadingMore?: false;
  readonly detailShotId?: null;
  readonly compareShotId?: null;
  readonly draft?: RecipeDraft;
  readonly appliedSignature?: string;
}

export interface StartupRetainedPatch {
  readonly loading: false;
  readonly startupPhase: 'demo' | 'offline-cache';
  readonly gatewayLinkDown: boolean;
  readonly status: string;
}

export type StartupProjection =
  | {
      readonly type: 'loading';
      readonly patch: StartupLoadingPatch;
    }
  | {
      readonly type: 'cached';
      readonly authoritativeWorkflow: Workflow;
      readonly patch: StartupCachedPatch;
    }
  | {
      readonly type: 'gateway';
      readonly authoritativeWorkflow: Workflow;
      readonly resetDemoSettings: boolean;
      /** Keep the shell and all write capabilities gated until forced reload settles. */
      readonly settingsRecoveryPending: boolean;
      readonly patch: StartupGatewayPatch;
    }
  | {
      readonly type: 'settings-recovered';
      readonly patch: Pick<
        StartupGatewayPatch,
        'startupPhase' | 'gatewayLinkDown' | 'loading' | 'status'
      >;
    }
  | {
      readonly type: 'deferred-apply';
      readonly patch: {
        readonly status: 'Machine asleep — tap Wake to load recipe';
      };
    }
  | {
      readonly type: 'workflow-stale';
      readonly patch: {
        readonly applyState: 'stale';
        readonly status: 'Workflow changed on the machine';
      };
    }
  | {
      readonly type: 'retained-fallback';
      /** Reopen safe cached preferences after a forced live reload failed. */
      readonly releaseSettingsGate: boolean;
      readonly patch: StartupRetainedPatch;
    };

/**
 * An exhaustive shell-effect matrix. Keeping these modes discriminated makes
 * it impossible for an offline or limited startup to accidentally inherit a
 * connected-only write merely because a new boolean defaulted to true.
 */
export type StartupEffectPlan =
  | { readonly type: 'retry-only' }
  | { readonly type: 'offline' }
  | { readonly type: 'limited' }
  | {
      readonly type: 'connected';
      readonly beans: Bean[];
      readonly machine: MachineSnapshot | null;
    };

export interface StartupFlowRuntimeSnapshot {
  readonly inFlight: boolean;
  readonly disposed: boolean;
}

export type StartupLoadOutcome =
  | { readonly type: 'settled'; readonly phase: 'connected' | 'limited' | 'offline-cache' }
  | { readonly type: 'fallback'; readonly phase: 'demo' | 'offline-cache'; readonly error: unknown }
  | {
      readonly type: 'ignored';
      readonly reason: 'in-flight' | 'disposed' | 'authority-changed';
    }
  | { readonly type: 'disposed' };

/**
 * Owns boot/reconnect acquisition, fallback policy, and the exact startup
 * connectivity effect matrix. The host remains a narrow composition adapter:
 * this flow neither imports AppState nor implements settings, bean selection,
 * rendering, sockets, background tasks, or machine commands.
 */
export class StartupFlow {
  private inFlight = false;
  private disposed = false;

  constructor(
    private readonly deps: StartupFlowDependencies,
    private readonly host: StartupFlowHost
  ) {}

  get snapshot(): StartupFlowRuntimeSnapshot {
    return { inFlight: this.inFlight, disposed: this.disposed };
  }

  async load(): Promise<StartupLoadOutcome> {
    if (this.disposed) return { type: 'ignored', reason: 'disposed' };
    if (this.inFlight) return { type: 'ignored', reason: 'in-flight' };

    this.inFlight = true;
    let hadUsableData = false;
    let previousAppliedSignature: string | null = null;
    let authorityRevision = this.host.snapshot().authorityRevision;
    let forcedSettingsPending = false;
    try {
      const initial = this.host.snapshot();
      authorityRevision = initial.authorityRevision;
      hadUsableData = initial.hasUsableData;
      previousAppliedSignature = initial.appliedSignature;
      this.commit({
        type: 'loading',
        patch: {
          loading: true,
          startupPhase: hadUsableData ? 'retrying' : 'connecting',
          status: hadUsableData ? 'Reconnecting to Decent.app…' : 'Loading Decent.app data'
        }
      });

      // Settings gate real content. Keeping this await inside the owned try /
      // finally also guarantees an unexpected rejection cannot wedge retries.
      await this.deps.loadSettings();
      if (this.disposed) return { type: 'disposed' };
      if (!this.authorityCurrent(authorityRevision)) {
        return { type: 'ignored', reason: 'authority-changed' };
      }

      const latestShotQuery = new URLSearchParams({ limit: '50', offset: '0', order: 'desc' });
      if (!hadUsableData) {
        const cached = await this.deps.loadCached(latestShotQuery);
        if (this.disposed) return { type: 'disposed' };
        if (!this.authorityCurrent(authorityRevision)) {
          return { type: 'ignored', reason: 'authority-changed' };
        }
        if (cached.workflow && cached.beans && cached.beans.length > 0) {
          this.commit(cachedProjection(
            cached,
            this.deps.readLastBeanId(),
            this.host.snapshot().batchesByBean
          ));
          hadUsableData = true;
        }
      }

      const startup = await this.deps.loadGateway(
        latestShotQuery,
        () => !this.disposed && this.authorityCurrent(authorityRevision)
      );
      if (this.disposed) return { type: 'disposed' };
      if (!this.authorityCurrent(authorityRevision)) {
        return { type: 'ignored', reason: 'authority-changed' };
      }
      const workflow = startup.data.workflow;
      const beans = startup.data.beans;
      if (!workflow || !beans) {
        throw new Error('Essential gateway startup data was unavailable');
      }

      const latestShots = startup.data.latestShots ?? emptyShotPage(latestShotQuery);
      const [machineInfo, machine] = await Promise.all([
        this.loadAuxiliary('machine-info', () => this.deps.loadMachineInfo()),
        this.loadAuxiliary('machine-state', () => this.deps.loadMachineState())
      ]);
      if (this.disposed) return { type: 'disposed' };
      if (!this.authorityCurrent(authorityRevision)) {
        return { type: 'ignored', reason: 'authority-changed' };
      }

      const machineSleeping = machine?.state?.state === 'sleeping';
      const offlineWithCache = startup.status === 'gateway-unavailable';
      const limited = startup.status === 'partial-failure';
      const settled = this.host.snapshot();
      const replacingDemoData = settled.demo;
      const settingsRecoveryRequired = replacingDemoData || settled.settingsRecoveryRequired;
      const settingsRecoveryPending = settingsRecoveryRequired && !offlineWithCache;
      const lastBeanId = this.deps.readLastBeanId();
      this.commit(gatewayProjection({
        startup,
        workflow,
        beans,
        latestShots,
        machineInfo,
        machine,
        batchesByBean: settled.batchesByBean,
        recoveringFromDemo: replacingDemoData,
        settingsRecoveryPending,
        lastBeanId
      }));

      if (offlineWithCache) {
        this.applyEffects({ type: 'offline' });
        return { type: 'settled', phase: 'offline-cache' };
      }
      if (settingsRecoveryRequired) {
        forcedSettingsPending = true;
        await this.host.recoverSettings();
        if (this.disposed) return { type: 'disposed' };
        if (!this.authorityCurrent(authorityRevision)) {
          return { type: 'ignored', reason: 'authority-changed' };
        }
        this.commit({
          type: 'settings-recovered',
          patch: terminalGatewayPatch(startup, machine)
        });
        forcedSettingsPending = false;
      }

      const selected = selectInitialBean(
        beans,
        workflow,
        lastBeanId,
        latestShots.items[0]
      );
      if (selected) {
        const wantsStartupApply = !this.host.workflowMatchesBean(selected);
        await this.host.selectBean(selected.id, {
          apply: !limited && wantsStartupApply && !machineSleeping,
          preferWorkflow: true,
          remember: !limited,
          allowMaintenanceWrites: !limited
        });
        if (this.disposed) return { type: 'disposed' };
        if (!this.authorityCurrent(authorityRevision)) {
          return { type: 'ignored', reason: 'authority-changed' };
        }
        if (!limited && wantsStartupApply && machineSleeping) {
          this.host.scheduleApply();
          this.commit({
            type: 'deferred-apply',
            patch: { status: 'Machine asleep — tap Wake to load recipe' }
          });
        }
      }

      if (
        previousAppliedSignature != null &&
        recipeFingerprint(workflow) !== previousAppliedSignature
      ) {
        this.commit({
          type: 'workflow-stale',
          patch: {
            applyState: 'stale',
            status: 'Workflow changed on the machine'
          }
        });
      }

      if (limited) {
        this.applyEffects({ type: 'limited' });
        return { type: 'settled', phase: 'limited' };
      }

      this.applyEffects({ type: 'connected', beans, machine });
      return { type: 'settled', phase: 'connected' };
    } catch (error) {
      if (this.disposed) return { type: 'disposed' };
      if (!this.authorityCurrent(authorityRevision)) {
        return { type: 'ignored', reason: 'authority-changed' };
      }
      this.reportFailure(error);
      if (hadUsableData) {
        const demo = this.host.snapshot().demo;
        this.commit({
          type: 'retained-fallback',
          releaseSettingsGate: forcedSettingsPending,
          patch: {
            loading: false,
            startupPhase: demo ? 'demo' : 'offline-cache',
            gatewayLinkDown: !demo,
            status: demo
              ? 'DEMO — sample data · gateway still unavailable'
              : 'Offline — showing cached data · retrying automatically'
          }
        });
        this.applyEffects({ type: 'retry-only' });
        return { type: 'fallback', phase: demo ? 'demo' : 'offline-cache', error };
      }
      this.host.enterDemo();
      return { type: 'fallback', phase: 'demo', error };
    } finally {
      this.inFlight = false;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
  }

  private commit(projection: StartupProjection): void {
    if (!this.disposed) this.host.commit(projection);
  }

  private applyEffects(plan: StartupEffectPlan): void {
    if (!this.disposed) this.host.applyEffects(plan);
  }

  private authorityCurrent(revision: number): boolean {
    return this.host.snapshot().authorityRevision === revision;
  }

  private async loadAuxiliary<Value>(
    operation: StartupAuxiliaryOperation,
    load: () => Promise<Value>
  ): Promise<Value | null> {
    try {
      return await load();
    } catch (error) {
      try {
        this.deps.onAuxiliaryFailure?.(operation, error);
      } catch {
        // Diagnostics must never demote otherwise usable startup data.
      }
      return null;
    }
  }

  private reportFailure(error: unknown): void {
    try {
      this.deps.onFailure?.(error);
    } catch {
      // Diagnostics must not replace the original failure or block fallback.
    }
  }
}

function cachedProjection(
  cached: GatewayStartupSnapshot['data'],
  lastBeanId: string | null,
  batchesByBean: Record<string, BeanBatch[]>
): Extract<StartupProjection, { type: 'cached' }> {
  const workflow = cached.workflow;
  const beans = cached.beans;
  if (!workflow || !beans || beans.length === 0) {
    throw new Error('Cached startup projection requires workflow and beans');
  }
  const grinders = cached.grinders ?? [];
  const profiles = cached.profiles ?? [];
  const selected = selectInitialBean(beans, workflow, lastBeanId, cached.latestShots?.items[0]);
  const history = cachedShotHistoryForSelection(cached.latestShots, {
    beanId: selected?.id ?? null,
    beans,
    batchesByBean
  });
  return {
    type: 'cached',
    authoritativeWorkflow: workflow,
    patch: {
      workflow,
      beans,
      beanUsageAt: beanUsageFromShots(beans, cached.latestShots?.items ?? [], {}),
      grinders,
      profiles,
      selectedBeanId: selected?.id ?? null,
      shots: history.records,
      shotsTotal: history.total,
      shotsLoadingMore: false,
      detailShotId: null,
      compareShotId: null,
      draft: normalizeDraft(recipeFromWorkflow(workflow), profiles, grinders),
      appliedSignature: recipeFingerprint(workflow),
      demo: false,
      startupPhase: 'offline-cache',
      gatewayLinkDown: true,
      loading: false,
      status: 'Offline — showing cached data while reconnecting'
    }
  };
}

function gatewayProjection(input: {
  startup: GatewayStartupSnapshot;
  workflow: Workflow;
  beans: Bean[];
  latestShots: PaginatedShots;
  machineInfo: MachineInfo | null;
  machine: MachineSnapshot | null;
  batchesByBean: Record<string, BeanBatch[]>;
  recoveringFromDemo: boolean;
  settingsRecoveryPending: boolean;
  lastBeanId: string | null;
}): Extract<StartupProjection, { type: 'gateway' }> {
  const offlineWithCache = input.startup.status === 'gateway-unavailable';
  const limited = input.startup.status === 'partial-failure';
  const machineSleeping = input.machine?.state?.state === 'sleeping';
  const resetBeanState = input.recoveringFromDemo || input.beans.length === 0;
  const selected = resetBeanState
    ? selectInitialBean(
        input.beans,
        input.workflow,
        input.lastBeanId,
        input.latestShots.items[0]
      )
    : null;
  const grinders = input.startup.data.grinders ?? [];
  const profiles = input.startup.data.profiles ?? [];
  const resetHistory = resetBeanState && offlineWithCache
    ? cachedShotHistoryForSelection(input.latestShots, {
        beanId: selected?.id ?? null,
        beans: input.beans,
        // Never use demo inventory to infer ownership of cached live shots.
        batchesByBean: input.recoveringFromDemo ? {} : input.batchesByBean
      })
    : { records: [], total: 0 };
  return {
    type: 'gateway',
    authoritativeWorkflow: input.workflow,
    resetDemoSettings: input.recoveringFromDemo,
    settingsRecoveryPending: input.settingsRecoveryPending,
    patch: {
      workflow: input.workflow,
      beans: input.beans,
      beanUsageAt: beanUsageFromShots(
        input.beans,
        input.latestShots.items,
        input.recoveringFromDemo ? {} : input.batchesByBean
      ),
      grinders,
      profiles,
      machineInfo: input.machineInfo,
      machine: input.machine,
      asleep: machineSleeping,
      demo: false,
      startupPhase: offlineWithCache
        ? 'offline-cache'
        : input.settingsRecoveryPending
          ? 'retrying'
          : limited
            ? 'limited'
            : 'connected',
      gatewayLinkDown: offlineWithCache,
      loading: input.settingsRecoveryPending,
      status: input.settingsRecoveryPending
        ? 'Refreshing settings from Decent.app…'
        : machineSleeping
          ? 'Machine asleep'
          : startupStatusLabel(input.startup.status),
      ...(resetBeanState ? {
        selectedBeanId: selected?.id ?? null,
        selectedBatchId: null,
        batchesByBean: {},
        shots: resetHistory.records,
        shotsTotal: resetHistory.total,
        shotsLoadingMore: false,
        detailShotId: null,
        compareShotId: null,
        draft: normalizeDraft(recipeFromWorkflow(input.workflow), profiles, grinders),
        appliedSignature: recipeFingerprint(input.workflow)
      } : {})
    }
  };
}

/**
 * Converts one mixed latest-shot cache page into truthful History state for a
 * concrete bean selection. History is intentionally bean-wide across bags. A
 * stable bean id proves ownership directly; a known batch-to-bean mapping may
 * prove older records that predate bean ids. Records resolving to another
 * known bean or to no bean are omitted rather than guessed from mutable labels.
 *
 * The global page cannot prove the selected bean's remote total, so `total`
 * deliberately counts only the records present in this page.
 */
export function cachedShotHistoryForSelection(
  page: PaginatedShots | null | undefined,
  selection: {
    readonly beanId: string | null;
    readonly beans: Bean[];
    readonly batchesByBean: Record<string, BeanBatch[]>;
  }
): { records: ShotRecord[]; total: number } {
  if (!page || !selection.beanId) return { records: [], total: 0 };
  const records = page.items
    .filter((shot) => {
      const explicitBeanId = shot.workflow?.context?.beanId;
      if (typeof explicitBeanId === 'string' && explicitBeanId.length > 0) {
        return explicitBeanId === selection.beanId;
      }
      return beanIdForContext(
        shot.workflow?.context,
        selection.beans,
        selection.batchesByBean
      ) === selection.beanId;
    })
    .map((shot): ShotRecord => ({
      ...shot,
      measurements: Array.isArray((shot as Partial<ShotRecord>).measurements)
        ? (shot as ShotRecord).measurements
        : []
    }));
  return { records, total: records.length };
}

function terminalGatewayPatch(
  startup: GatewayStartupSnapshot,
  machine: MachineSnapshot | null
): Extract<StartupProjection, { type: 'settings-recovered' }>['patch'] {
  const limited = startup.status === 'partial-failure';
  return {
    startupPhase: limited ? 'limited' : 'connected',
    gatewayLinkDown: false,
    loading: false,
    status: machine?.state?.state === 'sleeping'
      ? 'Machine asleep'
      : startupStatusLabel(startup.status)
  };
}

function emptyShotPage(query: URLSearchParams): PaginatedShots {
  return {
    items: [],
    total: 0,
    limit: Number(query.get('limit') ?? 0),
    offset: Number(query.get('offset') ?? 0)
  };
}

function startupStatusLabel(status: GatewayStartupSnapshot['status']): string {
  if (status === 'partial-failure') return 'Connected with limited data';
  if (status === 'gateway-unavailable') return 'Offline with cached data';
  return 'Connected';
}
