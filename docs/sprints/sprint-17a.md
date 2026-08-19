# Model Validation — Walk-Forward Backtest (Sprint 17a, run 2026-08-18)

**Status: built and run.** xP engine **v1.5.0** (unchanged — this sprint validates, it does not
recalibrate). Precondition for Sprint 17's gradient-boosted minutes work, which
[roadmap.md](../roadmap.md) already names as blocked on "refit `positionCalibration` against real
2026/27 results first." This is the walk-forward equivalent, run against seasons that already
exist.

## Why this exists

[phase-4-model.md](../phase-4-model.md) records exactly one backtest of the xP model: predicted
`xp_8 / 8` against actual 2025/26 season totals, cohort n = 207, **bias ≈ 0.000, MAE 0.420, r =
0.850**. Three things make that number weaker than it looks:

1. **2025/26 carries weight 0.6 in the model's own rate blend**, and `positionCalibration` was
   fitted on the same 207-player cohort. Bias ≈ 0 is true by construction.
2. **It is a season-aggregate comparison.** Averaging a player's 38 gameweeks before scoring
   suppresses exactly the gameweek-to-gameweek variance the model exists to price. An MAE of 0.42
   points per player-season is not comparable to any per-gameweek figure.
3. **Nothing was measured against a comparator.** The number stands on its own.

A third-party analysis of FPL quantitative methods (reviewed 2026-08-18) argued for exactly this
kind of walk-forward validation, and named the resource that makes it possible: the community-run
[Vaastav Fantasy-Premier-League archive](https://github.com/vaastav/Fantasy-Premier-League), which
serves per-gameweek CSVs for past seasons the FPL API itself no longer exposes.

## What was built

**`supabase/functions/ingest-fpl-archive`** — an Edge Function, not a local script. A first
attempt wrote a `npx tsx` script that generated batched `INSERT` SQL and relayed it through chat
to the `execute_sql` MCP tool; this was abandoned after one real batch (500 rows) turned out to
tokenize to roughly 500,000 tokens — dense numeric/JSON text tokenizes far worse than prose, and
relaying ~50,000 rows that way would have cost tens of millions of tokens for zero benefit over
having the function fetch and write server-side, which is what every other `sync-*` function in
this repo already does. Mirrors `sync-player-history`'s cursored, time-budgeted shape (55s budget,
resumable via `sync_runs.cursor`), though every season in practice completed in one invocation.

Rows are filtered to `player_code`s present in `player_season_history` (506 distinct codes) —
the model's only training source, and a much smaller set than an archived season's full headcount
(~700-900 rows/gameweek including academy and departed players this DB holds no season history
for). A player the model cannot train rates for is a player it cannot be scored against, so this
filter is exact, not a sample.

Two real bugs surfaced and were fixed before the data could be trusted:

- **The 1000-row PostgREST cap** (documented in [CLAUDE.md](../../CLAUDE.md) as a standing
  gotcha) silently truncated the first `player_season_history` fetch to ~1000 of 2039 rows,
  undercounting the allowed-codes set and writing only 4,899 rows for 2025-26 instead of the
  correct ~16,900. Fixed by paging with `.range()`.
- **`ON CONFLICT DO UPDATE command cannot affect row a second time`** — the archive occasionally
  repeats a row within one `gw{N}.csv` (rearranged/postponed fixtures re-listed), which a plain
  array upsert cannot apply twice in one statement. Fixed by deduping on `(player_id, fixture)`
  within a gameweek before upserting, last occurrence wins.

**`scripts/backtest-walkforward.ts`** — imports the real production model
(`supabase/functions/_shared/xp-model.ts`) directly and unmodified; that file has zero imports and
no Deno globals, so it runs under `npx tsx` as-is. A harness that reimplements the model validates
a copy, not the thing that ships.

**Scope cut, disclosed:** the harness calls `deriveRates` (season-weighted per-90 rates, gated at
270 weighted minutes) rather than the full `deriveRatesWithPrior` + `reconcileClubSquadWeighted`
pipeline `generate-predictions` runs in production. The prior-shrinkage and squad-reconciliation
layers exist to rescue cold-start/thin-data players; they do not materially change the number for
a player with a real prior-season record, which is exactly the cohort this harness scores
(≥1200 weighted minutes, matching the existing in-sample backtest's cohort floor so the two are
comparable in *shape* if not in scale). Fixture difficulty is held neutral (`fdr: 3`) throughout —
past-season official FDR isn't obtainable, and a proxy fitted after the fact would be inventing a
coefficient the ground rules forbid. The fixture-multiplier layer is therefore validated by
nothing here, in either version.

## Method

For each target season S ∈ {2023-24, 2024-25, 2025-26}: train rates from `player_season_history`
rows with `season_name < S` only (no season S or later touches training), predict every gameweek
of S with the real `predict()`, score against `player_gameweek_stats.total_points` (S's archive
data, ingested this sprint). Two comparators, computed over the identical row set as each other
and reported alongside a same-row-set restriction of the model's own numbers, so the comparison
isn't distorted by which rows each one happens to cover:

- **Naive baseline** — mean of the player's own last 5 gameweeks that season (undefined for the
  first 5 gameweeks of a player's season, so this necessarily excludes early-season rows).
- **`model (matched)`** — the same model predictions as `overall`, restricted to the rows where
  the baseline is defined, to check the gap isn't a row-set artifact.

Outcome tiers, on actual returns: **Zeros** (0 minutes), **Blanks** (played, ≤2 pts), **Tickers**
(3-4 pts), **Haulers** (≥5 pts).

## Results

| Season | Cohort (≥1200 wtd min) | Model MAE | Model (matched) MAE | Last-5 baseline MAE | Model r | Baseline r | Model bias |
|---|---|---|---|---|---|---|---|
| 2023-24 | 129 players | 2.316 | 2.349 | **2.034** | 0.227 | **0.369** | -0.230 |
| 2024-25 | 171 players | 2.360 | 2.386 | **2.043** | 0.203 | **0.345** | -0.458 |
| 2025-26 | 195 players | 2.546 | 2.552 | **2.061** | 0.153 | **0.341** | -0.655 |

Per-gameweek MAE is not comparable to the in-sample season-aggregate MAE of 0.420 — the two are
different units of aggregation, exactly the point of running this. The comparable number is the
one right here: **on identical rows, in every one of the three target seasons, the model's
per-gameweek MAE and correlation with actual points are both worse than a naive rolling average of
the player's own last 5 gameweeks.** Bias is not just non-zero out-of-sample, it is trending more
negative in more recent seasons — the model underpredicts, and increasingly so.

**Outcome tiers** (2025/26 shown, others in the raw output — pattern holds across all three):

| Tier | n | MAE | r |
|---|---|---|---|
| Zeros | 2001 | 2.935 | n/a (zero variance in actual) |
| Blanks | 2852 | 1.778 | 0.136 |
| Tickers | 821 | 1.049 | -0.095 |
| Haulers | 1339 | 4.518 | 0.138 |

Haulers carry the largest absolute error by a wide margin, consistent with `xp-model.ts`'s own
stated limitation — no current-season form, no minutes model beyond `startShare x 0.92` — being
sharpest exactly where a hot streak or a role change moves the true rate furthest from the
prior-seasons rate the model is stuck predicting from.

**Not a leakage bug.** The sharpest test available (per the original verification plan) is
whether 2025/26 — weighted 0.6 in the production rate blend — comes out *worse* walk-forward than
the in-sample figure. It does, decisively, and by more than aggregation alone would predict. The
split is doing real work.

## What this does and doesn't mean

It does not mean the underlying-metrics approach (xG90/xA90 over lagged points) is wrong — the
model still beats the tier where it should be strongest relatively (Haulers r = 0.138 vs Blanks r
= 0.136, roughly flat, not the sharp edge you'd expect from a shot-quality-driven model, which
itself is informative). It does mean **`positionCalibration`, fitted once on an in-sample cohort
that is largely the same season as its own training data, does not survive being asked to predict
a gameweek it has never seen** — and a naive baseline nobody would call a model currently beats it
on the numbers that matter for rank.

## Explicitly not done this sprint

- **Recalibration.** The bias trend (-0.23 -> -0.46 -> -0.66) is a material, non-construction
  departure from in-sample ≈0, which is what the original plan set as the trigger for refitting
  `positionCalibration` on walk-forward residuals. That refit is not done here — doing it well
  needs its own held-out check (refit on two seasons, validate on the third), and rushing it in
  the same pass that produced the finding risks exactly the "tune until it looks reasonable"
  failure the ground rules warn against. This result is the evidence for that follow-up sprint,
  not the follow-up itself.
- **FPL's own `xP` comparator.** The archive carries FPL's official per-gameweek `xP` column; it
  was dropped during ingestion when `raw` was trimmed to provenance-only fields to keep the Edge
  Function payload small. Recoverable without re-fetching truth data — add one column and one
  archive field — but not done here.
- **The ILP optimiser spike** and the **2022-23 season backfill beyond ingestion** (ingested,
  4th cohort available, not included as a walk-forward target since `player_season_history` has
  no season prior to it to train from) are both out of scope for this pass; see the parent
  conversation for why.

## Reproducing this

```bash
# Backfill (idempotent, safe to re-run; each call completes a season in one invocation)
curl -s "https://fyxyqxpscmqjyjxsyhms.supabase.co/functions/v1/ingest-fpl-archive?season=2023-24" \
  -H "Authorization: Bearer $ANON_KEY" -H "apikey: $ANON_KEY"
# season=2022-23 | 2023-24 | 2024-25 | 2025-26; add &force=1 to redo a completed season

# Validation harness (reads via publishable key, no writes)
npx tsx scripts/backtest-walkforward.ts
```
