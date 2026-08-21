// Sprint 13 — Live Matchday Hub.
//
// Assembles one gameweek's live/in-progress state from manager_picks +
// player_live_stats (falling back through player_gameweek_stats once FPL
// finalises a fixture) + fixtures + element_types, so /deadline's live card
// group is pure render. Reuses squadPointsFor/startersOf/benchOf from
// lib/manager-picks.ts rather than re-deriving the starter/bench/captain
// split — CLAUDE.md's "one quantity, one implementation".
//
// Two things here are this app's own projection, not FPL's applied truth,
// and both say so wherever they're read: auto-substitutions (FPL's real
// automatic_subs is not synced — see MANAGER_PICKS_NOTE) and the captain
// armband handover to the vice-captain when the captain definitely doesn't
// feature. Bonus points are provisional (bps-ranked) until FPL confirms them
// post-match.

import { supabase } from "./supabase/client";
import {
  benchOf,
  squadPointsFor,
  startersOf,
  type ManagerPick,
  type SquadPoints,
} from "./manager-picks";

export const LIVE_MODEL_NOTE =
  "Live figures are provisional while matches are in progress — bonus points (ranked by BPS) are " +
  "not final until FPL confirms them after the match. Auto-substitutions and the captain handover " +
  "shown here are this page's own projection, not FPL's applied result: automatic_subs isn't synced " +
  "(see manager_picks' own note), so a starter who finished on 0 minutes is projected to be replaced " +
  "by the first eligible bench player in position order, and the armband moves to the vice-captain " +
  "only once the captain's fixture is finished with 0 minutes recorded.";

/** Supabase caps every response at 1000 rows whatever .limit() asks for. */
const PAGE_ROWS = 1000;

export type PlayerMatchStatus = "not_started" | "playing" | "finished";

interface FixtureRow {
  teamH: number;
  teamA: number;
  started: boolean;
  finished: boolean;
}

/** One event's fixtures, team-keyed so a double gameweek's two rows both count. */
export async function loadFixtureRows(season: string, event: number): Promise<FixtureRow[]> {
  const { data, error } = await supabase
    .from("fixtures")
    .select("team_h, team_a, started, finished")
    .eq("season", season)
    .eq("event", event);
  if (error) throw new Error(error.message);
  return (data ?? []).map((f) => ({
    teamH: f.team_h as number,
    teamA: f.team_a as number,
    started: f.started as boolean,
    finished: f.finished as boolean,
  }));
}

/**
 * A team's match status for this event. A double gameweek only reads
 * "finished" once every one of its fixtures has finished, and "playing" as
 * soon as any one of them has kicked off — the cautious reading for whether
 * an auto-sub is safe to project.
 */
export function matchStatusForTeam(teamId: number, fixtures: FixtureRow[]): PlayerMatchStatus {
  const relevant = fixtures.filter((f) => f.teamH === teamId || f.teamA === teamId);
  if (relevant.length === 0) return "not_started";
  if (relevant.every((f) => f.finished)) return "finished";
  if (relevant.some((f) => f.started)) return "playing";
  return "not_started";
}

export interface LivePlayerDetail {
  points: number;
  minutes: number;
  bonus: number;
  bps: number;
  /** Only ever true from the live snapshot — sync-player-history doesn't carry it post-match. */
  inDreamteam: boolean;
}

/**
 * Per-player points/bonus/bps for one event, finalised rows preferred and
 * summed across fixtures (a DGW is two rows), falling back to the live
 * snapshot the same way loadEventPoints (lib/manager-picks.ts) does — but
 * carrying the extra columns (bonus, bps, dreamteam) the live hub needs that
 * loadEventPoints doesn't select, so this reads player_gameweek_stats /
 * player_live_stats itself rather than widening that shared helper's return
 * shape for one caller.
 */
