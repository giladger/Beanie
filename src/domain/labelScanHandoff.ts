/**
 * Phone hand-off for the label scanner (Phase 2).
 *
 * Signing into Google AI Studio and pasting a key is painful on a wall-mounted
 * tablet, so the tablet shows a QR that opens Beanie's scanner on your phone.
 * The phone loads the same skin from the tablet's gateway over the LAN, does the
 * whole flow there (key + photos + confirm), and commits via the normal REST
 * API — so the tablet never needs a key, and there's nothing to sync.
 *
 * Pure URL helpers; the QR rendering lives in components/qr.ts.
 */

export const HANDOFF_PARAM = 'beanieScan';

// Hosts the phone could never reach — if the tablet's own webview is on one of
// these, the QR would be useless, so callers fall back to on-device setup.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

/**
 * Build the hand-off URL from the current page href: same origin + path, with
 * the scan marker. Returns null when the page is served from a loopback host
 * (the phone couldn't reach it).
 */
export function buildHandoffUrl(href: string, lanHost?: string | null): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  // Prefer the gateway-reported LAN IP: the Decent tablet's webview runs on
  // localhost, so its own hostname isn't reachable from a phone. Fall back to the
  // page host when no LAN host is given.
  const host = lanHost && lanHost.trim() ? lanHost.trim() : url.hostname;
  if (!host || LOCAL_HOSTS.has(host)) return null;
  url.hostname = host;
  url.search = '';
  url.hash = '';
  url.searchParams.set(HANDOFF_PARAM, '1');
  return url.toString();
}

/** True when this page was opened from a hand-off QR. */
export function isHandoffArrival(search: string): boolean {
  return new URLSearchParams(search).get(HANDOFF_PARAM) === '1';
}
