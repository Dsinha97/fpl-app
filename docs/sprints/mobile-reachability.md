# Mobile one-handed reachability — built 2026-08-22

No new sprint number — a follow-on to [design-audit-response.md](design-audit-response.md),
prompted by the owner sending a phone screenshot of `/deadline` with the hamburger trigger circled:
hard to reach one-handed, and visibly floating mid-header rather than sitting at either edge.

## Context

The screenshot surfaced two problems in the header, and a data bug in the ContextBar built the
same session as `design-audit-response.md`:

1. **The hamburger trigger floated mid-header.** `components/nav-links.tsx`'s mobile wrapper carried
   its own `ml-auto` alongside `app/layout.tsx`'s `AccountMenu` wrapper's `ml-auto` — two auto
   margins in one flex row split the leftover space between them instead of pushing either to an
   edge. The wrapper's own comment claimed it sat "at the header's right edge" and cited a
   `ThemeToggle` removed in Sprint 14.3 (theme lives in `account-menu.tsx` now) — stale on both
   counts.
2. **All 11 nav links dropped down from wherever that trigger sat**, landing in the hardest-to-reach
   band of the screen regardless of which hand held the phone (the owner uses both).
3. **The ContextBar showed "FT 15."** `TeamState.freeTransfers` is not always a real count —
   `teamStateFromMyTeamJson` (`lib/fpl-squad.ts`) sets it to `rules.squadSize` as a sentinel meaning
   "unlimited, no hit possible" for FPL's pre-deadline "unlimited" transfer state, specifically so
   `simulateTransfers` never invents a hit FPL wouldn't charge. `/deadline` and `/transfers` both
   clamped this before display; the ContextBar (new the same session) rendered it raw.

## What shipped

**Nav split and relocation** (`components/nav-links.tsx`, `app/layout.tsx`) — `NavLinks` used to be
one component returning a two-element fragment (the `hidden lg:flex` desktop row and the
`lg:hidden` mobile trigger). Moving just the mobile trigger to the header's left edge would have
dragged the entire 10-item desktop row in front of the logo too, since fragment siblings share one
DOM position regardless of which breakpoint currently shows which one. Split into `DesktopNav()`
and `MobileNav()`, rendered independently: `<MobileNav />` first (its `lg:hidden` wrapper
contributes zero width at desktop, so this has no effect there), then the logo, then `<DesktopNav
/>`, then the account wrapper. Dropped the mobile wrapper's own `ml-auto`, leaving exactly one in
the row — `AccountMenu`'s — restoring "everything packs left, avatar hard-right."

**Bottom-sheet drawer** (`components/nav-links.tsx`) — the trigger being reachable is one tap; the
11 links inside it landing in the thumb zone regardless of grip mattered more, and made the exact
corner the trigger sits in far less critical. Replaced the `absolute right-0 top-full … w-56`
dropdown with a sheet docked to the bottom edge: `fixed inset-x-0 bottom-0`, `max-h-[70vh]
overflow-y-auto`, `rounded-t-2xl`, `pb-[calc(...+env(safe-area-inset-bottom))]` for the home
indicator, a `bg-black/40` backdrop, and items at `py-3` (~44px) instead of `py-2` (~36px). All
three existing dismiss paths were kept — outside click, Escape, route change — plus a new backdrop
click handler, since a backdrop click lands *inside* the wrapper's DOM subtree (fixed positioning
doesn't change containment) so the existing outside-click check alone wouldn't have closed it.
Verified live: all 11 links render at exactly 44×44px; sheet correctly renders identically in dark
mode (`#2A0A45` surface); backdrop click, Escape, and a mousedown on unrelated page content all
close it; following a link closes it and navigates. One disclosed, un-fixed limitation: with 11
full-size items the topmost link still lands around 39% down the screen (not literally the
strictest "bottom 55%") — fitting 11×44px targets entirely inside that band without scrolling isn't
possible; this is still a large improvement over the old top-anchored dropdown.

