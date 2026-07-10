# Render ownership architecture

_Decision date: 2026-07-10 · Status: partially implemented target architecture_

This document defines how Beanie renders continuously changing machine data
without allowing WebSocket rate, DOM mutation rate, or GPU resource lifetime to
become coupled. It is the architectural follow-up to
[the WebView GPU OOM investigation](webview-gpu-oom-investigation.md) and the
[render modernization plan](render-modernization-plan.md).

The central rule is:

> Arbitrarily fast input may update memory, but every DOM subtree has exactly
> one renderer. That renderer commits complete presentation models at a bounded
> rate, writes nothing when its model is unchanged, and releases every resource
> it acquires.

This is an ownership and lifecycle design, not a framework migration. Beanie
keeps its string views, delegated events, morphdom shell, domain modules, and
controllers.

## Implementation status

Normative sections below define the target contract. This snapshot separates
that contract from the code delivered with this decision.

| Area | Current status | Implemented in this change |
| --- | --- | --- |
| Bounded scheduling | Landed | `RenderChannel` provides latest-wins coalescing, equality, explicit flush, semantic-session reset, injected clocks, and disposal. |
| Topbar | Landed | Complete stat models, source-unit hysteresis, an opaque sole-writer island, atomic text/class/title/ARIA commits, and remount-safe current-model ordering. |
| Water alert band | Landed | Soft-alert display projection is stabilized in raw millimetres before the tank lookup; the machine's hard `needsWater` state remains immediate. |
| Live readouts | Landed as one combined island | A 10 Hz channel gates text/classes, owns the morph-opaque readouts and rail, resets between shots, observes rail layout, and performs stage work only on stage/reason revisions. Splitting numeric/stage models remains optional cleanup. |
| Charts | Landed resource contract | Exclusive canvas ownership, independent invalidation, resize/DPR/theme/visibility sources, model keys including profile identity, backing-store caps, listener/observer cleanup, and 1×1 teardown. The active live composite still uses the app's existing RAF to build its latest model. |
| Screensaver | Landed shared lifecycle | App orchestration schedules only while a visible photo surface is active; `ScreensaverIsland` owns both clocks and image DOM/resources, load/error generations, crossfade cleanup, and one-photo reconciliation. Imports close every `ImageBitmap` in `finally`. |
| Other hot surfaces | Landed | Derek token streaming is a complete, session-reset 20 Hz island; profile slider labels have a named render owner. |
| Async flow ownership | Landed for reviewed flows | Monotonic operation epochs/request identities prevent Derek, scanner, and profile save/import continuations from crossing close/reopen sessions. |
| Enforcement | Partial | AST tests reject presentation DOM writes in `app.ts` and controllers; the existing markup guard permits intentional sinks only under `src/render`. Repository-wide dependency/native-resource enforcement is still future work. |
| Telemetry store | Pending | Canonical telemetry remains in `AppState`; socket callbacks now publish to render/projector boundaries without owning DOM. A standalone revisioned `TelemetryStore` is a later extraction, not a prerequisite for these ownership fixes. |
| Acceptance | Pending on hardware | Local tests/build and browser verification are part of this change. The release WebView soak and Android graphics measurements remain an operational release gate. |

The extracted scanner and profile flows are UI coordinators today: they still
read form/focus state and depend on the application host. "Controllers are
DOM-free" below is the desired dependency boundary for later extraction, not a
claim that every existing flow already satisfies it.

## Context and evidence

The findings in this section describe the state before this migration.

The DE1 tablet runs the system WebView in the Reaprime process. GPU/compositor
allocations therefore appear in the app's Android `Graphics` bucket. On the
M50Mini, redundant text repaints driven by the 4–10 Hz telemetry stream grew
that bucket until Android killed the foreground process at roughly 2.3 GB RSS.
The JavaScript heap remained around 14 MB.

Two successive bugs established that local guards are not a sufficient design:

1. The machine/scale snapshot handler rewrote all five topbar values on every
   frame, including identical strings. A gate and 4 Hz throttle stopped that
   path.
2. The independent water-level socket still wrote the same displayed water
   value about once per second because its guard compared noisy raw millimetres.
   Routing that socket through the topbar writer stopped the direct writes, but
   the writer's water deadband was applied after a discontinuous tank lookup.
   Noise around an integer-millimetre boundary could still alternate
   between displayed values despite the deadband.

The review of the render-modernization commits found the same ownership problem
in other forms:

- `TopbarStats` patched scale text while the string-rendered shell owned scale
  tooltip and low-battery class. One observation can therefore leave a mixed
  old/new UI.
- `LiveReadouts` assigned five `textContent` properties on every update without
  checking the formatted value.
- morphdom and imperative writers can both reach the same topbar and live-shot
  descendants.
- chart construction was tied to canvas identity, while model, layout, theme,
  DPR, and interaction invalidation were partly collapsed into early returns.
- `LiveChart` hover listeners and backing stores did not have an explicit
  disposal contract.
- the screensaver slideshow owned two decoded image surfaces through callbacks
  and delayed cleanup without one lifecycle object to cancel pending work on
  unmount.
- the app harness does not execute real morphdom behavior, so ownership
  conflicts can pass the broad application test suite.

These are not independent special cases. They all result from the absence of a
declared boundary between observation, presentation policy, scheduling, DOM
mutation, and native-resource lifetime.

## Goals

This design must provide the following guarantees:

- A socket handler can ingest any number of frames without directly mutating
  DOM, scheduling UI-specific timers, or constructing browser resources.
