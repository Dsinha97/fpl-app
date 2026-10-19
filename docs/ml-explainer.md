# ML explainer — how the predictions work

What the app's "ML" is, what it is not, and how each number is produced, adjusted and judged
(model v1.6.0, 2026-10-19). Companion to [site-explainer.md](site-explainer.md); the method,
calibration history and backtests in full are in [phase-4-model.md](phase-4-model.md), and the
code is [`supabase/functions/_shared/xp-model.ts`](../supabase/functions/_shared/xp-model.ts).

## In one paragraph

There are **no neural networks and no gradient-trained models**. The xP engine is a hand-built
statistical model: per-90 rates blended from prior seasons, shrunk toward a fitted position × price
prior (empirical Bayes), converted to points through Poisson tail probabilities and FDR/venue
multipliers, then level-corrected per position. One small logistic regression (start probability)
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
  → predict() per player per fixture         Poisson components × FDR/venue
  → × positionCalibration
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
pulled down more than their record supports; disclosed in `COLD_START_MODEL_NOTE`.

## `predict()` — turning rates into points

Per player per fixture; every component is its own column.

| Component | How |
|---|---|
| Availability | `chance_of_playing / 100` scales expected minutes (not a trailing scalar) |
| Appearance | `p60 = startProb × 0.92`; `p(any) = minutes / 72`; long/short play points |
| Fixture multipliers | attack `(1+0.09·(3−FDR))×venue`, defence `(1+0.14·(3−FDR))×venue`; home/away 1.05/0.95 attack, 1.06/0.94 defence |
| Goals, assists | `rate × minuteShare × attackMult × points` |
| Clean sheet | `min(cs90 × defMult, 0.85) × p60 × points` |
| Goals conceded, saves | `E[floor(X/2)]`, `E[floor(X/3)]` under Poisson, not `λ/d` |
| Defensive contribution | Poisson tail `P(X ≥ 10 DEF / 12 MID,FWD)` × 2 points |
| Bonus | `bonus90 × minuteShare × mean(attackMult, defMult)` |
| Cards | `yellow90 × minuteShare × points` |

Sum × `positionCalibration` (GKP 1.265, DEF 1.2241, MID 1.2238, FWD 1.2576). Points values come
from the `scoring_rules` table, never hardcoded. The `xp_lower`/`xp_upper` band re-runs `predict`
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
| Derived FDR | `lib/fdr-derived.ts` | team attack/defence from results; beat a neutral baseline in 4 seasons, **not shipped** (untested vs official FDR; gate ~GW10 on 2026-27) |

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
  (`currentSeasonRow`, `currentSeasonScope`) but is **dormant**: it improved MAE and r in every
  season and failed the bias gate in 2024-25 and 2026-27. Re-run the sweep at 8–10 scored 2026-27
  gameweeks.
- **Refit by hand, gated on a backtest, not on a schedule:** `positionCalibration` (v1.0.0, 1.1.0,
  1.4.0), minutes coefficients (`scripts/minutes-model-gate.ts`), price thresholds
  (`scripts/price-window-probe.ts`), Championship factors (one-shot).
  [sprints/gw5-check-in.md](sprints/gw5-check-in.md) §2 advises against the planned GW10
  `positionCalibration` refit: live error is a −0.714 non-appearance cohort cancelling a +0.627
  appearance one, which a multiplicative factor cannot express.
- **Monitoring only:** `player_prediction_archive` keeps the last pre-deadline snapshot per
  gameweek; `lib/prediction-accuracy.ts` scores it against results (bias, MAE, Pearson r). It
  does not feed back into the model.

## How good is it

- **In-sample** (2025/26, weighted 0.6 in its own blend): MAE ≈ 0.41, r ≈ 0.83–0.85 per gameweek.
  This shows the points arithmetic is right, nothing more; bias → 0 is by construction.
- **Walk-forward, out-of-sample:** per-gameweek r ≈ 0.15–0.23 and MAE ≈ 2.3–2.5, **worse than a
  naive last-5-gameweeks baseline in every season** (r ≈ 0.34–0.37, MAE ≈ 2.04)
  ([sprints/sprint-17a.md](sprints/sprint-17a.md)).
- Every attempt to close that gap (current-season blend, bias correction, narrow scope) was gated
  on MAE, r and bias across all seasons and **did not ship**; the null results are the findings.
- Sign convention: walk-forward bias is `mean(actual − predicted)`, so negative means the model
  predicts more than is scored. The §2 table in phase-4-model.md predates that and uses the
  opposite sign.

## Limits worth knowing

- Everything downstream (captain, chips, transfers, gems) inherits xP's error.
- Risk and captain weights come from the build plan, hand-set rather than fitted.
- `positionCalibration` ×1.22–1.27 is large; it absorbs finishing above xG, penalties and
  over-dispersed counts.
- Official FDR is the fixture signal; the walk-forward harness pins FDR to 3, so that layer has
  never been exercised out of sample.
- `dc90` applies one aggregate count against two different FPL rules (CBIT vs CBIRT).
- Next step with the best evidence behind it: gate the current-season blend for the minutes-scoped
  quantities at GW10+, before any bigger model class — the binding constraint is thin per-player
  data and a frozen season-long scoring rate, not model capacity.
