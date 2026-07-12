export const MUTATION_OUTBOX_DB_NAME = 'beanie-mutation-outbox';
export const MUTATION_OUTBOX_DB_VERSION = 1;
export const MUTATION_OUTBOX_STORE_NAME = 'mutations';
export const MUTATION_OUTBOX_STORAGE_KEY = 'beanie:mutation-outbox:v1';

export type MutationOutboxState = 'pending' | 'in-flight' | 'retry-wait' | 'acknowledged';
export type MutationOutboxDurability = 'indexeddb' | 'local-storage' | 'memory';
export type MutationReceiptOutcome = 'committed' | 'already-applied' | 'not-applicable';

export interface MutationLease {
  token: string;
  ownerId: string;
  expiresAt: string;
}

export interface MutationFailure {
  message: string;
  failedAt: string;
}

export interface MutationReceipt<Details = unknown> {
  idempotencyKey: string;
  outcome: MutationReceiptOutcome;
  committedAt: string;
  acknowledgedAt: string;
  remoteReceiptId: string | null;
  remoteRevision: string | null;
  details: Details | null;
}

export interface DurableMutationRecord<Payload = unknown, ReceiptDetails = unknown> {
  idempotencyKey: string;
  kind: string;
  aggregateKey: string;
  payload: Payload;
  /** Persisted identity when replay metadata is intentionally excluded. */
  physicalIdentity?: string;
  state: MutationOutboxState;
  createdAt: string;
  updatedAt: string;
  attemptCount: number;
  lastAttemptAt: string | null;
  nextAttemptAt: string | null;
  lastError: MutationFailure | null;
  lease: MutationLease | null;
  receipt: MutationReceipt<ReceiptDetails> | null;
}

export interface MutationCommand<Payload = unknown> {
  idempotencyKey: string;
  kind: string;
  aggregateKey: string;
  payload: Payload;
  /** Stable identity excluding mutable/recomputed replay metadata. */
  physicalIdentity?: string;
  createdAt?: Date;
  /**
   * Atomically place this command after every previously admitted command for
   * the aggregate, even when the caller's wall clock moved backwards.
  */
  causalOrder?: 'aggregate';
  /** Atomically migrate existing routing metadata before causal placement. */
  canonicalAggregateKey?(record: Readonly<DurableMutationRecord>): string;
}

export interface EnqueueResult<Payload = unknown> {
  inserted: boolean;
  durability: MutationOutboxDurability;
  record: DurableMutationRecord<Payload>;
}

export interface ClaimedMutation<Payload = unknown> {
  record: DurableMutationRecord<Payload>;
  leaseToken: string;
}

export interface ClaimDueOptions {
  ownerId: string;
  leaseMs: number;
  limit?: number;
  kinds?: readonly string[];
  now?: Date;
  /** Atomically migrate routing metadata before aggregate heads are chosen. */
  canonicalAggregateKey?(record: Readonly<DurableMutationRecord>): string;
}

export interface MarkMutationRetryOptions {
  idempotencyKey: string;
  leaseToken: string;
  retryAt: Date;
  error: unknown;
  now?: Date;
}

export interface RenewMutationLeaseOptions {
  idempotencyKey: string;
  leaseToken: string;
  leaseMs: number;
  now?: Date;
}

export interface AcknowledgeMutationOptions<Details = unknown> {
  idempotencyKey: string;
  leaseToken: string;
  outcome: MutationReceiptOutcome;
  committedAt?: Date;
  remoteReceiptId?: string | null;
  remoteRevision?: string | null;
  details?: Details;
  now?: Date;
}

export interface PruneAcknowledgedOptions {
  before: Date;
  limit?: number;
}

export interface MutationOutboxStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface DurableMutationOutboxOptions {
  databaseName?: string;
  indexedDB?: IDBFactory | null;
  storage?: MutationOutboxStorage | null;
  storageKey?: string;
  now?: () => Date;
  createLeaseToken?: () => string;
}

interface MutationBackend {
  readonly durability: MutationOutboxDurability;
  isAvailable(): Promise<boolean>;
  readAll(): Promise<DurableMutationRecord[]>;
  mutate<Result>(
    mutation: (records: Map<string, DurableMutationRecord>) => Result
  ): Promise<Result>;
  close(): void;
}

export class IdempotencyConflictError extends Error {
  constructor(readonly idempotencyKey: string) {
    super(`Mutation ${idempotencyKey} was enqueued with different command data`);
    this.name = 'IdempotencyConflictError';
  }
}

export class MutationOutboxCorruptionError extends Error {
  constructor(readonly location: string) {
    super(`Mutation outbox contains malformed data in ${location}`);
    this.name = 'MutationOutboxCorruptionError';
  }
}