- Every mutable DOM property has one owner. A morphdom render and an imperative
  renderer never update the same descendant.
- Each presentation surface receives a complete view model. Text, tone, title,
  and accessible name move together.
- Presentation noise filtering happens in the continuous source unit before
  discontinuous conversion or formatting.
- Streaming surfaces have an explicit maximum commit rate and latest-value-wins
  behavior. They cannot grow a queue.
- An unchanged presentation model produces zero DOM writes and zero canvas
  redraws.
- A persistent canvas can reuse its chart object while still responding to
  model, layout, DPR, theme, and interaction changes.
- Timers, animation frames, observers, listeners, image decodes, textures, and
  canvas backing stores have explicit, idempotent disposal.
- The invariants are enforced by focused tests, mutation budgets, dependency
  checks, and a release-build soak on the actual tablet.

## Non-goals

- Replacing morphdom or rewriting the application in React, Svelte, Preact, or
  lit-html.
- Moving shot capture or persistence onto a display-rate sampler. Every
  measurement required for a saved shot must still be processed.
- Treating `AppState` as a reactive framework store or forcing every ordinary
  user action through the telemetry path.
- Making sensor hysteresis a business-domain truth. It is display policy; raw
  measurements and machine safety decisions remain unmodified.
- Guaranteeing that the Android WebView releases GPU allocations it has already
  retained. Beanie can prevent unbounded new work and release resources it
  owns; it cannot repair Chromium's allocator.
- Using a periodic Reaprime restart to hide a non-flat idle mutation path.

## Architectural decision

The render path is divided into five layers, with dependencies flowing only
from left to right:

```text
gateway sockets / demo source
          |
          v
telemetry ingestion and shot recording
          |
          v
presentation projectors
          |
          v
bounded render channels
          |
          v
render islands and resource hosts
          |
          v
DOM / canvas / decoded images
```

The composition root in `BeanieApp` may wire adjacent layers together. It may
not collapse them by putting presentation policy back in a socket callback or
by letting two renderers share a target.

The low-frequency application shell continues to render HTML strings and morph
them into place. High-frequency or resource-bearing areas are opaque islands
inside that shell. Morphdom owns the island boundary's placement; the island
owns every descendant and mutable property inside it.

## Core invariants

The following are requirements, not guidelines:

1. **One writer:** for every text node, class, style, attribute, input property,
   image source, or canvas bitmap, one named module owns writes for its entire
   mounted lifetime.
2. **Complete commit:** a renderer accepts a complete view model. It does not
   query `AppState`, a gateway, or another DOM node to fill in missing state.
3. **Latest wins:** a render channel retains at most one pending model. A newer
   offer replaces an older pending offer.
4. **Bounded work:** a streaming channel has at most one timer or animation
   frame scheduled and a documented maximum commit rate.
5. **Stable means silent:** equality with the last committed presentation model
   produces no DOM assignments, class-list operations, layout reads, or draws.
6. **Source-unit stabilization:** a projector accepts/rejects raw sensor changes
   before lookup-table conversion, rounding, string formatting, or threshold
   decoration.
7. **Reuse is not validity:** resource identity decides whether an object is
   constructed; independent invalidation decides whether it resizes or redraws.
8. **Mounted work only:** hidden, detached, superseded, or disposed owners do not
   schedule work or commit results.
9. **Symmetric lifetime:** every listener, observer, timer, RAF, decoded image,
   object URL, and large backing store acquired by an owner is released by that
   same owner.
10. **Raw data is preserved:** display sampling and hysteresis never discard
    observations required by `LiveShot`, shot decisions, alerts, persistence,
    or machine control.

## Telemetry ingestion

### Responsibility

The telemetry layer owns the latest normalized machine, scale, and water
observations and feeds the existing shot state machine. Socket callbacks do
only three things:

1. parse and validate the wire payload;
2. ingest the normalized observation;
3. request domain transitions that are genuinely event-driven, such as a sleep
   transition, water-alert band change, or shot start/end.

They do not query elements, assign DOM properties, instantiate charts, or
contain display throttles.

The target API is deliberately small:

```ts
interface TelemetrySnapshot {
  machine: MachineSnapshot | null;
  scale: ScaleSnapshot | null;
  waterLevelMm: number | null;
  observedAtMs: number;
  machineRevision: number;
  scaleRevision: number;
  waterRevision: number;
}

interface TelemetryStore {
  ingestMachine(frame: MachineSnapshot, observedAtMs: number): void;
  ingestScale(frame: ScaleSnapshot, observedAtMs: number): void;
  ingestWater(levelMm: number, observedAtMs: number): void;
  snapshot(): TelemetrySnapshot;
  subscribe(listener: () => void): () => void;
}
```

Separate revisions matter because the sockets have independent cadence and no
cross-socket ordering guarantee. Consumers can detect exactly which source
changed without interpreting object identity. `snapshot()` is immutable from a
consumer's perspective.

The initial migration may keep the canonical values in `AppState` while a
store-shaped adapter is introduced. The end-state contract is still that
socket callbacks publish observations and presentation consumers read a
snapshot; no socket owns a particular element.

### Shot recording versus presentation sampling

`LiveShot` and machine workflow logic continue to see every relevant frame in
arrival order. A render channel is a downstream observer of the latest state,
not the transport for shot measurements.

For example, 50 machine frames may add 50 measurement points while the live
numeric island commits five times. This is intentional: persisted fidelity and
display work have different rates.

### Event-driven shell changes

Some telemetry changes alter structure rather than a readout:

- sleeping/awake changes the overlay and power action;
- crossing a water alert band changes the warning banner;
- shot start/end changes the live panel structure;
- a stage/profile definition change changes the stage rows.

