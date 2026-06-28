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
  Profile,
  ProfileRecord,
  RecipeDraft,
  RinseData,
  ScaleSnapshot,
  ShotAnnotations,
  ShotMeasurement,
  ShotRecord,
  ShotUpdate,
  SteamSettings,
  Workflow,
  WorkflowContext
} from './api/types';
import {
  GatewayRequestError,
  gateway,
  gatewayHttpOrigin,
  gatewayWsOrigin
} from './api/gateway';
import { readMachineSnapshot, readScaleSnapshot } from './api/guards';
import {
  capitalize,
  defaultExitValueForApp,
  draftSignature,
  formatNumber,
  isBrewState,
  isDecentAppWebView,
  isMachineCommand,
  isNoScaleShotBlockError,
  isThemePreference,
  isUIScalePreference,
  liveChartHideMaxTimeLabel,
  liveChartModelOptions,
  hasGroupHeadController,
  machineCommandsAvailable,
  machineStatus,
  nonNegativeNumber,
  positiveNumber,
  round,
  scaleBatteryLow,
  scaleConnected,
  scaleStatLabel,
  scaleStatTitle,
  sleepOverlayModel,
  startupStatusLabel,
  temp,
  water,
  workflowSignature,
  type LiveChartMode
} from './appShell';
import {
  appendBatchStorageEvent,
  batchStorageEvents,
  beanLabel,
  buildWorkflowUpdate,
  compareBeansForPicker,
  emptyRecipe,
  editLastBatchStorageEventDate,
  formatGrams,
  formatRatio,
  latestBatch,
  normalizeDraft,
  parseNumberInput,
  profileBaseTemperature,
  ratioFor,
  recipeFromShot,
  roastAgeLabel,
  selectInitialBean,
  shotFilterForBean,
  yieldForRatio
} from './domain/beanWorkflow';
import { batchOptionLabel } from './domain/beanDisplay';
import {
  readFavoriteBeans,
  readFavoriteProfiles,
  readGeminiApiKey,
  readLastBeanId,
  readScanOnThisDevice,
  writeFavoriteBeans,
  writeFavoriteProfiles,
  writeGeminiApiKey,
  writeLastBeanId,
  writeScanOnThisDevice
} from './domain/storage';
import {
  demoBatches,
  demoBeans,
  demoGrinders,
  demoLabelScan,
  demoLabelEnrich,
  demoMachine,
  demoProfiles,
  demoShotsForBean,
  demoWorkflow
} from './mock/demo';
import { enrichLabel, GeminiError, isGeminiKeyError, scanLabel, verifyGeminiKey } from './api/gemini';
import { fileToScaledImage, type CapturedImage } from './domain/labelImage';
import {
  findExistingBean,
  labelScanToDraft,
  lowConfidenceFields,
  mergeEnrichment,
  type LabelScan,
  type LabelScanDraft,
  type LabelScanDraftField
} from './domain/labelScan';
import {
  renderLabelScannerModal as renderLabelScannerModalView,
  type LabelScannerStep
} from './views/labelScannerView';
import { buildHandoffUrl, isHandoffArrival } from './domain/labelScanHandoff';
import { renderQrSvg } from './components/qr';
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
import { renderSettingsShell, type DecentAccountPanelState, type FlowCalibrationDisplay } from './components/SettingsShell';
import {
  SETTINGS_SPEC,
  coerceFieldValue,
  demoSettingsBundle,
  setBundleField,
  type SettingsBundle
} from './domain/settingsModel';
import type { DecentAccountStatus, PluginSettings } from './api/settings';
import { readDisplayState } from './api/settings';
import { createSettingsController } from './controllers/settingsController';
import {
  BeanWorkflowController,
  beanUsageFromShots,
  beanUsageForBean
} from './controllers/beanWorkflowController';
import {
  editProfileEditorInput,
  newProfileEditorInput,
  saveProfile,
  selectProfileForDraft,
  toggleFavoriteProfile
} from './controllers/profileEditorController';
import {
  includeShotInHistory,
  liveShotEndDecision,
  waitForCompletedLiveShot,
  type LiveShotCompletionContext
} from './controllers/liveShotController';
import {
  saveShotUpdate,
  shotEnjoymentUpdate
} from './controllers/shotMetadataController';
import {
  cleaningStartPlan,
  cleaningThresholdPlan,
  countShotForCleaningPlan,
  finishCleaningCyclePlan,
  loadCleaningWorkflow,
  pickCleaningProfilePlan
} from './controllers/cleaningWorkflowController';
import {
  cleaningWizardBack,
  cleaningWizardNext,
  cleaningWizardOnFlushComplete,
  cleaningWizardOnPullComplete,
  startCleaningWizard,
  type CleaningWizardState
} from './controllers/cleaningWizardController';
import {
  applyMachinePresetPlan,
  applyMachineValuePlan,
  buildMachineWorkflowPlan,
  machinePresetLabelKey,
  machinePresetsWithValues,
  normalizeSteamPurgeMode,
  persistMachineWorkflowPlan,
  steamPurgeModePlan,
  updateSteamPurgeModeAndReadBack
} from './controllers/machineSettingsWorkflowController';
import {
  normalizePluginId,
  pluginFieldDefault,
  pluginSettingsSpec,
  type PluginConfigState
} from './domain/pluginSettings';
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
  type SimpleProfileField
} from './components/profileEditor';
import type { ProfileMetaKey, StepFieldKey } from './domain/profileModel';
import { LiveChart } from './components/LiveChart';
import { chartModelFromShot, overlayComparisonModel } from './components/liveChartModel';
import type { LiveChartModel } from './domain/liveChartModel';
import {
  calibrationPreviewFactor,
  clampCalibration,
  recordedFlowMultiplier,
  renderFlowCalibrator,
  roundCalibration,
  shotProfileTitle
} from './components/flowCalibrator';
import {
  readFlowCalibrationGlobal,
  readFlowCalibrationOverrides,
  resolveFlowCalibration,
  setProfileOverride,
  writeFlowCalibrationGlobal,
  writeFlowCalibrationOverrides
} from './domain/flowCalibration';
import {
  LiveShotSession,
  liveShotDurationMs,
  simulateShotFrames,
  type LiveFrame,
  type LiveShotState
} from './domain/liveShot';
import {
  liveShotPanelDecision,
  liveTelemetryFrameState,
  liveTelemetryIdleDecision,
  type LiveTelemetryIdleDecision
} from './domain/liveTelemetry';
import { beanieCache } from './domain/cache';
import { loadGatewayStartupWithCache } from './data/startupRepository';
import {
  fetchShotPage as fetchShotPageFromRepository,
  loadLatestShotCandidates as loadLatestShotCandidatesFromRepository
} from './data/shotRepository';
import { loadBeanBatches } from './data/beanRepository';
import {
  renderPhoneProfilesPage as renderPhoneProfilePickerPage,
  renderProfilesPage as renderProfilePickerPage
} from './views/profilePickerView';
import {
  createStockFormKey,
  freezeAmountFormKey,
  newStockFormKey,
  renderBatchStorageModal as renderBatchStorageModalView,
  renderBeanPickerModal as renderBeanPickerModalView
} from './views/beanPickerView';
import {
  renderNoScaleShotModal as renderNoScaleShotModalView,
  renderDeleteShotModal as renderDeleteShotModalView,
  renderDeleteProfileModal as renderDeleteProfileModalView,
  renderWaterAlert as renderWaterAlertView,
  renderWaterWarningBanner as renderWaterWarningBannerView
} from './views/alertsView';
import {
  compareHistoryShot,
  liveGhostReference,
  renderHistoryView,
  selectedHistoryShot as selectHistoryShot
} from './views/historyView';
import { renderShotEditModal as renderShotEditModalView } from './views/shotEditorView';
import {
  hotWaterTargetSpec,
  machineHotWaterStopModeTile,
  machineSteamPurgeTile,
  machineValueTile,
  renderCleaningBar as renderCleaningBarView,
  renderMachinePage as renderMachinePageView,
  renderMachineProgressPage as renderMachineProgressPageView
} from './views/machineView';
import { renderCleaningWizardModal as renderCleaningWizardModalView } from './views/cleaningWizardView';
import {
  renderGrinderEditorPage as renderGrinderEditorPageView,
  renderMachineLabelModal as renderMachineLabelModalView,
  renderImportProfileModal as renderImportProfileModalView
} from './views/formsView';
import {
  renderLivePanel as renderLivePanelView,
  renderPageHeader,
  renderWorkbench as renderWorkbenchView,
  type LiveStagesView,
  type WorkbenchHeroViewModel
} from './views/workbenchView';
import { renderPhoneShell, type PhoneTab } from './views/phoneView';
import { scoreValueFromTap } from './components/shotScore';
import { isServiceShot } from './domain/shotRecord';
import {
  applySettingsPreferences,
  buildSettingsShellModel,
  isWakeAppZonePosition,
  readSettingsPreferences,
  resetBeanieCache,
  type SettingsPreferences,
  type WakeAppZonePosition,
  writeSettingsPreferences
} from './domain/settings';
import {
  loadAllFromStore,
  pollFromStore,
  setStorePushHandler,
  SETTINGS_STORE_NAMESPACE
} from './domain/settingsStore';
import {
  cleaningDue,
  readCleaningProfileOverride,
  readCleaningState,
  readCleaningThreshold,
  resolveCleaningProfile,
  writeCleaningProfileOverride,
  writeCleaningState,
  writeCleaningThreshold,
  type CleaningState
} from './domain/cleaning';
import { reconnectDelayMs } from './domain/connectionHealth';
import { optimisticShotFromLive, shotMetadataWithFreshness } from './domain/liveShotRecord';
import { waterAlertLevel, type WaterAlertLevel } from './domain/waterAlert';
import {
  FLUSH_PRESETS,
  HOT_WATER_PRESETS,
  STEAM_PRESETS,
  flushValues,
  hotWaterValues,
  matchingPreset,
  steamValues,
  waterControlCapabilities,
  type NumberSpec,
  type WaterControlCapabilities
} from './domain/waterSettings';
import type { MachineServiceState } from './domain/timedSteamStop';
import {
  machineServiceMeta,
  machineServicePrimaryTime,
  machineServiceState,
  machineServiceStats,
  machineServiceTargetSeconds,
  machineServiceTone,
  machineServiceVerb
} from './domain/machineService';
import { MachineServiceController } from './controllers/machineServiceController';
import {
  captureMachineServiceWorkflowRestore,
  extendedMachineServiceWorkflow,
  machineActionPreflight,
  machineActionStatus,
  optimisticMachineSnapshot,
  restoreMachineServiceWorkflowAfterEnd as restoreMachineServiceWorkflowAfterEndController,
  sendMachineActionCommand,
  type MachineServiceWorkflowRestore
} from './controllers/machineExecutionController';
import {
  readHotWaterStopMode,
  readHotWaterWeightTarget,
  readMachinePresetLabels,
  readMachinePresetSelection,
  readMachinePresetValues,
  writeHotWaterStopMode,
  writeHotWaterWeightTarget,
  writeMachinePresetLabels,
  writeMachinePresetSelection,
  writeMachinePresetValues,
  type HotWaterStopMode,
  type MachinePresetSelection,
  type MachinePresetValueOverrides
} from './domain/machinePreferences';
import {
  markSecondTapHintUsed,
  shouldShowSecondTapHint,
  type SecondTapHintKind
} from './domain/interactionHints';
import {
  isShotNumberField,
  shotNumberFieldStep,
  type ShotBeanEditState,
  type ShotEditDraft,
  type ShotEditField,
  type ShotFieldOption,
  type ShotFieldSpec
} from './domain/shotEditModel';

type Modal =
  | 'bean-picker'
  | 'batch-storage'
  | 'edit-number'
  | 'edit-shot'
  | 'machine-label'
  | 'no-scale-shot'
  | 'label-scanner'
  | 'delete-shot'
  | 'cleaning-wizard'
  | 'import-profile'
  | 'delete-profile'
  | null;
type EditField = 'dose' | 'yield' | 'ratio' | 'grinderSetting' | 'temperature';
interface ClickActionContext {
  el: HTMLElement;
  id?: string;
  field?: string;
  index?: string;
  value?: string;
}

type ClickActionHandler = (context: ClickActionContext) => void | Promise<void>;
type ApplyState = 'idle' | 'pending' | 'applied' | 'failed' | 'stale';
// 'starting' = machine ramping up (substate preparingForShot), before flow;
// 'active' = actually flowing (substate pouring); 'purging' = flow stopped but
// still in the service state (the DE1 steam puff / purge).
type BeanPickerMode = 'inspect' | 'create';
type View =
  | 'workbench'
  | 'flow-calibrator'
  | 'settings'
  | 'machine'
  | 'profiles'
  | 'profile-editor'
  | 'grinder-editor';

const initialSettingsPreferences = readSettingsPreferences();

const FOCUSABLE_SEARCH = new Set(['search', 'shot-search', 'profile-search', 'settings-search']);

// Scrollable containers whose scroll position must survive a re-render.
const SCROLL_SELECTORS = ['.bean-picker-list', '.bean-picker-batch-list', '.shot-list', '.shot-bean-list', '.profile-list', '.page-body', '.settings-detail', '.phone-main', '.phone-list'];
const PHONE_MEDIA_QUERY = '(max-width: 640px), (max-height: 500px) and (max-width: 900px)';
const PRESENCE_HEARTBEAT_INTERVAL_MS = 15_000;
// While the app is shown over a sleeping machine (wake-app zone), turn the screen
// back off after this much inactivity.
const WAKE_APP_IDLE_SCREEN_OFF_MS = 5 * 60 * 1000;
const SHOT_REFRESH_INTERVAL_MS = 60_000;
const BEAN_REFRESH_INTERVAL_MS = 30_000;
const NO_SCALE_SHOT_MESSAGE = 'Shot blocked: connect a scale to start.';
const NO_SCALE_MACHINE_STATUS = 'Connect scale';
const NO_SCALE_ABORT_WINDOW_MS = 3_000;
const SCALE_FRESH_WINDOW_MS = 5_000;
const NO_SCALE_WARNING_VISIBLE_MS = 6_000;

// Which editor field a tap-to-edit numpad dialog is bound to.
interface ProfileEditTarget {
  target: 'step-field' | 'simple-field' | 'exit' | 'meta' | 'limiter-range';
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

// State for the "Import profile from Visualizer" modal. `code` mirrors the
// last-submitted share code so it survives the re-render after an error.
interface ProfileImportState {
  code: string;
  busy: boolean;
  error: string | null;
}

// Turn a gateway failure into a short, user-facing import error. fetchJson
// formats HTTP errors as "POST /path returned 500: <detail>"; the plugin's
// detail is usually a JSON body like {"error":"..."}. Pull out the useful part.
function importErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const http = raw.match(/returned (\d+)(?::\s*([\s\S]*))?$/);
  if (http) {
    const detail = (http[2] ?? '').trim();
    if (!detail) return `Import failed (HTTP ${http[1]})`;
    try {
      const parsed = JSON.parse(detail) as { error?: unknown };
      if (parsed && typeof parsed.error === 'string') return parsed.error;
    } catch {
      // detail isn't JSON — use it verbatim
    }
    return detail;
  }
  return raw.trim() || 'Import failed';
}

// Pull the gateway's own explanation out of a failed save so the editor banner
// can show *why* (e.g. 'Profile must have "tank_temperature"') rather than a
// bare 'POST /api/v1/profiles returned 400'.
function profileSaveErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const detail = raw.match(/returned \d+:\s*([\s\S]+)$/);
  if (detail) return detail[1]!.trim();
  return raw.trim() || 'Save failed';
}

interface NumberEditTarget {
  target:
    | 'settings-field'
    | 'settings-plugin-field'
    | 'display-brightness'
    | 'flow-calibration'
    | 'bean-picker-batch'
    | 'shot-edit'
    | 'form-field'
    | 'water-soft'
    | 'machine-refill';
  group?: string;
  key?: string;
  beanId?: string;
  batchId?: string;
  name?: string;
  formKey?: string;
  field?: ShotEditField;
  returnModal?: Modal;
}

interface SecondTapHintState {
  kind: SecondTapHintKind;
  id: string;
}

interface BatchStorageTarget {
  beanId: string;
  batchId: string;
}

// A shot's dose handed back to the bag it was pulled from when the shot is
// deleted — the inverse of consumeBatchDoseForShot. `remaining`/`next` are the
// bag weights before and after, kept for the confirm dialog's before→after line.
interface ReclaimPlan {
  bean: Bean;
  batch: BeanBatch;
  dose: number;
  remaining: number;
  next: number;
}

interface DeleteShotTarget {
  shotId: string;
  reclaim: ReclaimPlan | null;
}

interface LabelScannerState {
  step: LabelScannerStep;
  handoff: boolean;
  qrSvg: string | null;
  qrUrl: string | null;
  keyDraft: string;
  verifying: boolean;
  verifyMessage: { tone: 'good' | 'warn'; text: string } | null;
  images: CapturedImage[];
  scan: LabelScan | null;
  draft: LabelScanDraft | null;
  lowConfidence: LabelScanDraftField[];
  webFields: LabelScanDraftField[];
  enriching: boolean;
  existingBeanId: string | null;
  existingBeanLabel: string | null;
  saving: boolean;
  error: string | null;
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
  beanUsageAt: Record<string, number>;
  draft: RecipeDraft;
  search: string;
  shotSearch: string;
  profileSearch: string;
  profilePage: number;
  profileFocusId: string | null;
  favoriteProfiles: string[];
  favoriteBeans: string[];
  settingsPreferences: SettingsPreferences;
  // True while one or more settings failed to save to the gateway store; drives
  // the blocking store-error overlay.
  storeError: boolean;
  // False until settings have loaded from the store on boot; drives the spinner.
  settingsLoaded: boolean;
  settingsSearch: string;
  demo: boolean;
  loading: boolean;
  busy: boolean;
  status: string;
  secondTapHint: SecondTapHintState | null;
  view: View;
  phoneTab: PhoneTab;
  settingsSection: string;
  settingsBundle: SettingsBundle | null;
  settingsSource: 'gateway' | 'demo' | 'loading' | null;
  pluginConfig: PluginConfigState | null;
  decentAccount: DecentAccountStatus | null;
  decentAccountSource: 'loading' | 'gateway' | 'demo' | 'unavailable' | null;
  decentAccountEmail: string;
  decentAccountPassword: string;
  decentAccountSaving: boolean;
  decentAccountMessage: { tone: 'good' | 'warn' | 'muted'; text: string } | null;
  modal: Modal;
  scanner: LabelScannerState | null;
  beanPickerBeanId: string | null;
  beanPickerMode: BeanPickerMode;
  beanPickerAutofocusSearch: boolean;
  beanPickerDraftBatchBeanId: string | null;
  beanPickerEditingBeanId: string | null;
  beanPickerEditingBatchId: string | null;
  beanPickerShowAllBags: boolean;
  beanPickerFocusedBatchId: string | null;
  beanPickerFreezeBatchId: string | null;
  batchStorageTarget: BatchStorageTarget | null;
  deleteShotTarget: DeleteShotTarget | null;
  editingGrinderId: string | null;
  profileEditor: ProfileEditorState | null;
  editingProfileId: string | null;
  editDialog: InputDialogState | null;
  shotEdit: ShotEditDraft | null;
  shotEditField: ShotEditField | null;
  shotBeanEdit: ShotBeanEditState | null;
  profileEdit: ProfileEditTarget | null;
  machineEdit: MachineEditTarget | null;
  numberEdit: NumberEditTarget | null;
  machineLabelEdit: MachineLabelEditTarget | null;
  profileImport: ProfileImportState | null;
  // Profile browser hide/delete: server-backed hidden list (lazy-loaded when
  // the user reveals it), and the profile awaiting delete confirmation.
  profilesShowHidden: boolean;
  hiddenProfiles: ProfileRecord[];
  profileDeleteTarget: { id: string; title: string } | null;
  machinePresetLabels: Record<string, string>;
  machinePresetValues: MachinePresetValueOverrides;
  machinePresetSelection: MachinePresetSelection;
  hotWaterStopMode: HotWaterStopMode;
  formNumbers: Record<string, string>;
  detailShotId: string | null;
  /** Shot overlaid on the history detail chart for comparison. */
  compareShotId: string | null;
  /** Armed by the compare button: the next history tap picks the overlay shot. */
  comparePicking: boolean;
  machineInfo: MachineInfo | null;
  machineCapabilities: MachineCapabilities | null;
  machineSettings: De1MachineSettings | null;
  machine: MachineSnapshot | null;
  scale: ScaleSnapshot | null;
  waterLevel: number | null;
  liveActive: boolean;
  /** Shot ended; keep the shot screen up while the gateway finishes saving it. */
  liveFinalizing: boolean;
  liveChartMode: LiveChartMode;
  asleep: boolean;
  /** User tapped the sleep-screen wake-app zone: show Beanie while the machine
   * stays asleep. Independent of `asleep`, which tracks the machine itself. */
  appAwake: boolean;
  /** Edge to flash a translucent wake-app-zone preview over for ~2s after the
   * user enables the zone or changes its placement in Settings; null when idle. */
  wakeZonePreview: WakeAppZonePosition | null;
  applyState: ApplyState;
  appliedSignature: string | null;
  flowCalDraft: number | null;
  flowCalBase: number | null;
  flowCalShotId: string | null;
  flowCalShots: ShotRecord[];
  cleaning: CleaningState;
  cleaningProfileOverride: string | null;
  cleaningThreshold: number;
  /** User dismissed the current hard low-water block (re-arms when it recovers). */
  waterAlertDismissed: boolean;
  /** The machine's own refill threshold in mm (from the waterLevels socket). */
  machineRefillLevel: number | null;
  /** The profiles picker is choosing the cleaning-override profile, not the recipe. */
  cleaningProfilePicking: boolean;
  /** Guided backflush cleaning wizard; null when the dialog is closed. */
  cleaningWizard: CleaningWizardState | null;
  /** The gateway snapshot socket is down; machine readouts are stale. */
  gatewayLinkDown: boolean;
  /** Draw the reference shot's curves under the live trace while pulling. */
  liveGhost: boolean;
}

interface LiveReadoutEls {
  time: HTMLElement | null;
  weight: HTMLElement | null;
  pressure: HTMLElement | null;
  flow: HTMLElement | null;
  temp: HTMLElement | null;
  stageRail: HTMLElement | null;
}

// Step names from a profile's raw steps[], for the live stage chip. Mirrors the
// historical shot graph's profileSteps naming (name -> title -> "Step N").
function profileStepNames(profile: Profile | null): string[] {
  if (!Array.isArray(profile?.steps)) return [];
  return profile.steps.map((step, index) => {
    const record = step as Record<string, unknown> | null;
    const name = typeof record?.name === 'string' ? record.name.trim() : '';
    const title = typeof record?.title === 'string' ? record.title.trim() : '';
    return name || title || `Step ${index + 1}`;
  });
}

function accountLoginErrorMessage(error: GatewayRequestError): string {
  if (error.issue.statusCode === 401) return 'Invalid Decent account email or password.';
  if (error.issue.statusCode === 404) return 'This Reaprime build does not expose account linking to Beanie.';
  if (error.issue.kind === 'network') return 'Could not reach the gateway.';
  const detail = error.issue.message.match(/returned \d+:\s*(.+)$/)?.[1]?.trim();
  return detail || 'Could not link Decent account.';
}

function isPhoneTab(value: string | undefined): value is PhoneTab {
  return value === 'home' || value === 'scan' || value === 'beans' || value === 'shots' || value === 'settings';
}

