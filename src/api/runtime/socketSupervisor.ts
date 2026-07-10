/** Minimal WebSocket surface used by the reconnect owner and its tests. */
export interface SupervisedWebSocket<RawData = string> {
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent<RawData>) => void) | null;
  onerror: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  close(): void;
}

export interface SocketSupervisorScheduler {
  schedule(callback: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

export const browserSocketSupervisorScheduler: SocketSupervisorScheduler = {
  schedule: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  cancel: (handle) => {
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
  }
};

export function browserWebSocketFactory(url: string): SupervisedWebSocket<string> {
  return new WebSocket(url);
}

export type SocketSupervisorState =
  | 'stopped'
  | 'connecting'
  | 'open'
  | 'retry-wait'
  | 'disposed';

export interface SocketMessageContext<RawData> {
  readonly connectionId: number;
  readonly event: MessageEvent<RawData>;
}

export interface SocketOpenContext {
  readonly connectionId: number;
  readonly event: Event;
}

export interface SocketCloseContext {
  readonly connectionId: number;
  readonly event: CloseEvent;
  readonly willRetry: boolean;
}

export type SocketSupervisorFailure<RawData> =
  | { readonly phase: 'connect'; readonly error: unknown }
  | { readonly phase: 'decode'; readonly error: unknown; readonly data: RawData }
  | { readonly phase: 'socket'; readonly event: Event }
  | { readonly phase: 'close'; readonly error: unknown }
  | { readonly phase: 'backoff'; readonly error: unknown }
  | { readonly phase: 'schedule'; readonly error: unknown };

export interface SocketSupervisorOptions<Message, RawData = string> {
  /** Resolved again for every attempt, so a runtime gateway origin may move. */
  readonly url: string | (() => string);
  readonly socketFactory: (url: string) => SupervisedWebSocket<RawData>;
  readonly scheduler: SocketSupervisorScheduler;
  /** Receives a zero-based consecutive failure count. An open resets it. */
  readonly backoffDelayMs: (attempt: number) => number;
  /** Wire parsing/normalization belongs at the API boundary and is injected. */
  readonly decode: (data: RawData) => Message;
  readonly onMessage: (message: Message, context: SocketMessageContext<RawData>) => void;
  readonly onOpen?: (context: SocketOpenContext) => void;
  readonly onClose?: (context: SocketCloseContext) => void;
  readonly onFailure?: (failure: SocketSupervisorFailure<RawData>) => void;
  /** Structural connection policy remains with the caller. */
  readonly onStateChange?: (
    state: SocketSupervisorState,
    previous: SocketSupervisorState
  ) => void;
}

/**
 * Owns exactly one WebSocket and one retry timer.
 *
 * It deliberately knows nothing about DOM, rendering, or application state.
 * Each connection attempt has an identity; callbacks captured from a stopped
 * or superseded socket are ignored even if a platform delivers them late.
 */
export class SocketSupervisor<Message, RawData = string> {
  private readonly options: SocketSupervisorOptions<Message, RawData>;
  private socket: SupervisedWebSocket<RawData> | null = null;
  private retryHandle: unknown;
  private retryScheduled = false;
  private running = false;
  private disposed = false;
  private generation = 0;
  private consecutiveFailures = 0;
  private currentState: SocketSupervisorState = 'stopped';

  constructor(options: SocketSupervisorOptions<Message, RawData>) {
    this.options = options;
  }

  get state(): SocketSupervisorState {
    return this.currentState;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  /** Start immediately. Calling start while running is a no-op. */
  start(): void {
    if (this.disposed || this.running) return;
    this.running = true;
    this.consecutiveFailures = 0;
    this.connect();
  }

  /** Stop and release the socket/timer. A later start begins a fresh session. */
  stop(): void {
    if (
      this.disposed ||
      (!this.running && this.socket == null && !this.retryScheduled && this.currentState === 'stopped')
    ) return;
    this.teardown('stopped');
  }

  /** Permanently stop. Calling dispose more than once is safe. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.teardown('disposed');
  }

  private connect(): void {
    if (!this.running || this.disposed) return;
    this.cancelRetry();
    const connectionId = ++this.generation;
    this.setState('connecting');

    let socket: SupervisedWebSocket<RawData>;
    try {
      const url = typeof this.options.url === 'function' ? this.options.url() : this.options.url;
      socket = this.options.socketFactory(url);
    } catch (error) {
      if (!this.isGenerationCurrent(connectionId)) return;
      this.options.onFailure?.({ phase: 'connect', error });
      if (this.isGenerationCurrent(connectionId)) this.scheduleRetry(connectionId);
      return;
    }

    if (!this.isGenerationCurrent(connectionId)) {
      this.closeSocket(socket);
      return;
    }
    this.socket = socket;

    socket.onopen = (event) => {
      if (!this.isSocketCurrent(socket, connectionId)) return;
      this.consecutiveFailures = 0;
      this.setState('open');
      this.options.onOpen?.({ connectionId, event });
    };
    socket.onmessage = (event) => {
      if (!this.isSocketCurrent(socket, connectionId)) return;
      let message: Message;
      try {
        message = this.options.decode(event.data);
      } catch (error) {
        this.options.onFailure?.({ phase: 'decode', error, data: event.data });
        return;
      }
      if (!this.isSocketCurrent(socket, connectionId)) return;
      this.options.onMessage(message, { connectionId, event });
    };
    socket.onerror = (event) => {
      if (!this.isSocketCurrent(socket, connectionId)) return;
      this.options.onFailure?.({ phase: 'socket', event });
    };
    socket.onclose = (event) => {
      if (!this.isSocketCurrent(socket, connectionId)) return;
      this.detachSocket(socket);
      this.socket = null;
      const willRetry = this.running && !this.disposed;
      if (willRetry) this.scheduleRetry(connectionId);
      else this.setState(this.disposed ? 'disposed' : 'stopped');
      this.options.onClose?.({ connectionId, event, willRetry });
    };
  }

  private scheduleRetry(connectionId: number): void {
    if (
      this.retryScheduled ||
      !this.isGenerationCurrent(connectionId)
    ) return;

    const attempt = this.consecutiveFailures;
    this.consecutiveFailures += 1;
    let delayMs: number;
    try {
      const requested = this.options.backoffDelayMs(attempt);
      delayMs = Number.isFinite(requested) && requested >= 0 ? requested : 0;
    } catch (error) {
      this.options.onFailure?.({ phase: 'backoff', error });
      delayMs = 0;
    }

    this.retryScheduled = true;
    this.setState('retry-wait');
    try {
      this.retryHandle = this.options.scheduler.schedule(() => {
        this.retryScheduled = false;
        this.retryHandle = undefined;
        if (!this.isGenerationCurrent(connectionId)) return;
        this.connect();
      }, delayMs);
    } catch (error) {
      this.retryScheduled = false;
      this.retryHandle = undefined;
      this.running = false;
      this.setState('stopped');
      this.options.onFailure?.({ phase: 'schedule', error });
    }
  }

  private cancelRetry(): void {
    if (!this.retryScheduled) return;
    this.options.scheduler.cancel(this.retryHandle);
    this.retryHandle = undefined;
    this.retryScheduled = false;
  }

  private teardown(state: 'stopped' | 'disposed'): void {
    this.running = false;
    this.generation += 1;
    this.consecutiveFailures = 0;
    this.cancelRetry();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      this.detachSocket(socket);
      this.closeSocket(socket);
    }
    this.setState(state);
  }

  private closeSocket(socket: SupervisedWebSocket<RawData>): void {
    try {
      socket.close();
    } catch (error) {
      this.options.onFailure?.({ phase: 'close', error });
    }
  }

  private detachSocket(socket: SupervisedWebSocket<RawData>): void {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
  }

  private isGenerationCurrent(connectionId: number): boolean {
    return this.running && !this.disposed && connectionId === this.generation;
  }

  private isSocketCurrent(
    socket: SupervisedWebSocket<RawData>,
    connectionId: number
  ): boolean {
    return this.isGenerationCurrent(connectionId) && this.socket === socket;
  }

  private setState(next: SocketSupervisorState): void {
    if (next === this.currentState) return;
    const previous = this.currentState;
    this.currentState = next;
    this.options.onStateChange?.(next, previous);
  }
}
