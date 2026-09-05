// generate-predictions
//
// Recomputes expected points for every player from the next gameweek through
// the season's last gameweek, and replaces the stored predictions for this
// model version. See the window-resolution block below.
//
// Runs after sync-bootstrap has refreshed prices and availability, since a
// player being flagged doubtful is the single largest input change day to day.

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { currentSeason, jsonResponse, preflight, serviceClient, SyncRun } from "../_shared/sync.ts";
import { chunk } from "../_shared/coerce.ts";
import { verifyCron } from "../_shared/cron-auth.ts";
import {
  applySquadScale,
  availabilityOf,
  deriveDcEligibleSeasons,
  deriveRatesWithPrior,
  fitRatePriors,
  GOALKEEPER_POSITION_ID,
  MODEL_PARAMS,
  MODEL_VERSION,
  predict,
  priceBandOf,
  ratesAtBound,
  reconcileClubSquadWeighted,
  type FitRow,
  type PriorMetric,
  type Rates,
  type RateEvidence,
  type ScoringRules,
  type SeasonRow,
  type SquadMember,
  type SquadReconciliation,
} from "../_shared/xp-model.ts";

const FUNCTION_NAME = "generate-predictions";

/**
 * Floor on the prediction window, in gameweeks. Never publish less than this
 * even if the `gameweeks` table's last row is missing or malformed — this is
 * today's window, not an invented minimum.
 */
