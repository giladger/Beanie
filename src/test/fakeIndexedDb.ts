/**
 * Minimal in-memory IndexedDB fake for cache tests.
 *
 * Implements only the surface src/domain/cache.ts actually uses:
 * - factory.open(name, version) with onupgradeneeded/onsuccess/onerror/onblocked
 * - db.transaction(names, mode), db.objectStoreNames.contains, db.createObjectStore,
 *   db.close(), db.onversionchange, db.onclose
 * - tx.objectStore(name), tx.oncomplete/onerror/onabort
 * - store.get/getAll/put/delete/clear, store.indexNames.contains, store.createIndex
 *
 * Async ordering mirrors the real thing closely enough to be honest:
 * request success handlers fire in microtasks, and a transaction auto-commits
 * one microtask after its last pending request completes, so promise
 * continuations that synchronously issue follow-up requests keep it alive.
 */

interface StoreData {
  keyPath: string;
  records: Map<string, unknown>;
  indexNames: string[];
}

interface DatabaseData {
  version: number;
  stores: Map<string, StoreData>;
}

class FakeDOMStringList {
  constructor(private readonly names: () => string[]) {}

  contains(name: string): boolean {
    return this.names().includes(name);
  }

  get length(): number {
    return this.names().length;
  }
}

export class FakeIDBRequest<T = unknown> {
  result!: T;
  error: DOMException | null = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;

  succeed(value: T): void {
    this.result = value;
    this.onsuccess?.();
  }

  fail(error: DOMException): void {
    this.error = error;
    this.onerror?.();
  }
}

export class FakeIDBOpenRequest extends FakeIDBRequest<FakeIDBDatabase> {
  transaction: FakeIDBTransaction | null = null;
  onupgradeneeded: (() => void) | null = null;
  onblocked: (() => void) | null = null;
}

export class FakeIDBObjectStore {
  constructor(
    private readonly tx: FakeIDBTransaction,
    private readonly data: StoreData
  ) {}

  get keyPath(): string {
    return this.data.keyPath;
  }

  get indexNames(): FakeDOMStringList {
    return new FakeDOMStringList(() => this.data.indexNames);
  }

  createIndex(name: string, _keyPath: string): void {
    if (this.tx.mode !== 'versionchange') {
      throw new DOMException('createIndex requires a versionchange transaction', 'InvalidStateError');
    }
    if (!this.data.indexNames.includes(name)) this.data.indexNames.push(name);
  }

  get(key: string): FakeIDBRequest<unknown> {
    return this.tx.enqueue(() => clone(this.data.records.get(key)));
  }

  getAll(): FakeIDBRequest<unknown[]> {
    return this.tx.enqueue(() =>
      [...this.data.records.keys()]
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
        .map((key) => clone(this.data.records.get(key)))
    );
  }

  put(value: unknown): FakeIDBRequest<string> {
    return this.tx.enqueue(() => {
      this.requireWrite();
      const key = (value as Record<string, unknown>)[this.data.keyPath];
      if (typeof key !== 'string') {
        throw new DOMException('Fake store only supports string keys', 'DataError');
      }
      this.data.records.set(key, clone(value));
      return key;
    });
  }

  delete(key: string): FakeIDBRequest<undefined> {
    return this.tx.enqueue(() => {
      this.requireWrite();
      this.data.records.delete(key);
      return undefined;
    });
  }

  clear(): FakeIDBRequest<undefined> {
    return this.tx.enqueue(() => {
      this.requireWrite();
      this.data.records.clear();
      return undefined;
    });
  }

  private requireWrite(): void {
    if (this.tx.mode === 'readonly') {
      throw new DOMException('Transaction is read-only', 'ReadOnlyError');
    }
  }
}

export class FakeIDBTransaction {
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  error: DOMException | null = null;

  private finished = false;
  private pending = 0;

  constructor(
    private readonly db: FakeIDBDatabase,
    private readonly scope: readonly string[],
    readonly mode: IDBTransactionMode
  ) {
    queueMicrotask(() => this.maybeCommit());
  }

  objectStore(name: string): FakeIDBObjectStore {
    if (this.finished) {
      throw new DOMException('Transaction has finished', 'InvalidStateError');
    }
    if (!this.scope.includes(name)) {
      throw new DOMException(`Store ${name} is not in this transaction's scope`, 'NotFoundError');
    }
    const data = this.db.storeData(name);
    if (!data) throw new DOMException(`No store named ${name}`, 'NotFoundError');
    return new FakeIDBObjectStore(this, data);
  }

  enqueue<T>(operation: () => T): FakeIDBRequest<T> {
    if (this.finished) {
      throw new DOMException('Transaction is not active', 'TransactionInactiveError');
    }
    const request = new FakeIDBRequest<T>();
    this.pending += 1;
    queueMicrotask(() => {
      if (this.finished) return;
      try {
        request.succeed(operation());
        this.pending -= 1;
        if (this.pending === 0) queueMicrotask(() => this.maybeCommit());
      } catch (error) {
        this.pending -= 1;
        request.fail(error instanceof DOMException ? error : new DOMException(String(error), 'UnknownError'));
        this.abort(request.error);
      }
    });
    return request;
  }

  commitNow(): void {
    this.maybeCommit(true);
  }

  private maybeCommit(force = false): void {
    if (this.finished) return;
    if (!force && this.pending > 0) return;
    this.finished = true;
    this.oncomplete?.();
  }

