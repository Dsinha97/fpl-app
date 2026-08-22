// Sprint 15 — a manager's squad as it was actually entered, gameweek by
// gameweek, with that gameweek's real points.
//
// Nothing under lib/ read manager_picks before this: /team fetched it inline
// and threw away every event but the latest. Both new squad sections need the
// full history, so the read (and every correctness rule that comes with it)
// lives here once rather than twice in two pages.

import type { ReactNode } from "react";
import { supabase } from "./supabase/client";
// Type-only: the pitch owns the shape of its own prop, and this module is the
// other thing that can produce one. No runtime dependency on components/.
import type { SquadLayout } from "@/components/pitch-view";

/** Supabase caps every response at 1000 rows whatever .limit() asks for. */
const PAGE_ROWS = 1000;

export interface ManagerPick {
  event: number;
  /** 1-11 started, 12-15 benched. See the note on `startersOf` below. */
  position: number;
  element: number;
  /** 0 benched, 1 playing, 2 captain, 3 triple captain. */
  multiplier: number;
  isCaptain: boolean;
  isViceCaptain: boolean;
}

export interface ActualPoints {
  /** Summed across the event's fixtures — a double gameweek has two. */
  points: number;
  minutes: number;
  goals: number;
  assists: number;
  /** How many fixtures contributed. 2 marks a DGW on the card. */
  fixtures: number;
}

/**
 * What a past gameweek's squad scored, as separate terms.
 *
 * Deliberately not one reconciled number. `manager_picks` records the squad as
 * *picked*; FPL's `automatic_subs` — which bench player actually came on for a
 * blank — is not synced by supabase/functions/sync-manager, and
 * manager_gameweek_history.points is FPL's own figure net of any transfer hit.
 * So the two can legitimately disagree, and the honest display shows both with
 * the hit as its own term rather than quietly picking a winner. CLAUDE.md:
 * "say what the number means".
 */
export interface SquadPoints {
  /** Σ over starters of points, before the armband. */
  startersRaw: number;
  /** The captain's extra points on their own — never folded into startersRaw. */
  captain: { element: number; raw: number; multiplier: number; added: number } | null;
  /** startersRaw + captain.added — what the XI on screen adds up to. */
  asPicked: number;
  /** Σ over bench of points. Only actually scored under a Bench Boost. */
  benchRaw: number;
  /** Picks with no stats row at all for the event. */
  missing: number[];
}

export const MANAGER_PICKS_NOTE =
  "This is the squad as you entered it. FPL's automatic substitutions aren't stored here, so when " +
  "a starter blanked, the eleven shown isn't quite the eleven that scored — that's why FPL's own " +
  "gameweek total is shown alongside the total for these picks rather than instead of it. Any " +
  "transfer hit is listed as its own term, never netted off silently.";

// -------------------------------------------------------------- reading

/**
 * Every entered gameweek's picks, keyed by event, each sorted by position.
 *
 * Paged: a full season is ~570 rows for one entry, comfortably under the cap
 * today, but the cap is silent when it bites — a short page is the only
 * reliable end-of-data signal.
 */
export async function loadManagerPicks(
  season: string,
  entryId: number,
): Promise<Map<number, ManagerPick[]>> {
  const byEvent = new Map<number, ManagerPick[]>();

  for (let from = 0; ; from += PAGE_ROWS) {
    const { data, error } = await supabase
      .from("manager_picks")
      .select("event, position, element, multiplier, is_captain, is_vice_captain")
      .eq("season", season)
      .eq("entry_id", entryId)
      .order("event")
      .order("position")
      .range(from, from + PAGE_ROWS - 1);
    if (error) throw new Error(error.message);

    for (const r of data ?? []) {
      const pick: ManagerPick = {
        event: r.event as number,
        position: r.position as number,
        element: r.element as number,
        multiplier: r.multiplier as number,
        isCaptain: r.is_captain as boolean,
        isViceCaptain: r.is_vice_captain as boolean,
      };
      const list = byEvent.get(pick.event);
      if (list) list.push(pick);
      else byEvent.set(pick.event, [pick]);
    }

    if ((data?.length ?? 0) < PAGE_ROWS) break;
  }

  return byEvent;
}

export interface EventPointsResult {
  byPlayer: Map<number, ActualPoints>;
  /**
   * True when the figures came from player_live_stats — a gameweek still in
   * progress, where bonus points have not been finalised.
   */
  provisional: boolean;
}

/**
 * One gameweek's real points for a set of players.
 *
 * `player_gameweek_stats` is keyed per **fixture** (season, player_id,
 * fixture), so a double gameweek is two rows and reading one of them loses
 * half the return — every field here is summed per player, not taken from a
 * single row.
 *
 * Finalised and live rows are merged **per player**, by whichever source has
 * recorded more minutes — not by whether a finalised row merely exists.
 * sync-player-history's element-summary read can carry a *pre-kickoff*
 * placeholder row for the event's own fixture (zeroed stats, `kickoff_time`
 * in the future) well before it's played, so "a finalised row exists" is not
 * the same as "this player's result is settled" — verified directly against
 * GW1: two players' finalised rows sat at 0 points/0 minutes with a same-day
 * future kickoff while `player_live_stats` already showed 80 minutes played.
 * Taking the higher-minutes source per player self-corrects once the
 * finalised row is rewritten after the match, and a genuine 0-minute
 * result (an unused sub) is unaffected since neither source has more to
 * offer. `provisional` reports whether *any* player in the result came from
 * the live snapshot.
 *
 * Per-event and lazy by design: a whole season for a ~50-element pick history
 * is a few thousand rows, so pages fetch the event the user is looking at
 * rather than everything up front.
 */
