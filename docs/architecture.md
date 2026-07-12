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
   listeners.
2. Startup repositories load gateway data and cached fallback data.
3. `BeanieApp` keeps one `AppState` object and re-renders after `setState()`.
4. User actions are dispatched through `data-action` attributes.
5. App methods parse DOM/form values and delegate policy to controllers/domain
   helpers.
6. Controllers return explicit outcomes.
7. `BeanieApp` applies those outcomes to state, DOM, timers, sockets, or local
   UI flow.

Startup has two separate fallback concepts. Cached resources came from the
user's gateway and retain cached/offline provenance while the app retries the
live source. `src/mock/` is explicit demo/sample data; entering demo mode must
be visible and demo mutations must remain simulated. Do not relabel a cached
gateway snapshot as demo or make demo defaults appear to be the user's data.

The live shot path is intentionally more direct for performance:

- WebSocket frames are ingested by the app shell.
- Pure telemetry helpers merge partial machine/scale frames.
- `LiveShot` tracks the active shot model.
- While brewing, Beanie patches stable DOM readouts and redraws the canvas
  instead of re-rendering the whole app.

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

Bean stock has a parallel aggregate rule: every edit, storage migration,
split-freeze transaction, and delayed dose deduction for a coffee uses
`beanInventoryMutationKey(beanId)`. A split freeze owns one per-bean lane across
create, freezer-state repair, source-bag update, and authoritative reconciliation.
Do not introduce `batch:<id>` lanes: two bags from one coffee can affect the same
selection and recipe projection, and a delayed dose write must not interleave
with a split transaction.

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
- avoid importing singleton gateway/cache objects unless the controller is
  explicitly constructed with them at the boundary

Current controller map:

| Controller | Owns |
| --- | --- |
| [`beanInventoryController.ts`](../src/controllers/beanInventoryController.ts) | Stable inventory facade and imperative sequencer: per-bean command-lane ownership, field-intent revisions, authoritative reads, create/update/split execution, and cache publication. Existing consumers import the facade rather than its implementation modules. |
| [`beanInventoryContract.ts`](../src/controllers/beanInventoryContract.ts) | Public inventory ports, snapshots, requests, projections, and discriminated outcomes. It has type-only dependencies and no runtime behavior. |
| [`beanInventoryPolicy.ts`](../src/controllers/beanInventoryPolicy.ts) | Deterministic inventory projection, rollback, reconciliation, split planning, status, and idempotency-key policy. It does not import the controller facade. |
| `beanWorkflowController.ts` | Bean selection plus bean/grinder mutation policy and cache decisions. Batch mutation authority lives in `BeanInventoryController`. |
| [`cleaningExecutionFlow.ts`](../src/controllers/cleaningExecutionFlow.ts) | Cleaning workflow staging and the one exact machine-lane command that loads and optionally starts it, with explicit completion/authority/cancellation outcomes. |
| `cleaningWorkflowController.ts` | Cleaning start blockers, cleaning workflow creation/load result, finish/count/profile-pick plans. |
| `cleaningWizardController.ts` | Cleaning wizard step transitions and action completion. |
| `derekController.ts` / `derekFlow.ts` | Derek question state, streaming lifecycle, suggestions, and saved-answer restoration. |
| `doseMutationReconciler.ts` | Durable dose-deduction replay and conflict-safe reconciliation on the shared per-bean inventory lane, including dispatch-time migration of legacy queued keys. |
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
| `shotMetadataController.ts` | Shot score/edit persistence, demo behavior, cache update/failure decisions. |

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

The facade remains the only public mutation owner. This split lets a coding
agent inspect or change result contracts, pure reconciliation policy, or
network sequencing independently, while the one-way dependency graph and
facade imports keep authority from fragmenting. Safety-sensitive helpers such
as stable intent serialization and optimistic rollback belong in policy and
must be changed with focused policy/controller regressions, not copied into a
new caller.

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

- startup/lifecycle/dispose
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

The app shell should pass dependencies in. Do not import browser globals,
singleton gateway objects, or DOM APIs into a controller unless there is no
clean alternative.

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

Use `shotMetadataController.ts` for persistence and cache updates.

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

### Resource Provenance

When a screen combines independent reads, source is part of the state rather
than an incidental status string. Use the shared resource-state types for
`gateway`, `cache`, `default`, and `demo` sources and carry writability with the
result.

In particular, `settingsController.loadSettingsBundle()` loads each gateway
settings endpoint independently. A failed endpoint can contribute a safe
default so the settings shell remains navigable, but that section is marked
unavailable and read-only. A working endpoint remains live and writable. The
aggregate settings state is `degraded` when any section uses a default; it does
not become demo merely because one endpoint failed.

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

Physical mutation adapters are additionally constrained: raw workflow,
calibration, machine-setting, refill, and machine-state gateway calls belong in
the single `MachineWorkflowCommands` transport adapter assembled by
`BeanieApp`. If a controller needs the gateway, inject a narrow operation or
command port. That keeps tests small and prevents controller code from becoming
a second app shell.

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
inventory lanes, and prevents controllers from depending on `app.ts` or
`AppState`. Treat a failure as an ownership violation: fix the dependency
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
3. Preserve all six command/mutation invariants above. In particular, submit a
   compound physical command once, pass immutable requests into it, and project
   explicit snapshots/events/outcomes back into the shell. Submit every bean
   inventory write through `beanInventoryMutationKey(beanId)`.
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
- reading DOM from a controller
- importing singleton gateway/cache objects into pure policy modules
- making render functions mutate state
- string-building API payloads when typed objects/guards exist
- broad method reordering without a tested module boundary
- coupling tests to private implementation details when a result object can be
  asserted instead

Small glue in `BeanieApp` is fine. Unreviewable policy in `BeanieApp` is not.