/**
 * An authoritative local command journal for physical operations.
 *
 * A record is retained after acknowledgement as a receipt tombstone. That is
 * intentional: re-enqueueing the same physical operation is then a no-op even
 * after the remote write has completed. Call pruneAcknowledged only after the
 * remote system's idempotency retention window has elapsed.
 *
 * IndexedDB supplies cross-context transaction isolation. The localStorage
 * fallback is for a single active app context on platforms without IndexedDB;
 * localStorage has no compare-and-swap primitive and cannot safely coordinate
 * claims across tabs. The memory mode is explicitly non-durable and is only a
 * last-chance, current-process record; callers can detect both modes through
 * durability() and EnqueueResult.durability. Executors must also propagate
 * idempotencyKey to the remote mutation endpoint: a local lease fences journal
 * state, not an already dispatched remote side effect. Choose a lease longer
 * than the executor's bounded request time because this repository does not
 * renew leases.
 */
export class DurableMutationOutbox {
  private readonly databaseName: string;
  private readonly factory: IDBFactory | null;
  private readonly storage: MutationOutboxStorage | null;
  private readonly storageKey: string;
  private readonly now: () => Date;
  private readonly createLeaseToken: () => string;
  private backendPromise: Promise<MutationBackend> | null = null;
  private operationTail: Promise<void> = Promise.resolve();
  private disposePromise: Promise<void> | null = null;
  private disposed = false;

  constructor(options: DurableMutationOutboxOptions = {}) {
    this.databaseName = options.databaseName ?? MUTATION_OUTBOX_DB_NAME;
    this.factory =
      options.indexedDB === undefined ? defaultIndexedDbFactory() : options.indexedDB;
    this.storage = options.storage === undefined ? defaultStorage() : options.storage;
    this.storageKey = options.storageKey ?? MUTATION_OUTBOX_STORAGE_KEY;
    this.now = options.now ?? (() => new Date());
    this.createLeaseToken = options.createLeaseToken ?? defaultLeaseToken;
  }

  async durability(): Promise<MutationOutboxDurability> {
    this.assertOpen();
    return (await this.backend()).durability;
  }

  async enqueue<Payload>(command: MutationCommand<Payload>): Promise<EnqueueResult<Payload>> {
    this.assertOpen();
    validateCommand(command);
    return this.exclusive(async () => {
      const backend = await this.backend();
      const requestedCreatedAt = command.createdAt ?? this.now();
      return backend.mutate((records) => {
        if (command.canonicalAggregateKey) {
          for (const record of records.values()) {
            const aggregateKey = command.canonicalAggregateKey(record);
            requireNonEmpty(aggregateKey, 'canonicalAggregateKey');
            if (aggregateKey !== record.aggregateKey) {
              records.set(record.idempotencyKey, { ...record, aggregateKey });
            }
          }
        }
        const existing = records.get(command.idempotencyKey);
        if (existing) {
          if (!samePhysicalCommand(existing, command)) {
            throw new IdempotencyConflictError(command.idempotencyKey);
          }
          // aggregateKey is routing metadata, not part of the physical
          // command's identity. Re-enqueueing an otherwise identical command
          // is therefore the safe place to persist a newer canonical route.
          let canonical = existing.aggregateKey === command.aggregateKey
            ? existing
            : { ...existing, aggregateKey: command.aggregateKey };
          if (canonical.physicalIdentity == null && command.physicalIdentity != null) {
            canonical = { ...canonical, physicalIdentity: command.physicalIdentity };
          }
          if (canonical !== existing) records.set(existing.idempotencyKey, canonical);
          return {
            inserted: false,
            durability: backend.durability,
            record: cloneValue(canonical) as DurableMutationRecord<Payload>
          };
        }

        const requestedCreatedAtMs = requestedCreatedAt.getTime();
        const latestAggregateCreatedAtMs = command.causalOrder === 'aggregate'
          ? [...records.values()].reduce(
              (latest, record) => record.aggregateKey === command.aggregateKey
                ? Math.max(latest, Date.parse(record.createdAt))
                : latest,
              Number.NEGATIVE_INFINITY
            )
          : Number.NEGATIVE_INFINITY;
        const createdAt = new Date(Math.max(
          requestedCreatedAtMs,
          Number.isFinite(latestAggregateCreatedAtMs)
            ? latestAggregateCreatedAtMs + 1
            : requestedCreatedAtMs
        )).toISOString();
        const record: DurableMutationRecord<Payload> = {
          idempotencyKey: command.idempotencyKey,
          kind: command.kind,
          aggregateKey: command.aggregateKey,
          payload: cloneValue(command.payload),
          ...(command.physicalIdentity == null
            ? {}
            : { physicalIdentity: command.physicalIdentity }),
          state: 'pending',
          createdAt,
          updatedAt: createdAt,
          attemptCount: 0,
          lastAttemptAt: null,
          // Preserve the requested wall time for diagnostics. New pending work
          // is immediately due; causal createdAt may advance only for ordering.
          nextAttemptAt: requestedCreatedAt.toISOString(),
          lastError: null,
          lease: null,
          receipt: null
        };
        records.set(record.idempotencyKey, record);
        return { inserted: true, durability: backend.durability, record: cloneValue(record) };
      });
    });
  }

