#!/usr/bin/env node
// Installs the Beanie dev shim onto a connected Android device running Decent.app,
// so the on-device webview live-loads JS modules from your machine's Vite server.
//
// Unlike install-dev-shim.mjs (desktop, writes to the macOS container folder), this:
//   - points the shim at your machine's LAN IP (the tablet can't reach localhost), and
//   - pushes it into the device's app-private skin folder via `adb run-as`.
//
// Usage:
//   node scripts/install-dev-shim-device.mjs      (or: npm run skin:shim:device)
//
// Env overrides:
//   VITE_DEV_ORIGIN   full origin, e.g. http://10.0.0.63:5173 (skips IP autodetect)
//   BEANIE_DEV_HOST   just the host/IP (port defaults to 5173)
//   VITE_PORT         Vite port (default 5173)
//   ANDROID_SERIAL    target a single device serial (default: every debuggable one)
//   DECENT_PACKAGE    app package id (default net.tadel.reaprime)
//   ADB               path to adb (default: $ANDROID_HOME, ~/Library/Android/sdk, or PATH)

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import dgram from 'node:dgram';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { devShimHtml } from './shim-template.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = process.env.DECENT_PACKAGE ?? 'net.tadel.reaprime';

const manifestPathLocal = path.join(root, 'public', 'manifest.json');
if (!existsSync(manifestPathLocal)) fail(`missing ${manifestPathLocal}`);
const manifestJson = readFileSync(manifestPathLocal, 'utf8');
const skinId = JSON.parse(manifestJson).id;
if (!skinId) fail('public/manifest.json has no "id"');

const origin = await resolveOrigin();
// No gateway override: the page stays on Decent's localhost:3000, so the skin
// resolves the gateway to the device's own localhost:8080 automatically.
const shimHtml = devShimHtml(origin, '');

const adb = resolveAdb();
if (!adb) fail('adb not found — set ADB=/path/to/adb or install Android platform-tools');

let serials = listDevices(adb);
if (process.env.ANDROID_SERIAL) serials = serials.filter((s) => s === process.env.ANDROID_SERIAL);
if (!serials.length) fail('no connected devices (check `adb devices`)');

const targets = serials.filter((s) => packageDebuggable(adb, s, pkg));
if (!targets.length) {
  fail(
    `no connected device has a debuggable "${pkg}".\n` +
      `        Install a debug build first (e.g. \`flutter run\`); release builds can't be written via run-as.`
  );
}

const backupsDir = path.join(os.tmpdir(), `decent-dev-shim-${skinId}`);
console.log(`ok - skin id:     ${skinId}`);
console.log(`ok - vite origin: ${origin}`);
console.log(`ok - package:     ${pkg}`);

let anyBackup = false;
for (const serial of targets) {
  try {
    const res = installToDevice(serial);
    anyBackup = anyBackup || Boolean(res.backupPath);
    const backup = res.backupPath ? ` (backup: ${res.backupPath})` : '';
    console.log(`${res.ok ? 'ok  ' : 'warn'} - ${serial}: ${res.ok ? 'installed' : 'INSTALLED BUT UNVERIFIED'} ${res.indexPath}${backup}`);
  } catch (err) {
    console.log(`error - ${serial}: ${err.message}`);
  }
}

console.log('');
console.log('next:');
console.log('  1. start Vite if it is not already running:   npm run dev');
console.log('  2. on the tablet, return to the dashboard and reopen the skin');
console.log('  3. edit src/* — changes hot-reload on the device (no rebuild, no re-push)');
if (anyBackup) {
  console.log('');
  console.log('to revert a device to its previous build:');
  console.log(`  "$ADB" -s <serial> shell "run-as ${pkg} sh -c 'cat > app_flutter/web-ui/${skinId}/index.html'" < <backup-file>`);
}

// ---------- helpers ----------

function installToDevice(serial) {
  const dir = `app_flutter/web-ui/${skinId}`;
  const indexPath = `${dir}/index.html`;
  const manifestPath = `${dir}/manifest.json`;

  runAs(serial, ['mkdir', '-p', dir]);

  // Back up the current index.html (if it exists and isn't already our shim).
  const existing = readRemote(serial, indexPath);
  let backupPath = null;
  if (existing && existing.trim() && existing !== shimHtml) {
    mkdirSync(backupsDir, { recursive: true });
    backupPath = path.join(backupsDir, `${skinId}-${safe(serial)}-index.html`);
    writeFileSync(backupPath, existing);
  }

  writeRemote(serial, manifestPath, manifestJson);
  writeRemote(serial, indexPath, shimHtml);

  const after = readRemote(serial, indexPath);
  const ok = after === shimHtml || after.includes(`${origin}/src/main.ts`);
  return { indexPath, backupPath, ok };
}

