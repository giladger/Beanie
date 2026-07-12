# Beanie Architecture Guide

This document describes the current Beanie architecture and the rules for adding
new code. It is meant for humans and coding agents working in the repository.

Beanie is a static Decent.app WebUI skin. It does not use a frontend framework:
the app renders HTML strings, delegates browser events from a root element, and
talks directly to the Decent.app/Reaprime gateway over REST and WebSocket.

The central rule after the architecture cleanup is:

> `BeanieApp` is the shell. Workflow policy belongs outside the shell.

The shell wires together lifecycle, event dispatch, sockets, rendering, form
parsing, and state application. Controllers, repositories, domain modules, and
views own the behavior beneath that shell.

## Runtime Shape

The browser starts at `src/main.ts`, which constructs `BeanieApp` from
`src/app.ts`.

At runtime the app loop is:

1. `BeanieApp.start()` renders the initial shell and installs delegated
   listeners, then starts presentation bootstrap and inventory-journal
   hydration as independent tracks.
2. `StartupFlow` gates presentation content on synced settings, loads gateway/cache data
   through startup repositories, and publishes an explicit connectivity plan.
3. `DoseMutationReconciler.pendingAdjustments()` migrates legacy dose work,
   discovers every unsettled durable adjustment, and gives the shell the
   reservations that must be restored before stock writes become writable.
4. `BeanieApp` keeps one `AppState` object and re-renders after `setState()`.
5. User actions are dispatched through `data-action` attributes.
6. App methods parse DOM/form values and delegate policy to controllers/domain
   helpers.
7. Controllers return explicit outcomes.
8. `BeanieApp` applies those outcomes to state, DOM, timers, sockets, or local
   UI flow.

Startup has two separate fallback concepts. Cached resources came from the
user's gateway and retain cached/offline provenance while the app retries the
live source. `src/mock/` is explicit demo/sample data; entering demo mode must
be visible and demo mutations must remain simulated. Do not relabel a cached
gateway snapshot as demo or make demo defaults appear to be the user's data.
The synced-settings gate completes before startup content is acquired. Demo
uses an isolated process-cache generation: on exit the app restores the exact
pre-demo synced cache (or explicit defaults) immediately, then awaits a real
settings reload before selection or connected effects continue. If the gateway
is still unavailable, the restored values remain visible but read-only rather
than presenting sample edits as user data.
The flow's effect modes are deliberately exhaustive: offline cache starts
transport streams and the retry task but no refresh or maintenance writes;
limited data may refresh presentation but cannot remember selection, apply a
recipe, or write machine/cache migrations; only a fully connected startup
enables the normal tracking, machine-control, heartbeat, and migration effects.

Inventory-journal hydration is deliberately outside the `StartupFlow` gate.
IndexedDB can be blocked by another tab, so browsing and presentation startup
must not wait on it. In parallel, the shell asks the dose reconciler to migrate
legacy records and list every pending, in-flight, or retry-wait adjustment. It
synchronously reserves each result in `BeanInventoryController`, overlays the
first-admission remaining-weight scalar on the current batch projection, and
only then enables foreground inventory writes and starts replay. A hydration
failure leaves startup usable but stock mutations fail closed with a read-only
status; the shell retries hydration rather than silently allowing an
unreserved write.

One startup continuity gap remains: the cached latest-shot page informs bean
usage and initial-bean choice, but cached-only projection does not yet hydrate
`AppState.shots`. History can therefore remain empty until a live or
repository-backed bean selection succeeds.

The live shot path is intentionally more direct for performance:

- WebSocket frames are ingested by the app shell.
- Pure telemetry helpers merge partial machine/scale frames.
- `LiveShot` tracks the active shot model.
- The first active espresso frame snapshots the gateway-confirmed workflow
  shadow. Coffee, batch, profile, and optimistic presentation for that pull do
  not follow a later mutable UI selection.
- While brewing, Beanie patches stable DOM readouts and redraws the canvas
  instead of re-rendering the whole app.
- After the pour, `LiveShotCompletionFlow` admits a persisted candidate only
  when its explicit bean/batch identity does not conflict with that snapshot.
  When both a locally resolved gateway-confirmed batch and a positive captured
  dose are present, dose acceptance starts immediately without blocking record
  polling. The reconciler uses its persistent journal when available and a
  bounded volatile retry intake during a storage outage. A fallback UI
  attribution waits for an exact persisted batch match. An explicit mismatch is
  shown to the user and never mutates the foreign shot, its bag, or the visible
  coffee's history. If a confirmed expected-bag dose had already been accepted,
  that bag is marked for inventory review rather than attempting a second
  corrective mutation.

Adding inventory is deliberately separate from selecting a machine recipe.
The label scanner saves the bean and bag, closes with a “select it to brew”
status, and leaves the active coffee untouched. Selecting that coffee through
the normal picker is the action that stages/applies its workflow. A recipe
deferred while the DE1 sleeps resumes on either Beanie's Wake action or an
observed physical/remote wake transition. If that wake enters espresso
directly, application waits for the first safe post-shot idle frame.

### Mutation And Machine Command Topology

All queued gateway mutations share one scheduler. Feature controllers submit
through narrow ports; they do not create coordinators or call physical machine
transports directly.

