# Club tactical profiles

20 Premier League clubs' head-coach tactical data (formation, buildup style, pressing intensity,
role preferences), shown as disclosed context on the Clubs tab of `/fixtures` and in player detail —
Sprint 12.5, built 2026-08-07 as a **scoped-down** slice of a larger patch plan.

## The naming collision

This app already uses "manager" for the **FPL fantasy manager** (the owner, ID 274486) — `managers`,
`manager_season_history`, `lib/manager-profile.ts` (see [manager-profile.md](manager-profile.md)).
This feature's "manager" is a **real-world PL head coach**. Shipped under entirely different names to
avoid the collision: `pl_managers` table (not `manager_profiles`), `teams.tactical_manager_id`, and
`lib/tactical-profile.ts` (not `manager-profile.service.ts`, which would have collided with the file
that already existed).

## What shipped vs. what's blocked

**Built, as disclosed non-multiplicative context**: the database (`pl_managers`,
`20260807130000_pl_managers.sql`, seeded from [pl-manager-profiles.json](../pl-manager-profiles.json)),
the tactical knowledge base (traits/modifiers stored verbatim as provenance, not as an input to
arithmetic — `lib/tactical-profile.ts` is deliberately just types + a loader, no scoring function),
and UI surfaces (a one-line summary on player detail, a fuller 20-club table on `/fixtures`, both
behind `TACTICAL_PROFILE_NOTE`).

**Blocked, not built**: the plan's core idea — a `μ_fit` multiplier folding tactical fit into xP
itself (`xP = Base × Fixture × Minutes × Availability × μ_fit`). The reason is data quality, not
effort: the modifiers (e.g. `1.05`, `"+15% xA in high-offside trap games"`) are **transcribed
opinion** — hand-turned numbers from tactical-breakdown video/article titles, not measured data, the
same risk class as the rejected cold-start CSV in [cold-start-priors.md](cold-start-priors.md). And
they key on abstract player roles (`inverted_pivot`, `wide_crosser`) that exist in no data source
this app has — FPL exposes position, not tactical role — so applying the multiplier at all would
first require hand-authoring 573 more subjective role labels. The cold-start integration variant
(`C_manager` scaling inside `deriveRatesWithPrior`) is flagged as the single highest-risk phase: it
would sit on top of shrinkage weights that were out-of-sample validated, and an uncalibrated
multiplier could quietly undo that validation.

**Resolution**: the same pattern this repo already uses for an unmeasurable-but-real term —
[methodology.md](methodology.md#when-a-term-cannot-be-dropped-make-it-an-input) — except here the
number isn't disclosed as a user input either, since there's no honest input to expose; it's shown
as reference text only, pending a real per-player role source and a backtest.

A second proposal hit the same wall for a related reason (Sprint 18): a GW1-3 xP penalty for
players under a first-season manager. Refused on three grounds — `pl_managers` has no start
date/tenure field at all, so nothing here can even say *which* clubs qualify; folding it into xP
would be the same kind of reviewed change this page's `μ_fit` already isn't; and the penalty size
would be an invented coefficient. Logged in
[blocked-and-data-gaps.md](blocked-and-data-gaps.md), with the empirical version queued once a
tenure source exists — Sprint 17a's backfilled per-gameweek data could test "do first-season-manager
players underperform their prior rate early on" directly. — [sprint-18.md](../sprints/sprint-18.md)

See also: [PL_Team_Manager_Intelligence_Patch_Plan.md](../sources/PL_Team_Manager_Intelligence_Patch_Plan.md)
(the owner's source spec), [sprint-12.md §12.5](../sprints/sprint-12.md#sprint-125--pl-team-club-manager-intelligence-buildable-slice-built-2026-08-07).
