# Cold-start priors

How the model produces a projection for a player with little or no Premier League history, instead
of returning nothing.

## The problem, as measured

Before the patch, `deriveRates` returned `null` below 270 recency-weighted prior-season minutes and
the player was dropped entirely — no row, no `player_xp_horizons` entry, a dash in the UI. That was
**187 of 567 players (33%)**. Two things made a flat "add more data" fix wrong: 95 of the 187 already
had real PL evidence the 270-minute gate discarded wholesale (269 weighted minutes → nothing, 271 →
a full-confidence point estimate, a cliff not a judgement), and the gate conflated two different
populations — a 9-season veteran like Nelson (ARS) failed it purely because only the 3 most recent
seasons were read, while the genuine newcomers clustered at the promoted clubs (COV 93%, HUL 76%,
IPS 41% of squad with no PL minutes). — [cold-start-patch.md](../sprints/cold-start-patch.md)

## What was built (phase 1, empirical-Bayes shrinkage)

```
n_eff   = weightedMinutes / 90
w_prior = sigma2 / (n_eff * tau2 + sigma2)
mu_post = w_prior * mu_prior + (1 - w_prior) * own_rate
```

A player's own rate is shrunk toward a fitted prior in proportion to the evidence behind it — thin
evidence leans on the prior, thick evidence overrides it. Both variances are **measured off real
data** (`sigma2` from how much a player's own rate moves season to season, `tau2` from spread across
players in a position), not chosen. The prior mean itself falls back through four rungs:
`pl_recent` → `pl_extended` (wider season window) → `position_price` → `position_baseline`.
Coverage went from 380/567 to 567/567.

Two traps documented because both shipped wrong first:

- **Fitting the playing-time prior on 450+-minute seasons selects for starters.** It told every
  fringe player they average ~47 minutes; fixed by fitting on every season with any minutes at all.
- **Estimating `tau2` per price band collapses it to zero on thin cells**, driving prior weight to
  1.00 and letting the prior override real evidence. Fixed: price informs the *mean* (bands), the
  *spread* is estimated once per position where there's real sample size.

**Validated out-of-sample**: truncating established players' histories to simulate 90/180/270
minutes, the shrunk estimate beat both the raw thin-sample rate (MAE 0.048 vs 0.061) and the pure
prior (0.054) — the first genuine out-of-sample test in this repo.
— [cold-start-patch.md](../sprints/cold-start-patch.md)

## Phase 2 — external-league enrichment

The reference document (`docs/sources/cold-start-patch-plan.md`) proposed pulling in external
leagues to prime the prior for players with zero PL minutes. Most candidates were ruled out on
inspection, not assumption:

| Source | Verdict | Why |
|---|---|---|
| API-Football | Rejected | No xG anywhere in its docs |
| soccerdata | Rejected | Big-5 + PL only, misses the Championship (where the newcomer cluster actually sits) |
| Understat / Transfermarkt | Rejected | Top-5-only / no performance metrics |
| worldfootballR / FBref | Closed, not just deferred | Archived unmaintained; Big-5-only; the underlying Opta data was deleted from FBref on 2026-01-20 after the data provider terminated the feed |
| A supplied CSV (2026-08-05) | **Rejected** | 95% synthetic — see below |

**A rejected data drop.** A CSV claiming per-player minutes/xG/xA for newly-promoted players failed
three checks: 96 of 101 rows were one of four hand-written position archetypes (all 13 goalkeepers
identically 3420 minutes — impossible, several clubs have four registered keepers), `origin_club`
equalled the new PL club in 79/101 rows, and 42/101 players already carried real PL minutes. Using
it would have been actively harmful — shrinkage trusts evidence by volume, so a fabricated
2700-minute defender template would have overridden the real prior for ~96 players. This is the
origin of the **three-check gate** every later drop is held to: per-player distinct values (not
archetypes), a genuine origin competition, no overlap with players who already carry PL minutes.

**One drop cleared the gate (Sprint 15.6, xP engine v1.5.0).** FootyStats PDFs for the three
promoted clubs (Coventry, Hull, Ipswich) passed all three checks for 33 of 99 zero-PL-minute
players. A translation factor λ (Championship rate → PL-equivalent rate) was **fitted, not
invented** — using 12 players who played both leagues, pooled by minutes, not the supplied uniform
0.65 (which the data itself contradicts: one player's own PL-vs-Championship ratio was 0.40 for xG
and 0.78 for xA, not one number):

| Metric | λ (fitted) |
|---|---|
| `xg90` | 0.200 |
| `xa90` | 0.280 |
| `yellow90` | 0.844 |
| `dc90` | not fitted — no comparison data exists; stays on `position_price` |

The new prior source (`"external_measured"`) supplies only the prior **mean** — `sigma2`, `tau2`,
`n_eff`, and the shrinkage weight are byte-identical to before, so a covered player's stated
`reliability` doesn't overclaim what changed. Verified live with a harness asserting zero reliability
flips, zero rate differences for the 544 uncovered players, and genuinely distinct per-player values
for the 33 covered ones. — [championship-priors.md](../sprints/championship-priors.md)

The remaining 66 zero-PL-minute players (overseas signings, academy graduates) and `dc90` for all 33
have no fittable source and stay blocked — tracked in
[blocked-and-data-gaps.md](blocked-and-data-gaps.md).

## How this interacts with squad-building

The optimiser's `RiskLevel` control does double duty: `low` optimises the *lower* edge of a player's
rate-uncertainty band, `high` the mean. Prior-based players lose ~87% of their value from mean to
lower bound against ~14% for established players — so Low deprioritises speculation by arithmetic,
without inventing a separate reliability discount. See [squad-optimizer.md](squad-optimizer.md).

See also: [xp-model.md](xp-model.md), [methodology.md](methodology.md#an-invented-threshold-is-not-evidence).
