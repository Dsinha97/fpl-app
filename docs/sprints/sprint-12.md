# Sprint 12 — Chip Strategy Engine

**Status: built (2026-08-07), plus sub-sprints 12A, 12.5, 12.6.** See [../roadmap.md](../roadmap.md)
for the sprint index.

`/chips`, `lib/chips.ts` — per-gameweek value for Bench Boost, Triple Captain, Free Hit and Wildcard
over the projected window, plus a joint schedule that places all four without reusing a gameweek.
`ChipValue = xP(with chip) − xP(without)`, per `chip_definitions`' real windows (GW1–19, GW20–38).

**One new primitive, everything else reused.** `lib/chips.ts` adds a per-gameweek-event view of a
squad and pool, then reuses `optimiseLineup` (`lib/lineup.ts`) for Bench Boost/Triple Captain and
`optimizeSquad` (`lib/optimizer.ts`) for Free Hit/Wildcard unchanged — so the knapsack fill-order fix
and the bench sub-probability maths stay defined in exactly one place, per CLAUDE.md's "one quantity,
one implementation" rule. Squads are compared with `projectAtEvent`
(`lib/transfer-optimizer.ts`) or a windowed sibling that mirrors its formula for an arbitrary
gameweek range — needed because Wildcard's remaining-window horizon doesn't fit any of the fixed
`1 | 3 | 5 | 8 | "season"` horizons.

**Measured, not assumed: today's fixture list has no blanks or doubles anywhere.** Every gameweek
1–38 currently has all 20 clubs playing exactly once (counted from `fixtures` directly). Blanks and
doubles are created later by cup postponements. Bench Boost and Triple Captain draw most of their
real value from a double gameweek; Free Hit's canonical use is a blank. So every chip value today is
driven by fixture difficulty alone and reads comparatively flat — a real answer from an incomplete
fixture list, not a bug, but one the page must say out loud rather than present a near-tie as a
recommendation. `countBlanksAndDoubles`/`chipModelNote` compute this from `fixtures` at call time, so
the disclosure updates itself the moment a real double appears, with no code change.

**Only the first chip window is evaluable.** Predictions reach GW19; the GW20–38 half of every chip
is reported *blocked*, with its reason, rather than silently omitted — the same treatment
`transfer-optimizer.ts`'s wildcard row already gives an unavailable option: "a blocked option that
vanishes reads as a bug; its reason is information."

**Bench Boost is shown net of what auto-subs already deliver.** `optimiseLineup` already prices the
bench's expected contribution *without* the chip (`benchExpectedContribution`); charging for it again
would overstate every Bench Boost by however much the bench already earns on a normal week.

**Triple Captain reports two figures** — the gain with today's armband, and with the model's own best
captain for that gameweek — because the best target is often not today's captain, and collapsing the
two would hide a choice the user still has.

**Free Hit always re-optimises the armband for its one-week squad; Wildcard does not.** A Free Hit
squad is rebuilt from scratch for one week, so its captain is re-picked for it. A Wildcard squad
persists, so its captain is a separate decision the user still has to make — carrying the current
armband forward when it survives the rebuild, and disclosing understatement when it doesn't, mirrors
`transfer-optimizer.ts`'s wildcard branch exactly. This is also why a Wildcard valued over a
one-gameweek remaining window does not equal Free Hit's gain for the same gameweek even though both
rebuild the identical squad (verified directly) — the two differ by the captain-bonus term alone, by
design, not a bug.

