# Changelog

## v0.3.1 - 2026-07-16

This release concentrates on long-running stability, recovery after interrupted
gateway operations, and making Beanie safer to evolve. It also includes a set
of focused workflow and interface refinements.

### Long-running runtime and rendering stability

- Reworked high-frequency rendering around DOM morphing, bounded update
  channels, and stable presentation islands. Live charts, the topbar, Derek
  streaming, profile editing, water alerts, and the screensaver can now update
  without repeatedly rebuilding unrelated parts of the page, replacing chart
  canvases, or losing scroll and input state.
- Added deterministic cleanup for charts, WebSockets, timers, background tasks,
  image object URLs, scanner images, and screensaver resources. Together with
  capped chart backing stores and suspension while charts are hidden, this
  addresses the known WebView graphics-growth paths
- Supervised gateway WebSockets now own reconnect, stale-callback rejection,
  validation, and shutdown across machine, scale, water, display, and shot-state
  feeds. A reconnect can no longer leave an old socket or delayed task competing
  with the current runtime.
- Cached shot graph models and coalesced live telemetry updates avoid rebuilding
  expensive chart data on every application render while preserving full shot
  detail.
- Added explicit lifecycle and render-ownership tests for chart canvases,
  screensaver images, streaming responses, topbar updates, background work, and
  socket replacement.

### Startup, history, and workflow recovery

- Offline startup now restores the selected coffee's bounded shot history from
  the local cache, including cached measurements where available. A temporarily
  unavailable gateway no longer makes legitimate recent shots disappear or
  substitutes demo records for the user's library.
- Startup and reconnect are now single-flight operations with stale-result
  fencing. Invalid collection rows are discarded individually, and a delayed or
  incomplete response cannot overwrite newer confirmed state.
- Loading a saved shot now carries its brew temperature into the next workflow.
  The skin also preserves the gateway's current workflow temperature during
  startup instead of replacing it with the default recipe temperature.
- Temporary workflow restoration is retried after reconnect, so a failed first
  attempt does not silently leave the machine on the wrong workflow.
- Live shots and dose deductions now follow the coffee and bag in the machine's
  confirmed workflow instead of the visible draft or a cached workflow. Scanning
  and saving a new coffee no longer silently makes it active; selection changes
  only after the user explicitly chooses it.
- Settings loaded from unavailable gateway endpoints retain their provenance
  and become visibly read-only, with Retry, instead of presenting fallback
  values as confirmed machine state. Failed optimistic saves roll back only the
  fields they owned, so newer edits remain intact.

### Inventory and shot integrity

- Hardened the durable mutation journal for dose deductions, dose reclaims, and
  shot deletion with reclaim. Retries retain the original bag weight and absolute
  target; ambiguous or divergent remote state stops for review instead of
  applying another delta.
- Inventory operations for the same coffee now share one ordered lane in each
  runtime. Delayed shot deductions, browser edits, split freezes, and reclaims
  are rebased against authoritative bag state so stale local completions cannot
  overwrite newer local intent.
- Delete-with-reclaim now records its transaction before deleting the shot and
  atomically hands the inventory slot to the reclaim worker after a successful
  delete, or after an owned retry confirms that the shot is already absent. If
  Beanie cannot durably protect the reclaim, it fails before deleting the shot.
- Startup discovers unfinished inventory work independently of the visible UI,
  overlays pending adjustments without turning them into cached truth, and
  reconciles acknowledgements created by another browser context.
- Browser-based bag updates no longer send the gateway's unsupported
  `Idempotency-Key` header. Retry safety comes from the local journal, original
  bag weight, and absolute target weight, with a fail-closed conflict when the
  remote bag changed unexpectedly.

### Workflow and interface refinements

- Refined profile selection on tablet: the first tap previews a profile and the
  confirming second tap loads it, with a discoverable hint while the gesture is
  being learned. Phone selection remains a direct single tap.
- Saving a profile now loads it immediately and returns to the workbench.
  Duplicate profile content is reported explicitly, profile notes have a proper
  multiline editor, and text-entry focus and caret position survive unrelated
  renders.
- Bean selection now prioritizes newly added coffees and coffees with the most
  recent shot, making the currently relevant bags easier to reach.
- Removed passive recipe apply-state badges for a quieter interface; persistent
  machine state remains available in the topbar.
- Added consistent keyboard focus indicators, reduced-motion support, disabled
  styling for unavailable settings, and several small layout and interaction
  fixes across profile editing, shot history, and Derek notes.

### Architecture, privacy, and release operations

- Extracted startup, inventory, live-shot completion, shot deletion, settings,
  machine actions, cleaning, profile application, editing, account sessions,
  the screensaver, calibration, and selection workflows from the application
  shell. `src/app.ts` is about 30% smaller while retaining one application state
  and one low-level gateway scheduler.
