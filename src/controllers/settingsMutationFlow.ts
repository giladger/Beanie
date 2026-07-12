import type { DisplayState, WakeSchedule } from '../api/settings';
import {
  applySettingsBundleMutation,
  type SettingsBundleMutation,
  type SettingsFieldValue,
  type WakeSchedulePatch
} from '../domain/settingsBundleMutation';
import type {
  SettingsBundle,
  SettingsField,
  SettingsGroup
} from '../domain/settingsModel';

export interface SettingsMutationRemotePort {
  persistField(group: SettingsGroup, key: string, value: SettingsFieldValue): Promise<void>;
  /** Null means a shared latest-wins display writer superseded this request. */
  setDisplayBrightness(brightness: number): Promise<DisplayState | null>;
  /** Mirrors SettingsController's explicit `{ ok }` delete result. */
  deleteSchedule(id: string): Promise<boolean>;
  updateSchedule(id: string, patch: WakeSchedulePatch): Promise<void>;
  setPluginLoaded(id: string, loaded: boolean): Promise<void>;
}

export interface SettingsMutationContext {
  /** Demo/local settings apply optimistically without invoking the remote port. */
  readonly local: boolean;
  /** False when the rendered value came from an unavailable/default resource. */
  readonly writable: boolean;
}

export interface SettingsMutationSnapshot {
  readonly disposed: boolean;
  readonly revisions: Readonly<Record<string, number>>;
  readonly pending: Readonly<Record<string, number>>;
}

export type SettingsMutationStart =
  | {
      type: 'started';
      key: string;
      revision: number;
      optimistic: SettingsBundleMutation;
      optimisticStatus: string | null;
      completion: Promise<SettingsMutationOutcome>;
    }
  | { type: 'unchanged' }
  | { type: 'rejected'; reason: 'read-only' | 'missing-target' | 'invalid'; status: string }
  | { type: 'disposed' };

export interface SettingsMutationEffect {
  /** Presentation adapter may clear warnings/modals after this setting lands. */
  readonly noScaleBlock?: 'enabled' | 'disabled';
}

export type SettingsMutationOutcome =
  | {
      type: 'saved';
      key: string;
      revision: number;
      source: 'local' | 'remote';
      reconcile?: SettingsBundleMutation;
      status: string | null;
      effect?: SettingsMutationEffect;
    }
  | {
      type: 'failed';
      key: string;
      revision: number;
      error: unknown;
      /** Null when the optimistic value came from a synthetic/unknown baseline. */
      rollback: SettingsBundleMutation | null;
      status: string;
    }
  | {
      type: 'discarded';
      key: string;
      revision: number;
      reason: 'stale' | 'superseded' | 'disposed';
    };

export interface SetSettingsFieldRequest extends SettingsMutationContext {
  bundle: SettingsBundle;
  field: Pick<SettingsField, 'group' | 'key' | 'label'>;
  value: SettingsFieldValue;
}

export interface SetDisplayBrightnessRequest extends SettingsMutationContext {
  bundle: SettingsBundle;
  brightness: number;
}

export interface DeleteWakeScheduleRequest extends SettingsMutationContext {
  bundle: SettingsBundle;
  id: string;
}

export interface ToggleWakeScheduleRequest extends SettingsMutationContext {
  bundle: SettingsBundle;
  id: string;
  enabled: boolean;
}

export interface TogglePluginRequest extends SettingsMutationContext {
  bundle: SettingsBundle;
  id: string;
  loaded: boolean;
}

export interface SetNoScaleBlockRequest extends SettingsMutationContext {
  bundle: SettingsBundle;
  enabled: boolean;
  /** False when `bundle` is a synthetic fallback rather than observed state. */
  previousKnown: boolean;
}

interface MutationPlan<Value> {
  key: string;
  optimistic: SettingsBundleMutation;
  rollback: SettingsBundleMutation | null;
  optimisticStatus: string | null;
  context: SettingsMutationContext;
  runRemote(): Promise<Value>;
  savedStatus(source: 'local' | 'remote'): string | null;
  failureStatus: string;
  reconcile?(
    value: Value | undefined,
    source: 'local' | 'remote'
  ): SettingsBundleMutation | undefined;
  confirmed(value: Value | undefined, source: 'local' | 'remote'): SettingsBundleMutation;
  onConfirmed?(value: Value | undefined, source: 'local' | 'remote'): void;
  failureRollback?(): SettingsBundleMutation | null;
  superseded?(value: Value): boolean;
  effect?(source: 'local' | 'remote'): SettingsMutationEffect | undefined;
}

