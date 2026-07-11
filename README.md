# Beanie

<img src="docs/icon.png" alt="Beanie coffee bean icon" width="240" />

Beanie is a Decent.app skin built around your beans.

Got a few bags open at once? Then you know the pain: every coffee dials in
differently, and you're stuck remembering, or scribbling down, the grind, dose,
ratio, temperature, and profile for each one.

Beanie remembers for you. It keeps a separate recipe per bag, so when you switch
back to your Ethiopian, last time's grind, dose, yield, temperature, and profile
snap right back. No notebook, no "wait, what did I use last time?"

Pick a bag, pull a shot, rate it, and keep your tasting notes tied to that bean.
Over time, every bag builds up its own useful history, so dialing in gets easier
instead of messier.

Beanie is still early, so feedback is very welcome.

## What Beanie Does

1. Opens on the last active bean and its current recipe.
2. Pick another bean with one tap.
3. Restore the saved setup for that bean: profile, dose, yield, temperature, grinder, and grind setting.
4. Review previous shots for that bean with compact shot graphs.
5. Adjust the recipe, pull another shot, and save what worked.

## Install

Open Decent.app's settings skin installer:

```text
http://localhost:8080/api/v1/plugins/settings.reaplugin/ui
```

In the Web Interface settings, install from GitHub using:

```text
giladger/Beanie
```

Decent.app will fetch the latest Beanie GitHub release and install the skin.

## Development

Beanie is a static WebUI skin:

- No UI framework runtime.
- Direct REST and WebSocket calls to the Decent.app gateway.
- Static files served by Decent.app on port 3000.
- IndexedDB caches gateway data for faster, more resilient startup; it is not a
  separate source of truth.
- Most Beanie preferences use the gateway settings store so they follow the
  user across devices. Explicit per-device choices, photos, and secrets stay in
  browser storage.

### Local Dev

```bash
npm install
npm run skin:dev
```

`npm run skin:dev` writes a small development shim into Decent.app's Beanie skin
folder, then starts Vite on `localhost:5173`. Decent.app still opens the skin
from `http://localhost:3000/`, but the page loads the app modules from Vite, so
source changes hot reload without rebuilding or copying `dist`.

Vite development and preview servers bind to `127.0.0.1` by default. This keeps
them off the network for normal desktop work. Use one of the explicitly named
LAN/device commands only when another device must reach your machine, and only
on a trusted network.

During development, Beanie resolves Decent.app API calls from the Decent-served
page. On the local machine this means the skin uses the gateway at
`localhost:8080`. Override with:

```bash
BEANIE_GATEWAY=http://192.168.1.42:8080 npm run skin:dev
```

If the gateway is temporarily unavailable, Beanie keeps cached gateway data
visibly marked as offline/limited while it retries. Demo mode is different: it
uses clearly labelled sample data and simulates writes, so it must never be
mistaken for the user's cached library.

Useful development commands:

```bash
npm run skin:shim       # only install the Decent.app -> Vite shim (desktop container)
npm run skin:dev        # install the shim and start Vite with hot reload
npm run dev:lan         # expose Vite to the trusted LAN (no shim installation)
npm run skin:dev:device # push the shim to a debug device and start Vite on the LAN
npm run skin:shim:device # only push the shim onto a debuggable device via adb
npm run skin:shim:zip   # only build the development shim zip
npm run skin:shim:zip:lan # build + serve a shim zip to a trusted-LAN device
npm run skin:deploy     # build and copy the static skin into Decent.app
npm run preview         # preview dist on 127.0.0.1
npm run preview:lan     # expose the production preview to the trusted LAN
npm run release         # tag and push the next patch release
npm run release:zip     # build the installable release zip
```

### Hot reload on a release build

`skin:shim:device` writes the shim with `adb run-as`, which only works on a
debuggable build. To live-load onto a **release** build, serve the shim as a zip
and install it through Decent.app's own skin installer, which fetches it by URL:

```bash
npm run skin:shim:zip:lan # writes/serves beanie-shim.zip and prints its URL + QR
npm run dev:lan         # in another terminal, so the tablet can reach Vite
```

