# Streamline Parity and MVP Todo

This todo is based on an audit of the installed Streamline skin at:

- `/Users/gilad/Library/Containers/net.tadel.reaprime/Data/Documents/web-ui/streamline.js/index.html`
- `/Users/gilad/Library/Containers/net.tadel.reaprime/Data/Documents/web-ui/streamline.js/src/modules/app.js`
- `/Users/gilad/Library/Containers/net.tadel.reaprime/Data/Documents/web-ui/streamline.js/src/modules/api.js`
- `/Users/gilad/Library/Containers/net.tadel.reaprime/Data/Documents/web-ui/streamline.js/src/modules/chart.js`
- `/Users/gilad/Library/Containers/net.tadel.reaprime/Data/Documents/web-ui/streamline.js/src/modules/history.js`
- `/Users/gilad/Library/Containers/net.tadel.reaprime/Data/Documents/web-ui/streamline.js/src/modules/shotData.js`
- `/Users/gilad/Library/Containers/net.tadel.reaprime/Data/Documents/web-ui/streamline.js/src/modules/profileManager.js`
- `/Users/gilad/Library/Containers/net.tadel.reaprime/Data/Documents/web-ui/streamline.js/src/modules/profile_selector.js`
- `/Users/gilad/Library/Containers/net.tadel.reaprime/Data/Documents/web-ui/streamline.js/src/modules/profile_editor.js`
- `/Users/gilad/Library/Containers/net.tadel.reaprime/Data/Documents/web-ui/streamline.js/src/modules/numpad-modal.js`
- `/Users/gilad/Library/Containers/net.tadel.reaprime/Data/Documents/web-ui/streamline.js/src/settings/settings.js`

Parity means Beanie can replace Streamline for daily use without forcing the user back to Streamline for routine machine operation, profile management, history, charting, settings, or diagnostics. It does not mean copying Streamline's layout. Beanie remains bean-first: wake, pick the bean, recover the last good dial-in, brew, annotate, iterate.

## Legend

- `[MVP]` Required before a public Beanie release.
- `[Parity]` Required for full Streamline replacement.
- `[Decision]` Product decision needed before implementation.
- `[Done]` Present in the current Beanie direction, though it may still need polish.

## Already Present in Beanie

- [Done] Bean-first home screen instead of Streamline's profile-first console.
- [Done] Last bean/profile/dose/yield/grind hydration from previous shots.
- [Done] Bean search and active-bean marking.
- [Done] Compact top machine status with sleep/settings affordances.
- [Done] Touch-first numeric input dialog for dose, yield, and grind.
- [Done] Grinder and grind are conceptually merged; grinder selection lives with the grind input flow.
- [Done] Shot history filtered by active bean.
- [Done] Shot detail modal with a larger chart.
- [Done] Enjoyment is highlighted when present and hidden when absent.
- [Done] Demo data exists for development and presentations.

## MVP Release Blockers

These are the minimum changes needed for a credible release to the Decent community.

- [MVP] Remove demo-data ambiguity in real Decent.app mode.
  - Show a clear "connected to Decent.app" or "demo mode" state.
  - Never silently mix seeded demo beans/shots with real gateway data.
  - Add a user-visible reset for local demo/cache data.

- [MVP] Harden ReaPrime/Decent API integration.
  - Wrap every endpoint used by Beanie with typed request/response guards.
  - Handle unavailable gateway, stale gateway, malformed responses, and reconnects.
  - Keep the UI useful when beans, batches, grinders, profiles, or shots partially fail.
  - Add visible retry states for workflow, beans, shots, profiles, and grinders.

- [MVP] Make workflow application safe and explicit.
  - Apply profile, dose, yield, grinder, grind, bean, and batch through one workflow patch path.
  - Show pending, applied, failed, and stale states.
  - Detect when Decent.app workflow changed outside Beanie and offer reload/apply-current choices.
  - Preserve unknown workflow fields when patching.