- Established a single gateway mutation scheduler with typed owners for machine
  commands, inventory, settings, workflow application, and deletion. Architecture
  guards now reject duplicate command paths, legacy mutation lanes, and forbidden
  dependency shortcuts—important protection when multiple AI agents maintain the
  repository.
- Centralized profile decoding and encoding for canonical Reaprime and imported
  de1app/Tcl formats, preserving unknown fields while preventing legacy aliases
  from leaking back into saved profiles.
- Moved Gemini scanner keys to device-local storage, migrated and removed legacy
  gateway copies, and added an explicit key-removal control. On-device image
  processing now has explicit decoded-pixel and concurrency bounds and reliably
  releases its resources. Scanner requests have bounded durations; Derek streams
  also have bounded buffers and answer sizes.
- Clearing the local cache now preserves synced preferences and intentionally
  device-local data such as the scanner key, theme, and screensaver photos.
- Local development and preview servers now bind to loopback by default; explicit
  LAN commands are required for tablet testing, and the known Decent development
  origin is allowed without opening Vite to arbitrary sites.
- Added browser smoke tests, architecture checks, storage/privacy coverage, and
  stricter CI and release validation. The release command now accepts an explicit
  version, requires matching changelog notes, verifies tests/build/manifest, and
  atomically publishes the release commit and tag.

## v0.3.0 - 2026-07-07

### Derek dial-in helper

- Added a Derek dial-in helper: from a shot's detail pane (or the topbar), tap taste chips ("sour", "too fast"…) and Beanie asks Derek — Decent's community-knowledge assistant — with your bean, grinder, recipe, and the shot's actual curve attached. The cited answer streams in live, and ends with one-change-at-a-time suggestion cards: pick one and "Use for next shot" applies it — grind/dose/yield/temperature changes stage straight into the recipe, and profile-level changes (peak pressure, preinfusion) generate a tweaked copy of the profile that the bean's recipe switches to. Requires a Decent.app build with the Derek relay; the buttons hide on gateways without it.
- Describing the shot is optional: tap "Ask Derek" with nothing selected and Derek reads the curve as-is and gives his own take on what (if anything) to change.
- Derek now sees the whole shot: every chart series (pressure, flow, weight, group temp, weight flow) at full sample resolution, not a thinned summary.
- Profile-tweak cards show a before/after mini-trace of what the change does to the planned curve, and suggestions the tweak engine can't apply to the loaded profile appear as advice-only cards instead of failing on tap.
- While a Derek tweak is staged, the workbench profile control offers a one-tap "Revert tweak"; it clears once a shot is pulled with it, the bean changes, or a profile is picked by hand.
- The change you applied is remembered and stamped onto the next shot pulled on that bean, so a later "Dial in" on that shot tells Derek what was already tried and how it turned out.
- Derek answers are saved on the shot they were asked about — reopen "Dial in" on that shot and the answer is right there, with "Ask again" for a fresh one. Shots with Derek notes carry a small sparkles mark in the history and phone lists.
- The tip you applied is saved on the shot too: loading that shot's recipe (second tap) brings the changed value along, highlights the control that carries it, and offers "Revert tweak" to load the recipe as it really was.
- Derek answers read cleaner: citation markers and the source list are gone, and the context chips show rounded values.
- The phone's selected-shot card gets its own "Dial in" button.

### Live stage rail & shot replay

- The live stage rail now reads its advance and stop reasons from the gateway's shotState feed instead of guessing: an app-issued weight skip is named authoritatively (with the projected weight that tripped it), firmware-natural exits describe the step's own exit/time/volume trigger from telemetry, and the shot-complete status reads the real stop decision — target weight/volume, API or app command, machine stop, error, disconnect, or no-scale abort.
- Redesigned the live stage rail as a stepper timeline: completed stages tick off with a check badge and an accent connector, the current stage stays highlighted, stages the pour hasn't reached recede, and each stage's advance reason shows as a chip tinted with the color of the chart series that triggered it (pressure green, flow blue, weight gold). The final stop chip is teal for a met target, amber for an abnormal ending, neutral for a plain stop.
- Pressing a saved shot's chart now opens a live-style stage replay: the full stage rail — every step with the reason it advanced — beside a full-size chart of the shot, with per-stage reasons rebuilt from the shot's trace and the persisted stop reason on the last stage.
- The rail keeps the current stage in view when a profile overflows it, shows a cleaning profile's steps during a cleaning cycle, freezes on the last stage at shot end labelled with the stop reason, and stays visible while a shot is saving.

### Sleep screensaver, glanceable topbar & clock

