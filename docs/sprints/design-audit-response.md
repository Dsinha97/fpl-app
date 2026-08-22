# AI-website design audit response — built 2026-08-22

No new sprint number — a response to an external "AI-coded website" audit the owner ran against the
deployed app, prompted by the owner sharing the audit's findings and asking for an implementation
plan. Most of the audit's P0–P3 recommendations turned out not to apply; this records what was
verified true, what shipped, and — because a future audit will likely raise the same points again —
what was checked and explicitly rejected.

## Context

The audit produced a 4-phase, P0-ranked plan against generic "vibe-coded" failure modes: purple
gradients, scroll hijacking, inverted hover states, a 3D skeuomorphic pitch, hover-only data, and a
"critical DNS resolution failure" ranked P0. Before implementing anything, every claim was checked
against the actual codebase and a live `curl` against the deployed Worker.

### Verified false

The site returned `HTTP 200` in 263 ms with `CF-Cache-Status: HIT` at the time the audit claimed it
was down — the audit's tooling had no outbound network access, not a real outage. A code sweep found
zero `bg-gradient-*` utilities, zero `violet-*`, zero motion library, zero scroll listeners or
`IntersectionObserver`, zero `hover:opacity-*`/`brightness-*` dimming (219 `hover:` classes, all
additive), a flat 2D `components/pitch.tsx` with no `perspective`/`transform-style`, `tabular-nums`
already on 104 numeric cells across 22 files, and current-season xG/xA already rendered as plain
`<td>` cells on `/players` rather than hidden in a tooltip. `lib/fdr.ts`'s green→red ramp is
CVD-validated (ΔE, 12.3 protan pair separation) and predates/outperforms the audit's suggested
literal-FPL palette — changing it would be a regression, not a fix.

### Rejected on judgement

- **Neutral slate/zinc canvas.** The purple is `components/brand.tsx`'s actual identity, and dark
  mode already flips the accent to FPL green `#00FF87`. Kept the palette; finished the token
  migration instead (see below) rather than erasing brand identity to match a generic checklist.
- **Pitch/table view toggle.** `/players` is already a 16-column sortable table and
  `/team`/`/deadline`/`/builder` already carry `PitchView` — a toggle would duplicate routes, not add
  information.

## What shipped

**Sticky context bar** (`components/context-bar.tsx`, new; `app/layout.tsx`; `lib/countdown.ts`,
new) — the audit's one genuinely good finding, buried under everything else: a deadline-driven tool
had no persistent deadline/bank/FT anywhere in its chrome, and the header itself wasn't sticky. The
bar reuses `loadSeasonContext` (`lib/season-context.ts`) and whichever draft
`resolveRequestedDraft` (`lib/drafts.ts`) already picks for every other draft-aware page — no new
data shape, no extra network round trip. Free transfers renders `FT —` with an `InfoTooltip`
explanation rather than the `emptyTeamState` default of `1` whenever the resolved draft isn't
FPL-sourced, per CLAUDE.md's "say what the number means" — a manual draft's default free-transfer
count is not a fact about the owner's real squad. The countdown formatter (`fmtCountdown`) was
extracted out of `app/deadline/page.tsx` into `lib/countdown.ts` so the page and the bar share one
implementation rather than two hand-copies. `app/page.tsx` now redirects a signed-in visitor
straight to `/deadline` from a `useEffect` (never the render body — CLAUDE.md's `router.replace()`
gotcha), keeping the marketing splash only for a signed-out first visit.

**Data density on `/players`** (`app/players/page.tsx`) — added `expected_goals`/
`expected_assists` to the existing `players` select (already-populated columns, just never
selected) labelled `xG (N GW)`/`xA (N GW)` so a one-gameweek sample is never read as a rate, and a
new `player_predictions` fetch for `expected_minutes`/`start_probability` powers an `xMins` column
and a `Start %` sort key. `toScoredPlayer`'s `expectedMinutes`/`startProbability` fields — previously
hardcoded `null` because this page didn't fetch the data — are now wired to the real values, so
Hidden Gems' `startProbability ?? availability` fallback and every `valuePerMillion` calculation on
this page use real per-fixture minutes evidence instead of the status-only fallback.

