import type { MachineState } from '../api/types';
import type { SettingsBundle } from '../domain/settingsModel';
import {
  SETTINGS_SPEC,
  coerceFieldValue,
  demoSettingsBundle
} from '../domain/settingsModel';
import { applySettingsBundleMutation } from '../domain/settingsBundleMutation';
import {
  settingsResourceStates,
  settingsResourceWritable,
  type SettingsResourceKey,
  type SettingsResourceStates
} from '../domain/resourceState';
import {
  writeSettingsPreferencePatch,
  type SettingsPreferences
} from '../domain/settings';
import { parseNumberInput } from '../domain/beanWorkflow';
import type { FirmwareUpload, MachineSettingsChange } from '../domain/machineSettings';
import type { SettingsController } from './settingsController';
import {
  applySettingsMutationOutcome,
  type SettingsMutationFlow,
  type SettingsMutationOutcome,
  type SettingsMutationStart
} from './settingsMutationFlow';

export type MachineSettingsSource = 'gateway' | 'degraded' | 'demo' | 'loading' | null;

export interface MachineSettingsFlowSnapshot {
  readonly demo: boolean;
  readonly bundle: SettingsBundle | null;
  readonly source: MachineSettingsSource;
  readonly resources: SettingsResourceStates | null;
  readonly settingsStoreAvailable: boolean;
  readonly preferences: SettingsPreferences;
  readonly scaleConnected: boolean;
  readonly machineRefillLevel: number | null;
}

export interface MachineSettingsFlowPatch {
  readonly bundle?: SettingsBundle | null;
  readonly source?: MachineSettingsSource;
  readonly resources?: SettingsResourceStates | null;
  readonly preferences?: SettingsPreferences;
  readonly machineRefillLevel?: number | null;
  readonly status?: string;
  readonly busy?: boolean;
}

export type SettingsPresentationInvalidation = 'none' | 'theme' | 'layout';

export interface MachineSettingsFlowHost {
  snapshot(): MachineSettingsFlowSnapshot;
  commit(patch: MachineSettingsFlowPatch): void;
  authorityRevision(): number;
  hasConnectedGatewayAuthority(): boolean;
  hasLiveMachineAuthority(): boolean;
  reloadSyncedSettings(): Promise<void>;
  groundGlobalFlowCalibration(value: number): void;
  noteUserBrightness(brightness: number): void;
  refreshDisplayState(): Promise<void>;
  clearNoScaleBlockWarning(): void;
  machineSleepRequested(): void;
  machineWakeRequested(): void;
  applyPreferencePresentation(
    preferences: SettingsPreferences,
    invalidation: SettingsPresentationInvalidation
  ): void;
  isPhoneLayout(): boolean;
  openSettingsSurface(phone: boolean, section?: string): void;
  loadAccount(): void;
}

export interface MachineSettingsFlowCommands {
  tareScale(): Promise<void>;
  uploadFirmware(bytes: ArrayBuffer): Promise<void>;
  setRefillLevel(mm: number): Promise<void>;
}

/**
 * Owns the Reaprime machine-settings session above the endpoint and mutation
 * primitives: provenance-aware loading, typed UI intents, device/schedule
 * actions, preference persistence policy, and optimistic refill settlement.
 *
 * Gateway scheduling and physical authority remain in the injected ports. The
 * host exposes only this feature's projection, never AppState or a generic
 * state setter.
 */
export class MachineSettingsFlow {
  private bundleLoad: Promise<void> | null = null;
  private bundleGeneration = 0;
  private refillGeneration = 0;
  private refillRevision = 0;
  private readonly pendingRefills = new Set<number>();
  private confirmedRefillLevel: number | null = null;
  private confirmedRefillKnown = false;
  private confirmedRefillRevision = 0;
  private disposed = false;

  constructor(
    private readonly controller: SettingsController,
    private readonly mutations: SettingsMutationFlow,
    private readonly host: MachineSettingsFlowHost,
    private readonly commands: MachineSettingsFlowCommands
  ) {}

  get local(): boolean {
    const state = this.host.snapshot();
    return state.demo || state.source === 'demo';
  }

  loadBundle(): Promise<void> {
    const state = this.host.snapshot();
    if (state.bundle && (state.source === 'gateway' || state.source === 'demo')) {
      return Promise.resolve();
    }
    if (this.bundleLoad) return this.bundleLoad;
    const generation = this.bundleGeneration;
    const demo = state.demo;
    const load = this.runLoadBundle(generation, demo);
    this.bundleLoad = load;
    const clear = () => {
      if (this.bundleLoad === load) this.bundleLoad = null;
    };
    void load.then(clear, clear);
    return load;
  }

