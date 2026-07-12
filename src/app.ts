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
  ShotStateEvent,
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
import {
  browserSocketSupervisorScheduler,
  browserWebSocketFactory,
  SocketSupervisor
} from './api/runtime/socketSupervisor';
import { readMachineSnapshot, readScaleSnapshot, readShotStateEvent } from './api/guards';
import { escapeAttr, escapeHtml } from './components/html';
import {
  emptyDecisionLog,
  nextDecisionLog,
  stopReasonLabel,
  type ShotDecisionLog
} from './domain/shotDecisions';
import {
  capitalize,
  clockLabel,
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
  machineStatusView,
  nonNegativeNumber,
  positiveNumber,
  presentationOccluded,
  round,
  scaleConnected,
  sleepOverlayModel,
  startupStatusLabel,
  water,
  workflowSignature,
  type LiveChartMode,
  type MachineStatusView
} from './appShell';
import {
  appendBatchStorageEvent,
  batchStorageEvents,
  beanLabel,
  buildWorkflowUpdate,
  compareBeansForPicker,
  emptyRecipe,
  setBatchStorageEventDates,
  formatGrams,
  formatRatio,
  latestBatch,
  normalizeDraft,
  parseNumberInput,
  profileBaseTemperature,
  ratioFor,
  recipeFromShot,
  recipeFromWorkflow,
  roastAgeLabel,
  selectInitialBean,
  shotFilterForBean,
  yieldForRatio
} from './domain/beanWorkflow';
import {
  createRecipeCandidate,
  type RecipeCandidate
} from './domain/recipeIdentity';
import { batchOptionLabel, dateInputValue } from './domain/beanDisplay';
import {
  markStorageEventsMigrated,
  readFavoriteBeans,
  readFavoriteProfiles,
  readGeminiApiKey,
  clearGeminiApiKey,
  clearPendingDerekTweak,
  readLastBeanId,
  readPendingDerekTweak,
  readStorageEventsMigrated,
  migrateLegacyGeminiApiKey,
  writeFavoriteBeans,
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
import { renderLabelScannerModal as renderLabelScannerModalView } from './views/labelScannerView';
import { isHandoffArrival } from './domain/labelScanHandoff';
import { icon } from './components/icons';
import { captureFocus, morphRender, restoreFocus } from './render/renderer';
import { LiveReadouts } from './render/livePath';
import { TopbarIsland } from './render/topbarIsland';
import { TopbarProjector, type TopbarViewModel } from './render/topbarPresentation';
import { ScreensaverIsland } from './render/screensaverIsland';
import { DerekStreamIsland } from './render/derekStreamIsland';
import { patchProfileRangeValue } from './render/profileEditorIsland';
import {
  PresentationActivityCoordinator,
  type PresentationActivityTarget
} from './runtime/presentationActivity';
import { DisposableScope } from './runtime/disposableScope';
import { BackgroundTask } from './runtime/backgroundTask';
import { GatewayMutationCoordinator } from './runtime/gatewayMutationCoordinator';
import { OperationAuthority } from './runtime/operationAuthority';
import { BoundedImageTranscoder } from './platform/imageTranscoder';
import {
  TelemetryStore,
  type WaterLevelSnapshot
} from './telemetry/telemetryStore';
import { ScannerFlow } from './controllers/scannerFlow';
import type { LabelScannerState } from './controllers/scannerFlowContract';
export type { LabelScannerState } from './controllers/scannerFlowContract';
export type { ProfileEditTarget } from './controllers/profileEditorFlow';
export type { ClickActionHandler } from './controllers/actionContract';
import {
  ProfileEditorFlow,
  type ProfileEditTarget,
  type ProfileImportState
} from './controllers/profileEditorFlow';
import {
  batchFieldsFromForm,
  beanFieldsFromForm,
  beanFieldsUnchanged,
  clampRemainingToWeight,
  numberOrNullInput,
  textOrNull
} from './domain/beanForm';
import { DerekFlow, type DerekTweakChip } from './controllers/derekFlow';
import type {
  AppModal as Modal,
  ClickActionContext,
  ClickActionHandler
} from './controllers/actionContract';
import {
  MachineWorkflowCommands,
  type OwnedMachineLane
} from './controllers/machineWorkflowCommands';
import { SettingsStoreSync } from './controllers/settingsStoreSync';
import {
  RecipeApplyController,
  type RecipeApplyCalibration,
  type RecipeApplyEvent
} from './controllers/recipeApplyController';
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
  fieldValue,
  setBundleField,
  type SettingsBundle
} from './domain/settingsModel';
import {
  settingsResourceStates,
  settingsResourceWritable,
  type SettingsResourceKey,
  type SettingsResourceStates
} from './domain/resourceState';
import type { DecentAccountStatus, DisplayState, PluginSettings } from './api/settings';
import { readDisplayState } from './api/settings';
import { createSettingsController } from './controllers/settingsController';
import {
  BeanWorkflowController,
  beanUsageFromShots,
  beanUsageForBean
} from './controllers/beanWorkflowController';
import {
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
  createProfileEditorState,
  renderEditorModeBar,
  renderProfileEditor,
  setAllLimiterRanges,
  setProfileMeta,
  setSimpleProfileField,
  setStepExit,
  setStepField,
  type ProfileEditorState,
  type SimpleProfileField
} from './components/profileEditor';
import type { EditorStep, ProfileMetaKey, StepFieldKey } from './domain/profileModel';
import {
  liveStageAdvanceReason,
  stageStopReason,
  type StageReason
} from './domain/liveStageReason';
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
  lastReachedFrame,
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
import { cachedStartupData, loadGatewayStartupWithCache } from './data/startupRepository';
import {
  fetchShotPage as fetchShotPageFromRepository,
  loadLatestBeanUsage,
  loadLatestShotCandidates as loadLatestShotCandidatesFromRepository
} from './data/shotRepository';
import { loadBeanBatches } from './data/beanRepository';
import { migrateStorageEventsToGateway } from './data/storageEventsMigration';
import {
  readPendingDoses,
  writePendingDoses
} from './domain/pendingDoses';
import { DoseMutationReconciler } from './controllers/doseMutationReconciler';
import { rebaseChangedFields } from './domain/rebaseMutation';
import {

  type DerekState
} from './controllers/derekController';
import {

  readShotDerek,
  type AppliedDerekTip
} from './domain/derekShot';
import {

  renderDerekModal as renderDerekModalView
} from './views/derekView';
import {
  profileShortTitle,
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
  renderShotStagesModal as renderShotStagesModalView,
  selectedHistoryShot as selectHistoryShot
} from './views/historyView';
import { historicShotStages } from './domain/historicShotStages';
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
  renderImportProfileModal as renderImportProfileModalView,
  renderProfileNotesModal as renderProfileNotesModalView
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
  isClockFormat,
  isWakeAppZonePosition,
  readSettingsPreferences,
  type SettingsPreferences,
  type WakeAppZonePosition,
  writeSettingsPreferencePatch
} from './domain/settings';
import {
  SCREENSAVER_CLOCK_MOVE_INTERVAL_MS,
  MAX_SCREENSAVER_PHOTOS,
  SCREENSAVER_PHOTOS_CACHE_KEY,
  SCREENSAVER_PHOTO_INTERVAL_MS,
  SCREENSAVER_PHOTO_JPEG_QUALITY,
  SCREENSAVER_PHOTO_MAX_DIMENSION,
  isScreensaverMode,
  mergeScreensaverPhotos,
  nextScreensaverPhotoIndex,
  screensaverClockPosition,
  screensaverDimBrightness,
  screensaverShowsClock,
  screensaverShowsPhotos
} from './domain/screensaver';
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
import type { WaterAlertLevel } from './domain/waterAlert';
import { WaterAlertProjector } from './render/waterAlertPresentation';
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
  type MachineServiceWorkflowRestore,
  type SendMachineActionCommandResult
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

type EditField = 'dose' | 'yield' | 'ratio' | 'grinderSetting' | 'temperature';
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

const PHONE_MEDIA_QUERY = '(max-width: 640px), (max-height: 500px) and (max-width: 900px)';
const PRESENCE_HEARTBEAT_INTERVAL_MS = 15_000;
// While the app is shown over a sleeping machine (wake-app zone), turn the screen
// back off after this much inactivity.
const WAKE_APP_IDLE_SCREEN_OFF_MS = 5 * 60 * 1000;
const SHOT_REFRESH_INTERVAL_MS = 60_000;
const BEAN_REFRESH_INTERVAL_MS = 30_000;
const SETTINGS_SYNC_INTERVAL_MS = 10_000;
const NO_SCALE_SHOT_MESSAGE = 'Shot blocked: connect a scale to start.';
const NO_SCALE_MACHINE_STATUS = 'Connect scale';
const NO_SCALE_ABORT_WINDOW_MS = 3_000;
const SCALE_FRESH_WINDOW_MS = 5_000;
const NO_SCALE_WARNING_VISIBLE_MS = 6_000;

function readWaterLevelSnapshot(value: unknown): WaterLevelSnapshot {
  const data = value != null && typeof value === 'object'
    ? value as { currentLevel?: unknown; refillLevel?: unknown }
    : {};
  return {
    currentLevelMm:
      typeof data.currentLevel === 'number' && Number.isFinite(data.currentLevel)
        ? data.currentLevel
        : null,
    refillLevelMm:
      typeof data.refillLevel === 'number' && Number.isFinite(data.refillLevel)
        ? data.refillLevel
        : null
  };
}

// Which editor field a tap-to-edit numpad dialog is bound to.
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
    | 'machine-refill'
    | 'screensaver-brightness';
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

