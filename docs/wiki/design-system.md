# Design system

The token contract, the button/state vocabulary, the busy-state pattern, and the disclosure rule —
built in Sprint 19, replacing what used to be three sentences under
[frontend-conventions.md](frontend-conventions.md)'s "Theme" heading.

## The token layer (`app/globals.css`)

`:root` (light) and `.dark` define the same set of custom properties, consumed via Tailwind v4's
`@theme inline` block so a class like `bg-card` or `text-danger` resolves to the right value in
either theme with no `dark:` prefix needed. The values were derived from the exact computed hex of
the Tailwind utilities every component already used — `bg-purple-950` → `#3c0366`,
`border-zinc-200` → `#e4e4e7` — not guessed, so migrating a literal to its token is meant to be
visually silent. Verified live for every migration in this sprint via `getComputedStyle` diffed
against the literal it replaced.

- **Surfaces**: `--background` → `--card` → `--surface-3` is a three-step raise (page → raised card
  → popover/input), matching this app's existing dark-mode identity (`#0e0118` → `#1e0234` →
  `#2a0a45`) rather than relying on shadows, which don't read in dark mode. `--popover` is pinned to
  `--surface-3` specifically because every actual popover/menu component (`nav-links.tsx`,
  `account-menu.tsx`, `ui/filter-disclosure.tsx`, `ui/action-menu.tsx`) already rendered there — the
  token used to point at the card surface instead and simply disagreed with every consumer.
- **Two-tier cards**: `--card` (primary — full padding, raised) and `--card-supporting` (+
  `-foreground`/`-border`) — flush with the page background, fainter border, smaller padding. Use
  `--card` for the thing a page is named after (the actual decision or result); `--card-supporting`
  for context that isn't itself a decision. See [Card hierarchy](#card-hierarchy-stage-4a) below.
- **Semantic status**: `--success`/`--warning`/`--danger`, each with `-foreground`/`-surface`/
  `-border` variants, in `lib/semantic-colors.ts` (shaped like `lib/fdr.ts` — the one colour system
  in this repo that already worked before this sprint). Seeded from the pairs that were already
  dominant by usage count before formalisation: `emerald-700`/`emerald-400` (positive),
  `amber-700`/`amber-400` (warning), `red-700`/`red-300` (negative) — collapsing the ~40 one-off
  variants (`red-600` vs `red-700` vs `red-800`, etc.) used interchangeably for the same role.
- **`--primary-hover`**: one token instead of three ad-hoc dark-mode green shades (`#00e67a` ×15,
  `#00e078` ×3) that existed for the identical button role.
- **Not migrated wholesale.** ~300 raw hex literals existed across 25 files before this sprint; only
  the files a stage already touched were converted (down to ~150 warnings from the new lint rule,
  from 229 total warnings at the start). A blind mechanical replacement across a codebase with zero
  visual-regression tests was judged a worse trade than a slower, verified migration. The lint rule
  (`eslint.config.mjs`, `no-restricted-syntax`, warning-level so it never blocks a build) stops the
  bleed on new code without forcing an unreviewed diff on old code. `lib/fdr.ts` is exempt — its
  `hexCode` field is a deliberate non-`className` value feeding SVG/canvas, and its palette is
  CVD-validated — `lib/fdr.ts`'s own header comment records a 12.3 ΔE adjacent-pair separation
  (protan), against a 17.4 normal-vision floor, from the dataviz palette validator.

## Button and interaction states

`components/ui/button.tsx` (a shadcn-derived component with `focus-visible:ring-3`,
`disabled:opacity-50`, `active:translate-y-px`, and full token consumption) existed with zero
importers before this sprint, while 83 raw `<button>` elements across the app had 6
`focus-visible:` occurrences between them, none on a button. Rather than force a risky full swap to
the `<Button>` component across every call site with no test suite to catch a regression, Sprint 19
applied its exact treatment directly to every control on `/transfers`, `/chips`, `/builder`, and the
shared components those pages use:

- **Every interactive element** (button, input, select) gets `focus-visible:outline-none
  focus-visible:ring-2 focus-visible:ring-ring`.
- **Toggle groups** (the horizon pills, the FDR-window pills, replace-limit buttons) get
  `aria-pressed` and a `border-transparent` on *both* selected and unselected states — fixing a real
  1px shift where only the unselected side carried a border.
- **Disabled controls with an explanation** use `aria-disabled` + a `title`/reason string rather than
  the plain `disabled` attribute, following the convention `ui/action-menu.tsx` already used and
  documented in a comment: a genuinely `disabled` element drops out of the tab order, so a keyboard
  or screen-reader user would never reach the reason. Plain `disabled` remains correct where there is
  no reason worth giving.
- **Follow-on closed 2026-08-22**: `/players`, `/compare`, `/fixtures`, `/scenarios`, `/team`,
  `/settings`, and `/deadline`'s previously-missed controls, plus `components/nav-links.tsx` and the
  signed-out home page's two CTAs, all gained the same `focus-visible:ring-2 focus-visible:ring-ring`
  shape — closing the gap this bullet used to describe. The legacy `focus:border-*` inputs in the
  same files were converted to `focus-visible:` alongside. See
  [design-audit-response.md](../sprints/design-audit-response.md).

## The busy-state pattern (Stage 3)

`optimizeTransfers` and `runChipEngine` are real bounded searches, not lookups — they used to run
inside a bare `useMemo`, freezing the main thread on every recompute, with `loading={plan === null}`
on `/transfers` only ever true *before* the memo ran, never during it (making the "Searching…"
string dead code). The correct pattern already existed in this codebase, just only in one place
(`planTransferPath` in `app/transfers/page.tsx`):

```
setLoading(true);
setTimeout(() => {
  const result = expensiveSearch(...);
  setResult(result);
  setSignature(currentInputsSignature);
  setLoading(false);
}, 0);
```

The `setTimeout(0)` yields one frame so a busy indicator can actually paint before the search blocks
the thread. Both engines now follow this shape:

