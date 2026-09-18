# Sprint 37 — M9 design-audit Todo sweep

**Built 2026-09-18.** Linear parent [DSI-176](https://linear.app/dsinha-org/issue/DSI-176/sprint-37-m9-design-audit-todo-sweep-interface-writing-animation).

Takes the whole Linear Todo column as of 2026-09-18: 13 issues, all independent follow-ups from
the M9 design audit's `better-interface`/`better-writing`/`animate`/`emil-design-eng` scope
reviews. None had a Linear comment changing its scope, and none carries an unmet gate — each
issue's own description already contains a self-sufficient fix plan. Grouped into three phases,
each a stopping point.

## Phase 1 — Interface / accessibility

| Issue | Fix |
|---|---|
| [DSI-156](https://linear.app/dsinha-org/issue/DSI-156) | `text-zinc-400` → `text-zinc-500` across 5 components — light-theme contrast was ≈2.35:1, below WCAG AA |
| [DSI-155](https://linear.app/dsinha-org/issue/DSI-155) | Missing `aria-label` on an icon-only pin button in `chip-timing.tsx`, plus an app-wide sweep for the same `title`-only gap |
| [DSI-154](https://linear.app/dsinha-org/issue/DSI-154) | `type="button"` + `focus-visible` ring on the club-tactics expand control, matching `fdr-matrix.tsx`/`nav-links.tsx` |

## Phase 2 — Writing

| Issue | Fix |
|---|---|
| [DSI-153](https://linear.app/dsinha-org/issue/DSI-153) | Drop changelog language ("Now folded into...") from the compare panel's form-weight hint |
| [DSI-150](https://linear.app/dsinha-org/issue/DSI-150) | Clarify "last recorded" in the league-rank tooltip — FPL's previous scored gameweek, not this app's sync time |
| [DSI-152](https://linear.app/dsinha-org/issue/DSI-152) | Map raw OAuth error codes (e.g. `access_denied`) to friendly copy on the sign-in callback, plus a stall timeout |
| [DSI-151](https://linear.app/dsinha-org/issue/DSI-151) | Explain what Std dev *means* for the reader, not just name it — matching the Spread/Trend sibling tooltips |

## Phase 3 — Animation

| Issue | Fix |
|---|---|
| [DSI-145](https://linear.app/dsinha-org/issue/DSI-145) | Replace `transition-all` on the shared `Button` primitive with an explicit property list |
| [DSI-144](https://linear.app/dsinha-org/issue/DSI-144) | `active:scale-95` press feedback on the pitch-view player slot button |
| [DSI-149](https://linear.app/dsinha-org/issue/DSI-149) | Fade in transfer-plan and decision-analytics results instead of popping in |
| [DSI-148](https://linear.app/dsinha-org/issue/DSI-148) | Animate player-detail's expand content with the same `grid-template-rows` technique as `CollapsibleCard`, to match its own chevron |
| [DSI-147](https://linear.app/dsinha-org/issue/DSI-147) | Animate `SlideOver` left/right variants like the bottom-sheet variant already does |
| [DSI-146](https://linear.app/dsinha-org/issue/DSI-146) | Animate the shared `TapToReveal`/`FilterDisclosure` popover panels — one shared-hook change covers 5+ call sites |

## Status

**Built and verified 2026-09-18.** All three phases implemented, typechecked, linted, and
checked live in the browser preview (signed in as the dev test account where the surface needed a
session — `/leagues`, `/team`) — all 13 issues plus the parent closed in Linear the same day.

- **Phase 1** verified: `zinc-500` clears AA contrast in light theme; the club-tactics focus ring
  shows a real `box-shadow` on keyboard focus and `type="button"` didn't break Enter/Space toggle;
  the aria-label sweep found and fixed one more `title`-only pin button beyond the one named in
  DSI-155 (`chip-timing.tsx:870`) — every other icon-only `Button` app-wide already carried both.
- **Phase 2** verified: the compare-panel hint, the league-rank tooltip's live text, both OAuth
  callback paths (`?error=access_denied` and an unrecognized code), and the Std dev tooltip on
  `/team`'s Manager Profile card all render the new copy exactly as specified.
- **Phase 3** verified: the shared `Button` transition property list, pitch-slot `active:scale-95`,
  the player-detail grid-row expand (measured height animates, content unclipped), the mobile nav
  drawer's `panel-slide-left` and the desktop `/compare` panel's `panel-slide-right` (both settle
  with no horizontal overflow), and the `TapToReveal`/`FilterDisclosure` `@starting-style` fade —
  all confirmed via computed styles and screenshots.
  **One exception:** `components/transfer-plan.tsx`'s fade (DSI-149's first half) could not be
  exercised live — Sprint 28 already removed `<TransferPlan>` from both `/transfers` and
  `/deadline`, so the component is currently unreached by any route. The fix at the ticket's own
  file:line is applied and typechecks/lints clean; `decision-analytics-panel.tsx`'s half of the
  same ticket (live on `/team`) verified fine.
