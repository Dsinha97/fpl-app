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
  deriveRatesWithPrior,
  fitRatePriors,
  MODEL_VERSION,
  predict,
  priceBandOf,
  type FitRow,
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

const MIN_WEIGHTED_MINUTES_COHORT = 1200;

/**
 * Current-season blend weights to sweep. One constant: this list used to be
 * written out three times (the residual-map init, the per-season sweep, and
 * the bias-correction loop), so adding a weight meant editing three places
 * and silently produced an empty map entry if you missed one.
 */
const CURRENT_SEASON_WEIGHTS = [0.3, 0.6, 1.0] as const;

/**
 * Which quantities the current season is allowed to move. "all" is the
 * original blend; "minutes" holds the per-90 scoring rates at prior-only and
 * lets the current season move mpg/start_share alone — see
 * ShrinkInput.currentSeasonScope in _shared/xp-model.ts.
 */
const BLEND_SCOPES = ["all", "minutes"] as const;
type BlendScope = (typeof BLEND_SCOPES)[number]; // matches the existing in-sample backtest's cohort

/**
 * Pages a table past the API's 1000-row cap.
 *
 * `order` is REQUIRED, and must be a unique key. Postgres guarantees no row
 * order without an ORDER BY, so `limit`/`offset` paging over an unordered
 * query can silently skip or repeat rows between pages — the same defect
 * CLAUDE.md records for `lib/player-pool.ts`'s concurrent `.range()` reads,
 * which is why that rule exists. This harness reads 10-17 pages of
 * `player_gameweek_stats` per season, so an unordered read made every run a
 * slightly different sample: measured 2026-09-06, one 2023-24 player out of
 * 285 went missing on a single run. That is enough to move a bias figure in
 * the third decimal and is the leading explanation for why the tables in
 * docs/phase-4-model.md could not be reproduced from any recoverable input
 * state.
 */
