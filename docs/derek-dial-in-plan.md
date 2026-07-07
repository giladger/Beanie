# Derek dial-in helper

Beanie integration with Derek, Decent's RAG knowledge-base assistant, as a
context-aware dial-in helper: Beanie sends the bean, recipe, and the shot's
actual telemetry; Derek streams back cited advice **plus structured
single-parameter suggestions** that Beanie can apply to the next shot with one
tap — including generating a tweaked profile variant and pointing the bean's
recipe at it.

Progress is tracked in the checklists at the bottom of this file.

## Verified upstream facts (probed live, 2026-07-07)

- reaprime relays `POST /api/v1/derek/answers/stream` →
  `https://derek.decentespresso.com/api/answers/stream`, piping the SSE
  response back unbuffered (reaprime commit `3835c46e`; CORS is why the relay
  exists — browsers can't call Derek directly). No auth; LAN-trust like the
  rest of the API. Older gateways return 404 → feature-detect.
- Request body: `{ "query": string }` (extra fields allowed, e.g.
  `include_documents`, `include_videos`).
- SSE events, in order:
  - `queue` — `{"position": 0, "queued": false}`
  - `phase` — `{"phase": "searching_database"}` →
    `{"phase": "evidence_found", "hit_count": 15}` → `{"phase": "answering"}`
  - `delta` — `{"text": "..."}` markdown tokens (bold, lists, `[1]` citation
    markers)
  - `result` — `{"mode": "answer", "answer_text": "...", "citations": [...],
    "answer_id": "..."}` where each citation has `citation_url`,
    `section_title`, `source_type`, `citation_date`, `source_numbers` (maps to
    the `[n]` markers)
  - `error` — failure event
- Answers take ~15–60s and can queue; streaming makes this fine.
- **Derek reads telemetry**: given a downsampled `t, pressure, flow, weight`
  table it reasons from it directly (cited our preinfusion length from the
  numbers).
- **Derek honors output-format instructions**: asked for a fenced ` ```json `
  block of single-parameter suggestions, it produced a clean, ordered,
  cited block. No second AI pass needed.

## UX

### Entry points

1. **Shot detail / shot editor — "Dial in" button** (the headline flow). Opens
   the helper pre-loaded with that shot. First screen is taste chips, not a
   text box: `Sour` `Bitter` `Harsh/astringent` `Weak/watery` `Hollow`
   `Too fast` `Too slow` `Choked` `Channeled` (multi-select) + optional
   free-text line. One tap on **Ask Derek** sends the composed question.
2. **Workbench/machine — "Ask Derek"** for open-ended questions. Same modal,
   empty question, current bean/profile context attached as removable chips.

### The modal (tablet full-screen modal, phone bottom sheet)

- **Context chips row**: `bean · grinder · recipe · shot · taste` — each
  removable before sending; a disclosure shows the literal composed text
  ("what Derek is told"). Trust through transparency.
- **Streaming states** mapped from SSE: "Asking Derek…" → "Searching the
  knowledge base…" → "Found N sources" → live text. Queue position shown when
  `queued`. Never a dead spinner.
- **Answer body**: tiny safe markdown subset (bold, lists, paragraphs);
  everything else escaped. `[n]` markers become tappable superscript chips.
- **JSON fence cutoff**: when the streamed text reaches a ` ```json ` fence,
  stop rendering text and show a "Preparing suggestions…" shimmer; raw JSON is
  never displayed.
- **Suggestion cards** (from the parsed block): one card per suggestion,
  radio-select — picking one deselects others, so the UI itself enforces
  change-one-thing-at-a-time. Card shows `parameter: current → target`, the
  why-line, and profile-level cards a before/after mini profile chart.
  `[ Use for next shot ]` applies the selected card.
- **Citations footer**: numbered source cards (`section_title`, date) linking
  to `citation_url`; QR fallback on the tablet webview so sources open on a
  phone.
- **Actions**: Ask a follow-up (prefill question, keep context), Copy answer,
  Retry.
- **M50 Mini discipline**: 1340×800 landscape — header + scrollable body,
  nothing clips vertically (reuse the full-screen shot-stages modal pattern).

### Failure states (all designed)

- Gateway without the relay: probe once per session; hide entry points, hint
  in Settings → App.
- Derek unreachable / gateway offline: message + Retry; composed question
  preserved.
- 429: "Derek is busy — try again in a minute."
- Mid-stream drop: keep partial text, mark "answer interrupted", offer Retry.
- Missing/malformed JSON block: prose answer stands; cards are progressive
  enhancement, never a failure mode.
- Demo mode: entry points disabled with a hint (no fake AI answers).

## The composed query

Three parts:

1. **Context block** — machine + profile title, bean (name, roast level,
   roast age), grinder + setting, recipe (dose → yield, ratio, temperature),
   summary facts (duration, first drops, peak pressure, avg pour flow, stop
   reason, TDS/EY/score when present). Omit unknowns.
2. **Telemetry table** — downsampled to ~1Hz, capped ~60 rows:
   `t_s, pressure_bar, flow_mls, weight_g` from `ShotRecord.measurements`.
3. **Output contract** — "explain briefly, then end with a fenced json block
   `{"suggestions": [{parameter, direction, current, target, unit, why}]}`;
   `parameter` must be one of the enum below; each suggestion changes exactly
   ONE parameter; order by what to try first."

## Suggestion schema and applyability

| `parameter` | Applied to | Mechanism |
|---|---|---|
| `grind` | bean recipe | update grind setting |
| `dose` | bean recipe | update target dose |
| `yield` | bean recipe | update target yield |
| `brew_temperature` | bean recipe | update recipe temperature |
| `peak_pressure` | profile variant | tweak engine |
| `preinfusion_time` | profile variant | tweak engine |
| `preinfusion_flow` | profile variant | tweak engine |
| `profile` | bean recipe | switch to named library profile (fuzzy title match against the loaded list; unmatched → manual card) |
| anything else | — | **manual card**: shown as advice text, no Apply |

Validation on parse: schema-check every field, drop suggestions that fail,
cross-check `current` against Beanie's actual recipe/profile — if Derek
misread the current value, recompute the delta from the real one or degrade
the card to manual. Clamp targets to `FIELD_SPECS` ranges.

## Auto-apply: the tweaked profile

Accepting a profile-level suggestion:

1. **Tweak engine** (`src/domain/profileTweaks.ts`, pure) rides existing
   machinery: `createProfileEditorState(profile)` → typed `EditorStep[]`;
   for profiles that pass `parseStepsToSimple` the tweak is a knob change +
   `compileSimpleToSteps` (deterministic, already round-trip-guarded); for
   advanced profiles, targeted `EditorStep` edits:
   - `peak_pressure`: set the max-pressure `pump: 'pressure'` step(s) to the
     target (all steps holding the old peak move together).
   - `preinfusion_time` / `preinfusion_flow`: the low-pressure/flow steps
     before the ramp, matched by name `/pre|fill|infus|soak|bloom/i` with a
     structural fallback; edit `seconds` / `flow`.
   - **Confidence gate**: if the knob can't be located unambiguously, return
     null → the card degrades to manual. We never guess-edit a profile.
   `profileFromEditorState` produces the gateway-ready tweaked `Profile`.
2. **Variant creation**: `POST /profiles` (content-hash dedup server-side
   makes re-accepting idempotent). Title: `<Original> · derek: <param> <value>`.
3. **Recipe pointer swap**: the bean's recipe now references the variant — so
   "pick this bean → setup snaps back" loads the tweaked profile from now on.
   Recipe-level parameters stage into the recipe draft the same way.
4. **Visible, revertible**: workbench shows a tweak chip
   `⚗ preinfusion 8s → 13s (Derek) · revert` until a shot is pulled with it or
   the user reverts to the original profile. Variants get a badge in the
   profile picker.
5. **Learning loop (V2, designed-in now)**: record the applied suggestion in
   the next shot's `annotations.extras.derekTweak`; the following "Dial in"
   ask opens with "Previous change: X. Result: …" so Derek sees what was tried.

## Architecture

| Piece | File | Responsibility |
|---|---|---|
| SSE client | `src/api/derek.ts` | `streamDerekAnswer(body, handlers)` — fetch to `${gatewayHttpOrigin()}/api/v1/derek/answers/stream`, ReadableStream SSE parse, abort support, stall detection (45s without any event; every event resets the clock — do NOT reuse the app's 20s request timeout), proxy-token header |
| Dial-in domain | `src/domain/dialIn.ts` | taste-chip catalog; telemetry downsampler; `composeDialInQuery(...)`; output contract text; fenced-JSON extractor + schema validation + current-value cross-check; citation `[n]` mapping |
| Answer markdown | `src/domain/answerMarkdown.ts` | XSS-safe tiny renderer: bold/lists/paragraphs/citation chips only; JSON-fence cutoff detection |
| Tweak engine | `src/domain/profileTweaks.ts` | knob locator + deterministic transforms + confidence gate + variant naming |
| Controller | `src/controllers/derekController.ts` | state machine `idle → sending → queued → searching → answering(partial) → done(result+suggestions) / failed(error, partial)`; apply-selected-suggestion flow |
| View | `src/views/derekView.ts` | modal/sheet for every state; chips; cards; citations; before/after chart |
| Wiring | `app.ts` | entry-point buttons, feature probe (404 → hide), settings toggle, tweak chip + revert, variant badge |

## Risks

- **LLM JSON**: schema validation + manual-card fallback — a bad block costs
  cards, never correctness.
- **Knob location in exotic profiles**: confidence gate + before/after
  preview + dedup keep it safe; worst case manual-only.
- **Profile clutter**: dedup + badge + revert; a "delete unused Derek
  variants" cleanup can come later.
- **Beanie stays raw-facts**: Beanie never editorializes; all advice is
  visibly Derek's, cited, and only appears when the user asks.

## Work plan

### Phase 1 — Derek SSE client (`src/api/derek.ts`) ✅
- [x] SSE parser: buffer on blank-line boundaries, tolerate `data:` split
      across reads, multi-line data, CRLF, keepalive comments
- [x] `streamDerekAnswer`: POST via gateway relay, event callbacks, abort
      signal, stall timeout (45s, reset on any event), typed events
- [x] Error mapping: relay 404 (no route) distinguished from Derek 4xx/429
      and network failure
- [x] Tests: parser chunk-boundary cases, event decoding, error paths
      (12 tests in `src/test/derek.test.ts`)

### Phase 2 — Dial-in domain (`src/domain/dialIn.ts`) ✅
- [x] Taste chip catalog
- [x] Telemetry downsampler (~1Hz, ≤60 rows, pour-window aware)
- [x] `composeDialInQuery` (context block + telemetry + output contract;
      omits unknowns) + `buildDialInContext` from ShotRecord/bean/batch/
      grinder (reuses `buildShotStats`, `computeBeanFreshness`)
- [x] Suggestion extractor: fenced-JSON parse, schema validation, parameter
      enum, current-value cross-check, FIELD_SPECS clamping (out-of-range →
      manual card)
- [x] `jsonFenceCutoff` for the streaming cutoff (moved here from Phase 3 —
      it pairs with the extractor)
- [x] Tests: composer field combinations, extractor good/bad/missing JSON,
      cross-check corrections (9 tests in `src/test/dialIn.test.ts`)

### Phase 3 — Answer markdown (`src/domain/answerMarkdown.ts`) ✅
- [x] Tiny renderer: paragraphs, bold, ordered/unordered lists, `[n]` chips
      (filtered by the known citation set); everything else escaped
- [x] Streaming cutoff lives in `dialIn.ts` (`jsonFenceCutoff`)
- [x] Tests: XSS attempts, marker mapping, heading fallback
      (4 tests in `src/test/answerMarkdown.test.ts`)

### Phase 4 — Profile tweak engine (`src/domain/profileTweaks.ts`) ✅
- [x] `applyProfileTweak(profile, suggestion)` → tweaked profile + summary,
      or null
- [x] Simple-profile path via `parseStepsToSimple`/`compileSimpleToSteps`
      (flow profiles: peak pressure = existing limiter only)
- [x] Advanced path: peak-pressure (all steps at the old peak move together)
      and single-named-preinfusion locators + edits
- [x] Confidence gate (null on ambiguity, no-op targets, string targets)
- [x] Variant titling `<Original> · derek: <param> <value>` — idempotent,
      never chains suffixes; `isDerekVariantTitle`/`baseProfileTitle` helpers
- [x] Tests: simple + advanced + ambiguous cases, clamping, no-op guard
      (11 tests in `src/test/profileTweaks.test.ts`)

### Phase 5 — Controller (`src/controllers/derekController.ts`) ✅
- [x] Pure state machine incl. queue/phase/delta/result/error, retry, abort,
      stale-ask guard (`askSeq`), follow-up flow
- [x] Suggestion selection (radio; manual cards unselectable; first applicable
      pre-selected)
- [x] Tests: transitions, interrupted streams, selection rules
      (8 tests in `src/test/derekController.test.ts`)

### Phase 6 — View (`src/views/derekView.ts`) + styles ✅
- [x] One modal for tablet and phone (renderModal is shared across layouts)
      with all streaming states
- [x] Taste chips screen, context chips + "what Derek is told" disclosure
- [x] Suggestion cards with radio semantics, "try first" tag, variant/manual
      hints
- [x] Citations footer with links (new tab)
- [x] M50 Mini 800px-height check — verified in the browser at 1340×800:
      modal is 700px, nothing clips, body scrolls internally
- [x] Tests: render per state, gating, fence hold-back, escaping
      (4 tests in `src/test/derekView.test.ts`)
- [ ] Deferred: QR fallback for citations on the tablet webview;
      before/after mini profile chart on variant cards

### Phase 7 — App wiring (`app.ts`) ✅ (with deferrals)
- [x] Entry points: shot detail pane tools ("Dial in with Derek") and
      workbench topbar ("Derek") — hidden in demo and on relay-less gateways
- [x] Feature probe: lazy on first open (invalid-body POST — Derek 400 =
      present, reaprime 404 = missing), cached per session; a 404 mid-ask also
      flips the modal to its "needs a newer Decent.app" state
- [x] Delta streaming patches the answer DOM in place (no full re-render per
      token, same pattern as live-shot readouts)
- [x] Apply: recipe staging (grind/dose/yield/temperature), profile switch by
      fuzzy title, variant save via the dedup-aware saveProfile path + recipe
      pointer swap, then scheduleApply — the next pull uses the tweak, and
      re-opening the bean restores it (recipe = source of truth)
- [x] Live verification: full pipeline (composer → SSE stream → extractor)
      run against the real Derek service; three valid single-parameter
      suggestions returned with Beanie's current values cross-checked in
- [ ] Deferred: explicit workbench "revert tweak" chip (the variant's
      `· derek:` title already shows in the recipe row; revert = re-pick the
      original profile), `annotations.extras.derekTweak` learning loop (V2),
      settings on/off toggle (feature is opt-in per tap; low value), phone
      entry buttons (the modal itself is phone-ready)

### Phase 8 — Polish & ship ✅
- [x] Full test suite (701 ok) + `tsc` clean
- [x] CHANGELOG entry
- [x] Committed with progress marked here