  async get<Payload = unknown>(idempotencyKey: string): Promise<DurableMutationRecord<Payload> | null> {
    this.assertOpen();
    requireNonEmpty(idempotencyKey, 'idempotencyKey');
    return this.exclusive(async () => {
      const records = await (await this.backend()).readAll();
      const found = records.find((record) => record.idempotencyKey === idempotencyKey);
      return found ? (cloneValue(found) as DurableMutationRecord<Payload>) : null;
    });
  }

  async list<Payload = unknown>(
    states?: readonly MutationOutboxState[]
  ): Promise<Array<DurableMutationRecord<Payload>>> {
    this.assertOpen();
    return this.exclusive(async () => {
      const records = await (await this.backend()).readAll();
      const requested = states ? new Set(states) : null;
      return records
        .filter((record) => requested == null || requested.has(record.state))
        .sort(compareRecords)
        .map((record) => cloneValue(record) as DurableMutationRecord<Payload>);
    });
  }

  async claimDue<Payload = unknown>(
    options: ClaimDueOptions
  ): Promise<Array<ClaimedMutation<Payload>>> {
    this.assertOpen();
    requireNonEmpty(options.ownerId, 'ownerId');
    requirePositiveFinite(options.leaseMs, 'leaseMs');
    const limit = options.limit ?? 1;
    requirePositiveInteger(limit, 'limit');
    options.kinds?.forEach((kind) => requireNonEmpty(kind, 'kind'));
    const requestedKinds = options.kinds ? new Set(options.kinds) : null;

    return this.exclusive(async () => {
      const now = options.now ?? this.now();
      const nowMs = now.getTime();
      const nowIso = now.toISOString();
      const leaseExpiresAt = new Date(nowMs + options.leaseMs).toISOString();
      return (await this.backend()).mutate((records) => {
        if (options.canonicalAggregateKey) {
          for (const record of records.values()) {
            const aggregateKey = options.canonicalAggregateKey(record);
            requireNonEmpty(aggregateKey, 'canonicalAggregateKey');
            if (aggregateKey !== record.aggregateKey) {
              records.set(record.idempotencyKey, { ...record, aggregateKey });
            }
          }
        }
        const due = aggregateHeads(records.values())
          .filter(
            (record) =>
              (requestedKinds == null || requestedKinds.has(record.kind)) && isDue(record, nowMs)
          )
          .sort(compareRecords)
          .slice(0, limit);

        return due.map((record): ClaimedMutation<Payload> => {
          const leaseToken = this.nextLeaseToken(record.lease?.token ?? null);
          const claimed: DurableMutationRecord = {
            ...record,
            state: 'in-flight',
            updatedAt: nowIso,
            attemptCount: record.attemptCount + 1,
            lastAttemptAt: nowIso,
            nextAttemptAt: null,
            lease: {
              token: leaseToken,
              ownerId: options.ownerId,
              expiresAt: leaseExpiresAt
            },
            receipt: null
          };
          records.set(claimed.idempotencyKey, claimed);
          return {
            record: cloneValue(claimed) as DurableMutationRecord<Payload>,
            leaseToken
          };
        });
      });
    });
  }

  async markRetry(options: MarkMutationRetryOptions): Promise<boolean> {
    this.assertOpen();
    requireNonEmpty(options.idempotencyKey, 'idempotencyKey');
    requireNonEmpty(options.leaseToken, 'leaseToken');
    requireValidDate(options.retryAt, 'retryAt');

    return this.exclusive(async () => {
      const now = options.now ?? this.now();
      const nowMs = now.getTime();
      const nowIso = now.toISOString();
      return (await this.backend()).mutate((records) => {
        const current = records.get(options.idempotencyKey);
        if (!hasActiveLease(current, options.leaseToken, nowMs)) return false;
        records.set(current.idempotencyKey, {
          ...current,
          state: 'retry-wait',
          updatedAt: nowIso,
          nextAttemptAt: options.retryAt.toISOString(),
          lastError: { message: errorMessage(options.error), failedAt: nowIso },
          lease: null
        });
        return true;
      });
    });
  }

  /** Extend a still-current, unexpired fencing lease. Stale workers get false. */
  async renewLease(options: RenewMutationLeaseOptions): Promise<boolean> {
    this.assertOpen();
    requireNonEmpty(options.idempotencyKey, 'idempotencyKey');
    requireNonEmpty(options.leaseToken, 'leaseToken');
    requirePositiveFinite(options.leaseMs, 'leaseMs');

    return this.exclusive(async () => {
      const now = options.now ?? this.now();
      const nowMs = now.getTime();
      const nowIso = now.toISOString();
      return (await this.backend()).mutate((records) => {
        const current = records.get(options.idempotencyKey);
        if (!hasActiveLease(current, options.leaseToken, nowMs)) return false;
        records.set(current.idempotencyKey, {
          ...current,
          updatedAt: nowIso,
          lease: {
            ...current.lease,
            expiresAt: new Date(nowMs + options.leaseMs).toISOString()
          }
        });
        return true;
      });
    });
  }

