import type { RecipeDraft, ShotRecord } from '../api/types';
import {
  clampCalibration,
  readFlowCalibrationGlobal,
  readFlowCalibrationOverrides,
  resolveFlowCalibration,
  roundCalibration,
  setProfileOverride,
  shotProfileTitle,
  writeFlowCalibrationGlobal,
  writeFlowCalibrationOverrides
} from '../domain/flowCalibration';
import { isServiceShot } from '../domain/shotRecord';
import { demoBeans, demoShotsForBean } from '../mock/demo';
import { OperationAuthority } from '../runtime/operationAuthority';
import type { ClickActionHandler } from './actionContract';
import type { MachineWorkflowCommands } from './machineWorkflowCommands';

export interface FlowCalibratorRuntimeSnapshot {
  readonly demo: boolean;
  readonly settingsLocal: boolean;
  readonly settingsStoreAvailable: boolean;
  readonly calibrationWritable: boolean;
  readonly busy: boolean;
  readonly currentCalibration: number | null;
  readonly activeProfileTitle: string | null;
  readonly currentShots: readonly ShotRecord[];
}

export interface FlowCalibratorHost {
  runtime(): FlowCalibratorRuntimeSnapshot;
  isPageOpen(): boolean;
  showPage(): void;
  showStatus(status: string): void;
  requestRender(): void;
  projectMachineCalibration(value: number): void;
  loadSettings(): Promise<void>;
  loadLatestShots(limit: number, signal: AbortSignal): Promise<readonly ShotRecord[]>;
}

export type FlowCalibratorMachinePort = Pick<MachineWorkflowCommands, 'runExact'>;

export interface FlowCalibratorPageProjection {
  readonly shots: readonly ShotRecord[];
  readonly calibration: {
    readonly draft: number;
    readonly global: number;
    readonly active: number;
    readonly profileTitle: string | null;
    readonly profileOverride: number | null;
    readonly selectedShotId: string | null;
  };
  readonly busy: boolean;
  readonly writable: boolean;
}

export interface FlowCalibratorChartProjection {
  readonly active: boolean;
  readonly shot: ShotRecord | null;
  readonly base: number;
  readonly draft: number;
}

interface FlowCalibratorSession {
  readonly draft: number | null;
  readonly base: number | null;
  readonly selectedShotId: string | null;
  readonly shots: readonly ShotRecord[];
}

const EMPTY_SESSION: FlowCalibratorSession = Object.freeze({
  draft: null,
  base: null,
  selectedShotId: null,
  shots: []
});

/**
 * Owns the complete flow-calibrator session and its user actions. The shell
 * supplies a narrow live snapshot and explicit projections; no AppState or
 * generic state patcher crosses this boundary.
 */
export class FlowCalibratorFlow {
  private session: FlowCalibratorSession = EMPTY_SESSION;
  private readonly shotLoadAuthority = new OperationAuthority();
  private disposed = false;

