# Championship Cold-Start Priors (Sprint 15.6, built 2026-08-11)

**Status: built and deployed.** xP engine **v1.5.0**. See [cold-start-patch.md](cold-start-patch.md)
for phase 1 (empirical-Bayes shrinkage) and phase 2's history; this sprint is the first phase-2
external drop that actually cleared the gate.

## Why this exists

The owner supplied a plan to ingest per-player FootyStats PDFs (`docs/Promoted Team Data/<Team>/`)
for the three promoted clubs, to fill in the 99 players with zero Premier League evidence. The
plan's mechanics were wrong on inspection (it redefined `rate_priors`, an existing table with a
different meaning; used `players.fpl_id`, a column that doesn't exist; named all three of its
own worked examples — Leif Davis, Jaden Philogene, Alex Palmer — as cold-start cases when each
already carries real PL minutes; and hardcoded a single 0.65 league-translation factor across
every metric and position). But the underlying data was real: per-player, per-season stats with
percentile ranks, including the full CBIT defensive-action breakdown FPL scores defenders on —
something no other source in this repo has ever had for the Championship.

## What the data actually covers

`scripts/extract-footystats.ts` parses all 58 player PDFs (excluding the 3 team-level and 1
league-level PDF) into `docs/Promoted Team Data/extracted/footystats_championship_2025_26.csv`.
`scripts/match-and-gate.ts` joins those 58 rows to `players` by name (reusing the accent-folding
approach in `lib/player-search.ts`, plus 6 hand-verified nickname/apostrophe matches), then
re-runs the three-check gate from `cold-start-patch.md`:

- **Check 1 (distinct values):** 57 distinct metric-tuples across 57 matched players — no position
  archetypes, unlike the CSV that failed this same check on 2026-08-05.
- **Check 2 (genuine competition):** every row's `origin_league` is `EFL Championship`.
- **Check 3 (overlap with PL players):** resolved by splitting rather than rejecting — **33**
  players with zero PL minutes ever get a prior; **12** players who hold both a 450+ minute PL
  2024/25 season and a Championship 2025/26 PDF form the λ-fitting cohort instead (see below); the
  remaining **12** (some PL history, but not 450+ minutes in 2024/25) are excluded from both and
  used for nothing.
- One player (Amir Hadžiahmetović) has no corresponding row in `players` at all — reported, not
  silently dropped.

All 58 rows, including the 12 excluded and the 1 unmatched, are stored in
`external_player_seasons` (`supabase/migrations/20260811150000_external_player_seasons.sql`) —
raw values only, no translated columns, `matched_by`/`match_confidence` recorded per row.
`generate-predictions` reads only the 33-player subset (filtered live by joining on
`external_player_seasons.player_code`, not by a separate flag — a player with any real PL evidence
never reaches the branch that reads this table, so the filtering is structural, not a list).

## The λ fit — measured, not the supplied 0.65