export interface AppState {
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
  /** Initial gateway KV load succeeded; synced preferences are safe to edit. */
  settingsStoreAvailable: boolean;
  settingsSearch: string;
  demo: boolean;
  startupPhase: 'starting' | 'connecting' | 'connected' | 'limited' | 'offline-cache' | 'demo' | 'retrying';
  loading: boolean;
  busy: boolean;
  status: string;
  secondTapHint: SecondTapHintState | null;
  view: View;
  phoneTab: PhoneTab;
  settingsSection: string;
  settingsBundle: SettingsBundle | null;
  settingsSource: 'gateway' | 'degraded' | 'demo' | 'loading' | null;
  /** Per-endpoint provenance; fallback defaults are visible but never writable. */
  settingsResources: SettingsResourceStates | null;
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
  /** Settings "Preview" is showing the screensaver overlay; a tap dismisses it
   * (no machine command, no brightness change). */
  saverPreview: boolean;
  /** This device's screensaver slideshow (compressed JPEG data URLs from IndexedDB). */
  screensaverPhotos: string[];
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
  /** The Derek dial-in helper modal; null when closed. */
  derek: DerekState | null;
  /** A Derek change is loaded for the next shot; offers one-tap revert and
   * marks the changed workbench control. Cleared when the shot is pulled, the
   * bean changes, or a profile is picked by hand. */
  derekTweakChip: DerekTweakChip | null;
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
  private readonly gatewayMutations = new GatewayMutationCoordinator<string>();
  private readonly settingsStoreSync = new SettingsStoreSync(
    {
      load: (canCommit) => loadAllFromStore(gateway, canCommit),
      poll: (canCommit) => pollFromStore(gateway, canCommit),
      write: (key, value) => value === null
        ? gateway.storeDelete(SETTINGS_STORE_NAMESPACE, key)
        : gateway.storeSet(SETTINGS_STORE_NAMESPACE, key, value)
    },
    this.gatewayMutations
  );
  private readonly machineWorkflowCommands = new MachineWorkflowCommands(
    this.gatewayMutations,
    {
      updateWorkflow: (workflow) => gateway.updateWorkflow(workflow),
      requestState: (state) => gateway.requestState(state),
      updateCalibration: (calibration) => gateway.updateCalibration(calibration),
      updateMachineSettings: (settings) => gateway.updateMachineSettings(settings),
      updateMachineAdvancedSettings: (patch) => gateway.updateMachineAdvancedSettings(patch),
      resetMachineSettings: () => gateway.resetMachineSettings(),
      setRefillLevel: (level) => gateway.setRefillLevel(level)
    },
    { hasLiveAuthority: () => this.hasLiveMachineAuthority() }
  );
  private readonly recipeApply = new RecipeApplyController({
    commands: this.machineWorkflowCommands,
    runtime: () => ({
      demo: this.state.demo,
      connected: this.state.startupPhase === 'connected',
      sleeping: this.machineIsSleeping()
    })
  });
  private readonly settingsController = createSettingsController({
    ...gateway,
    scanDevices: () => this.runExactCommand('devices', () => gateway.scanDevices()),
    connectPreferredDevices: () => this.runExactCommand(
      'devices',
      () => gateway.connectPreferredDevices()
    ),
    connectDevice: (id) => this.runExactCommand(
      'devices',
      () => gateway.connectDevice(id)
    ),
    disconnectDevice: (id) => this.runExactCommand(
      'devices',
      () => gateway.disconnectDevice(id)
    ),
    requestState: (state) => this.runExactMachineCommand(
      (lane) => lane.requestState(state as MachineState)
    ),
    addWakeSchedule: (schedule) => this.runExactCommand(
      'wake-schedules',
      () => gateway.addWakeSchedule(schedule)
    ),
    updateWakeSchedule: (id, body) => this.runExactCommand(
      `wake-schedule:${id}`,
      () => gateway.updateWakeSchedule(id, body)
    ),
    deleteWakeSchedule: (id) => this.runExactCommand(
      `wake-schedule:${id}`,
      () => gateway.deleteWakeSchedule(id)
    ),
    loginDecentAccount: (email, password) => this.runExactCommand(
      'decent-account',
      () => gateway.loginDecentAccount(email, password)
    ),
    logoutDecentAccount: () => this.runExactCommand(
      'decent-account',
      () => gateway.logoutDecentAccount()
    ),
    updatePluginSettings: (id, values) => this.runExactCommand(
      `plugin:${id}`,
      () => gateway.updatePluginSettings(id, values)
    ),
    updateSettings: (patch) => this.runExactCommand(
      'gateway-settings',
      () => gateway.updateSettings(patch)
    ),
    updateMachineSettings: (patch) => this.runExactMachineCommand(
      (lane) => lane.updateMachineSettings(patch)
    ),
    updateMachineAdvancedSettings: (patch) => this.runExactMachineCommand(
      (lane) => lane.updateMachineAdvancedSettings(patch)
    ),
    updateCalibration: (value) => this.runExactMachineCommand(
      (lane) => lane.updateCalibration(value)
    ),
    updatePresenceSettings: (patch) => this.runExactCommand(
      'presence-settings',
      () => gateway.updatePresenceSettings(patch)
    ),
    resetMachineSettings: () => this.runExactMachineCommand(
      (lane) => lane.resetMachineSettings()
    )
  });
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
    settingsStoreAvailable: false,
    settingsSearch: '',
    demo: false,
    startupPhase: 'starting',
    loading: true,
    busy: false,
    status: 'Starting',
    secondTapHint: null,
    view: 'workbench',
    phoneTab: 'home',
    settingsSection: 'app',
    settingsBundle: null,
    settingsSource: null,
    settingsResources: null,
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
    saverPreview: false,
    screensaverPhotos: [],
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
    liveGhost: true,
    derek: null,
    derekTweakChip: null
  };

  // Derek's modal/ask/apply flow lives in its own vertical (src/controllers/derekFlow.ts).
  private readonly derekFlow: DerekFlow;
  // The label scanner's capture/extract/review flow (src/controllers/scannerFlow.ts).
  private readonly scannerFlow: ScannerFlow;
  // The profile editor's dispatch/open/submit glue (src/controllers/profileEditorFlow.ts).
  private readonly profileEditorFlow: ProfileEditorFlow;
  private clockTimer: number | null = null;
  // Raw telemetry is projected into one complete, stabilized view model, then
  // committed by the topbar's sole bounded DOM owner.
  private readonly topbarProjector = new TopbarProjector();
  private readonly topbarIsland = new TopbarIsland();
  private readonly screensaverIsland = new ScreensaverIsland();
  private readonly derekStreamIsland = new DerekStreamIsland();
  private readonly presentationActivity = new PresentationActivityCoordinator();
  private readonly appScope = new DisposableScope();
  private readonly shotRefreshTask = new BackgroundTask({
    intervalMs: SHOT_REFRESH_INTERVAL_MS,
    run: () => this.refreshVisibleShots()
  });
  private readonly beanRefreshTask = new BackgroundTask({
    intervalMs: BEAN_REFRESH_INTERVAL_MS,
    run: () => this.refreshBeans()
  });
  private readonly settingsSyncTask = new BackgroundTask({
    intervalMs: SETTINGS_SYNC_INTERVAL_MS,
    run: () => this.syncFromGateway()
  });
  private readonly startupRetryTask = new BackgroundTask({
    intervalMs: 30_000,
    run: () => this.retryStartupConnection(),
    onError: (error) => console.warn('[Beanie] Startup reconnect failed', error)
  });
  private readonly loadMoreAuthority = new OperationAuthority();
  private readonly doseMutationReconciler: DoseMutationReconciler;
  private readonly imageTranscoder = new BoundedImageTranscoder();
  private readonly telemetryStore = new TelemetryStore();
  private readonly machineStream: SocketSupervisor<MachineSnapshot>;
  private readonly scaleStream: SocketSupervisor<ScaleSnapshot>;
  private readonly waterStream: SocketSupervisor<WaterLevelSnapshot>;
  private readonly displayStream: SocketSupervisor<DisplayState>;
  private readonly shotStateStream: SocketSupervisor<ShotStateEvent>;
  private saverPhotoTimer: number | null = null;
  private screensaverImportGeneration = 0;
  // Slideshow/clock placement live outside AppState so their minute ticks
  // patch the overlay DOM in place instead of re-rendering the app.
  private saverPhotoIndex = 0;
  private saverClockPos = screensaverClockPosition(0.5, 0.5);
  private saverClockMovedAtMs = Date.now();
  // The gateway sequencer's decisions for the current shot (why each stage
  // advanced, why the pour stopped), accumulated off /ws/v1/machine/shotState.
  private decisionLog: ShotDecisionLog = emptyDecisionLog();
  private started = false;
  private disposed = false;
  private disposeDrain: Promise<void> | null = null;
  // Memoised so the boot settings load runs once; the scanner awaits it too.
  private settingsLoadPromise: Promise<void> | null = null;
  private settingsBundleLoadPromise: Promise<void> | null = null;
  private startupLoadInFlight = false;
  private readonly settingsMutationRevisions = new Map<string, number>();
  private shotRefreshInFlight = false;
  private beanRefreshInFlight = false;
  private beanUsageRefreshRequestId = 0;
  private shotCacheGeneration = 0;

  private readonly beanWorkflow = new BeanWorkflowController();
  private readonly liveShot = new LiveShotSession();
  private liveChart: LiveChart | null = null;
  private liveCanvas: HTMLCanvasElement | null = null;
  private readonly liveReadouts = new LiveReadouts();
  // Memoised parse of the active profile's steps for live stage-reason lookups.
  private cachedStepsProfile: Profile | null = null;
  private cachedSteps: EditorStep[] = [];
  // Cached chart model for the selected history/calibrator shot. Building the
  // model walks the shot's full measurement array, which is too expensive to
  // repeat on every setState re-render. Measurements are immutable once saved,
  // so the cache is keyed by shot id plus the measurements array reference (the
  // reference changes when a placeholder record is later upgraded with data).
  private shotChartModelCache: { shotId: string; measurements: readonly ShotMeasurement[]; profile: Profile | null; model: LiveChartModel } | null = null;
  // Same shape, for the shot overlaid on the detail chart by compare mode.
  private compareChartModelCache: { shotId: string; measurements: readonly ShotMeasurement[]; profile: Profile | null; model: LiveChartModel } | null = null;
  // Reference shot captured when a live pull starts, drawn under the live
  // trace (its chart model is built once here, off the telemetry hot path).
  private liveGhostModel: LiveChartModel | null = null;
  private liveGhostShotId: string | null = null;
  private detailChartCanvas: HTMLCanvasElement | null = null;
  private detailChart: LiveChart | null = null;
  private shotStagesChartCanvas: HTMLCanvasElement | null = null;
  private shotStagesChart: LiveChart | null = null;
  private shotStagesChartShotId: string | null = null;
  private shotStagesChartMeasurements: readonly ShotMeasurement[] | null = null;
  private shotStagesChartProfile: Profile | null = null;
  private calibratorChartCanvas: HTMLCanvasElement | null = null;
  private calibratorChart: LiveChart | null = null;
  private calibratorChartShotId: string | null = null;
  private calibratorChartMeasurements: readonly ShotMeasurement[] | null = null;
  private calibratorChartProfile: Profile | null = null;
  private calibratorChartFactor: number | null = null;
  // One-shot: focus the notes textarea on the render right after the modal opens.
  private pendingNotesFocus = false;
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
  private readonly waterAlertProjector = new WaterAlertProjector();
  private machineProgressReturnView: View | null = null;
  private machineStopFeedbackTimer: number | null = null;
  private timedSteamStopTimer: number | null = null;
  private timedSteamStopScheduledForMs: number | null = null;
  private machineServiceWorkflowToRestore: MachineServiceWorkflowRestore | null = null;
  private sleepBrightnessTimer: number | null = null;
  private sleepBrightnessDimmed = false;
  /** Backlight level the sleep dim last applied; used to detect a missing restore. */
  private lastSleepDimLevel: number | null = null;
  private sleepWakeRestoreTimer: number | null = null;
  // Brightness to restore when the user wakes the app without the machine.
  // Kept current off the live display socket; falls back to 100.
  private wakeAppRestoreBrightness = 100;
  // The in-flight sleep-dim brightness PUT, so a wake-app restore can sequence
  // after it (otherwise the two PUTs race and the screen can stay black).
  private sleepDimPromise: Promise<void> | null = null;
  private wakeZonePreviewTimer: number | null = null;
  private statusFeedbackTimer: number | null = null;
  private statusFeedbackUntilMs = 0;
  private wakeAppIdleTimer: number | null = null;
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
  private readonly chartActivityTarget: PresentationActivityTarget = {
    suspend: () => {
      for (const chart of this.managedCharts()) chart?.suspend();
    },
    resume: () => {
      for (const chart of this.managedCharts()) chart?.resume();
    }
  };
  private touchScrollPoint: { x: number; y: number } | null = null;
  // Decided once per touch gesture. On both WebKit and Chrome/Android, calling
  // preventDefault on the first touchmove of a gesture cancels native scrolling
  // for the *entire* gesture. If we locked at a scroll boundary (e.g. pulling up
  // while already at the top), the rest of the same swipe — including scrolling
  // back down — would do nothing. So we lock the page only when the touch began
  // over a region with no scrollable ancestor, and keep that for the gesture.
  private touchGestureLocked: boolean | null = null;

  constructor(private readonly root: HTMLElement) {
    this.presentationActivity.add(this.topbarIsland);
    this.presentationActivity.add(this.liveReadouts);
    this.presentationActivity.add(this.derekStreamIsland);
    this.presentationActivity.add(this.chartActivityTarget);
    // Producers are registered after surfaces. Suspension runs in reverse so
    // background work stops before its consumers; resume restores consumers
    // first and then performs one task-level catch-up.
    this.presentationActivity.add(this.shotRefreshTask);
    this.presentationActivity.add(this.beanRefreshTask);
    this.presentationActivity.add(this.settingsSyncTask);
    this.presentationActivity.add(this.startupRetryTask);
    this.machineStream = new SocketSupervisor<MachineSnapshot>({
      url: () => `${gatewayWsOrigin()}/ws/v1/machine/snapshot`,
      socketFactory: browserWebSocketFactory,
      scheduler: browserSocketSupervisorScheduler,
      backoffDelayMs: reconnectDelayMs,
      decode: (data) => readMachineSnapshot(JSON.parse(data)),
      onMessage: (snapshot) => {
        this.telemetryStore.ingest('machine', snapshot);
      },
      onOpen: () => {
        if (this.state.gatewayLinkDown) this.handleGatewayReconnected();
      },
      onClose: ({ willRetry }) => {
        if (willRetry && !this.state.gatewayLinkDown) {
          this.setState({
            gatewayLinkDown: true,
            startupPhase: this.state.demo ? 'demo' : 'offline-cache',
            status: this.state.demo ? this.state.status : 'Offline — showing last-known data while reconnecting'
          });
          if (!this.state.demo) this.startupRetryTask.start();
        }
      },
      onFailure: (failure) => {
        if (failure.phase === 'decode') console.warn('[Beanie] Bad machine frame', failure.error);
      }
    });
    this.scaleStream = new SocketSupervisor<ScaleSnapshot>({
      url: () => `${gatewayWsOrigin()}/ws/v1/scale/snapshot`,
      socketFactory: browserWebSocketFactory,
      scheduler: browserSocketSupervisorScheduler,
      backoffDelayMs: reconnectDelayMs,
      decode: (data) => readScaleSnapshot(JSON.parse(data)),
      onMessage: (snapshot) => {
        this.telemetryStore.ingest('scale', snapshot);
      },
      onFailure: (failure) => {
        if (failure.phase === 'decode') console.warn('[Beanie] Bad scale frame', failure.error);
      }
    });
    this.waterStream = new SocketSupervisor<WaterLevelSnapshot>({
      url: () => `${gatewayWsOrigin()}/ws/v1/machine/waterLevels`,
      socketFactory: browserWebSocketFactory,
      scheduler: browserSocketSupervisorScheduler,
      backoffDelayMs: reconnectDelayMs,
      decode: (data) => readWaterLevelSnapshot(JSON.parse(data)),
      onMessage: (snapshot) => {
        this.telemetryStore.ingest('water', snapshot);
      },
      onFailure: (failure) => {
        if (failure.phase === 'decode') console.warn('[Beanie] Bad water level frame', failure.error);
      }
    });
    this.displayStream = new SocketSupervisor<DisplayState>({
      url: () => `${gatewayWsOrigin()}/ws/v1/display`,
      socketFactory: browserWebSocketFactory,
      scheduler: browserSocketSupervisorScheduler,
      backoffDelayMs: reconnectDelayMs,
      decode: (data) => readDisplayState(JSON.parse(data)),
      onMessage: (snapshot) => {
        this.telemetryStore.ingest('display', snapshot);
      },
      onFailure: (failure) => {
        if (failure.phase === 'decode') console.warn('[Beanie] Bad display frame', failure.error);
      }
    });
    this.shotStateStream = new SocketSupervisor<ShotStateEvent>({
      url: () => `${gatewayWsOrigin()}/ws/v1/machine/shotState`,
      socketFactory: browserWebSocketFactory,
      scheduler: browserSocketSupervisorScheduler,
      backoffDelayMs: reconnectDelayMs,
      decode: (data) => readShotStateEvent(JSON.parse(data)),
      onMessage: (snapshot) => {
        this.telemetryStore.ingest('shotState', snapshot);
      },
      onFailure: (failure) => {
        if (failure.phase === 'decode') console.warn('[Beanie] Bad shotState frame', failure.error);
      }
    });
    this.doseMutationReconciler = new DoseMutationReconciler({
      readBatch: (id) => this.batchForPendingDose(id),
      updateBatch: (id, patch, options) => gateway.updateBatch(id, patch, options),
      runExactAggregate: (aggregateKey, run) => this.runExactCommand(aggregateKey, run),
      readLegacy: () => readPendingDoses(),
      clearLegacy: () => writePendingDoses([]),
      now: () => new Date(),
      onBatchSaved: (batch, entry) => this.adoptFlushedBatch(batch, entry.expectedRemaining),
      onRetryScheduled: () => {
        if (!this.disposed) this.setState({ status: 'Bag update failed — will retry' });
      },
      onWorkerError: (error) => {
        if (!this.disposed) console.error('[Beanie] Dose reconciliation failed', error);
      }
    });
    this.appScope.own(this.telemetryStore.subscribeChannel('machine', (frame) => {
      this.handleMachineTelemetry(frame.value, frame.previous, frame.observedAtMs);
    }));
    this.appScope.own(this.telemetryStore.subscribeChannel('scale', (frame) => {
      this.handleScaleTelemetry(frame.value, frame.previous, frame.observedAtMs);
    }));
    this.appScope.own(this.telemetryStore.subscribeChannel('water', (frame) => {
      this.handleWaterTelemetry(frame.value);
    }));
    this.appScope.own(this.telemetryStore.subscribeChannel('display', (frame) => {
      this.handleDisplayTelemetry(frame.value);
    }));
    this.appScope.own(this.telemetryStore.subscribeChannel('shotState', (frame) => {
      this.handleShotStateTelemetry(frame.value);
    }));
    this.appScope.own(this.shotRefreshTask);
    this.appScope.own(this.beanRefreshTask);
    this.appScope.own(this.settingsSyncTask);
    this.appScope.own(this.startupRetryTask);
    this.appScope.own(this.gatewayMutations);
    this.appScope.own(this.settingsStoreSync);
    this.appScope.own(this.settingsStoreSync.subscribe((event) => {
      if (event.type === 'write-failed') {
        console.error('[Beanie] Failed to save setting to gateway store', event.write.key, event.error);
      }
      if (!this.disposed && this.state.storeError !== event.state.storeError) {
        this.setState({ storeError: event.state.storeError });
      }
    }));
    this.appScope.own(this.recipeApply);
    this.appScope.own(this.recipeApply.subscribe((event) => this.handleRecipeApplyEvent(event)));
    this.appScope.own(this.loadMoreAuthority);
    this.appScope.own(this.doseMutationReconciler);
    this.derekFlow = new DerekFlow({
      state: () => this.state,
      setState: (next) => this.setState(next),
      patchStateDerek: (derek) => {
        this.state.derek = derek;
      },
      patchDerekStream: (model) => this.derekStreamIsland.offer(model),
      disposed: () => this.disposed,
      brewTempValue: () => this.brewTempValue(),
      scheduleApply: () => this.scheduleApply(),
      updateShotAnnotations: (shotId, merge) => this.updateShotAnnotationsExact(shotId, merge),
      loadShotRecipe: (shotId, opts) => this.loadShotRecipe(shotId, opts),
      findProfileByTitle: (title) => this.findProfileByTitle(title)
    });
    this.scannerFlow = new ScannerFlow(
      {
        state: () => this.state,
        setState: (next) => this.setState(next),
        selectBean: (beanId, options) => this.selectBean(beanId, options),
        loadSettings: () => this.loadSettings()
      },
      this.beanWorkflow,
      this.imageTranscoder
    );
    this.profileEditorFlow = new ProfileEditorFlow(
      {
        state: () => this.state,
        setState: (next) => this.setState(next),
        scheduleApply: () => this.scheduleApply(),
        requestNotesFocus: () => {
          this.pendingNotesFocus = true;
        }
      },
      root
    );
  }

  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    // Route synced-setting writes to the gateway store (no-op in demo).
    setStorePushHandler((storeKey, value) => this.pushSettingToStore(storeKey, value));
    applySettingsPreferences(this.state.settingsPreferences);
    this.appScope.listen(this.root, 'click', this.handleClick as EventListener);
    this.appScope.listen(this.root, 'input', this.handleInput as EventListener);
    this.appScope.listen(this.root, 'change', this.handleChange as EventListener);
    this.appScope.listen(this.root, 'focusout', this.handleFocusOut as EventListener);
    this.appScope.listen(this.root, 'submit', this.handleSubmit as EventListener);
    this.appScope.listen(this.root, 'keydown', this.handleKeydown as EventListener);
    this.appScope.listen(this.root, 'wheel', this.handleWheel as EventListener, { passive: false });
    this.appScope.listen(this.root, 'touchstart', this.handleTouchStart as EventListener, { passive: true });
    this.appScope.listen(this.root, 'touchmove', this.handleTouchMove as EventListener, { passive: false });
    if (this.phoneMedia) {
      this.appScope.listen(this.phoneMedia, 'change', this.handlePhoneMediaChange as EventListener);
    }
    // Live settings sync: re-poll the store whenever this device regains focus.
    this.appScope.listen(window, 'focus', this.handleWindowFocus as EventListener);
    if (typeof document.addEventListener === 'function') {
      this.appScope.listen(document, 'visibilitychange', this.handleDocumentVisibility as EventListener);
    }
    this.render();
    this.armClockTimer();
    this.syncSaverPhotoTimer();
    // Durable physical mutations reconcile independently of UI/bootstrap
    // mode. An offline startup enters retry-wait instead of leaving the journal
    // dormant for the whole session.
    void this.doseMutationReconciler.start().catch((error) => {
      console.error('[Beanie] Dose reconciler startup failed', error);
    });
    void this.loadScreensaverPhotos();
    void this.load();
    if (isHandoffArrival(location.search)) {
      history.replaceState(null, '', location.pathname);
      void this.scannerFlow.openLabelScanner({ fromHandoff: true });
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    setStorePushHandler(null);
    this.presentationActivity.dispose();
    this.disposeLiveStreams();
    // DisposableScope is intentionally synchronous. Start both asynchronous
    // drains explicitly so a replacement app can await the old physical work
    // before acquiring the same batch/machine resources.
    this.settingsStoreSync.dispose();
    this.recipeApply.dispose();
    const doseDrain = this.doseMutationReconciler.dispose();
    const commandDrain = this.gatewayMutations.disposeAndWait();
    this.disposeDrain = Promise.all([doseDrain, commandDrain]).then(() => undefined);
    void this.disposeDrain.catch((error) => {
      console.error('[Beanie] Runtime disposal drain failed', error);
    });
    this.appScope.dispose();
    this.telemetryStore.dispose();
    if (this.statusFeedbackTimer != null) window.clearTimeout(this.statusFeedbackTimer);
    this.derekFlow.dispose();
    this.scannerFlow.cancelScannerWork();
    this.screensaverImportGeneration += 1;
    this.imageTranscoder.dispose();
    this.profileEditorFlow.dispose();
    this.topbarIsland.dispose();
    this.screensaverIsland.dispose();
    this.derekStreamIsland.dispose();
    this.liveReadouts.dispose();
    if (this.clockTimer != null) window.clearTimeout(this.clockTimer);
    if (this.saverPhotoTimer != null) window.clearTimeout(this.saverPhotoTimer);
    if (this.simTimer != null) window.clearTimeout(this.simTimer);
    if (this.timedSteamStopTimer != null) window.clearTimeout(this.timedSteamStopTimer);
    if (this.sleepBrightnessTimer != null) window.clearTimeout(this.sleepBrightnessTimer);
    if (this.sleepWakeRestoreTimer != null) window.clearTimeout(this.sleepWakeRestoreTimer);
    if (this.wakeZonePreviewTimer != null) window.clearTimeout(this.wakeZonePreviewTimer);
    if (this.wakeAppIdleTimer != null) window.clearTimeout(this.wakeAppIdleTimer);
    this.liveChart?.dispose();
    this.detailChart?.dispose();
    this.shotStagesChart?.dispose();
    this.calibratorChart?.dispose();
    this.liveChart = null;
    this.detailChart = null;
    this.shotStagesChart = null;
    this.calibratorChart = null;
    this.clearMachineStopRequest();
    this.clockTimer = null;
    this.saverPhotoTimer = null;
    this.simTimer = null;
    this.timedSteamStopTimer = null;
    this.sleepBrightnessTimer = null;
    this.sleepWakeRestoreTimer = null;
  }

  async disposeAsync(): Promise<void> {
    this.dispose();
    await (this.disposeDrain ?? Promise.resolve());
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
    if (Date.now() - this.lastPresenceHeartbeatMs < PRESENCE_HEARTBEAT_INTERVAL_MS) return;
    this.sendPresenceHeartbeat();
  }

  // Force a presence heartbeat now, bypassing the interaction throttle. Pulling a
  // shot is hands-off, so without this no heartbeat goes out during the pour and
  // reaprime's idle-sleep timeout fires right after the shot. We ping it at the
  // shot's start and end so the sleep window counts from the end of the pull.
  private sendPresenceHeartbeat(): void {
    if (this.state.demo) return;
    this.lastPresenceHeartbeatMs = Date.now();
    void gateway.heartbeat().catch((error) => {
      console.warn('[Beanie] Presence heartbeat failed', error);
    });
  }

  private async load(): Promise<void> {
    if (this.startupLoadInFlight || this.disposed) return;
    this.startupLoadInFlight = true;
    let hadUsableData = this.state.workflow != null && this.state.beans.length > 0;
    const prevSignature = this.state.appliedSignature;
    this.setState({
      loading: true,
      startupPhase: hadUsableData ? 'retrying' : 'connecting',
      status: hadUsableData ? 'Reconnecting to Decent.app…' : 'Loading Decent.app data'
    });
    // Settings live only in the gateway store now — load them (the spinner shows
    // until this resolves) before rendering real content.
    await this.loadSettings();
    try {
      const latestShotQuery = new URLSearchParams({ limit: '50', offset: '0', order: 'desc' });
      if (!hadUsableData) {
        const cached = await cachedStartupData(latestShotQuery, beanieCache);
        if (cached.workflow && cached.beans && cached.beans.length > 0 && !this.disposed) {
          const selected = selectInitialBean(
            cached.beans,
            cached.workflow,
            readLastBeanId(),
            cached.latestShots?.items[0]
          );
          const grinders = cached.grinders ?? [];
          const profiles = cached.profiles ?? [];
          this.machineWorkflowCommands.synchronizeAuthoritative(cached.workflow);
          this.setState({
            workflow: cached.workflow,
            beans: cached.beans,
            beanUsageAt: beanUsageFromShots(cached.beans, cached.latestShots?.items ?? [], {}),
            grinders,
            profiles,
            selectedBeanId: selected?.id ?? null,
            draft: normalizeDraft(recipeFromWorkflow(cached.workflow), profiles, grinders),
            appliedSignature: workflowSignature(cached.workflow),
            demo: false,
            startupPhase: 'offline-cache',
            gatewayLinkDown: true,
            loading: false,
            status: 'Offline — showing cached data while reconnecting'
          });
          hadUsableData = true;
        }
      }
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
      const [machineInfo, machine] = await Promise.all([
        gateway.machineInfo().catch((error) => {
          console.warn('[Beanie] Could not load machine info', error);
          return null;
        }),
        gateway.machineState().catch((error) => {
          console.warn('[Beanie] Could not load machine state', error);
          return null;
        })
      ]);
      if (this.disposed) return;
      const machineSleeping = machine?.state?.state === 'sleeping';
      const offlineWithCache = startup.status === 'gateway-unavailable';
      const limited = startup.status === 'partial-failure';
      const recoveringFromDemo = this.state.demo;

      this.machineWorkflowCommands.synchronizeAuthoritative(workflow);
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
        startupPhase: offlineWithCache ? 'offline-cache' : limited ? 'limited' : 'connected',
        gatewayLinkDown: offlineWithCache,
        loading: false,
        status: machineSleeping ? 'Machine asleep' : startupStatusLabel(startup.status),
        ...(recoveringFromDemo
          ? {
              settingsBundle: null,
              settingsSource: null,
              settingsResources: null,
              settingsStoreAvailable: false,
              pluginConfig: null,
              decentAccountSource: null
            }
          : {})
      });
      if (recoveringFromDemo) {
        this.settingsLoadPromise = null;
        void this.loadSettings().then(() => {
          if (this.state.view === 'settings' || this.state.phoneTab === 'settings') void this.loadReaSettings();
        });
      }
      if (offlineWithCache) {
        // Cached startup is read-only continuity. Do not immediately fire bean
        // refreshes, heartbeats, selection writes, or machine settings calls at
        // a gateway the startup snapshot already proved unavailable.
        this.startLiveStreams();
        this.startupRetryTask.start();
        return;
      }
      const selected = selectInitialBean(beans, workflow, readLastBeanId(), latestShots.items[0]);
      if (selected) {
        const wantsStartupApply = !this.workflowMatchesBean(selected);
        await this.selectBean(selected.id, {
          apply: !limited && wantsStartupApply && !machineSleeping,
          preferWorkflow: true,
          remember: !limited
        });
        if (!limited && wantsStartupApply && machineSleeping) {
          this.scheduleApply();
          this.setState({ status: 'Machine asleep — tap Wake to load recipe' });
        }
      }
      if (prevSignature != null && workflowSignature(workflow) !== prevSignature) {
        this.setState({ applyState: 'stale', status: 'Workflow changed on the machine' });
      }
      if (limited) {
        // Mixed gateway/cache startup is presentation-only until every source
        // is authoritative. In particular, never auto-apply a recipe chosen
        // from a cached shot or enforce a machine mode from partial data.
        this.startLiveStreams();
        this.shotRefreshTask.start();
        this.beanRefreshTask.start();
        this.startupRetryTask.start();
        return;
      }
      void this.refreshBeanUsage(beans);
      this.noteUserActivity();
      void this.enforceGatewayTrackingMode();
      void this.loadMachineControlState();
      this.startLiveStreams();
      this.shotRefreshTask.start();
      this.beanRefreshTask.start();
      this.startupRetryTask.stop();
      void this.migrateStorageEventsOnce();
    } catch (error) {
      if (this.disposed) return;
      console.warn('[Beanie] Gateway unavailable; using demo data', error);
      if (hadUsableData) {
        const demo = this.state.demo;
        this.setState({
          loading: false,
          startupPhase: demo ? 'demo' : 'offline-cache',
          gatewayLinkDown: !demo,
          status: demo
            ? 'DEMO — sample data · gateway still unavailable'
            : 'Offline — showing cached data · retrying automatically'
        });
        this.startupRetryTask.start();
      } else {
        this.loadDemo();
      }
    } finally {
      this.startupLoadInFlight = false;
    }
  }

  private async retryStartupConnection(): Promise<void> {
    if (this.disposed || this.state.startupPhase === 'connected') return;
    await this.load();
  }

  /**
   * Beanie always drives the machine as a tracking client, so pin the gateway's
   * control mode to 'tracking' on every real load. This makes the setting
   * implicit — it no longer appears in the settings view — and stops a stray
   * 'disabled'/'full' left on the gateway (or set by another skin) from changing
   * how Beanie behaves. Best-effort: a failure just leaves the current mode.
   */
  private async enforceGatewayTrackingMode(): Promise<void> {
    if (this.state.demo) return;
    try {
      await this.runExactCommand('gateway-settings', () =>
        gateway.updateSettings({ gatewayMode: 'tracking' })
      );
    } catch (error) {
      console.warn('[Beanie] Could not set gateway control mode to tracking', error);
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
      startupPhase: 'demo',
      gatewayLinkDown: false,
      loading: false,
      status: 'DEMO — sample data · gateway unavailable'
    });
    this.startupRetryTask.start();
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
    options: { apply: boolean; preferWorkflow: boolean; preferredBatchId?: string | null; remember?: boolean }
  ): Promise<void> {
    const canApply = options.apply && (this.state.demo || this.state.startupPhase === 'connected');
    const selection = this.beanWorkflow.beginBeanSelection(beanId, this.state.beans, {
      writeLastBeanId: options.remember === false ? () => {} : writeLastBeanId
    });
    if (!selection) return;
    this.recipeApply.cancel(new Error(`Superseded by bean selection ${beanId}`));
    // A staged Derek tweak belongs to the bean it was suggested for.
    this.setState({ ...selection.state, derekTweakChip: null });

    const result = await this.beanWorkflow.completeBeanSelection({
      selection,
      options: {
        preferWorkflow: options.preferWorkflow,
        preferredBatchId: options.preferredBatchId
      },
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
      status: options.apply && !canApply ? 'Coffee selected; recipe is read-only until live data reconnects' : result.status
    });

    if (canApply) {
      await this.applyDraft();
    }
  }

  private async loadBatches(bean: Bean): Promise<BeanBatch[]> {
    if (this.state.demo) return this.state.batchesByBean[bean.id] ?? [];
    return loadBeanBatches(bean.id, {
      gateway: {
        batches: (beanId) => gateway.batches(beanId),
        updateBatch: (id, batch) => this.runExactCommand(
          `batch:${id}`,
          () => gateway.updateBatch(id, batch)
        )
      },
      cache: beanieCache
    });
  }

  // First open of this version: copy every cached batch's freeze/thaw history up
  // to the gateway so it stops being browser-only. Runs once per device (gated by
  // a localStorage flag), best-effort and off the critical path. The flag is only
  // set on a clean pass, so an offline launch retries on the next open.
  private async migrateStorageEventsOnce(): Promise<void> {
    if (this.state.demo || readStorageEventsMigrated()) return;
    try {
      const { migrated, completed } = await migrateStorageEventsToGateway({
        gateway: {
          batches: (beanId) => gateway.batches(beanId),
          updateBatch: (id, batch) => this.runExactCommand(
            `batch:${id}`,
            () => gateway.updateBatch(id, batch)
          )
        },
        cache: beanieCache
      });
      if (completed) markStorageEventsMigrated();
      if (migrated > 0) console.info(`[Beanie] Migrated freeze/thaw history for ${migrated} batch(es)`);
    } catch (error) {
      console.warn('[Beanie] Freeze/thaw migration failed; will retry next open', error);
    }
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
    if (!options.create) {
      void this.refreshBeans({ force: true, allowModal: true });
      void this.refreshBeanUsage();
    }
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
    const offset = this.state.shots.length;
    const batch = this.selectedBatch();
    const operation = this.loadMoreAuthority.begin(
      `shots:${bean.id}:${batch?.id ?? 'all'}:${offset}`
    );
    this.setState({ shotsLoadingMore: true, status: 'Loading more shots' });
    try {
      const { records } = await this.fetchShotPage(bean, batch, offset);
      if (
        !operation.isCurrent ||
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
      if (operation.isCurrent && this.state.shotsLoadingMore) {
        this.setState({ shotsLoadingMore: false });
      }
      operation.finish();
    }
  }

  // Patch the topbar and screensaver clocks in place on each minute boundary
  // (no re-render). A timeout chain rather than a 1s interval, so an idle
  // tablet stays idle.
  private armClockTimer(): void {
    if (this.clockTimer != null) window.clearTimeout(this.clockTimer);
    const msToNextMinute = 60_000 - (Date.now() % 60_000);
    this.clockTimer = window.setTimeout(() => {
      this.clockTimer = null;
      if (this.disposed) return;
      const label = clockLabel(new Date(), this.state.settingsPreferences.clockFormat);
      // Wander to a fresh spot on a slow cadence so the time never burns in
      // (persistence stress builds over hours, not minutes).
      if (Date.now() - this.saverClockMovedAtMs >= SCREENSAVER_CLOCK_MOVE_INTERVAL_MS) {
        this.saverClockMovedAtMs = Date.now();
        this.saverClockPos = screensaverClockPosition(Math.random(), Math.random());
      }
      this.screensaverIsland.updateClock(label, this.saverClockPos);
      this.armClockTimer();
    }, msToNextMinute + 250);
  }

  // Advance the screensaver photo slideshow by crossfading the two stacked
  // <img> layers. The chain runs whenever the overlay could appear and no-ops
  // (cheaply) while it isn't on screen.
  private syncSaverPhotoTimer(): void {
    const visible = !document.visibilityState || document.visibilityState === 'visible';
    const overlayActive = (this.state.asleep && !this.state.appAwake) || this.state.saverPreview;
    const shouldRun =
      !this.disposed &&
      visible &&
      Boolean(overlayActive) &&
      this.screensaverIsland.hasPhotoSurface &&
      screensaverShowsPhotos(this.state.settingsPreferences.screensaverMode) &&
      this.state.screensaverPhotos.length > 1;
    if (!shouldRun) {
      if (this.saverPhotoTimer != null) window.clearTimeout(this.saverPhotoTimer);
      this.saverPhotoTimer = null;
      return;
    }
    if (this.saverPhotoTimer != null) return;
    this.saverPhotoTimer = window.setTimeout(() => {
      this.saverPhotoTimer = null;
      if (this.disposed) return;
      this.advanceSaverPhoto();
      this.syncSaverPhotoTimer();
    }, SCREENSAVER_PHOTO_INTERVAL_MS);
  }

  private async loadScreensaverPhotos(): Promise<void> {
    const photos = await beanieCache.getObject<string[]>(SCREENSAVER_PHOTOS_CACHE_KEY, []);
    if (this.disposed || photos.length === 0) return;
    this.setState({ screensaverPhotos: photos });
  }

  // Import picked files (a folder or a multi-select) into the device-local
  // slideshow: images only, downscaled and recompressed so ~100 photos stay
  // tens of MB in IndexedDB rather than gigabytes of camera originals.
  private async addScreensaverPhotos(files: File[]): Promise<void> {
    const allImages = files.filter((file) => file.type.startsWith('image/'));
    // The merge keeps the newest photos, so selecting a huge folder only needs
    // its final bounded window. Older selected files could never survive the
    // persistent cap and must not consume native decode resources first.
    const images = allImages.slice(-MAX_SCREENSAVER_PHOTOS);
    if (images.length === 0) {
      this.setState({ status: 'No images in the selection' });
      return;
    }
    const generation = ++this.screensaverImportGeneration;
    this.setState({
      status: allImages.length > images.length
        ? `Importing newest ${images.length} of ${allImages.length} photos…`
        : `Importing ${images.length} photo${images.length === 1 ? '' : 's'}…`
    });
    const added: string[] = [];
    for (const file of images) {
      if (this.disposed || generation !== this.screensaverImportGeneration) return;
      const compressed = await this.compressScreensaverPhoto(file);
      if (compressed) added.push(compressed);
    }
    if (this.disposed || generation !== this.screensaverImportGeneration) return;
    if (added.length === 0) {
      this.setState({ status: 'Could not read those images' });
      return;
    }
    const screensaverPhotos = mergeScreensaverPhotos(this.state.screensaverPhotos, added);
    await beanieCache.putObject(SCREENSAVER_PHOTOS_CACHE_KEY, screensaverPhotos);
    this.saverPhotoIndex = 0;
    this.setState({
      screensaverPhotos,
      status: `${screensaverPhotos.length} screensaver photo${screensaverPhotos.length === 1 ? '' : 's'} stored`
    });
  }

  private async clearScreensaverPhotos(): Promise<void> {
    this.screensaverImportGeneration += 1;
    await beanieCache.deleteObject(SCREENSAVER_PHOTOS_CACHE_KEY);
    this.saverPhotoIndex = 0;
    this.setState({ screensaverPhotos: [], status: 'Screensaver photos cleared' });
  }

  private async compressScreensaverPhoto(file: File): Promise<string | null> {
    try {
      const result = await this.imageTranscoder.transcode(file, {
        maxEdge: SCREENSAVER_PHOTO_MAX_DIMENSION,
        maxPixels: SCREENSAVER_PHOTO_MAX_DIMENSION ** 2,
        mimeType: 'image/jpeg',
        quality: SCREENSAVER_PHOTO_JPEG_QUALITY
      });
      return result.dataUrl;
    } catch (error) {
      console.warn('[Beanie] Could not import screensaver photo', file.name, error);
      return null;
    }
  }

  private advanceSaverPhoto(): void {
    const overlayActive =
      (this.state.asleep && !this.state.appAwake) || Boolean(this.state.saverPreview);
    if (
      this.disposed ||
      (document.visibilityState && document.visibilityState !== 'visible') ||
      !overlayActive
    ) return;
    const photos = this.state.screensaverPhotos;
    if (photos.length < 2) return;
    const nextIndex = nextScreensaverPhotoIndex(this.saverPhotoIndex, photos.length);
    if (this.screensaverIsland.advancePhoto(photos[nextIndex]!)) {
      this.saverPhotoIndex = nextIndex;
    }
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
      void this.refreshBeanUsage(beans);
      void beanieCache.putBeans(beans).catch(() => {});
    } catch (error) {
      console.warn('[Beanie] Could not refresh beans', error);
    } finally {
      this.beanRefreshInFlight = false;
    }
  }

  // Shot summaries identify coffee through batch ids, while the picker does not
  // eagerly load every bean's batches. Ask the gateway for one scoped summary
  // per bean so the ordering reflects each bean's actual latest pull.
  private async refreshBeanUsage(beans: readonly Bean[] = this.state.beans): Promise<void> {
    if (this.state.demo || this.disposed || beans.length === 0) return;
    const requestId = ++this.beanUsageRefreshRequestId;
    const usage = await loadLatestBeanUsage(beans, gateway);
    if (this.disposed || requestId !== this.beanUsageRefreshRequestId) return;

    const beanIds = new Set(this.state.beans.map((bean) => bean.id));
    const beanUsageAt = { ...this.state.beanUsageAt };
    let changed = false;
    for (const [beanId, timestamp] of Object.entries(usage)) {
      if (!beanIds.has(beanId) || timestamp <= (beanUsageAt[beanId] ?? 0)) continue;
      beanUsageAt[beanId] = timestamp;
      changed = true;
    }
    if (changed) this.setState({ beanUsageAt });
  }

  private canRefreshBeansInsideModal(): boolean {
    if (this.state.modal !== 'bean-picker' || this.state.beanPickerMode === 'create') return false;
    return this.root.querySelector('.bean-picker-fields input:focus, .bean-picker-fields textarea:focus, .bean-picker-batch input:focus') == null;
  }

  private async refreshVisibleShots(): Promise<void> {
    const bean = this.selectedBean();
    if (!bean || this.state.demo || this.shotRefreshInFlight) return;
    if (this.presentationActivity.isSuspended) return;
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
    const candidate = this.currentRecipeCandidate();
    if (!candidate) return;
    this.recipeApply.stage(candidate, this.recipeApplyCalibration(candidate));
    await this.recipeApply.flush();
  }

  private recipeApplyCalibration(
    candidate: RecipeCandidate & { draft: RecipeDraft }
  ): RecipeApplyCalibration | null {
    const profileTitle = candidate.draft.profileTitle ?? candidate.draft.profile?.title ?? null;
    const resolved = this.resolveProfileFlowCalibration(profileTitle);
    if (resolved == null || resolved === this.currentFlowCalibrationMultiplier()) return null;
    return { target: resolved, persistToMachine: !this.settingsLocal };
  }

  private handleRecipeApplyEvent(event: RecipeApplyEvent): void {
    if (this.disposed) return;
    switch (event.type) {
      case 'scheduled':
      case 'in-flight':
        if (this.state.applyState !== 'pending') this.setState({ applyState: 'pending' });
        return;
      case 'applying':
        this.setState({ applyState: 'pending', status: 'Applying workflow' });
        return;
      case 'deferred':
        this.setState({ applyState: 'stale', status: 'Machine asleep — tap Wake to apply' });
        return;
      case 'blocked':
        this.setState({
          applyState: 'stale',
          status: event.reason === 'offline'
            ? 'Recipe changes are read-only until live data reconnects'
            : 'Recipe not applied — reconnect to continue'
        });
        return;
      case 'applied': {
        const { workflow } = event;
        const signature = event.request.candidate.fingerprint;
        const calibrationTarget = event.request.calibration?.target ?? null;
        const draftChanged = this.currentRecipeCandidate()?.fingerprint !== signature;
        if (event.source === 'gateway') void beanieCache.putWorkflow(workflow).catch(() => {});
        this.setState({
          workflow,
          ...(calibrationTarget == null ? {} : {
            settingsBundle: calibrationBundle(
              this.state.settingsBundle ?? demoSettingsBundle(),
              calibrationTarget
            )
          }),
          applyState: draftChanged ? 'stale' : 'applied',
          appliedSignature: signature,
          status: draftChanged
            ? 'Draft changed; applying soon'
            : event.source === 'demo' ? 'Workflow applied in demo' : 'Workflow applied'
        });
        return;
      }
      case 'failed':
        console.error('[Beanie] Apply failed', event.error);
        this.setState(
          this.hasLiveMachineAuthority()
            ? { applyState: 'failed', status: 'Apply failed' }
            : { applyState: 'stale', status: 'Recipe not applied — reconnect to continue' }
        );
        return;
      case 'staged':
      case 'not-applied':
      case 'no-candidate':
      case 'canceled':
      case 'disposed':
        return;
    }
  }

  /**
   * Unwrap an exact machine/workflow command while retaining the coordinator's
   * explicit cancellation outcomes at the boundary. Physical work that has
   * started is never reported as canceled; only queued work can reach these
   * synthetic errors during teardown.
   */
  private async runExactCommand<Value>(
    resourceKey: string,
    run: () => Value | PromiseLike<Value>
  ): Promise<Value> {
    const outcome = await this.gatewayMutations.exact(resourceKey, run);
    if (outcome.status === 'completed') return outcome.value;
    if (outcome.status === 'failed') throw outcome.error;
    throw new Error(`${resourceKey} command ${outcome.status}`);
  }

  private async runExactMachineCommand<Value>(
    run: (lane: OwnedMachineLane) => Value | PromiseLike<Value>
  ): Promise<Value> {
    const outcome = await this.machineWorkflowCommands.runExact(run);
    if (outcome.status === 'completed') return outcome.value;
    if (outcome.status === 'failed') throw outcome.error;
    throw new Error(`machine command ${outcome.status}`);
  }

  private async requestSafeMachineStop(): Promise<void> {
    const outcome = await this.machineWorkflowCommands.stopSafely();
    if (outcome.status === 'completed') return;
    if (outcome.status === 'failed') throw outcome.error;
    throw new Error(`machine stop ${outcome.status}`);
  }

  private updateWorkflowExact(workflow: Workflow): Promise<Workflow> {
    this.machineWorkflowCommands.stageDesired(workflow);
    return this.runExactMachineCommand((lane) => lane.updateWorkflow(workflow));
  }

  private hasLiveMachineAuthority(): boolean {
    return this.state.demo || this.state.startupPhase === 'connected';
  }

  private machineIsSleeping(): boolean {
    return this.state.asleep || this.state.machine?.state?.state === 'sleeping';
  }

  // Debounced auto-apply: any dial-in edit pushes the draft to the workflow
  // 200ms after the last change, so there is no manual Apply button.
  private scheduleApply(): void {
    const candidate = this.currentRecipeCandidate();
    if (!candidate) return;
    this.recipeApply.stage(candidate, this.recipeApplyCalibration(candidate));
  }

  private currentRecipeCandidate(): (RecipeCandidate & { draft: RecipeDraft }) | null {
    const bean = this.selectedBean();
    if (!bean) return null;
    const draft = normalizeDraft(this.state.draft, this.state.profiles, this.state.grinders);
    const workflow = buildWorkflowUpdate(
      bean,
      this.selectedBatch(),
      draft,
      draft.profile,
      this.state.workflow
    );
    return { ...createRecipeCandidate(workflow), draft };
  }

  private loadShotRecipe(shotId: string, opts: { skipDerekTip?: boolean } = {}): void {
    const shot = this.state.shots.find((item) => item.id === shotId);
    if (!shot) return;
    this.completeSecondTapHint('shot');
    let draft = normalizeDraft(recipeFromShot(shot, 'planned'), this.state.profiles, this.state.grinders);
    let chip: DerekTweakChip | null = null;
    let status = 'Shot recipe loaded';
    if (!opts.skipDerekTip) {
      // A tip chosen from this shot's Derek answer travels with the recipe:
      // loading the shot loads the changed value too, marked in the workbench.
      const applied = readShotDerek(shot).applied;
      if (applied) {
        const overlay = this.draftWithAppliedTip(draft, applied, shot.id);
        if (overlay) {
          draft = overlay.draft;
          chip = overlay.chip;
          status = `Shot recipe + ${applied.summary}`;
        }
      }
    }
    this.setState({
      draft,
      derekTweakChip: chip,
      view: 'workbench',
      detailShotId: shotId,
      secondTapHint: null,
      status
    });
    this.scheduleApply();
  }

  private draftWithAppliedTip(
    draft: RecipeDraft,
    tip: AppliedDerekTip,
    shotId: string
  ): { draft: RecipeDraft; chip: DerekTweakChip } | null {
    const chip: DerekTweakChip = {
      summary: tip.summary,
      parameter: tip.parameter,
      revertProfileId: null,
      revertShotId: shotId
    };
    switch (tip.parameter) {
      case 'grind':
        return { draft: { ...draft, grinderSetting: String(tip.target) }, chip };
      case 'dose':
      case 'yield':
      case 'brew_temperature': {
        const value = typeof tip.target === 'number' ? tip.target : Number(tip.target);
        if (!Number.isFinite(value)) return null;
        const patch =
          tip.parameter === 'dose'
            ? { dose: value }
            : tip.parameter === 'yield'
              ? { yield: value }
              : { brewTemp: value };
        return { draft: { ...draft, ...patch }, chip };
      }
      default: {
        // Profile-level tips point at the variant profile created at apply
        // time; if it was deleted since, load the plain recipe instead.
        const record =
          (tip.profileId ? this.state.profiles.find((item) => item.id === tip.profileId) : null) ??
          (tip.profileTitle ? this.findProfileByTitle(tip.profileTitle) : null);
        if (!record) return null;
        const selection = selectProfileForDraft({
          draft,
          profiles: this.state.profiles,
          grinders: this.state.grinders,
          profileId: record.id
        });
        return { draft: selection.draft, chip };
      }
    }
  }

  private selectHistoryShot(shotId: string): void {
    if (this.state.comparePicking) {
      const sameAsSelected = this.selectedHistoryShot()?.id === shotId;
      this.setState({
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
    this.setState({
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
      updateShot: (id, nextUpdate) => this.runExactCommand(`shot:${id}`, async () => {
        if (!nextUpdate.annotations) return gateway.updateShot(id, nextUpdate);
        const latest = await gateway.shot(id);
        return gateway.updateShot(id, {
          ...nextUpdate,
          annotations: rebaseChangedFields(
            shot.annotations,
            nextUpdate.annotations,
            latest.annotations
          )
        });
      }),
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

  private async updateShotAnnotationsExact(
    shotId: string,
    merge: (annotations: ShotAnnotations | null | undefined) => ShotAnnotations
  ): Promise<ShotRecord> {
    this.shotCacheGeneration += 1;
    const saved = await this.runExactCommand(`shot:${shotId}`, async () => {
      // Merge at lane execution time so a Derek background save cannot replace
      // an interactive annotation edit that landed while it was queued.
      const latest = await gateway.shot(shotId);
      return gateway.updateShot(shotId, { annotations: merge(latest.annotations) });
    });
    await beanieCache.invalidateShotMutation(saved.id).catch(() => {});
    await beanieCache.putShotRecord(saved).catch(() => {});
    return saved;
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
      await this.runExactCommand(`shot:${shotId}`, () => gateway.deleteShot(shotId));
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
    opts: { skipScaleCheck?: boolean; allowOfflineStop?: boolean } = {}
  ): Promise<boolean> {
    // Starting a mode from cached/mixed state can replay a stale workflow as
    // soon as only the command endpoint recovers. Keep the fail-safe idle/stop
    // command available, but require a fully authoritative startup for starts.
    const allowOfflineStop = state === 'idle' && opts.allowOfflineStop === true;
    if (!this.hasLiveMachineAuthority() && !allowOfflineStop) {
      this.setState({ status: 'Machine controls are read-only until live data reconnects' });
      return false;
    }
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
    if (allowOfflineStop && !this.hasLiveMachineAuthority()) {
      const stopped = await this.machineWorkflowCommands.stopSafely();
      if (stopped.status === 'completed') {
        return this.finishMachineAction(state, service, {
          type: 'sent',
          status: machineActionStatus(state, 'sent'),
          restore: null
        });
      }
      const error = stopped.status === 'failed'
        ? stopped.error
        : new Error(`Machine stop ${stopped.status}`);
      console.error('[Beanie] Machine action did not run', error);
      this.setState({ busy: false, status: 'Machine command failed' });
      return false;
    }
    const prepared = this.prepareMachineActionCommand(
      state,
      this.machineWorkflowCommands.desiredOr(this.state.workflow)
    );
    const preparedCalibration = state === 'espresso'
      ? this.resolveProfileFlowCalibration(prepared.workflow?.profile?.title ?? null)
      : null;
    const coordinated = await this.machineWorkflowCommands.runExact(
      async (lane) => {
        // Safety inputs are observations, not desired configuration. Re-check
        // them at dispatch after any queued workflow writes have completed.
        const dispatchPreflight = machineActionPreflight({
          state,
          skipScaleCheck: opts.skipScaleCheck === true,
          noScaleBlocked: this.shouldPreflightBlockShotForScale(),
          waterAlertHard: this.currentWaterAlert() === 'hard'
        });
        if (dispatchPreflight.type !== 'ready') {
          return { type: 'blocked' as const, preflight: dispatchPreflight };
        }
        let dispatchCommand = prepared;
        if (state === 'espresso' && prepared.workflow) {
          // Shot start is a compound exact command: persist the draft captured
          // at the tap (even if its debounce has not fired or an earlier apply
          // failed), then calibration, then request physical state.
          const workflow = await lane.updateWorkflow(prepared.workflow);
          dispatchCommand = { ...prepared, workflow };
          if (preparedCalibration != null && !this.settingsLocal) {
            await lane.updateCalibration(preparedCalibration);
          }
        }
        return {
          type: 'command' as const,
          command: await this.sendMachineActionInOwnedLane(dispatchCommand, lane)
        };
      }
    );
    if (coordinated.status === 'authority-blocked') {
      this.setState({ busy: false, status: 'Machine controls are read-only until live data reconnects' });
      return false;
    }
    if (coordinated.status !== 'completed') {
      const error = coordinated.status === 'failed'
        ? coordinated.error
        : new Error(`Machine action ${coordinated.status}`);
      console.error('[Beanie] Machine action did not run', error);
      this.setState({ busy: false, status: 'Machine command failed' });
      return false;
    }
    if (coordinated.value.type === 'blocked') {
      if (coordinated.value.preflight.type === 'blocked-no-scale') {
        this.showNoScaleShotWarning({ busy: false });
      } else {
        this.setState({ busy: false, waterAlertDismissed: false, status: 'Refill the water tank' });
      }
      return false;
    }
    return this.finishMachineAction(state, service, coordinated.value.command);
  }

  private prepareMachineActionCommand(
    state: MachineState,
    workflow: Workflow | null
  ): Parameters<typeof sendMachineActionCommand>[0] {
    return {
      state,
      workflow,
      steamSettings: this.currentSteamSettings(workflow),
      hotWaterData: this.currentHotWaterData(workflow),
      rinseData: this.currentRinseData(workflow),
      twoTapSteamStop: this.usesTwoTapSteamStop()
    };
  }

  /** Caller must already own the `machine` workflow-command lane. */
  private sendMachineActionInOwnedLane(
    command: Parameters<typeof sendMachineActionCommand>[0],
    lane: OwnedMachineLane
  ): Promise<SendMachineActionCommandResult> {
    return sendMachineActionCommand(command, {
      updateWorkflow: (nextWorkflow) => lane.updateWorkflow(nextWorkflow),
      requestState: (nextState) => lane.requestState(nextState),
      isNoScaleShotBlockError
    });
  }

  private finishMachineAction(
    state: MachineState,
    service: MachineServiceState | null,
    command: SendMachineActionCommandResult
  ): boolean {
    if (this.disposed) return false;
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
    if (state === 'sleeping') this.scheduleSleepBrightnessDim(1000);
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
    if (!this.state.demo && this.state.startupPhase !== 'connected') {
      this.setState({ status: 'Cleaning is read-only until live data reconnects' });
      return;
    }
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
    this.machineWorkflowCommands.stageDesired(plan.workflow);
    this.setState({ busy: true, status: plan.status });
    if (this.state.demo) {
      const result = await loadCleaningWorkflow(plan.workflow, true, {
        updateWorkflow: (workflow) => Promise.resolve(workflow)
      });
      if (result.type === 'failed') {
        this.cleaningInProgress = false;
        this.setState({ busy: false, status: result.status });
        return;
      }
      this.state.workflow = result.workflow;
      if (!startShot) {
        this.setState({ busy: false, status: 'Press the GHC to run the cleaning flush' });
        return;
      }
      const started = await this.machineAction('espresso', { skipScaleCheck: true });
      if (!started) {
        this.cleaningInProgress = false;
        void this.applyDraft();
      }
      return;
    }

    // Loading the cleaning workflow and starting the physical pull is one
    // exact lane command. A pending recipe apply therefore cannot slip between
    // those two awaits and make the machine run the wrong profile.
    const preparedCleaningAction = this.prepareMachineActionCommand('espresso', plan.workflow);
    const coordinated = await this.machineWorkflowCommands.runExact(
      async (lane) => {
        const result = await loadCleaningWorkflow(plan.workflow, false, {
          updateWorkflow: (workflow) => lane.updateWorkflow(workflow)
        });
        const command = result.type !== 'failed' && startShot
          ? await this.sendMachineActionInOwnedLane({
              ...preparedCleaningAction,
              workflow: result.workflow
            }, lane)
          : null;
        return { result, command };
      }
    );
    if (coordinated.status !== 'completed') {
      this.cleaningInProgress = false;
      const error = coordinated.status === 'failed'
        ? coordinated.error
        : new Error(`Cleaning command ${coordinated.status}`);
      console.error('[Beanie] Cleaning profile load failed', error);
      this.setState({ busy: false, status: 'Cleaning profile failed' });
      return;
    }
    const { result, command } = coordinated.value;
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
    // The cleaning plan already performed water/sleep preflight and cleaning
    // profiles are exempt from the ordinary espresso scale gate.
    const started = command != null && this.finishMachineAction('espresso', null, command);
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

  private machineStatusStat(): MachineStatusView {
    if (this.state.demo) return { label: 'Demo', tone: 'alert' };
    if (this.state.gatewayLinkDown) return { label: 'Offline', tone: 'alert' };
    if (Date.now() < this.noScaleShotWarningUntilMs) return { label: NO_SCALE_MACHINE_STATUS, tone: 'alert' };
    return machineStatusView(this.state.machine, this.state.loading);
  }

  private machineStatusLabel(): string {
    return this.machineStatusStat().label;
  }

  private topbarViewModel(): TopbarViewModel {
    const alert = this.currentWaterAlert();
    const scale = this.state.scale;
    return this.topbarProjector.project({
      status: this.machineStatusStat(),
      groupTemperatureC: this.state.machine?.groupTemperature,
      steamTemperatureC: this.state.machine?.steamTemperature,
      waterLevelMm: this.state.waterLevel,
      waterAlert: alert === 'hard' ? 'hard' : alert === 'soft' ? 'soft' : 'none',
      scale: scale
        ? {
            weight: scale.weight,
            batteryLevel: scale.batteryLevel,
            status: scale.status
          }
        : null
    });
  }

  private updateTopbarIsland(): void {
    this.topbarIsland.offer(this.topbarViewModel());
  }

  private async toggleMachineCommand(state: MachineState): Promise<void> {
    const active = this.state.machine?.state?.state === state;
    await this.machineAction(active ? 'idle' : state, { allowOfflineStop: active });
  }

  private observeSleepBrightnessState(sleeping: boolean): void {
    if (sleeping) {
      // The user kept the app awake while the machine sleeps — leave the screen lit.
      if (this.state.appAwake) return;
      this.scheduleSleepBrightnessDim(0);
      return;
    }
    const hadSleepDim = this.sleepBrightnessDimmed || this.sleepBrightnessTimer != null;
    this.clearSleepBrightnessTimer();
    this.sleepBrightnessDimmed = false;
    if (hadSleepDim) this.verifySleepBrightnessRestored();
  }

  // reaprime restores the tablet brightness on a real machine wake, but that
  // was tuned for the old dim-to-zero. Shortly after a wake, check whether the
  // screen is still stuck at the saver's dim level (e.g. the clock/photos
  // percent) and restore it ourselves if so — without racing a restore that
  // did happen.
  private verifySleepBrightnessRestored(): void {
    const dimLevel = this.lastSleepDimLevel;
    this.lastSleepDimLevel = null;
    if (this.state.demo || dimLevel == null) {
      void this.refreshDisplayStateSilently();
      return;
    }
    if (this.sleepWakeRestoreTimer != null) window.clearTimeout(this.sleepWakeRestoreTimer);
    this.sleepWakeRestoreTimer = window.setTimeout(() => {
      this.sleepWakeRestoreTimer = null;
      void (async () => {
        try {
          // Wait out a dim PUT still in flight so we observe its result.
          if (this.sleepDimPromise) await this.sleepDimPromise;
          const display = await gateway.displayState();
          if (display.requestedBrightness > dimLevel) {
            this.patchBundle({ display });
            return;
          }
          const restored = await this.setGatewayBrightnessLatest(this.wakeAppRestoreBrightness);
          if (restored) this.patchBundle({ display: restored });
        } catch (error) {
          console.warn('[Beanie] Wake brightness restore check failed', error);
        }
      })();
    }, 1500);
  }

  private scheduleSleepBrightnessDim(delayMs: number): void {
    if (this.disposed || this.state.demo || this.sleepBrightnessDimmed || this.state.appAwake) return;
    if (this.sleepBrightnessTimer != null) {
      if (delayMs > 0) return;
      this.clearSleepBrightnessTimer();
    }
    this.sleepBrightnessTimer = window.setTimeout(() => {
      this.sleepBrightnessTimer = null;
      void this.dimDisplayForSleep();
    }, delayMs);
  }

  private clearSleepBrightnessTimer(): void {
    if (this.sleepBrightnessTimer == null) return;
    window.clearTimeout(this.sleepBrightnessTimer);
    this.sleepBrightnessTimer = null;
  }

  private async dimDisplayForSleep(): Promise<void> {
    if (this.state.demo || this.sleepBrightnessDimmed || this.state.appAwake) return;
    // The dim is deferred ~1s; if the machine woke in that window, don't black
    // out the screen (and don't fight reaprime's wake-restore).
    if (!this.machineIsSleeping()) return;
    this.sleepBrightnessDimmed = true;
    // The black screensaver turns the screen fully off (as before); clock and
    // photo savers keep the configured backlight so their content is visible.
    const prefs = this.state.settingsPreferences;
    const level = screensaverDimBrightness(prefs.screensaverMode, prefs.screensaverBrightness);
    this.lastSleepDimLevel = level;
    // Publish the PUT so a concurrent wake-app tap restores brightness only
    // after this dim lands — otherwise the two writes race and the dim can win last.
    const dim = (async () => {
      try {
        const display = await this.setGatewayBrightnessLatest(level);
        if (display) this.patchBundle({ display });
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

  private async setGatewayBrightnessLatest(brightness: number): Promise<DisplayState | null> {
    const outcome = await this.gatewayMutations.latest(
      'display',
      'brightness',
      () => gateway.setDisplayBrightness(brightness)
    );
    if (outcome.status === 'completed') return outcome.value;
    if (outcome.status === 'failed') throw outcome.error;
    return null;
  }

  // Show Beanie while the machine stays asleep — the same view you'd get by
  // opening the skin in a browser. Deliberately sends NO machine command, so the
  // DE1 keeps sleeping; we only undo the screen dim ourselves (reaprime restores
  // brightness only on a real wake). `appAwake` then suppresses re-dimming and
  // hides the screensaver until the machine actually wakes.
  private async wakeAppWithoutMachine(): Promise<void> {
    const wasDimmed = this.sleepBrightnessDimmed;
    this.clearSleepBrightnessTimer();
    this.sleepBrightnessDimmed = false;
    this.lastSleepDimLevel = null;
    this.setState({ appAwake: true, status: 'App awake — machine still asleep' });
    this.armWakeAppIdleTimer();
    if (this.state.demo || !wasDimmed) return;
    try {
      // Wait out any dim PUT still in flight so our restore is the last write.
      if (this.sleepDimPromise) await this.sleepDimPromise;
      const display = await this.setGatewayBrightnessLatest(this.wakeAppRestoreBrightness);
      if (display) this.patchBundle({ display });
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
    this.scheduleSleepBrightnessDim(0);
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
      await this.machineAction('idle', { allowOfflineStop: true });
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
      await this.requestSafeMachineStop();
      if (this.disposed) return;
      this.setState({ busy: false, status: 'Stop requested' });
      this.armMachineStopFeedbackTimer();
    } catch (error) {
      console.error('[Beanie] Machine stop failed', error);
      this.clearMachineStopRequest();
      this.setState({ busy: false, status: 'Machine stop failed' });
    }
  }

  private startLiveStreams(): void {
    if (this.disposed || this.state.demo) return;
    this.machineStream.start();
    this.scaleStream.start();
    this.waterStream.start();
    this.displayStream.start();
    this.shotStateStream.start();
  }

  private disposeLiveStreams(): void {
    this.machineStream.dispose();
    this.scaleStream.dispose();
    this.waterStream.dispose();
    this.displayStream.dispose();
    this.shotStateStream.dispose();
  }

  private handleMachineTelemetry(
    snapshot: MachineSnapshot,
    previous: MachineSnapshot | null,
    observedAtMs: number
  ): void {
    if (this.disposed) return;
    this.ingestLiveFrame(
      snapshot,
      null,
      observedAtMs,
      previous ?? this.state.machine,
      this.telemetryStore.snapshot.scale ?? this.state.scale
    );
  }

  // Re-sync after an outage: anything could have changed while the link was
  // down (shots pulled from another UI, beans edited, machine state moved).
  private handleGatewayReconnected(): void {
    this.setState({ gatewayLinkDown: false, status: 'Gateway reconnected' });
    if (this.state.startupPhase === 'offline-cache') this.startupRetryTask.trigger();
    void this.refreshBeans({ force: true });
    void this.refreshBeanUsage();
    void this.refreshVisibleShots();
    void this.doseMutationReconciler.trigger();
  }

  private handleScaleTelemetry(
    snapshot: ScaleSnapshot,
    previous: ScaleSnapshot | null,
    observedAtMs: number
  ): void {
    if (this.disposed) return;
    this.ingestLiveFrame(
      null,
      snapshot,
      observedAtMs,
      this.telemetryStore.snapshot.machine ?? this.state.machine,
      previous ?? this.state.scale
    );
  }

  // Water is normalized before reaching this application subscriber. The
  // subscriber owns structural alert transitions; presentation remains behind
  // the bounded topbar owner.
  private handleWaterTelemetry(snapshot: WaterLevelSnapshot): void {
    if (this.disposed) return;
    const refill = snapshot.refillLevelMm;
    if (refill !== this.state.machineRefillLevel) {
      this.state.machineRefillLevel = refill;
      if (this.state.view === 'settings') this.setState({});
    }
    const level = snapshot.currentLevelMm;
    if (level == null || level === this.state.waterLevel) return;
    this.state.waterLevel = level;
    if (this.syncWaterAlert()) {
      this.setState({});
      return;
    }
    this.updateTopbarIsland();
  }

  // Keep the wake-app restore target current from the normalized display
  // channel. Frames caused by the screensaver dim itself are not adopted.
  private handleDisplayTelemetry(display: DisplayState): void {
    if (this.disposed) return;
    const sleepDimActive = this.sleepBrightnessDimmed || this.sleepBrightnessTimer != null;
    if (display.requestedBrightness > 0 && !sleepDimActive) {
      this.wakeAppRestoreBrightness = display.requestedBrightness;
    }
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
  }

  // The gateway sequencer's shot-state channel is the authority on why stages
  // advanced and what stopped the pour.
  private handleShotStateTelemetry(frame: ShotStateEvent): void {
    if (this.disposed) return;
    const next = nextDecisionLog(this.decisionLog, frame);
    if (next === this.decisionLog) return;
    this.decisionLog = next;
    this.liveReadouts.forceStageRefresh();
    if (
      !this.liveShot.isActive &&
      (this.state.liveActive || this.state.liveFinalizing)
    ) {
      this.updateLiveReadouts();
      this.liveReadouts.flush();
    }
  }
  // Feed one telemetry frame (from either socket, or the demo simulator) into the
  // live-shot session. The hot path deliberately avoids a full re-render: while a
  // shot is active we only redraw the canvas and patch readout text by reference.
  private ingestLiveFrame(
    machine: MachineSnapshot | null,
    scale: ScaleSnapshot | null,
    tMs: number,
    currentMachine = this.state.machine,
    currentScale = this.state.scale
  ): void {
    const frameState = liveTelemetryFrameState({
      currentMachine,
      currentScale,
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
      this.liveReadouts.beginSession();
      this.captureLiveGhost();
      // A pull is hands-off, so heartbeat at the start to keep the machine awake.
      this.sendPresenceHeartbeat();
      // First active frame: render once to mount the live panel + canvas, then draw.
      // Clear any leftover finalizing from a just-prior shot so this one takes over.
      this.setState({ liveActive: true, liveFinalizing: false, status: 'Live shot' });
      return;
    }
    if (panelDecision === 'ended') {
      // And again at the end, so reaprime's sleep timeout counts from the pour's
      // end rather than firing immediately after a touch-free shot.
      this.sendPresenceHeartbeat();
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
    this.updateTopbarIsland();
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
      await this.requestSafeMachineStop();
      if (this.disposed) return;
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
    if (this.state.startupPhase !== 'connected') {
      this.setState({ status: 'Add time is unavailable until live data reconnects' });
      return;
    }
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
      await this.updateWorkflowExact(nextWorkflow);
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
      updateWorkflow: (workflow) => this.updateWorkflowExact(workflow)
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
    if (this.disposed) return;
    if (this.machineStopFeedbackTimer != null) window.clearTimeout(this.machineStopFeedbackTimer);
    this.machineStopFeedbackTimer = window.setTimeout(() => {
      this.machineStopFeedbackTimer = null;
      if (!this.machineService.stopRequestedFor) return;
      this.setState({ status: 'Stop not confirmed' });
    }, 4000);
  }

  private currentWaterAlert(): WaterAlertLevel {
    return this.waterAlertProjector.project({
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
      await this.runExactMachineCommand((lane) => lane.setRefillLevel(mm));
      this.setState({ status: 'Machine refill level set' });
    } catch (error) {
      console.error('[Beanie] Set refill level failed', error);
      this.setState({ machineRefillLevel: previous, status: 'Set refill level failed' });
    }
  }

  // Publish the latest complete live model. LiveChart is the sole frame
  // scheduler and coalesces model/layout/theme/interaction invalidations into
  // one RAF; the app never calls resize()/draw() directly.
  private scheduleLiveDraw(): void {
    if ((!this.state.liveActive && !this.state.liveFinalizing) || !this.liveChart) return;
    const ghost = this.state.liveGhost ? this.liveGhostModel : null;
    const model = this.liveShot.model({
      ...liveChartModelOptions(this.state.liveChartMode, ghost?.maxTime),
      stageNames: profileStepNames(this.liveProfile())
    });
    this.liveChart.setOptions({
      hideMaxTimeLabel: liveChartHideMaxTimeLabel(this.state.liveChartMode, model.maxTime)
    });
    this.liveChart.setModel(ghost ? overlayComparisonModel(model, ghost) : model);
    this.liveChart.invalidate('model');
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
      this.liveChart?.dispose();
      this.liveChart = null;
      this.liveCanvas = null;
      this.liveReadouts.clear();
      return;
    }
    if (canvas !== this.liveCanvas) {
      this.liveChart?.dispose();
      this.liveCanvas = canvas;
      this.liveChart = new LiveChart(canvas, {
        detailed: true,
        hideMaxTimeLabel: this.state.liveChartMode === 'auto',
        hover: true
      });
    }
    this.liveReadouts.bind(this.root);
    this.scheduleLiveDraw();
  }

  private updateLiveReadouts(): void {
    this.liveReadouts.update({
      elapsedSeconds: this.liveShot.elapsedSeconds,
      latest: this.liveShot.latest,
      currentStage: this.currentStageIndex(),
      stageNames: profileStepNames(this.liveProfile()),
      stageMarkerCount: this.liveShot.snapshot.stageMarkers.length,
      stageReasons: () => this.liveStageReasons(),
      formatNumber
    });
  }

  // The active profile's stages — name plus, once a stage has advanced, the
  // actual reason it did — and the index the machine is currently in, for the
  // rail beside the live chart. Null when the profile has no usable steps.
  private liveStagesView(): LiveStagesView | null {
    const names = profileStepNames(this.liveProfile());
    if (names.length === 0) return null;
    const reasons = this.liveStageReasons();
    const steps = names.map((name, index) => ({ name, reason: reasons[index] ?? null }));
    return { steps, currentIndex: this.currentStageIndex() };
  }

  // The actual advance reason for each stage that has already handed off, indexed
  // by step. A stage's reason renders once the NEXT stage begins (its marker
  // carries the telemetry at the moment of advance); the gateway's shotState
  // decision for the vacated frame says WHAT advanced it (app weight skip vs
  // firmware exit). Cheap enough to call per frame — parsing is memoized.
  private liveStageReasons(): (StageReason | null)[] {
    const steps = this.parsedLiveSteps();
    const markers = this.liveShot.snapshot.stageMarkers;
    const reasons: (StageReason | null)[] = new Array(steps.length).fill(null);
    for (let i = 1; i < markers.length; i += 1) {
      const endedFrame = markers[i - 1]!.frame;
      if (endedFrame < 0 || endedFrame >= steps.length) continue;
      const elapsed = Math.max(0, markers[i]!.t - markers[i - 1]!.t);
      reasons[endedFrame] = liveStageAdvanceReason(
        this.decisionLog.advances.get(endedFrame) ?? null,
        steps[endedFrame],
        elapsed,
        {
          pressure: markers[i]!.atPressure,
          flow: markers[i]!.atFlow,
          weight: markers[i]!.atWeight
        }
      );
    }

    // The final stage has no successor marker, so the loop never labels it.
    // Once the pour has ended its reason is the shot's stop decision — or the
    // app's weight skip of that same frame, when skipping the last step is
    // what ended the shot.
    if (this.liveShot.phase === 'ended') {
      const frame = lastReachedFrame(this.liveShot.snapshot);
      if (frame != null && frame >= 0 && frame < steps.length && reasons[frame] == null) {
        const skip = this.decisionLog.advances.get(frame);
        if (skip) {
          const lastMarker = markers[markers.length - 1]!;
          const elapsed = Math.max(0, this.liveShot.elapsedSeconds - lastMarker.t);
          reasons[frame] = liveStageAdvanceReason(skip, steps[frame], elapsed, {
            pressure: this.liveShot.latest.pressure,
            flow: this.liveShot.latest.flow,
            weight: this.liveShot.latest.weight
          });
        } else {
          reasons[frame] = stageStopReason(this.decisionLog.stop);
        }
      }
    }
    return reasons;
  }

  // The profile the machine is actually running for the live pull. A cleaning
  // cycle loads the cleaning profile onto the machine WITHOUT touching the
  // recipe draft (the draft must survive to be restored afterwards), so while
  // one is in progress the rail/chart must describe the cleaning workflow's
  // steps, not the recipe's.
  private liveProfile(): Profile | null {
    if (this.cleaningInProgress) return this.state.workflow?.profile ?? null;
    return this.state.draft?.profile ?? null;
  }

  // Parsed steps of the active profile, memoized by profile reference so the
  // per-frame reason lookup doesn't re-parse the whole profile each tick.
  private parsedLiveSteps(): EditorStep[] {
    const profile = this.liveProfile();
    if (profile !== this.cachedStepsProfile) {
      this.cachedStepsProfile = profile;
      this.cachedSteps = profile ? createProfileEditorState(profile).steps : [];
    }
    return this.cachedSteps;
  }

  // The stage to highlight in the rail: the machine's reported profileFrame
  // while the pour is active, frozen at the last stage the pour reached once
  // it ends — the machine resets its frame to 0 on stop, which would snap the
  // highlight back to the first step while the ended panel is still up.
  // Validated against the active profile's step count; null when no frame is
  // known or it falls outside the steps.
  private currentStageIndex(): number | null {
    const frame = this.liveShot.isActive
      ? this.state.machine?.profileFrame
      : lastReachedFrame(this.liveShot.snapshot);
    const count = profileStepNames(this.liveProfile()).length;
    if (frame != null && Number.isInteger(frame) && frame >= 0 && frame < count) {
      return frame;
    }
    return null;
  }

  private onShotEnded(): void {
    const shotWindow = this.liveShot.snapshot;
    // The gateway reports a blockOnNoScale abort explicitly on the shotState
    // feed; the local duration/scale heuristic remains as the tiebreaker for
    // the moments the decision hasn't landed yet (two sockets, no ordering).
    const noScaleBlockedAbort =
      !this.cleaningInProgress &&
      (this.decisionLog.stop?.reason === 'noScale' ||
        this.isNoScaleBlockedLiveAbort(shotWindow));
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
      // The gateway's stop decision is authoritative (target weight vs API vs
      // app vs machine stop); the local weight heuristic covers only the
      // transient where the decision frame hasn't landed yet.
      completionReason:
        stopReasonLabel(this.decisionLog.stop) ?? this.liveShot.completionReason,
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
          beanUsageAt: bean && decision.optimisticShot
            ? {
                ...this.state.beanUsageAt,
                ...beanUsageForBean(bean.id, [decision.optimisticShot])
              }
            : this.state.beanUsageAt,
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
            decision.optimisticShot?.annotations?.actualDoseWeight ?? null,
            decision.optimisticShot?.id ?? null
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
        context.optimisticShot?.annotations?.actualDoseWeight ?? null,
        context.optimisticShot?.id ?? null
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
          beanUsageAt: {
            ...this.state.beanUsageAt,
            ...beanUsageForBean(bean.id, visibleRecords)
          },
          liveActive: false,
          liveFinalizing: false,
          detailShotId: savedShot.id,
          // The staged Derek tweak was used by this pull; the chip's job is done.
          derekTweakChip: null,
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
        beanUsageAt: {
          ...this.state.beanUsageAt,
          ...beanUsageForBean(bean.id, visibleRecords)
        },
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
    doseWeight: number | null | undefined,
    shotId: string | null
  ): Promise<void> {
    const dose = positiveNumber(doseWeight);
    if (dose == null || !shotId) return;
    const batch = (this.state.batchesByBean[bean.id] ?? []).find((item) => item.id === batchId);
    const remaining = positiveNumber(batch?.weightRemaining);
    if (!batch || remaining == null) return;
    const next = Math.max(0, round(remaining - dose, 1));
    if (this.state.demo) {
      await this.saveBatchStoragePatch(
        bean,
        batch.id,
        { beanId: bean.id, weightRemaining: next },
        `Bag: ${formatGrams(next)} left`
      );
      return;
    }

    const at = new Date().toISOString();
    try {
      // Journal before the first network attempt. A process death anywhere
      // after this await leaves a reclaimable command rather than lost beans.
      const queued = await this.doseMutationReconciler.enqueue({
        shotId,
        batchId: batch.id,
        beanId: bean.id,
        dose,
        expectedRemaining: next,
        at
      });
      if (queued.inserted) {
        const batches = (this.state.batchesByBean[bean.id] ?? []).map((item) =>
          item.id === batch.id ? { ...item, weightRemaining: next } : item
        );
        this.setState({
          batchesByBean: { ...this.state.batchesByBean, [bean.id]: batches },
          status: queued.durability === 'indexeddb' || queued.durability === 'local-storage'
            ? `Bag: ${formatGrams(next)} left`
            : `Bag: ${formatGrams(next)} left — device storage unavailable`
        });
        void beanieCache.putBeanBatches(bean.id, batches).catch(() => {});
      }
    } catch (error) {
      console.error('[Beanie] Could not journal dose deduction', error);
      this.setState({ status: 'Bag update could not be queued' });
    }
  }

  // A deleted bag resolves to null (the deduction is moot); anything else —
  // network down, gateway error — throws so the caller keeps the entry queued.
  private async batchForPendingDose(batchId: string): Promise<BeanBatch | null> {
    try {
      return await gateway.batch(batchId);
    } catch (error) {
      if (error instanceof GatewayRequestError && error.issue.statusCode === 404) return null;
      throw error;
    }
  }

  private adoptFlushedBatch(saved: BeanBatch, expectedRemaining: number): void {
    if (this.disposed) return;
    const current = this.state.batchesByBean[saved.beanId];
    if (!current) return;
    const currentBatch = current.find((item) => item.id === saved.id);
    // A newer optimistic deduction or foreground edit already owns the local
    // projection. Publishing this older absolute response would resurrect
    // weight and can make a later journal entry look falsely applied.
    if (currentBatch?.weightRemaining !== expectedRemaining) return;
    const batches = current.map((item) => (item.id === saved.id ? saved : item));
    this.setState({ batchesByBean: { ...this.state.batchesByBean, [saved.beanId]: batches } });
    void beanieCache.putBeanBatches(saved.beanId, batches).catch(() => {});
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
      weightRemaining: next
    };
    await this.saveBatchStoragePatch(bean, batch.id, batchInput, `Bag: ${formatGrams(next)} left`);
  }

  private async saveFreshnessForCompletedShot(shot: ShotRecord, batch: BeanBatch | null): Promise<ShotRecord> {
    const metadata = shotMetadataWithFreshness(shot.metadata, null, batch, shot.timestamp);
    // A Derek suggestion applied before this pull gets stamped onto the shot,
    // closing the advice → try → result loop: the next "Dial in" on this shot
    // tells Derek what was already changed.
    const pendingTweak = readPendingDerekTweak();
    const beanId = batch?.beanId ?? shot.workflow?.context?.beanId ?? null;
    const annotations =
      pendingTweak && beanId && pendingTweak.beanId === beanId
        ? {
            ...shot.annotations,
            extras: { ...shot.annotations?.extras, derekTweak: pendingTweak.summary }
          }
        : null;

    const update: ShotUpdate = {};
    if (metadata?.freshness) update.metadata = metadata;
    if (annotations) update.annotations = annotations;
    if (!update.metadata && !update.annotations) return shot;
    try {
      const saved = await this.runExactCommand(`shot:${shot.id}`, async () => {
        const latest = update.annotations ? await gateway.shot(shot.id) : null;
        return gateway.updateShot(shot.id, {
          ...update,
          ...(update.annotations && latest ? {
            annotations: rebaseChangedFields(
              shot.annotations,
              update.annotations,
              latest.annotations
            )
          } : {})
        });
      });
      if (annotations) clearPendingDerekTweak();
      this.shotCacheGeneration += 1;
      await beanieCache.invalidateShotMutation(saved.id).catch(() => {});
      await beanieCache.putShotRecord(saved).catch(() => {});
      return saved;
    } catch (error) {
      console.error('[Beanie] Save shot context failed', error);
      return { ...shot, ...(update.metadata ? { metadata: update.metadata } : {}) };
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
      this.scannerFlow.scannerClickActions(),
      this.recipeClickActions(),
      this.shotClickActions(),
      this.machineClickActions(),
      this.settingsClickActions(),
      this.navigationClickActions(),
      this.profileEditorFlow.profileEditorClickActions(),
      this.derekFlow.derekClickActions()
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
        if (value === 'beans') {
          void this.refreshBeans({ force: true });
          void this.refreshBeanUsage();
        }
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


  /**
   * Accept and push a synced setting's next value. The domain writer updates
   * its cache immediately after this returns true; on transport failure we
   * surface a blocking overlay rather than silently diverging from the store.
   */
  private pushSettingToStore(storeKey: string, value: string | null): boolean {
    if (this.state.demo) return true;
    if (!this.settingsStoreSync.admitWrite(storeKey, value)) {
      // Domain writers update their own view state after returning. Re-read the
      // untouched authoritative cache on the next microtask to roll that view
      // state back without allowing a default-derived write through.
      queueMicrotask(() => {
        if (this.disposed) return;
        this.applyLoadedSettings(this.settingsStoreSync.snapshot.available);
        this.setState({ status: 'Synced settings are unavailable or busy — no change was saved' });
      });
      return false;
    }
    return true;
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
      this.applyLoadedSettings(true);
      return;
    }
    const result = await this.settingsStoreSync.loadInitial();
    try {
      if (result.type === 'loaded' && !this.disposed) {
        try {
          await migrateLegacyGeminiApiKey(gateway);
        } catch (error) {
          // Do not make all preferences unavailable because a best-effort secret
          // cleanup failed. The next real startup retries the migration.
          console.warn('[Beanie] Legacy scanner key cleanup failed; will retry', error);
        }
        if (!this.disposed) this.applyLoadedSettings(true);
        return;
      }
      if (result.type === 'failed') {
        console.warn('[Beanie] Settings load failed; keeping the last trustworthy values or defaults', result.error);
      }
      // A failed first load has no trustworthy store snapshot. A later failed
      // reload must not discard a snapshot that was already loaded cleanly.
      if (!this.disposed) this.applyLoadedSettings(this.settingsStoreSync.snapshot.available);
    } finally {
      // Initial failure is recoverable: keep polling instead of making the
      // fallback defaults sticky for the lifetime of the app.
      if (!this.disposed) this.settingsSyncTask.start();
    }
  }

  /** Re-derive settings-backed state from the in-memory cache and render. */
  private applyLoadedSettings(storeAvailable = this.state.settingsStoreAvailable): void {
    this.setState({
      settingsLoaded: true,
      settingsStoreAvailable: storeAvailable,
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

  /**
   * Pick up changes made on another device sharing this gateway — synced
   * settings, plus the selected coffee and the workflow recipe. Runs on a timer
   * and immediately on window focus.
   */
  private async syncFromGateway(): Promise<void> {
    if (
      this.presentationActivity.isSuspended ||
      this.disposed ||
      this.state.startupPhase === 'offline-cache' ||
      this.state.startupPhase === 'retrying'
    ) return;
    await this.pollSettings();
    await this.resyncWorkflowAndBean();
  }

  /** Live sync: re-poll the settings store; re-render only if something changed. */
  private async pollSettings(): Promise<void> {
    if (this.state.demo || this.disposed) return;
    const wasAvailable = this.state.settingsStoreAvailable;
    const result = await this.settingsStoreSync.pollNow();
    if (result.type === 'polled') {
      if (!this.disposed && (!wasAvailable || result.changedKeys.length > 0)) {
        this.applyLoadedSettings(true);
      }
    } else if (result.type === 'failed') {
      console.warn('[Beanie] Settings poll failed', result.error);
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
    return this.state.applyState !== 'pending' && !this.recipeApply.snapshot.scheduled;
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
    // the workflow carries no bean, in last-bean-id. The fingerprint includes
    // workflow bean identity, while the explicit checks also cover the local
    // selection fallback used by older workflows.
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
    this.machineWorkflowCommands.synchronizeAuthoritative(workflow);
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
    this.settingsSyncTask.trigger();
  };
  private readonly handleDocumentVisibility = (): void => {
    this.syncSaverPhotoTimer();
    this.syncPresentationActivity();
  };

  private syncPresentationActivity(): void {
    const documentHidden =
      typeof document !== 'undefined' && document.visibilityState === 'hidden';
    const suspended = presentationOccluded({
      asleep: this.state.asleep,
      appAwake: this.state.appAwake,
      usesWebSleepControls: this.usesWebSleepControls(),
      saverPreview: this.state.saverPreview,
      documentHidden
    });
    this.presentationActivity.setSuspended(suspended);
    // A chart can be mounted by a later shell morph while the coordinator is
    // already suspended. Reconcile dynamic resources on every bind pass.
    if (suspended) this.chartActivityTarget.suspend();
  }

  private managedCharts(): Array<LiveChart | null> {
    return [
      this.liveChart,
      this.detailChart,
      this.shotStagesChart,
      this.calibratorChart
    ];
  }

  private retryFailedStoreWrites(): void {
    this.settingsStoreSync.retryFailedWrites();
  }

  private async dismissStoreError(): Promise<void> {
    const result = await this.settingsStoreSync.discardAndReload();
    if (this.disposed) return;
    if (result.type === 'reloaded') {
      this.applyLoadedSettings(true);
      this.setState({ storeError: false, status: 'Gateway settings restored' });
      return;
    }
    if (result.type === 'failed') {
      console.warn('[Beanie] Could not restore gateway settings', result.error);
      this.setState({ status: 'Could not reload gateway settings — retry when connected' });
    }
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
      roasterBeanCount: scanner.roasterBeanCount,
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
      'shot-stages': () => {
        if (!this.selectedHistoryShot()) return;
        this.setState({ modal: 'shot-stages' });
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
        this.setState({
          comparePicking: !this.state.comparePicking,
          status: this.state.comparePicking ? this.state.status : 'Pick a shot to compare'
        });
      },
      'clear-compare-shot': () => {
        this.setState({ compareShotId: null, comparePicking: false });
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
      // Tapping the water level jumps to its alert/refill settings (Settings → Machine).
      'water-stat': () => {
        this.openSettingsPage('machine');
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
        await this.machineAction('idle');
        if (!this.machineIsSleeping()) await this.recipeApply.resumeAfterWake();
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
      'retry-startup': async () => {
        await this.retryStartupConnection();
      },
      'retry-store-write': () => {
        this.retryFailedStoreWrites();
      },
      'dismiss-store-error': async () => {
        await this.dismissStoreError();
      },
      'open-settings': () => {
        this.openSettingsPage();
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
        // section's scroll (the morphing render preserves the surviving
        // element's scroll position).
        const detail = this.root.querySelector<HTMLElement>('.settings-detail');
        if (detail) detail.scrollTop = 0;
      },
      'settings-reset-machine': async () => {
        await this.resetMachineSettings();
      },
      'settings-reload-resources': async () => {
        this.setState({ settingsSource: 'loading', status: 'Reloading settings…' });
        this.settingsLoadPromise = null;
        await this.loadSettings();
        await this.loadReaSettings();
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
        await this.scannerFlow.openLabelScanner();
        this.scannerFlow.setScanner({
          step: 'onboard',
          handoff: false,
          keyDraft: readGeminiApiKey() ?? '',
          verifyMessage: null
        });
      },
      'settings-remove-scanner-key': () => {
        clearGeminiApiKey();
        this.setState({ status: 'Gemini key removed from this device' });
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
      'settings-clock-format': ({ el }) => {
        if (isClockFormat(el.dataset.value)) {
          this.updateSettingsPreferences({ clockFormat: el.dataset.value });
        }
      },
      'settings-screensaver-mode': ({ el }) => {
        if (isScreensaverMode(el.dataset.value)) {
          this.updateSettingsPreferences({ screensaverMode: el.dataset.value });
        }
      },
      'screensaver-preview': () => {
        this.setState({ saverPreview: true });
      },
      'saver-preview-end': () => {
        this.setState({ saverPreview: false });
      },
      'settings-screensaver-clear-photos': async () => {
        await this.clearScreensaverPhotos();
      },
      'settings-reset-cache': async () => {
        if (
          typeof window.confirm === 'function' &&
          !window.confirm('Clear downloaded offline data from this device? Synced settings and personal photos will be kept.')
        ) {
          return;
        }
        await this.resetLocalCache();
      },
    };
  }

  private openSettingsPage(section?: string): void {
    if (this.isPhoneLayout()) {
      this.setState({
        phoneTab: 'settings',
        view: 'workbench',
        ...(section ? { settingsSection: section } : {})
      });
      this.openSettingsForPhone();
      return;
    }
    this.setState({
      view: 'settings',
      ...(section ? { settingsSection: section } : {}),
      settingsBundle: this.state.settingsBundle ?? demoSettingsBundle(),
      settingsSource: this.state.settingsBundle
        ? this.state.settingsSource
        : this.state.demo
          ? 'demo'
          : 'loading',
      settingsResources: this.state.settingsResources
        ?? (this.state.demo ? settingsResourceStates('demo') : null)
    });
    void this.loadReaSettings();
    void this.loadDecentAccount();
  }

  private openSettingsForPhone(): void {
    this.setState({
      settingsBundle: this.state.settingsBundle ?? demoSettingsBundle(),
      settingsSource: this.state.settingsBundle
        ? this.state.settingsSource
        : this.state.demo
          ? 'demo'
          : 'loading',
      settingsResources: this.state.settingsResources
        ?? (this.state.demo ? settingsResourceStates('demo') : null)
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
        if (!id) return;
        // Tap-again to load, mirroring the bean picker: the first tap previews a
        // profile, and tapping the already-focused row loads it. Only this
        // deliberate second tap counts toward retiring the suggestion tooltip.
        if (id === this.state.profileFocusId) {
          this.completeSecondTapHint('profile');
          if (this.state.cleaningProfilePicking) this.pickCleaningProfile(id);
          else this.pickProfile(id);
        } else {
          this.focusProfile(id);
        }
      },
      // The phone list has no preview pane, so a single tap loads directly.
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
        // Notes editor layers over the profile-editor page — closing it must keep
        // the editor draft intact, so just drop the modal.
        if (this.state.modal === 'notes-editor') {
          this.setState({ modal: null });
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
        if (this.state.scanner) this.scannerFlow.cancelScannerWork();
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
    if (target.dataset.action === 'derek-note' && this.state.derek) {
      this.setState({ derek: { ...this.state.derek, note: target.value } });
    }
    if (target.dataset.action === 'derek-question' && this.state.derek) {
      this.setState({ derek: { ...this.state.derek, question: target.value } });
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
      // Picking a profile by hand replaces whatever Derek tweak was staged.
      derekTweakChip: null,
      status: selection.status
    });
    this.scheduleApply();
  }

  // First tap on a profile row just previews it in the pane (like inspecting a
  // bean) — the draft/machine profile only changes on the confirming second tap
  // in pickProfile. The armed row teaches the tap-again gesture on its own (see
  // renderProfileRow); no per-row hint state is needed.
  private focusProfile(id: string): void {
    const record = this.state.profiles.find((profile) => profile.id === id);
    this.setState({
      profileFocusId: id,
      status: record ? `Previewing ${profileShortTitle(record.profile.title ?? id)}` : this.state.status
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







  // `commit` is false for `input` events, true for `change`. A range slider
  // fires `input` continuously while dragging; re-rendering on each one replaces
  // the slider element and kills the drag. So for an in-progress range drag we
  // update state silently and patch the on-screen value, then do the single full
  // re-render on `change` (pointer release).
  private applyEditorEvent(
    target: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
    commit = true
  ): boolean {
    if (this.state.busy) return false;
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
      patchProfileRangeValue(target);
      return true;
    }
    this.setState({ profileEditor: next });
    return true;
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
    if (target.dataset.action === 'settings-topbar-clock') {
      this.updateSettingsPreferences({ topbarClock: (target as HTMLInputElement).checked });
      return;
    }
    if (target.dataset.action === 'settings-screensaver-add-photos') {
      const input = target as HTMLInputElement;
      const files = Array.from(input.files ?? []);
      input.value = '';
      if (files.length > 0) await this.addScreensaverPhotos(files);
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
      if (files.length > 0) void this.scannerFlow.addScannerPhotos(files);
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
    if (form.dataset.form === 'batch-storage-dates') {
      event.preventDefault();
      await this.saveBatchStorageDates(form);
      return;
    }
    if (form.dataset.form === 'grinder-editor') {
      event.preventDefault();
      await this.submitGrinderEditor(form);
      return;
    }
    if (form.dataset.form === 'scanner-onboard') {
      event.preventDefault();
      this.scannerFlow.saveScannerKey(form);
      return;
    }
    if (form.dataset.form === 'scanner-review') {
      event.preventDefault();
      await this.scannerFlow.submitScannerReview(form);
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
      updateBatch: (id, input) => this.runExactCommand(`batch:${id}`, () => gateway.updateBatch(id, input)),
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
    // Patch only the edited field (the gateway merges partial bodies): echoing
    // the whole batch here would clobber concurrent edits from other devices.
    const batchInput: Partial<BeanBatch> = { beanId: bean.id };
    const weight = name === 'weight' ? nextValue : previous.weight ?? null;
    if (name === 'weight') batchInput.weight = nextValue;
    // Keep "left" within the bag size whether the bag or the remaining changed.
    const remaining = clampRemainingToWeight(
      name === 'weightRemaining' ? nextValue : previous.weightRemaining ?? null,
      weight
    );
    if (name === 'weightRemaining' || remaining !== (previous.weightRemaining ?? null)) {
      batchInput.weightRemaining = remaining;
    }
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
      updateBatch: (id, input) => this.runExactCommand(`batch:${id}`, () => gateway.updateBatch(id, input)),
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

  private async saveBatchStorageDates(form: HTMLFormElement): Promise<void> {
    const selection = this.batchStorageSelection();
    if (!selection) return;
    const data = new FormData(form);
    const events = batchStorageEvents(selection.batch);
    const patch: Partial<BeanBatch> = { beanId: selection.bean.id };
    let changed = false;

    // Roast date — only when the row is shown, and only if it actually moved.
    if (form.elements.namedItem('roast')) {
      const roastValue = String(data.get('roast') ?? '').trim();
      if (roastValue && roastValue !== dateInputValue(selection.batch.roastDate)) {
        patch.roastDate = roastValue;
        changed = true;
      }
    }

    if (events.length === 0) {
      // Empty history: the form may offer a single "first freeze date" to backfill.
      const addValue = String(data.get('event-new') ?? '').trim();
      if (addValue) {
        const at = new Date(addValue);
        if (Number.isNaN(at.valueOf())) {
          this.setState({ status: 'Choose a valid date' });
          return;
        }
        Object.assign(patch, appendBatchStorageEvent(selection.batch, 'frozen', at));
        changed = true;
      }
    } else {
      const atDates = events.map((_, index) => String(data.get(`event-${index}`) ?? ''));
      const rebuilt = setBatchStorageEventDates(selection.batch, atDates, new Date());
      if (rebuilt.storageEvents) {
        Object.assign(patch, rebuilt);
        changed = true;
      }
    }

    if (!changed) {
      this.setState({ status: 'No date changes' });
      return;
    }
    await this.saveBatchStoragePatch(selection.bean, selection.batch.id, patch, 'Dates saved');
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
    // Only the kept-on-shelf remainder changes on the parent bag; the gateway
    // merges partial bodies, so leave every other field out of the patch.
    const parentUpdate: Partial<BeanBatch> = {
      beanId: selection.bean.id,
      weightRemaining: keep
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
      const { created, savedParent } = await this.runExactCommand(`batch:${selection.batch.id}`, async () => {
        const createdRaw = await gateway.createBatch(selection.bean.id, frozenBatch);
        const created = await gateway.updateBatch(createdRaw.id, {
          beanId: selection.bean.id,
          storageEvents: frozenBatch.storageEvents ?? null,
          frozen: true
        });
        const savedParent = await gateway.updateBatch(selection.batch.id, parentUpdate);
        return { created, savedParent };
      });
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
  ): Promise<'saved' | 'failed' | 'skipped'> {
    const optimistic = this.beanWorkflow.beginBatchUpdate({
      bean,
      batchesByBean: this.state.batchesByBean,
      selectedBeanId: this.state.selectedBeanId,
      batchId,
      batchInput,
      demo: this.state.demo
    });
    if (optimistic.type !== 'optimistic') return 'skipped';

    this.setState({
      batchesByBean: optimistic.batchesByBean,
      status
    });
    if (optimistic.shouldScheduleApply) this.scheduleApply();
    if (optimistic.complete) return 'saved';

    const result = await this.beanWorkflow.finishBatchUpdate({
      bean,
      batchId,
      batchInput,
      latestBatchesByBean: this.state.batchesByBean,
      previousBatches: optimistic.previousBatches
    }, {
      updateBatch: (id, input) => this.runExactCommand(`batch:${id}`, () => gateway.updateBatch(id, input)),
      putBeanBatches: (ownerId, batches) => beanieCache.putBeanBatches(ownerId, batches)
    });

    if (result.type === 'failed') {
      console.error('[Beanie] Save storage failed', result.error);
    }
    this.setState({
      batchesByBean: result.batchesByBean,
      status: result.type === 'failed' ? result.status : status
    });
    return result.type === 'failed' ? 'failed' : 'saved';
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
      weightRemaining: 0
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
      updateBatch: (id, input) => this.runExactCommand(`batch:${id}`, () => gateway.updateBatch(id, input)),
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
      updateBatch: (id, input) => this.runExactCommand(`batch:${id}`, () => gateway.updateBatch(id, input)),
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
    this.setState({ draft, ...this.clearDerekTweakOnEdit(field), status: 'Draft changed' });
    this.scheduleApply();
  }

  // Editing the value Derek changed drops the tweak marking (and the pending
  // next-shot stamp) — the recipe is no longer running that Derek tweak. Only
  // an edit to the tweaked control counts; changing a different value leaves
  // the marking on the one that is still Derek's.
  private clearDerekTweakOnEdit(field: string): { derekTweakChip?: null } {
    const parameter = this.state.derekTweakChip?.parameter;
    if (!parameter) return {};
    const editsTweak =
      (parameter === 'dose' && field === 'dose') ||
      (parameter === 'yield' && (field === 'yield' || field === 'ratio')) ||
      (parameter === 'grind' && field === 'grinderSetting') ||
      (parameter === 'brew_temperature' && field === 'temperature');
    if (!editsTweak) return {};
    clearPendingDerekTweak();
    return { derekTweakChip: null };
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
      const verifiedMachineSettings = await this.runExactMachineCommand((lane) =>
        updateSteamPurgeModeAndReadBack(plan.nextMode, {
          updateMachineSettings: (patch) => lane.updateMachineSettings(patch),
          readMachineSettings: () => gateway.machineSettings()
        })
      );
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
    if (!this.state.demo && this.state.startupPhase !== 'connected') {
      this.setState({ status: 'Machine settings are read-only until live data reconnects' });
      return;
    }
    const plan = buildMachineWorkflowPlan({
      workflow: this.state.workflow,
      steamSettings,
      hotWaterData,
      rinseData,
      currentMachineSettings: this.state.machineSettings,
      hotWaterStopMode: this.state.hotWaterStopMode,
      status
    });
    this.machineWorkflowCommands.stageDesired(plan.workflow);
    this.setState({
      workflow: plan.workflow,
      machineSettings: plan.machineSettings,
      busy: true,
      status: plan.savingStatus
    });
    const persist = (lane: OwnedMachineLane | null) => persistMachineWorkflowPlan(plan, this.state.demo, {
      writeHotWaterWeightTarget: (value) => writeHotWaterWeightTarget(value),
      updateWorkflow: (workflow) => lane?.updateWorkflow(workflow) ?? Promise.resolve(workflow),
      updateMachineSettings: (patch) => lane?.updateMachineSettings(patch) ?? Promise.resolve(),
      logDirectMachineUpdateFailure: (error) => {
        console.error('[Beanie] Direct machine settings update failed', error);
      }
    });
    const result = this.state.demo
      ? await persist(null)
      : await this.runExactMachineCommand((lane) => persist(lane));
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

  private currentSteamSettings(workflow = this.state.workflow): SteamSettings {
    if (workflow?.steamSettings) return steamValues(workflow, null);
    return steamValues(workflow, this.state.machineSettings);
  }

  private currentHotWaterData(workflow = this.state.workflow): HotWaterData {
    const values = workflow?.hotWaterData
      ? hotWaterValues(workflow, null)
      : hotWaterValues(workflow, this.state.machineSettings);
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

  private currentRinseData(workflow = this.state.workflow): RinseData {
    if (workflow?.rinseData) return flushValues(workflow, null);
    return flushValues(workflow, this.state.machineSettings);
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
    if (edit.target === 'screensaver-brightness') {
      const percent = Number(value);
      if (Number.isFinite(percent)) {
        this.updateSettingsPreferences({ screensaverBrightness: Math.max(0, Math.min(100, Math.round(percent))) });
      }
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
    this.setState({
      draft,
      ...this.clearDerekTweakOnEdit(dialog.field),
      modal: null,
      editDialog: null,
      status: 'Draft changed'
    });
    this.scheduleApply();
  }

  private render(): void {
    if (!this.state.settingsLoaded) {
      morphRender(
        this.root,
        `<div class="app-shell">
          <div class="settings-boot">
            <div class="settings-boot-spinner"></div>
            <p>Loading settings…</p>
          </div>
        </div>`
      );
      this.topbarIsland.bind(this.root);
      this.screensaverIsland.bind(this.root);
      this.derekStreamIsland.bind(this.root);
      this.syncPresentationActivity();
      return;
    }
    const bean = this.selectedBean();
    const focus = captureFocus();
    const isPhone = this.isPhoneLayout();
    const renderPhone = isPhone && (this.state.view === 'workbench' || this.state.view === 'settings');
    const isPage = this.state.view !== 'workbench' && !renderPhone;
    // Publish the current model before morphing. If the topbar is remounted,
    // bind() can replay only this current state—never a throttled stale frame.
    const topbarStats = this.topbarViewModel();
    this.topbarIsland.offer(topbarStats);
    const html = `
      <div class="app-shell ${renderPhone ? 'app-shell-phone' : isPage ? 'app-shell-page' : ''} ${this.hasRuntimeModeBanner() ? 'has-runtime-banner' : ''}">
        ${this.renderRuntimeModeBanner()}
        ${this.renderOperationFeedback()}
        ${renderPhone ? this.renderPhoneApp(bean) : isPage ? this.renderPage() : this.renderWorkbench(bean, topbarStats)}
        ${this.renderLivePanel()}
        ${this.renderModal()}
        ${isPage ? '' : this.renderWaterAlert()}
        ${this.renderWaterWarningBanner()}
        ${this.renderSleepOverlay()}
        ${this.renderWakeAppZonePreview()}
        ${this.renderStoreErrorOverlay()}
      </div>
    `;
    morphRender(this.root, html);
    this.topbarIsland.bind(this.root);
    this.screensaverIsland.bind(this.root);
    this.screensaverIsland.updateClock(
      clockLabel(new Date(), this.state.settingsPreferences.clockFormat),
      this.saverClockPos
    );
    this.screensaverIsland.setClockOnPhoto(
      screensaverShowsPhotos(this.state.settingsPreferences.screensaverMode) &&
        this.state.screensaverPhotos.length > 0
    );
    this.screensaverIsland.syncPhoto(
      this.state.screensaverPhotos[this.saverPhotoIndex] ?? null
    );
    this.syncSaverPhotoTimer();
    this.derekStreamIsland.bind(this.root);
    this.bindLiveElements();
    this.bindDetailChart();
    this.bindShotStagesChart();
    this.bindCalibratorChart();
    this.syncPresentationActivity();
    restoreFocus(this.root, focus);
    this.focusNotesEditor();
  }


  // When the notes modal has just opened, drop the caret into the textarea (at the
  // end of any existing text) so the keyboard comes up ready to type. One-shot so
  // later re-renders don't steal focus back while the user is mid-edit elsewhere.
  private focusNotesEditor(): void {
    if (!this.pendingNotesFocus) return;
    this.pendingNotesFocus = false;
    const input = this.root.querySelector<HTMLTextAreaElement>('[data-action="pe-notes-input"]');
    if (!input) return;
    input.focus();
    const end = input.value.length;
    try {
      input.setSelectionRange(end, end);
    } catch {
      /* not selectable */
    }
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
          {
            phone: true,
            flowCalibration: this.flowCalibrationDisplay(),
            resourceStates: this.state.settingsResources,
            syncedPreferencesWritable: this.state.demo || this.state.settingsStoreAvailable,
            scannerKeySet: readGeminiApiKey() != null
          }
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
      settingsHtml,
      derekEnabled: this.derekFlow.derekEnabled()
    });
  }

  private renderWorkbench(bean: Bean | null, topbarStats: TopbarViewModel): string {
    const draft = this.state.draft;
    const brewTemp = this.brewTempValue();
    const cleaningDueNow = cleaningDue(this.state.cleaning, this.state.cleaningThreshold);
    return renderWorkbenchView({
      topbar: {
        stats: topbarStats,
        machineCommands: {
          available: machineCommandsAvailable(this.state.demo, this.state.machineInfo),
          current: this.state.machine?.state?.state ?? 'idle',
          busy: this.state.busy
        },
        clock: this.state.settingsPreferences.topbarClock
          ? clockLabel(new Date(), this.state.settingsPreferences.clockFormat)
          : null,
        cleaningDue: cleaningDueNow,
        asleep: this.state.asleep,
        derekEnabled: this.derekFlow.derekEnabled()
      },
      hero: this.heroViewModel(bean),
      recipe: {
        draft,
        grinderStep: this.grinderStep(),
        ratioLabel: formatRatio(ratioFor(draft.dose, draft.yield)),
        brewTempLabel: brewTemp == null ? '--' : `${brewTemp.toFixed(1)}`,
        applyState: this.state.applyState,
        derekTweak: this.state.derekTweakChip
          ? {
              summary: this.state.derekTweakChip.summary,
              parameter: this.state.derekTweakChip.parameter
            }
          : null
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
      this.detailChart?.dispose();
      this.detailChart = null;
      this.detailChartCanvas = null;
      this.detailChartShotId = null;
      this.detailChartCompareShotId = null;
      return;
    }
    const compare = this.compareShotForDetailChart();
    // Skip when the same canvas survived with the same shots and the cached
    // models are still valid for those shots' measurements.
    const cachedModel = this.shotChartModelCache;
    const compareCacheValid =
      compare == null
        ? this.detailChartCompareShotId == null
        : this.detailChartCompareShotId === compare.id &&
          this.compareChartModelCache?.shotId === compare.id &&
          this.compareChartModelCache.measurements === compare.measurements &&
          this.compareChartModelCache.profile === (compare.workflow?.profile ?? null);
    if (
      canvas === this.detailChartCanvas &&
      this.detailChart != null &&
      shot.id === this.detailChartShotId &&
      cachedModel?.shotId === shot.id &&
      cachedModel.measurements === shot.measurements &&
      cachedModel.profile === (shot.workflow?.profile ?? null) &&
      compareCacheValid
    ) {
      // Layout, DPR, theme, and visibility are independent event sources owned
      // by LiveChart. A stable bind is therefore genuinely silent.
      return;
    }
    // Reuse the chart instance while the canvas element survives: LiveChart's
    // constructor attaches hover listeners to the canvas, so re-constructing on
    // a surviving canvas would stack them.
    const reuse = canvas === this.detailChartCanvas && this.detailChart != null;
    if (!reuse) this.detailChart?.dispose();
    const chart = reuse
      ? this.detailChart!
      : new LiveChart(canvas, { detailed: true, pixelScale: 3, hover: true });
    this.detailChart = chart;
    this.detailChartCanvas = canvas;
    this.detailChartShotId = shot.id;
    this.detailChartCompareShotId = compare?.id ?? null;
    const model = this.shotChartModel(shot);
    chart.setModel(compare ? overlayComparisonModel(model, this.compareChartModel(compare)) : model);
    // Draw after layout so the canvas has its CSS box for bounded DPR sizing.
    chart.invalidate(reuse ? 'model' : 'layout');
  }

  private compareShotForDetailChart(): ShotRecord | null {
    return compareHistoryShot(this.state.shots, this.state.detailShotId, this.state.compareShotId);
  }

  // Attaches the chart inside the shot-stages modal. The model is the same
  // cached one the detail chart uses (markers included), just drawn larger.
  private bindShotStagesChart(): void {
    if (this.state.modal !== 'shot-stages') {
      this.shotStagesChart?.dispose();
      this.shotStagesChart = null;
      this.shotStagesChartCanvas = null;
      this.shotStagesChartShotId = null;
      this.shotStagesChartMeasurements = null;
      this.shotStagesChartProfile = null;
      return;
    }
    const canvas = this.root.querySelector<HTMLCanvasElement>('#shot-stages-canvas');
    const shot = canvas ? this.selectedHistoryShot() : null;
    if (!canvas || !shot) {
      this.shotStagesChart?.dispose();
      this.shotStagesChart = null;
      this.shotStagesChartCanvas = null;
      this.shotStagesChartShotId = null;
      this.shotStagesChartMeasurements = null;
      this.shotStagesChartProfile = null;
      return;
    }
    const reuse = canvas === this.shotStagesChartCanvas && this.shotStagesChart != null;
    const sameModel =
      reuse &&
      this.shotStagesChartShotId === shot.id &&
      this.shotStagesChartMeasurements === shot.measurements &&
      this.shotStagesChartProfile === (shot.workflow?.profile ?? null);
    if (sameModel) return;
    if (!reuse) this.shotStagesChart?.dispose();
    const chart = reuse
      ? this.shotStagesChart!
      : new LiveChart(canvas, { detailed: true, pixelScale: 3, hover: true });
    this.shotStagesChart = chart;
    this.shotStagesChartCanvas = canvas;
    this.shotStagesChartShotId = shot.id;
    this.shotStagesChartMeasurements = shot.measurements;
    this.shotStagesChartProfile = shot.workflow?.profile ?? null;
    chart.setModel(this.shotChartModel(shot));
    chart.invalidate(reuse ? 'model' : 'layout');
  }

  // Returns the canvas chart model for a saved shot, rebuilding only when the
  // shot (or its measurement array instance) changes.
  private shotChartModel(shot: ShotRecord): LiveChartModel {
    const cached = this.shotChartModelCache;
    const profile = shot.workflow?.profile ?? null;
    if (
      cached &&
      cached.shotId === shot.id &&
      cached.measurements === shot.measurements &&
      cached.profile === profile
    ) {
      return cached.model;
    }
    const model = chartModelFromShot(shot);
    this.shotChartModelCache = { shotId: shot.id, measurements: shot.measurements, profile, model };
    return model;
  }

  private compareChartModel(shot: ShotRecord): LiveChartModel {
    const cached = this.compareChartModelCache;
    const profile = shot.workflow?.profile ?? null;
    if (
      cached &&
      cached.shotId === shot.id &&
      cached.measurements === shot.measurements &&
      cached.profile === profile
    ) {
      return cached.model;
    }
    const model = chartModelFromShot(shot);
    this.compareChartModelCache = { shotId: shot.id, measurements: shot.measurements, profile, model };
    return model;
  }

  private bindCalibratorChart(): void {
    if (this.state.view !== 'flow-calibrator') {
      this.calibratorChart?.dispose();
      this.calibratorChart = null;
      this.calibratorChartCanvas = null;
      this.calibratorChartShotId = null;
      this.calibratorChartMeasurements = null;
      this.calibratorChartProfile = null;
      this.calibratorChartFactor = null;
      return;
    }
    const canvas = this.root.querySelector<HTMLCanvasElement>('#flow-cal-canvas');
    if (!canvas) {
      this.calibratorChart?.dispose();
      this.calibratorChart = null;
      this.calibratorChartCanvas = null;
      this.calibratorChartShotId = null;
      this.calibratorChartMeasurements = null;
      this.calibratorChartProfile = null;
      this.calibratorChartFactor = null;
      return;
    }
    const shot = this.flowCalibrationSelectedShot();
    if (!shot) {
      this.calibratorChart?.dispose();
      this.calibratorChart = null;
      this.calibratorChartCanvas = null;
      this.calibratorChartShotId = null;
      this.calibratorChartMeasurements = null;
      this.calibratorChartProfile = null;
      this.calibratorChartFactor = null;
      return;
    }
    // Show the two calibration lines — machine flow and scale (weight) flow —
    // plus pressure for context. Only the machine-flow line is scaled by the
    // preview multiplier, so −/+ visibly moves it onto the scale line. Scale
    // from the multiplier the shot was actually pulled under when reaprime
    // recorded it; otherwise fall back to the open-time estimate.
    const shotBase = recordedFlowMultiplier(shot) ?? this.flowCalibrationBase();
    const factor = calibrationPreviewFactor(shotBase, this.flowCalibrationDraft());
    const profile = shot.workflow?.profile ?? null;
    const reuse = canvas === this.calibratorChartCanvas && this.calibratorChart != null;
    if (
      reuse &&
      this.calibratorChartShotId === shot.id &&
      this.calibratorChartMeasurements === shot.measurements &&
      this.calibratorChartProfile === profile &&
      this.calibratorChartFactor === factor
    ) return;
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
    // Reuse the instance while the canvas survives (see bindDetailChart); the
    // model is re-set every time because the preview factor tracks the draft.
    if (!reuse) this.calibratorChart?.dispose();
    const chart = reuse
      ? this.calibratorChart!
      : new LiveChart(canvas, { detailed: true, pixelScale: 3, hover: true });
    this.calibratorChart = chart;
    this.calibratorChartCanvas = canvas;
    this.calibratorChartShotId = shot.id;
    this.calibratorChartMeasurements = shot.measurements;
    this.calibratorChartProfile = profile;
    this.calibratorChartFactor = factor;
    chart.setModel({ ...model, series });
    chart.invalidate(reuse ? 'model' : 'layout');
  }

  private renderSleepOverlay(): string {
    const model = sleepOverlayModel({
      asleep: this.state.asleep,
      appAwake: this.state.appAwake,
      usesWebSleepControls: this.usesWebSleepControls(),
      wakeAppZoneEnabled: this.state.settingsPreferences.wakeAppZoneEnabled,
      wakeAppZonePosition: this.state.settingsPreferences.wakeAppZonePosition
    });
    const preview = this.state.saverPreview;
    if (!model.showOverlay && !preview) return '';
    // The wake-app zone layers on top of (and is rendered after) the wake-machine
    // overlay so a tap on the strip opens the app without waking the machine.
    const zone = !preview && model.showWakeAppZone
      ? `<button type="button" class="sleep-wake-app-zone sleep-wake-app-zone-${model.zonePosition}" data-action="wake-app" aria-label="Open app without waking the machine"></button>`
      : '';
    const action = preview ? 'saver-preview-end' : 'wake';
    const label = preview ? 'End screensaver preview' : 'Wake machine';
    return `
      <button type="button" class="sleep-overlay" data-action="${action}" aria-label="${label}">
        ${this.renderScreensaverContent()}
      </button>
      ${zone}
    `;
  }

  // Screensaver content inside the sleep overlay, modelled on de1app's saver
  // page: an optional photo slideshow (two stacked images crossfaded by the
  // slideshow timer) and an optional clock that wanders to avoid burn-in.
  private renderScreensaverContent(): string {
    const prefs = this.state.settingsPreferences;
    const photos = this.state.screensaverPhotos;
    const showPhotos = screensaverShowsPhotos(prefs.screensaverMode) && photos.length > 0;
    const showClock = screensaverShowsClock(prefs.screensaverMode, photos.length);
    if (!showPhotos && !showClock) return '';
    this.saverPhotoIndex = photos.length > 0 ? this.saverPhotoIndex % photos.length : 0;
    const photoLayers = showPhotos
      ? `<img id="saver-photo-a" class="saver-photo active" data-morph-skip="screensaver-photo" alt="" src="${escapeAttr(photos[this.saverPhotoIndex]!)}" />
         <img id="saver-photo-b" class="saver-photo" data-morph-skip="screensaver-photo" alt="" />`
      : '';
    const clock = showClock
      ? `<span id="saver-clock" class="saver-clock ${showPhotos ? 'on-photo' : ''}" data-morph-skip="screensaver-clock" style="left: ${this.saverClockPos.leftPct}%; top: ${this.saverClockPos.topPct}%;">${escapeHtml(clockLabel(new Date(), prefs.clockFormat))}</span>`
      : '';
    return `${photoLayers}${clock}`;
  }

  private renderWakeAppZonePreview(): string {
    const position = this.state.wakeZonePreview;
    if (!position) return '';
    return `<div class="sleep-wake-app-zone sleep-wake-app-zone-${position} wake-zone-preview" aria-hidden="true"></div>`;
  }

  private renderStoreErrorOverlay(): string {
    if (!this.state.storeError) return '';
    const count = this.settingsStoreSync.snapshot.failedWrites.length;
    const noun = count === 1 ? 'setting change' : 'setting changes';
    return `
      <div class="store-error-overlay" role="alertdialog" aria-modal="true" aria-labelledby="store-error-title">
        <div class="store-error-dialog">
          <h2 id="store-error-title">Couldn't save to the machine</h2>
          <p>${count} ${noun} didn't reach the gateway. The change is shown temporarily here but is not saved or synced.</p>
          <div class="store-error-actions">
            <button type="button" class="store-error-retry" data-action="retry-store-write">Retry</button>
            <button type="button" class="store-error-dismiss" data-action="dismiss-store-error">Discard and reload</button>
          </div>
        </div>
      </div>
    `;
  }

  private renderRuntimeModeBanner(): string {
    if (!this.hasRuntimeModeBanner()) return '';
    if (this.state.startupPhase === 'retrying') {
      return `<div class="runtime-mode-banner retrying" role="status"><strong>Reconnecting…</strong><span>Keeping the current data visible.</span></div>`;
    }
    const demo = this.state.startupPhase === 'demo' || this.state.demo;
    const limited = this.state.startupPhase === 'limited';
    return `
      <div class="runtime-mode-banner ${demo ? 'demo' : limited ? 'limited' : 'offline'}" role="status">
        <strong>${demo ? 'DEMO · sample data' : limited ? 'LIMITED · mixed data' : 'OFFLINE · cached data'}</strong>
        <span>${demo ? 'Machine actions are simulated and changes are not saved.' : limited ? 'Some resources are cached or unavailable; Beanie is retrying them.' : 'Data may be stale; machine changes can fail until the gateway returns.'}</span>
        <button type="button" data-action="retry-startup">Retry now</button>
      </div>`;
  }

  private hasRuntimeModeBanner(): boolean {
    return this.state.startupPhase !== 'connected' && this.state.startupPhase !== 'connecting';
  }

  private renderOperationFeedback(): string {
    if (Date.now() >= this.statusFeedbackUntilMs) return '';
    const status = this.state.status.trim();
    if (!status) return '';
    const alert = /fail|couldn['’]t|unavailable|error|not sent|reverted/i.test(status);
    return `<div class="operation-feedback ${alert ? 'alert' : ''}" role="status" aria-live="polite">${escapeHtml(status)}</div>`;
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
      hiddenProfiles: this.state.hiddenProfiles,
      showLoadHint: shouldShowSecondTapHint('profile')
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
      batchesByBean: this.state.batchesByBean,
      derekEnabled: this.derekFlow.derekEnabled()
    });
  }

  private selectedHistoryShot(): ShotRecord | null {
    return selectHistoryShot(this.state.shots, this.state.detailShotId);
  }


  private findProfileByTitle(title: string): ProfileRecord | null {
    const wanted = title.trim().toLowerCase();
    if (!wanted) return null;
    const titled = this.state.profiles.map((record) => ({
      record,
      title: (record.profile.title ?? '').trim().toLowerCase()
    }));
    return (
      titled.find((item) => item.title === wanted)?.record ??
      titled.find((item) => item.title.startsWith(wanted))?.record ??
      titled.find((item) => item.title.includes(wanted))?.record ??
      null
    );
  }


  private renderDerekModal(): string {
    const derek = this.state.derek;
    if (!derek) return '';
    return renderDerekModalView({
      state: derek,
      contextChips: this.derekFlow.derekContextChips(),
      tweakPreviews: this.derekFlow.derekTweakPreviews(derek)
    });
  }


  private renderModal(): string {
    if (this.state.modal === 'derek') return this.renderDerekModal();
    if (this.state.modal === 'bean-picker') return this.renderBeanPickerModal();
    if (this.state.modal === 'batch-storage') return this.renderBatchStorageModal();
    if (this.state.modal === 'edit-number') return this.renderEditDialog();
    if (this.state.modal === 'edit-shot') return this.renderShotEditModal();
    if (this.state.modal === 'machine-label') return this.renderMachineLabelModal();
    if (this.state.modal === 'no-scale-shot') return this.renderNoScaleShotModal();
    if (this.state.modal === 'label-scanner') return this.renderLabelScannerModal();
    if (this.state.modal === 'delete-shot') return this.renderDeleteShotModal();
    if (this.state.modal === 'shot-stages') return this.renderShotStagesModal();
    if (this.state.modal === 'cleaning-wizard') return this.renderCleaningWizardModal();
    if (this.state.modal === 'import-profile') return this.renderImportProfileModal();
    if (this.state.modal === 'delete-profile') return this.renderDeleteProfileModal();
    if (this.state.modal === 'notes-editor') return this.renderProfileNotesModal();
    return '';
  }

  private renderProfileNotesModal(): string {
    const pe = this.state.profileEditor;
    if (!pe) return '';
    return renderProfileNotesModalView(pe.notes);
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

  // Live-shot style replay of the selected saved shot: its stage rail (with
  // advance reasons rebuilt from the trace and the persisted stop reason on
  // the last reached step) beside a full-size chart.
  private renderShotStagesModal(): string {
    const shot = this.selectedHistoryShot();
    if (!shot) return '';
    const profile = shot.workflow?.profile ?? null;
    const steps = profile ? createProfileEditorState(profile).steps : [];
    return renderShotStagesModalView({
      shot,
      stages: historicShotStages(shot, steps)
    });
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
        {
          flowCalibration: this.flowCalibrationDisplay(),
          resourceStates: this.state.settingsResources,
          syncedPreferencesWritable: this.state.demo || this.state.settingsStoreAvailable,
          scannerKeySet: readGeminiApiKey() != null
        }
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
        this.state.busy,
        this.state.demo || (this.state.settingsStoreAvailable && this.settingsResourceWritable('calibration'))
      )}
    `;
  }

  private renderProfileEditorPage(): string {
    const pe = this.state.profileEditor;
    if (!pe) return this.pageHeader('Profile');
    const disabled = this.state.busy ? ' disabled' : '';
    // One compact header row — Back · Basic/Advanced toggle · Save — no title
    // (tablet real estate). Basic and advanced share the same dark chrome.
    return `
      <header class="page-head pe-editor-head">
        <button class="page-back" type="button" data-action="go-view" data-value="profiles" aria-label="Back"${disabled}>${icon('chevron-left')}<span>Back</span></button>
        ${renderEditorModeBar(pe, this.state.busy)}
        <div class="page-head-actions">
          <button type="button" class="pe-save commit-action" data-action="save-profile"${disabled}>${icon('check')}<span>${this.state.busy ? 'Saving…' : 'Save'}</span></button>
        </div>
      </header>
      <fieldset class="page-body profile-editor-page"${disabled}>
        ${renderProfileEditor(pe)}
      </fieldset>
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
    // App-side start buttons stand in for the physical GHC buttons where those
    // are absent (simulator/demo and GHC-less machines).
    const laneStart = (state: 'steam' | 'hotWater' | 'flush') =>
      machineCommandsAvailable(this.state.demo, this.state.machineInfo)
        ? { state, busy: this.state.busy }
        : null;
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
            start: laneStart('steam'),
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
            start: laneStart('hotWater'),
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
            start: laneStart('flush'),
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
      connected: this.state.startupPhase === 'connected' && !this.state.gatewayLinkDown,
      loading: this.state.loading,
      status: this.state.status,
      gatewayHost: gatewayHttpOrigin() || location.origin,
      machine: this.state.machine,
      scale: this.state.scale,
      machineRefillLevelMm: this.state.machineRefillLevel,
      screensaverPhotoCount: this.state.screensaverPhotos.length
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

  // Load the reaprime-backed settings bundle when Settings or a workbench
  // device action first needs it. Concurrent callers share the same request so
  // a top-bar Connect tap cannot race the Settings view's provenance load.
  private loadReaSettings(): Promise<void> {
    if (
      this.state.settingsBundle &&
      (this.state.settingsSource === 'gateway' || this.state.settingsSource === 'demo')
    ) return Promise.resolve();
    if (this.settingsBundleLoadPromise) return this.settingsBundleLoadPromise;
    const load = this.runLoadReaSettings();
    this.settingsBundleLoadPromise = load;
    const clearLoad = () => {
      if (this.settingsBundleLoadPromise === load) this.settingsBundleLoadPromise = null;
    };
    void load.then(clearLoad, clearLoad);
    return load;
  }

  private async runLoadReaSettings(): Promise<void> {
    let result: Awaited<ReturnType<typeof this.settingsController.loadSettingsBundle>>;
    result = await this.settingsController.loadSettingsBundle(this.state.demo);
    if (this.disposed) return;
    this.setState({
      settingsBundle: result.bundle,
      settingsSource: result.source,
      settingsResources: result.resources,
      status: result.status ?? this.state.status
    });
    // Ground the per-profile global default from the machine's real calibration
    // the first time we see it, so profiles without an override keep the user's
    // existing calibration instead of being reset to 1.0.
    if (result.source === 'gateway' && this.state.settingsStoreAvailable && readFlowCalibrationGlobal() == null) {
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

  private settingsResourceWritable(resource: SettingsResourceKey): boolean {
    return this.settingsLocal || settingsResourceWritable(this.state.settingsResources, resource);
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
      settingsResources: this.state.settingsResources
        ?? (this.state.demo ? settingsResourceStates('demo') : null),
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
    if (!this.state.demo && (!this.state.settingsStoreAvailable || !this.settingsResourceWritable('calibration'))) {
      this.setState({ status: 'Flow calibration is read-only until live settings are available' });
      return;
    }
    const value = roundCalibration(clampCalibration(raw));
    writeFlowCalibrationGlobal(value);
    await this.commitCalibrationConfig(value, 'Default flow calibration saved');
  }

  // Save the tuned value as an OVERRIDE for the selected shot's profile. A value
  // equal to the default clears the override (the profile reverts to following
  // the default). The machine re-syncs to the active profile afterwards.
  private async saveFlowCalibrationProfile(raw: number): Promise<void> {
    if (!Number.isFinite(raw)) return;
    if (!this.state.demo && (!this.state.settingsStoreAvailable || !this.settingsResourceWritable('calibration'))) {
      this.setState({ status: 'Flow calibration is read-only until live settings are available' });
      return;
    }
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
    if (!this.settingsResourceWritable('calibration')) return;
    const resolved = this.resolveProfileFlowCalibration(profileTitle);
    if (resolved == null || resolved === this.currentFlowCalibrationMultiplier()) return;
    const bundle = this.state.settingsBundle ?? demoSettingsBundle();
    this.setState({
      settingsBundle: { ...bundle, calibration: { ...bundle.calibration, flowMultiplier: resolved } },
      status: `Flow calibration ${resolved.toFixed(2)}×`
    });
    if (this.settingsLocal) return;
    try {
      await this.runExactMachineCommand((lane) => lane.updateCalibration(resolved));
    } catch (error) {
      console.error('[Beanie] Per-profile flow calibration apply failed', error);
    }
  }

  private async scanDevices(): Promise<void> {
    if (!this.settingsResourceWritable('devices')) {
      this.setState({ status: 'Device list is unavailable — reconnect and reload Settings' });
      return;
    }
    this.setState({ status: 'Scanning for devices…' });
    const result = await this.settingsController.scanDevices(this.settingsLocal);
    if (result.devices) this.patchBundle({ devices: result.devices });
    this.setState({ status: result.status });
  }

  private async connectPreferredDevices(): Promise<void> {
    // The workbench exposes this action before Settings has necessarily opened.
    // Load endpoint provenance on demand so a live gateway is not rejected just
    // because the settings bundle has not yet been inspected this session.
    if (!this.settingsLocal && this.state.settingsResources == null) {
      this.setState({ status: 'Loading device settings…' });
      await this.loadReaSettings();
    }
    if (!this.settingsResourceWritable('devices') || !this.settingsResourceWritable('rea')) {
      this.setState({ status: 'Preferred devices are unavailable — reconnect and reload Settings' });
      return;
    }
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
      await this.runExactCommand('scale', () => gateway.tareScale());
      this.setState({ status: 'Scale tared' });
    } catch (error) {
      console.error('[Beanie] Scale tare failed', error);
      this.setState({ status: 'Tare failed' });
    }
  }

  private async connectDevice(id: string, connect: boolean): Promise<void> {
    if (!id) return;
    if (!this.settingsResourceWritable('devices')) {
      this.setState({ status: 'Device list is unavailable — no change was sent' });
      return;
    }
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
    if (!this.settingsResourceWritable('display')) {
      this.setState({ status: 'Display settings are unavailable — no change was sent' });
      return;
    }
    const brightness = Math.max(0, Math.min(100, Math.round(parsed)));
    const mutation = this.beginSettingsMutation('display');
    const current = this.state.settingsBundle?.display ?? demoSettingsBundle().display;
    this.patchBundle({
      display: {
        ...current,
        brightness,
        requestedBrightness: brightness,
        lowBatteryBrightnessActive: false
      }
    });
    if (brightness !== 0) this.sleepBrightnessDimmed = false;
    if (this.settingsLocal) {
      this.setState({ status: 'Brightness saved (demo)' });
      return;
    }

    try {
      const display = await this.setGatewayBrightnessLatest(brightness);
      if (!display) return;
      if (!this.isCurrentSettingsMutation('display', mutation)) return;
      this.patchBundle({ display });
      this.setState({ status: 'Brightness saved' });
    } catch (error) {
      console.error('[Beanie] Display brightness change failed', error);
      if (!this.isCurrentSettingsMutation('display', mutation)) return;
      this.patchBundle({ display: current });
      await this.refreshDisplayStateSilently();
      this.setState({ status: 'Brightness save failed — change reverted' });
    }
  }

  private async requestMachineState(state: string): Promise<void> {
    if (!this.hasLiveMachineAuthority()) {
      this.setState({ status: 'Machine controls are read-only until live data reconnects' });
      return;
    }
    const result = await this.settingsController.requestMachineState({ state, local: this.settingsLocal });
    if (this.disposed) return;
    this.setState({ status: result.status });
    if (result.sleepRequested) {
      // An explicit sleep ends a wake-app override so the screen can re-dim and
      // the screensaver returns — even when the machine was already asleep (no
      // telemetry transition to clear it for us).
      if (this.state.appAwake) this.setState({ appAwake: false });
      this.scheduleSleepBrightnessDim(1000);
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
    if (!this.settingsResourceWritable('schedules')) {
      this.setState({ status: 'Wake schedules are unavailable — reconnect and reload Settings' });
      return;
    }
    const result = await this.settingsController.addWakeSchedule({
      time,
      local: this.settingsLocal,
      current: this.state.settingsBundle?.schedules ?? []
    });
    if (result.schedules) this.patchBundle({ schedules: result.schedules });
    if (result.status) this.setState({ status: result.status });
  }

  private async deleteWakeSchedule(id: string): Promise<void> {
    if (!this.settingsResourceWritable('schedules')) {
      this.setState({ status: 'Wake schedules are unavailable — no change was sent' });
      return;
    }
    const previous = this.state.settingsBundle?.schedules ?? [];
    const deleted = previous.find((schedule) => schedule.id === id) ?? null;
    const deletedIndex = previous.findIndex((schedule) => schedule.id === id);
    const mutationKey = `schedule:${id}`;
    const mutation = this.beginSettingsMutation(mutationKey);
    const remaining = previous.filter((s) => s.id !== id);
    this.patchBundle({ schedules: remaining });
    const result = await this.settingsController.deleteWakeSchedule({ id, local: this.settingsLocal });
    if (!this.isCurrentSettingsMutation(mutationKey, mutation)) return;
    if (!result.ok && deleted) {
      const current = this.state.settingsBundle?.schedules ?? [];
      if (!current.some((schedule) => schedule.id === id)) {
        const restored = [...current];
        restored.splice(Math.max(0, Math.min(deletedIndex, restored.length)), 0, deleted);
        this.patchBundle({ schedules: restored });
      }
    }
    if (result.status) this.setState({ status: result.status });
  }

  private async toggleWakeSchedule(id: string, enabled: boolean): Promise<void> {
    if (!this.settingsResourceWritable('schedules')) {
      this.setState({ status: 'Wake schedules are unavailable — no change was sent' });
      return;
    }
    const previous = this.state.settingsBundle?.schedules ?? [];
    const previousSchedule = previous.find((schedule) => schedule.id === id) ?? null;
    const mutationKey = `schedule:${id}`;
    const mutation = this.beginSettingsMutation(mutationKey);
    const schedules = previous.map((s) =>
      s.id === id ? { ...s, enabled } : s
    );
    this.patchBundle({ schedules });
    try {
      await this.settingsController.toggleWakeSchedule({ id, enabled, local: this.settingsLocal });
    } catch {
      if (!this.isCurrentSettingsMutation(mutationKey, mutation)) return;
      if (previousSchedule) {
        const current = this.state.settingsBundle?.schedules ?? [];
        this.patchBundle({
          schedules: current.map((schedule) => schedule.id === id ? { ...schedule, enabled: previousSchedule.enabled } : schedule)
        });
      }
      this.setState({ status: 'Could not update schedule — change reverted' });
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
    if (!this.settingsResourceWritable('plugins')) {
      this.setState({ status: 'Plugin status is unavailable — no change was sent' });
      return;
    }
    const previous = this.state.settingsBundle?.plugins ?? [];
    const previousPlugin = previous.find((plugin) => plugin.id === id) ?? null;
    const mutationKey = `plugin-toggle:${id}`;
    const mutation = this.beginSettingsMutation(mutationKey);
    const plugins = previous.map((p) =>
      p.id === id ? { ...p, loaded: enable } : p
    );
    this.patchBundle({ plugins });
    if (this.settingsLocal) return;
    try {
      await this.runExactCommand(`plugin:${id}`, () =>
        enable ? gateway.enablePlugin(id) : gateway.disablePlugin(id)
      );
      if (!this.isCurrentSettingsMutation(mutationKey, mutation)) return;
      this.setState({ status: enable ? 'Plugin enabled' : 'Plugin disabled' });
    } catch (error) {
      console.error('[Beanie] Plugin toggle failed', error);
      if (!this.isCurrentSettingsMutation(mutationKey, mutation)) return;
      if (previousPlugin) {
        const current = this.state.settingsBundle?.plugins ?? [];
        this.patchBundle({
          plugins: current.map((plugin) => plugin.id === id ? { ...plugin, loaded: previousPlugin.loaded } : plugin)
        });
      }
      this.setState({ status: 'Plugin change failed — change reverted' });
    }
  }

  private async togglePluginConfig(id: string): Promise<void> {
    if (this.state.pluginConfig?.id === id) {
      this.setState({ pluginConfig: null });
      return;
    }
    if (!pluginSettingsSpec(id)) return;
    if (!this.settingsResourceWritable('plugins')) {
      this.setState({ status: 'Plugin settings are unavailable — reconnect and try again' });
      return;
    }
    const result = await this.settingsController.loadPluginSettings({ local: this.settingsLocal, id });
    if (!result.settings) {
      this.setState({ pluginConfig: null, status: 'Plugin settings could not be loaded — nothing was changed' });
      return;
    }
    this.setState({ pluginConfig: this.makePluginConfig(id, result.settings) });
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
    if (!this.settingsResourceWritable('plugins')) {
      this.setState({ status: 'Plugin settings are unavailable — no change was made' });
      return;
    }
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
    if (!this.settingsResourceWritable('plugins')) {
      this.setState({ status: 'Plugin settings are unavailable — nothing was saved' });
      return;
    }
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
    if (!this.settingsResourceWritable('plugins')) {
      this.setState({ status: 'Plugin settings are unavailable — verification was not sent' });
      return;
    }
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
    if (!this.settingsResourceWritable(field.group)) {
      this.setState({ status: `${field.label} is unavailable — reconnect and reload Settings` });
      return;
    }
    const value = coerceFieldValue(field, raw);
    const previousValue = fieldValue(bundle, field);
    const mutationKey = `field:${field.group}:${key}`;
    const mutation = this.beginSettingsMutation(mutationKey);
    this.setState({ settingsBundle: setBundleField(bundle, field, value), status: 'Setting updated' });
    if (this.settingsLocal) return; // local-only without a gateway
    try {
      await this.persistSetting(field.group, key, value);
    } catch (error) {
      console.error('[Beanie] Update setting failed', error);
      if (!this.isCurrentSettingsMutation(mutationKey, mutation)) return;
      const current = this.state.settingsBundle;
      this.setState({
        settingsBundle: current ? setBundleField(current, field, previousValue) : current,
        status: 'Setting update failed — change reverted'
      });
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
      await this.runExactCommand('gateway-settings', () =>
        gateway.updateSettings({ blockOnNoScale: enabled })
      );
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

  private beginSettingsMutation(key: string): number {
    const revision = (this.settingsMutationRevisions.get(key) ?? 0) + 1;
    this.settingsMutationRevisions.set(key, revision);
    return revision;
  }

  private isCurrentSettingsMutation(key: string, revision: number): boolean {
    return this.settingsMutationRevisions.get(key) === revision;
  }

  private async resetMachineSettings(): Promise<void> {
    const bundle = this.state.settingsBundle;
    if (!bundle) return;
    if (!(['de1', 'advanced', 'calibration'] as const).every((key) => this.settingsResourceWritable(key))) {
      this.setState({ status: 'Machine settings are unavailable — reset was not sent' });
      return;
    }
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
    const changesSyncedPreference = Object.keys(next).some((key) => key !== 'theme');
    if (changesSyncedPreference && !this.state.demo && !this.state.settingsStoreAvailable) {
      this.setState({ status: 'Synced preferences are unavailable — no change was saved' });
      return;
    }
    const themeChanged = next.theme != null && next.theme !== this.state.settingsPreferences.theme;
    const scaleChanged = next.uiScale != null && next.uiScale !== this.state.settingsPreferences.uiScale;
    const settingsPreferences = { ...this.state.settingsPreferences, ...next };
    writeSettingsPreferencePatch(next);
    applySettingsPreferences(settingsPreferences);
    this.setState({
      settingsPreferences,
      status: 'Settings changed'
    });
    const charts = [
      this.liveChart,
      this.detailChart,
      this.shotStagesChart,
      this.calibratorChart
    ];
    if (themeChanged) charts.forEach((chart) => chart?.invalidate('theme'));
    if (scaleChanged) charts.forEach((chart) => chart?.invalidate('layout'));
  }

  private async resetLocalCache(): Promise<void> {
    await beanieCache.clear();
    // Device cache cleanup must never mutate gateway-backed preferences or
    // credentials. The user's screensaver photos are device content too, so
    // restore them after clearing downloaded offline snapshots.
    if (this.state.screensaverPhotos.length > 0) {
      await beanieCache.putObject(SCREENSAVER_PHOTOS_CACHE_KEY, this.state.screensaverPhotos);
    }
    this.setState({ status: 'Device cache cleared — synced settings were kept' });
  }

  private setState(next: Partial<AppState>): void {
    if (this.disposed) return;
    if (typeof next.status === 'string' && next.status !== this.state.status) {
      const status = next.status.trim();
      const structural = /^(Starting|Loading|Connected|Offline|DEMO)/.test(status);
      if (!structural) {
        this.statusFeedbackUntilMs = Date.now() + 4_000;
        if (this.statusFeedbackTimer != null) window.clearTimeout(this.statusFeedbackTimer);
        this.statusFeedbackTimer = window.setTimeout(() => {
          this.statusFeedbackTimer = null;
          if (!this.disposed) this.render();
        }, 4_050);
      }
    }
    this.state = { ...this.state, ...next };
    this.render();
  }

}

function promoteBean(beans: Bean[], beanId: string): Bean[] {
  const bean = beans.find((item) => item.id === beanId);
  if (!bean) return beans;
  return [bean, ...beans.filter((item) => item.id !== beanId)];
}

function calibrationBundle(bundle: SettingsBundle, flowMultiplier: number): SettingsBundle {
  return {
    ...bundle,
    calibration: { ...bundle.calibration, flowMultiplier }
  };
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



function decimalPlaces(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const [, fraction = ''] = value.toString().split('.');
  return fraction.length;
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
