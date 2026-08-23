# Sprint 22 — Navigation & shell

**Built** 2026-08-22, prompted by a round of real-device review of the shipped build
(screenshots from the owner's phone plus the desktop app) that surfaced one functional bug
and three classes of UI debt. Full plan: this sprint plus [sprint-23](sprint-23.md) and
[sprint-24](sprint-24.md) were scoped together in one planning pass; see the plan file's
Context section for the complete list of findings.

## What shipped

- **Fixed the FT tooltip overflowing off-screen on mobile.** `TapToReveal`
  (`components/info-tooltip.tsx`) only ever flipped vertically and never clamped
  horizontally, so the `FT ?` tooltip in the sticky context bar — anchored mid-row on a
  narrow phone — ran off the right edge. Positioning for both `TapToReveal` and
  `FilterDisclosure` now goes through one shared hook, `useAnchoredPanel`
  (`components/ui/use-anchored-panel.ts`), which clamps on both axes; `useDismissablePopover`
  in the same file is the shared outside-click/Escape convention, also now used by
  `MobileNav`.
- **Removed an internal filename from user-facing copy.** The same FT tooltip's text
  referenced `CLAUDE.md` — rewritten to describe the constraint without naming a repo file.
- **Grouped navigation.** `components/nav-links.tsx`'s flat 11-link `NAV` became
  `NAV_GROUPS`: **Live** (Deadline, My Team, News), **Strategy** (Builder, Scenarios,
  Transfers, Chips), **Statistics** (Players, Compare, Fixtures). `/status` left the nav
  entirely, moving into `AccountMenu` beside "Manage account" — a data-freshness page
  belongs there, not competing for a top-level slot.
  - **Desktop**: three `@base-ui/react/menu` dropdowns instead of eleven links — the same
    primitive `ActionMenu` (`components/ui/action-menu.tsx`) already used, so keyboard nav
    and focus management came for free.
  - **Mobile**: the bottom sheet became a **left-side drawer** sliding from the same edge as
    the hamburger trigger. The trigger-and-result used to be at opposite ends of the
    viewport; docking to the same edge fixes that. Groups inside the drawer expand
    independently (`MobileNavGroup`).

## Files touched

`components/nav-links.tsx`, `components/account-menu.tsx`, `components/context-bar.tsx`,
`components/info-tooltip.tsx`, `components/ui/filter-disclosure.tsx`, new
`components/ui/use-anchored-panel.ts`.

## Verification

`npx tsc --noEmit`, `npm run lint` (0 errors), `npm run build` all green. Browser-driven:
confirmed the FT tooltip panel stays within a 375px viewport (measured
`getBoundingClientRect()` directly, since the panel is `fixed`-positioned); walked all three
desktop dropdowns and confirmed active-group highlighting; opened the mobile drawer and
confirmed it slides from the left, closes on backdrop/Escape/link-follow, and locks body
scroll while open; confirmed Status renders in the account dropdown.
