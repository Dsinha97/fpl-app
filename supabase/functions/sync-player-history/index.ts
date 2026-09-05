// sync-player-history
//
// Per-fixture performance history and prior-season totals, one
// /element-summary/{id}/ call per player. With 564 players that cannot
// reliably finish inside a single Edge Function invocation, so the pass is
// cursored: each run works through as many players as its time budget allows,
// persists its position, and the next run resumes from there.
//
// The function is self-gating. Once a full pass completes it does nothing
// until the pass is more than PASS_INTERVAL_HOURS old, which means it can be
// scheduled on a short cron without repeatedly re-fetching 564 players.

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { getElementSummary, mapLimit } from "../_shared/fpl.ts";
import { currentSeason, jsonResponse, preflight, serviceClient, SyncRun } from "../_shared/sync.ts";
import { bool, chunk, int, num, ts } from "../_shared/coerce.ts";
import { verifyCron } from "../_shared/cron-auth.ts";

const FUNCTION_NAME = "sync-player-history";
const CONCURRENCY = 5;
const TIME_BUDGET_MS = 55_000;
const WRITE_EVERY = 25;
const PASS_INTERVAL_HOURS = 20;

interface Cursor {
  season: string;
  next_index: number;
  total: number;
  completed_at: string | null;
}

/** The cursor left behind by the previous run, if any. */
async function readCursor(db: SupabaseClient): Promise<Cursor | null> {
  const { data } = await db
    .from("sync_runs")
    .select("cursor")
    .eq("function_name", FUNCTION_NAME)
    .not("cursor", "is", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data?.cursor as Cursor | undefined) ?? null;
}

function gameweekRow(season: string, playerCode: number, h: Record<string, unknown>) {
  return {
    season,
    player_id: int(h.element),
    player_code: playerCode,
    fixture: int(h.fixture),
    event: int(h.round),
    opponent_team: int(h.opponent_team),
    was_home: bool(h.was_home),
    kickoff_time: ts(h.kickoff_time),
    team_h_score: int(h.team_h_score),
    team_a_score: int(h.team_a_score),

    minutes: int(h.minutes),
    starts: int(h.starts),
    total_points: int(h.total_points),
    goals_scored: int(h.goals_scored),
    assists: int(h.assists),
    clean_sheets: int(h.clean_sheets),
    goals_conceded: int(h.goals_conceded),
    own_goals: int(h.own_goals),
    penalties_saved: int(h.penalties_saved),
    penalties_missed: int(h.penalties_missed),
    yellow_cards: int(h.yellow_cards),
    red_cards: int(h.red_cards),
    saves: int(h.saves),
    bonus: int(h.bonus),
    bps: int(h.bps),

    influence: num(h.influence),
    creativity: num(h.creativity),
    threat: num(h.threat),
    ict_index: num(h.ict_index),

    expected_goals: num(h.expected_goals),
    expected_assists: num(h.expected_assists),
    expected_goal_involvements: num(h.expected_goal_involvements),
    expected_goals_conceded: num(h.expected_goals_conceded),
    defensive_contribution: int(h.defensive_contribution),
    clearances_blocks_interceptions: int(h.clearances_blocks_interceptions),
    recoveries: int(h.recoveries),
    tackles: int(h.tackles),

    value: int(h.value),
    selected: int(h.selected),
    transfers_balance: int(h.transfers_balance),
    transfers_in: int(h.transfers_in),
    transfers_out: int(h.transfers_out),

    raw: h,
  };
}

function seasonRow(fallbackCode: number, p: Record<string, unknown>) {
  return {
    player_code: int(p.element_code) ?? fallbackCode,
    season_name: String(p.season_name),
    start_cost: int(p.start_cost),
    end_cost: int(p.end_cost),
    total_points: int(p.total_points),
    minutes: int(p.minutes),
    starts: int(p.starts),
    goals_scored: int(p.goals_scored),
    assists: int(p.assists),
    clean_sheets: int(p.clean_sheets),
    goals_conceded: int(p.goals_conceded),
    own_goals: int(p.own_goals),
    penalties_saved: int(p.penalties_saved),
    penalties_missed: int(p.penalties_missed),
    yellow_cards: int(p.yellow_cards),
    red_cards: int(p.red_cards),
    saves: int(p.saves),
    bonus: int(p.bonus),
    bps: int(p.bps),
    influence: num(p.influence),
    creativity: num(p.creativity),
    threat: num(p.threat),
    ict_index: num(p.ict_index),
    expected_goals: num(p.expected_goals),
    expected_assists: num(p.expected_assists),
    expected_goal_involvements: num(p.expected_goal_involvements),
    expected_goals_conceded: num(p.expected_goals_conceded),
    defensive_contribution: int(p.defensive_contribution),
    clearances_blocks_interceptions: int(p.clearances_blocks_interceptions),
    recoveries: int(p.recoveries),
    tackles: int(p.tackles),
    raw: p,
  };
}