export async function loadLiveDetail(
  season: string,
  event: number,
  playerIds: number[],
): Promise<{ byPlayer: Map<number, LivePlayerDetail>; provisional: boolean }> {
  const byPlayer = new Map<number, LivePlayerDetail>();
  const ids = [...new Set(playerIds)];
  if (ids.length === 0) return { byPlayer, provisional: false };

  for (let from = 0; ; from += PAGE_ROWS) {
    const { data, error } = await supabase
      .from("player_gameweek_stats")
      .select("player_id, total_points, minutes, bonus, bps")
      .eq("season", season)
      .eq("event", event)
      .in("player_id", ids)
      .order("player_id")
      .range(from, from + PAGE_ROWS - 1);
    if (error) throw new Error(error.message);

    for (const r of data ?? []) {
      const id = r.player_id as number;
      const acc = byPlayer.get(id) ?? { points: 0, minutes: 0, bonus: 0, bps: 0, inDreamteam: false };
      acc.points += (r.total_points as number | null) ?? 0;
      acc.minutes += (r.minutes as number | null) ?? 0;
      acc.bonus += (r.bonus as number | null) ?? 0;
      acc.bps += (r.bps as number | null) ?? 0;
      byPlayer.set(id, acc);
    }

    if ((data?.length ?? 0) < PAGE_ROWS) break;
  }

  if (byPlayer.size > 0) return { byPlayer, provisional: false };

  const { data: live, error: liveError } = await supabase
    .from("player_live_stats")
    .select("player_id, total_points, minutes, bonus, bps, in_dreamteam")
    .eq("season", season)
    .eq("event", event)
    .in("player_id", ids);
  if (liveError) throw new Error(liveError.message);

  for (const r of live ?? []) {
    byPlayer.set(r.player_id as number, {
      points: (r.total_points as number | null) ?? 0,
      minutes: (r.minutes as number | null) ?? 0,
      bonus: (r.bonus as number | null) ?? 0,
      bps: (r.bps as number | null) ?? 0,
      inDreamteam: (r.in_dreamteam as boolean | null) ?? false,
    });
  }

  return { byPlayer, provisional: byPlayer.size > 0 };
}

export interface FormationLimits {
  /** element_type -> min/max allowed in a starting XI, from element_types.squad_min_play/max_play. */
  minPlay: Map<number, number>;
  maxPlay: Map<number, number>;
}

/** Starting-XI formation limits from the database — never hardcoded (CLAUDE.md). */
export async function loadFormationLimits(season: string): Promise<FormationLimits> {
  const { data, error } = await supabase
    .from("element_types")
    .select("id, squad_min_play, squad_max_play")
    .eq("season", season);
  if (error) throw new Error(error.message);
  const minPlay = new Map<number, number>();
  const maxPlay = new Map<number, number>();
  for (const t of data ?? []) {
    minPlay.set(t.id as number, (t.squad_min_play as number | null) ?? 0);
    maxPlay.set(t.id as number, (t.squad_max_play as number | null) ?? 15);
  }
  return { minPlay, maxPlay };
}

export interface AutoSub {
  outElement: number;
  inElement: number;
  /** The starting position (1-11) the incoming player projects into. */
  position: number;
}

/**
 * Projects which bench players would come on for blanking starters, using
 * the same constraints FPL's real substitution engine enforces: a bench
 * player only comes on if they actually played, a goalkeeper is only
 * replaced by the bench goalkeeper, and the resulting XI must stay within
 * squad_min_play/squad_max_play per position. This is an approximation of
 * FPL's own ordering, not a reimplementation of it — good enough to project
 * the outcome, not to be treated as the applied result.
 */
export function projectAutoSubs(
  starters: ManagerPick[],
  bench: ManagerPick[],
  elementTypeOf: (element: number) => number | undefined,
  live: Map<number, LivePlayerDetail>,
  status: (element: number) => PlayerMatchStatus,
  limits: FormationLimits,
): AutoSub[] {
  const typeCounts = new Map<number, number>();
  for (const p of starters) {
    const t = elementTypeOf(p.element);
    if (t !== undefined) typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
  }

  const blanks = starters
    .filter((p) => status(p.element) === "finished" && (live.get(p.element)?.minutes ?? 0) === 0)
    .sort((a, b) => a.position - b.position);

  const used = new Set<number>();
  const autoSubs: AutoSub[] = [];

  for (const blank of blanks) {
    const outType = elementTypeOf(blank.element);
    if (outType === undefined) continue;

    for (const candidate of bench) {
      if (used.has(candidate.element)) continue;
      const candidateLive = live.get(candidate.element);
      if (!candidateLive || candidateLive.minutes === 0) continue; // didn't play either

      const inType = elementTypeOf(candidate.element);
      if (inType === undefined) continue;
      if ((outType === 1) !== (inType === 1)) continue; // GK only <-> GK

      const trial = new Map(typeCounts);
      trial.set(outType, (trial.get(outType) ?? 0) - 1);
      trial.set(inType, (trial.get(inType) ?? 0) + 1);
      const legal = [1, 2, 3, 4].every((t) => {
        const count = trial.get(t) ?? 0;
        return count >= (limits.minPlay.get(t) ?? 0) && count <= (limits.maxPlay.get(t) ?? 15);
      });
      if (!legal) continue;

      typeCounts.set(outType, trial.get(outType)!);
      typeCounts.set(inType, trial.get(inType)!);
      used.add(candidate.element);
      autoSubs.push({ outElement: blank.element, inElement: candidate.element, position: blank.position });
      break;
    }
  }

  return autoSubs;
}

