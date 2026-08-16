# Deadline Hub & Live Matchday Hub

Related, not-yet-merged surfaces for pre-deadline and in-play decisions — Deadline Hub and My
Team's Squad view (both built), and Live Matchday Hub (staged, not built).

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

### Extended 2026-08-15: defaults to the imported squad, gains a pitch

At launch neither `/deadline` nor `/team` treated the squad pasted from FPL
(`teamStateFromMyTeamJson`, real purchase prices — see [fpl-authentication.md](fpl-authentication.md))
as the squad that matters most, and `/deadline` had no squad *visual* at all. Two changes:

- **Both pages default to the manager's own import**, not whichever draft is newest —
  `resolveRequestedDraft`'s new preference, matched by `entryId` first (see
  [fpl-authentication.md](fpl-authentication.md) for the naming consolidation this needed). A
  `?draft=` link still overrides it, so a deep link from `/builder` keeps working.
- **A new, read-only Squad section** renders on `/deadline` directly under the countdown, via
  `PitchView` generalised to draw either a projection or a known XI (see
  [frontend-conventions.md](frontend-conventions.md#one-pitch-component-for-a-projection-or-a-known-xi)).
  It shows the XI the owner actually set, not the optimiser's recommendation — the existing Captain
  & Starting XI section below already states that diff, so blending the two would make it
  impossible to tell which is which. Falls back to the model's own XI, clearly labelled, only when
  none has been set.

## My Team's Squad view (`/team`, added 2026-08-15)

`/team` previously rendered `manager_picks` as four plain position lists, with no default to the
FPL import either. Gained a **Current squad / Gameweek result** switch:

- **Current squad** renders the resolved import (above) on the same read-only `PitchView`, or —
  without ever silently saving a draft — a throwaway `TeamState` built from the latest
  `manager_picks` event via the existing `teamStateFromPicks` when no import exists yet.
- **Gameweek result** adds a `<select>` over every gameweek the manager has entered, showing that
  gameweek's real per-player points via a new `lib/manager-picks.ts`:
  - The starting XI is read from `position` (1–11 vs. 12–15), **never** `multiplier > 0` — under
    Bench Boost every pick's multiplier is non-zero, so the multiplier test would silently promote
    the bench onto the pitch in exactly the gameweek where the distinction matters.
  - `player_gameweek_stats` is keyed per **fixture**; points are summed per `(player, event)` so a
    double gameweek doesn't lose one.
  - **The two totals are shown side by side, never reconciled into one number** —
    `manager_picks` is as-picked and FPL's own `automatic_subs` isn't synced by `sync-manager`, and
    `manager_gameweek_history.points` is net of any transfer hit, so the two can legitimately
    disagree: `60 XI + 9 armband (×2) = 69 · FPL recorded 66 · includes a −4 transfer hit`.
  - An unfinished gameweek's points fall back to `player_live_stats` and are labelled provisional.

**Verified two ways**, since `manager_picks`/`player_gameweek_stats` are genuinely empty for
2026-27 pre-GW1 (deadline 2026-08-21): a throwaway `npx tsx` harness checked the shaping rules
directly (captain ×2/×3, DGW summing, the Bench Boost multiplier trap, missing-stats handling) with
no UI involved, then the live read path was exercised by seeding one gameweek's picks and stats for
the owner's own entry directly in Supabase and deleting every row afterward — confirming the
selector, the per-player points, the two-total summary, and the provisional label toggling on
`gameweeks.finished`. No real double gameweek or Bench Boost payload exists yet to check the live
path against; the harness covers that math, the live path doesn't yet. —
[sprints/additional-info.md](../sprints/additional-info.md#squad-view-on-deadline-hub-and-my-team--built-2026-08-15)

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
[blocked-and-data-gaps.md](blocked-and-data-gaps.md), [fpl-authentication.md](fpl-authentication.md)
(the import mechanism and its naming rule), [manager-profile.md](manager-profile.md) (`/team`'s
other section, the career percentile profile — a different topic on the same page).