Those transitions may request a low-frequency shell morph or remount an island.
The continuous values between transitions remain on their render channels.
Comparisons must be against a domain/presentation state such as alert level,
not against raw noisy samples.

## Presentation projectors

### Responsibility

A projector converts a telemetry/application snapshot into a complete,
renderer-ready model. It owns formatting, display hysteresis, tone selection,
tooltips, and accessible labels. It has no DOM dependency and does not import
`AppState` or gateway singletons.

The topbar implementation lives in `src/render/topbarPresentation.ts` and uses
complete stat models rather than the former mixture of strings and partial
objects:

```ts
interface StatViewModel {
  text: string;
  className: string;
  title: string;
  ariaLabel: string;
}

interface TopbarViewModel {
  machine: StatViewModel;
  group: StatViewModel;
  steam: StatViewModel;
  water: StatViewModel;
  scale: StatViewModel;
}
```

`TopbarProjector` accepts a `TopbarPresentationInput` and returns the whole
`TopbarViewModel`. As a result, a scale connect/disconnect or battery transition
cannot update its visible label while leaving its warning class or tooltip
stale.

Projectors are pure whenever history is unnecessary. A projector may be
stateful only for explicit presentation history such as hysteresis. That state
is reset when the corresponding source becomes unknown, when a new semantic
session begins, or when the projector is disposed.

### Stabilization order

The mandatory order is:

```text
raw observation -> finite/range validation -> source-unit hysteresis
                -> conversion -> display quantization -> formatting/decorating
```

Water is the motivating case. `waterTankMlFromMm()` uses an integer-indexed tank
lookup, so a tiny change around an integer-millimetre boundary can become a
large millilitre jump. A deadband applied to the converted value cannot reject
that noise reliably. `TopbarProjector` therefore holds an accepted raw
millimetre value and applies an accepted-source deadband in millimetres before
calling the lookup and formatting the result. The initial defaults are 0.5 mm
for water, 1.2 °C for group temperature, and 4 °C for steam temperature; these
are exported as `DEFAULT_TOPBAR_HYSTERESIS` so tests and future device evidence
can change them explicitly.

The same rule applies to group and steam temperature: accept or hold raw °C,
then format. Thresholds are presentation constants based on measured sensor
noise and must be named, documented, and directly tested. They must not alter
the raw values used for safety, recording, machine hard alerts, or settings.

A projector must also define recovery behavior:

- `null`, `NaN`, or invalid input projects the unknown model immediately;
- the first valid value after unknown is accepted immediately;
- a semantic status change such as disconnected/connected is not held behind a
  numeric deadband;
- a large real movement lands on the next allowed commit, including the final
  trailing commit after input stops.

### Model equality

Render equality is based on the complete view model, not the raw input. Two raw
samples that project to identical text, classes, titles, and ARIA state are the
same render model and must produce no UI work.

Models are small value objects. They should be compared field-by-field or with
a dedicated equality function; JSON serialization is unnecessary allocation on
the hot path.

## Bounded render channels

`src/render/renderChannel.ts` provides the shared scheduling primitive. A
`RenderChannel<Model>` has this conceptual contract:

```ts
interface RenderChannel<Model> {
  offer(model: Model): void; // replace pending model; schedule at most once
  flush(): void;             // commit latest pending model now if mounted
  reset(): void;             // drop old semantic-session history and work
  dispose(): void;           // cancel work and reject future commits
  readonly isDisposed: boolean;
}
```

The concrete constructor accepts `{ minIntervalMs, commit, equals?, scheduler? }`.
The scheduler supplies `now`, `schedule`, and `cancel` for deterministic tests.

Required semantics:

- The first offer commits immediately.
- Offers inside the interval replace the pending value and share one trailing
  timer.
- The trailing callback commits the newest value, never every intermediate
  value.
- Equality is checked against the last successfully committed model.
- An equal offer does not create a timer.
- If the newest pending model becomes equal to the committed model, the
  trailing callback performs no write.
- `flush()` cancels the scheduled callback before committing, so it cannot
  duplicate the commit later.
- `dispose()` is idempotent, cancels scheduled work, clears retained models,
  and prevents late callbacks from reaching the sink.
- At most one scheduled callback exists per channel.

Default channel budgets are surface-specific, not globally inherited:

| Surface | Trigger | Maximum commit cadence | Notes |
| --- | --- | --- | --- |
| Topbar metrics | machine, scale, water observations | 4 Hz | Preserves the measured safe cap and trailing value. |
| Live numeric readouts | active-shot observations | 10 Hz | Smooth enough for human-readable numbers; each field is still change-gated. |
| Live chart | active-shot observations | one RAF, capped to 15–20 fps if device measurement requires it | Measurement ingestion remains uncapped. |
| Stage state/reasons | stage or decision revision | event-driven | No per-frame class toggles. |
| Derek token stream | relay events | 20 Hz | Complete safe HTML, phase, and shimmer model; reset per request generation. |
| Profile range label | user range input | input-event cadence | One gated text/unit patch; no shell morph during drag. |
| Topbar/screensaver clock | minute boundary | one per minute | No polling interval. |
| Screensaver photos | configured slideshow boundary | one transition per interval | Suspended while not mounted/visible. |

These are initial budgets. They may be lowered after device measurement. Raising
them requires a documented tablet trace, not a subjective desktop impression.

## Render islands and DOM ownership

### Boundary contract

An island is a stable, keyed element in shell markup with an owner name. The
operative boundary in the current renderer is `data-morph-skip`:

