# Runtime ownership and consistency architecture

_Decision date: 2026-07-12 · Status: implemented, with gateway idempotency noted as an external contract_

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
7. Physical inventory deltas are journaled before their first inventory request
   and retained until an explicit receipt is recorded; foreground stock writes
   fail closed until every recovered adjustment is reserved and overlaid.
8. Presentation bootstrap and dose-journal hydration are independent: blocked
   durable storage cannot hide the shell, and a visible shell cannot imply
   inventory-write authority.
9. Dependency direction and runtime import acyclicity are checked in the test
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

### Settings-gated startup

`StartupFlow` is the single owner of boot and reconnect attempts. It admits at
most one load at a time, rejects settlement after disposal, and keeps the
synced-settings gate inside its `try`/`finally` so a rejected load cannot wedge
the flow. The shell releases a rejected gate promise, while `SettingsStoreSync`
releases a failed initial-load memo and continues polling unavailable storage.
The flow then acquires cached/gateway startup data through repository ports and
emits narrow projections plus one exhaustive effect plan to the shell.

Every attempt captures a transport-authority revision and rechecks it after
each await. Socket demotion increments that revision, stops refresh producers
and automatic write timers immediately, and prevents old HTTP/settings/cache
continuations from publishing. Disposal also revokes the runtime, startup, and
shot-cache generations before asynchronous drains begin.

The plans encode capability, not just a status label. Cached offline startup
starts transport streams and reconnect polling without refresh or maintenance
writes. Limited startup may refresh presentation, but selection cannot be
remembered, cannot apply a recipe, and cannot perform cache-migration writes.
Connected startup alone enables tracking-mode enforcement, machine-control
loads, heartbeats, storage migration, and normal background work. When the live
gateway replaces demo data, the app restores the pre-demo synced-cache snapshot
(or explicit defaults) before exposing cached continuity, then awaits a
non-demo settings recovery before selection and connected effects. Sample edits
therefore neither appear as user data offline nor authorize a real write.

The unscoped latest-shot cache page is projected into offline History only
after stable identity resolves each summary to the selected bean. History stays
bean-wide across bags; known batch ownership may recover legacy records without
bean ids, while known-foreign or unresolved records are omitted. Hydration is
cache-only and preserves full cached measurements when present. Because the
global page cannot prove a bean-specific remote total, startup exposes only the
number of matching cached rows and disables misleading pagination until a
repository-backed selection replaces it.

Dose-journal hydration is a separate startup track, not another
`StartupFlow` await. This matters because another browser context can block
IndexedDB indefinitely. The shell remains usable while
`DoseMutationReconciler.pendingAdjustments()` migrates the legacy queue and
discovers pending, in-flight, and retry-wait records. Before inventory writes
are enabled, the app synchronously reserves every discovered adjustment in the
foreground inventory facade and overlays its canonical remaining-weight scalar
on current batches. Only then does it mark the journal ready and start the
worker. If discovery fails, inventory create/update/split and selection
maintenance writes reject as read-only, while hydration retries independently;
presentation bootstrap and reconnect continue.

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
transport, setting-store keys, shot IDs, and per-bean inventory IDs. Compound
prepare-workflow + machine-state
sequences are submitted as one command and call the raw gateway adapter inside
that ownership boundary, avoiding nested-lane deadlock.

Synced key/value writes use latest-wins per store key and compare completion
against the current desired value. An old request may truthfully complete, but
it cannot clear an error belonging to a newer desired value.

Settings endpoint provenance is necessary but not sufficient write authority.
Every live settings resource is projected read-only outside the connected
startup phase, and each exact settings/device/account/plugin lane checks
connected authority again when queued work actually dispatches. Multi-request
plugin save/verification callbacks recheck between their raw GET and side
effect as well.

### Whole-map plugin settings

Reaprime returns and replaces an entire plugin settings map. Its current GET can
include manifest-secure values, while Beanie must treat those fields as
write-only UI inputs. `PluginConfigState` therefore stores only a sanitized
snapshot, the panel session, draft revision, touched fields, and explicitly
edited-secret flags. A user may temporarily type a new secret into the active
draft; previously stored/readable gateway secret values never enter AppState.

