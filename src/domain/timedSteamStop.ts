export type MachineServiceState = 'steam' | 'flush' | 'hotWater';
export type MachineServicePhase = 'starting' | 'active' | 'purging';

export const STEAM_DURATION_MACHINE_HEADROOM_SECONDS = 3;
export const MAX_STEAM_DURATION_SECONDS = 180;

interface TimedSteamStopDelayInput {
  service: MachineServiceState | null;
  phase: MachineServicePhase | null;
  startedAtMs: number | null;
  stopRequested: boolean;
  targetSeconds: number | null;
  nowMs: number;
}

export function timedSteamStopDelayMs({
  service,
  phase,
  startedAtMs,
  stopRequested,
  targetSeconds,
  nowMs
}: TimedSteamStopDelayInput): number | null {
  if (service !== 'steam') return null;
  if (phase !== 'active') return null;
  if (stopRequested) return null;
  if (startedAtMs == null) return null;
  if (targetSeconds == null || targetSeconds <= 0) return null;

  const fireAtMs = startedAtMs + targetSeconds * 1000;
  return Math.max(0, fireAtMs - nowMs);
}

export function paddedSteamDurationSeconds(
  userSeconds: number | null | undefined
): number | null {
  if (typeof userSeconds !== 'number' || !Number.isFinite(userSeconds) || userSeconds <= 0) {
    return null;
  }
  return Math.min(
    MAX_STEAM_DURATION_SECONDS,
    Math.ceil(userSeconds + STEAM_DURATION_MACHINE_HEADROOM_SECONDS)
  );
}
