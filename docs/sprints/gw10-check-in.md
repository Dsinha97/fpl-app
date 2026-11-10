# GW10 check-in — the GW10 model batch (DSI-51, DSI-52, DSI-186)

**Run 2026-11-09.** `gameweeks.finished` and `data_checked` both `true` for GW10 (GW11 `false`); GW10 has 10 of 10
fixtures finished. Scoreboard join and last-5 arms are the same SQL as [gw9-check-in.md](gw9-check-in.md) §1–2 and
reproduce GW6–9 exactly. Harness: `npx tsx --env-file=.env.local scripts/backtest-walkforward.ts`, now with a
derived-vs-**official** arm (§5). Bias is actual − predicted.

## 1. The scoreboard, GW8–10 (v1.7.0)

| GW | n | bias | MAE | r | no-show bias (n) | played bias | mean xP / realised |
|---|---|---|---|---|---|---|---|
| 8 | 668 | +0.084 | 1.280 | 0.485 | −0.615 (365) | +0.926 | 1.305 / 1.389 |
| 9 | 669 | +0.020 | 1.151 | 0.523 | −0.574 (359) | +0.708 | 1.292 / 1.312 |
| **10** | **670** | **+0.067** | **1.196** | **0.543** | **−0.533 (357)** | **+0.752** | **1.300 / 1.367** |

- **GW10 has the highest r on record (0.543).** MAE 1.196 is second best. Three weeks of v1.7.0 sit in a stable
  band: mean xP 1.29–1.31, bias +0.02 to +0.08.
- **Realised points were a little above prediction again** (1.367 vs 1.300); the played-cohort over-prediction
  (+0.752) is unchanged in kind. The no-show over-prediction keeps shrinking (−0.615, −0.574, −0.533).
- **DSI-219's verification sample is now three weeks.** Nothing here is a fault; its closure is the owner's call
  (see §6 for the version comparison, §8 for GW10 by cohort, §9 for what is open).

## 2. Last-5 baseline on the same rows

| GW | arm | n | model bias / MAE / r | last-5 bias / MAE / r |
|---|---|---|---|---|
| 9 | A | 659 | +0.036 / 1.153 / 0.523 | −0.063 / 1.100 / 0.566 |
| **10** | **A** | **667** | **+0.074 / 1.196 / 0.543** | **+0.007 / 1.155 / 0.538** |
| 9 | B | 294 | +0.410 / 1.801 / 0.331 | −0.669 / 2.103 / 0.349 |
| **10** | **B** | **323** | **+0.518 / 1.920 / 0.366** | **−0.403 / 2.224 / 0.289** |

(A = last five rows of any minutes; B = last five *played* rows, players with five. GW6–8 as in the GW9 check-in.)

- **A:** last-5 wins MAE again (1.155 vs 1.196) but the model edges r (0.543 vs 0.538). Over GW6–10 last-5 has won
  MAE in 4 of 5 weeks and the model r in 3 of 5.
- **B:** the model wins both metrics in GW10, and has won MAE in all five weeks.

## 3. DSI-186 — the accuracy-claims gate: **not met**

Pooled GW6–10, arm A (n=3,216), paired per-row |error| difference (model − last-5; positive = model worse).
**SEs treat rows as independent; the same player recurs across weeks, so they are optimistic.**

| cohort | n | model MAE / r | last-5 MAE / r | ΔMAE ± SE |
|---|---|---|---|---|
| **pooled** | 3,216 | 1.237 / 0.506 | 1.218 / 0.502 | +0.019 ± 0.021 |
| outfield, appeared | 1,406 | 1.970 / 0.254 | 2.123 / 0.258 | **−0.153 ± 0.037** |
| outfield, no-show | 1,458 | 0.587 / n/a | 0.464 / n/a | **+0.122 ± 0.028** |
| GKP, appeared | 101 | 2.253 / 0.002 | 2.321 / 0.194 | −0.068 ± 0.161 |
| GKP, no-show | 251 | 0.504 / n/a | 0.079 / n/a | **+0.425 ± 0.040** |
| GKP, all | 352 | 1.006 / 0.589 | 0.722 / 0.687 | **+0.283 ± 0.056** |