async function fetchAll<T>(
  table: string,
  select: string,
  extra = "",
  order = "",
): Promise<T[]> {
  if (!order) throw new Error(`fetchAll(${table}): an explicit unique 'order' is required`);
  const out: T[] = [];
  let from = 0;
  for (;;) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}${extra}` +
        `&order=${encodeURIComponent(order)}&limit=1000&offset=${from}`,
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
  // Everything needed to build a synthetic "current season so far" SeasonRow
  // for the blend sweep below — absent from the original truth-only fetch.
  starts: number | null;
  expected_goals: number | null;
  expected_assists: number | null;
  expected_goals_conceded: number | null;
  clean_sheets: number | null;
  bonus: number | null;
  saves: number | null;
  defensive_contribution: number | null;
  yellow_cards: number | null;
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

/**
 * FPL's archive position strings -> `element_types.id`.
 *
 * `player_gameweek_stats.raw->>'position'` (written by `ingest-fpl-archive`)
 * uses `GK`, while `element_types.singular_name_short` uses `GKP`; the other
 * three match. Verified against `element_types` (1=GKP, 2=DEF, 3=MID, 4=FWD)
 * rather than assumed.
 */
const ARCHIVE_POSITION_TO_ELEMENT_TYPE: Record<string, number> = {
  GK: 1, GKP: 1, DEF: 2, MID: 3, FWD: 4,
};

/**
 * Position per player *for one season*, rather than per player forever.
 *
 * Why this is not just `players.element_type`: `players` (and `element_types`,
 * and `fixtures`) only ever hold the CURRENT season's roster. Resolving a
 * historical season's positions through it means every past cohort is filtered
 * through today's Premier League squad list, and a player who has since left
 * the league would be dropped from seasons he actually played.
 *
 * Measured 2026-09-06: that filter currently drops **zero** players — every
 * code in `player_gameweek_stats` for 2022-23..2025-26 is still in today's
 * `players`, because `ingest-fpl-archive` only ever ingested codes that were
 * in the roster when it ran. So this is a latent fragility being closed, not
 * an active bug being fixed, and it is deliberately NOT offered as the
 * explanation for the reproducibility gap in docs/phase-4-model.md.
 *
 * Source order: the season's own archived `raw.position` first, then today's
 * roster. The fallback is load-bearing for 2026-27, whose rows come from
 * `sync-player-history` rather than the archive ingest and carry no
 * `raw.position` at all (0 of 1,891 rows).
 */
async function positionsForSeason(
  season: string,
  fallback: Map<number, number>,
): Promise<Map<number, number>> {
  const rows = await fetchAll<{ player_code: number; position: string | null }>(
    "player_gameweek_stats",
    "player_code,position:raw->>position",
    `&season=eq.${season}`,
    "player_code,fixture",
  );

  const byCode = new Map<number, number>();
  for (const r of rows) {
    const id = r.position ? ARCHIVE_POSITION_TO_ELEMENT_TYPE[r.position] : undefined;
    if (id !== undefined) byCode.set(r.player_code, id);
  }
  const fromArchive = byCode.size;

  // Fall back to today's roster for any code this season's rows don't place.
  for (const r of rows) {
    if (byCode.has(r.player_code)) continue;
    const id = fallback.get(r.player_code);
    if (id !== undefined) byCode.set(r.player_code, id);
  }
  console.error(
    `  positions: ${fromArchive} from this season's archive, ${byCode.size - fromArchive} from today's roster, ${byCode.size} total`,
  );
  return byCode;
}

async function main() {
  console.error("Loading reference tables...");
  const [players, elementTypes, scoringRows, seasonHistory] = await Promise.all([
    fetchAll<PlayerRow>("players", "id,code,element_type", "", "id"),
    fetchAll<ElementType>("element_types", "id,singular_name_short", "", "id"),
    fetchAll<ScoringRow>("scoring_rules", "stat,position,value", "&season=eq.2026-27", "stat,position"),
    fetchAll<SeasonRow & { player_code: number; start_cost: number | null }>(
      "player_season_history",
      "player_code,season_name,minutes,starts,expected_goals,expected_assists,expected_goals_conceded,clean_sheets,bonus,saves,defensive_contribution,yellow_cards,start_cost",
      "",
      "player_code,season_name",
    ),
  ]);

  // Today's roster, used as the FALLBACK position source only — see
  // `positionsForSeason`.
  const positionByCodeToday = new Map(players.map((p) => [p.code, p.element_type]));
  const positionCode = new Map(elementTypes.map((t) => [t.id, t.singular_name_short]));
  const scoring = buildScoring(scoringRows);
  const dcEligibleSeasons = deriveDcEligibleSeasons(seasonHistory);

  // Input fingerprint. The published tables in docs/phase-4-model.md could not
  // be reproduced from any recoverable input state (see that file's "Attempt 3"
  // section), and the reason nobody could tell why is that a run recorded its
  // *outputs* and none of its inputs. Printing the row counts each run reads
  // makes a future divergence attributable to a specific input instead of
  // guessable. `player_gameweek_stats` truth counts and the cohort size are
  // printed per season below, and are part of the same fingerprint.
  console.error(
    `Input fingerprint @ ${new Date().toISOString()}: players=${players.length} ` +
      `elementTypes=${elementTypes.length} scoringRules=${scoringRows.length} ` +
      `seasonHistory=${seasonHistory.length} modelVersion=${MODEL_VERSION}`,
  );

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
    // 2026-27 is the live season, added once GW3 was scored. It is a
    // deliberately weak target and is reported as such rather than quietly
    // averaged in: with three gameweeks played the last-5 baseline cannot
    // fire at all (it needs six), the blend arm only has events 2 and 3 to
    // contribute, and the mpg sanity check never triggers. It still belongs
    // in the gate — a season the model has genuinely never seen is the only
    // kind of evidence that matters here, and excluding it because it is
    // inconvenient would be choosing the gate to fit the answer.
    { archiveSeason: "2026-27", slashSeason: "2026/27" },
  ];

  const results: Record<string, unknown>[] = [];

  // Per-position bias-correction sweep (docs/roadmap.md's "attempt 2" step 2)
  // — accumulated across the whole walk-forward loop below so the correction
  // for a held-out season can be fit only from the OTHER two seasons
  // (leave-one-season-out), never from the season it's tested against. Keyed
  // by currentSeasonWeight, then archiveSeason, holding that season's own
  // blended residuals (with position) for that weight.
  type BlendResidual = { pred: number; actual: number; positionCode: string };
  // Keyed `scope:weight` so the two blend scopes accumulate side by side and
  // the bias-correction sweep below can be run over either.
  const blendKey = (scope: BlendScope, w: number) => `${scope}:${w}`;
  const blendResidualsByWeightAndSeason = new Map<string, Map<string, BlendResidual[]>>(
    BLEND_SCOPES.flatMap((scope) =>
      CURRENT_SEASON_WEIGHTS.map(
        (w) => [blendKey(scope, w), new Map<string, BlendResidual[]>()] as const,
      ),
    ),
  );
  const priorOnlyStatsBySeason = new Map<string, ReturnType<typeof accuracyStats>>();

  for (const { archiveSeason, slashSeason } of targets) {
    console.error(`\n=== ${archiveSeason} (walk-forward, trained on seasons < ${slashSeason}) ===`);

    // Positions as of THIS season, not as of today's roster — see
    // `positionsForSeason`.
    const positionByCode = await positionsForSeason(archiveSeason, positionByCodeToday);

    const truth = await fetchAll<GwTruthRow>(
      "player_gameweek_stats",
      "season,player_code,event,fixture,opponent_team,was_home,minutes,total_points," +
        "starts,expected_goals,expected_assists,expected_goals_conceded,clean_sheets,bonus,saves," +
        "defensive_contribution,yellow_cards",
      `&season=eq.${archiveSeason}`,
      "player_code,fixture",
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

    // accuracyStats returns NaN for every figure when n === 0 (deliberately,
    // so an empty set reads as "no data" rather than "zero error"). The last-5
    // baseline needs six played gameweeks before it produces a single row, so
    // early in a live season these are genuinely empty — print that, rather
    // than a line of NaN that looks like a broken harness.
    const line = (label: string, x: ReturnType<typeof stats>, suffix = "") =>
      x.n === 0
        ? `  ${label} n=0 — not enough played gameweeks yet (the last-5 baseline needs 6)`
        : `  ${label} n=${x.n} bias=${x.bias.toFixed(3)} mae=${x.mae.toFixed(3)} rmse=${x.rmse.toFixed(3)} r=${x.r.toFixed(3)}${suffix}`;

    console.error(line("model           ", overall));
    console.error(line("model (matched) ", matchedStats, "  <- same rows as last5 baseline"));
    console.error(line("last5 baseline  ", last5Stats));
    for (const p of byPosition) console.error(`    ${p.position}: n=${p.n} mae=${isNaN(p.mae) ? "n/a" : p.mae.toFixed(3)} r=${isNaN(p.r) ? "n/a" : p.r.toFixed(3)}`);
    for (const t of byTier) console.error(`    ${t.tier}: n=${t.n} mae=${isNaN(t.mae) ? "n/a" : t.mae.toFixed(3)} r=${isNaN(t.r) ? "n/a" : t.r.toFixed(3)}`);

    results.push({ season: archiveSeason, modelVersion: MODEL_VERSION, overall, modelMatchedToBaseline: matchedStats, last5Baseline: last5Stats, byPosition, byTier });

    // ---------------------------------------------------------------------
    // Current-season blend sweep (docs/phase-4-model.md's "current season
    // blend" section). A genuine within-season walk-forward: at event E, the
    // synthetic "season so far" row is built only from this *target*
    // season's events strictly before E, so nothing here ever sees the
    // future. Uses deriveRatesWithPrior (the real production path,
    // including squad-independent shrinkage) for BOTH arms — "prior-only"
    // and "blended" differ *only* in whether currentSeasonRow is passed, so
    // the comparison isolates the blend's effect rather than conflating it
    // with switching off deriveRates's simpler gate.
    //
    // priceBand is the player's price from their most recent PRIOR season's
    // start_cost (a proxy for "price at the start of the target season" —
    // the exact in-season price series isn't available for a season this
    // far back). This is the one place this sweep's cohort selection differs
    // from the baseline arm above: deriveRatesWithPrior never returns null
    // (it falls back to a fitted prior), so the >=1200-weighted-minutes
    // cohort filter above still applies to keep the two arms comparable, but
    // "cohort" here means "had that much PRIOR evidence", not zero passing.
    {
      const fitRows: FitRow[] = [];
      for (const [code, rows] of historyByCode) {
        const positionId = positionByCode.get(code);
        if (positionId === undefined) continue;
        for (const row of rows) {
          if (row.season_name >= slashSeason) continue; // strictly prior only
          fitRows.push({
            ...row,
            player_code: code,
            positionId,
            priceBand: priceBandOf(row.start_cost ?? 0),
          });
        }
      }
      const priors = fitRatePriors(fitRows, dcEligibleSeasons);

      // This season's own DC coverage — if any truth row this season has a
      // non-null dc, the synthetic row's season name is DC-eligible too.
      const seasonDcEligible = truth.some((r) => r.defensive_contribution !== null);
      const blendDcEligibleSeasons = new Set(dcEligibleSeasons);
      const BLEND_SEASON_NAME = `${slashSeason}-so-far`;
      if (seasonDcEligible) blendDcEligibleSeasons.add(BLEND_SEASON_NAME);

      // Most recent PRIOR-season price per player, for priceBand — see the
      // comment above.
      const priceBandByCode = new Map<number, string>();
      for (const [code, rows] of historyByCode) {
        const prior = rows.filter((r) => r.season_name < slashSeason).sort((a, b) => b.season_name.localeCompare(a.season_name));
        if (prior.length > 0) priceBandByCode.set(code, priceBandOf(prior[0].start_cost ?? 0));
      }

      const priorOnlyResiduals: BlendResidual[] = [];
      const blendedResidualsByWeight = new Map<string, BlendResidual[]>(
        BLEND_SCOPES.flatMap((scope) =>
          CURRENT_SEASON_WEIGHTS.map((w) => [blendKey(scope, w), [] as BlendResidual[]] as const),
        ),
      );

      // mpg sanity check (the 79->33 collapse this fix guards against) — the
      // five highest-prior-minutes players in this season's cohort, at the
      // event where they first have >=3 games of current-season evidence.
      const mpgCheck: { code: number; event: number; mpgBefore: number; mpgAfterByWeight: Record<number, number> }[] = [];
      const topByPriorMinutes = [...cohortCodes]
        .map((code) => ({ code, minutes: ratesByCode.get(code)?.weightedMinutes ?? 0 }))
        .sort((a, b) => b.minutes - a.minutes)
        .slice(0, 5)
        .map((x) => x.code);

      for (const code of cohortCodes) {
        const positionId = positionByCode.get(code);
        const priceBand = priceBandByCode.get(code);
        if (positionId === undefined || priceBand === undefined) continue;

        const priorRows = (historyByCode.get(code) ?? []).filter((r) => r.season_name < slashSeason);
        const posCode = positionCode.get(positionId) ?? "MID";
        const playerInput: PlayerInput = { positionId, positionCode: posCode, status: "a", chanceNextRound: null };

        const rows = (truthByCode.get(code) ?? [])
          .filter((r) => r.event !== null)
          .sort((a, b) => a.event! - b.event!);

        // Running totals of *strictly prior* events in this season, rebuilt
        // fresh before each event so nothing leaks the event being predicted.
        let games = 0, minutes = 0, starts = 0, xg = 0, xa = 0, xgc = 0, cs = 0, bonus = 0, saves = 0, dc = 0, yellow = 0;

        for (const row of rows) {
          // Predict this event using ONLY events strictly before it —
          // accumulate into the running current-season row AFTER predicting.
          const priorOnly = deriveRatesWithPrior({
            rows: priorRows, positionId, priceBand, priors, dcEligibleSeasons,
          });
          if (priorOnly) {
            const pred = predict(playerInput, priorOnly.rates, { fdr: 3, isHome: row.was_home ?? true }, scoring);
            priorOnlyResiduals.push({ pred: pred.xp, actual: row.total_points ?? 0, positionCode: posCode });
          }

          if (games > 0) {
            const currentSeasonRow: SeasonRow = {
              season_name: BLEND_SEASON_NAME,
              minutes, starts, expected_goals: xg, expected_assists: xa,
              expected_goals_conceded: xgc, clean_sheets: cs, bonus, saves,
              defensive_contribution: dc, yellow_cards: yellow, games,
            };
            for (const scope of BLEND_SCOPES) {
              for (const w of CURRENT_SEASON_WEIGHTS) {
                const blended = deriveRatesWithPrior({
                  rows: priorRows, positionId, priceBand, priors,
                  dcEligibleSeasons: blendDcEligibleSeasons,
                  currentSeasonRow, currentSeasonWeight: w, currentSeasonScope: scope,
                });
                if (!blended) continue;
                const pred = predict(playerInput, blended.rates, { fdr: 3, isHome: row.was_home ?? true }, scoring);
                blendedResidualsByWeight.get(blendKey(scope, w))!.push({ pred: pred.xp, actual: row.total_points ?? 0, positionCode: posCode });

                if (scope === "all" && w === 0.6 && games === 3 && topByPriorMinutes.includes(code)) {
                  mpgCheck.push({
                    code, event: row.event!,
                    mpgBefore: priorOnly?.rates.minutesPerGame ?? -1,
                    mpgAfterByWeight: { [w]: blended.rates.minutesPerGame },
                  });
                }
              }
            }
          }

          // Now fold this event into the running totals, for the *next* iteration.
          games += 1;
          minutes += row.minutes ?? 0;
          starts += row.starts ?? 0;
          xg += row.expected_goals ?? 0;
          xa += row.expected_assists ?? 0;
          xgc += row.expected_goals_conceded ?? 0;
          cs += row.clean_sheets ?? 0;
          bonus += row.bonus ?? 0;
          saves += row.saves ?? 0;
          dc += row.defensive_contribution ?? 0;
          yellow += row.yellow_cards ?? 0;
        }
      }

      const priorOnlyStats = stats(priorOnlyResiduals);
      priorOnlyStatsBySeason.set(archiveSeason, priorOnlyStats);
      for (const scope of BLEND_SCOPES) {
        for (const w of CURRENT_SEASON_WEIGHTS) {
          blendResidualsByWeightAndSeason
            .get(blendKey(scope, w))!
            .set(archiveSeason, blendedResidualsByWeight.get(blendKey(scope, w))!);
        }
      }
      console.error(`\n  -- current-season blend sweep (deriveRatesWithPrior, both arms) --`);
      console.error(`  prior-only (no blend)  n=${priorOnlyStats.n} bias=${priorOnlyStats.bias.toFixed(3)} mae=${priorOnlyStats.mae.toFixed(3)} r=${priorOnlyStats.r.toFixed(3)}`);
      const blendResults: Record<string, unknown>[] = [];
      for (const scope of BLEND_SCOPES) {
      for (const w of CURRENT_SEASON_WEIGHTS) {
        const s = stats(blendedResidualsByWeight.get(blendKey(scope, w))!);
        // "Without worsening bias" means |bias| shouldn't grow, in either
        // direction — comparing raw signed bias would call a more-negative
        // bias a "pass" whenever the prior-only bias was already negative,
        // which is backwards (a bias moving from -0.33 to -0.39 is worse,
        // not "not increasing").
        const clears = s.n > 0 && s.mae < priorOnlyStats.mae && s.r > priorOnlyStats.r &&
          Math.abs(s.bias) <= Math.abs(priorOnlyStats.bias) + 0.01;
        console.error(`  blended scope=${scope.padEnd(7)} wCur=${w}  n=${s.n} bias=${s.bias.toFixed(3)} mae=${s.mae.toFixed(3)} r=${s.r.toFixed(3)}  ${clears ? "CLEARS gate" : "does not clear"}`);
        blendResults.push({ scope, currentSeasonWeight: w, ...s, clearsGate: clears });
      }
      }
      for (const check of mpgCheck) {
        console.error(`    mpg check code=${check.code} event=${check.event}: before=${check.mpgBefore.toFixed(1)} after(w=0.6)=${check.mpgAfterByWeight[0.6]?.toFixed(1)}`);
      }

      results.push({
        season: archiveSeason,
        blendSweep: { priorOnly: priorOnlyStats, byWeight: blendResults, mpgCheck },
      });
    }
  }

  // ---------------------------------------------------------------------
  // Per-position bias-correction sweep, leave-one-season-out.
  //
  // The existing blend sweep above found MAE/r improve at every weight in
  // every season, but bias consistently worsens — "the signature of a
  // fixable calibration offset, not a broken feature" (docs/roadmap.md).
  // A per-position intercept correction is exactly that: shift each
  // position's predictions by a constant so their mean residual (bias) goes
  // to ~0. Pearson r is invariant to an additive shift, so this can only
  // help bias/MAE and never touches r — the correction is fit ONLY from the
  // two seasons NOT being scored (never the season under test), so this
  // stays a genuine out-of-sample check rather than the closed-form zero
  // this would trivially become if fit and scored on the same season.
  const POSITIONS = ["GKP", "DEF", "MID", "FWD"] as const;
  const correctionResults: Record<string, unknown>[] = [];

  for (const scope of BLEND_SCOPES) {
  for (const w of CURRENT_SEASON_WEIGHTS) {
    const bySeason = blendResidualsByWeightAndSeason.get(blendKey(scope, w))!;
    console.error(`\n=== bias correction, scope=${scope} wCur=${w} (leave-one-season-out) ===`);
    for (const heldOutSeason of targets.map((t) => t.archiveSeason)) {
      const trainSeasons = targets.map((t) => t.archiveSeason).filter((s) => s !== heldOutSeason);
      const trainResiduals = trainSeasons.flatMap((s) => bySeason.get(s) ?? []);

      const correctionByPosition = new Map<string, number>();
      for (const pos of POSITIONS) {
        const posResiduals = trainResiduals.filter((r) => r.positionCode === pos);
        // bias = mean(actual - pred); adding it back de-biases the arm it was fit on.
        correctionByPosition.set(pos, posResiduals.length > 0 ? stats(posResiduals).bias : 0);
      }

      const testResiduals = bySeason.get(heldOutSeason) ?? [];
      const corrected = testResiduals.map((r) => ({
        ...r,
        pred: r.pred + (correctionByPosition.get(r.positionCode) ?? 0),
      }));
      const correctedStats = stats(corrected);
      const priorOnly = priorOnlyStatsBySeason.get(heldOutSeason)!;
      const uncorrected = stats(testResiduals);

      const clears = correctedStats.n > 0 && correctedStats.mae < priorOnly.mae && correctedStats.r > priorOnly.r &&
        Math.abs(correctedStats.bias) <= Math.abs(priorOnly.bias) + 0.01;

      console.error(
        `  ${heldOutSeason}: correction(GKP/DEF/MID/FWD)=${POSITIONS.map((p) => correctionByPosition.get(p)!.toFixed(2)).join("/")}\n` +
          `    before  n=${uncorrected.n} bias=${uncorrected.bias.toFixed(3)} mae=${uncorrected.mae.toFixed(3)} r=${uncorrected.r.toFixed(3)}\n` +
          `    after   n=${correctedStats.n} bias=${correctedStats.bias.toFixed(3)} mae=${correctedStats.mae.toFixed(3)} r=${correctedStats.r.toFixed(3)}  ${clears ? "CLEARS gate" : "does not clear"}`,
      );

      correctionResults.push({
        scope,
        currentSeasonWeight: w,
        heldOutSeason,
        correctionByPosition: Object.fromEntries(correctionByPosition),
        before: uncorrected,
        after: correctedStats,
        priorOnly,
        clearsGate: clears,
      });
    }
  }
  }

  const seasonCount = targets.length;
  const allClear = BLEND_SCOPES.some((scope) =>
    CURRENT_SEASON_WEIGHTS.some((w) => {
      const rows = correctionResults.filter(
        (r) => r.scope === scope && r.currentSeasonWeight === w,
      );
      return rows.length === seasonCount && rows.every((r) => r.clearsGate === true);
    }),
  );
  console.error(
    `\n=== bias-correction verdict: ${allClear ? `at least one scope/weight clears the gate in all ${seasonCount} seasons` : `no scope/weight clears the gate in all ${seasonCount} seasons — do not ship`} ===`,
  );

  // The blend sweep's own verdict, independent of the bias correction: does
  // any scope/weight clear the unchanged gate in every target season on its
  // own? That is the question the narrow-scope arm actually asks, and it was
  // previously only readable by eye off the per-season lines.
  const blendSweepRows = results.flatMap((r) => {
    const row = r as { season?: string; blendSweep?: { byWeight: Record<string, unknown>[] } };
    return row.blendSweep
      ? row.blendSweep.byWeight.map((b) => ({ season: row.season as string, ...b }))
      : [];
  });
  const blendVerdict = BLEND_SCOPES.flatMap((scope) =>
    CURRENT_SEASON_WEIGHTS.map((w) => {
      const rows = blendSweepRows.filter(
        (b) => b.scope === scope && b.currentSeasonWeight === w,
      );
      return {
        scope,
        currentSeasonWeight: w,
        seasonsClear: rows.filter((b) => b.clearsGate === true).length,
        seasons: rows.length,
        clearsEverySeason: rows.length === seasonCount && rows.every((b) => b.clearsGate === true),
      };
    }),
  );
  console.error(`
=== blend sweep verdict (no bias correction), ${seasonCount} target seasons ===`);
  for (const v of blendVerdict) {
    console.error(
      `  scope=${v.scope.padEnd(7)} wCur=${v.currentSeasonWeight}  clears ${v.seasonsClear}/${v.seasons} seasons${v.clearsEverySeason ? "  <- SHIPPABLE" : ""}`,
    );
  }

  results.push({ biasCorrectionSweep: correctionResults, allClear, blendVerdict });

  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
