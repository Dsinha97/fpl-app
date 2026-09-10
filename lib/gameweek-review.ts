// /review — a post-gameweek counterfactual: what a decision actually cost,
// in terms named separately (CLAUDE.md: "say what the number means"), never
// a bare net figure.
//
// Deliberately built on the same primitives the live hub uses
// (`lib/manager-picks.ts`, `lib/gameweek-state.ts`) rather than a parallel
// implementation — `loadGameweekState` is event-agnostic, so a finished
// gameweek runs through the identical captaincy/auto-sub/points-split logic
// as a live one, just with every fixture already `finished`.

import { supabase } from "./supabase/client";
import { loadManagerPicks } from "./manager-picks";
import { captainChoiceAt, type CaptainChoice } from "./decision-analytics";
import { loadGameweekState, type GameweekState } from "./gameweek-state";
import { loadTransfers, type TransferRow } from "./manager-transfers";

export const REVIEW_MODEL_NOTE =
  "Bench recovered/stranded and the captain gap are this app's own projection, not FPL's applied " +
  "result — automatic_subs isn't synced (see MANAGER_PICKS_NOTE), so a starter who finished on 0 " +
  "minutes is projected to be replaced by the same rule FPL's engine uses, not read from FPL's own " +
  "decision. 'Best available captain' is hindsight over players who actually started this gameweek " +
  "— not an achievable in-the-moment choice, and not a claim that picking them was knowable in " +
  "advance.";

export interface GwHistoryRow {
  event: number;
  points: number | null;
  totalPoints: number | null;
  rank: number | null;
  overallRank: number | null;
  /** FPL's own "top X%" for this gameweek — lower is better, same convention as
   *  manager_season_history.rank_percentage (CLAUDE.md). Not to be confused
   *  with lib/manager-profile.ts's flipped, higher-is-better percentileScore. */
  percentileRank: number | null;
  eventTransfers: number | null;
  eventTransfersCost: number | null;
  pointsOnBench: number | null;
  activeChip: string | null;
}

async function loadGwHistory(
  season: string,
  entryId: number,
  events: number[],
): Promise<Map<number, GwHistoryRow>> {
  const byEvent = new Map<number, GwHistoryRow>();
  if (events.length === 0) return byEvent;

  const { data, error } = await supabase
    .from("manager_gameweek_history")
    .select(
      "event, points, total_points, rank, overall_rank, percentile_rank, event_transfers, event_transfers_cost, points_on_bench, active_chip",
    )
    .eq("season", season)
    .eq("entry_id", entryId)
    .in("event", events);
  if (error) throw new Error(error.message);

  for (const r of data ?? []) {
    byEvent.set(r.event as number, {
      event: r.event as number,
      points: r.points as number | null,
      totalPoints: r.total_points as number | null,
      rank: r.rank as number | null,
      overallRank: r.overall_rank as number | null,
      percentileRank: r.percentile_rank as number | null,
      eventTransfers: r.event_transfers as number | null,
      eventTransfersCost: r.event_transfers_cost as number | null,
      pointsOnBench: r.points_on_bench as number | null,
      activeChip: r.active_chip as string | null,
    });
  }
  return byEvent;
}

// Real transfers FPL recorded for this event — see `TransfersSection`'s empty-state handling
// for a gameweek with none. Sprint 29.2: `loadTransfers`/`TransferRow` moved to
// lib/manager-transfers.ts, which also backs /team's season-wide transfer ledger — this file
// re-exports the type so existing imports of `TransferRow` from here don't break.
export type { TransferRow };

/** Which of a season's gameweeks are finished, most recent first — what a "which gameweek" picker offers. */
export async function loadFinishedEvents(season: string): Promise<number[]> {
  const { data, error } = await supabase
    .from("gameweeks")
    .select("id")
    .eq("season", season)
    .eq("finished", true)
    .order("id", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => r.id as number);
}

/**
 * One gameweek's captain comparison.
 *
 * Sprint 36: this used to be computed inline below, and the season-wide panel
 * needed the same quantity. Rather than a second scorer, the computation moved
 * to lib/decision-analytics.ts and this is an alias of its result — the two
 * surfaces cannot disagree because there is only one of them
 * (CLAUDE.md: "one quantity, one implementation").
 */
export type CaptainReview = CaptainChoice;

export interface BenchReview {
  /** Points bench players scored that were recovered by a projected auto-sub. */
  recovered: number;
  /** Points still stranded on the bench after those subs — lib/manager-picks.ts's benchRaw minus recovered. */
  stranded: number;
  /** FPL's own points_on_bench for this gameweek, shown alongside rather than reconciled away
   *  (CLAUDE.md: say what the number means) — it can legitimately disagree with `stranded` since
   *  this app's auto-sub projection is not FPL's applied result (see REVIEW_MODEL_NOTE). */
  fplPointsOnBench: number | null;
}

export interface GameweekReview {
  event: number;
  history: GwHistoryRow | null;
  previousHistory: GwHistoryRow | null;
  state: GameweekState;
  captain: CaptainReview | null;
  bench: BenchReview;
  transfers: TransferRow[];
}

/**
 * Assembles one gameweek's full review. `elementTypeOf`/`teamIdOf` are the
 * caller's own player lookups (already loaded for the page), matching the
 * shape `loadGameweekState` already expects.
 */
export async function loadGameweekReview(
  season: string,
  entryId: number,
  event: number,
  elementTypeOf: (element: number) => number | undefined,
  teamIdOf: (element: number) => number | undefined,
): Promise<GameweekReview | null> {
  const [picksByEvent, historyByEvent] = await Promise.all([
    loadManagerPicks(season, entryId),
    loadGwHistory(season, entryId, [event, event - 1]),
  ]);

  const picks = picksByEvent.get(event);
  if (!picks || picks.length === 0) return null;

  const [state, transfers] = await Promise.all([
    loadGameweekState(season, event, picks, elementTypeOf, teamIdOf),
    loadTransfers(season, entryId, event),
  ]);

  // Points and minutes for this event's squad, out of the state already
  // loaded — `captainChoiceAt` takes plain maps precisely so it can be fed
  // from either a live GameweekState or the season-wide actuals pass.
  const points = new Map<number, number>();
  const minutes = new Map<number, number>();
  for (const p of picks) {
    const detail = state.detailByElement.get(p.element);
    points.set(p.element, detail?.points ?? 0);
    minutes.set(p.element, detail?.minutes ?? 0);
  }
  // `state.captaincy` is the fixture-status-aware resolution, which matters
  // for a gameweek still in play — this panel is event-agnostic like the state
  // it reads.
  const captain = captainChoiceAt(event, picks, points, minutes, {
    element: state.captaincy.effectiveElement,
    handedOver: state.captaincy.handedOver,
  });

  const recovered = state.autoSubs.reduce(
    (sum, s) => sum + (state.detailByElement.get(s.inElement)?.points ?? 0),
    0,
  );
  const bench: BenchReview = {
    recovered,
    stranded: Math.max(0, state.squadPoints.benchRaw - recovered),
    fplPointsOnBench: historyByEvent.get(event)?.pointsOnBench ?? null,
  };

  return {
    event,
    history: historyByEvent.get(event) ?? null,
    previousHistory: historyByEvent.get(event - 1) ?? null,
    state,
    captain,
    bench,
    transfers,
  };
}
