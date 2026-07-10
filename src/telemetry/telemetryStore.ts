import type { DisplayState } from '../api/settings';
import type { MachineSnapshot, ScaleSnapshot, ShotStateEvent } from '../api/types';

/** Normalized payload from `/ws/v1/machine/waterLevels`. */
export interface WaterLevelSnapshot {
  readonly currentLevelMm: number | null;
  readonly refillLevelMm: number | null;
}

/**
 * The five independently-paced Reaprime streams. Payload parsing/normalizing
 * stays at the API boundary; this store only owns latest-value and revision
 * semantics.
 */
export interface TelemetryChannels {
  readonly machine: MachineSnapshot;
  readonly scale: ScaleSnapshot;
  readonly water: WaterLevelSnapshot;
  readonly display: DisplayState;
  readonly shotState: ShotStateEvent;
}

export type TelemetryChannel = keyof TelemetryChannels;

export type TelemetryLatest = {
  readonly [Channel in TelemetryChannel]: TelemetryChannels[Channel] | null;
};

export type TelemetryRevisions = {
  readonly [Channel in TelemetryChannel]: number;
};

export type TelemetryObservedAt = {
  readonly [Channel in TelemetryChannel]: number | null;
};

export type TelemetrySnapshot = TelemetryLatest & {
  /** Increments for every ingested frame, including presentation-equal frames. */
  readonly revision: number;
  /** Per-stream revisions; streams never borrow ordering from one another. */
  readonly revisions: TelemetryRevisions;
  readonly observedAtMs: TelemetryObservedAt;
};

export interface TelemetryFrame<Channel extends TelemetryChannel> {
  readonly channel: Channel;
  readonly value: TelemetryChannels[Channel];
  readonly previous: TelemetryChannels[Channel] | null;
  readonly revision: number;
  readonly channelRevision: number;
  readonly observedAtMs: number;
}

export type AnyTelemetryFrame = {
  [Channel in TelemetryChannel]: TelemetryFrame<Channel>;
}[TelemetryChannel];

export type RawTelemetryListener = (
  frame: AnyTelemetryFrame,
  snapshot: TelemetrySnapshot
) => void;

export type TelemetryChannelListener<Channel extends TelemetryChannel> = (
  frame: TelemetryFrame<Channel>,
  snapshot: TelemetrySnapshot
) => void;

export type TelemetrySelector<Value> = (snapshot: TelemetrySnapshot) => Value;

export type TelemetrySelectorListener<Value> = (
  value: Value,
  previous: Value | undefined,
  snapshot: TelemetrySnapshot
) => void;

export interface TelemetrySubscriptionOptions<Value> {
  readonly equals?: (previous: Value, next: Value) => boolean;
  readonly emitCurrent?: boolean;
}

export interface TelemetryStoreOptions {
  readonly now?: () => number;
  readonly onListenerError?: (error: unknown) => void;
}

interface ErasedSelectorSubscription {
  readonly selector: TelemetrySelector<unknown>;
  readonly listener: TelemetrySelectorListener<unknown>;
  readonly equals: (previous: unknown, next: unknown) => boolean;
  selected: unknown;
}

type ErasedChannelListener = (
  frame: AnyTelemetryFrame,
  snapshot: TelemetrySnapshot
) => void;

const CHANNELS: readonly TelemetryChannel[] = [
  'machine',
  'scale',
  'water',
  'display',
  'shotState'
];

const ZERO_REVISIONS: TelemetryRevisions = Object.freeze({
  machine: 0,
  scale: 0,
  water: 0,
  display: 0,
  shotState: 0
});

const EMPTY_OBSERVED_AT: TelemetryObservedAt = Object.freeze({
  machine: null,
  scale: null,
  water: null,
  display: null,
  shotState: null
});

function initialSnapshot(): TelemetrySnapshot {
  return Object.freeze({
    machine: null,
    scale: null,
    water: null,
    display: null,
    shotState: null,
    revision: 0,
    revisions: ZERO_REVISIONS,
    observedAtMs: EMPTY_OBSERVED_AT
  });
}

/**
 * Revisioned latest-value store for normalized socket frames.
 *
 * Raw listeners see every frame and are the intended boundary for lossless
 * shot recording. Selector listeners are change-gated and are intended for
 * presentation. The store deliberately derives no sleep, alert, shot, or
 * navigation events; callers own those structural policies.
 */
export class TelemetryStore {
  private current: TelemetrySnapshot = initialSnapshot();
  private readonly now: () => number;
  private readonly onListenerError: (error: unknown) => void;
  private readonly rawListeners = new Set<RawTelemetryListener>();
  private readonly channelListeners = new Map<TelemetryChannel, Set<ErasedChannelListener>>();
  private readonly selectorSubscriptions = new Set<ErasedSelectorSubscription>();
  private disposed = false;