/**
 * Owns optimistic settings mutation identity and targeted rollback policy.
 *
 * Endpoint loading/provenance stays in SettingsController; cross-device KV
 * synchronization stays in SettingsStoreSync; command serialization stays in
 * the injected remote adapter. This flow only decides which scalar/item owns a
 * revision and which reducer operation may reconcile or roll it back.
 */
export class SettingsMutationFlow {
  private readonly revisions = new Map<string, number>();
  private readonly pending = new Map<string, number>();
  /** Roll back to the latest remote-confirmed value, not merely the previous optimistic value. */
  private readonly confirmedRollback = new Map<string, SettingsBundleMutation>();
  /** A late older success must never replace the baseline established by newer intent. */
  private readonly confirmedRevision = new Map<string, number>();
  /** Shared semantic baseline for differently-shaped operations on one schedule. */
  private readonly confirmedSchedules = new Map<string, WakeSchedule | null>();
  private disposed = false;

  constructor(private readonly remote: SettingsMutationRemotePort) {}

  get snapshot(): SettingsMutationSnapshot {
    return {
      disposed: this.disposed,
      revisions: Object.freeze(Object.fromEntries(this.revisions)),
      pending: Object.freeze(Object.fromEntries(this.pending))
    };
  }

  setField(request: SetSettingsFieldRequest): SettingsMutationStart {
    const previous = rawFieldValue(request.bundle, request.field);
    if (!isSettingsFieldValue(previous)) {
      return rejected('invalid', `${request.field.label} has an unsupported value`);
    }
    if (Object.is(previous, request.value)) return { type: 'unchanged' };
    return this.start({
      key: fieldMutationKey(request.field.group, request.field.key),
      context: request,
      optimistic: { type: 'set-field', field: request.field, value: request.value },
      rollback: { type: 'set-field', field: request.field, value: previous },
      optimisticStatus: 'Setting updated',
      runRemote: () => this.remote.persistField(request.field.group, request.field.key, request.value),
      savedStatus: (source) => source === 'local' ? 'Setting updated (demo)' : 'Setting updated',
      failureStatus: 'Setting update failed — change reverted',
      confirmed: () => ({ type: 'set-field', field: request.field, value: request.value })
    });
  }

  setDisplayBrightness(request: SetDisplayBrightnessRequest): SettingsMutationStart {
    if (!Number.isFinite(request.brightness)) {
      return rejected('invalid', 'Brightness must be a finite number');
    }
    const brightness = Math.max(0, Math.min(100, Math.round(request.brightness)));
    const previous = request.bundle.display;
    if (
      previous.brightness === brightness &&
      previous.requestedBrightness === brightness &&
      previous.lowBatteryBrightnessActive === false
    ) return { type: 'unchanged' };

    return this.start({
      key: 'display:brightness',
      context: request,
      optimistic: {
        type: 'patch-display',
        patch: { brightness, requestedBrightness: brightness, lowBatteryBrightnessActive: false }
      },
      rollback: {
        type: 'patch-display',
        patch: {
          brightness: previous.brightness,
          requestedBrightness: previous.requestedBrightness,
          lowBatteryBrightnessActive: previous.lowBatteryBrightnessActive
        }
      },
      optimisticStatus: 'Saving brightness…',
      runRemote: () => this.remote.setDisplayBrightness(brightness),
      savedStatus: (source) => source === 'local' ? 'Brightness saved (demo)' : 'Brightness saved',
      failureStatus: 'Brightness save failed — change reverted',
      superseded: (display) => display == null,
      // The brightness endpoint returns a complete DisplayState, but this
      // request owns only brightness fields. Keep concurrent wake-lock/socket
      // changes by reconciling those fields rather than replacing display.
      reconcile: (display, source) =>
        source === 'remote' && display != null ? brightnessMutation(display) : undefined,
      confirmed: (display, source) =>
        source === 'remote' && display != null ? brightnessMutation(display) : {
          type: 'patch-display',
          patch: { brightness, requestedBrightness: brightness, lowBatteryBrightnessActive: false }
        }
    });
  }

