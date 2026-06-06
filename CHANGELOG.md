# Changelog

## v0.1.5 - 2026-06-06

- Added a themeable skin system with new Decent, Acaia, Espresso, Nord, Solarized, Dracula, Gruvbox, and Rose Pine themes.
- Added Decent account settings, login failure messaging, presence heartbeats, and Visualizer back-sync controls.
- Improved shot history sync with visible auto-refresh, cached shot refreshes from summaries, gateway history page imports, and reduced refresh polling.
- Added scale availability warnings across brew flows, including machine status messages, blocked-shot messaging, and a no-scale popup.
- Improved live shot and saved-shot handling by keeping the shot screen open until the saved shot is ready, showing target dose/yield when actual values are zero, and clarifying imported zero-yield rows.
- Added bean and bag editing improvements, including editing bean, roaster, and batch together, selecting the latest bag batch, and adding beans from the shot editor.
- Added timed steam stop handling with flow-based timer start, heating/purging states, explicit steam rinse purge behavior, and tuned stop controls.
- Added per-shot flow calibration support and expanded tests for gateway, settings, shot records, bean workflow, timed steam stop, and calibration behavior.