- [MVP] Complete bean and batch management.
  - Create, edit, archive, and search beans.
  - Create and select batches per bean.
  - Track roast date, opened date, remaining bag weight, and notes.
  - Show freshness/age compactly without consuming the main brew surface.
  - Support beans without batches, because real user data will be messy.

- [MVP] Complete grinder management.
  - Load grinders from Decent.app.
  - Create/edit/select grinder records.
  - Support numeric and free-form grind settings.
  - Remember last grinder per bean and per preset.
  - Make changing grinder possible from the grind input dialog.

- [MVP] Finish the dial-in controls.
  - Dose, yield, ratio, grind, brew temperature, and profile should be editable.
  - Tapping the displayed value opens the touch numpad/input dialog.
  - Plus/minus controls must be stable, fast, and usable without a keyboard.
  - All steps must obey configured increments and sensible min/max values.
  - Add ratio editing as an alternate way to update target yield.

- [MVP] Replace compact shot charts with a release-grade chart module.
  - Support historical shot charts and live shot charts through the same rendering path.
  - Plot pressure, flow, target pressure, target flow, temperature, weight, and weight flow when present.
  - Render profile step markers.
  - Keep charts readable on tablet landscape and smaller browser windows.
  - Decide whether to import Plotly like Streamline or keep a custom renderer with parity features.

- [MVP] Add live shot mode.
  - Subscribe to machine and scale WebSockets.
  - Detect an active espresso shot.
  - Show live elapsed time, weight, pressure, flow, and temperature.
  - Update the chart during the shot.
  - On shot completion, refresh history and keep the finished shot attached to the active bean.
  - Show a completion reason when known: target weight reached, target volume reached, manual stop, or elapsed profile end.

- [MVP] Make history dependable.
  - Paginate shot lists instead of assuming all shots fit in one response.
  - Lazy-load full shot records for visible rows.
  - Cache shot summaries and full measurement data in IndexedDB.
  - Refresh new shots after completion.
  - Delete/update local cache entries when shots are edited or removed.
  - Support old shots with missing bean IDs by matching roaster/name as a fallback.

- [MVP] Add shot detail actions.
  - Open detail view from any shot row.
  - Show full chart, recipe, profile, grinder, grind, notes, and enjoyment.
  - Reload a previous shot setup into the current bean workflow.
  - Edit shot notes and enjoyment.
  - Delete shot only behind a confirmation.

- [MVP] Add a minimal settings screen.
  - Gateway host/status.
  - Theme.
  - UI scale.
  - Auto-load behavior.
  - Demo data/cache reset.
  - Visualizer upload toggle if supported.
  - About/version/default-skin status.

- [MVP] Add release packaging.
  - Build static skin assets into a clean release directory.
  - Include `skin-manifest.json`.
  - Provide install/update instructions.
  - Add smoke test instructions for Decent.app and ReaPrime.
  - Keep seed data out of production builds unless explicitly enabled.

- [MVP] Add quality gates.
  - Unit tests for workflow patch creation, shot-to-recipe hydration, bean matching, and chart data transforms.
  - Browser smoke test against demo data.
  - Browser smoke test against a live Decent gateway when available.
  - Visual checks at 1366x768, 1920x1200, and a narrow desktop/tablet width.
  - Accessibility pass for tap targets, focus handling, modal traps, and color contrast.

## Machine Operation Parity

Streamline is a general machine console. Beanie intentionally hides some controls, but full replacement needs equivalent access somewhere.

- [Decision] Decide where machine commands live in Beanie.
  - Current design removed the large Brew/Tare/Stop row to save space.
  - Options: compact command drawer, settings/utility sheet, long-press power menu, or do not include start/stop at all.
  - For community release, omitting stop entirely may be unacceptable unless Decent.app chrome always remains available.

- [Parity] Espresso start/stop controls.
  - Mirror Streamline's `PUT /api/v1/machine/state/{state}` behavior.
  - Prevent double taps and reflect machine state immediately.
  - Show errors if a state transition fails.

- [Parity] Sleep and wake behavior.
  - Keep the compact power control.
  - Handle sleeping, idle, heating, espresso, steam, hot water, and flush states.
  - Restore display brightness/wake lock behavior when waking.