```text
BeanieApp (composition and UI projection)
  -> feature controllers
       -> MachineWorkflowCommands (physical machine mutations)
            -> GatewayMutationCoordinator
       -> GatewayMutationCoordinator (other keyed gateway mutations)
            -> WorkflowCommandCoordinator (one concrete instance)
                 -> injected gateway transports
```

[`GatewayMutationCoordinator`](../src/runtime/gatewayMutationCoordinator.ts)
is the application-facing owner of the low-level scheduler. It exposes exact
FIFO barriers and keyed latest-wins submissions without exposing the underlying
policy API. [`MachineWorkflowCommands`](../src/controllers/machineWorkflowCommands.ts)
is the only typed authority for physical workflow, calibration, machine-setting,
refill, and state mutations. Compound commands receive an owned machine lane so
their steps stay contiguous without submitting nested work to the same queue.

Bean stock has a parallel aggregate rule: every batch read, edit, storage
migration, split-freeze transaction, and delayed dose deduction/reclaim for a
coffee uses `beanInventoryMutationKey(beanId)`. A split freeze owns one per-bean
lane across create, freezer-state repair, source-bag update, and authoritative
reconciliation. A newly journaled dose reserves its batch synchronously at
admission; records recovered during startup are all reserved and overlaid
before the write capability opens. Later remaining-weight edits/splits wait
outside the gateway lane until every earlier physical delta for that batch
settles. This closes both the worker-latency interval before a live dose worker
submits its lane command and the restart interval before old journal work is
known. Do not introduce `batch:<id>` lanes: two bags from one coffee can affect
the same selection and recipe projection.

## Directory Responsibilities

### `src/architecture/`

Executable dependency-direction policy. `dependencyPolicy.ts` defines the
allowed layer graph and names each temporary file-to-file exception with a
reason and migration. Add a narrow debt entry only for a deliberate transition;
remove it in the same change that removes the dependency.

### `src/runtime/`

Shared lifecycle, authority, and mutation-scheduling primitives.

- `workflowCommandCoordinator.ts`: low-level exact-FIFO/latest-wins scheduling
  policy. Feature code must not instantiate it.
- `gatewayMutationCoordinator.ts`: the single application-facing scheduler
  owner and the narrow mutation port injected into controllers.
- `operationAuthority.ts`: cancellation/staleness authority for multi-step
  operations.
- `backgroundTask.ts`, `disposableScope.ts`, and `presentationActivity.ts`:
  bounded asynchronous work, disposal, and presentation lifecycle helpers.

Runtime modules define cross-feature mechanics, not product workflow policy.
Feature-specific orchestration belongs in `src/controllers/`.

### `src/api/`

Gateway boundary code.

- `types.ts`: shared TypeScript shapes for gateway resources and app data.
- `gateway.ts`: REST/WebSocket client functions and gateway errors.
- `guards.ts`: lenient readers/guards for gateway payloads.
- `settings.ts`: settings API types, readers, and settings patch helpers.

Put code here when it describes wire/API shape, request mechanics, or payload
normalization. Do not put UI state or screen workflow policy here.

### `src/data/`

Repository and cache-backed loading code.

- `startupRepository.ts`: initial gateway/cache startup snapshot.
- `shotRepository.ts`: shot pages, full shot loading, latest candidate loading.
- `beanRepository.ts`: bean batch loading and cache-through behavior.

Put code here when it orchestrates gateway reads with cache fallback/writeback.
Repositories should return plain data/results, not HTML and not app state.

### `src/domain/`

Pure business rules, local preferences, and small domain models.

Examples:

- `beanWorkflow.ts`: recipe draft math and workflow patch construction.
- `waterSettings.ts`: machine water/steam/flush values, presets, clamping.
- `machineService.ts`: machine service progress and presentation helpers.
- `cleaning.ts`: cleaning counters/profile resolution/local storage.
- `liveShot.ts`: live shot state machine and graph model inputs.
- `resourceState.ts`: shared source/writability metadata for independently
  loaded resources.
- `settingsModel.ts`: declarative settings UI model.
- `settingsBundleMutation.ts`: targeted settings-bundle operations and their
  pure reducer.
- `pluginSettings.ts`: UI-secret sanitation, touched-field save plans,
  lane-time whole-map payload rebasing, and revision/session-fenced save
  settlement.
- `doseReclaim.ts`: the shared non-reducing `+grams`/bag-cap rule used by shot
  confirmation previews, immediate demo inventory, and durable replay.
- `shotRecord.ts`: service-shot filtering.

Prefer domain modules for deterministic calculations and reusable policy that
does not need gateway calls. A domain function may read/write local storage only
when the module is explicitly about skin-local preferences.

### `src/controllers/`

Stateful workflow policy and async orchestration, behind injected dependencies.

Controllers should:

- accept current data/state as input
- accept gateway/cache/local-storage dependencies as function arguments or
  constructor dependencies
- return explicit result objects
- avoid DOM reads/writes
- avoid rendering HTML
- avoid importing singleton gateway/cache objects

Three extracted flows still carry exact transitional boundary debt. This list
is an inventory of existing exceptions, not precedent for new code:

- `scannerFlow.ts` imports the gateway/cache singletons and reads
  `location`/`document` for handoff and scanner-form behavior;
- `derekFlow.ts` imports the gateway/cache singletons for profile persistence;
- `profileEditorFlow.ts` imports the gateway/cache singletons and accepts an
  `HTMLElement`, so it still owns profile-editor DOM interaction.

The migration is to inject narrow transport/cache ports and move browser reads
behind shell-owned adapters. Do not add another singleton or DOM dependency to
these or any other controller while that extraction remains unfinished.

Current controller map:

| Controller | Owns |
| --- | --- |
| [`beanInventoryController.ts`](../src/controllers/beanInventoryController.ts) | Foreground/UI stock facade and imperative sequencer: per-bean command-lane ownership, field-intent revisions, physical-adjustment reservations/overlays, latest-read and selection revisions, create/update/split execution, and the single serialized inventory-cache publication lane. Existing foreground consumers import the facade rather than its implementation modules. |
| [`beanInventoryContract.ts`](../src/controllers/beanInventoryContract.ts) | Public inventory ports, snapshots, requests, projections, and discriminated outcomes. It has type-only dependencies and no runtime behavior. |
| [`beanInventoryPolicy.ts`](../src/controllers/beanInventoryPolicy.ts) | Deterministic inventory projection, rollback, reconciliation, split planning, status, and idempotency-key policy. It does not import the controller facade. |
| `beanWorkflowController.ts` | Bean selection plus bean/grinder mutation policy and cache decisions. Batch mutation authority lives in `BeanInventoryController`. |
| [`cleaningExecutionFlow.ts`](../src/controllers/cleaningExecutionFlow.ts) | Cleaning workflow staging and the one exact machine-lane command that loads and optionally starts it, with explicit completion/authority/cancellation outcomes. |
| `cleaningWorkflowController.ts` | Cleaning start blockers, cleaning workflow creation/load result, finish/count/profile-pick plans. |
| `cleaningWizardController.ts` | Cleaning wizard step transitions and action completion. |
| `derekController.ts` / `derekFlow.ts` | Derek question state, streaming lifecycle, suggestions, and saved-answer restoration. |
| `doseMutationReconciler.ts` | Durable ordered dose adjustments: startup discovery and legacy-migration gating, first-admission replay metadata, shot deductions and deletion reclaims through one aggregate-head worker, volatile-promotion canonicalization, projection hand-off barriers, cross-context tombstone settlement, scalar-only typed outcomes, and the per-bean inventory lane. |
| [`liveShotCompletionFlow.ts`](../src/controllers/liveShotCompletionFlow.ts) | Shot-end routing, remote polling, optimistic fallback, freshness/Derek-context persistence, dose dispatch, and stale/disposal fencing. |
| `liveShotController.ts` | Pure shot-completion matching, polling primitives, fallback, and routing decisions used by `LiveShotCompletionFlow`. |
| [`machineActionFlow.ts`](../src/controllers/machineActionFlow.ts) | Physical start/stop admission, repeated dispatch-time safety, and contiguous workflow/calibration/state commands. |
| `machineExecutionController.ts` | Machine command preflight, hot-water weight stop orchestration, steam workflow padding/restore, command gateway sequencing. |
| `machineServiceController.ts` | Machine service progress/timer/stop-request state transitions. |
| [`machineServiceFlow.ts`](../src/controllers/machineServiceFlow.ts) | Ongoing service lifecycle after start: progress, timed/manual stop, duration extension, restoration, stop feedback, timers, events, and disposal. |
| `machineSettingsWorkflowController.ts` | Steam/water/flush workflow persistence, preset/value planning, steam purge readback, settings patch planning. |
| [`machineWorkflowCommands.ts`](../src/controllers/machineWorkflowCommands.ts) | Typed physical-mutation authority, desired/confirmed workflow tracking, live-authority checks, and non-nestable owned lanes. |
| `profileEditorController.ts` | Profile save persistence, favorite profile policy, profile picker/editor input decisions. |
| `profileEditorFlow.ts` | Profile editor session ownership and UI-facing orchestration. |
| [`recipeApplyController.ts`](../src/controllers/recipeApplyController.ts) | Recipe staging, semantic operation authority, debounce/wake deferral, and latest-wins workflow/calibration persistence. |
| `scannerFlow.ts` | Scanner onboarding, image conversion, Gemini request lifecycle, review, and save orchestration. |
| `settingsController.ts` | Reaprime settings/account/device/plugin operations. |
| [`settingsMutationFlow.ts`](../src/controllers/settingsMutationFlow.ts) | Per-resource optimistic settings identity, monotonic confirmed baselines, targeted reconcile/rollback, and stale/superseded/disposed outcomes. |
| [`settingsStoreSync.ts`](../src/controllers/settingsStoreSync.ts) | Synced-store load/poll/reload fencing, synchronous write admission, per-key latest-wins writes, retry/discard, snapshots, and disposal. |
| [`shotDeletionFlow.ts`](../src/controllers/shotDeletionFlow.ts) | Cross-resource shot deletion: remote/404 handling, replay-safe durable reclaim admission or owned-journal resume, optimistic inventory/provenance fencing, latest-state projections, and graceful drain ownership. |
| `shotMetadataController.ts` | Shot score/edit persistence plus deletion primitives: preview-vs-intent separation, remote/cache/reclaim sequencing, partial-success status, and pure latest-state list projection. |
| [`startupFlow.ts`](../src/controllers/startupFlow.ts) | Settings-gated boot/reconnect acquisition, cache/demo fallback policy, transport-revision and single-flight/disposal fencing, startup projections, and the exhaustive offline/limited/connected effect matrix. |