A save plan contains local changes only. Display defaults from a sparse legacy
map are not changes, and a blank secret does not clear a saved credential.
Inside the exact `plugin:<id>` command lane, the adapter performs a fresh raw
GET, rebases the local keys over every returned value, and POSTs the complete
replacement map. That raw snapshot—including readable secret values—remains
inside the lane callback and is never projected into `AppState`.

Settlement is fenced by editor session and revision: closing/reopening the panel
invalidates the old result, while edits made during an in-flight save remain
dirty and are rebased over accepted values for untouched fields. Verification
also reads the stored username/password transiently in the plugin lane and
passes them directly to the verifier; sanitized editor state is not credential
authority.

## Durable physical mutation outbox

A dose adjustment is a physical delta: beans were consumed by a completed shot,
or returned after remote deletion succeeded (or an owned reclaim journal made a
retry 404 replay-safe). The later inventory request may be offline or lose its
response. Neither direction can be safely represented by a best-effort promise
or a mutable localStorage array.

`DurableMutationOutbox` is a command journal with these states:

```text
pending -> in-flight -> acknowledged
              |
              v
          retry-wait --(due)--> in-flight
```

Each record contains a stable idempotency key, mutation kind, aggregate key,
first-admission replay payload, optional physical identity, attempt metadata,
fenced lease, last failure, and final receipt. Acknowledged records remain as
tombstones until an explicit age-bound prune, preventing a duplicate enqueue
from recreating completed physical work. The aggregate key is mutable routing
metadata rather than physical-command identity, so an idempotent re-enqueue may
canonicalize its route without changing the command.

Duplicate equivalence is deliberately narrower for dose work. Its physical
identity is `{beanId, batchId, dose}` under the mutation kind; `at` and
`expectedRemaining` are replay metadata captured by the first admission and do
not redefine the physical command. Re-enqueueing the same idempotency key and
physical identity returns that stored canonical payload even if a later caller
computed a different heuristic scalar. Commands without a physical identity
still require structural payload equality. During localStorage-to-IndexedDB
fallback promotion, operational progress may come from the newer or
acknowledged copy, but `createdAt` and the replay payload always come from the
earliest admission.

Deductions and reclaims use distinct stable keys derived from the shot identity
available at their own boundary plus the physical batch. For a live pull with
a locally resolved batch from the gateway-confirmed workflow and a positive
captured dose, reconciler acceptance starts before record polling and polling
does not wait for storage latency. Acceptance may land in the persistent
journal or its bounded volatile retry intake. A UI fallback waits for the
persisted gateway shot and an exact batch match. The accepted live command can
therefore carry an optimistic shot ID that differs from the later persisted ID,
so correctness never depends on key-prefix or wall-clock tie ordering. On
enqueue the outbox
atomically canonicalizes older dose routes and places each new record after the
maximum existing `createdAt` for that bean aggregate, even when the clock moved
backwards. An identical key must still match the mutation kind and physical
identity (or the entire payload for generic commands); otherwise it fails as an
idempotency conflict instead of being treated as a storage outage.

The dose reconciler follows this order:

1. Serialize admission behind legacy migration. Existing legacy records and
   volatile promotion form one admission epoch, so a new live command cannot
   splice ahead of older work for the bean.
2. Compute a deduction or reclaim and synchronously reserve that batch before
   journal admission yields. Persist it with atomic aggregate-causal ordering
   before the first inventory network attempt.
3. Require the caller's projection hand-off. A projection barrier prevents a
   fast worker from reaching the gateway before the caller commits or
   deliberately skips optimism.
4. Claim both dose-adjustment kinds through one worker, one aggregate head at a
   time.
5. Read current remote batch state.
6. If the expected remaining value is already present, acknowledge
   `already-applied`.