- [Parity] Scale handling.
  - Show connected/disconnected scale state.
  - Support tare.
  - Support scan/connect/reconnect flows.
  - Persist preferred scale device.
  - Show reconnect failures clearly.

- [Parity] Machine Bluetooth handling.
  - Scan for machines.
  - Connect to a selected DE1.
  - Show machine connection state and failures.
  - Persist preferred machine if the API supports it.

- [Parity] Non-GHC fallback controls.
  - Coffee, water, steam, flush, and stop controls for users without Decent GHC.
  - Compact layout that does not dominate the bean workflow.

- [Parity] Steam controls.
  - Steam duration.
  - Steam flow.
  - Fast/slow or profile mode where supported.
  - State feedback while steaming.

- [Parity] Hot water controls.
  - Volume.
  - Temperature.
  - Mode toggle where supported.
  - State feedback while dispensing.

- [Parity] Flush controls.
  - Flush duration setting.
  - Flush state feedback.

- [Parity] Machine readiness.
  - Subscribe to the time-to-ready plugin WebSocket when available.
  - Show heating progress and ready state.
  - Avoid wasting top-bar space when no meaningful readiness data exists.

- [Parity] Water tank and refill kit.
  - Subscribe to water level WebSocket.
  - Show tank level/status compactly.
  - Support refill-kit settings from the settings page.

- [Parity] Display and presence behavior.
  - Wake lock.
  - Brightness.
  - Screensaver.
  - Display dim/restore on sleep/idle.
  - Presence settings and schedules if the ReaPrime API exposes them.

- [Parity] Keyboard shortcuts.
  - Optional shortcuts for water, flush, stop, steam, espresso, profile picker, and tare.
  - Settings UI to view/edit/disable shortcuts.
  - Never let keyboard shortcuts fire while a modal/input is active.

- [Parity] Fullscreen and orientation prompts.
  - Respect tablet/fullscreen use.
  - Prompt on unsupported orientation.
  - Avoid prompts inside Decent.app if the shell already controls fullscreen.

## Charting and Shot Data Parity

Streamline's charting is one of its strongest pieces. Beanie needs this depth, but in the Beanie visual language.

- [MVP] Choose chart engine.
  - Option A: import Plotly, matching Streamline's proven implementation.
  - Option B: build a custom canvas/SVG renderer with the same trace coverage.
  - MVP should prefer the fastest reliable route unless bundle size or performance is a real blocker.

- [MVP] Historical shot detail chart.
  - Pressure.
  - Flow.
  - Target pressure.
  - Target flow.
  - Group temperature.
  - Target temperature.
  - Weight.
  - Weight flow.
  - Profile step markers.

- [MVP] Live shot chart.
  - Append telemetry points during the shot.
  - Keep axes stable enough to read.
  - Mark phase/step changes while brewing.
  - Recover gracefully if scale data drops.

- [Parity] Profile preview chart.
  - Show profile targets before applying.
  - Show step transitions.
  - Use the same chart grammar as shot detail when possible.

- [Parity] Shot phase summary.
  - Preinfusion time, grams, mL, temperature, flow, pressure.
  - Extraction time, grams, mL, temperature, flow, pressure.
  - Total time, grams, mL, temperature, flow, pressure.
  - Keep this out of the main screen unless it earns the space.

- [Parity] Chart themes.
  - Dark and light palettes.
  - High-contrast traces.
  - Grid and label colors that match Beanie, not Streamline.

- [Parity] Chart interaction.
  - Tap/hover readout.
  - Zoom/pan or reset if using Plotly.
  - Large chart must stay finger-friendly.

## Profile Parity

Streamline treats profiles as first-class. Beanie needs profile power without making profiles the primary workflow object.

- [MVP] Profile picker.
  - Search profiles.
  - Show current profile.
  - Preview profile graph.
  - Apply selected profile to the current bean workflow.
  - Preserve current bean/batch/grinder/dose/yield context when changing profile.