- **The gate requires winning MAE and r, pooled and per cohort including GKP.** Pooled is a statistical tie
  (MAE and r within noise). The model clearly wins MAE on outfield players who appear, and clearly loses on
  no-shows (a last-5 mean of zeros is nearly right for a player who is not playing) and on goalkeepers overall.
- That is the same shape as GW5: the model's value is in what a player does *given* they play; its cost is in
  *whether* they play. DSI-186 stays Backlog and blocked. No accuracy claim is supported.
- The in-harness walk-forward on 2026-27 (cohort ≥1,200 prior weighted minutes, n=1,173 matched rows) says the
  same, more strongly: model MAE 2.303 / r 0.176 vs last-5 1.973 / r 0.381. That harness scores per-fixture
  rates with neutral FDR and no minutes model, so it is the harsher comparison; the archived-xP arm above is the
  one production actually emits.

## 4. DSI-51 — current-season blend sweep (no bias correction)

| scope | wCur 0.3 | 0.6 | 1.0 |
|---|---|---|---|
| `all` | 3/4 seasons | 3/4 | 3/4 |
| `minutes` | **4/4** | **4/4** | **4/4** |

- **`scope=minutes` now clears all four seasons at every weight**; it was 2/4 before. 2026-27 (n=2,113) at
  wCur=1.0: MAE 2.237, r 0.286 against prior-only 2.313 / 0.210. `scope=all` fails one season.
- The harness labels these SHIPPABLE. **Nothing was shipped.** The harness predates v1.6.0's in-season minutes
  estimator (DSI-185), which already blends current-season minutes in production; whether the harness's `minutes`
  scope adds anything on top of it is untested. That needs its own decision, not a flag flip.
- **Follow-up, same day: does the `minutes` blend add anything on top of DSI-185's minutes model?** No, not
  in any amount that matters. New harness arm (`scripts/backtest-walkforward.ts`): prior-only rates plus
  `applyMinutesModel` (the production layering), against the same with the `minutes`-scope blend underneath.

  | season | minutes model applied to | prior-only + model MAE / r | + minutes blend (w=1.0) MAE / r |
  |---|---|---|---|
  | 2023-24 | 4,158 of 4,396 rows | 1.939 / 0.413 | 1.938 / 0.413 |
  | 2024-25 | 5,457 of 5,769 | 1.943 / 0.407 | 1.942 / 0.408 |
  | 2025-26 | 6,452 of 6,826 | 2.007 / 0.379 | 2.006 / 0.380 |
  | 2026-27 | 1,643 of 2,113 | 1.990 / 0.414 | 1.984 / 0.419 |

  The gate technically reads "adds" everywhere, but by 0.001–0.006 MAE and ≤0.005 r. **The 4/4 was measuring
  the thing DSI-185 already shipped**: the minutes model covers 78–95% of the rows and overrides the two fields
  the `minutes` scope touches. Verdict: do not ship the `minutes` blend. (The minutes model alone takes 2026-27
  MAE from 2.313 to 1.990 in this harness, but its coefficients are the pooled fit over all four seasons
  including the one scored, so that is an in-sample figure; the model's own per-season gate is
  `scripts/minutes-model-gate.ts`.)
- The bias-correction sweep still finds no scope/weight that clears 4/4 — do not ship.
- `positionCalibration` arms: unit factors (production) vs leave-one-season-out. On 2026-27 loso lowers MAE
  (2.326 to 2.278) and bias, r unchanged. Not a gate; recorded.

## 5. DSI-52 — derived vs **official** FDR on 2026-27: **official wins**

New arm in `scripts/backtest-walkforward.ts` (official `team_h/a_difficulty` from `fixtures`, same `predict()`
call, only `fdr` differs), same 2,116 rows:

| arm | bias | MAE | r |
|---|---|---|---|
| neutral (fdr=3) | −0.307 | 2.310 | 0.218 |
| **official** | −0.296 | **2.295** | **0.236** |
| derived, priorGames=2 | −0.295 | 2.303 | 0.219 |
| derived, priorGames=4 | −0.299 | 2.306 | 0.216 |
| derived, priorGames=8 | −0.292 | 2.304 | 0.216 |

- **Derived does not beat official at any `priorGames`** (MAE and r both worse). Official beats neutral by more
  than derived does. Derived-vs-neutral still reads as in Sprint 35 (`priorGames=2` clears 4/4 seasons; 4 and 8
  clear 3/4), but that is not the gate that matters. **Keep FPL's official FDR; derived FDR stays display-only.**
- `priorGames` was not tuned.
- On 2026-27 the shuffled control at `priorGames=4` (MAE 2.297, r 0.224) is better than derived (2.306 / 0.216), so
  the within-season signal on this thin season is weak; the earlier seasons carry the case.

## 6. v1.7.0 against older versions

`scripts/component-residuals.ts 2026-27` scores each archived gameweek by the version that was live
(`player_prediction_archive`), then **replays** v1.7.0's rules on the older versions' own archived inputs, so the
same rows are compared across versions and the week's difficulty drops out.

As shipped (different weeks, so not like-for-like):

| version | GWs | n | bias | MAE | r | Spearman |
|---|---|---|---|---|---|---|
| v1.5.0 | 2–6 | 3,254 | −0.082 | 1.348 | 0.488 | 0.623 |
| v1.6.0 | 7 | 667 | −0.132 | 1.259 | 0.518 | 0.628 |
| **v1.7.0** | **8–10** | **2,007** | **+0.057** | **1.209** | **0.517** | **0.652** |

Same rows (v1.7.0 rules replayed on the older inputs):

| rows | as shipped bias / MAE / r | v1.7.0 replay bias / MAE / r |
|---|---|---|
| GW2–6 (v1.5.0 inputs, n=3,254) | −0.082 / 1.348 / 0.488 | +0.103 / **1.281** / 0.493 |
| GW7 (v1.6.0 inputs, n=667) | −0.132 / 1.259 / 0.518 | +0.045 / **1.205** / 0.510 |
| GW8–10 (v1.7.0 inputs, n=2,007) | +0.057 / 1.209 / 0.517 | +0.014 / 1.225 / 0.516 |

- **v1.7.0 is better on MAE on identical rows (−0.067 vs v1.5.0, −0.054 vs v1.6.0) and about level on r**
  (+0.005 vs v1.5.0, −0.008 vs v1.6.0). It is an accuracy-in-level gain, not a ranking gain. Spearman is the
  highest shipped (0.652), by 0.03.
- **Bias flipped sign.** Older versions under-predicted by 0.08–0.13 on realised points; v1.7.0 over-predicts
  by 0.01–0.10 on the same rows. `positionCalibration` going to 1.0 removed a ×1.22–1.27 inflation that
  happened to net against missing components; the correction overshoots slightly. On the same GW2–6 rows
  |bias| is no better (−0.082 shipped vs +0.103 replayed), so v1.7.0 trades an under-prediction for a mild
  over-prediction rather than reducing the bias; the MAE gain is the real one.
- **Components, as shipped, v1.5.0 → v1.7.0** (predicted / realised, all positions): defensive contribution
  0.029 / 0.107 → 0.101 / 0.116 (fixed); appearance 0.730 / 0.790 → 0.733 / 0.771; goals 0.186 / 0.212 →
  0.187 / 0.152 and assists 0.077 / 0.124 → 0.107 / 0.085 (both now **over**-predicted, as the GW9 check-in
  found); clean sheet 0.184 / 0.209 → 0.179 / 0.250 (under-predicted more, a low-scoring GW8–10).
  Goalkeeper appearance 0.705 / 0.559 → 0.561 / 0.543 (fixed).
- **P(appear) calibration**: 0.2–0.4 bucket still under-predicts appearances (0.292 / 0.486); the 0.8–1.0
  bucket now reads 0.974 / 0.926 on points 3.209 / 3.412.
