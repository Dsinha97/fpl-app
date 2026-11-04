# GW9 check-in — the second live read of v1.7.0

**Run 2026-11-03.** `gameweeks.finished` and `data_checked` were both `true` for GW8 and GW9 (GW10 `false`),
and the join is restricted to `fixtures.finished = true`. Same join as [gw6-check-in.md](gw6-check-in.md) §1 and
[gw8-check-in.md](gw8-check-in.md): `player_prediction_archive` to `player_gameweek_stats` on
`(season, player_code, fixture)`, 2026-27, run as SQL against the live project. Bias is actual − predicted
(negative = over-predicted). GW6–8 reproduce the GW8 check-in exactly, so the join is unchanged.

## 1. The scoreboard, GW6–9 (locked data)

| GW | model | n | bias | MAE | r | no-show bias (n) | played bias (n) | mean xP / realised |
|---|---|---|---|---|---|---|---|---|
| 6 | v1.5.0 | 667 | −0.091 | 1.300 | 0.463 | −0.637 (352) | +0.520 (315) | 1.439 / 1.348 |
| 7 | v1.6.0 | 667 | −0.132 | 1.259 | 0.518 | −0.631 (363) | +0.465 (304) | 1.458 / 1.327 |
| 8 | v1.7.0 | 668 | +0.084 | 1.280 | 0.485 | −0.615 (365) | +0.926 (303) | 1.305 / 1.389 |
| **9** | **v1.7.0** | **669** | **+0.020** | **1.151** | **0.523** | **−0.574 (359)** | **+0.708 (310)** | **1.292 / 1.312** |

- **GW9 is the best week on record for MAE (1.151) and the highest r (0.523)** since GW7's 0.518. One week.
- **The bias came back toward zero** (+0.084 to +0.020). The played-cohort bias fell from +0.926 to +0.708,
  still above the pre-v1.7.0 range (+0.465 to +0.520) but below GW8's record. The no-show over-prediction
  shrank slightly (−0.615 to −0.574).
- **v1.7.0's mean level is stable.** 1.305 then 1.292, against 1.439 and 1.458 under v1.5.0/v1.6.0. The drop is
  `positionCalibration` going to 1.0, as designed; GW9 shows it was not a one-week effect.
- **GW8's +0.084 was mostly the week.** Realised points fell back (1.389 to 1.312) while the prediction level
  held, which is the reverse of GW8's mechanism. Two weeks of v1.7.0 average +0.052 bias (pooled n=1,337,
  MAE 1.216, r 0.503, Spearman 0.639).

## 2. Last-5 baseline on the same rows

Same method as [gw8-check-in.md](gw8-check-in.md) §2: the archived `xp` against a mean of a player's previous
five 2026-27 rows (by event, then fixture) on identical rows, requiring five.

**A. Last five rows of any minutes** (zeros included):

| GW | model | n | model bias / MAE / r | last-5 bias / MAE / r |
|---|---|---|---|---|
| 6 | v1.5.0 | 610 | −0.046 / 1.285 / 0.473 | −0.091 / 1.276 / 0.468 |
| 7 | v1.6.0 | 626 | −0.091 / 1.271 / 0.518 | −0.043 / 1.257 / 0.498 |
| 8 | v1.7.0 | 654 | +0.107 / 1.286 / 0.486 | +0.019 / 1.308 / 0.446 |
| **9** | **v1.7.0** | **659** | **+0.036 / 1.153 / 0.523** | **−0.063 / 1.100 / 0.566** |

**B. Last five *played* rows** (minutes > 0), players with five prior played rows only:

| GW | model | n | model bias / MAE / r | last-5 bias / MAE / r |
|---|---|---|---|---|
| 6 | v1.5.0 | 181 | +0.422 / 2.179 / 0.209 | −0.769 / 2.603 / 0.178 |
| 7 | v1.6.0 | 236 | +0.183 / 2.204 / 0.310 | −0.407 / 2.549 / 0.169 |
| 8 | v1.7.0 | 270 | +0.658 / 2.163 / 0.288 | −0.377 / 2.593 / 0.121 |
| **9** | **v1.7.0** | **294** | **+0.410 / 1.801 / 0.331** | **−0.669 / 2.103 / 0.349** |