Ipswich's Premier League → Championship → Premier League path is what makes a translation cohort
possible at all: 12 players hold both a 450+ minute PL 2024/25 season in `player_season_history`
and a 2025/26 Championship PDF. `scripts/fit-lambda.ts` fits one λ per metric, pooled (sum of PL
output ÷ sum of Championship output, minutes-weighted — not a mean of per-player ratios, which
blows up whenever a player's Championship denominator is near zero):

| Metric | λ | Note |
|---|---|---|
| `xg90` | **0.200** | |
| `xa90` | **0.280** | |
| `yellow90` (cards) | **0.844** | wide per-player dispersion (0.00–2.42); pooled on 34 PL + 40 Champ. events, not a near-zero count |
| `dc90` | **not fitted** | `player_season_history` has no `clearances_blocks_interceptions`/`tackles` for 2024/25 — nothing to compare against. Falls back to `position_price`, same as before this sprint. |

The supplied 0.65 (applied uniformly) is contradicted by the data it would have been applied to:
Leif Davis's own PL-vs-Championship ratio is 0.40 for xG and 0.78 for xA — not one number.

**Disclosed survivor bias, by direction:** the 12-player cohort is players good enough to have
played the Premier League who then played the Championship — better than a random Championship
player, so λ fitted on them is biased *optimistic*. That is the direction that hurts a manager who
trusts the number, the same asymmetry `cold-start-patch.md`'s phase-2 notes already flag for a
relegation cohort applied to promotion.

## The model seam — `mu` only, nothing else

`xp-model.ts` gains a sixth `PriorSource`, `"external_measured"`. It supplies the prior *mean*
only, for the metrics `MODEL_PARAMS.leagueTranslation` has a λ for, and only inside the
zero-evidence branch of `deriveRatesWithPrior`. `sigma2`, `tau2`, `n_eff`, and the shrinkage weight
itself are byte-for-byte untouched — a covered player's `reliability` stays `"low"` and `n_eff`
stays `0`. The number gets better; the stated confidence does not overclaim it.

## Verification

**Extraction correctness** — every field checked by hand against the raw PDF text for Leif Davis,
Alex Palmer, and Ellis Simms (one per layout: outfield-with-xA, goalkeeper, forward) before trusting
the automated run across all 58.

**A live `npx tsx` harness** (kept out of the commit, per the project rule) ran the real
`deriveRatesWithPrior`/`fitRatePriors` against live data, twice per player — with and without
`externalRates` — and asserted:
- **0 reliability flips** (low → medium/high) across all 577 players.
- **0 `n_eff` / `priorWeight` mismatches** between the two runs, for every player — proof the
  shrinkage weight itself is untouched.
- **0 rate differences** for the 544 players *not* covered by an external row.
- The 33 covered players' `xg90`/`xa90` moved to genuinely distinct, per-player values (not a
  shared position/price average) — including one striking real case: Raphael Borges Rodrigues
  (34 Championship minutes, 2 assists in that sample) jumps from `xa90` 0.096 to 0.540. Real, not a
  bug — his own tiny-sample rate is simply that noisy, and `reliability` stays `"low"` regardless,
  which is the whole point of the evidence gate.

**Deployed and verified live.** `generate-predictions` (edge function) was redeployed with the new
`xp-model.ts`/`index.ts` — the deployed bundle was fetched back and diffed line-for-line against
the local files (mod CRLF) to rule out a transcription error, then invoked for real:

```
model_version: "v1.5.0", players_predicted: 577, skipped_no_prior: 0
by_prior_source: { pl_recent: 471, position_price: 66, external_measured: 33, pl_extended: 7 }
```

`position_price` dropped from 99 → 66 (exactly the 33 reclassified); `pl_recent`/`pl_extended`
unchanged. A SQL comparison against a pre-deploy snapshot confirmed **0 differences** in `xp`,
`reliability`, or `prior_source` across 19,760 fixture-rows for the 544 uncovered players.

**No traditional backtest** (predicted vs. actual points) is possible for the 33 covered players —
there is no completed 2026/27 gameweek yet to test against, which is the cold-start problem itself.
The substitute is the check above: since the change is provably isolated to 33 previously-prior-only
players and touches no other player's rates, `positionCalibration` (fitted against the existing
backtest cohort) needs no refit — that cohort's bias/MAE/Pearson r are unchanged by construction.

## What was deliberately left out

- **`dc90`/CBIT translation** — the Championship-side data exists (full CBIT breakdown, all 58
  players), but no PL-side comparison data exists for 2024/25 to fit a λ against. Left on
  `position_price` rather than shipping an unfitted number.
- **`manager_blueprints` / tactical synergy** — the original plan's Sprint 10 proposed this; it is
  Sprint 12.5 phases 3–6, already blocked (`docs/roadmap.md`) because manager-side thresholds are
  transcribed opinion, not measured data. This sprint makes the *player*-side rates measurable
  (crosses/90, tackles/90, etc. are now real numbers for these 58 players) but does not touch the
  manager side, so the block stands — for a stated reason, not by default.
- **A recurring ingest pipeline.** The PDFs are a manual, dated snapshot (captured 2026-08-05), not
  a live feed. Re-running `scripts/extract-footystats.ts` next season means re-capturing new PDFs
  and re-running the match/gate/lambda scripts by hand.