Deno.serve(async (req) => {
  const cors = preflight(req);
  if (cors) return cors;

  // Sprint 32 — cron-only: nothing in a browser has any business calling
  // this. Checked before any work at all, which is also what closes the
  // `?force=1` escape hatch rather than merely guarding it.
  const denied = verifyCron(req);
  if (denied) return denied;

  const db = serviceClient();
  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";

  // Read before starting a run, otherwise we would find our own empty cursor.
  const previous = await readCursor(db);
  const run = await SyncRun.start(db, FUNCTION_NAME);
  const startedAt = Date.now();

  try {
    const season = await currentSeason(db);

    const { data: playerRows, error: playersError } = await db
      .from("players")
      .select("id, code")
      .eq("season", season)
      .order("id");
    if (playersError) throw new Error(`players: ${playersError.message}`);

    const players = (playerRows ?? []) as { id: number; code: number }[];
    if (players.length === 0) throw new Error("no players - run sync-bootstrap first");

    // A completed, still-fresh pass means there is nothing to do.
    const sameSeason = previous !== null && previous.season === season;
    const passIsFresh = sameSeason && previous.completed_at !== null &&
      Date.now() - new Date(previous.completed_at).getTime() <
        PASS_INTERVAL_HOURS * 3_600_000;

    if (!force && passIsFresh) {
      await run.finish("skipped", {
        season,
        cursor: previous as unknown as Record<string, unknown>,
        details: { reason: "pass already complete", completed_at: previous.completed_at },
      });
      return jsonResponse({ ok: true, season, skipped: true, completed_at: previous.completed_at });
    }

    // Resume mid-pass, or start a fresh one.
    const resumeFrom = sameSeason && !passIsFresh ? previous.next_index : 0;
    const resuming = resumeFrom > 0 && resumeFrom < players.length;
    let index = resuming ? resumeFrom : 0;

    let gameweekWritten = 0;
    let seasonWritten = 0;
    let processed = 0;
    let pendingGw: Record<string, unknown>[] = [];
    let pendingSeason: Record<string, unknown>[] = [];

    const flush = async () => {
      if (pendingGw.length > 0) {
        for (const batch of chunk(pendingGw, 200)) {
          const { error } = await db
            .from("player_gameweek_stats")
            .upsert(batch, { onConflict: "season,player_id,fixture" });
          if (error) throw new Error(`player_gameweek_stats: ${error.message}`);
        }
        gameweekWritten += pendingGw.length;
        pendingGw = [];
      }
      if (pendingSeason.length > 0) {
        for (const batch of chunk(pendingSeason, 200)) {
          const { error } = await db
            .from("player_season_history")
            .upsert(batch, { onConflict: "player_code,season_name" });
          if (error) throw new Error(`player_season_history: ${error.message}`);
        }
        seasonWritten += pendingSeason.length;
        pendingSeason = [];
      }
    };

    while (index < players.length && Date.now() - startedAt < TIME_BUDGET_MS) {
      const slice = players.slice(index, index + WRITE_EVERY);

      const summaries = await mapLimit(slice, CONCURRENCY, async (p) => ({
        player: p,
        summary: await getElementSummary(p.id),
      }));

      for (const { player, summary } of summaries) {
        for (const h of summary.history ?? []) {
          const row = gameweekRow(season, player.code, h);
          if (row.player_id !== null && row.fixture !== null) pendingGw.push(row);
        }
        for (const p of summary.history_past ?? []) {
          pendingSeason.push(seasonRow(player.code, p));
        }
      }

      await flush();
      index += slice.length;
      processed += slice.length;
    }

    const complete = index >= players.length;
    const cursor: Cursor = {
      season,
      next_index: complete ? 0 : index,
      total: players.length,
      completed_at: complete ? new Date().toISOString() : null,
    };

    await run.finish(complete ? "success" : "partial", {
      season,
      rowsWritten: gameweekWritten + seasonWritten,
      cursor: cursor as unknown as Record<string, unknown>,
      details: {
        processed,
        resumed_from: resuming ? resumeFrom : 0,
        reached: index,
        total: players.length,
        gameweek_stats: gameweekWritten,
        season_history: seasonWritten,
      },
    });

    return jsonResponse({
      ok: true,
      season,
      complete,
      processed,
      reached: index,
      total: players.length,
      gameweek_stats: gameweekWritten,
      season_history: seasonWritten,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${FUNCTION_NAME} failed: ${message}`);
    await run.finish("error", { error: message });
    return jsonResponse({ ok: false, error: message }, 500);
  }
});
