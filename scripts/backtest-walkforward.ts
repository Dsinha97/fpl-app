// Walk-forward validation of the production xP model.
//
// The only existing backtest (docs/phase-4-model.md) compares season-
// aggregate predicted xp_8/8 against actual 2025/26 points, a season
// weighted 0.6 in the model's own rate blend, with position calibration
// fitted on the same cohort — bias ~= 0 is true by construction. This script
// answers a different, harder question: trained on strictly earlier seasons
// only, how well does the model predict a gameweek it has never seen?
//
// Imports the real production model (supabase/functions/_shared/xp-model.ts)
// directly — that file has zero imports and no Deno globals, so it runs
// unmodified under tsx. This is deliberate: a harness that reimplements the
// model validates a copy, not the thing that ships.
//
// Scope cut, disclosed: this harness calls `deriveRates` (season-weighted
// per-90 rates, gated at minWeightedMinutes) rather than the full
// `deriveRatesWithPrior` + `reconcileClubSquadWeighted` pipeline
// generate-predictions actually runs. The prior-shrinkage and squad-
// reconciliation layers exist to rescue cold-start/thin-data players: they
// do not change what a player with a real prior-season record (the cohort
// this harness scores) gets. Excluding them keeps this a validation of the
// core per-fixture component model — the same cohort shape (>=1200 weighted
// minutes) the existing in-sample backtest already uses — not a claim that
// the harness reproduces generate-predictions' exact output.
//
// Fixture difficulty is held neutral (fdr=3) throughout, for the same reason
// the plan document gives: past-season official FDR isn't obtainable, and a
// proxy fitted after the fact would be inventing a coefficient. The fixture-
// multiplier layer is therefore not exercised by this validation pass.
//
// Usage: npx tsx scripts/backtest-walkforward.ts

import {
  deriveDcEligibleSeasons,
  deriveRates,
  MODEL_VERSION,
  predict,
  type PlayerInput,
  type SeasonRow,
  type ScoringRules,
} from "../supabase/functions/_shared/xp-model.ts";
import { accuracyStats, mean } from "../lib/stats.ts";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY not set - load .env.local");
}

const MIN_WEIGHTED_MINUTES_COHORT = 1200; // matches the existing in-sample backtest's cohort

