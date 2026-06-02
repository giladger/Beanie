# Profile Editor — de1app Carbon-Copy Workplan

**Goal:** make Beanie's profile editor a *functionally exact* copy of the de1app
(Decent tablet) profile editor — every field, range, step model, the simple
pressure/flow editors, the advanced step editor, the limits tab, the
simple↔advanced compiler, and the live "explanation" chart — rendered in
Beanie's own responsive CSS (not the tablet PNGs).

Decision recorded 2026-06-02: **fidelity target = functional-exact, beanie-styled.**

---

## 1. The two editors, side by side

### de1app (authoritative reference — Tcl/Tk)
Source: `de1app/de1plus/profiler.tcl`, `profile.tcl`, `vars.tcl`,
`de1_skin_settings.tcl`, `gui.tcl`, `machine.tcl`.

- **Three profile types**, keyed by `settings_profile_type`:
  - `settings_2a` — **Pressure** simple (preinfuse → pressurize → decline + limits)
  - `settings_2b` — **Flow** simple (preinfuse → hold → decline + limits)
  - `settings_2c` — **Advanced** (ordered list of step dicts in `advanced_shot`)
- **Simple editors edit scalar params** (`preinfusion_time`,
  `preinfusion_stop_pressure`, `espresso_pressure`, `espresso_hold_time`,
  `espresso_decline_time`, `pressure_end`, `flow_profile_hold`,
  `flow_profile_decline`, per-phase `espresso_temperature_0..3`, `maximum_flow`,
  `maximum_pressure`, …) and **compile them to `advanced_shot` steps** via
  `profile::sync_from_legacy`. The scalars are persisted so the simple editor
  can re-open with the original slider values.
- **Advanced step editor** (`settings_2c`): per step — `name`, message/`popup`,
  `temperature` (−30..105, 0.5°), `sensor` coffee/water, `pump` pressure/flow,
  `pressure` (0..11) / `flow` (0..8), `transition` fast/smooth, `seconds`,
  `volume` (0..2000), `weight` (0..2000), four "move on if" exit conditions
  (`exit_type` ∈ pressure_over/under, flow_over/under with the four stored
  `exit_*` values), and an optional per-step limiter
  (`max_flow_or_pressure` + `max_flow_or_pressure_range`). Step list supports
  add (insert-after-current, copies settings), delete (min 1), reorder; **max 20
  steps**.
- **Limits tab** (`settings_2c2`): `tank_desired_water_temperature` (0..45),
  `final_desired_shot_volume_advanced_count_start` (which step starts volume
  tracking), `final_desired_shot_volume_advanced`,
  `final_desired_shot_weight_advanced`, and global limiter ranges
  (`maximum_flow_range_advanced`, `maximum_pressure_range_advanced`).
- **Live explanation chart** (`update_de1_plus_advanced_explanation_chart`):
  pressure + flow + temperature over cumulative time, **fast = vertical jump,
  smooth = linear ramp**, with the selected step highlighted.

### Beanie today (`beanie/src/components/profileEditor.ts`, 1292 lines)
- Has the *shape* of all three editors (`renderSimpleProfileEditor`,
  advanced `renderStepDetail`, an SVG chart) but the internals are shallow.
- **Two disconnected implementations.** `src/domain/profileEditor.ts` (693 lines,
  `ProfileEditorModel`/`normalizeProfileForEditing`/`serializeProfileEditor`) is
  **dead** — only `src/test/profileEditor.test.ts` imports it; the live UI uses a
  separate `ProfileEditorState` in `components/` and never calls the domain layer.
- **Simple editor is a guess, not a model.** `simpleProfileModel()`
  (≈line 1047) infers preinfuse/main/decline indices from pump modes; profiles
  that don't match the assumed layout collapse. There is **no** simple→advanced
  compiler.
- **Chart isn't faithful** — flat stepped SVG, no fast/smooth interpolation.
- **innerHTML god-class re-render** (`app.ts` `editorDispatch` → `setState` →
  full innerHTML) drops input focus and slider drag mid-interaction. This is the
  primary "feels broken" symptom.

