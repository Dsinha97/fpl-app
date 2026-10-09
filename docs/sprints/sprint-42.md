# Sprint 42 — Mobile redesign: Deadline, Transfers, Fixtures, Builder

**Built 2026-10-08**, based on `main` after Sprint 41 (PR #43) merged. This is the follow-on that
[sprint-41.md](sprint-41.md) scoped out: the same primitives, applied to the four routes it left
on the old layout. Parent issue: DSI-215, related to DSI-214. The Linear Todo column was empty;
the owner asked for this directly.

The principles are Sprint 41's, unchanged:

- one key number, pinned to a fixed corner;
- one axis per section;
- no cards nested inside cards;
- bottom sheets for secondary tasks;
- 44px targets;
- an 11px text floor.

Everything here applies **below `sm`** (below `lg` for the `/transfers` picker). Desktop layouts
are unchanged except where noted.

## What changed

### Shared

- **`FilterDisclosure`** (`components/ui/filter-disclosure.tsx`) is a bottom sheet below `sm`.
  The 26rem popover anchored top-left was out of thumb reach, and its wrapped row was the widest
  thing on `/players`. The sheet has the same children and the same state. It has a heading, an
  "N active" count and a 44px "Show results" button. Both callers got it for free: the
  `PlayerFilters` bar (`/players`, the builder picker) and the builder's replacement filters.
  `PlayerFilters` and the builder's filter body now stack one control per line at 44px on a
  phone, with the special-filter pills 44px tall.
- **Profile `StatCell`** (`components/player-modal/stat-cell.tsx`) is now a hairline above each
  cell, not a bordered tile. The profile is already a sheet, so a grid of boxed tiles inside it
  was a card inside a card. The Overview's Price-watch section and its three projection boxes
  lost their frames the same way, and every 10px label in the profile is now 11px.
- **`HeroStat`** values are `whitespace-nowrap`. The `/deadline` countdown ("1d 7h 8m") was
  wrapping onto two lines in the corner.

### `/deadline`

- **Hero:** the countdown, pinned top-right in the page header. From `sm` up it stays under its
  own heading, as before.
- **Squad picker:** the header `<select>` is a full-width row reading "Squad <name>". With more
  than one draft, the row opens a radio-list bottom sheet; with one, it is plain text, because
  there is no choice to make.
- **Cards:** both card tiers (`card`, `cardSupporting`) lose their frame and inset below `sm` and
  become sections under a hairline. So do the chip valuations inside the chip call, which were
  cards inside a card.

### `/transfers`

- **Hero:** the simulation's net gain, labelled **Net xP**, pinned top-right of the result. Its
  terms stay on the left (`−2.9 xP · no hit`), never folded into it. The old 3xl headline
  number is gone, and this applies at every width: the 360px rail has room for the corner too.
- **Replacement picker:** a bottom sheet below `lg`. It used to be a bordered box inline under
  the squad table, which Sprint 23 had to scroll into view, and on a phone it was a card inside
  the squad card. The search box and candidate rows are 44px there.
- **Plan settings:** on a phone, one row reading back the settings summary with "Edit", opening
  a sheet. From `sm` up it is still the collapsible card. Both render the one `settingsBody`.
- **Bug fixed — page 4,800px wide with a move queued.** The result `<aside>` had no `min-w-0`,
  and its two collapsed `NoteDisclosure`s are single unwrapped lines. So the grid column took
  their full width as soon as a transfer was queued. The signed-out, no-move pass reads
  `scrollWidth === innerWidth` and never sees it. This is the CLAUDE.md "a scroll container
  only works if every ancestor may shrink" gotcha again.

### `/fixtures`

- **Hero:** the next gameweek (`Next · GW6`). Every view is read relative to it: the schedule
  opens there and the FDR window starts there.
- **FDR settings:** a summary row plus a bottom sheet, the same shape as `/transfers`.
- **Schedule:** gameweek sections lose their card frame below `sm` and become one list divided
  by hairlines.

### `/builder`

- **Hero:** the squad's projection over the horizon, pinned top-right. The captain and vice sit
  on the left. Below them, a `StatStrip` of Next GW · Armband · Players replaces the wrapping
  row of three blocks.
- **Gameweek lineup:** its stats are one `StatStrip` (Formation · XI · Bench · Armband ·
  **Total**, with the total as the accent) instead of the two-column `dl`. "Bench (raw)" is
  dropped on a phone, since the strip shows the auto-sub figure and the `dl` from `sm` up still
  has both.
- **Cards:** the xP panel, lineup, optimiser, replacement finder and search cards lose their
  frames below `sm`. Selects in them are 44px.

### Fixed-bottom bars

None of the four routes has one. A grep for `fixed`/`bottom-0` across them, `transfer-plan`,
`fixture-schedule` and `fdr-matrix` found only the builder's desktop slot popover, which is
top-anchored. Every bottom-edge surface added here is a `SlideOver`, which already covers the
tab bar. So `ABOVE_BOTTOM_TABS` had nothing new to lift.

## Decided against

- **The builder's replacement finder stays inline, not a sheet.** It has its own
  `FilterDisclosure`, which is now itself a sheet on a phone, so a sheet would have to open a
  sheet on top of itself. It is flattened instead.
- **Native `<select>`s inside cards stay native** (the builder's gameweek and optimiser selects,
  the FDR sort). On a phone the OS already presents a native select as its own sheet or wheel.
  They are 44px tall now.
- **The `?` glyph in `InfoTooltip`'s trigger is 10px.** It is an icon inside a 16px circle, not
  text, so the 11px floor doesn't apply. It is the only sub-11px text left on the four pages.

## Verification

- **Typecheck, lint, build:** `/ship-check` passes all three.
- **Overflow at 375 and 1280 (`/responsive-check`):** each page was loaded with a saved
  15-player draft, and `document.body.scrollWidth === innerWidth` held for all four at both
  widths. At 1280 the top-level document reads 1265 = 1265 (`clientWidth`, after the
  scrollbar).
- **Interactive state:** checked at 375 with the sheet or state open:
  - `/transfers` with a move queued (this is where the overflow above was found);
  - the `/deadline` squad sheet;
  - the `/players` filter sheet;
  - the `/fixtures` FDR settings sheet;
  - the profile Overview.
- **Themes:** screenshots in both light and dark.
- **Text floor:** a scan for computed `font-size < 11px` inside `<main>` found only the
  `InfoTooltip` glyph.
- **Still to do:** a check on a real phone before merge, as Sprint 41 also needs: sheet drag
  and keyboard behaviour in the picker search. The preview pane's screenshots were intermittently
  mis-scaled, so layout claims above rest on DOM measurement.

## Linear

DSI-215 was created in milestone "M8 · Beyond this season", related to DSI-214, and set to In Progress.
On merge, close it and add its row to [../linear.md](../linear.md).
