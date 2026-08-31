# Phase 4 — Expected Points (xP) Engine

**Status:** v1.5.0 built, calibrated, and deployed — this doc's body documents through v1.4.0
(the v1.5.0 Championship-priors change is in [championship-priors.md](sprints/championship-priors.md)).
The one backtest below is **in-sample** — season-aggregate xP against 2025/26, a season weighted
0.6 in the model's own rate blend, with `positionCalibration` fitted on the same cohort. A
**walk-forward, out-of-sample** backtest exists: [sprint-17a.md](sprints/sprint-17a.md). It found
the model's per-gameweek MAE and r are both worse than a naive last-5-gameweeks baseline in every
target season tested — read it before trusting the numbers below at gameweek granularity.
**Code:** [`supabase/functions/_shared/xp-model.ts`](../supabase/functions/_shared/xp-model.ts)
**Runner:** [`supabase/functions/generate-predictions/`](../supabase/functions/generate-predictions/)

Implements the nine steps in [the build plan](sources/fpl_app_phase_wise_build_plan.md#phase-4--expected-points-xp-engine).

---

## 1. What the model does

For every player and every fixture in the next 8 gameweeks, it estimates points from prior-season
per-90 rates, adjusted for fixture difficulty, venue, and availability. Each scoring component is
stored as its own column in `player_predictions` — the plan's requirement is *"keep the components
explicit so the model can be debugged"*, and a bare `xp` number cannot be audited.

Predictions are keyed per **fixture**, not per gameweek, so double gameweeks sum naturally and each
number is attributable to a specific opponent and venue.

### Components

| Step | Component | How |
| --- | --- | --- |
| 1–2 | Appearance | `p60 = startShare × 0.92`; appearance points from `long_play`/`short_play` |
| 3 | Goals, assists | `xG90 / xA90 × minuteShare × attackMultiplier × position points` |
| 4 | Clean sheet | Player's own CS rate as a team proxy, gated on `p60` |
| 5 | Bonus | `bonus90 × minuteShare`, scaled by the mean of both multipliers |
| 5 | Defensive contribution | **Poisson tail**: `P(X ≥ threshold)` where `X ~ Poisson(dc90 × minuteShare)` |
| 6 | Saves, goals conceded | `E[floor(X/3)]` and `E[floor(X/2)]` under Poisson, not `λ/d` |
| 8 | Fixture adjustment | Separate attack and defence multipliers from official FDR + venue |
| 9 | Availability | Folded into expected minutes rather than applied as a trailing scalar |

Scoring values are read from the `scoring_rules` table, which is populated from the FPL API — no
points values are hardcoded, so a mid-season rule change flows straight through.

### Two deliberate deviations from the plan

- **Fixture multiplier is per component, not global.** A hard fixture depresses attacking returns
  and clean sheets by different amounts; one scalar cannot express both.
- **Availability flows through minutes.** The plan's step 9 explicitly notes this is the more
  complete form than a separate multiplier.

### Discrete counts use Poisson, not ratios

Defensive contribution awards 2 points for clearing a per-match threshold (10 actions for
defenders, 12 for midfielders and forwards). A player averaging exactly the threshold does *not*
clear it every match — they clear it roughly half the time. Modelling the count as Poisson and
taking the tail probability captures this; a `rate / threshold` ratio would not. The same reasoning
applies to saves (1 point per 3) and goals conceded (−1 per 2), where `E[floor(X/d)]` is materially
lower than `λ/d`.

---

## 2. Calibration

**Method.** Compare predicted points per gameweek (`xp_8 / 8`) against actual points per gameweek
from the most recent completed season, for the 207 players with ≥ 1200 minutes and current
availability.

**This is an in-sample check, and its value depends on knowing that.** The 2025/26 season carries
weight 0.6 in the rate blend, so predictions should roughly *reproduce* that season. It therefore
does not measure predictive power. What it does measure — usefully — is whether the points
arithmetic is right. A systematic gap means points are being lost somewhere in the component sum.

### Results

| Iteration | Bias | MAE | RMSE | Pearson r |
| --- | --- | --- | --- | --- |
| Initial (`startCompletion` 0.85, no calibration) | **−0.485** | 0.582 | 0.709 | 0.849 |
| After `startCompletion` → 0.92 | −0.409 | — | — | — |
| After per-position calibration | **+0.001** | **0.420** | **0.552** | **0.850** |

The first run under-predicted by 0.49 points per gameweek — a 17% shortfall, uniform across all
four positions. Two fixes:

1. **`startCompletion` 0.85 → 0.92.** The original figure assumed starters are substituted before
   the hour far more often than they are. This suppressed both appearance points and clean sheets,
   since clean sheets are gated on the same probability.
2. **Per-position level correction**, fitted so mean predicted equals mean observed.

Final factors for v1.0.0: `GKP 1.091 · DEF 1.189 · MID 1.169 · FWD 1.165`.

**Refitted for v1.1.0** (the cold-start prior layer). Shrinking rates toward a fitted prior lowered
the overall level by 0.084 points per gameweek — a uniform 1.5–3.7% across positions — so the same
method was rerun on the same 207-player cohort, giving `GKP 1.1077 · DEF 1.2224 · MID 1.2116 ·
FWD 1.1972`. The refit restored bias to −0.000, and MAE improved to **0.410** from 0.420 while
**Pearson r stayed at 0.850**. That last figure is the one that matters: the shrinkage changed the
level without disturbing the ranking.

**Refitted again for v1.4.0**, after `dc90` (defensive contribution) got its own eligible-minutes
denominator — see "Sprint 12.6" in [roadmap.md](roadmap.md) for the full gate table. Rerun on a
209-player, ≥1200-minute, currently-available cohort against 2025/26 actuals:
`GKP 1.265 · DEF 1.2241 · MID 1.2238 · FWD 1.2576`. DEF and MID barely moved from their v1.1.0
values — raising `dc90` had already zeroed most of their bias before the refit — while GKP and FWD
moved more, for reasons unrelated to this fix (GKP's `dcThreshold` is 0, so `dc90` never reaches its
`predict()` output). Bias returned to 0.000 by construction; Pearson r held per-position and rose
overall (0.830 → 0.839 on this run's cohort, which is not the same snapshot the v1.1.0 figures above
were measured against, so the two 0.850/0.830-ish numbers are not directly comparable digit for
digit — each refit's own before/after pair is the meaningful comparison).

These are readable. Goalkeepers need the least correction because their scoring is the most
mechanistic — appearance, clean sheet, saves, and little else. Defenders need the most, consistent
with the Poisson tail under-counting over-dispersed defensive-contribution counts and with
defenders' attacking returns exceeding xG. The factors absorb what the component model does not
represent: finishing above expected, penalties won, and count over-dispersion.

**Bias going to ~0 is by construction and proves nothing on its own.** The meaningful results are
that MAE fell 28% and RMSE 22% — fixing a systematic level error improves accuracy for every
player, not just on average — and that Pearson r was unchanged at 0.850, confirming the correction
adjusted level without disturbing ranking.

### Per-position accuracy

| Position | n | MAE | RMSE | r |
| --- | --- | --- | --- | --- |
| GKP | 18 | 0.226 | 0.333 | 0.874 |
| DEF | 78 | 0.398 | 0.509 | 0.857 |
| MID | 93 | 0.475 | 0.615 | 0.830 |
| FWD | 18 | 0.431 | 0.561 | 0.876 |

Goalkeepers are the most predictable and midfielders the least, which matches the shape of the
game: midfield returns depend on attacking output that varies far more week to week.

---

## 3. Squad reconciliation (v1.2.0)

**The problem, measured.** Rates are derived per player with no view of the rest of the squad, so
nothing enforces the facts every club satisfies: exactly eleven start, exactly one of them the
goalkeeper, and the squad plays 990 minutes (11 × 90) per fixture. Summing `start_probability` per
club at the first predicted event under v1.1.0:

| Club | GKP sum (must be 1.00) | XI sum (must be 11.00) |
| --- | --- | --- |
| Chelsea | 1.36 | **14.82** |
| Spurs | 1.71 | 14.34 |
| Man City | 1.30 | 13.45 |
| Hull City | 0.31 | **4.08** |
| Coventry City | 0.75 | 6.39 |
| Ipswich Town | 1.21 | 7.21 |

A promoted club's squad collapses toward the position/price prior mean — fitted on squads where a
cheap defender is a bench filler, not a certain starter — while an expensive established squad
inflates past eleven in the same direction. League-wide: Σ start-probability 210.25 vs a true 220;
Σ expected minutes 20,031 vs a true 19,800.

**The fix.** `reconcileClubSquad` (`xp-model.ts`) solves an exact, parameter-free water-fill per
club per fixture: `Σ min(ceiling_i, λ·p_i) = target`, with the ceiling set by each player's own
`availability` so a doubtful player can never be handed a start probability above their own chance
of playing. Two independent budgets — eleven starters (one a goalkeeper) and 990 minutes — because
the ratio between them varies more than the model assumed: Hull's squad ran 138 minutes per start
against a league norm of ~92, so scaling minutes by the same factor as starts would have handed
Hull's squad over 1,500 minutes for one match. Verified against live data: after reconciliation,
every club's start/GKP/minutes sums hit their targets to within 1e-13 (floating-point noise), and
the water-fill's edge cases (a club with only one available goalkeeper, a doubtful player's ceiling,
an unreachable target) are covered by synthetic tests in addition to the live-data pass.

A doubly-bounded variant was tried and rejected: flooring each player's minutes at
`appearanceMinutes × startCompletion × theirOwnScaledStartShare` fixes the small tail of players
(~1% of the league) whose start and minutes scales otherwise disagree, but for a squad member whose
own raw minutes estimate is near zero — the exact population this mechanism exists for — the floor
swamps their base rate, so nearly their whole minutes allocation comes from the floor rather than
real signal. On live data this took a club's third-choice goalkeeper from squad-rank 24 of 29 to
rank 3 purely on save points inflating with borrowed minutes, and dragged that club's within-squad
rank correlation from 0.92 to 0.80. The single-budget version is shipped instead, leaving 8 of 570
players (1.4%) with a small, disclosed inconsistency between their scaled minutes and starts, rather
than an occasional large, unexplained swing.

**What it costs, measured against this document's own backtest.** Recalibration is decided from the
league-wide level, not the cohort — mean predicted points per gameweek across all 568 players moved
**−0.72%**, inside the ±1% band this document already treats as "leave `positionCalibration` alone"
(see §2), so the factors above are unchanged for v1.2.0.

The 207-player backtest cohort, run through the same method as §2, moved further than that:

| | Bias | MAE | RMSE | Pearson r |
| --- | --- | --- | --- | --- |
| v1.1.0 (before) | 0.000 | 0.409 | 0.542 | 0.850 |
| v1.2.0 (after, no recalibration) | −0.177 | 0.535 | 0.670 | **0.761** |

This is not noise spread evenly across the cohort — it is concentrated exactly where the mechanism's
limitation predicts. Splitting the cohort by club and squad start-scale:

| Club | Squad start-scale | Cohort bias, before → after |
| --- | --- | --- |
| Chelsea | 0.74 (cut) | +0.16 → **−0.81** |
| Spurs | 0.77 (cut) | −0.15 → −0.74 |
| Man City | 0.82 (cut) | −0.15 → −0.84 |
| Leeds | 1.12 (boost) | −0.33 → −0.08 (improved) |
| Everton | 1.13 (boost) | −0.31 → −0.02 (improved) |

Every club being cut got worse; every club being boosted got better. The clearest single case: a
Chelsea player who actually averaged 4.05 points per gameweek last season — a clearly nailed starter
— was projected down from 4.88 to 3.30, a 32% cut his own record does not support. This is the
uniform-correction limitation from §"Squad reconciliation" in `xp-model.ts` showing up in exactly
the population it predicts: a large registered squad has enough fringe depth that the *raw* sum
comfortably clears eleven from reserves alone, so the cut that brings the group back to eleven lands
on the established starter as hard as on the reserve who should have moved far more.

**Shipped anyway, deliberately, with this recorded rather than hidden.** The squad-sum error this
patch fixes (a 3.6× spread on a quantity that is identically 11 for every club) is a worse, more
visible defect than the cohort-r cost of fixing it with the simplest correct mechanism, and the
`COLD_START_MODEL_NOTE` / `COLD_START_NOTE` disclosures say plainly that established starters at
deep squads can be pulled down by more than their own record supports. The real fix — weighting the
water-fill by `n_eff` so low-evidence players absorb more of the correction and high-evidence
starters less — is a different algorithm, not a parameter, and is recorded as follow-up work in
[roadmap.md](roadmap.md) rather than built under the same change that found the need for it.

---

## 4. Honest limitations

- **No out-of-sample validation exists yet.** Nothing in this document demonstrates predictive
  accuracy, only internal consistency. Real backtesting starts once `player_gameweek_stats` fills
  with 2026/27 results, at which point predicted xP can be compared against actual points for
  gameweeks the model never saw.
- ~~**184 of 564 players get no prediction.**~~ **Fixed in v1.1.0.** The 270-weighted-minute gate
  dropped 187 of 567 players by the 2026-27 pre-season, and roughly half of them *did* have Premier
  League evidence that the gate discarded wholesale — at 269 weighted minutes you got nothing, at 271
  a full-confidence point estimate. Rates are now shrunk toward a fitted position/price prior in
  proportion to the minutes behind them, so every player gets a number plus a statement of how much
  of it is the prior. Coverage is 567 of 567. See the cold-start section of
  [roadmap.md](roadmap.md).
- **The first genuine out-of-sample test now exists**, though only for the shrinkage: truncating
  established players' histories to simulate 90/180/270 minutes, the shrunk estimate beat both the
  raw thin-sample rate (MAE 0.048 vs 0.061) and the pure prior (0.054) on `xg90`. That validates the
  blend, not the underlying xP model.
- **Fixture difficulty is the official FDR.** Team attack/defence strength values are still zero
  pre-season, so the custom analytical FDR of Phase 5 cannot be built yet.
- **The calibration factors are fitted, not derived.** They should be refitted from real gameweek
  data and will likely shrink as the component model improves.
- **No current-season form — and no path exists for it to reach the model at all (checked
  2026-08-22).** `generate-predictions/index.ts` reads `player_season_history` as its only
  per-player evidence; neither `player_gameweek_stats` nor `player_live_stats` is read anywhere in
  that function or in `xp-model.ts`. Its own `players` select pulls only
  `id, code, team_id, element_type, status, chance_of_playing_next_round, now_cost` —
  `total_points`, `goals_scored`, `minutes` and `form` sit on that row unselected. And
  `player_season_history` structurally cannot pick up a current-season row mid-season:
  `sync-player-history` fills it from FPL's `history_past`, which only lists *completed* seasons —
  so the model's whole training table is frozen for the entire 2026/27 season regardless of how
  many gameweeks are played. Between any two gameweeks, a player's xP moves only on availability,
  price band, fixtures/FDR, squad reconciliation, and the shrinking prediction window.

  This is not a theoretical gap — it is very likely the largest single contributor to the
  out-of-sample walk-forward result above. [sprint-17a.md](sprints/sprint-17a.md) shows a naive
  mean of the player's own last 5 gameweeks beating the model on both MAE and r in every target
  season, with the model's bias trending more negative each season (-0.230 → -0.458 → -0.655):

  | Season | Model MAE | Last-5 baseline MAE | Model r | Baseline r |
  |---|---|---|---|---|
  | 2023-24 | 2.316 | **2.034** | 0.227 | **0.369** |
  | 2024-25 | 2.360 | **2.043** | 0.203 | **0.345** |
  | 2025-26 | 2.546 | **2.061** | 0.153 | **0.341** |

  **Built and measured (2026-08-27) — does not clear the gate; not shipped.** The original
  proposal above (slot the current season in at rank 1, weight 0.6, displacing the oldest prior
  season) turned out to have a real bug: `weightedOwnRates`'s per-90 *rates* are genuinely
  minutes-proportional as described, but `mpg`/`start_share` are not — they divide by
  `wGames = Σ(w·GAMES_PER_SEASON)`, a **fixed 38-game denominator per season slot** regardless of
  how much of that season has actually been played. A synthetic current-season row at GW2 would
  contribute `0.6×38 = 22.8` games against `0.6×54 = 32.4` weighted minutes, while a genuine full
  season contributes `0.3×38 = 11.4` games for `0.3×3000 = 900` weighted minutes — the games
  denominator barely moves relative to minutes for a full season, but swamps it for a two-game
  partial one. Worked example: a 3000-minute/season starter with three full prior seasons reads
  `mpg ≈ 79` today; slotting one blended gameweek in at rank 1 would drop that to `mpg ≈ 33` — a
  58% cut to a nailed starter's expected minutes from one gameweek of data, silently, since the
  per-90 rates the proposal actually checked all still look fine. Fixed by giving `SeasonRow` an
  optional `games` field (`xp-model.ts`, defaults to `GAMES_PER_SEASON` so every existing caller
  is unaffected) and passing the player's own actual game count instead of a fixed 38.

  Also changed from the original proposal: the current season is **appended** as a fourth term
  (`ShrinkInput.currentSeasonRow`/`currentSeasonWeight` in `deriveRatesWithPrior`) rather than
  displacing the oldest of the three prior seasons. Displacing was found to have a second problem
  independent of the games bug: it silently halves the *prior* evidence weight (0.6→0.3 on last
  season) the moment any current-season data exists at all, regardless of how thin that data is —
  a second way for one gameweek to dominate. Appending adds no such effect: a two-gameweek current
  season contributes at most a few hundred weighted minutes against a full season's few thousand,
  so `n_eff`/`prior_weight`/`mpg` all move by low single-digit percentages early on and only
  genuinely bite once several gameweeks have accumulated — structural degradation, not a clamp or
  an invented minimum-gameweek threshold.

  **Swept with `scripts/backtest-walkforward.ts`** (`wCur ∈ {0.3, 0.6, 1.0}`, real within-season
  walk-forward: at event *E* the synthetic row is built only from that target season's events
  strictly before *E*, both arms run through the real `deriveRatesWithPrior`) against the gate
  above — MAE and Pearson r vs. prior-only, in all three seasons, without the *magnitude* of bias
  growing (a signed-only comparison would wrongly pass a bias moving from −0.33 to −0.39):

  | Season | Prior-only MAE / r / bias | Blended (w=0.6) MAE / r / bias | Clears? |
  |---|---|---|---|
  | 2023-24 | 2.193 / 0.238 / +0.079 | **2.156** / **0.311** / **+0.015** | Yes |
  | 2024-25 | 2.300 / 0.204 / −0.329 | **2.255** / **0.281** / −0.375 | **No — bias worsens** |
  | 2025-26 | 2.491 / 0.152 / −0.536 | **2.395** / **0.246** / **−0.511** | Yes |

  MAE and r improve in **every** season at every tested weight — 2024-25 is no exception on either
  of those two metrics. It fails purely on the bias criterion: `|bias|` grows from 0.329 to 0.375
  (w=0.6) or 0.390 (w=1.0), the model becoming more consistently over-generous in exactly the
  season blending was meant to help. The other two seasons clear cleanly at every weight tested.
  Since the gate requires all three seasons and 2024-25 fails at every weight, **the blend is not
  wired into `generate-predictions`, `MODEL_VERSION` is not bumped, and `COLD_START_MODEL_NOTE`/
  `COLD_START_NOTE` are unchanged** — per CLAUDE.md, this null result is itself the finding, not a
  reason to keep tuning `wCur` until one season's number looks acceptable. The `SeasonRow.games`
  fix and `deriveRatesWithPrior`'s `currentSeasonRow` parameter are additive and inert for every
  existing caller (no caller passes them), so they stay in `xp-model.ts` as reviewed, dormant
  infrastructure — a future attempt (a different `wCur`, a variance-informed weight, or
  investigating *why* 2024-25's bias specifically worsens) can reuse both without re-deriving
  them, and doesn't need to re-litigate whether append-vs-displace or the games fix are correct.

  **Adjacent finding, acted on 2026-08-30:** `COMPARISON_WEIGHTS` (`lib/scoring.ts`) dropped FPL's
  own `form` and renormalised over 0.90 because FPL zeroes it between seasons — a premise that
  expired the moment `players.form` went non-zero for real players post-GW1. Fixed: `ScoredPlayer`
  gained an optional `form` field (only `/compare` populates it, from the `players.form` column it
  was already fetching for its own informational column); when present, `comparePlayers` uses the
  plan's full five-term weighting (0.40/0.20/0.15/0.15/0.10); every other caller, with no `form`
  data, keeps the renormalised four-term weights unchanged. This is the comparison/ranking layer
  only — not the production xP engine, and not the blend below.

  **Attempt 2, bias correction — swept 2026-08-30, does not clear the gate, not shipped.** The blend
  above fails only on bias, in one season, which reads like a fixable calibration offset — so a
  per-position additive intercept correction was swept alongside `wCur`, fit **leave-one-season-out**
  (each held-out season's correction comes only from the *other* two seasons' blended residuals,
  never its own — Pearson r is invariant to an additive shift, so this can only move bias/MAE and
  never touches r). Verdict: **no weight clears the gate in all three seasons.** The correction
  learned from 2024-25 and 2025-26 (both blend arms under-predict, bias strongly negative) is itself
  strongly negative per position; applied to 2023-24 — whose blend arm was already *slightly
  over-predicting* (bias +0.015 to +0.079 depending on weight) — it overshoots into a large positive
  bias (e.g. +0.51 at w=0.3) instead of correcting it:

  | wCur | 2023-24 (bias before → after) | 2024-25 (before → after) | 2025-26 (before → after) |
  |---|---|---|---|
  | 0.3 | +0.042 → **+0.514 (fails)** | −0.359 → −0.035 (clears) | −0.539 → −0.360 (clears) |
  | 0.6 | +0.016 → **+0.486 (fails)** | −0.375 → −0.050 (clears) | −0.523 → −0.325 (clears) |
  | 1.0 | −0.013 → **+0.457 (fails)** | −0.390 → −0.063 (clears) | −0.510 → −0.293 (clears) |

  This is itself a finding, not a tuning failure: bias direction and magnitude aren't stable across
  seasons, so a single global per-position intercept can't be the fix — whatever is making 2023-24
  read differently from the other two (a genuinely different season, not a data artifact so far as
  this pass checked) would need to be understood before a correction could generalise. Per
  CLAUDE.md, this null result stands as-is rather than narrowing the gate (e.g. two-of-three) to let
  it through. Reproduce with `npx tsx scripts/backtest-walkforward.ts`, which now sweeps and reports
  this correction permanently, alongside the existing blend sweep.
- **`dc90` (defensive contribution) applies one aggregate count to two different FPL rules.** FPL
  scores defenders on clearances + blocks + interceptions + tackles, and midfielders/forwards on the
  same four plus recoveries — but the API exposes only the combined `defensive_contribution` total,
  and the model applies that one number against both thresholds (10 for DEF, 12 for MID). The
  component stats (`clearances_blocks_interceptions`, `recoveries`, `tackles`) are stored in
  `players` / `player_gameweek_stats` / `player_season_history` but read by no code path yet — see
  `XDC_MODEL_NOTE` in `lib/scoring.ts` and "Sprint 12.6" in [roadmap.md](roadmap.md). Fixed
  separately, in the same sprint: `dc90` previously divided by a multi-season minutes denominator
  that included pre-2024/25 seasons the FPL API never tracked the stat for, silently halving the
  rate (`deriveDcEligibleSeasons`, v1.4.0) — that bug is closed; the CBIT/CBIRT split above is not.

---

## 5. Storage and scheduling

- `prediction_models` — one row per version, with the full parameter set as JSON, so a prediction
  can always be traced to the exact configuration that produced it.
- `player_predictions` — per player per fixture, every component separately, plus the input rates.
- `player_xp_horizons` — a view rolling xP up to 1 / 3 / 6 / 8 gameweek windows, measured from the
  earliest predicted gameweek so it stays correct as the season advances.

`generate-predictions` runs at `5,35 * * * *`, a few minutes after `sync-bootstrap`, because an
availability flag flipping is the largest day-to-day input change.

---

## 6. Next

Phase 5's custom FDR replaces the official rating with a calibrated fixture model once team
strength data exists. Phase 6's transfer optimiser consumes `player_xp_horizons` directly — the
`xp_6` column is exactly the `xP_H(i)` term in the plan's transfer-gain formula.
