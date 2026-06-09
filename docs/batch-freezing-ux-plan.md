# Batch and Freezer UX Plan

Audit date: 2026-06-09
Viewport: 800 x 1340

Screenshots:

- `screenshots/batch-freezing-ux-audit-2026-06-09/01-workbench-selected-batch-shelf.png`
- `screenshots/batch-freezing-ux-audit-2026-06-09/02-bean-picker-batch-list-shelf.png`
- `screenshots/batch-freezing-ux-audit-2026-06-09/03-storage-modal-shelf-freeze-options.png`
- `screenshots/batch-freezing-ux-audit-2026-06-09/04-storage-modal-after-freeze-whole-batch.png`
- `screenshots/batch-freezing-ux-audit-2026-06-09/05-storage-modal-after-mark-thawed.png`
- `screenshots/batch-freezing-ux-audit-2026-06-09/06-storage-modal-another-shelf-partial-freeze.png`
- `screenshots/batch-freezing-ux-audit-2026-06-09/07-bean-picker-focused-other-batch.png`
- `screenshots/batch-freezing-ux-audit-2026-06-09/08-after-plus-batch-inline-created.png`

## Current UX Problems

1. The core object is unclear.

   The UI mixes "bean", "batch", "storage", "freeze", and "partial freezer stash" without a simple model. A user is really managing physical stock: a bag or portion that is either on the shelf, in the freezer, or thawed. The current labels make the workflow feel like editing metadata rather than moving coffee between places.

2. Storage is a secondary button inside a dense batch form.

   In the bean picker, storage appears as a small "On shelf" button at the bottom of a batch card. It is visually similar to an attribute, but it opens one of the highest-impact workflows. The state is discoverable only after reading the batch row closely.

3. The storage modal is action-first but not decision-first.

   The modal shows age metrics, then "Next action", then partial freezing, then dates. This hides the user's actual decision: use this stock as-is, freeze the whole stock, freeze part of it, thaw it, or correct when that happened.

4. Whole-batch and partial-batch actions compete without explaining stock results.

   "Freeze whole batch" and "Create frozen portion" are both prominent, but the UI does not preview what inventory will exist afterwards. For partial freeze, the user has to infer that one shelf batch will be reduced and a second frozen batch will be created.

5. Age terms are terse and hard to verify.

   "18d", "18a", "active age pauses", and "active age resumes" are compact, but not self-validating. Users can see numbers, yet it is hard to understand whether Beanie counted freezer time correctly.

6. Date correction is buried in a transactional modal.

   The date editor changes meaning based on latest event: add freeze date, correct freeze date, correct thaw date. That is logically consistent, but it prevents users from seeing the full storage history or checking whether they made the right sequence of moves.

7. The `+ Batch` control silently creates a batch inline.

   In the audited flow, tapping `+ Batch` created a new batch with today's date and full default weight inside the picker. That is quick, but surprising. The button does not communicate that it immediately mutates the list.

8. Existing frozen state is not prominent on the workbench.

   The workbench bean header can include "frozen today" or "thawed today", but it does not expose the current stock location as a first-class chip or action. The user has to open the picker to manage it.

## Target Model

Use one mental model everywhere:

- Bean: the coffee identity.
- Stock: a physical purchasable or split amount of that bean.
- Location: shelf, freezer, thawed.
- Freshness: roast age, active age, and storage history derived from stock events.

Rename UI surfaces around this model:

- "Batches" becomes "Stock".
- "Storage" becomes "Stock location".
- "Frozen" checkbox becomes "Starts in freezer".
- "Partial freezer stash" becomes "Split stock".
- "Create frozen portion" becomes "Move part to freezer".

## Proposed Screens

1. Workbench stock chip

   Add a compact chip beside the bean freshness text:

   - Shelf: `On shelf · 118g · 18 active days`
   - Freezer: `Frozen · 118g · active age paused`
   - Thawed: `Thawed today · 118g · 18 active days`

   Tapping the chip opens the stock manager directly for the current stock.

2. Stock list in the bean picker

   Replace the dense batch form row with a scannable stock card:

   - Header: roast date, remaining grams, current location chip.
   - Secondary text: roast level, roast age, active age.
   - Inline fields stay available, but storage/location is a primary chip, not a low-priority button.
   - Destructive delete remains visually separate.

3. Stock manager modal

   Rebuild the storage modal around three areas:

   - Current stock: bean name, remaining grams, location, roast date.
   - Freshness: roast age and active age with a short "freezer days excluded" note only when relevant.
   - Actions: location actions grouped by outcome.

   For shelf stock:

   - `Move all to freezer`
   - `Move part to freezer`
   - `Correct dates`

   For frozen stock:

   - `Move to shelf / thaw`
   - `Correct dates`

   For thawed stock:

   - `Move back to freezer`
   - `Correct dates`

4. Split-stock flow

   Make partial freezing a two-step confirmation inside the same modal:

   - Step 1: choose grams to move.
   - Step 2: preview result.

   Example preview:

   - Shelf stock: `74g -> 24g on shelf`
   - New freezer stock: `50g frozen today`

   The commit button should say `Move 50g to freezer`.

5. Add-stock flow

   Change `+ Batch` so it opens an explicit add-stock form or inline draft state instead of creating a saved batch immediately. The draft should ask for:

   - Roast date.
   - Starting grams.
   - Starting location: shelf or freezer.
   - Optional roast level.

   Commit button: `Add stock`.

6. Storage history

   Add a small timeline in the stock manager:

   - `Roasted May 22`
   - `Frozen Jun 9`
   - `Thawed Jun 12`

   Let users correct any event date from the timeline. This removes the ambiguous single "Correct date" panel that changes depending on the last event.

## Implementation Plan

1. Introduce display vocabulary helpers.

   Add stock/location labels and result-preview helpers in `src/domain/beanDisplay.ts` or `src/domain/beanWorkflow.ts`. Keep existing storage event data structures until the UI proves out.

2. Refactor the bean picker batch card.

   Update `src/views/beanPickerView.ts` so batch rows render as stock cards with a prominent location chip/action. Preserve current inline editing behavior for date, roast level, bag grams, and remaining grams.

3. Replace the storage modal content model.

   Rework `renderBatchStorageModal` into current stock, freshness, action groups, split-stock preview, and timeline sections. Keep existing app actions initially, but rename labels around stock movement.

4. Make partial freeze preview before mutation.

   Add modal-local state for a split-stock draft amount, then require explicit confirmation before `freezeBatchPortion` creates the new frozen stock.

5. Change `+ Batch` to draft-first.

   Replace the current immediate `createBatchInPicker` behavior with an unsaved inline draft or a dedicated add-stock panel. Only persist after the user taps `Add stock`.

6. Add focused tests.

   Update `src/test/beanPickerView.test.ts` for shelf, frozen, thawed, split preview, and add-stock draft states. Add controller tests around partial freezing to ensure the shelf and freezer stock amounts are previewed and committed consistently.

## Success Criteria

- A user can tell at a glance where the selected stock is.
- A user can predict exactly what stock rows will exist before freezing part of a bag.
- Adding stock never mutates saved data before an explicit commit.
- Date correction shows storage history, not just the latest event.
- The same words appear on the workbench, picker, modal, and add-stock flow.