export interface CaptaincyResult {
  /** The element whose points actually carry the multiplier, after any handover. */
  effectiveElement: number;
  /** True when the vice-captain's armband is live because the captain definitely didn't play. */
  handedOver: boolean;
}

/**
 * The real FPL rule: if the captain's fixture finishes with 0 minutes
 * recorded (they didn't feature at all), the armband moves to the
 * vice-captain. Before the captain's fixture is finished, nothing is
 * decided yet — the armband stays put rather than projecting a handover
 * that a late substitute appearance would undo.
 */
export function resolveCaptaincy(
  starters: ManagerPick[],
  live: Map<number, LivePlayerDetail>,
  status: (element: number) => PlayerMatchStatus,
): CaptaincyResult {
  const captain = starters.find((p) => p.isCaptain);
  const vice = starters.find((p) => p.isViceCaptain);
  if (!captain) return { effectiveElement: -1, handedOver: false };

  const blanked =
    status(captain.element) === "finished" && (live.get(captain.element)?.minutes ?? 0) === 0;
  if (blanked && vice) {
    return { effectiveElement: vice.element, handedOver: true };
  }
  return { effectiveElement: captain.element, handedOver: false };
}

export interface GameweekState {
  event: number;
  provisional: boolean;
  squadPoints: SquadPoints;
  captaincy: CaptaincyResult;
  /** squadPoints.asPicked, corrected for the captaincy handover and projected auto-subs. */
  liveTotal: number;
  autoSubs: AutoSub[];
  statusByElement: Map<number, PlayerMatchStatus>;
  /** Squad's players with a live/finalised row, sorted by BPS descending. */
  bpsRace: Array<{ element: number; bps: number; bonus: number }>;
}

/** Everything /deadline's live card group renders, assembled from the pieces above. */
export async function loadGameweekState(
  season: string,
  event: number,
  picks: ManagerPick[],
  elementTypeOf: (element: number) => number | undefined,
  teamIdOf: (element: number) => number | undefined,
): Promise<GameweekState> {
  const starters = startersOf(picks);
  const bench = benchOf(picks);
  const allIds = picks.map((p) => p.element);

  const [fixtures, { byPlayer: detail, provisional }, limits] = await Promise.all([
    loadFixtureRows(season, event),
    loadLiveDetail(season, event, allIds),
    loadFormationLimits(season),
  ]);

  const status = (element: number): PlayerMatchStatus => {
    const teamId = teamIdOf(element);
    if (teamId === undefined) return "not_started";
    return matchStatusForTeam(teamId, fixtures);
  };

  // squadPointsFor wants points-only rows — reuse it for the defensible term
  // split rather than re-deriving asPicked/benchRaw here.
  const pointsOnly = new Map(
    [...detail].map(([id, d]) => [id, { points: d.points, minutes: d.minutes, fixtures: 1 }]),
  );
  const squadPoints = squadPointsFor(picks, pointsOnly);

  const captaincy = resolveCaptaincy(starters, detail, status);
  const autoSubs = projectAutoSubs(starters, bench, elementTypeOf, detail, status, limits);

  // Re-total: swap the captain's added-multiplier term onto the effective
  // captain, then add in whatever the projected substitutes contributed
  // (the blanks they replace already contributed 0, so nothing to subtract).
  let liveTotal = squadPoints.startersRaw;
  if (captaincy.effectiveElement !== -1) {
    const raw = detail.get(captaincy.effectiveElement)?.points ?? 0;
    liveTotal += raw; // the extra multiplier-1 copy
  }
  for (const sub of autoSubs) {
    liveTotal += detail.get(sub.inElement)?.points ?? 0;
  }

  const statusByElement = new Map(allIds.map((id) => [id, status(id)]));

  const bpsRace = [...detail.entries()]
    .filter(([id]) => allIds.includes(id))
    .map(([element, d]) => ({ element, bps: d.bps, bonus: d.bonus }))
    .sort((a, b) => b.bps - a.bps);

  return {
    event,
    provisional,
    squadPoints,
    captaincy,
    liveTotal,
    autoSubs,
    statusByElement,
    bpsRace,
  };
}
