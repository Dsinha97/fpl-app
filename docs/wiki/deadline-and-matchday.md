# Deadline Hub & Live Matchday Hub

Two related, not-yet-merged surfaces for pre-deadline and in-play decisions.

## Deadline Hub (`/deadline`, built 2026-08-14)

Gathers every pre-deadline decision into one page — pure read/render over engines that already
exist, no new migration, function, or table: live countdown, `validateSquad` legality, per-player
availability alerts, an `optimiseLineup`-driven captain/XI recommendation diffed against the draft's
current picks (see [lineup-captain-bench.md](lineup-captain-bench.md)), an `optimizeTransfers` call
gated behind an explicit "Run optimiser" button (~1,875 simulations — too expensive to run
unprompted; see [transfer-engine.md](transfer-engine.md)), `benchBoostAt`/`tripleCaptainAt` for the
current gameweek only (see [chip-strategy.md](chip-strategy.md)), and a squad-scoped slice of
`change_feed` (see [data-pipeline.md](data-pipeline.md)).

It exists because none of Sprint 13, 15, or 17 were buildable this week (Sprint 13 needs a live
fixture, 15 needs Sprint 13's foundation, 17 needs completed gameweeks) — but a real gap remained:
nothing gathered pre-deadline decisions in one place. Built two shared helpers while touching every
page that had a copy: `availabilityFromStatus` (was pasted six times) and `loadSeasonContext` (was
pasted three or four times) — see [frontend-conventions.md](frontend-conventions.md).

**Once GW1's first fixture goes live, this page becomes the shell for `GameweekState`** — pre-
deadline planning and in-play tracking end up as the same route in two phases, not two separate
pages. — [roadmap.md](../roadmap.md#next-up)

## Live Matchday Hub (Sprint 13, staged, not built)

Deliberately not started: `sync-live-gameweek`'s row-writing path has never executed (it no-ops
without a live fixture, and GW1's deadline is 2026-08-21) — building a UI against an unverified
write path would itself be unverifiable. The only work done ahead of time is what costs nothing and
needs no live data: `player_live_stats`'s row count is now visible on `/status`, closing the one
observability gap (previously there was no way to see the write path finally fire without querying
the database directly).

**What it builds once live**: a `GameweekState` object — live score, provisional bonus, live overall
rank, pending auto-substitutions, captain effective ownership, a safety score for the bench/captain
decision already locked in. Every field already exists in `player_live_stats` or
`manager_gameweek_history` — a read/render sprint, not a new sync.

**GW1 dry-run checklist**, to run the moment the first fixture kicks off: confirm `sync-live-gameweek`
actually leaves its `skipped` branch on `/status`; spot-check one player's row against FPL's own live
score; only then build the render layer against real rows — a shape that looks right against a
forced `?force=1` dry run can still be wrong against what a live match actually populates.
— [sprint-13.md](../sprints/sprint-13.md)

See also: [data-pipeline.md](data-pipeline.md) (`sync-live-gameweek`'s cron and no-op guards),
[blocked-and-data-gaps.md](blocked-and-data-gaps.md).
