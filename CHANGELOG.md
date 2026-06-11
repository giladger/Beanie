# Changelog

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
