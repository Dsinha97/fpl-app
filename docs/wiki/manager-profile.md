# Manager percentile profile

The owner's own career FPL performance, shown on `/team` — Sprint 12A, `lib/manager-profile.ts`.
Not to be confused with [club-tactical-profiles.md](club-tactical-profiles.md)'s PL club managers —
see the naming note there.

## FPL already ships the percentile

`entry/{id}/history` returns `rank_percentage` per past season at sub-1% precision, already
ingested into `manager_season_history`. FPL's own convention is **lower is better** ("top X%");
`lib/manager-profile.ts` converts it to a **0–100, higher-is-better** `percentileScore` for display
— the one place in this app that flips the direction, so nothing else should assume FPL's raw
convention. The original change plan proposed reinventing this via a hand-maintained
`season_field_sizes` table and a `1 − (rank−1)/(field−1)` formula; skipped, since it would just
reproduce a number FPL already gives away, using historical field sizes that aren't in any API and
would go stale.

## What's built vs. blocked

Built: best/median/worst/spread/trend over the loaded seasons, with a confidence gate below 3–6
seasons, and rival comparison (percentile gap) against explicitly-added rivals
(`manager_rivals` — replaced an earlier version that scanned every row in `managers`, which leaked
every connected user's team to every other user the instant there was more than one account).

**Deliberately not built**: a composite volatility index (the spec's 0.50/0.30/0.20 weights are
uncalibratable on 7 loaded managers — the three components are shown side by side instead) and
manager archetypes (Ceiling Chaser vs. Conservative Grinder needs differential/transfer/chip
behaviour, which the FPL API exposes for the *current* season only — `manager_picks` FKs to the
current season's `players` and can't even store past-season behaviour if it could be fetched). Both
are recorded as blocked, not deferred, in [blocked-and-data-gaps.md](blocked-and-data-gaps.md).

See also: [manager_intelligence_sprint12_change_plan.md](../sources/manager_intelligence_sprint12_change_plan.md)
(the owner's source spec, with a reconciliation banner), [sprint-12.md §12A](../sprints/sprint-12.md#sprint-12a--manager-percentile-profile-built),
[deadline-and-matchday.md](deadline-and-matchday.md#my-teams-squad-view-team-added-2026-08-15)
(`/team`'s other section, added 2026-08-15 — the Current squad / Gameweek result pitch view, a
different topic on the same page).