  deleteSchedule(request: DeleteWakeScheduleRequest): SettingsMutationStart {
    const index = request.bundle.schedules.findIndex((schedule) => schedule.id === request.id);
    const schedule = index < 0 ? null : request.bundle.schedules[index]!;
    if (!schedule) return rejected('missing-target', 'Wake schedule no longer exists');
    return this.startSchedule(request.id, schedule, {
      key: scheduleDeleteMutationKey(request.id),
      context: request,
      optimistic: { type: 'remove-schedule', id: request.id },
      rollback: { type: 'restore-schedule', schedule, index },
      optimisticStatus: 'Deleting wake schedule…',
      runRemote: async () => {
        if (!await this.remote.deleteSchedule(request.id)) {
          throw new Error('Wake schedule delete was rejected');
        }
      },
      savedStatus: (source) => source === 'local' ? 'Wake schedule deleted (demo)' : 'Wake schedule deleted',
      failureStatus: 'Could not delete schedule — change reverted',
      confirmed: () => ({ type: 'remove-schedule', id: request.id }),
      onConfirmed: () => this.confirmedSchedules.set(request.id, null),
      failureRollback: () => this.scheduleDeleteRollback(request.id, schedule, index)
    });
  }

  toggleSchedule(request: ToggleWakeScheduleRequest): SettingsMutationStart {
    const schedule = request.bundle.schedules.find((item) => item.id === request.id) ?? null;
    if (!schedule) return rejected('missing-target', 'Wake schedule no longer exists');
    if (schedule.enabled === request.enabled) return { type: 'unchanged' };
    return this.startSchedule(request.id, schedule, {
      key: scheduleToggleMutationKey(request.id),
      context: request,
      optimistic: { type: 'set-schedule-enabled', id: request.id, enabled: request.enabled },
      rollback: { type: 'set-schedule-enabled', id: request.id, enabled: schedule.enabled },
      optimisticStatus: 'Updating wake schedule…',
      runRemote: () => this.remote.updateSchedule(request.id, { enabled: request.enabled }),
      savedStatus: (source) => source === 'local' ? 'Wake schedule updated (demo)' : 'Wake schedule updated',
      failureStatus: 'Could not update schedule — change reverted',
      confirmed: () => ({ type: 'set-schedule-enabled', id: request.id, enabled: request.enabled }),
      onConfirmed: () => this.confirmedSchedules.set(
        request.id,
        cloneSchedule({ ...schedule, enabled: request.enabled })
      ),
      failureRollback: () => this.scheduleToggleRollback(request.id, schedule)
    });
  }

  togglePlugin(request: TogglePluginRequest): SettingsMutationStart {
    const plugin = request.bundle.plugins.find((item) => item.id === request.id) ?? null;
    if (!plugin) return rejected('missing-target', 'Plugin no longer exists');
    if (plugin.loaded === request.loaded) return { type: 'unchanged' };
    return this.start({
      key: pluginMutationKey(request.id),
      context: request,
      optimistic: { type: 'set-plugin-loaded', id: request.id, loaded: request.loaded },
      rollback: { type: 'set-plugin-loaded', id: request.id, loaded: plugin.loaded },
      optimisticStatus: request.loaded ? 'Enabling plugin…' : 'Disabling plugin…',
      runRemote: () => this.remote.setPluginLoaded(request.id, request.loaded),
      savedStatus: (source) => source === 'local'
        ? request.loaded ? 'Plugin enabled (demo)' : 'Plugin disabled (demo)'
        : request.loaded ? 'Plugin enabled' : 'Plugin disabled',
      failureStatus: 'Plugin change failed — change reverted',
      confirmed: () => ({ type: 'set-plugin-loaded', id: request.id, loaded: request.loaded })
    });
  }