  constructor(options: TelemetryStoreOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.onListenerError =
      options.onListenerError ??
      ((error) => console.error('[Beanie] Telemetry listener failed', error));
    for (const channel of CHANNELS) this.channelListeners.set(channel, new Set());
  }

  get snapshot(): TelemetrySnapshot {
    return this.current;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  /**
   * Ingest one already-normalized frame. Every accepted call increments both
   * global and channel revisions, even when it repeats the same object/value.
   */
  ingest<Channel extends TelemetryChannel>(
    channel: Channel,
    value: TelemetryChannels[Channel],
    observedAtMs = this.now()
  ): TelemetryFrame<Channel> | null {
    if (this.disposed) return null;
    const timestamp = Number.isFinite(observedAtMs) ? observedAtMs : this.now();
    const previousSnapshot = this.current;
    const channelRevision = previousSnapshot.revisions[channel] + 1;
    const revision = previousSnapshot.revision + 1;
    const frame: TelemetryFrame<Channel> = Object.freeze({
      channel,
      value,
      previous: previousSnapshot[channel] as TelemetryChannels[Channel] | null,
      revision,
      channelRevision,
      observedAtMs: timestamp
    });
    this.current = Object.freeze({
      ...previousSnapshot,
      [channel]: value,
      revision,
      revisions: Object.freeze({
        ...previousSnapshot.revisions,
        [channel]: channelRevision
      }),
      observedAtMs: Object.freeze({
        ...previousSnapshot.observedAtMs,
        [channel]: timestamp
      })
    }) as TelemetrySnapshot;

    const anyFrame = frame as AnyTelemetryFrame;
    for (const listener of [...this.rawListeners]) {
      this.callListener(() => listener(anyFrame, this.current));
    }
    for (const listener of [...(this.channelListeners.get(channel) ?? [])]) {
      this.callListener(() => listener(anyFrame, this.current));
    }
    this.notifySelectors();
    return frame;
  }

  /** Lossless subscription used by shot/session recording and structural policy. */
  subscribeRaw(listener: RawTelemetryListener): () => void {
    if (this.disposed) return () => {};
    this.rawListeners.add(listener);
    return () => this.rawListeners.delete(listener);
  }

  /** Subscribe to every frame from one typed stream. */
  subscribeChannel<Channel extends TelemetryChannel>(
    channel: Channel,
    listener: TelemetryChannelListener<Channel>,
    options: { readonly emitCurrent?: boolean } = {}
  ): () => void {
    if (this.disposed) return () => {};
    const erased: ErasedChannelListener = (frame, snapshot) => {
      listener(frame as TelemetryFrame<Channel>, snapshot);
    };
    this.channelListeners.get(channel)?.add(erased);
    if (options.emitCurrent) {
      const value = this.current[channel];
      const observedAtMs = this.current.observedAtMs[channel];
      if (value != null && observedAtMs != null) {
        const frame = Object.freeze({
          channel,
          value,
          previous: null,
          revision: this.current.revision,
          channelRevision: this.current.revisions[channel],
          observedAtMs
        }) as TelemetryFrame<Channel>;
        this.callListener(() => listener(frame, this.current));
      }
    }
    return () => this.channelListeners.get(channel)?.delete(erased);
  }

  /**
   * Subscribe to a derived presentation value. The selector runs after each raw
   * frame, but the listener runs only when its selected value changes.
   */
  subscribe<Value>(
    selector: TelemetrySelector<Value>,
    listener: TelemetrySelectorListener<Value>,
    options: TelemetrySubscriptionOptions<Value> = {}
  ): () => void {
    if (this.disposed) return () => {};
    const selected = selector(this.current);
    const subscription: ErasedSelectorSubscription = {
      selector: selector as TelemetrySelector<unknown>,
      listener: listener as TelemetrySelectorListener<unknown>,
      equals: (options.equals ?? Object.is) as (previous: unknown, next: unknown) => boolean,
      selected
    };
    this.selectorSubscriptions.add(subscription);
    if (options.emitCurrent) {
      this.callListener(() => listener(selected, undefined, this.current));
    }
    return () => this.selectorSubscriptions.delete(subscription);
  }

  /** Permanently drops subscriptions and ignores future frames. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.rawListeners.clear();
    for (const listeners of this.channelListeners.values()) listeners.clear();
    this.selectorSubscriptions.clear();
  }

  private notifySelectors(): void {
    for (const subscription of [...this.selectorSubscriptions]) {
      let next: unknown;
      try {
        next = subscription.selector(this.current);
      } catch (error) {
        this.onListenerError(error);
        continue;
      }
      const previous = subscription.selected;
      try {
        if (subscription.equals(previous, next)) continue;
      } catch (error) {
        this.onListenerError(error);
        continue;
      }
      subscription.selected = next;
      this.callListener(() => subscription.listener(next, previous, this.current));
    }
  }

  private callListener(call: () => void): void {
    try {
      call();
    } catch (error) {
      this.onListenerError(error);
    }
  }
}
