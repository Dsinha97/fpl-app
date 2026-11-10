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
  (see §6).

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

## 6. Not done

- No model change, no deploy, no refit. `scope=minutes` is the only candidate, and it needs the DSI-185 overlap
  question answered first.
- The Sprint 43 integrity table and the component-residuals pooling for GW10 were not re-run.
- DSI-219 was not closed; that is the owner's decision.
