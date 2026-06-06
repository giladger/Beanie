export type MachineServiceState = 'steam' | 'flush' | 'hotWater';
export type MachineServicePhase = 'starting' | 'active' | 'purging';

export const TIMED_STEAM_PURGE_DELAY_MS = 250;

interface TimedSteamAutoPurgeDelayInput {
  service: MachineServiceState | null;
  phase: MachineServicePhase | null;
  startedAtMs: number | null;
  purgeRequested: boolean;
  targetSeconds: number | null;
  nowMs: number;
}

export function timedSteamAutoPurgeDelayMs({
  service,
  phase,
  startedAtMs,
  purgeRequested,
  targetSeconds,
  nowMs
}: TimedSteamAutoPurgeDelayInput): number | null {
  if (service !== 'steam') return null;
  if (phase !== 'active') return null;
  if (purgeRequested) return null;
  if (startedAtMs == null) return null;
  if (targetSeconds == null || targetSeconds <= 0) return null;

  const fireAtMs = startedAtMs + targetSeconds * 1000;
  return Math.max(0, fireAtMs - nowMs);
}

export function timedSteamTargetReached({
  startedAtMs,
  targetSeconds,
  nowMs
}: {
  startedAtMs: number | null;
  targetSeconds: number | null;
  nowMs: number;
}): boolean {
  if (startedAtMs == null) return false;
  if (targetSeconds == null || targetSeconds <= 0) return false;
  return nowMs - startedAtMs >= targetSeconds * 1000;
}
