# Beanie Feature Ideas (2026-06-11)

Ten feature ideas for Beanie, grounded in what the Decent DE1 / Reaprime
gateway already exposes and the infrastructure Beanie already has. Each entry
notes the existing pieces it builds on, so the cost estimate is honest.

Beanie's identity is "the skin built around your beans". The strongest ideas
below all extend that: they close the loop from *pull a shot* to *learn
something about this bag* to *pull a better shot tomorrow*.

## 1. Guided dial-in assistant

After each rated shot, compare actuals against the recipe (shot time, yield
vs target, enjoyment score) and suggest a concrete next move: "ran 8s fast at
target yield — go 2 clicks finer". Grinders already carry
`settingSmallStep`/`settingBigStep`, so suggestions can speak in the user's
grinder's own click units. Track convergence per bag and show a "dialed in"
badge once shots stabilize.

- Builds on: per-bean recipes, shot annotations (`enjoyment`, actual
  dose/yield), grinder step metadata, shots-left/freshness per bag.
- Why top tier: this is the literal promise of the skin ("dialing in gets
  easier instead of messier") turned from passive memory into active help.

## 2. Best-shot ghost overlay on the live chart

While brewing, draw the bean's reference shot (highest enjoyment, or
user-pinned) as a faint ghost trace behind the live curves. Divergence is
visible in real time: "pressure is climbing slower than my best shot." After
the shot, offer a two-shot overlay compare view in history.

- Builds on: `LiveChart` canvas, `shotGraphModel`, full `ShotRecord`
  measurements already cached per shot, the live-shot fast path.
- Why top tier: zero new data required; pure presentation of data Beanie
  already holds, and it's a feature even de1app doesn't do per-bean.

## 3. AI shot diagnosis (Gemini reads the curve)

Beanie already ships a Gemini integration for label scanning. Reuse it: send a
finished shot's pressure/flow/weight series plus the recipe and ask for a
diagnosis — channeling signatures (flow spikes under flat pressure), choking,
early blonding — with one suggested fix. Render as a short note on the shot
editor screen, clearly marked as AI guidance.

- Builds on: `src/api/gemini.ts`, shot measurement series, shot editor view,
  the existing KV-stored API key shared across devices.
- Why top tier: turns the shot graph from "data you must know how to read"
  into "data that explains itself" — the biggest skill barrier in espresso.

## 4. Roast-age-aware recipe nudges

Beans degas; a recipe saved at day 7 is wrong at day 21. Beanie already
computes active age (pausing while frozen). When the active age since the
bag's last shot has moved meaningfully, surface a nudge on the workbench:
"this bag aged 9 days since you last pulled it — expect to grind finer."
Optionally learn the per-bean drift from the user's own grind history.

- Builds on: `beanFreshness` (v0.2.0), per-bag shot history, recipe drafts.
- Why top tier: it's the natural payoff of the freshness tracking just
  shipped — the data already exists, this makes it actionable.

## 5. Bag report card + low-stock reorder

When a bag is finished (or dips below N estimated shots), show a report card:
shots pulled, average rating, best shot with its recipe, how the rating moved
across roast age. On "finish bag", offer one-tap "rebuy" that pre-creates the
next batch from the same bean with today's expected roast date, and keeps the
dialed recipe waiting. Low-stock state appears in the picker and title bar.

- Builds on: automatic bag depletion + shots-left estimate (v0.2.0), bean
  favorites, batch creation flow, the new bag-list picker.
- Why top tier: completes the bag lifecycle (scan → dial → drink → finish →
  rebuy) and produces a satisfying artifact the user will want to screenshot.

## 6. Drinks and drinkers (milk drinks, guest mode)

`WorkflowContext` already has `finalBeverageType` and `drinkerName`, unused in
the UI. Add named drinks: a drink = bean + recipe + steam settings (a flat
white steams differently than a cappuccino — timed steam stop already
exists). Then per-person presets: pick "Dana", get her decaf bean, her dose,
her steam time. Shot history becomes filterable by drinker.

- Builds on: workflow context fields, steam settings persistence, timed steam
  stop, bean picker patterns.
- Why top tier: makes Beanie the household machine UI, not just the
  enthusiast's solo dial-in tool; the data model needs almost nothing new.

## 7. Morning routines (wake schedules surfaced)

The gateway already has wake schedules (`/api/v1/presence/schedules`) and
Beanie has client functions for them but no UI. Build "routines": wake the
machine at 6:40 on weekdays, pre-select the morning bean and its recipe, set
steam for the usual milk drink, and greet with a "ready to brew" workbench
when the user walks up. Display brightness scheduling can ride along.

- Builds on: `wakeSchedules` gateway calls, presence settings, per-bean
  recipe restore, `setDisplayBrightness`.
- Why top tier: the highest-leverage unused gateway capability; turns the
  first interaction of the day into zero taps.

## 8. Recipe sharing via QR + Visualizer import

Beanie has a QR component (phone scanner handoff) and Visualizer back-sync.
Combine them: "share this bean's recipe" renders a QR encoding bean, recipe,
and profile reference; a friend with the same coffee scans it on their
Beanie and gets the bag pre-dialed. Inbound: import a Visualizer shot URL and
attach its recipe/profile to one of your beans.

- Builds on: `components/qr.ts`, label-scan phone handoff plumbing, Decent
  account + Visualizer plugin settings, profile create/update endpoints.
- Why top tier: gives Beanie a community/network edge; recipe portability per
  bean is something no Decent skin does cleanly today.

## 9. Maintenance odometer

Beanie counts cleaning cycles already; generalize to a maintenance dashboard
keyed to shot count: shots since last backflush, descale due (gateway exposes
the `descaling` state), water filter age, flow-calibration drift (per-shot
calibration is already recorded in `WorkflowMachine.flowCalibration`), and a
lifetime shot odometer. Gentle due-soon chips on the machine page, never
modal nags.

- Builds on: cleaning workflow + counters (`domain/cleaning.ts`), shot
  history totals, calibration endpoints, machine state stream.
- Why top tier: protects the user's $4k machine with data Beanie is already
  collecting; low effort, durable daily value.

## 10. Phone companion as a full remote

The phone layout exists for the scanner. Extend it into a true companion:
rate the shot and type tasting notes from the couch (phone keyboards beat
tablet ones), watch the live shot mirror remotely, get a "machine is warm"
banner, and browse a bag's history. The QR pairing flow and the gateway's
LAN-address endpoint are already in place.

- Builds on: `phoneView`, QR handoff, `lanAddress`, WebSocket telemetry,
  shot metadata controller.
- Why top tier: tasting notes are the most-skipped input in the loop because
  of where/when they happen; moving them to the phone is the fix, and it
  feeds every analytics idea above (1, 3, 4, 5).

## How they stack

Ideas 1–5 form one arc: richer per-bag learning (the core identity). Ideas
6–7 widen the audience (household, routine). Ideas 8–10 widen the surface
(community, machine care, phone). If sequencing, start with 2 (pure UI on
existing data), then 1 and 4 (shared analytics groundwork), then 5.
