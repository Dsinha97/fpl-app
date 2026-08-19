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
