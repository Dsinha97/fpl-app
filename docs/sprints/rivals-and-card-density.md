# Rivals fixes & card density — built 2026-08-20

No new sprint number — a bug-fix and layout-polish pass across `/team`'s rivals section and the
three card-heavy pages Sprint 19 ranked but didn't repack (`/deadline`, `/transfers`, `/chips`),
prompted directly by the owner using the app.

## Context

Two reports from live use, unrelated to each other:

1. **Rivals on `/team` were silently broken in three ways.** `addRival` wrote straight to
   `manager_rivals` without ever syncing the candidate manager, so a rival only ever appeared if the
   owner had separately typed the same ID into the main Manager ID form first (which does sync). A
   manager with zero completed seasons — test case entry **4675109** — could never appear at all:
   `buildManagerProfile([])` returns `null`, and the old code dropped any rival whose profile came
   back `null` with no message. And the comparison was career-only by design, even though this
   season's plumbing (`manager_gameweek_history`, already written by `sync-manager` for every synced
   entry) was sitting unused.
2. **Card density.** `/deadline`, `/transfers`, `/chips` had large dead zones next to short cards —
   Sprint 19 (see [design-system.md](../wiki/design-system.md)) fixed *ranking* (which card matters
   more) but not *packing* (how much of the row a card's actual content needs).

## What shipped

**Rivals** (`lib/manager-profile.ts`, `app/team/page.tsx`, `components/manager-profile-card.tsx`):

- `addRival` now calls `sync-manager` for the candidate entry **before** writing to
  `manager_rivals`, and shows the sync error inline without ever writing an unresolvable row —
  verified live against the deployed Edge Function: entry `999999999` returns
  `"Manager ID 999999999 not found on FPL"` (HTTP 404) and nothing is written; `4675109` (a
  brand-new entry, `history` = `{"current":[],"past":[],"chips":[]}`) syncs successfully, writing a
  `managers` row with zero `manager_season_history` rows.
- A rival with no career record no longer disappears. `RivalRow` (replacing the old flat
  `RivalComparison`) carries `career: CareerComparison | null` and `season: SeasonComparison | null`
  independently — a first-season manager renders "First season" under Career and (once GW1 has
  results) a real row under This season, rather than vanishing.
- `RivalTable` gained a **This season / Career** tab pair, styled on `/fixtures`' existing tab
  pattern. New `buildSeasonToDate`/`compareSeasonToDate` in `lib/manager-profile.ts` read
  `manager_gameweek_history` the same way `buildManagerProfile`/`compareToRival` already read
  `manager_season_history`. Every gap (`career.gap`, `season.pointsGap`) is `number | null` — null
  when either side has no rows yet, never a fabricated zero, verified with a throwaway harness:
  `compareSeasonToDate(null, rival)` returns `pointsGap: null`, matching the fact that **nobody**
  has `manager_gameweek_history` rows before GW1 (`entry/274486/history` — the owner's own 10-season
  entry — currently returns `"current":[]`).
- The Manager Profile section (career card + rivals + add-rival box) now renders whenever a manager
  is connected, not only when the *owner* has a completed season — the old gate hid the entire
  section, add-rival box included, for a first-season owner. Remove chips render from the raw
  `manager_rivals` id list rather than the resolved rivals array, so a rival that still fails to
  resolve can be removed instead of stuck invisibly.

**Card density** (`components/ui/collapsible-card.tsx` new; `components/chip-plan-editor.tsx`,
`app/deadline/page.tsx`, `app/chips/page.tsx`):

- New `CollapsibleCard` primitive — extracted once rather than adding a third hand-copy of the
  collapse pattern design-system.md already flagged as unconsolidated (`app/chips/page.tsx`'s
  fixture-flatness note, `transfer-plan.tsx`'s free-transfers note). Tier-aware (`primary`/
  `supporting`, matching Sprint 19's two-tier card system), collapsed by default with a one-line
  summary, `aria-expanded` + focus-visible ring preserved from the original bespoke version.
- Chip plan editor (shared by `/deadline` and `/transfers`) is now a `CollapsibleCard`, collapsed by
  default with the planned windows as its summary (`Wildcard GW4 · Bench Boost GW2 · Triple Captain
  GW16 · Free Hit not planned`), and its four chip rows became a `sm:2 / lg:4`-column grid instead
  of a tall single-column stack — the single biggest packing win, since four rows of one selector
  each were the emptiest part of both pages.
- `/deadline`: Squad readiness ‖ Availability paired `sm:grid-cols-2`; Captain & starting XI ‖ Chip
  call paired `lg:grid-cols-2` (Chip call's own Bench Boost/Triple Captain grid switches to a single
  column at `lg` so it doesn't squeeze inside the half-width card); Price & news watch became a
  collapsible supporting card summarising the change count.
- `/chips`: the two "Chip schedule · {half}" sections (GW1-19 / GW20-38 — FPL grants each chip once
  per half, so these were always two independent decisions shown one above the other) now sit
  `lg:grid-cols-2`; the gameweek-by-gameweek table became a collapsible supporting card summarising
  its GW range.
- `/transfers` needed no layout change beyond the chip-plan-editor fix — its existing
  `lg:grid-cols-[minmax(0,1fr)_360px]` split (Sprint 19) was already right; the waste was entirely
  above it.

## What was deliberately not done

The two existing bespoke collapses — `app/chips/page.tsx`'s fixture-flatness note and
`transfer-plan.tsx`'s free-transfers note — were **not** refactored onto `CollapsibleCard`, despite
being the reason it was extracted. Both are compact single-line notes (`text-[10px]`/muted styling,
no real "title") rather than named cards; forcing them into `CollapsibleCard`'s title+tier layout
would have visibly changed their size and weight for no reader benefit. They remain
design-system.md's flagged follow-on work — the primitive now exists for whoever picks it up.

## Verification

`npx tsc --noEmit`, `npm run lint` (0 new warnings — the pre-existing ~150 raw-hex warnings this
repo already carries are unaffected), `npm run build` all pass clean. Rivals logic verified against
the live deployed `sync-manager` Edge Function and Supabase tables (not mocked — see Context above);
the new pure functions verified with a throwaway `npx tsx` harness per this repo's engine-verify
discipline, not committed. Layout changes verified in the browser at desktop width (`/deadline`'s
Captain & XI ‖ Chip call pairing) and via DOM/text extraction where the preview pane was unavailable
(`/chips`).