```html
<div id="top-stats-island"
     data-morph-skip="topbar-stats"></div>
```

The boundary has two owners with non-overlapping responsibilities:

- the shell owns whether the boundary exists and where it is placed;
- the named island owns all descendants and all mutable properties inside the
  boundary.

`data-render-owner` may be added later as review metadata, but the renderer does
not currently interpret it. Boundary attributes are static. If a boundary attribute must vary, it belongs
inside the island instead. Morphdom's `data-morph-skip` rule makes descendants
opaque to the shell. An island must mount/update immediately after its boundary
appears; it cannot depend on placeholder values emitted by the shell staying
current.

The normalized lifetime shape is conceptual:

```ts
interface RenderIsland<Model> {
  mount(root: HTMLElement): void;
  update(model: Model): void;
  dispose(): void;
}
```

Current owners name these operations `bind/offer/dispose` or expose
surface-specific update methods. `mount()` is idempotent for the same root and disposes bindings to a different
root. `update()` after disposal or without a mounted, connected root is a
no-op. `dispose()` cancels the island channel and releases cached element
references and resources.

### Topbar island

The first island is the five metric cells inside the topbar. The rest of the
header—shot commands, clock placement, settings buttons, cleaning badge, and
sleep action—remains shell-rendered because it changes at user/event cadence.

The topbar island renders the complete `TopbarViewModel` atomically. It may
cache direct references after mount, but it never queries the application for
missing values. Per-stat commit order is text, tone/class, title, and ARIA state;
the complete model is stored as committed only after all writes succeed.

Every assignment is guarded against the corresponding DOM property. This
second gate is intentional even when channel equality exists: it protects a
remount or externally repaired DOM and makes mutation-budget tests precise.

### Live-shot islands

The current implementation deliberately lands as one `LiveReadouts` owner for
numeric values and the stage rail. It receives a bounded raw/lazy model, gates
every concrete write, observes rail layout, and resets its channel on a new
shot. Both owned subtrees are morph-opaque. This closes the leak and remount
races without requiring a structural rewrite of the live-shot state machine.

The finer split below is the target if profiling shows that independent models
materially simplify the surface:

The live panel is divided by cadence and structure:

- a numeric-readout island owns time, weight, pressure, flow, and temperature;
- a stage island owns stage row state, reason chips, and current-stage scroll;
- a chart host owns the live canvas.

The shell owns whether the live panel exists and supplies the stage definition
at mount. The stage island rebuilds its own descendants when that definition's
stable key changes. On ordinary telemetry it updates only when the current
stage or decision/reason revision changes. `scrollHeight`, `clientHeight`, and
`offsetTop` are read only on mount/layout invalidation or an actual stage
change, never on every measurement frame.

The numeric island formats before scheduling and compares each committed field.
Ten thousand frames with unchanged formatted values therefore cause no text
assignments.

### Form values

User-edited input properties are also an ownership boundary. For an
uncontrolled input, the browser/user owns `value` and `checked` between mount
and submission; the shell owns declarative attributes and `defaultValue` only.
Morph code must not copy a live `value` into target markup in a way that changes
the surviving element's `defaultValue`, because that erases the dirty-state
signal.

Long-lived drafts should migrate to explicit draft models, where a form
controller owns both the draft and the field update. Until then, uncontrolled
forms need a narrowly defined morph policy and real morphdom tests. They are not
an exception to one-writer ownership.

## Chart lifecycle and invalidation

Canvas identity controls object reuse; it does not prove the bitmap is current.
Every chart has an owning binder/host responsible for observing its boundary and
disposing it when the canvas detaches.

`LiveChart` supplies the resource-level contract:

```ts
chart.setModel(model);
chart.setOptions(options);
chart.invalidate('model' | 'layout' | 'theme' | 'interaction');
chart.dispose();
chart.isDisposed;
```

`invalidate()` coalesces redraws onto one animation frame. Layout invalidation
also runs `resize()`. `dispose()` is idempotent, cancels the pending RAF,
removes stored hover listeners, clears retained model and hover state, and
shrinks the canvas backing store to 1×1. A disposed chart never draws again.

The owner tracks independent invalidation keys:

| Key/reason | Source | Required action |
| --- | --- | --- |
| Canvas identity | shell morph/view change | Dispose old chart; construct and mount new chart. |
| Model key/revision | shot measurements, comparison, calibration draft, live points | Set model and invalidate `model`. |
| CSS box | `ResizeObserver`, phone/desktop switch, UI scale | Invalidate `layout`. |
| Device pixel ratio | window/media change or layout check | Invalidate `layout`. |
| Theme version | settings/theme application | Invalidate `theme`. |
| Hover position | owned pointer listeners | Invalidate `interaction`. |
| Visibility | view/island lifecycle | Suspend while hidden; invalidate layout/model on resume. |

`LiveChartOptions.maxBackingStorePixels` enforces a native-memory ceiling,
defaulting to exported `DEFAULT_MAX_BACKING_STORE_PIXELS`. `resize()` computes
an isotropically capped scale rather than multiplying CSS size by DPR and
`pixelScale` without a budget. This is especially important for the detailed
charts that currently request `pixelScale: 3`.

`LiveChart` owns its element-scoped `ResizeObserver`, window/DPR fallback,
system-theme media listener, visibility listener, hover listeners, and RAF.
All are symmetrically removed by `dispose()`. A per-canvas `WeakMap` enforces
exclusive ownership: constructing a replacement disposes the prior owner.
Model generation and resource lifetime remain separate: cached shot models may
outlive a chart, but a chart does not retain a shot model after disposal.

