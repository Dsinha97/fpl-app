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

## Bank is the stored primitive, budget is derived (2026-09-02)

`TeamState.bank` is real cash in tenths, and total budget is derived from it (`bank +
squadSellValue`). It used to be the other way round: `budget` was stored as squad sell value plus
bank *at the moment of import*, and every consumer recovered the bank as `budget − Σ sellPrice(now)`.

That residual is invariant under transfers — selling frees exactly what the replacement costs
against it — but **not** under price changes. When a held player rose, his sell value rose and the
frozen total didn't, so the difference came out of the bank: a *per-player* price move charged to
the *team's* cash. The owner hit it on a real squad at GW3 — Bank reading `£-0.1m` and an
over-budget bar on a legal 15. A price fall did the mirror thing and credited money that doesn't
exist.

Consequences for anything touching a squad:

- Read the bank through `squadBank` (`lib/squad-budget.ts`), never by subtracting a spend total from
  `state.budget`. `teamBudget` is there for the total. This is the same "one quantity, one
  implementation" rule [methodology.md](methodology.md) states generally — there were three
  disagreeing copies of "bank" before this.
- `addPlayer` debits the live price and `removePlayer` credits `sellPrice`, so `removePlayer` now
  takes the outgoing player's live price. Money moves only when the squad buys or sells.
- `state.budget` is still written on every new state and is still what `squadBank` falls back to, so
  drafts saved before the field existed keep parsing. Their cash was never persisted and can't be
  recovered after the fact — such a draft keeps the old drifting behaviour until it is re-imported
  once.

Verified before shipping with a throwaway `npx tsx` harness against real player rows, per
[methodology.md](methodology.md)'s harness rule: a +£0.2m rise moved value and total while bank held
flat, a −£0.2m fall did the same in reverse, and a sale-plus-purchase moved the bank by exactly
`sellPrice(out) − nowCost(in)`. The legacy derivation on the same squad read £0.1m off.
— commit `461a455`, [transfer-engine.md](transfer-engine.md)

## Re-importing overwrites the same draft, and preserves what FPL can't know (2026-08-30)

Both import paths (`teamStateFromPicks`, `teamStateFromMyTeamJson` — `lib/fpl-squad.ts`) used to
always mint a fresh `draftId` via `emptyTeamState`, so a second import of the same manager became
"DS United (FPL) (2)" instead of updating the first — even though `saveDraft` already updates in
place when a `draftId` matches. `resolveImportTarget` finds the existing import using
`resolveRequestedDraft`'s own entryId-then-name precedence, and both call sites
(`app/team/page.tsx`, `app/settings/page.tsx`) now reassign the fresh state onto that `draftId`
instead of a new one.

That surfaced a real second bug: the fresh `TeamState` never carried forward `chipPlan`, `pinned`,
`notes`, or `strategy` — all four are user intent a fresh FPL pull cannot know, and were silently
wiped on every re-import. Both call sites now merge those four fields forward from the draft being
overwritten before saving; everything else (squad, captain, budget, `activeChip`, `freeTransfers`)
still comes fresh from the import, deliberately not carried forward. Verified live: set a
wildcard-GW8 chip plan and a note on an imported draft, re-imported, confirmed both survived under
the same `draftId`.

