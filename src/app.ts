import type {
  Bean,
  BeanBatch,
  Grinder,
  HotWaterData,
  MachineSnapshot,
  MachineState,
  ProfileRecord,
  RecipeDraft,
  RinseData,
  ScaleSnapshot,
  ShotRecord,
  ShotSummary,
  SteamSettings,
  Workflow
} from './api/types';
import { gateway, gatewayHttpOrigin, gatewayWsOrigin } from './api/gateway';
import {
  beanLabel,
  buildWorkflowUpdate,
  emptyRecipe,
  formatGrams,
  formatRatio,
  latestBatch,
  normalizeDraft,
  parseNumberInput,
  profileBaseTemperature,
  ratioFor,
  recipeFromShot,
  recipeFromWorkflow,
  selectInitialBean,
  shotFilterForBean,
  yieldForRatio
} from './domain/beanWorkflow';
import {
  readFavoriteProfiles,
  readLastBeanId,
  writeFavoriteProfiles,
  writeLastBeanId
} from './domain/storage';
import {
  demoBatches,
  demoBeans,
  demoGrinders,
  demoMachine,
  demoProfiles,
  demoShotsForBean,
  demoWorkflow
} from './mock/demo';
import { icon, refreshIcons } from './components/icons';
import {
  backspaceInputDialogValue,
  clearInputDialogValue,
  createInputDialog,
  grinderChoicesFromGrinders,
  inputDialogCommitValue,
  inputDialogKindForField,
  nudgeInputDialogValue,
  rememberInputDialogValue,
  renderInputDialog,
  selectInputDialogChoice,
  setInputDialogValue,
  type InputDialogState,
  typeInputDialogKey
} from './components/InputDialog';
import { renderSettingsShell } from './components/SettingsShell';
import { renderProfilePreview } from './components/profilePreview';
import {
  addStep,
  createProfileEditorState,
  duplicateStep,
  moveStep,
  nudgeSimpleProfileField,
  nudgeStepField,
  profileFromEditorState,
  removeStep,
  renderEditorModeBar,
  renderProfileEditor,
  selectStep,
  setAdvancedTab,
  setAllLimiterRanges,
  setEditorMode,
  setProfileMeta,
  setSimpleProfileField,
  setSimpleProfileType,
  setStepExit,
  setStepField,
  setStepPump,
  setStepTransition,
  type ProfileEditorState,
  type ProfileMetaKey,
  type SimpleProfileField,
  type StepFieldKey
} from './components/profileEditor';
import { LiveChart } from './components/LiveChart';
import { chartModelFromShot } from './components/liveChartModel';
import { LiveShotSession, simulateShotFrames, type LiveFrame } from './domain/liveShot';
import { beanieCache } from './domain/cache';
import {
  applySettingsPreferences,
  buildSettingsShellModel,
  readSettingsPreferences,
  resetBeanieCache,
  type SettingsPreferences,
  type ThemePreference,
  type UIScalePreference,
  writeSettingsPreferences
} from './domain/settings';

type Modal = 'edit-number' | null;
type EditField = 'dose' | 'yield' | 'ratio' | 'grinderSetting' | 'temperature';
type ApplyState = 'idle' | 'pending' | 'applied' | 'failed' | 'stale';
type View =
  | 'workbench'
  | 'settings'
  | 'machine'
  | 'profiles'
  | 'profile-editor'
  | 'bean-editor'
  | 'batch-editor'
  | 'grinder-editor';

const initialSettingsPreferences = readSettingsPreferences();

const FOCUSABLE_SEARCH = new Set(['search', 'profile-search', 'settings-search']);

// Scrollable containers whose scroll position must survive a re-render.
const SCROLL_SELECTORS = ['.bean-list', '.shot-list', '.page-body'];

// Mirror ReaPrime's SteamSettings / HotWaterData / RinseData defaults.
const DEFAULT_STEAM: SteamSettings = {
  targetTemperature: 150,
  duration: 50,
  flow: 0.8,
  stopAtTemperature: 0
};
const DEFAULT_HOT_WATER: HotWaterData = {
  targetTemperature: 75,
  duration: 30,
  volume: 50,
  flow: 10
};
const DEFAULT_RINSE: RinseData = { targetTemperature: 90, duration: 10, flow: 6 };

interface AppState {
  beans: Bean[];
  batchesByBean: Record<string, BeanBatch[]>;
  grinders: Grinder[];
  profiles: ProfileRecord[];
  workflow: Workflow | null;
  selectedBeanId: string | null;
  selectedBatchId: string | null;
  shots: ShotRecord[];
  shotsTotal: number;
  shotsLoadingMore: boolean;
  draft: RecipeDraft;
  search: string;
  profileSearch: string;
  profilePage: number;
  profileFocusId: string | null;
  favoriteProfiles: string[];
  autoLoad: boolean;
  settingsPreferences: SettingsPreferences;
  settingsSearch: string;
  demo: boolean;
  loading: boolean;
  busy: boolean;
  status: string;
  view: View;
  settingsSection: string;
  modal: Modal;
  editingBeanId: string | null;
  profileEditor: ProfileEditorState | null;
  editingProfileId: string | null;
  editDialog: InputDialogState | null;
  profileDialogKey: SimpleProfileField | null;
  detailShotId: string | null;
  machine: MachineSnapshot | null;
  scale: ScaleSnapshot | null;
  liveActive: boolean;
  asleep: boolean;
  applyState: ApplyState;
  appliedSignature: string | null;
}

interface LiveReadoutEls {
  time: HTMLElement | null;
  weight: HTMLElement | null;
  pressure: HTMLElement | null;
  flow: HTMLElement | null;
  temp: HTMLElement | null;
}

export class BeanieApp {
  private state: AppState = {
    beans: [],
    batchesByBean: {},
    grinders: [],
    profiles: [],
    workflow: null,
    selectedBeanId: null,
    selectedBatchId: null,
    shots: [],
    shotsTotal: 0,
    shotsLoadingMore: false,
    draft: emptyRecipe(),
    search: '',
    profileSearch: '',
    profilePage: 0,
    profileFocusId: null,
    favoriteProfiles: readFavoriteProfiles(),
    autoLoad: initialSettingsPreferences.autoLoad,
    settingsPreferences: initialSettingsPreferences,
    settingsSearch: '',
    demo: false,
    loading: true,
    busy: false,
    status: 'Starting',
    view: 'workbench',
    settingsSection: 'gateway',
    modal: null,
    editingBeanId: null,
    profileEditor: null,
    editingProfileId: null,
    editDialog: null,
    profileDialogKey: null,
    detailShotId: null,
    machine: null,
    scale: null,
    liveActive: false,
    asleep: false,
    applyState: 'idle',
    appliedSignature: null
  };

  private applyTimer: number | null = null;
  private machineRetryTimer: number | null = null;
  private scaleRetryTimer: number | null = null;
  private machineSocket: WebSocket | null = null;
  private scaleSocket: WebSocket | null = null;

  private readonly liveShot = new LiveShotSession();
  private liveChart: LiveChart | null = null;
  private liveCanvas: HTMLCanvasElement | null = null;
  private liveReadoutEls: LiveReadoutEls | null = null;
  private liveRaf: number | null = null;
  private liveDirty = false;
  private simTimer: number | null = null;

  private readonly handleClick = (event: Event) => void this.onClick(event);
  private readonly handleInput = (event: Event) => this.onInput(event);
  private readonly handleChange = (event: Event) => void this.onChange(event);
  private readonly handleSubmit = (event: Event) => void this.onSubmit(event);

  constructor(private readonly root: HTMLElement) {}

  start(): void {
    applySettingsPreferences(this.state.settingsPreferences);
    this.root.addEventListener('click', this.handleClick);
    this.root.addEventListener('input', this.handleInput);
    this.root.addEventListener('change', this.handleChange);
    this.root.addEventListener('submit', this.handleSubmit);
    this.render();
    void this.load();
  }

  dispose(): void {
    this.root.removeEventListener('click', this.handleClick);
    this.root.removeEventListener('input', this.handleInput);
    this.root.removeEventListener('change', this.handleChange);
    this.root.removeEventListener('submit', this.handleSubmit);
    if (this.applyTimer != null) window.clearTimeout(this.applyTimer);
    if (this.machineRetryTimer != null) window.clearTimeout(this.machineRetryTimer);
    if (this.scaleRetryTimer != null) window.clearTimeout(this.scaleRetryTimer);
    if (this.simTimer != null) window.clearTimeout(this.simTimer);
    if (this.liveRaf != null) window.cancelAnimationFrame(this.liveRaf);
    this.machineSocket?.close();
    this.scaleSocket?.close();
  }

  private async load(): Promise<void> {
    const prevSignature = this.state.appliedSignature;
    this.setState({ loading: true, status: 'Loading Decent.app data' });
    try {
      const latestShotQuery = new URLSearchParams({ limit: '1', offset: '0', order: 'desc' });
      const [workflow, beans, grinders, profiles, latestShots] = await Promise.all([
        gateway.workflow(),
        gateway.beans(),
        gateway.grinders(),
        gateway.profiles(),
        gateway.shots(latestShotQuery)
      ]);

      this.setState({
        workflow,
        beans,
        grinders,
        profiles,
        demo: false,
        loading: false,
        status: 'Connected'
      });

      const selected = selectInitialBean(beans, workflow, readLastBeanId(), latestShots.items[0]);
      if (selected) {
        await this.selectBean(selected.id, {
          apply: this.state.autoLoad && !this.workflowMatchesBean(selected),
          preferWorkflow: true
        });
      }
      if (prevSignature != null && workflowSignature(workflow) !== prevSignature) {
        this.setState({ applyState: 'stale', status: 'Workflow changed on the machine' });
      }
      this.connectMachineSocket();
      this.connectScaleSocket();
    } catch (error) {
      console.warn('[Beanie] Gateway unavailable; using demo data', error);
      this.loadDemo();
    }
  }

  private loadDemo(): void {
    this.setState({
      workflow: demoWorkflow,
      beans: demoBeans,
      batchesByBean: demoBatches,
      grinders: demoGrinders,
      profiles: demoProfiles,
      machine: demoMachine,
      demo: true,
      loading: false,
      status: 'Demo data'
    });
    void this.selectBean(demoBeans[0]!.id, { apply: false, preferWorkflow: true });
  }

  private async selectBean(
    beanId: string,
    options: { apply: boolean; preferWorkflow: boolean }
  ): Promise<void> {
    const bean = this.state.beans.find((item) => item.id === beanId);
    if (!bean) return;

    writeLastBeanId(bean.id);
    this.setState({
      selectedBeanId: bean.id,
      busy: true,
      status: `Loading ${beanLabel(bean)}`
    });

    const batches = await this.loadBatches(bean);
    const selectedBatch =
      batches.find((batch) => batch.id === this.state.workflow?.context?.beanBatchId) ??
      latestBatch(batches);

    const { records: shots, total: shotsTotal } = await this.loadFirstShots(bean);
    const workflowMatches = this.workflowMatchesBean(bean);
    const draft =
      options.preferWorkflow && workflowMatches
        ? recipeFromWorkflow(this.state.workflow)
        : recipeFromShot(shots[0] ?? null);

    this.setState({
      batchesByBean: { ...this.state.batchesByBean, [bean.id]: batches },
      selectedBatchId: selectedBatch?.id ?? null,
      shots,
      shotsTotal,
      shotsLoadingMore: false,
      draft: normalizeDraft(draft, this.state.profiles, this.state.grinders),
      busy: false,
      applyState: 'idle',
      appliedSignature: workflowSignature(this.state.workflow),
      status: `${shots.length} shots loaded`
    });

    if (options.apply && this.state.autoLoad) {
      await this.applyDraft();
    }
  }

