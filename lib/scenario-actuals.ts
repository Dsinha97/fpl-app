// Sprint 28 — what a *scenario* would have scored.
//
// /scenarios has always compared drafts on xP alone. A projection with no
// counterweight is hard to calibrate against: the page can tell you squad A
// projects 1.4 points better than squad B over five gameweeks, and nothing
// on the screen ever says whether that gap has been borne out.
//
// This module answers the other half — the real points these players actually
// scored — for two windows:
//
//   lastEvent    the most recently finished gameweek, on its own
//   seasonToDate every finished gameweek so far, summed
//
// Both are COUNTERFACTUAL and must be labelled as such wherever they appear
// (see SCENARIO_ACTUALS_NOTE). A scenario is a hypothetical squad; applying
// today's XI and armband to a gameweek they were not picked for is not a
// record of anything that happened. Season-to-date is the more counterfactual
// of the two by a wide margin — it credits a squad for weeks it did not exist,
// with players who may have been bought since.
//
// Deliberately NOT modelled: auto-substitutions (a hypothetical squad has no
// pick history for FPL's rules to run against), chips, and any price or
// transfer history. Points come from the same `player_gameweek_stats` /
// `player_live_stats` pair `lib/manager-picks.ts` reads, reconciled the same
// way — per player, by higher minutes — so an in-flight gameweek is not
// silently scored as zero.

import { supabase } from "@/lib/supabase/client";
import type { TeamState } from "@/lib/team-state";

/** The API caps every response at 1000 rows whatever `.limit()` asks for. */
const PAGE_ROWS = 1000;

export const SCENARIO_ACTUALS_NOTE =
  "Counterfactual, not a track record. These are the real points this scenario's current starting XI " +
  "and captain scored — applied to gameweeks they were not actually picked for, in a squad that may " +
  "not have existed yet. Season to date is the strongest version of that caveat: it credits today's " +
  "eleven for every finished gameweek, including ones before a player was bought. Auto-substitutions " +
  "are not modelled (a hypothetical squad has no pick history for FPL's rules to run against), and " +
  "neither are chips, price moves or transfer costs — the bench never scores here, and a captain is " +
  "always doubled even if they did not play. A gameweek still in play is provisional until bonus is " +
  "confirmed.";

export interface ScenarioActuals {
  /** Points for the most recently finished gameweek, or null when no gameweek has finished yet. */
  lastEvent: number | null;
  /** Sum across every finished gameweek. Null when none have. */
  seasonToDate: number | null;
}

export interface ActualsSource {
  /** Finished gameweeks, ascending. Empty before the season's first is scored. */
  events: number[];
  /** The gameweek `lastEvent` refers to. */
  latestEvent: number | null;
  /** event -> playerId -> points. */
  pointsByEvent: Map<number, Map<number, number>>;
  /** event -> playerId -> minutes, from the same reconciled source as `pointsByEvent`.
   *  Scenarios don't use it; lib/decision-analytics.ts does, to resolve the
   *  vice-captain handover for a finished gameweek without a second pass over
   *  the same rows. Carried here rather than duplicated there. */
  minutesByEvent: Map<number, Map<number, number>>;
  /** True when any figure drew on the live snapshot rather than a finalised row. */
  provisional: boolean;
}

const EMPTY_SOURCE: ActualsSource = {
  events: [],
  latestEvent: null,
  pointsByEvent: new Map(),
  minutesByEvent: new Map(),
  provisional: false,
};

/**
 * Every finished gameweek's actual points for `playerIds`, in one paged pass.
 *
 * One query across all events rather than `loadEventPoints` per event: the
 * caller scores several drafts over the whole season so far, which would
 * otherwise be one round trip per gameweek. The per-fixture rows are summed
 * per player per event, so a double gameweek counts both.
 */
