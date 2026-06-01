# Beanie

Beanie is a bean-first WebUI skin for Decent.app.

The core workflow:

1. Wake into the last active bean and its current workflow.
2. Pick another bean with one tap.
3. Load the last successful setup for that bean: profile, dose, yield, grinder, and grind setting.
4. Review previous shots for that bean with compact graphs.
5. Adjust, apply, clear, and save presets without leaving the workbench.

## Development

```bash
npm install
npm run dev
```

During development, Vite proxies `/api/*` and `/ws/*` to a running Decent.app gateway at `localhost:8080`. Override with:

```bash
GATEWAY_HOST=192.168.1.42:8080 npm run dev
```

If no gateway is reachable, the skin falls back to realistic demo data so the UI remains inspectable.

## Release

```bash
npm test
npm run build
npm run release:zip
```

The release zip is installable from Decent.app's Web Interface settings. The zip contents place `index.html` and `manifest.json` at the root, matching Decent.app's skin installer expectations.

## Architecture

Beanie intentionally follows Streamline's static-web model:

- No UI framework runtime.
- Direct REST and WebSocket calls to the Decent.app gateway.
- Static files served by Decent.app on port 3000.
- Local storage only for skin-owned conveniences such as bean presets and last selected bean.

See [docs/workplan.md](docs/workplan.md) for the product and engineering plan.