- **Auto-run once** on first load, so opening the page still shows a result without a click.
- **A signature of the inputs that mattered** (horizon, free transfers, decision margin, chip plan,
  squad/draft) compared against what was true the last time the engine actually ran. A changed input
  surfaces an "Inputs changed — re-run" banner instead of either silently recomputing (which is what
  caused the freeze) or silently showing a stale result under a fresh-looking label.
- **`components/ui/spinner.tsx`** and **`skeleton.tsx`** — the first `animate-*` classes anywhere in
  this app — wired into every new busy label plus `role="status"` on the plain "Loading …" lines
  that previously announced nothing to a screen reader. Both honour `prefers-reduced-motion`.
- `/builder`'s `optimizeSquad` (a synchronous knapsack fill, not memoised, but with no busy state or
  re-entry guard) gained both: a plain re-entry check before any state changes, and `disabled` on
  its trigger buttons, closing a real bug where a double-click could run the search twice.

## Card hierarchy (Stage 4a)

`/deadline` rendered eight sibling sections — deadline countdown, squad, readiness, availability,
captain & XI, chip call, transfer call, price & news watch — all sharing one `card` constant at
identical padding, radius, and border. Nothing outranked anything else, so the page read as a list,
not an answer. `/chips` and `/transfers` had the same shape.

The fix keeps every section but ranks it:

