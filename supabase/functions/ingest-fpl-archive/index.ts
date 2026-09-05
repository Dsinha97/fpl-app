// ingest-fpl-archive
//
// Backfills player_gameweek_stats from the Vaastav Fantasy-Premier-League
// archive (github.com/vaastav/Fantasy-Premier-League) for a past season the
// FPL API itself no longer serves per-gameweek data for. This is what makes
// an out-of-sample walk-forward backtest of the xP model possible at all —
// see docs/sprints/sprint-17a.md.
//
// Runs entirely server-side: fetches the archive CSVs and writes with the
// service-role client, the same as every other sync-* function. An earlier
// attempt at this ingestion tried to relay the CSV data through chat as
// batched SQL text — infeasible, a single 500-row batch tokenizes to
// hundreds of thousands of tokens because of how dense numeric/JSON text
// tokenizes. Fetching and writing here avoids that path entirely; only a
// small JSON summary crosses back.
//
// Mirrors sync-player-history's cursored, time-budgeted shape: a season
// cannot reliably backfill (38 gameweeks x ~500 archive rows) inside one
// invocation, so each run resumes from where the last one left off.
//
// Rows are filtered to player_codes present in player_season_history — the
// xP model's only training source, and a much smaller set than an archived
// season's full headcount (which includes academy/departed players this DB
// has no season_history for). A player the model cannot train rates for is
// a player it cannot be scored against, so this filter is exact, not a
// sample: it removes rows the walk-forward harness could never use.
//
// Usage: GET .../ingest-fpl-archive?season=2023-24[&maxGw=38][&force=1]
// season is the archive's hyphen form (e.g. "2023-24"), independent of
// gameweeks.season (currently "2026-27") and player_season_history's slash
// form ("2023/24") — this function only writes player_gameweek_stats.

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { jsonResponse, preflight, serviceClient, SyncRun } from "../_shared/sync.ts";
import { bool, chunk, int, num, ts } from "../_shared/coerce.ts";
import { verifyCron } from "../_shared/cron-auth.ts";

const FUNCTION_NAME = "ingest-fpl-archive";
const ARCHIVE = "https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data";
const TIME_BUDGET_MS = 55_000;

interface Cursor {
  season: string;
  next_gw: number;
  max_gw: number;
  total_rows: number;
  completed_at: string | null;
}

async function readCursor(db: SupabaseClient, season: string): Promise<Cursor | null> {
  const { data } = await db
    .from("sync_runs")
    .select("cursor")
    .eq("function_name", FUNCTION_NAME)
    .not("cursor", "is", null)
    .order("started_at", { ascending: false })
    .limit(20);

  for (const row of data ?? []) {
    const cursor = row.cursor as Cursor | undefined;
    if (cursor && cursor.season === season) return cursor;
  }
  return null;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const vals = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h] = vals[i] ?? ""));
    return row;
  });
}

async function fetchCsv(url: string): Promise<Record<string, string>[] | null> {
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return parseCsv(await res.text());
}

