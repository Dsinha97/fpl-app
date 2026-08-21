# Frontend conventions

Patterns every page in `app/` is expected to follow — deviating from these has caused real bugs more
than once.

## `TeamState` is the one squad shape

Everything squad-shaped (`/builder`, `/scenarios`, `/transfers`, `/chips`, `/deadline`, `/team`)
consumes the shared `TeamState` (`lib/team-state.ts`). Mutations are pure functions returning new
state — `addPlayer`, `removePlayer`, `setCaptain`, `setViceCaptain` (which **swaps** the other
armband rather than vacating it).

`TeamState` carries an optional `entryId` (added 2026-08-15) — the FPL entry a squad was imported
from, absent on manual drafts and on imports made before the field existed. It exists so "which
draft is this manager's own import?" survives a rename; see
[fpl-authentication.md](fpl-authentication.md) for the naming rule and
[deadline-and-matchday.md](deadline-and-matchday.md) for what it defaults.

**`startingXI`/`benchOrder` can drift from `players` — always check `hasConsistentLineup`
before trusting them, never just `startingXI.length === 11`.** Neither `addPlayer` nor
`removePlayer` used to touch the XI/bench split at all, so a transfer could leave `startingXI`
naming a player no longer in `players`, or a removed player still occupying a bench slot. A
length check alone passes on a stale array — only `hasConsistentLineup(state)`
(`lib/team-state.ts`) actually verifies `startingXI ∪ benchOrder === players` with no id
missing or duplicated. `PitchView` silently drops whichever ids it can't place rather than
erroring, so the failure mode is a squad that quietly renders short, not a crash — caught on
a real draft (Sprint 21) where this had already happened. `addPlayer`/`removePlayer` now keep
the split consistent going forward, and `lib/drafts.ts`'s `readAll()` sanitizes (clears both
arrays) any draft that already isn't, on every read — so a stale draft heals itself rather than
needing a migration.

## One pitch component for a projection or a known XI

`PitchView` (`components/pitch-view.tsx`) draws a `SquadLayout` — starters, bench, formation, a
bench-strip summary — rather than a bare `LineupResult` from `lib/lineup.ts`. A `LineupResult` is
projection-shaped (`startersXp`, auto-sub `subProbability`) and could only ever draw a squad the
optimiser had scored; `layoutFromLineup` adapts one into a `SquadLayout` for `/builder`, while
`layoutFromPicks` (`lib/manager-picks.ts`) builds the same shape from a squad **already entered**,
with no sub-probability to show. Its three edit callbacks (`onSetCaptain`/`onSetVice`/`onRemove`)
are optional — `/builder` passes all three, `/deadline` and `/team`'s new read-only sections pass
none, and `components/player-detail.tsx`'s action buttons render only when their handler exists.
See [deadline-and-matchday.md](deadline-and-matchday.md).

## Player detail panel: live breakdown, season stats, and recent form

Built 2026-08-21, alongside the live-hub follow-ups in
[deadline-and-matchday.md](deadline-and-matchday.md#live-fixture-event-detail-and-the-fixtures-collapse-fix--built-2026-08-21-same-evening).
`components/player-detail.tsx` stays a **pure render** component — it never fetches, and every new
section follows the panel's existing convention: an `undefined` field on `PlayerData`
(`components/player-card.tsx`) hides the section entirely, the same rule `reliability`/`headlines`
already established.

- **Live points breakdown** (`PlayerData.live_breakdown`) — FPL's own per-stat points table
  (Minutes played, Assists, …, Total), sourced from `player_live_stats.explain` via
  `lib/gameweek-state.ts`'s `loadLiveDetail`, which flattens a double gameweek's two fixture
  entries and sums by identifier. This is FPL's own arithmetic stored verbatim — CLAUDE.md's "one
  quantity, one implementation" rules out recomputing it from `scoring_rules`' thresholds a second
  time. Only wired on `/team`, the one page that already loads a selected gameweek's live detail.
- **Season stats** (`season_total_points`/`season_bonus`/`dc_actions`/`form`) — already-loaded
  `players` columns, added to `/deadline`, `/builder`, and `/compare`'s comparison table.
  `dc_actions` is deliberately not called "DC points": it's the raw action count (clearances +
  blocks + interceptions + tackles, plus recoveries for MID/FWD), and FPL only scores it on
  crossing a positional threshold (10 for defenders, 12 for midfielders) — see
  [xp-model.md](xp-model.md) for the same distinction in the xP engine's own `XDC_MODEL_NOTE`.
  `/players` was left alone — it renders its own inline table, not this panel.
- **Recent form** (`past_results`) — the backward-looking mirror of the existing `upcoming` fixture
  ticker, from a new `lib/player-history.ts` reading `player_gameweek_stats`, DGW-summed into one
  entry per event the same way `squadPointsFor`/`loadEventPoints` already do.