  private async loadBatches(bean: Bean): Promise<BeanBatch[]> {
    if (this.state.demo) return this.state.batchesByBean[bean.id] ?? [];
    try {
      return await gateway.batches(bean.id);
    } catch (error) {
      console.warn('[Beanie] Could not load batches', error);
      return [];
    }
  }

  private readonly shotPageSize = 12;

  private async loadFirstShots(bean: Bean): Promise<{ records: ShotRecord[]; total: number }> {
    if (this.state.demo) {
      const records = demoShotsForBean(bean);
      return { records, total: records.length };
    }
    return this.fetchShotPage(bean, 0);
  }

  // Fetches one page of shots, caching the page + summaries and reading full
  // records through the IndexedDB cache. Falls back to a cached page when the
  // gateway is unreachable so history stays usable offline.
  private async fetchShotPage(
    bean: Bean,
    offset: number
  ): Promise<{ records: ShotRecord[]; total: number }> {
    const query = shotFilterForBean(bean, null);
    query.set('limit', String(this.shotPageSize));
    query.set('offset', String(offset));

    try {
      const page = await gateway.shots(query);
      void beanieCache.putShotPage(query, page);
      void beanieCache.putShotSummaries(page.items);
      const records = await Promise.all(page.items.map((shot) => this.loadFullShot(shot)));
      return { records, total: page.total };
    } catch (error) {
      console.warn('[Beanie] Could not load shots', error);
      const cached = await beanieCache.getShotPage(query).catch(() => null);
      if (cached) {
        const records = await Promise.all(cached.items.map((shot) => this.loadFullShot(shot)));
        return { records, total: cached.total };
      }
      return { records: [], total: offset };
    }
  }

  private async loadFullShot(shot: ShotSummary): Promise<ShotRecord> {
    const cached = await beanieCache.getShotRecord(shot.id).catch(() => null);
    if (cached) return cached;
    try {
      const record = await gateway.shot(shot.id);
      void beanieCache.putShotRecord(record);
      return record;
    } catch {
      return { ...shot, measurements: [] };
    }
  }

  private async loadMoreShots(): Promise<void> {
    const bean = this.selectedBean();
    if (!bean || this.state.demo || this.state.shotsLoadingMore) return;
    if (this.state.shots.length >= this.state.shotsTotal) return;
    this.setState({ shotsLoadingMore: true, status: 'Loading more shots' });
    const { records } = await this.fetchShotPage(bean, this.state.shots.length);
    const shots = [...this.state.shots, ...records];
    this.setState({ shots, shotsLoadingMore: false, status: `${shots.length} shots` });
  }

  private async applyDraft(): Promise<void> {
    const bean = this.selectedBean();
    if (!bean) return;

    const draft = normalizeDraft(this.state.draft, this.state.profiles, this.state.grinders);
    const batch = this.selectedBatch();
    const update = buildWorkflowUpdate(bean, batch, draft, draft.profile, this.state.workflow);
    const signature = draftSignature(draft);

    this.setState({ applyState: 'pending', status: 'Applying workflow' });
    if (this.state.demo) {
      // Do not write `draft` back: the user may have edited again during the
      // (debounced) apply, and clobbering it with this snapshot would revert
      // those taps. appliedSignature reflects what was sent; if the live draft
      // now differs it stays dirty and the pending debounce re-applies.
      this.setState({
        workflow: update,
        applyState: 'applied',
        appliedSignature: signature,
        status: 'Workflow applied in demo'
      });
      return;
    }

    try {
      const workflow = await gateway.updateWorkflow(update);
      this.setState({
        workflow,
        applyState: 'applied',
        appliedSignature: signature,
        status: 'Workflow applied'
      });
    } catch (error) {
      console.error('[Beanie] Apply failed', error);
      this.setState({ applyState: 'failed', status: 'Apply failed' });
    }
  }

  // Debounced auto-apply: any dial-in edit pushes the draft to the workflow
  // 200ms after the last change, so there is no manual Apply button.
  private scheduleApply(): void {
    if (!this.selectedBean()) return;
    if (this.applyTimer != null) window.clearTimeout(this.applyTimer);
    this.applyTimer = window.setTimeout(() => {
      this.applyTimer = null;
      void this.applyDraft();
    }, 200);
  }

  private loadShotRecipe(shotId: string): void {
    const shot = this.state.shots.find((item) => item.id === shotId);
    if (!shot) return;
    this.setState({
      draft: normalizeDraft(recipeFromShot(shot), this.state.profiles, this.state.grinders),
      view: 'workbench',
      detailShotId: shotId,
      status: 'Shot recipe loaded'
    });
    this.scheduleApply();
  }

  private selectHistoryShot(shotId: string): void {
    if (this.selectedHistoryShot()?.id === shotId) {
      this.loadShotRecipe(shotId);
      return;
    }
    this.setState({ detailShotId: shotId, status: 'Shot selected' });
  }

  private async machineAction(state: MachineState): Promise<void> {
    this.setState({ busy: true, status: `Sending ${state}` });
    if (this.state.demo) {
      this.setState({ busy: false, status: `Demo ${state}` });
      return;
    }
    try {
      await gateway.requestState(state);
      this.setState({ busy: false, status: `Sent ${state}` });
    } catch (error) {
      console.error('[Beanie] Machine action failed', error);
      this.setState({ busy: false, status: 'Machine command failed' });
    }
  }

  private connectMachineSocket(): void {
    if (this.state.demo) return;
    this.machineSocket?.close();
    const ws = new WebSocket(`${gatewayWsOrigin()}/ws/v1/machine/snapshot`);
    this.machineSocket = ws;
    ws.onmessage = (event) => {
      try {
        const snapshot = JSON.parse(event.data) as MachineSnapshot;
        this.ingestLiveFrame(snapshot, null, Date.now());
      } catch (error) {
        console.warn('[Beanie] Bad machine frame', error);
      }
    };
    ws.onclose = () => {
      if (this.machineSocket !== ws) return;
      if (this.machineRetryTimer != null) window.clearTimeout(this.machineRetryTimer);
      this.machineRetryTimer = window.setTimeout(() => this.connectMachineSocket(), 2500);
    };
  }

  private connectScaleSocket(): void {
    if (this.state.demo) return;
    this.scaleSocket?.close();
    const ws = new WebSocket(`${gatewayWsOrigin()}/ws/v1/scale/snapshot`);
    this.scaleSocket = ws;
    ws.onmessage = (event) => {
      try {
        const snapshot = JSON.parse(event.data) as ScaleSnapshot;
        this.ingestLiveFrame(null, snapshot, Date.now());
      } catch (error) {
        console.warn('[Beanie] Bad scale frame', error);
      }
    };
    ws.onclose = () => {
      if (this.scaleSocket !== ws) return;
      if (this.scaleRetryTimer != null) window.clearTimeout(this.scaleRetryTimer);
      this.scaleRetryTimer = window.setTimeout(() => this.connectScaleSocket(), 3000);
    };
  }

  // Feed one telemetry frame (from either socket, or the demo simulator) into the
  // live-shot session. The hot path deliberately avoids a full re-render: while a
  // shot is active we only redraw the canvas and patch readout text by reference.
  private ingestLiveFrame(
    machine: MachineSnapshot | null,
    scale: ScaleSnapshot | null,
    tMs: number
  ): void {
    if (machine) this.state.machine = machine;
    if (scale) this.state.scale = scale;

    const wasActive = this.state.liveActive;
    const frame: LiveFrame = { tMs, machine: this.state.machine, scale: this.state.scale };
    this.liveShot.ingest(frame);
    const active = this.liveShot.isActive;

    if (active && !wasActive) {
      // First active frame: render once to mount the live panel + canvas, then draw.
      this.setState({ liveActive: true, status: 'Live shot' });
      return;
    }
    if (!active && wasActive) {
      this.onShotEnded();
      return;
    }
    if (active) {
      this.scheduleLiveDraw();
      return;
    }
    // A sleep/wake transition flips the screensaver — re-render for that. Any
    // other idle telemetry only patches the top-bar readouts by reference, so a
    // streaming snapshot never re-renders the whole app (which would reset
    // scroll position of the bean list / history / pages).
    const sleeping = this.state.machine?.state?.state === 'sleeping';
    if (sleeping !== this.state.asleep) {
      this.setState({ asleep: sleeping });
      return;
    }
    this.updateTopbarStats();
  }

  private updateTopbarStats(): void {
    const machine = this.state.machine;
    const scale = this.state.scale;
    const ready = machine?.state?.state ?? (this.state.loading ? 'loading' : 'idle');
    const set = (id: string, value: string) => {
      const el = this.root.querySelector<HTMLElement>(`#${id}`);
      if (el) el.textContent = value;
    };
    set('stat-machine', capitalize(ready));
    set('stat-group', temp(machine?.groupTemperature));
    set('stat-steam', temp(machine?.steamTemperature));
    set('stat-scale', scale?.status === 'disconnected' ? 'offline' : `${formatNumber(scale?.weight, 1)} g`);
  }

  // Coalesce many incoming frames into at most one canvas draw per animation
  // frame. No rAF is scheduled while idle, so we never spin on a sleeping tablet.
  private scheduleLiveDraw(): void {
    this.liveDirty = true;
    if (this.liveRaf != null) return;
    this.liveRaf = window.requestAnimationFrame(() => {
      this.liveRaf = null;
      if (!this.state.liveActive || !this.liveChart || !this.liveDirty) return;
      this.liveDirty = false;
      this.liveChart.resize();
      this.liveChart.setModel(this.liveShot.model());
      this.liveChart.draw();
      this.updateLiveReadouts();
    });
  }

  // Re-acquire the canvas + readout nodes after each full render. The DOM is only
  // rebuilt on user-driven setState, never mid-shot, so these refs stay stable
  // while telemetry streams in.
  private bindLiveElements(): void {
    const canvas = this.root.querySelector<HTMLCanvasElement>('#live-canvas');
    if (!canvas) {
      this.liveChart = null;
      this.liveCanvas = null;
      this.liveReadoutEls = null;
      return;
    }
    if (canvas !== this.liveCanvas) {
      this.liveCanvas = canvas;
      this.liveChart = new LiveChart(canvas, { detailed: true });
    }
    this.liveReadoutEls = {
      time: this.root.querySelector<HTMLElement>('#live-time'),
      weight: this.root.querySelector<HTMLElement>('#live-weight'),
      pressure: this.root.querySelector<HTMLElement>('#live-pressure'),
      flow: this.root.querySelector<HTMLElement>('#live-flow'),
      temp: this.root.querySelector<HTMLElement>('#live-temp')
    };
    this.scheduleLiveDraw();
  }

  private updateLiveReadouts(): void {
    const els = this.liveReadoutEls;
    if (!els) return;
    const latest = this.liveShot.latest;
    if (els.time) els.time.textContent = `${this.liveShot.elapsedSeconds.toFixed(1)}s`;
    if (els.weight) els.weight.textContent = formatNumber(latest.weight, 1);
    if (els.pressure) els.pressure.textContent = formatNumber(latest.pressure, 1);
    if (els.flow) els.flow.textContent = formatNumber(latest.flow, 1);
    if (els.temp) {
      els.temp.textContent =
        latest.scaledTemperature == null ? '--' : (latest.scaledTemperature * 10).toFixed(1);
    }
  }

  private onShotEnded(): void {
    const reason = this.liveShot.completionReason;
    this.setState({
      liveActive: false,
      status: reason ? `Shot complete (${reason})` : 'Shot complete'
    });
    this.liveShot.reset();
    const bean = this.selectedBean();
    if (bean && !this.state.demo) {
      void beanieCache.invalidateShotMutation().catch(() => {});
      void this.loadFirstShots(bean).then(({ records, total }) =>
        this.setState({ shots: records, shotsTotal: total })
      );
    }
  }