async function fetchAll<T>(table: string, select: string, extra = ""): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  for (;;) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}${extra}&limit=1000&offset=${from}`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
    );
    if (!res.ok) throw new Error(`${table}: HTTP ${res.status} ${await res.text()}`);
    const rows = (await res.json()) as T[];
    out.push(...rows);
    if (rows.length < 1000) break;
    from += 1000;
  }
  return out;
}

interface PlayerRow { id: number; code: number; element_type: number }
interface ElementType { id: number; singular_name_short: string }
interface ScoringRow { stat: string; position: string; value: number }
interface GwTruthRow {
  season: string; player_code: number; event: number | null; fixture: number;
  opponent_team: number | null; was_home: boolean | null; minutes: number | null;
  total_points: number | null;
}

function buildScoring(rows: ScoringRow[]): ScoringRules {
  const table = new Map<string, number>();
  for (const r of rows) table.set(`${r.stat}:${r.position}`, Number(r.value));
  return { get: (stat, position) => table.get(`${stat}:${position}`) ?? table.get(`${stat}:ALL`) ?? 0 };
}

function tierOf(minutes: number, points: number): "Zeros" | "Blanks" | "Tickers" | "Haulers" {
  if (minutes <= 0) return "Zeros";
  if (points <= 2) return "Blanks";
  if (points <= 4) return "Tickers";
  return "Haulers";
}

// bias/MAE/RMSE/Pearson-r now live in lib/stats.ts as `accuracyStats`, shared
// with the live prediction-accuracy scoreboard — this used to be a locally
// declared `stats` here, which would have been a second implementation of
// the same accuracy metric. `mean` is imported alongside it for the same
// reason.
const stats = accuracyStats;

async function main() {
  console.error("Loading reference tables...");
  const [players, elementTypes, scoringRows, seasonHistory] = await Promise.all([
    fetchAll<PlayerRow>("players", "id,code,element_type"),
    fetchAll<ElementType>("element_types", "id,singular_name_short"),
    fetchAll<ScoringRow>("scoring_rules", "stat,position,value", "&season=eq.2026-27"),
    fetchAll<SeasonRow & { player_code: number }>(
      "player_season_history",
      "player_code,season_name,minutes,starts,expected_goals,expected_assists,expected_goals_conceded,clean_sheets,bonus,saves,defensive_contribution,yellow_cards",
    ),
  ]);

  const positionByCode = new Map(players.map((p) => [p.code, p.element_type]));
  const positionCode = new Map(elementTypes.map((t) => [t.id, t.singular_name_short]));
  const scoring = buildScoring(scoringRows);
  const dcEligibleSeasons = deriveDcEligibleSeasons(seasonHistory);

  const historyByCode = new Map<number, (SeasonRow & { player_code: number })[]>();
  for (const row of seasonHistory) {
    const list = historyByCode.get(row.player_code);
    if (list) list.push(row); else historyByCode.set(row.player_code, [row]);
  }

  // archive hyphen-form -> season_history slash-form, and which seasons are
  // strictly prior (string comparison is safe: both forms are 4-digit-year-
  // prefixed, so lexicographic order matches chronological order).
  const targets: { archiveSeason: string; slashSeason: string }[] = [
    { archiveSeason: "2023-24", slashSeason: "2023/24" },
    { archiveSeason: "2024-25", slashSeason: "2024/25" },
    { archiveSeason: "2025-26", slashSeason: "2025/26" },
  ];

  const results: Record<string, unknown>[] = [];

  for (const { archiveSeason, slashSeason } of targets) {
    console.error(`\n=== ${archiveSeason} (walk-forward, trained on seasons < ${slashSeason}) ===`);

    const truth = await fetchAll<GwTruthRow>(
      "player_gameweek_stats",
      "season,player_code,event,fixture,opponent_team,was_home,minutes,total_points",
      `&season=eq.${archiveSeason}`,
    );
    console.error(`  truth rows: ${truth.length}`);

    // Rates per player, trained on strictly-prior season_history rows only.
    const ratesByCode = new Map<number, ReturnType<typeof deriveRates>>();
    for (const [code, rows] of historyByCode) {
      const priorRows = rows.filter((r) => r.season_name < slashSeason);
      if (priorRows.length === 0) continue;
      ratesByCode.set(code, deriveRates(priorRows, dcEligibleSeasons));
    }

    // Cohort: >=1200 weighted minutes of prior evidence, same floor the
    // existing in-sample backtest uses, so the two numbers are comparable.
    const cohortCodes = new Set(
      [...ratesByCode.entries()]
        .filter(([, r]) => r !== null && r.weightedMinutes >= MIN_WEIGHTED_MINUTES_COHORT)
        .map(([code]) => code),
    );
    console.error(`  cohort (>=${MIN_WEIGHTED_MINUTES_COHORT} weighted minutes of prior evidence): ${cohortCodes.size} players`);

    type Residual = { pred: number; actual: number; positionCode: string; minutes: number };
    const residuals: Residual[] = [];
    const matchedResiduals: Residual[] = []; // model, restricted to rows where the last-5 baseline is also defined
    const last5ResidualsByCode = new Map<number, { pred: number; actual: number; positionCode: string; minutes: number }[]>();

    // Group truth rows per player, sorted by event, to compute the last-5-
    // gameweeks-mean baseline without leaking future gameweeks into it.
    const truthByCode = new Map<number, GwTruthRow[]>();
    for (const row of truth) {
      if (!cohortCodes.has(row.player_code)) continue;
      const list = truthByCode.get(row.player_code);
      if (list) list.push(row); else truthByCode.set(row.player_code, [row]);
    }

    for (const [code, rows] of truthByCode) {
      const rates = ratesByCode.get(code);
      if (!rates) continue;
      const positionId = positionByCode.get(code);
      if (!positionId) continue;
      const posCode = positionCode.get(positionId) ?? "MID";
      const playerInput: PlayerInput = { positionId, positionCode: posCode, status: "a", chanceNextRound: null };

      const sorted = [...rows].filter((r) => r.event !== null).sort((a, b) => (a.event! - b.event!));
      const pointsHistory: number[] = [];

      for (const row of sorted) {
        const prediction = predict(
          playerInput,
          rates,
          { fdr: 3, isHome: row.was_home ?? true },
          scoring,
        );
        const actual = row.total_points ?? 0;
        const entry = { pred: prediction.xp, actual, positionCode: posCode, minutes: row.minutes ?? 0 };
        residuals.push(entry);

        if (pointsHistory.length >= 5) {
          const last5 = mean(pointsHistory.slice(-5));
          const list = last5ResidualsByCode.get(code) ?? [];
          list.push({ pred: last5, actual, positionCode: posCode, minutes: row.minutes ?? 0 });
          last5ResidualsByCode.set(code, list);
          matchedResiduals.push(entry);
        }
        pointsHistory.push(actual);
      }
    }

    const overall = stats(residuals);
    const last5Flat = [...last5ResidualsByCode.values()].flat();
    const last5Stats = stats(last5Flat);
    const matchedStats = stats(matchedResiduals); // model, same row set as last5Stats

    const byPosition = ["GKP", "DEF", "MID", "FWD"].map((pos) => ({
      position: pos,
      ...stats(residuals.filter((r) => r.positionCode === pos)),
    }));

    const byTier = (["Zeros", "Blanks", "Tickers", "Haulers"] as const).map((tier) => ({
      tier,
      ...stats(residuals.filter((r) => tierOf(r.minutes, r.actual) === tier)),
    }));

    console.error(`  model            n=${overall.n} bias=${overall.bias.toFixed(3)} mae=${overall.mae.toFixed(3)} rmse=${overall.rmse.toFixed(3)} r=${overall.r.toFixed(3)}`);
    console.error(`  model (matched)  n=${matchedStats.n} bias=${matchedStats.bias.toFixed(3)} mae=${matchedStats.mae.toFixed(3)} rmse=${matchedStats.rmse.toFixed(3)} r=${matchedStats.r.toFixed(3)}  <- same rows as last5 baseline`);
    console.error(`  last5 baseline   n=${last5Stats.n} bias=${last5Stats.bias.toFixed(3)} mae=${last5Stats.mae.toFixed(3)} rmse=${last5Stats.rmse.toFixed(3)} r=${last5Stats.r.toFixed(3)}`);
    for (const p of byPosition) console.error(`    ${p.position}: n=${p.n} mae=${isNaN(p.mae) ? "n/a" : p.mae.toFixed(3)} r=${isNaN(p.r) ? "n/a" : p.r.toFixed(3)}`);
    for (const t of byTier) console.error(`    ${t.tier}: n=${t.n} mae=${isNaN(t.mae) ? "n/a" : t.mae.toFixed(3)} r=${isNaN(t.r) ? "n/a" : t.r.toFixed(3)}`);

    results.push({ season: archiveSeason, modelVersion: MODEL_VERSION, overall, modelMatchedToBaseline: matchedStats, last5Baseline: last5Stats, byPosition, byTier });
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
