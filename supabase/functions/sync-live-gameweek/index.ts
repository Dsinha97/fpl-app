// sync-live-gameweek
//
// Provisional per-player stats while matches are in progress.
//
// Scheduled every 2 minutes, but self-gating: it exits immediately unless the
// current gameweek has a fixture that has started and not finished, so it
// costs one cheap database query on the ~95% of days with no live football.

import { getLive } from "../_shared/fpl.ts";
import {
  currentSeason,
  hasLiveFixture,
  jsonResponse,
  preflight,
  serviceClient,
  SyncRun,
} from "../_shared/sync.ts";
import { bool, chunk, int, num } from "../_shared/coerce.ts";
import { verifyCron } from "../_shared/cron-auth.ts";

const FUNCTION_NAME = "sync-live-gameweek";

Deno.serve(async (req) => {
  const cors = preflight(req);
  if (cors) return cors;

  const db = serviceClient();

  // Sprint 32 — cron-only: nothing in a browser has any business calling
  // this. Checked before any work at all, which is what closes the
  // `?force=1` escape hatch rather than merely guarding it — the URL below
  // is not even parsed until this passes.
  const denied = await verifyCron(req, db);
  if (denied) return denied;

  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";

  const run = await SyncRun.start(db, FUNCTION_NAME);

  try {
    const season = await currentSeason(db);

    const { data: gw, error: gwError } = await db
      .from("gameweeks")
      .select("id")
      .eq("season", season)
      .eq("is_current", true)
      .maybeSingle();
    if (gwError) throw new Error(`gameweeks: ${gwError.message}`);

    if (!gw) {
      await run.finish("skipped", { season, details: { reason: "no current gameweek" } });
      return jsonResponse({ ok: true, season, skipped: "no current gameweek" });
    }

    // Gate on live football unless explicitly forced.
    if (!force) {
      const live = await hasLiveFixture(db, season, gw.id);

      if (!live) {
        await run.finish("skipped", {
          season,
          details: { reason: "no live fixtures", event: gw.id },
        });
        return jsonResponse({ ok: true, season, event: gw.id, skipped: "no live fixtures" });
      }
    }

    const live = await getLive(gw.id);

    // player_code is not in the live payload; resolve it from players.
    const { data: playerRows, error: playersError } = await db
      .from("players")
      .select("id, code")
      .eq("season", season);
    if (playersError) throw new Error(`players: ${playersError.message}`);
    const codes = new Map((playerRows ?? []).map((p) => [p.id as number, p.code as number]));

    const observedAt = new Date().toISOString();
    const rows = (live.elements ?? []).map((e) => {
      const s = e.stats ?? {};
      return {
        season,
        event: gw.id,
        player_id: e.id,
        player_code: codes.get(e.id) ?? null,

        minutes: int(s.minutes),
        starts: int(s.starts),
        total_points: int(s.total_points),
        goals_scored: int(s.goals_scored),
        assists: int(s.assists),
        clean_sheets: int(s.clean_sheets),
        goals_conceded: int(s.goals_conceded),
        own_goals: int(s.own_goals),
        penalties_saved: int(s.penalties_saved),
        penalties_missed: int(s.penalties_missed),
        yellow_cards: int(s.yellow_cards),
        red_cards: int(s.red_cards),
        saves: int(s.saves),
        bonus: int(s.bonus),
        bps: int(s.bps),

        influence: num(s.influence),
        creativity: num(s.creativity),
        threat: num(s.threat),
        ict_index: num(s.ict_index),

        expected_goals: num(s.expected_goals),
        expected_assists: num(s.expected_assists),
        expected_goal_involvements: num(s.expected_goal_involvements),
        expected_goals_conceded: num(s.expected_goals_conceded),
        defensive_contribution: int(s.defensive_contribution),

        in_dreamteam: bool(s.in_dreamteam),
        // FPL's own per-stat points breakdown — verbatim, so the player
        // detail panel's live table is FPL's arithmetic, not a second
        // implementation of scoring_rules' thresholds.
        explain: e.explain ?? null,
        raw: s,
        observed_at: observedAt,
      };
    });

    for (const batch of chunk(rows, 200)) {
      const { error } = await db
        .from("player_live_stats")
        .upsert(batch, { onConflict: "season,event,player_id" });
      if (error) throw new Error(`player_live_stats: ${error.message}`);
    }

    await run.finish("success", {
      season,
      rowsWritten: rows.length,
      details: { event: gw.id, elements: rows.length },
    });

    return jsonResponse({ ok: true, season, event: gw.id, elements: rows.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${FUNCTION_NAME} failed: ${message}`);
    await run.finish("error", { error: message });
    return jsonResponse({ ok: false, error: message }, 500);
  }
});