const MIN_HORIZON = 8;

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

  // Sprint 32 — cron-only: nothing in a browser has any business calling
  // this. Checked before any work at all, which is also what closes the
  // `?force=1` escape hatch rather than merely guarding it.
  const denied = verifyCron(req);
  if (denied) return denied;

  const db = serviceClient();
  const run = await SyncRun.start(db, FUNCTION_NAME);

  try {
    const season = await currentSeason(db);

    // Register (or refresh) this model version before referencing it.
    const { error: modelError } = await db.from("prediction_models").upsert({
      version: MODEL_VERSION,
      description:
        "Prior-season per-90 rates, recency weighted, with official-FDR fixture " +
        "multipliers and Poisson threshold models for defensive contribution, saves, " +
        "and goals conceded. v1.1.0 adds an empirical-Bayes cold-start layer: rates " +
        "are shrunk toward a prior fitted from position and price by measured " +
        "variance components, so a thin record is used rather than discarded. v1.2.0 " +
        "adds squad reconciliation: each club's projected starters, goalkeeper and " +
        "minutes are rescaled per fixture to sum to eleven, one and 990 respectively, " +
        "so a promoted club's squad no longer collapses toward zero nor an established " +
        "squad inflates past eleven. v1.3.0 replaces that uniform water-fill with an " +
        "evidence-weighted one: each player's share of the correction is weighted by " +
        "how much of their rate is prior rather than their own Premier League record, " +
        "so an established starter moves far less than a fringe reserve on the same " +
        "price band — gated on a backtest against the phase-4 cohort before shipping " +
        "(Pearson r 0.774 to 0.830, recovering most of the gap to the 0.851 figure with " +
        "no reconciliation at all; see docs/roadmap.md). v1.5.0 adds a one-shot external " +
        "prior for 33 zero-PL-minute players at the three promoted clubs, from real " +
        "2025/26 Championship stats translated by a fitted per-metric lambda — replacing " +
        "the position/price prior mean for xg90/xa90/yellow90 only, never touching " +
        "n_eff or the shrinkage weight itself. The prediction window runs from " +
        "the next gameweek through the season's last gameweek (floored at 8).",
      params: MODEL_PARAMS,
    }, { onConflict: "version" });
    if (modelError) throw new Error(`prediction_models: ${modelError.message}`);

    const scoring = await loadScoring(db, season);

    // Prediction window starts at the next unfinished gameweek and now runs to
    // the season's last gameweek. Sprint 12 (Chip Strategy) needed "Season" to
    // mean at least the chip window covering the next gameweek, which is why
    // this used to stop at whatever chip_definitions window contained
    // firstEvent (19 gameweeks, today). With Sprint 12 shipped and the 19 GW
    // horizon added alongside it (see the horizon_xp_19 migration), the
    // half-season figure is still reachable on its own horizon — so there is
    // no remaining reason for "Season" to stop short of the actual season.
    const [nextGwRes, lastGwRes] = await Promise.all([
      db.from("gameweeks")
        .select("id, deadline_time")
        .eq("season", season)
        .eq("finished", false)
        .order("id")
        .limit(1)
        .maybeSingle(),
      db.from("gameweeks")
        .select("id")
        .eq("season", season)
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (nextGwRes.error) throw new Error(`gameweeks: ${nextGwRes.error.message}`);
    if (!nextGwRes.data) throw new Error("no unfinished gameweeks - season complete?");
    if (lastGwRes.error) throw new Error(`gameweeks: ${lastGwRes.error.message}`);

    const firstEvent = nextGwRes.data.id as number;
    // Used only to gate the pre-deadline archive below — see that block.
    const firstEventDeadline = nextGwRes.data.deadline_time as string;
    // Floored at MIN_HORIZON so a malformed or missing `gameweeks` row can
    // never publish less than today's window; otherwise the season's real
    // last gameweek, whatever that currently is (38 today).
    const finalGameweek = (lastGwRes.data?.id as number | undefined) ?? firstEvent + MIN_HORIZON - 1;
    const lastEvent = Math.max(finalGameweek, firstEvent + MIN_HORIZON - 1);

    const [playersRes, typesRes, fixturesRes, squadplayRes, externalRes] = await Promise.all([
      db.from("players")
        .select("id, code, team_id, element_type, status, chance_of_playing_next_round, now_cost")
        .eq("season", season)
        .limit(1000),
      db.from("element_types")
        .select("id, singular_name_short, squad_min_play")
        .eq("season", season),
      db.from("fixtures")
        .select("id, event, team_h, team_a, team_h_difficulty, team_a_difficulty")
        .eq("season", season)
        .gte("event", firstEvent)
        .lte("event", lastEvent),
      // How many start per club, per fixture — never hardcoded. See
      // reconcileClubSquad below.
      db.from("game_settings")
        .select("value")
        .eq("season", season)
        .eq("key", "squad_squadplay")
        .maybeSingle(),
      // v1.5.0 — the one-shot Championship prior drop (see xp-model.ts's
      // header note and docs/sprints/championship-priors.md). Filtered to
      // matched, non-null player_code rows here rather than in xp-model.ts,
      // so the model layer never has to know this table exists.
      db.from("external_player_seasons")
        .select("player_code, xg90, xa90, cards90")
        .eq("season", "2025/26")
        .eq("league", "EFL Championship")
        .neq("matched_by", "unmatched")
        .not("player_code", "is", null),
    ]);
    if (playersRes.error) throw new Error(`players: ${playersRes.error.message}`);
    if (typesRes.error) throw new Error(`element_types: ${typesRes.error.message}`);
    if (fixturesRes.error) throw new Error(`fixtures: ${fixturesRes.error.message}`);
    if (squadplayRes.error) throw new Error(`game_settings: ${squadplayRes.error.message}`);
    if (!squadplayRes.data) throw new Error("game_settings: squad_squadplay missing");
    if (externalRes.error) throw new Error(`external_player_seasons: ${externalRes.error.message}`);

    // player_code -> raw (untranslated) Championship per-90 rates, restricted
    // to the metrics xp-model.ts has a fitted lambda for (yellow90 is the
    // model's name for the PDF's "cards90"). A player carrying real Premier
    // League minutes ignores this map entirely inside deriveRatesWithPrior —
    // it is only ever consulted on the zero-evidence branch — so passing it
    // for every player, cold-start or not, is harmless and keeps this block
    // from needing to know which 33 players actually qualify.
    const externalRatesByCode = new Map<number, Partial<Record<PriorMetric, number>>>();
    for (const row of externalRes.data ?? []) {
      const code = row.player_code as number;
      const rates: Partial<Record<PriorMetric, number>> = {};
      if (row.xg90 !== null) rates.xg90 = Number(row.xg90);
      if (row.xa90 !== null) rates.xa90 = Number(row.xa90);
      if (row.cards90 !== null) rates.yellow90 = Number(row.cards90);
      externalRatesByCode.set(code, rates);
    }

    const positionCode = new Map(
      (typesRes.data ?? []).map((t) => [t.id as number, t.singular_name_short as string]),
    );
    const goalkeeperRow = (typesRes.data ?? []).find((t) => t.id === GOALKEEPER_POSITION_ID);
    if (!goalkeeperRow) throw new Error(`element_types: no row for goalkeeper id ${GOALKEEPER_POSITION_ID}`);
    const squadBudgets = {
      xi: Number(squadplayRes.data.value),
      goalkeepers: Number(goalkeeperRow.squad_min_play),
    };

    // History can exceed one page; pull it in slices keyed by player code.
    const players = (playersRes.data ?? []) as {
      id: number;
      code: number;
      team_id: number;
      element_type: number;
      status: string | null;
      chance_of_playing_next_round: number | null;
      now_cost: number | null;
    }[];

    const positionByCode = new Map(players.map((p) => [p.code, p.element_type]));

    const historyByCode = new Map<number, SeasonRow[]>();
    const fitRows: FitRow[] = [];
    for (const codes of chunk(players.map((p) => p.code), 200)) {
      const { data, error } = await db
        .from("player_season_history")
        .select(
          "player_code, season_name, minutes, starts, expected_goals, expected_assists, " +
            "expected_goals_conceded, clean_sheets, bonus, saves, defensive_contribution, " +
            "yellow_cards, start_cost",
        )
        .in("player_code", codes);
      if (error) throw new Error(`player_season_history: ${error.message}`);

      for (const row of data ?? []) {
        const code = row.player_code as number;
        if (!historyByCode.has(code)) historyByCode.set(code, []);
        historyByCode.get(code)!.push(row as unknown as SeasonRow);

        const positionId = positionByCode.get(code);
        if (positionId === undefined) continue;
        fitRows.push({
          ...(row as unknown as SeasonRow),
          player_code: code,
          positionId,
          // That season's own starting price, not today's — bucketing an old
          // season by a price set years later would be hindsight.
          priceBand: priceBandOf((row.start_cost as number | null) ?? 0),
        });
      }
    }

    // Which seasons actually carry defensive-contribution data — FPL only
    // introduced the stat for 2024/25, so earlier `player_season_history`
    // rows read a real 0 rather than a tracked one. Derived once, globally,
    // over every row just pulled, then threaded into both the prior fit and
    // each player's own-rate blend below so dc90 is never divided by minutes
    // that could not have produced a DC point. See `deriveDcEligibleSeasons`.
    const dcEligibleSeasons = deriveDcEligibleSeasons(fitRows);

    // ------------------------------------------------------ fit the priors
    //
    // Fitted in-run and persisted, rather than by a separate scheduled
    // function: one writer means the priors can never be stale relative to the
    // predictions built from them, and storing them keeps a number auditable
    // after the fact. It is ~1,400 rows of aggregation, negligible next to the
    // per-player work below.
    const priors = fitRatePriors(fitRows, dcEligibleSeasons);

    const { error: priorError } = await db.from("rate_priors").upsert(
      priors.cells.map((c) => ({
        season,
        model_version: MODEL_VERSION,
        position_id: c.positionId,
        price_band: c.priceBand,
        metric: c.metric,
        mu: round(c.mu, 6),
        sigma2: round(c.sigma2, 8),
        tau2: round(c.tau2, 8),
        sample_size: c.sampleSize,
        shrunk_toward_position: c.shrunkTowardPosition,
      })),
      { onConflict: "season,model_version,position_id,price_band,metric" },
    );
    if (priorError) throw new Error(`rate_priors: ${priorError.message}`);

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
    //
    // Three passes rather than one. Rates are still derived per player with
    // no view of the rest of the squad (pass 1); but a club's players do not
    // independently sum to eleven starters, one keeper, and 990 minutes, so a
    // second pass reconciles each club's roster onto those facts before the
    // per-fixture `predict()` calls run (pass 3). See reconcileClubSquad in
    // xp-model.ts for why this needed its own pass rather than folding into
    // deriveRatesWithPrior — the shrinkage is genuinely per-player, and the
    // squad budget is genuinely not.

    interface Derived {
      player: typeof players[number];
      rates: Rates;
      evidence: RateEvidence;
      availability: number;
      playerInput: { positionId: number; positionCode: string; status: string | null; chanceNextRound: number | null };
    }

    const derived: Derived[] = [];
    let skippedNoRates = 0;
    const bySource = new Map<string, number>();

    // ---- pass 1: derive --------------------------------------------------
    for (const p of players) {
      // Shrunk toward the fitted prior rather than gated on a minutes floor. The
      // old floor threw away every player under 270 weighted minutes — half of
      // whom had real Premier League evidence — and the honest treatment is to
      // use what they have and say how thin it is.
      const shrunk = deriveRatesWithPrior({
        rows: historyByCode.get(p.code) ?? [],
        positionId: p.element_type,
        priceBand: priceBandOf(p.now_cost ?? 0),
        priors,
        dcEligibleSeasons,
        externalRates: externalRatesByCode.get(p.code),
      });
      if (!shrunk) {
        // The one abstention left: no Premier League minutes *and* no prior for
        // this position at all. Emitting nothing beats emitting a fabricated xP.
        // A skipped player is absent from pass 2's roster too, and so
        // correctly consumes none of their club's squad budget.
        skippedNoRates++;
        continue;
      }
      const { rates, evidence } = shrunk;
      bySource.set(evidence.priorSource, (bySource.get(evidence.priorSource) ?? 0) + 1);

      const code = positionCode.get(p.element_type) ?? "MID";
      const playerInput = {
        positionId: p.element_type,
        positionCode: code,
        status: p.status,
        chanceNextRound: p.chance_of_playing_next_round,
      };
      derived.push({ player: p, rates, evidence, availability: availabilityOf(playerInput), playerInput });
    }

    // ---- pass 2: reconcile ------------------------------------------------
    const byClub = new Map<number, Derived[]>();
    for (const d of derived) {
      const teamId = d.player.team_id;
      if (!byClub.has(teamId)) byClub.set(teamId, []);
      byClub.get(teamId)!.push(d);
    }

    const scaleByPlayerId = new Map<number, { startScale: number; minutesScale: number }>();
    const squadStatusByPlayerId = new Map<number, string>();
    const reconciliationByClub = new Map<number, SquadReconciliation>();
    let squadConsistencyViolations = 0;

    for (const [teamId, clubDerived] of byClub) {
      const members: SquadMember[] = clubDerived.map((d) => ({
        key: d.player.id,
        positionId: d.player.element_type,
        startShare: d.rates.startShare,
        minutesPerGame: d.rates.minutesPerGame,
        availability: d.availability,
        // v1.3.0: phase 2 weights each player's share of the squad
        // correction by how much of their rate is prior rather than their
        // own record, instead of one uniform factor per position group —
        // see reconcileClubSquadWeighted in xp-model.ts and "Squad
        // reconciliation, phase 2" in docs/roadmap.md for the backtest that
        // gated shipping it.
        priorWeight: d.evidence.priorWeight,
      }));
      const reconciliation = reconcileClubSquadWeighted(members, squadBudgets);
      reconciliationByClub.set(teamId, reconciliation);
      squadConsistencyViolations += reconciliation.consistencyViolations;

      const status = `${reconciliation.goalkeeperFit.status}/${reconciliation.outfieldFit.status}/${reconciliation.minutesFit.status}`;
      for (const d of clubDerived) {
        scaleByPlayerId.set(d.player.id, reconciliation.scales.get(d.player.id)!);
        squadStatusByPlayerId.set(d.player.id, status);
      }
    }

    // ---- pass 3: predict ---------------------------------------------------
    const rows: Record<string, unknown>[] = [];

    for (const d of derived) {
      const p = d.player;
      const scale = scaleByPlayerId.get(p.id)!;
      const squadStatus = squadStatusByPlayerId.get(p.id)!;
      const rates = applySquadScale(d.rates, scale);

      // The reported band comes from re-running the model at the rates'
      // bounds around the *unscaled* mean rates, then applying the same
      // squad scale to all three runs. One club-level lambda, not one per
      // bound — solving each bound independently would collapse the band on
      // exactly the cold-start players it exists for (their team-mates share
      // a prior cell, so ratesAtBound shifts them by a similar absolute
      // amount, and dividing each run by its own lambda maps all three close
      // to the same allocation). "Eleven start" is a certainty; which eleven
      // is what is uncertain, and the band should describe the second thing.
      // See COLD_START_MODEL_NOTE.
      const ratesLowUnscaled = ratesAtBound(d.rates, d.evidence, -MODEL_PARAMS.bandZ);
      const ratesHighUnscaled = ratesAtBound(d.rates, d.evidence, MODEL_PARAMS.bandZ);
      const ratesLow = applySquadScale(ratesLowUnscaled, scale);
      const ratesHigh = applySquadScale(ratesHighUnscaled, scale);

      for (const f of byTeam.get(p.team_id) ?? []) {
        const fixture = { fdr: f.fdr, isHome: f.isHome };
        const pred = predict(d.playerInput, rates, fixture, scoring);
        const low = predict(d.playerInput, ratesLow, fixture, scoring);
        const high = predict(d.playerInput, ratesHigh, fixture, scoring);

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
          xp_lower: round(Math.min(low.xp, high.xp), 3),
          xp_upper: round(Math.max(low.xp, high.xp), 3),

          prior_weight: round(d.evidence.priorWeight, 3),
          n_eff: round(d.evidence.nEff, 2),
          reliability: d.evidence.reliability,
          prior_source: d.evidence.priorSource,

          rates: {
            seasons: rates.seasonsUsed,
            mpg: round(rates.minutesPerGame, 1),
            start_share: round(rates.startShare, 3),
            xg90: round(rates.xg90, 3),
            xa90: round(rates.xa90, 3),
            dc90: round(rates.dc90, 2),
            // Carried so a number can be explained after the fact, which is the
            // whole point of storing provenance next to the value.
            prior_weight: round(d.evidence.priorWeight, 3),
            prior_source: d.evidence.priorSource,
            n_eff: round(d.evidence.nEff, 2),
            // Squad-reconciliation provenance (v1.2.0): how much this
            // player's rates moved to make their club's roster sum to
            // eleven starters, one keeper, and 990 minutes.
            squad_start_scale: round(scale.startScale, 3),
            squad_minutes_scale: round(scale.minutesScale, 3),
            squad_status: squadStatus,
          },
        });
      }
    }

    const squadStatusCounts = new Map<string, number>();
    for (const reconciliation of reconciliationByClub.values()) {
      for (const s of [reconciliation.goalkeeperFit.status, reconciliation.outfieldFit.status, reconciliation.minutesFit.status]) {
        squadStatusCounts.set(s, (squadStatusCounts.get(s) ?? 0) + 1);
      }
    }

    // Replace every stored version for this season, not just this run's own
    // MODEL_VERSION. No front-end page filters on model_version — six call
    // sites read player_predictions/player_xp_horizons without one — so a
    // version bump that deletes only its own rows would leave the previous
    // version's rows in place and double every player's horizon data. This
    // is the invariant that keeps that correct; see docs/roadmap.md.
    const { error: deleteError } = await db
      .from("player_predictions")
      .delete()
      .eq("season", season);
    if (deleteError) throw new Error(`clear predictions: ${deleteError.message}`);

    for (const batch of chunk(rows, 500)) {
      const { error } = await db.from("player_predictions").insert(batch);
      if (error) throw new Error(`player_predictions: ${error.message}`);
    }

    // Archive the next gameweek's snapshot before it is overwritten by a
    // future run. player_predictions holds no history — it is deleted and
    // replaced wholesale every run (see the delete above) — so this is the
    // only surviving record of what the model said before a gameweek's
    // deadline, which is what an accuracy scoreboard needs to score against
    // once the gameweek is played. See the migration
    // (20260827154000_prediction_archive.sql) for why this is a separate
    // table with a different key shape rather than reusing player_predictions.
    //
    // Gated on the deadline, not on a "haven't archived yet" flag: this
    // function runs every 30 minutes, so re-archiving pre-deadline is
    // intentional (it keeps the snapshot fresh right up to the deadline),
    // while any run after the deadline must leave the frozen snapshot alone.
    // That is the whole idempotency story — no separate "already archived"
    // state to track.
    let archivedRows = 0;
    const archiveSkippedReason = Date.now() >= Date.parse(firstEventDeadline)
      ? `gameweek ${firstEvent}'s deadline has passed; snapshot is frozen`
      : null;
    if (!archiveSkippedReason) {
      const archiveRows = rows
        .filter((r) => r.event === firstEvent)
        .map((r) => ({ ...r, deadline_time: firstEventDeadline }));
      for (const batch of chunk(archiveRows, 500)) {
        const { error } = await db
          .from("player_prediction_archive")
          .upsert(batch, { onConflict: "season,event,player_id,fixture" });
        if (error) throw new Error(`player_prediction_archive: ${error.message}`);
      }
      archivedRows = archiveRows.length;
    }

    await run.finish("success", {
      season,
      rowsWritten: rows.length,
      details: {
        model_version: MODEL_VERSION,
        events: `${firstEvent}-${lastEvent}`,
        horizon_gameweeks: lastEvent - firstEvent + 1,
        players_predicted: players.length - skippedNoRates,
        skipped_no_prior: skippedNoRates,
        prior_cells: priors.cells.length,
        by_prior_source: Object.fromEntries(bySource),
        clubs_reconciled: reconciliationByClub.size,
        squad_status: Object.fromEntries(squadStatusCounts),
        squad_consistency_violations: squadConsistencyViolations,
        archived_rows: archivedRows,
        archive_skipped_reason: archiveSkippedReason,
      },
    });

    return jsonResponse({
      ok: true,
      season,
      model_version: MODEL_VERSION,
      events: `${firstEvent}-${lastEvent}`,
      predictions: rows.length,
      players_predicted: players.length - skippedNoRates,
      skipped_no_prior: skippedNoRates,
      prior_cells: priors.cells.length,
      by_prior_source: Object.fromEntries(bySource),
      archived_rows: archivedRows,
      archive_skipped_reason: archiveSkippedReason,
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