  setNoScaleBlock(request: SetNoScaleBlockRequest): SettingsMutationStart {
    const previous = request.bundle.rea.blockOnNoScale;
    // This is also the no-scale alert's escape hatch. The host may only have a
    // fallback bundle at that point, so an apparently unchanged value is still
    // explicit intent that must reach the gateway and publish the close effect.
    const field = { group: 'rea' as const, key: 'blockOnNoScale' };
    return this.start({
      key: fieldMutationKey(field.group, field.key),
      context: request,
      optimistic: { type: 'set-field', field, value: request.enabled },
      rollback: request.previousKnown
        ? { type: 'set-field', field, value: previous }
        : null,
      optimisticStatus: request.enabled ? 'Scale block enabled' : 'Disabling scale block…',
      runRemote: () => this.remote.persistField('rea', 'blockOnNoScale', request.enabled),
      savedStatus: (source) => source === 'local'
        ? request.enabled ? 'Scale block enabled (demo)' : 'Scale block disabled (demo)'
        : request.enabled ? 'Scale block enabled' : 'Scale block disabled',
      failureStatus: 'Setting update failed — change reverted',
      reconcile: () => ({ type: 'set-field', field, value: request.enabled }),
      confirmed: () => ({ type: 'set-field', field, value: request.enabled }),
      effect: () => ({ noScaleBlock: request.enabled ? 'enabled' : 'disabled' })
    });
  }