| Page | Primary (`--card`) | Supporting (`--card-supporting`) |
|---|---|---|
| `/deadline` | Squad, Captain & starting XI, Chip call, Transfer call | Squad readiness, Availability, Price & news watch |
| `/chips` | Chip sequences, the two chip-schedule halves | The per-chip shortlist grid, the gameweek-by-gameweek table |
| `/transfers` | The simulation result (accent-bordered, matching `/chips`' convention) | The squad-picking table, the picker's "choose a player" instruction card |

`/deadline`'s countdown lost its card entirely — a border around one line of text was chrome, not
structure. The 3xl countdown number is unchanged, just unboxed. Where a page had two competing
heading vocabularies for section titles (`text-xs uppercase tracking-wide` vs `text-sm font-semibold`
used interchangeably for the same role, sometimes on the same page), one was picked and size now
carries rank consistently.

Content-preservation was verified by diffing each page's full rendered text before and after — this
stage changes weight and padding only, never drops a section or a disclosure string.

### Packing, not just ranking (2026-08-20)

Ranking cards fixed *which* card matters more; it left the actual defect the owner reported
unfixed — short cards (four rows of one dropdown each in the chip plan editor; a two-line readiness
list) still burned a full-width row of dead space. The follow-on pass repacked rather than
re-ranked: `/deadline` pairs Squad readiness ‖ Availability and Captain & starting XI ‖ Chip call
side by side (`sm:`/`lg:grid-cols-2`); `/chips` pairs its two chip-schedule halves the same way
(GW1-19 / GW20-38 — FPL grants each chip once per half, so these were always two independent
decisions, never one that should be summed); and a new `CollapsibleCard` primitive (see
[Disclosure](#disclosure) below) collapses the chip plan editor, `/deadline`'s price & news watch,
and `/chips`' gameweek-by-gameweek table to a title + one-line summary by default. Full detail:
[rivals-and-card-density.md](../sprints/rivals-and-card-density.md).

### Expandable-card stretch (2026-08-22)

A different card-pairing bug from the one above: `sm:grid-cols-2`/`flex-wrap` rows of
**independently-expandable, variable-height** cards — `LiveFixtureCard` and `ClubTacticsGrid` on
`/deadline`/`/fixtures`, not the fixed-content `CollapsibleCard` pairs above — stretch every card in
a row to match its tallest sibling by default (`align-items: stretch`). Expand one card and its
still-collapsed row-mate either shows dead space (`stretch`, the default) or a ragged bottom
(`items-start`). Switching the container from CSS Grid to `flex flex-wrap` with a fixed
`w-[calc(...)]` basis per card — the layout `/deadline`'s live hub already used — is only half the
fix: flex rows default to `align-items: stretch` too, so an expanded card still inflates a
collapsed neighbour. The actual fix is `self-start` on the card itself, alongside the
`w-[calc(...)]` basis. Verified live: expanding the GW1 Hull–Man Utd card grew it to 436px while
the still-collapsed Arsenal card beside it stayed at 80px. — CLAUDE.md's card-layout gotchas

### Two more mobile-layout bugs, neither about stretch (2026-08-22)

- **`/transfers`' decision summary rendered below the squad table and picker on a phone.** The
  `<aside>` holding net xP/hits/bank sat second in `lg:grid-cols-[minmax(0,1fr)_360px]`'s DOM order
  — a sensible right rail on desktop, but the grid collapses to one column below `lg`, so the actual
  decision output landed under two other sections instead of leading them. Fixed with `order-first
  lg:order-none` on the `<aside>` alone: `order-first` (`order: -9999`) wins on mobile where the
  squad `<section>` has no explicit order (`0`), and `lg:order-none` resets both to `0` at the
  breakpoint where DOM order (aside second) is the desired right-rail position again. Verified via
  `getBoundingClientRect`: aside above section at 375px, side by side at 1280px.
- **`/compare`'s metric table used `table-fixed` with percentage-width columns.** That layout can
  never trigger its own `overflow-x-auto` wrapper — `table-fixed` caps the table at its container's
  width by definition, so a phone viewport just divides the same pixels four ways instead of
  scrolling, squeezing player names and numbers illegibly rather than failing loudly. Switched to
  the `min-w-[...]` + sticky-first-column pattern `app/players/page.tsx` already established for the
  identical reason: natural table sizing lets the table exceed its wrapper, `overflow-x-auto`
  actually engages, and the row-label column stays pinned while scrolling. Verified: a 640px table
  inside a 343px wrapper scrolls with "Metric" sticky at the wrapper's left edge.

See [design-audit-response.md](../sprints/design-audit-response.md).

### Packing, continued (Sprint 23, 2026-08-22)

`/builder` and `/transfers` already used a `grid-cols-[minmax(0,1fr)_360px]` two-column
template — squad/table on the left, decisions in a fixed-width right rail (see the mobile
`order-first` fix above). Every other page still stacked full-width sections instead, forcing
long scrolls to see information the same desktop screen had width to spare for. This pass rolled
the same template out to the rest of the app:

- **`/deadline`**: the Live card gained a right rail (Price & news watch, Team news — moved up
  from the bottom of the page); the squad section gained one too (Squad readiness, Availability,
  Captain & starting XI, Chip call — previously two separate paired grids stacked full width). See
  [deadline-and-matchday.md](deadline-and-matchday.md#live-hub-repacked-into-a-two-column-rail-sprint-23-2026-08-22).
- **`/team`**: the redundant position-grouped squad list was deleted outright (not deduped —
  `PitchView` was always the read of record), freeing its only other job (free-transfers select,
  import button) to move into a right rail alongside the points tiles and Your Leagues. See
  [deadline-and-matchday.md](deadline-and-matchday.md#teams-redundant-squad-list-removed-page-repacked-into-two-columns-sprint-23-2026-08-22).
- **`/transfers`**: the replace-candidate picker used to render once, appended below the *entire*
  squad table — "Replace" on any row opened a panel with no visual link to that row, and
  off-screen on mobile with no signal it had even opened. The picker body is now built once and
  rendered twice via responsive Tailwind classes (`lg:hidden` / `hidden lg:block`): in the
  existing right `<aside>` on desktop, above the simulation result; inline below the table on
  mobile, scrolled into view on open (`scrollIntoView({ behavior: "smooth" })`). The originating
  row gets a highlight ring while its picker is open, so the connection survives a scroll.
- **`/chips`**: the "Chip sequences" card's explainer paragraph moved into an `InfoTooltip`
  (see [Disclosure](#disclosure) below); the "Front-loaded" preset's two-sentence note split into
  a one-line summary plus a `detail` shown in its own tooltip — the reasoning didn't disappear,
  CLAUDE.md's "say what the number means" still applies, it's just not the default view anymore.
  Sequences now sit in a left column with schedules (GW1-19, GW20-38) stacked in a right rail
  beside them, replacing three full-width sections stacked in a row. The bespoke amber
  fixture-flatness disclosure was replaced with `CollapsibleCard`, which gained a new `"amber"`
  tier for it — the component's own doc comment already claimed this migration had happened; it
  hadn't, until now.

See [sprint-22.md](../sprints/sprint-22.md) (grouped nav, prompting this round of review) and
[sprint-23.md](../sprints/sprint-23.md) (the density work itself).

## Component hierarchy and disclosure (Stage 4b)

The same defect existed one level down. `components/player-detail.tsx`'s `stat()` grid rendered all
six numbers identically (`text-sm font-semibold`), with Price in slot 1 and xP GW in slot 2 — xP's
only distinction from anything else on the panel was colour. `components/player-card.tsx`'s pitch
chip had its name (10px/bold) literally larger than its own xP (9px/semibold), on the one screen
most of the app is spent looking at.

- xP promoted to its own row at `text-3xl`, `ConfidenceBadge`/`RateBand` surfaced beside it —
  previously rendered nowhere in the detail panel despite existing and being well-built (semantic
  colour + text label + `aria-label`, never colour alone). The data was already being fetched on
  `/builder` for other purposes (`player_xp_horizons`' `reliability`/`prior_weight`/`xp_5_lower`/
  `xp_5_upper`); `PlayerData` just never carried it through. Added as optional fields so every other
  page that constructs a `PlayerData` (`/team`, `/deadline`, `/transfers`) is unaffected — the badges
  simply don't render where the data isn't wired yet.
- The pitch card's name/xP size relationship inverted within the existing 64–80px budget — the chip
  is a hard width constraint from the pitch layout (four chips per row in a 3-4-3), not something to
  grow.
- Two of the four competing `_NOTE` disclosure treatments retired: `RISK_MODEL_NOTE` was a bare
  `text-[11px] text-zinc-400` paragraph in one place on `/builder` and a native `title` — keyboard-
  inaccessible, invisible on touch, ~1s delayed — on the *same page*. Both native-`title` instances
  (the identical pattern also existed on `/transfers`) now use [`InfoTooltip`](#disclosure), the one
  disclosure mechanism in this app that's actually accessible. Two other treatments remain
  unconsolidated: a bare-paragraph pattern elsewhere (`/scenarios`, `/compare`) and a bespoke
  `noteOpen` collapse (`transfer-plan.tsx`) — follow-on work.

### Disclosure

`components/info-tooltip.tsx` is the pattern to reach for: click-toggled (works on touch, unlike
`:hover`), closes on Escape and outside-click, `aria-expanded`, `role="dialog"`. It migrated onto
tokens (`bg-popover`/`border-border`) and gained a focus-visible ring in this sprint — it had none
before. Prefer it over a native `title` for anything that isn't purely decorative, and over a bare
paragraph for anything that would otherwise compete with a page's primary content for visual weight.

`components/ui/collapsible-card.tsx` (added 2026-08-20) is the second disclosure primitive — for a
whole card collapsing to a title + one-line summary, not an inline note. It was extracted for the
[card-packing pass](#packing-not-just-ranking-2026-08-20) above rather than adding a third hand-copy
of the shape. It deliberately did **not** absorb the two `noteOpen` collapses named just above: both
are compact single-line notes with no real title (`text-[10px]`/muted styling), and forcing them
into `CollapsibleCard`'s title+tier layout would have visibly changed their size for no reader
benefit. They're still the open follow-on work; the primitive now exists for whoever picks it up.

### `TapToReveal` (added 2026-08-22): the same primitive, an arbitrary trigger

`InfoTooltip` always draws its own "?" circle — fine for a standalone note, wrong for a badge or a
dotted-underline stat label that already *is* the trigger and would look doubled with a "?" glued
next to it. `components/info-tooltip.tsx` was refactored so `InfoTooltip` is now a thin wrapper over
a new `TapToReveal(trigger, children, label, wrapperClassName?)` — one click-toggle/Escape/
outside-click implementation instead of two, per [methodology.md](methodology.md#one-quantity-one-implementation).

It migrated the nine remaining `cursor-help`/native-`title` sites Sprint 19 flagged but didn't reach:
`GemBadge`, `Gw1Badge`, `RateBand` (`components/confidence-badge.tsx`), the three stat definitions
in `manager-profile-card.tsx`, the chip-gain and captain-confidence notes in `app/builder/page.tsx`,
and the exit-route notes shared by `/builder` and `/transfers`. **Not** touched — still open, as
above: the bare-paragraph pattern on `/scenarios`/`/compare` and `transfer-plan.tsx`'s bespoke
`noteOpen` collapse; a different `/scenarios` row-header tooltip (table row labels with a `.note`
field) was migrated to `TapToReveal` directly rather than through `InfoTooltip`, since a dotted-
underline label is itself the trigger. See
[design-audit-response.md](../sprints/design-audit-response.md).

### Bottom sheet (added 2026-08-22, superseded 2026-08-22 same day by a left drawer — see below)

`components/nav-links.tsx`'s mobile drawer was `absolute right-0 top-full … w-56` — a dropdown, the
same shape `InfoTooltip`/`TapToReveal` and `AccountMenu` already use. Fine for a handful of items
next to their trigger; wrong for 11 full navigation links, which used to land wherever the trigger
happened to sit in the header regardless of which hand held the phone. Replaced with a sheet docked
to the bottom edge (`fixed inset-x-0 bottom-0`, `max-h-[70vh] overflow-y-auto`, `rounded-t-2xl`,
`env(safe-area-inset-bottom)`-aware) plus a `bg-black/40` backdrop — the app's first backdrop and
its first bottom-anchored popover. All three of `TapToReveal`'s existing dismiss paths (outside
click, Escape, and here also route-change) still apply, since the sheet stays inside the trigger's
own wrapper's DOM subtree — `fixed` positioning changes where something paints, not what contains
it — but the backdrop needed its own click handler: clicking it is a click "outside" the sheet's
*content* while still being inside that same DOM subtree, so the existing containment check alone
wouldn't close it. See [mobile-reachability.md](../sprints/mobile-reachability.md).

**Superseded the same day** by the [left-side drawer described below](#grouped-nav-a-left-drawer-and-one-shared-anchored-panel-hook-sprint-22-2026-08-22)
— kept here rather than deleted, per this wiki's own rule, since the backdrop/dismissal mechanics
this section describes are still exactly what the drawer uses.

The same pass added a **tap-target floor** to `TapToReveal` itself: `relative` plus an absolutely-
positioned, empty `before` pseudo-element (`before:-inset-2.5`, i.e. 10px on every side) extends the
*hit* area without touching the trigger's visible size — the "?" circle stays a visible 16×16px with
an effective 36×36px hit box. Verified via `getComputedStyle(el, '::before')` rather than
`getBoundingClientRect`, since a pseudo-element extends hit-testing without appearing in the real
element's own box. Applied everywhere `TapToReveal` renders except one: `app/builder/page.tsx`'s
pool `+`/`⇄` button repeats in every row of a densely-packed table, so a *vertical* halo would reach
into the identical button one row up or down — a misclick there adds the wrong player, not a
harmless near-miss. That one button gets a horizontal-only halo (`-inset-x-2`) instead, verified
against the real ~16px row-to-row gap.

`InfoTooltip`'s panel also learned to flip: it was `absolute top-full` unconditionally, so a trigger
near the bottom of a long page opened a panel that rendered below the fold. It now measures the
room below the trigger at open time and flips to `bottom-full` when short — the same "prefer below,
flip above when there is not enough room" rule `components/pitch-view.tsx`'s panel positioning
already followed, reimplemented as a plain viewport-height check rather than that component's full
wrapper-relative pixel calculation, since `TapToReveal` has no equivalent bounded wrapper to
position against at every one of its call sites.

**Correction (2026-08-22, Sprint 22):** the vertical-only flip described in the paragraph above is
superseded — see the shared `useAnchoredPanel` hook in the next section, which also fixed a real
bug this positioning scheme had: no *horizontal* clamping, so a `w-72` panel anchored near the
right edge of a narrow screen (the sticky `ContextBar`'s `FT ?` tooltip, mid-row after the
gameweek/countdown/Bank) could run off the viewport.

### Grouped nav, a left drawer, and one shared anchored-panel hook (Sprint 22, 2026-08-22)

A round of real-device review (the owner's phone plus the desktop app) found the FT tooltip above
overflowing the viewport (its copy also named `CLAUDE.md` directly — rewritten to describe the
constraint without leaking an internal filename to the user), and — separately — the [bottom
sheet](#bottom-sheet-added-2026-08-22-superseded-2026-08-22-same-day-by-a-left-drawer--see-below)
disorienting: its trigger sat at the header's left edge, but the sheet itself docked to the
*bottom* of the screen, so the tap and its result were at opposite ends of the viewport.

- **`useAnchoredPanel`/`useDismissablePopover`** (new, `components/ui/use-anchored-panel.ts`) —
  one shared implementation of "`fixed`-position floating panel, clamped to the viewport on both
  axes, with outside-click/Escape dismissal," replacing two near-identical hand-copies:
  `TapToReveal`'s vertical-only flip above, and `components/ui/filter-disclosure.tsx`'s
  horizontal-only clamp (the "Filter +" panel on `/players`/builder — not otherwise documented in
  this wiki), which had already solved the *other* half of the same problem. Both components, plus
  the drawer below, now consume the one hook. `MobileNav`'s outside-click/Escape logic also
  switched to `useDismissablePopover` rather than keeping its own copy.
- **11 flat nav links grouped into three `@base-ui/react/menu` dropdowns** — Live (Deadline, My
  Team, News), Strategy (Builder, Scenarios, Transfers, Chips), Statistics (Players, Compare,
  Fixtures) — the same headless menu primitive `components/ui/action-menu.tsx`'s split button
  already used, so keyboard nav and focus management came for free rather than a fourth hand-rolled
  popover. `/status` left the nav entirely, moving into `AccountMenu` beside "Manage account" — a
  data-freshness page belongs there, not competing for one of three group slots.
- **The bottom sheet became a left-side drawer**, docking to the *same* edge as its trigger instead
  of the opposite one. Groups inside expand independently (`MobileNavGroup`), each getting the same
  grid-rows accordion animation as [the section below](#a-real-expandtoggle-and-a-grid-rows-accordion-sprint-24-2026-08-22).

See [sprint-22.md](../sprints/sprint-22.md).

### A real `ExpandToggle`, and a grid-rows accordion (Sprint 24, 2026-08-22)

Every expander in the app — `CollapsibleCard`, `LiveFixtureCard`, `ClubTacticsGrid` — used plain
conditional render (`{open && …}`) with a hand-drawn `⌃` glyph as the only visual feedback: content
appeared and disappeared instantly, and expanding one card inside a `flex flex-wrap` row (see
["Expandable-card stretch"](#expandable-card-stretch-2026-08-22) above) reflowed the whole row with
no transition.

- **`components/ui/expand-toggle.tsx`** (new) — a real 36px circular chevron (`size="md"`; a 28px
  `size="sm"` for inline use beside a score line or card title), coloured from theme tokens rather
  than literal hex. Supports an `interactive={false}` mode: a decorative `<span>` rather than a
  `<button>`, for the common case where a *different* element already owns the click —
  `CollapsibleCard`'s whole header row is one `<button>`, and nesting a second real `<button>`
  inside it is invalid HTML that throws a React hydration error. That exact bug was found live in
  `/transfers`' replace-candidate row (a `<button>` wrapping a `TapToReveal` "N exit routes"
  trigger, itself a `<button>`) — fixed by converting the row to a `<div role="button" tabIndex={0}>`
  with its own `onClick`/`onKeyDown`, and stopping the nested `TapToReveal`'s click from bubbling so
  opening its tooltip doesn't also fire the row's `addMove`. Filed as its own fix rather than
  folded into `ExpandToggle`'s design note, since the picker itself predates this sprint (see
  [transfer-engine.md](transfer-engine.md) for `findReplacements`/reversibility, the engine behind
  it) — the JSX was simply relocated verbatim during [Sprint 23's density
  pass](#packing-continued-sprint-23-2026-08-22), not introduced by it.
- **CSS Grid `0fr` → `1fr`** (`grid-template-rows`, `transition-[grid-template-rows]`, an
  `overflow-hidden` inner wrapper) replaces mount/unmount everywhere an expander's body renders.
  Content now mounts unconditionally (height-zero, clipped) rather than being skipped while
  collapsed — checked each site for work that used to be skipped while `{open && …}` was false;
  none of the four components touched do side-effecting work in their bodies.
- **Not independently visually verified this pass** — the session's browser preview ran with
  `document.visibilityState === "hidden"` throughout (Chromium freezes layout recalculation for a
  backgrounded tab), which made `getBoundingClientRect()` return stale zero-heights immediately
  after any class toggle, reproduced with several unrelated CSS techniques pointing at the tooling,
  not the CSS. Structure, ARIA state (`aria-expanded`), and correct class-toggling were confirmed
  directly instead.

See [sprint-24.md](../sprints/sprint-24.md).

### UI defect sweep (Sprint 25, 2026-08-23)

Eleven small fixes across `/deadline`, `/team`, `/fixtures`, `/chips`, `/players` and the nav
shell — mostly truncation, dead space, and duplicated text the density/expansion passes above
didn't reach on every surface. Landed alongside the `fpldecision.com` domain cutover (see
[deployment.md](deployment.md#custom-domain)), an unrelated piece of work in the same sprint.

- **Short team codes, not full names, on live/fixture cards.** `components/live-fixtures.tsx`'s
  `LiveFixtureTeam` already carried `short_name` but only fed it to `TeamCrest`; the card's own
  label used the full name, which truncated unpredictably in a `sm:w-[calc(50%-0.375rem)]` card
  and shifted the crest/score layout. Now renders the short code (`ARS`, `COV`) with the full
  name moved to `title`. `components/fixture-schedule.tsx`'s `FixtureRow` had the identical bug
  and got the identical fix.
- **`/fixtures`' `FixtureRow` was the last raw `⌃` glyph in the app** — Sprint 24 converted
  `CollapsibleCard`, `LiveFixtureCard`, and `ClubTacticsGrid` to `ExpandToggle` + the grid-rows
  accordion but missed this file. Per-match rows now match; the gameweek section header got the
  `ExpandToggle` chevron too but **deliberately kept** mount/unmount for its body — animating up
  to 38 sections would mount every gameweek's `FixtureRow`s (each running `parseFixtureStats`) at
  once instead of only the ones actually opened. Sections snap, rows glide.
- **`/chips`' Fixture flatness card was showing the same ~10-sentence note twice** — `result.note`
  fed both `CollapsibleCard`'s always-visible collapsed summary and its accordion body (a grid
  accordion, not mount/unmount, so both render). `lib/chips.ts` gained `chipModelNoteSummary`, a
  genuinely separate one-sentence summary, alongside the unchanged `chipModelNote`;
  `ChipEngineResult` now carries both as `note`/`noteSummary`. The same page's dead-space bug —
  a short 2–3 row "Chip sequences" list next to a right rail running two tall schedule
  sections — was fixed by swapping the columns: sequences → schedules → fixture flatness now run
  down the main column, and the four per-chip shortlists (trimmed top-5→top-3, blocked windows
  behind their own disclosure) moved into the narrow rail, which they actually fit. See
  [chip-strategy.md](chip-strategy.md).
- **`/players`' xG/xA columns now read per-90, not season-to-date totals.** `xG (${gwPlayed}
  GW)` was accurate but implied a rate the way "xG"/"xA" do everywhere else in football; now
  `xG/90`/`xA/90`, `—` below 45 minutes, dimmed with the raw total in `title` below 180 (a
  12-minute cameo reading 7.5 xG/90 isn't a real rate). `historySeason` ("2025/26") now runs
  through a new `shortSeason()` helper (`lib/utils.ts`) at all four render sites → "25/26".
  `ConfidenceBadge` gained a `compact` prop pinning it to the two-letter `OR`/`PP`/`PR` form at
  every width (previously only below `sm`), passed only from the `xP {horizon}` cell —
  `player-detail.tsx`'s wide panel keeps the full words.
- **`/team` squad cards were overlapping the pitch.** Root cause wasn't the pitch layout —
  `player-card.tsx` renders a taller, centered value block when `next_fixture` is absent, and
  `/team`'s `toCard` never set it (unlike `/deadline` and `/builder`, which do). `/team` now
  fetches each picked gameweek's fixtures and attaches the opponent/H-A/FDR chip keyed by
  `selectedEvent`, not "next" — a historical gameweek shows the fixture it actually played.
  `/deadline`'s Team news card was also rendering 15 headlines while its own summary line counted
  the unsliced total (could read "37 headlines" above a 15-row list); now shows 5 with an
  "All N headlines →" link to `/news` when there are more.
- **Nav, extending [Sprint 22's grouped nav](#grouped-nav-a-left-drawer-and-one-shared-anchored-panel-hook-sprint-22-2026-08-22).**
  The mobile drawer header is now the app's own Monogram + Wordmark (Gmail-sidebar style)
  instead of a plain "Navigation" label, with the dedicated `×` close button removed — backdrop
  tap, Escape, and the hamburger itself (already an `×` while open) were three existing ways out;
  a fourth was redundant. **That last reason was wrong, and stayed wrong for three weeks** — the
  drawer is `z-50` over a `z-40` header, so the hamburger's `×` is underneath the panel and was
  never visible to anyone. A close button came back in DSI-141; see
  [`IconSwap`, and a close button nobody could see](#iconswap-and-a-close-button-nobody-could-see-dsi-141). Desktop nav groups now open on hover (translucent
  `bg-popover/80 backdrop-blur-md`) and "solidify" to opaque `bg-popover` on click — a controlled
  `Menu.Root` with `openOnHover`/`delay`/`closeDelay` on `Menu.Trigger` and `modal={false}` (the
  default `true` would lock page scroll on mere hover, which the prior click-only menu never
  triggered).

See [sprint-25.md](../sprints/sprint-25.md).

## Typography (Stage 5)

All 13 page-title `<h1>`s share one identical class string
(`text-2xl font-semibold tracking-tight`), and none set a line-height — Tailwind's stock `text-2xl`
default (2rem, ≈1.33) was silently in effect everywhere. A `line-height` rule in `@layer base` cannot
override this: Tailwind's `text-2xl` utility bundles its own line-height, and the utilities layer
always beats base-layer rules regardless of source order in a Tailwind v4 build. The fix is a theme
override — `--text-2xl` / `--text-2xl--line-height` redefined together in `@theme inline` to
`1.5rem` / `1.15` — applied once rather than hand-typed per element. `text-2xl` has exactly one other
caller in the app (a stat number on `/scenarios`), unaffected by the tighter leading.

The video's other typography-adjacent point — a 4-point spacing grid — was **not** adopted. This
app's 2pt/half-step scale (`py-1.5` ×16 on `/transfers`, `mt-2.5`/`pt-2.5` ×6 in
`player-detail.tsx`) is load-bearing in a dense data tool; rounding it up would visibly loosen the
64px pitch chip and the comparison tables for no accessibility or clarity gain. A sibling-margin
audit on `/transfers` and `/team` (the pages initially flagged for `mt-*` drift) found most of it
already resolved by Stage 4a's card-tier normalisation, and logged the remainder as a non-problem
rather than forcing an unnecessary component refactor.

## What's still raw hex / unmigrated

Every page outside `/transfers`, `/chips`, `/builder`, `/deadline`, and the shared components those
five touch: `/players`, `/compare`, `/fixtures`, `/scenarios`, `/team`, `/settings`, and the
top-level `app/layout.tsx` header/nav chrome. The ESLint rule (warning-level) will flag any *new*
raw hex added there; existing occurrences are unaffected until a future pass touches those files. See
[blocked-and-data-gaps.md](blocked-and-data-gaps.md) if this becomes a tracked gap rather than
opportunistic follow-on work.

The 2026-08-22 design-audit response (below) deliberately did **not** extend the token migration
while it was in these files for an unrelated reason (a button's focus ring, a table's sticky
column) — same reasoning as this section's own precedent: a mechanical hex→token replacement with
no visual-regression suite is a worse trade done as a side effect of a different task than as its
own reviewed pass. Warning count went 166→169 from that response's work, all in the same
already-established literal pattern (`dark:bg-[#1E0234]` on new sticky table cells,
`app/compare/page.tsx`), not a new one.

See also: [frontend-conventions.md](frontend-conventions.md) (theme boot script, static-export
traps), `lib/fdr.ts` (the FDR colour system's own CVD validation — see its header comment — the one
colour system that predates and outperforms this page's semantic tokens), [sprints/sprint-19.md](../sprints/sprint-19.md),
[sprints/rivals-and-card-density.md](../sprints/rivals-and-card-density.md) (the 2026-08-20 packing
follow-on), [sprints/design-audit-response.md](../sprints/design-audit-response.md) (the 2026-08-22
accessibility/focus-ring/mobile-layout follow-on, and what an external design audit got wrong),
[sprints/mobile-reachability.md](../sprints/mobile-reachability.md) (the same day's follow-on: the
bottom sheet, the tap-target floor, and a real "FT 15" bug).

## `CollapsibleCard` gains a controlled mode and a `section` tier (Sprint 28, 2026-08-29)

`/deadline`'s live/upcoming split needed three things the Sprint 24 primitive could not do.

**A controlled mode.** `CollapsibleCard`'s doc comment invited lifting its open state "when a page
needs to read or drive it externally"; this is that page. `defaultOpen` is captured at mount, and
`/deadline` learns whether a gameweek is in play *after* first paint — then learns it again at the
final whistle. `open` + `onOpenChange` now coexist with the uncontrolled `defaultOpen` path every
other caller still uses (`open !== undefined` selects controlled; `onOpenChange` fires either way).

**A `section` tier.** `border-transparent p-0` with a `text-base` heading. A section *contains*
cards — inheriting `primary`'s border and `p-4` would double-frame everything inside it and eat
32px of `max-w-5xl`, which the 360px rails cannot spare at exactly `lg`.

**Two defects the split exposed:**

- **The accordion clipped absolutely-positioned children.** `PitchView` renders `PlayerDetail` as
  `position: absolute`, so wrapping the squad in a card cut the popover off. The obvious fix —
  clip while animating, switch to `overflow-visible` on `onTransitionEnd` — **was built, measured,
  and does not work**: Chrome resolves an interpolating `fr` track in an indefinite-height grid to
  `0px` throughout and never fires a `transitionend` for `grid-template-rows`, so the body stayed
  clipped indefinitely. A `section` therefore opens *instantly*, with no height animation, which is
  also the better call on its own: sliding ~1,000px of squad, chip and transfer UI open over 300ms
  is a lurch. Card tiers keep Sprint 24's accordion untouched.
- **Collapsed bodies stayed in the tab order.** Harmless for a 20-row news list; not for a
  collapsed section holding horizon buttons, two selects, a run button and fifteen player cards.
  The body wrapper takes `inert={!isOpen}`. It stays **mounted** — that is load-bearing, since the
  collapsed summaries read state the collapsed body's own effects keep fresh.

Related: `/deadline` reorders its two sections with flex `order-1`/`order-2` rather than by
reordering an array of elements, so the DOM order never changes and React cannot remount either
subtree at the whistle (which would wipe an open popover, an expanded `LiveFixtureCard`, or
`ChipPlanEditor`'s own collapse state). The usual a11y objection to visual reordering does not
apply here — whichever section is second is also collapsed, and a collapsed body is `inert`.
See [sprint-28.md](../sprints/sprint-28.md).

## The `order` pattern generalises to three sections (Sprint 29, 2026-08-30)

The two watch cards (Price & news, Team news) used to sit in a permanent top strip above both
Live/Upcoming sections — Sprint 23's reason for keeping them outside a collapsible section (never
orphaned before GW1's first kickoff) meant they couldn't just join the accordion. Sprint 29 moved
them into the same `order`-based scheme instead of solving that constraint a second way: a
`sectionOrder(section)` helper returns `order-1`/`order-2`/`order-3` for `"live"`/`"watch"`/
`"upcoming"` depending on `livePhase` and whether a live section is rendered at all (no live
fixture → watch precedes upcoming directly). Live GW's countdown/date/import-note row, which used
to run on as untitled siblings of the `{gameweekName} deadline` label in one flex row, is now split
onto its own line below the label — a real visual separation the run-on version lacked. The
"Imported from your real FPL team" sentence folded into the existing `IMPORTED_SQUAD_NOTE` tooltip
instead of staying a second always-visible line.

**Side-by-side cards, `self-start` not just a fixed width.** The two watch cards sit in
`flex flex-wrap` with a `w-[calc(50%-0.625rem)]` basis each — CLAUDE.md's documented gotcha for
exactly this shape (`LiveFixtureCard`/`ClubTacticsGrid`, [above](#card-hierarchy-stage-4a))
applies again here: a flex row defaults `align-items: stretch`, so an expanded card still inflates
its still-collapsed neighbour without `self-start` on top of the width basis. Verified visually at
desktop width: expanding one card leaves the other at its own natural height.

`/leagues`' clickable league rows gained a trailing `ChevronRight` (lucide-react) plus explicit
`cursor-pointer` — the same markup previously rendered identically for a clickable and a
non-clickable row (`/team`'s now-removed inline table used the latter), leaving only a hover
background to distinguish them, which never shows at rest. — [sprint-29.md](../sprints/sprint-29.md)
## `SlideOver` — the primitive that already existed, once (Sprint 33, 2026-09-05)

`components/ui/` had no drawer, sheet, dialog or modal. The only real slide-over in the app was
**inlined inside `MobileNav`** (`components/nav-links.tsx`): backdrop, `role="dialog"`/`aria-modal`,
a body-scroll-lock effect, and `useDismissablePopover`.

When `/players` needed the same thing on the opposite edge, copying forty lines of
focus-and-scroll-trapping overlay would have been a bug with a delay on it — so it was lifted into
`components/ui/slide-over.tsx` **first**, and `MobileNav` re-expressed through it.

It takes `side`, `label`, `width` and a **`triggerRef`**. The last one is not incidental: without
it, clicking the trigger to *close* the panel is first read as an outside-click that closes it and
then as a toggle that reopens it. Any dismissable overlay driven by a button that stays on screen
needs this.

This is the third variant of the same underlying idea in the codebase — after the bottom sheet and
the left drawer above — and the first one extracted as a primitive rather than written in place.

## M9 — the audit, the primitives layer, and what the audit got wrong (2026-09-12/13)

An external design audit of every screen, worked in four sprints: **A** built primitives, **B**
applied them app-wide, **C1** did the per-screen visual work, **C2** the items that turned out to be
product work wearing design clothes. — [sprints/m9.md](../sprints/m9.md)

**Roughly half of each audit item was already fixed, already false, or would have been a regression
applied literally.** That is the sprint's most reusable finding, and it is why every item below
carries a measurement rather than a verdict. Three that mattered:

- *"Desaturate the FDR matrix."* Measured first (Machado 2009, severity 1.0, linear-RGB separation):
  the difficulty ramp holds ≥ 0.32 between adjacent steps under all three CVD conditions, sometimes
  wider than at normal vision. The broken channel was **venue** — a green ring for home against red
  for away scores 1.039 at normal vision and 0.204 under deuteranopia. Desaturating would have
  discarded a working channel to fix a different one. See
  [fixture-difficulty.md](fixture-difficulty.md).
- *"Make the deadline a tab bar."* Measured the widths; it did not fit.
- *"88 `title=` attributes need converting."* Measured: 14 exceed 40 characters, and most of those
  are truncation fallbacks where `title` is the correct idiom. Four carried reasoning available
  nowhere else and were converted; the rest were left.

### The primitives, and what adoption actually reached

`Button`, `Badge`, `Alert`, `DataTable`, `Delta`, `ModelNote`, `SegmentedControl`, plus a motion
scale and more of the raw-hex → token migration. Sprint A built them and adopted each in 1–2 files;
Sprint B is what made them app-wide: `Button` 1 → 20 files, `DataTable` 0 → 14 with the raw `<td>`
count across `app/` and `components/` reaching **0**, `Badge` 9, `Alert` 6, `ModelNote` 5 → 12.
`Checkbox` and `NoteDisclosure` were added mid-sprint and are fully adopted.

Three shapes deliberately keep a raw `<button>`: disclosure primitives, whole-row/whole-card
targets, and table sort headers — none is a button in the visual sense, and each would override most
of what the variant supplies.

Two Sprint B premises did not survive measurement. `ModelNote`'s scope assumed notes were rendered
naked; all 22 used notes were *already* inside a disclosure, and what was real is that 17 sites
re-typed the typography the primitive owns. The `title=` sweep is above.

### `SegmentedControl` is the only pick-one control

Four affordances existed for one job — a bordered strip with a `--primary` fill, a `bg-purple-950`
variant, a third border treatment, and a plain `<select>` — across a horizon picker at six call
sites and six other toggles, three of which were byte-identical `tabButton` helpers. All of them now
route through one component, with `HorizonControl` wrapping it for the `Horizon` type's string
round-trip and its `"season"` case.

Two deliberate exceptions, recorded so they are not "finished" later: the FDR **Sort** control stays
a `<select>` (three options, one conditionally disabled with a *"(not published yet)"* suffix a
segmented control has nowhere to put), and `manager-leagues`' rows carry `aria-pressed` but are a
list you pick from, not a toggle group.

The indicator is a raised neutral surface rather than `--primary`: choosing a tab is navigation, not
an action.

### The accent question, settled in two passes

`--primary` is reserved for actions and for a single top-tier winner. Sprint B swept the utility
actions to outline and found the last data-viz misuse — the Past Seasons bar on `/team`, a hand-copy
of `PercentileBar`, which had already been moved to `--chart-1` once. *Fixed once, missed once*, the
sprint's own recurring shape.

One conflict was parked for a human and resolved by DSI-141: `/transfers`' 5 GW column. DSI-135
wanted it demoted to plain foreground; DSI-124 had just narrowed it from "every value accented" to
the squad's own top quartile so the accent would mean something, and demoting would delete that.
`--chart-1` had been rejected as the middle path for failing contrast on white (3.7:1) — but light
mode there is `purple-800` and was never the complaint. **Light stays, dark moves to `--chart-1`**,
measured at 11.21:1 against the ground it is actually painted on rather than the 5.1:1 assumed
against the card. Selected-state fills and progress bars keep the accent; they are states, not
triggers.

### The settings card: a control row that states its own values

`CollapsibleCard` acquired a second standard use beyond a methodology note — the page's parameters,
collapsed behind a summary of those same parameters. `/transfers`' **Plan settings** (horizon,
squad, free transfers, wildcard) reads `5 GW · New draft · 1 free transfer` shut, matching the Chip
plan card directly below it; `/fixtures`' **FDR settings** (window, search, sort, rating source)
reads `8 GWs · Easiest run`. The rule that makes it safe: **a settings card that hides its own
values is just a place to lose a filter in**, so every non-default choice appears in the summary.

On `/fixtures` the six-swatch legend moved the other way — out of the permanent layout and into a
**How to read FDR** link beside the sort caption. A legend explains the grid rather than changing
it, and is learned once.

### `IconSwap`, and a close button nobody could see (DSI-141)

`References/Components/icon-swap.md` as `components/ui/icon-swap.tsx`: two icons in one grid cell,
the outgoing one leaving at `scale(0.25)` behind a 2px blur. Being one grid cell is the part that
matters beyond the motion — the control's width is the wider icon at every frame, so nothing beside
it moves. The `☰`/`×` text swap it replaced changed width mid-transition and nudged the wordmark.

Sprint 25 had argued the mobile drawer needed no close control "since the hamburger is already an ×
while open". It is — and the drawer is `z-50` over a `z-40` header, so that × has always been
underneath the panel. The affordance was not redundant, it was invisible. The drawer's header row
now reproduces the header it covers to the pixel (close button at x=16, wordmark at x=72, measured
dx 0 / dy 0.3px), so only the icon changes.

### Overflow that hides options is still overflow (DSI-141)

`SegmentedControl` contained its own overflow with `max-w-full overflow-x-auto` and no visual
affordance, so on a phone the later segments were simply gone — `/team`'s six horizon segments,
`/settings`' four tab labels, `/news`' change-type row. Nothing was clipped and
`document.body.scrollWidth` equalled the viewport, which is exactly why a responsive pass whose bar
is *"nothing overflows"* kept certifying it. Now: edge fades drawn in the track's own colour,
rendered only when a side actually has something hidden, plus the selected segment scrolled into
view. One primitive, nine call sites. See
[frontend-conventions.md](frontend-conventions.md#a-scroll-container-only-works-if-every-ancestor-may-shrink-2026-09-13)
for the two rules this depends on.

### Density on a phone: the frozen column and the `+N` chip

`/players`' sticky first column carried a checkbox, a name and up to four badges — most of a 375px
viewport, leaving a sliver for the data it exists to keep company with. Capped below `sm` with the
name truncating, and `RoleBadges` now draws only the highest-ranked set-piece duty (penalty → free
kick → corner, the priority `StatusBadge` already encoded) followed by a `+N` for the rest.
`/compare`'s metric column went 9rem → 7.5rem.

The `+N` chip produced the two defects that only running the app could find:

- It nested a `<button>` inside `/builder`'s own whole-row button — invalid HTML and a React
  hydration error. The chip is a plain titled span unless a caller opts in with `revealable`, which
  is why that prop defaults to off.
- `TapToReveal`'s panel is `fixed z-30` and was still painted over by the *next row's* `sticky z-10`
  cell. **`fixed` positions against the viewport but does not escape a stacking context**, and equal
  z-indexes are settled by DOM order. It portals to `document.body` now — which is what `fixed
  z-30` already claimed to mean, and it applies to all 14 of its call sites.
