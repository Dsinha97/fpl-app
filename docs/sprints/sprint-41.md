# Sprint 41 — Mobile redesign: foundation and three key screens

**Built 2026-10-08** on `feat/sprint-41-mobile`. Parent issue: DSI-214. This came from the owner's
request, not from the Todo column, which was empty. The owner compared the app at phone width with
the official FPL app's player sheet and with a set of mobile-layout principles:

- a bottom tab bar of 3–5 items, with a full-page hub for everything else;
- type that doesn't shrink on mobile;
- one main element per screen, laid out along one axis;
- no cards nested inside cards;
- bottom sheets for secondary tasks, and the navigation hidden while a focused task is open;
- empty states that offer a way out;
- key numbers in fixed positions, away from the body of text.

Three owner decisions shaped it:

- **Tabs:** Deadline · My Team · Players · More.
- **Scope:** the foundation plus three screens.
- **Players at phone width:** card rows carrying one key number, not a smaller table.

## What was wrong at 375px

- **Navigation:** a hamburger in the top-left opened a drawer of three collapsed accordions, so
  every destination took at least two taps. Account links lived in a separate menu.
- **`/players`:** a `min-w-[56rem]` table with 80px rows. Six players fitted on screen, and you had
  to scroll sideways to reach xP.
- **Pitch player panel:** ten equal stats in a 3-column grid with 10px labels.
- **Pitch cards:** names at 9px and fixtures at 7–8px.
- **iOS safe areas:** no `viewport-fit=cover`, so every `env(safe-area-inset-*)` already in
  `SlideOver` evaluated to 0.
- **Touch behaviour:** no tap-highlight, `touch-action` or input-zoom rules.
- **`ContextBar`:** wrapped to two lines, so the sticky header grew taller.

## What changed

### 1. Platform baseline
Applied with the `mobile-native` skill.

- **`app/layout.tsx`:**
  - `export const viewport` sets `viewport-fit=cover` and `interactive-widget=resizes-content`.
  - The header pads by `safe-area-inset-top`.
- **`theme-color`:** a single `<meta name="theme-color">` whose value follows `.dark`. Both
  `THEME_BOOT_SCRIPT` and `applyMode` set it (`components/theme.tsx`). It is not a pair of
  `prefers-color-scheme` tags, because an explicit Light/Dark choice in the account menu overrides
  the OS. The values are the header's own colours, `#ffffff` and `#1e0234`.
- **`globals.css`:**
  - Tap highlight off.
  - `text-size-adjust: 100%`.
  - `touch-action: manipulation` on controls.
  - `user-select: none` on buttons and tabs only (links stay selectable).
  - Inputs at 16px on a coarse pointer, which stops iOS zooming into a focused field. That rule is
    unlayered on purpose, because `text-sm` utilities beat `@layer base`. Zoom stays enabled.
- **`ContextBar`:** squad Value is hidden below `sm`, so the bar stays on one line. Bank and FT
  stay, since those are the numbers a transfer decision needs.

### 2. Bottom tab bar and the More hub
- **`components/bottom-tabs.tsx`:**
  - Four tabs below `lg`, each about 94px wide with an icon and a label.
  - The tab marks itself active and gives press feedback on touch-down.
  - Pads by `safe-area-inset-bottom`.
- **`app/more/page.tsx`:** every other route, one row each with a one-line description, plus the
  account rows. The route list comes from `NAV_GROUPS` through `MORE_GROUPS`, so the desktop nav
  and the hub can't drift apart.
- **`MobileNav` deleted.** Desktop navigation is unchanged.
- **`useHideBottomTabs(active)`:** a ref-counted "focus flow" that hides the bar. The full player
  profile uses it.
- **`ABOVE_BOTTOM_TABS`:** lifts the three other bottom-fixed bars above the tab bar — `/players`'
  compare bar, `/scenarios`' compare bar, and the draft-sync toast.

