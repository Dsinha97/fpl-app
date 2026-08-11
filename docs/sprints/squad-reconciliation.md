# Squad reconciliation

**Status: phase 1 built (v1.2.0, 2026-08-05); phase 2 built (v1.3.0, 2026-08-07).** See
[../roadmap.md](../roadmap.md) for the sprint index. Cited elsewhere as "Squad reconciliation, phase 2".

## Squad reconciliation, phase 1 — start/minutes water-fill (built, v1.2.0, 2026-08-05)

Investigating why the rejected data drop in [cold-start-patch.md](cold-start-patch.md) felt
necessary surfaced a real, measurable defect: every club starts exactly 11 players and 1 goalkeeper
per fixture, but `player_predictions` summed `start_probability` anywhere from 4.08 (Hull) to 14.82
(Chelsea) per club. `reconcileClubSquad` (`xp-model.ts`) fixes this with an exact, parameter-free
water-fill onto two budgets per club per fixture — 11 starters (1 goalkeeper) and 990 minutes, kept
separate because the ratio between them varies more than tenfold across today's squads (Hull ran 138
minutes per start against a league norm of ~92). Full mechanism, measurements, and the trade-off
accepted to ship it are recorded in
[../phase-4-model.md §3](../phase-4-model.md#3-squad-reconciliation-v120).

**Known limitation, shipped deliberately rather than fixed under the same change that found it.**
The water-fill is a single proportional factor per club per position group, so it cannot tell an
established starter from a fringe reserve on the same price band — at a large registered squad, the
correction lands on both equally, pulling a nailed starter down by the same proportion as a reserve
who should have moved far more. Measured on the phase-4 backtest cohort: Pearson r on the 207-player
established-player cohort fell from 0.850 to 0.761 with no recalibration, driven entirely by clubs
being scaled down (Chelsea, Spurs, Man City), while clubs being scaled up improved. The league-wide
level barely moved (mean predicted PPG −0.72%, inside the band this repo already treats as "leave
`positionCalibration` alone"), so recalibrating to chase the cohort figure would have been exactly
the mistake CLAUDE.md already warns against — raising the whole league to cancel a bias caused by
cohort *selection*.

## Squad reconciliation, phase 2 — evidence-weighted water-fill (built, v1.3.0, 2026-08-07)

Weights each player's share of the correction by `RateEvidence.priorWeight` (0–1, already computed by
`deriveRatesWithPrior`) instead of uniformly, so a low-evidence reserve absorbs most of a club's
correction and a high-evidence established starter absorbs little. `solveWeightedWaterFill`
generalises `solveWaterFill` to `q_i = min(c_i, p_i · λ^{w_i})` — `w_i = 1` for everyone is *exactly*
phase 1's formula (verified to agree with the exact solver to ~1e-13), and `w_i = 0` holds a player at
their raw `p_i` regardless of `λ`. Two disclosed costs: mixed exponents have no closed form, so this
is bisection (tolerance ~1e-4) rather than phase 1's exact iterative capping; and if every player in a
group carries zero weight the correction can never move at all (not just when the fixed floor already
exceeds target), so both directions fall back to the unweighted solve rather than silently failing.
`reconcileClubSquad` (phase 1, exact) stays in `xp-model.ts` unchanged, reachable if a future run
needs it back; `generate-predictions` now calls `reconcileClubSquadWeighted`.

**Gated on a fresh run of the phase-4 backtest before shipping**, in a `tsx` harness against live
data, comparing three variants — no reconciliation, phase 1, phase 2 — on the 208-player cohort
(≥1200 minutes in 2025/26, currently `status: 'a'`):

| Check | No reconciliation | Phase 1 | Phase 2 | Verdict |
|---|---|---|---|---|
| Constraint audit (11/1/990 per club per fixture) | — | holds | holds | ✅ still exact |
| `consistencyViolations` | 0 | 9 (1.6%) | 24 (4.2%) | disclosed cost, not disqualifying |
| Within-club Spearman(priorWeight, \|scale−1\|) | — | 0.19 / 0.13 | **0.54 / 0.56** | ✅ weighting works as designed |
| Phase-4 cohort Pearson r | 0.851 | 0.774 | **0.830** | ✅ recovers most of the gap |
| MAE / RMSE / bias | 0.407 / 0.540 / −0.003 | 0.521 / 0.660 / −0.178 | 0.454 / 0.576 / −0.113 | ✅ improves on all three |

Three of four gate criteria pass with a clear margin; `consistencyViolations` rises 2.7× in absolute
terms but stays a small share of the league (1.6% → 4.2%), and it was already an accepted, disclosed
cost of phase 1 — the same trade recorded for the doubly-bounded minutes solve below. Shipped
on that balance. Verified live post-deploy: `squad_consistency_violations: 24`, `squad_status: {ok:
60}` (all 20 clubs × 3 budgets), `model_version: v1.3.0`, matching the harness exactly.

A doubly-bounded minutes solve (flooring each player's minutes at their own scaled start share, to
close the ~1% consistency gap where `p60 > pAny`) was tried and rejected: for a squad member with a
near-zero own minutes estimate, the floor swamps their base rate and hands them an implausibly large
minutes scale from borrowed signal — measured taking one club's third-choice goalkeeper from
squad-rank 24 to rank 3. The single-budget solve is shipped instead, leaving that ~1% consistency
gap as a smaller, disclosed cost.
