# Security and operations

Beanie is a static skin, not a hosted service. Production assets run inside the
Decent.app WebView (or a browser pointed at Decent.app) and communicate with the
machine's gateway. That small deployment shape keeps the trust boundary clear:
the gateway, the browser/WebView storage, and any explicitly enabled external
service are the systems that can hold user data.

This document records the operational defaults. It is not a claim that a
development server or a coffee-machine LAN is safe to expose to the internet.

## Runtime modes and data provenance

Beanie keeps cached gateway resources and bundled sample data separate:

| Mode/source | What the user sees | Persistence behavior |
| --- | --- | --- |
| Gateway | Connected live machine/library data | Writes go to the gateway. |
| Cached gateway data | The user's last cached resources with an offline/limited state | Cache is continuity data, not a second authority; unavailable operations fail visibly or remain disabled. |
| Default for a failed settings endpoint | A safe value with that settings section marked unavailable | The fallback is read-only, so it cannot overwrite a machine value that could not be loaded. |
| Demo | Clearly labelled bundled sample beans, shots, workflow, and machine state | Writes are simulated and never promoted into the user's library. |

Per-resource provenance matters. A successful top-level startup or settings
request must not make a fallback value look live. Repositories/controllers carry
the source of each independently loaded resource, and renderers use that state
to distinguish connected, cached, default, degraded, and demo content.

## Storage boundaries

- Decent.app gateway: beans, bags, shots, profiles, workflows, machine settings,
  plugin settings, wake schedules, and Beanie preferences intended to sync.
- IndexedDB: cache-through copies of gateway collections/pages. Cache reset
  must not be described as deleting remote settings or library data.
- Browser/WebView local storage: explicitly per-device UI choices and small
  recovery markers, including theme, scanner-device choice, and the Gemini API
  key. Recovery queues can also fall back here when IndexedDB is unavailable.
- Screensaver image storage: downscaled photos selected by the user for this
  device. These are not synced through the gateway.

The gateway key/value store is a synchronization mechanism, not a secret vault.
Gemini keys from older Beanie versions are migrated to device-local storage and
the legacy gateway value is deleted. Removing the key in Settings deletes the
device copy.

## Gemini label scanner

The scanner is optional and uses the user's own Gemini API key. A scan is a
direct browser request to Google's Generative Language API; Beanie and the
Decent.app gateway do not proxy it.

Only after the user starts a scan, the request can contain:

- the selected coffee-label images, downscaled on the device;
- the extraction instructions and expected result shape; and
- up to 60 active roaster/bean names from the library, used only as spelling and
  naming context.

The key is sent to Google in the API-key request header and is not placed in the
request URL. Scanned images and prompt text are consequently subject to
Google's service and account terms. Do not use the feature for images or
library names that should not be sent to that provider.

## Development network defaults

Vite's development and preview servers bind to `127.0.0.1` by default. The dev
server restricts CORS to loopback origins and Decent.app's development page at
`http://decent:3000`; it does not expose the write-capable gateway proxy to
arbitrary websites. LAN variants must still be treated as intentionally
exposed developer tools.

| Command | Bind address | Intended use |
| --- | --- | --- |
| `npm run dev` | `127.0.0.1` | Normal desktop development. |
| `npm run dev:local` | `127.0.0.1` | Local development with Vite proxying to `localhost:8080`. |
| `npm run skin:dev` | `127.0.0.1` | Desktop Decent.app shim plus hot reload. |
| `npm run preview` | `127.0.0.1` | Local production-build inspection. |
| `npm run dev:lan` | `0.0.0.0` | A tablet/device loads Vite from this machine. |
| `npm run skin:dev:device` | `0.0.0.0` | Install a shim on a debuggable device and start LAN Vite. |
| `npm run preview:lan` | `0.0.0.0` | Inspect a production build from another trusted-LAN device. |
| `npm run skin:shim:zip` | No listener | Build the development shim ZIP without serving it. |
| `npm run skin:shim:zip:lan` | `0.0.0.0` on the shim ZIP port | Build and serve a shim to a release-build device. Start `dev:lan` separately. |

The `*:lan` servers have no production authentication layer. Use
them only on a trusted network, never port-forward or publicly tunnel them, and
stop them after the device workflow. Override the advertised device address
with `BEANIE_DEV_HOST` or `VITE_DEV_ORIGIN` when automatic LAN detection chooses
the wrong interface.

The production skin is a static bundle served by Decent.app and does not run or
require Vite.

## CI and release controls

Pull requests and pushes to `main` run a read-only validation workflow:

1. install from the lockfile with `npm ci`;
2. run the TypeScript suite and a real-Chromium runtime smoke test;
3. type-check and build the production assets; and
4. validate the public and built manifests.

Third-party GitHub Actions are pinned to commit SHAs. Checkout does not retain
credentials, and the validation workflow has read-only repository permission.

Tag releases separate validation from publication. The validation job has
read-only permission, verifies the `vX.Y.Z` tag against `package.json`, requires
non-empty matching changelog notes, builds the installable ZIP, and uploads that
ZIP plus notes as a short-lived artifact. Only the dependent publish job gets
`contents: write`, and it publishes exactly that validated artifact.

The local `npm run release` command applies the same preflight from an
up-to-date `main` before creating
Git state. It restores version files when validation fails and atomically pushes
the release commit and annotated tag, preventing a half-published tag/branch
pair. `--allow-dirty` permits untracked files only; tracked changes must still be
committed or stashed.

## Operational checklist

- Treat a Demo label and an Offline/limited label as different states during QA.
- Verify unavailable settings sections are read-only before testing recovery.
- Use loopback commands unless a second physical device needs access.
- Stop Vite and shim ZIP servers after on-device development.
- Never commit API keys, exported user data, screenshots containing secrets, or
  a populated browser-storage profile.
- Before tagging, add the matching non-empty `CHANGELOG.md` section and run
  `npm test`, `npm run build`, and `npm run validate:manifest`.
