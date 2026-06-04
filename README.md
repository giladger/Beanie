# Beanie

<img src="public/icon.png" alt="Beanie coffee bean icon" width="240" />

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
- Local storage only for skin-owned conveniences such as bean presets and the last selected bean.

See [docs/workplan.md](docs/workplan.md) for the product and engineering plan.

### Local Dev

```bash
npm install
npm run skin:dev
```

`npm run skin:dev` writes a small development shim into Decent.app's Beanie skin
folder, then starts Vite on `localhost:5173`. Decent.app still opens the skin
from `http://localhost:3000/`, but the page loads the app modules from Vite, so
source changes hot reload without rebuilding or copying `dist`.

During development, Beanie resolves Decent.app API calls from the Decent-served
page. On the local machine this means the skin uses the gateway at
`localhost:8080`. Override with:

```bash
BEANIE_GATEWAY=http://192.168.1.42:8080 npm run skin:dev
```

If no gateway is reachable, the skin falls back to realistic demo data so the UI remains inspectable.

Useful development commands:

```bash
npm run skin:shim     # only install the Decent.app -> Vite shim
npm run skin:dev      # install the shim and start Vite with hot reload
npm run skin:deploy   # build and copy the static skin into Decent.app
npm run release       # tag and push the next patch release
npm run release:zip   # build the installable release zip
```

The default Decent skin folder is:

```text
~/Library/Containers/net.tadel.reaprime/Data/Documents/web-ui/beanie
```

Override it with `DECENT_SKIN_DIR=/path/to/beanie`.

### Release

```bash
npm test
npm run release -- --dry-run
npm run release
npm run release:zip
```

Releases are published from Git tags. `npm run release` fetches tags, finds the
highest `vX.Y.Z` tag, bumps the project and skin manifest versions, commits the
bump, creates the next patch tag, and pushes both the commit and tag. The GitHub
release workflow verifies the tag matches `package.json`, builds
`beanie-vX.Y.Z.zip`, and attaches it to the release.