function writeRemote(serial, remotePath, content) {
  // Stream the file into a run-as'd `cat >` (app-private storage). The whole
  // remote command must be one quoted arg — adb re-parses it on the device.
  const r = spawnSync(adb, ['-s', serial, 'shell', `run-as ${pkg} sh -c 'cat > ${remotePath}'`], {
    input: content,
  });
  if (r.status !== 0) {
    throw new Error(`write ${remotePath} failed: ${(r.stderr || r.stdout || '').toString().trim()}`);
  }
}

function readRemote(serial, remotePath) {
  // exec-out is raw (no pty), so file bytes come back untouched.
  const r = spawnSync(adb, ['-s', serial, 'exec-out', 'run-as', pkg, 'cat', remotePath], {
    encoding: 'utf8',
  });
  return r.status === 0 ? r.stdout || '' : '';
}

function runAs(serial, cmd) {
  return spawnSync(adb, ['-s', serial, 'exec-out', 'run-as', pkg, ...cmd], { encoding: 'utf8' });
}

function listDevices(adbPath) {
  const out = spawnSync(adbPath, ['devices'], { encoding: 'utf8' });
  if (out.status !== 0) return [];
  return out.stdout
    .split('\n')
    .slice(1)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split(/\s+/))
    .filter(([, state]) => state === 'device')
    .map(([serial]) => serial);
}

function packageDebuggable(adbPath, serial, packageId) {
  const r = spawnSync(adbPath, ['-s', serial, 'exec-out', 'run-as', packageId, 'true'], {
    encoding: 'utf8',
  });
  const msg = `${r.stderr || ''}${r.stdout || ''}`;
  return r.status === 0 && !/run-as:|unknown package|not debuggable/i.test(msg);
}

function resolveAdb() {
  const candidates = [];
  if (process.env.ADB) candidates.push(process.env.ADB);
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (sdk) candidates.push(path.join(sdk, 'platform-tools', 'adb'));
  candidates.push(path.join(os.homedir(), 'Library/Android/sdk/platform-tools/adb'));
  candidates.push(path.join(os.homedir(), 'Android/Sdk/platform-tools/adb'));
  for (const c of candidates) if (c && existsSync(c)) return c;
  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['adb'], {
    encoding: 'utf8',
  });
  if (which.status === 0 && which.stdout.trim()) return which.stdout.split('\n')[0].trim();
  return null;
}

async function resolveOrigin() {
  if (process.env.VITE_DEV_ORIGIN) return process.env.VITE_DEV_ORIGIN.replace(/\/$/, '');
  const port = process.env.VITE_PORT ?? '5173';
  const host = process.env.BEANIE_DEV_HOST ?? (await detectLanIp()) ?? privateIpv4();
  if (!host) {
    fail('could not determine your LAN IP — set BEANIE_DEV_HOST=<ip> or VITE_DEV_ORIGIN=http://<ip>:5173');
  }
  return `http://${host}:${port}`;
}

// Source IP toward the default route — the address the tablet reaches us on.
// connect() on a UDP socket sets the default peer; it sends no packets.
function detectLanIp() {
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4');
    let settled = false;
    let timer;
    const done = (ip) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        sock.close();
      } catch {}
      resolve(ip);
    };
    sock.once('error', () => done(null));
    sock.once('connect', () => {
      let ip = null;
      try {
        ip = sock.address().address;
      } catch {}
      done(ip);
    });
    timer = setTimeout(() => done(null), 800);
    try {
      sock.connect(80, '8.8.8.8');
    } catch {
      done(null);
    }
  });
}

function privateIpv4() {
  const ifaces = os.networkInterfaces();
  const addrs = [];
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) addrs.push(ni.address);
    }
  }
  const isPrivate = (ip) =>
    /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
  return addrs.find(isPrivate) || addrs[0] || null;
}

function safe(s) {
  return s.replace(/[^A-Za-z0-9._-]/g, '_');
}

function fail(msg) {
  console.error(`error - ${msg}`);
  process.exit(1);
}
