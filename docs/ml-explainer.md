# ML explainer — how the predictions work

What the app's "ML" is, what it is not, and how each number is produced, adjusted and judged
(model v1.7.0, deployed 2026-10-19; results as of the GW10 batch, 2026-11-09). Companion to [site-explainer.md](site-explainer.md); the method,
calibration history and backtests in full are in [phase-4-model.md](phase-4-model.md), and the
code is [`supabase/functions/_shared/xp-model.ts`](../supabase/functions/_shared/xp-model.ts).

## In one paragraph

There are **no neural networks and no gradient-trained models**. The xP engine is a hand-built
statistical model: per-90 rates blended from prior seasons, shrunk toward a fitted position × price
prior (empirical Bayes), converted to points through Poisson and negative-binomial tail probabilities
and FDR/venue multipliers. Since v1.7.0 there is no per-position level scalar: the component errors it
used to hide are fixed at source. One small logistic regression (start probability)
is the only fitted regression. Every parameter is a closed-form estimate from the history table, a
one-off fit gated on a backtest, or a fixed FPL rule. Everything else the app "predicts" is
derived client-side from xP.

## Pipeline

```
player_season_history (3 prior seasons)
  → weighted per-90 rates                    deriveRates / weightedOwnRates
  → shrink toward position × price prior     fitRatePriors, deriveRatesWithPrior
  → in-season start/minutes model (v1.6.0)   applyMinutesModel (logistic)
  → squad reconciliation                     11 starters, 990 minutes per club
  → predict() per player per fixture         start/cameo minute states, components × FDR/venue
                                             (positionCalibration = 1.0 since v1.7.0)
  → player_predictions (+ archive) → player_xp_horizons view (1/3/5/8/season)
```

`generate-predictions` runs on `5,35 * * * *`, a few minutes after `sync-bootstrap`, because an
availability flag flipping is the largest day-to-day input change. Predictions are keyed per
**fixture**, so double gameweeks sum naturally.

## Feature engineering

**Own rates.** Ten quantities per player: `xg90`, `xa90`, `bonus90`, `dc90`, `saves90`, `xgc90`,
`cs90`, `yellow90`, `mpg` (minutes per game), `start_share`.
- Seasons weighted by recency `[0.6, 0.3, 0.1]`; per-90 rates are minutes-weighted
  (Σ w·stat / Σ w·minutes × 90).
- `dc90` has its own minutes denominator, counting only seasons FPL tracked the stat (2024/25 on).
- If the last three seasons hold under 270 weighted minutes, older seasons join with a 0.5 decay.

**Prior (`fitRatePriors`).** A prior mean per metric × position × price band (six bands).
- `sigma2` = how much one player's rate moves between seasons (pooled per position).
- `tau2` = how much players genuinely differ, estimated **once per position** — estimating it per
  band collapsed to zero on thin cells and let the prior override evidence.
- Thin bands are themselves shrunk toward the position mean. The playing-time prior is not fitted
  on 450+ minute seasons (that would select for starters). Refit on every run from
  `player_season_history`, persisted to `rate_priors`.

**Shrinkage.** `w_prior = σ² / (n_eff·τ² + σ²)`, `posterior = w_prior·prior + (1−w_prior)·own`.
`n_eff` = weighted minutes / 90, uncapped. About 39% prior at 90 minutes, 18% at 270, under 3% at
2,000. Every player gets a number plus a statement of how much of it is prior (`reliability`
high / medium / low at prior weight <0.10 / >0.50).

**Promoted-club players** with no Premier League record use real 2025/26 Championship rates
times fitted translation factors (`xg90` ×0.20, `xa90` ×0.28, `yellow90` ×0.844; fitted on 12
players with both records; survivor bias disclosed, in the optimistic direction). `dc90` is not
translated — no fittable comparison exists.

**In-season minutes model (v1.6.0).** The only regression:

```
P(start) = logistic(-2.264 + 0.6188·priorStartShare + 1.3118·last5StartRate
                    + 1.4546·startedLastGame + 1.2601·last3StartRate + 0.0926·GK)
minutesPerGame = P·83.8 + (1−P)·6.31          (goalkeeper: 89.54 / 0.02)
```

Applies to players with ≥1,200 prior weighted minutes and ≥3 games played this season; everyone
else stays on the shrinkage path. It replaced a start probability with Brier 0.176 by one that
beats a plain last-5 rate (0.1475). Coefficients are the pooled fit from
`scripts/minutes-model-gate.ts`, judged by one fit per held-out season.