  private abort(error: DOMException | null): void {
    if (this.finished) return;
    this.finished = true;
    this.error = error;
    this.onabort?.();
  }
}

export class FakeIDBDatabase {
  onversionchange: (() => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;
  private upgradeTransaction: FakeIDBTransaction | null = null;

  constructor(
    private readonly factory: FakeIndexedDb,
    readonly name: string,
    private readonly data: DatabaseData
  ) {}

  get version(): number {
    return this.data.version;
  }

  get objectStoreNames(): FakeDOMStringList {
    return new FakeDOMStringList(() => [...this.data.stores.keys()]);
  }

  storeData(name: string): StoreData | undefined {
    return this.data.stores.get(name);
  }

  createObjectStore(name: string, options: { keyPath: string }): FakeIDBObjectStore {
    if (!this.upgradeTransaction) {
      throw new DOMException('createObjectStore requires a versionchange transaction', 'InvalidStateError');
    }
    const store: StoreData = { keyPath: options.keyPath, records: new Map(), indexNames: [] };
    this.data.stores.set(name, store);
    return new FakeIDBObjectStore(this.upgradeTransaction, store);
  }

  transaction(names: string | string[], mode: IDBTransactionMode = 'readonly'): FakeIDBTransaction {
    if (this.closed) {
      throw new DOMException('The database connection is closing', 'InvalidStateError');
    }
    const scope = Array.isArray(names) ? names : [names];
    return new FakeIDBTransaction(this, scope, mode);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.factory.connectionClosed(this);
  }

  beginUpgrade(): FakeIDBTransaction {
    this.upgradeTransaction = new FakeIDBTransaction(this, [...this.data.stores.keys()], 'versionchange');
    return this.upgradeTransaction;
  }

  endUpgrade(): void {
    this.upgradeTransaction = null;
  }

  dispatchVersionChange(): void {
    this.onversionchange?.();
  }
}

export class FakeIndexedDb {
  private readonly databases = new Map<string, DatabaseData>();
  private readonly connections = new Map<string, Set<FakeIDBDatabase>>();
  private readonly unblockWaiters: Array<{ name: string; resume: () => void }> = [];

  open(name: string, version = 1): FakeIDBOpenRequest {
    const request = new FakeIDBOpenRequest();
    queueMicrotask(() => this.runOpen(name, version, request));
    return request;
  }

  /** Number of live (non-closed) connections to a database. */
  openConnectionCount(name: string): number {
    return this.connectionsFor(name).size;
  }

  /** Test helper: raw keys currently persisted in a store, in key order. */
  rawKeys(databaseName: string, storeName: string): string[] {
    const records = this.databases.get(databaseName)?.stores.get(storeName)?.records;
    return records ? [...records.keys()].sort() : [];
  }

  /**
   * Test helper: deliver a `versionchange` event to every open connection, as
   * another tab starting an upgrade would, without committing a version bump
   * (the upgrading tab may abort or be closed before it commits).
   */
  notifyVersionChange(name: string): void {
    for (const connection of [...this.connectionsFor(name)]) {
      connection.dispatchVersionChange();
    }
  }

  connectionClosed(connection: FakeIDBDatabase): void {
    this.connectionsFor(connection.name).delete(connection);
    for (let i = this.unblockWaiters.length - 1; i >= 0; i -= 1) {
      const waiter = this.unblockWaiters[i];
      if (waiter.name === connection.name && this.connectionsFor(connection.name).size === 0) {
        this.unblockWaiters.splice(i, 1);
        queueMicrotask(waiter.resume);
      }
    }
  }

  private connectionsFor(name: string): Set<FakeIDBDatabase> {
    let set = this.connections.get(name);
    if (!set) {
      set = new Set();
      this.connections.set(name, set);
    }
    return set;
  }

  private runOpen(name: string, version: number, request: FakeIDBOpenRequest): void {
    let data = this.databases.get(name);
    if (!data) {
      data = { version: 0, stores: new Map() };
      this.databases.set(name, data);
    }

    if (version < data.version) {
      request.fail(new DOMException('The requested version is lower than the existing version', 'VersionError'));
      return;
    }

    if (version > data.version && this.connectionsFor(name).size > 0) {
      this.notifyVersionChange(name);
      if (this.connectionsFor(name).size > 0) {
        // Other connections are still open: fire onblocked now, finish the
        // open later when the last connection closes (as real IndexedDB does).
        request.onblocked?.();
        this.unblockWaiters.push({ name, resume: () => this.finishOpen(name, version, request) });
        return;
      }
    }

    this.finishOpen(name, version, request);
  }

  private finishOpen(name: string, version: number, request: FakeIDBOpenRequest): void {
    const data = this.databases.get(name)!;
    const db = new FakeIDBDatabase(this, name, data);

    if (version > data.version) {
      data.version = version;
      const upgradeTx = db.beginUpgrade();
      request.result = db;
      request.transaction = upgradeTx;
      request.onupgradeneeded?.();
      request.transaction = null;
      db.endUpgrade();
      upgradeTx.commitNow();
    }

    this.connectionsFor(name).add(db);
    queueMicrotask(() => request.succeed(db));
  }
}

export function createFakeIndexedDb(): { factory: FakeIndexedDb; asIDBFactory: IDBFactory } {
  const factory = new FakeIndexedDb();
  return { factory, asIDBFactory: factory as unknown as IDBFactory };
}

function clone<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}