  async acknowledge<Details = unknown>(
    options: AcknowledgeMutationOptions<Details>
  ): Promise<boolean> {
    this.assertOpen();
    requireNonEmpty(options.idempotencyKey, 'idempotencyKey');
    requireNonEmpty(options.leaseToken, 'leaseToken');

    return this.exclusive(async () => {
      const now = options.now ?? this.now();
      const committedAt = options.committedAt ?? now;
      requireValidDate(committedAt, 'committedAt');
      const nowMs = now.getTime();
      const nowIso = now.toISOString();
      return (await this.backend()).mutate((records) => {
        const current = records.get(options.idempotencyKey);
        if (!hasActiveLease(current, options.leaseToken, nowMs)) return false;
        records.set(current.idempotencyKey, {
          ...current,
          state: 'acknowledged',
          updatedAt: nowIso,
          nextAttemptAt: null,
          lastError: null,
          lease: null,
          receipt: {
            idempotencyKey: current.idempotencyKey,
            outcome: options.outcome,
            committedAt: committedAt.toISOString(),
            acknowledgedAt: nowIso,
            remoteReceiptId: options.remoteReceiptId ?? null,
            remoteRevision: options.remoteRevision ?? null,
            details: options.details === undefined ? null : cloneValue(options.details)
          }
        });
        return true;
      });
    });
  }

  async pruneAcknowledged(options: PruneAcknowledgedOptions): Promise<number> {
    this.assertOpen();
    requireValidDate(options.before, 'before');
    const limit = options.limit ?? 100;
    requirePositiveInteger(limit, 'limit');

    return this.exclusive(async () =>
      (await this.backend()).mutate((records) => {
        const removable = [...records.values()]
          .filter(
            (record) =>
              record.state === 'acknowledged' &&
              Date.parse(record.receipt?.acknowledgedAt ?? record.updatedAt) < options.before.getTime()
          )
          .sort(compareRecords)
          .slice(0, limit);
        for (const record of removable) records.delete(record.idempotencyKey);
        return removable.length;
      })
    );
  }

  dispose(): Promise<void> {
    if (!this.disposePromise) {
      this.disposed = true;
      this.disposePromise = this.finishDispose();
    }
    return this.disposePromise;
  }

  private async backend(): Promise<MutationBackend> {
    if (!this.backendPromise) {
      const attempt = this.selectBackend();
      this.backendPromise = attempt;
      void attempt.catch(() => {
        // A transient IDB open/upgrade failure is fail-closed for this call,
        // but it must not poison every future physical mutation until reload.
        if (this.backendPromise === attempt && !this.disposed) this.backendPromise = null;
      });
    }
    return this.backendPromise;
  }

  private async selectBackend(): Promise<MutationBackend> {
    if (this.factory) {
      const indexedDb = new IndexedDbMutationBackend(this.factory, this.databaseName);
      if (await indexedDb.isAvailable()) {
        if (this.storage) {
          const fallback = new LocalStorageMutationBackend(this.storage, this.storageKey);
          if (await fallback.isAvailable()) {
            try {
              await migrateFallbackRecords(fallback, indexedDb);
            } catch (error) {
              indexedDb.close();
              throw error;
            }
          }
        }
        return indexedDb;
      }
      indexedDb.close();
      // A present factory which failed to open may be transiently blocked or
      // unavailable in only this context. Falling through to localStorage here
      // would let two tabs claim from different authoritative journals. The
      // explicit fallback is therefore reserved for platforms with no IDB
      // factory at all; an IDB open failure is surfaced and retried by the
      // caller instead of splitting authority.
      throw new Error('IndexedDB mutation outbox could not be opened');
    }

    if (this.storage) {
      const localStorage = new LocalStorageMutationBackend(this.storage, this.storageKey);
      if (await localStorage.isAvailable()) return localStorage;
    }

    return new MemoryMutationBackend();
  }

  private exclusive<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = this.operationTail.then(operation, operation);
    this.operationTail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private assertOpen(): void {
    if (this.disposed) throw new Error('Mutation outbox has been disposed');
  }

  private async finishDispose(): Promise<void> {
    await this.operationTail;
    if (!this.backendPromise) return;
    try {
      (await this.backendPromise).close();
    } catch {
      // Backend initialization failures are surfaced by the operation that
      // triggered them. Disposal still completes because there is no acquired
      // connection left to release in that case.
    }
  }