- **A: GW9 is the first week the baseline wins both metrics.** Last-5 leads on MAE by 0.053 (1.100 vs 1.153)
  and on r by 0.043 (0.566 vs 0.523). Over GW6–9 the model has now won MAE in one week of four and r in three
  of four. Still no standard errors, one gameweek per row.
- **B: the model still wins MAE (by 0.30, the widest gap in four weeks) but loses r for the first time**
  (0.331 vs 0.349). Arm B's lead is therefore less consistent than the GW8 note said: it held on MAE every
  week and on r in GW6–8 only.
- **GW9 was an easy week for a naive rule.** MAE fell for both arms, the model's by 0.13 and last-5's by
  0.21 in arm A. A week in which form predicts well favours the baseline.
- **Not the DSI-186 gate.** That is the GW10 batch (~2026-11-09), pooled and per cohort with standard errors.
  Nothing here is an accuracy claim, and a model that only ties a last-5 mean in arm A is the reason that gate
  exists.

## 3. What drove the GW9 bias

`scripts/component-residuals.ts` pools v1.7.0's GW8 and GW9 (n=1,337), so GW9 alone is derived by
subtracting the GW8 check-in's per-week figures from the pooled ones. **Treat each as ±0.002** (rounding
amplified by the subtraction). Mean predicted / realised per player-fixture:

| component | GW9 predicted / realised | gap | GW8 gap |
|---|---|---|---|
| clean sheet | 0.176 / 0.256 | **+0.080** | +0.116 |
| goals | 0.187 / 0.133 | **−0.054** | −0.068 |
| assists | 0.106 / 0.082 | −0.024 | −0.030 |
| appearance | 0.733 / 0.772 | +0.039 | +0.035 |
| goals conceded | −0.061 / −0.051 | +0.010 | +0.016 |
| defensive contribution | 0.101 / 0.099 | −0.002 | +0.026 |
| bonus, saves | within 0.003 | ~0 | ~0 |

- **GW9 repeats GW8's pattern at lower amplitude:** 7 clean-sheet sides of 20 (rate 0.35) and 2.10 goals per
  fixture, against 8 and 1.90 in GW8. The clean sheet is under-predicted and goals/assists over-predicted,
  the same signature of a low-scoring week.
- **Two consecutive such weeks is worth recording.** Over GW2–9 the clean-sheet rate is 0.10 to 0.40 and goals
  per fixture 1.90 to 3.60, so GW8–9 sit at the low end of goals without being outside the range. Still not
  testable as a standing bias from eight weeks of 10 fixtures; `p60` and the goals rates were not touched.
- **The defensive-contribution gap closed** (+0.026 to −0.002). That is the term v1.7.0 was built to fix,
  and it is now level over the two weeks (pooled 0.102 / 0.114). One of the three Sprint 43 targets
  reading right on a second week is mild evidence, not a result.
- **Pooled v1.7.0 replay on its own inputs reads +0.009** (live +0.052; MAE 1.233, r 0.501), so the shipped
  output and `predict()` still agree. GW8's replay was +0.041, so this is the replay level moving toward zero
  with the week, not a deploy fault.
- **P(appear) buckets** (GW8–9 pooled): 0.2–0.4 still under-predicts appearances (0.292 / 0.493), 0.8–1.0
  over-predicts (0.975 / 0.911). Unchanged from GW8; the minutes cohort split is the DSI-185/216 line.

## 4. Was it FDR?

Bias by archived `fdr`, GW9 (n): FDR 2 −0.004 (186), FDR 3 −0.081 (312), FDR 4 +0.051 (134), FDR 5 **+0.877
(37)**. FDR 2–4 are inside ±0.1. FDR 5 is thin (37 rows) and in GW8 went the other way (−0.482 on 25), so it
is noise. There is no FDR signature; the GW8 conclusion stands. The derived-vs-official preview was **not
re-run**: nothing in GW9 bears on it and DSI-52's gate is GW10.

## 5. Not done

- **The Sprint 43 integrity table was not re-run** on the latest `player_predictions` run.
- **GW9 alone was not run through `component-residuals.ts`** (it takes a season, not a gameweek), hence §3's
  derivation by subtraction. Adding a gameweek argument would remove the rounding.
- **No refit, no parameter change.** Two weeks of v1.7.0 do not separate a +0.02 to +0.08 offset from zero.
- **DSI-219 stays In Progress.** Its verification is the GW10 batch's sample, not this week.
- DSI-51/52/54/186 and the GW10 batch are untouched and stay at ~2026-11-09.
