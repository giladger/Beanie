// reaprime identifies a profile by a content hash of its brew settings — steps,
// temperatures, targets and beverage type, but *not* title/author/notes (see
// reaprime's profile_hash.dart). Saving an edited profile therefore hands it a
// NEW id: `ProfileController.update` deletes the old record and stores the new
// one whenever the hash moves, and a bundled default can't be written in place
// at all, so editing one creates a copy.
//
// Any marker Beanie keeps that names a profile by id has to travel with it
// across that move, or the profile silently loses its standing in the app —
// which is what made an edited favourite stop being a favourite. Markers keyed
// by *title* need no carry: the title is precisely what the hash leaves out, so
// flow-calibration overrides survive on their own.
//
// Favourites are the only id-keyed marker currently wired up. The cleaning
// profile override (domain/cleaning.ts) is id-keyed too and will need the same
// carry on the day something starts writing it.

export interface ProfileIdentityMove {
  /** The id the editor was opened on. */
  from: string;
  /** The id the save landed on. */
  to: string;
  /**
   * Whether `from` is gone. A settings edit re-hashes the record and reaprime
   * drops the old id — a move, so the marker goes with it. Copying a bundled
   * default leaves the original standing — a fork, where the original keeps its
   * own star and the copy inherits one rather than stealing it.
   */
  replaced: boolean;
}

/**
 * Re-point the favourites list after a save moved a profile to a new id. Order
 * is preserved, so a favourite keeps its place in the list and a fork's copy
 * lands next to the profile it came from. Returns a new list; never mutates.
 */
export function carryProfileFavorite(
  favoriteProfileIds: readonly string[],
  move: ProfileIdentityMove
): string[] {
  if (!move.from || !move.to || move.from === move.to) return [...favoriteProfileIds];
  const carried: string[] = [];
  for (const id of favoriteProfileIds.flatMap((id) =>
    id === move.from ? (move.replaced ? [move.to] : [move.from, move.to]) : [id]
  )) {
    if (!carried.includes(id)) carried.push(id);
  }
  return carried;
}
