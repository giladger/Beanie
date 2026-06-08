export type MachineState =
  | 'booting'
  | 'busy'
  | 'idle'
  | 'schedIdle'
  | 'sleeping'
  | 'heating'
  | 'preheating'
  | 'espresso'
  | 'brewing'
  | 'hotWater'
  | 'flush'
  | 'steam'
  | 'steamRinse'
  | 'skipStep'
  | 'cleaning'
  | 'descaling'
  | 'calibration'
  | 'selfTest'
  | 'airPurge'
  | 'needsWater'
  | 'error'
  | 'fwUpgrade';

export interface MachineSnapshot {
  timestamp: string;
  state: { state: MachineState; substate?: string };
  flow: number;
  pressure: number;
  targetFlow: number;
  targetPressure: number;
  mixTemperature: number;
  groupTemperature: number;
  targetMixTemperature: number;
  targetGroupTemperature: number;
  profileFrame: number;
  steamTemperature: number;
}

export interface MachineCapabilities {
  capabilities: string[];
}

export interface De1MachineSettings {
  usb?: boolean | null;
  fan?: number | null;
  flushTemp?: number | null;
  flushFlow?: number | null;
  flushTimeout?: number | null;
  hotWaterFlow?: number | null;
  steamFlow?: number | null;
  tankTemp?: number | null;
  steamPurgeMode?: number | null;
}

export interface MachineInfo {
  version?: string;
  model?: string;
  serialNumber?: string;
  GHC?: boolean;
  groupHeadControllerPresent?: boolean;
  extra?: Record<string, unknown>;
}

export interface ScaleSnapshot {
  timestamp: string;
  weight: number;
  weightFlow: number;
  batteryLevel?: number;
  status?: 'connected' | 'disconnected';
}