7. If the bag is deleted/untracked, acknowledge `not-applicable`.
8. Otherwise resolve the signed delta against that fresh scalar, serialize the
   partial update on the canonical
   `bean-inventory:<beanId>` lane, forwarding the idempotency key, then
   acknowledge `committed`.
9. On failure, release into retry-wait with bounded exponential backoff.

Admission and settlement are process-local projections over a shared durable
journal. If volatile promotion finds an older durable record for the same key,
the first admission's `expectedRemaining` wins; after the original projection
barrier, the reconciler emits a canonicalization event so the local optimistic
scalar is rebased before claim or settlement continues. If another browser
context owns the claim and records the receipt, this context later observes the
acknowledged tombstone, waits for its own projection barrier, and emits its
local settlement without issuing a second remote update.

Claims use lease tokens; an expired worker cannot acknowledge or reschedule a
record reclaimed by a newer worker. The worker renews its claim after acquiring
the aggregate command lane and again after the final read, so time spent queued
behind another inventory command cannot authorize a stale write. The per-bean
lane prevents concurrent execution, while the synchronous batch reservation
also prevents a later foreground weight edit or split from entering before a
journaled adjustment whose global worker is still busy on another bean. Reads
remain available: they overlay the latest owned pending scalar instead of
blocking on potentially unbounded offline retry. Records created by older
builds may still store `batch:<id>` as journal metadata. Both causal enqueue and
claim atomically rewrite those routing keys from the payload's `beanId`, so a
new per-bean record cannot bypass an older per-batch retry during migration.
Per-aggregate head blocking prevents either direction from overtaking an
earlier retry, including when deduction and reclaim used different shot IDs.

For a reclaim, the journal's `expectedRemaining` is an acknowledgement
heuristic, not an absolute write. If a fresh read already matches it, or the bag
is already at its non-reducing cap, the worker records `already-applied`;
otherwise it recomputes capped `current + dose` and writes only that scalar.
This preserves intervening changes serialized through the local lane while
keeping replay idempotent in the common lost-response case.

Remote acknowledgement does not publish a whole batch object back into UI
state. `BeanInventoryController` merges only the resolved remaining-weight
scalar and compares the process-local field-intent revision captured when the
adjustment projection was admitted. A foreground A→B→A edit therefore fences
the older response even though the final numbers happen to match; durable
records from an earlier app generation may publish only if this generation has
not expressed a newer weight intent.

Batch-list reads also enter the canonical per-bean command lane. Each read token
captures the latest-read revision, projection revision, mutation revision, and
the set of UI-owned fields that existed when the read began. Stale reads cannot
publish cache or AppState. A fresh GET that won the lane before a queued edit
may update that edit's remotely confirmed rollback baseline; a read that began
after or overlapped the owner cannot steal the baseline merely because it
settled later.

The returned gateway list is then protected before publication. A locally
owned or physically reserved batch omitted by the response is added back;
UI-owned fields come from local state; and the latest unsettled physical scalar
is overlaid unless a newer foreground weight owner wins. Cache publications
are serialized per bean. Before persistence, every UI-owned field is replaced
with its last remotely confirmed value. If any such field has no confirmed
baseline, the cache write is omitted altogether. The useful in-process
projection may therefore contain optimism, but a crash cannot convert that
optimism into offline truth. Bean selection separately tracks selection mode
(`null` means automatic) and effective bag provenance; if a
finish/create/removal changes the effective bag while shots are loading,
selection restarts so batches, shots, and recipe draft describe one bag.

IndexedDB is authoritative when available. localStorage is a persistent
fallback and memory is the last-resort fallback; the selected durability is
observable. Fallback records are promoted to IndexedDB when it recovers.
If an enqueue enters the bounded volatile intake during a transient persistent
store failure, newer commands for that same bean remain in the volatile FIFO
until every predecessor is promoted; recovery cannot append an older physical
command after a newer durable one.
Malformed authoritative journals fail closed instead of being overwritten.
The former pending-dose localStorage array is migrated idempotently and cleared
only after every record is durably enqueued. That migration gates discovery,
live durable admission, and volatile promotion through the same serialized
admission tail. If migration storage is temporarily unavailable, a live command
may enter the bounded process-local intake, but it cannot be promoted ahead of
legacy work. A transient IndexedDB initialization failure likewise returns an
explicit `volatile` durability result so the projection still reserves that
adjustment in order, while the worker continues trying to promote it into the
authoritative journal. No remote write is attempted directly from the volatile
buffer before that promotion.

