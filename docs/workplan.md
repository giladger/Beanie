# Beanie Workplan

## Product Bet

Home espresso brewing is usually organized around the coffee bag, not around a generic machine state. Beanie makes the bean the primary context: when a bean is selected, the skin should immediately recover what worked last time and put the barista one tap away from brewing.

## Target Workflow

1. **Wake**
   - Show the current Decent.app workflow.
   - Resolve the active bean from `workflow.context.beanBatchId` or `coffeeRoaster + coffeeName`.
   - If the workflow is empty, fall back to the last selected bean stored by the skin.

2. **Choose Bean**
   - Search and tap a bean from the recent/known bean list.
   - Load the bean's latest batch when available.
   - Fetch shots filtered by `beanBatchId`; fall back to `coffeeRoaster + coffeeName`.
   - Hydrate profile, dose, yield, grinder, and grind setting from the latest shot.

3. **Brew Prep**
   - Show profile, dose in, target yield, grinder, and grind setting as first-class editable controls.
   - Keep `PUT /api/v1/workflow` as the single apply path so Decent.app snapshots the same context into the next shot record.
   - Offer quick machine actions: tare, brew, stop, sleep.

4. **History**
   - Show shots for the selected bean, newest first.
   - Fetch full records for visible shots so each row can show pressure, flow, and weight curves.
   - Let the barista reload any previous shot's setup as the current draft.

5. **Presets**
   - Save bean-local presets in browser local storage.
   - Presets capture profile, dose, yield, grinder, and grind setting.
   - Later phase: sync presets through Decent.app's KV store for multi-device continuity.

## Release-Quality Constraints

- Static skin zip, no production server.
- Framework-free TypeScript inspired by Streamline's direct browser approach.
- Works against real Decent.app APIs, but has a demo fallback for development and presentations.
- Responsive 1366x768 tablet-first layout with a compressed mobile mode.
- Avoid editing machine firmware settings outside the current workflow unless the UI explicitly says so.
- Treat `workflow.context` as authoritative for bean/grinder/dose metadata.

## Phase 1 Scope

- Bean list, search, add-minimal-bean.
- Current bean hero and machine status strip.
- Latest-shot hydration for profile, dose, yield, grinder, grind setting.
- Editable draft controls and one-click `Apply`.
- Auto-load toggle for applying immediately after bean change.
- Local bean presets.
- Filtered shot history with compact SVG graphs.
- REST and WebSocket client.
- Unit tests for recipe derivation and workflow patch creation.

## Phase 2 Candidates

- Batch picker and freshness/open-date tracking.
- Better profile picker with search and profile graph preview.
- Grinder step metadata and named settings.
- Shot annotation editing.
- Favorite beans and archived beans.
- KV-store synced presets.
- Import path from legacy DYE/SDB shot descriptions.
- Offline cache using IndexedDB.

## API References

- `GET /api/v1/workflow`
- `PUT /api/v1/workflow`
- `GET /api/v1/beans`
- `GET /api/v1/beans/{id}/batches`
- `GET /api/v1/grinders`
- `GET /api/v1/profiles`
- `GET /api/v1/shots`
- `GET /api/v1/shots/{id}`
- `PUT /api/v1/machine/state/{state}`
- `PUT /api/v1/scale/tare`
- `ws://<host>:8080/ws/v1/machine/snapshot`
- `ws://<host>:8080/ws/v1/scale/snapshot`