### Capability gap
| Capability | de1app | beanie today |
|---|---|---|
| Simple pressure editor (`settings_2a`) | full | stubbed inference |
| Simple flow editor (`settings_2b`) | full | stubbed inference |
| Advanced per-step editor (`settings_2c`) | full, 20 steps | partial, shaky state |
| Limits tab (`settings_2c2`) | full | missing as a screen |
| simple ⇄ advanced compiler (`sync_from_legacy`) | core | absent |
| Live chart fast/smooth interpolation + step highlight | yes | crude |
| Per-step limiter + 4 exit conditions | yes | shallow |
| read-only clone-on-save, change tracking | yes | absent |

---

## 2. The gateway constraint that shapes everything

Beanie does **not** talk to de1app. It talks to **reaprime** (the forked base,
`reaprime/lib/src/models/data/profile.dart`), whose wire format is the
**pyde1 v2 profile JSON** — which is *already exactly what Beanie's `Profile`
type uses*: `steps[]` of
`{name, temperature, sensor, pump, transition, pressure|flow, seconds, volume,
weight, exit:{type,condition,value}, limiter:{value,range}}` (values are
stringified numbers), plus top-level `title, author, notes, beverage_type,
target_weight, target_volume, target_volume_count_start, tank_temperature,
version`.

**Critical:** reaprime's `Profile.toJson()` / `ProfileStep.toJson()` emit
**only** that fixed field set. On any create/update round-trip the gateway
**drops**:
- `type` and `legacy_profile_type` (so the profile "kind" is not persisted),
- per-step `message`/`popup`,
- the three "inactive" exit values (only the single active `exit` survives —
  which is fine, it matches execution),
- **every scalar simple-profile param** (`espresso_pressure`,
  `preinfusion_time`, …).

Consequences:
1. **The advanced editor can be an exact functional carbon copy.** Every step
   field reaprime stores maps 1:1 to a de1app step field. The only two losses
   (per-step message, remembered-but-inactive exit values) are execution-irrelevant.
2. **The simple editors cannot round-trip perfectly against the current gateway**
   without somewhere to keep the scalar params and the profile "kind". This is the
   one true blocker for a literal carbon copy and needs a decision (Phase 2 gate).

### Phase 2 design — derive, don't store (RESOLVED)

Storing the simple-profile scalars anywhere (in a KV sidecar **or** in the
reaprime `Profile` model) is unsafe: the scalars are a *derived view* of the
steps, so any other client that edits the steps without rewriting the scalars
leaves them lying. This is not hypothetical — it is the documented "lever-trio"
drift bug in reaprime's own curation audit (de1app stored `settings_2a` scalars
that contradicted the file's `advanced_shot` steps). It also collides with a
stated reaprime stance (*"the TCL-based profile format in de1app is not
authoritative for profiles here"*, `CLAUDE.md`) and the content-addressed
identity design — so it would likely (rightly) be rejected upstream.

**Resolution: steps are the only source of truth. The simple editor is a live
view computed from the steps, never a stored copy. Nothing is persisted beyond
the canonical `steps[]` — no scalars, no `type`, no upstream change.**

- **Open-as-basic-if-possible, advanced otherwise, with an always-present
  Advanced button.** Which editor opens is decided by parsing the steps, not by a
  stored tag.
- **The guard that makes "if possible" trustworthy (not a guess):** offer basic
  mode **iff `compile(parse(steps))` reproduces the original `steps` exactly.** A
  Beanie-made simple profile round-trips and opens basic; a hand-built advanced
  profile that merely looks 3-stage fails the check and opens advanced. No false
  positives → basic mode can never silently mangle advanced work. (This replaces
  the broken heuristic `simpleProfileModel` stage-guessing.)
- **Direction-aware toggle (one-way door, as in de1app):** *Advanced* is always
  available (simple→advanced just reveals the compiled steps). *Basic* is offered
  only while the current steps still pass the guard; advanced edits that break the
  canonical shape disable it.
- **"Fits basic" is a strict pattern:** single temperature across steps; optional
  leading flow preinfuse with a pressure-over exit; a hold step (pressure for
  pressure-type, flow for flow-type); a smooth decline. Anything else → advanced.
- **Safer than de1app**, which trusts a stored `settings_2a` tag even when the
  steps have drifted from it (the lever-trio failure mode). Deriving + verifying
  from live steps each time cannot make that mistake.
- **Carbon-copy scope:** we reproduce the editor's *knobs/ranges/UX* exactly. The
  step decomposition beneath is Beanie's own clean, invertible one (same curve,
  cleaner bytes) — we do not copy de1app's messier internal step layout.