  private nextLeaseToken(previousToken: string | null): string {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const candidate = requireLeaseToken(this.createLeaseToken());
      if (candidate !== previousToken) return candidate;
    }
    throw new Error('Lease token generator repeated the previous fencing token');
  }
}

/** Stable key for a dose deduction tied to one physical shot. */
export function pendingDoseIdempotencyKey(shotId: string, batchId: string): string {
  return `pending-dose:v1:${keyPart(shotId, 'shotId')}:${keyPart(batchId, 'batchId')}`;
}

/** Stable key for returning one deleted shot's dose to its physical bag. */
export function pendingDoseReclaimIdempotencyKey(shotId: string, batchId: string): string {
  // The prefix sorts after the legacy `pending-dose:v1` prefix when two
  // physical commands share an identical timestamp, preserving deduction
  // before inverse-reclaim order for the same shot.
  return `shot-dose-reclaim:v1:${keyPart(shotId, 'shotId')}:${keyPart(batchId, 'batchId')}`;
}

/** Physical dose identity; expectedRemaining/at are first-admission replay metadata. */
export function doseAdjustmentPhysicalIdentity(input: {
  beanId: string;
  batchId: string;
  dose: number;
}): string {
  return JSON.stringify([input.beanId, input.batchId, input.dose]);
}

/**
 * Stable migration key for entries written by the former localStorage queue,
 * which did not record a shot id. It deliberately includes every immutable
 * field so migration can be retried without creating a second command.
 */
export function legacyPendingDoseIdempotencyKey(entry: {
  batchId: string;
  beanId: string;
  dose: number;
  expectedRemaining: number;
  at: string;
}): string {
  requireNonEmpty(entry.batchId, 'batchId');
  requireNonEmpty(entry.beanId, 'beanId');
  requireFinite(entry.dose, 'dose');
  requireFinite(entry.expectedRemaining, 'expectedRemaining');
  requireNonEmpty(entry.at, 'at');
  const canonical = [
    entry.batchId,
    entry.beanId,
    String(entry.dose),
    String(entry.expectedRemaining),
    entry.at
  ].join('\u001f');
  return `pending-dose:legacy:v1:${encodeURIComponent(canonical)}`;
}

class IndexedDbMutationBackend implements MutationBackend {
  readonly durability = 'indexeddb' as const;
  private db: IDBDatabase | null = null;
  private openPromise: Promise<IDBDatabase | null> | null = null;

  constructor(
    private readonly factory: IDBFactory,
    private readonly databaseName: string
  ) {}

  async isAvailable(): Promise<boolean> {
    return (await this.openDb()) != null;
  }

  async readAll(): Promise<DurableMutationRecord[]> {
    const db = await this.requireDb();
    const transaction = db.transaction(MUTATION_OUTBOX_STORE_NAME, 'readonly');
    const done = transactionDone(transaction);
    try {
      const values = await requestResult<unknown[]>(
        transaction.objectStore(MUTATION_OUTBOX_STORE_NAME).getAll()
      );
      await done;
      return decodeStoredRecords(values, `IndexedDB/${this.databaseName}`).map(cloneValue);
    } catch (error) {
      await drainTransaction(done);
      throw error;
    }
  }

  async mutate<Result>(
    mutation: (records: Map<string, DurableMutationRecord>) => Result
  ): Promise<Result> {
    const db = await this.requireDb();
    const transaction = db.transaction(MUTATION_OUTBOX_STORE_NAME, 'readwrite');
    const done = transactionDone(transaction);
    try {
      const store = transaction.objectStore(MUTATION_OUTBOX_STORE_NAME);
      const values = await requestResult<unknown[]>(store.getAll());
      const records = new Map(
        decodeStoredRecords(values, `IndexedDB/${this.databaseName}`).map(
          (record): [string, DurableMutationRecord] => [record.idempotencyKey, cloneValue(record)]
        )
      );
      const originalKeys = new Set(records.keys());
      const result = mutation(records);

      const requests: Array<Promise<unknown>> = [];
      for (const key of originalKeys) {
        if (!records.has(key)) requests.push(requestResult(store.delete(key)));
      }
      for (const record of records.values()) {
        requests.push(requestResult(store.put(cloneValue(record))));
      }
      await Promise.all(requests);
      await done;
      return result;
    } catch (error) {
      await drainTransaction(done);
      throw error;
    }
  }

  close(): void {
    this.db?.close();
    this.db = null;
    this.openPromise = null;
  }

  private async requireDb(): Promise<IDBDatabase> {
    const db = await this.openDb();
    if (!db) throw new Error('IndexedDB mutation outbox is unavailable');
    return db;
  }