  invalidateSession(): void {
    this.bundleGeneration += 1;
    this.bundleLoad = null;
    this.refillGeneration += 1;
    this.refillRevision += 1;
    this.pendingRefills.clear();
    this.confirmedRefillLevel = null;
    this.confirmedRefillKnown = false;
    this.confirmedRefillRevision = 0;
  }

  open(section?: string): void {
    const phone = this.host.isPhoneLayout();
    this.host.openSettingsSurface(phone, section);
    const state = this.host.snapshot();
    this.host.commit({
      bundle: state.bundle ?? demoSettingsBundle(),
      source: state.bundle ? state.source : state.demo ? 'demo' : 'loading',
      resources: state.resources ?? (state.demo ? settingsResourceStates('demo') : null)
    });
    void this.loadBundle();
    this.host.loadAccount();
  }

  async reloadResources(): Promise<void> {
    this.host.commit({ source: 'loading', status: 'Reloading settings…' });
    this.bundleGeneration += 1;
    this.bundleLoad = null;
    await this.host.reloadSyncedSettings();
    await this.loadBundle();
  }

  patchBundle(patch: Partial<SettingsBundle>): void {
    const bundle = this.host.snapshot().bundle;
    if (!bundle) return;
    this.host.commit({ bundle: { ...bundle, ...patch } });
  }

  resourceWritable(resource: SettingsResourceKey): boolean {
    const state = this.host.snapshot();
    return this.local || (
      this.host.hasConnectedGatewayAuthority() &&
      settingsResourceWritable(state.resources, resource)
    );
  }

  effectiveResourceStates(): SettingsResourceStates | null {
    const resources = this.host.snapshot().resources;
    if (!resources || this.local || this.host.hasConnectedGatewayAuthority()) return resources;
    return Object.fromEntries(
      Object.entries(resources).map(([key, state]) => [
        key,
        {
          ...state,
          writable: false,
          message: state.message ?? 'Live gateway authority is unavailable'
        }
      ])
    ) as SettingsResourceStates;
  }

  async applyMutation(start: SettingsMutationStart): Promise<SettingsMutationOutcome | null> {
    if (start.type === 'rejected') {
      this.host.commit({ status: start.status });
      return null;
    }
    if (start.type !== 'started') return null;

    const bundle = this.host.snapshot().bundle;
    if (bundle || start.optimisticStatus) {
      this.host.commit({
        ...(bundle ? { bundle: applySettingsBundleMutation(bundle, start.optimistic) } : {}),
        ...(start.optimisticStatus ? { status: start.optimisticStatus } : {})
      });
    }
    const outcome = await start.completion;
    if (outcome.type === 'discarded' || this.disposed) return outcome;

    const current = this.host.snapshot().bundle;
    const patch: MachineSettingsFlowPatch = {
      ...(current ? { bundle: applySettingsMutationOutcome(current, outcome) } : {}),
      ...(outcome.status ? { status: outcome.status } : {})
    };
    if (outcome.type === 'failed') {
      console.error(`[Beanie] ${outcome.key} mutation failed`, outcome.error);
    }
    if (outcome.type === 'saved' && outcome.effect?.noScaleBlock === 'disabled') {
      this.host.clearNoScaleBlockWarning();
    }
    if (Object.keys(patch).length > 0) this.host.commit(patch);
    return outcome;
  }

  async scanDevices(): Promise<void> {
    if (!this.resourceWritable('devices')) {
      this.host.commit({ status: 'Device list is unavailable — reconnect and reload Settings' });
      return;
    }
    this.host.commit({ status: 'Scanning for devices…' });
    const result = await this.controller.scanDevices(this.local);
    if (result.devices) this.patchBundle({ devices: result.devices });
    this.host.commit({ status: result.status });
  }

  async connectPreferredDevices(): Promise<void> {
    const initial = this.host.snapshot();
    if (!this.local && initial.resources == null) {
      this.host.commit({ status: 'Loading device settings…' });
      await this.loadBundle();
    }
    if (!this.resourceWritable('devices') || !this.resourceWritable('rea')) {
      this.host.commit({ status: 'Preferred devices are unavailable — reconnect and reload Settings' });
      return;
    }
    this.host.commit({ status: 'Searching for preferred devices…' });
    const result = await this.controller.connectPreferredDevices({
      local: this.local,
      preferredScaleId: this.host.snapshot().bundle?.rea.preferredScaleId ?? null
    });
    if (result.devices) this.patchBundle({ devices: result.devices });
    this.host.commit({ status: result.status });
  }

