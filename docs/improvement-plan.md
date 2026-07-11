# Beanie Improvement Plan (2026-06-10 review)

A four-track review (shell, controllers/domain, views/components, api/data/tests)
produced a set of verified findings. The bug fixes and the highest-value
cleanups landed as the commit series ending at "Drop invalid collection items
instead of failing whole gateway reads". This file records what was fixed and
the items deliberately deferred, so future work can pick them up with context.

## Landed

- Test runner auto-discovers `src/test/*.test.ts` (no more manual import list).
- Cleaning cycle: failed cleaning starts no longer leave `cleaningInProgress`
  stuck (which swallowed the next real shot); cleaning workflows clear `beanId`
  so cleaning pulls are not recorded against the selected bean; bean selection
  skips service shots when deriving the dial-in draft.
- IndexedDB cache: collection order lists are authoritative (deleted
  beans/batches/grinders/profiles no longer resurrect from cache); stale keys
  are deleted in the same transaction; the connection reopens after
  `versionchange`; shot-end polling busts only the page cache instead of wiping
  all cached shot history.
- Shell: WebSocket machine/scale frames are validated like REST responses;
  `loadMoreShots` can no longer wedge pagination and the periodic refresh; the
  shot-cache generation is bumped before saves (stale-write window closed);
  `dispose()` clears the stop-feedback timer; all demo-settings guards go
  through `settingsLocal`.
- Controllers/domain: live-shot completion re-checks relevance after slow
  loads; the hot-water weight-target preference is written only after a
  successful weight-mode save; consecutive `frozen` storage events keep the
  earlier freeze; `heaterVoltage`/`refillKitSetting` persist as numbers;
  `beanFreshness` and `settingsModel` gained test suites.
- Components/api: `save`/`log-in`/`log-out` icons registered (with a test that
  scans `icon()` usage against the registry); profile editor −/+ nudges clamp
  to the same per-field bounds as the edit dialog; empty-string account email
  no longer reads as logged in; aborted Gemini calls propagate instead of
  reporting a network failure.
- July stabilization follow-up: settings reads now retain per-endpoint
  provenance and make unavailable/default sections read-only; failed plugin
  settings loads no longer synthesize demo credentials; workflow apply status
  is visible on tablet as well as phone; gateway timeouts cover body parsing;
  and Derek streaming has bounded duration, buffer, and answer sizes.
- Security/operations follow-up: local Vite and preview default to loopback,
  on-device commands opt into LAN binding explicitly, validation runs for pull
  requests/main, and release publication is isolated from the read-only build
  job. Gemini keys are device-local and legacy gateway copies are removed.
- Resilience/cleanup: collection guards drop invalid items (one bad gateway row
  no longer throws the app into demo mode at startup); dead
  `bean-editor`/`batch-editor` views, the constant-true `autoLoad` flag, and the
  unused demo-startup-snapshot code removed; `createShotBean` routed through
  `beanWorkflow.saveBean`; shot-metadata saves share `persistShotUpdate`; the
  detail/calibrator chart model is cached per shot instead of being rebuilt on
  every render.

## Deferred — architecture debt (ordered by value)

Per docs/architecture.md, workflow policy should leave `BeanieApp`. The biggest
liftable chunks, none DOM/timer-coupled:

1. **`freezeBatchPortion`** (app.ts, ~70 lines). The only batch flow bypassing
   `BeanWorkflowController`; has a partial-failure hole (createBatch succeeds,
   updateBatch fails → frozen batch exists remotely but never lands in state).
2. **`applyDraft`** (app.ts, ~66 lines). The core dial-in apply policy
   (request-id guards, draft-signature staleness, demo split, cache
   write-through) is fully testable with injected deps; the debounce timer
   stays in the shell.
3. **Shot-end pipeline** (`saveFreshnessForCompletedShot` first — a textbook
   `shotMetadataController` job; the optimistic list-merge policy in
   `onShotEnded`/`refreshShotsAfterLiveShot` later).
4. **`deleteShot`** → `shotMetadataController`; **`savePluginConfig`** secret
   merge → `domain/pluginSettings`; small optimistic one-offs
   (`setNoScaleBlock`, `setMachineRefillLevel`, `togglePlugin`, …) → their
   matching controllers.
5. **Shared demo/remote save helper.** Six controller save flows repeat the
   same skeleton (demo id minting, `(demo)` status suffix, fail-soft cache
   write). A `saveWithDemoFallback` helper would collapse ~150 lines.
6. **Profile (de)serialization out of `profileEditor.ts`** (the
   `readStep`/`writeStep`/alias tables, ~200 lines) into `domain/profileModel`.
7. **`hotWaterDataForNativeWorkflow`** and the thrice-duplicated
   `positiveNumber`/`formatNumber` helpers → `domain/waterSettings`.

## Deferred — smaller cleanups

- app.ts duplication: `beginBatchUpdate`/`finishBatchUpdate` sequence ×4,
  settings-bundle seeding ×3, numpad-dialog scaffolding ×3, gateway/cache dep
  literals rebuilt per call site.
- View helper duplication (~80 lines): `inputValue`/`round`, second-tap hint,
  load-more, date-label helpers across beanPickerView/phoneView/historyView/
  shotEditorView/machineView — one shared pure module.
- Views read the wall clock (`new Date()` defaults in freshness helpers,
  `todayDateInputValue`) — pass `now` through view models for deterministic
  rendering.
- `InputDialog` reads localStorage directly for recents — move to a domain
  storage helper, shell passes `recentValues` in.
- Dead `terms` search strings in SettingsShell/settingsModel sections (leftover
  settings search) — delete or wire up.
- `shotGraphModel` computes `maxY`/`hasData`/`missingSeries` that production
  discards; the fixed `maxY: 12` silently clips spikes — consider
  `Math.max(12, model.maxY)`.
- Consecutive `setState` calls in `machineAction`/`wake`/`stopHotWaterAtWeight`
  cause 2–4 full innerHTML rebuilds per action — coalesce where statuses allow.
- `cache.ts` writes `schemaVersion` per entry but never reads it — check on
  read or clear stores on version bump.
- Demo fidelity gaps: scanner extraction skips the empty-photos validation,
  demo shot lists ignore the selected batch, demo machine settings start
  undefined.
