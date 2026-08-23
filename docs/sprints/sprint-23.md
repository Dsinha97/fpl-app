# Sprint 23 — Page density

**Built** 2026-08-22, part of the same round as [sprint-22](sprint-22.md) and
[sprint-24](sprint-24.md). `/builder` and `/transfers` already used a
`grid-cols-[minmax(0,1fr)_360px]` two-column template; the rest of the app stacked
full-width sections instead, forcing long scrolls to see the same information the wide
desktop screen had room for side by side.

## What shipped

- **`/deadline`** (`app/deadline/page.tsx`): the Live card's BPS-race block used to be
  `sm:col-span-2` inside its own grid, stretching across the full card width and leaving a
  gap next to the fixture grid. It's now the left column of a two-column row, with **Price &
  news watch** and **Team news** (moved up from the bottom of the page) as a right rail
  beside it. The squad section got the same treatment: `PitchView` on the left, with
  **Squad readiness**, **Availability**, **Captain & starting XI**, and **Chip call**
  stacked in a rail on the right, replacing what used to be two separate paired grids
  stacked full width.
- **`/team`** (`app/team/page.tsx`): deleted the position-grouped squad list — the same 15
  players `PitchView` already shows above it, kept only because the free-transfers select
  and "Import as draft" button lived in its header. Those two moved into a small
  "Free transfers" card in a new right rail, alongside the points tiles (now 2-up instead of
  a 6-across full-width strip) and **Your Leagues** (moved up from further down the page).
  Also normalised this page's repeated inline `border-zinc-200 bg-white …
  dark:border-purple-900/40 dark:bg-[#1E0234]` to the `bg-card`/`bg-card-supporting` tokens
  `/deadline` and `/chips` already use.
- **`/transfers`** (`app/transfers/page.tsx`): the replace-candidate picker used to render
  once, appended below the entire squad table — "Replace" on any row opened a panel with no
  visual link to that row, and off-screen on mobile with no signal it had opened. The picker
  body is now built once (`pickerBody`) and rendered twice: in the existing right `<aside>`
  on desktop (above the simulation result), and inline below the table on mobile with
  `scrollIntoView({ behavior: "smooth" })` on open. The originating row gets a highlight
  ring while its picker is open, so the connection survives a scroll. Table cell padding was
  also tightened slightly to free width for the action column.
- **`/chips`** (`app/chips/page.tsx`): the "Chip sequences" card's explainer paragraph moved
  into an `InfoTooltip`; the "Front-loaded" preset's two-sentence note split into a one-line
  `note` plus a `detail` shown in its own tooltip (the reasoning didn't disappear — CLAUDE.md's
  "say what the number means" still applies, it just isn't the default view). Sequences now
  sit in a left column with the fixture-flatness disclosure below them; the two chip-schedule
  cards (GW1-19, GW20-38) stack in a right rail beside them, replacing what used to be three
  full-width sections stacked in a row. The bespoke amber disclosure was replaced with
  `CollapsibleCard`, which gained a new `"amber"` tier for it.

## Files touched

`app/deadline/page.tsx`, `app/team/page.tsx`, `app/transfers/page.tsx`, `app/chips/page.tsx`,
`components/ui/collapsible-card.tsx` (new `amber` tier).

## Verification

`npx tsc --noEmit`, `npm run lint` (0 errors, warning count unchanged or lower), `npm run
build` all green. Browser-driven at 1280px and 375px: confirmed each page's new two-column
grid renders with matching left/right column widths and y-alignment (measured via
`getBoundingClientRect()`); confirmed `/team`'s squad list is gone and free-transfers/import
still work from the new rail; confirmed `/transfers`' picker renders in the aside on desktop
and inline on mobile (only one is visible at a time via `lg:hidden`/`hidden lg:block`), and
that the originating row highlights while picking.

## Follow-on found, not fixed here

The candidate row in `/transfers`' picker is a `<button>` wrapping a `TapToReveal` "exit
routes" trigger, which is itself a `<button>` — invalid HTML (button inside button), throwing
a real React hydration error. Pre-existing before this sprint (the exact same JSX was
relocated here, not introduced), flagged as its own follow-up rather than fixed in this pass.