- [MVP] Favorite/recent profiles.
  - Show compact favorites or recents in the profile picker.
  - Hydrate from Streamline-compatible KV data if present.
  - Store Beanie favorites under a Beanie namespace.

- [Parity] Profile visibility.
  - Hide/unhide profiles.
  - Delete profiles with confirmation.
  - Reset bundled/default profiles if the API supports it.

- [Parity] Profile import.
  - Upload local profile JSON.
  - Import Visualizer share codes.
  - Validate profile shape before saving.
  - Show friendly errors for incompatible files.

- [Parity] Profile editor.
  - Create and edit profiles.
  - Edit steps/frames.
  - Edit target pressure/flow/temperature behavior.
  - Edit profile notes.
  - Save and apply from the editor.
  - This can ship after MVP if profile picker/import covers most daily use.

- [Parity] Profile metadata.
  - Read and write saved grinder setting metadata.
  - Avoid overwriting metadata keys owned by other skins.
  - Make any Beanie-specific metadata namespaced.

## Bean-First Additions Beyond Streamline

These are not Streamline parity items, but they are what make Beanie worth building.

- [MVP] Bean cockpit as the home surface.
  - The active bean is the main object.
  - Profile/dose/yield/grind are attributes of the active bean's next shot.
  - Last-used settings should be one tap away after wake.

- [MVP] Bean change workflow.
  - Search/tap another bean.
  - Load latest bean batch.
  - Load latest recipe from this bean's previous shot.
  - Show all matching shots and charts.
  - If auto-load is enabled, apply workflow safely.
  - If auto-load is disabled, stage changes and show an apply affordance.

- [MVP] Bean presets.
  - Save current setup as a bean-local preset.
  - Apply preset to current bean workflow.
  - Delete/rename preset.
  - Include profile, dose, yield, grinder, grind, and optional temperature.

- [Parity] KV-backed sync.
  - Move presets/favorites from local-only storage to ReaPrime store when stable.
  - Keep local fallback for offline/demo use.
  - Add migration from old localStorage keys.

- [Parity] Dial-in memory.
  - Show what changed from the previous shot.
  - Capture tasting notes and enjoyment.
  - Suggest next adjustments from history, without pretending to be more certain than the data supports.

- [Parity] Bean lifecycle.
  - Open date.
  - Bag size.
  - Remaining estimate.
  - Archive/finish bag.
  - Duplicate a bean for a new batch.

- [Parity] Shot clustering.
  - Group shots by bean and batch.
  - Fall back to roaster/name matching for legacy data.
  - Flag ambiguous matches.

## Settings Parity

Streamline's settings page is deep. Beanie needs a smaller MVP settings page first, then parity by category.

- [MVP] Settings shell.
  - Searchable settings screen.
  - Clear route back to the bean workflow.
  - Touch-friendly controls.
  - Save/apply/error feedback.

- [MVP] Skin settings.
  - Theme.
  - UI scale.
  - Demo mode and cache reset.
  - Default-skin status.
  - Version/build metadata.

- [MVP] Workflow settings.
  - Auto-load on bean change.
  - Confirm before overwriting workflow.
  - Preserve current profile when changing bean, if user prefers.
  - Preserve current grinder when changing bean, if user prefers.

- [Parity] Quick adjustments.
  - Flow multiplier.
  - Steam settings.
  - Hot water settings.
  - Water tank settings.
  - Flush settings.

- [Parity] Bluetooth settings.
  - Machine scan/connect.
  - Scale scan/connect.
  - Auto-connect settings.
  - Scale power mode.

- [Parity] Calibration settings.
  - Fan threshold.
  - Default load.
  - Refill kit.
  - Voltage.
  - Stop at weight.
  - Slow start.
  - Steam calibration.
  - Gate high-risk machine settings behind confirmation and plain language.

- [Parity] Maintenance settings.
  - Descaling.
  - Air purge.
  - Maintenance instructions or links where the API expects user action.

