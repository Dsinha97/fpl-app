# DSI-185 — the expected-minutes model: gated, ported, deployed (v1.6.0)

**Run 2026-10-13.** Linear [DSI-185](https://linear.app/dsinha-org/issue/DSI-185) (M8), In Progress.
The estimator is **ported into `xp-model.ts` (v1.6.0) and `generate-predictions` and deployed** (function v22,
2026-10-13). The amended gate (§4) passes four of its five criteria and fails one (G4, by 0.0010 in 2023-24); the
owner reviewed that and instructed the deploy, so it shipped with the miss on the record rather than the gate
being loosened.

Harness: [`scripts/minutes-model-gate.ts`](../../scripts/minutes-model-gate.ts) — read-only against the
live DB, deterministic.

## 1. Two corrections to how the problem was framed

**The appeared/no-show bias split is mechanical, not a finding.** Minutes are bimodal. For a *perfect*
expectation, `E[actual − pred | appeared] > 0` and `E[actual − pred | no-show] < 0` by construction —
players who play are, on average, above the mean, and players who don't are below it. So "−0.714 / +0.627,
five weeks running" ([gw6-check-in.md](gw6-check-in.md) §1) shows the model *has* a spread, not that it
has a defect. A less-shrunk predictor looks better on that split purely for being closer to 0/90.
`byAppearance` stays in the harness; it can no longer be the gate on its own.

**`startBrier` was scored against the wrong outcome.** `brierScore` in `backtest-walkforward.ts`
compares `startProbability` (P(*start*)) with `minutes > 0` (*appeared*, which includes bench cameos),
and its "0.25 = coin flip" reference is wrong for a ~58%/34% event. The comparison below scores start
probability against `starts`, and reports climatology as the reference.

The real failure is still real — it is just visible in the right metrics (§2).

## 2. Results

Cohort: the walk-forward harness's (≥1200 weighted prior-season minutes), rows with ≥3 prior gameweeks
in-season. Every fit is leave-one-season-out. Brier / RMSE lower is better.

**Pooled, four seasons (n = 16,770):**

| estimator | start Brier | appear Brier | minutes RMSE | GKP start Brier |
|---|---|---|---|---|
| prior-only | 0.2492 | 0.2490 | 40.58 | 0.1718 |
| last-5 (standing baseline) | 0.1575 | 0.1358 | 30.90 | 0.0748 |
| shrunk blend | 0.1501 | 0.1484 | 30.21 | 0.0723 |
| **logistic, 6 features** | **0.1345** | 0.1371 | **29.62** | **0.0584** |

The logistic estimator beats last-5 on start Brier in **4 of 4 seasons** (0.1218 vs 0.1458, 0.1371 vs
0.1553, 0.1419 vs 0.1681, 0.1227 vs 0.1475) and on GKP start Brier in 4 of 4. Climatology is ~0.244.
Calibration out of sample is close but not exact: predicted vs actual start rate by decile runs 0.113/0.096,
0.134/0.112, 0.182/0.208, 0.383/0.407, 0.646/0.673, 0.823/0.806, then 0.875–0.915 against 0.872–0.911 —
several mid-deciles are 2–3 points off, and the first draft of this document called that "well calibrated". It
is not, strictly; §4 is where that matters.

**2026-27 rows matched to the shipped archive (n = 703), the incumbent:**

| | start Brier | appear Brier | minutes RMSE | GKP start Brier |
|---|---|---|---|---|
| **production (shipped)** | 0.1760 | **0.1149** | 32.52 | 0.1004 |
| last-5 | 0.1475 | 0.1444 | 29.16 | 0.0497 |
| logistic | **0.1227** | 0.1389 | **27.50** | **0.0433** |

So the shipped model's start probability is worse than the player's own last-five starts rate — a real
discrimination failure — and the goalkeeper bias looks like the same failure (start Brier 0.1004 → 0.0433)
rather than a saves/clean-sheet term. (Last-5 is marginally ahead of the logistic on pooled *appear*
Brier, 0.1358 vs 0.1371; the logistic is not claimed to win that one.)

**Where the incumbent wins, disclosed:** production's *appearance* Brier is better (0.1149 vs 0.1389).
It carries FPL's availability flags (`status`, `chance_of_playing`), which are not stored historically
and so are absent from every estimator here. A fix must keep that term: start probability from the
estimator, availability applied on top, as `predict()` already structures it.

**Where the logistic loses, disclosed:** minutes **MAE** (22.5 vs 19.8 for last-5) and the cohort
biases (appeared +11.6 vs +8.9; no-show −27.4 vs −23.0). MAE rewards the median and these biases
reward overconfidence (§1); neither is what an expected-points model should optimise. They are
reported because the issue's gate named them.

## 3. Features and limits

The six features: prior-season start share, last-5 start rate, last start, last-3 start rate, a goalkeeper
flag, intercept. No gradient-boosting was needed — the simpler model wins on the data we have.

- Cohort-restricted, so it says nothing about cold-start players.
- Prior-season terms come from `deriveRates`, i.e. without the production prior-shrinkage layer.
- One fit per held-out season on the other three — not strictly forward-chaining, with six parameters.
- 2026-27 is 703 rows (GW4–6); its read agrees with the three settled seasons but is not independent
  evidence of its own.

## 4. The amended gate, and its verdict

Amended on 2026-10-13 at the owner's instruction. The original criterion (per-cohort bias/MAE against
last-5) is replaced because it is mechanically unfavourable to any calibrated mean predictor (§1); in its
place, proper scoring rules, each required **in every season**, nothing narrowed:

| | criterion | result |
|---|---|---|
| G1 | start Brier beats last-5, 4 of 4 seasons | **PASS** (0.1218/0.1371/0.1419/0.1227 vs 0.1458/0.1553/0.1681/0.1475) |
| G2 | GKP start Brier beats last-5, 4 of 4 | **PASS** (0.0549/0.0606/0.0608/0.0433 vs 0.0667/0.0808/0.0782/0.0497) |
| G3 | minutes RMSE (two-part) beats last-5, 4 of 4 | **PASS** (29.02/29.72/30.09/27.58 vs 30.26/30.61/31.72/29.16) |
| G4 | calibration-in-the-large within 2 SE, 4 of 4 | **FAIL** — 2023-24: −0.0163 vs a 0.0153 limit; the other three are inside |
| G5 | beats the shipped archive on 2026-27 start Brier | **PASS** (0.1227 vs 0.1760, n=703) |

**G4 is a miss by 0.0010 in one season, and the criterion is the amended gate's own.** It was written before
the result was known, so it is not loosened here. What the number means: in 2023-24 the leave-one-season-out
fit over-predicts the start rate by 1.6 points (that season started 57.7% of the time, the others ~58–60%) —
a season-level drift the features cannot see. It is small beside a Brier gain of ~0.02, and the 2 SE limit
treats rows as independent when the same players repeat across rows, so it is anti-conservative; a
player-clustered SE would be wider (not computed here, so no claim is made that it would pass). Both are reasons to *discuss* G4, not to quietly change
it after seeing a fail.

## 5. What was ported

`MINUTES_MODEL`, `inSeasonStartForm` and `applyMinutesModel` in `supabase/functions/_shared/xp-model.ts`;
`MODEL_VERSION` v1.5.0 → **v1.6.0**. In `generate-predictions` pass 1, between `deriveRatesWithPrior` and the
squad reconciliation:

- **Population:** ≥1,200 weighted prior minutes *and* ≥3 games this season (what the gate scored). 235 of 667
  players today; everyone else stays on the old path unchanged.
- **Inputs:** `deriveRates` start share (the feature the coefficients were fitted on — not the shrunk
  rate), and the last ≤5 games from `player_gameweek_stats`, restricted to gameweeks **before** the one
  being predicted and to fixtures whose results have **landed** (the unwritten-fixture trap from
  [gw5-check-in.md](gw5-check-in.md) §0 would otherwise read as 22 no-shows). Paged past the 1,000-row cap.
- **Output:** `startShare` = P(start); `minutesPerGame` = P·minutes-if-starts + (1−P)·minutes-if-not
  (outfield 83.8 / 6.31, goalkeeper 89.54 / 0.02). Availability still multiplies in `predict()`, and the
  club reconciliation still rescales to eleven starters and 990 minutes.
- **Provenance:** `rates.minutes_model` on each stored prediction, `minutes_model_players` in the run details.
- The coefficients are the pooled fit the gate script prints as "SHIPPING FIT"; re-run it and re-paste.

**Checked:** the ported functions run on live data with 0 out-of-range outputs; mean start probability for
the cohort moves 0.511 → 0.578 against a realised cohort rate of 0.575; replaying the ported code over
2026-27 scores 0.1176 vs last-5 0.1397 (in-sample coefficients, so slightly optimistic). `deno check` finds no
errors in the new code (two pre-existing `GenericStringError` errors in the history select are untouched).

**Not checked:** the full pipeline end to end (priors, squad reconciliation with a mixed
estimator/prior-season club, the archive write) — that needs a run of the deployed function. Note that
`gameweeks.finished` lags a played gameweek, so the model currently reads form through GW5 although GW6 is
scored; it catches up when the flag flips.

## 6. Deployed

`generate-predictions` v22 (`verify_jwt: true`, as `config.toml`), deployed through the Supabase MCP. The five
uploaded files were read back and are byte-identical to what was intended. They are comment-stripped, as the
previously deployed copies already were; with comments ignored, v21 matched `HEAD` exactly, so the only delta
shipped is this change.

First scheduled run after the deploy (14:05 UTC, run 144993): **success**, `model_version` v1.6.0, 667 players,
22,011 rows, `minutes_model_players` **235**. Checked in the table afterwards: every stored prediction is v1.6.0;
235 rows carry `rates.minutes_model = true`; every club's outfield start probabilities sum to 10.00 and its
goalkeepers to 1.00 (min = max across all 20 clubs); squad-reconciliation status `ok` 60/60.
`squad_consistency_violations` fell from 13 to 9. The GW6 archive stays frozen (deadline passed), so the first
archived snapshot from v1.6.0 is GW7's.

**Still to do:** re-read the live scoreboard once GW7 is scored, and again at the GW10 batch (~2026-11-09) with n
in the thousands. DSI-186 (accuracy claims) stays blocked by that read. Rollback, if needed, is redeploying the
v1.5.0 files from the commit before this change.