  async handleScaleStatTap(): Promise<void> {
    if (this.host.snapshot().scaleConnected) {
      await this.tareScale();
      return;
    }
    await this.connectPreferredDevices();
  }

  async connectDevice(id: string, connect: boolean): Promise<void> {
    if (!id) return;
    if (!this.resourceWritable('devices')) {
      this.host.commit({ status: 'Device list is unavailable — no change was sent' });
      return;
    }
    this.host.commit({ status: connect ? 'Connecting…' : 'Disconnecting…' });
    const result = await this.controller.connectDevice({
      id,
      connect,
      local: this.local,
      fallbackDevices: this.host.snapshot().bundle?.devices ?? []
    });
    if (result.devices) this.patchBundle({ devices: result.devices });
    if (result.status) this.host.commit({ status: result.status });
  }

  async setDisplayBrightness(raw: string): Promise<void> {
    const parsed = parseNumberInput(raw);
    if (parsed == null) return;
    const bundle = this.host.snapshot().bundle;
    if (!bundle) return;
    if (!this.resourceWritable('display')) {
      this.host.commit({ status: 'Display settings are unavailable — no change was sent' });
      return;
    }
    const brightness = Math.max(0, Math.min(100, Math.round(parsed)));
    const start = this.mutations.setDisplayBrightness({
      bundle,
      brightness,
      local: this.local,
      writable: true
    });
    if (start.type === 'started') this.host.noteUserBrightness(brightness);
    const outcome = await this.applyMutation(start);
    if (outcome?.type === 'failed') await this.host.refreshDisplayState();
  }

  async requestMachineState(state: MachineState): Promise<void> {
    if (!this.host.hasLiveMachineAuthority()) {
      this.host.commit({ status: 'Machine controls are read-only until live data reconnects' });
      return;
    }
    const result = await this.controller.requestMachineState({ state, local: this.local });
    if (this.disposed) return;
    this.host.commit({ status: result.status });
    if (result.sleepRequested) this.host.machineSleepRequested();
    else if (result.status !== 'Machine command failed') this.host.machineWakeRequested();
  }

  async uploadFirmware(file: FirmwareUpload): Promise<void> {
    if (this.local || !this.host.hasConnectedGatewayAuthority()) {
      this.host.commit({ status: 'Firmware upload needs a connected gateway' });
      return;
    }
    const authorityRevision = this.host.authorityRevision();
    const authorityCurrent = () =>
      !this.disposed &&
      authorityRevision === this.host.authorityRevision() &&
      this.host.hasConnectedGatewayAuthority();
    this.host.commit({ status: `Uploading ${file.name}…`, busy: true });
    try {
      const body = await file.arrayBuffer();
      if (!authorityCurrent()) {
        if (!this.disposed) this.host.commit({ busy: false });
        return;
      }
      await this.commands.uploadFirmware(body);
      if (authorityCurrent()) {
        this.host.commit({ status: 'Firmware uploaded — restart the machine', busy: false });
      } else if (!this.disposed) {
        this.host.commit({ busy: false });
      }
    } catch (error) {
      console.error('[Beanie] Firmware upload failed', error);
      if (authorityCurrent()) {
        this.host.commit({ status: 'Firmware upload failed', busy: false });
      } else if (!this.disposed) {
        this.host.commit({ busy: false });
      }
    }
  }

  async addWakeSchedule(time: string): Promise<void> {
    if (!this.resourceWritable('schedules')) {
      this.host.commit({ status: 'Wake schedules are unavailable — reconnect and reload Settings' });
      return;
    }
    const result = await this.controller.addWakeSchedule({
      time,
      local: this.local,
      current: this.host.snapshot().bundle?.schedules ?? []
    });
    if (result.schedules) this.patchBundle({ schedules: result.schedules });
    if (result.status) this.host.commit({ status: result.status });
  }

  async deleteWakeSchedule(id: string): Promise<void> {
    const bundle = this.host.snapshot().bundle;
    if (!bundle) return;
    if (!this.resourceWritable('schedules')) {
      this.host.commit({ status: 'Wake schedules are unavailable — no change was sent' });
      return;
    }
    await this.applyMutation(this.mutations.deleteSchedule({
      bundle,
      id,
      local: this.local,
      writable: true
    }));
  }

