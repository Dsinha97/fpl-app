# Deadline Hub & Live Matchday Hub

Related surfaces for pre-deadline and in-play decisions, all built — Deadline Hub, My Team's Squad
view, and Live Matchday Hub, which now share `/deadline` as one route in two phases.

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

## Live Matchday Hub (Sprint 13, built and verified live 2026-08-21)

Held back deliberately until GW1's real deadline (2026-08-21 17:30 UTC) and first kickoff, so the
GW1 dry-run checklist below could run against a genuinely live fixture rather than an unverifiable
`?force=1` dry run. It passed, and the render layer shipped the same evening.

**`lib/gameweek-state.ts`** assembles a live gameweek from `manager_picks` +
`player_live_stats`/`player_gameweek_stats` + `fixtures` + `element_types`, reusing
`startersOf`/`benchOf`/`squadPointsFor` from `lib/manager-picks.ts` rather than re-deriving the
starter/bench/captain split:

- **Live total** — starters + captain, corrected for two things this app projects rather than takes
  from FPL directly (FPL's own `automatic_subs` isn't synced, see the note below):
  - `projectAutoSubs` — a starter who finishes on 0 minutes is projected to be replaced by the first
    eligible bench player, checked against real `element_types.squad_min_play`/`squad_max_play` for
    formation legality (never a hardcoded 1-3-2-1-style rule).
  - `resolveCaptaincy` — the armband moves to the vice-captain only once the captain's own fixture has
    *finished* with 0 minutes recorded — before that, nothing is decided, so a captain who's merely
    not started yet keeps the armband rather than projecting a handover a 60th-minute introduction
    would undo.
- **Player status** (playing / yet to play / finished) and a **provisional BPS race**, both labelled
  provisional — bonus isn't final until FPL confirms it post-match.
- **Live overall rank** is shown only once FPL has actually published
  `manager_gameweek_history.overall_rank` — "not published yet" rather than a computed guess.

Renders as a card group on `/deadline`, switched on whether any fixture in the live gameweek has
started — before kickoff the page is byte-for-byte the pre-deadline planning page; after, the live
group takes the top slot. One route, two phases, no duplicated squad loading.

**GW1 dry-run checklist — run and passed:** `sync-live-gameweek`'s `sync_runs` row moved from 90
consecutive `skipped` rows to `success` (600 elements) the moment `fixtures.started` flipped true; a
spot-checked player row matched FPL's own `event/1/live/` payload exactly; the render layer was then
checked against the owner's real GW1 squad (seeded from `manager_picks`, not synthetic) in both
themes before trusting it. — [sprint-13.md](../sprints/sprint-13.md)

**A real gap the dry run found, fixed same day:** `sync-fixtures` ran hourly, so `fixtures.started`
— the flag `sync-live-gameweek`'s own gate trusts — lagged a genuine kickoff by up to ~55 minutes.
Not a code-review catch; the first real live fixture found it. See
[data-pipeline.md](data-pipeline.md#sync-fixtures-self-gated-cadence-fixed-2026-08-21) for the fix.

### Live fixture event detail, and the `/fixtures` collapse fix — built 2026-08-21, same evening

Watching the live hub through the real opener surfaced two more gaps, fixed the same evening as the
dry run above.

**`fixtures.stats` already carried FPL's full per-fixture event breakdown** — goals, assists, own
goals, penalties, cards, provisional bonus, each split home/away with the scoring player's element
id — refreshed by the same self-gated `sync-fixtures` cron. Nothing rendered it. `lib/fixture-stats.ts`
parses it once (`parseFixtureStats`); a shared `components/live-fixtures.tsx` renders it in two
places from that one parse:

- **`/deadline`'s live hub** — a `LiveFixtureCard` per fixture the squad is actually involved in
  (filtered by the squad's own club ids), tagging owned players `(in your squad)` in the accent
  colour. Also gained a "View in My Team →" link, since the pitch/gameweek-result view already
  lives there.
- **`/fixtures`' Schedule tab** — the same breakdown as an expandable row on any fixture, without
  squad tagging (that page has no squad context). Verified live: expanding the GW1 opener's row
  showed Saka/Havertz goals, Calafiori/Tzolis assists, and bonus marked provisional, matching the
  match's real state.

**`/fixtures` was separately found collapsing the gameweek actually being played.**
`FixtureSchedule`'s "which sections start open" logic only compared against `gameweeks.is_next` —
which flips to the *next* gameweek the moment the current one's deadline passes, hours before it's
actually played (the same `is_next`-vs-`is_current` trap the live hub itself had to route around,
above). A gameweek now also stays open while any of its fixtures has started and not every fixture
has finished, closing again once the gameweek ends or the next deadline passes. Verified live: GW1
stayed expanded showing the real 2-0 scoreline while `is_next` already pointed at GW2.

See also: [data-pipeline.md](data-pipeline.md) (`sync-live-gameweek`'s cron and self-gating),
[blocked-and-data-gaps.md](blocked-and-data-gaps.md), [fpl-authentication.md](fpl-authentication.md)
(the import mechanism and its naming rule), [manager-profile.md](manager-profile.md) (`/team`'s
other section, the career percentile profile — a different topic on the same page),
[ownership-and-leagues.md](ownership-and-leagues.md) (the other Sprint-10/13-adjacent build that
landed the same evening — mini-league effective ownership, a different quantity from anything on
this page), [frontend-conventions.md](frontend-conventions.md#player-detail-panel-live-breakdown-season-stats-and-recent-form)
(the player detail panel's own GW1-follow-up additions, built alongside this).