export async function loadScenarioActuals(
  season: string,
  playerIds: number[],
): Promise<ActualsSource> {
  const ids = [...new Set(playerIds)];
  if (ids.length === 0) return EMPTY_SOURCE;

  const { data: gwRows, error: gwError } = await supabase
    .from("gameweeks")
    .select("id")
    .eq("season", season)
    .eq("finished", true)
    .order("id", { ascending: true });
  if (gwError) throw new Error(gwError.message);
  const events = (gwRows ?? []).map((r) => r.id as number);
  if (events.length === 0) return EMPTY_SOURCE;

  const finalised = new Map<number, Map<number, { points: number; minutes: number }>>();
  for (let from = 0; ; from += PAGE_ROWS) {
    const { data, error } = await supabase
      .from("player_gameweek_stats")
      .select("event, player_id, total_points, minutes")
      .eq("season", season)
      .in("event", events)
      .in("player_id", ids)
      .order("event")
      .order("player_id")
      .range(from, from + PAGE_ROWS - 1);
    if (error) throw new Error(error.message);

    for (const r of data ?? []) {
      const ev = r.event as number;
      let byPlayer = finalised.get(ev);
      if (!byPlayer) finalised.set(ev, (byPlayer = new Map()));
      const id = r.player_id as number;
      const acc = byPlayer.get(id) ?? { points: 0, minutes: 0 };
      acc.points += (r.total_points as number | null) ?? 0;
      acc.minutes += (r.minutes as number | null) ?? 0;
      byPlayer.set(id, acc);
    }

    if ((data?.length ?? 0) < PAGE_ROWS) break;
  }

  // The live snapshot, for the same reason `loadEventPoints` always fetches
  // it: a finalised row can itself be a stale pre-kickoff placeholder, so the
  // higher-minutes source per player is the reliable one. Only the latest
  // finished event can plausibly still be moving, so only it is fetched.
  const latestEvent = events[events.length - 1];
  const live = new Map<number, { points: number; minutes: number }>();
  const { data: liveRows, error: liveError } = await supabase
    .from("player_live_stats")
    .select("player_id, total_points, minutes")
    .eq("season", season)
    .eq("event", latestEvent)
    .in("player_id", ids);
  if (liveError) throw new Error(liveError.message);
  for (const r of liveRows ?? []) {
    live.set(r.player_id as number, {
      points: (r.total_points as number | null) ?? 0,
      minutes: (r.minutes as number | null) ?? 0,
    });
  }

  let provisional = false;
  const pointsByEvent = new Map<number, Map<number, number>>();
  const minutesByEvent = new Map<number, Map<number, number>>();
  for (const ev of events) {
    const src = finalised.get(ev) ?? new Map<number, { points: number; minutes: number }>();
    const out = new Map<number, number>();
    const mins = new Map<number, number>();
    for (const id of ids) {
      const fin = src.get(id);
      const liv = ev === latestEvent ? live.get(id) : undefined;
      // One winner per player, chosen once — points and minutes must come from
      // the same row or a captain could be scored from one source and judged
      // to have blanked from the other.
      if (liv && (!fin || liv.minutes > fin.minutes)) {
        out.set(id, liv.points);
        mins.set(id, liv.minutes);
        provisional = true;
      } else if (fin) {
        out.set(id, fin.points);
        mins.set(id, fin.minutes);
      } else {
        out.set(id, 0);
        mins.set(id, 0);
      }
    }
    pointsByEvent.set(ev, out);
    minutesByEvent.set(ev, mins);
  }

  return { events, latestEvent, pointsByEvent, minutesByEvent, provisional };
}

/**
 * One gameweek's points for a scenario: the starting XI raw, plus the
 * captain's points again. No auto-subs, no bench, no chips — see the module
 * note. A player with no row scores 0, which is the honest answer for someone
 * who did not feature, and indistinguishable from one who blanked.
 */
export function scenarioPointsAt(team: TeamState, byPlayer: Map<number, number>): number {
  // Fall back to the first eleven picks when the XI has not been set — the
  // same shape `optimiseLineup` would otherwise fill in, without needing a
  // projection to do it.
  const xi = team.startingXI.length > 0
    ? team.startingXI
    : team.players.slice(0, 11).map((p) => p.playerId);

  let total = 0;
  for (const id of xi) total += byPlayer.get(id) ?? 0;
  if (team.captain !== null && xi.includes(team.captain)) {
    total += byPlayer.get(team.captain) ?? 0;
  }
  return total;
}

/** Both windows for one scenario. */
export function scenarioActuals(team: TeamState, source: ActualsSource): ScenarioActuals {
  if (source.events.length === 0) return { lastEvent: null, seasonToDate: null };

  let seasonToDate = 0;
  for (const ev of source.events) {
    seasonToDate += scenarioPointsAt(team, source.pointsByEvent.get(ev) ?? new Map());
  }
  const latest = source.latestEvent === null
    ? null
    : scenarioPointsAt(team, source.pointsByEvent.get(source.latestEvent) ?? new Map());

  return { lastEvent: latest, seasonToDate };
}