  // Demo affordance: replay a deterministic simulated shot at real-time pacing so
  // the live canvas can be throttle-tested without a machine.
  private startSimulatedShot(): void {
    if (this.simTimer != null) return;
    const frames = simulateShotFrames();
    const startMs = Date.now();
    let index = 0;
    const pump = () => {
      const elapsed = Date.now() - startMs;
      while (index < frames.length && frames[index]!.tMs <= elapsed) {
        const frame = frames[index]!;
        this.ingestLiveFrame(frame.machine ?? null, frame.scale ?? null, startMs + frame.tMs);
        index += 1;
      }
      if (index >= frames.length) {
        this.simTimer = null;
        return;
      }
      this.simTimer = window.setTimeout(pump, 16);
    };
    pump();
  }

  private async onClick(event: Event): Promise<void> {
    const target = event.target as HTMLElement;
    const el = target.closest<HTMLElement>('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    const id = el.dataset.id;
    const field = el.dataset.field;
    const index = el.dataset.index;
    const value = el.dataset.value;

    switch (action) {
      case 'select-bean':
        if (id) await this.selectBean(id, { apply: true, preferWorkflow: false });
        break;
      case 'adjust':
        if (field) this.adjustField(field, Number(el.dataset.delta ?? '0'));
        break;
      case 'edit-field':
        if (isEditField(field)) this.openEditDialog(field);
        break;
      case 'dialog-adjust':
        this.adjustDialogValue(Number(el.dataset.delta ?? '0'));
        break;
      case 'dialog-key':
        this.typeDialogKey(el.dataset.key ?? '');
        break;
      case 'dialog-backspace':
        this.backspaceDialogValue();
        break;
      case 'dialog-clear':
        this.clearDialogValue();
        break;
      case 'dialog-recent':
        this.setDialogValue(el.dataset.value ?? '');
        break;
      case 'dialog-choice':
        this.selectDialogChoice(id ?? null);
        break;
      case 'dialog-commit':
        this.commitEditDialog();
        break;
      case 'pe-simple-edit':
        if (el.dataset.key) this.openProfileNumberDialog(el.dataset.key as SimpleProfileField, el);
        break;
      case 'go-view':
        if (value) this.goView(value as View);
        break;
      case 'select-history-shot':
        if (id) this.selectHistoryShot(id);
        break;
      case 'stop':
        await this.machineAction('idle');
        break;
      case 'sleep':
        await this.machineAction('sleeping');
        break;
      case 'wake':
        this.setState({ asleep: false });
        await this.machineAction('idle');
        break;
      case 'refresh':
        await this.load();
        break;
      case 'load-more-shots':
        await this.loadMoreShots();
        break;
      case 'simulate-shot':
        this.startSimulatedShot();
        break;
      case 'open-settings':
        this.setState({ view: 'settings' });
        break;
      case 'settings-section':
        if (value) this.setState({ settingsSection: value });
        break;
      case 'settings-theme':
        if (isThemePreference(el.dataset.value)) {
          this.updateSettingsPreferences({ theme: el.dataset.value });
        }
        break;
      case 'settings-ui-scale':
        if (isUIScalePreference(el.dataset.value)) {
          this.updateSettingsPreferences({ uiScale: el.dataset.value });
        }
        break;
      case 'settings-reset-cache':
        await this.resetLocalCache();
        break;
      case 'open-add-bean':
        this.setState({ view: 'bean-editor', editingBeanId: null });
        break;
      case 'open-edit-bean':
        this.setState({ view: 'bean-editor', editingBeanId: id ?? this.state.selectedBeanId });
        break;
      case 'archive-bean':
        if (id) await this.archiveBean(id);
        break;
      case 'open-add-batch':
        this.setState({ view: 'batch-editor' });
        break;
      case 'open-add-grinder':
        this.setState({ view: 'grinder-editor', modal: null, editDialog: null });
        break;
      case 'open-profile-picker':
        this.setState({
          view: 'profiles',
          profileSearch: '',
          profilePage: 0,
          profileFocusId: this.profileIdForDraft()
        });
        break;
      case 'profiles-page':
        if (value) this.setState({ profilePage: Number(value) });
        break;
      case 'focus-profile':
        if (id) this.focusProfile(id);
        break;
      case 'open-machine-settings':
        this.setState({ view: 'machine' });
        break;
      case 'pick-profile':
        if (id) this.pickProfile(id);
        break;
      case 'toggle-favorite-profile':
        if (id) this.toggleFavoriteProfile(id);
        break;
      case 'close-modal':
        if (this.state.profileDialogKey) {
          this.setState({ modal: null, editDialog: null, profileDialogKey: null });
          break;
        }
        this.setState({
          modal: null,
          editingBeanId: null,
          profileEditor: null,
          editingProfileId: null,
          editDialog: null,
          profileDialogKey: null
        });
        break;
      case 'new-profile':
        this.setState({
          view: 'profile-editor',
          editingProfileId: null,
          profileEditor: createProfileEditorState(null),
          profileDialogKey: null
        });
        break;
      case 'edit-profile':
        if (id) this.openProfileEditor(id);
        break;
      case 'save-profile':
        await this.submitProfileEditor();
        break;
      case 'pe-add-step':
        this.editorDispatch(addStep);
        break;
      case 'pe-duplicate-step':
        if (index != null) this.editorDispatch((pe) => duplicateStep(pe, Number(index)));
        break;
      case 'pe-remove-step':
        if (index != null) this.editorDispatch((pe) => removeStep(pe, Number(index)));
        break;
      case 'pe-move-step':
        if (index != null) this.editorDispatch((pe) => moveStep(pe, Number(index), value === '1' ? 1 : -1));
        break;
      case 'pe-select-step':
        if (index != null) this.editorDispatch((pe) => selectStep(pe, Number(index)));
        break;
      case 'pe-step-pump':
        if (index != null) this.editorDispatch((pe) => setStepPump(pe, Number(index), value === 'flow' ? 'flow' : 'pressure'));
        break;
      case 'pe-step-transition':
        if (index != null) this.editorDispatch((pe) => setStepTransition(pe, Number(index), value === 'smooth' ? 'smooth' : 'fast'));
        break;
      case 'pe-step-sensor-toggle':
        if (index != null) {
          this.editorDispatch((pe) => {
            const step = pe.steps[Number(index)];
            return setStepField(pe, Number(index), 'sensor', step?.sensor === 'water' ? 'coffee' : 'water');
          });
        }
        break;
      case 'pe-step-transition-toggle':
        if (index != null) {
          this.editorDispatch((pe) => {
            const step = pe.steps[Number(index)];
            return setStepTransition(pe, Number(index), step?.transition === 'smooth' ? 'fast' : 'smooth');
          });
        }
        break;
      case 'pe-step-nudge':
        if (index != null && el.dataset.key) {
          this.editorDispatch((pe) =>
            nudgeStepField(pe, Number(index), el.dataset.key as StepFieldKey, Number(el.dataset.delta ?? '0'))
          );
        }
        break;
      case 'pe-simple-nudge':
        if (el.dataset.key) {
          this.editorDispatch((pe) =>
            nudgeSimpleProfileField(pe, el.dataset.key as SimpleProfileField, Number(el.dataset.delta ?? '0'))
          );
        }
        break;
      case 'pe-set-mode':
        this.editorDispatch((pe) => setEditorMode(pe, value === 'basic' ? 'basic' : 'advanced'));
        break;
      case 'pe-set-simple-type':
        this.editorDispatch((pe) => setSimpleProfileType(pe, value === 'flow' ? 'flow' : 'pressure'));
        break;
      case 'pe-advanced-tab':
        this.editorDispatch((pe) => setAdvancedTab(pe, value === 'limits' ? 'limits' : 'steps'));
        break;
      case 'pe-step-exit-nudge':
        if (index != null) {
          this.editorDispatch((pe) => {
            const step = pe.steps[Number(index)];
            const type = el.dataset.type === 'flow' ? 'flow' : 'pressure';
            const condition = el.dataset.condition === 'under' ? 'under' : 'over';
            const current = step?.exit?.type === type && step.exit.condition === condition
              ? step.exit.value
              : defaultExitValueForApp(type, condition);
            return setStepExit(pe, Number(index), {
              type,
              condition,
              value: Math.max(0, Number((current + Number(el.dataset.delta ?? '0')).toFixed(1)))
            });
          });
        }
        break;
      case 'pe-step-exit-preset':
        if (index != null) {
          this.editorDispatch((pe) =>
            setStepExit(pe, Number(index), {
              type: el.dataset.type === 'flow' ? 'flow' : 'pressure',
              condition: el.dataset.condition === 'under' ? 'under' : 'over',
              value: Number(el.dataset.value ?? '0') || 0
            })
          );
        }
        break;
      case 'pe-step-exit-clear':
        if (index != null) this.editorDispatch((pe) => setStepExit(pe, Number(index), null));
        break;
      default:
        break;
    }
  }

  private onInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    if (target.dataset.action === 'search') {
      this.setState({ search: target.value });
    }
    if (target.dataset.action === 'settings-search') {
      this.setState({ settingsSearch: target.value });
    }
    if (target.dataset.action === 'profile-search') {
      this.setState({ profileSearch: target.value, profilePage: 0, profileFocusId: null });
    }
    if (target.dataset.action?.startsWith('pe-')) {
      this.applyEditorEvent(target, false);
    }
  }

  private pickProfile(id: string): void {
    const record = this.state.profiles.find((profile) => profile.id === id);
    const draft = { ...this.state.draft };
    if (record) {
      draft.profileId = record.id;
      draft.profile = record.profile;
      draft.profileTitle = record.profile.title ?? null;
      // A new profile carries its own temperatures, so drop any prior offset.
      draft.brewTemp = null;
    }
    this.setState({
      draft: normalizeDraft(draft, this.state.profiles, this.state.grinders),
      view: 'workbench',
      profileSearch: '',
      status: 'Profile selected'
    });
    this.scheduleApply();
  }

  private focusProfile(id: string): void {
    const record = this.state.profiles.find((profile) => profile.id === id);
    const draft = { ...this.state.draft };
    if (record) {
      draft.profileId = record.id;
      draft.profile = record.profile;
      draft.profileTitle = record.profile.title ?? null;
      draft.brewTemp = null;
    }
    this.setState({
      draft: normalizeDraft(draft, this.state.profiles, this.state.grinders),
      profileFocusId: id,
      status: 'Profile selected'
    });
  }

  private goView(view: View): void {
    this.setState({
      view,
      editingBeanId: null,
      profileEditor: null,
      editingProfileId: null,
      profileDialogKey: null
    });
  }

  private editorDispatch(fn: (pe: ProfileEditorState) => ProfileEditorState): void {
    const pe = this.state.profileEditor;
    if (!pe) return;
    this.setState({ profileEditor: fn(pe) });
  }

  private openProfileEditor(id: string): void {
    const record = this.state.profiles.find((profile) => profile.id === id);
    if (!record) return;
    this.setState({
      view: 'profile-editor',
      editingProfileId: id,
      profileEditor: createProfileEditorState(record.profile),
      profileDialogKey: null
    });
  }

