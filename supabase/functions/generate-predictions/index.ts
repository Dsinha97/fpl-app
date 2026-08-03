// generate-predictions
//
// Recomputes expected points for every player across the next HORIZON
// gameweeks and replaces the stored predictions for this model version.
//
// Runs after sync-bootstrap has refreshed prices and availability, since a
// player being flagged doubtful is the single largest input change day to day.

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { currentSeason, jsonResponse, preflight, serviceClient, SyncRun } from "../_shared/sync.ts";
import { chunk } from "../_shared/coerce.ts";
import {
  deriveRates,
  MODEL_PARAMS,
  MODEL_VERSION,
  predict,
  type ScoringRules,
  type SeasonRow,
} from "../_shared/xp-model.ts";

const FUNCTION_NAME = "generate-predictions";
const HORIZON = 8;

/** Scoring values read from the database, so FPL rule changes flow through. */
async function loadScoring(db: SupabaseClient, season: string): Promise<ScoringRules> {
  const { data, error } = await db
    .from("scoring_rules")
    .select("stat, position, value")
    .eq("season", season);
  if (error) throw new Error(`scoring_rules: ${error.message}`);

  const table = new Map<string, number>();
  for (const r of data ?? []) table.set(`${r.stat}:${r.position}`, Number(r.value));

  return {
    get(stat: string, position: string) {
      return table.get(`${stat}:${position}`) ?? table.get(`${stat}:ALL`) ?? 0;
    },
  };
}

