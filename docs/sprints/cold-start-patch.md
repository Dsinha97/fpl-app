# Cold-Start Patch

**Status: phase 1 built; phase 2 deferred, gated.** See [../roadmap.md](../roadmap.md) for the
sprint index.

## Phase 1 — empirical-Bayes rate priors (built)

Sits outside the sprint numbering: a patch taken before Sprint 12 because a third of the player pool
had no projection at all. Sourced from [../cold-start-patch-plan.md](../cold-start-patch-plan.md), which
remains the reference for the deferred phase 2.

### The problem, measured

`deriveRates` returned null below 270 recency-weighted prior-season minutes and
`generate-predictions` then skipped the player entirely — no rows, absent from `player_xp_horizons`,
a dash in the UI.

| Weighted minutes, 3 most recent seasons | Players | Had xP |
|---|---|---|
| Zero PL history | 92 | 0 |
| Under 60 | 44 | 0 |
| 60–149 | 29 | 0 |
| 150–269 — *just missed the gate* | 22 | 0 |
| 270+ | 380 | 380 |

**187 of 567 (33%).** Two things mattered more than the headline. **95 already had Premier League
evidence** that the gate discarded wholesale: at 269 weighted minutes you got nothing, at 271 a
full-confidence point estimate — a cliff, not a confidence judgement. And **the gate was catching two
unrelated populations**: Nelson (ARS) has 9 PL seasons and 1,914 minutes and still got nothing,
because only the 3 most recent seasons were read. The genuine newcomers clustered at promoted clubs —
COV 93%, HUL 76%, IPS 41%.

### What was built

Rates are shrunk toward a fitted prior in proportion to the evidence behind them:

```
n_eff   = weightedMinutes / 90
w_prior = sigma2 / (n_eff * tau2 + sigma2)
mu_post = w_prior * mu_prior + (1 - w_prior) * own_rate
```

**Both variances are measured, not chosen** — `sigma2` from how much one player's own rate moves
between seasons, `tau2` from how much players in a position differ, both off `player_season_history`
(1,386 player-seasons, 280 players with two or more seasons). A four-rung fallback supplies the
prior mean: `pl_recent` → `pl_extended` (widens the season window, which is what fixes Nelson) →
`position_price` → `position_baseline`.

Coverage went **187 skipped → 0**, with 468 players on `pl_recent`, 7 on `pl_extended` and 92 on
`position_price`.

### Decisions worth keeping

- **Price informs the mean; the position informs the spread.** The first attempt estimated `tau2`
  per price band and it collapsed to zero on thin cells, driving the prior weight to **1.00** and
  letting the prior override real evidence. A variance needs far more data than a mean, so `tau2` is
  estimated once per position where there are hundreds of observations, while the band mean is kept
  because price genuinely predicts (MID `xg90` 0.044 → 0.080 → 0.158 → 0.204 across bands). Nothing
  assumes the bands are ordered — `xg90` is non-monotone for forwards.
- **The playing-time prior must not be fitted on starters.** `minFitMinutes: 450` is right for a
  per-90 rate but a selection bias on `mpg`, which is the quantity being predicted. Fitting it on
  450+ minute seasons only produced a prior saying every defender averages 47 minutes, and told a
  fringe player who genuinely averages 11 that he was a starter — McNair's projection jumped 0.90 →
  5.10. Playing time is fitted on every season with a minute in it.
- **No cap on `n_eff`.** The design document suggested capping at 5; that would leave a permanent
  5–10% prior on every established player and move 380 settled numbers for no reason.
- **`positionCalibration` was refitted**, because the shrinkage lowered the level by 0.084 points per
  gameweek. Bias returned to −0.000, MAE *improved* to 0.410 from 0.420, and Pearson r stayed at
  0.850 — level corrected without disturbing ranking, which is the same test Phase 4 used.
- **The band is a rate-uncertainty band, not a prediction interval.** It comes from re-running
  `predict()` at the rates' ±1.28σ bounds, so it ignores match-to-match Poisson noise and is
  *narrower* than real outcomes. `COLD_START_MODEL_NOTE` says so wherever it appears.