  // `commit` is false for `input` events, true for `change`. A range slider
  // fires `input` continuously while dragging; re-rendering on each one replaces
  // the slider element and kills the drag. So for an in-progress range drag we
  // update state silently and patch the on-screen value, then do the single full
  // re-render on `change` (pointer release).
  private applyEditorEvent(
    target: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
    commit = true
  ): boolean {
    const pe = this.state.profileEditor;
    if (!pe) return false;
    const action = target.dataset.action;
    const key = target.dataset.key;
    const index = Number(target.dataset.index ?? '-1');
    let next: ProfileEditorState | null = null;
    if (action === 'pe-meta' && key) {
      next = setProfileMeta(pe, key as ProfileMetaKey, target.value);
    } else if (action === 'pe-simple-field' && key) {
      next = setSimpleProfileField(pe, key as SimpleProfileField, target.value);
    } else if (action === 'pe-step-field' && key && index >= 0) {
      next = setStepField(pe, index, key as StepFieldKey, target.value);
    } else if (action === 'pe-step-exit' && key && index >= 0) {
      next = this.applyExitField(pe, index, key, target);
    } else if (action === 'pe-limiter-range') {
      next = setAllLimiterRanges(pe, Number(target.value) || 0);
    }
    if (next === null) return false;

    const isRangeDrag = !commit && target instanceof HTMLInputElement && target.type === 'range';
    if (isRangeDrag) {
      this.state = { ...this.state, profileEditor: next };
      this.patchLiveValue(target);
      return true;
    }
    this.setState({ profileEditor: next });
    return true;
  }

  // Live-update the value readout beside a slider mid-drag, without a re-render.
  private patchLiveValue(range: HTMLInputElement): void {
    const value = range.closest('.pe-ctl')?.querySelector<HTMLElement>('.pe-ctl-value');
    if (!value) return;
    const unit = value.querySelector('em');
    value.textContent = range.value;
    if (unit) value.appendChild(unit);
  }

  private applyExitField(
    pe: ProfileEditorState,
    index: number,
    key: string,
    target: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  ): ProfileEditorState {
    if (key === 'enabled') {
      return setStepExit(pe, index, (target as HTMLInputElement).checked ? {} : null);
    }
    if (key === 'type') {
      return setStepExit(pe, index, { type: target.value === 'flow' ? 'flow' : 'pressure' });
    }
    if (key === 'condition') {
      return setStepExit(pe, index, { condition: target.value === 'under' ? 'under' : 'over' });
    }
    if (key === 'value') {
      return setStepExit(pe, index, {
        type: target.dataset.type === 'flow' ? 'flow' : target.dataset.type === 'pressure' ? 'pressure' : undefined,
        condition: target.dataset.condition === 'under' ? 'under' : target.dataset.condition === 'over' ? 'over' : undefined,
        value: Number(target.value) || 0
      });
    }
    return pe;
  }

  private validateProfileEditor(pe: ProfileEditorState): string | null {
    if (!pe.title.trim()) return 'Add a preset name before saving';
    if (pe.steps.length === 0) return 'Profile needs at least one step';
    return null;
  }

  private async submitProfileEditor(): Promise<void> {
    const pe = this.state.profileEditor;
    if (!pe) return;
    const problem = this.validateProfileEditor(pe);
    if (problem) {
      this.setState({ status: problem });
      return;
    }
    const profile = profileFromEditorState(pe);
    const editingId = this.state.editingProfileId;
    // reaprime protects bundled defaults — edits to them are saved as a child
    // clone (createProfile with parentId), never an in-place update.
    const editingRecord = editingId ? this.state.profiles.find((item) => item.id === editingId) : undefined;
    const cloneOfDefault = Boolean(editingId) && editingRecord?.isDefault === true;
    const update = Boolean(editingId) && !cloneOfDefault;
    this.setState({ busy: true, status: cloneOfDefault ? 'Saving a copy' : 'Saving profile' });

    if (this.state.demo) {
      const record: ProfileRecord = { id: update ? editingId! : `demo-profile-${Date.now()}`, profile };
      const profiles = update
        ? this.state.profiles.map((item) => (item.id === editingId ? record : item))
        : [record, ...this.state.profiles];
      this.setState({
        profiles,
        view: 'workbench',
        profileEditor: null,
        editingProfileId: null,
        busy: false,
        status: cloneOfDefault ? 'Saved a copy (demo)' : 'Profile saved (demo)'
      });
      this.pickProfile(record.id);
      return;
    }

    try {
      const saved = update
        ? await gateway.updateProfile(editingId!, { profile })
        : await gateway.createProfile({ profile, parentId: editingId ?? undefined });
      void beanieCache.invalidateProfileMutation(saved.id).catch(() => {});
      let profiles = this.state.profiles;
      try {
        profiles = await gateway.profiles();
      } catch {
        profiles = this.state.profiles.some((item) => item.id === saved.id)
          ? this.state.profiles.map((item) => (item.id === saved.id ? saved : item))
          : [saved, ...this.state.profiles];
      }
      this.setState({
        profiles,
        view: 'workbench',
        profileEditor: null,
        editingProfileId: null,
        busy: false,
        status: cloneOfDefault ? 'Saved a copy' : 'Profile saved'
      });
      this.pickProfile(saved.id);
    } catch (error) {
      console.error('[Beanie] Save profile failed', error);
      this.setState({ busy: false, status: 'Save profile failed' });
    }
  }

  private toggleFavoriteProfile(id: string): void {
    const favorites = new Set(this.state.favoriteProfiles);
    if (favorites.has(id)) favorites.delete(id);
    else favorites.add(id);
    const favoriteProfiles = [...favorites];
    writeFavoriteProfiles(favoriteProfiles);
    this.setState({ favoriteProfiles });
  }

  private async onChange(event: Event): Promise<void> {
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    if (target.dataset.action?.startsWith('pe-')) {
      this.applyEditorEvent(target);
      return;
    }
    const field = target.dataset.field;
    if (!field) return;

    if (field === 'autoLoad') {
      const enabled = (target as HTMLInputElement).checked;
      this.updateSettingsPreferences({ autoLoad: enabled });
      return;
    }

    if (field === 'visualizerUpload') {
      const enabled = (target as HTMLInputElement).checked;
      this.updateSettingsPreferences({ visualizerUpload: enabled });
      return;
    }

    if (field === 'batchId') {
      this.setState({ selectedBatchId: (target as HTMLSelectElement).value || null });
      return;
    }

    const draft = { ...this.state.draft };
    if (field === 'dose') draft.dose = parseNumberInput(target.value);
    if (field === 'yield') draft.yield = parseNumberInput(target.value);
    if (field === 'grinderSetting') draft.grinderSetting = target.value || null;
    if (field === 'profileId') {
      const record = this.state.profiles.find((profile) => profile.id === target.value);
      draft.profileId = record?.id ?? null;
      draft.profile = record?.profile ?? null;
      draft.profileTitle = record?.profile.title ?? null;
    }
    if (field === 'grinderId') {
      const grinder = this.state.grinders.find((item) => item.id === target.value);
      draft.grinderId = grinder?.id ?? null;
      draft.grinderModel = grinder?.model ?? null;
    }
    this.setState({ draft, status: 'Draft changed' });
    this.scheduleApply();
  }

  private async onSubmit(event: Event): Promise<void> {
    const form = event.target as HTMLFormElement;
    if (form.dataset.form === 'bean-editor') {
      event.preventDefault();
      await this.submitBeanEditor(form);
      return;
    }
    if (form.dataset.form === 'batch-editor') {
      event.preventDefault();
      await this.submitBatchEditor(form);
      return;
    }
    if (form.dataset.form === 'grinder-editor') {
      event.preventDefault();
      await this.submitGrinderEditor(form);
      return;
    }
    if (form.dataset.form === 'machine-settings') {
      event.preventDefault();
      await this.submitMachineSettings(form);
    }
  }

  private async submitMachineSettings(form: HTMLFormElement): Promise<void> {
    const data = new FormData(form);
    const steamSettings: SteamSettings = {
      ...DEFAULT_STEAM,
      ...this.state.workflow?.steamSettings,
      duration: numberOrNullInput(data.get('steamDuration')) ?? DEFAULT_STEAM.duration,
      targetTemperature: numberOrNullInput(data.get('steamTemp')) ?? DEFAULT_STEAM.targetTemperature
    };
    const hotWaterData: HotWaterData = {
      ...DEFAULT_HOT_WATER,
      ...this.state.workflow?.hotWaterData,
      flow: numberOrNullInput(data.get('waterFlow')) ?? DEFAULT_HOT_WATER.flow,
      duration: numberOrNullInput(data.get('waterDuration')) ?? DEFAULT_HOT_WATER.duration,
      targetTemperature: numberOrNullInput(data.get('waterTemp')) ?? DEFAULT_HOT_WATER.targetTemperature,
      volume: numberOrNullInput(data.get('waterVolume')) ?? DEFAULT_HOT_WATER.volume
    };
    const rinseData: RinseData = {
      ...DEFAULT_RINSE,
      ...this.state.workflow?.rinseData,
      flow: numberOrNullInput(data.get('flushFlow')) ?? DEFAULT_RINSE.flow,
      duration: numberOrNullInput(data.get('flushDuration')) ?? DEFAULT_RINSE.duration
    };
    const workflow: Workflow = {
      ...(this.state.workflow ?? {}),
      steamSettings,
      hotWaterData,
      rinseData
    };

    this.setState({ busy: true, status: 'Saving machine settings' });
    if (this.state.demo) {
      this.setState({ workflow, view: 'workbench', busy: false, status: 'Machine settings saved (demo)' });
      return;
    }
    try {
      const saved = await gateway.updateWorkflow(workflow);
      this.setState({ workflow: saved, view: 'workbench', busy: false, status: 'Machine settings saved' });
    } catch (error) {
      console.error('[Beanie] Save machine settings failed', error);
      this.setState({ busy: false, status: 'Save machine settings failed' });
    }
  }

  private async submitBeanEditor(form: HTMLFormElement): Promise<void> {
    const data = new FormData(form);
    const fields: Partial<Bean> = {
      roaster: String(data.get('roaster') ?? '').trim(),
      name: String(data.get('name') ?? '').trim(),
      country: textOrNull(data.get('country')),
      region: textOrNull(data.get('region')),
      processing: textOrNull(data.get('processing')),
      notes: textOrNull(data.get('notes'))
    };
    if (!fields.roaster || !fields.name) return;

    const editingId = this.state.editingBeanId;
    this.setState({ busy: true, status: editingId ? 'Saving bean' : 'Adding bean' });

    if (this.state.demo) {
      if (editingId) {
        const beans = this.state.beans.map((bean) =>
          bean.id === editingId ? { ...bean, ...fields } : bean
        );
        this.setState({ beans, view: 'workbench', editingBeanId: null, busy: false, status: 'Bean saved (demo)' });
      } else {
        const bean: Bean = { id: `demo-${Date.now()}`, ...fields } as Bean;
        this.setState({
          beans: [bean, ...this.state.beans],
          view: 'workbench',
          editingBeanId: null,
          busy: false,
          status: 'Bean added (demo)'
        });
        await this.selectBean(bean.id, { apply: false, preferWorkflow: false });
      }
      return;
    }

    try {
      if (editingId) {
        const updated = await gateway.updateBean(editingId, fields);
        const beans = this.state.beans.map((bean) => (bean.id === editingId ? updated : bean));
        this.setState({ beans, view: 'workbench', editingBeanId: null, busy: false, status: 'Bean saved' });
      } else {
        const bean = await gateway.createBean(fields);
        this.setState({
          beans: [bean, ...this.state.beans],
          view: 'workbench',
          editingBeanId: null,
          busy: false,
          status: 'Bean added'
        });
        await this.selectBean(bean.id, { apply: false, preferWorkflow: false });
      }
    } catch (error) {
      console.error('[Beanie] Save bean failed', error);
      this.setState({ busy: false, status: 'Save bean failed' });
    }
  }

