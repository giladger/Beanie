# Runtime ownership and consistency architecture

_Decision date: 2026-07-10 · Status: implemented, with gateway idempotency noted as an external contract_

This document defines Beanie's runtime architecture for long-lived browser
resources, high-rate telemetry, asynchronous workflow ownership, and durable
physical mutations. It complements
[render ownership](render-ownership-architecture.md): that document answers
“who may paint?”, while this one answers “who may stay alive, who owns an async
result, and which writes may be reordered or replayed?”

The motivating incident was Android WebView graphics growth, but the solution is
broader than one leak. The previous shape let lifecycle policy emerge from
dozens of independent timers, socket callbacks, request counters, image decode
paths, and DOM writers. A missed cleanup or a second writer could reintroduce
unbounded work. The new shape makes ownership executable and testable.

## Decision summary

Beanie adopts the following runtime rules:

1. Every long-lived browser resource has one disposable owner.
2. Semantic visibility, not DOM connectivity, decides whether presentation
   work is active.
3. Transport, observation, domain recording, presentation, and rendering are
   separate layers.
4. Periodic work is single-flight and self-scheduling; `setInterval` is not a
   workflow primitive.
5. Async UI results commit only through a scoped operation lease.
6. Writes sharing a physical resource go through one keyed command lane.
7. Physical deltas are journaled before the first network attempt and retained
   until an explicit receipt is recorded.
8. Dependency direction and runtime import acyclicity are checked in the test
   suite.

## Runtime map

```text
                     BeanieApp composition root
                               |
          +--------------------+---------------------+
          |                    |                     |
          v                    v                     v
  DisposableScope     PresentationActivity   WorkflowCommandCoordinator
          |                    |                     |
          |              suspend / resume      keyed serialized writes
          |                    |                     |
          v                    v                     v
 listeners/tasks       render islands/charts   gateway mutations
 sockets/leases                                      |
          |                                          v
          v                                  DurableMutationOutbox
 SocketSupervisor -> TelemetryStore           claim / retry / receipt
          |                |
          |                +-> lossless domain/shot consumers
          +------------------> bounded presentation projectors/channels
```

No box above is a global service locator. `BeanieApp` is the composition root:
it constructs owners, injects ports, and disposes them in a deliberate order.

## Lifecycle ownership

### `DisposableScope`

`src/runtime/disposableScope.ts` is the terminal owner for listeners, timers,
animation frames, subscriptions, child scopes, and arbitrary disposables.

Its guarantees are:

- disposal is idempotent;
- the abort signal is invalidated before cleanup begins;
- resources are released in reverse registration order;
- outer callbacks are removed before child scopes are torn down;
- one broken cleanup does not prevent later cleanups;
- callbacks check scope liveness before invoking application code.

Code that acquires a long-lived resource must either own it directly or return a
`Disposable` to the scope that owns its semantic lifetime. “The page will be
reloaded” is not a cleanup policy.

### Semantic presentation activity

The workbench remains mounted under the sleep overlay, so `isConnected` and
element existence are not evidence that work should continue.
`PresentationActivityCoordinator` derives one active/suspended state from:

- document visibility;
- machine sleep overlay visibility;
- screensaver preview occlusion.

On suspend it walks targets in reverse registration order: producers stop
before consumers release native resources. On resume it walks mount order:
consumers restore first, then background tasks perform one catch-up. Target
failures are isolated so a broken chart cannot strand every later owner active.

Current activity targets include the topbar, live readouts, Derek stream,
managed charts, shot refresh, bean refresh, and settings synchronization.

### Background tasks

`BackgroundTask` replaces workflow `setInterval` loops. It arms the next wake
only after the current promise settles, which makes overlap impossible. Manual
triggers collapse into one trailing run. Suspension cancels the wake; resume
performs exactly one catch-up.

This applies to refresh and synchronization. One-shot safety timers (for
example a steam stop deadline) remain explicit because they represent a domain
deadline rather than periodic polling.

## Telemetry and transport

### Supervised sockets

Each WebSocket is owned by a `SocketSupervisor`. The supervisor owns exactly:

- one socket generation;
- one retry timer;
- retry/backoff state;
- decode and lifecycle callbacks;
- stale-callback rejection after stop/reconnect;
- idempotent start, stop, and dispose.

The app no longer carries five parallel sets of socket, retry timer, attempt,
and callback fields. Browser construction and scheduling are injected adapters,
which makes the state machine deterministic in tests.

### Revisioned telemetry store

Validated frames enter `TelemetryStore`, not a renderer. Its five channels are
machine, scale, water, display, and shot state. Every accepted frame increments
both a global observation revision and a channel revision and records its own
observation time.

