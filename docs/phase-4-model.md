# Phase 4 — Expected Points (xP) Engine

**Status:** v1.0.0 built, calibrated, and scheduled — 2026-08-02
**Code:** [`supabase/functions/_shared/xp-model.ts`](../supabase/functions/_shared/xp-model.ts)
**Runner:** [`supabase/functions/generate-predictions/`](../supabase/functions/generate-predictions/)

Implements the nine steps in [the build plan](../fpl_app_phase_wise_build_plan.md#phase-4--expected-points-xp-engine).

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

## 3. Honest limitations

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
- **No current-season form.** Rates come entirely from prior seasons. A player whose role has
  changed — new manager, new position, transfer — will be mispriced until in-season data is blended
  in.

---

## 4. Storage and scheduling

- `prediction_models` — one row per version, with the full parameter set as JSON, so a prediction
  can always be traced to the exact configuration that produced it.
- `player_predictions` — per player per fixture, every component separately, plus the input rates.
- `player_xp_horizons` — a view rolling xP up to 1 / 3 / 6 / 8 gameweek windows, measured from the
  earliest predicted gameweek so it stays correct as the season advances.

`generate-predictions` runs at `5,35 * * * *`, a few minutes after `sync-bootstrap`, because an
availability flag flipping is the largest day-to-day input change.

---

## 5. Next

Phase 5's custom FDR replaces the official rating with a calibrated fixture model once team
strength data exists. Phase 6's transfer optimiser consumes `player_xp_horizons` directly — the
`xp_6` column is exactly the `xP_H(i)` term in the plan's transfer-gain formula.