  private async archiveBean(id: string): Promise<void> {
    if (!window.confirm('Archive this bag? It will be hidden from the bean list.')) return;
    this.setState({ busy: true, status: 'Archiving bag' });
    if (!this.state.demo) {
      try {
        await gateway.updateBean(id, { archived: true });
      } catch (error) {
        console.error('[Beanie] Archive bean failed', error);
        this.setState({ busy: false, status: 'Archive failed' });
        return;
      }
    }
    const beans = this.state.beans.filter((bean) => bean.id !== id);
    this.setState({ beans, view: 'workbench', editingBeanId: null, busy: false, status: 'Bag archived' });
    if (this.state.selectedBeanId === id) {
      const next = beans[0];
      if (next) await this.selectBean(next.id, { apply: false, preferWorkflow: false });
      else this.setState({ selectedBeanId: null });
    }
  }

  private async submitBatchEditor(form: HTMLFormElement): Promise<void> {
    const bean = this.selectedBean();
    if (!bean) return;
    const data = new FormData(form);
    const batchInput: Partial<BeanBatch> = {
      beanId: bean.id,
      roastDate: textOrNull(data.get('roastDate')),
      roastLevel: textOrNull(data.get('roastLevel')),
      weight: numberOrNullInput(data.get('weight')),
      weightRemaining: numberOrNullInput(data.get('weightRemaining')),
      frozen: data.get('frozen') === 'on'
    };

    this.setState({ busy: true, status: 'Adding batch' });
    if (this.state.demo) {
      const batch: BeanBatch = { id: `demo-batch-${Date.now()}`, ...batchInput } as BeanBatch;
      const batches = [batch, ...(this.state.batchesByBean[bean.id] ?? [])];
      this.setState({
        batchesByBean: { ...this.state.batchesByBean, [bean.id]: batches },
        selectedBatchId: batch.id,
        view: 'workbench',
        busy: false,
        status: 'Batch added (demo)'
      });
      return;
    }

    try {
      const batch = await gateway.createBatch(bean.id, batchInput);
      const batches = [batch, ...(this.state.batchesByBean[bean.id] ?? [])];
      this.setState({
        batchesByBean: { ...this.state.batchesByBean, [bean.id]: batches },
        selectedBatchId: batch.id,
        view: 'workbench',
        busy: false,
        status: 'Batch added'
      });
    } catch (error) {
      console.error('[Beanie] Add batch failed', error);
      this.setState({ busy: false, status: 'Add batch failed' });
    }
  }

  private async submitGrinderEditor(form: HTMLFormElement): Promise<void> {
    const data = new FormData(form);
    const model = String(data.get('model') ?? '').trim();
    if (!model) return;
    const grinderInput: Partial<Grinder> = {
      model,
      burrs: textOrNull(data.get('burrs')),
      settingType: String(data.get('settingType') ?? 'numeric'),
      settingSmallStep: numberOrNullInput(data.get('settingSmallStep')),
      settingBigStep: numberOrNullInput(data.get('settingBigStep'))
    };

    this.setState({ busy: true, status: 'Adding grinder' });
    const selectGrinder = (grinder: Grinder, status: string) => {
      this.setState({
        grinders: [grinder, ...this.state.grinders],
        draft: { ...this.state.draft, grinderId: grinder.id, grinderModel: grinder.model },
        view: 'workbench',
        editDialog: null,
        busy: false,
        status
      });
      this.scheduleApply();
    };

    if (this.state.demo) {
      const grinder: Grinder = { id: `demo-grinder-${Date.now()}`, ...grinderInput } as Grinder;
      selectGrinder(grinder, 'Grinder added (demo)');
      return;
    }

    try {
      const grinder = await gateway.createGrinder(grinderInput);
      selectGrinder(grinder, 'Grinder added');
    } catch (error) {
      console.error('[Beanie] Add grinder failed', error);
      this.setState({ busy: false, status: 'Add grinder failed' });
    }
  }

  private adjustField(field: string, delta: number): void {
    const draft = { ...this.state.draft };
    if (field === 'dose') draft.dose = round((draft.dose ?? 0) + delta, 1);
    if (field === 'yield') draft.yield = round((draft.yield ?? 0) + delta, 1);
    if (field === 'grinderSetting') {
      const current = parseNumberInput(draft.grinderSetting ?? '0') ?? 0;
      draft.grinderSetting = round(current + delta, 2).toString();
    }
    if (field === 'ratio') {
      const current = ratioFor(draft.dose, draft.yield) ?? 2;
      const nextYield = yieldForRatio(draft.dose, round(current + delta, 2));
      if (nextYield != null) draft.yield = nextYield;
    }
    if (field === 'temperature') {
      const current = this.brewTempValue() ?? 93;
      draft.brewTemp = round(current + delta, 1);
    }
    this.setState({ draft, status: 'Draft changed' });
    this.scheduleApply();
  }

  private openEditDialog(field: EditField): void {
    const draft = this.state.draft;
    const value =
      field === 'grinderSetting'
        ? draft.grinderSetting ?? ''
        : field === 'dose'
          ? draft.dose?.toString() ?? ''
          : field === 'yield'
            ? draft.yield?.toString() ?? ''
            : field === 'ratio'
              ? ratioFor(draft.dose, draft.yield)?.toFixed(2) ?? ''
              : this.brewTempValue()?.toFixed(1) ?? '';
    const step =
      field === 'dose'
        ? 0.5
        : field === 'yield'
          ? 1
          : field === 'ratio'
            ? 0.1
            : field === 'temperature'
              ? 0.5
              : this.grinderStep();
    const title =
      field === 'grinderSetting' ? 'Grind' : field === 'temperature' ? 'Temp' : capitalize(field);

    this.setState({
      modal: 'edit-number',
      profileDialogKey: null,
      editDialog: createInputDialog({
        field,
        kind: inputDialogKindForField(field),
        title,
        value,
        step,
        bigStep: field === 'grinderSetting' ? this.grinderBigStep() : step * 2,
        choiceTitle: field === 'grinderSetting' ? 'Grinder' : undefined,
        choices: field === 'grinderSetting' ? grinderChoicesFromGrinders(this.state.grinders) : [],
        selectedChoiceId: field === 'grinderSetting' ? this.grinderIdForDraft() : null
      })
    });
  }

  private openProfileNumberDialog(key: SimpleProfileField, el: HTMLElement): void {
    const value = el.dataset.value ?? '0';
    const title = el.dataset.title ?? 'Value';
    const unit = el.dataset.unit ?? '';
    const min = Number(el.dataset.min ?? '0');
    const max = Number(el.dataset.max ?? '100');
    const step = Number(el.dataset.step ?? '1');
    const digits = step < 1 ? 1 : 0;

    this.setState({
      modal: 'edit-number',
      profileDialogKey: key,
      editDialog: createInputDialog({
        field: 'temperature',
        kind: key === 'temperature' ? 'temperature' : 'grind',
        title,
        value,
        unit,
        min,
        max,
        step,
        bigStep: step < 1 ? 1 : Math.max(5, step * 5),
        digits,
        helper: `Input value between ${min} and ${max}`,
        maxLength: 6
      })
    });
  }

  private adjustDialogValue(delta: number): void {
    const dialog = this.state.editDialog;
    if (!dialog) return;
    this.setState({ editDialog: nudgeInputDialogValue(dialog, delta) });
  }

  private typeDialogKey(key: string): void {
    const dialog = this.state.editDialog;
    if (!dialog) return;
    this.setState({ editDialog: typeInputDialogKey(dialog, key) });
  }

  private backspaceDialogValue(): void {
    const dialog = this.state.editDialog;
    if (!dialog) return;
    this.setState({ editDialog: backspaceInputDialogValue(dialog) });
  }

  private clearDialogValue(): void {
    const dialog = this.state.editDialog;
    if (!dialog) return;
    this.setState({ editDialog: clearInputDialogValue(dialog) });
  }

  private setDialogValue(value: string): void {
    const dialog = this.state.editDialog;
    if (!dialog) return;
    this.setState({ editDialog: setInputDialogValue(dialog, value) });
  }

  private selectDialogChoice(choiceId: string | null): void {
    const dialog = this.state.editDialog;
    if (!dialog) return;
    if (this.state.profileDialogKey) {
      this.setState({ editDialog: selectInputDialogChoice(dialog, choiceId) });
      return;
    }

    const draft = { ...this.state.draft };
    if (dialog.field === 'grinderSetting') {
      const grinder = this.state.grinders.find((item) => item.id === choiceId);
      draft.grinderId = grinder?.id ?? null;
      draft.grinderModel = grinder?.model ?? null;
    }

    this.setState({
      draft,
      editDialog: selectInputDialogChoice(dialog, choiceId),
      status: 'Draft changed'
    });
    this.scheduleApply();
  }

  private commitEditDialog(): void {
    const dialog = this.state.editDialog;
    if (!dialog) return;

    const value = inputDialogCommitValue(dialog);
    const profileKey = this.state.profileDialogKey;
    if (profileKey) {
      rememberInputDialogValue(dialog.kind, value);
      this.setState({
        profileEditor: this.state.profileEditor
          ? setSimpleProfileField(this.state.profileEditor, profileKey, value)
          : null,
        modal: null,
        editDialog: null,
        profileDialogKey: null,
        status: 'Profile changed'
      });
      return;
    }

    const draft = { ...this.state.draft };
    if (dialog.field === 'dose') draft.dose = parseNumberInput(value);
    if (dialog.field === 'yield') draft.yield = parseNumberInput(value);
    if (dialog.field === 'grinderSetting') draft.grinderSetting = value || null;
    if (dialog.field === 'ratio') {
      const ratio = parseNumberInput(value);
      const nextYield = ratio == null ? null : yieldForRatio(draft.dose, ratio);
      if (nextYield != null) draft.yield = nextYield;
    }
    if (dialog.field === 'temperature') draft.brewTemp = parseNumberInput(value);
    rememberInputDialogValue(dialog.kind, value);
    this.setState({ draft, modal: null, editDialog: null, status: 'Draft changed' });
    this.scheduleApply();
  }

  private render(): void {
    const bean = this.selectedBean();
    const focus = this.captureFocus();
    const scroll = this.captureScroll();
    const isPage = this.state.view !== 'workbench';
    this.root.innerHTML = `
      <div class="app-shell ${isPage ? 'app-shell-page' : ''}">
        ${isPage ? this.renderPage() : this.renderWorkbench(bean)}
        ${this.renderLivePanel()}
        ${this.renderModal()}
        ${this.renderSleepOverlay()}
      </div>
    `;
    refreshIcons();
    this.bindLiveElements();
    this.bindDetailChart();
    this.restoreFocus(focus);
    this.restoreScroll(scroll);
  }

  // Re-rendering replaces innerHTML, which resets the scroll position of every
  // scrollable container. Capture and restore it synchronously (before paint)
  // so a re-render never visibly jumps the list/page back to the top.
  private captureScroll(): Record<string, number> {
    const map: Record<string, number> = {};
    for (const selector of SCROLL_SELECTORS) {
      const el = this.root.querySelector<HTMLElement>(selector);
      if (el && el.scrollTop > 0) map[selector] = el.scrollTop;
    }
    return map;
  }

  private restoreScroll(map: Record<string, number>): void {
    for (const selector of Object.keys(map)) {
      const el = this.root.querySelector<HTMLElement>(selector);
      if (el) el.scrollTop = map[selector]!;
    }
  }

  private renderWorkbench(bean: Bean | null): string {
    return `
      ${this.renderTopbar()}
      <main class="workbench">
        ${this.renderBeanRail()}
        <section class="surface">
          ${this.renderHero(bean)}
          ${this.renderRecipeEditor()}
          ${this.renderHistory()}
        </section>
      </main>
    `;
  }

  private renderPage(): string {
    switch (this.state.view) {
      case 'settings':
        return this.renderSettingsPage();
      case 'machine':
        return this.renderMachinePage();
      case 'profiles':
        return this.renderProfilesPage();
      case 'profile-editor':
        return this.renderProfileEditorPage();
      case 'bean-editor':
        return this.renderBeanEditorPage();
      case 'batch-editor':
        return this.renderBatchEditorPage();
      case 'grinder-editor':
        return this.renderGrinderEditorPage();
      default:
        return '';
    }
  }

