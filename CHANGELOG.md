# Changelog

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