If a new flow has more than one async step, optimistic state, demo/remote split,
cache invalidation, rollback, or user-facing status policy, it probably belongs
in a controller.

Controllers own their public state contracts. Define a feature-specific
readable snapshot interface containing only the fields the controller needs,
plus precise patch, event, request, and outcome types. The shell can satisfy
these structurally, but a controller must not import `BeanieApp`, `AppState`, or
an app-wide state mutation surface. [`scannerFlowContract.ts`](../src/controllers/scannerFlowContract.ts)
is an example of a narrow controller-owned boundary.

For a large safety-sensitive controller, separate the boundary, deterministic
policy, and imperative sequencing without exposing multiple entry points. Bean
inventory is the reference shape:

```text
existing consumers
        |
        v
beanInventoryController (stable facade and side-effect sequencing)
        |                    |
        | runtime            | type-only
        v                    v
beanInventoryPolicy     beanInventoryContract
```

The facade is the only public owner of **foreground/UI** stock mutations; it is
not the only code path that can eventually change a remote batch. The adjacent
authority paths are deliberately narrow and documented:

- `DoseMutationReconciler` applies a durable physical scalar through its
  injected exact per-bean lane adapter;
- repository/storage maintenance and legacy repair may perform raw writes only
  through capability-gated composition adapters and the canonical lane;
- `ShotDeletionFlow` owns reclaim admission and projection coordination, but
  delegates the actual inventory delta to the reconciler.

Those adapters are part of the inventory boundary, not alternate foreground
facades. This split lets a coding agent inspect or change result contracts,
pure reconciliation policy, or network sequencing independently, while the
one-way dependency graph keeps authority from fragmenting. Safety-sensitive
helpers such as stable intent serialization and optimistic rollback belong in
policy and must be changed with focused policy/controller regressions, not
copied into a new caller.

### `src/views/`

Pure screen/modal renderers.

Views accept view models and return HTML strings. They may call HTML escaping,
icons, small formatting helpers, and pure view helpers. They should not:

- read or mutate `AppState`
- call the gateway
- call repositories/controllers
- read from the DOM
- read/write local storage

Examples:

- `workbenchView.ts`
- `machineView.ts`
- `historyView.ts`
- `beanPickerView.ts`
- `profilePickerView.ts`
- `shotEditorView.ts`
- `formsView.ts`
- `alertsView.ts`

### `src/components/`

Reusable UI rendering, input models, chart models, and browser-facing widgets.

Examples:

- `InputDialog.ts`: reusable numeric/text dialog model/render helpers.
- `LiveChart.ts`: canvas drawing class.
- `profileEditor.ts`: profile editor state and render logic.
- `shotGraphModel.ts`, `profileChartModel.ts`, `liveChartModel.ts`: chart data
  shaping.
- `html.ts`: escaping helpers.
- `icons.ts`: icon rendering.

Components can be richer than views, but the same rule applies: keep gateway and
app shell state out unless there is a very deliberate browser-widget reason.

### `src/app.ts`

The shell coordinator.

`BeanieApp` owns:

- lifecycle/dispose and the narrow adapters that apply `StartupFlow` projections
  and connectivity effects
- one `AppState` object
- delegated event listeners
- routing between app views/modals
- form parsing and DOM reads
- WebSocket ownership
- timers and animation frames
- canvas/DOM live-shot patching
- calling controllers and applying controller outcomes
- deciding when to re-render

`BeanieApp` should not grow new workflow policy. It is allowed to contain glue:
parse a field, call a controller, write a local preference through a domain
helper, set state, and render.

This is a direction, not a claim that the extraction is finished. `src/app.ts`
is still more than 10,000 lines, so it is not yet a comfortably manageable
composition shell for AI-agent maintenance. The next two high-value vertical
extractions are:

1. `BeanSelectionFlow`: selection mode/provenance, batch and shot acquisition,
   effective-bag changes, recipe-draft scheduling, and stale selection fencing;
2. `DoseDeductionAdmissionFlow`: completed-shot dose intent, synchronous
   reservation, journal admission, optimism/canonicalization, cache projection,
   and reservation release.

Both should expose narrow requests/events and reuse the existing inventory and
dose authorities. They must not create a second state store, scheduler, or
journal owner.

### `src/appShell.ts`

State-free shell helpers used by `BeanieApp`.

Examples:

- machine status labels
- water/temperature/number formatting
- scale/machine command predicates
- live chart display options
- draft/workflow signatures
- settings preference type guards

Add here only when the helper is shell-level and pure. Domain-specific rules
should still live in `src/domain/`.

### `src/mock/`