  async toggleWakeSchedule(id: string, enabled: boolean): Promise<void> {
    const bundle = this.host.snapshot().bundle;
    if (!bundle) return;
    if (!this.resourceWritable('schedules')) {
      this.host.commit({ status: 'Wake schedules are unavailable — no change was sent' });
      return;
    }
    await this.applyMutation(this.mutations.toggleSchedule({
      bundle,
      id,
      enabled,
      local: this.local,
      writable: true
    }));
  }

  async setField(group: string, key: string, raw: string | boolean): Promise<void> {
    const bundle = this.host.snapshot().bundle;
    if (!bundle) return;
    const field = SETTINGS_SPEC.flatMap((section) => section.fields).find(
      (candidate) => candidate.group === group && candidate.key === key
    );
    if (!field) return;
    if (!this.resourceWritable(field.group)) {
      this.host.commit({ status: `${field.label} is unavailable — reconnect and reload Settings` });
      return;
    }
    await this.applyMutation(this.mutations.setField({
      bundle,
      field,
      value: coerceFieldValue(field, raw),
      local: this.local,
      writable: true
    }));
  }

  async setNoScaleBlock(enabled: boolean): Promise<void> {
    const observedBundle = this.host.snapshot().bundle;
    await this.applyMutation(this.mutations.setNoScaleBlock({
      bundle: observedBundle ?? demoSettingsBundle(),
      enabled,
      previousKnown: observedBundle != null,
      local: this.local,
      // This is the blocking alert's escape hatch and intentionally remains an
      // explicit live attempt even before the Settings session has loaded.
      writable: true
    }));
  }

  async resetMachineSettings(): Promise<void> {
    const bundle = this.host.snapshot().bundle;
    if (!bundle) return;
    if (!(['de1', 'advanced', 'calibration'] as const).every((key) => this.resourceWritable(key))) {
      this.host.commit({ status: 'Machine settings are unavailable — reset was not sent' });
      return;
    }
    try {
      const result = await this.controller.resetMachineSettings({ local: this.local, bundle });
      this.host.commit({ bundle: { ...bundle, ...result.bundlePatch }, status: result.status });
    } catch {
      this.host.commit({ status: 'Reset failed' });
    }
  }

  updatePreferences(next: Partial<SettingsPreferences>): void {
    const state = this.host.snapshot();
    const changesSyncedPreference = Object.keys(next).some((key) => key !== 'theme');
    if (changesSyncedPreference && !state.demo && !state.settingsStoreAvailable) {
      this.host.commit({ status: 'Synced preferences are unavailable — no change was saved' });
      return;
    }
    const themeChanged = next.theme != null && next.theme !== state.preferences.theme;
    const scaleChanged = next.uiScale != null && next.uiScale !== state.preferences.uiScale;
    const preferences = { ...state.preferences, ...next };
    writeSettingsPreferencePatch(next);
    this.host.applyPreferencePresentation(
      preferences,
      themeChanged ? 'theme' : scaleChanged ? 'layout' : 'none'
    );
    this.host.commit({ preferences, status: 'Settings changed' });
  }

  async handleChange(change: MachineSettingsChange): Promise<void> {
    switch (change.type) {
      case 'field':
        await this.setField(change.group, change.key, change.raw);
        return;
      case 'display-brightness':
        await this.setDisplayBrightness(change.raw);
        return;
      case 'water-soft-limit': {
        const ml = Number(change.raw);
        if (Number.isFinite(ml)) this.updatePreferences({ waterSoftLimitMl: Math.max(0, ml) });
        return;
      }
      case 'topbar-clock':
        this.updatePreferences({ topbarClock: change.enabled });
        return;
      case 'machine-refill': {
        const mm = Number(change.raw);
        if (Number.isFinite(mm)) await this.setMachineRefillLevel(Math.max(0, mm));
        return;
      }
      case 'no-scale-block':
        await this.setNoScaleBlock(change.enabled);
        return;
      case 'schedule-toggle':
        await this.toggleWakeSchedule(change.id, change.enabled);
        return;
      case 'firmware':
        await this.uploadFirmware(change.file);
    }
  }

