// LAN address helpers shared by the dev-shim installers. The tablet can't reach
// the desktop's `localhost`, so any shim that runs on a device has to embed the
// machine's LAN IP instead. Both install-dev-shim-device.mjs and
// build-shim-zip.mjs resolve that IP the same way through here.
import os from 'node:os';
import dgram from 'node:dgram';

// Source IP toward the default route — the address another LAN device reaches us
// on. connect() on a UDP socket sets the default peer; it sends no packets.
export function detectLanIp() {
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

export function privateIpv4() {
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

// The host another LAN device should use to reach this machine.
// BEANIE_DEV_HOST overrides autodetect; falls back to the first private IPv4.
export async function resolveLanHost() {
  return process.env.BEANIE_DEV_HOST ?? (await detectLanIp()) ?? privateIpv4();
}

// Full Vite origin to embed in a shim served to a device. VITE_DEV_ORIGIN wins
// outright; otherwise it's http://<lan-host>:<VITE_PORT|5173>. Null if no IP.
export async function resolveLanViteOrigin() {
  if (process.env.VITE_DEV_ORIGIN) return process.env.VITE_DEV_ORIGIN.replace(/\/$/, '');
  const port = process.env.VITE_PORT ?? '5173';
  const host = await resolveLanHost();
  return host ? `http://${host}:${port}` : null;
}