- **The optimiser reuses the existing Risk control rather than inventing a discount.** Low optimises
  the band's lower edge, High the mean. Verified on real data: prior-based players drop 87.5% from
  mean to lower bound against 14% for established ones, so Munoz falls from 70th to 118th among
  midfielders. Without that lever this patch would have quietly filled squads with speculation, and
  `withoutXp` became `lowReliability` because almost nobody is now refused a number.
- **The first genuine out-of-sample test in this repo.** Truncating established players' histories to
  simulate 90/180/270 minutes, the shrunk estimate beat **both** the raw thin-sample rate (MAE 0.048
  vs 0.061) and the pure prior (0.054). If it had beaten only one, the blend would not have earned
  its place.

### Corrections to the design document

Recorded because the document is kept unedited as the owner's source:

1. **§15–§21 argue against a formula that does not exist.** `xp-model.ts` was already component-wise
   with position-specific scoring, Poisson DC thresholds and per-component fixture multipliers — §21's
   own requirement. The cold-start layer needed no new xP formula, only to produce the existing
   `Rates` shape, which is why this landed as one seam rather than a parallel model.
2. **§13's team context has no data** — `teams.strength_*` is zero for all 20 clubs, so it is dropped
   and disclosed.
3. **Four new prediction tables collapse to one** — `player_prior_predictions` and
   `player_posterior_predictions` duplicated `player_predictions`; metadata columns on the existing
   table are correct.
4. **§25's gameweek decay schedule** is replaced by minutes-based `n_eff`, as the document itself
   recommends.
5. **The Sprint A→G order is inverted for this repo** — it leads with provider integration, which is
   partly unobtainable, and ships nothing until Sprint E while half the gap needed no external data.

## Phase 2 — external-league enrichment (deferred, gated)

Not started. Findings that shape it, verified rather than assumed:

- **API-Football has no expected goals** — "xG" appears zero times in its 139-page documentation.
  `/players` gives goals, assists, shots, passes, tackles and a composite rating. It cannot satisfy
  §7, though it does cover minutes, shots, key passes and defensive actions.
- **soccerdata ships Big-5 + Premier League, not the Championship** — other leagues "can be added but
  there are no guarantees they will be scraped correctly". So the largest newcomer cluster is the
  least covered.
- **Understat is excluded**: top-5 leagues only, so it cannot reach the Championship at all.
  **Transfermarkt is excluded**: no performance metrics, and §22 says fees must not be the primary
  minutes proxy.
- **The translation cohort would be survivor-biased.** `player_season_history` holds 498 codes and
  every one is in the current squad, because `sync-player-history` iterates *current* players. Fitting
  λ from it would measure how well transfers translate *conditional on the player still being in the
  league years later*, hiding every flop and biasing λ upward — the direction that hurts a manager.
  The fix is to take both sides of the cohort from FBref.
- Free tier is 100 requests/day and `/players` paginates at 20, so a Championship season is ~36
  requests: enough for a seasonal backfill, never for anything live.

**A candidate data drop was rejected, measured rather than assumed (2026-08-05).**
`../Promoted Team Data/premier_league_new_players_analytics.csv` was supplied as per-player
minutes/appearances/xG/xA data for players new to the league, intended to feed the cold-start prior.
Three checks — distinct-tuple count per position, `origin_club == new_pl_club` rate, and a join
against `player_season_history` — showed it is 95% synthetic: 96 of 101 rows are one of four
hand-written position archetypes (all 13 goalkeepers identically 3420 minutes / 38 apps / 38 starts,
which is impossible — several clubs have four registered keepers), `origin_club` equals `new_pl_club`
in 79/101 rows with `origin_league` defaulting to `EFL_Championship`, and 42/101 players already
carry real Premier League minutes and are not cold-start cases at all. Injecting it would have been
actively harmful: shrinkage weights evidence by `n_eff = minutes/90`, so the fabricated 2700-minute
defender template would read as *strong* evidence and override the fitted prior, flipping ~96 players
from `reliability: "low"` to `"high"` and giving every promoted-club defender an identical
projection. **Not used.** Any future drop must pass the same three checks before it is allowed to
influence a projection: per-player distinct values (not position archetypes), a genuine origin
competition, and no overlap with players who already carry PL minutes.