- **Panel size** raised 268×340 → 320×460 for the new sections. `PitchView`'s positioning and the
  picker's `fixed` placement both read `PANEL_WIDTH`/`PANEL_MAX_HEIGHT` directly, so neither needed
  a separate change to stay in sync.

Verified live against the real GW1 opener: `/team`'s live breakdown matched a real player's
minutes/assists/total exactly against the FPL app; `/deadline` and `/compare`'s season-stat rows
agreed on identical figures for the same player, confirming both surfaces read the same columns.

## Horizon is a page-level control, and "season" is a string

`Horizon = 1 | 3 | 5 | 8 | 19 | "season"` (`HORIZONS`, `horizonLabel`, `horizonLength` in
`lib/team-state.ts`) drives the projection, picker, optimiser, and comparison together on any page
that has it. Because `"season"` is a string, **any arithmetic on a horizon must go through
`horizonLength`**, never the raw value — a direct numeric comparison against `"season"` is a type
error waiting to compile-pass and crash at runtime.

## Player search needs `matchesPlayerQuery`

`web_name` alone is not enough — FPL abbreviates it (`E.Anderson`). Every search box uses
`matchesPlayerQuery`/`fullName` (`lib/player-search.ts`), which matches every name field and folds
accents.

## Theme

Class-based dark mode (`.dark` on `<html>`), with a no-FOUC boot script in `app/layout.tsx`. Brand
purple `#0E0118` page / `#1E0234` card / `#2A0A45` input, `#00FF87` accent. Both themes need styling
on anything new.

The full token contract (surfaces, semantic status colours, the two-tier card system, button/state
vocabulary, the busy-state pattern, and the disclosure rule) is
[design-system.md](design-system.md) — built Sprint 19. Prefer a token (`bg-card`, `text-danger`,
`focus-visible:ring-ring`) over a new raw hex literal; an ESLint rule flags new ones under `app/` and
`components/`.

## Shared helpers, extracted after being pasted enough times

- **`availabilityFromStatus`** (`lib/scoring.ts`) — was copy-pasted six times before extraction.
  Extracted, with `loadSeasonContext` below, while building
  [deadline-and-matchday.md](deadline-and-matchday.md)'s Deadline Hub — a concrete instance of
  CLAUDE.md's "one quantity, one implementation" rule applied to UI code, not just model code.
- **`loadSeasonContext`** (`lib/season-context.ts`) — the `gameweeks`/`element_types`/`game_settings`
  fetch, pasted three or four times (including `/chips`' own variant) before extraction.
- **`resolveRequestedDraft`** (`lib/drafts.ts`) — the `?draft=` query-param resolution every
  draft-aware page needs, since `listDrafts()` sorts by `updatedAt` and a page without this defaults
  to whichever draft was most recently *edited*, not the one being looked at. Since 2026-08-15 it
  takes an optional preference: `/deadline` and `/team` pass their linked manager's `entryId` and
  team name, so their fallback (when no `?draft=` is present) is the manager's own FPL import —
  matched by `entryId` first, by the naming rule second — rather than whichever draft is newest.
  `/builder`, `/scenarios`, `/transfers` and `/chips` don't pass it, so their fallback is unchanged.
- **`uniqueDraftName`** (`lib/drafts.ts`) — collision-safe naming, shared by both the FPL importer
  and `cloneDraft`, which had the identical latent bug independently.
- **`lib/manager-picks.ts`** (2026-08-15) — the first read of `manager_picks` under `lib/`; both
  `/deadline` and `/team` need a manager's picks for a given gameweek, so the read and its
  correctness rules (starting XI from `position`, never `multiplier`; `player_gameweek_stats` summed
  per fixture for double gameweeks) live once. See [deadline-and-matchday.md](deadline-and-matchday.md).

## Static-export-specific traps

- **`router.replace()` in a render body, not an effect, produces a real React warning** — "setState
  on a different component during render" — that only fires on the branch a page redirects *from*.
  A signed-in-only or signed-out-only test pass never exercises it. Always wrap in `useEffect`.
  Caught twice (`/signin`, `/settings/fpl`) before this became a known pattern.
- **Don't touch refs inside an IIFE in JSX** — hoist into a `useMemo`, or React's linter flags it.
- **Active-tab state reads `window.location.search`, not `useSearchParams`** — every
  `?draft=`/`?tab=`-reading page avoids the Next hook, since it needs a Suspense boundary this
  static export has no existing precedent for.
- **`trailingSlash: true` is required** or a direct hit on `/team/` 404s — see
  [deployment.md](deployment.md).

See also: [deployment.md](deployment.md) (why static export forecloses these patterns),
[methodology.md](methodology.md) (the same "verify, don't assume" discipline applied to model code).
