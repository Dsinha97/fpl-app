@AGENTS.md

# FPL Decision — Analytics Hub

Personal Fantasy Premier League analytics and decision-support app. Static Next.js
front end on GitHub Pages, Supabase Postgres + Edge Functions behind it.

- Live: https://dsinha97.github.io/fpl-app/ · repo `Dsinha97/fpl-app` (public)
- Supabase project `FPL-App`, ref `fyxyqxpscmqjyjxsyhms`
- Owner's FPL manager ID **274486**; season being ingested 2026-27 (GW1 deadline 2026-08-21)
- Roadmap: [docs/updated-plan.md](docs/updated-plan.md) — **supersedes**
  `fpl_app_phase_wise_build_plan.md`, which is kept only as the original source doc
- Architecture, schema, and Edge Function detail: [docs/architecture.md](docs/architecture.md)
- xP model method + backtest: [docs/phase-4-model.md](docs/phase-4-model.md)

## Commands

```bash
npm run dev          # Next dev server (Turbopack)
npx tsc --noEmit     # typecheck — run before every commit
npm run lint         # eslint
npm run build        # static export to out/ — must pass before pushing
```

Never start the dev server with Bash; use the preview tools. If Turbopack reports a
parse error that `tsc` and `npm run build` both disagree with, it is a stale `.next`
cache — delete `.next` and restart.

## Ground rules

**Secrets.** Never ask for, store, or accept the Supabase DB password. Migrations and
function deploys go through the Supabase MCP OAuth integration; the browser client uses
only the project URL and publishable key. `.env*` and `.claude/` are gitignored, and
secrets belong in `.env.local` / GitHub Secrets referenced by name.

**Missing pre-season data — drop, renormalise, disclose.** Several formulas in the plan
reference fields FPL zeroes between seasons (team attack/defence strength, `players.form`).
Do not multiply a term by zero and ship a quietly shrunken score. Drop the term,
renormalise the remaining weights, and surface a note in the UI next to the number.
Precedent: `CAPTAIN_MODEL_NOTE` in `lib/lineup.ts`, `COMPARISON_MODEL_NOTE` in
`lib/scoring.ts`, `REPLACEMENT_MODEL_NOTE` for the omitted TeamFit terms.

**Say what the number means.** Downgrades are labelled as downgrades; empty result sets
say so ("Nothing available improves on this pick") rather than ranking five worse options.

**Squad rules come from the database.** Load `SquadRules` from `game_settings`; never
hardcode 15 players / £100m / 3-per-club.

**Verify, don't assume.** Probe the FPL API before designing against it, and check asset
URLs with curl — several documented patterns 404.

## Layout

```
app/            routes: / · /team · /players · /fixtures · /changes · /status
                        /builder (squad builder) · /compare (2–4 player comparison)
lib/            team-state.ts   TeamState, validateSquad, computeProjection, armbands
                optimizer.ts    greedy + swap squad optimiser (strategies, risk gates)
                lineup.ts       XI / captain / bench-order engine
                scoring.ts      risk, comparison, replacement finder (Sprint 4)
                formation.ts    bestStartingXi · fdr.ts FDR palette · drafts.ts localStorage
                supabase/client.ts
components/     pitch-view, pitch, player-card, player-detail, armband, identity,
                player-status-icons, fdr-badge, brand, theme, nav-links, ui/ (shadcn)
supabase/       migrations/ (SQL) · functions/ (Deno Edge Functions) · functions/_shared/
docs/           updated-plan.md · architecture.md · phase-4-model.md · phase-1-plan.md
```

`supabase/functions/**` is Deno and is **excluded from tsconfig and eslint** — it must be,
or `tsc --noEmit` breaks on Deno globals.

## Front-end conventions

- Everything squad-shaped consumes the shared `TeamState` (`lib/team-state.ts`). Mutations
  are pure functions returning a new state — `addPlayer`, `removePlayer`, `setCaptain`,
  `setViceCaptain` (which **swaps** rather than vacating the other armband).
- Horizon (`1 | 3 | 6 | 8`) is a **page-level** control in the builder and drives the
  projection, picker, optimiser, and comparison. The XI/captain/bench panel is deliberately
  pinned to the next gameweek — FPL makes you pick one lineup per GW.
- Dark theme is class-based: `.dark` on `<html>`, set by a no-FOUC boot script in
  `app/layout.tsx`, defaulting to the system preference. Brand purple surfaces
  `#0E0118` page / `#1E0234` card / `#2A0A45` input, purple-900/40 borders,
  `#00FF87` accent. Style both themes on anything new.
- The FDR scale in `lib/fdr.ts` is the owner's specified ordered ramp with green/red venue
  rings — don't swap it for a default palette. FDR surfaces carry a `?` tooltip
  (`components/info-tooltip.tsx`) explaining the colours.
- Static export means no server components doing data fetching at request time, no route
  handlers, and no `next/image` optimisation.

## Gotchas that have bitten

- Supabase `.select()` needs a single string literal; concatenating with `+` collapses the
  row type to `GenericStringError`.
- Edge Functions called from the browser need CORS preflight (`preflight()` in
  `_shared/sync.ts`) — curl never exercises the OPTIONS request.
- `trailingSlash: true` is required or `/team/` 404s on Pages.
- FPL kit images need the size suffix: `shirt_{team_code}-110.png`, GK `shirt_{code}_1-110.png`.
  Club crests are `resources.premierleague.com/premierleague/badges/70/t{team_code}.png`.
  FPL region codes aren't all ISO — EN/S1/WA/NI map to flagcdn `gb-eng`/`gb-sct`/`gb-wls`/`gb-nir`.
- Don't touch refs inside an IIFE in JSX; hoist into a `useMemo` or React lints it.

## Status

Phases 0–4 and Sprints 1–4 of `docs/updated-plan.md` are complete: sync pipeline, xP engine
v1.0.0, dark theme, `/builder` (pitch UI, paginated picker, squad optimiser, lineup engine,
replacement finder) and `/compare`.

Next: **Sprint 5 — Transfer Decision Engine** (transfer simulator, roll-vs-transfer). It is
also where `SquadBalance` and `FutureFlexibility`, currently omitted from TeamFit, become
computable.

Blocked until matches are played: custom FDR and the `TeamAttackStrength` term both need
team strength fields FPL leaves at 0 pre-season, and the xP `positionCalibration` factors
must be refitted against real 2026/27 results — the current backtest is in-sample and proves
arithmetic consistency, not predictive accuracy.