In Decent.app's skin installer, paste the printed
`http://<lan-ip>:5180/beanie-shim.zip` into the **source field** — the same box
you'd normally type `giladger/Beanie` into. Decent fetches and unpacks the zip
itself (`POST /api/v1/webui/skins/install/url`), so this needs no debug build and
no `adb`; the machine just has to be able to reach your Vite host over the LAN.
The QR only helps you copy the URL onto the tablet. Keep the server running
during the install — Decent pulls the zip from it.

Do **not** use the "Upload a previously exported ZIP file" control — that's the
beans/shots *data import*, not a skin installer.

The shim only carries `index.html` + `manifest.json`; all modules load from your
machine's Vite server, so `src/*` edits hot-reload on the device. By default it
installs as its own entry — id `beanie-dev`, shown as **Beanie (dev)** — so it
sits alongside the release rather than replacing it; pick it from the skin list.
Set `SHIM_SKIN_ID=beanie` to overwrite the release in place instead.

`dev:lan`, `preview:lan`, and `skin:shim:zip:lan` listen on every interface.
They have no production authentication boundary: do not expose them through a
public IP, port forward, tunnel, or untrusted Wi-Fi, and stop them when the
device session is finished. Plain `skin:shim:zip` only writes the zip. The
installed production skin does not use Vite.

Env overrides: `BEANIE_DEV_HOST` / `VITE_DEV_ORIGIN` (the Vite origin baked into
the shim), `VITE_PORT` (default 5173), `SHIM_ZIP_PORT` (default 5180),
`SHIM_ZIP_OUT` (output path), `SHIM_SKIN_ID` / `SHIM_SKIN_NAME` (skin identity).
Pass `--no-serve` to only write the zip. To remove a shim skin later:
`curl -X DELETE http://<machine>:8080/api/v1/webui/skins/<id>`.

The default Decent skin folder is:

```text
~/Library/Containers/net.tadel.reaprime/Data/Documents/web-ui/beanie
```

Override it with `DECENT_SKIN_DIR=/path/to/beanie`.

### Runtime data and privacy

- Beans, bags, shots, profiles, workflows, machine settings, and synced Beanie
  preferences are read from or written to the Decent.app gateway. IndexedDB
  copies are caches used for startup/offline continuity.
- Demo mode uses bundled sample records. Changes made there are simulated and
  are not written to the machine or silently promoted into the real library.
- Screensaver photos, theme, scanner device choice, and other explicitly
  per-device UI state stay in that browser/WebView.
- The optional bag-label scanner stores its Gemini API key only on the current
  device. On upgrade, Beanie migrates a legacy gateway-stored key to the device
  and removes the gateway copy.
- Testing a key sends only that key to Gemini's model-list endpoint. Starting a
  scan then sends the selected, device-downscaled label images and its
  extraction prompt directly from the browser to Google Gemini; the prompt may
  include up to 60 active roaster/bean names as spelling context. Photos and
  library context are not sent before Scan. Deleting the device key disables
  future scans until another key is entered.

See [Security and operations](docs/security-and-operations.md) for the network,
storage, third-party-service, CI, and release trust boundaries.

### Release

```bash
npm test
npm run test:browser     # builds/tests dist; first time: npx playwright install chromium
npm run release -- --dry-run
npm run release
npm run release:zip
```

Releases are published from Git tags. `npm run release` fetches tags, finds the
highest `vX.Y.Z` tag, requires matching non-empty changelog notes, and bumps the
project and skin manifest versions. It must run from an up-to-date `main` and
runs the unit and browser tests, production build, and manifest validation
before creating a commit or tag; a failed check restores
the version files. A successful run commits the bump, creates the annotated
tag, and atomically pushes the commit and tag. `--allow-dirty` permits untracked
files only, never uncommitted tracked changes.

Pull requests and pushes to `main` run the same install, test, build, and
manifest checks. On a release tag, a read-only validation job builds
`beanie-vX.Y.Z.zip`; only the isolated publish job receives permission to attach
that validated bundle to the GitHub release.
