# Sprint 13 — Live Matchday Hub

**Status: built and verified live, 2026-08-21.** See [../roadmap.md](../roadmap.md) for the sprint index.

## What shipped

The GW1 deadline (2026-08-21 17:30 UTC) meant `sync-live-gameweek`'s write path could finally be
exercised against a real match, so the render layer staged below went ahead — on `/deadline`, per the
"one route, two phases" plan: pre-deadline planning above, live tracking below, switching on whether
any GW1+ fixture has started.

- **`lib/gameweek-state.ts`** — the one place that assembles a live gameweek, so `/deadline` stays a
  render surface. Reuses `startersOf`/`benchOf`/`squadPointsFor` from `lib/manager-picks.ts` rather than
  re-deriving the starter/bench/captain split (CLAUDE.md: "one quantity, one implementation").
  - `loadLiveDetail` — per-player points/minutes/bonus/bps, finalised rows (`player_gameweek_stats`,
    summed across fixtures for a DGW) preferred over the live snapshot, the same fallback shape
    `loadEventPoints` already uses, extended with the extra columns the live hub needs.
  - `projectAutoSubs` — a starter who finishes on 0 minutes is projected to be replaced by the first
    eligible bench player, using real `element_types.squad_min_play`/`squad_max_play` for formation
    legality rather than a hardcoded rule.
  - `resolveCaptaincy` — the armband moves to the vice-captain only once the captain's fixture has
    finished with 0 minutes recorded, matching FPL's real rule.
  - Both are labelled projections, not FPL's applied result — `automatic_subs` isn't synced (see
    `MANAGER_PICKS_NOTE`), so `LIVE_MODEL_NOTE` says so wherever the live hub is read.
- **`/deadline`'s live card group** — live total (corrected for the captaincy handover and projected
  subs), a player-status summary (playing / yet to play / finished), the projected auto-subs list, and
  a provisional BPS race, all marked "Provisional" until FPL confirms bonus post-match. Renders only
  once `fixtures.started` is true for the live gameweek — before kickoff the page is unchanged.

## GW1 dry-run checklist — run and passed

1. **`sync-live-gameweek` left its `skipped` branch.** `sync_runs` moved from 90 consecutive `skipped`
   rows to `status: success, rows_written: 600` the moment `fixtures.started` flipped true.
2. **Spot-checked against FPL's own live feed.** Player 1's row (`minutes=3, total_points=1, bonus=0,
   bps=3`) matched `event/1/live/`'s payload exactly.
3. **The render layer was built and checked against real rows, not `?force=1` synthetic ones** — seeded
   the owner's actual GW1 picks and confirmed the live total, the two squad players genuinely in the
   opening fixture, and the provisional BPS race all rendered correctly in both themes.

## A real gap the dry run found

`sync-fixtures` only ran hourly, so `fixtures.started` — the flag `sync-live-gameweek`'s own gate
trusts — stayed false for up to ~55 minutes after a genuine kickoff. Not a bug in the code written this
sprint; a pre-existing scheduling gap the first real live match exposed. Fixed same day: `sync-fixtures`
now self-gates on `kickoff_time` (it can't gate on `started`/`finished` the way `sync-live-gameweek`
does, since those are exactly the columns it exists to refresh) and runs every 2 minutes, the same
"cheap query on the ~95% of quiet ticks" cost every other self-gating sync already pays. Confirmed live:
the new cron fired unassisted while GW1's opener was in progress.

## Not built this sprint

`GameweekState` was scoped to what a live gameweek needs to *read*; nothing here submits anything to
FPL (that's Sprint 15, Action Layer) and live overall rank is deliberately shown only once FPL has
actually published `manager_gameweek_history.overall_rank` — before that it reads "not published yet"
rather than a computed guess.
