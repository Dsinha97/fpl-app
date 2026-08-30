// Sprint 29.2 — reconciliation between the FPL transfer ledger
// (manager_transfers, lib/manager-transfers.ts) and the app's own draft
// history. Neither is assumed authoritative: the ledger has real dates and
// prices but only exists once sync-manager has run since the transfer; the
// snapshot diff needs no sync but only sees whatever squad shape was saved
// locally. Showing both, and saying when they disagree, beats silently
// preferring one (CLAUDE.md: "say what the number means").

export interface SquadDiff {
  /** Player ids present in `next` but not `prev`. */
  in: number[];
  /** Player ids present in `prev` but not `next`. */
  out: number[];
}

/** Anything with a flat list of player ids — a `TeamState`, a `DraftSnapshot`
 *  (lib/drafts.ts), or just the raw array. Kept minimal so this doesn't need
 *  to import the full TeamState/DraftSnapshot type to compare two squads. */
export interface SquadLike {
  playerIds: number[];
}

/** Pure set difference between two squads' player ids — order-independent,
 *  a captaincy or bench-order change alone yields an empty diff. */
export function diffSquads(prev: SquadLike | null, next: SquadLike): SquadDiff {
  const prevIds = new Set(prev?.playerIds ?? []);
  const nextIds = new Set(next.playerIds);
  return {
    in: [...nextIds].filter((id) => !prevIds.has(id)),
    out: [...prevIds].filter((id) => !nextIds.has(id)),
  };
}

/**
 * True when the ledger and the snapshot diff don't agree on who came in —
 * out is intentionally not compared the same way: a player can leave the
 * squad by expiring off the bench during optimisation without ever being
 * "transferred out" in FPL's own sense, but who's newly *in* should always
 * match a genuine transfer.
 */
export function diffDisagreesWithLedger(diff: SquadDiff, ledgerInIds: number[]): boolean {
  const ledgerIn = new Set(ledgerInIds);
  const diffIn = new Set(diff.in);
  if (ledgerIn.size !== diffIn.size) return true;
  for (const id of ledgerIn) if (!diffIn.has(id)) return true;
  return false;
}
