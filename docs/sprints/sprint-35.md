# Sprint 35 — A results-derived FDR: the method works, and it still does not ship

**Built and measured 2026-09-06.** Roadmap's "results-derived custom FDR", scoped 2026-09-03 and
not started until now. The headline: **the signal is real and survives a scrambling control, but
the thing it was measured against is not the thing it would replace.**

## 1. Why this one is backtestable when Sprint 31's was not

Sprint 31 built a *strength*-derived FDR and proved it can never be model-grade: `teams` holds one
season's rows, strength is a live snapshot with no history, so the walk-forward harness has nothing
to walk over and the standing gate cannot be run at all. It is display-only, permanently.

Results are different — they are recoverable for four seasons. One correction to the roadmap's
premise, checked rather than assumed: **`fixtures` holds only 2026-27** (380 rows, 30 scored as of
this build), so `deriveStandingsFromFixtures` cannot be walked over past seasons either.
`player_gameweek_stats` carries `team_h_score`, `team_a_score`, `opponent_team` and `was_home` on
every row for four seasons, and that is enough to reconstruct both sides of every fixture.

`lib/fdr-derived.ts` is pure — no Supabase client, no I/O — so the harness and the app can share one
implementation and `tsc` checks it (`supabase/functions/**` is excluded from tsconfig by necessity).

Three properties it has to have, and why:

- **Within-season.** FPL reassigns team ids alphabetically each season, so team 1 in 2023-24 is not
  team 1 today. Nothing compares ids across seasons. That costs nothing — a rolling in-season
  difficulty is what the model consumes anyway.
- **Rolling and strictly backward-looking.** A rating used at event *E* is built only from events
  `< E`.
- **Shrunk toward the league mean.** A team three games in has no more business carrying a
  full-confidence rating than a player with 200 minutes. `DEFAULT_PRIOR_GAMES = 4` is a **documented
  input, swept in the backtest**, not a fitted coefficient.

Banding to 1-5 is by **quintile**, deliberately: mapping a raw score to the scale needs a factor,
and any constant chosen for it would be exactly the invented coefficient CLAUDE.md forbids tuning
until the output looks right. Ranking sidesteps it, and matches what FDR *is* — a banding of
opponents against each other.

## 2. The harness had never exercised the fixture layer at all

`scripts/backtest-walkforward.ts` pins `fdr: 3` throughout, so `fdrDelta = 0` and only the
home/away factor ever applied. That is stated in its own header as a scope cut, and it makes the
neutral arm a clean baseline: the new arm differs from it **only** in the `fdr` passed to
`predict()`.

The baseline is neutral rather than FPL's own FDR because past-season official FDR is not
obtainable. **This is the sprint's central caveat — see §5.**

## 3. Two real defects found by validating rather than trusting

Both were caught by running the module against live data before believing the numbers, per
CLAUDE.md.

- **Venue was being counted twice.** `bandToFdr` originally ranked home and away entries in one
  pool. Home sides both score more and concede less, so a single ranking sorts nearly every
  team-at-home above nearly every team-away, and the resulting 1-5 mostly encoded *venue* rather
  than team quality — while `predict` already applies its own `homeAttack`/`awayAttack` factors.
  Observed directly at 2026-27 event 3: every `:H` entry banded 3-5, every `:A` entry 1-2. Fixed by
  banding **within** venue. This was not cosmetic: it roughly doubled the measured effect.
- **A fixture yields two sides only when both teams have player rows for it.** The three completed
  seasons reconstruct exactly 760 sides each (2 x 380), so historical data is complete. 2026-27 gave
  56 from 30 fixtures — a `sync-player-history` lag, not an error. Recorded as
  `ONE_SIDED_FIXTURE_NOTE`.

Arithmetic was verified independently, not just structurally: reconstructed total goals match the
real scorelines exactly (78 vs 78 for 2026-27).

## 4. Results, and the control that makes them believable

Same gate as every other model change: MAE down, Pearson r up, `|bias|` not growing beyond +0.01 —
in every target season.

`priorGames = 4` (the documented default):

| Season | | bias | MAE | r |
|---|---|---|---|---|
| 2023-24 | neutral | −0.233 | 2.318 | 0.229 |
| | **derived** | **−0.226** | **2.307** | **0.236** |
| | shuffled control | −0.238 | 2.322 | 0.220 |
| 2024-25 | neutral | −0.461 | 2.363 | 0.198 |
| | **derived** | **−0.452** | **2.347** | **0.209** |
| | shuffled control | −0.448 | 2.360 | 0.192 |
| 2025-26 | neutral | −0.666 | 2.548 | 0.152 |
| | **derived** | **−0.664** | **2.542** | **0.157** |
| | shuffled control | −0.666 | 2.556 | 0.146 |
| 2026-27 | neutral | −0.914 | 2.564 | 0.251 |
| | derived | −0.926 | 2.544 | 0.276 |
| | shuffled control | −0.942 | 2.565 | 0.264 |

**The control is what makes this a result rather than a coincidence.** The shuffled arm feeds
`predict` the identical distribution of `fdr` values with the team-to-rating mapping destroyed. In
every season at every setting it is **worse than neutral** on both MAE and r, while the real ratings
are better. The information is in which opponent gets which rating, not in the spread of numbers.
Without this arm, "a spread of fdr values happens to help" would have been indistinguishable from
"the ratings know something".

**`priorGames` is deliberately not chosen from these numbers.** 2 and 8 clear 4/4; 4 clears 3/4,
failing 2026-27's bias by 0.002 against a ±0.01 tolerance. All three sit within 0.012 of each other
on a 471-row season and straddle the threshold non-monotonically — that is noise, and picking the
setting that passes would be the "acceptance threshold you invented is not evidence" trap. The
default stays 4, and it clears 3 of 4.

**The effect is small.** MAE improves ~0.5%, r by 0.005-0.026. Consistent, real, modest.

## 5. Why it does not ship, and what would justify shipping it

**The baseline is neutral. Production is not.** `ScoredPlayer.fdrRun` is populated from FPL's
*official* FDR on five pages. What has been measured is *derived beats no fixture adjustment at
all*. What has **not** been measured is *derived beats official* — because official FDR for past
seasons is not obtainable, which is why the harness pinned `fdr=3` in the first place.

Swapping `fdrRun` on this evidence would be claiming something the backtest never tested. So:
nothing is wired into `fdrRun`, no page changes, `MODEL_VERSION` unchanged.

**The gate that would justify shipping** is derived-vs-official on the current season, where
official FDR *is* available (`fixtures.team_h_difficulty` / `team_a_difficulty`). At GW3 that is
n=471 and far too thin to settle anything. Re-run from ~GW10, when the same walk-forward machinery
can score both arms against real 2026-27 results.

**A second follow-up, if it clears:** `predict` collapses fixture difficulty into one `fdr` scalar
with separate `attackAlpha`/`defenceAlpha` applied to it. `phase-4-model.md` already records that
one scalar cannot really express both halves. `fixtureDifficulty` computes the two halves separately
and then adds them precisely because that is what the model can consume today — splitting
`FixtureInput` into attack and defence terms is the natural next step, deliberately not bundled into
the change that first tests whether the signal exists.

## Verification

`npx tsx scripts/backtest-walkforward.ts` against live data — the harness is the verification, per
CLAUDE.md. Reconstruction checked independently with a throwaway harness (kept out of the commit):
760 sides per completed season, goals matching the real scorelines exactly, and the banded output
eyeballed against real 2026-27 team names. `npx tsc --noEmit`, `npm run lint`, `npm run build`.