Bundled demo/sample data. Keep it realistic enough for UI and workflow tests to
exercise normal app paths, but keep its source explicit. Cached gateway data is
the normal offline-continuity path and does not belong here.

### `src/test/`

Plain TypeScript tests run by `tsx src/test/runAll.ts`.

Test files usually mirror their source module:

- `foo.ts` -> `foo.test.ts`
- `controllers/fooController.ts` -> `fooController.test.ts`
- `views/fooView.ts` -> `fooView.test.ts`

Keep tests close to the boundary being changed.

## How New Code Should Be Written

Use this decision tree before adding code.

### 1. Is it gateway wire shape or endpoint mechanics?

Put it in `src/api/`.

Examples:

- new response type
- new guard/reader for a gateway payload
- new `gateway.*` request function
- new gateway error handling primitive

Also add API/guard tests if the payload shape is lenient or failure-prone.

### 2. Is it cache-backed loading or fallback?

Put it in `src/data/`.

Examples:

- load from gateway, write to cache
- use cached fallback when gateway fails
- merge cached measurements with fresh summaries
- normalize cache query keys

Repository tests should cover gateway success, gateway failure with cache, cache
write failures where relevant, and generation/staleness guards.

### 3. Is it deterministic business logic?

Put it in `src/domain/`.

Examples:

- matching presets
- deriving water alert level
- deciding whether a shot is a service shot
- recipe math
- profile parsing/serialization
- local preference read/write helpers

Domain tests should be fast and independent of `BeanieApp`.

### 4. Is it a multi-step workflow?

Put policy in `src/controllers/`.

Examples:

- save something remotely with demo fallback
- optimistic update plus rollback
- controller-level status messages
- gateway call followed by cache invalidation
- profile/load/save decisions
- machine command preflight and restore

