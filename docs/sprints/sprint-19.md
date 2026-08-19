# Sprint 19 — Design System & Interaction Feedback

**Built** 2026-08-19/20. Full plan: the approved plan file for this session (not checked into the
repo — see [docs/wiki/design-system.md](../wiki/design-system.md) for the lasting reference).

## Context

A UI/UX principles video ("Every UI/UX Concept Explained in Under 10 Minutes") was reviewed for
ideas worth adopting, alongside a direct owner request that `/deadline`, `/transfers`, and `/chips`
had too many equally-weighted cards. Auditing the app against the video's six principles turned up
four real defects worth more than the principles themselves — none of them things the video
described, all found by reading the actual code:

1. `app/globals.css`'s `--font-sans` was self-referential (`var(--font-sans)`), never resolving to
   `next/font`'s `--font-geist-sans` — Geist Sans downloaded on every page load and was never
   actually applied anywhere.
2. `components/ui/button.tsx` had the only correct `focus-visible` ring in the app and zero
   importers — 83 raw `<button>` elements, 6 `focus-visible:` occurrences total, none on a button.
3. `optimizeTransfers` (`/transfers`) and `runChipEngine` (`/chips`) ran synchronously inside a bare
   `useMemo`, freezing the tab on every recompute, with a `loading={plan === null}` flag that could
   never be true *during* the search — only before it.
4. `/deadline` rendered eight sibling sections in a flat stack sharing one `card` constant, so
   nothing outranked anything else — the concrete shape of "too many cards." `/chips` and
   `/transfers` repeated it.

## What shipped

- **Stage 0** — the font fix, landed first and alone since it moves every later visual comparison's
  baseline.
- **Stage 1** — a design-token layer that is actually load-bearing: real light-mode brand colours
  (derived from the exact hex the components already used, not guessed), `--success`/`--warning`/
  `--danger` (+ `-surface`/`-border` variants), a `--card`/`--card-supporting` two-tier system,
  `--surface-1/2/3`, one `--primary-hover` token collapsing three ad-hoc dark-mode green shades, a
  fixed `--popover` (was pointing at the wrong surface), and an ESLint `no-restricted-syntax` rule
  (warning-level) rejecting new raw hex in `className`.
- **Stage 2** — `focus-visible` rings, `aria-pressed` on toggle groups (fixing a real 1px shift where
  only the unselected side had a border), and one `aria-disabled`+reason convention, applied to
  every button/input/select on `/transfers`, `/chips`, `/builder`, and the shared components those
  pages use.
- **Stage 3** — the freeze fixed for real: both engines moved to a button/effect-gated pattern with
  a `setTimeout(0)` yield, an auto-run on first load, and an "inputs changed — re-run" banner
  instead of a silent stale recompute. `/builder`'s `optimizeSquad` gained a re-entry guard and
  button disabling (a double-click could run the knapsack search twice). New `Spinner`/`Skeleton`
  components, wired into every new busy state plus `role="status"` on the plain "Loading …" lines
  that previously announced nothing to a screen reader.
- **Stage 4a** — the card-ranking fix. `/deadline`'s squad, captain & XI, chip call, and transfer
  call keep full card weight; readiness, availability, and price & news watch recede to the page
  background with a fainter border and smaller heading. The countdown lost its card entirely — a
  border around one line of text was chrome, not structure. `/chips` and `/transfers` got the same
  treatment (schedules/sequences/simulation-result primary; per-chip grid, gameweek table, and the
  squad-picking table supporting).
- **Stage 4b** — xP promoted from a 3-column grid slot (behind Price, same weight as everything
  else) to its own 3xl row in the player detail panel, with `ConfidenceBadge`/`RateBand` surfaced
  beside it for the first time (the data — `reliability`/`prior_weight`/rate bounds — was already
  being fetched on `/builder`, just never threaded into `PlayerData`). The pitch card's name/xP size
  relationship was inverted within its existing 64–80px budget. Two of the four competing `_NOTE`
  disclosure treatments were retired — `RISK_MODEL_NOTE` was a bare paragraph in one place and a
  native, keyboard-inaccessible `title` in another **on the same page** (`/builder`); both `title`
  instances now use `InfoTooltip`.
- **Stage 5** — page-title line-height, applied once via a `--text-2xl`/`--text-2xl--line-height`
  theme override rather than 13 hand-typed rules (a plain `@layer base` rule cannot win against
  Tailwind's own line-height-bundling text-size utilities). The rhythm half of this stage turned out
  to be a non-problem on closer inspection — logged, not force-fixed.

## What was deliberately not done

Full hex migration (~300 literals, only the files each stage already touched were converted — ~150
remain, flagged by the new lint rule but not blocking), a 4-point spacing migration (the app's
2pt/half-step scale is load-bearing in a dense data tool), and a component-level `space-y-*` rhythm
refactor that the audit found wasn't needed. See
[docs/wiki/design-system.md](../wiki/design-system.md) for the full reasoning.

## Verification

Every stage verified live in the browser (both themes) via computed-style checks against the
literal it replaced — not just visual inspection. No automated test suite exists in this repo;
`tsc --noEmit`, `npm run lint`, `npm run build` all pass clean at every commit in this sprint.
