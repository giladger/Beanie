// Reconnect pacing for the gateway WebSockets. The tablet's wifi link to the
// gateway drops routinely (sleep, AP roaming, gateway restarts); each socket
// retries on its own schedule, backing off so a long outage doesn't hammer
// the network stack, but capped low — on a LAN the cost of retrying is tiny
// and the cost of staying disconnected is a stale-looking skin.

const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 15_000;

/**
 * Delay before reconnect attempt `attempt` (0-based): 1s, 2s, 4s, 8s, then
 * 15s for every attempt after that.
 */
export function reconnectDelayMs(attempt: number): number {
  if (!Number.isFinite(attempt) || attempt <= 0) return BASE_DELAY_MS;
  return Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.min(attempt, 6));
}
