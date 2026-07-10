import {
  SocketSupervisor,
  type SocketSupervisorFailure,
  type SocketSupervisorScheduler,
  type SocketSupervisorState,
  type SupervisedWebSocket
} from '../api/runtime/socketSupervisor';

class FakeSocket<RawData> implements SupervisedWebSocket<RawData> {
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<RawData>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  closeCalls = 0;

  close(): void {
    this.closeCalls += 1;
  }

  serverOpen(): void {
    this.onopen?.(event());
  }

  serverMessage(data: RawData): void {
    this.onmessage?.(messageEvent(data));
  }

  serverClose(): void {
    this.onclose?.(closeEvent());
  }
}

class FakeScheduler implements SocketSupervisorScheduler {
  private nextId = 1;
  private tasks: Array<{ id: number; callback: () => void; delayMs: number; canceled: boolean }> = [];

  schedule(callback: () => void, delayMs: number): unknown {
    const task = { id: this.nextId++, callback, delayMs, canceled: false };
    this.tasks.push(task);
    return task.id;
  }

  cancel(handle: unknown): void {
    const task = this.tasks.find((candidate) => candidate.id === handle);
    if (task) task.canceled = true;
  }

  get activeCount(): number {
    return this.tasks.filter((task) => !task.canceled).length;
  }

  runNext(): void {
    const index = this.tasks.findIndex((task) => !task.canceled);
    if (index < 0) throw new Error('No scheduled task');
    const [task] = this.tasks.splice(index, 1);
    task!.callback();
  }
}

run('socket supervisor starts once and delivers decoded typed messages', () => {
  const scheduler = new FakeScheduler();
  const sockets: FakeSocket<string>[] = [];
  const messages: number[] = [];
  const states: SocketSupervisorState[] = [];
  const opens: number[] = [];
  const supervisor = new SocketSupervisor<number, string>({
    url: 'ws://gateway/machine',
    socketFactory: () => {
      const socket = new FakeSocket<string>();
      sockets.push(socket);
      return socket;
    },
    scheduler,
    backoffDelayMs: (attempt) => 100 * (attempt + 1),
    decode: (data) => Number(JSON.parse(data)),
    onMessage: (message) => messages.push(message),
    onOpen: ({ connectionId }) => opens.push(connectionId),
    onStateChange: (state) => states.push(state)
  });

  supervisor.start();
  supervisor.start();
  equal(sockets.length, 1);
  equal(supervisor.state, 'connecting');
  sockets[0]!.serverOpen();
  sockets[0]!.serverMessage('42');

  deepEqual(messages, [42]);
  deepEqual(opens, [1]);
  deepEqual(states, ['connecting', 'open']);
  equal(supervisor.isRunning, true);
  equal(scheduler.activeCount, 0);
});

run('socket supervisor backs off consecutively and resets after open', () => {
  const scheduler = new FakeScheduler();
  const sockets: FakeSocket<string>[] = [];
  const delays: number[] = [];
  const supervisor = createSupervisor({ scheduler, sockets, delays });

  supervisor.start();
  const firstClose = sockets[0]!.onclose!;
  firstClose(closeEvent());
  firstClose(closeEvent()); // a late duplicate callback from the same socket
  equal(supervisor.state, 'retry-wait');
  deepEqual(delays, [100]);
  equal(scheduler.activeCount, 1);

  scheduler.runNext();
  equal(sockets.length, 2);
  sockets[1]!.serverClose();
  deepEqual(delays, [100, 200]);

  scheduler.runNext();
  sockets[2]!.serverOpen();
  sockets[2]!.serverClose();
  deepEqual(delays, [100, 200, 100]);
});

run('stop cancels retry and stale socket callbacks cannot affect a new session', () => {
  const scheduler = new FakeScheduler();
  const sockets: FakeSocket<string>[] = [];
  const messages: number[] = [];
  const closes: number[] = [];
  const supervisor = new SocketSupervisor<number, string>({
    url: 'ws://gateway/scale',
    socketFactory: () => {
      const socket = new FakeSocket<string>();
      sockets.push(socket);
      return socket;
    },
    scheduler,
    backoffDelayMs: () => 100,
    decode: Number,
    onMessage: (message) => messages.push(message),
    onClose: ({ connectionId }) => closes.push(connectionId)
  });

  supervisor.start();
  const staleOpen = sockets[0]!.onopen!;
  const staleMessage = sockets[0]!.onmessage!;
  const staleClose = sockets[0]!.onclose!;
  sockets[0]!.serverClose();
  equal(scheduler.activeCount, 1);
  supervisor.stop();
  supervisor.stop();
  equal(scheduler.activeCount, 0);
  equal(supervisor.state, 'stopped');

  // Simulate a platform dispatch that was queued before handlers were detached.
  staleOpen(event());
  staleMessage(messageEvent('7'));
  staleClose(closeEvent());
  deepEqual(messages, []);
  deepEqual(closes, [1]);
  equal(scheduler.activeCount, 0);

  supervisor.start();
  equal(sockets.length, 2);
  sockets[1]!.serverOpen();
  sockets[1]!.serverMessage('8');
  deepEqual(messages, [8]);
});