**Squad reconciliation.** Every club starts 11 (one a goalkeeper) and plays 990 minutes, but
per-player rates do not sum to that. An exact water-fill, `Σ min(ceiling_i, λ·p_i) = target`,
fixes it, with ceilings set by availability. v1.3.0 weights the correction by prior share so an
established starter moves less than a fringe player. Known cost: starters at deep squads can be
pulled down more than their record supports; disclosed in `COLD_START_MODEL_NOTE`. Since v1.7.0
minutes are split like starts, 90 for the keeper and 900 for the outfield, because pooling them in one
990 budget let a backup keeper absorb outfield minutes (keepers' expected minutes summed to 116.7
against 88.2 played).

## `predict()` — turning rates into points

Per player per fixture; every component is its own column.

| Component | How |
|---|---|
| Availability | `chance_of_playing / 100` scales expected minutes (not a trailing scalar) |
| Minute states | expected minutes split into a start state (P = start probability) and a cameo state (~18.7 min); threshold components (DC, saves, goals conceded) are averaged over the states, because half the chance of a full match is not the tail of half a match |
| Appearance | `p60 = startProb × 0.92`; P(appear) is the two states' total (not `minutes / 72`); long/short play points |
| Fixture multipliers | attack `(1+0.09·(3−FDR))×venue`, defence `(1+0.14·(3−FDR))×venue`; home/away 1.05/0.95 attack, 1.06/0.94 defence |
| Goals, assists | `rate × minuteShare × attackMult × points`; assists also × FPL assists per xA (DEF 1.27, MID 1.34, FWD 2.40, GKP 1) |
| Clean sheet | `min(cs90 × defMult, 0.85) × p60 × points` |
| Goals conceded, saves | `E[floor(X/2)]`, `E[floor(X/3)]` under Poisson, not `λ/d` |
| Defensive contribution | negative-binomial tail `P(X ≥ 10 DEF / 12 MID,FWD)` × 2 points (dispersion r = 20 DEF, 31 MID/FWD; fitted on 2025-26 only) |
| Bonus | `bonus90 × minuteShare × mean(attackMult, defMult)` |
| Cards | `yellow90 × minuteShare × points` |

The sum is used as is: `positionCalibration` was ×1.22–1.27 through v1.6.0 and is 1.0 from v1.7.0,
once the components it was compensating for were fixed ([sprints/sprint-43.md](sprints/sprint-43.md)).
Points values come from the `scoring_rules` table, never hardcoded. The `xp_lower`/`xp_upper` band re-runs `predict`
at ±1.28 posterior sd — a rate-uncertainty band, **not** a prediction interval (it ignores
match-to-match Poisson noise).

## Everything else that is "predicted"

Only xP is generated server-side. The rest is client-side, derived from xP:

| Output | Where | What it is |
|---|---|---|
| Risk 0–100 | `lib/scoring.ts` | rotation 0.30, injury 0.25, minutes uncertainty 0.20 (tent peaking at 45 min), fixture variance 0.15, renormalised over 0.90; converts to points via `riskPoints` (12 at risk 100) |
| Captain | `lib/lineup.ts` | `0.556·xP_norm + 0.222·fixture + 0.167·startProb + 0.056·penalty − 0.15·(1−availability)`; XI maximises plain Σ xP |
| Bench order | `lib/lineup.ts` | Poisson substitution probability over the ten outfield starters |
| Compare | `lib/scoring.ts` | xP 0.40, fixture 0.20, value 0.15, minutes 0.15, form 0.10 (form only on `/compare`) |
| Squad score | `lib/squad-score.ts` | everything converted to points-equivalent, then summed with the per-term breakdown |
| Transfers | `lib/transfer-optimizer.ts` | beam search, ≤3 moves, every basket scored through `simulateTransfers`; headline `+gain xP − hit − risk` |
| Chips | `lib/chips.ts`, `chip-plan.ts` | value = xP with chip − xP without, per gameweek |
| Hidden gems | `lib/hidden-gems.ts` | percentile filters on the live pool; "low"-reliability players excluded |
| Price watch | `lib/price-watch.ts` | **progress toward FPL's price threshold, not a prediction** — falls `3,577 + 31,870/1% owned` (R²=0.81), rises flat ~378k (R²=0.02); crossing is followed by a change only ~10% (falls) / ~22% (rises) of the time |
| Derived FDR | `lib/fdr-derived.ts` | team attack/defence from results; beat a neutral baseline in 4 seasons but **does not beat official FDR** on 2026-27 (GW10, n=2,116), so it stays display-only |

