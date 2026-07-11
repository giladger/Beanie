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

## Directory Responsibilities

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
| `beanWorkflowController.ts` | Bean selection, bean/batch/grinder mutation policy, optimistic rollback, cache invalidation decisions. |
| `cleaningWorkflowController.ts` | Cleaning start blockers, cleaning workflow creation/load result, finish/count/profile-pick plans. |
| `cleaningWizardController.ts` | Cleaning wizard step transitions and action completion. |
| `derekController.ts` / `derekFlow.ts` | Derek question state, streaming lifecycle, suggestions, and saved-answer restoration. |
| `doseMutationReconciler.ts` | Durable dose-deduction replay and conflict-safe reconciliation. |
| `liveShotController.ts` | Shot completion matching, polling, fallback, and shot-end routing decisions. |
| `machineExecutionController.ts` | Machine command preflight, hot-water weight stop orchestration, steam workflow padding/restore, command gateway sequencing. |
| `machineServiceController.ts` | Machine service progress/timer/stop-request state transitions. |
| `machineSettingsWorkflowController.ts` | Steam/water/flush workflow persistence, preset/value planning, steam purge readback, settings patch planning. |
| `profileEditorController.ts` | Profile save persistence, favorite profile policy, profile picker/editor input decisions. |
| `profileEditorFlow.ts` | Profile editor session ownership and UI-facing orchestration. |
| `scannerFlow.ts` | Scanner onboarding, image conversion, Gemini request lifecycle, review, and save orchestration. |
| `settingsController.ts` | Reaprime settings/account/device/plugin operations. |
| `shotMetadataController.ts` | Shot score/edit persistence, demo behavior, cache update/failure decisions. |

If a new flow has more than one async step, optimistic state, demo/remote split,
cache invalidation, rollback, or user-facing status policy, it probably belongs
in a controller.

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

- value/preset/workflow persistence:
  `machineSettingsWorkflowController.ts`
- action preflight/gateway sequencing/restore:
  `machineExecutionController.ts`
- active service progress and timers:
  `machineServiceController.ts` and `domain/machineService.ts`
- reusable water/steam/flush specs:
  `domain/waterSettings.ts`

Do not put machine timing math directly in `BeanieApp`.

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
it is truly UI/application state. If the state is owned by a controller, prefer
the controller returning the next value instead of hiding mutable state inside
the controller.

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
- controller dependency adapters in `BeanieApp`
- `settingsController.ts` where it is constructed around the gateway

If a controller needs the gateway, inject the operation. That keeps tests small
and prevents controller code from becoming a second app shell.

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

## Review Checklist For New Code

Before considering a change done:

- Did new workflow policy avoid `BeanieApp`?
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
- calling `gateway.*` from a view or component
- reading DOM from a controller
- importing singleton gateway/cache objects into pure policy modules
- making render functions mutate state
- string-building API payloads when typed objects/guards exist
- broad method reordering without a tested module boundary
- coupling tests to private implementation details when a result object can be
  asserted instead

Small glue in `BeanieApp` is fine. Unreviewable policy in `BeanieApp` is not.
