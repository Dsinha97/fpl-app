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

## Rivals: sync-before-write, and a rival with no career record still shows (2026-08-20)

`addRival` used to write straight to `manager_rivals` with no foreign key and no sync — a rival
only ever appeared once the owner separately typed the same ID into the main Manager ID form, which
does sync. It now calls `sync-manager` for the candidate first and shows the error inline without
ever writing an unresolvable row (verified against the deployed function: a nonexistent ID returns
`"Manager ID … not found on FPL"`, HTTP 404, nothing written).

A manager with zero completed seasons — no `manager_season_history` rows at all — used to be
dropped silently: `buildManagerProfile([])` returns `null`, and the old code treated that as "this
rival failed." `RivalRow` now carries `career` and `season` independently
(`career: CareerComparison | null`, `season: SeasonComparison | null`), so a first-season manager
still gets a row — "First season" under Career, a real line under This season once they've played a
gameweek. The section (career card, rivals, add-rival box) also no longer hides entirely when the
*owner* has no career record of their own; that gate used to hide the add-rival box for a
first-season owner too.

## Rivals now track the current season too, not just career (2026-08-20)

The "career, not current season" framing above described a real constraint at the time — pre-season,
nobody had a current rank. `sync-manager` was already writing `history.current` into
`manager_gameweek_history` for every synced entry; the rivals code just never read it. `RivalTable`
now has **This season / Career** tabs (styled on `/fixtures`' tab pattern); new
`buildSeasonToDate`/`compareSeasonToDate` in `lib/manager-profile.ts` read
`manager_gameweek_history` the way `buildManagerProfile`/`compareToRival` already read
`manager_season_history`. Every gap is `number | null` — null, not a fabricated 0, when either side
has no rows yet; before GW1 that's everyone, owner included, confirmed live against
`entry/274486/history` (`"current":[]`, even for the owner's own 10-season entry). Full detail:
[sprints/rivals-and-card-density.md](../sprints/rivals-and-card-density.md).

**Deliberately not built**: a composite volatility index (the spec's 0.50/0.30/0.20 weights are
uncalibratable on 7 loaded managers — the three components are shown side by side instead) and
manager archetypes (Ceiling Chaser vs. Conservative Grinder needs differential/transfer/chip
behaviour, which the FPL API exposes for the *current* season only — `manager_picks` FKs to the
current season's `players` and can't even store past-season behaviour if it could be fetched). Both
are recorded as blocked, not deferred, in [blocked-and-data-gaps.md](blocked-and-data-gaps.md).

See also: [manager_intelligence_sprint12_change_plan.md](../sources/manager_intelligence_sprint12_change_plan.md)
(the owner's source spec, with a reconciliation banner), [sprint-12.md §12A](../sprints/sprint-12.md#sprint-12a--manager-percentile-profile-built),
[rivals-and-card-density.md](../sprints/rivals-and-card-density.md) (the 2026-08-20 rivals fixes
above), [deadline-and-matchday.md](deadline-and-matchday.md#my-teams-squad-view-team-added-2026-08-15)
(`/team`'s other section, added 2026-08-15 — the Current squad / Gameweek result pitch view, a
different topic on the same page).