  private openDb(): Promise<IDBDatabase | null> {
    if (this.db) return Promise.resolve(this.db);
    if (this.openPromise) return this.openPromise;

    this.openPromise = new Promise((resolve) => {
      let settled = false;
      let request: IDBOpenDBRequest;
      try {
        request = this.factory.open(this.databaseName, MUTATION_OUTBOX_DB_VERSION);
      } catch {
        resolve(null);
        return;
      }

      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(MUTATION_OUTBOX_STORE_NAME)) {
          database.createObjectStore(MUTATION_OUTBOX_STORE_NAME, { keyPath: 'idempotencyKey' });
        }
      };
      request.onerror = () => {
        if (!settled) {
          settled = true;
          resolve(null);
        }
      };
      // Do not downgrade to another store while an upgrade is blocked. The
      // request completes once the older connection closes, preserving one
      // authoritative journal across tabs.
      request.onblocked = () => {};
      request.onsuccess = () => {
        const database = request.result;
        if (settled) {
          database.close();
          return;
        }
        settled = true;
        database.onversionchange = () => {
          database.close();
          if (this.db === database) this.db = null;
          this.openPromise = null;
        };
        database.onclose = () => {
          if (this.db === database) this.db = null;
          this.openPromise = null;
        };
        this.db = database;
        resolve(database);
      };
    });
    return this.openPromise;
  }
}

class LocalStorageMutationBackend implements MutationBackend {
  readonly durability = 'local-storage' as const;

  constructor(
    private readonly storage: MutationOutboxStorage,
    private readonly storageKey: string
  ) {}

  async isAvailable(): Promise<boolean> {
    try {
      this.storage.getItem(this.storageKey);
      return true;
    } catch {
      return false;
    }
  }

  async readAll(): Promise<DurableMutationRecord[]> {
    return [...this.readMap().values()].map(cloneValue);
  }

  async mutate<Result>(
    mutation: (records: Map<string, DurableMutationRecord>) => Result
  ): Promise<Result> {
    const records = this.readMap();
    const result = mutation(records);
    this.writeMap(records);
    return result;
  }

  close(): void {}

  clear(): void {
    this.storage.removeItem(this.storageKey);
  }

  private readMap(): Map<string, DurableMutationRecord> {
    const raw = this.storage.getItem(this.storageKey);
    if (!raw) return new Map();
    let values: unknown;
    try {
      values = JSON.parse(raw) as unknown;
    } catch {
      throw new MutationOutboxCorruptionError(`localStorage/${this.storageKey}`);
    }
    return new Map(
      decodeStoredRecords(values, `localStorage/${this.storageKey}`).map(
        (record): [string, DurableMutationRecord] => [record.idempotencyKey, record]
      )
    );
  }

  private writeMap(records: Map<string, DurableMutationRecord>): void {
    if (records.size === 0) {
      this.storage.removeItem(this.storageKey);
      return;
    }
    this.storage.setItem(this.storageKey, JSON.stringify([...records.values()]));
  }
}

class MemoryMutationBackend implements MutationBackend {
  readonly durability = 'memory' as const;
  private records = new Map<string, DurableMutationRecord>();

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async readAll(): Promise<DurableMutationRecord[]> {
    return [...this.records.values()].map(cloneValue);
  }

  async mutate<Result>(
    mutation: (records: Map<string, DurableMutationRecord>) => Result
  ): Promise<Result> {
    const working = new Map(
      [...this.records.entries()].map(([key, record]) => [key, cloneValue(record)])
    );
    const result = mutation(working);
    this.records = new Map(
      [...working.entries()].map(([key, record]) => [key, cloneValue(record)])
    );
    return result;
  }

  close(): void {
    this.records.clear();
  }
}

async function migrateFallbackRecords(
  fallback: LocalStorageMutationBackend,
  indexedDb: IndexedDbMutationBackend
): Promise<void> {
  const fallbackRecords = await fallback.readAll();
  if (fallbackRecords.length === 0) return;

  await indexedDb.mutate((records) => {
    for (const incoming of fallbackRecords) {
      const existing = records.get(incoming.idempotencyKey);
      if (!existing) {
        records.set(incoming.idempotencyKey, incoming);
        continue;
      }
      if (!samePhysicalCommand(existing, incoming)) {
        throw new IdempotencyConflictError(incoming.idempotencyKey);
      }
      records.set(incoming.idempotencyKey, preferredRecord(existing, incoming));
    }
  });

  // A failed remove is safe: the same idempotent records are merged again on
  // the next open. Never abandon the now-authoritative IndexedDB journal merely
  // because cleanup of the fallback copy was denied.
  try {
    fallback.clear();
  } catch {
    // Retain the duplicate fallback copy for the next idempotent migration.
  }
}

