import type {
  Bean,
  BeanBatch,
  De1MachineSettings,
  Grinder,
  HotWaterData,
  MachineCapabilities,
  MachineInfo,
  MachineSnapshot,
  MachineState,
  ProfileRecord,
  RecipeDraft,
  RinseData,
  ScaleSnapshot,
  ShotAnnotations,
  ShotMeasurement,
  ShotRecord,
  ShotSummary,
  ShotUpdate,
  SteamSettings,
  Workflow,
  WorkflowContext
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
import {
  SETTINGS_SPEC,
  coerceFieldValue,
  demoSettingsBundle,
  setBundleField,
  type SettingsBundle
} from './domain/settingsModel';
import { demoPluginSettings } from './api/settings';
import type {
  De1AdvancedSettingsPatch,
  PluginSettings,
  PresenceSettingsPatch,
  ReaSettingsPatch
} from './api/settings';
import {
  pluginFieldDefault,
  pluginSettingsSpec,
  type PluginConfigState
} from './domain/pluginSettings';
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
import { LiveShotSession, simulateShotFrames, type LiveFrame, type LiveShotState } from './domain/liveShot';
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
import {
  DEFAULT_HOT_WATER,
  DEFAULT_RINSE,
  DEFAULT_STEAM,
  FLUSH_PRESETS,
  HOT_WATER_PRESETS,
  STEAM_PRESETS,
  clampFlush,
  clampHotWater,
  clampSteam,
  flushValues,
  hotWaterValues,
  matchingPreset,
  steamValues,
  waterControlCapabilities,
  type NumberSpec,
  type WaterControlCapabilities,
  type WaterPreset
} from './domain/waterSettings';

type Modal = 'bean-picker' | 'edit-number' | 'edit-shot' | 'machine-label' | null;
type EditField = 'dose' | 'yield' | 'ratio' | 'grinderSetting' | 'temperature';
type ShotEditField =
  | 'coffeeRoaster'
  | 'coffeeName'
  | 'beanBatchId'
  | 'finalBeverageType'
  | 'baristaName'
  | 'drinkerName'
  | 'targetDoseWeight'
  | 'targetYield'
  | 'actualDoseWeight'
  | 'actualYield'
  | 'grinderId'
  | 'grinderModel'
  | 'grinderSetting'
  | 'drinkTds'
  | 'drinkEy'
  | 'espressoNotes';
type ApplyState = 'idle' | 'pending' | 'applied' | 'failed' | 'stale';
type LiveChartMode = 'preset30' | 'auto';
type MachineServiceState = 'steam' | 'flush' | 'hotWater';
type BeanPickerMode = 'inspect' | 'create';
type SecondTapHintKind = 'bean' | 'shot';
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
const SCROLL_SELECTORS = ['.bean-picker-list', '.shot-list', '.page-body'];

const SHOT_SCORE_OPTIONS = [
  { value: 20, icon: '😞', label: 'Bad' },
  { value: 40, icon: '😕', label: 'Meh' },
  { value: 60, icon: '😐', label: 'Okay' },
  { value: 80, icon: '🙂', label: 'Good' },
  { value: 100, icon: '😍', label: 'Great' }
] as const;

type ShotScoreOption = (typeof SHOT_SCORE_OPTIONS)[number];

// Which editor field a tap-to-edit numpad dialog is bound to.
interface ProfileEditTarget {
  target: 'step-field' | 'simple-field' | 'exit';
  key?: string;
  index?: number;
  type?: 'pressure' | 'flow';
  condition?: 'over' | 'under';
}

interface MachineEditTarget {
  name: string;
  title: string;
  unit: string;
  spec: NumberSpec;
}

interface MachineLabelEditTarget {
  presetName: string;
  presetId: string;
  label: string;
}

interface ShotEditDraft {
  shotId: string;
  coffeeRoaster: string | null;
  coffeeName: string | null;
  beanBatchId: string | null;
  finalBeverageType: string | null;
  baristaName: string | null;
  drinkerName: string | null;
  targetDoseWeight: number | null;
  targetYield: number | null;
  actualDoseWeight: number | null;
  actualYield: number | null;
  grinderId: string | null;
  grinderModel: string | null;
  grinderSetting: string | null;
  drinkTds: number | null;
  drinkEy: number | null;
  enjoyment: number | null;
  espressoNotes: string | null;
  contextExtras: Record<string, unknown> | null;
  annotationExtras: Record<string, unknown> | null;
}

interface ShotFieldOption {
  label: string;
  value: string;
  detail?: string;
}

interface ShotFieldSpec {
  label: string;
  kind: 'text' | 'number' | 'textarea';
  value: string;
  step?: string;
  options: ShotFieldOption[];
}

interface SecondTapHintState {
  kind: SecondTapHintKind;
  id: string;
}

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
  secondTapHint: SecondTapHintState | null;
  view: View;
  settingsSection: string;
  settingsBundle: SettingsBundle | null;
  settingsSource: 'gateway' | 'demo' | null;
  pluginConfig: PluginConfigState | null;
  modal: Modal;
  beanPickerBeanId: string | null;
  beanPickerMode: BeanPickerMode;
  editingBeanId: string | null;
  editingGrinderId: string | null;
  profileEditor: ProfileEditorState | null;
  editingProfileId: string | null;
  editDialog: InputDialogState | null;
  shotEdit: ShotEditDraft | null;
  shotEditField: ShotEditField | null;
  profileEdit: ProfileEditTarget | null;
  machineEdit: MachineEditTarget | null;
  machineLabelEdit: MachineLabelEditTarget | null;
  machinePresetLabels: Record<string, string>;
  machinePresetValues: MachinePresetValueOverrides;
  detailShotId: string | null;
  machineInfo: MachineInfo | null;
  machineCapabilities: MachineCapabilities | null;
  machineSettings: De1MachineSettings | null;
  machine: MachineSnapshot | null;
  scale: ScaleSnapshot | null;
  waterLevel: number | null;
  liveActive: boolean;
  liveChartMode: LiveChartMode;
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
    secondTapHint: null,
    view: 'workbench',
    settingsSection: 'gateway',
    settingsBundle: null,
    settingsSource: null,
    pluginConfig: null,
    modal: null,
    beanPickerBeanId: null,
    beanPickerMode: 'inspect',
    editingBeanId: null,
    editingGrinderId: null,
    profileEditor: null,
    editingProfileId: null,
    editDialog: null,
    shotEdit: null,
    shotEditField: null,
    profileEdit: null,
    machineEdit: null,
    machineLabelEdit: null,
    machinePresetLabels: readMachinePresetLabels(),
    machinePresetValues: readMachinePresetValues(),
    detailShotId: null,
    machineInfo: null,
    machineCapabilities: null,
    machineSettings: null,
    machine: null,
    scale: null,
    waterLevel: null,
    liveActive: false,
    liveChartMode: 'preset30',
    asleep: false,
    applyState: 'idle',
    appliedSignature: null
  };

  private applyTimer: number | null = null;
  private machineRetryTimer: number | null = null;
  private scaleRetryTimer: number | null = null;
  private waterRetryTimer: number | null = null;
  private machineSocket: WebSocket | null = null;
  private scaleSocket: WebSocket | null = null;
  private waterSocket: WebSocket | null = null;

  private readonly liveShot = new LiveShotSession();
  private liveChart: LiveChart | null = null;
  private liveCanvas: HTMLCanvasElement | null = null;
  private liveReadoutEls: LiveReadoutEls | null = null;
  private liveRaf: number | null = null;
  private liveDirty = false;
  private simTimer: number | null = null;
  private machineServiceState: MachineServiceState | null = null;
  private machineServiceStartedAtMs: number | null = null;
  private machineProgressReturnView: View | null = null;
  private machineStopRequestedFor: MachineServiceState | null = null;
  private machineStopRequestedAtMs: number | null = null;
  private machineStopFeedbackTimer: number | null = null;

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
    if (this.waterRetryTimer != null) window.clearTimeout(this.waterRetryTimer);
    if (this.simTimer != null) window.clearTimeout(this.simTimer);
    if (this.liveRaf != null) window.cancelAnimationFrame(this.liveRaf);
    this.machineSocket?.close();
    this.scaleSocket?.close();
    this.waterSocket?.close();
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
      const machineInfo = await gateway.machineInfo().catch((error) => {
        console.warn('[Beanie] Could not load machine info', error);
        return null;
      });

      this.setState({
        workflow,
        beans,
        grinders,
        profiles,
        machineInfo,
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
      void this.loadMachineControlState();
      this.connectMachineSocket();
      this.connectScaleSocket();
      this.connectWaterLevelSocket();
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
      machineInfo: {
        version: 'demo',
        model: 'Beanie demo',
        serialNumber: 'demo',
        GHC: false,
        extra: { simulated: true }
      },
      machine: demoMachine,
      machineCapabilities: { capabilities: [] },
      machineSettings: {
        steamFlow: demoWorkflow.steamSettings?.flow,
        hotWaterFlow: demoWorkflow.hotWaterData?.flow,
        flushTemp: demoWorkflow.rinseData?.targetTemperature,
        flushFlow: demoWorkflow.rinseData?.flow,
        flushTimeout: demoWorkflow.rinseData?.duration
      },
      demo: true,
      loading: false,
      status: 'Demo data'
    });
    void this.selectBean(demoBeans[0]!.id, { apply: false, preferWorkflow: true });
  }

  private async loadMachineControlState(): Promise<void> {
    if (this.state.demo) return;
    const [capabilities, settings] = await Promise.allSettled([
      gateway.machineCapabilities(),
      gateway.machineSettings()
    ]);
    const next: Partial<AppState> = {};
    if (capabilities.status === 'fulfilled') next.machineCapabilities = capabilities.value;
    if (settings.status === 'fulfilled') next.machineSettings = settings.value;
    if (Object.keys(next).length > 0) this.setState(next);
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
    const selectedBatch = latestBatch(batches);

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

  private async openBeanPicker(
    beanId: string | null,
    options: { create?: boolean } = {}
  ): Promise<void> {
    const id = beanId ?? this.state.selectedBeanId;
    this.setState({
      modal: 'bean-picker',
      search: '',
      beanPickerBeanId: options.create ? null : id,
      beanPickerMode: options.create ? 'create' : 'inspect'
    });
    if (id && !options.create) await this.ensureBatchesLoaded(id);
  }

  private async inspectBeanInPicker(beanId: string): Promise<void> {
    this.setState({
      beanPickerBeanId: beanId,
      beanPickerMode: 'inspect',
      secondTapHint: this.nextSecondTapHint('bean', beanId)
    });
    await this.ensureBatchesLoaded(beanId);
  }

  private async ensureBatchesLoaded(beanId: string): Promise<void> {
    if (this.state.batchesByBean[beanId]) return;
    const bean = this.state.beans.find((item) => item.id === beanId);
    if (!bean) return;
    this.setState({ status: 'Loading batches' });
    const batches = await this.loadBatches(bean);
    this.setState({
      batchesByBean: { ...this.state.batchesByBean, [bean.id]: batches },
      status: 'Batches loaded'
    });
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

  private async loadLatestShotCandidates(limit = 6): Promise<ShotRecord[]> {
    const query = new URLSearchParams({ limit: String(limit), offset: '0', order: 'desc' });
    try {
      const page = await gateway.shots(query);
      void beanieCache.putShotPage(query, page);
      void beanieCache.putShotSummaries(page.items);
      return Promise.all(page.items.map((shot) => this.loadFullShot(shot)));
    } catch (error) {
      console.warn('[Beanie] Could not load latest shot candidates', error);
      const cached = await beanieCache.getShotPage(query).catch(() => null);
      if (!cached) return [];
      return Promise.all(cached.items.map((shot) => this.loadFullShot(shot)));
    }
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
    this.completeSecondTapHint();
    this.setState({
      draft: normalizeDraft(recipeFromShot(shot), this.state.profiles, this.state.grinders),
      view: 'workbench',
      detailShotId: shotId,
      secondTapHint: null,
      status: 'Shot recipe loaded'
    });
    this.scheduleApply();
  }

  private selectHistoryShot(shotId: string): void {
    if (this.selectedHistoryShot()?.id === shotId) {
      this.loadShotRecipe(shotId);
      return;
    }
    this.setState({
      detailShotId: shotId,
      secondTapHint: this.nextSecondTapHint('shot', shotId),
      status: 'Shot selected'
    });
  }

  private nextSecondTapHint(kind: SecondTapHintKind, id: string): SecondTapHintState | null {
    return recordSecondTapHintShown() ? { kind, id } : null;
  }

  private completeSecondTapHint(): void {
    markSecondTapHintUsed();
  }

  private openShotEditor(): void {
    const shot = this.selectedHistoryShot();
    if (!shot) return;
    this.setState({
      modal: 'edit-shot',
      editDialog: null,
      shotEdit: shotEditDraftFromShot(shot),
      shotEditField: null,
      profileEdit: null
    });
  }

  private async submitShotDyeEditor(form: HTMLFormElement): Promise<void> {
    const shotId = form.dataset.id ?? this.selectedHistoryShot()?.id;
    const shot = shotId ? this.state.shots.find((item) => item.id === shotId) : null;
    if (!shot) return;

    const update = this.shotUpdateFromForm(form, shot);

    this.setState({ busy: true, status: 'Saving shot' });
    if (this.state.demo) {
      this.replaceShotRecord(applyShotUpdate(shot, update), 'Shot saved (demo)');
      return;
    }

    try {
      const saved = await gateway.updateShot(shot.id, update);
      await beanieCache.invalidateShotMutation(saved.id);
      await beanieCache.putShotRecord(saved);
      this.replaceShotRecord(saved, 'Shot saved');
    } catch (error) {
      console.error('[Beanie] Save shot failed', error);
      this.setState({ busy: false, status: 'Save shot failed' });
    }
  }

  private replaceShotRecord(shot: ShotRecord, status: string): void {
    const shots = this.state.shots.map((item) => (item.id === shot.id ? shot : item));
    this.setState({
      shots,
      detailShotId: shot.id,
      modal: null,
      editDialog: null,
      shotEdit: null,
      shotEditField: null,
      busy: false,
      status
    });
  }

  private shotUpdateFromForm(form: HTMLFormElement, shot: ShotRecord): ShotUpdate {
    const draft = shotEditDraftWithFormNumbers(
      this.state.shotEdit?.shotId === shot.id ? this.state.shotEdit : shotEditDraftFromShot(shot),
      form
    );
    const grinderId = draft.grinderId;
    const selectedGrinder = grinderId ? this.state.grinders.find((grinder) => grinder.id === grinderId) : null;
    const beanBatchId = draft.beanBatchId;
    const selectedBatch = this.batchAndBeanForId(beanBatchId);

    const context: WorkflowContext = {
      ...(shot.workflow?.context ?? {}),
      targetDoseWeight: draft.targetDoseWeight,
      targetYield: draft.targetYield,
      grinderId,
      grinderModel: draft.grinderModel ?? selectedGrinder?.model ?? null,
      grinderSetting: draft.grinderSetting,
      beanBatchId,
      coffeeName: draft.coffeeName ?? selectedBatch?.bean.name ?? null,
      coffeeRoaster: draft.coffeeRoaster ?? selectedBatch?.bean.roaster ?? null,
      finalBeverageType: draft.finalBeverageType,
      baristaName: draft.baristaName,
      drinkerName: draft.drinkerName,
      extras: draft.contextExtras
    };
    const annotations: ShotAnnotations = {
      ...(shot.annotations ?? {}),
      actualDoseWeight: draft.actualDoseWeight,
      actualYield: draft.actualYield,
      drinkTds: draft.drinkTds,
      drinkEy: draft.drinkEy,
      enjoyment: draft.enjoyment,
      espressoNotes: draft.espressoNotes,
      extras: draft.annotationExtras
    };

    return {
      workflow: { context },
      annotations,
      shotNotes: annotations.espressoNotes ?? null,
      metadata: annotations.extras ?? null
    };
  }

  private commitShotFieldDialog(form: HTMLFormElement): void {
    const field = form.dataset.field;
    if (!isShotEditField(field)) return;
    const data = new FormData(form);
    this.applyShotEditField(field, String(data.get('value') ?? ''));
  }

  private applyShotEditField(field: ShotEditField, value: string): void {
    const draft = this.state.shotEdit;
    if (!draft) return;
    const next = updateShotEditDraftField(draft, field, value, this.state.grinders, this.state.beans, (batchId) =>
      this.batchAndBeanForId(batchId)
    );
    this.setState({ shotEdit: next, shotEditField: null, status: 'Shot draft changed' });
  }

  private setShotEditEnjoyment(value: number | null): void {
    const draft = this.state.shotEdit;
    if (!draft) return;
    this.setState({
      shotEdit: { ...draft, enjoyment: value },
      status: 'Shot draft changed'
    });
  }

  private async updateShotEnjoyment(shotId: string, value: number | null): Promise<void> {
    const shot = this.state.shots.find((item) => item.id === shotId);
    if (!shot) return;
    const update: ShotUpdate = {
      annotations: {
        ...(shot.annotations ?? {}),
        enjoyment: value
      }
    };
    this.setState({ busy: true, status: 'Saving score' });
    if (this.state.demo) {
      this.replaceShotRecord(applyShotUpdate(shot, update), 'Score saved (demo)');
      return;
    }

    try {
      const saved = await gateway.updateShot(shot.id, update);
      await beanieCache.invalidateShotMutation(saved.id);
      await beanieCache.putShotRecord(saved);
      this.replaceShotRecord(saved, 'Score saved');
    } catch (error) {
      console.error('[Beanie] Save score failed', error);
      this.setState({ busy: false, status: 'Save score failed' });
    }
  }

  private batchAndBeanForId(batchId: string | null): { batch: BeanBatch; bean: Bean } | null {
    if (!batchId) return null;
    for (const bean of this.state.beans) {
      const batch = (this.state.batchesByBean[bean.id] ?? []).find((item) => item.id === batchId);
      if (batch) return { batch, bean };
    }
    return null;
  }

  private async machineAction(state: MachineState): Promise<void> {
    const service = machineServiceState(state);
    this.setState({ busy: true, status: machineActionStatus(state, 'sending') });
    if (this.state.demo) {
      if (state !== 'espresso') this.stopSimulatedShot();
      this.rememberMachineProgressReturnView(service);
      this.trackMachineServiceState(state);
      this.setState({
        busy: false,
        machine: optimisticMachineSnapshot(this.state.machine, state),
        view: service ? 'machine' : this.state.view,
        liveActive: state === 'espresso' ? this.state.liveActive : false,
        asleep: state === 'sleeping',
        status: machineActionStatus(state, 'demo')
      });
      if (state === 'espresso') this.startSimulatedShot();
      return;
    }
    try {
      await gateway.requestState(state);
      this.rememberMachineProgressReturnView(service);
      this.trackMachineServiceState(state);
      this.setState({
        busy: false,
        machine: optimisticMachineSnapshot(this.state.machine, state),
        view: service ? 'machine' : this.state.view,
        asleep: state === 'sleeping',
        status: machineActionStatus(state, 'sent')
      });
    } catch (error) {
      console.error('[Beanie] Machine action failed', error);
      this.setState({ busy: false, status: 'Machine command failed' });
    }
  }

  private async toggleMachineCommand(state: MachineState): Promise<void> {
    const active = this.state.machine?.state?.state === state;
    await this.machineAction(active ? 'idle' : state);
  }

  private async stopMachineService(): Promise<void> {
    const service = machineServiceState(this.state.machine?.state?.state) ?? this.machineServiceState;
    if (!service) {
      await this.machineAction('idle');
      return;
    }

    this.machineStopRequestedFor = service;
    this.machineStopRequestedAtMs = Date.now();
    this.setState({ busy: true, status: 'Stopping machine' });
    if (this.state.demo) {
      const returnView = this.consumeMachineProgressReturnView();
      this.clearMachineStopRequest();
      this.trackMachineServiceState('idle');
      this.setState({
        busy: false,
        machine: optimisticMachineSnapshot(this.state.machine, 'idle'),
        view: returnView,
        status: 'Demo stopped'
      });
      return;
    }

    try {
      await gateway.requestState('idle');
      this.setState({ busy: false, status: 'Stop requested' });
      this.armMachineStopFeedbackTimer();
    } catch (error) {
      console.error('[Beanie] Machine stop failed', error);
      this.clearMachineStopRequest();
      this.setState({ busy: false, status: 'Machine stop failed' });
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

  // The DE1 tank level arrives on its own socket (separate from the snapshot).
  // It changes slowly, so patch the top-bar readout by reference rather than
  // re-rendering the whole app on every frame.
  private connectWaterLevelSocket(): void {
    if (this.state.demo) return;
    this.waterSocket?.close();
    const ws = new WebSocket(`${gatewayWsOrigin()}/ws/v1/machine/waterLevels`);
    this.waterSocket = ws;
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as { currentLevel?: unknown };
        const level = typeof data.currentLevel === 'number' && Number.isFinite(data.currentLevel) ? data.currentLevel : null;
        if (level === this.state.waterLevel) return;
        this.state.waterLevel = level;
        const el = this.root.querySelector<HTMLElement>('#stat-water');
        if (el) el.textContent = water(level);
      } catch (error) {
        console.warn('[Beanie] Bad water level frame', error);
      }
    };
    ws.onclose = () => {
      if (this.waterSocket !== ws) return;
      if (this.waterRetryTimer != null) window.clearTimeout(this.waterRetryTimer);
      this.waterRetryTimer = window.setTimeout(() => this.connectWaterLevelSocket(), 3000);
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
    const previousService = machineServiceState(this.state.machine?.state?.state);
    if (machine) {
      this.state.machine = machine;
      this.trackMachineServiceState(machine.state.state, tMs);
    }
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
    const currentService = machineServiceState(this.state.machine?.state?.state);
    if (currentService && this.state.view !== 'machine') {
      this.rememberMachineProgressReturnView(currentService);
      this.setState({ view: 'machine' });
      return;
    }
    if (this.state.view === 'machine' && currentService) {
      this.setState({});
      return;
    }
    if (previousService && !currentService && this.state.view === 'machine') {
      this.setState({ view: this.consumeMachineProgressReturnView() });
      return;
    }
    this.updateTopbarStats();
  }

  private rememberMachineProgressReturnView(service: MachineServiceState | null): void {
    if (!service || this.machineProgressReturnView != null) return;
    this.machineProgressReturnView = this.state.view;
  }

  private consumeMachineProgressReturnView(): View {
    const view = this.machineProgressReturnView ?? 'workbench';
    this.machineProgressReturnView = null;
    return view;
  }

  private trackMachineServiceState(state: MachineState | undefined, nowMs = Date.now()): void {
    const service = machineServiceState(state);
    if (!service) {
      this.machineServiceState = null;
      this.machineServiceStartedAtMs = null;
      this.clearMachineStopRequest();
      return;
    }
    if (this.machineServiceState !== service || this.machineServiceStartedAtMs == null) {
      this.machineServiceState = service;
      this.machineServiceStartedAtMs = nowMs;
    }
    if (this.machineStopRequestedFor && this.machineStopRequestedFor !== service) this.clearMachineStopRequest();
  }

  private clearMachineStopRequest(): void {
    this.machineStopRequestedFor = null;
    this.machineStopRequestedAtMs = null;
    if (this.machineStopFeedbackTimer != null) {
      window.clearTimeout(this.machineStopFeedbackTimer);
      this.machineStopFeedbackTimer = null;
    }
  }

  private armMachineStopFeedbackTimer(): void {
    if (this.machineStopFeedbackTimer != null) window.clearTimeout(this.machineStopFeedbackTimer);
    this.machineStopFeedbackTimer = window.setTimeout(() => {
      this.machineStopFeedbackTimer = null;
      if (!this.machineStopRequestedFor) return;
      this.setState({ status: 'Stop not confirmed' });
    }, 4000);
  }

  private updateTopbarStats(): void {
    const machine = this.state.machine;
    const scale = this.state.scale;
    const set = (id: string, value: string) => {
      const el = this.root.querySelector<HTMLElement>(`#${id}`);
      if (el) el.textContent = value;
    };
    set('stat-machine', machineStatus(machine, this.state.loading));
    set('stat-group', temp(machine?.groupTemperature));
    set('stat-steam', temp(machine?.steamTemperature));
    set('stat-water', water(this.state.waterLevel));
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
      const model = this.liveShot.model(liveChartModelOptions(this.state.liveChartMode));
      this.liveChart.setOptions({
        hideMaxTimeLabel: liveChartHideMaxTimeLabel(this.state.liveChartMode, model.maxTime)
      });
      this.liveChart.setModel(model);
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
      this.liveChart = new LiveChart(canvas, {
        detailed: true,
        hideMaxTimeLabel: this.state.liveChartMode === 'auto'
      });
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
    const shotWindow = this.liveShot.snapshot;
    const bean = this.selectedBean();
    const optimisticShot = bean
      ? optimisticShotFromLive(
          bean,
          this.selectedBatch(),
          this.state.workflow,
          normalizeDraft(this.state.draft, this.state.profiles, this.state.grinders),
          shotWindow
        )
      : null;
    const refreshContext = {
      previousShotIds: new Set(this.state.shots.map((shot) => shot.id)),
      startedAtMs: shotWindow.startMs,
      endedAtMs: shotWindow.lastActiveMs ?? Date.now(),
      optimisticShot
    };
    const reason = this.liveShot.completionReason;
    this.setState({
      liveActive: false,
      beans: bean ? promoteBean(this.state.beans, bean.id) : this.state.beans,
      shots: optimisticShot ? includeShotInHistory(this.state.shots, optimisticShot, this.shotPageSize) : this.state.shots,
      shotsTotal: optimisticShot ? Math.max(this.state.shotsTotal, this.state.shots.length + 1) : this.state.shotsTotal,
      detailShotId: optimisticShot?.id ?? this.state.detailShotId,
      status: reason ? `Shot complete (${reason})` : 'Shot complete'
    });
    this.liveShot.reset();
    if (bean && !this.state.demo) {
      void this.refreshShotsAfterLiveShot(bean, refreshContext);
    }
  }

  private async refreshShotsAfterLiveShot(
    bean: Bean,
    context: {
      previousShotIds: Set<string>;
      startedAtMs: number | null;
      endedAtMs: number | null;
      optimisticShot: ShotRecord | null;
    }
  ): Promise<void> {
    const delays = [0, 1000, 2000, 4000, 8000];
    let lastRecords: ShotRecord[] = [];
    let lastTotal = this.state.shotsTotal;

    for (let attempt = 0; attempt < delays.length; attempt += 1) {
      const delayMs = delays[attempt]!;
      if (delayMs > 0) await delay(delayMs);
      if (this.selectedBean()?.id !== bean.id) return;

      await beanieCache.invalidateShotMutation().catch(() => {});
      const [{ records, total }, latestRecords] = await Promise.all([
        this.loadFirstShots(bean),
        this.loadLatestShotCandidates()
      ]);
      lastRecords = records;
      lastTotal = total;

      const completedShot =
        completedLiveShot(records, context, false) ??
        completedLiveShot(latestRecords, context, attempt === delays.length - 1);
      if (!completedShot) continue;

      const visibleRecords = includeShotInHistory(records, completedShot, this.shotPageSize);

      this.setState({
        shots: visibleRecords,
        shotsTotal: Math.max(total, visibleRecords.length),
        shotsLoadingMore: false,
        detailShotId: completedShot.id,
        status: 'Shot list updated'
      });
      return;
    }

    if (this.selectedBean()?.id !== bean.id) return;
    const visibleRecords = context.optimisticShot
      ? includeShotInHistory(lastRecords, context.optimisticShot, this.shotPageSize)
      : lastRecords;
    this.setState({
      shots: visibleRecords,
      shotsTotal: Math.max(lastTotal, visibleRecords.length),
      shotsLoadingMore: false,
      detailShotId: context.optimisticShot?.id ?? lastRecords[0]?.id ?? this.state.detailShotId,
      status: 'Shot list updated'
    });
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

  private stopSimulatedShot(): void {
    if (this.simTimer != null) {
      window.clearTimeout(this.simTimer);
      this.simTimer = null;
    }
    if (this.liveRaf != null) {
      window.cancelAnimationFrame(this.liveRaf);
      this.liveRaf = null;
    }
    this.liveDirty = false;
    this.liveShot.reset();
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
        if (id) {
          this.completeSecondTapHint();
          this.setState({ modal: null, secondTapHint: null });
          await this.selectBean(id, { apply: true, preferWorkflow: false });
        }
        break;
      case 'inspect-bean':
        if (id) {
          const focusedId = this.state.beanPickerBeanId ?? this.state.selectedBeanId;
          if (id === focusedId) {
            this.completeSecondTapHint();
            this.setState({ modal: null, secondTapHint: null });
            if (id !== this.state.selectedBeanId) {
              await this.selectBean(id, { apply: true, preferWorkflow: false });
            }
          } else {
            await this.inspectBeanInPicker(id);
          }
        }
        break;
      case 'adjust':
        if (field) this.adjustField(field, Number(el.dataset.delta ?? '0'));
        break;
      case 'edit-field':
        if (isEditField(field)) this.openEditDialog(field);
        break;
      case 'machine-edit-value':
        this.openMachineValueDialog(el);
        break;
      case 'machine-preset':
        if (el.dataset.name && value) await this.applyMachinePreset(el.dataset.name, value);
        break;
      case 'machine-edit-label':
        this.openMachineLabelDialog(el);
        break;
      case 'machine-label-save':
        this.commitMachineLabelEdit();
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
        await this.commitEditDialog();
        break;
      case 'pe-edit-value':
        this.openProfileValueDialog(el);
        break;
      case 'go-view':
        if (value) this.goView(value as View);
        break;
      case 'select-history-shot':
        if (id) this.selectHistoryShot(id);
        break;
      case 'edit-shot':
        this.openShotEditor();
        break;
      case 'open-shot-field':
        if (isShotEditField(field)) this.setState({ shotEditField: field });
        break;
      case 'close-shot-field':
        this.setState({ shotEditField: null });
        break;
      case 'shot-field-option':
        if (isShotEditField(field)) this.applyShotEditField(field, value ?? '');
        break;
      case 'shot-edit-score':
        this.setShotEditEnjoyment(scoreValueFromTap(value, this.state.shotEdit?.enjoyment ?? null));
        break;
      case 'set-shot-score':
        if (id) {
          const shot = this.state.shots.find((item) => item.id === id);
          await this.updateShotEnjoyment(id, scoreValueFromTap(value, shot?.annotations?.enjoyment ?? null));
        }
        break;
      case 'machine-command':
        if (isMachineCommand(value)) await this.toggleMachineCommand(value);
        break;
      case 'toggle-live-chart-mode':
        this.setState({
          liveChartMode: this.state.liveChartMode === 'preset30' ? 'auto' : 'preset30'
        });
        break;
      case 'stop':
        await this.stopMachineService();
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
        void this.loadReaSettings();
        break;
      case 'settings-section':
        if (value) this.setState({ settingsSection: value });
        break;
      case 'settings-reset-machine':
        await this.resetMachineSettings();
        break;
      case 'settings-plugin-config':
        if (id) await this.togglePluginConfig(id);
        break;
      case 'settings-plugin-save':
        if (id) await this.savePluginConfig(id);
        break;
      case 'settings-plugin-verify':
        if (id) await this.verifyPluginConfig(id);
        break;
      case 'settings-scan-devices':
        await this.scanDevices();
        break;
      case 'settings-connect-device':
        if (id) await this.connectDevice(id, true);
        break;
      case 'settings-disconnect-device':
        if (id) await this.connectDevice(id, false);
        break;
      case 'settings-machine-state':
        if (value) await this.requestMachineState(value);
        break;
      case 'settings-schedule-add': {
        const timeInput = this.root.querySelector<HTMLInputElement>('[data-action="settings-schedule-time"]');
        await this.addWakeSchedule(timeInput?.value ?? '');
        break;
      }
      case 'settings-schedule-delete':
        if (id) await this.deleteWakeSchedule(id);
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
        if (this.state.modal === 'bean-picker') {
          this.setState({
            beanPickerBeanId: null,
            beanPickerMode: 'create',
            status: 'Adding bean'
          });
        } else {
          await this.openBeanPicker(null, { create: true });
        }
        break;
      case 'open-edit-bean':
        await this.openBeanPicker(id ?? this.state.selectedBeanId);
        break;
      case 'archive-bean':
        if (id) await this.archiveBean(id);
        break;
      case 'open-add-batch':
        await this.openBeanPicker(this.state.selectedBeanId);
        await this.createBatchInPicker(this.state.selectedBeanId);
        break;
      case 'bean-picker-add-batch':
        await this.createBatchInPicker(this.state.beanPickerBeanId ?? this.state.selectedBeanId);
        break;
      case 'delete-batch':
        if (id) await this.deleteBatchFromPicker(el.dataset.beanId ?? null, id);
        break;
      case 'open-add-grinder':
        this.setState({ view: 'grinder-editor', editingGrinderId: null, modal: null, editDialog: null });
        break;
      case 'open-edit-grinder':
        if (id) this.setState({ view: 'grinder-editor', editingGrinderId: id, modal: null, editDialog: null });
        break;
      case 'open-profile-picker':
        this.setState({
          view: 'profiles',
          profileSearch: '',
          profilePage: 0,
          profileFocusId: this.profileIdForDraft()
        });
        break;
      case 'open-bean-picker':
        await this.openBeanPicker(this.state.selectedBeanId);
        break;
      case 'profiles-page':
        if (value) this.setState({ profilePage: Number(value) });
        break;
      case 'focus-profile':
        if (id) this.focusProfile(id);
        break;
      case 'open-machine-settings':
        this.setState({ view: 'machine' });
        void this.loadMachineControlState();
        break;
      case 'pick-profile':
        if (id) this.pickProfile(id);
        break;
      case 'toggle-favorite-profile':
        if (id) this.toggleFavoriteProfile(id);
        break;
      case 'close-modal':
        if (this.state.profileEdit || this.state.machineEdit || this.state.machineLabelEdit) {
          this.setState({
            modal: null,
            editDialog: null,
            shotEdit: null,
            shotEditField: null,
            profileEdit: null,
            machineEdit: null,
            machineLabelEdit: null
          });
          break;
        }
        this.setState({
          modal: null,
          editingBeanId: null,
          profileEditor: null,
          editingProfileId: null,
          editDialog: null,
          shotEdit: null,
          shotEditField: null,
          profileEdit: null,
          machineEdit: null,
          machineLabelEdit: null
        });
        break;
      case 'new-profile':
        this.setState({
          view: 'profile-editor',
          editingProfileId: null,
          profileEditor: createProfileEditorState(null),
          profileEdit: null
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
      profileEdit: null
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
      profileEdit: null
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
    if (target.dataset.action === 'shot-edit-number') {
      const field = target.dataset.field;
      if (isShotEditField(field) && isShotNumberField(field)) this.applyShotEditField(field, target.value);
      return;
    }
    if (target.dataset.action?.startsWith('pe-')) {
      this.applyEditorEvent(target);
      return;
    }
    if (target.dataset.action === 'settings-field') {
      const raw = target instanceof HTMLInputElement && target.type === 'checkbox' ? target.checked : target.value;
      void this.onSettingsField(target.dataset.group ?? '', target.dataset.key ?? '', raw);
      return;
    }
    if (target.dataset.action === 'settings-plugin-toggle') {
      void this.togglePlugin(target.dataset.id ?? '', (target as HTMLInputElement).checked);
      return;
    }
    if (target.dataset.action === 'settings-plugin-field') {
      const raw = target instanceof HTMLInputElement && target.type === 'checkbox' ? target.checked : target.value;
      this.updatePluginField(target.dataset.key ?? '', raw);
      return;
    }
    if (target.dataset.action === 'settings-schedule-toggle') {
      void this.toggleWakeSchedule(target.dataset.id ?? '', (target as HTMLInputElement).checked);
      return;
    }
    if (target.dataset.action === 'settings-firmware') {
      const file = (target as HTMLInputElement).files?.[0];
      if (file) void this.uploadFirmware(file);
      return;
    }
    if (target.dataset.action === 'bean-picker-batch-field') {
      const form = target.closest<HTMLFormElement>('[data-form="bean-picker-batch"]');
      if (form) await this.saveBeanPickerBatch(form);
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
    if (form.dataset.form === 'shot-field-dialog') {
      event.preventDefault();
      this.commitShotFieldDialog(form);
      return;
    }
    if (form.dataset.form === 'shot-dye-editor') {
      event.preventDefault();
      await this.submitShotDyeEditor(form);
      return;
    }
    if (form.dataset.form === 'bean-editor') {
      event.preventDefault();
      await this.submitBeanEditor(form);
      return;
    }
    if (form.dataset.form === 'bean-picker-bean') {
      event.preventDefault();
      await this.submitBeanPickerBean(form);
      return;
    }
    if (form.dataset.form === 'bean-picker-batch') {
      event.preventDefault();
      await this.submitBeanPickerBatch(form);
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
  }

  private async submitBeanEditor(form: HTMLFormElement): Promise<void> {
    const data = new FormData(form);
    const fields = beanFieldsFromForm(data);
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

  private async submitBeanPickerBean(form: HTMLFormElement): Promise<void> {
    const data = new FormData(form);
    const fields = beanFieldsFromForm(data);
    if (!fields.roaster || !fields.name) return;

    const editingId = form.dataset.id || null;
    this.setState({ busy: true, status: editingId ? 'Saving bean' : 'Adding bean' });

    if (this.state.demo) {
      const bean: Bean = editingId
        ? { ...(this.state.beans.find((item) => item.id === editingId) as Bean), ...fields }
        : ({ id: `demo-${Date.now()}`, ...fields } as Bean);
      const beans = editingId
        ? this.state.beans.map((item) => (item.id === editingId ? bean : item))
        : [bean, ...this.state.beans];
      this.setState({
        beans,
        batchesByBean: editingId ? this.state.batchesByBean : { ...this.state.batchesByBean, [bean.id]: [] },
        beanPickerBeanId: bean.id,
        beanPickerMode: 'inspect',
        busy: false,
        status: editingId ? 'Bean saved (demo)' : 'Bean added (demo)'
      });
      return;
    }

    try {
      const bean = editingId ? await gateway.updateBean(editingId, fields) : await gateway.createBean(fields);
      const beans = editingId
        ? this.state.beans.map((item) => (item.id === editingId ? bean : item))
        : [bean, ...this.state.beans];
      this.setState({
        beans,
        batchesByBean: editingId ? this.state.batchesByBean : { ...this.state.batchesByBean, [bean.id]: [] },
        beanPickerBeanId: bean.id,
        beanPickerMode: 'inspect',
        busy: false,
        status: editingId ? 'Bean saved' : 'Bean added'
      });
    } catch (error) {
      console.error('[Beanie] Save bean failed', error);
      this.setState({ busy: false, status: 'Save bean failed' });
    }
  }

  private async archiveBean(id: string): Promise<void> {
    if (!window.confirm('Delete this bag? It will be hidden from the bean list.')) return;
    this.setState({ busy: true, status: 'Deleting bag' });
    if (!this.state.demo) {
      try {
        await gateway.updateBean(id, { archived: true });
      } catch (error) {
        console.error('[Beanie] Delete bean failed', error);
        this.setState({ busy: false, status: 'Delete failed' });
        return;
      }
    }
    const beans = this.state.beans.filter((bean) => bean.id !== id);
    this.setState({
      beans,
      view: 'workbench',
      editingBeanId: null,
      modal: this.state.modal === 'bean-picker' ? null : this.state.modal,
      busy: false,
      status: 'Bag deleted'
    });
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
    const batchInput = batchFieldsFromForm(data, bean.id);

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

  private async createBatchInPicker(beanId: string | null): Promise<void> {
    if (!beanId) return;
    const bean = this.state.beans.find((item) => item.id === beanId);
    if (!bean) return;
    const current = this.state.batchesByBean[bean.id] ?? [];
    const latest = latestBatch(current);
    const batchInput: Partial<BeanBatch> = {
      beanId: bean.id,
      roastDate: todayDateInputValue(),
      roastLevel: latest?.roastLevel ?? null,
      weight: latest?.weight ?? null,
      weightRemaining: latest?.weight ?? null,
      frozen: false
    };

    this.setState({ status: 'Adding batch' });
    if (this.state.demo) {
      const batch: BeanBatch = { id: `demo-batch-${Date.now()}`, ...batchInput } as BeanBatch;
      const batches = [batch, ...current];
      this.setState({
        batchesByBean: { ...this.state.batchesByBean, [bean.id]: batches },
        selectedBatchId: bean.id === this.state.selectedBeanId ? batch.id : this.state.selectedBatchId,
        status: 'Batch added (demo)'
      });
      if (bean.id === this.state.selectedBeanId) this.scheduleApply();
      return;
    }

    try {
      const batch = await gateway.createBatch(bean.id, batchInput);
      const batches = [batch, ...(this.state.batchesByBean[bean.id] ?? [])];
      this.setState({
        batchesByBean: { ...this.state.batchesByBean, [bean.id]: batches },
        selectedBatchId: bean.id === this.state.selectedBeanId ? batch.id : this.state.selectedBatchId,
        status: 'Batch added'
      });
      if (bean.id === this.state.selectedBeanId) this.scheduleApply();
    } catch (error) {
      console.error('[Beanie] Add batch failed', error);
      this.setState({ status: 'Add batch failed' });
    }
  }

  private async saveBeanPickerBatch(form: HTMLFormElement): Promise<void> {
    const beanId = form.dataset.beanId;
    const batchId = form.dataset.batchId;
    if (!beanId || !batchId) return;
    const bean = this.state.beans.find((item) => item.id === beanId);
    if (!bean) return;
    const current = this.state.batchesByBean[bean.id] ?? [];
    const previous = current.find((item) => item.id === batchId);
    if (!previous) return;
    const batchInput = batchFieldsFromForm(new FormData(form), bean.id);
    const optimistic: BeanBatch = { ...previous, ...batchInput, id: batchId, beanId: bean.id };
    const optimisticBatches = current.map((item) => (item.id === batchId ? optimistic : item));

    this.setState({
      batchesByBean: { ...this.state.batchesByBean, [bean.id]: optimisticBatches },
      status: 'Batch saved'
    });
    if (bean.id === this.state.selectedBeanId && latestBatch(optimisticBatches)?.id === batchId) this.scheduleApply();
    if (this.state.demo) return;

    try {
      const saved = await gateway.updateBatch(batchId, batchInput);
      const latest = this.state.batchesByBean[bean.id] ?? [];
      this.setState({
        batchesByBean: {
          ...this.state.batchesByBean,
          [bean.id]: latest.map((item) => (item.id === batchId ? saved : item))
        },
        status: 'Batch saved'
      });
    } catch (error) {
      console.error('[Beanie] Save batch failed', error);
      this.setState({
        batchesByBean: { ...this.state.batchesByBean, [bean.id]: current },
        status: 'Save batch failed'
      });
    }
  }

  private async deleteBatchFromPicker(beanId: string | null, batchId: string): Promise<void> {
    if (!beanId) return;
    const bean = this.state.beans.find((item) => item.id === beanId);
    if (!bean) return;
    const current = this.state.batchesByBean[bean.id] ?? [];
    const batch = current.find((item) => item.id === batchId);
    if (!batch) return;
    if (!window.confirm(`Delete ${batchOptionLabel(batch)}?`)) return;

    const previousSelectedBatchId = this.state.selectedBatchId;
    const batches = current.filter((item) => item.id !== batchId);
    const selectedBatchId =
      bean.id === this.state.selectedBeanId ? latestBatch(batches)?.id ?? null : previousSelectedBatchId;

    this.setState({
      batchesByBean: { ...this.state.batchesByBean, [bean.id]: batches },
      selectedBatchId,
      status: 'Batch deleted'
    });
    if (bean.id === this.state.selectedBeanId) this.scheduleApply();
    if (this.state.demo) return;

    try {
      await gateway.deleteBatch(batchId);
    } catch (error) {
      console.error('[Beanie] Delete batch failed', error);
      this.setState({
        batchesByBean: { ...this.state.batchesByBean, [bean.id]: current },
        selectedBatchId: previousSelectedBatchId,
        status: 'Delete batch failed'
      });
    }
  }

  private async submitBeanPickerBatch(form: HTMLFormElement): Promise<void> {
    const beanId = form.dataset.beanId;
    if (!beanId) return;
    const bean = this.state.beans.find((item) => item.id === beanId);
    if (!bean) return;
    const batchId = form.dataset.batchId || null;
    const batchInput = batchFieldsFromForm(new FormData(form), bean.id);

    this.setState({ busy: true, status: batchId ? 'Saving batch' : 'Adding batch' });
    if (this.state.demo) {
      const current = this.state.batchesByBean[bean.id] ?? [];
      const batch: BeanBatch = batchId
        ? { ...(current.find((item) => item.id === batchId) as BeanBatch), ...batchInput, id: batchId }
        : ({ id: `demo-batch-${Date.now()}`, ...batchInput } as BeanBatch);
      const batches = batchId
        ? current.map((item) => (item.id === batchId ? batch : item))
        : [batch, ...current];
      this.setState({
        batchesByBean: { ...this.state.batchesByBean, [bean.id]: batches },
        selectedBatchId: bean.id === this.state.selectedBeanId && !batchId ? batch.id : this.state.selectedBatchId,
        busy: false,
        status: batchId ? 'Batch saved (demo)' : 'Batch added (demo)'
      });
      return;
    }

    try {
      const batch = batchId
        ? await gateway.updateBatch(batchId, batchInput)
        : await gateway.createBatch(bean.id, batchInput);
      const current = this.state.batchesByBean[bean.id] ?? [];
      const batches = batchId
        ? current.map((item) => (item.id === batchId ? batch : item))
        : [batch, ...current];
      this.setState({
        batchesByBean: { ...this.state.batchesByBean, [bean.id]: batches },
        selectedBatchId: bean.id === this.state.selectedBeanId && !batchId ? batch.id : this.state.selectedBatchId,
        busy: false,
        status: batchId ? 'Batch saved' : 'Batch added'
      });
    } catch (error) {
      console.error('[Beanie] Save batch failed', error);
      this.setState({ busy: false, status: batchId ? 'Save batch failed' : 'Add batch failed' });
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

    const editingId = this.state.editingGrinderId;
    this.setState({ busy: true, status: editingId ? 'Saving grinder' : 'Adding grinder' });
    const selectGrinder = (grinder: Grinder, status: string, grinders?: Grinder[]) => {
      this.setState({
        grinders: grinders ?? [grinder, ...this.state.grinders],
        draft: { ...this.state.draft, grinderId: grinder.id, grinderModel: grinder.model },
        view: 'workbench',
        editingGrinderId: null,
        editDialog: null,
        busy: false,
        status
      });
      this.scheduleApply();
    };

    if (this.state.demo) {
      if (editingId) {
        const previous = this.state.grinders.find((grinder) => grinder.id === editingId);
        const grinder: Grinder = { ...(previous ?? { id: editingId }), ...grinderInput } as Grinder;
        const grinders = this.state.grinders.map((item) => (item.id === editingId ? grinder : item));
        selectGrinder(grinder, 'Grinder saved (demo)', grinders);
      } else {
        const grinder: Grinder = { id: `demo-grinder-${Date.now()}`, ...grinderInput } as Grinder;
        selectGrinder(grinder, 'Grinder added (demo)');
      }
      return;
    }

    try {
      if (editingId) {
        const grinder = await gateway.updateGrinder(editingId, grinderInput);
        const grinders = this.state.grinders.map((item) => (item.id === editingId ? grinder : item));
        selectGrinder(grinder, 'Grinder saved', grinders);
      } else {
        const grinder = await gateway.createGrinder(grinderInput);
        selectGrinder(grinder, 'Grinder added');
      }
    } catch (error) {
      console.error('[Beanie] Save grinder failed', error);
      this.setState({ busy: false, status: 'Save grinder failed' });
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
      profileEdit: null,
      machineEdit: null,
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

  // Tap a control's value → numpad dialog bound to that editor field.
  private openProfileValueDialog(el: HTMLElement): void {
    const target = el.dataset.target;
    if (!target) return;
    const value = el.dataset.value ?? '0';
    const title = el.dataset.title ?? 'Value';
    const unit = el.dataset.unit ?? '';
    const min = Number(el.dataset.min ?? '0');
    const max = Number(el.dataset.max ?? '100');
    const step = Number(el.dataset.step ?? '1');
    const digits = step < 1 ? 1 : 0;

    this.setState({
      modal: 'edit-number',
      machineEdit: null,
      profileEdit: {
        target: target as ProfileEditTarget['target'],
        key: el.dataset.key,
        index: el.dataset.index != null ? Number(el.dataset.index) : undefined,
        type: el.dataset.type === 'flow' ? 'flow' : el.dataset.type === 'pressure' ? 'pressure' : undefined,
        condition: el.dataset.condition === 'under' ? 'under' : el.dataset.condition === 'over' ? 'over' : undefined
      },
      editDialog: createInputDialog({
        field: 'temperature',
        kind: 'grind',
        title,
        value,
        unit,
        min,
        max,
        step,
        bigStep: step < 1 ? 1 : Math.max(5, step * 5),
        digits,
        helper: `Between ${min} and ${max}`,
        maxLength: 6,
        recentValues: []
      })
    });
  }

  private openMachineValueDialog(el: HTMLElement): void {
    const name = el.dataset.name;
    if (!name) return;
    const min = Number(el.dataset.min ?? '0');
    const max = Number(el.dataset.max ?? '100');
    const step = Number(el.dataset.step ?? '1');
    const unit = el.dataset.unit ?? '';
    const title = el.dataset.title ?? 'Value';
    const value = el.dataset.value ?? '';
    const spec: NumberSpec = { min, max, step, unit, enabled: true };

    this.setState({
      modal: 'edit-number',
      profileEdit: null,
      machineLabelEdit: null,
      machineEdit: { name, title, unit, spec },
      editDialog: createInputDialog({
        field: 'temperature',
        kind: 'grind',
        title,
        value,
        unit,
        min,
        max,
        step,
        bigStep: step < 1 ? 1 : Math.max(5, step * 5),
        digits: step < 1 ? 1 : 0,
        helper: `Between ${min} and ${max}`,
        maxLength: 6,
        recentValues: []
      })
    });
  }

  private openMachineLabelDialog(el: HTMLElement): void {
    const presetName = el.dataset.name;
    const presetId = el.dataset.value;
    const label = el.dataset.label ?? '';
    if (!presetName || !presetId) return;
    this.setState({
      modal: 'machine-label',
      editDialog: null,
      profileEdit: null,
      machineEdit: null,
      machineLabelEdit: { presetName, presetId, label }
    });
  }

  private commitMachineLabelEdit(): void {
    const edit = this.state.machineLabelEdit;
    if (!edit) return;
    const input = this.root.querySelector<HTMLInputElement>('[data-action="machine-label-input"]');
    const label = (input?.value ?? '').trim();
    if (!label) return;
    const machinePresetLabels = {
      ...this.state.machinePresetLabels,
      [machinePresetLabelKey(edit.presetName, edit.presetId)]: label
    };
    writeMachinePresetLabels(machinePresetLabels);
    this.setState({
      machinePresetLabels,
      modal: null,
      machineLabelEdit: null,
      status: 'Button renamed'
    });
  }

  private async applyMachinePreset(name: string, presetId: string): Promise<void> {
    const capabilities = this.machineCapabilitiesForControls();
    let steamSettings = this.currentSteamSettings();
    let hotWaterData = this.currentHotWaterData();
    let rinseData = this.currentRinseData();

    if (name === 'steamPreset') {
      const preset = machinePresetsWithValues(name, STEAM_PRESETS, this.state.machinePresetValues)
        .find((item) => item.id === presetId);
      if (!preset) return;
      steamSettings = clampSteam({ ...DEFAULT_STEAM, ...preset.values }, capabilities);
    }
    if (name === 'waterPreset') {
      const preset = machinePresetsWithValues(name, HOT_WATER_PRESETS, this.state.machinePresetValues)
        .find((item) => item.id === presetId);
      if (!preset) return;
      hotWaterData = clampHotWater({ ...DEFAULT_HOT_WATER, ...preset.values }, capabilities);
    }
    if (name === 'flushPreset') {
      const preset = machinePresetsWithValues(name, FLUSH_PRESETS, this.state.machinePresetValues)
        .find((item) => item.id === presetId);
      if (!preset) return;
      rinseData = clampFlush({ ...DEFAULT_RINSE, ...preset.values }, capabilities);
    }

    await this.setMachineWorkflow(steamSettings, hotWaterData, rinseData, 'Machine preset saved');
  }

  private async applyMachineValue(name: string, value: number | null): Promise<void> {
    if (value == null) return;
    const capabilities = this.machineCapabilitiesForControls();
    const steamSettings = this.currentSteamSettings();
    const hotWaterData = this.currentHotWaterData();
    const rinseData = this.currentRinseData();
    const selectedSteamPreset = matchingPreset(
      steamSettings,
      machinePresetsWithValues('steamPreset', STEAM_PRESETS, this.state.machinePresetValues)
    );
    const selectedWaterPreset = matchingPreset(
      hotWaterData,
      machinePresetsWithValues('waterPreset', HOT_WATER_PRESETS, this.state.machinePresetValues)
    );
    const selectedFlushPreset = matchingPreset(
      rinseData,
      machinePresetsWithValues('flushPreset', FLUSH_PRESETS, this.state.machinePresetValues)
    );

    if (name === 'steamFlow') steamSettings.flow = value;
    if (name === 'steamTemp') steamSettings.targetTemperature = value;
    if (name === 'steamDuration') steamSettings.duration = value;
    if (name === 'steamStopTemp') steamSettings.stopAtTemperature = value;
    if (name === 'waterTemp') hotWaterData.targetTemperature = value;
    if (name === 'waterFlow') hotWaterData.flow = value;
    if (name === 'waterVolume') hotWaterData.volume = value;
    if (name === 'waterDuration') hotWaterData.duration = value;
    if (name === 'flushDuration') rinseData.duration = value;
    if (name === 'flushFlow') rinseData.flow = value;
    if (name === 'flushTemp') rinseData.targetTemperature = value;

    const nextSteamSettings = clampSteam(steamSettings, capabilities);
    const nextHotWaterData = clampHotWater(hotWaterData, capabilities);
    const nextRinseData = clampFlush(rinseData, capabilities);
    this.savePresetValuesAfterMachineEdit(
      name,
      selectedSteamPreset,
      selectedWaterPreset,
      selectedFlushPreset,
      nextSteamSettings,
      nextHotWaterData,
      nextRinseData
    );

    await this.setMachineWorkflow(
      nextSteamSettings,
      nextHotWaterData,
      nextRinseData,
      'Machine setting saved'
    );
  }

  private savePresetValuesAfterMachineEdit(
    fieldName: string,
    selectedSteamPreset: string,
    selectedWaterPreset: string,
    selectedFlushPreset: string,
    steamSettings: SteamSettings,
    hotWaterData: HotWaterData,
    rinseData: RinseData
  ): void {
    let key: string | null = null;
    let values: object | null = null;
    if (fieldName.startsWith('steam') && selectedSteamPreset !== 'custom') {
      key = machinePresetLabelKey('steamPreset', selectedSteamPreset);
      values = steamSettings;
    }
    if (fieldName.startsWith('water') && selectedWaterPreset !== 'custom') {
      key = machinePresetLabelKey('waterPreset', selectedWaterPreset);
      values = hotWaterData;
    }
    if (fieldName.startsWith('flush') && selectedFlushPreset !== 'custom') {
      key = machinePresetLabelKey('flushPreset', selectedFlushPreset);
      values = rinseData;
    }
    if (!key || !values) return;

    const machinePresetValues = {
      ...this.state.machinePresetValues,
      [key]: numericPresetValues(values)
    };
    writeMachinePresetValues(machinePresetValues);
    this.setState({ machinePresetValues });
  }

  private async setMachineWorkflow(
    steamSettings: SteamSettings,
    hotWaterData: HotWaterData,
    rinseData: RinseData,
    status: string
  ): Promise<void> {
    const workflow: Workflow = {
      ...(this.state.workflow ?? {}),
      steamSettings,
      hotWaterData,
      rinseData
    };
    const machineSettings = machineSettingsFromWorkflow(steamSettings, hotWaterData, rinseData, this.state.machineSettings);
    const machinePatch = machineSettingsPatchFromWorkflow(steamSettings, hotWaterData, rinseData);
    this.setState({
      workflow,
      machineSettings,
      busy: true,
      status: `${status}...`
    });
    if (this.state.demo) {
      this.setState({ busy: false, status: `${status} (demo)` });
      return;
    }
    try {
      const saved = await gateway.updateWorkflow(workflow);
      let directMachineSaved = true;
      try {
        await gateway.updateMachineSettings(machinePatch);
      } catch (error) {
        directMachineSaved = false;
        console.error('[Beanie] Direct machine settings update failed', error);
      }
      this.setState({
        workflow: { ...saved, steamSettings, hotWaterData, rinseData },
        machineSettings,
        busy: false,
        status: directMachineSaved ? status : `${status}; direct machine update failed`
      });
      if (directMachineSaved) void this.loadMachineControlState();
    } catch (error) {
      console.error('[Beanie] Save machine settings failed', error);
      this.setState({ busy: false, status: 'Machine settings save failed' });
    }
  }

  private machineCapabilitiesForControls(): WaterControlCapabilities {
    return waterControlCapabilities({
      capabilities: this.state.machineCapabilities,
      settings: this.state.machineSettings,
      demo: this.state.demo
    });
  }

  private currentSteamSettings(): SteamSettings {
    if (this.state.workflow?.steamSettings) return steamValues(this.state.workflow, null);
    return steamValues(this.state.workflow, this.state.machineSettings);
  }

  private currentHotWaterData(): HotWaterData {
    if (this.state.workflow?.hotWaterData) return hotWaterValues(this.state.workflow, null);
    return hotWaterValues(this.state.workflow, this.state.machineSettings);
  }

  private currentRinseData(): RinseData {
    if (this.state.workflow?.rinseData) return flushValues(this.state.workflow, null);
    return flushValues(this.state.workflow, this.state.machineSettings);
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
    if (this.state.profileEdit) {
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

  private applyProfileEdit(pe: ProfileEditorState, edit: ProfileEditTarget, value: string): ProfileEditorState {
    if (edit.target === 'step-field' && edit.key != null && edit.index != null) {
      return setStepField(pe, edit.index, edit.key as StepFieldKey, value);
    }
    if (edit.target === 'simple-field' && edit.key != null) {
      return setSimpleProfileField(pe, edit.key as SimpleProfileField, value);
    }
    if (edit.target === 'exit' && edit.index != null) {
      return setStepExit(pe, edit.index, { type: edit.type, condition: edit.condition, value: Number(value) || 0 });
    }
    return pe;
  }

  private async commitEditDialog(): Promise<void> {
    const dialog = this.state.editDialog;
    if (!dialog) return;

    const value = inputDialogCommitValue(dialog);
    const machineEdit = this.state.machineEdit;
    if (machineEdit) {
      this.setState({
        modal: null,
        editDialog: null,
        machineEdit: null,
        status: 'Machine setting changed'
      });
      await this.applyMachineValue(machineEdit.name, parseNumberInput(value));
      return;
    }

    const edit = this.state.profileEdit;
    if (edit) {
      const pe = this.state.profileEditor;
      this.setState({
        profileEditor: pe ? this.applyProfileEdit(pe, edit, value) : null,
        modal: null,
        editDialog: null,
        profileEdit: null,
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
        ${isPage ? '' : this.renderLivePanel()}
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
    const chart = new LiveChart(canvas, { detailed: true, pixelScale: 3 });
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
    if (!FOCUSABLE_SEARCH.has(action) && !action.startsWith('pe-') && action !== 'shot-edit-number') return null;
    const parts = [`[data-action="${action}"]`];
    if (active?.dataset.field != null) parts.push(`[data-field="${active.dataset.field}"]`);
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
    const preset30 = this.state.liveChartMode === 'preset30';
    return `
      <div class="live-panel">
        <div class="live-card panel">
          <div class="live-head">
            <div class="live-title-row">
              <span class="eyebrow">Live shot</span>
              <button
                class="live-chart-toggle ${preset30 ? 'active' : ''}"
                data-action="toggle-live-chart-mode"
                aria-pressed="${preset30 ? 'true' : 'false'}"
                aria-label="${preset30 ? '30 second chart preset' : 'Auto chart scale'}"
                title="${preset30 ? '30 second chart preset' : 'Auto chart scale'}"
              >
                ${icon('timer')}
                <span>${preset30 ? '30s' : 'Auto'}</span>
              </button>
              <button
                class="live-stop-button"
                data-action="stop"
                aria-label="Stop shot"
                title="Stop shot"
                ${this.state.busy ? 'disabled' : ''}
              >
                ${icon('square')}
                <span>Stop</span>
              </button>
            </div>
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
    const machine = this.state.machine;
    const scale = this.state.scale;
    const machineCommands = this.renderMachineCommands();
    return `
      <header class="topbar">
        <div class="top-inline">
          <div class="top-stats" aria-label="Machine metrics">
            ${topStat('Status', machineStatus(machine, this.state.loading), 'stat-machine')}
            ${topStat('Group', temp(machine?.groupTemperature), 'stat-group')}
            ${topStat('Steam', temp(machine?.steamTemperature), 'stat-steam')}
            ${topStat('Water', water(this.state.waterLevel), 'stat-water')}
            ${topStat('Scale', scale?.status === 'disconnected' ? 'offline' : `${formatNumber(scale?.weight, 1)} g`, 'stat-scale')}
          </div>
          ${machineCommands}
          <div class="top-icons" role="toolbar" aria-label="Skin actions">
            <button class="icon-tool" data-action="open-machine-settings" aria-label="Machine settings" title="Machine settings">${icon('droplet')}</button>
            <button class="icon-tool" data-action="open-settings" aria-label="Settings" title="Settings">${icon('settings')}</button>
            <button class="icon-tool" data-action="sleep" aria-label="Sleep" title="Sleep">${icon('power')}</button>
          </div>
        </div>
      </header>
    `;
  }

  private renderMachineCommands(): string {
    if (!machineCommandsAvailable(this.state.demo, this.state.machineInfo)) return '';
    const current = this.state.machine?.state?.state ?? 'idle';
    const commands: Array<{ state: MachineState; label: string; icon: string }> = [
      { state: 'espresso', label: 'Shot', icon: 'coffee' },
      { state: 'steam', label: 'Steam', icon: 'waves' },
      { state: 'flush', label: 'Flush', icon: 'refresh-cw' },
      { state: 'hotWater', label: 'Water', icon: 'droplets' }
    ];
    return `
      <div class="top-machine-actions" role="toolbar" aria-label="Machine commands">
        ${commands
          .map(({ state, label, icon: iconName }) => {
            const active = current === state;
            const disabled = this.state.busy ? ' disabled' : '';
            const title = active ? `Stop ${label.toLowerCase()}` : label;
            return `
              <button
                class="machine-command ${active ? 'active' : ''}"
                data-action="machine-command"
                data-value="${escapeAttr(state)}"
                aria-pressed="${active ? 'true' : 'false'}"
                aria-label="${escapeAttr(title)}"
                title="${escapeAttr(title)}"
                ${disabled}
              >
                ${icon(iconName)}
                <span>${escapeHtml(label)}</span>
              </button>
            `;
          })
          .join('')}
      </div>
    `;
  }

  private renderBeanPickerModal(): string {
    const query = this.state.search.trim().toLowerCase();
    const matches = this.state.beans.filter((bean) => beanLabel(bean).toLowerCase().includes(query));
    const focused = this.beanPickerFocusedBean();
    const focusedId = focused?.id ?? null;
    return `
      <div class="modal-backdrop bean-picker-backdrop" data-action="close-modal">
        <section class="modal panel bean-picker-modal" role="dialog" aria-modal="true" aria-label="Pick a bag" data-action="noop">
          <div class="modal-head bean-picker-head">
            <div>
              <span class="eyebrow">Beans</span>
              <h2>Pick a bag</h2>
            </div>
            <div class="modal-head-actions">
              <button class="icon-button" data-action="refresh" aria-label="Sync beans" title="Sync beans">${icon('refresh-cw')}</button>
              <button class="icon-button" data-action="open-add-bean" aria-label="Add bean" title="Add bean">${icon('plus')}</button>
              <button class="icon-button" data-action="close-modal" aria-label="Close" title="Close">${icon('x')}</button>
            </div>
          </div>
          <div class="bean-picker-body">
            <div class="bean-picker-list-panel">
              <label class="search bean-picker-search">
                ${icon('search')}
                <input type="search" data-action="search" value="${escapeAttr(this.state.search)}" placeholder="Search beans" autofocus />
              </label>
              <div class="bean-picker-list">
                ${
                  matches.length === 0
                    ? '<p class="empty-history">No beans found.</p>'
                    : matches.map((bean) => this.renderBeanPickerRow(bean, bean.id === focusedId)).join('')
                }
              </div>
            </div>
            ${this.renderBeanPickerInspector(focused)}
          </div>
        </section>
      </div>
    `;
  }

  private beanPickerFocusedBean(): Bean | null {
    if (this.state.beanPickerMode === 'create') return null;
    const id = this.state.beanPickerBeanId ?? this.state.selectedBeanId;
    return this.state.beans.find((bean) => bean.id === id) ?? this.selectedBean();
  }

  private renderBeanPickerRow(bean: Bean, focused: boolean): string {
    const current = bean.id === this.state.selectedBeanId;
    const hint = this.renderSecondTapHint('bean', bean.id);
    return `
      <button class="bean-row ${focused ? 'active' : ''} ${hint ? 'has-second-tap-hint' : ''}" data-action="inspect-bean" data-id="${escapeAttr(bean.id)}">
        <span>
          <small>${escapeHtml(bean.country ?? 'Recent bean')}</small>
          <b>${escapeHtml(bean.roaster)}</b>
          <strong>${escapeHtml(bean.name)}</strong>
        </span>
        ${current ? '<em>In use</em>' : ''}
        ${hint}
      </button>
    `;
  }

  private renderBeanPickerInspector(bean: Bean | null): string {
    if (this.state.beanPickerMode === 'create' || !bean) {
      return `
        <div class="bean-picker-inspector">
          ${this.renderBeanPickerBeanForm(null)}
          <p class="bean-picker-hint">Save the bag first, then add roast batches.</p>
        </div>
      `;
    }

    const batches = this.state.batchesByBean[bean.id] ?? [];
    const visibleBatches = recentBatches(batches, 2);
    const currentBatchId = latestBatch(batches)?.id ?? null;
    return `
      <div class="bean-picker-inspector">
        ${this.renderBeanPickerBeanForm(bean)}
        <div class="bean-picker-batches">
          <div class="bean-picker-section-head">
            <div>
              <span class="eyebrow">Batches</span>
              <strong>${escapeHtml(batches.length === 0 ? 'None' : batchOptionLabel(latestBatch(batches)!))}</strong>
            </div>
            <button type="button" class="secondary-button compact" data-action="bean-picker-add-batch">${icon('plus')}<span>Batch</span></button>
          </div>
          <div class="bean-picker-batch-list">
            ${
              batches.length === 0
                ? '<p class="empty-history">No batches yet.</p>'
                : visibleBatches.map((batch) => this.renderBeanPickerBatchForm(bean, batch, batch.id === currentBatchId)).join('')
            }
          </div>
        </div>
      </div>
    `;
  }

  private renderBeanPickerBeanForm(bean: Bean | null): string {
    const editing = bean != null;
    const dataId = editing ? ` data-id="${escapeAttr(bean.id)}"` : '';
    return `
      <form class="bean-picker-bean-form" data-form="bean-picker-bean"${dataId}>
        <div class="bean-picker-section-head">
          <div>
            <span class="eyebrow">${editing ? 'Bean' : 'New bean'}</span>
            <strong>${escapeHtml(editing ? beanLabel(bean) : 'Add a bag')}</strong>
          </div>
          <div class="bean-picker-actions">
            ${
              editing
                ? `<button type="button" class="secondary-button compact" data-action="select-bean" data-id="${escapeAttr(bean.id)}">${icon('check')}<span>Use</span></button>
                   <button type="submit" class="primary-button compact">${icon('check')}<span>Save</span></button>
                   <button type="button" class="icon-button subtle-danger bean-delete-button" data-action="archive-bean" data-id="${escapeAttr(bean.id)}" aria-label="Delete bag" title="Delete bag">${icon('trash-2')}</button>`
                : `<button type="button" class="secondary-button compact" data-action="close-modal"><span>Cancel</span></button>`
            }
            ${editing ? '' : `<button type="submit" class="primary-button compact">${icon('check')}<span>Save</span></button>`}
          </div>
        </div>
        <div class="bean-picker-fields">
          <label>Roaster<input name="roaster" required autocomplete="off" value="${escapeAttr(editing ? bean.roaster : '')}" /></label>
          <label>Bean<input name="name" required autocomplete="off" value="${escapeAttr(editing ? bean.name : '')}" /></label>
          <label>Country<input name="country" autocomplete="off" value="${escapeAttr(inputValue(editing ? bean.country : ''))}" /></label>
          <label>Region<input name="region" autocomplete="off" value="${escapeAttr(inputValue(editing ? bean.region : ''))}" /></label>
          <label>Process<input name="processing" autocomplete="off" value="${escapeAttr(inputValue(editing ? bean.processing : ''))}" /></label>
          <label class="bean-picker-notes">Notes<textarea name="notes" rows="4" autocomplete="off">${escapeHtml(inputValue(editing ? bean.notes : ''))}</textarea></label>
        </div>
      </form>
    `;
  }

  private renderBeanPickerBatchForm(bean: Bean, batch: BeanBatch, active: boolean): string {
    return `
      <form
        class="bean-picker-batch ${active ? 'current' : ''}"
        data-form="bean-picker-batch"
        data-bean-id="${escapeAttr(bean.id)}"
        data-batch-id="${escapeAttr(batch.id)}"
      >
        <div class="bean-picker-batch-title">
          <strong>${escapeHtml(batchOptionLabel(batch))}</strong>
          <small>${escapeHtml(active ? 'Latest' : batch.frozen ? 'Frozen' : batch.roastLevel ?? 'Batch')}</small>
        </div>
        <label>Date<input data-action="bean-picker-batch-field" type="date" name="roastDate" value="${escapeAttr(dateInputValue(batch.roastDate))}" /></label>
        <label>Roast<input data-action="bean-picker-batch-field" name="roastLevel" autocomplete="off" value="${escapeAttr(inputValue(batch.roastLevel))}" /></label>
        <label>Bag<input data-action="bean-picker-batch-field" type="number" name="weight" min="0" step="0.1" inputmode="decimal" value="${escapeAttr(inputValue(batch.weight))}" /></label>
        <label>Left<input data-action="bean-picker-batch-field" type="number" name="weightRemaining" min="0" step="0.1" inputmode="decimal" value="${escapeAttr(inputValue(batch.weightRemaining))}" /></label>
        <label class="bean-picker-check" title="Frozen"><input data-action="bean-picker-batch-field" type="checkbox" name="frozen" ${batch.frozen ? 'checked' : ''} /><span>Frozen</span></label>
        <button type="button" class="icon-button danger-icon bean-picker-batch-delete" data-action="delete-batch" data-id="${escapeAttr(batch.id)}" data-bean-id="${escapeAttr(bean.id)}" aria-label="Delete batch" title="Delete batch">${icon('trash-2')}</button>
      </form>
    `;
  }

  private renderHero(bean: Bean | null): string {
    const title = bean ? beanLabel(bean) : 'Pick a bag';
    return `
      <section class="hero panel">
        <div class="hero-main">
          <div class="hero-title-row">
            <button class="bean-title-button" data-action="open-bean-picker" aria-label="Choose bean" title="Choose bean">
              <span>${escapeHtml(title)}</span>
              ${icon('chevron-down')}
            </button>
            ${
              bean
                ? `<div class="hero-bean-actions">
                    <button class="icon-button" data-action="open-edit-bean" data-id="${escapeAttr(bean.id)}" aria-label="Edit bean" title="Edit bean">${icon('pencil')}</button>
                    <button class="icon-button subtle-danger" data-action="archive-bean" data-id="${escapeAttr(bean.id)}" aria-label="Delete bag" title="Delete bag">${icon('trash-2')}</button>
                  </div>`
                : ''
            }
          </div>
        </div>
        <div class="hero-side">
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
        ${this.controlProfile()}
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

  private controlProfile(): string {
    const title = this.state.draft.profileTitle ?? 'No profile';
    return `
      <div class="select-control profile-control panel">
        <label>Profile</label>
        <button type="button" class="profile-button" data-action="open-profile-picker">
          <span>${escapeHtml(title)}</span>
          ${icon('sliders-horizontal')}
        </button>
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
      const ga = this.profileGroupLabel(a, favorites);
      const gb = this.profileGroupLabel(b, favorites);
      if (ga !== gb) return ga.localeCompare(gb, undefined, { sensitivity: 'base' });
      return profileShortTitle(a.profile.title ?? a.id).localeCompare(
        profileShortTitle(b.profile.title ?? b.id),
        undefined,
        { sensitivity: 'base' }
      );
    });
    const focus =
      sorted.find((record) => record.id === this.state.profileFocusId) ??
      sorted.find((record) => record.id === selectedId) ??
      sorted[0] ??
      null;
    const actions = `<button class="icon-button" data-action="new-profile" aria-label="New profile" title="New profile">${icon('plus')}</button>`;

    return `
      ${this.pageHeader('Profiles', 'workbench', actions)}
      <main class="page-body profiles-page">
        <label class="search">
          ${icon('search')}
          <input type="search" data-action="profile-search" value="${escapeAttr(this.state.profileSearch)}" placeholder="Search profiles" />
        </label>
        <section class="profile-selector-shell">
          <div class="profile-list">
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

  // Group key for the picker: favorites cluster first, otherwise group by the
  // title's folder prefix (e.g. "A-Flow/…") or, lacking one, by author.
  private profileGroupLabel(record: ProfileRecord, favorites: Set<string>): string {
    if (favorites.has(record.id)) return 'Favorites';
    return profileGroup(record.profile.title ?? record.id, record.profile.author);
  }

  private renderProfileRows(
    records: ProfileRecord[],
    favorites: Set<string>,
    selectedId: string | null,
    focusId: string | null
  ): string {
    let lastGroup = '';
    return records.map((record) => {
      const group = this.profileGroupLabel(record, favorites);
      const header = group !== lastGroup ? `<div class="profile-group-header">${escapeHtml(group)}</div>` : '';
      lastGroup = group;
      return `${header}${this.renderProfileRow(record, favorites.has(record.id), record.id === selectedId, group, record.id === focusId)}`;
    }).join('');
  }

  private renderProfileRow(record: ProfileRecord, favorite: boolean, active: boolean, group: string, focused = false): string {
    const title = record.profile.title ?? record.id;
    const shortTitle = profileShortTitle(title);
    const author = (record.profile.author ?? '').trim();
    // The group header already conveys the author/folder, so only surface the
    // author here when it adds something the header doesn't (avoids "Decent"
    // under a "DECENT" header).
    const showAuthor = author !== '' && author.toLowerCase() !== group.toLowerCase();
    return `
      <div class="profile-row ${active ? 'active' : ''} ${focused ? 'focused' : ''}">
        <button type="button" class="profile-pick" data-action="focus-profile" data-id="${escapeAttr(record.id)}">
          <span class="profile-row-title">${favorite ? '<span class="profile-row-fav">★</span> ' : ''}${escapeHtml(shortTitle)}</span>
          ${showAuthor ? `<span class="profile-row-author">${escapeHtml(author)}</span>` : ''}
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
    // reaprime drops `type`, so derive the real kind from the steps.
    const type = createProfileEditorState(record.profile).type;
    return `
      <aside class="profile-preview-pane">
        <div class="profile-preview-head">
          <div>
            <span class="eyebrow">${escapeHtml(author || 'Profile')}</span>
            <h2>${escapeHtml(title)}</h2>
            <span class="profile-type-chip">${escapeHtml(displayProfileType(type))}</span>
          </div>
          <button type="button" class="profile-fav ${favorite ? 'on' : ''}" data-action="toggle-favorite-profile" data-id="${escapeAttr(record.id)}" aria-label="${favorite ? 'Unfavorite' : 'Favorite'} ${escapeAttr(title)}" aria-pressed="${favorite}">${favorite ? '★' : '☆'}</button>
        </div>
        <section class="profile-preview-block">
          <span class="eyebrow">Preview</span>
          <div class="profile-preview-large">
            ${renderProfilePreview(record.profile)}
          </div>
        </section>
        <section class="profile-description-block">
          <span class="eyebrow">Description</span>
          <p class="profile-preview-notes">${escapeHtml(record.profile.notes || 'No description.')}</p>
        </section>
        <div class="profile-preview-actions">
          <button type="button" class="pa-edit" data-action="edit-profile" data-id="${escapeAttr(record.id)}">${icon('pencil')}<span>Edit</span></button>
          <button type="button" class="pa-select ${active ? 'is-selected' : ''}" data-action="pick-profile" data-id="${escapeAttr(record.id)}">${active ? 'Selected' : 'Select'}</button>
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
    const duration = shotDurationLabel(shot);
    const hint = this.renderSecondTapHint('shot', shot.id);
    return `
      <button class="shot-item ${active ? 'active' : ''} ${hint ? 'has-second-tap-hint' : ''}" data-action="select-history-shot" data-id="${escapeAttr(shot.id)}">
        <span class="shot-item-info">
          <span class="shot-item-recipe">${formatGrams(recipe.dose)} → ${formatGrams(recipe.yield)}</span>
          <span class="shot-item-dur">${duration ? escapeHtml(duration) : ''}</span>
          ${enjoymentBadge(shot)}
        </span>
        <span class="shot-item-profile">${escapeHtml(recipe.profileTitle ?? 'No profile')}</span>
        ${hint}
      </button>
    `;
  }

  private renderSecondTapHint(kind: SecondTapHintKind, id: string): string {
    const hint = this.state.secondTapHint;
    if (!hint || hint.kind !== kind || hint.id !== id) return '';
    return '<span class="second-tap-tooltip">Tap again to load</span>';
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
        ${shotScoreControl(shot.annotations?.enjoyment ?? null, {
          action: 'set-shot-score',
          shotId: shot.id,
          variant: 'detail'
        })}
        <button class="icon-button shot-edit-button" data-action="edit-shot" aria-label="Edit shot fields" title="Edit shot fields">${icon('pencil')}</button>
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
    if (this.state.modal === 'bean-picker') return this.renderBeanPickerModal();
    if (this.state.modal === 'edit-number') return this.renderEditDialog();
    if (this.state.modal === 'edit-shot') return this.renderShotEditModal();
    if (this.state.modal === 'machine-label') return this.renderMachineLabelModal();
    return '';
  }

  private renderSettingsPage(): string {
    return `
      ${this.pageHeader('Settings', 'workbench', `<button class="icon-button" data-action="refresh" aria-label="Sync" title="Sync">${icon('refresh-cw')}</button>`)}
      ${renderSettingsShell(this.settingsShellModel(), this.state.settingsSection, this.state.settingsBundle, this.state.pluginConfig)}
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
          <button type="button" class="pe-save commit-action" data-action="save-profile">${icon('check')}<span>Save</span></button>
        </div>
      </header>
      <main class="page-body profile-editor-page">
        ${renderProfileEditor(pe)}
      </main>
    `;
  }

  private renderMachinePage(): string {
    const service = machineServiceState(this.state.machine?.state?.state);
    if (service) return this.renderMachineProgressPage(service);
    const capabilities = this.machineCapabilitiesForControls();
    const steam = this.currentSteamSettings();
    const water = this.currentHotWaterData();
    const flush = this.currentRinseData();
    const steamPresets = machinePresetsWithValues('steamPreset', STEAM_PRESETS, this.state.machinePresetValues);
    const waterPresets = machinePresetsWithValues('waterPreset', HOT_WATER_PRESETS, this.state.machinePresetValues);
    const flushPresets = machinePresetsWithValues('flushPreset', FLUSH_PRESETS, this.state.machinePresetValues);
    const steamPreset = matchingPreset(steam, steamPresets);
    const waterPreset = matchingPreset(water, waterPresets);
    const flushPreset = matchingPreset(flush, flushPresets);
    return `
      ${this.pageHeader('Steam · Water · Flush')}
      <main class="page-body machine-page">
        <div class="machine-lanes">
          ${renderMachineLane({
            tone: 'steam',
            eyebrow: 'Steam',
            title: 'Milk',
            presetName: 'steamPreset',
            presets: steamPresets,
            selectedPreset: steamPreset,
            labelOverrides: this.state.machinePresetLabels,
            values: [
              machineValueTile('steamFlow', 'Flow', steam.flow, capabilities.steam.flow),
              machineValueTile('steamTemp', 'Temp', steam.targetTemperature, capabilities.steam.targetTemperature),
              machineValueTile('steamDuration', 'Time', steam.duration, capabilities.steam.duration),
              machineValueTile('steamStopTemp', 'Milk stop', steam.stopAtTemperature, capabilities.steam.stopAtTemperature!)
            ]
          })}
          ${renderMachineLane({
            tone: 'water',
            eyebrow: 'Hot water',
            title: 'Drink',
            presetName: 'waterPreset',
            presets: waterPresets,
            selectedPreset: waterPreset,
            labelOverrides: this.state.machinePresetLabels,
            values: [
              machineValueTile('waterTemp', 'Temp', water.targetTemperature, capabilities.hotWater.targetTemperature),
              machineValueTile('waterFlow', 'Flow', water.flow, capabilities.hotWater.flow),
              machineValueTile('waterVolume', 'Volume', water.volume, capabilities.hotWater.volume!),
              machineValueTile('waterDuration', 'Time', water.duration, capabilities.hotWater.duration)
            ]
          })}
          ${renderMachineLane({
            tone: 'flush',
            eyebrow: 'Flush',
            title: 'Clean',
            presetName: 'flushPreset',
            presets: flushPresets,
            selectedPreset: flushPreset,
            labelOverrides: this.state.machinePresetLabels,
            values: [
              machineValueTile('flushDuration', 'Time', flush.duration, capabilities.flush.duration),
              machineValueTile('flushFlow', 'Flow', flush.flow, capabilities.flush.flow),
              machineValueTile('flushTemp', 'Temp', flush.targetTemperature, capabilities.flush.targetTemperature),
              machineReadoutTile('Source', capabilities.source === 'machine' ? 'DE1' : sourceLabel(capabilities), 'settings')
            ]
          })}
        </div>
      </main>
    `;
  }

  private renderMachineProgressPage(service: MachineServiceState): string {
    const tone = machineServiceTone(service);
    const steam = this.currentSteamSettings();
    const water = this.currentHotWaterData();
    const flush = this.currentRinseData();
    const targetSeconds = machineServiceTargetSeconds(service, steam, water, flush);
    const elapsedSeconds = this.machineServiceStartedAtMs == null
      ? 0
      : Math.max(0, (Date.now() - this.machineServiceStartedAtMs) / 1000);
    const machine = this.state.machine;
    const stats = machineServiceStats(elapsedSeconds, targetSeconds);
    const meta = machineServiceMeta(service, steam, water, flush, machine);
    const stopRequested = this.machineStopRequestedFor === service;
    const stopAgeSeconds = stopRequested && this.machineStopRequestedAtMs != null
      ? Math.max(0, (Date.now() - this.machineStopRequestedAtMs) / 1000)
      : 0;
    const stopLabel = stopRequested
      ? stopAgeSeconds > 4 && !this.state.busy ? 'Stop again' : 'Stopping...'
      : 'Stop';
    const primaryTime = machineServicePrimaryTime(elapsedSeconds, targetSeconds);
    return `
      <header class="page-head machine-progress-head">
        <h1 class="page-title">${escapeHtml(machineServiceVerb(service))}</h1>
      </header>
      <main class="page-body machine-page machine-progress-page">
        <section class="machine-progress ${tone}">
          <div class="machine-progress-focus">
            <div class="machine-progress-ring">${machineGraphicIcon(tone)}</div>
            <div class="machine-progress-time">
              <strong>${escapeHtml(primaryTime.value)}</strong>
              <span>${escapeHtml(primaryTime.label)}</span>
            </div>
            <div class="machine-progress-meta">
              ${meta.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}
            </div>
          </div>
          <div class="machine-progress-actions">
            <div class="machine-progress-stats">
              ${stats.map((stat) => `
                <div class="machine-progress-stat">
                  <span>${escapeHtml(stat.label)}</span>
                  <strong>${escapeHtml(stat.value)}</strong>
                  <em>${escapeHtml(stat.unit)}</em>
                </div>
              `).join('')}
            </div>
            <button type="button" class="machine-progress-stop ${stopRequested ? 'stopping' : ''}" data-action="stop" ${this.state.busy && stopRequested ? 'disabled' : ''}>
              ${icon('square')}
              <span>${escapeHtml(stopLabel)}</span>
            </button>
          </div>
        </section>
      </main>
    `;
  }

  private renderBeanEditorPage(): string {
    const editing = this.state.editingBeanId
      ? this.state.beans.find((bean) => bean.id === this.state.editingBeanId) ?? null
      : null;
    const v = (value: string | null | undefined) => escapeAttr(value ?? '');
    const actions = `
      ${editing ? `<button type="button" class="command danger" data-action="archive-bean" data-id="${escapeAttr(editing.id)}">${icon('trash-2')}<span>Delete</span></button>` : ''}
      <button class="command primary commit-action" type="submit" form="bean-form">${icon(editing ? 'check' : 'plus')}<span>${editing ? 'Save' : 'Add'}</span></button>
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
    const actions = `<button class="command primary commit-action" type="submit" form="batch-form" ${bean ? '' : 'disabled'}>${icon('plus')}<span>Add batch</span></button>`;
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
    const editing = this.state.editingGrinderId
      ? this.state.grinders.find((grinder) => grinder.id === this.state.editingGrinderId) ?? null
      : null;
    const actionLabel = editing ? 'Save grinder' : 'Add grinder';
    const actions = `<button class="command primary commit-action" type="submit" form="grinder-form">${icon(editing ? 'check' : 'plus')}<span>${actionLabel}</span></button>`;
    return `
      ${this.pageHeader(editing ? 'Edit Grinder' : 'Add Grinder', 'workbench', actions)}
      <form id="grinder-form" class="page-body form-page" data-form="grinder-editor">
        <label>Model<input name="model" required autocomplete="off" value="${escapeAttr(editing?.model ?? '')}" /></label>
        <label>Burrs<input name="burrs" autocomplete="off" value="${escapeAttr(editing?.burrs ?? '')}" /></label>
        <label>Setting type
          <select name="settingType">
            <option value="numeric" ${editing?.settingType === 'numeric' || !editing?.settingType ? 'selected' : ''}>Numeric</option>
            <option value="preset" ${editing?.settingType === 'preset' ? 'selected' : ''}>Preset</option>
          </select>
        </label>
        <div class="field-row">
          <label>Small step<input type="number" name="settingSmallStep" min="0" step="0.01" value="${escapeAttr(String(editing?.settingSmallStep ?? 0.1))}" /></label>
          <label>Big step<input type="number" name="settingBigStep" min="0" step="0.1" value="${escapeAttr(String(editing?.settingBigStep ?? 1))}" /></label>
        </div>
      </form>
    `;
  }

  private renderBatchControl(bean: Bean | null): string {
    if (!bean) return '';
    const batch = this.selectedBatch();
    return `
      <div class="batch-control">
        <button type="button" class="batch-current" data-action="open-bean-picker" aria-label="Manage batches" title="Manage batches">
          <span>Batch</span>
          <strong>${escapeHtml(batch ? batchOptionLabel(batch) : 'No batch')}</strong>
        </button>
        <button class="icon-button" data-action="open-add-batch" aria-label="Add batch" title="Add batch">${icon('plus')}</button>
      </div>
    `;
  }

  private renderEditDialog(): string {
    const dialog = this.state.editDialog;
    if (!dialog) return '';
    return renderInputDialog(dialog);
  }

  private renderMachineLabelModal(): string {
    const edit = this.state.machineLabelEdit;
    if (!edit) return '';
    return `
      <div class="modal-backdrop" data-action="close-modal">
        <section class="modal machine-label-modal" role="dialog" aria-modal="true" aria-label="Rename button" data-action="noop">
          <div class="modal-head">
            <div>
              <span class="eyebrow">Button name</span>
              <h2>Rename</h2>
            </div>
            <button type="button" class="icon-button" data-action="close-modal" aria-label="Close">${icon('x')}</button>
          </div>
          <input class="machine-label-input" data-action="machine-label-input" value="${escapeAttr(edit.label)}" autocomplete="off" />
          <div class="modal-actions">
            <button type="button" class="text-button" data-action="close-modal">Cancel</button>
            <button type="button" class="command primary" data-action="machine-label-save">${icon('pencil')}<span>Rename</span></button>
          </div>
        </section>
      </div>
    `;
  }

  private renderShotEditModal(): string {
    const shot = this.selectedHistoryShot();
    if (!shot) return '';
    const draft =
      this.state.shotEdit?.shotId === shot.id ? this.state.shotEdit : shotEditDraftFromShot(shot);
    const shotDate = new Date(shot.timestamp);
    const shotLabel = Number.isNaN(shotDate.valueOf())
      ? shot.timestamp
      : shotDate.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const field = (
      name: ShotEditField,
      label: string,
      value: unknown,
      wide = false,
      multiline = false
    ) => `
      <label class="${wide ? 'wide' : ''}">
        <span>${escapeHtml(label)}</span>
        <button type="button" class="shot-edit-value ${multiline ? 'multiline' : ''}" data-action="open-shot-field" data-field="${escapeAttr(name)}">
          <strong>${escapeHtml(fieldDisplayValue(name, value))}</strong>
        </button>
      </label>
    `;
    const numberField = (name: Extract<ShotEditField, 'targetDoseWeight' | 'targetYield' | 'actualDoseWeight' | 'actualYield' | 'drinkTds' | 'drinkEy'>, label: string, value: number | null) => `
      <label>
        <span>${escapeHtml(label)}</span>
        <input
          class="shot-edit-number"
          name="${escapeAttr(name)}"
          type="number"
          step="${escapeAttr(shotNumberFieldStep(name))}"
          value="${escapeAttr(inputValue(value))}"
          inputmode="decimal"
          autocomplete="off"
          data-action="shot-edit-number"
          data-field="${escapeAttr(name)}"
        />
      </label>
    `;

    return `
      <div class="modal-backdrop" data-action="close-modal">
        <form class="modal panel shot-edit-modal" data-form="shot-dye-editor" data-id="${escapeAttr(shot.id)}" data-action="noop">
          <div class="modal-head shot-edit-head">
            <div>
              <h2>Edit shot</h2>
              <p class="modal-hint">${escapeHtml(shotLabel)}</p>
            </div>
            <button type="button" class="icon-button" data-action="close-modal" aria-label="Close">${icon('x')}</button>
          </div>

          <div class="shot-edit-grid">
            <fieldset class="shot-edit-section">
              <legend>Bean</legend>
              <div class="shot-edit-fields">
                ${field('coffeeRoaster', 'Roaster', draft.coffeeRoaster)}
                ${field('coffeeName', 'Bean', draft.coffeeName)}
                ${field('beanBatchId', 'Batch', batchDisplayLabel(draft.beanBatchId, this.state.beans, this.state.batchesByBean))}
                ${field('finalBeverageType', 'Drink', draft.finalBeverageType)}
                ${field('baristaName', 'Barista', draft.baristaName)}
                ${field('drinkerName', 'Drinker', draft.drinkerName)}
              </div>
            </fieldset>

            <fieldset class="shot-edit-section">
              <legend>Recipe</legend>
              <div class="shot-edit-fields">
                ${numberField('targetDoseWeight', 'Target in', draft.targetDoseWeight)}
                ${numberField('targetYield', 'Target out', draft.targetYield)}
                ${numberField('actualDoseWeight', 'Actual in', draft.actualDoseWeight)}
                ${numberField('actualYield', 'Actual out', draft.actualYield)}
                ${field('grinderId', 'Grinder', grinderDisplayLabel(draft.grinderId, this.state.grinders) ?? draft.grinderModel)}
                ${field('grinderSetting', 'Grind', draft.grinderSetting)}
              </div>
            </fieldset>

            <fieldset class="shot-edit-section">
              <legend>Result</legend>
              <div class="shot-edit-fields">
                ${numberField('drinkTds', 'TDS', draft.drinkTds)}
                ${numberField('drinkEy', 'EY', draft.drinkEy)}
                <label class="wide">
                  <span>Score</span>
                  ${shotScoreControl(draft.enjoyment, { action: 'shot-edit-score', variant: 'edit' })}
                </label>
                ${field('espressoNotes', 'Notes', draft.espressoNotes, true, true)}
              </div>
            </fieldset>
          </div>

          <div class="modal-actions shot-edit-actions">
            <button type="button" class="command" data-action="close-modal">Cancel</button>
            <button type="submit" class="command primary commit-action">${icon('check')}<span>Save</span></button>
          </div>
        </form>
        ${this.renderShotFieldDialog(draft)}
      </div>
    `;
  }

  private renderShotFieldDialog(draft: ShotEditDraft): string {
    const field = this.state.shotEditField;
    if (!field) return '';
    const spec = shotFieldSpec(
      field,
      draft,
      this.state.grinders,
      this.state.beans,
      this.state.batchesByBean,
      this.state.shots
    );
    const input =
      spec.kind === 'textarea'
        ? `<textarea name="value" rows="5" spellcheck="true">${escapeHtml(spec.value)}</textarea>`
        : spec.kind === 'number'
          ? `<input name="value" type="number" step="${escapeAttr(spec.step ?? '0.1')}" value="${escapeAttr(spec.value)}" inputmode="decimal" autocomplete="off" />`
          : `<input name="value" value="${escapeAttr(spec.value)}" autocomplete="off" />`;
    const options =
      spec.options.length === 0
        ? ''
        : `<div class="shot-field-options" aria-label="${escapeAttr(spec.label)} options">
            ${spec.options
              .map(
                (option) => `
                  <button type="button" data-action="shot-field-option" data-field="${escapeAttr(field)}" data-value="${escapeAttr(option.value)}">
                    <strong>${escapeHtml(option.label)}</strong>
                    ${option.detail ? `<small>${escapeHtml(option.detail)}</small>` : ''}
                  </button>
                `
              )
              .join('')}
          </div>`;

    return `
      <div class="modal-backdrop shot-field-backdrop" data-action="close-shot-field">
        <form class="modal panel shot-field-dialog" data-form="shot-field-dialog" data-field="${escapeAttr(field)}" data-action="noop">
          <div class="modal-head shot-edit-head">
            <div>
              <span class="eyebrow">Edit</span>
              <h2>${escapeHtml(spec.label)}</h2>
            </div>
            <button type="button" class="icon-button" data-action="close-shot-field" aria-label="Close">${icon('x')}</button>
          </div>
          <label class="shot-field-input">
            <span>${escapeHtml(spec.label)}</span>
            ${input}
          </label>
          ${options}
          <div class="modal-actions shot-edit-actions">
            <button type="button" class="command" data-action="close-shot-field">Cancel</button>
            <button type="submit" class="command primary">Done</button>
          </div>
        </form>
      </div>
    `;
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
    return latestBatch(batches);
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

  // Load the reaprime-backed settings bundle when the Settings view opens.
  // Each endpoint falls back to a demo default so a missing machine/battery
  // never blanks the screen; in demo mode the whole bundle is local.
  private async loadReaSettings(): Promise<void> {
    if (this.state.settingsBundle) return;
    if (this.state.demo) {
      this.setState({ settingsBundle: demoSettingsBundle(), settingsSource: 'demo' });
      return;
    }
    const fallback = demoSettingsBundle();
    let source: 'gateway' | 'demo' = 'gateway';
    const [rea, de1, advanced, calibration, presence, skins, devices, plugins, schedules] = await Promise.all([
      gateway.settings().catch(() => {
        source = 'demo';
        return fallback.rea;
      }),
      gateway.machineSettings().catch(() => fallback.de1),
      gateway.machineAdvancedSettings().catch(() => fallback.advanced),
      gateway.calibration().catch(() => fallback.calibration),
      gateway.presenceSettings().catch(() => fallback.presence),
      gateway.skins().catch(() => fallback.skins),
      gateway.devices().catch(() => fallback.devices),
      gateway.plugins().catch(() => fallback.plugins),
      gateway.wakeSchedules().catch(() => fallback.schedules)
    ]);
    this.setState({
      settingsBundle: { rea, de1, advanced, calibration, presence, skins, devices, plugins, schedules },
      settingsSource: source,
      status: source === 'gateway' ? this.state.status : 'Settings unavailable — showing defaults'
    });
  }

  private patchBundle(patch: Partial<SettingsBundle>): void {
    if (!this.state.settingsBundle) return;
    this.setState({ settingsBundle: { ...this.state.settingsBundle, ...patch } });
  }

  private get settingsLocal(): boolean {
    return this.state.demo || this.state.settingsSource === 'demo';
  }

  private async scanDevices(): Promise<void> {
    this.setState({ status: 'Scanning for devices…' });
    if (this.settingsLocal) {
      this.setState({ status: 'Scanning unavailable in demo mode' });
      return;
    }
    try {
      const devices = await gateway.scanDevices();
      this.patchBundle({ devices });
      this.setState({ status: `Found ${devices.length} device${devices.length === 1 ? '' : 's'}` });
    } catch (error) {
      console.error('[Beanie] Device scan failed', error);
      this.setState({ status: 'Scan failed' });
    }
  }

  private async connectDevice(id: string, connect: boolean): Promise<void> {
    if (!id || this.settingsLocal) return;
    this.setState({ status: connect ? 'Connecting…' : 'Disconnecting…' });
    try {
      await (connect ? gateway.connectDevice(id) : gateway.disconnectDevice(id));
      this.patchBundle({ devices: await gateway.devices().catch(() => this.state.settingsBundle?.devices ?? []) });
      this.setState({ status: connect ? 'Connected' : 'Disconnected' });
    } catch (error) {
      console.error('[Beanie] Device connect failed', error);
      this.setState({ status: connect ? 'Connect failed' : 'Disconnect failed' });
    }
  }

  private async requestMachineState(state: string): Promise<void> {
    if (this.settingsLocal) {
      this.setState({ status: `${state} unavailable in demo mode` });
      return;
    }
    try {
      await gateway.setMachineState(state);
      this.setState({ status: `Machine → ${state}` });
    } catch (error) {
      console.error('[Beanie] Machine state change failed', error);
      this.setState({ status: 'Machine command failed' });
    }
  }

  private async uploadFirmware(file: File): Promise<void> {
    if (this.settingsLocal) {
      this.setState({ status: 'Firmware upload needs a connected gateway' });
      return;
    }
    this.setState({ status: `Uploading ${file.name}…`, busy: true });
    try {
      await gateway.uploadFirmware(await file.arrayBuffer());
      this.setState({ status: 'Firmware uploaded — restart the machine', busy: false });
    } catch (error) {
      console.error('[Beanie] Firmware upload failed', error);
      this.setState({ status: 'Firmware upload failed', busy: false });
    }
  }

  private async addWakeSchedule(time: string): Promise<void> {
    if (!time) return;
    if (this.settingsLocal) {
      const schedules = [
        ...(this.state.settingsBundle?.schedules ?? []),
        { id: `local-${time}`, time, daysOfWeek: [], enabled: true, keepAwakeFor: null }
      ];
      this.patchBundle({ schedules });
      return;
    }
    try {
      await gateway.addWakeSchedule({ time, daysOfWeek: [], enabled: true });
      this.patchBundle({ schedules: await gateway.wakeSchedules() });
      this.setState({ status: 'Wake schedule added' });
    } catch (error) {
      console.error('[Beanie] Add schedule failed', error);
      this.setState({ status: 'Could not add schedule' });
    }
  }

  private async deleteWakeSchedule(id: string): Promise<void> {
    const remaining = (this.state.settingsBundle?.schedules ?? []).filter((s) => s.id !== id);
    this.patchBundle({ schedules: remaining });
    if (this.settingsLocal) return;
    try {
      await gateway.deleteWakeSchedule(id);
    } catch (error) {
      console.error('[Beanie] Delete schedule failed', error);
      this.setState({ status: 'Could not delete schedule' });
    }
  }

  private async toggleWakeSchedule(id: string, enabled: boolean): Promise<void> {
    const schedules = (this.state.settingsBundle?.schedules ?? []).map((s) =>
      s.id === id ? { ...s, enabled } : s
    );
    this.patchBundle({ schedules });
    if (this.settingsLocal) return;
    try {
      await gateway.updateWakeSchedule(id, { enabled });
    } catch (error) {
      console.error('[Beanie] Update schedule failed', error);
    }
  }

  private async togglePlugin(id: string, enable: boolean): Promise<void> {
    const plugins = (this.state.settingsBundle?.plugins ?? []).map((p) =>
      p.id === id ? { ...p, loaded: enable } : p
    );
    this.patchBundle({ plugins });
    if (this.settingsLocal) return;
    try {
      await (enable ? gateway.enablePlugin(id) : gateway.disablePlugin(id));
      this.setState({ status: enable ? 'Plugin enabled' : 'Plugin disabled' });
    } catch (error) {
      console.error('[Beanie] Plugin toggle failed', error);
      this.setState({ status: 'Plugin change failed' });
    }
  }

  private async togglePluginConfig(id: string): Promise<void> {
    if (this.state.pluginConfig?.id === id) {
      this.setState({ pluginConfig: null });
      return;
    }
    if (!pluginSettingsSpec(id)) return;
    let settings: PluginSettings;
    if (this.settingsLocal) {
      settings = demoPluginSettings(id);
    } else {
      settings = await gateway.pluginSettings(id).catch((error) => {
        console.error('[Beanie] Load plugin settings failed', error);
        return demoPluginSettings(id);
      });
    }
    this.setState({ pluginConfig: this.makePluginConfig(id, settings) });
  }

  private makePluginConfig(id: string, settings: PluginSettings): PluginConfigState {
    const spec = pluginSettingsSpec(id);
    const draft: Record<string, string | number | boolean> = {};
    for (const field of spec?.fields ?? []) {
      draft[field.key] = field.secret ? '' : settings.values[field.key] ?? pluginFieldDefault(field);
    }
    return { id, settings, draft, secretEdited: {}, dirty: false, saving: false, verify: null };
  }

  private updatePluginField(key: string, raw: string | boolean): void {
    const config = this.state.pluginConfig;
    if (!config) return;
    const field = pluginSettingsSpec(config.id)?.fields.find((candidate) => candidate.key === key);
    if (!field) return;
    let value: string | number | boolean;
    if (field.type === 'toggle') {
      value = raw === true;
    } else if (field.type === 'number') {
      const parsed = Number(raw);
      value = Number.isFinite(parsed) ? parsed : field.min ?? 0;
    } else {
      value = String(raw);
    }
    const draft = { ...config.draft, [key]: value };
    const secretEdited = field.secret ? { ...config.secretEdited, [key]: String(value) !== '' } : config.secretEdited;
    this.setState({ pluginConfig: { ...config, draft, secretEdited, dirty: true, verify: null } });
  }

  private async savePluginConfig(id: string): Promise<void> {
    const config = this.state.pluginConfig;
    if (!config || config.id !== id) return;
    const spec = pluginSettingsSpec(id);
    if (!spec) return;
    // Build the payload + optimistic next state. Secret fields are only sent (and
    // only marked "set") when the user actually typed a new value this session.
    const payload: Record<string, string | number | boolean> = {};
    const nextValues = { ...config.settings.values };
    const nextSecretsSet = { ...config.settings.secretsSet };
    for (const field of spec.fields) {
      if (field.secret) {
        if (config.secretEdited[field.key] && String(config.draft[field.key] ?? '') !== '') {
          payload[field.key] = config.draft[field.key];
          nextSecretsSet[field.key] = true;
        }
      } else {
        payload[field.key] = config.draft[field.key];
        nextValues[field.key] = config.draft[field.key];
      }
    }
    const nextSettings: PluginSettings = { values: nextValues, secretsSet: nextSecretsSet };
    if (this.settingsLocal) {
      this.setState({ pluginConfig: this.makePluginConfig(id, nextSettings), status: 'Plugin settings saved (demo)' });
      return;
    }
    this.setState({ pluginConfig: { ...config, saving: true } });
    try {
      await gateway.updatePluginSettings(id, payload);
      this.setState({ pluginConfig: this.makePluginConfig(id, nextSettings), status: 'Plugin settings saved' });
    } catch (error) {
      console.error('[Beanie] Save plugin settings failed', error);
      this.setState({ pluginConfig: { ...config, saving: false }, status: 'Plugin settings save failed' });
    }
  }

  private async verifyPluginConfig(id: string): Promise<void> {
    const config = this.state.pluginConfig;
    if (!config || config.id !== id) return;
    if (config.dirty) {
      this.setState({ pluginConfig: { ...config, verify: { tone: 'warn', message: 'Save your changes before verifying.' } } });
      return;
    }
    this.setState({ pluginConfig: { ...config, verify: { tone: 'muted', message: 'Verifying…' } } });
    if (this.settingsLocal) {
      const hasUser = String(config.settings.values.username ?? '') !== '';
      const ok = hasUser && config.settings.secretsSet.password === true;
      this.setState({
        pluginConfig: {
          ...config,
          verify: { tone: ok ? 'good' : 'warn', message: ok ? 'Credentials look valid (demo).' : 'Add an email and password first.' }
        }
      });
      return;
    }
    try {
      const result = await gateway.verifyPlugin(id);
      const current = this.state.pluginConfig;
      if (!current || current.id !== id) return;
      this.setState({ pluginConfig: { ...current, verify: { tone: result.ok ? 'good' : 'warn', message: result.message } } });
    } catch (error) {
      console.error('[Beanie] Verify plugin failed', error);
      const current = this.state.pluginConfig;
      if (!current || current.id !== id) return;
      this.setState({ pluginConfig: { ...current, verify: { tone: 'warn', message: 'Verification failed.' } } });
    }
  }

  private async onSettingsField(group: string, key: string, raw: string | boolean): Promise<void> {
    const bundle = this.state.settingsBundle;
    if (!bundle) return;
    const field = SETTINGS_SPEC.flatMap((section) => section.fields).find(
      (candidate) => candidate.group === group && candidate.key === key
    );
    if (!field) return;
    const value = coerceFieldValue(field, raw);
    this.setState({ settingsBundle: setBundleField(bundle, field, value), status: 'Setting updated' });
    if (this.state.demo || this.state.settingsSource === 'demo') return; // local-only without a gateway
    try {
      await this.persistSetting(field.group, key, value);
    } catch (error) {
      console.error('[Beanie] Update setting failed', error);
      this.setState({ status: 'Setting update failed' });
    }
  }

  private persistSetting(group: string, key: string, value: string | number | boolean | null): Promise<void> {
    const patch = { [key]: value };
    if (group === 'rea') return gateway.updateSettings(patch as unknown as ReaSettingsPatch);
    if (group === 'de1') return gateway.updateMachineSettings(patch as unknown as Partial<De1MachineSettings>);
    if (group === 'advanced') return gateway.updateMachineAdvancedSettings(patch as unknown as De1AdvancedSettingsPatch);
    if (group === 'calibration') return gateway.updateCalibration(Number(value));
    if (group === 'presence') return gateway.updatePresenceSettings(patch as unknown as PresenceSettingsPatch);
    return Promise.resolve();
  }

  private async resetMachineSettings(): Promise<void> {
    const bundle = this.state.settingsBundle;
    if (!bundle) return;
    if (this.state.demo || this.state.settingsSource === 'demo') {
      const fallback = demoSettingsBundle();
      this.setState({
        settingsBundle: { ...bundle, de1: fallback.de1, advanced: fallback.advanced, calibration: fallback.calibration },
        status: 'Machine settings reset (demo)'
      });
      return;
    }
    try {
      await gateway.resetMachineSettings();
      const [de1, advanced, calibration] = await Promise.all([
        gateway.machineSettings(),
        gateway.machineAdvancedSettings(),
        gateway.calibration()
      ]);
      this.setState({ settingsBundle: { ...bundle, de1, advanced, calibration }, status: 'Machine settings reset' });
    } catch (error) {
      console.error('[Beanie] Reset machine settings failed', error);
      this.setState({ status: 'Reset failed' });
    }
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

const machinePresetLabelsStorageKey = 'beanie:machine-preset-labels';
const machinePresetValuesStorageKey = 'beanie:machine-preset-values';
const secondTapHintStorageKey = 'beanie:second-tap-hint';
const secondTapHintMaxShows = 3;

type MachinePresetValueOverrides = Record<string, Record<string, number>>;

interface SecondTapHintPrefs {
  shown: number;
  used: boolean;
}

function readSecondTapHintPrefs(): SecondTapHintPrefs {
  try {
    const raw = localStorage.getItem(secondTapHintStorageKey);
    const parsed = raw ? JSON.parse(raw) : {};
    const shown = typeof parsed?.shown === 'number' && Number.isFinite(parsed.shown) ? parsed.shown : 0;
    return {
      shown: Math.max(0, Math.min(secondTapHintMaxShows, shown)),
      used: parsed?.used === true
    };
  } catch {
    return { shown: 0, used: false };
  }
}

function writeSecondTapHintPrefs(prefs: SecondTapHintPrefs): void {
  try {
    localStorage.setItem(secondTapHintStorageKey, JSON.stringify(prefs));
  } catch {
    // Ignore storage failures; the hint is purely instructional.
  }
}

function recordSecondTapHintShown(): boolean {
  const prefs = readSecondTapHintPrefs();
  if (prefs.used || prefs.shown >= secondTapHintMaxShows) return false;
  writeSecondTapHintPrefs({ ...prefs, shown: prefs.shown + 1 });
  return true;
}

function markSecondTapHintUsed(): void {
  const prefs = readSecondTapHintPrefs();
  if (prefs.used) return;
  writeSecondTapHintPrefs({ shown: prefs.shown, used: true });
}

function readMachinePresetLabels(): Record<string, string> {
  try {
    const raw = localStorage.getItem(machinePresetLabelsStorageKey);
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    );
  } catch {
    return {};
  }
}

function writeMachinePresetLabels(labels: Record<string, string>): void {
  localStorage.setItem(machinePresetLabelsStorageKey, JSON.stringify(labels));
}

function readMachinePresetValues(): MachinePresetValueOverrides {
  try {
    const raw = localStorage.getItem(machinePresetValuesStorageKey);
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([key, value]) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
        const numericValues = Object.fromEntries(
          Object.entries(value).filter((entry): entry is [string, number] => (
            typeof entry[1] === 'number' && Number.isFinite(entry[1])
          ))
        );
        return Object.keys(numericValues).length > 0 ? [[key, numericValues]] : [];
      })
    );
  } catch {
    return {};
  }
}

function writeMachinePresetValues(values: MachinePresetValueOverrides): void {
  localStorage.setItem(machinePresetValuesStorageKey, JSON.stringify(values));
}

function machinePresetLabelKey(name: string, presetId: string): string {
  return `${name}:${presetId}`;
}

function machinePresetsWithValues<T extends object>(
  name: string,
  presets: WaterPreset<T>[],
  valueOverrides: MachinePresetValueOverrides
): WaterPreset<T>[] {
  return presets.map((preset) => {
    const overrides = valueOverrides[machinePresetLabelKey(name, preset.id)];
    if (!overrides) return preset;
    return {
      ...preset,
      values: { ...preset.values, ...overrides }
    };
  });
}

function numericPresetValues(values: object): Record<string, number> {
  return Object.fromEntries(
    Object.entries(values).filter((entry): entry is [string, number] => (
      typeof entry[1] === 'number' && Number.isFinite(entry[1])
    ))
  );
}

function presetLabel<T extends object>(
  name: string,
  preset: WaterPreset<T>,
  labelOverrides: Record<string, string>
): string {
  return labelOverrides[machinePresetLabelKey(name, preset.id)] ?? preset.label;
}

interface MachineLaneOptions<T extends object> {
  tone: 'steam' | 'water' | 'flush';
  eyebrow: string;
  title: string;
  presetName: string;
  presets: WaterPreset<T>[];
  selectedPreset: string;
  labelOverrides: Record<string, string>;
  values: MachineValueTile[];
}

interface MachineValueTile {
  name?: string;
  label: string;
  value: string;
  unit: string;
  spec?: NumberSpec;
  disabled?: boolean;
}

function renderMachineLane<T extends object>(options: MachineLaneOptions<T>): string {
  return `
    <section class="machine-lane ${options.tone}">
      <div class="machine-lane-title">
        <div>
          <span class="eyebrow">${escapeHtml(options.eyebrow)}</span>
          <h2>${escapeHtml(options.title)}</h2>
        </div>
      </div>
      ${renderMachineGraphic(options.tone)}
      ${renderMachinePresetTiles(options.presetName, options.presets, options.selectedPreset, options.labelOverrides)}
      <div class="machine-values">
        ${options.values.map(renderMachineValueTile).join('')}
      </div>
    </section>
  `;
}

function renderMachinePresetTiles<T extends object>(
  name: string,
  presets: WaterPreset<T>[],
  selected: string,
  labelOverrides: Record<string, string>
): string {
  return `
    <div class="machine-presets" role="group">
      ${presets.map((preset) => renderMachinePresetTile(name, preset, selected === preset.id, labelOverrides)).join('')}
    </div>
  `;
}

function renderMachinePresetTile<T extends object>(
  name: string,
  preset: WaterPreset<T>,
  selected: boolean,
  labelOverrides: Record<string, string>
): string {
  const label = presetLabel(name, preset, labelOverrides);
  return `
    <span class="machine-preset ${selected ? 'active' : ''}">
      <button type="button" class="machine-preset-select" data-action="machine-preset" data-name="${escapeAttr(name)}" data-value="${escapeAttr(preset.id)}" aria-pressed="${selected}">
        <strong>${escapeHtml(label)}</strong>
      </button>
      <button type="button" class="machine-preset-edit" data-action="machine-edit-label" data-name="${escapeAttr(name)}" data-value="${escapeAttr(preset.id)}" data-label="${escapeAttr(label)}" aria-label="Rename ${escapeAttr(label)}" title="Rename">
        ${icon('pencil')}
      </button>
    </span>
  `;
}

function renderMachineGraphic(tone: MachineLaneOptions<object>['tone']): string {
  return `
    <div class="machine-graphic" aria-hidden="true">
      ${machineGraphicIcon(tone)}
    </div>
  `;
}

function machineGraphicIcon(tone: MachineLaneOptions<object>['tone']): string {
  const streamlineGlyphs: Record<MachineLaneOptions<object>['tone'], string> = {
    steam: 'M 86.125 -11.625 C 83.042969 -9.042969 79.605469 -7.082031 75.8125 -5.75 C 72.019531 -4.417969 68.082031 -3.75 64 -3.75 C 60 -3.75 56.105469 -4.457031 52.3125 -5.875 C 48.519531 -7.292969 45.082031 -9.332031 42 -12 C 39.25 -14.332031 36.9375 -17.042969 35.0625 -20.125 C 33.1875 -23.207031 31.832031 -26.5 31 -30 C 29.667969 -30.25 28.332031 -30.625 27 -31.125 C 25.667969 -31.625 24.375 -32.207031 23.125 -32.875 C 21.457031 -33.792969 19.9375 -34.832031 18.5625 -36 C 17.1875 -37.167969 15.957031 -38.5 14.875 -40 C 13.792969 -41.417969 12.855469 -42.957031 12.0625 -44.625 C 11.269531 -46.292969 10.667969 -48 10.25 -49.75 C 9.832031 -51.5 9.625 -53.292969 9.625 -55.125 C 9.625 -56.957031 9.792969 -58.75 10.125 -60.5 C 10.457031 -62.332031 10.980469 -64.082031 11.6875 -65.75 C 12.394531 -67.417969 13.25 -69 14.25 -70.5 C 15.332031 -72 16.542969 -73.375 17.875 -74.625 C 19.207031 -75.875 20.625 -76.957031 22.125 -77.875 C 23.707031 -78.875 25.375 -79.667969 27.125 -80.25 C 28.875 -80.832031 30.625 -81.25 32.375 -81.5 C 33.292969 -81.667969 34.105469 -81.480469 34.8125 -80.9375 C 35.519531 -80.394531 35.917969 -79.667969 36 -78.75 C 36.082031 -77.917969 35.875 -77.144531 35.375 -76.4375 C 34.875 -75.730469 34.167969 -75.332031 33.25 -75.25 C 31.917969 -75 30.582031 -74.644531 29.25 -74.1875 C 27.917969 -73.730469 26.667969 -73.167969 25.5 -72.5 C 24.332031 -71.75 23.25 -70.894531 22.25 -69.9375 C 21.25 -68.980469 20.332031 -67.957031 19.5 -66.875 C 18.75 -65.707031 18.105469 -64.5 17.5625 -63.25 C 17.019531 -62 16.625 -60.707031 16.375 -59.375 C 16.125 -58.042969 16 -56.6875 16 -55.3125 C 16 -53.9375 16.167969 -52.582031 16.5 -51.25 C 16.832031 -49.917969 17.292969 -48.625 17.875 -47.375 C 18.457031 -46.125 19.167969 -44.957031 20 -43.875 C 20.832031 -42.707031 21.769531 -41.6875 22.8125 -40.8125 C 23.855469 -39.9375 24.957031 -39.167969 26.125 -38.5 C 27.375 -37.832031 28.667969 -37.292969 30 -36.875 C 31.332031 -36.457031 32.667969 -36.167969 34 -36 C 34.75 -35.917969 35.394531 -35.625 35.9375 -35.125 C 36.480469 -34.625 36.792969 -34.042969 36.875 -33.375 C 37.375 -30.125 38.417969 -27.082031 40 -24.25 C 41.582031 -21.417969 43.625 -18.917969 46.125 -16.75 C 48.625 -14.667969 51.417969 -13.042969 54.5 -11.875 C 57.582031 -10.707031 60.75 -10.125 64 -10.125 C 67.332031 -10.125 70.542969 -10.667969 73.625 -11.75 C 76.707031 -12.832031 79.5 -14.417969 82 -16.5 C 84.582031 -18.667969 86.6875 -21.144531 88.3125 -23.9375 C 89.9375 -26.730469 91 -29.75 91.5 -33 C 91.667969 -33.75 92 -34.355469 92.5 -34.8125 C 93 -35.269531 93.625 -35.542969 94.375 -35.625 C 95.792969 -35.707031 97.167969 -35.957031 98.5 -36.375 C 99.832031 -36.792969 101.082031 -37.332031 102.25 -38 C 103.5 -38.667969 104.667969 -39.4375 105.75 -40.3125 C 106.832031 -41.1875 107.792969 -42.167969 108.625 -43.25 C 109.457031 -44.332031 110.167969 -45.5 110.75 -46.75 C 111.332031 -48 111.792969 -49.292969 112.125 -50.625 C 112.457031 -51.957031 112.644531 -53.3125 112.6875 -54.6875 C 112.730469 -56.0625 112.625 -57.417969 112.375 -58.75 C 112.207031 -60.082031 111.855469 -61.394531 111.3125 -62.6875 C 110.769531 -63.980469 110.125 -65.167969 109.375 -66.25 C 108.625 -67.417969 107.75 -68.480469 106.75 -69.4375 C 105.75 -70.394531 104.667969 -71.25 103.5 -72 C 102.25 -72.75 100.980469 -73.355469 99.6875 -73.8125 C 98.394531 -74.269531 97.082031 -74.625 95.75 -74.875 C 94.832031 -74.957031 94.125 -75.355469 93.625 -76.0625 C 93.125 -76.769531 92.917969 -77.542969 93 -78.375 C 93.167969 -79.292969 93.582031 -80.019531 94.25 -80.5625 C 94.917969 -81.105469 95.707031 -81.292969 96.625 -81.125 C 98.457031 -80.875 100.230469 -80.4375 101.9375 -79.8125 C 103.644531 -79.1875 105.25 -78.375 106.75 -77.375 C 108.332031 -76.375 109.792969 -75.25 111.125 -74 C 112.457031 -72.75 113.625 -71.375 114.625 -69.875 C 115.625 -68.375 116.480469 -66.769531 117.1875 -65.0625 C 117.894531 -63.355469 118.417969 -61.625 118.75 -59.875 C 119 -58.042969 119.105469 -56.230469 119.0625 -54.4375 C 119.019531 -52.644531 118.792969 -50.875 118.375 -49.125 C 117.875 -47.292969 117.230469 -45.5625 116.4375 -43.9375 C 115.644531 -42.3125 114.707031 -40.792969 113.625 -39.375 C 112.457031 -37.957031 111.1875 -36.644531 109.8125 -35.4375 C 108.4375 -34.230469 106.957031 -33.207031 105.375 -32.375 C 104.125 -31.707031 102.8125 -31.144531 101.4375 -30.6875 C 100.0625 -30.230469 98.667969 -29.875 97.25 -29.625 C 96.417969 -26.125 95.042969 -22.832031 93.125 -19.75 C 91.207031 -16.667969 88.875 -13.957031 86.125 -11.625 Z M 64.375 -105.75 C 65.207031 -105.75 65.9375 -105.4375 66.5625 -104.8125 C 67.1875 -104.1875 67.5 -103.457031 67.5 -102.625 L 67.5 -34.625 C 67.5 -33.792969 67.1875 -33.0625 66.5625 -32.4375 C 65.9375 -31.8125 65.207031 -31.5 64.375 -31.5 C 63.457031 -31.5 62.6875 -31.8125 62.0625 -32.4375 C 61.4375 -33.0625 61.125 -33.792969 61.125 -34.625 L 61.125 -102.625 C 61.125 -103.457031 61.4375 -104.1875 62.0625 -104.8125 C 62.6875 -105.4375 63.457031 -105.75 64.375 -105.75 Z M 52.625 -105.75 C 53.457031 -105.5 54.105469 -105 54.5625 -104.25 C 55.019531 -103.5 55.125 -102.707031 54.875 -101.875 L 41 -45 C 40.75 -44.167969 40.25 -43.519531 39.5 -43.0625 C 38.75 -42.605469 37.957031 -42.457031 37.125 -42.625 C 36.292969 -42.875 35.644531 -43.375 35.1875 -44.125 C 34.730469 -44.875 34.582031 -45.667969 34.75 -46.5 L 48.75 -103.375 C 48.917969 -104.207031 49.375 -104.855469 50.125 -105.3125 C 50.875 -105.769531 51.707031 -105.917969 52.625 -105.75 Z M 76.125 -105.75 C 75.292969 -105.5 74.644531 -105 74.1875 -104.25 C 73.730469 -103.5 73.582031 -102.707031 73.75 -101.875 L 87.75 -45 C 87.917969 -44.167969 88.394531 -43.519531 89.1875 -43.0625 C 89.980469 -42.605469 90.792969 -42.457031 91.625 -42.625 C 92.457031 -42.875 93.105469 -43.375 93.5625 -44.125 C 94.019531 -44.875 94.125 -45.667969 93.875 -46.5 L 80 -103.375 C 79.75 -104.207031 79.25 -104.855469 78.5 -105.3125 C 77.75 -105.769531 76.957031 -105.917969 76.125 -105.75 Z M 76.125 -105.75',
    water: 'M 63.875 -109.375 C 64.625 -109.375 65.292969 -109.125 65.875 -108.625 C 66.457031 -108.125 66.832031 -107.5 67 -106.75 C 67.582031 -103.667969 68.5 -100.582031 69.75 -97.5 C 71 -94.5 72.480469 -91.582031 74.1875 -88.75 C 75.894531 -85.917969 77.832031 -83.292969 80 -80.875 C 82.167969 -78.375 84.542969 -76.125 87.125 -74.125 C 92.707031 -69.625 96.957031 -64.6875 99.875 -59.3125 C 102.792969 -53.9375 104.25 -48.292969 104.25 -42.375 C 104.25 -37.042969 103.207031 -31.894531 101.125 -26.9375 C 99.042969 -21.980469 96.125 -17.625 92.375 -13.875 C 88.625 -10.042969 84.269531 -7.105469 79.3125 -5.0625 C 74.355469 -3.019531 69.207031 -2 63.875 -2 C 58.542969 -2 53.394531 -3.019531 48.4375 -5.0625 C 43.480469 -7.105469 39.082031 -10.042969 35.25 -13.875 C 31.5 -17.625 28.605469 -21.980469 26.5625 -26.9375 C 24.519531 -31.894531 23.5 -37.042969 23.5 -42.375 C 23.5 -48.292969 24.957031 -53.9375 27.875 -59.3125 C 30.792969 -64.6875 35.042969 -69.625 40.625 -74.125 C 43.125 -76.125 45.457031 -78.375 47.625 -80.875 C 49.792969 -83.292969 51.75 -85.917969 53.5 -88.75 C 55.25 -91.582031 56.75 -94.5 58 -97.5 C 59.167969 -100.582031 60.082031 -103.667969 60.75 -106.75 C 60.917969 -107.5 61.292969 -108.125 61.875 -108.625 C 62.457031 -109.125 63.125 -109.375 63.875 -109.375 Z M 63.875 -95.125 C 61.792969 -90.042969 59.105469 -85.269531 55.8125 -80.8125 C 52.519531 -76.355469 48.792969 -72.457031 44.625 -69.125 C 39.542969 -65.125 35.8125 -60.855469 33.4375 -56.3125 C 31.0625 -51.769531 29.875 -47.125 29.875 -42.375 C 29.875 -37.875 30.730469 -33.542969 32.4375 -29.375 C 34.144531 -25.207031 36.582031 -21.542969 39.75 -18.375 C 43 -15.207031 46.707031 -12.75 50.875 -11 C 55.042969 -9.25 59.375 -8.375 63.875 -8.375 C 68.375 -8.375 72.707031 -9.25 76.875 -11 C 81.042969 -12.75 84.707031 -15.207031 87.875 -18.375 C 91.042969 -21.542969 93.5 -25.207031 95.25 -29.375 C 97 -33.542969 97.875 -37.875 97.875 -42.375 C 97.875 -47.125 96.667969 -51.769531 94.25 -56.3125 C 91.832031 -60.855469 88.125 -65.125 83.125 -69.125 C 78.957031 -72.457031 75.207031 -76.355469 71.875 -80.8125 C 68.542969 -85.269531 65.875 -90.042969 63.875 -95.125 Z M 41.625 -45.5 C 42.542969 -45.75 43.375 -45.644531 44.125 -45.1875 C 44.875 -44.730469 45.332031 -44.082031 45.5 -43.25 C 46.25 -40.417969 47.0625 -37.8125 47.9375 -35.4375 C 48.8125 -33.0625 50.082031 -30.957031 51.75 -29.125 C 53.25 -27.292969 55.332031 -25.707031 58 -24.375 C 60.667969 -23.042969 64.332031 -22.125 69 -21.625 C 69.832031 -21.542969 70.542969 -21.144531 71.125 -20.4375 C 71.707031 -19.730469 71.917969 -18.957031 71.75 -18.125 C 71.667969 -17.207031 71.292969 -16.480469 70.625 -15.9375 C 69.957031 -15.394531 69.167969 -15.167969 68.25 -15.25 C 63.082031 -15.832031 58.769531 -16.957031 55.3125 -18.625 C 51.855469 -20.292969 49.042969 -22.375 46.875 -24.875 C 44.707031 -27.375 43.105469 -30.082031 42.0625 -33 C 41.019531 -35.917969 40.125 -38.792969 39.375 -41.625 C 39.125 -42.457031 39.230469 -43.25 39.6875 -44 C 40.144531 -44.75 40.792969 -45.25 41.625 -45.5 Z M 41.625 -45.5',
    flush: 'M 33.25 -71.25 L 33.25 -84.375 C 33.25 -89.457031 35.042969 -93.792969 38.625 -97.375 C 42.207031 -100.957031 46.542969 -102.75 51.625 -102.75 L 76.25 -102.75 C 81.332031 -102.75 85.644531 -100.957031 89.1875 -97.375 C 92.730469 -93.792969 94.5 -89.457031 94.5 -84.375 L 94.5 -71.25 Z M 100.125 -65.75 L 100.125 -84.375 C 100.125 -90.957031 97.792969 -96.582031 93.125 -101.25 C 88.457031 -105.917969 82.832031 -108.25 76.25 -108.25 L 51.625 -108.25 C 45.042969 -108.25 39.417969 -105.917969 34.75 -101.25 C 30.082031 -96.582031 27.75 -90.957031 27.75 -84.375 L 27.75 -65.75 Z M 27.75 -54.375 C 27.75 -55.125 28.019531 -55.769531 28.5625 -56.3125 C 29.105469 -56.855469 29.792969 -57.125 30.625 -57.125 L 98.75 -57.125 C 99.5 -57.125 100.144531 -56.855469 100.6875 -56.3125 C 101.230469 -55.769531 101.5 -55.125 101.5 -54.375 C 101.5 -53.625 101.230469 -52.957031 100.6875 -52.375 C 100.144531 -51.792969 99.5 -51.5 98.75 -51.5 L 30.625 -51.5 C 29.792969 -51.5 29.105469 -51.792969 28.5625 -52.375 C 28.019531 -52.957031 27.75 -53.625 27.75 -54.375 Z M 63.875 -45.75 C 64.542969 -45.75 65.144531 -45.542969 65.6875 -45.125 C 66.230469 -44.707031 66.542969 -44.167969 66.625 -43.5 C 67.125 -41.25 68.042969 -39.0625 69.375 -36.9375 C 70.707031 -34.8125 72.292969 -33.042969 74.125 -31.625 C 76.542969 -29.707031 78.394531 -27.605469 79.6875 -25.3125 C 80.980469 -23.019531 81.625 -20.542969 81.625 -17.875 C 81.625 -15.542969 81.167969 -13.3125 80.25 -11.1875 C 79.332031 -9.0625 78.042969 -7.167969 76.375 -5.5 C 74.707031 -3.917969 72.792969 -2.6875 70.625 -1.8125 C 68.457031 -0.9375 66.207031 -0.5 63.875 -0.5 C 61.542969 -0.5 59.292969 -0.9375 57.125 -1.8125 C 54.957031 -2.6875 53.042969 -3.917969 51.375 -5.5 C 49.792969 -7.167969 48.542969 -9.0625 47.625 -11.1875 C 46.707031 -13.3125 46.25 -15.542969 46.25 -17.875 C 46.25 -20.542969 46.894531 -23.019531 48.1875 -25.3125 C 49.480469 -27.605469 51.292969 -29.707031 53.625 -31.625 C 55.542969 -33.042969 57.167969 -34.8125 58.5 -36.9375 C 59.832031 -39.0625 60.75 -41.25 61.25 -43.5 C 61.332031 -44.167969 61.625 -44.707031 62.125 -45.125 C 62.625 -45.542969 63.207031 -45.75 63.875 -45.75 Z M 63.875 -35.125 C 63.042969 -33.625 62.042969 -32.207031 60.875 -30.875 C 59.707031 -29.542969 58.457031 -28.332031 57.125 -27.25 C 55.207031 -25.75 53.832031 -24.207031 53 -22.625 C 52.167969 -21.042969 51.75 -19.457031 51.75 -17.875 C 51.75 -16.292969 52.0625 -14.792969 52.6875 -13.375 C 53.3125 -11.957031 54.207031 -10.667969 55.375 -9.5 C 56.457031 -8.417969 57.75 -7.5625 59.25 -6.9375 C 60.75 -6.3125 62.292969 -6 63.875 -6 C 65.542969 -6 67.105469 -6.3125 68.5625 -6.9375 C 70.019531 -7.5625 71.332031 -8.417969 72.5 -9.5 C 73.667969 -10.667969 74.542969 -11.957031 75.125 -13.375 C 75.707031 -14.792969 76 -16.292969 76 -17.875 C 76 -19.457031 75.582031 -21.042969 74.75 -22.625 C 73.917969 -24.207031 72.582031 -25.75 70.75 -27.25 C 69.332031 -28.332031 68.0625 -29.542969 66.9375 -30.875 C 65.8125 -32.207031 64.792969 -33.625 63.875 -35.125 Z M 63.875 -35.125'
  };
  return `
    <svg class="machine-graphic-streamline" viewBox="0 0 160 160" role="img" aria-label="${toneLabel(tone)}">
      <g transform="translate(16 136)">
        <path d="${streamlineGlyphs[tone]}" />
      </g>
    </svg>
  `;
}

function toneLabel(tone: MachineLaneOptions<object>['tone']): string {
  if (tone === 'water') return 'Water';
  if (tone === 'flush') return 'Flush';
  return 'Steam';
}

function machineValueTile(name: string, label: string, value: number | undefined, spec: NumberSpec): MachineValueTile {
  return {
    name,
    label,
    value: formatMachineValue(value),
    unit: spec.enabled ? spec.unit : 'Unavailable',
    spec,
    disabled: !spec.enabled
  };
}

function machineReadoutTile(label: string, value: string, unit: string): MachineValueTile {
  return { label, value, unit, disabled: true };
}

function renderMachineValueTile(tile: MachineValueTile): string {
  const disabled = tile.disabled === true ? ' disabled' : '';
  const action = tile.name && tile.spec?.enabled
    ? ` data-action="machine-edit-value" data-name="${escapeAttr(tile.name)}" data-title="${escapeAttr(tile.label)}" data-value="${escapeAttr(tile.value)}" data-unit="${escapeAttr(tile.spec.unit)}" data-min="${tile.spec.min}" data-max="${tile.spec.max}" data-step="${tile.spec.step}"`
    : '';
  const title = tile.spec?.reason ? ` title="${escapeAttr(tile.spec.reason)}"` : '';
  return `
    <button type="button" class="machine-value-tile ${tile.disabled ? 'disabled' : ''}"${action}${title}${disabled}>
      <span class="machine-value-label">${escapeHtml(tile.label)}</span>
      <strong>${escapeHtml(tile.value || '--')}</strong>
      <em>${escapeHtml(tile.unit)}</em>
    </button>
  `;
}

function sourceLabel(capabilities: WaterControlCapabilities): string {
  if (capabilities.source === 'machine') return 'Machine settings';
  if (capabilities.source === 'demo') return 'Demo';
  return 'Workflow';
}

function machineSettingsFromWorkflow(
  steam: SteamSettings,
  water: HotWaterData,
  flush: RinseData,
  current: De1MachineSettings | null
): De1MachineSettings {
  return {
    ...(current ?? {}),
    steamFlow: steam.flow,
    hotWaterFlow: water.flow,
    flushTemp: flush.targetTemperature,
    flushFlow: flush.flow,
    flushTimeout: flush.duration
  };
}

function machineSettingsPatchFromWorkflow(
  steam: SteamSettings,
  water: HotWaterData,
  flush: RinseData
): Partial<De1MachineSettings> {
  return {
    steamFlow: steam.flow,
    hotWaterFlow: water.flow,
    flushTemp: flush.targetTemperature,
    flushFlow: flush.flow,
    flushTimeout: flush.duration
  };
}

function formatMachineValue(value: number | undefined): string {
  if (value == null || !Number.isFinite(value)) return '';
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
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

function completedLiveShot(
  records: ShotRecord[],
  context: { previousShotIds: Set<string>; startedAtMs: number | null; endedAtMs: number | null },
  allowFallback: boolean
): ShotRecord | null {
  const newShot = records.find(
    (shot) => !context.previousShotIds.has(shot.id) && shotMatchesLiveWindow(shot, context)
  );
  if (newShot) return newShot;

  const timeMatch = records.find((shot) => shotMatchesLiveWindow(shot, context));
  if (timeMatch) return timeMatch;

  if (!allowFallback) return null;
  const newest = records[0] ?? null;
  if (!newest || context.previousShotIds.has(newest.id)) return null;
  const timestamp = Date.parse(newest.timestamp);
  return context.startedAtMs == null || !Number.isFinite(timestamp) ? newest : null;
}

function shotMatchesLiveWindow(
  shot: ShotRecord,
  context: { startedAtMs: number | null; endedAtMs: number | null }
): boolean {
  if (context.startedAtMs == null) return false;
  const timestamp = Date.parse(shot.timestamp);
  if (!Number.isFinite(timestamp)) return false;
  const start = context.startedAtMs - 10_000;
  const end = (context.endedAtMs ?? Date.now()) + 90_000;
  return timestamp >= start && timestamp <= end;
}

function includeShotInHistory(records: ShotRecord[], shot: ShotRecord, limit: number): ShotRecord[] {
  const withoutDuplicate = records.filter((item) => item.id !== shot.id);
  return [shot, ...withoutDuplicate].slice(0, Math.max(1, limit));
}

function optimisticShotFromLive(
  bean: Bean,
  batch: BeanBatch | null,
  workflow: Workflow | null,
  draft: RecipeDraft,
  liveState: LiveShotState
): ShotRecord | null {
  if (liveState.startMs == null) return null;
  const shotWorkflow = buildWorkflowUpdate(bean, batch, draft, draft.profile, workflow);
  return {
    id: `pending-live-${liveState.startMs}`,
    timestamp: new Date(liveState.startMs).toISOString(),
    workflow: shotWorkflow,
    annotations: {
      actualDoseWeight: draft.dose ?? shotWorkflow.context?.targetDoseWeight ?? null,
      actualYield: liveState.latest.weight ?? draft.yield ?? shotWorkflow.context?.targetYield ?? null
    },
    metadata: { pendingLiveShot: true },
    measurements: measurementsFromLiveShot(liveState)
  };
}

function measurementsFromLiveShot(liveState: LiveShotState): ShotMeasurement[] {
  if (liveState.startMs == null) return [];
  const byMs = new Map<number, { machine: Record<string, unknown>; scale: Record<string, unknown> }>();
  const frameFor = (t: number) => {
    const tMs = liveState.startMs! + Math.round(t * 1000);
    let frame = byMs.get(tMs);
    if (!frame) {
      const timestamp = new Date(tMs).toISOString();
      frame = {
        machine: { timestamp, state: { state: 'espresso', substate: 'pouring' } },
        scale: { timestamp }
      };
      byMs.set(tMs, frame);
    }
    return frame;
  };

  for (const series of liveState.series) {
    for (const point of series.points) {
      const frame = frameFor(point.t);
      if (series.key === 'pressure') frame.machine.pressure = point.value;
      if (series.key === 'flow') frame.machine.flow = point.value;
      if (series.key === 'targetPressure') frame.machine.targetPressure = point.value;
      if (series.key === 'targetFlow') frame.machine.targetFlow = point.value;
      if (series.key === 'groupTemperature') frame.machine.groupTemperature = point.value * 10;
      if (series.key === 'targetTemperature') frame.machine.targetGroupTemperature = point.value * 10;
      if (series.key === 'weightFlow') frame.scale.weightFlow = point.value;
    }
  }

  return [...byMs.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, frame]) => ({ machine: frame.machine, scale: frame.scale }) as ShotMeasurement);
}

function promoteBean(beans: Bean[], beanId: string): Bean[] {
  const bean = beans.find((item) => item.id === beanId);
  if (!bean) return beans;
  return [bean, ...beans.filter((item) => item.id !== beanId)];
}

function enjoymentBadge(shot: ShotRecord, size: 'row' | 'detail' = 'row'): string {
  const value = shot.annotations?.enjoyment;
  if (value == null) {
    if (size === 'row') return '<span class="enjoyment-badge empty" aria-hidden="true"><strong></strong></span>';
    return '';
  }
  const score = scoreOptionForValue(value);
  const formatted = score ? score.label : Number.isInteger(value) ? value.toString() : value.toFixed(1);
  const iconText = score?.icon ?? formatted;
  return `<span class="enjoyment-badge ${size === 'detail' ? 'large' : ''}" aria-label="Enjoyment ${escapeAttr(formatted)}"><strong>${escapeHtml(iconText)}</strong></span>`;
}

function shotScoreControl(
  value: number | null,
  options: { action: 'shot-edit-score' | 'set-shot-score'; shotId?: string; variant: 'edit' | 'detail' }
): string {
  const current = scoreOptionForValue(value);
  const idAttr = options.shotId ? ` data-id="${escapeAttr(options.shotId)}"` : '';
  return `
    <div class="shot-score-control ${options.variant === 'detail' ? 'compact' : ''}" aria-label="Shot score">
      ${SHOT_SCORE_OPTIONS.map((item) => {
        const active = current?.value === item.value;
        return `<button type="button" class="${active ? 'active' : ''}" data-action="${options.action}"${idAttr} data-value="${item.value}" aria-label="${escapeAttr(item.label)}" aria-pressed="${active}" title="${escapeAttr(item.label)}">${escapeHtml(item.icon)}</button>`;
      }).join('')}
    </div>
  `;
}

function scoreOptionForValue(value: number | null | undefined): ShotScoreOption | null {
  if (value == null) return null;
  let closest: ShotScoreOption = SHOT_SCORE_OPTIONS[0]!;
  let distance = Math.abs(value - closest.value);
  for (const option of SHOT_SCORE_OPTIONS) {
    const nextDistance = Math.abs(value - option.value);
    if (nextDistance < distance) {
      closest = option;
      distance = nextDistance;
    }
  }
  return closest;
}

function scoreValueFromTap(value: string | undefined, currentValue: number | null | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return scoreOptionForValue(currentValue)?.value === parsed ? null : parsed;
}

function shotEditDraftFromShot(shot: ShotRecord): ShotEditDraft {
  const ctx = shot.workflow?.context ?? {};
  const ann = shot.annotations ?? {};
  return {
    shotId: shot.id,
    coffeeRoaster: ctx.coffeeRoaster ?? null,
    coffeeName: ctx.coffeeName ?? null,
    beanBatchId: ctx.beanBatchId ?? null,
    finalBeverageType: ctx.finalBeverageType ?? null,
    baristaName: ctx.baristaName ?? null,
    drinkerName: ctx.drinkerName ?? null,
    targetDoseWeight: ctx.targetDoseWeight ?? null,
    targetYield: ctx.targetYield ?? null,
    actualDoseWeight: ann.actualDoseWeight ?? null,
    actualYield: ann.actualYield ?? null,
    grinderId: ctx.grinderId ?? null,
    grinderModel: ctx.grinderModel ?? null,
    grinderSetting: textOrNull(inputValue(ctx.grinderSetting)),
    drinkTds: ann.drinkTds ?? null,
    drinkEy: ann.drinkEy ?? null,
    enjoyment: ann.enjoyment ?? null,
    espressoNotes: ann.espressoNotes ?? shot.shotNotes ?? null,
    contextExtras: ctx.extras ?? null,
    annotationExtras: ann.extras ?? shot.metadata ?? null
  };
}

function shotEditDraftWithFormNumbers(draft: ShotEditDraft, form: HTMLFormElement): ShotEditDraft {
  let next = draft;
  const fields: Array<Extract<ShotEditField, 'targetDoseWeight' | 'targetYield' | 'actualDoseWeight' | 'actualYield' | 'drinkTds' | 'drinkEy'>> = [
    'targetDoseWeight',
    'targetYield',
    'actualDoseWeight',
    'actualYield',
    'drinkTds',
    'drinkEy'
  ];
  for (const field of fields) {
    const control = form.elements.namedItem(field);
    if (control instanceof HTMLInputElement) {
      next = { ...next, [field]: numberOrNullInput(control.value) };
    }
  }
  return next;
}

function updateShotEditDraftField(
  draft: ShotEditDraft,
  field: ShotEditField,
  value: string,
  grinders: Grinder[],
  beans: Bean[],
  batchForId: (batchId: string | null) => { batch: BeanBatch; bean: Bean } | null
): ShotEditDraft {
  const text = textOrNull(value);
  const number = numberOrNullInput(value);
  if (isShotNumberField(field)) return { ...draft, [field]: number };
  if (field === 'beanBatchId') {
    const match = batchForId(text);
    return {
      ...draft,
      beanBatchId: text,
      coffeeName: match?.bean.name ?? draft.coffeeName,
      coffeeRoaster: match?.bean.roaster ?? draft.coffeeRoaster
    };
  }
  if (field === 'coffeeName') {
    const bean = text ? beans.find((item) => optionKey(item.name) === optionKey(text)) : null;
    return {
      ...draft,
      coffeeName: text,
      coffeeRoaster: bean?.roaster ?? draft.coffeeRoaster
    };
  }
  if (field === 'grinderId') {
    const grinder = text ? grinders.find((item) => item.id === text) : null;
    return {
      ...draft,
      grinderId: grinder?.id ?? null,
      grinderModel: grinder?.model ?? draft.grinderModel
    };
  }
  return { ...draft, [field]: text };
}

function shotFieldSpec(
  field: ShotEditField,
  draft: ShotEditDraft,
  grinders: Grinder[],
  beans: Bean[],
  batchesByBean: Record<string, BeanBatch[]>,
  shots: ShotRecord[]
): ShotFieldSpec {
  const label = shotFieldLabel(field);
  if (field === 'beanBatchId') {
    return { label, kind: 'text', value: draft.beanBatchId ?? '', options: batchFieldOptions(beans, batchesByBean) };
  }
  if (field === 'grinderId') {
    return {
      label,
      kind: 'text',
      value: draft.grinderId ?? '',
      options: [
        { label: 'No grinder', value: '' },
        ...grinders.map((grinder) => ({
          label: grinder.model,
          value: grinder.id,
          detail: grinder.burrs ?? undefined
        }))
      ]
    };
  }
  if (field === 'espressoNotes') {
    return {
      label,
      kind: 'textarea',
      value: draft.espressoNotes ?? '',
      options: [
        { label: 'Clear', value: '' },
        { label: 'Sweet', value: 'Sweet, balanced, clean.' },
        { label: 'Sour', value: 'Sour, fast, needs finer grind or more yield.' },
        { label: 'Bitter', value: 'Bitter, dry, needs coarser grind or less yield.' }
      ]
    };
  }
  const value = draft[field];
  if (isShotNumberField(field)) {
    return {
      label,
      kind: 'number',
      value: inputValue(value),
      step: shotNumberFieldStep(field),
      options: numericShotFieldOptions(field)
    };
  }
  return { label, kind: 'text', value: inputValue(value), options: textShotFieldOptions(field, beans, shots, grinders) };
}

function batchFieldOptions(beans: Bean[], batchesByBean: Record<string, BeanBatch[]>): ShotFieldOption[] {
  const options: ShotFieldOption[] = [{ label: 'No batch', value: '' }];
  for (const bean of beans) {
    for (const batch of batchesByBean[bean.id] ?? []) {
      options.push({ label: `${bean.roaster} ${bean.name}`, value: batch.id, detail: batchOptionLabel(batch) });
    }
  }
  return options;
}

function numericShotFieldOptions(field: ShotEditField): ShotFieldOption[] {
  const values =
    field === 'drinkTds'
      ? [7, 8, 9, 10, 11, 12]
      : field === 'drinkEy'
        ? [16, 18, 20, 22, 24]
        : field === 'targetYield' || field === 'actualYield'
          ? [34, 36, 38, 40, 42, 45]
          : [17, 17.5, 18, 18.5, 20];
  return [{ label: 'Clear', value: '' }, ...values.map((item) => ({ label: inputValue(item), value: String(item) }))];
}

function textShotFieldOptions(
  field: ShotEditField,
  beans: Bean[],
  shots: ShotRecord[],
  grinders: Grinder[]
): ShotFieldOption[] {
  if (field === 'coffeeRoaster') {
    return uniqueTextOptions([
      ...beans.map((bean) => ({ label: bean.roaster, value: bean.roaster, detail: bean.name })),
      ...shots.map((shot) => ({
        label: shot.workflow?.context?.coffeeRoaster ?? '',
        value: shot.workflow?.context?.coffeeRoaster ?? '',
        detail: shot.workflow?.context?.coffeeName ?? ''
      }))
    ]);
  }
  if (field === 'coffeeName') {
    return uniqueTextOptions([
      ...beans.map((bean) => ({ label: bean.name, value: bean.name, detail: bean.roaster })),
      ...shots.map((shot) => ({
        label: shot.workflow?.context?.coffeeName ?? '',
        value: shot.workflow?.context?.coffeeName ?? '',
        detail: shot.workflow?.context?.coffeeRoaster ?? ''
      }))
    ]);
  }
  if (field === 'finalBeverageType') {
    return uniqueTextOptions([
      { label: 'Espresso', value: 'espresso' },
      { label: 'Americano', value: 'americano' },
      { label: 'Cortado', value: 'cortado' },
      { label: 'Cappuccino', value: 'cappuccino' },
      { label: 'Iced', value: 'iced' },
      ...shots.map((shot) => ({
        label: shot.workflow?.context?.finalBeverageType ?? '',
        value: shot.workflow?.context?.finalBeverageType ?? ''
      }))
    ]);
  }
  if (field === 'baristaName' || field === 'drinkerName') {
    return uniqueTextOptions(
      shots.map((shot) => {
        const value = shot.workflow?.context?.[field] ?? '';
        return { label: value, value };
      })
    );
  }
  if (field === 'grinderModel') {
    return uniqueTextOptions([
      ...grinders.map((grinder) => ({ label: grinder.model, value: grinder.model, detail: grinder.burrs ?? '' })),
      ...shots.map((shot) => ({
        label: shot.workflow?.context?.grinderModel ?? '',
        value: shot.workflow?.context?.grinderModel ?? ''
      }))
    ]);
  }
  if (field === 'grinderSetting') {
    return uniqueTextOptions([
      ...shots.map((shot) => {
        const value = inputValue(shot.workflow?.context?.grinderSetting);
        return { label: value, value, detail: shot.workflow?.context?.grinderModel ?? '' };
      }),
      { label: '5.0', value: '5.0' },
      { label: '5.5', value: '5.5' },
      { label: '6.0', value: '6.0' },
      { label: '6.5', value: '6.5' }
    ]);
  }
  return [{ label: 'Clear', value: '' }];
}

function uniqueTextOptions(items: ShotFieldOption[]): ShotFieldOption[] {
  const options: ShotFieldOption[] = [{ label: 'Clear', value: '' }];
  const seen = new Set<string>();
  for (const item of items) {
    const value = item.value.trim();
    const label = item.label.trim();
    if (!value || !label) continue;
    const key = optionKey(value);
    if (seen.has(key)) continue;
    seen.add(key);
    options.push({ label, value, detail: item.detail?.trim() || undefined });
  }
  return options;
}

function optionKey(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function shotFieldLabel(field: ShotEditField): string {
  const labels: Record<ShotEditField, string> = {
    coffeeRoaster: 'Roaster',
    coffeeName: 'Bean',
    beanBatchId: 'Batch',
    finalBeverageType: 'Drink',
    baristaName: 'Barista',
    drinkerName: 'Drinker',
    targetDoseWeight: 'Target in',
    targetYield: 'Target out',
    actualDoseWeight: 'Actual in',
    actualYield: 'Actual out',
    grinderId: 'Grinder',
    grinderModel: 'Model',
    grinderSetting: 'Grind',
    drinkTds: 'TDS',
    drinkEy: 'EY',
    espressoNotes: 'Notes'
  };
  return labels[field];
}

function fieldDisplayValue(field: ShotEditField, value: unknown): string {
  const text = inputValue(value);
  if (!text) return '--';
  if (field === 'espressoNotes') return text.length > 52 ? `${text.slice(0, 49)}...` : text;
  return text;
}

function grinderDisplayLabel(grinderId: string | null, grinders: Grinder[]): string | null {
  if (!grinderId) return null;
  return grinders.find((grinder) => grinder.id === grinderId)?.model ?? grinderId;
}

function batchDisplayLabel(
  batchId: string | null,
  beans: Bean[],
  batchesByBean: Record<string, BeanBatch[]>
): string | null {
  if (!batchId) return null;
  for (const bean of beans) {
    const batch = (batchesByBean[bean.id] ?? []).find((item) => item.id === batchId);
    if (batch) return `${bean.name} · ${batchOptionLabel(batch)}`;
  }
  return batchId;
}

function isShotNumberField(field: ShotEditField): field is Extract<
  ShotEditField,
  'targetDoseWeight' | 'targetYield' | 'actualDoseWeight' | 'actualYield' | 'drinkTds' | 'drinkEy'
> {
  return (
    field === 'targetDoseWeight' ||
    field === 'targetYield' ||
    field === 'actualDoseWeight' ||
    field === 'actualYield' ||
    field === 'drinkTds' ||
    field === 'drinkEy'
  );
}

function shotNumberFieldStep(field: ShotEditField): string {
  return field === 'drinkTds' || field === 'drinkEy' ? '0.01' : '0.1';
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

function recentBatches(batches: BeanBatch[], limit: number): BeanBatch[] {
  return [...batches]
    .sort((a, b) => {
      const ad = a.roastDate ? Date.parse(a.roastDate) : 0;
      const bd = b.roastDate ? Date.parse(b.roastDate) : 0;
      return bd - ad;
    })
    .slice(0, limit);
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

function dateInputValue(value: string | null | undefined): string {
  if (!value) return '';
  const match = value.match(/^\d{4}-\d{2}-\d{2}/);
  if (match) return match[0]!;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '' : date.toISOString().slice(0, 10);
}

function todayDateInputValue(): string {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
}

function beanFieldsFromForm(data: FormData): Partial<Bean> {
  return {
    roaster: String(data.get('roaster') ?? '').trim(),
    name: String(data.get('name') ?? '').trim(),
    country: textOrNull(data.get('country')),
    region: textOrNull(data.get('region')),
    processing: textOrNull(data.get('processing')),
    notes: textOrNull(data.get('notes'))
  };
}

function batchFieldsFromForm(data: FormData, beanId: string): Partial<BeanBatch> {
  return {
    beanId,
    roastDate: textOrNull(data.get('roastDate')),
    roastLevel: textOrNull(data.get('roastLevel')),
    weight: numberOrNullInput(data.get('weight')),
    weightRemaining: numberOrNullInput(data.get('weightRemaining')),
    frozen: data.get('frozen') === 'on'
  };
}

function inputValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(round(value, 3));
  return String(value);
}

function applyShotUpdate(shot: ShotRecord, update: ShotUpdate): ShotRecord {
  const workflow = update.workflow
    ? ({
        ...(shot.workflow ?? {}),
        ...update.workflow,
        context: Object.prototype.hasOwnProperty.call(update.workflow, 'context')
          ? update.workflow.context
          : shot.workflow?.context
      } as Workflow)
    : shot.workflow;
  return {
    ...shot,
    workflow,
    annotations: Object.prototype.hasOwnProperty.call(update, 'annotations')
      ? update.annotations
      : shot.annotations,
    shotNotes: Object.prototype.hasOwnProperty.call(update, 'shotNotes')
      ? update.shotNotes
      : shot.shotNotes,
    metadata: Object.prototype.hasOwnProperty.call(update, 'metadata')
      ? update.metadata
      : shot.metadata
  };
}

function temp(value: number | null | undefined): string {
  return value == null ? '--' : `${Math.round(value)}°C`;
}

function water(value: number | null | undefined): string {
  // The DE1 reports tank level as a height in millimetres (same as Streamline).
  return value == null ? '--' : `${Math.round(value)} mm`;
}

// A friendly readiness label instead of the raw machine state. Heating shows
// while warming up (including idle-but-below-target); otherwise "Ready".
function machineStatus(machine: MachineSnapshot | null, loading: boolean): string {
  if (!machine) return loading ? 'Connecting…' : 'Offline';
  switch (machine.state?.state) {
    case 'heating':
    case 'preheating':
      return 'Heating';
    case 'sleeping':
      return 'Asleep';
    case 'schedIdle':
      return 'Scheduled';
    case 'espresso':
      return 'Brewing';
    case 'steam':
      return 'Steaming';
    case 'steamRinse':
      return 'Steam rinse';
    case 'hotWater':
      return 'Hot water';
    case 'flush':
      return 'Flushing';
    case 'needsWater':
      return 'Add water';
    case 'cleaning':
      return 'Cleaning';
    case 'descaling':
      return 'Descaling';
    case 'booting':
      return 'Booting';
    case 'error':
      return 'Error';
    default: {
      const t = machine.groupTemperature;
      const target = machine.targetGroupTemperature;
      if (t != null && target != null && target > 0 && t < target - 2) return 'Heating';
      return 'Ready';
    }
  }
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

function isShotEditField(value: string | undefined): value is ShotEditField {
  return (
    value === 'coffeeRoaster' ||
    value === 'coffeeName' ||
    value === 'beanBatchId' ||
    value === 'finalBeverageType' ||
    value === 'baristaName' ||
    value === 'drinkerName' ||
    value === 'targetDoseWeight' ||
    value === 'targetYield' ||
    value === 'actualDoseWeight' ||
    value === 'actualYield' ||
    value === 'grinderId' ||
    value === 'grinderModel' ||
    value === 'grinderSetting' ||
    value === 'drinkTds' ||
    value === 'drinkEy' ||
    value === 'espressoNotes'
  );
}

function isMachineCommand(value: string | undefined): value is MachineState {
  return value === 'espresso' || value === 'steam' || value === 'flush' || value === 'hotWater';
}

function machineServiceState(state: MachineState | undefined): MachineServiceState | null {
  if (state === 'steam' || state === 'flush' || state === 'hotWater') return state;
  return null;
}

function machineServiceTone(service: MachineServiceState): MachineLaneOptions<object>['tone'] {
  if (service === 'hotWater') return 'water';
  return service;
}

function machineServiceVerb(service: MachineServiceState): string {
  if (service === 'hotWater') return 'Pouring hot water';
  if (service === 'flush') return 'Flushing';
  return 'Steaming';
}

function machineServiceTargetSeconds(
  service: MachineServiceState,
  steam: SteamSettings,
  water: HotWaterData,
  flush: RinseData
): number | null {
  if (service === 'steam') return positiveNumber(steam.duration);
  if (service === 'flush') return positiveNumber(flush.duration);
  return positiveNumber(water.duration) ?? hotWaterVolumeSeconds(water);
}

function hotWaterVolumeSeconds(water: HotWaterData): number | null {
  const volume = positiveNumber(water.volume);
  const flow = positiveNumber(water.flow);
  if (volume == null || flow == null) return null;
  return volume / flow;
}

function machineServiceStats(
  elapsedSeconds: number,
  targetSeconds: number | null
): Array<{ label: string; value: string; unit: string }> {
  return [
    { label: 'Elapsed', value: formatSecondsValue(elapsedSeconds), unit: 's' },
    { label: 'Target', value: targetSeconds == null ? '--' : formatSecondsValue(targetSeconds), unit: 's' }
  ];
}

function machineServiceMeta(
  service: MachineServiceState,
  steam: SteamSettings,
  water: HotWaterData,
  flush: RinseData,
  machine: MachineSnapshot | null
): string[] {
  if (service === 'steam') {
    return [
      `${formatNumber(steam.flow, 1)} ml/s`,
      `${formatNumber(steam.targetTemperature, 0)} C target`,
      `${formatNumber(machine?.steamTemperature, 0)} C steam`
    ];
  }
  if (service === 'hotWater') {
    return [
      `${formatNumber(water.flow, 1)} ml/s`,
      `${formatNumber(water.volume, 0)} ml target`,
      `${formatNumber(water.targetTemperature, 0)} C target`,
      `${formatNumber(machine?.mixTemperature, 0)} C water`
    ];
  }
  return [
    `${formatNumber(flush.flow, 1)} ml/s`,
    `${formatNumber(flush.targetTemperature, 0)} C target`,
    `${formatNumber(machine?.groupTemperature, 0)} C group`
  ];
}

function machineServicePrimaryTime(
  elapsedSeconds: number,
  targetSeconds: number | null
): { value: string; label: string } {
  if (targetSeconds == null) return { value: `${formatSecondsValue(elapsedSeconds)}s`, label: 'elapsed' };
  if (elapsedSeconds > targetSeconds) {
    return { value: `+${formatSecondsValue(elapsedSeconds - targetSeconds)}s`, label: 'over target' };
  }
  return { value: `${formatSecondsValue(targetSeconds - elapsedSeconds)}s`, label: 'remaining' };
}

function positiveNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function formatSecondsValue(value: number): string {
  if (!Number.isFinite(value)) return '--';
  return value >= 100 ? value.toFixed(0) : value.toFixed(1);
}

function machineCommandsAvailable(demo: boolean, info: MachineInfo | null): boolean {
  if (demo) return true;
  if (!info) return false;
  return isSimulatorMachine(info) || hasGroupHeadController(info) === false;
}

function liveChartModelOptions(mode: LiveChartMode): { minTime?: number } {
  return mode === 'preset30' ? { minTime: 30 } : {};
}

function liveChartHideMaxTimeLabel(mode: LiveChartMode, maxTime: number): boolean {
  return mode === 'auto' || maxTime > 30;
}

function hasGroupHeadController(info: MachineInfo): boolean | null {
  if (typeof info.GHC === 'boolean') return info.GHC;
  if (typeof info.groupHeadControllerPresent === 'boolean') return info.groupHeadControllerPresent;
  return null;
}

function isSimulatorMachine(info: MachineInfo): boolean {
  const text = [info.model, info.serialNumber, info.version]
    .filter((part): part is string => typeof part === 'string')
    .join(' ')
    .toLowerCase();
  if (text.includes('mock') || text.includes('simulator') || text.includes('simulated')) return true;
  return info.extra?.simulated === true || info.extra?.simulation === true;
}

function optimisticMachineSnapshot(
  machine: MachineSnapshot | null,
  state: MachineState
): MachineSnapshot {
  const now = new Date().toISOString();
  return {
    timestamp: now,
    state: { state },
    flow: machine?.flow ?? 0,
    pressure: machine?.pressure ?? 0,
    targetFlow: machine?.targetFlow ?? 0,
    targetPressure: machine?.targetPressure ?? 0,
    mixTemperature: machine?.mixTemperature ?? 0,
    groupTemperature: machine?.groupTemperature ?? 0,
    targetMixTemperature: machine?.targetMixTemperature ?? 0,
    targetGroupTemperature: machine?.targetGroupTemperature ?? 0,
    profileFrame: machine?.profileFrame ?? 0,
    steamTemperature: machine?.steamTemperature ?? 0
  };
}

function machineActionStatus(
  state: MachineState,
  phase: 'sending' | 'sent' | 'demo'
): string {
  const label = machineStateLabel(state);
  if (phase === 'sending') return state === 'idle' ? 'Stopping machine' : `Starting ${label}`;
  if (phase === 'demo') return state === 'idle' ? 'Demo stopped' : `Demo ${label}`;
  return state === 'idle' ? 'Machine stopped' : `${label} started`;
}

function machineStateLabel(state: MachineState): string {
  switch (state) {
    case 'espresso':
      return 'shot';
    case 'hotWater':
      return 'water';
    default:
      return state;
  }
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