- **Caveats.** The versions ran on different weeks and different amounts of data (v1.5.0 on GW2–6 includes the
  cold-start weeks; v1.6.0 is one gameweek). The replay reconstructs some inputs approximately (its header says
  so): its v1.7.0-on-v1.7.0 row differs from the shipped row (assists 0.154 vs 0.107, saves 0.032 vs 0.019,
  goals conceded −0.078 vs −0.060), so a replay's component lines are indicative only and its pooled bias
  (+0.014 vs +0.057 shipped) is a replay level, not a deploy fault. No standard errors.
- **The earlier walk-forward result still stands**: MAE, r and |bias| better than v1.6.0 in 4 of 4 seasons
  ([sprint-43.md](sprint-43.md)).

## 7. Sprint 43 deploy-time checks, re-run 2026-11-10

On the live `player_predictions` (18,816 rows, 672 players, events 11–38, all `v1.7.0`):

| Check | Result |
|---|---|
| `model_version` | `v1.7.0` on every row |
| `appearance_probability` | 0 null, 0 outside 0–1, 0 below `start_probability` (18,816 rows) |
| Keeper expected minutes per club fixture | **89.9–90.1** (560 club-fixtures) |
| Outfield minutes per club fixture | 899.8–900.2 |
| Start sums | keepers 1.000–1.001, outfield 9.998–10.003 |
| `squad_consistency_violations` | **0** on the last three `generate-predictions` runs (v22 had 9) |
| `prediction_models.params` for v1.7.0 | matches local `MODEL_PARAMS` key for key |

All hold. `computed_at` reads 2026-11-08 19:05 while runs keep succeeding every 30 minutes; that is the "write only
changed rows" change (`2a3b50b`), not a stalled job.

## 8. GW10 alone, by cohort

`scripts/component-residuals.ts` now takes a gameweek (`2026-27 10`) and `--cohort`, so GW10 is read directly
rather than derived by subtraction (it reproduces §1 exactly: n=670, bias +0.067, MAE 1.196, r 0.543). Mean
predicted / realised points per player-fixture, as shipped:

| component | all (670) | played (313) | no-show (357) |
|---|---|---|---|
| appearance | 0.732 / 0.772 | 1.182 / 1.652 | 0.337 / 0.000 |
| goals | 0.186 / 0.203 | 0.335 / 0.435 | 0.055 / 0 |
| clean sheet | 0.181 / 0.199 | 0.305 / 0.425 | 0.073 / 0 |
| defensive contribution | 0.099 / 0.119 | 0.163 / 0.256 | 0.043 / 0 |
| assists | 0.107 / 0.099 | 0.189 / 0.211 | 0.035 / 0 |
| bonus | 0.094 / 0.096 | 0.163 / 0.204 | 0.033 / 0 |
| **total bias** | **+0.067** | **+0.752** | **−0.533** |

- **Of the played cohort's +0.752, appearance is 0.47 (62%)**, then clean sheet 0.12, goals 0.10, defensive
  contribution 0.09, bonus 0.04. These are the components that scale with minutes, which is exactly what a
  forecast that spreads a player's probability over "plays" and "doesn't" must get wrong in each cohort.
- **This split is by realised outcome, so it is opposite-signed by construction** (the no-show cohort is a flat
  −0.533 from a 0.337 appearance forecast plus the rest). It locates the error; it does not say the model is
  biased. The pooled +0.067 is the number that carries information, and GW10 shows assists and goals on the
  pooled line near level (0.107/0.099, 0.186/0.203), unlike the three-week pool in §6.
- GW10 alone corrects the GW9 check-in's by-subtraction derivation only in method; its figures are not redone.
- The replay's cohort lines show the same split with its approximations (assists 0.274 vs 0.189 shipped on the
  played cohort), so use the shipped lines.

## 9. Not done

- No model change, no deploy, no refit.
- The cohort split is by realised minutes only, not by position or by predicted P(appear) bucket.
- DSI-219 was closed on this evidence on 2026-11-09 (see `docs/linear.md`).
