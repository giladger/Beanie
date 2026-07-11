#!/usr/bin/env node
// Build a "zip shim": a tiny skin zip (shim index.html + manifest.json) that you
// install through Decent.app's OWN skin installer. Because the app unpacks the
// zip into its skin folder itself, this works on RELEASE builds — unlike
// install-dev-shim-device.mjs, which needs `adb run-as` and a debuggable build.
//
// The shim only carries index.html + manifest.json; all JS/CSS is live-loaded
// from your machine's Vite server, so source edits hot-reload on the device.
//
// By default it also serves the zip over HTTP and prints a QR code, so you can
// download it straight onto the tablet and feed it to the installer.
//
// Usage:
//   node scripts/build-shim-zip.mjs            (or: npm run skin:shim:zip:lan)
//   node scripts/build-shim-zip.mjs --no-serve (or: npm run skin:shim:zip)
//
// Env overrides:
//   VITE_DEV_ORIGIN   full Vite origin embedded in the shim, e.g. http://10.0.0.63:5173
//   BEANIE_DEV_HOST   just the host/IP for the Vite origin (port defaults to VITE_PORT)
//   VITE_PORT         Vite port the shim loads modules from (default 5173)
//   SHIM_ZIP_PORT     port to serve the zip on (default 5180)
//   SHIM_ZIP_OUT      output zip path (default ./beanie-shim.zip)
//   SHIM_SKIN_ID      skin id to install as (default: "<manifest id>-dev", e.g.
//                     beanie-dev). The "-dev" id makes the shim its own entry in
//                     the skin list. Set it to the release id (beanie) to
//                     overwrite the release in place instead.
//   SHIM_SKIN_NAME    skin display name (default: "<manifest name> (dev)")

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import qrcode from 'qrcode-generator';
import { devShimHtml } from './shim-template.mjs';
import { resolveLanViteOrigin, resolveLanHost } from './net.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serve = !process.argv.includes('--no-serve');

const manifestPath = path.join(root, 'public', 'manifest.json');
if (!existsSync(manifestPath)) fail(`missing ${manifestPath}`);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (!manifest.id) fail('public/manifest.json has no "id"');
// A zip shim is a dev tool, so default to a distinct "<id>-dev" / "<name> (dev)"
// identity: it installs as its own entry in the skin list instead of clobbering
// the release. Override either with SHIM_SKIN_ID / SHIM_SKIN_NAME.
manifest.name = process.env.SHIM_SKIN_NAME ?? `${manifest.name} (dev)`;
manifest.id = process.env.SHIM_SKIN_ID ?? `${manifest.id}-dev`;
const skinId = manifest.id;
const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;

const origin = await resolveLanViteOrigin();
if (!origin) {
  fail('could not determine your LAN IP — set BEANIE_DEV_HOST=<ip> or VITE_DEV_ORIGIN=http://<ip>:5173');
}

// Empty gateway: the page stays on Decent's own origin, so the skin resolves the
// gateway to the device's localhost:8080 — same as the device shim.
const shimHtml = devShimHtml(origin, '');

const stageDir = path.join(os.tmpdir(), `beanie-shim-zip-${skinId}`);
rmSync(stageDir, { recursive: true, force: true });
mkdirSync(stageDir, { recursive: true });
writeFileSync(path.join(stageDir, 'index.html'), shimHtml);
writeFileSync(path.join(stageDir, 'manifest.json'), manifestJson);

const outZip = path.resolve(process.env.SHIM_ZIP_OUT ?? path.join(root, 'beanie-shim.zip'));
rmSync(outZip, { force: true });
// Run from the stage dir so the entries land at the zip root (index.html,
// manifest.json) — the layout Decent expects, matching release:zip.
const z = spawnSync('zip', ['-r', outZip, 'index.html', 'manifest.json'], {
  cwd: stageDir,
  encoding: 'utf8',
});
if (z.status !== 0) fail(`zip failed: ${(z.stderr || z.stdout || '').trim()}`);

const zipBuf = readFileSync(outZip);
console.log(`ok - skin id:     ${skinId}`);
console.log(`ok - vite origin: ${origin}`);
console.log(`ok - wrote:       ${outZip} (${(zipBuf.length / 1024).toFixed(1)} KB)`);

if (!serve) {
  console.log('');
  console.log('next: run `npm run skin:shim:zip:lan` to serve the zip to a device,');
  console.log('      or host the generated file yourself. The device also needs `npm run dev:lan`.');
  process.exit(0);
}

const servePort = Number(process.env.SHIM_ZIP_PORT ?? 5180);
const serveHost = await resolveLanHost();
// Reply with the whole buffer and close the socket. Decent's Dart HTTP client
// rejects a streamed keep-alive response ("Connection closed before full header
// was received"); a single-shot Connection: close response is what it expects.
const server = http.createServer((_req, res) => {
  res.writeHead(200, {
    'Content-Type': 'application/zip',
    'Content-Length': zipBuf.length,
    'Content-Disposition': `attachment; filename="${path.basename(outZip)}"`,
    Connection: 'close',
  });
  res.end(zipBuf);
});
server.keepAliveTimeout = 0;

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    fail(`port ${servePort} is in use — set SHIM_ZIP_PORT=<port> to pick another`);
  }
  fail(err.message);
});

server.listen(servePort, '0.0.0.0', () => {
  const url = serveHost
    ? `http://${serveHost}:${servePort}/${path.basename(outZip)}`
    : `http://<this-machine>:${servePort}/${path.basename(outZip)}`;
  console.log('');
  console.log(`ok - serving zip at: ${url}`);
  console.log('');
  if (serveHost) console.log(qrAnsi(url));
  console.log('');
  console.log('next:');
  console.log('  1. start Vite on the LAN if it is not running: npm run dev:lan');
  console.log('  2. open Decent.app\'s skin installer on the machine and paste the URL above');
  console.log('     into the source field (the box you\'d normally type a repo into).');
  console.log('     Decent fetches the zip itself — the QR just helps you copy the URL over.');
  console.log('  3. the skin appears in the list; open it — src/* edits now hot-reload');
  console.log('');
  console.log('keep this running (Decent must reach the URL to install); Ctrl-C to stop.');
});

// ---------- helpers ----------

// Render a URL as a terminal QR using ANSI background colors (light quiet zone,
// two-space cells), so it scans regardless of the terminal's color theme.
function qrAnsi(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const margin = 2;
  const light = '\x1b[47m  \x1b[0m';
  const dark = '\x1b[40m  \x1b[0m';
  const lines = [];
  for (let r = -margin; r < n + margin; r++) {
    let line = '';
    for (let c = -margin; c < n + margin; c++) {
      const on = r >= 0 && r < n && c >= 0 && c < n && qr.isDark(r, c);
      line += on ? dark : light;
    }
    lines.push(line);
  }
  return lines.join('\n');
}

function fail(msg) {
  console.error(`error - ${msg}`);
  process.exit(1);
}
