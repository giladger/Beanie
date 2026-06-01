export type MachineState =
  | 'booting'
  | 'busy'
  | 'idle'
  | 'schedIdle'
  | 'sleeping'
  | 'heating'
  | 'preheating'
  | 'espresso'
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
  frozen?: boolean;
  archived?: boolean;
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
  target_weight?: number;
  target_volume?: number;
  tank_temperature?: number;
  steps?: unknown[];
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
  beanBatchId?: string | null;
  coffeeName?: string | null;
  coffeeRoaster?: string | null;
  finalBeverageType?: string | null;
}

export interface Workflow {
  id?: string;
  name?: string;
  description?: string;
  profile?: Profile | null;
  context?: WorkflowContext | null;
  steamSettings?: Record<string, unknown>;
  hotWaterData?: Record<string, unknown>;
  rinseData?: Record<string, unknown>;
}

export interface WorkflowUpdate {
  name?: string;
  profile?: Profile | null;
  context?: WorkflowContext;
}

export interface ShotSummary {
  id: string;
  timestamp: string;
  workflow?: Workflow | null;
  annotations?: {
    actualDoseWeight?: number | null;
    actualYield?: number | null;
    enjoyment?: number | null;
    espressoNotes?: string | null;
  } | null;
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
  sourceShotId?: string | null;
  sourceLabel?: string | null;
}

export interface BeanPreset {
  id: string;
  name: string;
  createdAt: string;
  recipe: RecipeDraft;
}

export type ApiRuntimeMode = 'real' | 'demo';

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
  | 'scale';

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

export type ApiStartupSnapshot = GatewayStartupSnapshot | DemoStartupSnapshot;