  constructor(
    private readonly host: FlowCalibratorHost,
    private readonly machineCommands: FlowCalibratorMachinePort
  ) {}

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.shotLoadAuthority.dispose();
    this.session = EMPTY_SESSION;
  }

  reset(): void {
    if (this.disposed) return;
    this.shotLoadAuthority.invalidate(new Error('Flow calibrator reset'));
    this.session = EMPTY_SESSION;
  }

  clickActions(): Record<string, ClickActionHandler> {
    return {
      'open-flow-calibrator': () => {
        this.open();
      },
      'flow-cal-adjust': ({ delta }) => {
        this.adjustDraft(Number(delta ?? '0'));
      },
      'flow-cal-save-global': async ({ value }) => {
        await this.saveGlobal(Number(value));
      },
      'flow-cal-save-profile': async ({ value }) => {
        await this.saveProfile(Number(value));
      },
      'flow-cal-shot': ({ id }) => {
        if (id) this.selectShot(id);
      }
    };
  }

  open(): void {
    if (this.disposed) return;
    this.session = {
      draft: null,
      base: null,
      selectedShotId: null,
      // Seed the page immediately; the async load widens this to every bean.
      shots: [...this.host.runtime().currentShots]
    };
    this.host.showPage();
    void this.host.loadSettings();
    void this.loadAllShots();
  }

  setDraft(raw: number): void {
    if (this.disposed || !Number.isFinite(raw)) return;
    this.session = {
      ...this.session,
      base: this.session.base ?? this.currentMultiplier(),
      draft: roundCalibration(raw)
    };
    this.host.showStatus('Flow calibration preview');
  }

  adjustDraft(delta: number): void {
    if (!Number.isFinite(delta) || delta === 0) return;
    this.setDraft(this.draft() + delta);
  }

  selectShot(id: string): void {
    if (this.disposed || !this.shots().some((shot) => shot.id === id)) return;
    this.session = { ...this.session, selectedShotId: id };
    this.host.showStatus('Shot selected');
  }

  pageProjection(): FlowCalibratorPageProjection {
    const runtime = this.host.runtime();
    const shots = this.shots();
    const selected = this.selectedShot(shots);
    const profileTitle = selected ? shotProfileTitle(selected) : null;
    const overrides = readFlowCalibrationOverrides();
    const storedOverride = profileTitle == null ? null : overrides[profileTitle];
    return {
      shots,
      calibration: {
        draft: this.draft(),
        global: this.globalDefault(),
        active: this.currentMultiplier(),
        profileTitle,
        profileOverride: storedOverride == null ? null : roundCalibration(storedOverride),
        selectedShotId: selected?.id ?? null
      },
      busy: runtime.busy,
      writable: runtime.demo || (
        runtime.settingsStoreAvailable && runtime.calibrationWritable
      )
    };
  }

  chartProjection(): FlowCalibratorChartProjection {
    const shots = this.shots();
    return {
      active: this.host.isPageOpen(),
      shot: this.selectedShot(shots),
      base: this.base(),
      draft: this.draft()
    };
  }

  settingsDisplay(): {
    readonly value: number;
    readonly origin: 'default' | 'profile';
    readonly profileTitle: string | null;
  } {
    const profileTitle = this.host.runtime().activeProfileTitle;
    const { value, source } = resolveFlowCalibration({
      profileTitle,
      overrides: readFlowCalibrationOverrides(),
      globalDefault: this.globalDefault()
    });
    return {
      value: roundCalibration(value),
      origin: source === 'profile' ? 'profile' : 'default',
      profileTitle
    };
  }

  recipeCalibration(draft: Pick<RecipeDraft, 'profileTitle' | 'profile'>): {
    readonly target: number;
    readonly persistToMachine: boolean;
  } | null {
    const profileTitle = draft.profileTitle ?? draft.profile?.title ?? null;
    const resolved = this.resolvedForProfile(profileTitle);
    if (resolved == null || resolved === this.currentMultiplier()) return null;
    return { target: resolved, persistToMachine: !this.host.runtime().settingsLocal };
  }

  /** Calibration to include in a contiguous espresso-start command. */
  resolvedForProfile(profileTitle: string | null): number | null {
    const overrides = readFlowCalibrationOverrides();
    const globalDefault = readFlowCalibrationGlobal();
    if (globalDefault == null) {
      const title = profileTitle?.trim();
      const override = title ? overrides[title] : undefined;
      return override != null ? roundCalibration(override) : null;
    }
    return roundCalibration(resolveFlowCalibration({
      profileTitle,
      overrides,
      globalDefault
    }).value);
  }

  /** Seed the synced default once from an authoritative machine read. */
  groundGlobalDefault(value: number): void {
    if (
      readFlowCalibrationGlobal() == null &&
      Number.isFinite(value) &&
      value > 0
    ) {
      writeFlowCalibrationGlobal(roundCalibration(value));
    }
  }

  private async loadAllShots(): Promise<void> {
    const lease = this.shotLoadAuthority.begin('flow-calibrator-shots');
    try {
      const runtime = this.host.runtime();
      const loaded = runtime.demo
        ? demoBeans
            .flatMap((bean) => demoShotsForBean(bean))
            .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
        : await this.host.loadLatestShots(40, lease.signal);
      const result = lease.commit(() => {
        if (!this.host.isPageOpen() || (!runtime.demo && loaded.length === 0)) return false;
        this.session = { ...this.session, shots: [...loaded] };
        return true;
      });
      if (result.status === 'committed' && result.value) this.host.requestRender();
    } catch (error) {
      if (lease.isCurrent && !lease.signal.aborted) {
        console.warn('[Beanie] Could not load flow calibration shots', error);
      }
    } finally {
      lease.finish();
    }
  }

  private async saveGlobal(raw: number): Promise<void> {
    if (!Number.isFinite(raw) || !this.writable()) return;
    const value = roundCalibration(clampCalibration(raw));
    writeFlowCalibrationGlobal(value);
    await this.commitCalibration(value, 'Default flow calibration saved');
  }

  private async saveProfile(raw: number): Promise<void> {
    if (!Number.isFinite(raw) || !this.writable()) return;
    const selected = this.selectedShot(this.shots());
    const profileTitle = selected ? shotProfileTitle(selected) : null;
    if (!profileTitle) return;
    const value = roundCalibration(clampCalibration(raw));
    const overrides = setProfileOverride(
      readFlowCalibrationOverrides(),
      profileTitle,
      value,
      this.globalDefault()
    );
    writeFlowCalibrationOverrides(overrides);
    await this.commitCalibration(
      value,
      overrides[profileTitle] == null
        ? `${profileTitle} now follows the default`
        : `Flow calibration saved for ${profileTitle}`
    );
  }

  private writable(): boolean {
    const runtime = this.host.runtime();
    if (runtime.demo) return true;
    if (runtime.settingsStoreAvailable && runtime.calibrationWritable) return true;
    this.host.showStatus('Flow calibration is read-only until live settings are available');
    return false;
  }

  private async commitCalibration(savedValue: number, status: string): Promise<void> {
    this.session = {
      ...this.session,
      base: this.session.base ?? this.currentMultiplier(),
      // Preserve the value the user saved even when the active profile resolves
      // to a different override.
      draft: savedValue
    };
    this.host.requestRender();
    await this.applyActiveProfileCalibration();
    if (!this.disposed) this.host.showStatus(status);
  }

  private async applyActiveProfileCalibration(): Promise<void> {
    const runtime = this.host.runtime();
    if (!runtime.calibrationWritable) return;
    const resolved = this.resolvedForProfile(runtime.activeProfileTitle);
    if (resolved == null || resolved === this.currentMultiplier()) return;
    this.host.projectMachineCalibration(resolved);
    if (runtime.settingsLocal) return;
    const outcome = await this.machineCommands.runExact(
      (lane) => lane.updateCalibration(resolved)
    );
    if (outcome.status === 'completed') return;
    console.error(
      '[Beanie] Per-profile flow calibration apply failed',
      outcome.status === 'failed' ? outcome.error : new Error(`machine command ${outcome.status}`)
    );
  }

  private currentMultiplier(): number {
    const value = this.host.runtime().currentCalibration;
    return roundCalibration(
      typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 1
    );
  }

  private globalDefault(): number {
    return roundCalibration(readFlowCalibrationGlobal() ?? this.currentMultiplier());
  }

  private draft(): number {
    return this.session.draft ?? this.currentMultiplier();
  }

  private base(): number {
    return roundCalibration(this.session.base ?? this.currentMultiplier());
  }

  private shots(): ShotRecord[] {
    const source = this.session.shots.length > 0
      ? this.session.shots
      : this.host.runtime().currentShots;
    return source.filter((shot) => !isServiceShot(shot));
  }

  private selectedShot(shots: readonly ShotRecord[]): ShotRecord | null {
    return shots.find((shot) => shot.id === this.session.selectedShotId) ?? shots[0] ?? null;
  }
}
