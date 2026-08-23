# Sprint 24 — Expand/collapse polish

**Built** 2026-08-22, part of the same round as [sprint-22](sprint-22.md) and
[sprint-23](sprint-23.md). Every expandable card in the app (`CollapsibleCard`,
`LiveFixtureCard`, `ClubTacticsGrid`) previously used plain conditional render
(`{open && …}`) with a hand-drawn `⌃` glyph as the only visual feedback — content appeared
and disappeared instantly, and expanding one card inside a `flex flex-wrap` row reflowed the
whole row with no transition.

## What shipped

- **`components/ui/expand-toggle.tsx` (new).** A real 36px circular chevron toggle —
  `size="md"` (36px) for a standalone control, `size="sm"` (28px) inline beside a score line
  or card title. Colours come from the app's theme tokens (`border`, `primary`,
  `muted-foreground`), not literal hex values. Supports `interactive={false}` for the
  common case where a *different* element already owns the click (e.g. `CollapsibleCard`'s
  entire header row is one `<button>`) — rendering a second real `<button>` nested inside
  the first is invalid HTML and throws a hydration error, the exact bug found and flagged in
  [sprint-23](sprint-23.md)'s follow-on note. In that mode it renders a decorative `<span>`
  that previews its hover colour via `group-hover` when the owning button is hovered.
- **Grid-rows accordion.** Every expander now wraps its body in
  `grid-template-rows: 0fr` → `1fr` with `transition-[grid-template-rows]` and an
  `overflow-hidden` inner wrapper, replacing mount/unmount. Applied to
  `components/ui/collapsible-card.tsx` (propagating to every `CollapsibleCard` consumer),
  `components/live-fixtures.tsx`'s `LiveFixtureCard`, `components/club-tactics.tsx`'s
  `ClubTacticsGrid`, and the mobile nav drawer's group sections
  (`components/nav-links.tsx`'s `MobileNavGroup`, started in Sprint 22). Content now mounts
  unconditionally (height-zero, clipped) rather than being skipped while collapsed — checked
  each site for work that used to be skipped while `{open && …}` was false; none of the
  touched components do side-effecting work in their bodies, so this is safe.
- `self-start` was already present on `LiveFixtureCard` and `ClubTacticsGrid` (CLAUDE.md's
  documented fix for flex rows inflating a collapsed sibling) and was left untouched.

## Files touched

New `components/ui/expand-toggle.tsx`. Updated `components/ui/collapsible-card.tsx`,
`components/live-fixtures.tsx`, `components/club-tactics.tsx`, `components/nav-links.tsx`.

## Verification

`npx tsc --noEmit`, `npm run lint` (0 errors), `npm run build` all green. Confirmed via DOM
inspection that toggling `aria-expanded` correctly swaps `grid-rows-[0fr]` ↔
`grid-rows-[1fr]` and that content renders (non-zero `scrollHeight`) once expanded.

**Known verification gap**: this session's Browser pane runs with `document.visibilityState
=== "hidden"` throughout (confirmed directly, and consistent with earlier `screenshot`/
`scrollIntoView` calls timing out with "the Browser pane is not displayed, so the page is not
compositing frames"). Chromium freezes layout recalculation for backgrounded tabs, which
made `getBoundingClientRect()` return stale (zero) heights immediately after a class toggle
in this session specifically — reproduced with several unrelated CSS techniques (grid, plain
`max-height`), which pointed at the environment rather than the CSS. The animation itself
could not be visually confirmed smooth in this session; worth a quick look in a real,
foregrounded browser before considering this fully verified.