function preferredRecord(
  existing: DurableMutationRecord,
  incoming: DurableMutationRecord
): DurableMutationRecord {
  const progress = existing.state === 'acknowledged' && incoming.state !== 'acknowledged'
    ? existing
    : incoming.state === 'acknowledged' && existing.state !== 'acknowledged'
      ? incoming
      : incoming.updatedAt > existing.updatedAt ? incoming : existing;
  // Operational progress may come from either backend, but replay heuristics
  // belong to the earliest physical admission and must never be replaced by a
  // later duplicate merely because it has a newer updatedAt.
  const firstAdmission = existing.createdAt <= incoming.createdAt ? existing : incoming;
  const preferred = {
    ...progress,
    payload: firstAdmission.payload,
    createdAt: firstAdmission.createdAt
  };
  if (preferred.physicalIdentity != null) return preferred;
  const identity = physicalIdentity(existing) ?? physicalIdentity(incoming);
  return identity == null ? preferred : { ...preferred, physicalIdentity: identity };
}

function validateCommand(command: MutationCommand): void {
  requireNonEmpty(command.idempotencyKey, 'idempotencyKey');
  requireNonEmpty(command.kind, 'kind');
  requireNonEmpty(command.aggregateKey, 'aggregateKey');
  if (command.physicalIdentity !== undefined) {
    requireNonEmpty(command.physicalIdentity, 'physicalIdentity');
  }
  if (command.createdAt) requireValidDate(command.createdAt, 'createdAt');
  if (command.causalOrder !== undefined && command.causalOrder !== 'aggregate') {
    throw new Error('causalOrder must be aggregate');
  }
}

function samePhysicalCommand(
  record: DurableMutationRecord,
  command: Pick<MutationCommand, 'kind' | 'payload' | 'physicalIdentity'>
): boolean {
  if (record.kind !== command.kind) return false;
  const recordIdentity = physicalIdentity(record);
  const commandIdentity = command.physicalIdentity ?? inferredDoseIdentity(command.kind, command.payload);
  if (recordIdentity != null || commandIdentity != null) {
    return recordIdentity != null && commandIdentity != null && recordIdentity === commandIdentity;
  }
  return structurallyEqual(record.payload, command.payload);
}

function physicalIdentity(record: DurableMutationRecord): string | null {
  return record.physicalIdentity ?? inferredDoseIdentity(record.kind, record.payload);
}

function inferredDoseIdentity(kind: string, payload: unknown): string | null {
  if (kind !== 'pending-dose-deduction' && kind !== 'pending-dose-reclaim') return null;
  if (!payload || typeof payload !== 'object') return null;
  const candidate = payload as { beanId?: unknown; batchId?: unknown; dose?: unknown };
  if (
    typeof candidate.beanId !== 'string' ||
    typeof candidate.batchId !== 'string' ||
    typeof candidate.dose !== 'number' ||
    !Number.isFinite(candidate.dose)
  ) return null;
  return doseAdjustmentPhysicalIdentity({
    beanId: candidate.beanId,
    batchId: candidate.batchId,
    dose: candidate.dose
  });
}

function structurallyEqual(left: unknown, right: unknown): boolean {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function isDue(record: DurableMutationRecord, nowMs: number): boolean {
  if (record.state === 'pending') return true;
  if (record.state === 'retry-wait') {
    return record.nextAttemptAt != null && Date.parse(record.nextAttemptAt) <= nowMs;
  }
  if (record.state === 'in-flight') {
    return record.lease != null && Date.parse(record.lease.expiresAt) <= nowMs;
  }
  return false;
}

function aggregateHeads(records: Iterable<DurableMutationRecord>): DurableMutationRecord[] {
  const heads = new Map<string, DurableMutationRecord>();
  const unsettled = [...records]
    .filter((record) => record.state !== 'acknowledged')
    .sort(compareRecords);
  for (const record of unsettled) {
    if (!heads.has(record.aggregateKey)) heads.set(record.aggregateKey, record);
  }
  return [...heads.values()];
}

function hasActiveLease(
  record: DurableMutationRecord | undefined,
  leaseToken: string,
  nowMs: number
): record is DurableMutationRecord & { lease: MutationLease } {
  return (
    record?.state === 'in-flight' &&
    record.lease?.token === leaseToken &&
    Date.parse(record.lease.expiresAt) > nowMs
  );
}

function compareRecords(left: DurableMutationRecord, right: DurableMutationRecord): number {
  const created = left.createdAt.localeCompare(right.createdAt);
  return created === 0 ? left.idempotencyKey.localeCompare(right.idempotencyKey) : created;
}

function decodeStoredRecords(value: unknown, location: string): DurableMutationRecord[] {
  if (!Array.isArray(value)) throw new MutationOutboxCorruptionError(location);
  const records: DurableMutationRecord[] = [];
  const keys = new Set<string>();
  for (const candidate of value) {
    if (!isDurableMutationRecord(candidate) || keys.has(candidate.idempotencyKey)) {
      throw new MutationOutboxCorruptionError(location);
    }
    keys.add(candidate.idempotencyKey);
    records.push(candidate);
  }
  return records;
}

function isDurableMutationRecord(value: unknown): value is DurableMutationRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<DurableMutationRecord>;
  const shapeIsValid =
    typeof record.idempotencyKey === 'string' &&
    record.idempotencyKey.trim().length > 0 &&
    typeof record.kind === 'string' &&
    record.kind.trim().length > 0 &&
    typeof record.aggregateKey === 'string' &&
    record.aggregateKey.trim().length > 0 &&
    'payload' in record &&
    (record.physicalIdentity === undefined ||
      (typeof record.physicalIdentity === 'string' && record.physicalIdentity.length > 0)) &&
    isMutationState(record.state) &&
    isTimestamp(record.createdAt) &&
    isTimestamp(record.updatedAt) &&
    typeof record.attemptCount === 'number' &&
    Number.isInteger(record.attemptCount) &&
    record.attemptCount >= 0 &&
    (record.lastAttemptAt == null || isTimestamp(record.lastAttemptAt)) &&
    (record.nextAttemptAt == null || isTimestamp(record.nextAttemptAt)) &&
    isMutationFailure(record.lastError) &&
    isMutationLease(record.lease) &&
    isMutationReceipt(record.receipt);
  if (!shapeIsValid) return false;

  if (record.receipt?.idempotencyKey !== undefined) {
    if (record.receipt.idempotencyKey !== record.idempotencyKey) return false;
  }
  switch (record.state) {
    case 'pending':
      return record.lease == null && record.receipt == null;
    case 'in-flight':
      return record.lease != null && record.receipt == null && record.nextAttemptAt == null;
    case 'retry-wait':
      return record.lease == null && record.receipt == null && record.nextAttemptAt != null;
    case 'acknowledged':
      return record.lease == null && record.receipt != null && record.nextAttemptAt == null;
  }
  return false;
}

