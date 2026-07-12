# Beanie Improvement Plan (2026-07-12 architecture review)

This plan combines the original four-track review with the architecture and
runtime-consistency implementation reviewed on 2026-07-12. It records what is
actually implemented and the remaining debt in value order, so future human or
AI-agent work does not infer completion from extracted filenames alone.

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
- Architecture extraction: one `GatewayMutationCoordinator` now owns command
  scheduling; `MachineWorkflowCommands` is the typed authority for physical
  mutations; and recipe apply, settings-store sync, cleaning execution, machine
  action, and machine-service lifecycles have dedicated controllers/flows.
  Controllers expose narrow snapshots/events/outcomes rather than `AppState`.
  Targeted settings-bundle operations preserve unrelated concurrent edits on
  rollback, and `commandArchitectureGuard.test.ts` protects the ownership
  boundaries. See [architecture.md](architecture.md#mutation-and-machine-command-topology)
  for the command and state invariants.
- Architecture extraction phase two: `BeanInventoryController` now owns stock
  creation, edits, storage, finishing, and whole/split freezes with targeted
  rollback and authoritative partial-failure reconciliation;
  `LiveShotCompletionFlow` owns shot-end routing, polling, fallback, freshness
  and Derek-context persistence; and `SettingsMutationFlow` owns optimistic
  settings revisions and monotonic confirmed rollback baselines. Delayed dose
  deductions and every inventory write share the canonical per-bean lane, and
  the architecture guard rejects legacy `batch:<id>` lanes. The inventory
  facade is split into a type-only contract, deterministic policy, and one
  imperative sequencer; ambiguous creates preserve their complete retry intent,
  and queued partial freezes rebase from authoritative source weight while
  fencing delayed dose/UI projections.
- Architecture extraction phase three: `StartupFlow` owns single-flight
  boot/reconnect and its capability matrix, while dose-journal hydration runs
  independently so blocked IndexedDB does not block presentation. Foreground
  inventory writes fail closed until legacy migration and durable discovery
  have reserved and overlaid every unsettled adjustment; hydration failures
  retry. Dose physical identity is bean/batch/dose, with `at` and
  `expectedRemaining` retained from the first admission. Legacy migration gates
  live and volatile ordering, volatile duplicates rebase to canonical metadata,
  and one context can observe another context's acknowledged tombstone and
  settle locally without a second write. Inventory reads preserve omitted
  protected batches and UI-owned fields, update confirmed baselines only across
  the correct read/mutation boundary, and sanitize or omit cache writes so
  optimism cannot become offline truth. Plugin state is allowlist-sanitized and
  session/revision/touched-field fenced.
- Architecture extraction phase four: reclaiming shot deletion now persists a
  shot-scoped transaction in the existing mutation outbox before DELETE. The
  transaction occupies the bean inventory's causal slot, is claimed only
  inside the exact shot lane, and atomically hands that slot to the ordinary
  dose-reclaim worker after a 2xx response or owned 404. Restart discovery
  classifies sources and released children from one outbox snapshot, restores
  non-overlaying stock reservations, and seeds replay ownership before a
  cross-context handoff can hide the source;
  unavailable durable storage or untracked remaining weight fails before
  DELETE. An admitted reclaim intent cannot be bypassed by a later bare delete,
  while deterministic child conflicts terminate into explicit inventory review
  instead of blocking a bean forever. Graceful shutdown drains deletion and
  journal/dose work before releasing waiters and closing the shared gateway
  coordinator. True cross-device exactly-once still requires gateway DELETE
  receipts.

## Deferred — architecture debt (ordered by value)

Per [architecture.md](architecture.md), workflow policy should leave
`BeanieApp`. At 10,000+ lines, `src/app.ts` is safer than before but is not yet
a manageable small shell for a repository maintained primarily by AI agents.
The remaining work starts here:

1. **Extract `BeanSelectionFlow`.** Move selection mode/provenance, batch and
   shot acquisition, effective-bag restarts, recipe scheduling, and stale-result
   fencing behind one narrow controller-owned contract.
2. **Extract `DoseDeductionAdmissionFlow`.** Move completed-shot dose intent,
   reservation, durable admission, optimism/canonicalization, cache projection,
   and release out of `BeanieApp` while retaining the existing reconciler and
   inventory authorities.
3. **Cached offline shot hydration.** `StartupFlow` uses cached latest shots for
   bean usage and initial selection, but its cached projection does not populate
   the shell's shot list. Define the selected-bean/batch filtering contract and
   publish the cached page so History is useful during a cold offline start.
4. **Harden settings contracts.** Replace plain-string field keys and cast-built
   patches with group-indexed keys. Make public cache/repository/settings
   capability parameters required and fail closed instead of defaulting true.
5. **Expose inventory-journal readiness in the stock UI.** Runtime adapters and
   submit handlers fail closed, but bag mutation controls still look enabled
   until the user clicks and receives the read-only status. Pass an explicit
   capability into the bean-picker/storage views and disable only mutation
   controls while preserving inventory browsing.
6. **Finish controller boundary injection.** Remove gateway/cache singleton
   imports from scanner, Derek, and profile-editor flows; move scanner
   `location`/`document` and profile-editor `HTMLElement` access behind shell
   adapters.
7. **Remaining optimistic one-offs.** Move `setMachineRefillLevel` to its
   matching controller with revisioned confirmed rollback and stale-result
   fencing.
8. **Shared demo/remote save helper.** Six controller save flows repeat the
   same skeleton (demo id minting, `(demo)` status suffix, fail-soft cache
   write). A `saveWithDemoFallback` helper would collapse ~150 lines.
9. **Profile (de)serialization out of `profileEditor.ts`** (the
   `readStep`/`writeStep`/alias tables, ~200 lines) into `domain/profileModel`.
10. **`hotWaterDataForNativeWorkflow`** and the thrice-duplicated
   `positiveNumber`/`formatNumber` helpers → `domain/waterSettings`.

## Deferred — smaller cleanups

- app.ts duplication: settings-bundle seeding ×3, numpad-dialog scaffolding ×3,
  and gateway/cache dependency literals rebuilt per call site.
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
- Consecutive shell projections around wake and hot-water weight-stop outcomes
  can still cause multiple full innerHTML rebuilds — coalesce where statuses
  allow without moving lifecycle ownership back into `BeanieApp`.
- Shot-cache invalidation remains auxiliary after the atomic delete/reclaim
  handoff. A crash in that final interval cannot lose inventory work, but an
  offline restart may show stale history until a connected refresh; a durable
  cleanup marker would close that presentation-only gap.
- `cache.ts` writes `schemaVersion` per entry but never reads it — check on
  read or clear stores on version bump.
- The production JavaScript bundle is about 839 KB minified and still trips
  Vite's 500 KB warning — split infrequently used settings/editor/scanner
  surfaces behind dynamic imports without fragmenting runtime ownership.
- Demo fidelity gaps: scanner extraction skips the empty-photos validation,
  demo shot lists ignore the selected batch, demo machine settings start
  undefined.