The store has two consumer classes:

- raw/channel consumers see every frame for shot recording and structural
  domain transitions;
- selector consumers receive only presentation changes.

Independent sockets never borrow ordering from one another. A machine revision
does not imply that a scale value is newer. Presentation throttling is strictly
downstream and cannot discard measurements needed for a saved shot.

### Hot-path rule

Socket callbacks may parse, validate, and ingest. They may not construct a
chart, mutate DOM, start a UI timer, or implement retry policy. That separation
is enforced partly by module boundaries and partly by the existing render
mutation guard.

## Native and graphics resources

### Charts

`LiveChart` owns its canvas bitmap, observers, listeners, media query, pointer
interaction, and animation frame. Suspension cancels work and shrinks the
backing store to 1×1 while retaining the latest model. Resume reattaches
sources, recomputes layout/DPR/theme, and schedules one draw.

The application publishes model invalidations. It no longer maintains a
second RAF loop that directly calls chart resize/draw. Resource identity and
render validity are separate: retaining a chart object does not make its old
layout or theme current.

### Images

`BoundedImageTranscoder` treats decoded bitmaps, object URLs, image elements,
canvas backing stores, and batch pixel budgets as explicit leases. Every path,
including decode failure and fallback, closes/revokes/releases in `finally`.
Scanner batches have bounded concurrency and total decoded pixels. Screensaver
imports use the same owner rather than opening an independent decode path.
Both entry points cap their input set, app disposal rejects queued/future image
work, and an already-acquired lease runs only far enough to execute its cleanup.

### Streaming text

Derek's token stream publishes plain text to an opaque island and commits with
`textContent` at a bounded rate. Markdown is rendered once at finalization. The
hot path no longer reparses and replaces a growing HTML string repeatedly.

## Async result authority

Cancellation and correctness are different concerns. A fetch may ignore an
abort signal or may already have reached the server. Therefore an aborted
continuation still needs a commit-time ownership check.

`OperationAuthority` gives one semantic workflow lane an unforgeable current
lease containing:

- a monotonic generation;
- a semantic subject key;
- an `AbortSignal` for cleanup;
- a synchronous atomic `commit()` gate;
- idempotent `finish()`.

Beginning a newer operation aborts the old signal, but the token comparison is
what prevents stale state mutation. Commit callbacks must be synchronous so
the ownership check and reducer transition cannot be separated by another
await. Recipe application and shot pagination now use this mechanism instead
of naked integer request IDs.

Telemetry revisions, socket generations, render session keys, and UI operation
leases remain distinct. Combining them into one global revision would create
false ordering between independent sources.

## Write coordination

`WorkflowCommandCoordinator` maintains one lane per resource key. It supports
two explicit policies:

- `exact-fifo`: every command executes in order. Use for physical actions,
  deltas, creates, deletes, and multi-step transactions.
- `latest-wins`: only a queued command with the same coalescing key may be
  replaced. Use for desired full-state configuration.

An exact command is a coalescing barrier. Given:

```text
set configuration A -> start physical action -> set configuration B
```

configuration B may not erase or move ahead of A, because the physical action
was submitted against A. In-flight work is never described as canceled;
disposal can remove only queued work.

Current resource keys include machine/workflow, display, the shared device
transport, setting-store keys, shot IDs, and batch IDs. Compound
prepare-workflow + machine-state
sequences are submitted as one command and call the raw gateway adapter inside
that ownership boundary, avoiding nested-lane deadlock.

Synced key/value writes use latest-wins per store key and compare completion
against the current desired value. An old request may truthfully complete, but
it cannot clear an error belonging to a newer desired value.

## Durable physical mutation outbox

A dose deduction is a physical delta: beans were consumed even if the gateway
was offline or its response was lost. It cannot be safely represented by a
best-effort promise or a mutable localStorage array.

`DurableMutationOutbox` is a command journal with these states:

```text
pending -> in-flight -> acknowledged
              |
              v
          retry-wait --(due)--> in-flight
```

Each record contains a stable idempotency key, mutation kind, aggregate key,
immutable payload, attempt metadata, fenced lease, last failure, and final
receipt. Acknowledged records remain as tombstones until an explicit age-bound
prune, preventing a duplicate enqueue from recreating completed physical work.

The dose reconciler follows this order:

1. Compute the immutable deduction from the completed shot.
2. Persist it before the first network attempt.
3. Claim only the dose kind, one aggregate head at a time.
4. Read current remote batch state.
5. If the expected remaining value is already present, acknowledge
   `already-applied`.