### 3. `HeroStat`, `StatStrip`, `FixtureRun` (`components/ui/stat-strip.tsx`)
- **`HeroStat`:** the one number a screen answers, pinned top-right.
- **`StatStrip`:** at most five supporting numbers in one row, divided by hairlines rather than
  boxed as cards. It uses `minmax(0,1fr)` tracks (see DSI-138/141).
- **`FixtureRun`:** the next five fixtures as difficulty pills. Venue is shown as text and also by
  `venueRing()`.

### 4. Pitch sheet (`components/player-detail.tsx`)
Modelled on the official app's player sheet:

- **Header:** club and position chip, then the name, with xP (or the gameweek's points) as the
  hero in the corner.
- **Stat strip:** Price, Total pts, Form, Owned and Exp. mins. A stat the caller has no value for
  is dropped rather than shown as a dash.
- **Fixture run.**
- **Actions:** on a phone, 48px rows that say what they do (Make captain, Make vice-captain,
  Replace, Remove from squad). The full-width "Full profile" button is the way on to everything
  else. The desktop popover keeps its compact button row.

Two data fixes came with it:

- **`/team` sheet stats:** the sheet now gets `upcoming`, built from fixtures already fetched,
  extended past the latest picked gameweek. It also gets `total_points` and `form`. Before this,
  the sheet read "—" for a season total the page already had.
- **Pitch cards:** name, number and fixture each get a full-width row, at 11px, 12px and 10px.
  That made the cards taller, which exposed a latent pitch bug, described next.

**Pitch bug found and fixed:** `InteractivePitch` had `overflow-hidden`, and an `overflow-hidden`
box ignores its content for the aspect-ratio automatic minimum. So when the cards grew, the
forwards were clipped under a pitch that would not get taller. The clipping now sits on the artwork
layer, and the aspect ratio acts as a floor.

### 5. Player Explorer (`app/players/page.tsx`)
- **Below `sm`:** a card list replaces the table. Each card shows the name, club · position · price,
  and the active sort's value as the hero, right-aligned. There's a 44px compare checkbox, and a
  tap opens the profile. The table is unchanged from `sm` up.
- **Sort:** a bottom sheet with 18 options, every one labelled in words, plus a direction toggle.
- **Zero results:** names the query, suggests the likely fix, and offers "Clear search and filters"
  (desktop too).

### 6. Player profile (`components/player-modal.tsx`)
- `HeroStat` in the header: xP, with the price underneath.
- On a phone, the actions moved to a bar along the bottom edge.
- The tab bar is hidden while the profile is open.
- The fixture run opens the Overview tab.

## Deliberately not done
- **Player filters:** still the shared inline `PlayerFilters` disclosure; it isn't a bottom sheet.
  The component is shared with `/builder`'s picker, and it is already one row on a phone.
- **No typo suggestions:** zero-results says "check the spelling". There is no fuzzy matcher to
  suggest a correction, and inventing one was out of scope.
- **Profile Overview:** still `StatCell` tiles inside the sheet, so these are still cards nested in
  a card. They carry the rank bars, and restyling them is a pass of its own.
- **Not migrated yet:** Transfers, Fixtures, Builder and Deadline.
- **Gestures:** no parallax back-swipe and no long-press menus.

## Verification
- `tsc`, `eslint`, `next build`: pass.
- **Measured in the preview browser** at 375×812 (dark) and 1280×800 (light), with manager 274486:
  - `scrollWidth === innerWidth` on `/more`, `/team` and `/players`.
  - The forwards row is fully visible.
  - The sheet's stat strip matches the official app for Groß: £5.9m, 47 pts, form 15.5.
  - The sort sheet re-sorts the list.
  - "haalandd" shows the zero-results state.
  - The profile hides the tab bar.
  - Desktop shows the table, the desktop nav, and no tab bar.
- **Needs a real phone:** none of these reproduce in emulation —
  - the safe-area insets around the tab bar and home indicator;
  - the status-bar colour;
  - tap delay;
  - input zoom;
  - the keyboard pushing the layout up.