Where a formula needs a field FPL zeroes, the term is dropped, weights are renormalised and a
`*_NOTE` is shown beside the number. Missing quantities that cannot be dropped become documented,
user-set inputs (`decisionMargin`).

## How the model adapts to real performance

- **Adapts automatically (every ~30 min):** starts and minutes. `generate-predictions` reads
  this season's landed games from `player_gameweek_stats` (window = 10 gameweeks back, last 5
  games used), excluding the gameweek being predicted and any fixture where nobody has minutes yet
  (an unwritten fixture would read as 22 no-shows). `sync-player-history` runs every 10 minutes, so
  a dropped or newly nailed player moves in xP within roughly one run of the result landing.
- **Does not adapt:** the scoring rates (`xg90`, `xa90`, bonus, cs, dc). They come only from
  `player_season_history`, which FPL fills from completed seasons, so a striker's hot or cold
  streak does not move his xG rate this season. The current-season blend exists
  (`currentSeasonRow`, `currentSeasonScope`) but is **dormant**. Re-run at the GW10 batch, the
  `minutes` scope cleared all four seasons but added only 0.001–0.006 MAE on top of the minutes
  model already shipped, so it was not adopted ([sprints/gw10-check-in.md](sprints/gw10-check-in.md) §4).
- **Refit by hand, gated on a backtest, not on a schedule:** minutes coefficients
  (`scripts/minutes-model-gate.ts`), DC dispersion and assists-per-xA
  (`scripts/component-params-fit.ts`), price thresholds (`scripts/price-window-probe.ts`),
  Championship factors (one-shot). `positionCalibration` was refit three times (v1.0.0, 1.1.0, 1.4.0)
  and then retired: the GW5 check-in showed a −0.714 non-appearance cohort cancelling a +0.627
  appearance one, which a multiplicative factor cannot express, so v1.7.0 fixed the components instead.
- **Monitoring only:** `player_prediction_archive` keeps the last pre-deadline snapshot per
  gameweek; `lib/prediction-accuracy.ts` scores it against results (bias, MAE, Pearson r). It
  does not feed back into the model.

## How good is it

- **In-sample** (2025/26, weighted 0.6 in its own blend): MAE ≈ 0.41, r ≈ 0.83–0.85 per gameweek.
  This shows the points arithmetic is right, nothing more; bias → 0 is by construction.
- **Walk-forward harness, out-of-sample (v1.7.0):** MAE 2.20–2.35 and r 0.16–0.24 across the four
  target seasons, an improvement of 0.11–0.20 MAE on v1.6.0 in every season
  ([sprints/sprint-43.md](sprints/sprint-43.md) §5). The harness is the harsh comparison (neutral
  start inputs, no minutes model), and there it is still **worse than a last-5 baseline**: on 2026-27,
  MAE 2.303 / r 0.176 against 1.973 / 0.381.
- **Live, on the xP production actually emits (GW6–10, n=3,216):** a statistical tie with last-5
  pooled (MAE 1.237 vs 1.218, r 0.506 vs 0.502). The model is clearly better for outfield players who
  appear (MAE −0.153) and clearly worse on whether players play: no-shows (+0.122) and goalkeepers
  (+0.283). GW10 alone had the highest r on record, 0.543
  ([sprints/gw10-check-in.md](sprints/gw10-check-in.md) §1–3).
- **The accuracy-claims gate (DSI-186) was not met**, so the app makes no accuracy claim.
- Attempts to close the gap by adding a current-season blend, a bias correction or a narrower scope
  were gated on MAE, r and bias across all seasons and **did not ship**; the null results are the
  findings. The one gap that closed was found by scoring each component separately (v1.7.0).
- Sign convention: walk-forward bias is `mean(actual − predicted)`, so negative means the model
  predicts more than is scored. The §2 table in phase-4-model.md predates that and uses the
  opposite sign.

## System architecture

The "ML system" is a data pipeline plus a deterministic model, not a training platform. There is
no GPU, no model registry and no training cluster: the model is code, its parameters are constants
checked into the repo, and the only fitting that happens in production is closed-form aggregation
inside the prediction job. Fuller detail: [architecture.md](architecture.md),
[wiki/data-pipeline.md](wiki/data-pipeline.md).