6. If the bag is deleted/untracked, acknowledge `not-applicable`.
7. Otherwise serialize the partial update on `batch:<id>`, forwarding the
   idempotency key, then acknowledge `committed`.
8. On failure, release into retry-wait with bounded exponential backoff.

Claims use lease tokens; an expired worker cannot acknowledge or reschedule a
record reclaimed by a newer worker. The worker renews its claim after acquiring
the aggregate command lane and again after the final read, so time spent queued
behind another batch command cannot authorize a stale write. Per-aggregate head
blocking prevents a later deduction from overtaking an earlier retry for the
same bag.

IndexedDB is authoritative when available. localStorage is a persistent
fallback and memory is the last-resort fallback; the selected durability is
observable. Fallback records are promoted to IndexedDB when it recovers.
Malformed authoritative journals fail closed instead of being overwritten.
The former pending-dose localStorage array is migrated idempotently and cleared
only after every record is durably enqueued. A transient IndexedDB initialization
failure is also accepted into a bounded process-local intake: it returns an
explicit `volatile` durability result so the projection still reserves that
dose in order, while the worker continues trying to promote the mutation into
the authoritative journal. No remote write is attempted before promotion.

If neither IndexedDB nor localStorage is usable, crash-safe persistence is
impossible. Beanie keeps and reconciles the command in the current process but
surfaces “device storage unavailable” instead of claiming durability. This is
an explicit degraded mode; the release tablet is required to provide IndexedDB.

### Exactly-once boundary

The client forwards `Idempotency-Key` on batch updates. True cross-device
exactly-once behavior requires Reaprime to store and replay a receipt for that
key. Until the server honors it, Beanie additionally re-reads the batch and
recognizes the expected remaining weight, covering the common “write landed,
response was lost” case. That heuristic cannot prove exactly-once if another
device changes the same bag between the lost response and replay. This is an
explicit external contract gap, not hidden client certainty.

## Dependency enforcement

`src/architecture/dependencyPolicy.ts` is executable architecture. The test
suite parses production TypeScript imports and enforces allowed layer
directions, rejects runtime cycles, and distinguishes type-only edges. Existing
inversions are admitted only as exact file-to-file debt entries with a reason
and migration. Removing an inversion makes its debt entry stale and fails the
test, so the exception must be deleted in the same change.

The largest remaining debt is flow hosts exposing `state(): AppState`. The
target is narrow query/command ports plus operation leases and atomic guarded
reducers. The migration order is scanner, Derek, profile editor, bean workflow,
then the remaining app-local async counters. New whole-state flow dependencies
are forbidden by policy rather than accepted as precedent.

## Shutdown order

Beanie shuts down outside-in:

1. mark the app disposed and remove the store push handler;
2. suspend presentation producers/consumers;
3. stop supervised sockets;
4. dispose scoped listeners, tasks, command queues, operation authorities, and
   durable workers;
5. drop telemetry subscribers;
6. dispose render islands and shrink chart/native resources;
7. cancel remaining one-shot domain safety timers.

Queued commands become disposed. An already-started physical command is allowed
to report its real result; stale UI leases prevent it from mutating a dead app.
Normal startup and hot-module replacement await both the command and durable
worker drains before constructing a replacement composition root, preventing
two app generations from owning the same physical resource concurrently.

## Acceptance criteria

Every change to these owners must keep the following gates green:

- focused deterministic tests for suspension, disposal, stale callbacks,
  retry, coalescing barriers, leases, and receipt fencing;
- full TypeScript and application test suite;
- executable dependency and render ownership guards;
- production build and manifest validation;
- production-bundle browser smoke test for failed startup, explicit demo and
  cached/offline provenance, Settings usability, and blocked offline writes;
- release WebView soak with `dumpsys meminfo`, requiring flat JavaScript and
  Graphics trends while idle/asleep and bounded recovery after active use.

The memory criterion is a trend, not a single sample. A stable retained cache is
acceptable; monotonically rising Graphics/native allocations while inputs and
presentation are unchanged are not.

## Rejected alternatives

- Adding more equality checks to individual socket callbacks: this leaves
  ownership and cleanup implicit and will regress when a new writer appears.
- Restarting Reaprime periodically: this masks retention and loses runtime
  state rather than bounding work.
- Treating AbortController as stale-result correctness: remote work may ignore
  or outrun cancellation.
- Coalescing every mutation: deltas and physical actions would be lost.
- Retrying every mutation FIFO without coalescing: rapid desired-state changes
  would build an unnecessary backlog.
- A framework rewrite: lifecycle, transport, idempotency, and physical command
  semantics remain necessary in any view framework.
