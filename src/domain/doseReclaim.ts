/**
 * Resolve a physical +grams reclaim against current stock.
 *
 * Callers validate that remaining is non-negative and dose is positive before
 * reaching this policy. A known, internally consistent bag weight is a hard
 * cap. An inconsistent cap below already-observed remaining stock is ignored:
 * reclaim must never reduce stock merely to repair unrelated metadata.
 */
export function doseReclaimRemaining(
  currentRemaining: number,
  dose: number,
  knownBagWeight: number | null | undefined
): number {
  const cap = positiveFinite(knownBagWeight);
  const increased = roundGrams(currentRemaining + dose);
  return cap == null || cap < currentRemaining
    ? increased
    : roundGrams(Math.min(cap, increased));
}

function positiveFinite(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function roundGrams(value: number): number {
  return Math.round(value * 10) / 10;
}