`teamStateFromPicks` (the `manager_picks` import path, which carries no real purchase price) also
gained an optional `purchasePriceOf` parameter — when the season's own `manager_transfers` record
(already loaded for [transfer-engine.md](transfer-engine.md)'s ledger) shows a real
`element_in_cost` for a player, that beats the current-price fallback `sellPrice()` was previously
overstating proceeds from. A player never transferred this season (the original squad) still falls
back to current price, same as before. — [sprints/sprint-29.md](../sprints/sprint-29.md)

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
- **Panel size** raised 268×340 → 320×460 for the new sections when they first shipped, then lowered
  back to 320×340 in Sprint 21 once everything past the metric grid and live breakdown moved behind
  a "Show full details" toggle, collapsed by default — corrected here 2026-08-22 after two ingest
  passes carried the intermediate 320×460 figure forward as current. `PitchView`'s positioning and
  the picker's `fixed` placement both read `PANEL_WIDTH`/`PANEL_MAX_HEIGHT`
  (`components/player-detail.tsx`) directly, so neither needed a separate change to stay in sync
  with either size.

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
- **`fmtCountdown`** (`lib/countdown.ts`, 2026-08-22) — the "ms until an ISO deadline" formatter,
  pulled out of `app/deadline/page.tsx` so the new sticky `ContextBar` and `/deadline` itself share
  one implementation. See [deadline-and-matchday.md](deadline-and-matchday.md#the-countdown-left-this-page-2026-08-22-a-sticky-app-wide-contextbar).
- **`freeTransfersDisplay`** (`lib/transfers.ts`, 2026-08-22) — the one honest reading of
  `TeamState.freeTransfers`. That field is sometimes a sentinel, not a count: the FPL importer sets
  it to `rules.squadSize` for FPL's pre-deadline "unlimited" transfer state, so `simulateTransfers`
  never invents a hit FPL wouldn't charge. `/deadline` and `/transfers`' FT selects clamped this
  separately before display; a new sticky `ContextBar` rendering it a third way, raw, is what
  actually surfaced the bug live (a real "FT 15"). Returns `{ kind: "unlimited" }` when a wildcard
  or free hit is the squad's `activeChip`, otherwise a count clamped to `[0, MAX_FREE_TRANSFERS]`
  with anything above the cap — the sentinel — falling back to the documented default of 1. See
  [mobile-reachability.md](../sprints/mobile-reachability.md).

## `NavLinks` split into `DesktopNav`/`MobileNav` (2026-08-22)

One component used to return a two-element fragment: the `hidden lg:flex` desktop row and the
`lg:hidden` mobile trigger. That's fine as long as both siblings' relative position in the header
never needs to differ — but moving just the mobile trigger to the header's left edge (see
[design-system.md](design-system.md#bottom-sheet-added-2026-08-22-superseded-2026-08-22-same-day-by-a-left-drawer--see-below))
would have dragged the entire desktop row in front of the logo too, since fragment siblings
share one DOM position regardless of which breakpoint currently shows which one. Split into two
components so `app/layout.tsx` can place them independently — `<MobileNav />` first, then the logo,
then `<DesktopNav />` — with no effect on the desktop layout, since `MobileNav`'s `lg:hidden`
wrapper contributes zero width once it's hidden. The pattern generalises: a component that renders
different content per breakpoint via CSS display, rather than one shared subtree, can't be safely
reordered as a unit if the breakpoints ever need different relative positions.

**Correction (same day, Sprint 22):** "10-item desktop row" above is stale within hours of being
written — `NAV`'s flat 11-link array (10 visible plus `/status`) became `NAV_GROUPS`, three
`@base-ui/react/menu` dropdowns (Live/Strategy/Statistics) rather than a flat row, and `/status`
moved into `AccountMenu`. The split rationale in this section is unaffected — `DesktopNav`/
`MobileNav` are still two independently-placeable components for the same reason — only the
desktop row's own content changed shape. See
[design-system.md's nav/drawer section](design-system.md#grouped-nav-a-left-drawer-and-one-shared-anchored-panel-hook-sprint-22-2026-08-22).

## `/players`' own data columns (2026-08-22)

`/players` renders its own 16+-column sortable table rather than the shared `player-detail.tsx`
panel (see above) — gained two more columns, both already-ingested data simply not yet selected:
current-season `expected_goals`/`expected_assists` from `players`, and an `expected_minutes`/
`start_probability` fetch from `player_predictions` powering an `xMins` column and a `Start %` sort
key. The same fetch also replaced `toScoredPlayer`'s hardcoded `expectedMinutes: null`/
`startProbability: null` — previously hardcoded because this page never fetched the data — with the
real values, so every `startProbability ?? availability` fallback already written into
[hidden-gems.md](hidden-gems.md) and `lib/scoring.ts` now has real per-fixture minutes evidence on
this page instead of the status-only fallback. See
[design-audit-response.md](../sprints/design-audit-response.md).

**Correction (Sprint 25, 2026-08-23):** the columns were originally labelled `xG (N GW)`/
`xA (N GW)` (a season-to-date total, accurate but implying a rate the way "xG"/"xA" do elsewhere
in football) — replaced with `xG/90`/`xA/90` instead (`—` below 45 minutes, dimmed with the raw
total in `title` below 180 minutes, since a 12-minute cameo reading 7.5 xG/90 is not a real rate).
See [design-system.md](design-system.md#ui-defect-sweep-sprint-25-2026-08-23).

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
