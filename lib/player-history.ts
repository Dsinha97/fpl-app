// Past-gameweek results for a player detail panel's "recent form" strip —
// the mirror of PlayerData.upcoming (lib/team-state.ts's fixture ticker),
// but backward-looking. Reads player_gameweek_stats, already the single
// source lib/manager-picks.ts's loadEventPoints and /team's Gameweek result
// view read from — no new table.

import { supabase } from "./supabase/client";

/** Supabase caps every response at 1000 rows whatever .limit() asks for. */
const PAGE_ROWS = 1000;

export interface PastResult {
  event: number;
  /** Summed across the event's fixtures — a double gameweek is two rows for one event. */
  points: number;
  opponent_short_name: string;
  is_home: boolean;
}

/**
 * Every finalised gameweek's points for a set of players, keyed by player.
 * A double gameweek's two fixtures are summed into one entry per event
 * (matching squadPointsFor/loadEventPoints' own DGW-sum convention) rather
 * than kept as two opponent cells — the points total is what "recent form"
 * needs; which two clubs contributed is a `/team` Gameweek-result question,
 * not this ticker's.
 */
export async function loadPastResults(
  season: string,
  playerIds: number[],
  teamShortById: Map<number, string>,
): Promise<Map<number, PastResult[]>> {
  const byPlayer = new Map<number, Map<number, { points: number; opponentTeamId: number; isHome: boolean }>>();
  const ids = [...new Set(playerIds)];
  if (ids.length === 0) return new Map();

  for (let from = 0; ; from += PAGE_ROWS) {
    const { data, error } = await supabase
      .from("player_gameweek_stats")
      .select("player_id, event, total_points, opponent_team, was_home")
      .eq("season", season)
      .in("player_id", ids)
      .order("player_id")
      .order("event")
      .range(from, from + PAGE_ROWS - 1);
    if (error) throw new Error(error.message);

    for (const r of data ?? []) {
      const playerId = r.player_id as number;
      const event = r.event as number;
      let events = byPlayer.get(playerId);
      if (!events) byPlayer.set(playerId, (events = new Map()));
      const acc = events.get(event) ?? {
        points: 0,
        opponentTeamId: r.opponent_team as number,
        isHome: r.was_home as boolean,
      };
      acc.points += (r.total_points as number | null) ?? 0;
      events.set(event, acc);
    }

    if ((data?.length ?? 0) < PAGE_ROWS) break;
  }

  const result = new Map<number, PastResult[]>();
  for (const [playerId, events] of byPlayer) {
    const rows: PastResult[] = [...events.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([event, acc]) => ({
        event,
        points: acc.points,
        opponent_short_name: teamShortById.get(acc.opponentTeamId) ?? "—",
        is_home: acc.isHome,
      }));
    result.set(playerId, rows);
  }
  return result;
}