- [Parity] Skin management.
  - List installed skins.
  - Set default skin.
  - Update skins.
  - Avoid dangerous skin actions while Beanie is running unless tested.

- [Parity] Language/i18n.
  - Build translation infrastructure.
  - Decide whether to reuse Streamline's translation CSV.
  - At minimum, avoid hardcoded text that blocks later localization.

- [Parity] Extensions.
  - Visualizer enable/disable.
  - Visualizer credentials/settings.
  - Auto-upload minimum duration.
  - Plugin enable/disable/call endpoint wrappers.

- [Parity] Miscellaneous.
  - Screensaver.
  - Brightness.
  - Wake lock.
  - Presence.
  - Units.
  - Font size/UI zoom.
  - Resolution.
  - Advanced machine settings.
  - Keyboard shortcuts.
  - Smart charging if supported.

- [Parity] Updates and support.
  - App info.
  - Firmware info.
  - Firmware upload if appropriate.
  - User manual link.
  - Talk to Decent link.
  - Feedback submission.

## Data, Storage, and Sync

- [MVP] IndexedDB cache.
  - Shots.
  - Full shot measurements.
  - Profiles.
  - Beans/batches/grinders.
  - Cache versioning and migrations.

- [MVP] API schema normalization.
  - Normalize old/new workflow fields.
  - Normalize old/new bean/grinder fields.
  - Normalize shot measurement arrays.
  - Keep raw source records available for debugging.

- [MVP] Cache invalidation.
  - Refresh on shot completion.
  - Refresh on workflow apply.
  - Refresh on profile/bean/grinder mutation.
  - Manual reload button.

- [Parity] ReaPrime store/KV.
  - Namespaced Beanie settings.
  - Favorite profiles/beans.
  - Bean presets.
  - Last active bean.
  - Conflict handling if multiple clients edit settings.

- [Parity] Visualizer integration.
  - Detect plugin enabled state.
  - Save plugin settings.
  - Verify credentials.
  - Detect successful upload of a completed shot.
  - Show upload status in shot detail.

## Routing and App Structure

- [MVP] Keep main route fast.
  - Bean workflow renders quickly even with many shots.
  - Heavy views such as settings/profile editor load only when opened.

- [MVP] Add routes/views.
  - Main bean workflow.
  - Shot detail.
  - Profile picker.
  - Bean editor.
  - Settings.

- [Parity] Add advanced routes/views.
  - Profile editor.
  - Profile import.
  - Bluetooth/device setup.
  - Maintenance/settings subpages.

- [Parity] Browser navigation.
  - Back from detail/settings/profile views returns to current bean.
  - Route state survives reload.
  - Modal routes do not trap users after refresh.

## Responsive and Touch Quality

- [MVP] Tablet landscape first.
  - 1366x768 must be excellent.
  - 1920x1200 must use the space without bloat.
  - Text must never overlap controls or charts.

- [MVP] Compact desktop/narrow tablet.
  - Sidebar can collapse.
  - Shot list and chart remain usable.
  - Modals fit without keyboard.

- [Parity] Scaling system.
  - User-set UI zoom.
  - Stable fixed-format controls.
  - No layout shift when values change.

- [Parity] Portrait/orientation handling.
  - Prompt or adapt.
  - Do not show a broken main workflow in portrait.

- [Parity] Accessibility.
  - Keyboard focus order.
  - Button labels.
  - Modal focus trap.
  - Screen-reader useful labels for icon-only controls.
  - Color contrast in light/dark themes.

## Testing and Release

- [MVP] Unit tests.
  - Workflow patching.
  - Bean matching.
  - Latest-shot recipe derivation.
  - Shot chart transforms.
  - Preset serialization.
  - API normalization.

- [MVP] Integration tests.
  - Demo-mode boot.
  - Empty real gateway boot.
  - Real gateway with beans/shots/profiles.
  - Gateway offline.
  - Workflow apply success/failure.
  - Shot detail open/close.

- [MVP] Browser visual tests.
  - 1366x768.
  - 1920x1200.
  - Narrow desktop/tablet.
  - Number input dialog.
  - Shot detail chart.
  - Settings shell.