The app shell should pass dependencies in. Do not add browser globals,
singleton gateway objects, or DOM APIs to a controller. The exact existing
exceptions are listed under [`src/controllers/`](#srccontrollers) and must be
reduced, not expanded.

Controller result shapes should be explicit discriminated unions:

```ts
type SaveResult =
  | { type: 'saved'; item: Item; status: string }
  | { type: 'demo'; item: Item; status: string }
  | { type: 'failed'; error: unknown; status: string };
```

Then `BeanieApp` applies the result:

```ts
const result = await saveThing(input, this.state.demo, deps);
if (result.type === 'failed') {
  this.setState({ busy: false, status: result.status });
  return;
}
this.setState({ thing: result.item, busy: false, status: result.status });
```

### 5. Is it HTML for a screen or modal?

Put it in `src/views/` or `src/components/`.

View code should receive everything it needs as a model. Build the model in
`BeanieApp` or a pure model helper, then render.

Do this:

```ts
return renderMachinePage({
  headerHtml: this.pageHeader('Steam · Water · Flush'),
  lanes,
  cleaningBarHtml
});
```

Do not make a view reach into app state, gateway, DOM, or local storage.

### 6. Is it event wiring, DOM parsing, or state application?

Keep it in `BeanieApp`.

Examples:

- finding a form element
- reading `dataset`
- opening/closing a modal
- choosing the next view
- calling `setState`
- scheduling timers
- managing `requestAnimationFrame`
- holding live DOM references

If the method starts accumulating business decisions, split the decision into a
controller/domain function and keep only the adapter in `BeanieApp`.

## Common Feature Recipes

### Add A New Button Or UI Action

1. Render the button in a view/component with `data-action`.
2. Add a case to the appropriate `handle*ClickAction` method in `BeanieApp`.
3. Keep DOM parsing in `BeanieApp`.
4. Delegate policy to a domain/controller helper if the action changes workflow
   or persistence.
5. Add or update view tests for rendered HTML.
6. Add controller/domain tests for behavior.

### Add A New Modal/Form

1. Define the form state shape near existing app state types if it is shell-only.
2. Render the modal in `src/views/formsView.ts` or a focused view module.
3. Parse the submitted form in `BeanieApp`.
4. Move save/update policy into a controller if it calls the gateway, updates
   cache, handles demo mode, or rolls back state.
5. Test rendering separately from save behavior.

### Add A Gateway-Backed Save Flow

1. Add/extend `gateway.ts` for the endpoint.
2. Add guards/readers if the response shape is not already trusted.
3. Add a controller function that accepts injected dependencies:

   ```ts
   await saveFoo(input, demo, {
     saveRemote: (patch) => gateway.saveFoo(patch),
     writeCache: (foo) => repository.writeFoo(foo)
   });
   ```

4. Make the controller return `saved`, `demo`, or `failed`.
5. Let `BeanieApp` apply the result to state and status.
6. Test demo, success, and failure.

### Add Cache-Backed Loading

1. Put load/fallback/write-through policy in `src/data/`.
2. Keep cache-key normalization inside the repository/cache domain.
3. Return plain data plus status/source metadata if needed.
4. Do not make `BeanieApp` know the details of cache fallback.
5. Inventory is stricter: publish every batch-list cache update through
   `BeanInventoryController`. Its per-bean tail prevents an older write from
   completing last. Batch GETs use the same per-bean command lane as mutations;
   each read token captures the read, projection, and mutation revisions plus
   the fields already owned when the read began. That boundary lets a fresh GET
   that won the lane before a queued edit refresh the edit's confirmed rollback
   baseline, while a read that began after/overlapped the owner cannot steal it.
   Latest-read tokens still prevent an older result from publishing last.
6. Treat the gateway list as an input, not the final projection. Restore a
   locally protected batch if the response omitted it, preserve every UI-owned
   field from local state, and overlay the latest unsettled physical scalar
   unless a newer foreground weight owner wins.
7. Sanitize before persistence. Replace each UI-owned field with its last
   remotely confirmed value; if any owned field lacks a confirmed baseline,
   omit the cache write entirely. The useful optimistic projection may remain
   in process, but it must never become offline truth.

### Add Plugin Settings Behavior

Reaprime's plugin settings endpoint is a whole-map replacement API, even though
Beanie's editor presents it as individual fields. Preserve these boundaries:

1. Sanitize the gateway response when it crosses into `PluginConfigState`;
   previously stored/readable gateway secret values must not enter `AppState`.
   The sanitizer copies only fields in the known plugin specification, so
   unknown gateway keys cannot become UI-owned write intent.
   A newly typed secret may exist only in the active draft; a blank secret draft
   means “keep the stored secret,” not “clear it.”
2. Track panel `session`, draft `revision`, `touched` fields, and explicitly
   edited secrets. Manifest defaults may be displayed for a sparse legacy map,
   but an untouched default is not write intent.
3. Submit only the local changed keys to the settings controller. Inside the
   exact `plugin:<id>` command lane, read the fresh raw map, merge those keys,
   and POST the complete replacement. The raw map, including any readable
   secure value, stays inside that transient lane callback.
4. Settle against the current session and revision. Ignore a closed/reopened
   editor, adopt accepted remote values for untouched fields, and preserve any
   edits made after the save began.
5. Verify saved credentials by reading them transiently inside the same plugin
   lane. Never try to reconstruct verification credentials from sanitized UI
   state.

### Add Machine Settings Or Service Behavior

Use existing machine modules first:

- physical mutation scheduling and authority:
  `machineWorkflowCommands.ts` through the shared
  `GatewayMutationCoordinator`
- physical start/stop admission and compound start commands:
  `machineActionFlow.ts`
- cleaning workflow load/start commands:
  `cleaningExecutionFlow.ts`
- recipe staging, debounce, and apply commands:
  `recipeApplyController.ts`
- value/preset/workflow persistence:
  `machineSettingsWorkflowController.ts`
- active service lifecycle, restoration, progress, and timers:
  `machineServiceFlow.ts`, `machineServiceController.ts`, and
  `domain/machineService.ts`
- reusable water/steam/flush specs:
  `domain/waterSettings.ts`

Do not create a second mutation scheduler, call raw physical gateway mutations
from a feature, or put machine timing math directly in `BeanieApp`.

### Add Shot Metadata Behavior

Use `shotMetadataController.ts` for persistence and pure deletion primitives;
use `ShotDeletionFlow` for the cross-resource delete/reclaim workflow. A delete
dialog may retain a before/after
preview, but the mutation boundary receives only immutable bean/batch/dose
intent. Remote reclaims must be journaled through `DoseMutationReconciler`
before optional cache cleanup; do not send an absolute preview weight to the
gateway. The worker resolves `+dose`, capped by the bag's original weight,
against a fresh remaining-weight scalar inside the canonical per-bean lane.
The replay heuristic requires a tracked admission scalar. If current local
stock is missing or untracked, request authoritative inventory review instead
of journaling an unbounded `+dose` or promoting the display-only modal preview.

The current remote order is DELETE shot, enqueue the durable reclaim, then
invalidate the shot cache. This minimizes the unprotected interval but cannot
eliminate a process crash after DELETE succeeds and before enqueue completes.
If a retry sees 404, it may resume only a reclaim already owned by this
reconciler; creating a new reclaim would risk returning the same dose twice
after another client deleted it. Closing the gap requires a combined
delete/reclaim command journaled before DELETE, as described in
[runtime ownership](runtime-ownership-and-consistency.md#delete--reclaim-boundary).

Keep shot edit form rendering in views and form parsing in `BeanieApp`. Move
policy into the controller when it touches gateway/cache/demo behavior.

### Add Profile Editor Behavior

Use:

- `components/profileEditor.ts` for editor state, field math, and rendering.
- `domain/profileModel.ts` and `domain/simpleProfile.ts` for profile parsing and
  profile transformation rules.
- `profileEditorController.ts` for persistence, favorite profile policy, and
  picker/editor input decisions.

Do not mix profile serialization policy into `BeanieApp`.

## State And Side Effects

### App State

`AppState` lives in `src/app.ts`. New top-level state should be added only when
it is truly UI/application state. Stateful controllers expose immutable narrow
snapshots and events; `BeanieApp` projects those into `AppState` and rendering.
Controllers that need to read or patch shell-owned state declare their own
minimal structural interfaces rather than accepting `AppState` or a generic
`setState` function. This keeps ownership explicit and prevents a controller
from becoming a second shell.

### Command And Mutation Invariants

These are architectural constraints, not local implementation preferences:

1. **One scheduler.** The runtime owns one `GatewayMutationCoordinator`, and it
   is the only concrete owner of `WorkflowCommandCoordinator`. Controllers
   receive its submission port or `MachineWorkflowCommands`; they never create
   an independent command queue.
2. **Desired is not confirmed.** `MachineWorkflowCommands` keeps the latest
   local desired workflow separate from the gateway-confirmed shadow workflow.
   Staging new intent must not falsely advance confirmed state, and a late
   confirmation must not overwrite newer desired intent.
3. **The owned machine lane is non-nestable.** A compound command submits once
   and performs its ordered physical steps through the supplied
   `OwnedMachineLane`. The lane deliberately has no scheduling method, because
   nesting a submission on the same resource can deadlock or interleave work.
4. **Authority is checked per step.** Admission checks improve feedback, but
   live authority can disappear while a command is queued or between requests.
   Revalidate at dispatch and immediately before every physical gateway side
   effect in an owned lane.
5. **`stopSafely()` is the only offline physical exception.** It is
   argument-free and may request only `idle`. Wake, start, workflow, settings,
   calibration, and refill mutations always require live authority.
6. **Rollback is targeted.** Settings optimism uses operations from
   [`settingsBundleMutation.ts`](../src/domain/settingsBundleMutation.ts).
   Apply the inverse operation to the latest bundle; never restore an old whole
   bundle or collection, which would erase unrelated concurrent changes.
7. **Inventory durability gates writes.** Presentation startup may proceed
   without the dose journal, but foreground stock writes may not. Reserve and
   overlay every unsettled durable adjustment first; if discovery fails, keep
   writes read-only and retry. Legacy migration and volatile promotion share
   the admission gate, and no dose reaches the gateway directly from volatile
   intake before promotion into the selected authoritative journal backend.

### Resource Provenance

When a screen combines independent reads, source is part of the state rather
than an incidental status string. Use the shared resource-state types for
`gateway`, `cache`, `default`, and `demo` sources and carry writability with the
result.

In particular, `settingsController.loadSettingsBundle()` loads each gateway
settings endpoint independently. A failed endpoint can contribute a safe
default so the settings shell remains navigable, but that section is marked
unavailable and read-only. A working endpoint remains writable only while the
shell also holds current connected gateway authority; socket/startup demotion
projects every live resource read-only and queued settings lanes recheck that
capability at dispatch. The aggregate settings state is `degraded` when any
section uses a default; it does not become demo merely because one endpoint
failed.

The same rule applies to future repositories: return data plus per-resource
source metadata, preserve cached provenance when fresh data is missing, and do
not infer that a fallback is writable.

### Status Strings

Status strings are user-facing. Keep them close to the workflow that decides
them. Controller-level workflow statuses should usually be returned in result
objects so tests can assert them.

### Local Storage

Local storage helpers live in domain modules such as:

- `domain/storage.ts`
- `domain/machinePreferences.ts`
- `domain/cleaning.ts`
- `domain/settings.ts`
- `domain/interactionHints.ts`

Do not access `localStorage` directly from views or controllers. The app shell
may call domain storage helpers when applying a controller result.

### Gateway

Direct gateway calls should be limited to:

- `src/api/gateway.ts`
- repositories
- composition adapters in `BeanieApp`
- `settingsController.ts` where it is constructed around the gateway

The current transitional exceptions are the same three controller flows named
above: scanner, Derek, and profile editor still import the gateway/cache
singletons directly. Keep that list exact; do not treat it as permission for a
fourth bypass.

Physical mutation adapters are additionally constrained: raw workflow,
calibration, machine-setting, refill, and machine-state gateway calls belong in
the single `MachineWorkflowCommands` transport adapter assembled by
`BeanieApp`. If a controller needs the gateway, inject a narrow operation or
command port. That keeps tests small and prevents controller code from becoming
a second app shell.

### Known Settings Contract Debt

The current app composition supplies transport-authority checks correctly, but
two public contracts are still easier to misuse than they should be:

- `SettingsField.key` is a plain `string`, and
  `SettingsController.persistSetting()` builds a computed patch then casts it
  to the selected settings group. Invalid group/key pairs are therefore a
  runtime concern rather than a type error.
- several cache, startup-repository, bean-repository, settings-store, and
  settings-sync capability callbacks are optional or default to `() => true`.
  Existing composition sites pass the required fences, but a new caller can
  accidentally obtain fail-open write behavior by omission.

Future work should introduce group-indexed settings keys and make mutation or
cache-publication authority explicit/fail-closed at public boundaries. Until
then, every new call site must pass the current authority callback and tests
must cover demotion after an await.

### Rendering

Rendering must be deterministic and side-effect free. No gateway calls, storage
writes, timers, or DOM reads from renderers.

Escape dynamic text with `escapeHtml`/`escapeAttr`. Prefer existing view/component
patterns and icons.

### Live Shot Performance

Do not re-render the whole app for every live telemetry frame. The live shot path
uses direct readout updates and canvas redraws to avoid resetting scroll, losing
DOM refs, or creating frame-rate problems.

If changing live telemetry, verify:

- shot start/end behavior
- held machine series behavior
- scale-only frames
- no-scale abort behavior
- chart/readout updates

## Testing Rules

Run all tests with:

```bash
npm test
```

Run the real-browser startup smoke test with:

```bash
npm run test:browser
```

Playwright builds the application and serves `dist/`, so this gate exercises
the production bundle and relative asset paths rather than Vite's source graph.

Build/typecheck with:

```bash
npm run build
```

Manifest/release-adjacent validation:

```bash
npm run validate:manifest
```

Before committing meaningful code, run:

```bash
npm test
npm run build
```

For manifest/release-adjacent changes, also run `npm run validate:manifest`.

Test at the lowest useful boundary:

- domain logic -> domain tests
- controller workflow -> controller tests with fake dependencies
- view HTML -> view tests
- app event wiring/lifecycle -> `appHarness.test.ts`
- gateway payloads -> gateway/guard tests
- repositories -> repository/cache tests

Do not rely on `BeanieApp` harness tests for controller policy. The harness is
for shell wiring.

[`commandArchitectureGuard.test.ts`](../src/test/commandArchitectureGuard.test.ts)
is an AST-level architecture test. It enforces the single scheduler owner,
rejects legacy command coordinators, confines raw physical gateway mutations to
the `MachineWorkflowCommands` transport adapter, rejects legacy per-batch
inventory lanes, requires selection batch reads and shot deletion to use their
canonical exact lanes, keeps inventory contract/policy internals behind the
facade, and prevents controllers from depending on `app.ts` or `AppState`.
Treat a failure as an ownership violation: fix the dependency
direction instead of weakening the guard unless an explicit, documented
migration changes the invariant.

`dependencyArchitecture.test.ts` separately enforces the layer graph in
`src/architecture/dependencyPolicy.ts` and rejects stale debt entries. Passing
one architecture guard does not substitute for the other.

The scheduler, machine command authority, recipe apply, settings-store sync,
settings mutation, bean inventory, live-shot completion, cleaning execution,
machine action, and machine service flows each have focused tests beside the
rest of `src/test/`. When a command spans several physical steps, assert order,
loss of authority between steps, cancellation/disposal, partial-write
reconciliation, and the absence of nested scheduling.

## AI-Agent Maintenance Protocol

For architecture-affecting work, agents should follow this short protocol:

1. Read this guide, the controller or runtime owner being changed, and
   `commandArchitectureGuard.test.ts` before editing.
2. Name the single owner of each state transition and side effect. Extend the
   existing owner through a narrow port or controller-owned contract instead of
   adding a parallel queue, authority, or shell workflow.
3. Preserve all seven command/mutation invariants above. In particular, submit a
   compound physical command once, pass immutable requests into it, and project
   explicit snapshots/events/outcomes back into the shell. Submit every bean
   inventory write through `beanInventoryMutationKey(beanId)`, and do not make
   inventory writable until durable reservations have been restored.
4. Add tests at the lowest boundary, including stale authority, supersession,
   partial failure, rollback against newer state, and disposal where relevant.
5. Run `npm test` and `npm run build`. If ownership or a public contract moved,
   update this guide in the same change and verify every local documentation
   link.

## Review Checklist For New Code

Before considering a change done:

- Did new workflow policy avoid `BeanieApp`?
- Does the change use the one shared mutation scheduler and the existing
  `MachineWorkflowCommands` authority for physical mutations?
- Are desired intent and gateway-confirmed shadow state still distinct?
- Does each physical step recheck authority, with `stopSafely()` remaining the
  only offline exception?
- Do optimistic failures apply targeted inverse operations to current state?
- Does each controller expose a narrow controller-owned contract rather than
  `AppState`?
- Are gateway/cache dependencies injected into controllers?
- If inventory is writable, have all unsettled journal records already been
  reserved and overlaid, with failure leaving the capability closed?
- Does every new cache/startup/settings write call pass explicit live authority
  rather than relying on a fail-open default?
- Are views pure?
- Are status strings tested when they encode policy?
- Does demo mode follow the same visible state path as remote mode?
- Is cached/default/demo provenance visible and are non-authoritative defaults
  read-only?
- Are failure paths tested?
- Does the live shot path avoid unnecessary full renders?
- Did `npm test` and `npm run build` pass?
- If manifests/releases changed, did `npm run validate:manifest` pass?

## Anti-Patterns

Avoid these:

- adding large business workflows directly to `BeanieApp`
- instantiating another `WorkflowCommandCoordinator` or feature-local gateway
  mutation queue
- scheduling from inside an owned machine lane
- passing `AppState`, a generic app-state patcher, or `BeanieApp` into a
  controller
- rolling back an entire settings bundle or array after a targeted optimistic
  mutation
- calling `gateway.*` from a view or component
- adding another DOM read to a controller (scanner/profile editor are the exact
  transitional exceptions)
- adding another singleton gateway/cache import to a controller (scanner,
  Derek, and profile editor are the exact transitional exceptions)
- importing singleton gateway/cache objects into pure policy modules
- making render functions mutate state
- string-building API payloads when typed objects/guards exist
- broad method reordering without a tested module boundary
- coupling tests to private implementation details when a result object can be
  asserted instead

Small glue in `BeanieApp` is fine. Unreviewable policy in `BeanieApp` is not.
