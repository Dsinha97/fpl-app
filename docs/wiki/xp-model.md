# The xP (Expected Points) model

Predicts each player's fantasy points per fixture from prior-season per-90 rates, adjusted for
fixture difficulty, venue, and expected minutes — the number every other engine in this app builds
on.

## What it does

For every player and every fixture in the prediction window, `xp-model.ts` (Deno,
`supabase/functions/_shared/xp-model.ts`) estimates points from per-90 rates derived from prior
seasons, weighted toward the most recent. Each scoring component (appearance, goals, assists, clean
sheet, bonus, defensive contribution, saves, goals conceded) is stored as its own column in
`player_predictions`, not summed into a bare number — the design goal is that a projection can be
debugged, not just trusted. Predictions are keyed **per fixture**, not per gameweek, so a double
gameweek sums naturally. — [phase-4-model.md](../phase-4-model.md)

Discrete counts (defensive-contribution thresholds, saves, goals conceded) use **Poisson tail
probabilities** (`P(X ≥ threshold)`, `E[floor(X/d)]`) rather than a `rate / divisor` ratio — a
player averaging exactly the DC threshold does not clear it every match, they clear it about half
the time, and only a Poisson model captures that. — [phase-4-model.md](../phase-4-model.md#1-what-the-model-does)

Fixture adjustment uses **separate attack and defence multipliers** (a hard fixture depresses
attacking returns and clean sheets by different amounts), and availability is folded into expected
minutes rather than applied as a trailing scalar.

## Calibration

The backtest compares `xp_8 / 8` against actual points-per-gameweek for players with ≥1200 minutes
and current availability, from the most recent completed season. This is explicitly an **in-sample
check** — the season being tested carries weight in the model's own rate blend, so it can't measure
predictive power. What it can measure is whether the points arithmetic is right.

The first run under-predicted by 17% uniformly across positions — traced to `startCompletion` being
set too low (0.85 → 0.92) and no per-position level correction. Fixing both took bias to +0.001,
Pearson r to 0.850. — [phase-4-model.md §2](../phase-4-model.md#2-calibration)

Calibration factors have been refit three times as the model changed underneath them, each time
gated on the same 200+-player cohort and the same three checks (bias, MAE, Pearson r unchanged or
improved):

| Version | Trigger | GKP / DEF / MID / FWD |
|---|---|---|
| v1.0.0 | Initial fit | 1.091 / 1.189 / 1.169 / 1.165 |
| v1.1.0 | Cold-start shrinkage lowered the level ~0.084 pts/GW | 1.1077 / 1.2224 / 1.2116 / 1.1972 |
| v1.4.0 | `dc90` eligible-minutes fix raised DEF/MID | 1.265 / 1.2241 / 1.2238 / 1.2576 |

`positionCalibration` is fitted **in-sample** and must be refit once real 2026/27 results exist —
recorded as a live blocker in [roadmap.md](../roadmap.md).

## Squad reconciliation

Per-player rates have no view of the rest of the squad, so nothing enforced that each club starts
exactly 11 (1 goalkeeper) and plays 990 minutes per fixture — summed `start_probability` ranged from
4.08 (Hull) to 14.82 (Chelsea) per club under v1.1.0. `reconcileClubSquad` (v1.2.0) fixes this with
an exact water-fill onto two budgets (starters, minutes) per club per fixture. It's a uniform
correction per club, which costs accuracy on established starters at deep squads (Pearson r on the
backtest cohort fell 0.850 → 0.761); v1.3.0's `reconcileClubSquadWeighted` fixes most of that by
weighting each player's share of the correction by their own evidence (`priorWeight`), recovering
r to 0.830. Full detail: [phase-4-model.md §3](../phase-4-model.md#3-squad-reconciliation-v120),
[squad-reconciliation.md](../sprints/squad-reconciliation.md).

## Known, disclosed gaps

- **`dc90` applies one aggregate defensive-contribution count to two different FPL scoring rules**
  (defenders score on CBIT, mid/forwards on CBIRT). The component stats exist in the database but no
  code path reads them yet — `XDC_MODEL_NOTE` in `lib/scoring.ts` discloses this in the UI.
- **No current-season form** — rates come entirely from prior seasons until 2026/27 gameweeks
  accrue.
- **Fixture difficulty is the official FDR**, not a custom model — team attack/defence strength is
  zero for every club pre-season, which also blocks a calibrated fixture model (Phase 5, unbuilt).

See also: [cold-start-priors.md](cold-start-priors.md) (what happens for players with thin or no PL
evidence), [methodology.md](methodology.md) (the "drop, renormalise, disclose" and "verify with a
harness" rules this model was built under).