```
FPL public API ─► Edge Functions (Deno, service role) ─► Postgres (RLS)
                        ▲  pg_cron + pg_net → invoke_sync            │ publishable key, read-only
                        │  (Vault-backed cron secret)                ▼
   RSS · Vaastav archive · Telegram          Next.js static export ─► Cloudflare Workers assets
                                             (optimiser / lineup / chips run in the browser)
```

### Data collection

| Source | Function (cron) | Lands in |
|---|---|---|
| `bootstrap-static` | `sync-bootstrap` (`*/30`) | `teams`, `players`, `gameweeks`, `element_types`, `game_settings`, `scoring_rules`, `chip_definitions`, snapshot tables |
| `fixtures` | `sync-fixtures` (`*/2`, self-gated; hourly floor) | `fixtures`, `fixture_changes` |
| `element-summary/{id}` | `sync-player-history` (`*/10`) | `player_gameweek_stats`, `player_season_history` |
| `event/{gw}/live` | `sync-live-gameweek` (`*/2`, gated on a live match) | `player_live_stats` |
| `entry/{id}` (+ history, picks, transfers) | `sync-claimed-managers` (`*/2`, claimed ∪ rivals) and on-demand `sync-manager` | `managers`, `manager_*` |
| League standings and picks | `sync-league-picks` (on demand) | `league_entries`, `league_entry_picks` |
| RSS headlines | `sync-news` | `news_items`, `news_item_entities` |
| Vaastav community archive | `ingest-fpl-archive` (manual backfill) | past-season `player_gameweek_stats` (2022-23 to 2025-26) |
| Championship PDFs | `scripts/extract-footystats.ts` (one-shot) | `external_player_seasons` |

Two properties matter for the model:
- **History is change-detected, not snapshotted.** `record_player_snapshots()` writes price,
  ownership, status and news rows only when something moved (~25k rows a season rather than ~7.8M).
  A bounded 2-hourly watchlist samples ownership for players near a price threshold, because a
  daily snapshot cannot reconstruct transfer velocity.
- **The model's training table is `player_season_history`**, filled from FPL's `history_past`
  (completed seasons only). In-season form reaches the model only through
  `player_gameweek_stats`, and only for the minutes model (see above).

### Data verification

There is no separate validation service. Correctness is enforced in layers:
- **At ingest.** `_shared/coerce.ts` normalises the FPL API's loose types (numbers as strings,
  `""`/`"None"` as null) before anything reaches Postgres. Writes are idempotent upserts on
  natural keys. Duplicate rows are de-duplicated before write (the archive repeats rearranged
  fixtures). Schema constraints reject bad shapes.