export async function loadEventPoints(
  season: string,
  event: number,
  playerIds: number[],
): Promise<EventPointsResult> {
  const byPlayer = new Map<number, ActualPoints>();
  if (playerIds.length === 0) return { byPlayer, provisional: false };

  const ids = [...new Set(playerIds)];
  const finalisedByPlayer = new Map<number, ActualPoints>();

  for (let from = 0; ; from += PAGE_ROWS) {
    const { data, error } = await supabase
      .from("player_gameweek_stats")
      .select("player_id, total_points, minutes, goals_scored, assists")
      .eq("season", season)
      .eq("event", event)
      .in("player_id", ids)
      .order("player_id")
      .range(from, from + PAGE_ROWS - 1);
    if (error) throw new Error(error.message);

    for (const r of data ?? []) {
      const id = r.player_id as number;
      const acc = finalisedByPlayer.get(id) ?? { points: 0, minutes: 0, goals: 0, assists: 0, fixtures: 0 };
      acc.points += (r.total_points as number | null) ?? 0;
      acc.minutes += (r.minutes as number | null) ?? 0;
      acc.goals += (r.goals_scored as number | null) ?? 0;
      acc.assists += (r.assists as number | null) ?? 0;
      acc.fixtures += 1;
      finalisedByPlayer.set(id, acc);
    }

    if ((data?.length ?? 0) < PAGE_ROWS) break;
  }

  // Always fetch the live snapshot too — not just for players with no
  // finalised row — since a finalised row can itself be the stale
  // pre-kickoff placeholder described above.
  const { data: live, error: liveError } = await supabase
    .from("player_live_stats")
    .select("player_id, total_points, minutes, goals_scored, assists")
    .eq("season", season)
    .eq("event", event)
    .in("player_id", ids);
  if (liveError) throw new Error(liveError.message);

  const liveByPlayer = new Map<number, ActualPoints>();
  for (const r of live ?? []) {
    liveByPlayer.set(r.player_id as number, {
      points: (r.total_points as number | null) ?? 0,
      minutes: (r.minutes as number | null) ?? 0,
      goals: (r.goals_scored as number | null) ?? 0,
      assists: (r.assists as number | null) ?? 0,
      fixtures: 1,
    });
  }

  let provisional = false;
  for (const id of ids) {
    const fin = finalisedByPlayer.get(id);
    const liv = liveByPlayer.get(id);
    if (fin && liv) {
      if (liv.minutes > fin.minutes) {
        byPlayer.set(id, liv);
        provisional = true;
      } else {
        byPlayer.set(id, fin);
      }
    } else if (fin) {
      byPlayer.set(id, fin);
    } else if (liv) {
      byPlayer.set(id, liv);
      provisional = true;
    }
  }

  return { byPlayer, provisional };
}

// -------------------------------------------------------------- shaping

/**
 * The eleven that started, by **position**, not by `multiplier > 0`.
 *
 * Under a Bench Boost every pick has a non-zero multiplier, so the multiplier
 * test promotes the bench onto the pitch in exactly the gameweek where the
 * distinction matters. Position is the reliable rule; multiplier is used only
 * to scale points.
 */
export const startersOf = (picks: ManagerPick[]): ManagerPick[] =>
  picks.filter((p) => p.position <= 11).sort((a, b) => a.position - b.position);

export const benchOf = (picks: ManagerPick[]): ManagerPick[] =>
  picks.filter((p) => p.position >= 12).sort((a, b) => a.position - b.position);

/** "3-4-3" from the starting XI's element types, matching lib/lineup.ts's format. */
export function formationOf(
  starters: ManagerPick[],
  elementTypeOf: (playerId: number) => number | undefined,
): string {
  const count = (type: number) =>
    starters.filter((p) => elementTypeOf(p.element) === type).length;
  return `${count(2)}-${count(3)}-${count(4)}`;
}

/** The pitch layout for a gameweek already played — a known XI, not a projection. */
export function layoutFromPicks(
  picks: ManagerPick[],
  elementTypeOf: (playerId: number) => number | undefined,
  benchSummary: ReactNode,
): SquadLayout {
  const starters = startersOf(picks);
  return {
    starters: starters.map((p) => p.element),
    bench: benchOf(picks).map((p) => p.element),
    formation: formationOf(starters, elementTypeOf),
    // No auto-sub probabilities: this gameweek has already happened, and a
    // forecast of it would be a category error.
    subProbability: new Map(),
    benchSummary,
  };
}

/** Splits a gameweek's return into terms that can each be shown and defended. */
export function squadPointsFor(
  picks: ManagerPick[],
  actual: Map<number, ActualPoints>,
): SquadPoints {
  const missing: number[] = [];
  const pointsOf = (element: number): number => {
    const row = actual.get(element);
    if (!row) {
      missing.push(element);
      return 0;
    }
    return row.points;
  };

  let startersRaw = 0;
  let captain: SquadPoints["captain"] = null;

  for (const p of startersOf(picks)) {
    const raw = pointsOf(p.element);
    startersRaw += raw;
    if (p.isCaptain) {
      // The armband's contribution is the *extra* over the one copy already
      // counted in startersRaw, so the two terms sum rather than overlap.
      const multiplier = Math.max(1, p.multiplier);
      captain = { element: p.element, raw, multiplier, added: raw * (multiplier - 1) };
    }
  }

  const benchRaw = benchOf(picks).reduce((sum, p) => sum + pointsOf(p.element), 0);

  return {
    startersRaw,
    captain,
    asPicked: startersRaw + (captain?.added ?? 0),
    benchRaw,
    missing,
  };
}
