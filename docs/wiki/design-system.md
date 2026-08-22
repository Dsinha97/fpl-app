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
  CVD-validated (see [risk-scoring.md](risk-scoring.md) for the validation methodology it shares).

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
- **Follow-on work**: the remaining pages (`/players`, `/compare`, `/fixtures`, `/scenarios`, `/team`,
  `/settings`) were not touched — the lint rule from Stage 1 keeps new code on those pages from
  regressing further, but existing raw buttons there still lack focus rings.

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

See also: [frontend-conventions.md](frontend-conventions.md) (theme boot script, static-export
traps), [risk-scoring.md](risk-scoring.md) (the FDR colour system's CVD validation, the one colour
system that predates and outperforms this page's semantic tokens), [sprints/sprint-19.md](../sprints/sprint-19.md),
[sprints/rivals-and-card-density.md](../sprints/rivals-and-card-density.md) (the 2026-08-20 packing
follow-on).