If neither IndexedDB nor localStorage is usable, crash-safe persistence is
impossible. Beanie keeps and reconciles the command in the current process but
surfaces “device storage unavailable” instead of claiming durability. This is
an explicit degraded mode; the release tablet is required to provide IndexedDB.

### Exactly-once boundary

The client forwards `Idempotency-Key` on batch creates and updates. True
cross-device exactly-once behavior requires Reaprime to store and replay a
receipt for that key. Until the server honors it, Beanie additionally re-reads
inventory after an apparently failed write. Updates recognize the expected
remaining weight. Creates first capture an authoritative ID baseline, but a
failed POST is never promoted from a matching candidate alone: it produces an
explicit “review stock” outcome, retains the operation's idempotency key, and a
split transaction does not advance. An identical retry reuses that key, so a
server replay receipt can resolve the operation without creating a new command.
A partial freeze claims the source bag's remaining-weight intent before it
queues. Once its per-bean lane begins, it reads the authoritative source and
rebuilds the split amounts before the first POST; a failed or insufficient
preflight aborts without creating a portion. This lets an older dose command run
first without losing grams, while the intent revision prevents its later UI
settlement—or a newer foreground edit—from overwriting the split projection.
The read heuristics still cannot prove exactly-once if another device changes
the same inventory between the lost response and reconciliation. This is an
explicit external contract gap, not hidden client certainty.

### Delete / reclaim boundary

Shot deletion is a two-resource workflow. A reclaiming remote deletion uses one
transaction in the same outbox as dose work:

```text
persist pending-shot-delete-reclaim on bean aggregate
  -> acquire exact shot:<id> lane
  -> claim known transaction by id
  -> DELETE shot
  -> atomically acknowledge source + release pending-dose-reclaim child
  -> invalidate shot cache
```

The source key is shot-only
(`shot-delete-reclaim:v1:<shotId>`), so retrying the same shot with changed
bean, batch, or dose identity is an idempotency conflict. Its payload keeps the
first admission's `expectedRemaining` heuristic and occupies the
`bean-inventory:<beanId>` causal position before DELETE. The exact by-id claim
deliberately ignores aggregate-head eligibility: DELETE is physically
serialized by the shot lane while the source record reserves the future
inventory slot. The claim happens only after acquiring that lane, immediately
before HTTP dispatch, so it cannot expire while waiting behind another delete.

The handoff is one backend mutation. It verifies the active source lease,
records the DELETE outcome, and creates or deduplicates the normal reclaim
child on the same aggregate. A new child inherits the source's `createdAt`
slot; an existing physically identical child keeps its first-admission payload
and operational progress. A conflicting child aborts the entire mutation, so
the source is not falsely acknowledged. The standard dose worker still claims
only deduction/reclaim kinds and therefore cannot execute later same-bean work
while the delete source occupies the aggregate head.

This closes the local hard-crash gap:

- before durable prepare, no DELETE is authorized;
- after prepare but before or during DELETE, restart discovery retains the
  source and retries it;
- after a successful DELETE or lost response but before handoff, the lease
  eventually expires and the owned retry receives 404, which authorizes the
  atomic handoff;
- after handoff, the existing dose worker owns the inverse delta and its normal
  retry/tombstone rules apply.

Persistent evidence is mandatory. IndexedDB is preferred and localStorage is
accepted only under its documented single-context limitation; memory and
volatile intake fail before DELETE. Missing/untracked bag weight also fails
before DELETE because the flow cannot create a replay heuristic safely.
Startup reserves every unsettled delete transaction so foreground stock writes
cannot overtake it, but does **not** overlay `expectedRemaining` until the
reclaim child exists. One `pendingWork()` snapshot classifies sources and
children together; the shell seeds those sources into deletion recovery before
it starts, closing the cross-context race where a handoff could otherwise occur
between two discovery reads. The source reservation is transferred
synchronously to the child before source waiters are released.