  /** Invalidate every pending result without canceling already-started I/O. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pending.clear();
    this.confirmedRollback.clear();
    this.confirmedRevision.clear();
    this.confirmedSchedules.clear();
  }

  private startSchedule<Value>(
    id: string,
    observed: WakeSchedule,
    plan: MutationPlan<Value>
  ): SettingsMutationStart {
    const alreadyPending = this.pending.has(scheduleDeleteMutationKey(id)) ||
      this.pending.has(scheduleToggleMutationKey(id));
    const start = this.start(plan);
    // `start()` defers I/O by a microtask, so establish the shared semantic
    // baseline synchronously before any completion can consult it. A new group
    // starts from the latest observed item; overlapping operations retain the
    // original remote-confirmed baseline until their physical outcomes advance it.
    if (start.type === 'started' && !alreadyPending) {
      this.confirmedSchedules.set(id, cloneSchedule(observed));
    }
    return start;
  }

  private scheduleDeleteRollback(
    id: string,
    fallback: WakeSchedule,
    index: number
  ): SettingsBundleMutation {
    const confirmed = this.confirmedSchedule(id, fallback);
    return confirmed == null
      ? { type: 'remove-schedule', id }
      : { type: 'restore-schedule', schedule: confirmed, index };
  }

  private scheduleToggleRollback(
    id: string,
    fallback: WakeSchedule
  ): SettingsBundleMutation {
    const confirmed = this.confirmedSchedule(id, fallback);
    return confirmed == null
      ? { type: 'remove-schedule', id }
      : { type: 'set-schedule-enabled', id, enabled: confirmed.enabled };
  }

  private confirmedSchedule(id: string, fallback: WakeSchedule): WakeSchedule | null {
    if (!this.confirmedSchedules.has(id)) return cloneSchedule(fallback);
    const confirmed = this.confirmedSchedules.get(id);
    return confirmed == null ? null : cloneSchedule(confirmed);
  }

  private start<Value>(plan: MutationPlan<Value>): SettingsMutationStart {
    if (this.disposed) return { type: 'disposed' };
    if (!plan.context.local && !plan.context.writable) {
      return rejected('read-only', 'Setting is unavailable — reconnect and reload Settings');
    }
    const revision = (this.revisions.get(plan.key) ?? 0) + 1;
    if (!this.pending.has(plan.key)) {
      if (plan.rollback == null) this.confirmedRollback.delete(plan.key);
      else this.confirmedRollback.set(plan.key, plan.rollback);
      this.confirmedRevision.set(plan.key, revision - 1);
    }
    this.revisions.set(plan.key, revision);
    this.pending.set(plan.key, revision);
    return {
      type: 'started',
      key: plan.key,
      revision,
      optimistic: plan.optimistic,
      optimisticStatus: plan.optimisticStatus,
      // Defer the injected port by one microtask so callers can apply the
      // optimistic reducer before even a synchronous fake/adapter begins I/O.
      completion: Promise.resolve().then(() => this.complete(plan, revision))
    };
  }

  private async complete<Value>(
    plan: MutationPlan<Value>,
    revision: number
  ): Promise<SettingsMutationOutcome> {
    try {
      const source = plan.context.local ? 'local' as const : 'remote' as const;
      const value = plan.context.local ? undefined : await plan.runRemote();
      if (
        source === 'remote' &&
        value !== undefined &&
        plan.superseded?.(value as Value)
      ) {
        if (!this.isCurrent(plan.key, revision)) return this.discarded(plan.key, revision);
        return this.discarded(plan.key, revision, 'superseded');
      }
      if (
        !this.disposed &&
        revision > (this.confirmedRevision.get(plan.key) ?? -1)
      ) {
        plan.onConfirmed?.(value, source);
        this.confirmedRollback.set(plan.key, plan.confirmed(value, source));
        this.confirmedRevision.set(plan.key, revision);
      }
      if (!this.isCurrent(plan.key, revision)) return this.discarded(plan.key, revision);
      const reconcile = plan.reconcile?.(value, source);
      return {
        type: 'saved',
        key: plan.key,
        revision,
        source,
        ...(reconcile == null ? {} : { reconcile }),
        status: plan.savedStatus(source),
        ...(plan.effect == null ? {} : { effect: plan.effect(source) })
      };
    } catch (error) {
      if (!this.isCurrent(plan.key, revision)) return this.discarded(plan.key, revision);
      return {
        type: 'failed',
        key: plan.key,
        revision,
        error,
        rollback: plan.failureRollback?.() ??
          this.confirmedRollback.get(plan.key) ??
          plan.rollback,
        status: plan.failureStatus
      };
    } finally {
      if (this.pending.get(plan.key) === revision) this.pending.delete(plan.key);
    }
  }

  private isCurrent(key: string, revision: number): boolean {
    return !this.disposed && this.revisions.get(key) === revision;
  }

  private discarded(
    key: string,
    revision: number,
    reason: 'stale' | 'superseded' | 'disposed' = this.disposed ? 'disposed' : 'stale'
  ): SettingsMutationOutcome {
    return {
      type: 'discarded',
      key,
      revision,
      reason
    };
  }
}

export function applySettingsMutationOutcome(
  bundle: SettingsBundle,
  outcome: SettingsMutationOutcome
): SettingsBundle {
  if (outcome.type === 'failed' && outcome.rollback) {
    return applySettingsBundleMutation(bundle, outcome.rollback);
  }
  if (outcome.type === 'saved' && outcome.reconcile) {
    return applySettingsBundleMutation(bundle, outcome.reconcile);
  }
  return bundle;
}

function fieldMutationKey(group: SettingsGroup, key: string): string {
  return `field:${group}:${key}`;
}

function scheduleDeleteMutationKey(id: string): string {
  // Toggle and delete share one physical gateway lane in the host adapter, but
  // their UI rollbacks have different shapes. Separate revision identities keep
  // a stale scalar toggle confirmation from replacing delete's item restoration.
  return `schedule-delete:${id}`;
}

function scheduleToggleMutationKey(id: string): string {
  return `schedule-toggle:${id}`;
}

function pluginMutationKey(id: string): string {
  return `plugin:${id}`;
}

function rawFieldValue(
  bundle: SettingsBundle,
  field: Pick<SettingsField, 'group' | 'key'>
): unknown {
  return (bundle[field.group] as unknown as Record<string, unknown>)[field.key];
}

function isSettingsFieldValue(value: unknown): value is SettingsFieldValue {
  return value == null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean';
}

function brightnessMutation(display: DisplayState): SettingsBundleMutation {
  return {
    type: 'patch-display',
    patch: {
      brightness: display.brightness,
      requestedBrightness: display.requestedBrightness,
      lowBatteryBrightnessActive: display.lowBatteryBrightnessActive
    }
  };
}

function cloneSchedule(schedule: WakeSchedule): WakeSchedule {
  return { ...schedule, daysOfWeek: [...schedule.daysOfWeek] };
}

function rejected(
  reason: Extract<SettingsMutationStart, { type: 'rejected' }>['reason'],
  status: string
): Extract<SettingsMutationStart, { type: 'rejected' }> {
  return { type: 'rejected', reason, status };
}

// Compile-time boundary: the feature flow accepts settings DTOs, not AppState,
// DOM objects, SettingsStoreSync, or a command scheduler.
function assertNarrowRemotePort(remote: SettingsMutationRemotePort): void {
  // @ts-expect-error Remote ports do not expose cross-device KV synchronization.
  void remote.writeStore;
  // @ts-expect-error Remote ports do not expose scheduler policy.
  void remote.runExact;
}
void assertNarrowRemotePort;