function isMutationState(value: unknown): value is MutationOutboxState {
  return (
    value === 'pending' ||
    value === 'in-flight' ||
    value === 'retry-wait' ||
    value === 'acknowledged'
  );
}

function isMutationFailure(value: unknown): value is MutationFailure | null {
  if (value == null) return true;
  if (typeof value !== 'object') return false;
  const failure = value as Partial<MutationFailure>;
  return typeof failure.message === 'string' && isTimestamp(failure.failedAt);
}

function isMutationLease(value: unknown): value is MutationLease | null {
  if (value == null) return true;
  if (typeof value !== 'object') return false;
  const lease = value as Partial<MutationLease>;
  return (
    typeof lease.token === 'string' &&
    lease.token.length > 0 &&
    typeof lease.ownerId === 'string' &&
    lease.ownerId.length > 0 &&
    isTimestamp(lease.expiresAt)
  );
}

function isMutationReceipt(value: unknown): value is MutationReceipt | null {
  if (value == null) return true;
  if (typeof value !== 'object') return false;
  const receipt = value as Partial<MutationReceipt>;
  return (
    typeof receipt.idempotencyKey === 'string' &&
    isReceiptOutcome(receipt.outcome) &&
    isTimestamp(receipt.committedAt) &&
    isTimestamp(receipt.acknowledgedAt) &&
    (receipt.remoteReceiptId == null || typeof receipt.remoteReceiptId === 'string') &&
    (receipt.remoteRevision == null || typeof receipt.remoteRevision === 'string')
  );
}

function isReceiptOutcome(value: unknown): value is MutationReceiptOutcome {
  return value === 'committed' || value === 'already-applied' || value === 'not-applicable';
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function requestResult<Result>(request: IDBRequest<Result>): Promise<Result> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
  });
}

async function drainTransaction(done: Promise<void>): Promise<void> {
  try {
    await done;
  } catch {
    // The request error remains the operation's primary failure. Observing the
    // transaction rejection here prevents a second unhandled rejection.
  }
}

function defaultIndexedDbFactory(): IDBFactory | null {
  try {
    return globalThis.indexedDB ?? null;
  } catch {
    return null;
  }
}

function defaultStorage(): MutationOutboxStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

let leaseSequence = 0;

function defaultLeaseToken(): string {
  const randomUuid = globalThis.crypto?.randomUUID;
  if (randomUuid) return randomUuid.call(globalThis.crypto);
  leaseSequence += 1;
  return `lease-${Date.now().toString(36)}-${leaseSequence.toString(36)}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

function keyPart(value: string, name: string): string {
  requireNonEmpty(value, name);
  return encodeURIComponent(value.trim());
}

function requireLeaseToken(value: string): string {
  requireNonEmpty(value, 'lease token');
  return value;
}

function requireNonEmpty(value: string, name: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

function requireFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
}

function requirePositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive finite number`);
  }
}

function requirePositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
}

function requireValidDate(value: Date, name: string): void {
  if (Number.isNaN(value.getTime())) throw new TypeError(`${name} must be a valid date`);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function cloneValue<Value>(value: Value): Value {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as Value;
}