**A real bug the verification harness caught.** `windowTotal` (Wildcard's remaining-window sum)
originally defaulted a missing prediction to `0` rather than `null`. `optimizeSquad` treats a `null`
projection as "no data" (excluded from the cheapest-real-pick reserve floor) and a `0` as a genuine,
if unappealing, projection (included) — so a player with no prediction at all was being read as a
real zero-xP pick, skewing which players the reserve floor considered. The same reserve-floor failure
mode the squad optimiser already exhibited (see [sprint-09.md](sprint-09.md)), caught this time by the
`tsx` harness against live data before it reached the UI, not by code review.

**Joint schedule, not a bare ranking.** Assigning chips to distinct gameweeks within a half is a small
exact search (a few dozen candidate gameweeks per chip), so it is brute-forced rather than
approximated, and the result reports its margin over the next-best assignment — so a schedule built
from a flat set of values reads as illustrative rather than a confident recommendation, which is what
today's blank/double-free fixture list actually produces.

## Post-ship fixes and extensions (2026-08-07)

Two real defects, found by the owner using the shipped page, plus three follow-on extensions.

**Bug 1 — the joint schedule silently discarded the second half's chip use.** `chip_definitions`
holds two windows per chip (GW1-19, GW20-38 today — FPL grants each chip once per half), and
`runChipEngine` correctly valued every gameweek in both, but `bestSchedule` only ever assigned one
slot per chip name across the *entire* season. The second half's Bench Boost/Triple Captain/Free
Hit/Wildcard was computed and sitting in the calendar table but never reachable from the schedule.
Fixed: `bestSchedule` now runs once per half (grouping `chipDefinitions` by chip, then zipping each
chip's Nth window together as "half N", robust to windows starting on slightly different gameweeks
across chips — wildcard opens GW2, the others GW1). Two independent `ChipHalfSchedule`s are returned
and rendered as two blocks.

**Bug 2 — the schedule total mixed incompatible units.** Wildcard is valued cumulatively over the
rest of its half (a permanent rebuild), while Bench Boost, Triple Captain and Free Hit are each a
single gameweek's gain (nothing persists). The old single "Total" summed all four into one number —
a season-long figure added to three one-week figures, which meant nothing. Fixed: `ChipHalfSchedule`
splits `oneOff` (BB + TC + FH, genuinely additive, its own total and margin) from `wildcard` (its own
best gameweek, reported separately, never summed). `chipModelNote` now also discloses that every chip
is still valued against *today's* squad regardless of what the schedule plays first — a Triple
Captain shown after a scheduled Wildcard does not yet reflect the rebuilt squad, since the engine
doesn't model chip-to-chip interaction.

**Wildcard toggle on `/transfers`' manual basket.** The optimizer panel's own Wildcard row already
waived the hit internally (`freeTransfers: moves.length`), but a user building a custom basket by
hand had no way to do the same — any basket beyond the free-transfer count was charged normally. An
"Apply as Wildcard (no hit)" checkbox now does exactly that, gated on the same window check the
optimizer panel already computes plus a check that the draft doesn't already carry a different active
chip (the same guard `transfer-optimizer.ts`'s own wildcard branch applies). Applying sets the new
draft's `activeChip` to `"wildcard"` and leaves `freeTransfers` untouched — a wildcard spends the
chip, not a free transfer.

**Bench Boost / Triple Captain inline on `/builder` and `/scenarios`.** Both are one `optimiseLineup`
call, cheap enough to run on every edit; `benchBoostAt`/`tripleCaptainAt` (`lib/chips.ts`) are now
exported and reused directly rather than reimplemented. Both pages build a `PredAt` scoped to the
next gameweek entirely from data already loaded (`xp_1`, the loaded prediction row, the first
fixture's FDR) — no new fetch. Free Hit and Wildcard stay off both pages: each is a full-squad
rebuild search that already takes several seconds on `/chips` alone, and running it on every builder
edit would make the page unusable — both pages link to `/chips` for them instead.

## Sprint 12A — Manager Percentile Profile (built)

`docs/manager_intelligence_sprint12_change_plan.md` proposed a Manager Intelligence & Rank
Normalization workstream alongside Sprint 12. This is the executable subset — a career percentile
profile and rival comparison on `/team` — scoped to what the data actually supports, with no new
tables and no new Edge Functions: every quantity is a deterministic statistic over the season rows
`/team` already fetches, computed in `lib/stats.ts` and `lib/manager-profile.ts`.

**FPL already ships the percentile.** `entry/{id}/history` returns `rank_percentage` per past season
at sub-1% precision, already ingested into `manager_season_history.rank_percentage` and already
rendered on `/team` as "Top X%". The change plan's proposed `season_field_sizes` table and
`1 − (rank−1)/(field−1)` formula would reinvent it — and worse, historical field sizes are not in any
API, so that table would be hand-entered constants going stale to reproduce a number FPL gives away.

**Over half the proposed capabilities are blocked, more permanently than Sprint 10.** Measured against
the live database: `manager_season_history` held 60 rows (7 managers, 4–13 seasons each);
`manager_gameweek_history`, `manager_picks`, `manager_transfers` and `manager_chips` held **zero**.
The gameweek tables are empty because it is pre-season, but the FPL API exposes no picks, transfers or
chips for *past* seasons at all, and `manager_picks` carries a hard FK to `players(season, id)` where
`players` holds only the current season — so past-season behaviour cannot be stored even if it could be
fetched. Transfer/captain/differential/chip aggressiveness, hit frequency and template dependence are
therefore not a 12A deliverable; they begin to accrue for the *current* season from GW1.

`total_players` (bootstrap-static) is a moving target — **2,889,243** in early August, climbing toward
~11M by GW1, a ~4× swing — so it is captured into `game_settings` (`sync-bootstrap`) but used by
nothing yet; `game_settings.updated_at` is the sample-time record.

**Decisions taken**: use `rank_percentage` as canonical, no composite volatility index (§7's
0.50/0.30/0.20 weights are uncalibratable on 7 managers — the three components are reported side by
side instead), and archetypes deferred entirely rather than classified on half the inputs (Ceiling
Chaser and Conservative Grinder are indistinguishable without differential exposure).

| §3 capability | Status |
|---|---|
| Historical percentile, consistency, volatility, best/worst, median | **Built** |
| Basic rival analysis (percentile gap) | **Built** — career comparison, 7 managers loaded |
| Manager archetype | Deferred — needs behaviour |
| Risk appetite, transfer/captain/differential/chip aggressiveness, hit frequency | Blocked — no historical behavioural data; accrues from GW1 |
| Template dependence | Doubly blocked — needs Sprint 10 *and* picks |

**Not scheduled by the change plan, but a real prerequisite**: `generate-predictions` ran a fixed
8-gameweek window, extended 2026-08-06 — see [additional-info.md](additional-info.md), "Pre-Sprint-12
finishing batch".

## Sprint 12.5 — PL Team (Club) Manager Intelligence (buildable slice built, 2026-08-07)

[PL_Team_Manager_Intelligence_Patch_Plan.md](../PL_Team_Manager_Intelligence_Patch_Plan.md) (owner's
patch plan, kept unedited) proposes a tactical layer: each PL club's head coach gets a profile —
formation, buildup style, pressing intensity, role preferences per position, and numeric modifiers —
which multiplies into xP as a `μ_fit` term, feeds the cold-start prior, and ranks replacements. Data
is [pl-manager-profiles.json](../pl-manager-profiles.json), 20 profiles verified to cover all 20
current-season clubs including this season's promoted/newly-arrived four (Coventry, Hull, Ipswich,
Leeds) and Sunderland.

Two problems need resolving before this can be built as specified, plus one naming collision.

**Naming collision: "manager" already means something else here.** `managers` /
`manager_season_history` / `manager_gameweek_history` / `manager_picks` / `manager_transfers` /
`manager_chips` and `lib/manager-profile.ts` all refer to the **FPL fantasy manager** (the owner,
ID 274486) — Sprint 12A is literally titled "Manager Percentile Profile" and is already built on that
name. This patch's "manager" is a **real-world PL head coach**. Ship it under different names
throughout: a `pl_managers` table (not `manager_profiles`), `teams.tactical_manager_id` (not
`clubs.manager_id` — there is no `clubs` table, it's `teams`), and `lib/tactical-profile.ts` /
`system-fit.ts` (not `manager-profile.service.ts`, which collides with the file that already exists).
The plan's `MODEL_VERSION = v1.2` in Phase 4 also collides — the shipped cold-start-plus-reconciliation
model is already `v1.2.0`; a future bump here is `v1.3.0`.

**The modifiers are transcribed opinion, not measured data — the same shape of risk as the rejected
promoted-player CSV.** Values like `1.05` / `1.15` / `1.20` (set-piece bias) and strings like `"+15%
xA in high-offside trap / vertical transition games"` come from `source_file` entries that are
tactical-breakdown video and article titles (e.g. "Marco Rose's FM26 Blueprint", "How a Set-Piece
Coach Is DESTROYING The Premier League") — qualitative scouting judgment, hand-turned into numbers.
Multiplying that straight into `xP = Base × Fixture × Minutes × Availability × μ_fit` is exactly what
"An acceptance threshold you invented is not evidence" and "Never tune an invented coefficient until
the answer looks reasonable" (both in [../../CLAUDE.md](../../CLAUDE.md)) exist to catch, and it
compounds: the tactical traits key on abstract player roles (`inverted_pivot`, `transition_runner`,
`wide_crosser`, `box_presence_target`) that exist in no data source this app has — FPL gives position,
not tactical role — so matching a real player to a role would mean hand-authoring 573 more subjective
labels *before* the unmeasured multiplier is even applied. Phase 5's cold-start integration
(`w'(N) = w(N) × (1 − C_manager)`) is the sharpest version of this risk: `C_manager` is itself
undefined and unmeasured, and folding it into `deriveRatesWithPrior` would sit on top of shrinkage
weights that were out-of-sample validated (beat both the raw thin-sample rate and the pure prior) —
an uncalibrated multiplier could quietly undo that validation.

**Resolution, following the pattern this repo already uses for exactly this tension**
(`decisionMargin` in `transfer-optimizer.ts`: "when a term cannot be dropped, make it an input"): ship
the tactical data as **disclosed, non-multiplicative context**, not as a term inside xP, until there
is a way to validate it.

| Phase (as numbered in the patch plan) | Status here |
|---|---|
| 1 — Database | **Built.** `pl_managers` (`20260807130000_pl_managers.sql`), `teams.tactical_manager_id`. Seeded as a one-off migration (static reference data, no sync cadence — same treatment as `chip_definitions`), not an Edge Function. |
| 2 — Tactical Knowledge Base | **Built** — traits/modifiers stored verbatim as given in `tactical_traits`/`modifiers` jsonb; provenance for a human reader, not an input to arithmetic. `lib/tactical-profile.ts` is deliberately thin: types and a loader, no scoring function. |
| 7 — Team Builder badges / 8 — Scenario Lab explanations / 9 — Explainability | **Built, as text.** A one-line `System` summary in `components/player-detail.tsx` (`tacticalSummary`), and a fuller 20-club section carrying formation, buildup style, pressing intensity, the traits, the source-figure modifiers, and `source_file` provenance — all behind `TACTICAL_PROFILE_NOTE`, same disclosure pattern as `RISK_MODEL_NOTE`. |
| 3, 4 — System Fit multiplier, xP integration | **Blocked on validation**, not on data. Needs a real per-player role source (not hand-authored) and a backtest showing the multiplier explains variance the current model misses, once 2026/27 results exist to check against — the same bar the cold-start patch and `positionCalibration` were both held to. |
| 5 — Cold-start `C_manager` scaling | **Blocked**, and flagged as the highest-risk phase — see above. Do not touch `deriveRatesWithPrior`'s validated shrinkage without the same out-of-sample test that validated it. |
| 6 — Replacement Finder System Fit Score | **Blocked**, downstream of 3/4. |
| 10 — Research pipeline | Deferred — a process question (how the owner keeps profiles current), not a build item. |

**Alias map, verified on the live `teams` table.** 7 of 20 clubs have a different name in the JSON
than in `teams.name` (`Brighton & Hove Albion`/`Brighton`, `Leeds United`/`Leeds`, `Manchester
City`/`Man City`, `Manchester United`/`Man Utd`, `Newcastle United`/`Newcastle`, `Nottingham
Forest`/`Nott'm Forest`, `Tottenham Hotspur`/`Spurs`). The seed migration maps these explicitly and
asserts 20 of 20 clubs linked, raising an exception rather than partially seeding if the assertion
fails — verified live, all 20 linked correctly including all 7 aliased ones.

**Player role tagging is a second data-quality question, separate from the manager profiles
themselves.** If the owner wants to supply it, it should get the same three-check treatment recorded
in [cold-start-patch.md](cold-start-patch.md) for the rejected CSV: per-player values (not position
archetypes), a genuine source, and disclosed provenance — before it is trusted anywhere near a
multiplier.

## Sprint 12.6 — Defensive Contribution engine fix, plus five surface fixes (built, 2026-08-08)

Five observations from using the app. Four were small surface fixes; the fifth ("add an xDefcon
field") uncovered a real deflation bug in the xP engine, so most of this sprint is the fix and its
backtest gate.

**xDefcon — why it couldn't just be surfaced.** The FPL API only tracks `defensive_contribution`
from 2024/25 onward; every `player_season_history` row from 2023/24 and earlier reads a real `0`,
not a missing value. `deriveRates`, `weightedOwnRates` (the path actually used since v1.1.0) and
`fitRatePriors`'s `metricValue` all blended `dc90` over the *same* multi-season minutes denominator
as every other rate, so a zero-DC season silently divided the true rate down by its share of the
blend. Verified before the fix: league-max `dc90` was 10.43 against thresholds of 10 (DEF) / 12
(MID), and `rate_priors.mu` for `dc90` was 4.51/90 (DEF) and 5.00/90 (MID) — both roughly half of
what the 2025/26 season alone implies (`sum(defensive_contribution)/minutes*90` over that one season
tops out near 15/90).

**Fix: `deriveDcEligibleSeasons`** (`supabase/functions/_shared/xp-model.ts`) derives the eligible-
season set from the data itself (any season where any player recorded `defensive_contribution > 0`)
rather than hardcoding a season list, so it self-updates as more seasons accumulate real data. `dc90`
gets its own minutes denominator restricted to that set, in `deriveRates`, `weightedOwnRates` and
`metricValue` (which now returns `null` — dropping the row — for an ineligible season, rather than
`0`). Verified live: post-fix `rate_priors.mu` for `dc90` rose to 7.56/90 (DEF) and 8.43/90 (MID).

**Calibration refit, gated on the phase-4 backtest cohort.** Raising `dc90` raises DEF/MID xP, so
`positionCalibration` needed refitting by the same mean-matching method [../phase-4-model.md](../phase-4-model.md)
§2 documents. Measured on a 209-player, ≥1200-minute, currently-available cohort against 2025/26 actuals
(`xp_8/8` vs `total_points/38`) via `execute_sql`, immediately before and after each deploy — not a
committed harness, following the same discipline as prior refits:

| Metric | Pre-fix (measured) | Post-dc90-fix, pre-refit | Post-refit (v1.4.0) |
|---|---|---|---|
| Bias (overall) | −0.115 | −0.060 | **0.000** (by construction) |
| MAE (overall) | 0.454 | 0.455 | **0.449** |
| RMSE (overall) | 0.574 | 0.574 | **0.567** |
| Pearson r (overall) | 0.830 | 0.832 | **0.839** |
| Pearson r — GKP / DEF / MID / FWD | 0.778 / 0.838 / 0.825 / 0.829 | 0.733 / 0.844 / 0.843 / 0.804 | 0.733 / 0.844 / 0.843 / 0.804 |
| `squad_consistency_violations` | 24–32 (fluctuates run to run) | 32 | 32 |

Per-position Pearson r is bit-identical between the dc90-only run and the refit — expected, since a
level correction cannot change within-position ranking. The pre-fix→post-dc90-fix GKP/FWD dip (0.778
→ 0.733, 0.829 → 0.804) is **not attributable to this change**: `dcThreshold` is 0 for GKP so
`defensiveContribution` never enters its `predict()` output at all, and `dc90`'s prior importance for
GKP (`mu = 0`) means it cannot move GKP's `priorWeight` either — the shift is data drift between two
live runs roughly an hour apart (small-n cohorts, n=18 for both GKP and FWD), not a code effect. DEF
and MID — the positions the fix actually touches — both improved. Shipped as **xP engine v1.4.0**;
refit factors `GKP 1.265, DEF 1.2241, MID 1.2238, FWD 1.2576` (from `1.1077 / 1.2224 / 1.2116 /
1.1972`) — DEF and MID barely moved, since raising `dc90` had already zeroed most of their bias
before the refit.

**Schema.** `20260808160000_horizon_xdc.sql` adds `xdc_1/3/5/8/19/total` to `player_xp_horizons`,
same drop-and-recreate pattern as the view's three prior migrations (`CREATE OR REPLACE` cannot
insert mid-projection columns). Verified live: `xdc_5` matches a hand-summed `player_predictions`
window for spot-checked players exactly.

**Surfaces.** `xDefcon` column on `/players` (DEF/MID only — GKP/FWD show `—` rather than a
misleading `0.00`, since `dcThreshold` is 0 for GKP and FWD's own rate is negligible) and a matching
row on `/compare`, both behind `XDC_MODEL_NOTE` (`lib/scoring.ts`). The note discloses the one gap
the engine fix does not close: FPL scores defenders on CBIT and midfielders/forwards on CBIRT
(including recoveries), but the model applies one aggregate `defensive_contribution` count to both,
because that is the only qualifying-action total the API exposes as a single number.
`clearances_blocks_interceptions`, `recoveries` and `tackles` are stored in `players` /
`player_gameweek_stats` / `player_season_history` but read by no code path — a position-correct split
is separate future work.

**`/players` gained a horizon control** (`HORIZONS` from `lib/team-state.ts`, same button group
`/compare` already used), retiring the hardcoded `RUN_LENGTH = 5` and the xP column's fixed `xp_5`.
The horizon now drives the fixture ticker, the xP column and the xDefcon column together. Fixtures
are fetched unbounded and sliced client-side via `horizonLength`, the same pattern `/compare` already
uses for the same reason (the horizon can reach "season").

**Select-to-compare.** `/players` rows gained a leading checkbox (up to `MAX_COMPARE`, now a shared
constant in `lib/scoring.ts` rather than redeclared in both pages — `/compare` imports it too), a
sticky bottom bar once ≥2 are selected, and a "Compare N players →" link to `/compare?ids=…`, the
same query param `/compare` already reads for the builder's replacement-finder deep link.

**Chip disclosure.** `lib/chips.ts`'s per-gameweek loop clamped `from = max(def.startEvent,
windowStart)`, so a gameweek before a chip's own window (Wildcard/Free Hit's `start_event = 2`
leaving GW1 unplayable) simply had no entry — silently absent rather than shown blocked, unlike the
"`Predictions only reach GW…`" case three lines above it in the same function. Now emits a
`blockedValuation` for each such gameweek with reason `"<Chip> opens GW<N>."`, and `/chips`'s
per-gameweek grid renders it as a titled `—` instead of treating the (previously nonexistent, now
present-but-blocked) row as a genuine `+0.0`. The GW1 greying itself was correct — `chip_definitions`
really does say `start_event = 2` for 2026-27 — only the missing disclosure was the bug. `/transfers`'
matching tooltip now names the rule ("Wildcard opens GW2 — FPL doesn't allow it before then") rather
than only the gameweek number.

**Draft handoff.** `/builder`'s "Free Hit & Wildcard schedule" link, `/scenarios`' "Chip Strategy"
link, and any future draft-aware link now carry `?draft=<id>`, read by a new shared
`resolveRequestedDraft` helper (`lib/drafts.ts`) that both `/chips` and `/transfers` call in their
init effects — extracted rather than copied a third and fourth time, following `/builder`'s own
existing `?draft=` pattern. `listDrafts()` sorts by `updatedAt` descending, so without this every
target page defaulted to whichever draft was most recently *edited*, not the one actually being
looked at.

**Club tactics moved from `/team` to a third "Clubs" tab on `/fixtures`.** The Sprint 12.5 20-club
grid was ~160 lines sitting below the "Connect your FPL team" empty state on a page otherwise
entirely about one manager's squad — a league-wide reference table with no natural home there.
`/fixtures` already had tab machinery (`schedule | fdr`) and already loaded the `teams` row the grid
needs; extracted into `components/club-tactics.tsx`, unchanged in content and disclosure
(`TACTICAL_PROFILE_NOTE`).