The existing binders migrate as follows:

- `bindDetailChart()` keys model invalidation on primary shot measurements and
  profile identity, plus comparison measurements/profile/identity. A stable
  bind is silent; layout/theme/DPR are independent observer sources.
- `bindShotStagesChart()` no longer returns solely because the canvas survived;
  it tracks the selected shot/model revision as well.
- `bindCalibratorChart()` invalidates the model for calibration factor changes
  while reusing the chart.
- the live chart receives coalesced work at its display cadence, independent of
  measurement ingestion. Its existing app RAF currently builds the composite
  live model; chart-owned invalidations handle interaction/layout/theme.

## Screensaver resource lifecycle

The slideshow is split into orchestration and resource ownership rather than a
timer plus unrelated DOM callbacks.

`BeanieApp` owns the selected photo index and the slideshow interval decision.
It arms one timer only while the document is visible and a mounted, active
photo surface can advance; disposal or any ineligible render cancels it.

`ScreensaverIsland` owns:

- the two image elements and which lease is active/incoming;
- the crossfade-completion timer;
- `load`/`error` handlers;
- generation tokens for stale async callbacks;
- current mounted photo URL and reconciliation with application selection;
- object URLs, when Blob-backed sources are used;
- clearing hidden and detached image sources;
- visibility/mount state.

At most two decoded display images may be retained during a crossfade. After
the fade, the outgoing lease clears its image source and revokes any object URL.
Before assigning a new incoming source, any older incoming lease is released.
Data URLs cannot be revoked, but clearing `src` releases Beanie's reference to
the decoded surface. Stored compressed photo strings remain ordinary IndexedDB
data, not mounted image resources.

The host does no slideshow work while the overlay is absent, the configured
mode does not show photos, the document is hidden, or the app is disposed. On
resume it schedules one future transition; it does not replay missed intervals.

Every callback captures the current generation. A callback from a superseded
load/fade checks the token and exits without changing classes or sources. Image
load failure releases the failed incoming lease and keeps the current image
visible.

Photo import has a separate short-lived resource scope. Every
`ImageBitmap` is closed in `finally`, including early returns such as a missing
2D context or encoding failure. Temporary import canvases are shrunk after
encoding when device measurement shows their backing stores are retained.

One minute-boundary timer supplies a formatted label. `ScreensaverIsland` is
the sole DOM writer for both the morph-opaque topbar clock and saver clock, and
also owns the saver burn-in position.

## Shell and morphdom contract

`src/render/renderer.ts` owns shell reconciliation. It may mutate the shell but
must skip:

- every `data-morph-skip` island boundary (`data-render-owner` remains proposed metadata);
- every managed canvas;
- browser-owned live form properties according to the form ownership policy.

The shell renderer may add, remove, and reorder island boundaries as views
change. After each morph, the composition root reconciles mounts:

1. dispose owners whose boundary is no longer connected;
2. mount owners for new/replaced boundaries;
3. offer the latest complete model to mounted owners;
4. reconcile resource invalidation keys;
5. restore focus only when a genuinely replaced field requires it.

An island never calls `morphRender()`, and the shell never reaches into an
island to repair a child. If a child is wrong, the island's complete model is
re-offered or the island is remounted.

## Module boundaries and dependency rules

Target module placement:

```text
src/api/                         wire payloads and gateway/WebSocket mechanics
src/domain/                      machine/shot rules and raw conversions
src/telemetry/                   latest normalized observations and revisions
src/render/renderChannel.ts      generic bounded latest-value scheduler
src/render/*Presentation.ts      projector inputs, complete VMs, equality
src/render/*Island.ts            DOM owners for imperative islands
src/render/chartHost.ts          chart mount/observer/invalidation owner
src/render/screensaverIsland.ts  image/clock resource owner
src/render/renderer.ts           morphdom shell policy only
src/components/LiveChart.ts      bounded canvas drawing resource
src/app.ts                       composition and structural transition glue
```

Allowed dependency direction:

```text
api -> telemetry -> presentation -> render channel -> island/resource host
             \-> domain/session recording
domain --------------------------------------^ (pure types/conversions only)
app.ts --------------------------------------^ (composition only)
```

Rules:

- `src/render/*Presentation.ts` may import pure domain types/functions. It may
  not import `AppState`, gateway/cache singletons, `document`, or `window`.
- `src/render/renderChannel.ts` has no DOM, gateway, or app dependency; time and
  scheduling are injected behind small defaults.
- islands may use DOM APIs and their view-model types. They may not import a
  gateway, repository, controller, or `AppState`.
- resource hosts are the only owners allowed to construct/dispose their native
  resource type in application code.
- socket/API modules may not import islands, render channels, or browser
  components.
- `BeanieApp` may wire dependencies and request structural renders. It may not
  contain per-field hot-path mutation code.
- domain controllers remain DOM-free. Existing `ScannerFlow` and
  `ProfileEditorFlow` are explicitly UI coordinators until their form/focus
  reads are injected or moved to render/form owners. Workflow async lifecycle
  tokens belong to the controller/flow that starts the work, not to a render
  island.

### Static enforcement

`src/test/renderOwnershipGuard.test.ts` now AST-checks `app.ts` and controllers
for the presentation mutations moved by this migration, and
`renderGuard.test.ts` rejects raw markup sinks outside `src/render`. This is a
deliberately partial first enforcement layer. Expand it repository-wide to
flag outside a callsite-specific allowlist:

- assignments to `textContent`, `innerHTML`, `className`, `style.*`, `src`,
  `value`, or `checked`;
