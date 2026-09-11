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

## Out-of-sample validation (Sprint 17a)

The calibration check above is season-aggregate and in-sample by construction — the season being
scored carries weight 0.6 in the model's own rate blend, and `positionCalibration` was fitted on
the same cohort. A walk-forward backtest asks a harder question: trained on strictly earlier
seasons only, how well does the model predict a gameweek it has never seen?

Backfilled `player_gameweek_stats` for 2022-23 through 2025-26 from the community-run
[Vaastav archive](https://github.com/vaastav/Fantasy-Premier-League) (`ingest-fpl-archive` — see
[data-pipeline.md](data-pipeline.md)), then ran the real, unmodified `predict()` for each of
2023-24/2024-25/2025-26, trained only on `player_season_history` rows strictly before that season.

**Result: at per-gameweek granularity, the model's MAE and Pearson r are both worse than a naive
mean-of-the-last-5-gameweeks baseline, in every one of the three seasons tested** — confirmed on
identical rows, not a row-mismatch artifact. Bias also trends more negative in more recent seasons
(−0.23 → −0.46 → −0.66), a material departure from the in-sample bias ≈ 0. This is not evidence of
a leakage bug — 2025/26 (weighted 0.6 in the rate blend) came out *worse* walk-forward than
in-sample, exactly as a real split should. It means `positionCalibration`, fitted once on a cohort
that is largely the same season as its own training data, does not survive being asked to predict
a gameweek it hasn't seen. — [sprint-17a.md](../sprints/sprint-17a.md)