function gameweekRow(season: string, playerCode: number, r: Record<string, string>) {
  return {
    season,
    player_id: int(r.element),
    player_code: playerCode,
    fixture: int(r.fixture),
    event: int(r.round),
    opponent_team: int(r.opponent_team),
    was_home: bool(r.was_home === "True"),
    kickoff_time: ts(r.kickoff_time),
    team_h_score: int(r.team_h_score),
    team_a_score: int(r.team_a_score),

    minutes: int(r.minutes),
    starts: int(r.starts),
    total_points: int(r.total_points),
    goals_scored: int(r.goals_scored),
    assists: int(r.assists),
    clean_sheets: int(r.clean_sheets),
    goals_conceded: int(r.goals_conceded),
    own_goals: int(r.own_goals),
    penalties_saved: int(r.penalties_saved),
    penalties_missed: int(r.penalties_missed),
    yellow_cards: int(r.yellow_cards),
    red_cards: int(r.red_cards),
    saves: int(r.saves),
    bonus: int(r.bonus),
    bps: int(r.bps),

    influence: num(r.influence),
    creativity: num(r.creativity),
    threat: num(r.threat),
    ict_index: num(r.ict_index),

    expected_goals: num(r.expected_goals),
    expected_assists: num(r.expected_assists),
    expected_goal_involvements: num(r.expected_goal_involvements),
    expected_goals_conceded: num(r.expected_goals_conceded),
    // Not present before the 2025-26 DC rule; int()/num() on undefined -> null.
    defensive_contribution: int(r.defensive_contribution),
    clearances_blocks_interceptions: int(r.clearances_blocks_interceptions),
    recoveries: int(r.recoveries),
    tackles: int(r.tackles),

    value: int(r.value),
    selected: int(r.selected),
    transfers_balance: int(r.transfers_balance),
    transfers_in: int(r.transfers_in),
    transfers_out: int(r.transfers_out),

    // Everything with a typed column above is not duplicated here (unlike
    // sync-player-history, which keeps the full untyped API payload because
    // there is no typed equivalent) — this CSV is fully typed already, and
    // keeping the whole row twice is bloat with no new information across
    // ~10-30k rows a season. Provenance plus the two archive-only
    // descriptive fields not modelled elsewhere per row are kept.
    raw: { _source: "vaastav-archive", name: r.name, position: r.position, team: r.team },
  };
}

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
  const season = url.searchParams.get("season");
  const maxGw = Number(url.searchParams.get("maxGw") ?? "38");
  const force = url.searchParams.get("force") === "1";

  if (!season || !/^\d{4}-\d{2}$/.test(season)) {
    return jsonResponse({ ok: false, error: "season query param required, e.g. season=2023-24" }, 400);
  }
  if (!Number.isInteger(maxGw) || maxGw < 1 || maxGw > 38) {
    return jsonResponse({ ok: false, error: "maxGw must be an integer 1-38" }, 400);
  }

  const previous = await readCursor(db, season);
  const run = await SyncRun.start(db, FUNCTION_NAME, season);
  const startedAt = Date.now();

  try {
    const passComplete = previous?.completed_at != null && !force;
    if (passComplete) {
      await run.finish("skipped", {
        season,
        cursor: previous as unknown as Record<string, unknown>,
        details: { reason: "already complete for this season, pass force=1 to redo" },
      });
      return jsonResponse({ ok: true, season, skipped: true, cursor: previous });
    }

    // PostgREST caps every response at 1000 rows regardless of .limit() (see
    // CLAUDE.md) — player_season_history has 2000+ rows, so this must page
    // with .range() or it silently truncates to the first ~1000 rows'
    // distinct codes, undercounting which players the model can be trained
    // and scored for. Hit this exact bug on the first deploy: 4,899 rows
    // written instead of the ~16-17k a full season should produce.
    const allowedCodes = new Set<number>();
    for (let from = 0; ; from += 1000) {
      const { data: codeRows, error: codeError } = await db
        .from("player_season_history")
        .select("player_code")
        .range(from, from + 999);
      if (codeError) throw new Error(`player_season_history: ${codeError.message}`);
      for (const r of codeRows ?? []) allowedCodes.add(r.player_code as number);
      if (!codeRows || codeRows.length < 1000) break;
    }
    if (allowedCodes.size === 0) throw new Error("player_season_history is empty - nothing to filter against");

    const playersRaw = await fetchCsv(`${ARCHIVE}/${season}/players_raw.csv`);
    if (!playersRaw) throw new Error(`players_raw.csv not found for season ${season}`);
    const idToCode = new Map<number, number>();
    for (const p of playersRaw) idToCode.set(Number(p.id), Number(p.code));

    let gw = (!force && previous && previous.season === season) ? previous.next_gw : 1;
    let totalRows = force ? 0 : (previous?.season === season ? previous.total_rows : 0);
    let gwsProcessed = 0;
    let reachedEnd = false;

    while (gw <= maxGw && Date.now() - startedAt < TIME_BUDGET_MS) {
      const gwRows = await fetchCsv(`${ARCHIVE}/${season}/gws/gw${gw}.csv`);
      if (!gwRows) { reachedEnd = true; break; }

      // Keyed by (player_id, fixture) — the archive occasionally repeats a
      // row within one gw{N}.csv (postponed/rearranged fixtures re-listed),
      // which a plain array turns into "ON CONFLICT DO UPDATE command cannot
      // affect row a second time" since Postgres won't apply two upserts to
      // the same row inside one statement. Last occurrence wins.
      const rowsByKey = new Map<string, ReturnType<typeof gameweekRow>>();
      for (const r of gwRows) {
        const playerId = Number(r.element);
        const playerCode = idToCode.get(playerId);
        if (!playerCode || !allowedCodes.has(playerCode)) continue;
        const row = gameweekRow(season, playerCode, r);
        if (row.player_id === null || row.fixture === null) continue;
        rowsByKey.set(`${row.player_id}|${row.fixture}`, row);
      }
      const rows = [...rowsByKey.values()];

      for (const batch of chunk(rows, 200)) {
        const { error } = await db
          .from("player_gameweek_stats")
          .upsert(batch, { onConflict: "season,player_id,fixture" });
        if (error) throw new Error(`player_gameweek_stats gw${gw}: ${error.message}`);
      }

      totalRows += rows.length;
      gwsProcessed++;
      gw++;
    }

    const complete = gw > maxGw || reachedEnd;
    const cursor: Cursor = {
      season,
      next_gw: complete ? maxGw + 1 : gw,
      max_gw: maxGw,
      total_rows: totalRows,
      completed_at: complete ? new Date().toISOString() : null,
    };

    await run.finish(complete ? "success" : "partial", {
      season,
      rowsWritten: totalRows,
      cursor: cursor as unknown as Record<string, unknown>,
      details: { gws_processed_this_run: gwsProcessed, reached_gw: gw - 1, reached_end_of_archive: reachedEnd },
    });

    return jsonResponse({
      ok: true,
      season,
      complete,
      gws_processed_this_run: gwsProcessed,
      reached_gw: gw - 1,
      total_rows: totalRows,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${FUNCTION_NAME} failed: ${message}`);
    await run.finish("error", { error: message });
    return jsonResponse({ ok: false, error: message }, 500);
  }
});