- `setAttribute`, `removeAttribute`, `classList.*`, DOM insertion/removal;
- `getContext`, canvas width/height mutation, and direct drawing;
- `new Image`, `createImageBitmap`, and object-URL creation;
- imports that violate the dependency direction above.

The current migration starts with an explicit baseline allowlist because `app.ts`
currently contains legitimate form and shell glue. The allowlist must name
call sites and shrink in each phase; a global count or regex with broad path
exceptions is not enough. Newly introduced violations fail CI immediately.

## Lifecycle integration

### Application start

1. Construct projectors, render channels, islands, and resource hosts.
2. Render the initial shell.
3. Reconcile island mounts and offer the initial models.
4. Subscribe presentation dispatch to the telemetry store.
5. Connect sockets.

This ordering prevents an early socket frame from targeting absent elements.
The store retains the newest snapshot, so no presentation state is lost before
mount.

### View or layout change

1. Morph the low-frequency shell.
2. Dispose owners for detached boundaries.
3. Mount replacement boundaries.
4. Offer current models.
5. Signal layout invalidation to surviving chart hosts.

Surviving canvas identity keeps the chart object; layout invalidation still
resizes/redraws it.

### Application disposal

The target disposal order is outside-in:

1. stop socket/repository producers;
2. unsubscribe telemetry listeners;
3. dispose render channels so no trailing commit can run;
4. dispose islands and resource hosts;
5. dispose charts, observers, images, and browser listeners;
6. remove shell-level delegated listeners.

Every newly introduced dispose method is idempotent because view changes and
application teardown can race. `BeanieApp.dispose()` now terminates the new
channels, UI-flow operation epochs, observers, image resources, and chart
backing stores; reorganizing all legacy teardown into the exact sequence above
is follow-up cleanup.

## Failure handling

- A malformed socket payload is rejected at ingestion and does not perturb the
  last valid presentation model.
- A projector failure is reported once with the responsible input revision; the
  last committed UI remains. It must not trigger an immediate retry loop.
- A missing island boundary leaves the newest model pending in memory and logs
  only when the boundary should structurally exist.
- A DOM commit failure does not advance the channel's committed model; a later
  explicit remount/reconcile may retry it.
- A disposed owner ignores late timers, RAFs, image loads, observer callbacks,
  and async model generation through a disposed/generation check.
- A canvas context failure must render a no-chart fallback and release the
  attempted backing store. `LiveChart` still throws at construction today, so
  binder-level fallback handling remains open.

## Test strategy

Passing the existing application suite is necessary but not sufficient. Tests
must exercise the boundaries directly with observable write/draw counters.

### Projector tests

- Water samples alternating around a discontinuous lookup boundary (including
  `49.9999` and `50.0001` mm) hold one displayed model until the raw-mm
  hysteresis boundary is crossed.
- A real water movement beyond the band updates once and establishes the new
  band.
- Steam/group noise inside their measured source-unit bands is held; a real
  change lands.
- Unknown -> valid and valid -> unknown transitions are immediate.
- Scale connected, disconnected, low-battery, and normal states each produce a
  complete and internally consistent text/class/title/ARIA model.
- Equality covers every view-model field.
- Projecting display values never changes raw shot or alert inputs.

### Render-channel tests with a fake clock

- Ten thousand equal offers after the initial commit produce one total commit
  and no scheduled callback.
- Ten thousand distinct offers inside one interval retain one pending model,
  one timer, and commit only the final model on the trailing edge.
- `flush()` commits once and cancels the trailing timer.
- Returning to the already committed model before the trailing edge produces no
  second commit.
- `dispose()` before the trailing edge produces no late commit and is safe when
  called twice.
- Offers after disposal are ignored.
- Reentrant offers from a sink cannot create two timers or corrupt the committed
  model.

### Island mutation-budget tests

Use real DOM element classes (not the current minimal fake) and instrument the
property setters or a `MutationObserver`:

- Initial topbar mount writes one complete model.
- Ten thousand stable telemetry presentations cause zero mutations.
- One scale disconnect changes label, tone, title, and ARIA state in one commit.
- Re-offering the committed model causes zero assignments, including class-list
  calls whose boolean result would be unchanged.
- Stable live readouts cause zero text writes; a changed formatted value touches
  only its owned element.
- An unchanged stage/reason revision causes zero class operations, layout
  reads, or scrolling.
- A stage transition updates the expected rows/reason and scrolls at most once.
- Morphing the shell does not mutate island descendants.
- Replacing/removing a boundary mounts/disposes exactly once.

### Morphdom and form tests

Run `morphRender()` against a DOM implementation that actually provides
`firstElementChild` and element constructors:

- every island descendant retains node identity and content across a shell
  morph;
- a focused textarea's live value and `defaultValue` remain distinct after a
  template-changing morph;
- moving focus within the form and morphing again cannot discard an unsaved
  draft;
- clean uncontrolled fields can adopt a new saved default;
- keyed canvases survive shell changes without their bitmap attributes being
  overwritten.

### Chart tests

- Repeated `invalidate()` calls schedule one RAF and draw once.
- `layout` invalidation resizes before drawing even when the canvas identity is
  unchanged.
- model, comparison, calibration, and theme revisions redraw a surviving
  chart.
- a model-equivalent bind does not redraw.
- backing-store width × height never exceeds
  `DEFAULT_MAX_BACKING_STORE_PIXELS` (within rounding), while aspect ratio is
  preserved.
- `dispose()` cancels RAF, removes each hover listener, clears retained state,
  and shrinks the bitmap to 1×1.