Deno.serve(async (req) => {
  const cors = preflight(req);
  if (cors) return cors;

  const db = serviceClient();
  const run = await SyncRun.start(db, FUNCTION_NAME);

  try {
    const season = await currentSeason(db);

    // Register (or refresh) this model version before referencing it.
    const { error: modelError } = await db.from("prediction_models").upsert({
      version: MODEL_VERSION,
      description:
        "Baseline pre-season model: prior-season per-90 rates, recency weighted, " +
        "with official-FDR fixture multipliers and Poisson threshold models for " +
        "defensive contribution, saves, and goals conceded.",
      params: MODEL_PARAMS,
    }, { onConflict: "version" });
    if (modelError) throw new Error(`prediction_models: ${modelError.message}`);

    const scoring = await loadScoring(db, season);

    // Prediction window starts at the next unfinished gameweek.
    const { data: nextGw, error: gwError } = await db
      .from("gameweeks")
      .select("id")
      .eq("season", season)
      .eq("finished", false)
      .order("id")
      .limit(1)
      .maybeSingle();
    if (gwError) throw new Error(`gameweeks: ${gwError.message}`);
    if (!nextGw) throw new Error("no unfinished gameweeks - season complete?");

    const firstEvent = nextGw.id as number;
    const lastEvent = firstEvent + HORIZON - 1;

    const [playersRes, typesRes, fixturesRes] = await Promise.all([
      db.from("players")
        .select("id, code, team_id, element_type, status, chance_of_playing_next_round")
        .eq("season", season)
        .limit(1000),
      db.from("element_types").select("id, singular_name_short").eq("season", season),
      db.from("fixtures")
        .select("id, event, team_h, team_a, team_h_difficulty, team_a_difficulty")
        .eq("season", season)
        .gte("event", firstEvent)
        .lte("event", lastEvent),
    ]);
    if (playersRes.error) throw new Error(`players: ${playersRes.error.message}`);
    if (typesRes.error) throw new Error(`element_types: ${typesRes.error.message}`);
    if (fixturesRes.error) throw new Error(`fixtures: ${fixturesRes.error.message}`);

    const positionCode = new Map(
      (typesRes.data ?? []).map((t) => [t.id as number, t.singular_name_short as string]),
    );

    // History can exceed one page; pull it in slices keyed by player code.
    const players = (playersRes.data ?? []) as {
      id: number;
      code: number;
      team_id: number;
      element_type: number;
      status: string | null;
      chance_of_playing_next_round: number | null;
    }[];

    const historyByCode = new Map<number, SeasonRow[]>();
    for (const codes of chunk(players.map((p) => p.code), 200)) {
      const { data, error } = await db
        .from("player_season_history")
        .select(
          "player_code, season_name, minutes, starts, expected_goals, expected_assists, " +
            "expected_goals_conceded, clean_sheets, bonus, saves, defensive_contribution, yellow_cards",
        )
        .in("player_code", codes);
      if (error) throw new Error(`player_season_history: ${error.message}`);

      for (const row of data ?? []) {
        const code = row.player_code as number;
        if (!historyByCode.has(code)) historyByCode.set(code, []);
        historyByCode.get(code)!.push(row as unknown as SeasonRow);
      }
    }

    // Fixtures indexed by team, so each player inherits their club's schedule.
    const byTeam = new Map<number, { fixtureId: number; event: number; opponent: number; isHome: boolean; fdr: number }[]>();
    for (const f of fixturesRes.data ?? []) {
      const add = (
        teamId: number,
        opponent: number,
        isHome: boolean,
        fdr: number | null,
      ) => {
        if (!byTeam.has(teamId)) byTeam.set(teamId, []);
        byTeam.get(teamId)!.push({
          fixtureId: f.id as number,
          event: f.event as number,
          opponent,
          isHome,
          fdr: fdr ?? 3,
        });
      };
      add(f.team_h as number, f.team_a as number, true, f.team_h_difficulty as number | null);
      add(f.team_a as number, f.team_h as number, false, f.team_a_difficulty as number | null);
    }

    // ------------------------------------------------------------ predict

    const rows: Record<string, unknown>[] = [];
    let skippedNoRates = 0;

    for (const p of players) {
      const rates = deriveRates(historyByCode.get(p.code) ?? []);
      if (!rates) {
        // No usable history — a promoted-club player or a new signing to the
        // league. Emitting nothing is better than emitting a fabricated xP.
        skippedNoRates++;
        continue;
      }

      const code = positionCode.get(p.element_type) ?? "MID";
      const playerInput = {
        positionId: p.element_type,
        positionCode: code,
        status: p.status,
        chanceNextRound: p.chance_of_playing_next_round,
      };

      for (const f of byTeam.get(p.team_id) ?? []) {
        const pred = predict(playerInput, rates, { fdr: f.fdr, isHome: f.isHome }, scoring);

        rows.push({
          season,
          model_version: MODEL_VERSION,
          player_id: p.id,
          player_code: p.code,
          fixture: f.fixtureId,
          event: f.event,
          opponent_team: f.opponent,
          was_home: f.isHome,
          fdr: f.fdr,

          expected_minutes: round(pred.expectedMinutes, 1),
          start_probability: round(pred.startProbability, 3),
          p60: round(pred.p60, 3),
          availability: round(pred.availability, 2),
          attack_multiplier: round(pred.attackMultiplier, 3),
          defence_multiplier: round(pred.defenceMultiplier, 3),

          xp_appearance: round(pred.components.appearance, 3),
          xp_goals: round(pred.components.goals, 3),
          xp_assists: round(pred.components.assists, 3),
          xp_clean_sheet: round(pred.components.cleanSheet, 3),
          xp_goals_conceded: round(pred.components.goalsConceded, 3),
          xp_saves: round(pred.components.saves, 3),
          xp_bonus: round(pred.components.bonus, 3),
          xp_defensive_contribution: round(pred.components.defensiveContribution, 3),
          xp_cards: round(pred.components.cards, 3),

          xp: round(pred.xp, 3),
          rates: {
            seasons: rates.seasonsUsed,
            mpg: round(rates.minutesPerGame, 1),
            start_share: round(rates.startShare, 3),
            xg90: round(rates.xg90, 3),
            xa90: round(rates.xa90, 3),
            dc90: round(rates.dc90, 2),
          },
        });
      }
    }

    // Replace this version's predictions wholesale — a stale row for a fixture
    // that has since been rescheduled would otherwise linger.
    const { error: deleteError } = await db
      .from("player_predictions")
      .delete()
      .eq("season", season)
      .eq("model_version", MODEL_VERSION);
    if (deleteError) throw new Error(`clear predictions: ${deleteError.message}`);

    for (const batch of chunk(rows, 500)) {
      const { error } = await db.from("player_predictions").insert(batch);
      if (error) throw new Error(`player_predictions: ${error.message}`);
    }

    await run.finish("success", {
      season,
      rowsWritten: rows.length,
      details: {
        model_version: MODEL_VERSION,
        events: `${firstEvent}-${lastEvent}`,
        players_predicted: players.length - skippedNoRates,
        skipped_no_history: skippedNoRates,
      },
    });

    return jsonResponse({
      ok: true,
      season,
      model_version: MODEL_VERSION,
      events: `${firstEvent}-${lastEvent}`,
      predictions: rows.length,
      players_predicted: players.length - skippedNoRates,
      skipped_no_history: skippedNoRates,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${FUNCTION_NAME} failed: ${message}`);
    await run.finish("error", { error: message });
    return jsonResponse({ ok: false, error: message }, 500);
  }
});

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