- **Tunable, later:** the guard uses *exact step equality* (max safety; opens some
  imported de1app simple profiles as advanced because their compiler emits
  slightly different steps). Optionally relax to *curve equivalence* (same
  pressure/flow/temp-vs-time within tolerance) to catch more imports. Ship
  exact-equality first.
- **Optional polish (not required, never authoritative):** remember the user's
  last-chosen editor as a client-side preference (localStorage by profile id); if
  it ever disagrees with the guard, the guard wins.

No decision blocks Phase 2 anymore; it can ship without any reaprime change.

---

## 3. Is an exact carbon copy possible? — verdict

- **Advanced editor + limits tab + live chart: yes, exactly.** All data is in the
  wire model; it's a rewrite of Beanie internals, not new protocol.
- **Simple pressure/flow editors: yes, behaviorally** — once Phase 2's
  scalar-persistence decision is made. The de1app compiler is portable and
  deterministic.
- **Pixel-identical tablet visuals: out of scope by decision** (functional-exact
  in Beanie styling).

---

## 4. Phased workplan

### Phase 1 — Unify the model, delete the dead layer ✅ *(done 2026-06-02)*
- Established the live `ProfileEditorState` in `components/profileEditor.ts` as the
  **single source of truth**; folded the dead domain layer's one unique
  capability — reading de1app Tcl-derived input — into it:
  `createProfileEditorState` now reads `advanced_shot` (fallback for `steps`),
  `profile_title`/`profile_notes`, `final_desired_shot_*` and
  `tank_desired_water_temperature` aliases; `readStep` folds flat
  `exit_if`/`exit_type`/`exit_*` and `max_flow_or_pressure` into the nested
  `exit`/`limiter` model. It always **writes** canonical reaprime v2 (nested
  `exit`, `steps[]`), and consumed Tcl keys no longer leak into output.
- **Deleted** `src/domain/profileEditor.ts`; migrated its 6 tests to live-model
  equivalents. All 41 tests pass, typecheck clean.
- Added the centralized **`FIELD_SPECS`** table (min/max/step/default/unit per
  field) from de1app `machine.tcl`/`vars.tcl` — the backbone for later phases.
- **Deferred (cosmetic):** physically moving the model out of `components/` into
  `domain/` so components becomes render-only. Low-risk mechanical step; left for
  a later pass to avoid churning `app.ts`/test imports now.

> **Phase 2 is unblocked** — the "derive, don't store" design in §2 needs no
> reaprime change and no persistence decision. Phases 3–6 are independent too.

### Phase 2 — simple ⇄ advanced compiler + auto-detect (see "Phase 2 design")
Built on branch `feature/profile-editor-phase2` (worktree `../beanie-phase2`).

**2a — pure engine ✅ (done):** `src/domain/simpleProfile.ts` —
`compileSimpleToSteps(knobs, type)`, its inverse `parseStepsToSimple(steps)`
(null = not canonical simple), and `canEditAsBasic(steps)` = parse succeeds AND
`compile(parse(steps))` reproduces the steps (off-axis value ignored — it never
reaches the machine). Step names are carried through the knobs so the round-trip
is byte-faithful. Tests in `src/test/simpleProfile.test.ts`: pressure & flow
round-trips, edit-stays-basic, and rejection of every distinct 3-step shape in
the reaprime default library. A one-time fs sweep this session confirmed all 70
bundled defaults classify as advanced (zero false positives); the committed test
uses browser-pure inline fixtures (project has no `@types/node`). 77 tests green,
`tsc` clean.