  private pageHeader(title: string, back: View = 'workbench', actions = ''): string {
    return `
      <header class="page-head">
        <button class="page-back" data-action="go-view" data-value="${back}" aria-label="Back" title="Back">
          ${icon('chevron-left')}<span>Back</span>
        </button>
        <h1 class="page-title">${escapeHtml(title)}</h1>
        <div class="page-head-actions">${actions}</div>
      </header>
    `;
  }

  private bindDetailChart(): void {
    const canvas = this.root.querySelector<HTMLCanvasElement>('#detail-canvas');
    if (!canvas) return;
    const shot = this.selectedHistoryShot();
    if (!shot) return;
    const chart = new LiveChart(canvas, { detailed: true });
    chart.setModel(chartModelFromShot(shot));
    // Draw after layout so the canvas has its CSS box for DPR sizing.
    window.requestAnimationFrame(() => {
      chart.resize();
      chart.draw();
    });
  }

  private captureFocus(): { selector: string; start: number | null } | null {
    const active = document.activeElement as HTMLInputElement | null;
    const action = active?.dataset?.action;
    if (!action) return null;
    if (!FOCUSABLE_SEARCH.has(action) && !action.startsWith('pe-')) return null;
    const parts = [`[data-action="${action}"]`];
    if (active?.dataset.index != null) parts.push(`[data-index="${active.dataset.index}"]`);
    if (active?.dataset.key != null) parts.push(`[data-key="${active.dataset.key}"]`);
    // The four exit sliders share action/index/key — disambiguate by type+condition.
    if (active?.dataset.type != null) parts.push(`[data-type="${active.dataset.type}"]`);
    if (active?.dataset.condition != null) parts.push(`[data-condition="${active.dataset.condition}"]`);
    const start = typeof active?.selectionStart === 'number' ? active.selectionStart : null;
    return { selector: parts.join(''), start };
  }

  private restoreFocus(focus: { selector: string; start: number | null } | null): void {
    if (!focus) return;
    const el = this.root.querySelector<HTMLInputElement>(focus.selector);
    if (!el) return;
    el.focus();
    if (focus.start != null) {
      try {
        el.setSelectionRange(focus.start, focus.start);
      } catch {
        /* not a text input */
      }
    }
  }

  private renderSleepOverlay(): string {
    if (!this.state.asleep) return '';
    return `
      <div class="sleep-overlay" data-action="wake" role="button" tabindex="0" aria-label="Tap to wake">
        <span class="sleep-hint">Tap to wake</span>
      </div>
    `;
  }

  private renderLivePanel(): string {
    if (!this.state.liveActive) return '';
    return `
      <div class="live-panel">
        <div class="live-card panel">
          <div class="live-head">
            <span class="eyebrow">Live shot</span>
            <div class="live-readouts">
              ${liveReadout('Time', 'live-time', '0.0s')}
              ${liveReadout('Weight', 'live-weight', '--', 'g')}
              ${liveReadout('Pressure', 'live-pressure', '--', 'bar')}
              ${liveReadout('Flow', 'live-flow', '--', 'ml/s')}
              ${liveReadout('Temp', 'live-temp', '--', 'C')}
            </div>
          </div>
          <div class="live-canvas-wrap">
            <canvas id="live-canvas" class="live-canvas"></canvas>
          </div>
        </div>
      </div>
    `;
  }

  private renderTopbar(): string {
    const ready = this.state.machine?.state?.state ?? (this.state.loading ? 'loading' : 'idle');
    const machine = this.state.machine;
    const scale = this.state.scale;
    return `
      <header class="topbar">
        <div class="top-inline">
          <div class="top-stats" aria-label="Machine metrics">
            ${topStat('Machine', capitalize(ready), 'stat-machine')}
            ${topStat('Group', temp(machine?.groupTemperature), 'stat-group')}
            ${topStat('Steam', temp(machine?.steamTemperature), 'stat-steam')}
            ${topStat('Scale', scale?.status === 'disconnected' ? 'offline' : `${formatNumber(scale?.weight, 1)} g`, 'stat-scale')}
          </div>
          <div class="top-icons" role="toolbar" aria-label="Skin actions">
            ${this.state.demo ? `<button class="icon-tool" data-action="simulate-shot" aria-label="Simulate shot" title="Simulate shot">${icon('play')}</button>` : ''}
            <button class="icon-tool" data-action="open-machine-settings" aria-label="Steam, water and flush" title="Steam, water and flush">${icon('droplets')}</button>
            <button class="icon-tool" data-action="open-settings" aria-label="Settings" title="Settings">${icon('settings')}</button>
            <button class="icon-tool" data-action="sleep" aria-label="Sleep" title="Sleep">${icon('power')}</button>
          </div>
        </div>
      </header>
    `;
  }

  private renderBeanRail(): string {
    const query = this.state.search.trim().toLowerCase();
    const beans = this.state.beans.filter((bean) => beanLabel(bean).toLowerCase().includes(query));
    return `
      <aside class="bean-rail panel">
        <div class="rail-head">
          <div>
            <span class="eyebrow">Beans</span>
            <h2>Pick a bag</h2>
          </div>
          <div class="rail-actions">
            <button class="icon-button" data-action="refresh" aria-label="Sync beans" title="Sync beans">${icon('refresh-cw')}</button>
            <button class="icon-button" data-action="open-add-bean" aria-label="Add bean" title="Add bean">${icon('plus')}</button>
          </div>
        </div>
        <label class="search">
          ${icon('search')}
          <input type="search" data-action="search" value="${escapeAttr(this.state.search)}" placeholder="Search beans" />
        </label>
        <div class="bean-list">
          ${beans.map((bean) => this.renderBeanButton(bean)).join('')}
        </div>
      </aside>
    `;
  }

  private renderBeanButton(bean: Bean): string {
    const active = bean.id === this.state.selectedBeanId;
    return `
      <button class="bean-row ${active ? 'active' : ''}" data-action="select-bean" data-id="${escapeAttr(bean.id)}">
        <small>${escapeHtml(bean.country ?? 'Recent bean')}</small>
        <b>${escapeHtml(bean.roaster)}</b>
        <strong>${escapeHtml(bean.name)}</strong>
      </button>
    `;
  }

  private renderHero(bean: Bean | null): string {
    const draft = this.state.draft;
    return `
      <section class="hero panel">
        <div class="hero-main">
          <div class="hero-title-row">
            <h1>${bean ? escapeHtml(beanLabel(bean)) : 'No bean selected'}</h1>
            ${
              bean
                ? `<div class="hero-bean-actions">
                    <button class="icon-button" data-action="open-edit-bean" data-id="${escapeAttr(bean.id)}" aria-label="Edit bean" title="Edit bean">${icon('pencil')}</button>
                    <button class="icon-button" data-action="archive-bean" data-id="${escapeAttr(bean.id)}" aria-label="Archive bag" title="Archive bag">${icon('archive')}</button>
                  </div>`
                : ''
            }
          </div>
        </div>
        <div class="hero-side">
          <button type="button" class="hero-profile-button" data-action="open-profile-picker">
            <span class="eyebrow">Profile</span>
            <strong>${escapeHtml(draft.profileTitle ?? 'No profile')}</strong>
            ${icon('sliders-horizontal')}
          </button>
          <div class="hero-context">
            ${this.renderBatchControl(bean)}
          </div>
        </div>
      </section>
    `;
  }

  private renderRecipeEditor(): string {
    const draft = this.state.draft;
    return `
      <section class="recipe-grid">
        ${this.controlNumber('Dose', 'dose', draft.dose, 0.5)}
        ${this.controlNumber('Yield', 'yield', draft.yield, 1)}
        ${this.controlRatio()}
        ${this.controlGrind()}
        ${this.controlTemp()}
      </section>
    `;
  }

  private controlNumber(label: string, field: EditField, value: number | null | undefined, step: number): string {
    return `
      <div class="control panel">
        <label>${escapeHtml(label)}</label>
        <div class="stepper compact-stepper">
          <button data-action="adjust" data-field="${field}" data-delta="${-step}" aria-label="Decrease ${escapeAttr(label)}">${icon('minus')}</button>
          <button class="value-button" data-action="edit-field" data-field="${field}">${escapeHtml(value == null ? '--' : value.toString())}</button>
          <button data-action="adjust" data-field="${field}" data-delta="${step}" aria-label="Increase ${escapeAttr(label)}">${icon('plus')}</button>
        </div>
      </div>
    `;
  }

  private controlGrind(): string {
    const draft = this.state.draft;
    const step = this.grinderStep();
    return `
      <div class="control grind-control panel">
        <label>Grind</label>
        <div class="stepper compact-stepper">
          <button data-action="adjust" data-field="grinderSetting" data-delta="${-step}" aria-label="Decrease grind">${icon('minus')}</button>
          <button class="value-button" data-action="edit-field" data-field="grinderSetting">${escapeHtml(draft.grinderSetting ?? '--')}</button>
          <button data-action="adjust" data-field="grinderSetting" data-delta="${step}" aria-label="Increase grind">${icon('plus')}</button>
        </div>
      </div>
    `;
  }

  private renderProfilesPage(): string {
    const query = this.state.profileSearch.trim().toLowerCase();
    const favorites = new Set(this.state.favoriteProfiles);
    const selectedId = this.profileIdForDraft();
    const matches = this.state.profiles.filter((record) => {
      const title = (record.profile.title ?? '').toLowerCase();
      const author = (record.profile.author ?? '').toLowerCase();
      return !query || title.includes(query) || author.includes(query);
    });
    const sorted = [...matches].sort((a, b) => {
      const fa = favorites.has(a.id) ? 0 : 1;
      const fb = favorites.has(b.id) ? 0 : 1;
      if (fa !== fb) return fa - fb;
      return (a.profile.title ?? '').localeCompare(b.profile.title ?? '');
    });
    const focus =
      sorted.find((record) => record.id === this.state.profileFocusId) ??
      sorted.find((record) => record.id === selectedId) ??
      sorted[0] ??
      null;
    const actions = `<button class="icon-button" data-action="new-profile" aria-label="New profile" title="New profile">${icon('plus')}</button>`;

    return `
      ${this.pageHeader('Profiles', 'workbench', actions)}
      <main class="page-body profiles-page de1-profiles-page">
        <label class="search">
          ${icon('search')}
          <input type="search" data-action="profile-search" value="${escapeAttr(this.state.profileSearch)}" placeholder="Search profiles" />
        </label>
        <section class="profile-selector-shell">
          <div class="profile-list de1-profile-list">
            ${
              sorted.length === 0
                ? '<p class="empty">No profiles match.</p>'
                : this.renderProfileRows(sorted, favorites, selectedId, focus?.id ?? null)
            }
          </div>
          ${this.renderProfilePreviewPane(focus, favorites.has(focus?.id ?? ''), focus?.id === selectedId)}
        </section>
      </main>
    `;
  }

  private renderProfileRows(
    records: ProfileRecord[],
    favorites: Set<string>,
    selectedId: string | null,
    focusId: string | null
  ): string {
    let lastGroup = '';
    return records.map((record) => {
      const title = record.profile.title ?? record.id;
      const group = profileGroup(title, record.profile.author);
      const header = group !== lastGroup ? `<div class="profile-group-header">${escapeHtml(group)}</div>` : '';
      lastGroup = group;
      return `${header}${this.renderProfileRow(record, favorites.has(record.id), record.id === selectedId, record.id === focusId)}`;
    }).join('');
  }

