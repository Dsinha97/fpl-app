// sync-bootstrap
//
// One call to /bootstrap-static/ populates every reference and config table:
// teams, positions, gameweeks, players, chip rules, scoring rules, and game
// settings. Runs every 30 minutes.
//
// After the reference tables are refreshed it calls record_player_snapshots,
// which appends to the price / status / news / ownership history tables only
// where a value actually changed.

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { getBootstrap } from "../_shared/fpl.ts";
import { deriveSeason } from "../_shared/season.ts";
import { jsonResponse, preflight, serviceClient, SyncRun } from "../_shared/sync.ts";
import { bool, chunk, date, int, num, str, ts } from "../_shared/coerce.ts";

const FUNCTION_NAME = "sync-bootstrap";

/** Upsert in chunks; returns rows written or throws with table context. */
async function upsert(
  db: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
  chunkSize = 200,
): Promise<number> {
  for (const batch of chunk(rows, chunkSize)) {
    const { error } = await db.from(table).upsert(batch, { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
  return rows.length;
}

Deno.serve(async (req) => {
  const cors = preflight(req);
  if (cors) return cors;

  const db = serviceClient();
  const run = await SyncRun.start(db, FUNCTION_NAME);
  const counts: Record<string, number> = {};

  try {
    const boot = await getBootstrap();
    const season = deriveSeason(boot.events);

    // ------------------------------------------------ teams and positions
    // Both must land before players, which carries FKs onto them.

    counts.teams = await upsert(
      db,
      "teams",
      boot.teams.map((t) => ({
        season,
        id: t.id,
        code: t.code,
        name: t.name,
        short_name: t.short_name,
        strength: int(t.strength),
        strength_overall_home: int(t.strength_overall_home),
        strength_overall_away: int(t.strength_overall_away),
        strength_attack_home: int(t.strength_attack_home),
        strength_attack_away: int(t.strength_attack_away),
        strength_defence_home: int(t.strength_defence_home),
        strength_defence_away: int(t.strength_defence_away),
        played: int(t.played),
        win: int(t.win),
        draw: int(t.draw),
        loss: int(t.loss),
        points: int(t.points),
        position: int(t.position),
        form: str(t.form),
        unavailable: bool(t.unavailable),
        pulse_id: int(t.pulse_id),
        raw: t,
      })),
      "season,id",
    );

    counts.element_types = await upsert(
      db,
      "element_types",
      boot.element_types.map((p) => ({
        season,
        id: p.id,
        singular_name: p.singular_name,
        singular_name_short: p.singular_name_short,
        plural_name: p.plural_name,
        plural_name_short: p.plural_name_short,
        squad_select: int(p.squad_select),
        squad_min_select: int(p.squad_min_select),
        squad_max_select: int(p.squad_max_select),
        squad_min_play: int(p.squad_min_play),
        squad_max_play: int(p.squad_max_play),
        element_count: int(p.element_count),
        raw: p,
      })),
      "season,id",
    );

    // ------------------------------------------------------------ gameweeks

    counts.gameweeks = await upsert(
      db,
      "gameweeks",
      boot.events.map((e) => ({
        season,
        id: e.id,
        name: e.name,
        deadline_time: ts(e.deadline_time),
        deadline_time_epoch: int(e.deadline_time_epoch),
        average_entry_score: int(e.average_entry_score),
        highest_score: int(e.highest_score),
        finished: Boolean(e.finished),
        data_checked: Boolean(e.data_checked),
        is_previous: Boolean(e.is_previous),
        is_current: Boolean(e.is_current),
        is_next: Boolean(e.is_next),
        released: bool(e.released),
        can_enter: bool(e.can_enter),
        can_manage: bool(e.can_manage),
        ranked_count: int(e.ranked_count),
        transfers_made: int(e.transfers_made),
        most_selected: int(e.most_selected),
        most_transferred_in: int(e.most_transferred_in),
        most_captained: int(e.most_captained),
        most_vice_captained: int(e.most_vice_captained),
        top_element: int(e.top_element),
        chip_plays: e.chip_plays ?? null,
        raw: e,
      })),
      "season,id",
    );

    // -------------------------------------------------------------- players

    counts.players = await upsert(
      db,
      "players",
      boot.elements.map((p) => ({
        season,
        id: p.id,
        code: p.code,

        first_name: str(p.first_name),
        second_name: str(p.second_name),
        web_name: str(p.web_name),
        known_name: str(p.known_name),
        team_id: p.team,
        team_code: int(p.team_code),
        element_type: p.element_type,
        squad_number: int(p.squad_number),
        photo: str(p.photo),
        opta_code: str(p.opta_code),
        birth_date: date(p.birth_date),
        region: int(p.region),

        now_cost: int(p.now_cost),
        cost_change_event: int(p.cost_change_event),
        cost_change_event_fall: int(p.cost_change_event_fall),
        cost_change_start: int(p.cost_change_start),
        cost_change_start_fall: int(p.cost_change_start_fall),
        price_change_percent: num(p.price_change_percent),

        status: str(p.status),
        news: str(p.news),
        news_added: ts(p.news_added),
        chance_of_playing_this_round: int(p.chance_of_playing_this_round),
        chance_of_playing_next_round: int(p.chance_of_playing_next_round),
        can_transact: bool(p.can_transact),
        can_select: bool(p.can_select),
        removed: bool(p.removed),

        selected_by_percent: num(p.selected_by_percent),
        transfers_in: int(p.transfers_in),
        transfers_out: int(p.transfers_out),
        transfers_in_event: int(p.transfers_in_event),
        transfers_out_event: int(p.transfers_out_event),

        total_points: int(p.total_points),
        event_points: int(p.event_points),
        points_per_game: num(p.points_per_game),
        form: num(p.form),
        value_form: num(p.value_form),
        value_season: num(p.value_season),
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

        penalties_order: int(p.penalties_order),
        penalties_text: str(p.penalties_text),
        corners_and_indirect_freekicks_order: int(p.corners_and_indirect_freekicks_order),
        corners_and_indirect_freekicks_text: str(p.corners_and_indirect_freekicks_text),
        direct_freekicks_order: int(p.direct_freekicks_order),
        direct_freekicks_text: str(p.direct_freekicks_text),

        ep_this: num(p.ep_this),
        ep_next: num(p.ep_next),

        raw: p,
      })),
      "season,id",
      100,
    );

    // ----------------------------------------------------- chip definitions
    // The API ships the season's real chip windows, so nothing is hardcoded.

    counts.chip_definitions = await upsert(
      db,
      "chip_definitions",
      boot.chips.map((c) => ({
        season,
        name: c.name,
        number: c.number,
        chip_type: str(c.chip_type),
        start_event: c.start_event,
        stop_event: int(c.stop_event),
        raw: c,
      })),
      "season,name,start_event",
    );

    // --------------------------------------------------------- scoring rules
    // 10 stats are position-keyed; the rest are scalars stored as 'ALL'.

    const scoringRows: Record<string, unknown>[] = [];
    for (const [stat, value] of Object.entries(boot.game_config?.scoring ?? {})) {
      if (value !== null && typeof value === "object") {
        for (const [position, v] of Object.entries(value)) {
          const n = num(v);
          if (n !== null) scoringRows.push({ season, stat, position, value: n });
        }
      } else {
        const n = num(value);
        if (n !== null) scoringRows.push({ season, stat, position: "ALL", value: n });
      }
    }
    counts.scoring_rules = await upsert(db, "scoring_rules", scoringRows, "season,stat,position");

    // --------------------------------------------------------- game settings

    counts.game_settings = await upsert(
      db,
      "game_settings",
      Object.entries(boot.game_settings ?? {}).map(([key, value]) => ({
        season,
        key,
        value: value ?? null,
      })),
      "season,key",
    );

    // ------------------------------------------------------- snapshots
    // Runs after players are current, so it compares fresh values against the
    // last recorded observation and writes only genuine changes.

    const { data: snapshots, error: snapshotError } = await db.rpc("record_player_snapshots", {
      p_season: season,
    });
    if (snapshotError) throw new Error(`record_player_snapshots: ${snapshotError.message}`);

    const snapshotCounts = (snapshots ?? {}) as Record<string, number>;
    Object.assign(counts, snapshotCounts);

    const rowsWritten = Object.values(counts).reduce((a, b) => a + b, 0);
    await run.finish("success", { season, rowsWritten, details: counts });

    return jsonResponse({ ok: true, season, rowsWritten, counts });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${FUNCTION_NAME} failed: ${message}`);
    await run.finish("error", { error: message, details: counts });

    return jsonResponse({ ok: false, error: message, counts }, 500);
  }
});