  /**
   * Accept authoritative water telemetry without letting an old frame erase a
   * newer optimistic refill intent. The latest observed value becomes the
   * rollback baseline and is projected once no mutation is pending.
   */
  observeRefillLevel(mm: number | null): void {
    this.confirmedRefillLevel = mm;
    this.confirmedRefillKnown = true;
    this.confirmedRefillRevision = this.refillRevision;
    if (this.pendingRefills.size > 0) return;
    if (this.host.snapshot().machineRefillLevel !== mm) {
      this.host.commit({ machineRefillLevel: mm });
    }
  }

  /**
   * Revisioned optimistic refill write. Older failures cannot roll back newer
   * intent; older successes still advance the confirmed baseline so a later
   * failure rolls back to the last physical value that actually landed.
   */
  async setMachineRefillLevel(mm: number): Promise<void> {
    const state = this.host.snapshot();
    const generation = this.refillGeneration;
    const revision = ++this.refillRevision;
    if (!this.confirmedRefillKnown) {
      this.confirmedRefillLevel = state.machineRefillLevel;
      this.confirmedRefillKnown = true;
      this.confirmedRefillRevision = revision - 1;
    }
    this.pendingRefills.add(revision);
    this.host.commit({ machineRefillLevel: mm, status: 'Updating machine refill level…' });

    if (state.demo) {
      this.pendingRefills.delete(revision);
      if (generation !== this.refillGeneration || this.disposed) return;
      if (revision >= this.confirmedRefillRevision) {
        this.confirmedRefillLevel = mm;
        this.confirmedRefillKnown = true;
        this.confirmedRefillRevision = revision;
      }
      if (revision === this.refillRevision) {
        this.host.commit({ status: 'Machine refill level set (demo)' });
      }
      return;
    }

    try {
      await this.commands.setRefillLevel(mm);
      this.pendingRefills.delete(revision);
      if (generation !== this.refillGeneration || this.disposed) return;
      if (revision >= this.confirmedRefillRevision) {
        this.confirmedRefillLevel = mm;
        this.confirmedRefillKnown = true;
        this.confirmedRefillRevision = revision;
      }
      if (revision === this.refillRevision) {
        this.host.commit({ status: 'Machine refill level set' });
      }
    } catch (error) {
      this.pendingRefills.delete(revision);
      console.error('[Beanie] Set refill level failed', error);
      if (
        generation !== this.refillGeneration ||
        this.disposed ||
        revision !== this.refillRevision
      ) return;
      this.host.commit({
        machineRefillLevel: this.confirmedRefillKnown ? this.confirmedRefillLevel : null,
        status: 'Set refill level failed'
      });
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.invalidateSession();
  }

  private async runLoadBundle(generation: number, demo: boolean): Promise<void> {
    const authorityRevision = this.host.authorityRevision();
    if (!demo && !this.host.hasConnectedGatewayAuthority()) return;
    const result = await this.controller.loadSettingsBundle(demo);
    const state = this.host.snapshot();
    if (
      this.disposed ||
      generation !== this.bundleGeneration ||
      state.demo !== demo ||
      (!demo && (
        authorityRevision !== this.host.authorityRevision() ||
        !this.host.hasConnectedGatewayAuthority()
      ))
    ) return;
    this.host.commit({
      bundle: result.bundle,
      source: result.source,
      resources: result.resources,
      ...(result.status ? { status: result.status } : {})
    });
    if (result.source === 'gateway' && this.host.snapshot().settingsStoreAvailable) {
      this.host.groundGlobalFlowCalibration(result.bundle.calibration.flowMultiplier);
    }
  }

  private async tareScale(): Promise<void> {
    const state = this.host.snapshot();
    if (state.demo) {
      this.host.commit({ status: 'Tare unavailable in demo mode' });
      return;
    }
    if (!state.scaleConnected) {
      this.host.commit({ status: 'Scale disconnected' });
      return;
    }
    if (!this.host.hasConnectedGatewayAuthority()) {
      this.host.commit({ status: 'Scale controls are read-only until live data reconnects' });
      return;
    }
    const authorityRevision = this.host.authorityRevision();
    const authorityCurrent = () =>
      !this.disposed &&
      authorityRevision === this.host.authorityRevision() &&
      this.host.hasConnectedGatewayAuthority();
    this.host.commit({ status: 'Taring scale…' });
    try {
      await this.commands.tareScale();
      if (authorityCurrent()) this.host.commit({ status: 'Scale tared' });
    } catch (error) {
      console.error('[Beanie] Scale tare failed', error);
      if (authorityCurrent()) this.host.commit({ status: 'Tare failed' });
    }
  }
}