export interface Bean {
  id: string;
  roaster: string;
  name: string;
  species?: string | null;
  decaf?: boolean;
  country?: string | null;
  region?: string | null;
  producer?: string | null;
  processing?: string | null;
  variety?: string[] | null;
  altitude?: number[] | null;
  notes?: string | null;
  archived?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface BeanBatch {
  id: string;
  beanId: string;
  roastDate?: string | null;
  roastLevel?: string | null;
  weight?: number | null;
  weightRemaining?: number | null;
  storageEvents?: BeanBatchStorageEvent[] | null;
  frozen?: boolean;
  archived?: boolean;
}

export type BeanBatchStorageEventType = 'frozen' | 'thawed';

export interface BeanBatchStorageEvent {
  type: BeanBatchStorageEventType;
  at: string;
}

export type BeanBatchStorageState = 'ambient' | 'frozen' | 'thawed';

export interface BeanFreshnessSnapshot {
  roastDate: string;
  roastAgeDays: number;
  activeAgeDays: number;
  storageState: BeanBatchStorageState;
  frozenIntervals: Array<{ frozenAt: string; thawedAt?: string | null }>;
  thawedAt?: string | null;
}

export interface Grinder {
  id: string;
  model: string;
  burrs?: string | null;
  burrSize?: number | null;
  burrType?: string | null;
  settingType?: 'numeric' | 'preset' | string;
  settingSmallStep?: number | null;
  settingBigStep?: number | null;
  archived?: boolean;
}

export interface Profile {
  title?: string;
  author?: string;
  notes?: string;
  beverage_type?: string;
  type?: string;
  legacy_profile_type?: string;
  target_weight?: number;
  target_volume?: number;
  target_volume_count_start?: number;
  tank_temperature?: number;
  steps?: unknown[];
  lang?: string;
  hidden?: boolean | number;
  reference_file?: string;
  version?: string;
}

export interface ProfileRecord {
  id: string;
  profile: Profile;
  visibility?: 'visible' | 'hidden' | 'deleted';
  isDefault?: boolean;
}

export interface WorkflowContext {
  targetDoseWeight?: number | null;
  targetYield?: number | null;
  grinderId?: string | null;
  grinderModel?: string | null;
  grinderSetting?: string | number | null;
  beanId?: string | null;
  beanBatchId?: string | null;
  coffeeName?: string | null;
  coffeeRoaster?: string | null;
  finalBeverageType?: string | null;
  baristaName?: string | null;
  drinkerName?: string | null;
  extras?: Record<string, unknown> | null;
}

export interface SteamSettings {
  targetTemperature?: number;
  duration?: number;
  flow?: number;
  stopAtTemperature?: number;
}

export interface HotWaterData {
  targetTemperature?: number;
  duration?: number;
  volume?: number;
  flow?: number;
}

export interface RinseData {
  targetTemperature?: number;
  duration?: number;
  flow?: number;
}

export interface Workflow {
  id?: string;
  name?: string;
  description?: string;
  profile?: Profile | null;
  context?: WorkflowContext | null;
  steamSettings?: SteamSettings;
  hotWaterData?: HotWaterData;
  rinseData?: RinseData;
  /** Snapshot of machine settings active when the shot was pulled. */
  machine?: WorkflowMachine | null;
}

export interface WorkflowMachine {
  /** The DE1's flow-estimation calibration (calibration_flow_multiplier) at shot time. */
  flowCalibration?: number | null;
}

export interface ShotAnnotations {
  actualDoseWeight?: number | null;
  actualYield?: number | null;
  drinkTds?: number | null;
  drinkEy?: number | null;
  enjoyment?: number | null;
  espressoNotes?: string | null;
  extras?: Record<string, unknown> | null;
}

export interface ShotSummary {
  id: string;
  timestamp: string;
  workflow?: Workflow | null;
  annotations?: ShotAnnotations | null;
  shotNotes?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface ShotMeasurement {
  machine: {
    timestamp: string;
    pressure?: number | null;
    flow?: number | null;
    mixTemperature?: number | null;
    groupTemperature?: number | null;
  };
  scale?: {
    timestamp?: string;
    weight?: number | null;
    weightFlow?: number | null;
    batteryLevel?: number | null;
  } | null;
  volume?: number | null;
}

export interface ShotRecord extends ShotSummary {
  measurements: ShotMeasurement[];
}

export interface ShotUpdate {
  workflow?: Partial<Workflow> & { context?: WorkflowContext | null };
  annotations?: ShotAnnotations | null;
  shotNotes?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface PaginatedShots {
  items: ShotSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface RecipeDraft {
  profileId?: string | null;
  profileTitle?: string | null;
  profile?: Profile | null;
  dose?: number | null;
  yield?: number | null;
  grinderId?: string | null;
  grinderModel?: string | null;
  grinderSetting?: string | null;
  brewTemp?: number | null;
  sourceShotId?: string | null;
  sourceLabel?: string | null;
}

export type ApiRuntimeStatus =
  | 'connected'
  | 'demo'
  | 'gateway-unavailable'
  | 'partial-failure';

export type ApiDataSource = 'gateway' | 'demo';

export type ApiResourceName =
  | 'workflow'
  | 'beans'
  | 'batches'
  | 'grinders'
  | 'profiles'
  | 'shots'
  | 'shot'
  | 'machine'
  | 'scale'
  | 'settings';

export type ApiIssueKind = 'network' | 'http' | 'malformed' | 'unknown';

export interface ApiIssue {
  kind: ApiIssueKind;
  message: string;
  resource?: ApiResourceName;
  method?: string;
  path?: string;
  statusCode?: number;
  details?: string[];
}

export interface ApiResourceSuccess<T> {
  resource: ApiResourceName;
  status: 'loaded';
  source: ApiDataSource;
  data: T;
  receivedAt: string;
}

export interface ApiResourceFailure {
  resource: ApiResourceName;
  status: 'failed';
  source: 'gateway';
  issue: ApiIssue;
  receivedAt: string;
}

export type ApiResource<T> = ApiResourceSuccess<T> | ApiResourceFailure;

export interface ApiDemoFallback {
  fromStatus: Exclude<ApiRuntimeStatus, 'connected' | 'demo'>;
  reason: string;
  issues: ApiIssue[];
}

export interface GatewayStartupResources {
  workflow: ApiResource<Workflow>;
  beans: ApiResource<Bean[]>;
  grinders: ApiResource<Grinder[]>;
  profiles: ApiResource<ProfileRecord[]>;
  shots: ApiResource<PaginatedShots>;
}

export interface GatewayStartupSnapshot {
  mode: 'real';
  status: Exclude<ApiRuntimeStatus, 'demo'>;
  source: 'gateway';
  origin: string;
  fallbackToDemo: null;
  resources: GatewayStartupResources;
  issues: ApiIssue[];
  data: {
    workflow?: Workflow;
    beans?: Bean[];
    grinders?: Grinder[];
    profiles?: ProfileRecord[];
    latestShots?: PaginatedShots;
  };
}

export interface DemoStartupSnapshot {
  mode: 'demo';
  status: 'demo';
  source: 'demo';
  origin: null;
  fallbackToDemo: ApiDemoFallback | null;
  resources: Partial<GatewayStartupResources>;
  issues: ApiIssue[];
  data: {
    workflow: Workflow;
    beans: Bean[];
    batchesByBean?: Record<string, BeanBatch[]>;
    grinders: Grinder[];
    profiles: ProfileRecord[];
    latestShots?: PaginatedShots;
    shots?: ShotRecord[];
  };
}