  private renderProfileRow(record: ProfileRecord, favorite: boolean, active: boolean, focused = false): string {
    const title = record.profile.title ?? record.id;
    const shortTitle = profileShortTitle(title);
    const author = record.profile.author ?? '';
    return `
      <div class="profile-row ${active ? 'active' : ''} ${focused ? 'focused' : ''}">
        <button type="button" class="profile-pick" data-action="focus-profile" data-id="${escapeAttr(record.id)}">
          <span class="profile-row-title">${favorite ? '★ ' : ''}${escapeHtml(shortTitle)}</span>
          ${author ? `<span class="profile-row-author">${escapeHtml(author)}</span>` : ''}
        </button>
        ${active ? '<span class="profile-selected-dot">Selected</span>' : ''}
      </div>
    `;
  }

  private renderProfilePreviewPane(record: ProfileRecord | null, favorite: boolean, active: boolean): string {
    if (!record) {
      return `
        <aside class="profile-preview-pane">
          <p class="empty">No profile selected.</p>
        </aside>
      `;
    }
    const title = record.profile.title ?? record.id;
    const author = record.profile.author ?? '';
    const steps = Array.isArray(record.profile.steps) ? record.profile.steps.length : 0;
    const type = record.profile.type ?? record.profile.legacy_profile_type ?? 'profile';
    const target = [
      record.profile.target_weight != null ? `${formatProfileNumber(record.profile.target_weight)}g` : null,
      record.profile.target_volume != null ? `${formatProfileNumber(record.profile.target_volume)}ml` : null
    ].filter(Boolean).join(' / ');
    return `
      <aside class="profile-preview-pane">
        <div class="profile-preview-head">
          <div>
            <span class="eyebrow">${escapeHtml(author || 'Profile')}</span>
            <h2>${escapeHtml(title)}</h2>
          </div>
          <button type="button" class="profile-fav ${favorite ? 'on' : ''}" data-action="toggle-favorite-profile" data-id="${escapeAttr(record.id)}" aria-label="${favorite ? 'Unfavorite' : 'Favorite'} ${escapeAttr(title)}" aria-pressed="${favorite}">${favorite ? '★' : '☆'}</button>
        </div>
        <section class="profile-preview-block">
          <span class="eyebrow">Preview</span>
          <div class="profile-preview-large">
            ${renderProfilePreview(record.profile)}
          </div>
        </section>
        <dl class="profile-preview-facts">
          <div><dt>Type</dt><dd>${escapeHtml(displayProfileType(type))}</dd></div>
          <div><dt>Steps</dt><dd>${steps}</dd></div>
          <div><dt>Target</dt><dd>${escapeHtml(target || '--')}</dd></div>
        </dl>
        <section class="profile-description-block">
          <span class="eyebrow">Description</span>
          <p class="profile-preview-notes">${escapeHtml(record.profile.notes || 'No description.')}</p>
        </section>
        <div class="profile-preview-actions">
          <button type="button" class="command primary" data-action="pick-profile" data-id="${escapeAttr(record.id)}">${active ? 'Selected' : 'Select'}</button>
          <button type="button" class="command" data-action="edit-profile" data-id="${escapeAttr(record.id)}">${icon('pencil')}<span>Edit</span></button>
        </div>
      </aside>
    `;
  }

  private controlRatio(): string {
    const draft = this.state.draft;
    const ratio = ratioFor(draft.dose, draft.yield);
    return `
      <div class="control panel">
        <label>Ratio</label>
        <div class="stepper compact-stepper">
          <button data-action="adjust" data-field="ratio" data-delta="-0.1" aria-label="Decrease ratio">${icon('minus')}</button>
          <button class="value-button" data-action="edit-field" data-field="ratio">${escapeHtml(formatRatio(ratio))}</button>
          <button data-action="adjust" data-field="ratio" data-delta="0.1" aria-label="Increase ratio">${icon('plus')}</button>
        </div>
      </div>
    `;
  }

  private controlTemp(): string {
    const value = this.brewTempValue();
    const label = value == null ? '--' : `${value.toFixed(1)}`;
    return `
      <div class="control panel">
        <label>Temp</label>
        <div class="stepper compact-stepper">
          <button data-action="adjust" data-field="temperature" data-delta="-0.5" aria-label="Decrease temperature">${icon('minus')}</button>
          <button class="value-button" data-action="edit-field" data-field="temperature">${escapeHtml(label)}</button>
          <button data-action="adjust" data-field="temperature" data-delta="0.5" aria-label="Increase temperature">${icon('plus')}</button>
        </div>
      </div>
    `;
  }

  private brewTempValue(): number | null {
    const draft = this.state.draft;
    if (draft.brewTemp != null) return draft.brewTemp;
    return profileBaseTemperature(draft.profile ?? null);
  }

  private renderHistory(): string {
    const shots = this.state.shots;
    const selected = this.selectedHistoryShot();
    return `
      <section class="history-panel panel">
        <div class="history-split">
          <div class="shot-list">
            ${
              shots.length === 0
                ? '<p class="empty-history">No shots found for this bean.</p>'
                : shots.map((shot) => this.renderShotListItem(shot, shot.id === selected?.id)).join('')
            }
            ${this.renderLoadMore()}
          </div>
          <div class="shot-detail-pane">
            ${selected ? this.renderShotDetailPane(selected) : '<p class="empty-history">Select a shot to inspect.</p>'}
          </div>
        </div>
      </section>
    `;
  }

  private selectedHistoryShot(): ShotRecord | null {
    const shots = this.state.shots;
    return shots.find((shot) => shot.id === this.state.detailShotId) ?? shots[0] ?? null;
  }

  private renderShotListItem(shot: ShotRecord, active: boolean): string {
    const recipe = recipeFromShot(shot);
    const date = new Date(shot.timestamp);
    const time = Number.isNaN(date.valueOf())
      ? shot.timestamp
      : date.toLocaleString([], {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        });
    const duration = shotDurationLabel(shot);
    return `
      <button class="shot-item ${active ? 'active' : ''}" data-action="select-history-shot" data-id="${escapeAttr(shot.id)}">
        <span class="shot-item-info">
          <span class="shot-item-time">${escapeHtml(time)}</span>
          <span class="shot-item-recipe">${formatGrams(recipe.dose)} → ${formatGrams(recipe.yield)}</span>
          <span class="shot-item-dur">${duration ? escapeHtml(duration) : ''}</span>
          ${enjoymentBadge(shot)}
        </span>
        <span class="shot-item-profile">${escapeHtml(recipe.profileTitle ?? 'No profile')}</span>
      </button>
    `;
  }

  private renderShotDetailPane(shot: ShotRecord): string {
    const recipe = recipeFromShot(shot);
    const date = new Date(shot.timestamp);
    const notes = shot.annotations?.espressoNotes ?? shot.shotNotes ?? '';
    const title = Number.isNaN(date.valueOf())
      ? shot.timestamp
      : date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const duration = shotDurationLabel(shot);
    return `
      <div class="pane-head">
        <span class="pane-time">${escapeHtml(title)}</span>
        <span class="pane-stat">${formatGrams(recipe.dose)} → ${formatGrams(recipe.yield)}</span>
        <span class="pane-stat">grind ${escapeHtml(recipe.grinderSetting ?? '--')}</span>
        <span class="pane-stat">${duration ? escapeHtml(duration) : ''}</span>
        <span class="pane-profile">${escapeHtml(recipe.profileTitle ?? 'No profile')}</span>
        ${enjoymentBadge(shot, 'detail')}
      </div>
      <div class="detail-chart">
        <canvas id="detail-canvas" class="live-canvas detail-canvas"></canvas>
      </div>
      <section class="detail-notes-panel" aria-label="Tasting notes">
        <span class="eyebrow">Tasting notes</span>
        <p>${escapeHtml(notes || 'No tasting notes')}</p>
      </section>
    `;
  }

  private renderLoadMore(): string {
    if (this.state.demo || this.state.shots.length >= this.state.shotsTotal) return '';
    const remaining = this.state.shotsTotal - this.state.shots.length;
    return `
      <button class="command load-more" data-action="load-more-shots" ${this.state.shotsLoadingMore ? 'disabled' : ''}>
        ${this.state.shotsLoadingMore ? 'Loading…' : `Load ${remaining} more`}
      </button>
    `;
  }


  private renderModal(): string {
    if (this.state.modal === 'edit-number') return this.renderEditDialog();
    return '';
  }

  private renderSettingsPage(): string {
    return `
      ${this.pageHeader('Settings', 'workbench', `<button class="icon-button" data-action="refresh" aria-label="Sync" title="Sync">${icon('refresh-cw')}</button>`)}
      ${renderSettingsShell(this.settingsShellModel(), this.state.settingsSection)}
    `;
  }

  private renderProfileEditorPage(): string {
    const pe = this.state.profileEditor;
    if (!pe) return this.pageHeader('Profile');
    // One compact header row — Back · Basic/Advanced toggle · Save — no title
    // (tablet real estate). Basic and advanced share the same dark chrome.
    return `
      <header class="page-head pe-editor-head">
        <button class="page-back" type="button" data-action="go-view" data-value="profiles" aria-label="Back">${icon('chevron-left')}<span>Back</span></button>
        ${renderEditorModeBar(pe)}
        <div class="page-head-actions">
          <button type="button" class="pe-save" data-action="save-profile">${icon('save')}<span>Save</span></button>
        </div>
      </header>
      <main class="page-body profile-editor-page">
        ${renderProfileEditor(pe)}
      </main>
    `;
  }

  private renderMachinePage(): string {
    const steam = { ...DEFAULT_STEAM, ...this.state.workflow?.steamSettings };
    const water = { ...DEFAULT_HOT_WATER, ...this.state.workflow?.hotWaterData };
    const flush = { ...DEFAULT_RINSE, ...this.state.workflow?.rinseData };
    const num = (value?: number) => (value == null ? '' : String(value));
    const actions = `<button class="command primary" type="submit" form="machine-form">${icon('save')}<span>Save</span></button>`;
    return `
      ${this.pageHeader('Steam · Water · Flush', 'workbench', actions)}
      <form id="machine-form" class="page-body machine-page" data-form="machine-settings">
        <fieldset class="machine-group">
          <legend>Steam</legend>
          <div class="field-row">
            <label>Time (s)<input type="number" name="steamDuration" min="0" step="1" value="${num(steam.duration)}" /></label>
            <label>Temp (C)<input type="number" name="steamTemp" min="0" step="1" value="${num(steam.targetTemperature)}" /></label>
          </div>
        </fieldset>
        <fieldset class="machine-group">
          <legend>Hot water</legend>
          <div class="field-row">
            <label>Flow (ml/s)<input type="number" name="waterFlow" min="0" step="0.1" value="${num(water.flow)}" /></label>
            <label>Duration (s)<input type="number" name="waterDuration" min="0" step="1" value="${num(water.duration)}" /></label>
          </div>
          <div class="field-row">
            <label>Temp (C)<input type="number" name="waterTemp" min="0" step="1" value="${num(water.targetTemperature)}" /></label>
            <label>Volume (ml)<input type="number" name="waterVolume" min="0" step="1" value="${num(water.volume)}" /></label>
          </div>
        </fieldset>
        <fieldset class="machine-group">
          <legend>Flush</legend>
          <div class="field-row">
            <label>Flow (ml/s)<input type="number" name="flushFlow" min="0" step="0.1" value="${num(flush.flow)}" /></label>
            <label>Duration (s)<input type="number" name="flushDuration" min="0" step="1" value="${num(flush.duration)}" /></label>
          </div>
        </fieldset>
      </form>
    `;
  }