- **Landed-result guard.** A played fixture is not necessarily a *written* one, and an unwritten
  fixture reads `minutes = 0, starts = 0` for every player. The predictor and accuracy scoreboard
  count a fixture only once anyone in it has real minutes
  ([wiki/data-pipeline.md](wiki/data-pipeline.md#a-played-gameweek-is-not-a-written-one-found-2026-09-20)).
- **Row-cap discipline.** PostgREST returns at most 1,000 rows per response. Every large read pages
  with `.range()` on a unique `ORDER BY` (an unordered offset page repeated ~26% of rows in the
  backtest harness) and fires pages concurrently after a count. A reading that is uniformly null
  or zero is checked for row count before it is believed.
- **Model checks.** Backtests are gated on MAE, Pearson r and the *magnitude* of bias across all
  seasons; `scripts/backtest-walkforward.ts` prints an input fingerprint (row counts per reference
  table, per-season truth counts) so a divergent run is attributable; squad reconciliation is
  verified to hit its targets to ~1e-13; derived scoring breakdowns are reconciled against stored
  totals and any gap is shown as "Unattributed".
- **Access checks.** RLS policies are verified by simulating a second user and each role inside a
  rolled-back `execute_sql` transaction. `npx tsc --noEmit`, `npm run lint` and `npm run build`
  gate every commit (`.github/workflows/ci.yml` runs the same three).
- **Honest gaps.** There is no automated schema-drift detector on the FPL payloads and no
  data-quality alert beyond the health panel below. Engine changes are verified by hand in a
  throwaway `npx tsx` harness against live data (the `engine-verify` skill).

### Machine resource management

Compute is Supabase Edge Functions (Deno) and Postgres, plus the visitor's browser. There is no
training fleet to manage, so the resource work is about staying inside request limits and being a
polite client:
- **Time-budgeted, cursor-resumable jobs.** `sync-player-history` and `ingest-fpl-archive` stop at
  a 55 s budget and store their position in `sync_runs.cursor`, so ~700 `element-summary` calls
  spread over runs instead of timing out.
- **Bounded concurrency.** `mapLimit` caps parallel FPL calls (5 for player history, league picks
  and manager picks; 3 managers at once in `sync-claimed-managers`).
- **Polite, resilient fetching.** `fetchWithRetry`: 20 s timeout, 3 retries, 500 ms × 2ⁿ backoff on
  429/5xx, fail-fast on other 4xx; a courtesy `User-Agent` pointing at the live site.
- **Self-gating crons.** Short intervals are cheap because most invocations exit after one query:
  `sync-live-gameweek` and `sync-claimed-managers` act only while a fixture is live (shared
  `hasLiveFixture`); `sync-fixtures` gates on kickoff proximity with an hourly floor.
- **Cost bounding.** Cron-only functions require a secret that has no public copy
  (`verifyCron`); browser-invoked functions verify the JWT and are rate-limited per user from
  `sync_runs` (`game_settings.sync_rate_limit`, default 30 calls / 600 s; a counting failure allows
  the call).
- **Storage discipline.** Change-detected history, a bounded ownership watchlist, and
  `player_predictions` being deleted and rewritten per run (only the pre-deadline snapshot is kept,
  in `player_prediction_archive`).
- **Client-side compute.** The optimiser, lineup, chip and scenario engines run in the browser on
  data loaded through `lib/player-pool.ts` (concurrent paged reads), which keeps the backend load
  independent of how many people use the optimiser. The cost is page weight and settle time
  ([wiki/performance.md](wiki/performance.md)).

### Feature extraction

Feature extraction is the model itself, not a separate feature store: `generate-predictions` reads
the reference tables, history and this season's landed games, builds all ten rates, the priors, the
start-form features and the club squad context in one pass, and writes the result. The features
are not persisted as a reusable table; instead each `player_predictions` row carries the provenance
of its own number (`prior_weight`, `n_eff`, `reliability`, `prior_source`, `minutes_model`, the
input rates and the `xp_lower`/`xp_upper` band), and `rate_priors` holds the fitted priors, so a
projection can be explained after the fact as well as recomputed.

### Analysis tools

Offline analysis lives in `scripts/` and is run by hand with `npx tsx`, never in production:

| Script | Purpose |
|---|---|
| `backtest-walkforward.ts` | Walk-forward out-of-sample backtest; sweeps current-season blend weight/scope and the bias correction; prints an input fingerprint |
| `minutes-model-gate.ts` | Fits and gates the logistic start model, one fit per held-out season; prints the "SHIPPING FIT" |
| `fit-lambda.ts`, `match-and-gate.ts`, `extract-footystats.ts` | Championship → Premier League translation and its gate |
| `price-window-probe.ts`, `price-threshold-gate.ts`, `price-falls-walkforward.ts` | Measure and gate the price-change threshold |

Supporting tooling: Supabase MCP (migrations, `execute_sql`, advisors, logs), Linear as the
planning interface (`/linear-sync`, `/start-sprint`), the `graft` code graph for navigation, a
`post-commit` hook marking docs for wiki ingest, and project skills (`engine-verify`,
`verify-rls`, `ship-check`, `signed-in`, `responsive-check`). The rule: verify an engine change
against live data in a harness before trusting the UI, and keep the harness out of the commit.

### Process management

- **Scheduling.** `pg_cron` calls `public.invoke_sync(fn)`, which POSTs through `pg_net` with the
  service role and the Vault-held cron secret. Predictions run at `5,35 * * * *`, after
  `sync-bootstrap` (`*/30`), so an availability flip is in the next run; `notify` runs `*/15`.
- **Idempotence and re-entrancy.** Every sync is safe to repeat; cursors make long jobs resumable;
  a failed sync must not mark itself fresh (`managers.last_success_at` only moves on a complete
  run).
- **Audit trail.** Every execution writes a `sync_runs` row (`running`, then
  `success | partial | error | skipped | rejected`) with rows written, error, details and cursor.
  A refused cron call still leaves a row.
- **Model lifecycle.** Releases are code changes: bump `MODEL_VERSION`, write `prediction_models`
  (full parameter JSON), ship the Edge Function through the Supabase MCP integration. There is no
  automated retraining; refits are manual, scripted and backtest-gated.
- **Delivery.** Pushes to `main` trigger Cloudflare's Git build (`npm run build`, then
  `wrangler deploy`); GitHub Actions is a quality gate only.

### Configuration

- **Database-held settings.** `game_settings` (synced from bootstrap, plus keys such as
  `sync_rate_limit` and `price_watch_*_threshold`), `scoring_rules` (per-stat, per-position points),
  `chip_definitions`, and `SquadRules` loaded from `game_settings`. Nothing about squad size,
  budget, club limits or points values is hardcoded.
- **Model parameters.** `MODEL_PARAMS` and `MINUTES_MODEL` in `xp-model.ts`; each version's full
  set is also stored in `prediction_models`. `lib/price-watch.ts` thresholds are fitted defaults and
  overridable arguments.
- **Secrets.** Referenced by name only. The cron secret is generated inside Postgres and lives in
  Vault; `FPL_SESSION_ENC_KEY` is an Edge Function secret; Supabase keys are env vars; the two
  `NEXT_PUBLIC_*` values are Cloudflare **build** variables (baked in at build) and GitHub Secrets.
- **Deployment config.** `wrangler.jsonc` (static assets from `out/`), `next.config.ts`
  (`output: "export"`, `trailingSlash: true`, no `basePath`), `public/_headers` (CSP, immutable
  caching for hashed assets, revalidation for HTML), and `.nvmrc`.

### Monitoring

- **Pipeline tab** (`/settings` → Pipeline, formerly `/status`) renders `sync_runs`.
- **Sync health** (`lib/sync-health.ts`): lists tracked managers that have never completed a sync
  or are overdue (24 h), and recent failed runs. It is built never to be silently empty, because a
  blank panel looks identical to a broken one.
- **Prediction accuracy** (`lib/prediction-accuracy.ts`): archived pre-deadline predictions scored
  against landed results with bias, MAE and r, partial gameweeks labelled as such.
- **Alerts.** `notify` sends Telegram alerts (deadlines, injuries, price moves, fixture changes)
  from a deduplicated outbox; Cloudflare Web Analytics for visitors; Supabase logs and advisors for
  the backend.
- **Known weak spot.** The recurring failure class is *work that silently does not happen and
  renders as absence* (unpaged reads, rivals never re-synced, a failed sync marking itself fresh,
  cron calls dropped on a transient lookup error). Each fix added a way to see the failure; the
  open gap is that nothing alerts on a stale prediction run or an accuracy drift by itself.

### Serving infrastructure

- **Read path.** Browser → Postgres over the publishable key, read-only, under RLS
  (public-read for league data, `auth.uid() = user_id` for owner tables). There is no application
  server and no model endpoint: predictions are precomputed rows (`player_predictions`,
  `player_xp_horizons`) served as ordinary table reads, refreshed every 30 minutes.
- **Write path.** Only Edge Functions with the service role write league data. Three caller
  classes: cron-only (secret header), browser users (JWT plus per-user rate limit), and the
  Telegram webhook ([wiki/edge-function-security.md](wiki/edge-function-security.md)). CORS is
  limited to `fpldecision.com`, `www`, and `localhost:3000` as defence in depth only.
- **Front end.** A static Next.js export (`out/`) on Cloudflare Workers assets at
  `fpldecision.com` (apex custom domain; `www` 301-redirects to it), with a `workers.dev` fallback.
  Hashed assets are cached immutably for a year; HTML revalidates on every request.
- **What this means for latency and freshness.** Prediction freshness is bounded by the 30-minute
  job plus the 10-minute results sync; page speed is bounded by client-side loading and compute,
  not by a model service. There is no autoscaling concern because there is no model-serving tier,
  but Supabase quotas and the FPL API's tolerance are the real ceilings.
- **Access boundary.** Row Level Security is the only real access control; the site URL is public.

## Limits worth knowing

- Everything downstream (captain, chips, transfers, gems) inherits xP's error.
- Risk and captain weights come from the build plan, hand-set rather than fitted.
- With the scalar gone, the level shows through: v1.7.0 over-predicts goals and assists and
  under-predicts clean sheets on 2026-27 (GW8–10). It is tracked as a watch item (DSI-221), to be
  re-read around GW14 and acted on only if the same-sign gap persists.
- Official FDR is the fixture signal. At GW10 it beat both neutral FDR and the results-derived rating
  on 2026-27 (MAE 2.295 vs 2.310 and 2.303–2.306).
- `dc90` applies one aggregate count against two different FPL rules (CBIT vs CBIRT).
- The binding constraint is thin per-player data and a frozen season-long scoring rate, not model
  capacity, so a bigger model class is not the next step. The current-season blend for the
  minutes-scoped quantities was the candidate and has now been run: it adds nothing measurable on top
  of the minutes model.