export class BeanieApp {
  private readonly settingsController = createSettingsController(gateway);
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
    beanUsageAt: {},
    draft: emptyRecipe(),
    search: '',
    shotSearch: '',
    profileSearch: '',
    profilePage: 0,
    profileFocusId: null,
    favoriteProfiles: readFavoriteProfiles(),
    favoriteBeans: readFavoriteBeans(),
    settingsPreferences: initialSettingsPreferences,
    storeError: false,
    settingsLoaded: false,
    settingsSearch: '',
    demo: false,
    loading: true,
    busy: false,
    status: 'Starting',
    secondTapHint: null,
    view: 'workbench',
    phoneTab: 'home',
    settingsSection: 'app',
    settingsBundle: null,
    settingsSource: null,
    pluginConfig: null,
    decentAccount: null,
    decentAccountSource: null,
    decentAccountEmail: '',
    decentAccountPassword: '',
    decentAccountSaving: false,
    decentAccountMessage: null,
    modal: null,
    scanner: null,
    beanPickerBeanId: null,
    beanPickerMode: 'inspect',
    beanPickerAutofocusSearch: false,
    beanPickerDraftBatchBeanId: null,
    beanPickerEditingBeanId: null,
    beanPickerEditingBatchId: null,
    beanPickerShowAllBags: false,
    beanPickerFocusedBatchId: null,
    beanPickerFreezeBatchId: null,
    batchStorageTarget: null,
    deleteShotTarget: null,
    editingGrinderId: null,
    profileEditor: null,
    editingProfileId: null,
    editDialog: null,
    shotEdit: null,
    shotEditField: null,
    shotBeanEdit: null,
    profileEdit: null,
    machineEdit: null,
    numberEdit: null,
    machineLabelEdit: null,
    profileImport: null,
    profilesShowHidden: false,
    hiddenProfiles: [],
    profileDeleteTarget: null,
    machinePresetLabels: readMachinePresetLabels(),
    machinePresetValues: readMachinePresetValues(),
    machinePresetSelection: readMachinePresetSelection(),
    hotWaterStopMode: readHotWaterStopMode(),
    formNumbers: {},
    detailShotId: null,
    compareShotId: null,
    comparePicking: false,
    machineInfo: null,
    machineCapabilities: null,
    machineSettings: null,
    machine: null,
    scale: null,
    waterLevel: null,
    liveActive: false,
    liveFinalizing: false,
    liveChartMode: 'preset30',
    asleep: false,
    appAwake: false,
    wakeZonePreview: null,
    applyState: 'idle',
    appliedSignature: null,
    flowCalDraft: null,
    flowCalBase: null,
    flowCalShotId: null,
    flowCalShots: [],
    cleaning: readCleaningState(),
    cleaningProfileOverride: readCleaningProfileOverride(),
    cleaningThreshold: readCleaningThreshold(),
    waterAlertDismissed: false,
    machineRefillLevel: null,
    cleaningProfilePicking: false,
    cleaningWizard: null,
    gatewayLinkDown: false,
    liveGhost: true
  };

  private applyTimer: number | null = null;
  private machineRetryTimer: number | null = null;
  private scaleRetryTimer: number | null = null;
  private waterRetryTimer: number | null = null;
  private displayRetryTimer: number | null = null;
  // Consecutive failed (re)connect attempts per socket, for backoff pacing.
  private machineSocketAttempts = 0;
  private scaleSocketAttempts = 0;
  private waterSocketAttempts = 0;
  private displaySocketAttempts = 0;
  private shotRefreshTimer: number | null = null;
  private beanRefreshTimer: number | null = null;
  private machineSocket: WebSocket | null = null;
  private scaleSocket: WebSocket | null = null;
  private waterSocket: WebSocket | null = null;
  private displaySocket: WebSocket | null = null;
  private disposed = false;
  // Memoised so the boot settings load runs once; the scanner awaits it too.
  private settingsLoadPromise: Promise<void> | null = null;
  // Live cross-device sync: re-poll the store on this interval.
  private settingsPollTimer: number | null = null;
  // Setting pushes that failed; keyed by store key so a Retry re-sends each.
  private readonly failedStoreWrites = new Map<string, string | null>();
  private shotRefreshInFlight = false;
  private beanRefreshInFlight = false;
  private applyRequestId = 0;
  private loadMoreRequestId = 0;
  private shotCacheGeneration = 0;

  private readonly beanWorkflow = new BeanWorkflowController();
  private readonly liveShot = new LiveShotSession();
  private liveChart: LiveChart | null = null;
  private liveCanvas: HTMLCanvasElement | null = null;
  private liveReadoutEls: LiveReadoutEls | null = null;
  private liveRaf: number | null = null;
  private liveDirty = false;
  // Cached chart model for the selected history/calibrator shot. Building the
  // model walks the shot's full measurement array, which is too expensive to
  // repeat on every setState re-render. Measurements are immutable once saved,
  // so the cache is keyed by shot id plus the measurements array reference (the
  // reference changes when a placeholder record is later upgraded with data).
  private shotChartModelCache: { shotId: string; measurements: readonly ShotMeasurement[]; model: LiveChartModel } | null = null;
  // Same shape, for the shot overlaid on the detail chart by compare mode.
  private compareChartModelCache: { shotId: string; measurements: readonly ShotMeasurement[]; model: LiveChartModel } | null = null;
  // Reference shot captured when a live pull starts, drawn under the live
  // trace (its chart model is built once here, off the telemetry hot path).
  private liveGhostModel: LiveChartModel | null = null;
  private liveGhostShotId: string | null = null;
  private detailChartCanvas: HTMLCanvasElement | null = null;
  private detailChartShotId: string | null = null;
  private detailChartCompareShotId: string | null = null;
  private simTimer: number | null = null;
  private readonly machineService = new MachineServiceController();
  // True while a cleaning/backflush cycle is running as an espresso pull, so the
  // shot-end handler records a cleaning (not a bean shot) and restores the recipe.
  private cleaningInProgress = false;
  // Last computed water-alert band, used to detect threshold crossings on the
  // telemetry hot path (so we only re-render when the band actually changes).
  private lastWaterAlert: WaterAlertLevel = 'none';
  private machineProgressReturnView: View | null = null;
  private machineStopFeedbackTimer: number | null = null;
  private timedSteamStopTimer: number | null = null;
  private timedSteamStopScheduledForMs: number | null = null;
  private machineServiceWorkflowToRestore: MachineServiceWorkflowRestore | null = null;
  private sleepBrightnessTimer: number | null = null;
  private sleepBrightnessZeroed = false;
  // Brightness to restore when the user wakes the app without the machine.
  // Kept current off the live display socket; falls back to 100.
  private wakeAppRestoreBrightness = 100;
  // The in-flight sleep-dim brightness PUT, so a wake-app restore can sequence
  // after it (otherwise the two PUTs race and the screen can stay black).
  private sleepDimPromise: Promise<void> | null = null;
  private wakeZonePreviewTimer: number | null = null;
  private wakeAppIdleTimer: number | null = null;
  private applyAfterWake = false;
  private lastPresenceHeartbeatMs = 0;
  private lastScaleFrameMs: number | null = null;
  private noScaleBrewFlashStartedMs: number | null = null;
  private noScaleShotWarningUntilMs = 0;
  private readonly phoneMedia = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(PHONE_MEDIA_QUERY)
    : null;
  private readonly handlePhoneMediaChange = () => {
    this.render();
  };

  private readonly handleClick = (event: Event) => {
    this.noteUserActivity();
    void this.onClick(event);
  };
  private readonly handleInput = (event: Event) => {
    this.noteUserActivity();
    this.onInput(event);
  };
  private readonly handleChange = (event: Event) => {
    this.noteUserActivity();
    void this.onChange(event);
  };
  private readonly handleFocusOut = (event: FocusEvent) => {
    this.noteUserActivity();
    void this.onFocusOut(event);
  };
  private readonly handleSubmit = (event: Event) => {
    this.noteUserActivity();
    void this.onSubmit(event);
  };
  private readonly handleKeydown = () => {
    this.noteUserActivity();
  };
  private readonly handleWheel = (event: WheelEvent) => {
    this.noteUserActivity();
    this.onScrollGesture(event);
  };
  private readonly handleTouchStart = (event: TouchEvent) => {
    this.noteUserActivity();
    this.onTouchStart(event);
  };
  private readonly handleTouchMove = (event: TouchEvent) => {
    this.noteUserActivity();
    this.onTouchMove(event);
  };
  private touchScrollPoint: { x: number; y: number } | null = null;
  // Decided once per touch gesture. On both WebKit and Chrome/Android, calling
  // preventDefault on the first touchmove of a gesture cancels native scrolling
  // for the *entire* gesture. If we locked at a scroll boundary (e.g. pulling up
  // while already at the top), the rest of the same swipe — including scrolling
  // back down — would do nothing. So we lock the page only when the touch began
  // over a region with no scrollable ancestor, and keep that for the gesture.
  private touchGestureLocked: boolean | null = null;

  constructor(private readonly root: HTMLElement) {}

  start(): void {
    this.disposed = false;
    // Route synced-setting writes to the gateway store (no-op in demo).
    setStorePushHandler((storeKey, value) => this.pushSettingToStore(storeKey, value));
    applySettingsPreferences(this.state.settingsPreferences);
    this.root.addEventListener('click', this.handleClick);
    this.root.addEventListener('input', this.handleInput);
    this.root.addEventListener('change', this.handleChange);
    this.root.addEventListener('focusout', this.handleFocusOut);
    this.root.addEventListener('submit', this.handleSubmit);
    this.root.addEventListener('keydown', this.handleKeydown);
    this.root.addEventListener('wheel', this.handleWheel, { passive: false });
    this.root.addEventListener('touchstart', this.handleTouchStart, { passive: true });
    this.root.addEventListener('touchmove', this.handleTouchMove, { passive: false });
    this.phoneMedia?.addEventListener('change', this.handlePhoneMediaChange);
    // Live settings sync: re-poll the store whenever this device regains focus.
    window.addEventListener('focus', this.handleWindowFocus);
    this.render();
    void this.load();
    if (isHandoffArrival(location.search)) {
      history.replaceState(null, '', location.pathname);
      void this.openLabelScanner({ fromHandoff: true });
    }
  }

  dispose(): void {
    this.disposed = true;
    setStorePushHandler(null);
    this.root.removeEventListener('click', this.handleClick);
    this.root.removeEventListener('input', this.handleInput);
    this.root.removeEventListener('change', this.handleChange);
    this.root.removeEventListener('focusout', this.handleFocusOut);
    this.root.removeEventListener('submit', this.handleSubmit);
    this.root.removeEventListener('keydown', this.handleKeydown);
    this.root.removeEventListener('wheel', this.handleWheel);
    this.root.removeEventListener('touchstart', this.handleTouchStart);
    this.root.removeEventListener('touchmove', this.handleTouchMove);
    this.phoneMedia?.removeEventListener('change', this.handlePhoneMediaChange);
    window.removeEventListener('focus', this.handleWindowFocus);
    if (this.settingsPollTimer != null) window.clearInterval(this.settingsPollTimer);
    if (this.applyTimer != null) window.clearTimeout(this.applyTimer);
    if (this.machineRetryTimer != null) window.clearTimeout(this.machineRetryTimer);
    if (this.scaleRetryTimer != null) window.clearTimeout(this.scaleRetryTimer);
    if (this.waterRetryTimer != null) window.clearTimeout(this.waterRetryTimer);
    if (this.displayRetryTimer != null) window.clearTimeout(this.displayRetryTimer);
    if (this.shotRefreshTimer != null) window.clearInterval(this.shotRefreshTimer);
    if (this.beanRefreshTimer != null) window.clearInterval(this.beanRefreshTimer);
    if (this.simTimer != null) window.clearTimeout(this.simTimer);
    if (this.timedSteamStopTimer != null) window.clearTimeout(this.timedSteamStopTimer);
    if (this.sleepBrightnessTimer != null) window.clearTimeout(this.sleepBrightnessTimer);
    if (this.wakeZonePreviewTimer != null) window.clearTimeout(this.wakeZonePreviewTimer);
    if (this.wakeAppIdleTimer != null) window.clearTimeout(this.wakeAppIdleTimer);
    if (this.liveRaf != null) window.cancelAnimationFrame(this.liveRaf);
    this.clearMachineStopRequest();
    this.applyTimer = null;
    this.machineRetryTimer = null;
    this.scaleRetryTimer = null;
    this.waterRetryTimer = null;
    this.displayRetryTimer = null;
    this.shotRefreshTimer = null;
    this.beanRefreshTimer = null;
    this.simTimer = null;
    this.timedSteamStopTimer = null;
    this.sleepBrightnessTimer = null;
    this.liveRaf = null;
    this.closeLiveSockets();
  }

  private onScrollGesture(event: WheelEvent): void {
    if (!this.canScrollInsideApp(event.target, event.deltaX, event.deltaY)) {
      event.preventDefault();
    }
  }

  private onTouchStart(event: TouchEvent): void {
    const touch = event.touches[0];
    this.touchScrollPoint = touch ? { x: touch.clientX, y: touch.clientY } : null;
    this.touchGestureLocked = null;
  }

  private onTouchMove(event: TouchEvent): void {
    const touch = event.touches[0];
    if (!touch || !this.touchScrollPoint) return;

    this.touchScrollPoint = { x: touch.clientX, y: touch.clientY };

    // Lock the page (block the bounce) only for gestures that started over a
    // non-scrollable region. Inside a scroll area we must never preventDefault,
    // or the engine cancels the whole swipe after a boundary overscroll (true on
    // WebKit and Chrome/Android alike). Chaining past the area's edge is already
    // absorbed by overscroll-behavior on the root, which is overflow:hidden and
    // cannot move.
    if (this.touchGestureLocked == null) {
      this.touchGestureLocked = !this.hasScrollableAncestor(event.target);
    }
    if (this.touchGestureLocked) {
      event.preventDefault();
    }
  }

  private hasScrollableAncestor(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false;
    let el: Element | null = target;
    while (el && el !== this.root) {
      if (this.elementIsScrollable(el)) return true;
      el = el.parentElement;
    }
    return false;
  }

  private elementIsScrollable(el: Element): boolean {
    const style = window.getComputedStyle(el);
    const yScrollable = /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1;
    const xScrollable = /(auto|scroll)/.test(style.overflowX) && el.scrollWidth > el.clientWidth + 1;
    return yScrollable || xScrollable;
  }

  private canScrollInsideApp(target: EventTarget | null, deltaX: number, deltaY: number): boolean {
    if (!(target instanceof Element)) return false;

    let el: Element | null = target;
    while (el && el !== this.root) {
      if (this.elementCanScroll(el, deltaX, deltaY)) return true;
      el = el.parentElement;
    }
    return false;
  }

  private elementCanScroll(el: Element, deltaX: number, deltaY: number): boolean {
    const style = window.getComputedStyle(el);
    const yScrollable = /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1;
    const xScrollable = /(auto|scroll)/.test(style.overflowX) && el.scrollWidth > el.clientWidth + 1;

    if (yScrollable && Math.abs(deltaY) >= Math.abs(deltaX)) {
      const maxTop = el.scrollHeight - el.clientHeight;
      return deltaY < 0 ? el.scrollTop > 0 : el.scrollTop < maxTop - 1;
    }

    if (xScrollable && Math.abs(deltaX) > Math.abs(deltaY)) {
      const maxLeft = el.scrollWidth - el.clientWidth;
      return deltaX < 0 ? el.scrollLeft > 0 : el.scrollLeft < maxLeft - 1;
    }

    return false;
  }

  private noteUserActivity(): void {
    if (this.state.demo) return;
    // Showing the app over a sleeping machine: any interaction defers the
    // screen-off; once it's no longer awake-over-asleep, drop a stale timer.
    if (this.state.appAwake) this.armWakeAppIdleTimer();
    else this.clearWakeAppIdleTimer();
    const now = Date.now();
    if (now - this.lastPresenceHeartbeatMs < PRESENCE_HEARTBEAT_INTERVAL_MS) return;
    this.lastPresenceHeartbeatMs = now;
    void gateway.heartbeat().catch((error) => {
      console.warn('[Beanie] Presence heartbeat failed', error);
    });
  }

  private async load(): Promise<void> {
    const prevSignature = this.state.appliedSignature;
    this.setState({ loading: true, status: 'Loading Decent.app data' });
    // Settings live only in the gateway store now — load them (the spinner shows
    // until this resolves) before rendering real content.
    await this.loadSettings();
    try {
      const latestShotQuery = new URLSearchParams({ limit: '50', offset: '0', order: 'desc' });
      const startup = await loadGatewayStartupWithCache(latestShotQuery, { cache: beanieCache });
      const workflow = startup.data.workflow;
      const beans = startup.data.beans;
      if (!workflow || !beans) {
        throw new Error('Essential gateway startup data was unavailable');
      }
      const grinders = startup.data.grinders ?? [];
      const profiles = startup.data.profiles ?? [];
      const latestShots = startup.data.latestShots ?? {
        items: [],
        total: 0,
        limit: Number(latestShotQuery.get('limit') ?? 0),
        offset: Number(latestShotQuery.get('offset') ?? 0)
      };
      const machineInfo = await gateway.machineInfo().catch((error) => {
        console.warn('[Beanie] Could not load machine info', error);
        return null;
      });
      const machine = await gateway.machineState().catch((error) => {
        console.warn('[Beanie] Could not load machine state', error);
        return null;
      });
      if (this.disposed) return;
      const machineSleeping = machine?.state?.state === 'sleeping';

      this.setState({
        workflow,
        beans,
        beanUsageAt: beanUsageFromShots(beans, latestShots.items, this.state.batchesByBean),
        grinders,
        profiles,
        machineInfo,
        machine,
        asleep: machineSleeping,
        demo: false,
        loading: false,
        status: machineSleeping ? 'Machine asleep' : startupStatusLabel(startup.status)
      });
      this.noteUserActivity();

      const selected = selectInitialBean(beans, workflow, readLastBeanId(), latestShots.items[0]);
      if (selected) {
        const wantsStartupApply = !this.workflowMatchesBean(selected);
        await this.selectBean(selected.id, {
          apply: wantsStartupApply && !machineSleeping,
          preferWorkflow: true
        });
        if (wantsStartupApply && machineSleeping) {
          this.applyAfterWake = true;
          this.setState({ applyState: 'stale', status: 'Machine asleep — tap Wake to load recipe' });
        }
      }
      if (prevSignature != null && workflowSignature(workflow) !== prevSignature) {
        this.setState({ applyState: 'stale', status: 'Workflow changed on the machine' });
      }
      void this.loadMachineControlState();
      this.connectMachineSocket();
      this.connectScaleSocket();
      this.connectWaterLevelSocket();
      this.connectDisplaySocket();
      this.startShotRefreshTimer();
      this.startBeanRefreshTimer();
    } catch (error) {
      if (this.disposed) return;
      console.warn('[Beanie] Gateway unavailable; using demo data', error);
      this.loadDemo();
    }
  }

  private loadDemo(): void {
    const demoShotUsage = demoBeans.flatMap((bean) => demoShotsForBean(bean));
    this.setState({
      workflow: demoWorkflow,
      beans: demoBeans,
      beanUsageAt: beanUsageFromShots(demoBeans, demoShotUsage, demoBatches),
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
    options: { apply: boolean; preferWorkflow: boolean; preferredBatchId?: string | null }
  ): Promise<void> {
    const selection = this.beanWorkflow.beginBeanSelection(beanId, this.state.beans, { writeLastBeanId });
    if (!selection) return;
    this.setState(selection.state);

    const result = await this.beanWorkflow.completeBeanSelection({
      selection,
      options,
      beans: this.state.beans,
      workflow: this.state.workflow,
      profiles: this.state.profiles,
      grinders: this.state.grinders,
      fallbackDraft: this.state.draft,
      loadBatches: (selected) => this.loadBatches(selected),
      loadFirstShots: (selected, selectedBatch) => this.loadFirstShots(selected, selectedBatch),
      isCurrent: (current) =>
        this.beanWorkflow.isCurrentBeanSelection(current) &&
        this.state.selectedBeanId === current.bean.id,
      workflowMatchesBean: (selected, batches) => this.workflowMatchesBean(selected, batches)
    });
    if (result.type === 'stale') return;

    this.setState({
      batchesByBean: { ...this.state.batchesByBean, [result.bean.id]: result.batches },
      selectedBatchId: result.selectedBatch?.id ?? null,
      shots: result.shots,
      shotsTotal: result.shotsTotal,
      shotsLoadingMore: false,
      compareShotId: null,
      comparePicking: false,
      beanUsageAt: {
        ...this.state.beanUsageAt,
        ...result.beanUsageAt
      },
      draft: result.draft,
      busy: false,
      applyState: 'idle',
      appliedSignature: workflowSignature(this.state.workflow),
      status: result.status
    });

    if (options.apply) {
      await this.applyDraft();
    }
  }

  private async loadBatches(bean: Bean): Promise<BeanBatch[]> {
    if (this.state.demo) return this.state.batchesByBean[bean.id] ?? [];
    return loadBeanBatches(bean.id, { gateway, cache: beanieCache });
  }

  private async openBeanPicker(
    beanId: string | null,
    options: { create?: boolean; autofocusSearch?: boolean } = {}
  ): Promise<void> {
    const id = beanId ?? this.state.selectedBeanId;
    this.setState({
      modal: 'bean-picker',
      search: '',
      beanPickerBeanId: options.create ? null : id,
      beanPickerMode: options.create ? 'create' : 'inspect',
      beanPickerAutofocusSearch: options.autofocusSearch ?? false,
      beanPickerDraftBatchBeanId: null,
      beanPickerEditingBeanId: null,
      beanPickerEditingBatchId: null,
      beanPickerShowAllBags: false,
      beanPickerFocusedBatchId: null,
      beanPickerFreezeBatchId: null
    });
    if (!options.create) void this.refreshBeans({ force: true, allowModal: true });
    if (id && !options.create) await this.ensureBatchesLoaded(id);
  }

  private async inspectBeanInPicker(beanId: string): Promise<void> {
    this.setState({
      beanPickerBeanId: beanId,
      beanPickerMode: 'inspect',
      beanPickerDraftBatchBeanId: null,
      beanPickerEditingBeanId: null,
      beanPickerEditingBatchId: null,
      beanPickerShowAllBags: false,
      beanPickerFocusedBatchId: null,
      beanPickerFreezeBatchId: null,
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

  private async loadFirstShots(
    bean: Bean,
    batch: BeanBatch | null
  ): Promise<{ records: ShotRecord[]; total: number }> {
    if (this.state.demo) {
      const records = demoShotsForBean(bean);
      return { records, total: records.length };
    }
    return this.fetchShotPage(bean, batch, 0);
  }

  // Fetches one page of shots, caching the page + summaries and reading full
  // records through the IndexedDB cache. Falls back to a cached page when the
  // gateway is unreachable so history stays usable offline.
  private async fetchShotPage(
    bean: Bean,
    batch: BeanBatch | null,
    offset: number
  ): Promise<{ records: ShotRecord[]; total: number }> {
    const cacheGeneration = this.shotCacheGeneration;
    const query = shotFilterForBean(bean, batch);
    return fetchShotPageFromRepository(
      { query, pageSize: this.shotPageSize, offset },
      {
        gateway,
        cache: beanieCache,
        canWriteCache: () => cacheGeneration === this.shotCacheGeneration
      }
    );
  }

  private async loadMoreShots(): Promise<void> {
    const bean = this.selectedBean();
    if (!bean || this.state.demo || this.state.shotsLoadingMore) return;
    if (this.state.shots.length >= this.state.shotsTotal) return;
    const requestId = ++this.loadMoreRequestId;
    const offset = this.state.shots.length;
    const batch = this.selectedBatch();
    this.setHistoryState({ shotsLoadingMore: true, status: 'Loading more shots' });
    try {
      const { records } = await this.fetchShotPage(bean, batch, offset);
      if (
        requestId !== this.loadMoreRequestId ||
        this.selectedBean()?.id !== bean.id ||
        this.selectedBatch()?.id !== batch?.id
      ) return;
      const shots = [...this.state.shots, ...records];
      // Full render: the appended shots also feed the hero's shots-left estimate.
      this.setState({ shots, shotsLoadingMore: false, status: `${shots.length} shots` });
    } catch (error) {
      console.warn('[Beanie] Could not load more shots', error);
    } finally {
      // Never leave the flag stuck: it gates both pagination and the periodic
      // shot refresh. A newer request owns the flag, so only the latest clears.
      if (requestId === this.loadMoreRequestId && this.state.shotsLoadingMore) {
        this.setHistoryState({ shotsLoadingMore: false });
      }
    }
  }

  private startShotRefreshTimer(): void {
    if (this.shotRefreshTimer != null) return;
    this.shotRefreshTimer = window.setInterval(() => {
      void this.refreshVisibleShots();
    }, SHOT_REFRESH_INTERVAL_MS);
  }

  private startBeanRefreshTimer(): void {
    if (this.beanRefreshTimer != null) return;
    this.beanRefreshTimer = window.setInterval(() => {
      void this.refreshBeans();
    }, BEAN_REFRESH_INTERVAL_MS);
  }

  private async refreshBeans(options: { force?: boolean; allowModal?: boolean } = {}): Promise<void> {
    if (this.state.demo || this.disposed || this.beanRefreshInFlight) return;
    if (this.state.busy) return;
    if (!options.allowModal && this.state.modal && !this.canRefreshBeansInsideModal()) return;
    if (
      !options.force &&
      typeof document !== 'undefined' &&
      document.visibilityState &&
      document.visibilityState !== 'visible'
    ) return;

    this.beanRefreshInFlight = true;
    try {
      const beans = await gateway.beans();
      if (this.disposed || !beansChanged(this.state.beans, beans)) return;

      const beanIds = new Set(beans.map((bean) => bean.id));
      const selectedBeanId = this.state.selectedBeanId && beanIds.has(this.state.selectedBeanId)
        ? this.state.selectedBeanId
        : null;
      const beanPickerBeanId = this.state.beanPickerBeanId && beanIds.has(this.state.beanPickerBeanId)
        ? this.state.beanPickerBeanId
        : selectedBeanId;
      const beanPickerEditingBeanId = this.state.beanPickerEditingBeanId && beanIds.has(this.state.beanPickerEditingBeanId)
        ? this.state.beanPickerEditingBeanId
        : null;
      this.setState({
        beans,
        selectedBeanId,
        selectedBatchId: selectedBeanId ? this.state.selectedBatchId : null,
        beanPickerBeanId,
        beanPickerEditingBeanId,
        batchesByBean: keepKeys(this.state.batchesByBean, beanIds),
        beanUsageAt: keepKeys(this.state.beanUsageAt, beanIds)
      });
      void beanieCache.putBeans(beans).catch(() => {});
    } catch (error) {
      console.warn('[Beanie] Could not refresh beans', error);
    } finally {
      this.beanRefreshInFlight = false;
    }
  }

  private canRefreshBeansInsideModal(): boolean {
    if (this.state.modal !== 'bean-picker' || this.state.beanPickerMode === 'create') return false;
    return this.root.querySelector('.bean-picker-fields input:focus, .bean-picker-fields textarea:focus, .bean-picker-batch input:focus') == null;
  }

  private async refreshVisibleShots(): Promise<void> {
    const bean = this.selectedBean();
    if (!bean || this.state.demo || this.shotRefreshInFlight) return;
    if (document.visibilityState !== 'visible' || this.state.view !== 'workbench') return;
    if (this.state.liveActive || this.state.liveFinalizing || this.state.shotsLoadingMore) return;
    // Skip while a modal covers the workbench: the shot list isn't visible, and a
    // re-render would disrupt in-progress editing (e.g. the bean picker forms).
    if (this.state.modal === 'edit-shot' || this.state.modal === 'bean-picker' || this.state.modal === 'batch-storage') return;

    this.shotRefreshInFlight = true;
    const batch = this.selectedBatch();
    try {
      const { records, total } = await this.fetchShotPage(bean, batch, 0);
      if (
        this.selectedBean()?.id !== bean.id ||
        this.selectedBatch()?.id !== batch?.id ||
        this.state.liveActive ||
        this.state.liveFinalizing
      ) return;

      const firstPageIds = new Set(records.map((shot) => shot.id));
      const tail = this.state.shots.filter((shot) => !firstPageIds.has(shot.id));
      const shots = [...records, ...tail].slice(0, Math.max(this.shotPageSize, this.state.shots.length));
      const selectedShotStillVisible = this.state.detailShotId
        ? shots.some((shot) => shot.id === this.state.detailShotId)
        : false;

      this.setState({
        shots,
        shotsTotal: total,
        shotsLoadingMore: false,
        detailShotId: selectedShotStillVisible ? this.state.detailShotId : shots.find((shot) => !isServiceShot(shot))?.id ?? null,
        beanUsageAt: {
          ...this.state.beanUsageAt,
          ...beanUsageForBean(bean.id, records)
        }
      });
    } catch (error) {
      console.warn('[Beanie] Could not refresh shots', error);
    } finally {
      this.shotRefreshInFlight = false;
    }
  }

  private async loadLatestShotCandidates(limit = 6): Promise<ShotRecord[]> {
    const cacheGeneration = this.shotCacheGeneration;
    return loadLatestShotCandidatesFromRepository(limit, {
      gateway,
      cache: beanieCache,
      canWriteCache: () => cacheGeneration === this.shotCacheGeneration
    });
  }

  private async applyDraft(): Promise<void> {
    const bean = this.selectedBean();
    if (!bean) return;

    if (!this.state.demo && this.machineIsSleeping()) {
      this.applyAfterWake = true;
      this.setState({ applyState: 'stale', status: 'Machine asleep — tap Wake to apply' });
      return;
    }

    const draft = normalizeDraft(this.state.draft, this.state.profiles, this.state.grinders);
    const batch = this.selectedBatch();
    const update = buildWorkflowUpdate(bean, batch, draft, draft.profile, this.state.workflow);
    const signature = draftSignature(draft);
    const requestId = ++this.applyRequestId;

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
      void this.applyProfileFlowCalibration(draft.profileTitle ?? draft.profile?.title ?? null);
      return;
    }

    try {
      const workflow = await gateway.updateWorkflow(update);
      if (requestId !== this.applyRequestId) return;
      void beanieCache.putWorkflow(workflow).catch(() => {});
      const currentSignature = draftSignature(
        normalizeDraft(this.state.draft, this.state.profiles, this.state.grinders)
      );
      if (currentSignature !== signature) {
        this.setState({
          workflow,
          applyState: 'stale',
          appliedSignature: signature,
          status: 'Draft changed; applying soon'
        });
        return;
      }
      this.setState({
        workflow,
        applyState: 'applied',
        appliedSignature: signature,
        status: 'Workflow applied'
      });
      void this.applyProfileFlowCalibration(draft.profileTitle ?? draft.profile?.title ?? null);
    } catch (error) {
      if (requestId !== this.applyRequestId) return;
      const currentSignature = draftSignature(
        normalizeDraft(this.state.draft, this.state.profiles, this.state.grinders)
      );
      if (currentSignature !== signature) {
        this.setState({ applyState: 'stale', status: 'Draft changed; applying soon' });
        return;
      }
      console.error('[Beanie] Apply failed', error);
      this.setState({ applyState: 'failed', status: 'Apply failed' });
    }
  }

  private machineIsSleeping(): boolean {
    return this.state.asleep || this.state.machine?.state?.state === 'sleeping';
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
    this.completeSecondTapHint('shot');
    this.setState({
      draft: normalizeDraft(recipeFromShot(shot, 'planned'), this.state.profiles, this.state.grinders),
      view: 'workbench',
      detailShotId: shotId,
      secondTapHint: null,
      status: 'Shot recipe loaded'
    });
    this.scheduleApply();
  }

  private selectHistoryShot(shotId: string): void {
    if (this.state.comparePicking) {
      const sameAsSelected = this.selectedHistoryShot()?.id === shotId;
      this.setHistoryState({
        compareShotId: sameAsSelected ? this.state.compareShotId : shotId,
        comparePicking: false,
        status: sameAsSelected ? this.state.status : 'Comparing shots'
      });
      return;
    }
    if (this.selectedHistoryShot()?.id === shotId) {
      this.loadShotRecipe(shotId);
      return;
    }
    this.setHistoryState({
      detailShotId: shotId,
      secondTapHint: this.nextSecondTapHint('shot', shotId),
      status: 'Shot selected'
    });
  }

  private nextSecondTapHint(kind: SecondTapHintKind, id: string): SecondTapHintState | null {
    return shouldShowSecondTapHint(kind) ? { kind, id } : null;
  }

  private completeSecondTapHint(kind: SecondTapHintKind): void {
    markSecondTapHintUsed(kind);
  }

  private openShotEditor(): void {
    const shot = this.selectedHistoryShot();
    if (!shot) return;
    this.setState({
      modal: 'edit-shot',
      editDialog: null,
      shotEdit: shotEditDraftFromShot(shot),
      shotEditField: null,
      shotBeanEdit: null,
      profileEdit: null
    });
  }

  private async submitShotDyeEditor(form: HTMLFormElement): Promise<void> {
    const shotId = form.dataset.id ?? this.selectedHistoryShot()?.id;
    const shot = shotId ? this.state.shots.find((item) => item.id === shotId) : null;
    if (!shot) return;

    const update = this.shotUpdateFromForm(form, shot);
    await this.persistShotUpdate(shot, update, {
      busyStatus: 'Saving shot',
      successStatus: 'Shot saved',
      demoStatus: 'Shot saved (demo)',
      failureStatus: 'Save shot failed'
    });
  }

  // Shared persistence path for shot metadata edits: set the busy status, bump
  // the cache generation before the write (so an in-flight shot page fetch from
  // before the edit cannot re-cache pre-edit data after the invalidation), save
  // through the controller, then apply the saved record or the failure status.
  private async persistShotUpdate(
    shot: ShotRecord,
    update: ShotUpdate,
    opts: { busyStatus: string; successStatus: string; demoStatus: string; failureStatus: string }
  ): Promise<void> {
    this.setState({ busy: true, status: opts.busyStatus });
    if (!this.state.demo) this.shotCacheGeneration += 1;
    const result = await saveShotUpdate({
      shot,
      update,
      demo: this.state.demo,
      successStatus: opts.successStatus,
      demoStatus: opts.demoStatus,
      failureStatus: opts.failureStatus
    }, {
      updateShot: (id, nextUpdate) => gateway.updateShot(id, nextUpdate),
      invalidateShotMutation: (id) => beanieCache.invalidateShotMutation(id),
      putShotRecord: (saved) => beanieCache.putShotRecord(saved)
    });

    if (result.type === 'saved') {
      this.replaceShotRecord(result.shot, result.status);
    } else {
      console.error(`[Beanie] ${opts.failureStatus}`, result.error);
      this.setState({ busy: false, status: result.status });
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
      shotBeanEdit: null,
      busy: false,
      status
    });
  }

  // Open the confirm dialog; the actual delete (and optional reclaim) runs from
  // its buttons via performDeleteShot. The reclaim plan is computed now, while
  // the shot still names the bag and dose, so the dialog can show before→after.
  private deleteShot(shotId: string): void {
    const shot = this.state.shots.find((item) => item.id === shotId);
    if (!shot) return;
    this.setState({
      modal: 'delete-shot',
      deleteShotTarget: { shotId, reclaim: this.reclaimableDoseForShot(shot) }
    });
  }

  private async performDeleteShot(reclaim: boolean): Promise<void> {
    const target = this.state.deleteShotTarget;
    if (!target) return;
    const shotId = target.shotId;
    const reclaimPlan = reclaim ? target.reclaim : null;

    const applyDeletedShot = (status: string) => {
      const shots = this.state.shots.filter((item) => item.id !== shotId);
      const visibleShots = shots.filter((item) => !isServiceShot(item));
      this.setState({
        shots,
        shotsTotal: Math.max(0, this.state.shotsTotal - 1),
        detailShotId: visibleShots[0]?.id ?? null,
        compareShotId: this.state.compareShotId === shotId ? null : this.state.compareShotId,
        modal: null,
        deleteShotTarget: null,
        editDialog: null,
        shotEdit: null,
        shotEditField: null,
        shotBeanEdit: null,
        busy: false,
        status
      });
    };

    this.setState({ busy: true, status: 'Deleting shot', modal: null, deleteShotTarget: null });
    if (this.state.demo) {
      if (reclaimPlan) await this.applyDoseReclaim(reclaimPlan);
      applyDeletedShot(
        reclaimPlan ? `Shot deleted (demo) · Bag: ${formatGrams(reclaimPlan.next)} left` : 'Shot deleted (demo)'
      );
      return;
    }

    try {
      await gateway.deleteShot(shotId);
      this.shotCacheGeneration += 1;
      await beanieCache.invalidateShotMutation(shotId);
      if (reclaimPlan) await this.applyDoseReclaim(reclaimPlan);
      applyDeletedShot(reclaimPlan ? `Shot deleted · Bag: ${formatGrams(reclaimPlan.next)} left` : 'Shot deleted');
    } catch (error) {
      console.error('[Beanie] Delete shot failed', error);
      this.setState({ busy: false, status: 'Delete shot failed' });
    }
  }

  private shotUpdateFromDraft(shot: ShotRecord, draft: ShotEditDraft): ShotUpdate {
    const grinderId = draft.grinderId;
    const selectedGrinder = grinderId ? this.state.grinders.find((grinder) => grinder.id === grinderId) : null;
    const beanBatchId = draft.beanBatchId;
    const selectedBatch = this.batchAndBeanForId(beanBatchId);
    const beanId = draft.beanId ?? selectedBatch?.bean.id ?? null;

    const context: WorkflowContext = {
      ...(shot.workflow?.context ?? {}),
      targetDoseWeight: draft.targetDoseWeight,
      targetYield: draft.targetYield,
      grinderId,
      grinderModel: draft.grinderModel ?? selectedGrinder?.model ?? null,
      grinderSetting: draft.grinderSetting,
      beanId,
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
      metadata: shotMetadataWithFreshness(shot.metadata, annotations.extras, selectedBatch?.batch ?? null, shot.timestamp)
    };
  }

  private shotUpdateFromForm(form: HTMLFormElement, shot: ShotRecord): ShotUpdate {
    const draft = shotEditDraftWithFormNumbers(
      this.state.shotEdit?.shotId === shot.id ? this.state.shotEdit : shotEditDraftFromShot(shot),
      form
    );
    return this.shotUpdateFromDraft(shot, draft);
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
    const next = updateShotEditDraftField(draft, field, value, this.state.grinders);
    this.setState({ shotEdit: next, shotEditField: null, status: 'Shot draft changed' });
  }

  private applyPhoneShotField(shotId: string, field: ShotEditField, value: string): void {
    const shot = this.state.shots.find((item) => item.id === shotId);
    if (!shot) return;
    const draft = this.state.shotEdit?.shotId === shotId ? this.state.shotEdit : shotEditDraftFromShot(shot);
    const next = updateShotEditDraftField(draft, field, value, this.state.grinders);
    this.setState({ shotEdit: next, status: 'Shot draft changed' });
  }

  private applyPhoneShotScore(shotId: string, value: number | null): void {
    const shot = this.state.shots.find((item) => item.id === shotId);
    if (!shot) return;
    const draft = this.state.shotEdit?.shotId === shotId ? this.state.shotEdit : shotEditDraftFromShot(shot);
    this.setState({ shotEdit: { ...draft, enjoyment: value }, status: 'Shot draft changed' });
  }

  private async savePhoneShotDraft(shotId: string): Promise<void> {
    const shot = this.state.shots.find((item) => item.id === shotId);
    const draft = this.state.shotEdit?.shotId === shotId ? this.state.shotEdit : null;
    if (!shot || !draft) return;
    const update = this.shotUpdateFromDraft(shot, draft);
    await this.persistShotUpdate(shot, update, {
      busyStatus: 'Saving shot',
      successStatus: 'Shot saved',
      demoStatus: 'Shot saved (demo)',
      failureStatus: 'Save shot failed'
    });
  }

  private setShotEditEnjoyment(value: number | null): void {
    const draft = this.state.shotEdit;
    if (!draft) return;
    this.setState({
      shotEdit: { ...draft, enjoyment: value },
      status: 'Shot draft changed'
    });
  }

  // Find the library bag a shot draft currently points at. Roaster + name are
  // historical display snapshots; identity comes from beanId or beanBatchId.
  private shotDraftBean(draft: ShotEditDraft): Bean | null {
    if (draft.beanId) {
      const byBeanId = this.state.beans.find((bean) => bean.id === draft.beanId);
      if (byBeanId) return byBeanId;
    }
    const fromBatch = this.batchAndBeanForId(draft.beanBatchId)?.bean;
    return fromBatch ?? null;
  }

  private openShotBeanDialog(): void {
    if (!this.state.shotEdit) return;
    this.setState({ shotBeanEdit: { creating: false }, shotEditField: null });
  }

  // Pick a bag and close the dialog: adopt its roaster + name and tag the shot
  // with its latest batch. An empty id clears the bean entirely.
  private async pickShotBean(beanId: string): Promise<void> {
    const draft = this.state.shotEdit;
    if (!draft) return;
    if (!beanId) {
      this.setState({
        shotEdit: { ...draft, coffeeRoaster: null, coffeeName: null, beanId: null, beanBatchId: null },
        shotBeanEdit: null,
        status: 'Shot draft changed'
      });
      return;
    }
    const bean = this.state.beans.find((item) => item.id === beanId);
    if (!bean) return;
    await this.ensureBatchesLoaded(beanId);
    const current = this.state.shotEdit;
    if (!current) return;
    const latest = latestBatch(this.state.batchesByBean[beanId] ?? []);
    this.setState({
      shotEdit: { ...current, coffeeRoaster: bean.roaster, coffeeName: bean.name, beanId: bean.id, beanBatchId: latest?.id ?? null },
      shotBeanEdit: null,
      status: 'Shot draft changed'
    });
  }

  // Create a bag inline from the shot editor and tag the shot with it. A brand
  // new bag has no batches yet, so the batch is left empty.
  private async createShotBean(form: HTMLFormElement): Promise<void> {
    const draft = this.state.shotEdit;
    if (!draft) return;
    const fields = beanFieldsFromForm(new FormData(form));
    if (!fields.roaster || !fields.name) return;

    this.setState({ busy: true, status: 'Adding bean' });
    const result = await this.beanWorkflow.saveBean({
      beans: this.state.beans,
      batchesByBean: this.state.batchesByBean,
      editingId: null,
      fields,
      demo: this.state.demo,
      nowMs: Date.now()
    }, {
      createBean: (input) => gateway.createBean(input),
      updateBean: (id, input) => gateway.updateBean(id, input),
      putBeans: (beans) => beanieCache.putBeans(beans),
      putBeanBatches: (beanId, batches) => beanieCache.putBeanBatches(beanId, batches)
    });

    if (result.type === 'failed') {
      console.error('[Beanie] Add bean failed', result.error);
      this.setState({ busy: false, status: result.status });
      return;
    }

    // A brand new bag has no batches yet, so the shot's batch is left empty.
    const current = this.state.shotEdit;
    this.setState({
      beans: result.beans,
      batchesByBean: result.batchesByBean,
      shotEdit: current
        ? { ...current, coffeeRoaster: result.bean.roaster, coffeeName: result.bean.name, beanId: result.bean.id, beanBatchId: null }
        : current,
      shotBeanEdit: null,
      busy: false,
      status: result.status
    });
  }

  // Fill a new-bean form's inputs from an existing bag, directly (no re-render)
  // so the user's later edits to the prefilled values aren't clobbered. Only
  // fields the given form actually contains are touched.
  private prefillBeanForm(form: HTMLFormElement | null, beanId: string): void {
    const bean = beanId ? this.state.beans.find((item) => item.id === beanId) : null;
    if (!form || !bean) return;
    const set = (name: string, value: string) => {
      const el = form.elements.namedItem(name);
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.value = value;
    };
    set('prefillBeanId', bean.id);
    set('roaster', bean.roaster);
    set('name', bean.name);
    set('country', inputValue(bean.country));
    set('region', inputValue(bean.region));
    set('processing', inputValue(bean.processing));
    set('notes', inputValue(bean.notes));
  }

  private async updateShotEnjoyment(shotId: string, value: number | null): Promise<void> {
    const shot = this.state.shots.find((item) => item.id === shotId);
    if (!shot) return;
    const update = shotEnjoymentUpdate(shot, value);
    await this.persistShotUpdate(shot, update, {
      busyStatus: 'Saving score',
      successStatus: 'Score saved',
      demoStatus: 'Score saved (demo)',
      failureStatus: 'Save score failed'
    });
  }

  private batchAndBeanForId(batchId: string | null): { batch: BeanBatch; bean: Bean } | null {
    if (!batchId) return null;
    for (const bean of this.state.beans) {
      const batch = (this.state.batchesByBean[bean.id] ?? []).find((item) => item.id === batchId);
      if (batch) return { batch, bean };
    }
    return null;
  }

  // Resolves true when the machine command actually went through (or demo
  // simulated it), false when a preflight block or gateway failure stopped it.
  private async machineAction(
    state: MachineState,
    opts: { skipScaleCheck?: boolean } = {}
  ): Promise<boolean> {
    const preflight = machineActionPreflight({
      state,
      skipScaleCheck: opts.skipScaleCheck === true,
      noScaleBlocked: this.shouldPreflightBlockShotForScale(),
      waterAlertHard: this.currentWaterAlert() === 'hard'
    });
    if (preflight.type === 'blocked-no-scale') {
      this.showNoScaleShotWarning({ busy: false });
      return false;
    }
    if (preflight.type === 'blocked-water') {
      // Re-arm the (dismissable) refill popup instead of starting a shot.
      this.setState({ waterAlertDismissed: false, status: 'Refill the water tank' });
      return false;
    }
    const service = preflight.service;
    this.setState({ busy: true, status: preflight.status });
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
        appAwake: false,
        status: machineActionStatus(state, 'demo')
      });
      if (state === 'espresso') this.startSimulatedShot();
      return true;
    }
    const command = await sendMachineActionCommand({
      state,
      workflow: this.state.workflow,
      steamSettings: this.currentSteamSettings(),
      hotWaterData: this.currentHotWaterData(),
      rinseData: this.currentRinseData(),
      twoTapSteamStop: this.usesTwoTapSteamStop()
    }, {
      updateWorkflow: (workflow) => gateway.updateWorkflow(workflow),
      requestState: (nextState) => gateway.requestState(nextState),
      isNoScaleShotBlockError
    });
    if (command.restore) this.captureMachineServiceWorkflowRestore(command.restore);
    if (command.type === 'failed') {
      console.error('[Beanie] Machine action failed', command.error);
      if (state === 'steam' && !command.restore) this.machineServiceWorkflowToRestore = null;
      if (command.noScaleBlocked) {
        this.showNoScaleShotWarning({ busy: false });
        return false;
      }
      this.setState({ busy: false, status: command.status });
      return false;
    }
    this.rememberMachineProgressReturnView(service);
    this.trackMachineServiceState(state);
    this.setState({
      busy: false,
      machine: optimisticMachineSnapshot(this.state.machine, state),
      view: service ? 'machine' : this.state.view,
      asleep: state === 'sleeping',
      appAwake: false,
      status: command.status
    });
    if (state === 'sleeping') this.scheduleSleepBrightnessZero(1000);
    else this.observeSleepBrightnessState(false);
    return true;
  }

  // Backflush / cleaning cycle: load the cleaning profile (bean-independent),
  // then run it as an espresso pull. The user's dial-in `draft` is left intact,
  // so finishCleaningCycle() can restore the real recipe afterwards.
  //
  // On a GHC machine the DE1 firmware only starts flows from the physical
  // controller (Decent's de1app: "once the GHC is enabled, only the GHC can
  // start operations"), so `startShot` is false: we just load the cleaning
  // profile and leave it on the machine. Crucially we must NOT then restore the
  // recipe — the cleaning profile has to stay loaded so that when the user
  // presses the GHC, reaprime sees a cleaning profile and skips the no-scale
  // block. finishCleaningCycle() restores the recipe once the pull completes.
  private async runCleaningCycle(opts: { startShot?: boolean } = {}): Promise<void> {
    const startShot = opts.startShot !== false;
    const plan = cleaningStartPlan({
      busy: this.state.busy,
      liveActive: this.state.liveActive,
      liveFinalizing: this.state.liveFinalizing,
      profiles: this.state.profiles,
      cleaningProfileOverride: this.state.cleaningProfileOverride,
      workflow: this.state.workflow,
      demo: this.state.demo,
      // Only block on sleep when WE start the shot; on a GHC the user does.
      machineSleeping: startShot && this.machineIsSleeping(),
      waterAlert: this.currentWaterAlert()
    });
    if (plan.type === 'ignored') return;
    if (plan.type === 'missing-profile' || plan.type === 'sleeping') {
      this.setState({ status: plan.status });
      return;
    }
    if (plan.type === 'water-block') {
      this.setState({ waterAlertDismissed: plan.waterAlertDismissed, status: plan.status });
      return;
    }
    this.cleaningInProgress = true;
    this.setState({ busy: true, status: plan.status });
    const result = await loadCleaningWorkflow(plan.workflow, this.state.demo, {
      updateWorkflow: (workflow) => gateway.updateWorkflow(workflow)
    });
    if (result.type === 'failed') {
      this.cleaningInProgress = false;
      console.error('[Beanie] Cleaning profile load failed', result.error);
      this.setState({ busy: false, status: result.status });
      return;
    }
    this.state.workflow = result.workflow;
    if (!startShot) {
      // GHC: cleaning profile is loaded and we stay armed. Do NOT restore the
      // recipe — the user starts the flush on the GHC with the profile in place.
      this.setState({ busy: false, status: 'Press the GHC to run the cleaning flush' });
      return;
    }
    // Run as an espresso pull; a backflush has no yield, so skip the scale gate.
    const started = await this.machineAction('espresso', { skipScaleCheck: true });
    if (!started) {
      // The pull never started: leave cleaning mode so the next real shot is
      // not treated as a cleaning cycle, and re-apply the user's draft to put
      // the recipe workflow back on the machine (as finishCleaningCycle does).
      this.cleaningInProgress = false;
      void this.applyDraft();
    }
  }

  private machineHasGhc(): boolean {
    return !this.state.demo && hasGroupHeadController(this.state.machineInfo ?? { GHC: false }) === true;
  }

  // A cleaning pull just ended: reset the counter, restore the real recipe.
  private finishCleaningCycle(): void {
    this.cleaningInProgress = false;
    this.liveShot.reset();
    const plan = finishCleaningCyclePlan(new Date().toISOString());
    writeCleaningState(plan.cleaning);
    // If the wizard started this pull, re-open it (it was hidden during the pull)
    // advanced to the next step.
    const wizard = this.state.cleaningWizard;
    const advance = wizard ? cleaningWizardOnPullComplete(wizard) : null;
    this.setState({
      cleaning: plan.cleaning,
      liveActive: false,
      liveFinalizing: false,
      status: plan.status,
      ...(advance?.type === 'advance'
        ? { modal: 'cleaning-wizard', cleaningWizard: advance.next }
        : wizard?.actionPending === 'pull'
          ? { modal: 'cleaning-wizard', cleaningWizard: { ...wizard, actionPending: null } }
          : {})
    });
    // The draft was never touched by cleaning, so re-applying it restores the
    // user's profile/dose/yield on the machine (no-op if no bean is selected).
    void this.applyDraft();
  }

  // Open the guided backflush cleaning wizard.
  private openCleaningWizard(): void {
    this.setState({ modal: 'cleaning-wizard', cleaningWizard: startCleaningWizard() });
  }

  // Wizard action: run the cleaning (forward-flush) profile as an espresso pull.
  // The dialog STAYS OPEN showing a "running" state — it does not depend on the
  // live-shot screen, because on flaky BLE the cleaning pull's telemetry can be
  // missed and the wizard would otherwise vanish into a dead state. If tracking
  // works, finishCleaningCycle() auto-advances; otherwise the user taps Skip.
  private async runCleaningWizardPull(): Promise<void> {
    const wizard = this.state.cleaningWizard;
    if (!wizard || wizard.actionPending) return;
    if (this.state.busy || this.cleaningInProgress || this.state.liveActive || this.state.liveFinalizing) return;
    this.setState({ modal: 'cleaning-wizard', cleaningWizard: { ...wizard, actionPending: 'pull', note: null } });
    // On a GHC machine the firmware ignores API state requests, so there's no
    // point starting the espresso here — we only load the profile and the user
    // presses the GHC. (startShot:false also skips the recipe-restore, so the
    // cleaning profile stays loaded for the no-scale carve-out at GHC-press.)
    await this.runCleaningCycle({ startShot: !this.machineHasGhc() });
    if (!this.cleaningInProgress && this.state.cleaningWizard) {
      // The pull never started (no profile / asleep / low water): clear the
      // running state and surface the reason inline.
      this.setState({
        cleaningWizard: { ...this.state.cleaningWizard, actionPending: null, note: this.state.status }
      });
    }
  }

  // Wizard action: run a group-head flush to rinse detergent out. Like the pull,
  // the dialog stays open in a "running" state; the flush-end transition in
  // trackMachineServiceState() auto-advances when tracked, else the user taps Skip.
  private async runCleaningWizardFlush(): Promise<void> {
    const wizard = this.state.cleaningWizard;
    if (!wizard || wizard.actionPending) return;
    if (this.state.busy || this.cleaningInProgress || this.state.liveActive || this.state.liveFinalizing) return;
    this.setState({ modal: 'cleaning-wizard', cleaningWizard: { ...wizard, actionPending: 'flush', note: null } });
    const started = await this.machineAction('flush');
    if (!started && this.state.cleaningWizard) {
      this.setState({
        cleaningWizard: { ...this.state.cleaningWizard, actionPending: null, note: this.state.status }
      });
    }
  }

  // A flush the wizard started just ended: re-open the dialog at the next step.
  private advanceCleaningWizardAfterFlush(): void {
    const wizard = this.state.cleaningWizard;
    if (!wizard || wizard.actionPending !== 'flush') return;
    const advance = cleaningWizardOnFlushComplete(wizard);
    this.setState({
      modal: 'cleaning-wizard',
      cleaningWizard: advance.type === 'advance' ? advance.next : { ...wizard, actionPending: null }
    });
  }

  // The user advances the wizard by hand while an action is marked running. If
  // the live shot was never picked up (flaky telemetry), the pull would stay
  // "in progress" forever and block the next step (and could mis-save a stray
  // frame as a shot), so tear that tracking down. When the shot IS being tracked
  // (liveActive), leave it — finishCleaningCycle handles the real end.
  private teardownUntrackedCleaningAction(): void {
    const wizard = this.state.cleaningWizard;
    if (wizard?.actionPending && this.cleaningInProgress && !this.state.liveActive) {
      this.cleaningInProgress = false;
      this.liveShot.reset();
      // The cleaning profile is on the machine; restore the user's recipe (the
      // draft was never touched), the same way finishCleaningCycle would.
      void this.applyDraft();
    }
  }

  // On a GHC machine the user starts the pull on the controller, so when the
  // wizard reaches a pull step we load the cleaning profile automatically —
  // no extra "Load profile" tap. (Non-GHC machines keep the explicit Run
  // button; auto-starting an API pull there would be surprising.)
  private maybeAutoLoadCleaningProfile(): void {
    const wizard = this.state.cleaningWizard;
    if (!wizard || wizard.actionPending || !this.machineHasGhc()) return;
    if (wizard.step === 'pull-1' || wizard.step === 'pull-2') {
      void this.runCleaningWizardPull();
    }
  }

  // Count a completed espresso pull toward the next cleaning reminder.
  private countShotForCleaning(): void {
    const cleaning = countShotForCleaningPlan(this.state.cleaning);
    writeCleaningState(cleaning);
    this.state.cleaning = cleaning;
  }

  // Chosen from the profile picker (cleaning mode): store the override and return
  // to the machine page. Selecting the auto-detected profile clears the override.
  private pickCleaningProfile(profileId: string): void {
    const plan = pickCleaningProfilePlan(profileId, this.state.profiles);
    writeCleaningProfileOverride(plan.override);
    this.setState({
      cleaningProfileOverride: plan.override,
      cleaningProfilePicking: plan.cleaningProfilePicking,
      view: plan.view,
      status: plan.status
    });
  }

  private setCleaningThreshold(shots: number): void {
    const plan = cleaningThresholdPlan(shots);
    writeCleaningThreshold(plan.threshold);
    this.setState({ cleaningThreshold: plan.threshold, status: plan.status });
  }

  private captureMachineServiceWorkflowRestore(restore?: MachineServiceWorkflowRestore): void {
    if (this.machineServiceWorkflowToRestore != null) return;
    this.machineServiceWorkflowToRestore = restore ?? captureMachineServiceWorkflowRestore({
      steamSettings: this.currentSteamSettings(),
      hotWaterData: this.currentHotWaterData(),
      rinseData: this.currentRinseData()
    });
  }

  private shouldPreflightBlockShotForScale(): boolean {
    return this.state.settingsBundle?.rea.blockOnNoScale === true && !this.hasFreshConnectedScale(Date.now());
  }

  private isNoScaleBlockedLiveAbort(shotWindow: LiveShotState): boolean {
    const blockSetting = this.state.settingsBundle?.rea.blockOnNoScale;
    if (blockSetting === false) return false;
    if (this.hasFreshConnectedScale(Date.now())) return false;
    const durationMs = liveShotDurationMs(shotWindow);
    return durationMs != null && durationMs <= NO_SCALE_ABORT_WINDOW_MS;
  }

  private hasFreshConnectedScale(tMs: number): boolean {
    if (!scaleConnected(this.state.scale)) return false;
    return this.lastScaleFrameMs != null && tMs - this.lastScaleFrameMs <= SCALE_FRESH_WINDOW_MS;
  }

  private beginNoScaleBrewFlashIfNeeded(machine: MachineSnapshot, previousState: string | undefined, tMs: number): void {
    const state = machine.state?.state;
    if (!isBrewState(state) || isBrewState(previousState)) return;
    if (this.state.settingsBundle?.rea.blockOnNoScale === false) return;
    if (this.hasFreshConnectedScale(tMs)) return;
    this.noScaleBrewFlashStartedMs = tMs;
  }

  private consumeNoScaleBrewFlashIfNeeded(machine: MachineSnapshot, previousState: string | undefined, tMs: number): boolean {
    const state = machine.state?.state;
    if (isBrewState(state) || !isBrewState(previousState)) return false;
    const startedMs = this.noScaleBrewFlashStartedMs;
    this.noScaleBrewFlashStartedMs = null;
    if (startedMs == null) return false;
    if (this.state.settingsBundle?.rea.blockOnNoScale === false) return false;
    if (this.hasFreshConnectedScale(tMs)) return false;
    if (tMs - startedMs > NO_SCALE_ABORT_WINDOW_MS) return false;
    this.liveShot.reset();
    this.showNoScaleShotWarning({
      liveActive: false,
      liveFinalizing: false
    });
    return true;
  }

  private showNoScaleShotWarning(next: Partial<AppState> = {}): void {
    this.noScaleShotWarningUntilMs = Date.now() + NO_SCALE_WARNING_VISIBLE_MS;
    this.setState({ ...next, modal: 'no-scale-shot', status: NO_SCALE_SHOT_MESSAGE });
  }

  private machineStatusLabel(): string {
    if (this.state.gatewayLinkDown && !this.state.demo) return 'Offline';
    if (Date.now() < this.noScaleShotWarningUntilMs) return NO_SCALE_MACHINE_STATUS;
    return machineStatus(this.state.machine, this.state.loading);
  }

  private async toggleMachineCommand(state: MachineState): Promise<void> {
    const active = this.state.machine?.state?.state === state;
    await this.machineAction(active ? 'idle' : state);
  }

  private observeSleepBrightnessState(sleeping: boolean): void {
    if (sleeping) {
      // The user kept the app awake while the machine sleeps — leave the screen lit.
      if (this.state.appAwake) return;
      this.scheduleSleepBrightnessZero(0);
      return;
    }
    const hadSleepDim = this.sleepBrightnessZeroed || this.sleepBrightnessTimer != null;
    this.clearSleepBrightnessTimer();
    this.sleepBrightnessZeroed = false;
    if (hadSleepDim) void this.refreshDisplayStateSilently();
  }

  private scheduleSleepBrightnessZero(delayMs: number): void {
    if (this.state.demo || this.sleepBrightnessZeroed || this.state.appAwake) return;
    if (this.sleepBrightnessTimer != null) {
      if (delayMs > 0) return;
      this.clearSleepBrightnessTimer();
    }
    this.sleepBrightnessTimer = window.setTimeout(() => {
      this.sleepBrightnessTimer = null;
      void this.zeroDisplayForSleep();
    }, delayMs);
  }

  private clearSleepBrightnessTimer(): void {
    if (this.sleepBrightnessTimer == null) return;
    window.clearTimeout(this.sleepBrightnessTimer);
    this.sleepBrightnessTimer = null;
  }

  private async zeroDisplayForSleep(): Promise<void> {
    if (this.state.demo || this.sleepBrightnessZeroed || this.state.appAwake) return;
    // The dim is deferred ~1s; if the machine woke in that window, don't black
    // out the screen (and don't fight reaprime's wake-restore).
    if (!this.machineIsSleeping()) return;
    this.sleepBrightnessZeroed = true;
    // Publish the PUT so a concurrent wake-app tap restores brightness only
    // after this dim lands — otherwise the two writes race and 0 can win last.
    const dim = (async () => {
      try {
        const display = await gateway.setDisplayBrightness(0);
        this.patchBundle({ display });
      } catch (error) {
        console.warn('[Beanie] Sleep brightness dim failed', error);
      }
    })();
    this.sleepDimPromise = dim;
    await dim;
    if (this.sleepDimPromise === dim) this.sleepDimPromise = null;
  }

  private async refreshDisplayStateSilently(): Promise<void> {
    if (this.state.demo) return;
    try {
      this.patchBundle({ display: await gateway.displayState() });
    } catch {
      // Display state is best-effort; machine controls should stay quiet.
    }
  }

  // Show Beanie while the machine stays asleep — the same view you'd get by
  // opening the skin in a browser. Deliberately sends NO machine command, so the
  // DE1 keeps sleeping; we only undo the screen dim ourselves (reaprime restores
  // brightness only on a real wake). `appAwake` then suppresses re-dimming and
  // hides the screensaver until the machine actually wakes.
  private async wakeAppWithoutMachine(): Promise<void> {
    const wasDimmed = this.sleepBrightnessZeroed;
    this.clearSleepBrightnessTimer();
    this.sleepBrightnessZeroed = false;
    this.setState({ appAwake: true, status: 'App awake — machine still asleep' });
    this.armWakeAppIdleTimer();
    if (this.state.demo || !wasDimmed) return;
    try {
      // Wait out any dim PUT still in flight so our restore is the last write.
      if (this.sleepDimPromise) await this.sleepDimPromise;
      const display = await gateway.setDisplayBrightness(this.wakeAppRestoreBrightness);
      this.patchBundle({ display });
    } catch (error) {
      console.warn('[Beanie] Wake-app brightness restore failed', error);
    }
  }

  // While the app is shown over a sleeping machine, turn the screen back off
  // after WAKE_APP_IDLE_SCREEN_OFF_MS of no interaction. Re-armed on every
  // user action via noteUserActivity().
  private armWakeAppIdleTimer(): void {
    if (this.state.demo) return;
    this.clearWakeAppIdleTimer();
    this.wakeAppIdleTimer = window.setTimeout(() => {
      this.wakeAppIdleTimer = null;
      this.wakeAppIdleScreenOff();
    }, WAKE_APP_IDLE_SCREEN_OFF_MS);
  }

  private clearWakeAppIdleTimer(): void {
    if (this.wakeAppIdleTimer == null) return;
    window.clearTimeout(this.wakeAppIdleTimer);
    this.wakeAppIdleTimer = null;
  }

  // Idle timeout while awake over a sleeping machine: drop back to the sleep
  // screen and turn the display off again.
  private wakeAppIdleScreenOff(): void {
    if (this.state.demo || !this.state.appAwake || !this.machineIsSleeping()) return;
    this.setState({ appAwake: false });
    this.scheduleSleepBrightnessZero(0);
  }

  // Flash a translucent preview of the wake-app zone over the current view for
  // ~2s so the user can see where the tap area lands when they enable it or
  // change its placement in Settings.
  private previewWakeAppZone(position: WakeAppZonePosition): void {
    if (this.wakeZonePreviewTimer != null) window.clearTimeout(this.wakeZonePreviewTimer);
    this.setState({ wakeZonePreview: position });
    this.wakeZonePreviewTimer = window.setTimeout(() => {
      this.wakeZonePreviewTimer = null;
      if (!this.disposed) this.setState({ wakeZonePreview: null });
    }, 2000);
  }

  private async stopMachineService(): Promise<void> {
    const service = machineServiceState(this.state.machine?.state?.state) ?? this.machineService.service;
    if (!service) {
      await this.machineAction('idle');
      return;
    }

    this.machineService.markStopRequested(service, Date.now());
    if (service === 'steam') this.clearTimedSteamStopTimer();
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

  private closeLiveSockets(): void {
    const machineSocket = this.machineSocket;
    const scaleSocket = this.scaleSocket;
    const waterSocket = this.waterSocket;
    const displaySocket = this.displaySocket;
    this.machineSocket = null;
    this.scaleSocket = null;
    this.waterSocket = null;
    this.displaySocket = null;
    this.closeSocket(machineSocket);
    this.closeSocket(scaleSocket);
    this.closeSocket(waterSocket);
    this.closeSocket(displaySocket);
    this.machineSocketAttempts = 0;
    this.scaleSocketAttempts = 0;
    this.waterSocketAttempts = 0;
    this.displaySocketAttempts = 0;
  }

  private closeSocket(socket: WebSocket | null): void {
    if (!socket) return;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    socket.close();
  }

  private connectMachineSocket(): void {
    if (this.disposed || this.state.demo) return;
    const previous = this.machineSocket;
    this.machineSocket = null;
    this.closeSocket(previous);
    const ws = new WebSocket(`${gatewayWsOrigin()}/ws/v1/machine/snapshot`);
    this.machineSocket = ws;
    ws.onopen = () => {
      if (this.disposed || this.machineSocket !== ws) return;
      this.machineSocketAttempts = 0;
      if (this.state.gatewayLinkDown) this.handleGatewayReconnected();
    };
    ws.onmessage = (event) => {
      try {
        const snapshot = readMachineSnapshot(JSON.parse(event.data));
        this.ingestLiveFrame(snapshot, null, Date.now());
      } catch (error) {
        console.warn('[Beanie] Bad machine frame', error);
      }
    };
    ws.onclose = () => {
      if (this.disposed) return;
      if (this.machineSocket !== ws) return;
      // The snapshot stream is the skin's lifeline to the gateway: while it is
      // down every machine readout is stale, so say so instead of keeping the
      // last state on screen as if it were live.
      if (!this.state.gatewayLinkDown) this.setState({ gatewayLinkDown: true });
      if (this.machineRetryTimer != null) window.clearTimeout(this.machineRetryTimer);
      this.machineRetryTimer = window.setTimeout(() => {
        this.machineRetryTimer = null;
        this.connectMachineSocket();
      }, reconnectDelayMs(this.machineSocketAttempts++));
    };
  }

  // Re-sync after an outage: anything could have changed while the link was
  // down (shots pulled from another UI, beans edited, machine state moved).
  private handleGatewayReconnected(): void {
    this.setState({ gatewayLinkDown: false, status: 'Gateway reconnected' });
    void this.refreshBeans({ force: true });
    void this.refreshVisibleShots();
  }

  private connectScaleSocket(): void {
    if (this.disposed || this.state.demo) return;
    const previous = this.scaleSocket;
    this.scaleSocket = null;
    this.closeSocket(previous);
    const ws = new WebSocket(`${gatewayWsOrigin()}/ws/v1/scale/snapshot`);
    this.scaleSocket = ws;
    ws.onopen = () => {
      if (this.scaleSocket === ws) this.scaleSocketAttempts = 0;
    };
    ws.onmessage = (event) => {
      try {
        const snapshot = readScaleSnapshot(JSON.parse(event.data));
        this.ingestLiveFrame(null, snapshot, Date.now());
      } catch (error) {
        console.warn('[Beanie] Bad scale frame', error);
      }
    };
    ws.onclose = () => {
      if (this.disposed) return;
      if (this.scaleSocket !== ws) return;
      if (this.scaleRetryTimer != null) window.clearTimeout(this.scaleRetryTimer);
      this.scaleRetryTimer = window.setTimeout(() => {
        this.scaleRetryTimer = null;
        this.connectScaleSocket();
      }, reconnectDelayMs(this.scaleSocketAttempts++));
    };
  }

  // The DE1 tank level arrives on its own socket (separate from the snapshot).
  // It changes slowly, so patch the top-bar readout by reference rather than
  // re-rendering the whole app on every frame.
  private connectWaterLevelSocket(): void {
    if (this.disposed || this.state.demo) return;
    const previous = this.waterSocket;
    this.waterSocket = null;
    this.closeSocket(previous);
    const ws = new WebSocket(`${gatewayWsOrigin()}/ws/v1/machine/waterLevels`);
    this.waterSocket = ws;
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as { currentLevel?: unknown; refillLevel?: unknown };
        const hasLevel = typeof data.currentLevel === 'number' && Number.isFinite(data.currentLevel);
        const refill = typeof data.refillLevel === 'number' && Number.isFinite(data.refillLevel) ? data.refillLevel : null;
        // The machine's own refill threshold rarely changes; re-render when it
        // does so the Settings control reflects the live value.
        if (refill !== this.state.machineRefillLevel) {
          this.state.machineRefillLevel = refill;
          if (this.state.view === 'settings') this.setState({});
        }
        if (!hasLevel) return;
        const level = Number(data.currentLevel);
        if (level === this.state.waterLevel) return;
        this.state.waterLevel = level;
        // A soft-band crossing restyles the topbar + toggles the warning banner,
        // so re-render; otherwise just patch the readout text cheaply.
        if (this.syncWaterAlert()) {
          this.setState({});
          return;
        }
        const el = this.root.querySelector<HTMLElement>('#stat-water');
        if (el) el.textContent = water(level);
      } catch (error) {
        console.warn('[Beanie] Bad water level frame', error);
      }
    };
    ws.onopen = () => {
      if (this.waterSocket === ws) this.waterSocketAttempts = 0;
    };
    ws.onclose = () => {
      if (this.disposed) return;
      if (this.waterSocket !== ws) return;
      if (this.waterRetryTimer != null) window.clearTimeout(this.waterRetryTimer);
      this.waterRetryTimer = window.setTimeout(() => {
        this.waterRetryTimer = null;
        this.connectWaterLevelSocket();
      }, reconnectDelayMs(this.waterSocketAttempts++));
    };
  }

  // Track the gateway's display state live instead of relying on a one-shot GET
  // on wake. That GET races the gateway's own brightness restore (which lands a
  // beat after the wake transition) and can cache a transient 0%, leaving the
  // Settings readout stuck at 0 while the screen is actually lit. The gateway
  // pushes every DisplayState change on this socket, so the bundle always
  // reflects the real value — and a restore that arrives late still updates it.
  private connectDisplaySocket(): void {
    if (this.disposed || this.state.demo) return;
    const previous = this.displaySocket;
    this.displaySocket = null;
    this.closeSocket(previous);
    const ws = new WebSocket(`${gatewayWsOrigin()}/ws/v1/display`);
    this.displaySocket = ws;
    ws.onmessage = (event) => {
      try {
        const display = readDisplayState(JSON.parse(event.data));
        // Keep the wake-app restore target current off the live socket so it's
        // right even before the settings bundle loads. Ignore the sleep dim's own
        // 0 (and any low-battery cap, which leaves requestedBrightness intact).
        if (display.requestedBrightness > 0) this.wakeAppRestoreBrightness = display.requestedBrightness;
        const current = this.state.settingsBundle?.display;
        if (
          current &&
          current.brightness === display.brightness &&
          current.requestedBrightness === display.requestedBrightness &&
          current.lowBatteryBrightnessActive === display.lowBatteryBrightnessActive &&
          current.wakeLockEnabled === display.wakeLockEnabled &&
          current.wakeLockOverride === display.wakeLockOverride
        ) {
          return;
        }
        this.patchBundle({ display });
      } catch (error) {
        console.warn('[Beanie] Bad display frame', error);
      }
    };
    ws.onopen = () => {
      if (this.displaySocket === ws) this.displaySocketAttempts = 0;
    };
    ws.onclose = () => {
      if (this.disposed) return;
      if (this.displaySocket !== ws) return;
      if (this.displayRetryTimer != null) window.clearTimeout(this.displayRetryTimer);
      this.displayRetryTimer = window.setTimeout(() => {
        this.displayRetryTimer = null;
        this.connectDisplaySocket();
      }, reconnectDelayMs(this.displaySocketAttempts++));
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
    const frameState = liveTelemetryFrameState({
      currentMachine: this.state.machine,
      currentScale: this.state.scale,
      machineFrame: machine,
      scaleFrame: scale,
      view: this.state.view,
      asleep: this.state.asleep,
      tMs
    });
    if (machine) {
      this.state.machine = machine;
      this.trackMachineServiceState(machine.state.state, machine.state.substate, tMs);
      this.observeSleepBrightnessState(machine.state.state === 'sleeping');
      this.beginNoScaleBrewFlashIfNeeded(machine, frameState.previousMachineState, tMs);
    }
    if (scale) {
      this.state.scale = scale;
      this.lastScaleFrameMs = tMs;
      if (frameState.freshScaleConnected) {
        this.noScaleBrewFlashStartedMs = null;
        this.noScaleShotWarningUntilMs = 0;
      }
    }
    const wasActive = this.state.liveActive;
    // Sample only the snapshot that actually arrived on this tick. The machine
    // (~4 Hz) and scale (~10 Hz) sockets fire independently; feeding both cached
    // snapshots every time re-samples the source that did *not* update, appending
    // its held value at a fresh timestamp and drawing a flat-segment staircase.
    const frame: LiveFrame = { tMs, machine, scale };
    this.liveShot.ingest(frame);
    const active = this.liveShot.isActive;

    const panelDecision = liveShotPanelDecision(wasActive, active);
    if (panelDecision === 'started') {
      this.captureLiveGhost();
      // First active frame: render once to mount the live panel + canvas, then draw.
      // Clear any leftover finalizing from a just-prior shot so this one takes over.
      this.setState({ liveActive: true, liveFinalizing: false, status: 'Live shot' });
      return;
    }
    if (panelDecision === 'ended') {
      this.onShotEnded();
      return;
    }
    if (panelDecision === 'idle' && machine && this.consumeNoScaleBrewFlashIfNeeded(machine, frameState.previousMachineState, tMs)) return;
    if (panelDecision === 'active') {
      this.scheduleLiveDraw();
      return;
    }
    const decision = liveTelemetryIdleDecision(frameState.idleDecisionInput);
    if (this.applyLiveTelemetryIdleDecision(decision)) return;

    const waterAlertChanged = this.syncWaterAlert();
    const afterWaterAlertDecision = liveTelemetryIdleDecision({
      ...frameState.idleDecisionInput,
      waterAlertChanged
    });
    this.applyLiveTelemetryIdleDecision(afterWaterAlertDecision);
  }

  private applyLiveTelemetryIdleDecision(decision: LiveTelemetryIdleDecision): boolean {
    // A sleep/wake transition flips the screensaver — re-render for that. Any
    // other idle telemetry only patches the top-bar readouts by reference, so a
    // streaming snapshot never re-renders the whole app (which would reset
    // scroll position of the bean list / history / pages).
    if (decision.type === 'set-asleep') {
      // A fresh sleep returns to the screensaver; a real wake ends it. Either
      // transition clears the app-awake-while-asleep override.
      this.setState({ asleep: decision.asleep, appAwake: false });
      return true;
    }
    if (decision.type === 'enter-service') {
      this.rememberMachineProgressReturnView(decision.service);
      this.setState({ view: 'machine' });
      return true;
    }
    if (decision.type === 'refresh-service') {
      this.setState({});
      return true;
    }
    if (decision.type === 'leave-service') {
      this.setState({ view: this.consumeMachineProgressReturnView() });
      return true;
    }
    if (decision.type === 'check-water-alert') return false;
    if (decision.type === 'water-alert-changed') {
      this.setState({});
      return true;
    }
    if (decision.type === 'refresh-scale-connection') {
      this.setState({});
      return true;
    }
    this.updateTopbarStats();
    return true;
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

  private trackMachineServiceState(
    state: MachineState | undefined,
    substate?: string,
    nowMs = Date.now()
  ): void {
    const transition = this.machineService.track(state, substate, nowMs);

    if (transition.clearTimedSteamTimer) this.clearTimedSteamStopTimer();
    if (transition.restoreWorkflowAfterEnd) void this.restoreMachineServiceWorkflowAfterEnd();
    if (transition.updateTimedSteamStopTimer) this.updateTimedSteamStopTimer(nowMs);
    // A flush the cleaning wizard kicked off just returned to idle — step it on.
    if (transition.previousService === 'flush' && transition.currentService == null) {
      this.advanceCleaningWizardAfterFlush();
    }
  }

  private updateTimedSteamStopTimer(nowMs = Date.now()): void {
    const delayMs = this.machineService.timedSteamStopDelay({
      disabled: this.state.demo,
      twoTapStop: this.usesTwoTapSteamStop(),
      targetSeconds: this.currentMachineServiceTargetSeconds(),
      nowMs
    });
    if (delayMs == null) {
      this.clearTimedSteamStopTimer();
      return;
    }
    this.scheduleTimedSteamStop(delayMs, nowMs);
  }

  private scheduleTimedSteamStop(delayMs: number, nowMs = Date.now()): void {
    const scheduledForMs = nowMs + delayMs;
    if (
      this.timedSteamStopTimer != null &&
      this.timedSteamStopScheduledForMs != null &&
      Math.abs(this.timedSteamStopScheduledForMs - scheduledForMs) < 250
    ) {
      return;
    }
    this.clearTimedSteamStopTimer();
    this.timedSteamStopScheduledForMs = scheduledForMs;
    this.timedSteamStopTimer = window.setTimeout(() => {
      this.timedSteamStopTimer = null;
      this.timedSteamStopScheduledForMs = null;
      void this.requestTimedSteamIdleStop();
    }, delayMs);
  }

  private clearTimedSteamStopTimer(): void {
    if (this.timedSteamStopTimer != null) {
      window.clearTimeout(this.timedSteamStopTimer);
      this.timedSteamStopTimer = null;
    }
    this.timedSteamStopScheduledForMs = null;
  }

  private async requestTimedSteamIdleStop(): Promise<void> {
    const state = this.state.machine?.state?.state;
    if (state !== 'steam') return;
    this.machineService.markTimedSteamStopRequested(Date.now());
    try {
      await gateway.requestState('idle');
      this.setState({ status: 'Timed steam stop requested' });
      this.armMachineStopFeedbackTimer();
    } catch (error) {
      console.error('[Beanie] Timed steam stop failed', error);
      this.clearMachineStopRequest();
      this.setState({ status: 'Timed steam stop failed' });
    }
  }

  private currentMachineServiceTargetSeconds(): number | null {
    if (this.machineService.targetOverrideSeconds != null) return this.machineService.targetOverrideSeconds;
    const service = this.machineService.service;
    if (!service) return null;
    return machineServiceTargetSeconds(
      service,
      this.currentSteamSettings(),
      this.currentHotWaterData(),
      this.currentRinseData(),
      this.state.hotWaterStopMode,
      scaleConnected(this.state.scale)
    );
  }

  private async extendMachineServiceDuration(seconds: number): Promise<void> {
    const service = machineServiceState(this.state.machine?.state?.state) ?? this.machineService.service;
    if (!service || this.state.demo) return;
    const currentTarget = machineServiceTargetSeconds(
      service,
      this.currentSteamSettings(),
      this.currentHotWaterData(),
      this.currentRinseData(),
      this.state.hotWaterStopMode,
      scaleConnected(this.state.scale)
    );
    const nextTarget = this.machineService.extendTarget(seconds, Date.now(), currentTarget);
    this.captureMachineServiceWorkflowRestore();
    this.setState({ status: `Added ${seconds}s` });
    this.updateTimedSteamStopTimer();

    const workflow = this.state.workflow;
    if (workflow == null) return;
    const nextWorkflow = extendedMachineServiceWorkflow({
      workflow,
      service,
      steamSettings: this.currentSteamSettings(),
      hotWaterData: this.currentHotWaterData(),
      rinseData: this.currentRinseData(),
      nextTargetSeconds: nextTarget,
      twoTapSteamStop: this.usesTwoTapSteamStop()
    });

    try {
      await gateway.updateWorkflow(nextWorkflow);
    } catch (error) {
      console.error('[Beanie] Extend service duration failed', error);
      this.setState({ status: 'Add time failed' });
    }
  }

  private async restoreMachineServiceWorkflowAfterEnd(): Promise<void> {
    const restore = this.machineServiceWorkflowToRestore;
    this.machineServiceWorkflowToRestore = null;
    const result = await restoreMachineServiceWorkflowAfterEndController({
      restore,
      workflow: this.state.workflow,
      demo: this.state.demo
    }, {
      updateWorkflow: (workflow) => gateway.updateWorkflow(workflow)
    });
    if (result.type === 'failed') {
      console.error('[Beanie] Machine service settings restore failed', result.error);
      this.setState({ status: result.status });
    }
  }

  private usesTwoTapSteamStop(): boolean {
    return normalizeSteamPurgeMode(this.state.machineSettings?.steamPurgeMode) === 1;
  }

  private clearMachineStopRequest(): void {
    this.machineService.clearStopRequest();
    if (this.machineStopFeedbackTimer != null) {
      window.clearTimeout(this.machineStopFeedbackTimer);
      this.machineStopFeedbackTimer = null;
    }
  }

  private armMachineStopFeedbackTimer(): void {
    if (this.machineStopFeedbackTimer != null) window.clearTimeout(this.machineStopFeedbackTimer);
    this.machineStopFeedbackTimer = window.setTimeout(() => {
      this.machineStopFeedbackTimer = null;
      if (!this.machineService.stopRequestedFor) return;
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
    set('stat-machine', this.machineStatusLabel());
    set('stat-group', temp(machine?.groupTemperature));
    set('stat-steam', temp(machine?.steamTemperature));
    set('stat-water', water(this.state.waterLevel));
    set('stat-scale', scaleStatLabel(scale));
  }

  private currentWaterAlert(): WaterAlertLevel {
    return waterAlertLevel({
      levelMm: this.state.waterLevel,
      machineState: this.state.machine?.state?.state ?? null,
      softLimitMl: this.state.settingsPreferences.waterSoftLimitMl
    });
  }

  // Recompute the water-alert band; return true if it changed so the caller can
  // re-render (the topbar tint and the blocking overlay both follow the band).
  // Clearing back below 'hard' re-arms the dismissable popup.
  private syncWaterAlert(): boolean {
    const next = this.currentWaterAlert();
    if (next === this.lastWaterAlert) return false;
    this.lastWaterAlert = next;
    if (next !== 'hard') this.state.waterAlertDismissed = false;
    return true;
  }

  // Push a new refill threshold (mm) to the machine; the DE1 then raises
  // `needsWater` (and the blocking popup) once the tank reaches it.
  private async setMachineRefillLevel(mm: number): Promise<void> {
    const previous = this.state.machineRefillLevel;
    this.setState({ machineRefillLevel: mm, status: 'Updating machine refill level…' });
    if (this.state.demo) {
      this.setState({ status: 'Machine refill level set (demo)' });
      return;
    }
    try {
      await gateway.setRefillLevel(mm);
      this.setState({ status: 'Machine refill level set' });
    } catch (error) {
      console.error('[Beanie] Set refill level failed', error);
      this.setState({ machineRefillLevel: previous, status: 'Set refill level failed' });
    }
  }

  // Coalesce many incoming frames into at most one canvas draw per animation
  // frame. No rAF is scheduled while idle, so we never spin on a sleeping tablet.
  private scheduleLiveDraw(): void {
    this.liveDirty = true;
    if (this.liveRaf != null) return;
    this.liveRaf = window.requestAnimationFrame(() => {
      this.liveRaf = null;
      if (!this.liveDirty) return;
      this.drawLiveChart();
    });
  }

  private drawLiveChart(): void {
    if ((!this.state.liveActive && !this.state.liveFinalizing) || !this.liveChart) return;
    this.liveDirty = false;
    this.liveChart.resize();
    const ghost = this.state.liveGhost ? this.liveGhostModel : null;
    const model = this.liveShot.model({
      ...liveChartModelOptions(this.state.liveChartMode, ghost?.maxTime),
      stageNames: profileStepNames(this.state.draft?.profile ?? null)
    });
    this.liveChart.setOptions({
      hideMaxTimeLabel: liveChartHideMaxTimeLabel(this.state.liveChartMode, model.maxTime)
    });
    this.liveChart.setModel(ghost ? overlayComparisonModel(model, ghost) : model);
    this.liveChart.draw();
    this.updateLiveReadouts();
  }

  // Resolve the reference shot once at pull start; building a chart model
  // walks the whole measurement array, far too slow for the per-frame path.
  private captureLiveGhost(): void {
    if (this.cleaningInProgress) {
      this.liveGhostModel = null;
      this.liveGhostShotId = null;
      return;
    }
    const reference = liveGhostReference(this.state.shots, this.state.detailShotId, this.state.compareShotId);
    this.liveGhostModel = reference ? chartModelFromShot(reference) : null;
    this.liveGhostShotId = reference?.id ?? null;
  }

  private liveGhostPanelModel(): { enabled: boolean; title: string } | null {
    if (!this.liveGhostModel || !this.liveGhostShotId) return null;
    const reference = this.state.shots.find((shot) => shot.id === this.liveGhostShotId);
    const recipe = reference ? recipeFromShot(reference) : null;
    const what = recipe ? `${formatGrams(recipe.dose)} → ${formatGrams(recipe.yield)}` : 'reference shot';
    return {
      enabled: this.state.liveGhost,
      title: this.state.liveGhost ? `Hide reference overlay (${what})` : `Show reference overlay (${what})`
    };
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
      temp: this.root.querySelector<HTMLElement>('#live-temp'),
      stageRail: this.root.querySelector<HTMLElement>('#live-stage-rail')
    };
    this.drawLiveChart();
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
    if (els.stageRail) {
      // The rail's items are static for the shot; only the highlight moves, so we
      // just toggle `.current` on the item matching the machine's profileFrame.
      const current = this.currentStageIndex();
      els.stageRail.querySelectorAll<HTMLElement>('.live-stage-item').forEach((item) => {
        item.classList.toggle('current', Number(item.dataset.index) === current);
      });
    }
  }

  // The active profile's stage names plus the index the machine is currently in,
  // for the rail beside the live chart. Null when the profile has no usable steps
  // (then there is nothing to list, so the rail stays hidden).
  private liveStagesView(): LiveStagesView | null {
    const names = profileStepNames(this.state.draft?.profile ?? null);
    if (names.length === 0) return null;
    return { names, currentIndex: this.currentStageIndex() };
  }

  // The machine's reported profileFrame, validated against the active profile's
  // step count; null when no frame is known or it falls outside the steps.
  private currentStageIndex(): number | null {
    const frame = this.state.machine?.profileFrame;
    const count = profileStepNames(this.state.draft?.profile ?? null).length;
    if (Number.isInteger(frame) && frame! >= 0 && frame! < count) return frame!;
    return null;
  }

  private onShotEnded(): void {
    const shotWindow = this.liveShot.snapshot;
    const noScaleBlockedAbort = !this.cleaningInProgress && this.isNoScaleBlockedLiveAbort(shotWindow);
    const bean = this.selectedBean();
    const batch = this.selectedBatch();
    const optimisticShot = !this.cleaningInProgress && !noScaleBlockedAbort && bean
      ? optimisticShotFromLive(
          bean,
          batch,
          this.state.workflow,
          normalizeDraft(this.state.draft, this.state.profiles, this.state.grinders),
          shotWindow
        )
      : null;

    const decision = liveShotEndDecision({
      cleaningInProgress: this.cleaningInProgress,
      noScaleBlockedAbort,
      beanId: bean?.id ?? null,
      demo: this.state.demo,
      currentShots: this.state.shots,
      shotWindow,
      optimisticShot,
      completionReason: this.liveShot.completionReason,
      nowMs: Date.now()
    });

    switch (decision.type) {
      case 'cleaning':
        this.finishCleaningCycle();
        return;
      case 'no-scale-abort':
        this.liveShot.reset();
        this.showNoScaleShotWarning({
          liveActive: false,
          liveFinalizing: false
        });
        return;
      case 'remote-save':
        if (!bean) return;
        // Keep the shot screen up (chart frozen, "Saving…") while the gateway
        // finishes persisting the shot, so the list never flashes the unsettled
        // optimistic yield. refreshShotsAfterLiveShot swaps in the real shot —
        // or falls back to the optimistic one — and only then closes the screen.
        this.countShotForCleaning();
        this.setState({
          liveActive: false,
          liveFinalizing: true,
          beans: promoteBean(this.state.beans, decision.beanId),
          status: decision.status
        });
        void this.refreshShotsAfterLiveShot(bean, batch, decision.context);
        return;
      case 'local-complete':
        // Demo / no bean: nothing to wait for — show the shot immediately.
        this.countShotForCleaning();
        this.setState({
          liveActive: false,
          liveFinalizing: false,
          beans: bean ? promoteBean(this.state.beans, bean.id) : this.state.beans,
          shots: decision.optimisticShot
            ? includeShotInHistory(this.state.shots, decision.optimisticShot, this.shotPageSize)
            : this.state.shots,
          shotsTotal: decision.optimisticShot
            ? Math.max(this.state.shotsTotal, this.state.shots.length + 1)
            : this.state.shotsTotal,
          detailShotId: decision.optimisticShot?.id ?? this.state.detailShotId,
          status: decision.status
        });
        this.liveShot.reset();
        if (bean && batch) {
          void this.consumeBatchDoseForShot(
            bean,
            batch.id,
            decision.optimisticShot?.annotations?.actualDoseWeight ?? null
          );
        }
        return;
    }
  }

  private async refreshShotsAfterLiveShot(
    bean: Bean,
    batch: BeanBatch | null,
    context: LiveShotCompletionContext
  ): Promise<void> {
    // Deduct the dose now: the beans are spent the moment the shot ends, even if
    // the gateway poll below times out or the user navigates away mid-wait.
    if (batch) {
      void this.consumeBatchDoseForShot(
        bean,
        batch.id,
        context.optimisticShot?.annotations?.actualDoseWeight ?? null
      );
    }
    try {
      const result = await waitForCompletedLiveShot(context, {
        delay,
        invalidateShotMutation: async () => {
          this.shotCacheGeneration += 1;
          // Only the page cache needs busting to discover the new shot; the
          // per-shot summaries/records are still valid and must survive so
          // offline history is not destroyed if the gateway dies mid-poll.
          await beanieCache.invalidateShotPages().catch(() => {});
        },
        loadFirstShots: () => this.loadFirstShots(bean, batch),
        loadLatestShotCandidates: () => this.loadLatestShotCandidates(),
        stillRelevant: () =>
          this.selectedBean()?.id === bean.id &&
          this.selectedBatch()?.id === batch?.id &&
          !this.state.liveActive
      });

      if (result.type === 'aborted') return;

      if (result.type === 'completed') {
        const savedShot = await this.saveFreshnessForCompletedShot(result.shot, batch);
        const records = result.records.map((shot) => (shot.id === savedShot.id ? savedShot : shot));
        const visibleRecords = includeShotInHistory(records, savedShot, this.shotPageSize);

        // Real shot is persisted and settled — now close the shot screen onto it.
        this.liveShot.reset();
        this.setState({
          shots: visibleRecords,
          shotsTotal: Math.max(result.total, visibleRecords.length),
          shotsLoadingMore: false,
          liveActive: false,
          liveFinalizing: false,
          detailShotId: savedShot.id,
          status: 'Shot saved'
        });
        return;
      }

      // Gave up waiting for the gateway — fall back to the optimistic shot so the
      // screen still closes rather than hanging.
      this.liveShot.reset();
      const visibleRecords = context.optimisticShot
        ? includeShotInHistory(result.records, context.optimisticShot, this.shotPageSize)
        : result.records;
      this.setState({
        shots: visibleRecords,
        shotsTotal: Math.max(result.total, visibleRecords.length),
        shotsLoadingMore: false,
        liveActive: false,
        liveFinalizing: false,
        detailShotId: context.optimisticShot?.id ?? result.records[0]?.id ?? this.state.detailShotId,
        status: 'Shot list updated'
      });
    } finally {
      // Safety net: never leave the shot screen stuck finalizing (e.g. the user
      // switched beans mid-wait). Don't touch it if a new live shot took over.
      if (this.state.liveFinalizing && !this.state.liveActive) {
        this.liveShot.reset();
        this.setState({ liveActive: false, liveFinalizing: false });
      }
    }
  }

  // A pulled shot consumes its dose from the bag it was brewed from, so the
  // remaining weight tracks itself; bags without a tracked weight are left alone.
  private async consumeBatchDoseForShot(
    bean: Bean,
    batchId: string,
    doseWeight: number | null | undefined
  ): Promise<void> {
    const dose = positiveNumber(doseWeight);
    if (dose == null) return;
    const batch = (this.state.batchesByBean[bean.id] ?? []).find((item) => item.id === batchId);
    const remaining = positiveNumber(batch?.weightRemaining);
    if (!batch || remaining == null) return;
    const next = Math.max(0, round(remaining - dose, 1));
    const batchInput: Partial<BeanBatch> = {
      beanId: bean.id,
      roastDate: batch.roastDate ?? null,
      roastLevel: batch.roastLevel ?? null,
      weight: batch.weight ?? null,
      weightRemaining: next,
      storageEvents: batch.storageEvents ?? null,
      frozen: batch.frozen
    };
    await this.saveBatchStoragePatch(bean, batch.id, batchInput, `Bag: ${formatGrams(next)} left`);
  }

  // The inverse of consumeBatchDoseForShot: a deleted shot can return its dose to
  // the bag it was pulled from. Only bags with a tracked remaining weight qualify
  // (remaining may be 0 if this shot emptied it), and we never refill past the
  // bag's original weight.
  private reclaimableDoseForShot(shot: ShotRecord): ReclaimPlan | null {
    const dose = positiveNumber(shot.annotations?.actualDoseWeight);
    if (dose == null) return null;
    const found = this.batchAndBeanForId(shot.workflow?.context?.beanBatchId ?? null);
    if (!found) return null;
    const remaining = nonNegativeNumber(found.batch.weightRemaining);
    if (remaining == null) return null;
    const cap = positiveNumber(found.batch.weight);
    const next = round(cap == null ? remaining + dose : Math.min(cap, remaining + dose), 1);
    return { bean: found.bean, batch: found.batch, dose, remaining, next };
  }

  private async applyDoseReclaim(plan: ReclaimPlan): Promise<void> {
    const { bean, batch, next } = plan;
    const batchInput: Partial<BeanBatch> = {
      beanId: bean.id,
      roastDate: batch.roastDate ?? null,
      roastLevel: batch.roastLevel ?? null,
      weight: batch.weight ?? null,
      weightRemaining: next,
      storageEvents: batch.storageEvents ?? null,
      frozen: batch.frozen
    };
    await this.saveBatchStoragePatch(bean, batch.id, batchInput, `Bag: ${formatGrams(next)} left`);
  }

  private async saveFreshnessForCompletedShot(shot: ShotRecord, batch: BeanBatch | null): Promise<ShotRecord> {
    const metadata = shotMetadataWithFreshness(shot.metadata, null, batch, shot.timestamp);
    if (!metadata?.freshness) return shot;
    try {
      const saved = await gateway.updateShot(shot.id, { metadata });
      this.shotCacheGeneration += 1;
      await beanieCache.invalidateShotMutation(saved.id).catch(() => {});
      await beanieCache.putShotRecord(saved).catch(() => {});
      return saved;
    } catch (error) {
      console.error('[Beanie] Save freshness snapshot failed', error);
      return { ...shot, metadata };
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
    const context: ClickActionContext = {
      el,
      id: el.dataset.id,
      field: el.dataset.field,
      index: el.dataset.index,
      value: el.dataset.value
    };

    await this.commitActiveBeanPickerFormBeforeAction(el);

    const handler = action ? this.clickActionTable().get(action) : undefined;
    if (handler) await handler(context);
  }

  // Every data-action click in the skin routes through this table — one flat
  // registry instead of a chain of switch statements, so an action name can
  // only ever be claimed by one feature group. Built lazily on first click.
  private clickActions: Map<string, ClickActionHandler> | null = null;

  private clickActionTable(): Map<string, ClickActionHandler> {
    if (this.clickActions) return this.clickActions;
    const table = new Map<string, ClickActionHandler>();
    const groups = [
      this.phoneClickActions(),
      this.beanClickActions(),
      this.scannerClickActions(),
      this.recipeClickActions(),
      this.shotClickActions(),
      this.machineClickActions(),
      this.settingsClickActions(),
      this.navigationClickActions(),
      this.profileEditorClickActions()
    ];
    for (const group of groups) {
      for (const [action, handler] of Object.entries(group)) {
        if (table.has(action)) throw new Error(`Duplicate click action: ${action}`);
        table.set(action, handler);
      }
    }
    this.clickActions = table;
    return table;
  }

  private phoneClickActions(): Record<string, ClickActionHandler> {
    return {
      'phone-tab': ({ value }) => {
        if (!isPhoneTab(value)) return;
        this.setState({ phoneTab: value, view: 'workbench' });
        if (value === 'settings') {
          this.openSettingsForPhone();
        }
        if (value === 'beans') void this.refreshBeans({ force: true });
      },
      'phone-select-bean': async ({ id }) => {
        if (id) {
          this.setState({ secondTapHint: null });
          // Match the tablet picker: selecting a coffee also sets it as the
          // machine's next brew (there is no separate "brew this" step).
          await this.selectBean(id, { apply: true, preferWorkflow: false });
        }
      },
      'phone-select-shot': ({ id }) => {
        if (id) {
          const closing = this.state.detailShotId === id;
          this.setState({
            detailShotId: closing ? null : id,
            shotEdit: closing || this.state.shotEdit?.shotId !== id ? null : this.state.shotEdit,
            secondTapHint: null,
            status: closing ? 'Shot closed' : 'Shot selected'
          });
        }
      },
      'phone-edit-shot': ({ id }) => {
        if (id) this.setState({ detailShotId: id, secondTapHint: null });
        this.openShotEditor();
      },
      'phone-shot-score': ({ id, value }) => {
        if (id) {
          const shot = this.state.shots.find((item) => item.id === id);
          const draft = this.state.shotEdit?.shotId === id ? this.state.shotEdit : shot ? shotEditDraftFromShot(shot) : null;
          this.applyPhoneShotScore(id, scoreValueFromTap(value, draft?.enjoyment ?? null));
        }
      },
      'phone-save-shot': async ({ id }) => {
        if (id) await this.savePhoneShotDraft(id);
      },
    };
  }

  private beanClickActions(): Record<string, ClickActionHandler> {
    return {
      'select-bean': async ({ id }) => {
        if (id) {
          this.completeSecondTapHint('bean');
          this.setState({ modal: null, secondTapHint: null });
          await this.selectBean(id, { apply: true, preferWorkflow: false });
        }
      },
      'inspect-bean': async ({ id }) => {
        if (id) {
          const focusedId = this.state.beanPickerBeanId ?? this.state.selectedBeanId;
          if (id === focusedId) {
            this.completeSecondTapHint('bean');
            this.setState({ modal: null, secondTapHint: null });
            if (id !== this.state.selectedBeanId) {
              await this.selectBean(id, { apply: true, preferWorkflow: false });
            }
          } else {
            await this.inspectBeanInPicker(id);
          }
        }
      },
      'open-add-bean': async () => {
        if (this.state.modal === 'bean-picker') {
          this.setState({
            beanPickerBeanId: null,
            beanPickerMode: 'create',
            beanPickerDraftBatchBeanId: null,
            beanPickerEditingBeanId: null,
            beanPickerEditingBatchId: null,
            beanPickerShowAllBags: false,
            status: 'Adding bean'
          });
        } else {
          await this.openBeanPicker(null, { create: true });
        }
      },
      'open-edit-bean': async ({ id }) => {
        await this.openBeanPicker(id ?? this.state.selectedBeanId, { autofocusSearch: false });
      },
      'archive-bean': async ({ id }) => {
        if (id) await this.archiveBean(id);
      },
      'toggle-bean-details': ({ id }) => {
        if (id) {
          this.setState({
            beanPickerEditingBeanId: this.state.beanPickerEditingBeanId === id ? null : id,
            beanPickerEditingBatchId: null,
            beanPickerBeanId: id,
            beanPickerMode: 'inspect'
          });
        }
      },
      'toggle-batch-details': ({ id }) => {
        if (id) {
          this.setState({
            beanPickerEditingBatchId: this.state.beanPickerEditingBatchId === id ? null : id,
            beanPickerEditingBeanId: null,
            beanPickerFreezeBatchId: null
          });
        }
      },
      'focus-batch': async ({ el, id }) => {
        if (id) {
          const changed = this.state.beanPickerFocusedBatchId !== id;
          this.setState({
            beanPickerFocusedBatchId: id,
            beanPickerFreezeBatchId: changed ? null : this.state.beanPickerFreezeBatchId,
            beanPickerEditingBatchId: changed ? null : this.state.beanPickerEditingBatchId
          });
          // Selecting a bag also sets it as the bean's in-use bag (no separate Brew button).
          if (changed && el.dataset.beanId) await this.selectBatchFromPicker(el.dataset.beanId, id);
        }
      },
      'toggle-freeze-stepper': ({ id }) => {
        if (id) {
          this.setState({
            beanPickerFreezeBatchId: this.state.beanPickerFreezeBatchId === id ? null : id,
            beanPickerEditingBatchId: null
          });
        }
      },
      'confirm-freeze-stock': async ({ el, id }) => {
        if (id && el.dataset.beanId) await this.freezeStock(el.dataset.beanId, id);
      },
      'toggle-bean-picker-show-all': () => {
        this.setState({ beanPickerShowAllBags: !this.state.beanPickerShowAllBags });
      },
      'toggle-favorite-bean': ({ id }) => {
        if (id) this.toggleFavoriteBean(id);
      },
      'open-add-batch': async () => {
        await this.openBeanPicker(this.state.selectedBeanId);
        this.startBatchDraftInPicker(this.state.selectedBeanId);
      },
      'bean-picker-add-batch': () => {
        this.startBatchDraftInPicker(this.state.beanPickerBeanId ?? this.state.selectedBeanId);
      },
      'cancel-batch-draft': () => {
        this.cancelBatchDraft();
      },
      'open-batch-storage': ({ el, id }) => {
        if (id && el.dataset.beanId) {
          this.setState({
            modal: 'batch-storage',
            batchStorageTarget: { beanId: el.dataset.beanId, batchId: id },
            status: 'Dates and history'
          });
        }
      },
      'batch-storage-event': async ({ el, id }) => {
        if (el.dataset.type === 'frozen' || el.dataset.type === 'thawed') {
          const target = id && el.dataset.beanId ? { beanId: el.dataset.beanId, batchId: id } : null;
          await this.saveBatchStorageEvent(el.dataset.type, target);
        }
      },
      'finish-batch': async ({ el, id }) => {
        if (id) await this.finishBatchFromPicker(el.dataset.beanId ?? null, id);
      },
    };
  }

  private scannerClickActions(): Record<string, ClickActionHandler> {
    return {
      'open-label-scanner': async () => {
        await this.openLabelScanner();
      },
      'scanner-setup-here': () => {
        // Remember the choice so this device scans on-device next time without
        // showing the hand-off screen (it only takes effect once a key exists).
        writeScanOnThisDevice(true);
        this.setScanner({ handoff: false });
      },
      'scanner-use-phone': () => {
        // Going back to the phone hand-off clears the per-device preference.
        writeScanOnThisDevice(false);
        this.setScanner({ handoff: true });
      },
      'scanner-verify-key': async ({ el }) => {
        const input = el.closest('form')?.querySelector<HTMLInputElement>('input[name="apiKey"]');
        const key = input?.value.trim() ?? '';
        this.setScanner({ keyDraft: key, verifying: true, verifyMessage: null });
        const result = await verifyGeminiKey(key);
        this.setScanner({
          verifying: false,
          verifyMessage: { tone: result.ok ? 'good' : 'warn', text: result.message }
        });
      },
      'scanner-change-key': () => {
        this.setScanner({ step: 'onboard', keyDraft: readGeminiApiKey() ?? '', verifyMessage: null });
      },
      'scanner-remove-photo': ({ index }) => {
        const scanner = this.state.scanner;
        const removeAt = Number(index);
        if (scanner && Number.isInteger(removeAt)) {
          this.setScanner({ images: scanner.images.filter((_, position) => position !== removeAt) });
        }
      },
      'scanner-extract': async () => {
        await this.runScannerExtraction();
      },
      'scanner-rescan': () => {
        // Also the Cancel button while extracting — abort whatever is in flight.
        this.cancelScannerWork();
        this.setScanner({ step: 'capture', scan: null, draft: null, error: null, saving: false, webFields: [], enriching: false });
      },
      'scanner-enrich': async () => {
        await this.runScannerEnrich();
      },
    };
  }

  private setScanner(patch: Partial<LabelScannerState>): void {
    if (!this.state.scanner) return;
    this.setState({ scanner: { ...this.state.scanner, ...patch } });
  }

  /**
   * Scanner requests are tied to a session id so a response that arrives after
   * the modal was closed (or reopened) can't write into the new session, and an
   * AbortController so closing/cancelling actually stops the network call.
   */
  private scannerSession = 0;
  private scannerRequest: AbortController | null = null;

  /** Abort in-flight scanner network work and invalidate its session. */
  private cancelScannerWork(): void {
    this.scannerSession++;
    this.scannerRequest?.abort();
    this.scannerRequest = null;
  }

  /** Fresh signal for one scanner request, bound to the current session. */
  private beginScannerRequest(): { signal: AbortSignal; session: number } {
    this.scannerRequest?.abort();
    this.scannerRequest = new AbortController();
    return { signal: this.scannerRequest.signal, session: this.scannerSession };
  }

  private scannerSessionAlive(session: number): boolean {
    return session === this.scannerSession && this.state.scanner != null;
  }

  /**
   * Push a synced setting's current value to the gateway store. Optimistic: the
   * local cache was already updated by the writer, so on failure we surface a
   * blocking overlay (hard-fail) rather than silently diverging from the store.
   */
  private pushSettingToStore(storeKey: string, value: string | null): void {
    if (this.state.demo) return;
    // A cleared value DELETEs the key (POSTing null would store the string
    // "null"); otherwise the raw string is written.
    const push =
      value === null
        ? gateway.storeDelete(SETTINGS_STORE_NAMESPACE, storeKey)
        : gateway.storeSet(SETTINGS_STORE_NAMESPACE, storeKey, value);
    void push.then(
      () => {
        this.failedStoreWrites.delete(storeKey);
        if (this.failedStoreWrites.size === 0 && this.state.storeError) {
          this.setState({ storeError: false });
        }
      },
      (error: unknown) => {
        console.error('[Beanie] Failed to save setting to gateway store', storeKey, error);
        this.failedStoreWrites.set(storeKey, value);
        if (!this.state.storeError) this.setState({ storeError: true });
      }
    );
  }

  /**
   * Load all settings from the gateway store into the in-memory cache, once per
   * app lifecycle (memoised so the boot path and the scanner share one run).
   * Settings have no localStorage home, so this must finish before real content
   * renders — the app shows a spinner until it does. Fail-soft: on a store error
   * we fall back to defaults so the app is still usable.
   */
  private loadSettings(): Promise<void> {
    if (!this.settingsLoadPromise) {
      this.settingsLoadPromise = this.runLoadSettings();
    }
    return this.settingsLoadPromise;
  }

  private async runLoadSettings(): Promise<void> {
    if (this.state.demo) {
      this.applyLoadedSettings();
      return;
    }
    try {
      await loadAllFromStore(gateway);
      if (this.disposed) return;
      this.applyLoadedSettings();
      this.startSettingsPoll();
    } catch (error) {
      console.warn('[Beanie] Settings load failed; using defaults', error);
      if (!this.disposed) this.applyLoadedSettings();
    }
  }

  /** Re-derive settings-backed state from the in-memory cache and render. */
  private applyLoadedSettings(): void {
    this.setState({
      settingsLoaded: true,
      settingsPreferences: readSettingsPreferences(),
      favoriteProfiles: readFavoriteProfiles(),
      favoriteBeans: readFavoriteBeans(),
      machinePresetLabels: readMachinePresetLabels(),
      machinePresetValues: readMachinePresetValues(),
      machinePresetSelection: readMachinePresetSelection(),
      hotWaterStopMode: readHotWaterStopMode(),
      cleaning: readCleaningState(),
      cleaningProfileOverride: readCleaningProfileOverride(),
      cleaningThreshold: readCleaningThreshold()
    });
    applySettingsPreferences(this.state.settingsPreferences);
  }

  private startSettingsPoll(): void {
    if (this.settingsPollTimer != null) return;
    this.settingsPollTimer = window.setInterval(() => void this.syncFromGateway(), 10_000);
  }

  /**
   * Pick up changes made on another device sharing this gateway — synced
   * settings, plus the selected coffee and the workflow recipe. Runs on a timer
   * and immediately on window focus.
   */
  private async syncFromGateway(): Promise<void> {
    await this.pollSettings();
    await this.resyncWorkflowAndBean();
  }

  /** Live sync: re-poll the settings store; re-render only if something changed. */
  private async pollSettings(): Promise<void> {
    if (this.state.demo || this.disposed) return;
    try {
      const changed = await pollFromStore(gateway);
      if (changed.length > 0 && !this.disposed) this.applyLoadedSettings();
    } catch (error) {
      console.warn('[Beanie] Settings poll failed', error);
    }
  }

  /** Safe to overwrite the displayed recipe: not mid-push of a local edit. */
  private canResyncRecipe(): boolean {
    // Adopt remote recipe/bean changes unless a local apply is in flight
    // ('pending') or a debounced edit is scheduled. We must keep resyncing
    // while 'stale'/'failed' too: a sleeping DE1 (the tablet's normal idle
    // state) parks applyState at 'stale', and excluding it would permanently
    // stop the tablet from picking up changes made on another device. Local
    // unsynced draft edits aren't clobbered — resync only adopts when the
    // gateway *workflow* differs, which a not-yet-applied draft hasn't changed.
    return this.state.applyState !== 'pending' && this.applyTimer == null;
  }

  /**
   * Re-fetch the workflow and selected coffee from the gateway so this device
   * reflects what another device changed. Only while calmly viewing (idle, or
   * settled after an apply) so it never clobbers an in-progress edit, apply,
   * live shot, or open dialog.
   */
  private async resyncWorkflowAndBean(): Promise<void> {
    if (
      this.state.demo ||
      this.disposed ||
      this.state.busy ||
      this.state.liveActive ||
      !this.canResyncRecipe() ||
      this.state.modal != null
    ) {
      return;
    }
    let workflow: Workflow;
    try {
      workflow = await gateway.workflow();
    } catch (error) {
      console.warn('[Beanie] Workflow resync failed', error);
      return;
    }
    if (this.disposed || this.state.busy || !this.canResyncRecipe()) return;
    // The selected coffee can travel in the workflow (context.beanId) or, when
    // the workflow carries no bean, in last-bean-id; the recipe signature omits
    // the bean. Check all three so any of them re-syncs.
    const lastBeanId = readLastBeanId();
    const newBeanId = workflow.context?.beanId ?? null;
    const currentBeanId = this.state.workflow?.context?.beanId ?? null;
    const changed =
      newBeanId !== currentBeanId ||
      (lastBeanId != null && lastBeanId !== this.state.selectedBeanId) ||
      workflowSignature(workflow) !== workflowSignature(this.state.workflow);
    if (!changed) return;
    // Adopt the gateway's workflow, then re-derive the displayed recipe + bean
    // from it (display only — never applied back to the machine).
    this.state.workflow = workflow;
    // Prefer the explicitly-selected coffee (last-bean-id, written on every
    // pick) over the workflow's bean: picking a coffee uses apply:false, so the
    // workflow's context.beanId lags behind until a recipe is applied.
    const selected =
      (lastBeanId != null ? this.state.beans.find((bean) => bean.id === lastBeanId) ?? null : null) ??
      selectInitialBean(this.state.beans, workflow, lastBeanId, null);
    if (selected) {
      await this.selectBean(selected.id, { apply: false, preferWorkflow: true });
    } else {
      this.setState({ workflow, appliedSignature: workflowSignature(workflow) });
    }
  }

  private readonly handleWindowFocus = (): void => {
    void this.syncFromGateway();
  };

  private retryFailedStoreWrites(): void {
    for (const [storeKey, value] of [...this.failedStoreWrites.entries()]) {
      this.pushSettingToStore(storeKey, value);
    }
  }

  private dismissStoreError(): void {
    this.failedStoreWrites.clear();
    this.setState({ storeError: false });
  }

  /**
   * Open the scanner. The Decent tablet (whose webview user agent is exactly
   * "Decent") can't take photos well, so it hands off to a phone via QR. A phone
   * or normal browser — including the one that scanned the QR — runs the flow
   * on-device. Demo and the QR-arrival both go straight to the on-device flow.
   */
  private async openLabelScanner(options: { fromHandoff?: boolean } = {}): Promise<void> {
    this.cancelScannerWork();
    // The Gemini key lives in the store; make sure settings have loaded.
    await this.loadSettings();
    const hasKey = readGeminiApiKey() != null;
    // A tablet that has chosen "Set up on this device" (and has a key) skips the
    // hand-off entirely and scans on-device from then on.
    const scanHere = hasKey && readScanOnThisDevice();
    const handoff = isDecentAppWebView() && options.fromHandoff !== true && !this.state.demo && !scanHere;
    // Build the QR from the gateway's LAN IP (the tablet webview is on localhost).
    const handoffUrl = handoff ? buildHandoffUrl(location.href, await gateway.lanAddress()) : null;
    this.setState({
      modal: 'label-scanner',
      scanner: {
        step: handoff ? 'onboard' : this.state.demo || hasKey ? 'capture' : 'onboard',
        handoff,
        qrSvg: handoffUrl ? renderQrSvg(handoffUrl) : null,
        qrUrl: handoffUrl,
        keyDraft: '',
        verifying: false,
        verifyMessage: null,
        images: [],
        scan: null,
        draft: null,
        lowConfidence: [],
        webFields: [],
        enriching: false,
        existingBeanId: null,
        existingBeanLabel: null,
        saving: false,
        error: null
      }
    });
  }

  private async addScannerPhotos(files: File[]): Promise<void> {
    if (!this.state.scanner) return;
    // Per-file isolation: one unreadable photo must not drop the others.
    const results = await Promise.allSettled(files.map((file) => fileToScaledImage(file)));
    if (!this.state.scanner) return;
    const added: CapturedImage[] = results
      .filter((result): result is PromiseFulfilledResult<CapturedImage> => result.status === 'fulfilled')
      .map((result) => result.value);
    const failed = results.length - added.length;
    if (added.length > 0) this.setScanner({ images: [...this.state.scanner.images, ...added] });
    if (failed > 0) {
      console.error(
        '[Beanie] Could not prepare photo',
        results.find((result) => result.status === 'rejected')
      );
      this.setState({ status: failed === 1 ? 'Could not read one photo' : `Could not read ${failed} photos` });
    }
  }

  private async runScannerExtraction(): Promise<void> {
    const scanner = this.state.scanner;
    if (!scanner) return;
    if (!this.state.demo && readGeminiApiKey() == null) {
      this.setScanner({
        step: 'onboard',
        handoff: false,
        verifyMessage: { tone: 'warn', text: 'Add your Gemini API key first.' }
      });
      return;
    }
    const { signal, session } = this.beginScannerRequest();
    this.setScanner({ step: 'extracting', error: null });
    try {
      const scan: LabelScan = this.state.demo
        ? demoLabelScan()
        : await scanLabel(
            scanner.images.map((image) => ({ mime: image.mime, base64: image.base64 })),
            readGeminiApiKey() ?? '',
            { signal }
          );
      if (!this.scannerSessionAlive(session)) return;
      const draft = labelScanToDraft(scan);
      const existing = findExistingBean(this.state.beans, draft.roaster, draft.name);
      this.setScanner({
        step: 'review',
        scan,
        draft,
        lowConfidence: [...lowConfidenceFields(scan)],
        webFields: [],
        enriching: false,
        existingBeanId: existing?.id ?? null,
        existingBeanLabel: existing ? beanLabel(existing) : null
      });
      // Look up the roaster's site in the background — the review form is
      // already editable while it searches.
      void this.runScannerEnrich({ auto: true });
    } catch (error) {
      if (signal.aborted || !this.scannerSessionAlive(session)) return;
      console.error('[Beanie] Label scan failed', error);
      if (isGeminiKeyError(error)) {
        // The stored key went bad — back to onboarding instead of a dead retry loop.
        this.setScanner({
          step: 'onboard',
          handoff: false,
          keyDraft: readGeminiApiKey() ?? '',
          verifyMessage: { tone: 'warn', text: 'Gemini rejected your API key — check it and save again.' }
        });
        return;
      }
      const message = error instanceof GeminiError ? error.message : 'Could not read the label — try again.';
      this.setScanner({ step: 'error', error: message });
    }
  }

  /** The review form's live values, falling back to the stored draft. */
  private readScannerReviewDraft(): LabelScanDraft | null {
    const form = document.querySelector<HTMLFormElement>('form[data-form="scanner-review"]');
    if (!form) return this.state.scanner?.draft ?? null;
    const data = new FormData(form);
    const get = (name: string): string => String(data.get(name) ?? '');
    return {
      roaster: get('roaster'),
      name: get('name'),
      country: get('country'),
      region: get('region'),
      processing: get('processing'),
      notes: get('notes'),
      roastDate: get('roastDate'),
      roastLevel: get('roastLevel'),
      weight: get('weight')
    };
  }

  /**
   * Look up the roaster's site and fold extra detail into the draft. Runs
   * automatically when the review opens (auto: failures stay quiet — the
   * button is still there to retry) and from the enrich button (manual:
   * failures surface in the status line). The merge reads the live form so
   * edits made while it searches are never clobbered.
   */
  private async runScannerEnrich(options: { auto?: boolean } = {}): Promise<void> {
    const scanner = this.state.scanner;
    if (!scanner || scanner.enriching || scanner.step !== 'review') return;
    const base = this.readScannerReviewDraft();
    if (!base) return;
    if (!base.roaster.trim() || !base.name.trim()) {
      if (!options.auto) this.setState({ status: 'Add a roaster and bean name to enrich.' });
      return;
    }

    const { signal, session } = this.beginScannerRequest();
    this.setScanner({ enriching: true });
    try {
      const enrichment = this.state.demo
        ? demoLabelEnrich()
        : await enrichLabel(
            { roaster: base.roaster, name: base.name, country: base.country },
            readGeminiApiKey() ?? '',
            { signal }
          );
      if (!this.scannerSessionAlive(session) || this.state.scanner?.step !== 'review') return;
      const current = this.readScannerReviewDraft() ?? base;
      const merged = mergeEnrichment(current, enrichment);
      this.withScannerFocusKept(() =>
        this.setScanner({
          enriching: false,
          draft: merged.draft,
          webFields: [...new Set([...(this.state.scanner?.webFields ?? []), ...merged.webFields])]
        })
      );
      if (!options.auto && merged.webFields.length === 0) this.setState({ status: 'No extra details found.' });
    } catch (error) {
      if (signal.aborted || !this.scannerSessionAlive(session)) return;
      console.error('[Beanie] Enrich failed', error);
      this.setScanner({ enriching: false });
      if (!options.auto) {
        const message = error instanceof GeminiError ? error.message : 'Could not reach the roaster — try again.';
        this.setState({ status: message });
      }
    }
  }

  /**
   * Re-rendering replaces the review form's inputs; when a background enrich
   * lands mid-typing, put the caret back where it was.
   */
  private withScannerFocusKept(render: () => void): void {
    const active = document.activeElement;
    const focused =
      (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) &&
      active.closest('form[data-form="scanner-review"]')
        ? { name: active.name, start: active.selectionStart, end: active.selectionEnd }
        : null;
    render();
    if (!focused) return;
    const next = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      `form[data-form="scanner-review"] [name="${focused.name}"]`
    );
    if (!next) return;
    next.focus();
    try {
      if (focused.start != null && focused.end != null) next.setSelectionRange(focused.start, focused.end);
    } catch {
      // date/number inputs don't support selection ranges
    }
  }

  private saveScannerKey(form: HTMLFormElement): void {
    const key = String(new FormData(form).get('apiKey') ?? '').trim();
    if (!key) {
      this.setScanner({ verifyMessage: { tone: 'warn', text: 'Enter your API key first.' } });
      return;
    }
    // writeGeminiApiKey is a synced write — it pushes to the store itself.
    writeGeminiApiKey(key);
    this.setScanner({ step: 'capture', keyDraft: '', verifyMessage: null });
  }

  private async submitScannerReview(form: HTMLFormElement): Promise<void> {
    const scanner = this.state.scanner;
    if (!scanner) return;
    const data = new FormData(form);
    const beanFields = beanFieldsFromForm(data);
    if (!beanFields.roaster || !beanFields.name) {
      this.setState({ status: 'Add a roaster and a bean name.' });
      return;
    }

    // Stop a still-running background enrich from re-rendering the form mid-save.
    this.cancelScannerWork();
    this.setScanner({ saving: true, error: null, enriching: false });

    const existing =
      (scanner.existingBeanId ? this.state.beans.find((bean) => bean.id === scanner.existingBeanId) : null) ??
      findExistingBean(this.state.beans, beanFields.roaster, beanFields.name);

    let beanId: string;
    let beans = this.state.beans;
    let batchesByBean = this.state.batchesByBean;

    if (existing) {
      beanId = existing.id;
    } else {
      const saved = await this.beanWorkflow.saveBean(
        { beans, batchesByBean, editingId: null, fields: beanFields, demo: this.state.demo, nowMs: Date.now() },
        {
          createBean: (input) => gateway.createBean(input),
          updateBean: (id, input) => gateway.updateBean(id, input),
          putBeans: (next) => beanieCache.putBeans(next),
          putBeanBatches: (id, batches) => beanieCache.putBeanBatches(id, batches)
        }
      );
      if (saved.type === 'failed') {
        console.error('[Beanie] Scanner save bean failed', saved.error);
        this.setScanner({ saving: false, step: 'error', error: saved.status });
        return;
      }
      beanId = saved.bean.id;
      beans = saved.beans;
      batchesByBean = saved.batchesByBean;
    }

    const bean = existing ?? beans.find((item) => item.id === beanId);
    if (!bean) {
      this.setScanner({ saving: false, step: 'error', error: 'Could not save the bean.' });
      return;
    }

    const batchInput = batchFieldsFromForm(data, beanId);
    batchInput.weightRemaining = batchInput.weight;

    const created = await this.beanWorkflow.createBatch(
      {
        bean,
        batchesByBean,
        selectedBeanId: this.state.selectedBeanId,
        selectedBatchId: this.state.selectedBatchId,
        batchInput,
        demo: this.state.demo,
        nowMs: Date.now()
      },
      {
        createBatch: (id, input) => gateway.createBatch(id, input),
        putBeanBatches: (id, batches) => beanieCache.putBeanBatches(id, batches)
      }
    );

    if (created.type === 'failed') {
      console.error('[Beanie] Scanner add batch failed', created.error);
      this.setState({ beans, batchesByBean });
      this.setScanner({ saving: false, step: 'error', error: created.status });
      return;
    }

    this.setState({
      beans,
      batchesByBean: created.batchesByBean,
      selectedBatchId: created.batch.id,
      modal: null,
      scanner: null,
      status: existing ? 'Added a bag from the label' : 'Added a bean from the label'
    });
    await this.selectBean(beanId, { apply: false, preferWorkflow: false });
  }

  private renderLabelScannerModal(): string {
    const scanner = this.state.scanner;
    if (!scanner) return '';
    return renderLabelScannerModalView({
      step: scanner.step,
      demo: this.state.demo,
      handoff: scanner.handoff,
      qrSvg: scanner.qrSvg,
      qrUrl: scanner.qrUrl,
      keyDraft: scanner.keyDraft,
      verifying: scanner.verifying,
      verifyMessage: scanner.verifyMessage,
      images: scanner.images.map((image) => ({ dataUrl: image.dataUrl })),
      draft: scanner.draft,
      lowConfidence: scanner.lowConfidence,
      webFields: scanner.webFields,
      enriching: scanner.enriching,
      existingBeanLabel: scanner.existingBeanLabel,
      saving: scanner.saving,
      error: scanner.error
    });
  }

  private recipeClickActions(): Record<string, ClickActionHandler> {
    return {
      'adjust': ({ el, field }) => {
        if (field) this.adjustField(field, Number(el.dataset.delta ?? '0'));
      },
      'edit-field': ({ field }) => {
        if (isEditField(field)) this.openEditDialog(field);
      },
      'open-number-edit': ({ el }) => {
        this.openNumberEditDialog(el);
      },
      'dialog-adjust': ({ el }) => {
        this.adjustDialogValue(Number(el.dataset.delta ?? '0'));
      },
      'dialog-key': ({ el }) => {
        this.typeDialogKey(el.dataset.key ?? '');
      },
      'dialog-backspace': () => {
        this.backspaceDialogValue();
      },
      'dialog-clear': () => {
        this.clearDialogValue();
      },
      'dialog-recent': ({ el }) => {
        this.setDialogValue(el.dataset.value ?? '');
      },
      'dialog-choice': ({ id }) => {
        this.selectDialogChoice(id ?? null);
      },
      'dialog-commit': async () => {
        await this.commitEditDialog();
      },
    };
  }

  private shotClickActions(): Record<string, ClickActionHandler> {
    return {
      'select-history-shot': ({ id }) => {
        if (id) this.selectHistoryShot(id);
      },
      'edit-shot': () => {
        this.openShotEditor();
      },
      'delete-shot': ({ id }) => {
        if (id) this.deleteShot(id);
      },
      'confirm-delete-shot': () => {
        void this.performDeleteShot(false);
      },
      'confirm-delete-shot-reclaim': () => {
        void this.performDeleteShot(true);
      },
      'open-shot-field': ({ field }) => {
        if (isShotEditField(field)) this.setState({ shotEditField: field, shotBeanEdit: null });
      },
      'close-shot-field': () => {
        this.setState({ shotEditField: null });
      },
      'shot-field-option': ({ field, value }) => {
        if (isShotEditField(field)) this.applyShotEditField(field, value ?? '');
      },
      'open-shot-bean': async () => {
        await this.openShotBeanDialog();
      },
      'close-shot-bean': () => {
        this.setState({ shotBeanEdit: null });
      },
      'shot-bean-pick': async ({ id }) => {
        await this.pickShotBean(id ?? '');
      },
      'shot-bean-new': () => {
        if (this.state.shotBeanEdit) this.setState({ shotBeanEdit: { creating: true } });
      },
      'shot-bean-cancel-new': () => {
        if (this.state.shotBeanEdit) this.setState({ shotBeanEdit: { creating: false } });
      },
      'shot-edit-ey-calc': ({ value }) => {
        const ey = Number(value);
        if (this.state.shotEdit && Number.isFinite(ey)) {
          this.setState({ shotEdit: { ...this.state.shotEdit, drinkEy: ey } });
        }
      },
      'shot-edit-score': ({ value }) => {
        this.setShotEditEnjoyment(scoreValueFromTap(value, this.state.shotEdit?.enjoyment ?? null));
      },
      'set-shot-score': async ({ id, value }) => {
        if (id) {
          const shot = this.state.shots.find((item) => item.id === id);
          await this.updateShotEnjoyment(id, scoreValueFromTap(value, shot?.annotations?.enjoyment ?? null));
        }
      },
      'load-more-shots': async () => {
        await this.loadMoreShots();
      },
      'toggle-compare-pick': () => {
        this.setHistoryState({
          comparePicking: !this.state.comparePicking,
          status: this.state.comparePicking ? this.state.status : 'Pick a shot to compare'
        });
      },
      'clear-compare-shot': () => {
        this.setHistoryState({ compareShotId: null, comparePicking: false });
      },
    };
  }

  private machineClickActions(): Record<string, ClickActionHandler> {
    return {
      'machine-edit-value': ({ el }) => {
        this.openMachineValueDialog(el);
      },
      'machine-preset': async ({ el, value }) => {
        if (el.dataset.name && value) await this.applyMachinePreset(el.dataset.name, value);
      },
      'machine-steam-purge-mode': async ({ value }) => {
        await this.setSteamPurgeMode(Number(value));
      },
      'machine-water-stop-mode': async ({ value }) => {
        await this.setHotWaterStopMode(value === 'time' ? 'time' : 'volume');
      },
      'machine-edit-label': ({ el }) => {
        this.openMachineLabelDialog(el);
      },
      'machine-label-save': () => {
        this.commitMachineLabelEdit();
      },
      'machine-command': async ({ value }) => {
        if (isMachineCommand(value)) await this.toggleMachineCommand(value);
      },
      'open-cleaning-wizard': () => {
        this.openCleaningWizard();
      },
      'cleaning-wizard-next': () => {
        const wizard = this.state.cleaningWizard;
        if (!wizard) return;
        this.teardownUntrackedCleaningAction();
        this.setState({ cleaningWizard: cleaningWizardNext(wizard) });
        this.maybeAutoLoadCleaningProfile();
      },
      'cleaning-wizard-back': () => {
        const wizard = this.state.cleaningWizard;
        if (!wizard) return;
        this.teardownUntrackedCleaningAction();
        this.setState({ cleaningWizard: cleaningWizardBack(wizard) });
      },
      'cleaning-wizard-run-pull': async () => {
        await this.runCleaningWizardPull();
      },
      'cleaning-wizard-run-flush': async () => {
        await this.runCleaningWizardFlush();
      },
      'cleaning-threshold': ({ value }) => {
        const shots = Number(value);
        if (Number.isFinite(shots)) this.setCleaningThreshold(shots);
      },
      'water-alert-dismiss': () => {
        this.setState({ waterAlertDismissed: true });
      },
      'scale-stat': async () => {
        await this.handleScaleStatTap();
      },
      'live-ghost-toggle': () => {
        this.setState({ liveGhost: !this.state.liveGhost });
        this.scheduleLiveDraw();
      },
      'stop': async () => {
        await this.stopMachineService();
      },
      'machine-extend-service': async () => {
        await this.extendMachineServiceDuration(5);
      },
      'sleep': async () => {
        await this.machineAction('sleeping');
      },
      'wake': async () => {
        this.setState({ asleep: false, appAwake: false });
        await this.machineAction('idle');
        if (this.applyAfterWake && !this.machineIsSleeping()) {
          this.applyAfterWake = false;
          await this.applyDraft();
        }
      },
      'wake-app': async () => {
        await this.wakeAppWithoutMachine();
      },
      'simulate-shot': () => {
        this.startSimulatedShot();
      },
      'open-machine-settings': () => {
        this.setState({ view: 'machine' });
        void this.loadMachineControlState();
      },
    };
  }

  private settingsClickActions(): Record<string, ClickActionHandler> {
    return {
      'retry-store-write': () => {
        this.retryFailedStoreWrites();
      },
      'dismiss-store-error': () => {
        this.dismissStoreError();
      },
      'open-settings': () => {
        if (this.isPhoneLayout()) {
          this.setState({ phoneTab: 'settings', view: 'workbench' });
          this.openSettingsForPhone();
          return;
        }
        this.setState({
          view: 'settings',
          settingsBundle: this.state.settingsBundle ?? demoSettingsBundle(),
          settingsSource: this.state.settingsBundle
            ? this.state.settingsSource
            : this.state.demo
              ? 'demo'
              : 'loading'
        });
        void this.loadReaSettings();
        void this.loadDecentAccount();
      },
      'open-flow-calibrator': () => {
        this.openFlowCalibrator();
      },
      'flow-cal-adjust': ({ el }) => {
        this.adjustFlowCalibrationDraft(Number(el.dataset.delta ?? '0'));
      },
      'flow-cal-save-global': async ({ value }) => {
        await this.saveFlowCalibrationGlobal(Number(value));
      },
      'flow-cal-save-profile': async ({ value }) => {
        await this.saveFlowCalibrationProfile(Number(value));
      },
      'flow-cal-shot': ({ id }) => {
        if (id) this.selectFlowCalibrationShot(id);
      },
      'settings-section': ({ value }) => {
        if (!value) return;
        this.setState({ settingsSection: value });
        // A section switch should open at the top, not inherit the prior
        // section's scroll (which restoreScroll would otherwise carry over now
        // that .settings-detail is scroll-preserved across re-renders).
        const detail = this.root.querySelector<HTMLElement>('.settings-detail');
        if (detail) detail.scrollTop = 0;
      },
      'settings-reset-machine': async () => {
        await this.resetMachineSettings();
      },
      'settings-plugin-config': async ({ id }) => {
        if (id) await this.togglePluginConfig(id);
      },
      'settings-plugin-save': async ({ id }) => {
        if (id) await this.savePluginConfig(id);
      },
      'settings-plugin-verify': async ({ id }) => {
        if (id) await this.verifyPluginConfig(id);
      },
      'settings-change-scanner-key': async () => {
        await this.openLabelScanner();
        this.setScanner({
          step: 'onboard',
          handoff: false,
          keyDraft: readGeminiApiKey() ?? '',
          verifyMessage: null
        });
      },
      'settings-account-login': async () => {
        await this.loginDecentAccount();
      },
      'settings-account-logout': async () => {
        await this.logoutDecentAccount();
      },
      'settings-account-refresh': async () => {
        await this.refreshDecentAccount();
      },
      'settings-scan-devices': async () => {
        await this.scanDevices();
      },
      'settings-connect-preferred-devices': async () => {
        await this.connectPreferredDevices();
      },
      'settings-connect-device': async ({ id }) => {
        if (id) await this.connectDevice(id, true);
      },
      'settings-disconnect-device': async ({ id }) => {
        if (id) await this.connectDevice(id, false);
      },
      'settings-machine-state': async ({ value }) => {
        if (value) await this.requestMachineState(value);
      },
      'settings-schedule-add': async () => {
        const timeInput = this.root.querySelector<HTMLInputElement>('[data-action="settings-schedule-time"]');
        await this.addWakeSchedule(timeInput?.value ?? '');
      },
      'settings-schedule-delete': async ({ id }) => {
        if (id) await this.deleteWakeSchedule(id);
      },
      'settings-theme': ({ el }) => {
        if (isThemePreference(el.dataset.value)) {
          this.updateSettingsPreferences({ theme: el.dataset.value });
        }
      },
      'settings-ui-scale': ({ el }) => {
        if (isUIScalePreference(el.dataset.value)) {
          this.updateSettingsPreferences({ uiScale: el.dataset.value });
        }
      },
      'settings-wake-app-zone-position': ({ el }) => {
        if (isWakeAppZonePosition(el.dataset.value)) {
          this.updateSettingsPreferences({ wakeAppZonePosition: el.dataset.value });
          this.previewWakeAppZone(el.dataset.value);
        }
      },
      'settings-reset-cache': async () => {
        await this.resetLocalCache();
      },
    };
  }

  private openSettingsForPhone(): void {
    this.setState({
      settingsBundle: this.state.settingsBundle ?? demoSettingsBundle(),
      settingsSource: this.state.settingsBundle
        ? this.state.settingsSource
        : this.state.demo
          ? 'demo'
          : 'loading'
    });
    void this.loadReaSettings();
    void this.loadDecentAccount();
  }

  private navigationClickActions(): Record<string, ClickActionHandler> {
    return {
      'go-view': ({ value }) => {
        if (value) this.goView(value as View);
      },
      'open-add-grinder': () => {
        this.setState({ view: 'grinder-editor', editingGrinderId: null, modal: null, editDialog: null });
      },
      'open-edit-grinder': ({ id }) => {
        if (id) this.setState({ view: 'grinder-editor', editingGrinderId: id, modal: null, editDialog: null });
      },
      'open-profile-picker': () => {
        this.setState({
          view: 'profiles',
          cleaningProfilePicking: false,
          profileSearch: '',
          profilePage: 0,
          profileFocusId: this.profileIdForDraft()
        });
      },
      'open-cleaning-profile-picker': () => {
        this.setState({
          view: 'profiles',
          cleaningProfilePicking: true,
          profileSearch: '',
          profilePage: 0,
          profileFocusId: resolveCleaningProfile(this.state.profiles, this.state.cleaningProfileOverride)?.id ?? null
        });
      },
      'open-bean-picker': async () => {
        await this.openBeanPicker(this.state.selectedBeanId);
      },
      'profiles-page': ({ value }) => {
        if (value) this.setState({ profilePage: Number(value) });
      },
      'focus-profile': ({ id }) => {
        if (id) this.focusProfile(id);
      },
      'pick-profile': ({ id }) => {
        if (id) {
          if (this.state.cleaningProfilePicking) this.pickCleaningProfile(id);
          else this.pickProfile(id);
        }
      },
      'toggle-favorite-profile': ({ id }) => {
        if (id) this.toggleFavoriteProfile(id);
      },
      'toggle-show-hidden': () => {
        void this.toggleShowHidden();
      },
      'hide-profile': ({ id }) => {
        if (id) void this.hideProfile(id);
      },
      'unhide-profile': ({ id }) => {
        if (id) void this.unhideProfile(id);
      },
      'delete-profile': ({ id }) => {
        if (id) this.openDeleteProfile(id);
      },
      'confirm-delete-profile': () => {
        void this.confirmDeleteProfile();
      },
      'hide-instead-delete': () => {
        void this.hideInsteadOfDelete();
      },
      'close-modal': () => {
        if (this.state.modal === 'cleaning-wizard') this.teardownUntrackedCleaningAction();
        if (this.state.modal === 'batch-storage') {
          this.setState({ modal: 'bean-picker', batchStorageTarget: null });
          return;
        }
        if (this.state.profileEdit || this.state.machineEdit || this.state.numberEdit || this.state.machineLabelEdit) {
          const returnModal = this.state.numberEdit?.returnModal ?? null;
          this.setState({
            modal: returnModal,
            editDialog: null,
            shotEdit: returnModal === 'edit-shot' ? this.state.shotEdit : null,
            shotEditField: returnModal === 'edit-shot' ? this.state.shotEditField : null,
            shotBeanEdit: returnModal === 'edit-shot' ? this.state.shotBeanEdit : null,
            profileEdit: null,
            machineEdit: null,
            numberEdit: null,
            machineLabelEdit: null
          });
          return;
        }
        if (this.state.scanner) this.cancelScannerWork();
        this.setState({
          modal: null,
          scanner: null,
          batchStorageTarget: null,
          deleteShotTarget: null,
          beanPickerDraftBatchBeanId: null,
          beanPickerEditingBeanId: null,
          beanPickerEditingBatchId: null,
          beanPickerFreezeBatchId: null,
          profileEditor: null,
          editingProfileId: null,
          editDialog: null,
          shotEdit: null,
          shotEditField: null,
          shotBeanEdit: null,
          profileEdit: null,
          machineEdit: null,
          numberEdit: null,
          machineLabelEdit: null,
          profileImport: null,
          profileDeleteTarget: null,
          cleaningWizard: null
        });
      },
    };
  }

  private profileEditorClickActions(): Record<string, ClickActionHandler> {
    return {
      'pe-edit-value': ({ el }) => {
        this.openProfileValueDialog(el);
      },
      'new-profile': () => {
        this.openNewProfileEditor();
      },
      'open-import-profile': () => {
        this.openImportProfile();
      },
      'import-profile-submit': () => {
        void this.submitImportProfile();
      },
      'edit-profile': ({ id }) => {
        if (id) this.openProfileEditor(id);
      },
      'save-profile': async () => {
        await this.submitProfileEditor();
      },
      'pe-add-step': () => {
        this.editorDispatch(addStep);
      },
      'pe-duplicate-step': ({ index }) => {
        if (index != null) this.editorDispatch((pe) => duplicateStep(pe, Number(index)));
      },
      'pe-remove-step': ({ index }) => {
        if (index != null) this.editorDispatch((pe) => removeStep(pe, Number(index)));
      },
      'pe-move-step': ({ index, value }) => {
        if (index != null) this.editorDispatch((pe) => moveStep(pe, Number(index), value === '1' ? 1 : -1));
      },
      'pe-select-step': ({ index }) => {
        if (index != null) this.editorDispatch((pe) => selectStep(pe, Number(index)));
      },
      'pe-step-pump': ({ index, value }) => {
        if (index != null) this.editorDispatch((pe) => setStepPump(pe, Number(index), value === 'flow' ? 'flow' : 'pressure'));
      },
      'pe-step-transition': ({ index, value }) => {
        if (index != null) this.editorDispatch((pe) => setStepTransition(pe, Number(index), value === 'smooth' ? 'smooth' : 'fast'));
      },
      'pe-step-sensor-toggle': ({ index }) => {
        if (index != null) {
          this.editorDispatch((pe) => {
            const step = pe.steps[Number(index)];
            return setStepField(pe, Number(index), 'sensor', step?.sensor === 'water' ? 'coffee' : 'water');
          });
        }
      },
      'pe-step-transition-toggle': ({ index }) => {
        if (index != null) {
          this.editorDispatch((pe) => {
            const step = pe.steps[Number(index)];
            return setStepTransition(pe, Number(index), step?.transition === 'smooth' ? 'fast' : 'smooth');
          });
        }
      },
      'pe-step-nudge': ({ el, index }) => {
        if (index != null && el.dataset.key) {
          this.editorDispatch((pe) =>
            nudgeStepField(pe, Number(index), el.dataset.key as StepFieldKey, Number(el.dataset.delta ?? '0'))
          );
        }
      },
      'pe-simple-nudge': ({ el }) => {
        if (el.dataset.key) {
          this.editorDispatch((pe) =>
            nudgeSimpleProfileField(pe, el.dataset.key as SimpleProfileField, Number(el.dataset.delta ?? '0'))
          );
        }
      },
      'pe-set-mode': ({ value }) => {
        this.editorDispatch((pe) => setEditorMode(pe, value === 'basic' ? 'basic' : 'advanced'));
      },
      'pe-set-simple-type': ({ value }) => {
        this.editorDispatch((pe) => setSimpleProfileType(pe, value === 'flow' ? 'flow' : 'pressure'));
      },
      'pe-advanced-tab': ({ value }) => {
        this.editorDispatch((pe) => setAdvancedTab(pe, value === 'limits' ? 'limits' : 'steps'));
      },
      'pe-step-exit-nudge': ({ el, index }) => {
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
      },
      'pe-step-exit-preset': ({ el, index }) => {
        if (index != null) {
          this.editorDispatch((pe) =>
            setStepExit(pe, Number(index), {
              type: el.dataset.type === 'flow' ? 'flow' : 'pressure',
              condition: el.dataset.condition === 'under' ? 'under' : 'over',
              value: Number(el.dataset.value ?? '0') || 0
            })
          );
        }
      },
      'pe-step-exit-clear': ({ index }) => {
        if (index != null) this.editorDispatch((pe) => setStepExit(pe, Number(index), null));
      },
    };
  }

  private onInput(event: Event): void {
    const target = event.target as HTMLInputElement | HTMLTextAreaElement;
    if (target.dataset.action === 'phone-recipe-field') {
      if (isEditField(target.dataset.field)) this.applyPhoneRecipeField(target.dataset.field, target.value);
      return;
    }
    if (target.dataset.action === 'phone-shot-field') {
      if (target.dataset.id && isShotEditField(target.dataset.field)) {
        this.applyPhoneShotField(target.dataset.id, target.dataset.field, target.value);
      }
      return;
    }
    if (target.dataset.action === 'search') {
      this.setState({ search: target.value });
    }
    if (target.dataset.action === 'shot-search') {
      this.setState({ shotSearch: target.value });
    }
    if (target.dataset.action === 'settings-search') {
      this.setState({ settingsSearch: target.value });
    }
    if (target.dataset.action === 'profile-search') {
      this.setState({ profileSearch: target.value, profilePage: 0, profileFocusId: null });
    }
    if (target.dataset.action === 'settings-account-field') {
      this.updateDecentAccountField(target.dataset.key ?? '', target.value);
    }
    if (target.dataset.action?.startsWith('pe-')) {
      this.applyEditorEvent(target, false);
    }
  }

  private pickProfile(id: string): void {
    const selection = selectProfileForDraft({
      draft: this.state.draft,
      profiles: this.state.profiles,
      grinders: this.state.grinders,
      profileId: id
    });
    this.setState({
      draft: selection.draft,
      view: 'workbench',
      profileSearch: '',
      status: selection.status
    });
    this.scheduleApply();
  }

  private focusProfile(id: string): void {
    const selection = selectProfileForDraft({
      draft: this.state.draft,
      profiles: this.state.profiles,
      grinders: this.state.grinders,
      profileId: id
    });
    this.setState({
      draft: selection.draft,
      profileFocusId: id,
      status: selection.status
    });
  }

  private goView(view: View): void {
    this.setState({
      view,
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
    const input = editProfileEditorInput(this.state.profiles, id);
    if (input.type === 'missing') return;
    this.openProfileEditorInput(input.editingProfileId, input.profile);
  }

  private openNewProfileEditor(): void {
    const input = newProfileEditorInput();
    if (input.type === 'missing') return;
    this.openProfileEditorInput(input.editingProfileId, input.profile);
  }

  private openImportProfile(): void {
    this.setState({ modal: 'import-profile', profileImport: { code: '', busy: false, error: null } });
  }

  // Import a profile from a Visualizer share code via the bundled plugin, then
  // refresh the list and focus the new profile so it shows in the preview pane.
  // Importing does not select it onto the machine — the user presses Select.
  private async submitImportProfile(): Promise<void> {
    const current = this.state.profileImport;
    if (!current || current.busy) return;
    const input = this.root.querySelector<HTMLInputElement>('[data-action="import-profile-input"]');
    const code = (input?.value ?? '').trim();
    if (!code) {
      this.setState({ profileImport: { code: '', busy: false, error: 'Enter a share code.' } });
      return;
    }
    this.setState({ profileImport: { code, busy: true, error: null } });
    try {
      const result = await gateway.importProfileFromVisualizer(code);
      await beanieCache.invalidateProfileMutation(result.profileId ?? undefined);
      const profiles = await gateway.profiles();
      await beanieCache.putProfiles(profiles);
      this.setState({
        profiles,
        modal: null,
        profileImport: null,
        profileFocusId: result.profileId ?? this.state.profileFocusId,
        status: result.profileTitle ? `Imported ${result.profileTitle}` : 'Profile imported'
      });
    } catch (err) {
      this.setState({ profileImport: { code, busy: false, error: importErrorMessage(err) } });
    }
  }

  private openProfileEditorInput(editingProfileId: string | null, profile: Profile | null): void {
    this.setState({
      view: 'profile-editor',
      editingProfileId,
      profileEditor: createProfileEditorState(profile),
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
      this.setState({ status: problem, profileEditor: { ...pe, saveNotice: { tone: 'error', message: problem } } });
      return;
    }
    const profile = profileFromEditorState(pe);
    const editingId = this.state.editingProfileId;
    const cloneOfDefault = Boolean(editingId) && this.state.profiles.find((item) => item.id === editingId)?.isDefault === true;
    this.setState({
      busy: true,
      status: cloneOfDefault ? 'Saving a copy' : 'Saving profile',
      profileEditor: { ...pe, saveNotice: null }
    });

    const result = await saveProfile({
      profiles: this.state.profiles,
      editingId,
      profile,
      demo: this.state.demo,
      nowMs: Date.now()
    }, {
      createProfile: (input) => gateway.createProfile(input),
      updateProfile: (id, input) => gateway.updateProfile(id, input),
      loadProfiles: () => gateway.profiles(),
      invalidateProfileMutation: (profileId) => beanieCache.invalidateProfileMutation(profileId),
      putProfiles: (profiles) => beanieCache.putProfiles(profiles),
      restoreProfile: (id) => gateway.setProfileVisibility(id, 'visible').then(() => {})
    });

    if (result.type === 'failed') {
      console.error('[Beanie] Save profile failed', result.error);
      const editor = this.state.profileEditor;
      this.setState({
        busy: false,
        status: result.status,
        profileEditor: editor
          ? { ...editor, saveNotice: { tone: 'error', message: profileSaveErrorMessage(result.error) } }
          : editor
      });
      return;
    }

    // Saving keeps the editor open (Save is not "done") and surfaces the result
    // in-place. The saved profile is now the one being edited, so a re-save
    // updates it instead of creating a duplicate, and it's focused so it shows
    // when the user returns to the list. The gateway content-hash-dedupes by
    // brew settings (ignoring title), so a `deduped` save created nothing new —
    // say so rather than imply a fresh profile appeared.
    const editor = this.state.profileEditor;
    const savedTitle = result.profiles.find((item) => item.id === result.profileId)?.profile.title;
    const notice: { tone: 'error' | 'success'; message: string } = result.deduped
      ? {
          tone: 'error',
          message: savedTitle
            ? `These settings already match the existing profile "${savedTitle}". Change a setting to save a separate profile.`
            : 'These settings already match an existing profile. Change a setting to save a separate profile.'
        }
      : { tone: 'success', message: result.status };
    this.setState({
      profiles: result.profiles,
      editingProfileId: result.profileId,
      profileFocusId: result.profileId,
      busy: false,
      status: result.status,
      profileEditor: editor ? { ...editor, dirty: false, saveNotice: notice } : editor
    });
  }

  private toggleFavoriteProfile(id: string): void {
    const { favoriteProfileIds: favoriteProfiles } = toggleFavoriteProfile({
      favoriteProfileIds: this.state.favoriteProfiles,
      profileId: id
    }, {
      writeFavoriteProfiles: (ids) => writeFavoriteProfiles(ids)
    });
    this.setState({ favoriteProfiles });
  }

  // Reveal/collapse the hidden-profiles section. Hidden profiles are fetched
  // lazily (a separate visibility=hidden query) so the normal list stays lean.
  private async toggleShowHidden(): Promise<void> {
    if (this.state.profilesShowHidden) {
      this.setState({ profilesShowHidden: false });
      return;
    }
    try {
      const hiddenProfiles = await gateway.hiddenProfiles();
      this.setState({ profilesShowHidden: true, hiddenProfiles });
    } catch (err) {
      console.error('[Beanie] Load hidden profiles failed', err);
      this.setState({ status: 'Could not load hidden profiles' });
    }
  }

  private async hideProfile(id: string): Promise<void> {
    try {
      await gateway.setProfileVisibility(id, 'hidden');
      await this.reloadProfileLists('Profile hidden');
    } catch (err) {
      console.error('[Beanie] Hide profile failed', err);
      this.setState({ status: 'Could not hide profile' });
    }
  }

  private async unhideProfile(id: string): Promise<void> {
    try {
      await gateway.setProfileVisibility(id, 'visible');
      await this.reloadProfileLists('Profile restored');
    } catch (err) {
      console.error('[Beanie] Restore profile failed', err);
      this.setState({ status: 'Could not restore profile' });
    }
  }

  // Delete is destructive (no in-app recovery), so confirm via a dialog. Look up
  // the title from whichever list holds the profile (visible or hidden).
  private openDeleteProfile(id: string): void {
    const record =
      this.state.profiles.find((p) => p.id === id) ??
      this.state.hiddenProfiles.find((p) => p.id === id);
    const title = record?.profile.title ?? 'this profile';
    this.setState({ modal: 'delete-profile', profileDeleteTarget: { id, title } });
  }

  private async confirmDeleteProfile(): Promise<void> {
    const target = this.state.profileDeleteTarget;
    if (!target) return;
    this.setState({ modal: null, profileDeleteTarget: null });
    try {
      await gateway.deleteProfile(target.id);
      await this.reloadProfileLists('Profile deleted');
    } catch (err) {
      console.error('[Beanie] Delete profile failed', err);
      this.setState({ status: 'Could not delete profile' });
    }
  }

  // Escape hatch from the delete dialog: hide (reversible) instead of deleting.
  private async hideInsteadOfDelete(): Promise<void> {
    const target = this.state.profileDeleteTarget;
    if (!target) return;
    this.setState({ modal: null, profileDeleteTarget: null });
    await this.hideProfile(target.id);
  }

  // After a visibility/delete mutation, refresh the visible list (and its cache)
  // plus the hidden list when it's on screen.
  private async reloadProfileLists(status: string): Promise<void> {
    await beanieCache.invalidateProfileMutation();
    const profiles = await gateway.profiles();
    await beanieCache.putProfiles(profiles);
    const hiddenProfiles = this.state.profilesShowHidden
      ? await gateway.hiddenProfiles()
      : this.state.hiddenProfiles;
    this.setState({ profiles, hiddenProfiles, status });
  }

  private toggleFavoriteBean(id: string): void {
    const favorites = new Set(this.state.favoriteBeans);
    if (favorites.has(id)) favorites.delete(id);
    else favorites.add(id);
    const favoriteBeans = [...favorites];
    writeFavoriteBeans(favoriteBeans);
    this.setState({ favoriteBeans });
  }

  private async onChange(event: Event): Promise<void> {
    const target = event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    if (target.dataset.action === 'phone-recipe-field') {
      if (isEditField(target.dataset.field)) this.applyPhoneRecipeField(target.dataset.field, target.value);
      return;
    }
    if (target.dataset.action === 'phone-shot-field') {
      if (target.dataset.id && isShotEditField(target.dataset.field)) {
        this.applyPhoneShotField(target.dataset.id, target.dataset.field, target.value);
      }
      return;
    }
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
    if (target.dataset.action === 'settings-display-brightness') {
      await this.setDisplayBrightness(target.value);
      return;
    }
    if (target.dataset.action === 'settings-water-soft') {
      const ml = Number(target.value);
      if (Number.isFinite(ml)) this.updateSettingsPreferences({ waterSoftLimitMl: Math.max(0, ml) });
      return;
    }
    if (target.dataset.action === 'settings-wake-app-zone') {
      const enabled = (target as HTMLInputElement).checked;
      this.updateSettingsPreferences({ wakeAppZoneEnabled: enabled });
      if (enabled) this.previewWakeAppZone(this.state.settingsPreferences.wakeAppZonePosition);
      return;
    }
    if (target.dataset.action === 'settings-machine-refill') {
      const mm = Number(target.value);
      if (Number.isFinite(mm)) await this.setMachineRefillLevel(Math.max(0, mm));
      return;
    }
    if (target.dataset.action === 'no-scale-block-toggle') {
      void this.setNoScaleBlock((target as HTMLInputElement).checked);
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
    if (target.dataset.action === 'scanner-add-photos') {
      const input = target as HTMLInputElement;
      const files = Array.from(input.files ?? []);
      input.value = '';
      if (files.length > 0) void this.addScannerPhotos(files);
      return;
    }
    if (target.dataset.action === 'bean-picker-batch-field') {
      const form = target.closest<HTMLFormElement>('[data-form="bean-picker-batch"]');
      if (form) await this.saveBeanPickerBatch(form);
      return;
    }
    if (target.dataset.action === 'bean-prefill') {
      const select = target as HTMLSelectElement;
      this.prefillBeanForm(select.closest<HTMLFormElement>('form'), select.value);
      select.value = '';
      return;
    }
    const field = target.dataset.field;
    if (!field) return;

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

  private async onFocusOut(event: FocusEvent): Promise<void> {
    if (this.state.modal !== 'bean-picker' || this.state.busy) return;
    const target = event.target as HTMLElement | null;
    const form = target?.closest<HTMLFormElement>('form[data-form="bean-picker-bean"]');
    if (!form || !form.isConnected) return;
    const next = event.relatedTarget instanceof Node ? event.relatedTarget : null;
    if (next && form.contains(next)) return;
    const fields = beanFieldsFromForm(new FormData(form));
    if (!fields.roaster || !fields.name) return;
    await this.submitBeanPickerBean(form);
  }

  private async commitActiveBeanPickerFormBeforeAction(nextEl: HTMLElement): Promise<void> {
    if (this.state.modal !== 'bean-picker' || this.state.busy) return;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const form =
      active?.closest<HTMLFormElement>('form[data-form="bean-picker-bean"]') ??
      this.root.querySelector<HTMLFormElement>('.bean-picker-details.open form[data-form="bean-picker-bean"], .bean-picker-modal.create-mode form[data-form="bean-picker-bean"]');
    if (!form || !form.isConnected || form.contains(nextEl)) return;
    const fields = beanFieldsFromForm(new FormData(form));
    if (!fields.roaster || !fields.name) return;
    await this.submitBeanPickerBean(form);
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
    if (form.dataset.form === 'shot-bean-create') {
      event.preventDefault();
      await this.createShotBean(form);
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
    if (form.dataset.form === 'batch-storage-date') {
      event.preventDefault();
      await this.saveBatchStorageDate(form);
      return;
    }
    if (form.dataset.form === 'grinder-editor') {
      event.preventDefault();
      await this.submitGrinderEditor(form);
      return;
    }
    if (form.dataset.form === 'scanner-onboard') {
      event.preventDefault();
      this.saveScannerKey(form);
      return;
    }
    if (form.dataset.form === 'scanner-review') {
      event.preventDefault();
      await this.submitScannerReview(form);
      return;
    }
  }

  private async submitBeanPickerBean(form: HTMLFormElement): Promise<void> {
    const data = new FormData(form);
    const fields = beanFieldsFromForm(data);
    if (!fields.roaster || !fields.name) return;

    const editingId = form.dataset.id || null;
    this.setState({ busy: true, status: editingId ? 'Saving bean' : 'Adding bean' });

    if (!editingId) {
      const prefillBeanId = String(data.get('prefillBeanId') ?? '');
      const continuingBean = prefillBeanId ? this.state.beans.find((item) => item.id === prefillBeanId) ?? null : null;
      if (continuingBean && beanFieldsUnchanged(fields, continuingBean)) {
        await this.addFirstStockToBean(continuingBean, data, 'Stock added');
        return;
      }
    }

    const result = await this.beanWorkflow.saveBean({
      beans: this.state.beans,
      batchesByBean: this.state.batchesByBean,
      editingId,
      fields,
      demo: this.state.demo,
      nowMs: Date.now()
    }, {
      createBean: (input) => gateway.createBean(input),
      updateBean: (id, input) => gateway.updateBean(id, input),
      putBeans: (beans) => beanieCache.putBeans(beans),
      putBeanBatches: (beanId, batches) => beanieCache.putBeanBatches(beanId, batches)
    });

    if (result.type === 'failed') {
      console.error('[Beanie] Save bean failed', result.error);
      this.setState({ busy: false, status: result.status });
      return;
    }

    if (!editingId) {
      const created = await this.beanWorkflow.createBatch({
        bean: result.bean,
        batchesByBean: result.batchesByBean,
        selectedBeanId: this.state.selectedBeanId,
        selectedBatchId: this.state.selectedBatchId,
        batchInput: batchFieldsFromForm(data, result.bean.id),
        demo: this.state.demo,
        nowMs: Date.now()
      }, {
        createBatch: (beanId, input) => gateway.createBatch(beanId, input),
        putBeanBatches: (beanId, batches) => beanieCache.putBeanBatches(beanId, batches)
      });

      if (created.type === 'failed') {
        console.error('[Beanie] Add first stock failed', created.error);
        this.setState({
          beans: result.beans,
          batchesByBean: result.batchesByBean,
          beanPickerBeanId: result.bean.id,
          beanPickerMode: 'inspect',
          beanPickerEditingBeanId: null,
          beanPickerEditingBatchId: null,
          busy: false,
          status: created.status
        });
        return;
      }

      this.setState({
        beans: result.beans,
        batchesByBean: created.batchesByBean,
        selectedBatchId: created.selectedBatchId,
        beanPickerBeanId: result.bean.id,
        beanPickerMode: 'inspect',
        beanPickerEditingBeanId: null,
        beanPickerEditingBatchId: null,
        formNumbers: omitKeys(this.state.formNumbers, [createStockFormKey('weight'), createStockFormKey('weightRemaining')]),
        busy: false,
        status: this.state.demo ? 'Bean and stock added (demo)' : 'Bean and stock added'
      });
      return;
    }

    this.setState({
      beans: result.beans,
      batchesByBean: result.batchesByBean,
      beanPickerBeanId: result.bean.id,
      beanPickerMode: 'inspect',
      beanPickerEditingBeanId: editingId ? this.state.beanPickerEditingBeanId : null,
      beanPickerEditingBatchId: null,
      busy: false,
      status: result.status
    });
  }

  private async addFirstStockToBean(bean: Bean, data: FormData, status: string): Promise<void> {
    const nowMs = Date.now();
    const result = await this.beanWorkflow.createBatch({
      bean,
      batchesByBean: this.state.batchesByBean,
      selectedBeanId: this.state.selectedBeanId,
      selectedBatchId: this.state.selectedBatchId,
      batchInput: batchFieldsFromForm(data, bean.id),
      demo: this.state.demo,
      nowMs
    }, {
      createBatch: (beanId, input) => gateway.createBatch(beanId, input),
      putBeanBatches: (beanId, batches) => beanieCache.putBeanBatches(beanId, batches)
    });

    if (result.type === 'failed') {
      console.error('[Beanie] Add stock to existing bean failed', result.error);
      this.setState({ busy: false, status: result.status });
      return;
    }

    const beans = promoteBean(this.state.beans, bean.id);
    void beanieCache.putBeans(beans).catch(() => {});
    this.setState({
      beans,
      batchesByBean: result.batchesByBean,
      selectedBatchId: result.selectedBatchId,
      beanUsageAt: { ...this.state.beanUsageAt, [bean.id]: nowMs },
      beanPickerBeanId: bean.id,
      beanPickerMode: 'inspect',
      beanPickerDraftBatchBeanId: null,
      beanPickerEditingBeanId: null,
      beanPickerEditingBatchId: null,
      formNumbers: omitKeys(this.state.formNumbers, [createStockFormKey('weight'), createStockFormKey('weightRemaining')]),
      busy: false,
      status: this.state.demo ? `${status} (demo)` : status
    });
  }

  private async archiveBean(id: string): Promise<void> {
    if (!window.confirm('Delete this coffee? It will be hidden from the bean list.')) return;
    this.setState({ busy: true, status: 'Deleting coffee' });
    const result = await this.beanWorkflow.archiveBean({
      beans: this.state.beans,
      id,
      selectedBeanId: this.state.selectedBeanId,
      demo: this.state.demo
    }, {
      updateBean: (beanId, fields) => gateway.updateBean(beanId, fields),
      invalidateBeanMutation: (beanId) => beanieCache.invalidateBeanMutation(beanId),
      putBeans: (beans) => beanieCache.putBeans(beans)
    });

    if (result.type === 'failed') {
      console.error('[Beanie] Delete bean failed', result.error);
      this.setState({ busy: false, status: result.status });
      return;
    }

    // Deleting from the bean picker should leave the user in the picker, landing
    // on a neighbouring coffee, rather than dropping back to the workbench.
    const inPicker = this.state.modal === 'bean-picker';
    const prevIndex = this.state.beans.findIndex((bean) => bean.id === id);
    const nextFocusId = inPicker
      ? result.beans[prevIndex]?.id ?? result.beans[prevIndex - 1]?.id ?? result.beans[0]?.id ?? null
      : this.state.beanPickerBeanId;
    this.setState({
      beans: result.beans,
      view: inPicker ? this.state.view : 'workbench',
      modal: inPicker ? 'bean-picker' : this.state.modal === 'bean-picker' ? null : this.state.modal,
      beanPickerBeanId: inPicker ? nextFocusId : this.state.beanPickerBeanId,
      beanPickerMode: inPicker && !nextFocusId ? 'create' : this.state.beanPickerMode,
      beanPickerEditingBeanId: null,
      beanPickerEditingBatchId: null,
      busy: false,
      status: result.status
    });
    if (result.archivedSelectedBean) {
      if (result.nextSelectedBeanId) await this.selectBean(result.nextSelectedBeanId, { apply: false, preferWorkflow: false });
      else this.setState({ selectedBeanId: null });
    }
  }

  private startBatchDraftInPicker(beanId: string | null): void {
    if (!beanId) return;
    const bean = this.state.beans.find((item) => item.id === beanId);
    if (!bean) return;
    const current = this.state.batchesByBean[bean.id] ?? [];
    const latest = latestBatch(current);
    const weightKey = newStockFormKey(bean.id, 'weight');
    const remainingKey = newStockFormKey(bean.id, 'weightRemaining');
    const weight = inputValue(latest?.weight ?? 250);
    this.setState({
      beanPickerBeanId: bean.id,
      beanPickerMode: 'inspect',
      beanPickerDraftBatchBeanId: bean.id,
      beanPickerEditingBatchId: null,
      formNumbers: {
        ...this.state.formNumbers,
        [weightKey]: this.state.formNumbers[weightKey] ?? weight,
        [remainingKey]: this.state.formNumbers[remainingKey] ?? weight
      },
      status: 'Adding stock'
    });
  }

  private async selectBatchFromPicker(beanId: string, batchId: string): Promise<void> {
    await this.ensureBatchesLoaded(beanId);
    const bean = this.state.beans.find((item) => item.id === beanId);
    const batch = bean ? (this.state.batchesByBean[bean.id] ?? []).find((item) => item.id === batchId) : null;
    if (!bean || !batch || isFinishedBatch(batch)) return;
    this.completeSecondTapHint('bean');
    // Selecting a bag to brew keeps the picker open so you can keep managing bags;
    // it just marks this bag as the one in use.
    this.setState({ secondTapHint: null });
    await this.selectBean(bean.id, { apply: true, preferWorkflow: false, preferredBatchId: batch.id });
  }

  private cancelBatchDraft(): void {
    const beanId = this.state.beanPickerDraftBatchBeanId;
    if (!beanId) return;
    this.setState({
      beanPickerDraftBatchBeanId: null,
      formNumbers: omitKeys(this.state.formNumbers, [
        newStockFormKey(beanId, 'weight'),
        newStockFormKey(beanId, 'weightRemaining')
      ]),
      status: 'Stock draft cancelled'
    });
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
    const batchInput = batchFieldsFromForm(new FormData(form), bean.id, previous);
    const optimistic = this.beanWorkflow.beginBatchUpdate({
      bean,
      batchesByBean: this.state.batchesByBean,
      selectedBeanId: this.state.selectedBeanId,
      batchId,
      batchInput,
      demo: this.state.demo
    });
    if (optimistic.type !== 'optimistic') return;

    this.setState({
      batchesByBean: optimistic.batchesByBean,
      status: optimistic.status
    });
    if (optimistic.shouldScheduleApply) this.scheduleApply();
    if (optimistic.complete) return;

    const result = await this.beanWorkflow.finishBatchUpdate({
      bean,
      batchId,
      batchInput,
      latestBatchesByBean: this.state.batchesByBean,
      previousBatches: optimistic.previousBatches
    }, {
      updateBatch: (id, input) => gateway.updateBatch(id, input),
      putBeanBatches: (ownerId, batches) => beanieCache.putBeanBatches(ownerId, batches)
    });

    if (result.type === 'failed') {
      console.error('[Beanie] Save batch failed', result.error);
    }
    this.setState({
      batchesByBean: result.batchesByBean,
      status: result.status
    });
  }

  private async saveBeanPickerBatchValue(
    beanId: string,
    batchId: string,
    name: string,
    value: string
  ): Promise<void> {
    const bean = this.state.beans.find((item) => item.id === beanId);
    if (!bean) return;
    const current = this.state.batchesByBean[bean.id] ?? [];
    const previous = current.find((item) => item.id === batchId);
    if (!previous) return;
    const nextValue = numberOrNullInput(value);
    const batchInput: Partial<BeanBatch> = {
      beanId: bean.id,
      roastDate: previous.roastDate,
      roastLevel: previous.roastLevel,
      weight: previous.weight,
      weightRemaining: previous.weightRemaining,
      storageEvents: previous.storageEvents ?? null,
      frozen: previous.frozen
    };
    if (name === 'weight') batchInput.weight = nextValue;
    if (name === 'weightRemaining') batchInput.weightRemaining = nextValue;
    // Keep "left" within the bag size whether the bag or the remaining changed.
    batchInput.weightRemaining = clampRemainingToWeight(batchInput.weightRemaining ?? null, batchInput.weight ?? null);
    const optimistic = this.beanWorkflow.beginBatchUpdate({
      bean,
      batchesByBean: this.state.batchesByBean,
      selectedBeanId: this.state.selectedBeanId,
      batchId,
      batchInput,
      demo: this.state.demo
    });
    if (optimistic.type !== 'optimistic') return;

    this.setState({
      batchesByBean: optimistic.batchesByBean,
      status: optimistic.status
    });
    if (optimistic.shouldScheduleApply) this.scheduleApply();
    if (optimistic.complete) return;

    const result = await this.beanWorkflow.finishBatchUpdate({
      bean,
      batchId,
      batchInput,
      latestBatchesByBean: this.state.batchesByBean,
      previousBatches: optimistic.previousBatches
    }, {
      updateBatch: (id, input) => gateway.updateBatch(id, input),
      putBeanBatches: (ownerId, batches) => beanieCache.putBeanBatches(ownerId, batches)
    });

    if (result.type === 'failed') {
      console.error('[Beanie] Save batch failed', result.error);
    }
    this.setState({
      batchesByBean: result.batchesByBean,
      status: result.status
    });
  }

  private batchStorageSelection(): { bean: Bean; batch: BeanBatch } | null {
    const target = this.state.batchStorageTarget;
    if (!target) return null;
    const bean = this.state.beans.find((item) => item.id === target.beanId);
    const batch = bean ? (this.state.batchesByBean[bean.id] ?? []).find((item) => item.id === target.batchId) : null;
    return bean && batch ? { bean, batch } : null;
  }

  private async saveBatchStorageEvent(
    type: 'frozen' | 'thawed',
    target: { beanId: string; batchId: string } | null = null
  ): Promise<void> {
    const selection = target ? this.batchAndBeanByIds(target.beanId, target.batchId) : this.batchStorageSelection();
    if (!selection) return;
    const batchInput = {
      beanId: selection.bean.id,
      ...appendBatchStorageEvent(selection.batch, type, new Date())
    };
    await this.saveBatchStoragePatch(selection.bean, selection.batch.id, batchInput, type === 'frozen' ? 'Bag frozen' : 'Bag moved to shelf');
  }

  private batchAndBeanByIds(beanId: string, batchId: string): { bean: Bean; batch: BeanBatch } | null {
    const bean = this.state.beans.find((item) => item.id === beanId);
    const batch = bean ? (this.state.batchesByBean[bean.id] ?? []).find((item) => item.id === batchId) : null;
    return bean && batch ? { bean, batch } : null;
  }

  private async saveBatchStorageDate(form: HTMLFormElement): Promise<void> {
    const selection = this.batchStorageSelection();
    if (!selection) return;
    const data = new FormData(form);
    const eventType = data.get('type') === 'thawed' ? 'thawed' : 'frozen';
    const existingEvents = batchStorageEvents(selection.batch);
    const atValue = String(data.get('at') ?? '');
    if (existingEvents.length === 0) {
      const at = new Date(atValue);
      if (Number.isNaN(at.valueOf())) {
        this.setState({ status: 'Choose a valid date' });
        return;
      }
      const batchInput = {
        beanId: selection.bean.id,
        ...appendBatchStorageEvent(selection.batch, eventType, at)
      };
      await this.saveBatchStoragePatch(selection.bean, selection.batch.id, batchInput, eventType === 'frozen' ? 'Freeze date saved' : 'Thaw date saved');
      return;
    }
    const batchInput = {
      beanId: selection.bean.id,
      ...editLastBatchStorageEventDate(selection.batch, atValue, new Date())
    };
    if (!batchInput.storageEvents) return;
    await this.saveBatchStoragePatch(selection.bean, selection.batch.id, batchInput, eventType === 'frozen' ? 'Freeze date saved' : 'Thaw date saved');
  }

  private async freezeStock(beanId: string, batchId: string): Promise<void> {
    const selection = this.batchAndBeanByIds(beanId, batchId);
    if (!selection) return;
    const formKey = freezeAmountFormKey(batchId);
    const remaining = positiveNumber(selection.batch.weightRemaining);
    const amountRaw = numberOrNullInput(this.state.formNumbers[formKey] ?? null);
    // The form holds how much goes into the freezer; unset means the whole bag.
    const freezeAmount = remaining == null
      ? 0
      : amountRaw == null
        ? remaining
        : Math.min(Math.max(amountRaw, 0), remaining);
    const keep = remaining == null ? 0 : Math.max(0, round(remaining - freezeAmount, 1));

    if (remaining == null || keep <= 0) {
      const batchInput = {
        beanId: selection.bean.id,
        ...appendBatchStorageEvent(selection.batch, 'frozen', new Date())
      };
      this.setState({
        beanPickerFreezeBatchId: null,
        formNumbers: omitKey(this.state.formNumbers, formKey)
      });
      await this.saveBatchStoragePatch(selection.bean, selection.batch.id, batchInput, 'Bag frozen');
      return;
    }

    const portionWeight = round(remaining - keep, 1);
    if (portionWeight <= 0) {
      this.setState({ status: 'Nothing left to freeze' });
      return;
    }
    const frozenEvent = appendBatchStorageEvent(selection.batch, 'frozen', new Date());
    const frozenBatch: Partial<BeanBatch> = {
      beanId: selection.bean.id,
      roastDate: selection.batch.roastDate ?? null,
      roastLevel: selection.batch.roastLevel ?? null,
      weight: portionWeight,
      weightRemaining: portionWeight,
      storageEvents: frozenEvent.storageEvents ?? null,
      frozen: true
    };
    const parentUpdate: Partial<BeanBatch> = {
      beanId: selection.bean.id,
      roastDate: selection.batch.roastDate ?? null,
      roastLevel: selection.batch.roastLevel ?? null,
      weight: selection.batch.weight ?? null,
      weightRemaining: keep,
      storageEvents: selection.batch.storageEvents ?? null,
      frozen: selection.batch.frozen ?? false
    };

    this.setState({ status: 'Freezing stock' });
    try {
      const current = this.state.batchesByBean[selection.bean.id] ?? [];
      if (this.state.demo) {
        const created = { id: `demo-batch-${Date.now()}`, ...frozenBatch } as BeanBatch;
        const batches = [created, ...current.map((batch) =>
          batch.id === selection.batch.id ? { ...batch, ...parentUpdate } : batch
        )];
        this.setState({
          batchesByBean: { ...this.state.batchesByBean, [selection.bean.id]: batches },
          formNumbers: omitKey(this.state.formNumbers, formKey),
          beanPickerFreezeBatchId: null,
          status: `Froze ${portionWeight}g (demo)`
        });
        return;
      }

      // The batches POST endpoint persists weights but drops storage state, so the
      // new portion comes back unfrozen. Set its frozen state with a follow-up update.
      const createdRaw = await gateway.createBatch(selection.bean.id, frozenBatch);
      const created = await gateway.updateBatch(createdRaw.id, {
        beanId: selection.bean.id,
        storageEvents: frozenBatch.storageEvents ?? null,
        frozen: true
      });
      const savedParent = await gateway.updateBatch(selection.batch.id, parentUpdate);
      const latest = this.state.batchesByBean[selection.bean.id] ?? current;
      const batches = [created, ...latest.map((batch) => (batch.id === selection.batch.id ? savedParent : batch))];
      await beanieCache.putBeanBatches(selection.bean.id, batches).catch(() => {});
      this.setState({
        batchesByBean: { ...this.state.batchesByBean, [selection.bean.id]: batches },
        formNumbers: omitKey(this.state.formNumbers, formKey),
        beanPickerFreezeBatchId: null,
        status: `Froze ${portionWeight}g`
      });
    } catch (error) {
      console.error('[Beanie] Freeze stock failed', error);
      this.setState({ status: 'Freeze stock failed' });
    }
  }

  private async saveBatchStoragePatch(
    bean: Bean,
    batchId: string,
    batchInput: Partial<BeanBatch>,
    status: string
  ): Promise<void> {
    const optimistic = this.beanWorkflow.beginBatchUpdate({
      bean,
      batchesByBean: this.state.batchesByBean,
      selectedBeanId: this.state.selectedBeanId,
      batchId,
      batchInput,
      demo: this.state.demo
    });
    if (optimistic.type !== 'optimistic') return;

    this.setState({
      batchesByBean: optimistic.batchesByBean,
      status
    });
    if (optimistic.shouldScheduleApply) this.scheduleApply();
    if (optimistic.complete) return;

    const result = await this.beanWorkflow.finishBatchUpdate({
      bean,
      batchId,
      batchInput,
      latestBatchesByBean: this.state.batchesByBean,
      previousBatches: optimistic.previousBatches
    }, {
      updateBatch: (id, input) => gateway.updateBatch(id, input),
      putBeanBatches: (ownerId, batches) => beanieCache.putBeanBatches(ownerId, batches)
    });

    if (result.type === 'failed') {
      console.error('[Beanie] Save storage failed', result.error);
    }
    this.setState({
      batchesByBean: result.batchesByBean,
      status: result.type === 'failed' ? result.status : status
    });
  }

  private async finishBatchFromPicker(beanId: string | null, batchId: string): Promise<void> {
    if (!beanId) return;
    const bean = this.state.beans.find((item) => item.id === beanId);
    if (!bean) return;
    const current = this.state.batchesByBean[bean.id] ?? [];
    const batch = current.find((item) => item.id === batchId);
    if (!batch) return;
    if (isFinishedBatch(batch)) return;

    const batchInput: Partial<BeanBatch> = {
      beanId: bean.id,
      roastDate: batch.roastDate ?? null,
      roastLevel: batch.roastLevel ?? null,
      weight: batch.weight ?? null,
      weightRemaining: 0,
      storageEvents: batch.storageEvents ?? null,
      frozen: batch.frozen
    };
    const optimistic = this.beanWorkflow.beginBatchUpdate({
      bean,
      batchesByBean: this.state.batchesByBean,
      selectedBeanId: this.state.selectedBeanId,
      batchId,
      batchInput,
      demo: this.state.demo
    });
    if (optimistic.type !== 'optimistic') return;

    const finishingSelected =
      bean.id === this.state.selectedBeanId &&
      (this.state.selectedBatchId === batchId || (!this.state.selectedBatchId && latestBatch(current.filter(isUsableBatch))?.id === batchId));
    const nextSelectedBatchId = finishingSelected
      ? latestBatch(optimistic.optimisticBatches.filter(isUsableBatch))?.id ?? null
      : this.state.selectedBatchId;

    this.setState({
      batchesByBean: optimistic.batchesByBean,
      selectedBatchId: nextSelectedBatchId,
      beanPickerEditingBatchId: this.state.beanPickerEditingBatchId === batchId ? null : this.state.beanPickerEditingBatchId,
      status: 'Bag finished'
    });
    if (finishingSelected) this.scheduleApply();
    if (optimistic.complete) return;

    const result = await this.beanWorkflow.finishBatchUpdate({
      bean,
      batchId,
      batchInput,
      latestBatchesByBean: this.state.batchesByBean,
      previousBatches: optimistic.previousBatches
    }, {
      updateBatch: (id, input) => gateway.updateBatch(id, input),
      putBeanBatches: (ownerId, batches) => beanieCache.putBeanBatches(ownerId, batches)
    });

    if (result.type === 'failed') {
      console.error('[Beanie] Finish batch failed', result.error);
      this.setState({ batchesByBean: result.batchesByBean, status: result.status });
      return;
    }
    this.setState({
      batchesByBean: result.batchesByBean,
      selectedBatchId: nextSelectedBatchId,
      status: 'Bag finished'
    });
  }

  private async submitBeanPickerBatch(form: HTMLFormElement): Promise<void> {
    const beanId = form.dataset.beanId;
    if (!beanId) return;
    const bean = this.state.beans.find((item) => item.id === beanId);
    if (!bean) return;
    const batchId = form.dataset.batchId || null;
    const previous = batchId
      ? (this.state.batchesByBean[bean.id] ?? []).find((item) => item.id === batchId)
      : undefined;
    const batchInput = batchFieldsFromForm(new FormData(form), bean.id, previous);

    this.setState({ busy: true, status: batchId ? 'Saving stock' : 'Adding stock' });
    if (!batchId) {
      const result = await this.beanWorkflow.createBatch({
        bean,
        batchesByBean: this.state.batchesByBean,
        selectedBeanId: this.state.selectedBeanId,
        selectedBatchId: this.state.selectedBatchId,
        batchInput,
        demo: this.state.demo,
        nowMs: Date.now()
      }, {
        createBatch: (beanId, input) => gateway.createBatch(beanId, input),
        putBeanBatches: (beanId, batches) => beanieCache.putBeanBatches(beanId, batches)
      });

      if (result.type === 'failed') {
        console.error('[Beanie] Save batch failed', result.error);
        this.setState({ busy: false, status: result.status });
        return;
      }

      this.setState({
        batchesByBean: result.batchesByBean,
        selectedBatchId: result.selectedBatchId,
        beanPickerDraftBatchBeanId: null,
        beanPickerEditingBatchId: null,
        formNumbers: omitKeys(this.state.formNumbers, [
          newStockFormKey(bean.id, 'weight'),
          newStockFormKey(bean.id, 'weightRemaining')
        ]),
        busy: false,
        status: result.status
      });
      return;
    }

    const optimistic = this.beanWorkflow.beginBatchUpdate({
      bean,
      batchesByBean: this.state.batchesByBean,
      selectedBeanId: this.state.selectedBeanId,
      batchId,
      batchInput,
      demo: this.state.demo
    });
    if (optimistic.type !== 'optimistic') {
      this.setState({ busy: false });
      return;
    }

    this.setState({
      batchesByBean: optimistic.batchesByBean,
      selectedBatchId: this.state.selectedBatchId,
      busy: false,
      status: optimistic.status
    });
    if (optimistic.complete) return;

    const result = await this.beanWorkflow.finishBatchUpdate({
      bean,
      batchId,
      batchInput,
      latestBatchesByBean: this.state.batchesByBean,
      previousBatches: optimistic.previousBatches
    }, {
      updateBatch: (id, input) => gateway.updateBatch(id, input),
      putBeanBatches: (ownerId, batches) => beanieCache.putBeanBatches(ownerId, batches)
    });

    if (result.type === 'failed') {
      console.error('[Beanie] Save batch failed', result.error);
    }
    this.setState({
      batchesByBean: result.batchesByBean,
      selectedBatchId: this.state.selectedBatchId,
      status: result.status
    });
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

    const result = await this.beanWorkflow.saveGrinder({
      grinders: this.state.grinders,
      editingId,
      grinderInput,
      demo: this.state.demo,
      nowMs: Date.now()
    }, {
      createGrinder: (input) => gateway.createGrinder(input),
      updateGrinder: (id, input) => gateway.updateGrinder(id, input),
      putGrinders: (grinders) => beanieCache.putGrinders(grinders)
    });

    if (result.type === 'failed') {
      console.error('[Beanie] Save grinder failed', result.error);
      this.setState({ busy: false, status: result.status });
      return;
    }

    this.setState({
      grinders: result.grinders,
      draft: { ...this.state.draft, grinderId: result.grinder.id, grinderModel: result.grinder.model },
      view: 'workbench',
      editingGrinderId: null,
      editDialog: null,
      busy: false,
      status: result.status
    });
    this.scheduleApply();
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
      const nextYield = yieldForRatio(draft.dose, round(current + delta, 1));
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
              ? ratioFor(draft.dose, draft.yield)?.toFixed(1) ?? ''
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

  private applyPhoneRecipeField(field: EditField, rawValue: string): void {
    const draft = { ...this.state.draft };
    if (field === 'dose') draft.dose = parseNumberInput(rawValue);
    if (field === 'yield') draft.yield = parseNumberInput(rawValue);
    if (field === 'grinderSetting') draft.grinderSetting = rawValue.trim() || null;
    if (field === 'ratio') {
      const ratio = parseNumberInput(rawValue);
      const nextYield = ratio == null ? null : yieldForRatio(draft.dose, ratio);
      if (nextYield != null) draft.yield = nextYield;
    }
    if (field === 'temperature') draft.brewTemp = parseNumberInput(rawValue);
    this.setState({ draft, status: 'Draft changed' });
    this.scheduleApply();
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

  private openNumberEditDialog(el: HTMLElement): void {
    const target = el.dataset.target as NumberEditTarget['target'] | undefined;
    if (!target) return;
    const value = el.dataset.value ?? '';
    const title = el.dataset.title ?? 'Value';
    const unit = el.dataset.unit ?? '';
    const min = Number(el.dataset.min ?? '0');
    const max = Number(el.dataset.max ?? '9999');
    const step = Number(el.dataset.step ?? '1');
    const digits = step < 1 ? Math.min(2, decimalPlaces(step)) : 0;
    const returnModal = el.dataset.returnModal as Modal | undefined;

    this.setState({
      modal: 'edit-number',
      profileEdit: null,
      machineEdit: null,
      machineLabelEdit: null,
      numberEdit: {
        target,
        group: el.dataset.group,
        key: el.dataset.key,
        beanId: el.dataset.beanId,
        batchId: el.dataset.batchId,
        name: el.dataset.name,
        formKey: el.dataset.formKey,
        field: isShotEditField(el.dataset.field) ? el.dataset.field : undefined,
        returnModal
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
        maxLength: 8,
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
    const plan = applyMachinePresetPlan({
      name,
      presetId,
      machinePresetValues: this.state.machinePresetValues,
      capabilities: this.machineCapabilitiesForControls(),
      steamSettings: this.currentSteamSettings(),
      hotWaterData: this.currentHotWaterData(),
      rinseData: this.currentRinseData()
    });
    if (!plan.applied) return;
    // Remember which button the user actually tapped, so the highlight is
    // restored verbatim on the next load instead of being re-guessed from the
    // machine's stored values (which drifts to 'custom'). `name` is the lane id
    // ('steamPreset' | 'waterPreset' | 'flushPreset'), already validated by the
    // plan above.
    const selection = { ...this.state.machinePresetSelection, [name]: presetId };
    writeMachinePresetSelection(selection);
    this.setState({ machinePresetSelection: selection });
    await this.setMachineWorkflow(plan.steamSettings, plan.hotWaterData, plan.rinseData, plan.status);
  }

  private async applyMachineValue(name: string, value: number | null): Promise<void> {
    const plan = applyMachineValuePlan({
      name,
      value,
      machinePresetValues: this.state.machinePresetValues,
      capabilities: this.machineCapabilitiesForControls(),
      steamSettings: this.currentSteamSettings(),
      hotWaterData: this.currentHotWaterData(),
      rinseData: this.currentRinseData()
    });
    if (!plan.applied) return;
    if (plan.machinePresetValues) {
      writeMachinePresetValues(plan.machinePresetValues);
      this.setState({ machinePresetValues: plan.machinePresetValues });
    }
    await this.setMachineWorkflow(plan.steamSettings, plan.hotWaterData, plan.rinseData, plan.status);
  }

  private async setSteamPurgeMode(mode: number): Promise<void> {
    const plan = steamPurgeModePlan(mode, this.state.machineSettings, this.state.settingsBundle);

    this.setState({
      machineSettings: plan.machineSettings,
      settingsBundle: plan.settingsBundle,
      busy: true,
      status: plan.savingStatus
    });
    if (this.settingsLocal) {
      this.setState({ busy: false, status: plan.demoStatus });
      return;
    }

    try {
      const verifiedMachineSettings = await updateSteamPurgeModeAndReadBack(plan.nextMode, {
        updateMachineSettings: (patch) => gateway.updateMachineSettings(patch),
        readMachineSettings: () => gateway.machineSettings()
      });
      this.setState({
        machineSettings: verifiedMachineSettings,
        busy: false,
        status: plan.successStatus
      });
    } catch (error) {
      console.error('[Beanie] Save steam purge setting failed', error);
      this.setState({ busy: false, status: plan.failedStatus });
      void this.loadMachineControlState();
    }
  }

  private async setHotWaterStopMode(mode: HotWaterStopMode): Promise<void> {
    writeHotWaterStopMode(mode);
    this.setState({
      hotWaterStopMode: mode,
      status: mode === 'time' ? 'Water stops by time' : 'Water stops by weight when scale is connected'
    });
    await this.setMachineWorkflow(
      this.currentSteamSettings(),
      this.currentHotWaterData(),
      this.currentRinseData(),
      'Water stop mode saved'
    );
  }

  private async setMachineWorkflow(
    steamSettings: SteamSettings,
    hotWaterData: HotWaterData,
    rinseData: RinseData,
    status: string
  ): Promise<void> {
    const plan = buildMachineWorkflowPlan({
      workflow: this.state.workflow,
      steamSettings,
      hotWaterData,
      rinseData,
      currentMachineSettings: this.state.machineSettings,
      hotWaterStopMode: this.state.hotWaterStopMode,
      status
    });
    this.setState({
      workflow: plan.workflow,
      machineSettings: plan.machineSettings,
      busy: true,
      status: plan.savingStatus
    });
    const result = await persistMachineWorkflowPlan(plan, this.state.demo, {
      writeHotWaterWeightTarget: (value) => writeHotWaterWeightTarget(value),
      updateWorkflow: (workflow) => gateway.updateWorkflow(workflow),
      updateMachineSettings: (patch) => gateway.updateMachineSettings(patch),
      logDirectMachineUpdateFailure: (error) => {
        console.error('[Beanie] Direct machine settings update failed', error);
      }
    });
    if (result.type === 'demo') {
      this.setState({ busy: false, status: result.status });
      return;
    }
    if (result.type === 'saved') {
      this.setState({
        workflow: result.workflow,
        machineSettings: plan.machineSettings,
        busy: false,
        status: result.status
      });
      if (result.directMachineSaved) void this.loadMachineControlState();
      return;
    }
    console.error('[Beanie] Save machine settings failed', result.error);
    this.setState({ busy: false, status: result.status });
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
    const values = this.state.workflow?.hotWaterData
      ? hotWaterValues(this.state.workflow, null)
      : hotWaterValues(this.state.workflow, this.state.machineSettings);
    // Time mode zeroes the volume sent to the gateway (so the DE1 stops on time
    // and reaprime's stop-at-weight stays inert). Restore the user's saved
    // volume/weight target so it survives a reload and a switch back to Weight mode.
    const savedTarget = readHotWaterWeightTarget();
    const volume = values.volume;
    if (savedTarget != null && !(typeof volume === 'number' && volume > 0)) {
      return { ...values, volume: savedTarget };
    }
    return values;
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
    if (edit.target === 'meta' && edit.key != null) {
      return setProfileMeta(pe, edit.key as ProfileMetaKey, value);
    }
    if (edit.target === 'limiter-range') {
      return setAllLimiterRanges(pe, Number(value) || 0);
    }
    return pe;
  }

  private async applyNumberEdit(edit: NumberEditTarget, value: string): Promise<void> {
    if (edit.target === 'settings-field' && edit.group && edit.key) {
      await this.onSettingsField(edit.group, edit.key, value);
      return;
    }
    if (edit.target === 'settings-plugin-field' && edit.key) {
      this.updatePluginField(edit.key, value);
      return;
    }
    if (edit.target === 'display-brightness') {
      await this.setDisplayBrightness(value);
      return;
    }
    if (edit.target === 'flow-calibration') {
      this.setFlowCalibrationDraft(Number(value));
      return;
    }
    if (edit.target === 'water-soft') {
      const ml = Number(value);
      if (Number.isFinite(ml)) this.updateSettingsPreferences({ waterSoftLimitMl: Math.max(0, ml) });
      return;
    }
    if (edit.target === 'machine-refill') {
      const mm = Number(value);
      if (Number.isFinite(mm)) await this.setMachineRefillLevel(Math.max(0, mm));
      return;
    }
    if (edit.target === 'bean-picker-batch' && edit.beanId && edit.batchId && edit.name) {
      await this.saveBeanPickerBatchValue(edit.beanId, edit.batchId, edit.name, value);
      return;
    }
    if (edit.target === 'form-field' && edit.formKey) {
      this.setState({
        formNumbers: { ...this.state.formNumbers, [edit.formKey]: value }
      });
    }
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

    const numberEdit = this.state.numberEdit;
    if (numberEdit) {
      const returnModal = numberEdit.returnModal ?? null;
      if (numberEdit.target === 'shot-edit' && numberEdit.field) {
        const shotEdit = this.state.shotEdit
          ? updateShotEditDraftField(this.state.shotEdit, numberEdit.field, value, this.state.grinders)
          : null;
        this.setState({
          modal: returnModal,
          editDialog: null,
          numberEdit: null,
          shotEdit,
          status: 'Shot changed'
        });
        return;
      }

      this.setState({
        modal: returnModal,
        editDialog: null,
        numberEdit: null,
        status: 'Value changed'
      });
      await this.applyNumberEdit(numberEdit, value);
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
    if (!this.state.settingsLoaded) {
      this.root.innerHTML = `
        <div class="app-shell">
          <div class="settings-boot">
            <div class="settings-boot-spinner"></div>
            <p>Loading settings…</p>
          </div>
        </div>
      `;
      return;
    }
    const bean = this.selectedBean();
    const focus = this.captureFocus();
    const scroll = this.captureScroll();
    const isPhone = this.isPhoneLayout();
    const renderPhone = isPhone && (this.state.view === 'workbench' || this.state.view === 'settings');
    const isPage = this.state.view !== 'workbench' && !renderPhone;
    this.root.innerHTML = `
      <div class="app-shell ${renderPhone ? 'app-shell-phone' : isPage ? 'app-shell-page' : ''}">
        ${renderPhone ? this.renderPhoneApp(bean) : isPage ? this.renderPage() : this.renderWorkbench(bean)}
        ${this.renderLivePanel()}
        ${this.renderModal()}
        ${isPage ? '' : this.renderWaterAlert()}
        ${this.renderWaterWarningBanner()}
        ${this.renderSleepOverlay()}
        ${this.renderWakeAppZonePreview()}
        ${this.renderStoreErrorOverlay()}
      </div>
    `;
    refreshIcons();
    this.bindLiveElements();
    this.bindDetailChart();
    this.bindCalibratorChart();
    this.restoreFocus(focus);
    this.restoreScroll(scroll);
  }

  private isPhoneLayout(): boolean {
    return this.phoneMedia?.matches === true;
  }

  private renderPhoneApp(bean: Bean | null): string {
    const brewTemp = this.brewTempValue();
    const selectedShot = this.state.detailShotId ? this.selectedHistoryShot() : null;
    const selectedShotDraft = selectedShot
      ? this.state.shotEdit?.shotId === selectedShot.id
        ? this.state.shotEdit
        : shotEditDraftFromShot(selectedShot)
      : null;
    const settingsHtml = this.state.phoneTab === 'settings'
      ? renderSettingsShell(
          this.settingsShellModel(),
          this.state.settingsSection,
          this.state.settingsBundle,
          this.state.pluginConfig,
          this.decentAccountPanelState(),
          ['app', 'brew', 'machine', 'power', 'account', 'plugins', 'connection', 'danger'],
          { phone: true, flowCalibration: this.flowCalibrationDisplay() }
        )
      : '';
    return renderPhoneShell({
      activeTab: this.state.phoneTab,
      status: this.state.status,
      machineStatus: this.machineStatusLabel(),
      asleep: this.state.asleep,
      selectedBean: bean,
      selectedBatch: this.selectedBatch(),
      batchesByBean: this.state.batchesByBean,
      beans: this.sortedBeansForPicker(),
      beanSearch: this.state.search,
      shotSearch: this.state.shotSearch,
      favoriteBeanIds: this.state.favoriteBeans,
      averageDoseIn: this.averageDoseIn(),
      applyState: this.state.applyState,
      shots: this.state.shots,
      selectedShot,
      selectedShotDraft,
      selectedShotDirty: Boolean(selectedShot && this.state.shotEdit?.shotId === selectedShot.id),
      shotsTotal: this.state.shotsTotal,
      shotsLoadingMore: this.state.shotsLoadingMore,
      demo: this.state.demo,
      draft: this.state.draft,
      ratioLabel: formatRatio(ratioFor(this.state.draft.dose, this.state.draft.yield)),
      brewTempLabel: brewTemp == null ? '--' : brewTemp.toFixed(1),
      settingsHtml
    });
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
    const draft = this.state.draft;
    const brewTemp = this.brewTempValue();
    const waterAlert = this.currentWaterAlert();
    const waterTone = waterAlert === 'hard' ? 'stat-alert' : waterAlert === 'soft' ? 'stat-warn' : '';
    const cleaningDueNow = cleaningDue(this.state.cleaning, this.state.cleaningThreshold);
    const scale = this.state.scale;
    return renderWorkbenchView({
      topbar: {
        machineStatus: this.machineStatusLabel(),
        machineTone: this.state.gatewayLinkDown && !this.state.demo ? 'stat-alert' : '',
        groupTemperature: temp(this.state.machine?.groupTemperature),
        steamTemperature: temp(this.state.machine?.steamTemperature),
        water: water(this.state.waterLevel),
        waterTone,
        scale: {
          label: scaleStatLabel(scale),
          title: scaleStatTitle(scale),
          tone: scaleBatteryLow(scale) ? 'stat-warn' : ''
        },
        machineCommands: {
          available: machineCommandsAvailable(this.state.demo, this.state.machineInfo),
          current: this.state.machine?.state?.state ?? 'idle',
          busy: this.state.busy
        },
        cleaningDue: cleaningDueNow,
        asleep: this.state.asleep
      },
      hero: this.heroViewModel(bean),
      recipe: {
        draft,
        grinderStep: this.grinderStep(),
        ratioLabel: formatRatio(ratioFor(draft.dose, draft.yield)),
        brewTempLabel: brewTemp == null ? '--' : `${brewTemp.toFixed(1)}`
      },
      historyHtml: this.renderHistory()
    });
  }

  private heroViewModel(bean: Bean | null): WorkbenchHeroViewModel {
    if (!bean) {
      return { beanName: 'Pick a bag', roaster: null, age: null, remaining: null, shotsLeft: null, beanId: null };
    }
    const batch = this.selectedBatch();
    const remaining = positiveNumber(batch?.weightRemaining);
    const avgDose = this.averageDoseIn();
    const shotsLeft = remaining != null && avgDose != null ? Math.floor(remaining / avgDose) : null;
    return {
      beanName: bean.name?.trim() || beanLabel(bean),
      roaster: bean.roaster?.trim() || null,
      age: roastAgeLabel(batch),
      remaining: remaining == null ? null : formatGrams(remaining),
      shotsLeft: shotsLeft == null ? null : `~${shotsLeft} shot${shotsLeft === 1 ? '' : 's'}`,
      beanId: bean.id
    };
  }

  // Average dose-in across the bean's loaded shots (state.shots is already
  // bean-scoped), so "shots left" reflects how this bag is actually pulled;
  // fall back to the current recipe dose before any shots exist.
  private averageDoseIn(): number | null {
    const doses = this.state.shots
      .filter((shot) => !isServiceShot(shot))
      .map((shot) =>
        positiveNumber(shot.annotations?.actualDoseWeight) ??
        positiveNumber(shot.workflow?.context?.targetDoseWeight)
      )
      .filter((dose): dose is number => dose != null);
    if (doses.length === 0) return positiveNumber(this.state.draft?.dose);
    return doses.reduce((sum, dose) => sum + dose, 0) / doses.length;
  }

  private renderPage(): string {
    switch (this.state.view) {
      case 'flow-calibrator':
        return this.renderFlowCalibratorPage();
      case 'settings':
        return this.renderSettingsPage();
      case 'machine':
        return this.renderMachinePage();
      case 'profiles':
        return this.renderProfilesPage();
      case 'profile-editor':
        return this.renderProfileEditorPage();
      case 'grinder-editor':
        return this.renderGrinderEditorPage();
      default:
        return '';
    }
  }

  private pageHeader(title: string, back: View = 'workbench', actions = ''): string {
    return renderPageHeader(title, back, actions);
  }

  private bindDetailChart(): void {
    const canvas = this.root.querySelector<HTMLCanvasElement>('#detail-canvas');
    const shot = canvas ? this.selectedHistoryShot() : null;
    if (!canvas || !shot) {
      this.detailChartCanvas = null;
      this.detailChartShotId = null;
      this.detailChartCompareShotId = null;
      return;
    }
    const compare = this.compareShotForDetailChart();
    // innerHTML re-renders replace the canvas, so the chart usually has to
    // re-attach; only skip when the same element survived with the same shots
    // and the cached models are still valid for those shots' measurements.
    const cachedModel = this.shotChartModelCache;
    const compareCacheValid =
      compare == null
        ? this.detailChartCompareShotId == null
        : this.detailChartCompareShotId === compare.id &&
          this.compareChartModelCache?.shotId === compare.id &&
          this.compareChartModelCache.measurements === compare.measurements;
    if (
      canvas === this.detailChartCanvas &&
      shot.id === this.detailChartShotId &&
      cachedModel?.shotId === shot.id &&
      cachedModel.measurements === shot.measurements &&
      compareCacheValid
    ) {
      return;
    }
    this.detailChartCanvas = canvas;
    this.detailChartShotId = shot.id;
    this.detailChartCompareShotId = compare?.id ?? null;
    const chart = new LiveChart(canvas, { detailed: true, pixelScale: 3 });
    const model = this.shotChartModel(shot);
    chart.setModel(compare ? overlayComparisonModel(model, this.compareChartModel(compare)) : model);
    // Draw after layout so the canvas has its CSS box for DPR sizing.
    window.requestAnimationFrame(() => {
      chart.resize();
      chart.draw();
    });
  }

  private compareShotForDetailChart(): ShotRecord | null {
    return compareHistoryShot(this.state.shots, this.state.detailShotId, this.state.compareShotId);
  }

  // Returns the canvas chart model for a saved shot, rebuilding only when the
  // shot (or its measurement array instance) changes.
  private shotChartModel(shot: ShotRecord): LiveChartModel {
    const cached = this.shotChartModelCache;
    if (cached && cached.shotId === shot.id && cached.measurements === shot.measurements) {
      return cached.model;
    }
    const model = chartModelFromShot(shot);
    this.shotChartModelCache = { shotId: shot.id, measurements: shot.measurements, model };
    return model;
  }

  private compareChartModel(shot: ShotRecord): LiveChartModel {
    const cached = this.compareChartModelCache;
    if (cached && cached.shotId === shot.id && cached.measurements === shot.measurements) {
      return cached.model;
    }
    const model = chartModelFromShot(shot);
    this.compareChartModelCache = { shotId: shot.id, measurements: shot.measurements, model };
    return model;
  }

  private bindCalibratorChart(): void {
    if (this.state.view !== 'flow-calibrator') return;
    const canvas = this.root.querySelector<HTMLCanvasElement>('#flow-cal-canvas');
    if (!canvas) return;
    const shot = this.flowCalibrationSelectedShot();
    if (!shot) return;
    // Show the two calibration lines — machine flow and scale (weight) flow —
    // plus pressure for context. Only the machine-flow line is scaled by the
    // preview multiplier, so −/+ visibly moves it onto the scale line. Scale
    // from the multiplier the shot was actually pulled under when reaprime
    // recorded it; otherwise fall back to the open-time estimate.
    const shotBase = recordedFlowMultiplier(shot) ?? this.flowCalibrationBase();
    const factor = calibrationPreviewFactor(shotBase, this.flowCalibrationDraft());
    const model = this.shotChartModel(shot);
    const series = model.series
      .filter((item) => item.key === 'flow' || item.key === 'weightFlow' || item.key === 'pressure')
      .map((item) => {
        if (item.key === 'flow') {
          return {
            ...item,
            label: 'Machine flow',
            shortLabel: 'Machine flow',
            points: item.points.map((point) => ({ t: point.t, value: point.value * factor }))
          };
        }
        if (item.key === 'weightFlow') {
          return { ...item, label: 'Scale flow', shortLabel: 'Scale flow' };
        }
        return item;
      });
    const chart = new LiveChart(canvas, { detailed: true, pixelScale: 3 });
    chart.setModel({ ...model, series });
    window.requestAnimationFrame(() => {
      chart.resize();
      chart.draw();
    });
  }

  private captureFocus(): { selector: string; start: number | null; value: string | null } | null {
    const active = document.activeElement as HTMLInputElement | null;
    const action = active?.dataset?.action;
    if (!action) return null;
    if (
      !FOCUSABLE_SEARCH.has(action) &&
      !action.startsWith('pe-') &&
      action !== 'phone-recipe-field' &&
      action !== 'phone-shot-field' &&
      action !== 'shot-edit-number' &&
      action !== 'bean-picker-batch-field' &&
      action !== 'bean-picker-bean-field'
    ) {
      return null;
    }
    const batchForm = active?.closest<HTMLFormElement>('[data-form="bean-picker-batch"]');
    const parts = batchForm?.dataset.batchId != null
      ? [`[data-form="bean-picker-batch"][data-batch-id="${batchForm.dataset.batchId}"] [data-action="${action}"]`]
      : [`[data-action="${action}"]`];
    if (active?.dataset.field != null) parts.push(`[data-field="${active.dataset.field}"]`);
    if (active?.dataset.index != null) parts.push(`[data-index="${active.dataset.index}"]`);
    if (active?.dataset.key != null) parts.push(`[data-key="${active.dataset.key}"]`);
    if (active?.getAttribute('name') != null) parts.push(`[name="${active.getAttribute('name')}"]`);
    // The four exit sliders share action/index/key — disambiguate by type+condition.
    if (active?.dataset.type != null) parts.push(`[data-type="${active.dataset.type}"]`);
    if (active?.dataset.condition != null) parts.push(`[data-condition="${active.dataset.condition}"]`);
    const start = typeof active?.selectionStart === 'number' ? active.selectionStart : null;
    // Capture the in-progress value too. These fields are uncontrolled, so a
    // background re-render (water band crossing, sleep/wake, refresh timers)
    // would otherwise reset typed-but-uncommitted text back to the saved value.
    const value = typeof (active as HTMLInputElement | HTMLTextAreaElement | null)?.value === 'string'
      ? (active as HTMLInputElement | HTMLTextAreaElement).value
      : null;
    return { selector: parts.join(''), start, value };
  }

  private restoreFocus(focus: { selector: string; start: number | null; value: string | null } | null): void {
    if (!focus) return;
    const el = this.root.querySelector<HTMLInputElement>(focus.selector);
    if (!el) return;
    if (focus.value != null && el.value !== focus.value) el.value = focus.value;
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
    const model = sleepOverlayModel({
      asleep: this.state.asleep,
      appAwake: this.state.appAwake,
      usesWebSleepControls: this.usesWebSleepControls(),
      wakeAppZoneEnabled: this.state.settingsPreferences.wakeAppZoneEnabled,
      wakeAppZonePosition: this.state.settingsPreferences.wakeAppZonePosition
    });
    if (!model.showOverlay) return '';
    // The wake-app zone layers on top of (and is rendered after) the wake-machine
    // overlay so a tap on the strip opens the app without waking the machine.
    const zone = model.showWakeAppZone
      ? `<button type="button" class="sleep-wake-app-zone sleep-wake-app-zone-${model.zonePosition}" data-action="wake-app" aria-label="Open app without waking the machine"></button>`
      : '';
    return `
      <button type="button" class="sleep-overlay" data-action="wake" aria-label="Wake machine"></button>
      ${zone}
    `;
  }

  private renderWakeAppZonePreview(): string {
    const position = this.state.wakeZonePreview;
    if (!position) return '';
    return `<div class="sleep-wake-app-zone sleep-wake-app-zone-${position} wake-zone-preview" aria-hidden="true"></div>`;
  }

  private renderStoreErrorOverlay(): string {
    if (!this.state.storeError) return '';
    const count = this.failedStoreWrites.size;
    const noun = count === 1 ? 'setting change' : 'setting changes';
    return `
      <div class="store-error-overlay" role="alertdialog" aria-modal="true" aria-labelledby="store-error-title">
        <div class="store-error-dialog">
          <h2 id="store-error-title">Couldn't save to the machine</h2>
          <p>${count} ${noun} didn't reach the gateway. Your change is held on this device but isn't synced across your devices.</p>
          <div class="store-error-actions">
            <button type="button" class="store-error-retry" data-action="retry-store-write">Retry</button>
            <button type="button" class="store-error-dismiss" data-action="dismiss-store-error">Keep local copy</button>
          </div>
        </div>
      </div>
    `;
  }

  private renderLivePanel(): string {
    return renderLivePanelView({
      active: this.state.liveActive,
      finalizing: this.state.liveFinalizing,
      busy: this.state.busy,
      ghost: this.liveGhostPanelModel(),
      stages: this.liveStagesView()
    });
  }

  private usesWebSleepControls(): boolean {
    return !isDecentAppWebView();
  }

  private renderBeanPickerModal(): string {
    const query = this.state.search.trim().toLowerCase();
    const beans = this.sortedBeansForPicker();
    return renderBeanPickerModalView({
      search: this.state.search,
      autofocusSearch: this.state.beanPickerAutofocusSearch,
      matches: beans.filter((bean) => beanLabel(bean).toLowerCase().includes(query)),
      focusedBean: this.beanPickerFocusedBean(),
      mode: this.state.beanPickerMode,
      selectedBeanId: this.state.selectedBeanId,
      selectedBatchId: this.state.selectedBatchId,
      favoriteBeanIds: this.state.favoriteBeans,
      focusedBatchId: this.state.beanPickerFocusedBatchId,
      freezeStepperBatchId: this.state.beanPickerFreezeBatchId,
      batchesByBean: this.state.batchesByBean,
      prefillBeans: beans,
      draftBatchBeanId: this.state.beanPickerDraftBatchBeanId,
      editingBeanDetailsId: this.state.beanPickerEditingBeanId,
      editingBatchId: this.state.beanPickerEditingBatchId,
      showAllBags: this.state.beanPickerShowAllBags,
      formNumbers: this.state.formNumbers,
      secondTapHint: this.state.secondTapHint,
      averageDoseIn: this.averageDoseIn()
    });
  }

  private sortedBeansForPicker(): Bean[] {
    const usage = this.state.beanUsageAt;
    const selectedId = this.state.selectedBeanId;
    const favorites = new Set(this.state.favoriteBeans);
    return [...this.state.beans].sort((a, b) => {
      // Favorites stay pinned to the top, then fall back to the usual order.
      const fa = favorites.has(a.id) ? 0 : 1;
      const fb = favorites.has(b.id) ? 0 : 1;
      if (fa !== fb) return fa - fb;
      return compareBeansForPicker(a, b, usage, selectedId);
    });
  }

  private beanPickerFocusedBean(): Bean | null {
    if (this.state.beanPickerMode === 'create') return null;
    const id = this.state.beanPickerBeanId ?? this.state.selectedBeanId;
    return this.state.beans.find((bean) => bean.id === id) ?? this.selectedBean();
  }

  private renderProfilesPage(): string {
    const cleaningMode = this.state.cleaningProfilePicking;
    const selectedId = cleaningMode
      ? resolveCleaningProfile(this.state.profiles, this.state.cleaningProfileOverride)?.id ?? null
      : this.profileIdForDraft();
    const model = {
      profiles: this.state.profiles,
      search: this.state.profileSearch,
      favoriteProfileIds: this.state.favoriteProfiles,
      selectedId,
      focusId: this.state.profileFocusId,
      cleaningMode,
      showHidden: this.state.profilesShowHidden,
      hiddenProfiles: this.state.hiddenProfiles
    };
    return this.isPhoneLayout() ? renderPhoneProfilePickerPage(model) : renderProfilePickerPage(model);
  }

  private brewTempValue(): number | null {
    const draft = this.state.draft;
    if (draft.brewTemp != null) return draft.brewTemp;
    return profileBaseTemperature(draft.profile ?? null);
  }

  private renderHistory(): string {
    return renderHistoryView({
      shots: this.state.shots,
      detailShotId: this.state.detailShotId,
      compareShotId: this.state.compareShotId,
      comparePicking: this.state.comparePicking,
      demo: this.state.demo,
      shotsTotal: this.state.shotsTotal,
      shotsLoadingMore: this.state.shotsLoadingMore,
      secondTapHint: this.state.secondTapHint,
      batchesByBean: this.state.batchesByBean
    });
  }

  private selectedHistoryShot(): ShotRecord | null {
    return selectHistoryShot(this.state.shots, this.state.detailShotId);
  }

  private renderModal(): string {
    if (this.state.modal === 'bean-picker') return this.renderBeanPickerModal();
    if (this.state.modal === 'batch-storage') return this.renderBatchStorageModal();
    if (this.state.modal === 'edit-number') return this.renderEditDialog();
    if (this.state.modal === 'edit-shot') return this.renderShotEditModal();
    if (this.state.modal === 'machine-label') return this.renderMachineLabelModal();
    if (this.state.modal === 'no-scale-shot') return this.renderNoScaleShotModal();
    if (this.state.modal === 'label-scanner') return this.renderLabelScannerModal();
    if (this.state.modal === 'delete-shot') return this.renderDeleteShotModal();
    if (this.state.modal === 'cleaning-wizard') return this.renderCleaningWizardModal();
    if (this.state.modal === 'import-profile') return this.renderImportProfileModal();
    if (this.state.modal === 'delete-profile') return this.renderDeleteProfileModal();
    return '';
  }

  private renderImportProfileModal(): string {
    const state = this.state.profileImport;
    if (!state) return '';
    return renderImportProfileModalView(state);
  }

  private renderDeleteProfileModal(): string {
    const target = this.state.profileDeleteTarget;
    if (!target) return '';
    return renderDeleteProfileModalView(target.title);
  }

  private renderCleaningWizardModal(): string {
    const wizard = this.state.cleaningWizard;
    if (!wizard) return '';
    return renderCleaningWizardModalView({
      step: wizard.step,
      note: wizard.note,
      actionPending: wizard.actionPending,
      hasGhc: this.machineHasGhc(),
      loading: this.state.busy,
      canRunPull: resolveCleaningProfile(this.state.profiles, this.state.cleaningProfileOverride) != null
    });
  }

  private renderBatchStorageModal(): string {
    const selection = this.batchStorageSelection();
    return selection ? renderBatchStorageModalView(selection.bean, selection.batch) : '';
  }

  private renderNoScaleShotModal(): string {
    const blockEnabled = this.state.settingsBundle?.rea.blockOnNoScale !== false;
    return renderNoScaleShotModalView(blockEnabled);
  }

  private renderDeleteShotModal(): string {
    const plan = this.state.deleteShotTarget?.reclaim ?? null;
    const reclaim = plan
      ? { dose: formatGrams(plan.dose), remaining: formatGrams(plan.remaining), next: formatGrams(plan.next) }
      : null;
    return renderDeleteShotModalView(reclaim);
  }

  private renderWaterWarningBanner(): string {
    if (this.currentWaterAlert() !== 'soft') return '';
    const ml = this.state.waterLevel != null ? water(this.state.waterLevel) : null;
    return renderWaterWarningBannerView(ml);
  }

  private renderWaterAlert(): string {
    if (this.currentWaterAlert() !== 'hard' || this.state.waterAlertDismissed) return '';
    const machineBlocked = this.state.machine?.state?.state === 'needsWater';
    const ml = this.state.waterLevel != null ? water(this.state.waterLevel) : null;
    return renderWaterAlertView({ machineBlocked, mlLabel: ml });
  }

  private renderSettingsPage(): string {
    return `
      ${this.pageHeader('Settings', 'workbench')}
      ${renderSettingsShell(
        this.settingsShellModel(),
        this.state.settingsSection,
        this.state.settingsBundle,
        this.state.pluginConfig,
        this.decentAccountPanelState(),
        undefined,
        { flowCalibration: this.flowCalibrationDisplay() }
      )}
    `;
  }

  private renderFlowCalibratorPage(): string {
    const shots = this.flowCalibrationShots();
    const selected = this.flowCalibrationSelectedShot();
    const profileTitle = selected ? shotProfileTitle(selected) : null;
    const overrides = readFlowCalibrationOverrides();
    const override = profileTitle != null && overrides[profileTitle] != null ? roundCalibration(overrides[profileTitle]) : null;
    return `
      ${this.pageHeader('Flow Calibrator', 'workbench')}
      ${renderFlowCalibrator(
        shots,
        {
          draft: this.flowCalibrationDraft(),
          global: this.globalFlowCalibrationDefault(),
          active: this.currentFlowCalibrationMultiplier(),
          profileTitle,
          profileOverride: override,
          selectedShotId: selected?.id ?? null
        },
        this.state.busy
      )}
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
    // Prefer the explicitly-saved button selection; fall back to value-matching
    // only when nothing has been selected yet (legacy / first run).
    const selection = this.state.machinePresetSelection;
    const steamPreset = selection.steamPreset ?? matchingPreset(steam, steamPresets);
    const waterPreset = selection.waterPreset ?? matchingPreset(water, waterPresets);
    const flushPreset = selection.flushPreset ?? matchingPreset(flush, flushPresets);
    const waterScaleConnected = scaleConnected(this.state.scale);
    return renderMachinePageView({
      headerHtml: this.pageHeader('Steam · Water · Flush'),
      lanes: [
        {
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
              machineSteamPurgeTile(this.state.machineSettings?.steamPurgeMode)
            ]
          },
          {
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
              machineHotWaterStopModeTile(this.state.hotWaterStopMode, waterScaleConnected),
              this.state.hotWaterStopMode === 'time'
                ? machineValueTile('waterDuration', 'Time', water.duration, capabilities.hotWater.duration)
                : machineValueTile(
                    'waterVolume',
                    waterScaleConnected ? 'Weight' : 'Volume',
                    water.volume,
                    hotWaterTargetSpec(capabilities.hotWater.volume!, waterScaleConnected)
                  )
            ]
          },
          {
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
              machineValueTile('flushTemp', 'Temp', flush.targetTemperature, capabilities.flush.targetTemperature)
            ]
          }
      ],
      cleaningBarHtml: this.renderCleaningBar()
    });
  }

  private renderCleaningBar(): string {
    const profiles = this.state.profiles;
    const resolved = resolveCleaningProfile(profiles, this.state.cleaningProfileOverride);
    const cleaning = this.state.cleaning;
    const threshold = this.state.cleaningThreshold;
    const due = cleaningDue(cleaning, threshold);
    return renderCleaningBarView({
      due,
      profileTitle: resolved?.profile?.title ?? null,
      profilesAvailable: profiles.length > 0,
      shotsSinceClean: cleaning.shotsSinceClean,
      lastCleanedAt: cleaning.lastCleanedAt,
      threshold
    });
  }

  private renderMachineProgressPage(service: MachineServiceState): string {
    const tone = machineServiceTone(service);
    const steam = this.currentSteamSettings();
    const water = this.currentHotWaterData();
    const flush = this.currentRinseData();
    const waterScaleConnected = scaleConnected(this.state.scale);
    const progress = this.machineService.snapshot();
    const targetSeconds = progress.targetOverrideSeconds
      ?? machineServiceTargetSeconds(
        service,
        steam,
        water,
        flush,
        this.state.hotWaterStopMode,
        waterScaleConnected
      );
    const targetWeight = service === 'hotWater' && this.state.hotWaterStopMode === 'volume' && waterScaleConnected
      ? positiveNumber(water.volume)
      : null;
    const elapsedSeconds = progress.startedAtMs == null
      ? 0
      : Math.max(0, (Date.now() - progress.startedAtMs) / 1000);
    const machine = this.state.machine;
    const stats = machineServiceStats(targetSeconds, targetWeight);
    const meta = machineServiceMeta(service, steam, water, flush, machine, this.state.scale, this.state.hotWaterStopMode);
    const stopRequested = progress.stopRequestedFor === service;
    const stopAgeSeconds = stopRequested && progress.stopRequestedAtMs != null
      ? Math.max(0, (Date.now() - progress.stopRequestedAtMs) / 1000)
      : 0;
    const stopLabel = stopRequested
      ? stopAgeSeconds > 4 && !this.state.busy ? 'Stop again' : 'Stopping...'
      : 'Stop';
    const primaryTime = progress.phase === 'starting'
      ? { value: service === 'steam' ? 'Heating' : 'Starting', label: null }
      : progress.phase === 'purging'
        ? { value: 'Purging', label: null }
        : targetWeight != null
          ? {
              value: `${formatNumber(this.state.scale?.weight, 1)}g`,
              label: `${formatNumber(targetWeight, 0)}g target`
            }
          : machineServicePrimaryTime(elapsedSeconds, targetSeconds);
    return renderMachineProgressPageView({
      title: machineServiceVerb(service),
      tone,
      primaryTime,
      meta,
      stats,
      busy: this.state.busy,
      stopRequested,
      stopLabel
    });
  }

  private renderGrinderEditorPage(): string {
    const editing = this.state.editingGrinderId
      ? this.state.grinders.find((grinder) => grinder.id === this.state.editingGrinderId) ?? null
      : null;
    const actionLabel = editing ? 'Save grinder' : 'Add grinder';
    const actions = `<button class="command primary commit-action" type="submit" form="grinder-form">${icon(editing ? 'check' : 'plus')}<span>${actionLabel}</span></button>`;
    return renderGrinderEditorPageView(
      this.pageHeader(editing ? 'Edit Grinder' : 'Add Grinder', 'workbench', actions),
      editing,
      this.state.formNumbers
    );
  }

  private renderEditDialog(): string {
    const dialog = this.state.editDialog;
    if (!dialog) return '';
    return renderInputDialog(dialog);
  }

  private renderMachineLabelModal(): string {
    const edit = this.state.machineLabelEdit;
    if (!edit) return '';
    return renderMachineLabelModalView(edit.label);
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
    const batch = this.batchAndBeanForId(draft.beanBatchId)?.batch ?? null;
    const batchText = batch ? batchOptionLabel(batch) : draft.beanBatchId ? 'Saved batch' : null;
    const beans = this.sortedBeansForPicker();
    const field = this.state.shotEditField;

    return renderShotEditModalView({
      shotId: shot.id,
      shotLabel,
      draft,
      grinders: this.state.grinders,
      beanSummary: {
        batchLabel: batchText
      },
      fieldDialog: field
        ? {
            field,
            spec: shotFieldSpec(field, draft, this.state.grinders, this.state.shots)
          }
        : null,
      beanDialog: this.state.shotBeanEdit
        ? {
            state: this.state.shotBeanEdit,
            selectedBeanId: this.shotDraftBean(draft)?.id ?? null,
            beans,
            prefillBeans: beans
          }
        : null
    });
  }

  private settingsShellModel() {
    return buildSettingsShellModel({
      query: this.state.settingsSearch,
      preferences: this.state.settingsPreferences,
      demo: this.state.demo,
      loading: this.state.loading,
      status: this.state.status,
      gatewayHost: gatewayHttpOrigin() || location.origin,
      machine: this.state.machine,
      scale: this.state.scale,
      machineRefillLevelMm: this.state.machineRefillLevel
    });
  }

  private decentAccountPanelState(): DecentAccountPanelState {
    return {
      status: this.state.decentAccount,
      source: this.state.decentAccountSource,
      emailDraft: this.state.decentAccountEmail,
      passwordDraft: this.state.decentAccountPassword,
      saving: this.state.decentAccountSaving,
      message: this.state.decentAccountMessage
    };
  }

  private selectedBean(): Bean | null {
    return this.state.beans.find((bean) => bean.id === this.state.selectedBeanId) ?? null;
  }

  private selectedBatch(): BeanBatch | null {
    const bean = this.selectedBean();
    if (!bean) return null;
    const batches = this.state.batchesByBean[bean.id] ?? [];
    const selected = this.state.selectedBatchId
      ? batches.find((batch) => batch.id === this.state.selectedBatchId) ?? null
      : null;
    if (selected && !isFinishedBatch(selected)) return selected;
    return latestBatch(batches.filter(isUsableBatch)) ?? latestBatch(batches);
  }

  private workflowMatchesBean(bean: Bean, batches: BeanBatch[] = this.state.batchesByBean[bean.id] ?? []): boolean {
    const ctx = this.state.workflow?.context;
    const directBeanId = (ctx as (WorkflowContext & { beanId?: string | null }) | null | undefined)?.beanId;
    if (directBeanId) return directBeanId === bean.id;
    const batchId = ctx?.beanBatchId;
    return !!batchId && batches.some((batch) => batch.id === batchId && batch.beanId === bean.id);
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
    if (this.state.settingsBundle && this.state.settingsSource !== 'loading') return;
    const result = await this.settingsController.loadSettingsBundle(this.state.demo);
    this.setState({
      settingsBundle: result.bundle,
      settingsSource: result.source,
      status: result.status ?? this.state.status
    });
    // Ground the per-profile global default from the machine's real calibration
    // the first time we see it, so profiles without an override keep the user's
    // existing calibration instead of being reset to 1.0.
    if (result.source === 'gateway' && readFlowCalibrationGlobal() == null) {
      const seed = result.bundle.calibration.flowMultiplier;
      if (typeof seed === 'number' && Number.isFinite(seed) && seed > 0) {
        writeFlowCalibrationGlobal(roundCalibration(seed));
      }
    }
  }

  private patchBundle(patch: Partial<SettingsBundle>): void {
    if (!this.state.settingsBundle) return;
    this.setState({ settingsBundle: { ...this.state.settingsBundle, ...patch } });
  }

  private get settingsLocal(): boolean {
    return this.state.demo || this.state.settingsSource === 'demo';
  }

  private openFlowCalibrator(): void {
    this.setState({
      view: 'flow-calibrator',
      settingsBundle: this.state.settingsBundle ?? demoSettingsBundle(),
      settingsSource: this.state.settingsBundle
        ? this.state.settingsSource
        : this.state.demo
          ? 'demo'
          : 'loading',
      flowCalDraft: null,
      flowCalBase: null,
      flowCalShotId: null,
      // Seed with the current bean's shots for an instant list, then widen to
      // every bean's shots — calibration is machine-global, so any shot works.
      flowCalShots: this.state.shots
    });
    void this.loadReaSettings();
    void this.loadAllCalibrationShots();
  }

  // Flow calibration spans all beans, not just the selected one. Demo gathers
  // every demo bean's shots; live reuses the no-bean-filter shot loader.
  private async loadAllCalibrationShots(): Promise<void> {
    if (this.state.demo) {
      const all = demoBeans
        .flatMap((bean) => demoShotsForBean(bean))
        .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
      this.setState({ flowCalShots: all });
      return;
    }
    const shots = await this.loadLatestShotCandidates(40);
    if (this.state.view !== 'flow-calibrator' || shots.length === 0) return;
    this.setState({ flowCalShots: shots });
  }

  private currentFlowCalibrationMultiplier(): number {
    const value = this.state.settingsBundle?.calibration.flowMultiplier ?? demoSettingsBundle().calibration.flowMultiplier;
    return roundCalibration(typeof value === 'number' && Number.isFinite(value) ? value : 1);
  }

  // The global default profiles without an override follow. Persisted locally;
  // before it has ever been grounded (seeded from the machine in loadReaSettings)
  // it falls back to the machine's current value.
  private globalFlowCalibrationDefault(): number {
    return roundCalibration(readFlowCalibrationGlobal() ?? this.currentFlowCalibrationMultiplier());
  }

  private flowCalibrationDraft(): number {
    return this.state.flowCalDraft ?? this.currentFlowCalibrationMultiplier();
  }

  // The multiplier the displayed shots were pulled under — the saved value as it
  // was before any change this visit. Frozen on the first edit so applying one
  // shot doesn't re-scale every other shot's suggestion.
  private flowCalibrationBase(): number {
    return roundCalibration(this.state.flowCalBase ?? this.currentFlowCalibrationMultiplier());
  }

  private setFlowCalibrationDraft(raw: number): void {
    if (!Number.isFinite(raw)) return;
    this.setState({
      flowCalBase: this.state.flowCalBase ?? this.currentFlowCalibrationMultiplier(),
      flowCalDraft: roundCalibration(raw),
      status: 'Flow calibration preview'
    });
  }

  private adjustFlowCalibrationDraft(delta: number): void {
    if (!Number.isFinite(delta) || delta === 0) return;
    this.setFlowCalibrationDraft(this.flowCalibrationDraft() + delta);
  }

  // All real (non flush/steam/water) shots across every bean, newest first.
  private flowCalibrationShots(): ShotRecord[] {
    const all = this.state.flowCalShots.length ? this.state.flowCalShots : this.state.shots;
    return all.filter((shot) => !isServiceShot(shot));
  }

  private flowCalibrationSelectedShot(): ShotRecord | null {
    const shots = this.flowCalibrationShots();
    return shots.find((shot) => shot.id === this.state.flowCalShotId) ?? shots[0] ?? null;
  }

  private selectFlowCalibrationShot(id: string): void {
    if (!this.flowCalibrationShots().some((shot) => shot.id === id)) return;
    this.setState({ flowCalShotId: id, status: 'Shot selected' });
  }

  // Save the tuned value as the overridable DEFAULT. Profiles with their own
  // override are untouched (they still win when used) — only profiles that
  // follow the default move. The machine re-syncs to the active profile, so a
  // profile with its own value is never changed by editing the default.
  private async saveFlowCalibrationGlobal(raw: number): Promise<void> {
    if (!Number.isFinite(raw)) return;
    const value = roundCalibration(clampCalibration(raw));
    writeFlowCalibrationGlobal(value);
    await this.commitCalibrationConfig(value, 'Default flow calibration saved');
  }

  // Save the tuned value as an OVERRIDE for the selected shot's profile. A value
  // equal to the default clears the override (the profile reverts to following
  // the default). The machine re-syncs to the active profile afterwards.
  private async saveFlowCalibrationProfile(raw: number): Promise<void> {
    if (!Number.isFinite(raw)) return;
    const selected = this.flowCalibrationSelectedShot();
    const profileTitle = selected ? shotProfileTitle(selected) : null;
    if (!profileTitle) return;
    const value = roundCalibration(clampCalibration(raw));
    const overrides = setProfileOverride(
      readFlowCalibrationOverrides(),
      profileTitle,
      value,
      this.globalFlowCalibrationDefault()
    );
    writeFlowCalibrationOverrides(overrides);
    const cleared = overrides[profileTitle] == null;
    await this.commitCalibrationConfig(
      value,
      cleared ? `${profileTitle} now follows the default` : `Flow calibration saved for ${profileTitle}`
    );
  }

  private activeProfileTitle(): string | null {
    return this.state.draft?.profileTitle ?? this.state.draft?.profile?.title ?? null;
  }

  // Resolved flow calibration for the active profile, for the read-only Settings
  // → Brew readout. Computed fresh from the override store so it stays current
  // when the profile changes.
  private flowCalibrationDisplay(): FlowCalibrationDisplay {
    const profileTitle = this.activeProfileTitle();
    const { value, source } = resolveFlowCalibration({
      profileTitle,
      overrides: readFlowCalibrationOverrides(),
      globalDefault: this.globalFlowCalibrationDefault()
    });
    return { value: roundCalibration(value), origin: source === 'profile' ? 'profile' : 'default', profileTitle };
  }

  // After changing stored calibration config (the default or an override), sync
  // the machine to the ACTIVE profile's resolved value. This is what keeps a
  // profile with its own override from being disturbed by a default change, and
  // keeps the machine on the loaded profile when saving an override for another.
  private async commitCalibrationConfig(savedValue: number, status: string): Promise<void> {
    this.setState({
      flowCalBase: this.state.flowCalBase ?? this.currentFlowCalibrationMultiplier(),
      // Keep the view on the value just saved — don't snap the stepper/chart back
      // to the machine's current (pulled-at) value.
      flowCalDraft: savedValue
    });
    await this.applyProfileFlowCalibration(this.activeProfileTitle());
    this.setState({ status });
  }

  // The multiplier a profile should run at: its override else the global default.
  // Returns null when the global default has never been grounded AND the profile
  // has no override — so we never reset a machine calibration the user hasn't
  // opted into managing.
  private resolveProfileFlowCalibration(profileTitle: string | null): number | null {
    const overrides = readFlowCalibrationOverrides();
    const globalDefault = readFlowCalibrationGlobal();
    if (globalDefault == null) {
      const title = profileTitle?.trim();
      const override = title ? overrides[title] : undefined;
      return override != null ? roundCalibration(override) : null;
    }
    return roundCalibration(resolveFlowCalibration({ profileTitle, overrides, globalDefault }).value);
  }

  // Push the active profile's resolved calibration to the machine when it differs
  // from what's live — the "changes when that profile is used" behaviour. Called
  // from applyDraft once the workflow (and thus the profile) has been applied.
  private async applyProfileFlowCalibration(profileTitle: string | null): Promise<void> {
    const resolved = this.resolveProfileFlowCalibration(profileTitle);
    if (resolved == null || resolved === this.currentFlowCalibrationMultiplier()) return;
    const bundle = this.state.settingsBundle ?? demoSettingsBundle();
    this.setState({
      settingsBundle: { ...bundle, calibration: { ...bundle.calibration, flowMultiplier: resolved } },
      status: `Flow calibration ${resolved.toFixed(2)}×`
    });
    if (this.settingsLocal) return;
    try {
      await gateway.updateCalibration(resolved);
    } catch (error) {
      console.error('[Beanie] Per-profile flow calibration apply failed', error);
    }
  }

  private async scanDevices(): Promise<void> {
    this.setState({ status: 'Scanning for devices…' });
    const result = await this.settingsController.scanDevices(this.settingsLocal);
    if (result.devices) this.patchBundle({ devices: result.devices });
    this.setState({ status: result.status });
  }

  private async connectPreferredDevices(): Promise<void> {
    this.setState({ status: 'Searching for preferred devices…' });
    const result = await this.settingsController.connectPreferredDevices({
      local: this.settingsLocal,
      preferredScaleId: this.state.settingsBundle?.rea.preferredScaleId ?? null
    });
    if (result.devices) this.patchBundle({ devices: result.devices });
    this.setState({ status: result.status });
  }

  private async handleScaleStatTap(): Promise<void> {
    if (scaleConnected(this.state.scale)) {
      await this.tareScale();
      return;
    }
    await this.connectPreferredDevices();
  }

  private async tareScale(): Promise<void> {
    if (this.state.demo) {
      this.setState({ status: 'Tare unavailable in demo mode' });
      return;
    }
    if (!scaleConnected(this.state.scale)) {
      this.setState({ status: 'Scale disconnected' });
      return;
    }
    this.setState({ status: 'Taring scale…' });
    try {
      await gateway.tareScale();
      this.setState({ status: 'Scale tared' });
    } catch (error) {
      console.error('[Beanie] Scale tare failed', error);
      this.setState({ status: 'Tare failed' });
    }
  }

  private async connectDevice(id: string, connect: boolean): Promise<void> {
    if (!id) return;
    this.setState({ status: connect ? 'Connecting…' : 'Disconnecting…' });
    const result = await this.settingsController.connectDevice({
      id,
      connect,
      local: this.settingsLocal,
      fallbackDevices: this.state.settingsBundle?.devices ?? []
    });
    if (result.devices) this.patchBundle({ devices: result.devices });
    if (result.status) this.setState({ status: result.status });
  }

  private async setDisplayBrightness(raw: string): Promise<void> {
    const parsed = parseNumberInput(raw);
    if (parsed == null) return;
    const brightness = Math.max(0, Math.min(100, Math.round(parsed)));
    const current = this.state.settingsBundle?.display ?? demoSettingsBundle().display;
    this.patchBundle({
      display: {
        ...current,
        brightness,
        requestedBrightness: brightness,
        lowBatteryBrightnessActive: false
      }
    });
    if (brightness !== 0) this.sleepBrightnessZeroed = false;
    if (this.settingsLocal) {
      this.setState({ status: 'Brightness saved (demo)' });
      return;
    }

    try {
      const display = await gateway.setDisplayBrightness(brightness);
      this.patchBundle({ display });
      this.setState({ status: 'Brightness saved' });
    } catch (error) {
      console.error('[Beanie] Display brightness change failed', error);
      await this.refreshDisplayStateSilently();
      this.setState({ status: 'Brightness save failed' });
    }
  }

  private async requestMachineState(state: string): Promise<void> {
    const result = await this.settingsController.requestMachineState({ state, local: this.settingsLocal });
    this.setState({ status: result.status });
    if (result.sleepRequested) {
      // An explicit sleep ends a wake-app override so the screen can re-dim and
      // the screensaver returns — even when the machine was already asleep (no
      // telemetry transition to clear it for us).
      if (this.state.appAwake) this.setState({ appAwake: false });
      this.scheduleSleepBrightnessZero(1000);
    } else if (result.status !== 'Machine command failed') {
      this.observeSleepBrightnessState(false);
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
    const result = await this.settingsController.addWakeSchedule({
      time,
      local: this.settingsLocal,
      current: this.state.settingsBundle?.schedules ?? []
    });
    if (result.schedules) this.patchBundle({ schedules: result.schedules });
    if (result.status) this.setState({ status: result.status });
  }

  private async deleteWakeSchedule(id: string): Promise<void> {
    const remaining = (this.state.settingsBundle?.schedules ?? []).filter((s) => s.id !== id);
    this.patchBundle({ schedules: remaining });
    const result = await this.settingsController.deleteWakeSchedule({ id, local: this.settingsLocal });
    if (result.status) this.setState({ status: result.status });
  }

  private async toggleWakeSchedule(id: string, enabled: boolean): Promise<void> {
    const schedules = (this.state.settingsBundle?.schedules ?? []).map((s) =>
      s.id === id ? { ...s, enabled } : s
    );
    this.patchBundle({ schedules });
    try {
      await this.settingsController.toggleWakeSchedule({ id, enabled, local: this.settingsLocal });
    } catch {
      this.setState({ status: 'Could not update schedule' });
    }
  }

  private async loadDecentAccount(): Promise<void> {
    if (this.state.decentAccountSource === 'gateway' || this.state.decentAccountSource === 'demo') return;
    if (!this.state.demo && !this.settingsLocal) this.setState({ decentAccountSource: 'loading' });
    const result = await this.settingsController.loadDecentAccount({
      local: this.state.demo || this.settingsLocal,
      currentEmail: this.state.decentAccountEmail
    });
    this.setState({
      decentAccount: result.account,
      decentAccountSource: result.source,
      decentAccountEmail: result.email,
      decentAccountPassword: '',
      decentAccountSaving: false,
      decentAccountMessage: result.message
    });
  }

  private async refreshDecentAccount(): Promise<void> {
    this.setState({
      decentAccountSaving: true,
      decentAccountSource: this.state.decentAccountSource === 'gateway' || this.state.decentAccountSource === 'demo'
        ? null
        : this.state.decentAccountSource,
      decentAccountMessage: { tone: 'muted', text: 'Refreshing Decent account status...' }
    });
    await this.loadDecentAccount();
  }

  private updateDecentAccountField(key: string, value: string): void {
    if (key === 'email') {
      this.setState({ decentAccountEmail: value, decentAccountMessage: null });
      return;
    }
    if (key === 'password') {
      this.setState({ decentAccountPassword: value, decentAccountMessage: null });
    }
  }

  private async loginDecentAccount(): Promise<void> {
    const email = this.state.decentAccountEmail.trim();
    const password = this.state.decentAccountPassword;
    if (!email || !password) {
      this.setState({
        decentAccountMessage: { tone: 'warn', text: 'Enter both email and password.' }
      });
      return;
    }
    this.setState({
      decentAccountSaving: true,
      decentAccountMessage: { tone: 'muted', text: 'Linking Decent account...' }
    });
    try {
      const result = await this.settingsController.loginDecentAccount({
        local: this.state.demo || this.settingsLocal,
        email,
        password
      });
      this.setState({
        decentAccount: result.account,
        decentAccountSource: result.source,
        decentAccountEmail: result.email,
        decentAccountPassword: '',
        decentAccountSaving: false,
        decentAccountMessage: result.message
      });
    } catch (error) {
      console.error('[Beanie] Decent account login failed', error);
      const message = error instanceof GatewayRequestError
        ? accountLoginErrorMessage(error)
        : 'Could not link Decent account.';
      this.setState({
        decentAccountSaving: false,
        decentAccountSource: this.state.decentAccountSource === 'loading' ? 'unavailable' : this.state.decentAccountSource,
        decentAccountMessage: { tone: 'warn', text: message }
      });
    }
  }

  private async logoutDecentAccount(): Promise<void> {
    this.setState({
      decentAccountSaving: true,
      decentAccountMessage: { tone: 'muted', text: 'Unlinking Decent account...' }
    });
    try {
      const result = await this.settingsController.logoutDecentAccount({
        local: this.state.demo || this.settingsLocal
      });
      this.setState({
        decentAccount: result.account,
        decentAccountSource: result.source,
        decentAccountPassword: '',
        decentAccountSaving: false,
        decentAccountMessage: result.message
      });
    } catch (error) {
      console.error('[Beanie] Decent account unlink failed', error);
      this.setState({
        decentAccountSaving: false,
        decentAccountMessage: { tone: 'warn', text: 'Could not unlink Decent account.' }
      });
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
    const settings = await this.settingsController.loadPluginSettings({ local: this.settingsLocal, id });
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
    if (!config || normalizePluginId(config.id) !== normalizePluginId(id)) return;
    const pluginId = config.id;
    const spec = pluginSettingsSpec(pluginId);
    if (!spec) return;
    // Build the payload + optimistic next state. Reaprime stores plugin settings
    // as a whole object, so preserve existing secret values when saving other fields.
    const payload: Record<string, string | number | boolean> = {};
    const nextValues = { ...config.settings.values };
    const nextSecretsSet = { ...config.settings.secretsSet };
    for (const field of spec.fields) {
      if (field.secret) {
        if (config.secretEdited[field.key] && String(config.draft[field.key] ?? '') !== '') {
          payload[field.key] = config.draft[field.key];
          nextValues[field.key] = config.draft[field.key];
          nextSecretsSet[field.key] = true;
        } else if (config.settings.values[field.key] != null) {
          payload[field.key] = config.settings.values[field.key];
        }
      } else {
        payload[field.key] = config.draft[field.key];
        nextValues[field.key] = config.draft[field.key];
      }
    }
    const nextSettings: PluginSettings = { values: nextValues, secretsSet: nextSecretsSet };
    if (this.settingsLocal) {
      const result = await this.settingsController.savePluginSettings({ local: true, id: pluginId, payload });
      this.setState({ pluginConfig: this.makePluginConfig(pluginId, nextSettings), status: result.status });
      return;
    }
    this.setState({ pluginConfig: { ...config, saving: true } });
    const result = await this.settingsController.savePluginSettings({ local: false, id: pluginId, payload });
    if (result.ok) {
      this.setState({ pluginConfig: this.makePluginConfig(pluginId, nextSettings), status: result.status });
    } else {
      this.setState({
        pluginConfig: {
          ...config,
          saving: false,
          verify: { tone: 'warn', message: 'Save failed. Check plugin settings are valid.' }
        },
        status: result.status
      });
    }
  }

  private async verifyPluginConfig(id: string): Promise<void> {
    const config = this.state.pluginConfig;
    if (!config || normalizePluginId(config.id) !== normalizePluginId(id)) return;
    const pluginId = config.id;
    if (config.dirty) {
      this.setState({ pluginConfig: { ...config, verify: { tone: 'warn', message: 'Save your changes before verifying.' } } });
      return;
    }
    this.setState({ pluginConfig: { ...config, verify: { tone: 'muted', message: 'Verifying…' } } });
    const result = await this.settingsController.verifyPluginSettings({
      local: this.settingsLocal,
      id: pluginId,
      settings: config.settings
    });
    const current = this.state.pluginConfig;
    if (!current || normalizePluginId(current.id) !== normalizePluginId(pluginId)) return;
    this.setState({ pluginConfig: { ...current, verify: result } });
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
    if (this.settingsLocal) return; // local-only without a gateway
    try {
      await this.persistSetting(field.group, key, value);
    } catch (error) {
      console.error('[Beanie] Update setting failed', error);
      this.setState({ status: 'Setting update failed' });
    }
  }

  private async setNoScaleBlock(enabled: boolean): Promise<void> {
    const previousBundle = this.state.settingsBundle;
    const nextBundle = previousBundle
      ? { ...previousBundle, rea: { ...previousBundle.rea, blockOnNoScale: enabled } }
      : previousBundle;
    this.setState({
      settingsBundle: nextBundle,
      status: enabled ? 'Scale block enabled' : 'Disabling scale block...'
    });

    if (this.settingsLocal) {
      if (!enabled) this.noScaleShotWarningUntilMs = 0;
      this.setState({
        modal: enabled ? this.state.modal : null,
        status: enabled ? 'Scale block enabled (demo)' : 'Scale block disabled (demo)'
      });
      return;
    }

    try {
      await gateway.updateSettings({ blockOnNoScale: enabled });
      if (!enabled) this.noScaleShotWarningUntilMs = 0;
      this.setState({
        modal: enabled ? this.state.modal : null,
        status: enabled ? 'Scale block enabled' : 'Scale block disabled'
      });
    } catch (error) {
      console.error('[Beanie] Update no-scale block setting failed', error);
      this.setState({
        settingsBundle: previousBundle,
        status: 'Setting update failed'
      });
    }
  }

  private persistSetting(group: string, key: string, value: string | number | boolean | null): Promise<void> {
    return this.settingsController.persistSetting(group, key, value);
  }

  private async resetMachineSettings(): Promise<void> {
    const bundle = this.state.settingsBundle;
    if (!bundle) return;
    try {
      const result = await this.settingsController.resetMachineSettings({
        local: this.state.demo || this.state.settingsSource === 'demo',
        bundle
      });
      this.setState({ settingsBundle: { ...bundle, ...result.bundlePatch }, status: result.status });
    } catch {
      this.setState({ status: 'Reset failed' });
    }
  }

  private updateSettingsPreferences(next: Partial<SettingsPreferences>): void {
    const settingsPreferences = { ...this.state.settingsPreferences, ...next };
    writeSettingsPreferences(settingsPreferences);
    applySettingsPreferences(settingsPreferences);
    this.setState({
      settingsPreferences,
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
    if (this.disposed) return;
    this.state = { ...this.state, ...next };
    this.render();
  }

  // State changes whose visible effect is confined to the workbench history
  // panel (shot selection, compare mode, pagination) re-render only
  // that panel. A full innerHTML rebuild costs O(whole app) and resets scroll
  // and focus everywhere, which a list tap shouldn't pay for. Falls back to a
  // full render whenever the panel isn't on screen (phone layout shows status
  // text outside the panel, other views/modals don't show it at all).
  private setHistoryState(next: Partial<AppState>): void {
    if (this.disposed) return;
    const panel = this.isPhoneLayout() ? null : this.root.querySelector<HTMLElement>('.history-panel');
    if (!panel) {
      this.setState(next);
      return;
    }
    this.state = { ...this.state, ...next };

    const list = panel.querySelector<HTMLElement>('.shot-list');
    const scrollTop = list?.scrollTop ?? 0;
    const template = document.createElement('template');
    template.innerHTML = this.renderHistory();
    const fresh = template.content.firstElementChild as HTMLElement | null;
    if (!fresh) {
      this.render();
      return;
    }
    panel.replaceWith(fresh);
    refreshIcons();
    this.bindDetailChart();
    if (scrollTop > 0) {
      const freshList = fresh.querySelector<HTMLElement>('.shot-list');
      if (freshList) freshList.scrollTop = scrollTop;
    }
  }

}

function promoteBean(beans: Bean[], beanId: string): Bean[] {
  const bean = beans.find((item) => item.id === beanId);
  if (!bean) return beans;
  return [bean, ...beans.filter((item) => item.id !== beanId)];
}

function keepKeys<T>(record: Record<string, T>, keys: Set<string>): Record<string, T> {
  const next: Record<string, T> = {};
  for (const [key, value] of Object.entries(record)) {
    if (keys.has(key)) next[key] = value;
  }
  return next;
}

function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _removed, ...rest } = record;
  return rest;
}

function omitKeys<T>(record: Record<string, T>, keys: string[]): Record<string, T> {
  const remove = new Set(keys);
  const next: Record<string, T> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!remove.has(key)) next[key] = value;
  }
  return next;
}

function beansChanged(current: Bean[], next: Bean[]): boolean {
  if (current.length !== next.length) return true;
  for (let index = 0; index < current.length; index += 1) {
    const a = current[index]!;
    const b = next[index]!;
    if (
      a.id !== b.id ||
      a.roaster !== b.roaster ||
      a.name !== b.name ||
      a.createdAt !== b.createdAt ||
      a.updatedAt !== b.updatedAt ||
      a.archived !== b.archived
    ) return true;
  }
  return false;
}

function shotEditDraftFromShot(shot: ShotRecord): ShotEditDraft {
  const ctx = shot.workflow?.context ?? {};
  const ann = shot.annotations ?? {};
  return {
    shotId: shot.id,
    coffeeRoaster: ctx.coffeeRoaster ?? null,
    coffeeName: ctx.coffeeName ?? null,
    beanId: ctx.beanId ?? null,
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
  grinders: Grinder[]
): ShotEditDraft {
  const text = textOrNull(value);
  const number = numberOrNullInput(value);
  if (isShotNumberField(field)) return { ...draft, [field]: number };
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
  shots: ShotRecord[]
): ShotFieldSpec {
  const label = shotFieldLabel(field);
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
  return { label, kind: 'text', value: inputValue(value), options: textShotFieldOptions(field, shots) };
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
  shots: ShotRecord[]
): ShotFieldOption[] {
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
    finalBeverageType: 'Drink',
    baristaName: 'Barista',
    drinkerName: 'Drinker',
    targetDoseWeight: 'Target in',
    targetYield: 'Target out',
    actualDoseWeight: 'Actual in',
    actualYield: 'Actual out',
    grinderId: 'Grinder',
    grinderSetting: 'Grind',
    drinkTds: 'TDS',
    drinkEy: 'EY',
    espressoNotes: 'Notes'
  };
  return labels[field];
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

function decimalPlaces(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const [, fraction = ''] = value.toString().split('.');
  return fraction.length;
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

function beanFieldsUnchanged(fields: Partial<Bean>, bean: Bean): boolean {
  return (
    normalizeBeanField(fields.roaster) === normalizeBeanField(bean.roaster) &&
    normalizeBeanField(fields.name) === normalizeBeanField(bean.name) &&
    normalizeBeanField(fields.country) === normalizeBeanField(bean.country) &&
    normalizeBeanField(fields.region) === normalizeBeanField(bean.region) &&
    normalizeBeanField(fields.processing) === normalizeBeanField(bean.processing) &&
    normalizeBeanField(fields.notes) === normalizeBeanField(bean.notes)
  );
}

function normalizeBeanField(value: unknown): string {
  return String(value ?? '').trim();
}

function batchFieldsFromForm(data: FormData, beanId: string, fallback?: BeanBatch): Partial<BeanBatch> {
  const frozen = data.has('frozen') ? data.get('frozen') === 'on' : fallback?.frozen ?? false;
  const storageEvents = fallback?.storageEvents ?? (frozen ? [{ type: 'frozen' as const, at: new Date().toISOString() }] : null);
  const weight = data.has('weight') ? numberOrNullInput(data.get('weight')) : fallback?.weight ?? null;
  const weightRemaining = data.has('weightRemaining')
    ? numberOrNullInput(data.get('weightRemaining'))
    : fallback?.weightRemaining ?? null;
  return {
    beanId,
    roastDate: textOrNull(data.get('roastDate')),
    roastLevel: textOrNull(data.get('roastLevel')),
    weight,
    // A bag can't hold more than its size, so "left" is capped at the bag weight.
    weightRemaining: clampRemainingToWeight(weightRemaining, weight),
    storageEvents,
    frozen
  };
}

// "Grams left" can never exceed the bag's size. When both are known numbers,
// pull a too-high remaining down to the bag weight; otherwise leave it as-is.
function clampRemainingToWeight(remaining: number | null, weight: number | null): number | null {
  if (typeof remaining === 'number' && typeof weight === 'number' && remaining > weight) return weight;
  return remaining;
}

function isFinishedBatch(batch: BeanBatch): boolean {
  return typeof batch.weightRemaining === 'number' && Number.isFinite(batch.weightRemaining) && batch.weightRemaining < 5;
}

function isUsableBatch(batch: BeanBatch): boolean {
  return !isFinishedBatch(batch);
}

function inputValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(round(value, 3));
  return String(value);
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
    value === 'finalBeverageType' ||
    value === 'baristaName' ||
    value === 'drinkerName' ||
    value === 'targetDoseWeight' ||
    value === 'targetYield' ||
    value === 'actualDoseWeight' ||
    value === 'actualYield' ||
    value === 'grinderId' ||
    value === 'grinderSetting' ||
    value === 'drinkTds' ||
    value === 'drinkEy' ||
    value === 'espressoNotes'
  );
}