The first durable shot intent wins. If DELETE is queued and the visible shot is
submitted again without reclaim, the flow resumes/queues the existing source
instead of issuing a bare DELETE. It cannot safely cancel after a lost response
because the shot may already be absent while the inverse delta is still owed.
A physically conflicting reclaim child is a deterministic invariant failure,
not a network retry: the source is acknowledged `not-applicable`, the shot
deletion remains truthful, and the bean is flagged for manual inventory review
so one corrupt command cannot block the aggregate forever.

An owned 404 is local evidence that this client intended the combined
operation, not a gateway receipt proving which device deleted the shot. A
no-reclaim/bare 404 never invents an inventory delta, and gateway-side DELETE
idempotency receipts are still required for true cross-device exactly-once
execution when multiple devices race.

Cache invalidation is deliberately after the atomic physical handoff and is not
part of that transaction. A crash in this final auxiliary interval cannot lose
or duplicate inventory work, but cached/offline History may remain stale until
the next connected shot refresh. A future durable cleanup marker can close that
presentation-only gap.

## Dependency enforcement

`src/architecture/dependencyPolicy.ts` is executable architecture. The test
suite parses production TypeScript imports and enforces allowed layer
directions, rejects runtime cycles, and distinguishes type-only edges. Existing
inversions are admitted only as exact file-to-file debt entries with a reason
and migration. Removing an inversion makes its debt entry stale and fails the
test, so the exception must be deleted in the same change.

Scanner, Derek, and profile-editor flows now expose controller-owned narrow
state/patch contracts instead of `state(): AppState`. Recipe, machine-action,
cleaning, active-service, and settings-store concurrency likewise publish
explicit requests, outcomes, snapshots, or events. The AST-level
`commandArchitectureGuard.test.ts` prevents controllers from importing
`app.ts`/`AppState`, confines physical gateway mutations to the one machine
transport adapter, prevents a second low-level command scheduler, and requires
raw batch writes and selection reads to use the inventory owner/canonical lane.
It also requires shot DELETE to use `shot:<id>` and prevents feature code from
importing inventory contract/policy internals around the facade. Remaining
inversions stay visible as exact debt entries rather than becoming precedent.

Narrow state contracts did not finish dependency injection in three flows.
`scannerFlow.ts` still imports the gateway/cache singletons and reads
`location`/`document`; `derekFlow.ts` still imports the gateway/cache
singletons; and `profileEditorFlow.ts` imports those singletons and accepts an
`HTMLElement`. These are the exact transitional singleton/DOM exceptions. New
controller code must not extend the list; migrate them to injected ports and
shell-owned browser adapters.

Two public capability contracts also remain fail-open debt. Settings model keys
are plain strings and `persistSetting()` relies on group-selected casts rather
than group-indexed key types. Separately, several cache, startup/bean
repository, settings-store, and settings-sync authority callbacks are optional
or default to `() => true`. Current app wiring passes live fences, so this is an
API-hardening gap rather than a known production bypass; future signatures
should require explicit capability and fail closed when it is absent.

## Shutdown order

Beanie shuts down outside-in:

1. mark the app disposed, revoke startup/runtime/shot-cache generations, and
   remove the store push handler;
2. suspend presentation producers/consumers;
3. stop supervised sockets;
4. stop new deletion/dose admissions;
5. drain admitted DELETE/handoff work, then dose admissions and the shared
   reconciler/outbox;
6. release only the remaining local inventory waiters and immediately dispose
   the gateway command coordinator, so retained restart work cannot be
   overtaken during teardown;
7. after command continuations run, drain the serialized inventory-cache tail;
8. drop telemetry subscribers;
9. dispose render islands and shrink chart/native resources;
10. cancel remaining one-shot domain safety timers.

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
