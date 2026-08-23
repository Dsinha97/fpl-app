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

**Correction (2026-08-22):** this section originally described a **Current squad / Gameweek
result** radio switch. Sprint 21 removed the "Current squad" mode entirely — `TeamState.players`
derived straight from the import/latest-picks could go stale after a transfer
(`hasConsistentLineup`, see [frontend-conventions.md](frontend-conventions.md#teamstate-is-the-one-squad-shape)),
and `PitchView` silently dropped whichever players it couldn't place rather than erroring, so a
stale mode rendered a short squad with no signal anything was wrong. **Gameweek result — the real
picks a gameweek was actually played with — is the only mode left**, since FPL publishes those
already consistent. This wiki page was never updated when the mode was cut; the original two-mode
description below is corrected in place rather than deleted, per this wiki's own rule. See
[sprint-21.md](../sprints/sprint-21.md#1-teams-current-squad-pitch-was-silently-dropping-players).

`/team` previously rendered `manager_picks` as four plain position lists, with no default to the
FPL import either. Gained a section (originally a **Current squad / Gameweek result** switch, now
just "Squad view" — see the correction above):

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

### `/team`'s redundant squad list removed, page repacked into two columns (Sprint 23, 2026-08-22)

Below the Squad view's `PitchView`, `/team` also rendered the same 15 players a second time as a
position-grouped list (`Goalkeepers`/`Defenders`/`Midfielders`/`Forwards`) — a leftover from before
the 2026-08-15 pitch view existed, kept only because it was the sole host of the free-transfers
`<select>` and the "Import as draft" button. Deleted outright rather than deduped, since
`PitchView` was always the read of record; the free-transfers control and import button moved into
a small "Free transfers" card instead. Part of a wider density pass (see [design-system.md's
"Packing, continued"](design-system.md#packing-continued-sprint-23-2026-08-22)) that repacked
`/team` into the same `grid-cols-[minmax(0,1fr)_360px]` two-column template `/builder`/`/transfers`
already used: `PitchView` + the gameweek selector on the left, the points tiles (now 2-up instead
of a 6-across full-width strip), the free-transfers card, and **Your Leagues** (moved up from
further down the page) in the right rail. This page also had its own set of hardcoded
`border-zinc-200 bg-white … dark:bg-[#1E0234]` card classes, never migrated onto the `bg-card`/
`bg-card-supporting` tokens [design-system.md's token layer](design-system.md#the-token-layer-appglobalscss)
introduced back in Sprint 19 — normalised as part of this pass. See
[sprint-23.md](../sprints/sprint-23.md).

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

### Live hub repacked into a two-column rail (Sprint 23, 2026-08-22)

The live card's BPS-race list was `sm:col-span-2` inside its own `sm:grid-cols-2` grid — a
five-row list stretching across the card's full width and leaving a gap next to the fixture-card
grid beside it. The live card is now the left column of a two-column row
(`grid-cols-[minmax(0,1fr)_360px]`, the same template as the density pass below), with **Price &
news watch** and **Team news** — previously full-width `CollapsibleCard`s at the very bottom of
the page — moved up into a right rail beside it. The rail renders unconditionally (before
kickoff, live card absent), so neither `CollapsibleCard` is orphaned before GW1's first fixture
starts. Squad/readiness/availability/captain/chip-call below the live card got the same
two-column treatment — see [design-system.md's "Packing, continued"
section](design-system.md#packing-continued-sprint-23-2026-08-22) for the shared template and
[sprint-23.md](../sprints/sprint-23.md) for the full change.

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

### The countdown left this page (2026-08-22): a sticky app-wide `ContextBar`

`/deadline` was the only place the deadline countdown, bank, or free-transfer count ever appeared —
everywhere else, a manager checking those numbers before a decision had to navigate here first. A
new `components/context-bar.tsx` renders under the nav in every page's now-`sticky top-0` header,
reusing `loadSeasonContext` for the countdown/gameweek name and whichever draft
`resolveRequestedDraft` (see [frontend-conventions.md](frontend-conventions.md#shared-helpers-extracted-after-being-pasted-enough-times))
already resolves for every other draft-aware page — no new query shape, no extra Supabase round
trip beyond `loadSeasonContext` itself. `fmtCountdown` (this page's own countdown formatter) moved
out to `lib/countdown.ts` so the bar and `/deadline` share one implementation.

**Corrected 2026-08-22** — the bar originally rendered `TeamState.freeTransfers` raw whenever the
resolved draft was FPL-sourced, and this is exactly what surfaced a real bug live: `freeTransfers`
is sometimes a sentinel, not a count. `teamStateFromMyTeamJson` sets it to `rules.squadSize` for
FPL's pre-deadline "unlimited" transfer state (so `simulateTransfers` never invents a hit FPL
wouldn't charge), and the bar showed that sentinel as a literal "FT 15." The fix,
`freeTransfersDisplay` (`lib/transfers.ts` — see
[frontend-conventions.md](frontend-conventions.md#shared-helpers-extracted-after-being-pasted-enough-times)),
is now the one shared reading everywhere: `FT ∞` when the squad's `activeChip` is a wildcard or free
hit, otherwise a count clamped to `[0, 5]` with anything above that cap — the sentinel — read as the
documented default of 1, never as a real 5-transfer cap nobody set. The owner's own rule settled
what "1" should mean here: not a placeholder hidden behind an "unknown" state, but the real default,
shown plainly and changeable on `/deadline` or `/team` — so `/deadline`'s and `/transfers`' FT
`<select>`s now `saveDraft` on change instead of being page-local state that evaporated on
navigation, and `/team` gained its own FT control. See
[mobile-reachability.md](../sprints/mobile-reachability.md). Bank has no equivalent correctness
problem — `budget − totalSpend(players)` is a real computed value for whichever draft is loaded, the
same number `/transfers` and `/team` already show for it.

`app/page.tsx` also now redirects a signed-in visitor from `/` straight to `/deadline`, so the
marketing splash only shows once, before first sign-in. See
[design-audit-response.md](../sprints/design-audit-response.md).

See also: [data-pipeline.md](data-pipeline.md) (`sync-live-gameweek`'s cron and self-gating),
[blocked-and-data-gaps.md](blocked-and-data-gaps.md), [fpl-authentication.md](fpl-authentication.md)
(the import mechanism and its naming rule), [manager-profile.md](manager-profile.md) (`/team`'s
other section, the career percentile profile — a different topic on the same page),
[ownership-and-leagues.md](ownership-and-leagues.md) (the other Sprint-10/13-adjacent build that
landed the same evening — mini-league effective ownership, a different quantity from anything on
this page), [frontend-conventions.md](frontend-conventions.md#player-detail-panel-live-breakdown-season-stats-and-recent-form)
(the player detail panel's own GW1-follow-up additions, built alongside this),
[design-system.md](design-system.md#expandable-card-stretch-2026-08-22) (`LiveFixtureCard`'s and
`ClubTacticsGrid`'s row-stretch fix, found using this page's own real GW1 cards).