- no pointer, observer, or RAF callback draws after disposal.
- repeated mount/unmount cycles keep listener, chart, and canvas counts flat.

### Screensaver tests

- no slideshow timer runs while the photo overlay is unmounted or hidden;
- one transition retains at most active and incoming image leases;
- fade completion releases the outgoing source and object URL;
- a superseded load/fade callback cannot mutate the current layers;
- load failure retains the current image and releases the failed lease;
- dispose cancels both timers, clears handlers and sources, and revokes every
  owned URL;
- every imported `ImageBitmap` closes on success, missing context, encode
  failure, and thrown error.

### Integration and stress tests

- Replay 10,000 identical machine/scale/water observations through the real
  ingestion -> projector -> channel -> island path: after mount, DOM writes =
  0 and chart draws = 0.
- Replay noisy idle captures at original cadence for one hour of virtual time:
  numeric writes remain 0 after stabilization; clock writes match minute
  boundaries only.
- Replay an active shot at capture cadence: every measurement reaches
  `LiveShot`, while numeric commits stay within 10 Hz and chart draws stay
  within the configured frame budget. The final displayed values equal the
  last projected values.
- Walk every view/modal repeatedly: connected node, listener, observer, timer,
  canvas, and image counts return to the same baseline.
- Theme, phone/desktop, UI-scale, and DPR changes preserve chart instance where
  possible and cause exactly one coalesced layout/theme redraw.

## Device acceptance criteria

Desktop tests cannot validate the in-process WebView allocator. The release
bundle must pass on the real M50Mini (1340×800 landscape) against the live
gateway. Do not use a Vite/HMR page for memory acceptance because each full
reload can strand the previous page's GPU tiles.

### Instrumentation

Record at each sample:

- Android total PSS and `Graphics` from `dumpsys meminfo`;
- DOM node/listener counts from `Memory.getDOMCounters`;
- canvas count and dimensions/backing-store pixels;
- island commit counts, per-property mutation counts, chart draw counts, and
  pending channel count;
- JS heap for confirmation that a new regression is not a separate heap leak;
- current view, screensaver visibility, scale connection, and machine state.

### Idle-visible soak

1. Restart Reaprime once to establish a clean baseline; load the release skin.
2. Leave the workbench/topbar visible with the machine sleeping and scale
   disconnected for at least eight hours.
3. Sample every five minutes.
4. After temperatures stabilize, topbar numeric commits and live-chart draws
   must remain zero. Clock commits may occur once per minute when enabled.
5. DOM/listener/canvas counts must be flat.
6. `Graphics` must show no sustained positive slope. Normal sample noise is
   acceptable; a monotonic rise over six consecutive samples, more than 25 MB
   above the post-warmup band, or a fitted slope above 2 MB/hour fails the
   acceptance run and triggers source isolation before release.

### Screensaver-photo soak

Run the photo screensaver for at least two complete passes through the configured
set, then continue for eight hours:

- decoded display leases never exceed two;
- hidden-layer sources are released after each fade;
- photo index/timer count remains bounded;
- DOM/image element counts are flat;
- `Graphics` returns to a bounded band after each transition rather than gaining
  one photo-sized step per interval. The same 25 MB / 2 MB-hour failure bounds
  apply after warmup.

### Active-use cycle

Use recorded telemetry or the demo source for repeated UI cycles, plus at least
one user-initiated real shot (heating/pumping is never automated without the
user):

- live readouts, stage reasons, chart, finalization, history detail, comparison,
  stages modal, and calibrator all render correctly;
- display commit/draw rates stay within their budgets;
- after each view closes, chart instances/listeners/observers return to baseline
  and disposed canvases have 1×1 backing stores;
- twenty replayed mount/unmount cycles do not produce a monotonic Graphics,
  listener, or canvas-count increase;
- the real shot saves every measurement and the final UI matches the final
  telemetry state.

Acceptance artifacts are committed to the OOM investigation: build commit,
device/app versions, timestamps, conditions, raw sample table, mutation/draw
counts, and a conclusion. A short flat window is useful smoke coverage but does
not replace the eight-hour soak that matches the original failure timescale.

## Process-restart mitigation is a separate layer

The investigation found that active use can ratchet WebView `Graphics` memory
even after Beanie releases its resources, and that a page reload does not reset
the in-process GPU baseline. A Reaprime process restart does.

A scheduled restart while the machine is sleeping may therefore be a reasonable
operational mitigation for a tablet expected to run for weeks. It is not part of
the render architecture and it must not be used as proof that the architecture
is correct.

The distinction is:

| Render ownership architecture | Process-restart mitigation |
| --- | --- |
| Prevents redundant/new repaint and resource work. | Reclaims WebView/process allocations already retained. |
| Must make idle steady state flat. | May reset the baseline at a safe operational boundary. |
| Is testable with mutation, draw, lifecycle, and soak invariants. | Is validated by restart safety and restored state. |
| Ships in this repository. | Requires Reaprime/host lifecycle authority outside the skin. |
| Failure is an application defect. | Need may remain because of an engine defect. |

Do not add a reload/restart loop to Beanie. If the host adopts a nightly restart,
it must check machine sleeping/not brewing, preserve user-visible state, avoid
interrupting imports or settings writes, and be documented as mitigation for
the measured allocator behavior. The release still fails if idle Graphics rises
under stable conditions before that restart.

## Migration plan

The migration is incremental so each owner can be verified and old writers
deleted before the next surface moves.

### Phase 1 — Presentation core and topbar — **landed**