- Added a configurable sleep screensaver (modelled on de1app's saver page): when the machine sleeps, the wake-on-tap screen can show the classic dim black screen (default, unchanged), a clock, a photo slideshow, or photos with a clock. The clock wanders to a fresh spot to avoid burn-in; photos are picked from a device folder, downscaled, and stored on-device so the slideshow needs no network while the tablet sleeps; screensaver brightness is configurable (default 25%); and a Preview button shows the saver immediately. The setting syncs across devices.
- Made the topbar glanceable: the status stat is tinted by machine state (ready green, heating amber, service teal, asleep muted, error/offline/add-water red) and shows the live group temperature while warming up ("Heating 82→93°"). Every stat is now tappable — Group opens the brew temp editor, Steam the Steam·Water·Flush page, Water the water-level alerts, Scale tares or connects — and the machine-services button is renamed to Machine.
- Added a topbar wall clock (with its own toggle under Settings → App) and a Clock format setting — Auto / 12h / 24h — applied to both the topbar and screensaver clocks, since Android webviews don't always surface the tablet's 24-hour switch to the page.
- Moved the fallback steam/flush/hot-water start commands onto a per-lane Start button on the Steam·Water·Flush page, which already hosts their progress and stop controls.

### Charts & polish

- Added a mouse hover crosshair and values tooltip to shot charts, and let the shot-stages modal fill the screen on desktops.
- Made the AI bag-label scanner library-aware: it reuses the bean/roaster spellings and naming style already in your library instead of inventing new ones.

### Fixes

- Fixed the add-coffee form on mobile: reachable buttons and a tamed date field.
- Kept in-progress bean edits from flickering back to old values on re-render, and stopped the live stage rail flickering at shot end.
- Fixed cross-device edits being overwritten: bag updates (dose deduction at shot end, inline weight edits, freezes, finishing a bag) now send only the fields they change, so they can no longer revert freeze/thaw history or roast-date edits made on another device.
- Fixed a shot's bag deduction being silently lost when the gateway write failed: failed deductions are queued on-device and replayed against fresh bag state on startup or reconnect, without ever double-counting a shot.

## v0.2.9 - 2026-06-28

- Allow editing of all freeze/thaw dates.

## v0.2.8 - 2026-06-28

- Added live shot stage tracking: the live panel now shows a fixed vertical rail beside the chart listing every step of the running profile with the current one highlighted, and marks each stage's start with a labelled line on the chart so you can see where one phase hands off to the next.
- Overhauled the phone companion: safe-area insets are honored across the shell, pages, and overlays; machine, brew, power, and maintenance settings are reachable; the bean picker collapses into a single scrolling column; the profile picker gains search and per-row metadata; recipe and shot fields read as editable and show their apply state; the Shots tab gets a search box; the label scanner opens as a bottom sheet; and the live shot is shown rather than hidden.
- Improved the profile browser: import profiles from Visualizer, hide or delete profiles, toggle hidden profiles from a header eye button, and confirm deletes through a dialog that also offers to hide instead.
- Redesigned the shot detail header into facts and controls tiers with a clearer visual hierarchy — a prominent dose → yield, the brew ratio and brew temperature, and a small icon anchoring each fact.
- Removed the per-bean shot trends (sparkline) strip and its button.
- Remembered the tablet's "Set up on this device" scanner choice across reloads.

## v0.2.7 - 2026-06-20

- Added a cleaning wizard

## v0.2.6 - 2026-06-19

- Added a sleep-screen "wake app without the machine" tap zone: when enabled in Settings → App → Sleep screen, an edge strip (top, bottom, left, or right) appears on the tablet sleep screen, and tapping it opens Beanie while the machine stays asleep — the same view you'd get by opening the skin in a browser. The rest of the sleep screen still wakes the machine as before. The zone restores the screen brightness itself (the machine never wakes, so reaprime won't), and after 5 minutes of inactivity the screen turns back off and returns to the sleep screen. The setting syncs across devices.

## v0.2.5 - 2026-06-18

- Added global and per-profile flow calibration overrides: flow calibration is now an overridable default plus per-profile overrides keyed by profile title, modelled on the de1app Graphical Flow Calibrator.
- Anchored the live chart's time axis to the ghost shot's length when a ghost overlay is enabled
- Fixed the Settings brightness readout sometimes sticking at 0% after the screen woke.

## v0.2.4 - 2026-06-15