Recalibration itself was deliberately **not** done in the same pass that found this — refitting on
the same run that produced the finding risks exactly the "tune until it looks reasonable" failure
[methodology.md](methodology.md) warns against. The evidence now exists; the refit is a follow-up
with its own held-out check.

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
- **No current-season form reaches the model — a fix was built and measured (2026-08-27), and did
  not clear the shipping gate.** `generate-predictions/index.ts` still reads `player_season_history`
  as its only per-player evidence; between any two gameweeks a player's xP still moves only on
  availability, price band, fixtures/FDR, and squad reconciliation, never on what they actually did.
  This was checked, not just asserted: `xp-model.ts` gained an additive, currently-unused
  `SeasonRow.games` field and a `deriveRatesWithPrior` `currentSeasonRow`/`currentSeasonWeight`
  parameter (appends the current season as a fourth term rather than displacing a prior one — see
  [phase-4-model.md §4](../phase-4-model.md#4-honest-limitations) for why displacing and a naive
  `games`-denominator both silently broke a nailed starter's `mpg`), then swept against a real
  within-season walk-forward extension of `scripts/backtest-walkforward.ts`. MAE and Pearson r
  improved in **every** backtest season at every weight tested — but 2024-25's bias magnitude
  worsened at every weight, and the gate needs all three seasons. **Not wired into
  `generate-predictions`**; `MODEL_VERSION` stays `v1.5.0`. No caller passes either new field today,
  so this is dormant, reviewed infrastructure for a future attempt, not a live code path.
  **Attempt 2 (Sprint 30, 2026-08-30) also failed the gate, and failed informatively.** Since the
  blend only ever failed on *bias* — MAE and Pearson r improved everywhere — a per-position additive
  intercept was swept alongside `currentSeasonWeight`, fitted **leave-one-season-out** so no season
  ever sees its own correction. Pearson r is invariant to an additive shift, so the sweep could only
  move the term the gate was failing on.

  It didn't. The correction learned from 2024-25 and 2025-26 — both arms under-predicting, strongly
  negative bias — is itself strongly negative, and applying it to 2023-24, whose blend arm was
  already near zero or slightly *over*-predicting, overshoots into a large positive bias instead of
  correcting anything (at `wCur` 0.3: 2023-24 goes +0.042 → **+0.514** while the other two clear).
  Every weight tested does this.

  That's a finding about the data, not a tuning failure: bias direction isn't stable enough across
  seasons for one global per-position constant to fix, and whatever makes 2023-24 read differently
  would have to be understood first. Per [methodology.md](methodology.md), the null result stands —
  the three-season gate was **not** narrowed to two-of-three to let it through. `MODEL_VERSION`
  stays `v1.5.0`. The sweep is kept permanently in `scripts/backtest-walkforward.ts`, so
  `npx tsx scripts/backtest-walkforward.ts` reproduces it.

  Note the *ingredient* is no longer missing — `players.form` is populated for 358 of 651 players as
  of 2026-09-02, and Sprint 30 restored it to `/compare`'s own weighting — see
  [risk-scoring.md](risk-scoring.md#consumers). What blocks the
  xP blend now is the backtest gate, not the data.
  — [sprints/sprint-30.md](../sprints/sprint-30.md#1-current-season-blend-attempt-2-per-position-bias-correction)
- **Out-of-sample accuracy is currently worse than a naive baseline** — see the walk-forward
  validation section above. (The current-season-form gap just above is the leading suspect why.)
- **Fixture difficulty is the official FDR**, not a custom model — and two custom ones have now been
  built without either reaching `fdrRun`. A *strength*-derived rating (Sprint 31) is display-only
  **permanently**, because `teams` holds one season with no history and so it can never be walked
  over by the backtest at all. A *results*-derived rating (Sprint 35) is backtestable, beats a
  neutral baseline in all four seasons with a scrambling control to prove it, and still does not
  ship — because the baseline it beat is *no fixture adjustment*, not the official FDR production
  actually uses. Full story, including the GW10 gate that would settle it:
  [fixture-difficulty.md](fixture-difficulty.md). The calibrated attack/defence fixture model
  (Phase 5, unbuilt) remains separately blocked on `strength_attack_*`/`strength_defence_*` still
  being zero for every club in-season — see [fpl-api-constraints.md](fpl-api-constraints.md).

## The accuracy scoreboard (shipped 2026-09-06)

`lib/prediction-accuracy.ts` shipped in Sprint 27 with **zero callers**, deliberately — a panel
built on one gameweek's residuals invites being read as a verdict. GW3 finishing took the usable
intersection of *archived* and *scored* gameweeks from n=1 to n=2, which is exactly the bar
`roadmap.md`'s Blocked table had named, so it unblocked on its own stated condition with no
judgement call. `components/accuracy-scoreboard.tsx` renders under "Warehouse contents" on
`/settings` → Pipeline — the deliberate exception to that page's sign-in wall.

What it reported on first render, cross-checked against an independent SQL computation of the same
join, every per-position row matching:

| Cohort | n | bias | MAE | RMSE | r |
|---|---|---|---|---|---|
| All players | 1,272 | −0.248 | 1.392 | 2.190 | 0.460 |
| GKP | 139 | −0.541 | 1.210 | 1.798 | 0.515 |
| DEF | 420 | −0.185 | 1.631 | 2.426 | 0.368 |
| MID | 562 | −0.213 | 1.309 | 2.143 | 0.500 |
| FWD | 151 | −0.282 | 1.208 | 1.987 | 0.532 |

The panel states the scored gameweeks, the residual count, and the bias **direction in words** next
to every signed figure; carries `ACCURACY_MODEL_NOTE` through `InfoTooltip`; names GW3's bonus as
*provisional* (all ten fixtures were `finished_provisional` but not `finished` at build time); and
says GW1 is permanently absent because the archive did not exist before its deadline. It is framed
as a running count, not a verdict. The 1000-row cap bug fixed on the way in is recorded in
[data-pipeline.md](data-pipeline.md#player_predictions-and-the-row-cap).

**The bias sign convention, stated once.** `accuracyStats` (`lib/stats.ts`) is
`mean(actual − predicted)`, so **negative bias means the model over-predicts**. `phase-4-model.md`
had it both ways — §2 predates the shared helper and uses `predicted − actual`, while the
walk-forward section called −0.375 "over-generous" and then three paragraphs later said the same
negative biases meant the arms "under-predict". The code was never ambiguous; the docs were, and
were corrected with the convention now stated once where the walk-forward tables begin.

### Attempt 3 at the current-season blend (Sprint 34, 2026-09-06) — also does not ship

2026-27 was added as a **fourth walk-forward target**, and reported as the weak season it is rather
than averaged in silently: the last-5 baseline cannot fire below six played gameweeks, so it prints
`n=0 — not enough played gameweeks yet` instead of a line of `NaN`, and the blend arm has events 2
and 3 only (n=468 vs 703 prior-only).

`ShrinkInput.currentSeasonScope` (`"all" | "minutes"`, defaulting to `"all"` so every existing
caller and earlier sweep is untouched) lets the current season move `mpg`/`start_share` while
holding per-90 scoring rates at prior-only — on the reasoning that the blend fails on *bias*, bias
is a level error, and level is set far more by expected minutes than by a per-90 rate, while
playing time is also the one thing a prior season genuinely cannot know.

**Verdict: `scope=all` clears 2 of 4 seasons; `scope=minutes` clears 2 of 4 at w=0.3 and 1 of 4
above. Neither ships.** Re-run once 2026-27 has 8-10 scored gameweeks, which is also when the
last-5 baseline starts producing rows for it.

**And the narrow-scope hypothesis is untested, not supported.** The first version of this sweep had
it clearing 3 of 4 against the full blend's 2, which read as real support. That result came from the
corrupted harness inputs described in
[methodology.md](methodology.md#a-harness-that-records-its-outputs-and-not-its-inputs-cannot-be-debugged)
and does not survive the fix — corrected, the full blend clears 2023-24 and the narrow scope fails
it. Nothing here confirms or refutes the idea; the run that appeared to test it was measuring noise.

**The `positionCalibration` refit stays not-done, deliberately.** Three gameweeks is far too thin —
the shipped factors were fitted on a 209-player full-season cohort, and refitting on ~1,200
player-fixtures would bake this season's noise into a permanent constant. The +0.248 production
over-prediction measured above is partly those factors being wrong for 2026-27; worth recording, not
worth acting on before ~GW10-12.
— [sprints/sprint-34.md](../sprints/sprint-34.md)

See also: [cold-start-priors.md](cold-start-priors.md) (what happens for players with thin or no PL
evidence), [methodology.md](methodology.md) (the "drop, renormalise, disclose" and "verify with a
harness" rules this model was built under).