**Free-transfers correctness and persistence** (`lib/transfers.ts`, `components/context-bar.tsx`,
`app/deadline/page.tsx`, `app/transfers/page.tsx`, `app/team/page.tsx`) — added
`freeTransfersDisplay(team)`, the one shared interpretation of `TeamState.freeTransfers`
(`{ kind: "unlimited" }` when a wildcard or free hit is the squad's `activeChip`, otherwise a count
clamped to `[0, MAX_FREE_TRANSFERS]` with any value *above* the cap — the import sentinel — falling
back to the documented default of 1, never to the cap of 5, which would itself read as a limit
nobody set). `/deadline` and `/transfers`' FT `<select>`s were page-local `useState(1)`, seeded from
the draft but never written back — exactly why the bar couldn't see what was picked. Both now
`saveDraft({ ...team, freeTransfers: n })` on change, the same pattern the chip-plan editor already
used in both files. `/team` gained its own FT control next to "Import as draft →" — the page
previously never loaded drafts at all, only ever *created* one, so it needed the same
`listDrafts`/`onDraftsChanged`/`resolveRequestedDraft` loader the ContextBar uses; `aria-disabled`
with a reason string when no imported draft exists yet, per the Sprint 19 convention. Verified live
against the exact bug: setting a stored draft's `freeTransfers` to 15 (the real sentinel value from
the original screenshot) now shows `FT 1` everywhere; setting 3 on `/deadline` and navigating to
`/players` shows `FT 3` on the bar; setting `activeChip: "wildcard"` shows `FT ∞` on the bar,
`/team`, and `/transfers` alike.

**Tap-target floor and tooltip flip** (`components/info-tooltip.tsx`, `app/builder/page.tsx`) — the
app declared no 44px target anywhere; the largest deliberate sizing was `min-h-9` (36px), and
`TapToReveal`'s own "?" circle and badge/label triggers ranged 12–16px. Added `relative` plus an
absolutely-positioned, empty `before` pseudo-element (`before:-inset-2.5` or a purpose-fit variant)
to `TapToReveal`'s base button — extends the *hit* area without touching the visible size or layout
of the trigger. Verified: the "?" trigger stays a visible 16×16px with a computed `-10px` inset on
every side, an effective 36×36px hit box. Safe everywhere it applies: every trigger's real
neighbours in the app are static, non-interactive spans (`AvailabilityBadge`/`RoleBadges` on
`/players`, separate grid cells on `manager-profile-card.tsx`), not other clickable elements, so a
halo has nothing to steal a click from. `app/builder/page.tsx`'s pool `+`/`⇄` button is the one
exception — it repeats in every row of a densely-packed table, so a *vertical* halo would reach into
the identical button one row up/down (a misclick there adds the wrong player, not a harmless
near-miss); given a horizontal-only expansion instead (`-inset-x-2`), verified safe against the
real ~16px row-to-row gap. The pager (`‹ Prev`/`Next ›`, opposite ends of a `justify-between` row)
and the revert button (alone in its own row) got the full halo.

`InfoTooltip`'s panel also gained a flip: `absolute top-full` unconditionally before, so a trigger
low on a long page (the `/players` table, a card deep in a list) opened a panel that rendered below
the fold with no way to see it. Now measures the room below the trigger at open time and flips to
`bottom-full` when it's short, the same "prefer below, flip above when there is not enough room"
rule `components/pitch-view.tsx`'s panel positioning already used — implemented as a simpler
viewport-height check rather than `pitch-view.tsx`'s full wrapper-relative pixel calculation, since
`TapToReveal` has no equivalent bounded wrapper to position against everywhere it's used. Verified
live: a trigger with only ~130px of room below correctly opened upward instead of rendering
off-screen.

## What was written up, not implemented

Recorded in the working plan (not a docs file) as a prioritized punch list for a later pass:

1. Horizon pills sit top-right on `/players`, `/compare`, `/scenarios`, `/transfers`, `/builder`
   and re-drive content several screens below — the biggest remaining structural issue. Candidate
   fix: a sticky bottom control bar on mobile, following the pattern the `/players` and `/scenarios`
   compare bars already establish.
2. `/players`' table is `min-w-[56rem]` (896px), 2.6× a 343px mobile viewport.
3. Smaller targets not covered here: 14px range-slider drag thumbs, 14px checkboxes, the
   `ActionMenu` caret, unsized close buttons on `/transfers`.
4. `/team` has its own coarse `fmtCountdown(deadline): string` (`app/team/page.tsx`), distinct from
   `lib/countdown.ts`'s live-ticking one used by `/deadline` and the ContextBar — a naming collision
   flagged for awareness, not merged, since the two serve genuinely different purposes (a coarse
   tile value vs. a live per-second display).

## Verification

`npx tsc --noEmit`, `npm run lint` (0 errors before and after every part; warning count unchanged
except new sticky-column literals following the already-established raw-hex pattern), and
`npm run build` all passed after each part. Full browser verification via the preview tools at
375×812 and 1280×800, both themes: trigger position, sheet contents/sizing/dismiss paths, desktop
row unaffected, the exact FT-15 bug reproduced and fixed, cross-page FT agreement, wildcard `∞`
display, tap-target hit-box sizes via `getComputedStyle(el, '::before')`, and the tooltip flip —
all as described above.