**Touch/keyboard accessibility** (`components/info-tooltip.tsx`; nine call sites) — extracted a
`TapToReveal` primitive (the click-toggle/Escape/outside-click logic `InfoTooltip` already had,
generalised to an arbitrary trigger instead of always drawing a "?" circle) and migrated every
`cursor-help`/native-`title` site that carried reasoning found nowhere else:
`components/gem-badge.tsx`, `gw1-badge.tsx`, `confidence-badge.tsx`'s `RateBand`,
`manager-profile-card.tsx`'s three stat definitions, two chip explanations plus the captain-
confidence and exit-route notes in `app/builder/page.tsx`, the exit-route note in
`app/transfers/page.tsx`, and the row-note headers on `app/scenarios/page.tsx`. This is the exact
follow-on Sprint 19 named and deferred. Purely redundant `title=`s (FDR cells, name-truncation
expanders, timestamps) were left alone — the number or name is already visible without hovering.

Also closed the focus-ring gap Sprint 19 left on `/players`, `/compare`, `/fixtures`, `/scenarios`,
`/team`, `/settings`, `/deadline`, plus `components/nav-links.tsx` and the home CTAs — the same
`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring` shape, and converted the
legacy `focus:border-*` inputs in the same files to `focus-visible:`.

**Mobile responsive pass** — `app/transfers/page.tsx`'s result `<aside>` gets `order-first
lg:order-none` so the transfer decision (net xP, hits, bank) renders above the squad table and
picker on a phone instead of below both, verified live: aside top < section top at 375px, side by
side again at 1280px. `app/compare/page.tsx`'s metric table was `table-fixed` with percentage
columns — fine on desktop, illegibly squeezed on a phone since it can never trigger its own
`overflow-x-auto` wrapper; switched to the `min-w-[...]` + sticky-first-column pattern
`app/players/page.tsx` already uses, verified live: a 640px table inside a 343px wrapper scrolls
with the "Metric" column pinned. `league-table.tsx` and `fdr-matrix.tsx` already had sticky columns
over a non-`table-fixed` layout — already mobile-safe in practice — but gained an explicit `min-w`
for consistency. `components/player-detail.tsx` was checked and left alone: its popover panel is a
fixed 320px (`PANEL_WIDTH`) with position already clamped by `pitch-view.tsx`'s
`getBoundingClientRect` logic, so it needs no breakpoint classes to fit a phone.

**Infra hardening** (`public/_headers`, `app/globals.css`, `package.json`) — `_headers`' comment
called these "Cloudflare Pages header rules" while the project deploys via Workers static assets
(`wrangler.jsonc`'s `assets` block); corrected. Added an explicit `Cache-Control: public,
max-age=0, must-revalidate` rule for HTML — the live site already carried this as a Workers-assets
platform default (confirmed via `curl -I`), so this makes an existing behaviour explicit rather than
changing it. `tw-animate-css` was imported in `globals.css` and used by zero classes anywhere in the
app; removed the import and the now-unused dependency.

## What was deliberately not done

A full raw-hex-to-token migration (Workstream F in the working plan) was scoped down. New code in
this pass (`context-bar.tsx`, `lib/countdown.ts`) introduces zero raw hex literals — verified by
grep. But converting the pre-existing `#00FF87`/`purple-N` literals in files this pass merely
*opened* for an unrelated reason (a button's focus ring, a table's sticky column) was judged the
same bad trade CLAUDE.md and `docs/wiki/design-system.md` already name: a mechanical replacement
across files with no visual-regression test suite, done as a side effect of a different task rather
than a reviewed pass of its own. The warning-level ESLint rule keeps flagging every occurrence
(169 warnings after this pass, up from 166 — the new sticky-column cells in `app/compare/page.tsx`
follow the same literal pattern `app/players/page.tsx` already used, not a new one); a dedicated
token-migration pass remains open follow-on work, tracked in
[design-system.md](../wiki/design-system.md)'s "What's still raw hex" section.

## Verification

`npx tsc --noEmit`, `npm run lint` (0 errors throughout, warning count unchanged except the
documented raw-hex additions above), and `npm run build` all passed after every workstream. Browser
verification via the preview tools: sticky header confirmed pinned (`position: sticky`, `top: 0`)
after scrolling 1200px on `/players`; context bar read the owner's real pinned FPL draft from
localStorage and displayed `Bank £0.0m` / `FT 1` correctly against its stored `budget`/
`freeTransfers`; a `TapToReveal` click-open/Escape-close cycle confirmed via `aria-expanded`
toggling true/false with the full previously-hover-only content readable in the panel; `/transfers`
and `/compare` mobile-layout claims confirmed via `getBoundingClientRect` comparisons at 375px and
1280px as described above.
