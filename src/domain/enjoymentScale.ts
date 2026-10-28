/**
 * Shot enjoyment scale.
 *
 * The gateway stores `annotations.enjoyment` on a 0-10 scale since Decaid 0.8.7
 * (database schema 6): its migration rescales every stored rating above 10
 * from the de1app-era 0-100 scale to 0-10 (80 -> 8), its de1app importers do
 * the same, and PUT /api/v1/shots/:id rejects anything above 10. The gateway's
 * own Visualizer plugin scales ratings back to 0-100 on upload, so Beanie only
 * ever speaks 0-10 to the gateway.
 *
 * Gateways older than 0.8.7 still hold 0-100 ratings, so reads normalize with
 * the same rule as the gateway's migration: anything above 10 can only be a
 * legacy 0-100 rating.
 */
export const ENJOYMENT_MAX = 10;
const LEGACY_ENJOYMENT_MAX = 100;

/**
 * The enjoyment on the 0-10 scale, or null for an unrated shot (null, or the
 * 0 that de1app imports use as "not rated").
 */
export function normalizeEnjoyment(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  const scaled = value > ENJOYMENT_MAX ? (value * ENJOYMENT_MAX) / LEGACY_ENJOYMENT_MAX : value;
  return Math.min(scaled, ENJOYMENT_MAX);
}
