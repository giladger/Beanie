import type {
  Bean,
  BeanBatch,
  BeanPreset,
  Grinder,
  MachineSnapshot,
  MachineState,
  ProfileRecord,
  RecipeDraft,
  ScaleSnapshot,
  ShotRecord,
  ShotSummary,
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
  presetName,
  profileBaseTemperature,
  ratioFor,
  recipeFromShot,
  recipeFromWorkflow,
  selectInitialBean,
  shotFilterForBean,
  yieldForRatio
} from './domain/beanWorkflow';
import { readLastBeanId, readPresets, writeLastBeanId, writePresets } from './domain/storage';
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
import { renderShotGraph } from './components/ShotGraph';
import { LiveChart } from './components/LiveChart';
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

type Modal =
  | 'bean-editor'
  | 'batch-editor'
  | 'grinder-editor'
  | 'settings'
  | 'edit-number'
  | 'shot-detail'
  | null;
type EditField = 'dose' | 'yield' | 'ratio' | 'grinderSetting' | 'temperature';
type ApplyState = 'idle' | 'pending' | 'applied' | 'failed' | 'stale';

const initialSettingsPreferences = readSettingsPreferences();

interface AppState {
  beans: Bean[];
  batchesByBean: Record<string, BeanBatch[]>;
  grinders: Grinder[];
  profiles: ProfileRecord[];
  workflow: Workflow | null;
  selectedBeanId: string | null;
  selectedBatchId: string | null;
  shots: ShotRecord[];
  draft: RecipeDraft;
  presets: BeanPreset[];
  search: string;
  autoLoad: boolean;
  settingsPreferences: SettingsPreferences;
  settingsSearch: string;
  demo: boolean;
  loading: boolean;
  busy: boolean;
  status: string;
  modal: Modal;
  editingBeanId: string | null;
  editDialog: InputDialogState | null;
  detailShotId: string | null;
  machine: MachineSnapshot | null;
  scale: ScaleSnapshot | null;
  liveActive: boolean;
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
    draft: emptyRecipe(),
    presets: [],
    search: '',
    autoLoad: initialSettingsPreferences.autoLoad,
    settingsPreferences: initialSettingsPreferences,
    settingsSearch: '',
    demo: false,
    loading: true,
    busy: false,
    status: 'Starting',
    modal: null,
    editingBeanId: null,
    editDialog: null,
    detailShotId: null,
    machine: null,
    scale: null,
    liveActive: false,
    applyState: 'idle',
    appliedSignature: null
  };

  private renderTimer: number | null = null;
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

  constructor(private readonly root: HTMLElement) {}

  start(): void {
    applySettingsPreferences(this.state.settingsPreferences);
    this.root.addEventListener('click', (event) => void this.onClick(event));
    this.root.addEventListener('input', (event) => this.onInput(event));
    this.root.addEventListener('change', (event) => void this.onChange(event));
    this.root.addEventListener('submit', (event) => void this.onSubmit(event));
    this.render();
    void this.load();
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

    const shots = await this.loadShots(bean);
    const presets = readPresets(bean.id);
    const workflowMatches = this.workflowMatchesBean(bean);
    const draft =
      options.preferWorkflow && workflowMatches
        ? recipeFromWorkflow(this.state.workflow)
        : recipeFromShot(shots[0] ?? null);

    this.setState({
      batchesByBean: { ...this.state.batchesByBean, [bean.id]: batches },
      selectedBatchId: selectedBatch?.id ?? null,
      shots,
      presets,
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

  private async loadShots(bean: Bean): Promise<ShotRecord[]> {
    if (this.state.demo) return demoShotsForBean(bean);

    try {
      const page = await gateway.shots(shotFilterForBean(bean, null));
      const visible = page.items.slice(0, 14);
      return Promise.all(visible.map((shot) => this.loadFullShot(shot)));
    } catch (error) {
      console.warn('[Beanie] Could not load shots', error);
      return [];
    }
  }

  private async loadFullShot(shot: ShotSummary): Promise<ShotRecord> {
    try {
      return await gateway.shot(shot.id);
    } catch {
      return { ...shot, measurements: [] };
    }
  }

  private async applyDraft(): Promise<void> {
    const bean = this.selectedBean();
    if (!bean) return;

    const draft = normalizeDraft(this.state.draft, this.state.profiles, this.state.grinders);
    const batch = this.selectedBatch();
    const update = buildWorkflowUpdate(bean, batch, draft, draft.profile, this.state.workflow);
    const signature = draftSignature(draft);

    this.setState({ busy: true, applyState: 'pending', status: 'Applying workflow' });
    if (this.state.demo) {
      this.setState({
        workflow: update,
        draft,
        busy: false,
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
        draft,
        busy: false,
        applyState: 'applied',
        appliedSignature: signature,
        status: 'Workflow applied'
      });
    } catch (error) {
      console.error('[Beanie] Apply failed', error);
      this.setState({ busy: false, applyState: 'failed', status: 'Apply failed' });
    }
  }

  private isDirty(): boolean {
    if (!this.selectedBean() || this.state.appliedSignature == null) return false;
    return draftSignature(this.state.draft) !== this.state.appliedSignature;
  }

  private async savePreset(): Promise<void> {
    const bean = this.selectedBean();
    if (!bean) return;

    const preset: BeanPreset = {
      id: crypto.randomUUID(),
      name: presetName(this.state.draft),
      createdAt: new Date().toISOString(),
      recipe: { ...this.state.draft, sourceLabel: 'Saved preset' }
    };
    const presets = [preset, ...this.state.presets].slice(0, 8);
    writePresets(bean.id, presets);
    this.setState({ presets, status: 'Preset saved' });
  }

  private usePreset(id: string): void {
    const preset = this.state.presets.find((item) => item.id === id);
    if (!preset) return;
    this.setState({
      draft: normalizeDraft(preset.recipe, this.state.profiles, this.state.grinders),
      status: 'Preset loaded'
    });
  }

  private resetFromLastShot(): void {
    this.setState({
      draft: normalizeDraft(recipeFromShot(this.state.shots[0] ?? null), this.state.profiles, this.state.grinders),
      status: 'Reset to latest shot'
    });
  }

  private loadShotRecipe(shotId: string): void {
    const shot = this.state.shots.find((item) => item.id === shotId);
    if (!shot) return;
    this.setState({
      draft: normalizeDraft(recipeFromShot(shot), this.state.profiles, this.state.grinders),
      modal: null,
      detailShotId: null,
      status: 'Shot recipe loaded'
    });
  }

  private async saveShotAnnotations(
    id: string,
    notes: string,
    enjoyment: number | null
  ): Promise<void> {
    this.setState({ busy: true, status: 'Saving shot' });
    if (this.state.demo) {
      this.setState({ shots: patchShotAnnotations(this.state.shots, id, notes, enjoyment) });
      this.setState({ busy: false, status: 'Shot updated (demo)' });
      return;
    }
    try {
      const updated = await gateway.updateShot(id, {
        annotations: { espressoNotes: notes || null, enjoyment }
      });
      const shots = this.state.shots.map((shot) => (shot.id === id ? updated : shot));
      this.setState({ shots, busy: false, status: 'Shot updated' });
    } catch (error) {
      console.error('[Beanie] Shot update failed', error);
      this.setState({ busy: false, status: 'Shot update failed' });
    }
  }

  private async deleteShotRecord(id: string): Promise<void> {
    if (!window.confirm('Delete this shot? This cannot be undone.')) return;
    this.setState({ busy: true, status: 'Deleting shot' });
    if (!this.state.demo) {
      try {
        await gateway.deleteShot(id);
      } catch (error) {
        console.error('[Beanie] Shot delete failed', error);
        this.setState({ busy: false, status: 'Shot delete failed' });
        return;
      }
    }
    this.setState({
      shots: this.state.shots.filter((shot) => shot.id !== id),
      busy: false,
      modal: null,
      detailShotId: null,
      status: this.state.demo ? 'Shot deleted (demo)' : 'Shot deleted'
    });
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
    // Idle telemetry: keep the top bar fresh on the existing debounced path.
    this.scheduleRender();
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
      void this.loadShots(bean).then((shots) => this.setState({ shots }));
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

    switch (action) {
      case 'select-bean':
        if (id) await this.selectBean(id, { apply: true, preferWorkflow: false });
        break;
      case 'adjust':
        if (field) this.adjustField(field, Number(el.dataset.delta ?? '0'));
        break;
      case 'apply':
        await this.applyDraft();
        break;
      case 'save-preset':
        await this.savePreset();
        break;
      case 'use-preset':
        if (id) this.usePreset(id);
        break;
      case 'clear':
        this.setState({ draft: emptyRecipe(), status: 'Draft cleared' });
        break;
      case 'reset':
        this.resetFromLastShot();
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
      case 'open-shot':
        if (id) this.setState({ modal: 'shot-detail', detailShotId: id });
        break;
      case 'load-shot':
        if (id) this.loadShotRecipe(id);
        break;
      case 'delete-shot':
        if (id) await this.deleteShotRecord(id);
        break;
      case 'stop':
        await this.machineAction('idle');
        break;
      case 'sleep':
        await this.machineAction('sleeping');
        break;
      case 'refresh':
        await this.load();
        break;
      case 'simulate-shot':
        this.startSimulatedShot();
        break;
      case 'open-settings':
        this.setState({ modal: 'settings' });
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
        this.setState({ modal: 'bean-editor', editingBeanId: null });
        break;
      case 'open-edit-bean':
        this.setState({ modal: 'bean-editor', editingBeanId: id ?? this.state.selectedBeanId });
        break;
      case 'archive-bean':
        if (id) await this.archiveBean(id);
        break;
      case 'open-add-batch':
        this.setState({ modal: 'batch-editor' });
        break;
      case 'open-add-grinder':
        this.setState({ modal: 'grinder-editor' });
        break;
      case 'close-modal':
        this.setState({ modal: null, editingBeanId: null, editDialog: null, detailShotId: null });
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
  }

  private async onChange(event: Event): Promise<void> {
    const target = event.target as HTMLInputElement | HTMLSelectElement;
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
  }

  private async onSubmit(event: Event): Promise<void> {
    const form = event.target as HTMLFormElement;
    if (form.dataset.form === 'edit-shot') {
      event.preventDefault();
      const id = form.dataset.id;
      if (!id) return;
      const data = new FormData(form);
      const notes = String(data.get('notes') ?? '').trim();
      const enjoymentRaw = String(data.get('enjoyment') ?? '').trim();
      const enjoyment = enjoymentRaw === '' ? null : Number(enjoymentRaw);
      await this.saveShotAnnotations(
        id,
        notes,
        enjoyment != null && Number.isFinite(enjoyment) ? enjoyment : null
      );
      return;
    }
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
        this.setState({ beans, modal: null, editingBeanId: null, busy: false, status: 'Bean saved (demo)' });
      } else {
        const bean: Bean = { id: `demo-${Date.now()}`, ...fields } as Bean;
        this.setState({
          beans: [bean, ...this.state.beans],
          modal: null,
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
        this.setState({ beans, modal: null, editingBeanId: null, busy: false, status: 'Bean saved' });
      } else {
        const bean = await gateway.createBean(fields);
        this.setState({
          beans: [bean, ...this.state.beans],
          modal: null,
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
    this.setState({ beans, modal: null, editingBeanId: null, busy: false, status: 'Bag archived' });
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
        modal: null,
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
        modal: null,
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
        modal: null,
        editDialog: null,
        busy: false,
        status
      });
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
  }

  private commitEditDialog(): void {
    const dialog = this.state.editDialog;
    if (!dialog) return;

    const value = inputDialogCommitValue(dialog);
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
  }

  private render(): void {
    const bean = this.selectedBean();
    this.root.innerHTML = `
      <div class="app-shell">
        ${this.renderTopbar()}
        <main class="workbench">
          ${this.renderBeanRail()}
          <section class="surface">
            ${this.renderHero(bean)}
            ${this.renderRecipeEditor(bean)}
            ${this.renderHistory()}
          </section>
        </main>
        ${this.renderLivePanel()}
        ${this.renderModal()}
      </div>
    `;
    refreshIcons();
    this.bindLiveElements();
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
            ${topStat('Machine', capitalize(ready))}
            ${topStat('Group', temp(machine?.groupTemperature))}
            ${topStat('Steam', temp(machine?.steamTemperature))}
            ${topStat('Scale', scale?.status === 'disconnected' ? 'offline' : `${formatNumber(scale?.weight, 1)} g`)}
          </div>
          <div class="top-icons" role="toolbar" aria-label="Skin actions">
            ${this.state.demo ? `<button class="icon-tool" data-action="simulate-shot" aria-label="Simulate shot" title="Simulate shot">${icon('play')}</button>` : ''}
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
          <p>${escapeHtml(bean?.notes ?? bean?.processing ?? 'Select a bean to load the last dial-in.')}</p>
        </div>
        <div class="hero-side">
          <label class="switch">
            <input type="checkbox" data-field="autoLoad" ${this.state.autoLoad ? 'checked' : ''} />
            <span>Auto-load</span>
          </label>
          ${this.renderApplyStatus()}
          <span class="chip">${escapeHtml(draft.sourceLabel ?? 'No source')}</span>
          ${this.renderBatchControl(bean)}
        </div>
      </section>
    `;
  }

  private renderRecipeEditor(bean: Bean | null): string {
    const draft = this.state.draft;
    return `
      <section class="recipe-grid">
        ${this.controlNumber('Dose', 'dose', draft.dose, 0.5)}
        ${this.controlNumber('Yield', 'yield', draft.yield, 1)}
        ${this.controlRatio()}
        ${this.controlGrind()}
        ${this.controlTemp()}
        ${this.controlProfile()}
        <div class="quick-panel panel">
          <div class="quick-head">
            <span class="eyebrow">Bean presets</span>
            <button class="text-button" data-action="save-preset">${icon('save')}<span>Save</span></button>
          </div>
          <div class="preset-list">
            ${this.state.presets.length === 0 ? '<span class="empty">No presets</span>' : this.state.presets.map((preset) => `
              <button class="preset" data-action="use-preset" data-id="${escapeAttr(preset.id)}">${escapeHtml(preset.name)}</button>
            `).join('')}
          </div>
        </div>
        <div class="command-panel panel">
          <button class="command primary" data-action="apply" ${bean ? '' : 'disabled'}>${icon('sliders-horizontal')}<span>Apply</span></button>
          <button class="command" data-action="reset">${icon('rotate-ccw')}<span>Latest</span></button>
          <button class="command danger" data-action="clear">${icon('trash-2')}<span>Clear</span></button>
        </div>
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

  private controlProfile(): string {
    const selectedId = this.profileIdForDraft();
    return `
      <div class="select-control panel">
        <label>Profile</label>
        <select data-field="profileId">
          <option value="">No profile</option>
          ${this.state.profiles.map((profile) => `
            <option value="${escapeAttr(profile.id)}" ${profile.id === selectedId ? 'selected' : ''}>${escapeHtml(profile.profile.title ?? profile.id)}</option>
          `).join('')}
        </select>
      </div>
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

  private renderApplyStatus(): string {
    if (!this.selectedBean()) return '';
    if (this.state.busy && this.state.applyState === 'pending') {
      return '<span class="chip apply-pending">Applying…</span>';
    }
    if (this.state.applyState === 'failed') {
      return '<span class="chip apply-failed">Apply failed</span>';
    }
    if (this.state.applyState === 'stale') {
      return '<span class="chip apply-stale">Changed on machine · Sync to reload</span>';
    }
    if (this.isDirty()) {
      return '<span class="chip apply-pending">Unsaved · tap Apply</span>';
    }
    if (this.state.applyState === 'applied') {
      return '<span class="chip apply-applied">Applied</span>';
    }
    return '<span class="chip apply-applied">In sync</span>';
  }

  private renderHistory(): string {
    return `
      <section class="history-panel panel">
        <div class="history-head">
          <div>
            <span class="eyebrow">History</span>
            <h2>Shots</h2>
          </div>
          <span class="chip">${this.state.shots.length} shots</span>
        </div>
        <div class="shot-list">
          ${this.state.shots.length === 0 ? '<p class="empty-history">No shots found for this bean.</p>' : this.state.shots.map((shot) => this.renderShotRow(shot)).join('')}
        </div>
      </section>
    `;
  }

  private renderShotRow(shot: ShotRecord): string {
    const recipe = recipeFromShot(shot);
    const date = new Date(shot.timestamp);
    const notes = shot.annotations?.espressoNotes ?? shot.shotNotes ?? '';
    const detail = [recipe.profileTitle ?? 'No profile', notes].filter(Boolean).join(' · ');
    return `
      <article class="shot-card">
        <button class="shot-load" data-action="open-shot" data-id="${escapeAttr(shot.id)}">
          <small>${Number.isNaN(date.valueOf()) ? escapeHtml(shot.timestamp) : escapeHtml(date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }))}</small>
          <div class="shot-title-line">
            <b>${formatGrams(recipe.dose)} -> ${formatGrams(recipe.yield)}</b>
            ${enjoymentBadge(shot)}
          </div>
          <span>${escapeHtml(detail)}</span>
        </button>
        <div class="shot-dial">
          ${stat('Grind', recipe.grinderSetting ?? '--')}
        </div>
        ${renderShotGraph(shot)}
      </article>
    `;
  }

  private renderModal(): string {
    if (this.state.modal === 'edit-number') return this.renderEditDialog();
    if (this.state.modal === 'shot-detail') return this.renderShotDetail();
    if (this.state.modal === 'settings') {
      return renderSettingsShell(this.settingsShellModel());
    }
    if (this.state.modal === 'bean-editor') return this.renderBeanEditor();
    if (this.state.modal === 'batch-editor') return this.renderBatchEditor();
    if (this.state.modal === 'grinder-editor') return this.renderGrinderEditor();
    return '';
  }

  private renderBeanEditor(): string {
    const editing = this.state.editingBeanId
      ? this.state.beans.find((bean) => bean.id === this.state.editingBeanId) ?? null
      : null;
    const v = (value: string | null | undefined) => escapeAttr(value ?? '');
    return `
      <div class="modal-backdrop">
        <form class="modal panel" data-form="bean-editor" role="dialog" aria-modal="true" aria-labelledby="bean-editor-title">
          <div class="modal-head">
            <h2 id="bean-editor-title">${editing ? 'Edit Bean' : 'Add Bean'}</h2>
            <button type="button" class="icon-button" data-action="close-modal" aria-label="Close" title="Close">${icon('x')}</button>
          </div>
          <label>Roaster<input name="roaster" required autocomplete="off" value="${v(editing?.roaster)}" /></label>
          <label>Coffee<input name="name" required autocomplete="off" value="${v(editing?.name)}" /></label>
          <div class="field-row">
            <label>Country<input name="country" autocomplete="off" value="${v(editing?.country)}" /></label>
            <label>Region<input name="region" autocomplete="off" value="${v(editing?.region)}" /></label>
          </div>
          <label>Process<input name="processing" autocomplete="off" value="${v(editing?.processing)}" /></label>
          <label>Notes<textarea name="notes" rows="2">${escapeHtml(editing?.notes ?? '')}</textarea></label>
          <div class="modal-actions">
            ${
              editing
                ? `<button type="button" class="command danger" data-action="archive-bean" data-id="${escapeAttr(editing.id)}">${icon('archive')}<span>Archive</span></button>`
                : '<button type="button" class="command" data-action="close-modal">Cancel</button>'
            }
            <button class="command primary" type="submit">${icon('save')}<span>${editing ? 'Save' : 'Add'}</span></button>
          </div>
        </form>
      </div>
    `;
  }

  private renderBatchEditor(): string {
    const bean = this.selectedBean();
    return `
      <div class="modal-backdrop">
        <form class="modal panel" data-form="batch-editor" role="dialog" aria-modal="true" aria-labelledby="batch-editor-title">
          <div class="modal-head">
            <h2 id="batch-editor-title">Add Batch</h2>
            <button type="button" class="icon-button" data-action="close-modal" aria-label="Close" title="Close">${icon('x')}</button>
          </div>
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
          <div class="modal-actions">
            <button type="button" class="command" data-action="close-modal">Cancel</button>
            <button class="command primary" type="submit" ${bean ? '' : 'disabled'}>${icon('save')}<span>Add</span></button>
          </div>
        </form>
      </div>
    `;
  }

  private renderGrinderEditor(): string {
    return `
      <div class="modal-backdrop">
        <form class="modal panel" data-form="grinder-editor" role="dialog" aria-modal="true" aria-labelledby="grinder-editor-title">
          <div class="modal-head">
            <h2 id="grinder-editor-title">Add Grinder</h2>
            <button type="button" class="icon-button" data-action="close-modal" aria-label="Close" title="Close">${icon('x')}</button>
          </div>
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
          <div class="modal-actions">
            <button type="button" class="command" data-action="close-modal">Cancel</button>
            <button class="command primary" type="submit">${icon('save')}<span>Add</span></button>
          </div>
        </form>
      </div>
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

  private renderShotDetail(): string {
    const shot = this.state.shots.find((item) => item.id === this.state.detailShotId);
    if (!shot) return '';

    const recipe = recipeFromShot(shot);
    const date = new Date(shot.timestamp);
    const notes = shot.annotations?.espressoNotes ?? shot.shotNotes ?? '';
    const title = Number.isNaN(date.valueOf())
      ? shot.timestamp
      : date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

    return `
      <div class="modal-backdrop">
        <div class="shot-detail-modal panel" role="dialog" aria-modal="true" aria-labelledby="shot-detail-title">
          <div class="modal-head shot-detail-head">
            <div>
              <span class="eyebrow">Shot</span>
              <h2 id="shot-detail-title">${escapeHtml(title)}</h2>
            </div>
            <div class="shot-detail-head-actions">
              ${enjoymentBadge(shot, 'detail')}
              <button type="button" class="icon-button" data-action="close-modal" aria-label="Close" title="Close">${icon('x')}</button>
            </div>
          </div>
          <div class="detail-summary">
            ${stat('Dose', formatGrams(recipe.dose))}
            ${stat('Yield', formatGrams(recipe.yield))}
            ${stat('Grind', recipe.grinderSetting ?? '--')}
          </div>
          <div class="detail-profile">${escapeHtml(recipe.profileTitle ?? 'No profile')}</div>
          <div class="detail-chart">
            ${renderShotGraph(shot, { detailed: true })}
          </div>
          <form class="detail-edit" data-form="edit-shot" data-id="${escapeAttr(shot.id)}">
            <label class="detail-field">
              <span>Notes</span>
              <textarea name="notes" rows="2" placeholder="Tasting notes">${escapeHtml(notes)}</textarea>
            </label>
            <label class="detail-field detail-enjoyment-field">
              <span>Enjoyment</span>
              <input type="number" name="enjoyment" min="0" max="100" step="1" value="${escapeAttr(shot.annotations?.enjoyment != null ? String(shot.annotations.enjoyment) : '')}" />
            </label>
            <div class="detail-actions">
              <button type="button" class="command danger" data-action="delete-shot" data-id="${escapeAttr(shot.id)}">${icon('trash-2')}<span>Delete</span></button>
              <button type="button" class="command" data-action="load-shot" data-id="${escapeAttr(shot.id)}">${icon('sliders-horizontal')}<span>Load recipe</span></button>
              <button type="submit" class="command primary">${icon('save')}<span>Save</span></button>
            </div>
          </form>
        </div>
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
      presets: [],
      status: cleared === 0 ? 'Cache reset' : `Reset ${cleared} local item${cleared === 1 ? '' : 's'}`
    });
  }

  private setState(next: Partial<AppState>): void {
    this.state = { ...this.state, ...next };
    this.render();
  }

  private scheduleRender(): void {
    if (this.renderTimer != null) return;
    this.renderTimer = window.setTimeout(() => {
      this.renderTimer = null;
      this.render();
    }, 250);
  }
}

function topStat(label: string, value: string): string {
  return `<div class="top-stat"><label>${escapeHtml(label)}</label><strong>${escapeHtml(value)}</strong></div>`;
}

function liveReadout(label: string, id: string, value: string, unit = ''): string {
  const suffix = unit ? `<em>${escapeHtml(unit)}</em>` : '';
  return `<div class="live-readout"><label>${escapeHtml(label)}</label><strong id="${id}">${escapeHtml(value)}</strong>${suffix}</div>`;
}

function stat(label: string, value: string): string {
  return `<div class="stat"><label>${escapeHtml(label)}</label><strong>${escapeHtml(value)}</strong></div>`;
}

function enjoymentBadge(shot: ShotRecord, size: 'row' | 'detail' = 'row'): string {
  const value = shot.annotations?.enjoyment;
  if (value == null) return '';
  const formatted = Number.isInteger(value) ? value.toString() : value.toFixed(1);
  return `<span class="enjoyment-badge ${size === 'detail' ? 'large' : ''}" aria-label="Enjoyment ${escapeAttr(formatted)}"><span>Enjoy</span><strong>${escapeHtml(formatted)}</strong></span>`;
}

function patchShotAnnotations(
  shots: ShotRecord[],
  id: string,
  notes: string,
  enjoyment: number | null
): ShotRecord[] {
  return shots.map((shot) =>
    shot.id === id
      ? { ...shot, annotations: { ...shot.annotations, espressoNotes: notes || null, enjoyment } }
      : shot
  );
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