1. Add `RenderChannel`, fake-clock tests, and disposal/reentrancy coverage.
2. Add `TopbarProjector` and source-unit hysteresis tests, including the water
   lookup-boundary reproduction.
3. Introduce the complete `TopbarViewModel` and topbar island.
4. Route machine, scale, and water observations to one topbar channel.
5. Delete the alternate topbar DOM writer from `app.ts`/`livePath.ts`; the
   shell may seed initial markup only from the same complete current model.
6. Add a direct invariant test proving there is exactly one topbar writer.

Exit gate: 10,000 stable frames yield zero mutations; scale metadata changes
atomically; water boundary noise does not flap; all existing tests/build pass.

### Phase 2 — Live readouts and stage rail — **landed combined; optional split pending**

1. Mount an opaque combined `LiveReadouts` island behind a 10 Hz channel.
2. Gate numeric text and stage classes/reasons individually.
3. Change stage layout reads and updates from per-frame work to
   stage/reason/resize events, and reset the channel at shot boundaries.
4. Optionally split numeric and stage models if profiling or dependency
   cleanup justifies the extra boundary.

Exit gate: replayed active shot preserves all measurements, respects numeric
commit budget, and does zero stage work between stage/decision changes.

### Phase 3 — Managed charts — **resource and static-host lifecycle landed**

1. Land `LiveChart.invalidate()`, backing-store budget, and idempotent
   `dispose()`.
2. Give each binder a complete model key and let `LiveChart` own
   layout/DPR/theme/visibility sources.
3. Replace canvas-identity early returns with independent invalidation.
4. Keep the existing live composite RAF for now; unify it with chart
   invalidation if double-draw instrumentation shows meaningful overlap.
5. Stress mount/unmount and theme/layout changes.

Exit gate: chart instance reuse is preserved, every required invalidation draws
once, and teardown returns resources/counts to baseline.

### Phase 4 — Screensaver resources — **code landed; hardware gate pending**

1. Separate app-owned interval/index orchestration from island-owned DOM,
   callbacks, decoded-image leases, and fade cleanup.
2. Arm the interval only while visible, mounted, and eligible.
3. Make import bitmap cleanup exception-safe.
4. Add photo-cycle lifecycle tests; run the device soak in Phase 6.

Exit gate: no more than two display leases, no callbacks after disposal, and no
per-photo Graphics staircase.

### Phase 5 — Telemetry store and enforcement — **partial**

1. Finish replacing direct `AppState` mutation in socket handlers with the
   telemetry store and explicit structural events.
2. Narrow render/projector dependencies so none import `AppState` or gateways.
3. Add the AST ownership/dependency check with a reviewed migration allowlist.
4. Delete superseded timers, guards, element caches, and allowlist entries.

Exit gate: sockets have no DOM/render imports, new unauthorized DOM/native
resource writes fail CI, and the dependency graph follows this document.

### Phase 6 — Tablet acceptance and operational handoff — **pending hardware**

1. Run the idle-visible, screensaver-photo, and active-use protocols above on a
   release bundle.
2. Commit measurements and conclusions to the investigation docs.
3. Only after the idle path is proven flat, decide with the Reaprime owner
   whether a safe sleeping-time process restart is still warranted for retained
   active-use allocations.

## Alternatives considered

### Continue adding local guards and deadbands

Rejected as the primary design. Guards are necessary inside an owner, but the
water socket demonstrated that one missed writer preserves the leak. Local
deadbands also fail when applied after discontinuous conversion. The
architecture must make the correct path the only allowed path.

### Re-render all application state through morphdom on every frame

Rejected. Morphdom avoids many unnecessary DOM replacements, but creating and
diffing the full shell at socket cadence still couples input rate to UI work and
does not own canvas/image lifetimes. It also leaves resource invalidation
implicit.

### Use one global animation-frame render loop

Rejected. Surfaces have different useful rates and triggers. A single loop
wakes clocks, stage rails, charts, and hidden views together and makes it harder
to prove stable surfaces are silent. Small named channels provide clearer
budgets and disposal.

### Replace string views with a framework

Rejected for this problem. A framework could express components, but it would
not automatically provide source-unit hysteresis, latest-value sampling,
WebView-specific repaint budgets, canvas/image disposal, or process-level
memory recovery. Beanie already has pure views and delegated events; explicit
ownership can be added without risking domain behavior in a rewrite.

### Periodically reload the page

Rejected. Measurement showed that reloads, including Vite HMR full reloads, can
strand page tiles and do not reclaim the process baseline. Reloading may make
the problem worse during development.

### Periodically restart Reaprime instead of changing rendering

Rejected as a fix, retained as a separate possible mitigation. It recovers
memory but permits an application defect to consume resources between restarts
and can interrupt machine/user activity. Idle must be flat first.

## Definition of done

This architecture is complete only when all of the following are true:

- the topbar, live readouts, stage rail, charts, and screensaver each have one
  identifiable owner and no alternate writer;
- socket handlers ingest data and emit structural/domain events but contain no
  DOM or resource lifecycle code;
- projectors produce complete models and stabilize sensor data in source units;
- all streaming channels are latest-value, bounded, equality-gated, and
  disposable;
- chart and image resources have symmetric, tested lifetime behavior;
- real morphdom tests cover islands and uncontrolled form dirty state;
- static checks prevent new ownership/dependency violations;
- replay stress tests meet mutation/draw/resource budgets;
- the release build passes the M50Mini soak criteria and the evidence is
  committed;
- any Reaprime restart proposal is documented and evaluated separately from
  Beanie's render correctness.
