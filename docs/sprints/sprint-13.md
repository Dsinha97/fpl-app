# Sprint 13 — Live Matchday Hub

**Status: staged, not built (2026-08-09).** See [../roadmap.md](../roadmap.md) for the sprint index.

Not started, deliberately: GW1's deadline is 2026-08-21, and `sync-live-gameweek`'s
row-writing path has never executed in production — it skips whenever there is no current
gameweek or no live fixture ([../architecture.md](../architecture.md)), and both guards have been true every
day since the pipeline shipped. Code and a UI written against an unexercised write path
would be unverifiable until a real match kicks off, so Sprint 14 was taken first and this
sprint's groundwork was limited to what costs nothing and needs no live data to be correct:

- **`player_live_stats`'s row count is now visible on `/status`** (`app/status/page.tsx`),
  closing the one observability gap the exploration found — previously the table wasn't in
  the warehouse-contents grid at all, so there was no way to see the write path finally
  fire without querying the database directly.

**What Sprint 13 builds, once GW1 is live** — a `GameweekState` object surfaced on `/team`
(or a new `/live` page): live score, provisional bonus, live overall rank, pending
auto-substitutions, captain effective ownership, and a "safety score" for the bench/captain
decision already locked in. Every field is already in `player_live_stats` (`bonus`, `bps`,
`in_dreamteam`, the live per-gameweek aggregate) or reachable from `manager_gameweek_history`
— this is a read/render sprint, not a new sync.

**GW1 dry-run checklist**, to run the moment the first fixture kicks off:

1. Confirm `sync-live-gameweek` actually leaves its `skipped` branch — `/status`'s "Last run
   per function" row should read `success`, not `skipped`, and the new "Live-gameweek rows"
   count on the warehouse-contents grid should move off zero.
2. Spot-check one player's `player_live_stats` row against the FPL app's own live score for
   the same fixture — `bonus`/`bps` are provisional mid-match and can still move.
3. Only after that passes: build the `GameweekState` render layer against real rows, not
   `?force=1` synthetic ones — a shape that looks right against a forced dry run can still
   be wrong against what a live match actually populates (see CLAUDE.md's "verify engine
   changes against live data" precedent from the squad-optimiser and beam-search bugs).
