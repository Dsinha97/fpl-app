# Fixture difficulty (FDR)

Three generations of fixture difficulty, only one of which the xP model consumes: FPL's **official**
FDR (shipped, feeding `ScoredPlayer.fdrRun`), a **strength-derived** rating (shipped, display-only,
permanently unbacktestable), and a **results-derived** rating (built and measured, deliberately not
shipped). The interesting part is *why* the two custom ones stopped where they did — the reasons are
different, and neither is "it didn't work".

Terms: [glossary.md](glossary.md). How it enters the projection: [xp-model.md](xp-model.md).

## What production actually uses

`ScoredPlayer.fdrRun` is populated from FPL's own `fixtures.team_h_difficulty` /
`team_a_difficulty`, on five pages. It feeds `fixtureScore` and `riskScore`'s `fixtureVariance`.
Neither custom rating below is wired into it.

## Generation 2 — strength-derived, display-only and permanently so (Sprint 31, 2026-09-03)

`lib/fdr.ts`'s `strengthFdr` derives a fixture's difficulty from the opponent's own
`strength_overall_*` **at the venue they are playing**. `/fixtures` gets an Official / Strength
toggle; `FdrCell` gained a *second* optional rating rather than having `fdr` replaced.

**It cannot ever clear the model gate, and that is a property of the data rather than of the
method.** `teams` holds one season's rows and `strength_overall_*` is a live snapshot with no
history, so `scripts/backtest-walkforward.ts` has nothing to walk over. A rating that cannot be
measured is not allowed near `fdrRun`, so the containment is checked statically: every `fdrRun`
writer reads `c.fdr`, and `strengthFdr` appears only in `lib/fdr.ts` and the matrix component.

Its coarseness is disclosed rather than smoothed over (`STRENGTH_FDR_NOTE`): measured live
2026-09-03, `strength_overall_home` takes only {2, 3, 4} across all 20 clubs and
`strength_overall_away` only {2, 3, 4, 5}. A missing strength renders **neutral** rather than
falling through to a misleading band.
— [sprint-31.md](../sprints/sprint-31.md#4-custom-fdr--built-shown-and-deliberately-kept-out-of-the-model)

## Generation 3 — results-derived: the signal is real, and it still doesn't ship (Sprint 35, 2026-09-06)

`lib/fdr-derived.ts` — pure, no Supabase client, no I/O, so the backtest harness and the app can
share one implementation and `tsc` checks it (`supabase/functions/**` is excluded from tsconfig by
necessity, so a Deno copy would have been unchecked).

**Why this one is backtestable when generation 2 was not.** Results are recoverable for four
seasons. One roadmap premise was corrected by checking rather than assuming: `fixtures` holds
**only 2026-27** (380 rows), so `deriveStandingsFromFixtures` cannot be walked over past seasons
either. `player_gameweek_stats` carries `team_h_score`, `team_a_score`, `opponent_team` and
`was_home` on every row for four seasons, which is enough to reconstruct both sides of every
fixture.

Three properties it must have:

- **Within-season.** FPL reassigns team ids alphabetically each season, so nothing compares ids
  across seasons. That costs nothing — a rolling in-season difficulty is what the model consumes.
- **Rolling and strictly backward-looking.** A rating used at event *E* is built only from `< E`.
- **Shrunk toward the league mean.** `DEFAULT_PRIOR_GAMES = 4` is a documented input swept in the
  backtest, not a fitted coefficient — the same treatment `decisionMargin` gets, see
  [methodology.md](methodology.md#when-a-term-cannot-be-dropped-make-it-an-input).

Banding to 1–5 is by **quintile**, deliberately: mapping a raw score onto the scale would need a
constant, and any constant chosen for it is the invented coefficient this project forbids tuning
until the output looks right. Ranking sidesteps it, and matches what FDR *is* — a banding of
opponents against each other.

### Two defects found by running it against live data

Both caught by validating rather than trusting, per
[methodology.md](methodology.md#verify-engine-changes-against-live-data-not-just-review).

- **Venue was counted twice.** `bandToFdr` originally ranked home and away entries in one pool.
  Home sides both score more and concede less, so one ranking sorts nearly every team-at-home above
  nearly every team-away and the resulting 1–5 mostly encoded *venue* — while `predict` already
  applies its own `homeAttack`/`awayAttack` factors. Observed directly at 2026-27 event 3: every
  `:H` entry banded 3–5, every `:A` entry 1–2. Fixed by banding **within** venue, which roughly
  doubled the measured effect.
- **A fixture yields two sides only when both teams have player rows for it.** The three completed
  seasons reconstruct exactly 760 sides each (2 × 380); 2026-27 gave 56 from 30 fixtures — a
  `sync-player-history` lag, not an error, recorded as `ONE_SIDED_FIXTURE_NOTE`.

Reconstructed total goals match the real scorelines exactly (78 vs 78 for 2026-27).

### The result, and the control arm that makes it one

At `priorGames = 4`, the derived arm beats the neutral baseline on MAE and Pearson r in all four
seasons; the effect is **small** (MAE ~0.5%, r by 0.005–0.026) and consistent.

**The shuffled control is what turns that into a result rather than a coincidence.** It feeds
`predict` the identical distribution of `fdr` values with the team-to-rating mapping destroyed. In
every season at every setting it is *worse than neutral* on both metrics, while the real ratings are
better — so the information is in which opponent gets which rating, not in the spread of numbers.
Without that arm, "a spread of fdr values happens to help" would have been indistinguishable from
"the ratings know something". See
[methodology.md](methodology.md#a-scrambling-control-is-what-separates-a-result-from-a-coincidence).

`priorGames` is deliberately **not** chosen from these numbers: 2 and 8 clear 4/4, 4 clears 3/4
(failing 2026-27's bias by 0.002 against a ±0.01 tolerance). All three sit within 0.012 of each
other on a 471-row season and straddle the threshold non-monotonically — that is noise, and picking
the setting that passes is the invented-threshold trap.

### Why it doesn't ship

**The baseline is neutral. Production is not.** What was measured is *derived beats no fixture
adjustment at all* — because `scripts/backtest-walkforward.ts` pins `fdr: 3` throughout, which is
also what made the neutral arm a clean comparison. What has **not** been measured is *derived beats
official*, because official FDR for past seasons is not obtainable. Swapping `fdrRun` on this
evidence would claim something the backtest never tested, so nothing is wired in, no page changes,
`MODEL_VERSION` unchanged.

**The gate that would justify shipping** is derived-vs-official on the *current* season, where
official FDR is available in `fixtures`. At GW3 that is n=471 and far too thin. Re-run from ~GW10.

**A second follow-up if it clears:** `predict` collapses fixture difficulty into one `fdr` scalar
with separate `attackAlpha`/`defenceAlpha` applied to it, and `phase-4-model.md` already records
that one scalar cannot really express both halves. Splitting `FixtureInput` into attack and defence
terms is the natural next step, deliberately not bundled into the change that first tests whether
the signal exists.
— [sprint-35.md](../sprints/sprint-35.md)

## The distinction worth keeping

Generation 2 is **display-only forever** (no history to backtest against, ever). Generation 3 is
**unshipped pending one specific measurement** that becomes possible around GW10. Those are
different states, and [blocked-and-data-gaps.md](blocked-and-data-gaps.md) lists them separately.