- [Parity] Real-machine test matrix.
  - Idle.
  - Heating.
  - Espresso active.
  - Espresso completion.
  - Steam.
  - Hot water.
  - Flush.
  - Sleep/wake.
  - Scale connected/disconnected.
  - Machine disconnected/reconnected.

- [MVP] Release artifacts.
  - Versioned zip/build folder.
  - Changelog.
  - Install instructions.
  - Known issues.
  - Feedback/support path.

- [Parity] Upgrade path.
  - Migrate local demo/development storage.
  - Migrate Beanie beta settings.
  - Do not disturb Streamline settings unless intentionally importing.

## Suggested Roadmap

### Sprint 0: Foundation Audit

- [MVP] Inventory all Streamline endpoints Beanie will use.
- [MVP] Write typed API wrappers and response guards.
- [MVP] Add IndexedDB cache skeleton.
- [MVP] Add real/demo mode separation.
- [MVP] Add release build script and manifest validation.

### Sprint 1: Bean MVP

- [MVP] Bean/batch/grinder CRUD.
- [MVP] Bean picker and batch picker polish.
- [MVP] Workflow apply state machine.
- [MVP] Bean presets.
- [MVP] Numeric dialog completion for dose/yield/ratio/grind/temp.

### Sprint 2: History and Charts

- [MVP] Paginated shot history.
- [MVP] IndexedDB shot cache.
- [MVP] Full shot detail view.
- [MVP] Release-grade chart module.
- [MVP] Shot notes/enjoyment editing.

### Sprint 3: Live Machine

- [MVP] Machine and scale WebSockets.
- [MVP] Live shot detection.
- [MVP] Live chart.
- [MVP] Shot-completion refresh.
- [MVP] Scale state and tare.

### Sprint 4: Profiles and Settings MVP

- [MVP] Profile picker with preview.
- [MVP] Favorite/recent profiles.
- [MVP] Settings shell.
- [MVP] Theme/UI scale/demo/cache settings.
- [MVP] Visualizer toggle if stable.

### Parity Wave 1: Machine Console

- [Parity] Optional command drawer for espresso/stop/water/steam/flush.
- [Parity] Non-GHC controls.
- [Parity] Time-to-ready.
- [Parity] Water tank.
- [Parity] Display/wake lock/brightness.

### Parity Wave 2: Profile Power

- [Parity] Profile import.
- [Parity] Profile hide/unhide/delete/reset.
- [Parity] Profile editor.
- [Parity] Profile metadata sync.

### Parity Wave 3: Settings Depth

- [Parity] Bluetooth/device setup.
- [Parity] Quick adjustments.
- [Parity] Calibration.
- [Parity] Maintenance.
- [Parity] Skin management.
- [Parity] Extensions.
- [Parity] Updates/support.

### Parity Wave 4: Polish and Internationalization

- [Parity] Localization.
- [Parity] Keyboard shortcuts.
- [Parity] Full scaling/orientation system.
- [Parity] Advanced accessibility pass.
- [Parity] Multi-client KV conflict handling.

## Open Product Decisions

- [Decision] Should Beanie expose espresso start/stop controls, or remain a bean workflow skin that assumes Decent.app/GHC controls are available elsewhere?
- [Decision] Should charts use Plotly for speed and parity, or a smaller custom renderer for tighter visual control?
- [Decision] How much of Streamline's settings depth belongs in Beanie before 1.0?
- [Decision] Should Visualizer integration be MVP or parity-only?
- [Decision] Should profile editing ship in 1.0, or is picker/import enough for the first public release?
- [Decision] Should Beanie import Streamline favorite-profile assignments automatically?
- [Decision] Should Beanie have its own KV namespace only, or offer one-time migration from Streamline keys?
- [Decision] What is the support stance for portrait/mobile browsers?
- [Decision] What exact Decent.app/ReaPrime versions are supported for the first release?
- [Decision] What must happen when the active bean's last shot references a profile/grinder that no longer exists?