> **Library finding:** *every* reaprime default profile is `type: "advanced"` —
> the importer flattens simple profiles to steps. So auto-basic essentially only
> triggers for profiles authored in Beanie's own simple editor; existing/imported
> profiles open advanced (correctly). Basic mode is a *creation* tool, not
> something that lights up for the bundled library.

**2b — UI wiring (next):** replace the broken `simpleProfileModel` stage-guessing
in `components/profileEditor.ts` with the engine; drive editor open-logic and the
Basic/Advanced toggle from `canEditAsBasic` (Advanced always available; Basic only
while the guard holds).

### Phase 3 — advanced step editor parity ✅ *(done)*
- Per-step controls all present: name, message, temperature, sensor toggle, pump
  toggle (pressure-goal vs flow-goal), value, transition, seconds, volume,
  weight, four exit conditions, per-step limiter value **and range**. Exit model
  is single-active and serializes to the one nested `exit`.
- Step controls **redesigned** as compact cards (commit `d5ba483`); add =
  insert-after-current copying settings; delete (min 1); reorder; **capped at 20**
  (commit `d8fe19b`).

### Phase 4 — limits parity ✅ *(done)*
- Dedicated **Steps / Limits sub-tabs** in the advanced editor (commit `6061005`,
  de1app `settings_2c2`). The Limits panel holds tank temperature,
  preinfusion-ends-after (`target_volume_count_start`), stop-at-volume,
  stop-at-weight, plus a global **Limiter range** applied to every limited step.
- Per-step limiter **range** also editable as a card on the step itself when a
  limiter is set (commit `d8fe19b`). Identity row keeps name/author/type/
  beverage/notes.

### Phase 5 — live explanation chart parity ✅ *(done, `f61a6ae`)*
- Pure, tested `profileChartModel.ts`: fast = vertical jump + hold, smooth =
  linear ramp; pressure/flow/temperature traces (temp starts at first target);
  selected-step highlight from per-step spans. Both charts use it.

### Phase 6 — rendering robustness ✅ *(done, `776dfa4`)*
- Range-slider `input` now updates state silently and patches the readout in
  place (keeping the dragged element alive); the single full re-render is
  deferred to `change`. Exit sliders disambiguated in `captureFocus` by
  type+condition. Scroll/focus restore already existed.

### Phase 7 — save / clone / validation ✅ *(done, `ec06556`)*
- Editing a reaprime default (`isDefault`) saves a child clone via
  `createProfile({ parentId })`; normal profiles update in place. Pre-save
  validation blocks an empty name / no steps with a status message.

### Phase 8 — tests & verification 🟡 *(ongoing)*
- Done: simple↔advanced compiler round-trips + guard rejection set
  (`simpleProfile.test.ts`), chart-model interpolation (`profileChartModel.test.ts`),
  Tcl-input/serialization and 20-step cap (`profileEditor.test.ts`); 86 tests
  green, `tsc` clean; each phase manually verified in the Vite preview.
- Remaining: a focus-preservation regression test; verification against a live
  reaprime (so far demo-data only).

---

## 5. Key file map
- Beanie editor (live): `beanie/src/components/profileEditor.ts`
- Beanie editor (dead, to repurpose): `beanie/src/domain/profileEditor.ts`
- Beanie preview chart: `beanie/src/components/profilePreview.ts`
- Beanie wire types: `beanie/src/api/types.ts` (`Profile`, `ProfileRecord`)
- Beanie app wiring: `beanie/src/app.ts` (`openProfileEditor`, `editorDispatch`,
  `submitProfileEditor`, `renderProfileEditorPage`)
- Gateway truth: `reaprime/lib/src/models/data/profile.dart`,
  `reaprime/doc/Profiles.md`, `reaprime/assets/defaultProfiles/*.json`
- de1app reference: `de1app/de1plus/{profiler,profile,vars,gui,machine}.tcl`,
  `de1app/de1plus/de1_skin_settings.tcl`