run('decode failures are isolated without reconnecting the healthy socket', () => {
  const scheduler = new FakeScheduler();
  const socket = new FakeSocket<string>();
  const failures: Array<SocketSupervisorFailure<string>['phase']> = [];
  const messages: number[] = [];
  const supervisor = new SocketSupervisor<number, string>({
    url: 'ws://gateway/water',
    socketFactory: () => socket,
    scheduler,
    backoffDelayMs: () => 100,
    decode: (data) => {
      const value = Number(data);
      if (!Number.isFinite(value)) throw new Error('bad frame');
      return value;
    },
    onMessage: (message) => messages.push(message),
    onFailure: (failure) => failures.push(failure.phase)
  });

  supervisor.start();
  socket.serverOpen();
  socket.serverMessage('bad');
  socket.serverMessage('12');

  deepEqual(failures, ['decode']);
  deepEqual(messages, [12]);
  equal(supervisor.state, 'open');
  equal(scheduler.activeCount, 0);
});

run('factory failures retry through the same owned timer', () => {
  const scheduler = new FakeScheduler();
  const failures: string[] = [];
  const urls: string[] = [];
  const socket = new FakeSocket<string>();
  let attempts = 0;
  let origin = 'one';
  const supervisor = new SocketSupervisor<string, string>({
    url: () => `ws://${origin}/display`,
    socketFactory: (url) => {
      attempts += 1;
      urls.push(url);
      if (attempts === 1) throw new Error('factory failed');
      return socket;
    },
    scheduler,
    backoffDelayMs: () => 25,
    decode: (data) => data,
    onMessage: () => {},
    onFailure: (failure) => failures.push(failure.phase)
  });

  supervisor.start();
  equal(supervisor.state, 'retry-wait');
  equal(scheduler.activeCount, 1);
  origin = 'two';
  scheduler.runNext();
  socket.serverOpen();

  deepEqual(failures, ['connect']);
  deepEqual(urls, ['ws://one/display', 'ws://two/display']);
  equal(supervisor.state, 'open');
});

run('dispose is terminal, idempotent, and closes exactly once', () => {
  const scheduler = new FakeScheduler();
  const sockets: FakeSocket<string>[] = [];
  const supervisor = createSupervisor({ scheduler, sockets, delays: [] });
  supervisor.start();
  supervisor.dispose();
  supervisor.dispose();
  supervisor.start();
  supervisor.stop();

  equal(sockets.length, 1);
  equal(sockets[0]!.closeCalls, 1);
  equal(supervisor.state, 'disposed');
  equal(supervisor.isDisposed, true);
  equal(supervisor.isRunning, false);
  equal(scheduler.activeCount, 0);
});

function createSupervisor(input: {
  scheduler: FakeScheduler;
  sockets: FakeSocket<string>[];
  delays: number[];
}): SocketSupervisor<number, string> {
  return new SocketSupervisor<number, string>({
    url: 'ws://gateway/socket',
    socketFactory: () => {
      const socket = new FakeSocket<string>();
      input.sockets.push(socket);
      return socket;
    },
    scheduler: input.scheduler,
    backoffDelayMs: (attempt) => {
      const delay = 100 * (attempt + 1);
      input.delays.push(delay);
      return delay;
    },
    decode: Number,
    onMessage: () => {}
  });
}

function event(): Event {
  return {} as Event;
}

function messageEvent<RawData>(data: RawData): MessageEvent<RawData> {
  return { data } as MessageEvent<RawData>;
}

function closeEvent(): CloseEvent {
  return {} as CloseEvent;
}

function run(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

function equal<T>(actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  }
}

function deepEqual(actual: unknown, expected: unknown): void {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`Expected ${right}, received ${left}`);
}