  private renderBeanEditorPage(): string {
    const editing = this.state.editingBeanId
      ? this.state.beans.find((bean) => bean.id === this.state.editingBeanId) ?? null
      : null;
    const v = (value: string | null | undefined) => escapeAttr(value ?? '');
    const actions = `
      ${editing ? `<button type="button" class="command danger" data-action="archive-bean" data-id="${escapeAttr(editing.id)}">${icon('archive')}<span>Archive</span></button>` : ''}
      <button class="command primary" type="submit" form="bean-form">${icon('save')}<span>${editing ? 'Save' : 'Add'}</span></button>
    `;
    return `
      ${this.pageHeader(editing ? 'Edit Bean' : 'Add Bean', 'workbench', actions)}
      <form id="bean-form" class="page-body form-page" data-form="bean-editor">
        <label>Roaster<input name="roaster" required autocomplete="off" value="${v(editing?.roaster)}" /></label>
        <label>Coffee<input name="name" required autocomplete="off" value="${v(editing?.name)}" /></label>
        <div class="field-row">
          <label>Country<input name="country" autocomplete="off" value="${v(editing?.country)}" /></label>
          <label>Region<input name="region" autocomplete="off" value="${v(editing?.region)}" /></label>
        </div>
        <label>Process<input name="processing" autocomplete="off" value="${v(editing?.processing)}" /></label>
        <label>Notes<textarea name="notes" rows="3">${escapeHtml(editing?.notes ?? '')}</textarea></label>
      </form>
    `;
  }

  private renderBatchEditorPage(): string {
    const bean = this.selectedBean();
    const actions = `<button class="command primary" type="submit" form="batch-form" ${bean ? '' : 'disabled'}>${icon('save')}<span>Add batch</span></button>`;
    return `
      ${this.pageHeader('Add Batch', 'workbench', actions)}
      <form id="batch-form" class="page-body form-page" data-form="batch-editor">
        <p class="modal-hint">${escapeHtml(bean ? beanLabel(bean) : 'No bean selected')}</p>
        <div class="field-row">
          <label>Roast date<input type="date" name="roastDate" /></label>
          <label>Roast level<input name="roastLevel" autocomplete="off" /></label>
        </div>
        <div class="field-row">
          <label>Bag weight (g)<input type="number" name="weight" min="0" step="1" /></label>
          <label>Remaining (g)<input type="number" name="weightRemaining" min="0" step="1" /></label>
        </div>
        <label class="switch inline-switch"><input type="checkbox" name="frozen" /><span>Frozen</span></label>
      </form>
    `;
  }

  private renderGrinderEditorPage(): string {
    const actions = `<button class="command primary" type="submit" form="grinder-form">${icon('save')}<span>Add grinder</span></button>`;
    return `
      ${this.pageHeader('Add Grinder', 'workbench', actions)}
      <form id="grinder-form" class="page-body form-page" data-form="grinder-editor">
        <label>Model<input name="model" required autocomplete="off" /></label>
        <label>Burrs<input name="burrs" autocomplete="off" /></label>
        <label>Setting type
          <select name="settingType">
            <option value="numeric">Numeric</option>
            <option value="preset">Preset</option>
          </select>
        </label>
        <div class="field-row">
          <label>Small step<input type="number" name="settingSmallStep" min="0" step="0.01" value="0.1" /></label>
          <label>Big step<input type="number" name="settingBigStep" min="0" step="0.1" value="1" /></label>
        </div>
      </form>
    `;
  }

  private renderBatchControl(bean: Bean | null): string {
    if (!bean) return '';
    const batches = this.state.batchesByBean[bean.id] ?? [];
    const selectedId = this.selectedBatch()?.id ?? '';
    return `
      <div class="batch-control">
        <select data-field="batchId" aria-label="Batch">
          <option value="">No batch</option>
          ${batches
            .map(
              (batch) =>
                `<option value="${escapeAttr(batch.id)}" ${batch.id === selectedId ? 'selected' : ''}>${escapeHtml(batchOptionLabel(batch))}</option>`
            )
            .join('')}
        </select>
        <button class="icon-button" data-action="open-add-batch" aria-label="Add batch" title="Add batch">${icon('plus')}</button>
      </div>
    `;
  }

  private renderEditDialog(): string {
    const dialog = this.state.editDialog;
    if (!dialog) return '';
    return renderInputDialog(dialog);
  }

  private settingsShellModel() {
    return buildSettingsShellModel({
      query: this.state.settingsSearch,
      preferences: { ...this.state.settingsPreferences, autoLoad: this.state.autoLoad },
      demo: this.state.demo,
      loading: this.state.loading,
      status: this.state.status,
      gatewayHost: gatewayHttpOrigin() || location.origin,
      machine: this.state.machine,
      scale: this.state.scale
    });
  }

  private selectedBean(): Bean | null {
    return this.state.beans.find((bean) => bean.id === this.state.selectedBeanId) ?? null;
  }

  private selectedBatch(): BeanBatch | null {
    const bean = this.selectedBean();
    if (!bean) return null;
    const batches = this.state.batchesByBean[bean.id] ?? [];
    return batches.find((batch) => batch.id === this.state.selectedBatchId) ?? latestBatch(batches);
  }

  private workflowMatchesBean(bean: Bean): boolean {
    const ctx = this.state.workflow?.context;
    return ctx?.coffeeName === bean.name && ctx?.coffeeRoaster === bean.roaster;
  }

  private profileIdForDraft(): string {
    const draft = this.state.draft;
    return (
      draft.profileId ??
      this.state.profiles.find((record) => record.profile.title === draft.profileTitle)?.id ??
      ''
    );
  }

  private grinderIdForDraft(): string {
    const draft = this.state.draft;
    return (
      draft.grinderId ??
      this.state.grinders.find((grinder) => grinder.model === draft.grinderModel)?.id ??
      ''
    );
  }

  private grinderStep(): number {
    const grinder = this.state.grinders.find((item) => item.id === this.grinderIdForDraft());
    return grinder?.settingSmallStep ?? 0.1;
  }

  private grinderBigStep(): number {
    const grinder = this.state.grinders.find((item) => item.id === this.grinderIdForDraft());
    return grinder?.settingBigStep ?? 1;
  }

  private updateSettingsPreferences(next: Partial<SettingsPreferences>): void {
    const settingsPreferences = { ...this.state.settingsPreferences, ...next };
    writeSettingsPreferences(settingsPreferences);
    applySettingsPreferences(settingsPreferences);
    this.setState({
      settingsPreferences,
      autoLoad: settingsPreferences.autoLoad,
      status: 'Settings changed'
    });
  }

  private async resetLocalCache(): Promise<void> {
    const cleared = resetBeanieCache();
    await beanieCache.clear();
    this.setState({
      status: cleared === 0 ? 'Cache reset' : `Reset ${cleared} local item${cleared === 1 ? '' : 's'}`
    });
  }

  private setState(next: Partial<AppState>): void {
    this.state = { ...this.state, ...next };
    this.render();
  }

}

function topStat(label: string, value: string, id?: string): string {
  const idAttr = id ? ` id="${id}"` : '';
  return `<div class="top-stat"><label>${escapeHtml(label)}</label><strong${idAttr}>${escapeHtml(value)}</strong></div>`;
}

function liveReadout(label: string, id: string, value: string, unit = ''): string {
  const suffix = unit ? `<em>${escapeHtml(unit)}</em>` : '';
  return `<div class="live-readout"><label>${escapeHtml(label)}</label><strong id="${id}">${escapeHtml(value)}</strong>${suffix}</div>`;
}


function shotDurationLabel(shot: ShotRecord): string | null {
  const all = shot.measurements;
  if (!Array.isArray(all) || all.length < 2) return null;
  // Mirror the chart's window: prefer the espresso pour (preinfusion/pouring)
  // span when substates are present, else the full measurement span.
  const pour = all.filter((m) => {
    const sub = (m.machine as { state?: { substate?: string } } | undefined)?.state?.substate;
    return sub === 'preinfusion' || sub === 'pouring';
  });
  const series = pour.length > 1 ? pour : all;
  const first = Date.parse(series[0]!.machine.timestamp);
  const last = Date.parse(series[series.length - 1]!.machine.timestamp);
  if (!Number.isFinite(first) || !Number.isFinite(last) || last <= first) return null;
  return `${Math.round((last - first) / 1000)}s`;
}

function enjoymentBadge(shot: ShotRecord, size: 'row' | 'detail' = 'row'): string {
  const value = shot.annotations?.enjoyment;
  if (value == null) return '';
  const formatted = Number.isInteger(value) ? value.toString() : value.toFixed(1);
  return `<span class="enjoyment-badge ${size === 'detail' ? 'large' : ''}" aria-label="Enjoyment ${escapeAttr(formatted)}"><span>Enjoy</span><strong>${escapeHtml(formatted)}</strong></span>`;
}

function batchOptionLabel(batch: BeanBatch): string {
  const roast = batch.roastDate ? new Date(batch.roastDate) : null;
  const roastText =
    roast && !Number.isNaN(roast.valueOf())
      ? roast.toLocaleDateString([], { month: 'short', day: 'numeric' })
      : 'Batch';
  const remaining = batch.weightRemaining != null ? ` · ${formatGrams(batch.weightRemaining)}` : '';
  return `${roastText}${remaining}`;
}

function profileGroup(title: string, author?: string): string {
  const slash = title.indexOf('/');
  if (slash > 0) return title.slice(0, slash).trim();
  return author?.trim() || 'Profiles';
}

function profileShortTitle(title: string): string {
  const slash = title.indexOf('/');
  return slash > 0 ? title.slice(slash + 1).trim() : title;
}

function displayProfileType(value: string): string {
  const legacy =
    value === 'settings_2a'
      ? 'pressure'
      : value === 'settings_2b'
        ? 'flow'
        : value === 'settings_2c' || value === 'settings_2c2'
          ? 'advanced'
          : value;
  return legacy.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatProfileNumber(value: number): string {
  return Number.isInteger(value) ? value.toString() : value.toFixed(1);
}

function textOrNull(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? '').trim();
  return text ? text : null;
}

function numberOrNullInput(value: FormDataEntryValue | null): number | null {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function temp(value: number | null | undefined): string {
  return value == null ? '--' : `${value.toFixed(1)} C`;
}

function formatNumber(value: number | null | undefined, digits: number): string {
  return value == null || Number.isNaN(value) ? '--' : value.toFixed(digits);
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function isEditField(value: string | undefined): value is EditField {
  return (
    value === 'dose' ||
    value === 'yield' ||
    value === 'ratio' ||
    value === 'grinderSetting' ||
    value === 'temperature'
  );
}

function draftSignature(draft: RecipeDraft): string {
  return signatureOf(
    draft.profileTitle ?? null,
    draft.dose ?? null,
    draft.yield ?? null,
    draft.grinderModel ?? null,
    draft.grinderSetting ?? null
  );
}

function workflowSignature(workflow: Workflow | null): string {
  const ctx = workflow?.context;
  return signatureOf(
    workflow?.profile?.title ?? null,
    typeof ctx?.targetDoseWeight === 'number' ? ctx.targetDoseWeight : null,
    typeof ctx?.targetYield === 'number' ? ctx.targetYield : null,
    ctx?.grinderModel ?? null,
    ctx?.grinderSetting != null ? String(ctx.grinderSetting) : null
  );
}

function signatureOf(
  profileTitle: string | null,
  dose: number | null,
  yieldValue: number | null,
  grinderModel: string | null,
  grind: string | null
): string {
  return JSON.stringify([profileTitle, dose, yieldValue, grinderModel, grind]);
}

function isThemePreference(value: string | undefined): value is ThemePreference {
  return value === 'system' || value === 'dark' || value === 'light';
}

function isUIScalePreference(value: string | undefined): value is UIScalePreference {
  return value === 'compact' || value === 'standard' || value === 'large';
}

function defaultExitValueForApp(type: 'pressure' | 'flow', condition: 'over' | 'under'): number {
  if (type === 'pressure') return condition === 'over' ? 11 : 0;
  return condition === 'over' ? 6 : 0;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}
