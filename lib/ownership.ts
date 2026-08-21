// Sprint 10 (exact slice) — mini-league effective ownership.
//
// The GW1 deadline made any entry's picks public, so this reads real
// picks for the leagues in manager_leagues (via supabase/functions/
// sync-league-picks + league_entries/league_entry_picks) rather than the
// sampled top-1k template the full Sprint 10 needs. Every figure here is
// scoped to one league — see docs/roadmap.md's "GW1 live-data unlock" phase
// 2 and docs/sprints/sprint-10.md for the formulas this implements verbatim:
//
//   EO           = ownership × multiplier      (captain 2×, triple captain 3×, bench 0×)
//   Differential = xP × (1 − EO) × Upside × MinutesProbability
//   RankGain     = ExpectedPoints × (1 − EO)
//
// A small league's EO is exact but is about that league, not the game —
// every reader of these figures must show the league name and entry count
// alongside the number, never a bare "EO" (CLAUDE.md: "say what the number
// means").

import { clamp } from "./stats";

export const OWNERSHIP_MODEL_NOTE =
  "Effective ownership here is exact for this league, not the game — it's computed from every " +
  "member's real picks for this gameweek, not the top-1k sample the full Ownership Intelligence " +
  "sprint uses. A small league's EO can swing hard on one captain pick, and can exceed 100% if " +
  "several members captain the same player (their share counts twice).";

export const UPSIDE_MODEL_NOTE =
  "Upside is a disclosed input, not a modelled term — nothing in this app's data measures a " +
  "player's ceiling above his expected points, so rather than invent a coefficient (CLAUDE.md: " +
  "\"never tune an invented coefficient until the answer looks reasonable\"), it defaults to 1 " +
  "(neutral) and is exposed for the caller to set explicitly, the same way decisionMargin is in " +
  "lib/transfer-optimizer.ts.";

export interface LeaguePickRow {
  entryId: number;
  element: number;
  /** Raw FPL multiplier: 0 bench, 1 playing, 2 captain, 3 triple captain — already carries the
   *  chip effect (a live Bench Boost sets bench multiplier to 1, not 0; see manager-picks.ts). */
  multiplier: number;
  isCaptain: boolean;
}

export interface PlayerOwnership {
  element: number;
  /** How many of the league's entries own this player anywhere in their 15. */
  owners: number;
  ownershipPct: number;
  captains: number;
  tripleCaptains: number;
  /** Σ multiplier / entry count — the EO formula above, can exceed 1. */
  eo: number;
}

/**
 * One league's effective ownership for every player picked by any member,
 * for one gameweek's picks. `numEntries` is passed separately rather than
 * inferred from the picks, so a league snapshot that's still mid-sync (some
 * members' picks not yet fetched) doesn't silently understate EO — the
 * denominator is the league's real membership count from league_entries,
 * not "however many picks rows happen to be here yet".
 */
export function computeLeagueOwnership(
  picks: LeaguePickRow[],
  numEntries: number,
): Map<number, PlayerOwnership> {
  interface Acc {
    owners: Set<number>;
    captains: number;
    tripleCaptains: number;
    shareSum: number;
  }
  const byPlayer = new Map<number, Acc>();

  for (const p of picks) {
    const acc = byPlayer.get(p.element) ?? {
      owners: new Set<number>(),
      captains: 0,
      tripleCaptains: 0,
      shareSum: 0,
    };
    acc.owners.add(p.entryId);
    acc.shareSum += p.multiplier;
    if (p.isCaptain) {
      // The triple-captain chip keeps is_captain true and raises the
      // multiplier to 3 — league_entry_picks has no separate flag for it,
      // so it's derived from the multiplier here rather than stored twice.
      if (p.multiplier >= 3) acc.tripleCaptains += 1;
      else acc.captains += 1;
    }
    byPlayer.set(p.element, acc);
  }

  const result = new Map<number, PlayerOwnership>();
  for (const [element, acc] of byPlayer) {
    result.set(element, {
      element,
      owners: acc.owners.size,
      ownershipPct: numEntries > 0 ? acc.owners.size / numEntries : 0,
      captains: acc.captains,
      tripleCaptains: acc.tripleCaptains,
      eo: numEntries > 0 ? acc.shareSum / numEntries : 0,
    });
  }
  return result;
}

/**
 * `Differential = xP × (1 − EO) × Upside × MinutesProbability`.
 *
 * EO is clamped to [0, 1] for this term specifically: a heavily-captained
 * player in a small league can carry EO above 100%, and `1 - EO` going
 * negative would flip "nobody else has him" into a bonus rather than a
 * floor of zero. The raw (unclamped) EO is still what PlayerOwnership.eo
 * reports — only the differential/rank-gain terms clamp it.
 */
export function differentialScore(
  xp: number,
  eo: number,
  minutesProbability: number,
  upside = 1,
): number {
  return xp * (1 - clamp(eo, 0, 1)) * upside * clamp(minutesProbability, 0, 1);
}

/** `RankGain = ExpectedPoints × (1 − EO)`, same EO clamp as differentialScore. */
export function rankGain(expectedPoints: number, eo: number): number {
  return expectedPoints * (1 - clamp(eo, 0, 1));
}