- Added a delete-shot dialog: removing a shot now offers to reclaim its dose back to the bag it was pulled from (adding the weight back, capped at the bag's size), delete without reclaiming, or cancel — replacing the bare confirmation prompt.
- Fixed espresso shots disappearing from history after a backflush: a cleaning cycle no longer leaves its "cleaning" beverage tag on the active workflow, so later pulls are recorded as espresso instead of being hidden as service shots.

## v0.2.3 - 2026-06-14
- Debugging changes

## v0.2.2 - 2026-06-14

- Fixed tap-to-wake on tablets where it silently fell back to button controls: Beanie now recognizes the reaprime webview by its embedded JS bridge rather than only the user agent, which some Android System WebView builds drop on first load.

## v0.2.1 - 2026-06-13

- Added shot comparison: overlay a second shot's measured curves (faded, thinner, legend-free) under the selected shot on the history detail chart — pick the comparison with one tap from the shot list and dismiss it from a chip on the chart.
- Added a per-bean trend strip showing raw sparklines of dose, yield, ratio, time, EY, and score across the loaded shots in brew order, plus a grind row when the stored settings parse as plain numbers.
- Added a ghost reference trace: when a pull starts, the armed comparison shot (or the shot open in the history pane) is drawn faded beneath the live curves so you can watch the pull track against the shot you're dialing toward; a Ghost button in the live panel toggles the overlay.
- Added raw shot stats under the history detail chart — peak pressure, average pour flow, average pour temperature, time to first drops, last measured weight, and post-stop drip — shown alongside the overlaid shot when comparing.
- Added a one-tap EY fill in the shot editor: a hint under the extraction-yield field shows the value derived from TDS, dose, and beverage weight, and fills it on tap.
- Added a low scale-battery readout: the topbar carries the scale battery percentage in its tooltip and surfaces it inline with a warning tone once it drops below 20%.
- Improved gateway resilience: WebSocket reconnects now back off exponentially, the status reads Offline with alert styling when the live connection drops, and a successful reconnect re-syncs beans and visible shots in case anything changed during the outage.


## v0.2.0 - 2026-06-11

- Added bean freshness and storage tracking: each bag records its roast date and freeze/thaw history, and Beanie reports roast age, active age (paused while a bag is frozen), and remaining weight.
- Redesigned the bean stock picker into a single bag list where you select, freeze, finish, and edit a bag inline from its row, with a freeze stepper for weighing how much goes into the freezer (partial freezes split the bag).
- Added bean favorites that pin coffees to the top of the picker.
- Redesigned the dashboard title bar around the active coffee — name, roaster, remaining grams, an estimated shots-left count, and roast age — with the whole bar opening the bean picker.
- Added automatic bag depletion: a bag's remaining weight now decreases by the shot dose each time you pull a shot.
- Added active age and an estimated shots-left count to each coffee in the bean list.

## v0.1.7 - 2026-06-07

- Added an AI bag-label scanner that can photograph a coffee bag, extract bean and batch details with Gemini, review low-confidence fields, and save the confirmed result into the existing bean workflow.
- Added phone support and a dedicated phone companion layout so Beanie can be used from smaller screens during scanning and companion workflows.
- Refactored Beanie's app architecture into clearer shell, controller, domain, data, component, and view boundaries, with broader tests around the extracted workflows.

## v0.1.6 - 2026-06-06

- Added hot water scale stop mode.
- Added a machine-page cleaning/backflush cycle with compact footer controls and easier profile selection.
- Improved topbar controls with larger labeled actions, visible tablet labels, centered labels, and a clearer Dispense button.
- Improved scale handling with top readout connect/tare actions and preferred device auto-connect.
- Improved low-water alerts with soft and hard warnings.
- Improved startup and shot history behavior with cached startup collections, selected-batch filtering, stale request guards, and safer shot cache writes.
- Improved bean workflow by prefilling new beans from existing beans and reading recorded flow calibration from workflow machine data.
- Improved live shot chart rendering by drawing at full detail-chart resolution.

## v0.1.5 - 2026-06-06

- Added a themeable skin system with new Decent, Acaia, Espresso, Nord, Solarized, Dracula, Gruvbox, and Rose Pine themes.
- Added Decent account settings, login failure messaging, presence heartbeats, and Visualizer back-sync controls.
- Improved shot history sync with visible auto-refresh, cached shot refreshes from summaries, gateway history page imports, and reduced refresh polling.
- Added scale availability warnings across brew flows, including machine status messages, blocked-shot messaging, and a no-scale popup.
- Improved live shot and saved-shot handling by keeping the shot screen open until the saved shot is ready, showing target dose/yield when actual values are zero, and clarifying imported zero-yield rows.
- Added bean and bag editing improvements, including editing bean, roaster, and batch together, selecting the latest bag batch, and adding beans from the shot editor.
- Added timed steam stop handling with flow-based timer start, heating/purging states, explicit steam rinse purge behavior, and tuned stop controls.
- Added per-shot flow calibration support and expanded tests for gateway, settings, shot records, bean workflow, timed steam stop, and calibration behavior.
