// Shared dev-shim HTML used by both install paths so the shim stays identical:
//   - install-dev-shim.mjs         desktop (writes into the macOS skin folder)
//   - install-dev-shim-device.mjs  Android (pushes into the on-device skin folder)
//
// The shim keeps the page on Decent's own origin (localhost:3000) — so the skin
// still resolves the gateway to the device's localhost:8080 — and only pulls the
// JS modules from Vite at `origin`.
export function devShimHtml(origin, gateway) {
  const gatewayScript = gateway
    ? `    <script>window.BEANIE_GATEWAY = ${JSON.stringify(gateway)};</script>\n`
    : '';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Beanie Dev</title>
${gatewayScript}    <script type="module" src="${origin}/@vite/client"></script>
    <script type="module" src="${origin}/src/main.ts"></script>
  </head>
  <body>
    <div id="app"></div>
  </body>
</html>
`;
}
