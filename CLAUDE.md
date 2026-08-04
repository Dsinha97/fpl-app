@AGENTS.md

# FPL Decision — Analytics Hub

Personal Fantasy Premier League analytics and decision-support app. Static Next.js
front end on GitHub Pages, Supabase Postgres + Edge Functions behind it.

- Live: https://dsinha97.github.io/fpl-app/ · repo `Dsinha97/fpl-app` (public)
- Supabase project `FPL-App`, ref `fyxyqxpscmqjyjxsyhms`
- Owner's FPL manager ID **274486**; season being ingested 2026-27 (GW1 deadline 2026-08-21)
- Roadmap: [docs/roadmap.md](docs/roadmap.md) — the authoritative sprint plan. It reconciles the
  owner's revised feature set (`docs/update-aug3.md`, kept unedited) against what is actually built.
  `docs/updated-plan.md` is now the **formula and method reference** only; its roadmap table and
  `fpl_app_phase_wise_build_plan.md` are both superseded
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
Precedent: `CAPTAIN_MODEL_NOTE` in `lib/lineup.ts`, `COMPARISON_MODEL_NOTE` and `RISK_MODEL_NOTE` in
`lib/scoring.ts`, `REPLACEMENT_MODEL_NOTE` for the omitted TeamFit terms, `SEASON_HORIZON_NOTE` in
`lib/team-state.ts` for a horizon that is shorter than its name suggests, `TRANSFER_MODEL_NOTE` in
`lib/transfers.ts`, `TRANSFER_OPTIMIZER_NOTE` in `lib/transfer-optimizer.ts`,
`COLD_START_MODEL_NOTE` in `supabase/functions/_shared/xp-model.ts` (mirrored front-side as
`COLD_START_NOTE` in `lib/scoring.ts` — the Deno file cannot be imported by Next).

**When a term cannot be dropped, make it an input.** Sometimes the missing quantity *is* the
feature — rolling a transfer is only worth something the frozen projection cannot see, so dropping it
would delete the option, and estimating it would be a fudge factor wearing a model's clothes. The
third way is `decisionMargin` in `lib/transfer-optimizer.ts`: a user-set number, defaulted and
documented, rendered as its own `+1 news` term and settable to zero to see the arithmetic alone.
Never tune an invented coefficient until the answer looks reasonable.

**Say what the number means.** Downgrades are labelled as downgrades; empty result sets
say so ("Nothing available improves on this pick") rather than ranking five worse options.
Costs and assumptions stay as their own terms — the transfer headline reads
`+8.5 xP − 8 hit − 0.2 risk = +0.3`, never a bare net figure. A basket that only breaks even should
look like one. Where a figure is knowingly conservative, say so and prefer understating: the wildcard
row does not re-optimise the armband, and discloses that its gain is therefore understated.

**One quantity, one implementation.** `riskPoints` (`lib/squad-score.ts`) is the single risk→points
rate, so Scenarios and Transfers cannot disagree about the same squad; the transfer optimiser scores
every branch through `simulateTransfers` rather than a second scorer, so the recommendation and the
manual basket agree to the decimal. Two implementations of one number is a bug with a delay on it.

**Squad rules come from the database.** Load `SquadRules` from `game_settings`; never
hardcode 15 players / £100m / 3-per-club.

**Verify, don't assume.** Probe the FPL API before designing against it, and check asset
URLs with curl — several documented patterns 404.

## Layout

```
app/            routes: / · /team · /players · /fixtures · /changes · /status
                        /builder · /scenarios (draft lab) · /transfers · /compare
lib/            team-state.ts   TeamState, validateSquad, computeProjection, horizons, armbands
                optimizer.ts    greedy fill + swap + funded-upgrade squad optimiser; fill order
                                and objective are separate (see fillScoreOf vs scoreOf)
                lineup.ts       XI / captain / bench-order engine
                scoring.ts      risk, comparison, replacement finder
                squad-score.ts  SquadScore over a whole draft (points-equivalent terms)
                transfers.ts    transfer basket simulation, sell prices, hit cost, FT accrual
                transfer-optimizer.ts  roll vs spend vs hit vs wildcard, beam search over baskets
                player-search.ts  name matching for every search box
                formation.ts    bestStartingXi · fdr.ts FDR palette · drafts.ts localStorage
                utils.ts        cn() · supabase/client.ts
components/     pitch-view, pitch, player-card, player-detail, armband, identity, transfer-plan,
                fixture-schedule, fdr-matrix, draft-timeline, player-status-icons,
                confidence-badge (reliability + rate band), fdr-badge, brand, theme,
                nav-links, info-tooltip, ui/ (+ range-slider)
supabase/       migrations/ (SQL) · functions/ (Deno Edge Functions) · functions/_shared/
docs/           roadmap.md · architecture.md · updated-plan.md (formulas) ·
                phase-4-model.md · phase-1-plan.md · update-aug3.md (owner source)
```

`supabase/functions/**` is Deno and is **excluded from tsconfig and eslint** — it must be,
or `tsc --noEmit` breaks on Deno globals.

## Front-end conventions

- Everything squad-shaped consumes the shared `TeamState` (`lib/team-state.ts`). Mutations
  are pure functions returning a new state — `addPlayer`, `removePlayer`, `setCaptain`,
  `setViceCaptain` (which **swaps** rather than vacating the other armband).
- Horizon (`1 | 3 | 5 | 8 | "season"`, with `HORIZONS`, `horizonLabel` and `horizonLength` in
  `lib/team-state.ts`) is a **page-level** control in the builder and drives the projection, picker,
  optimiser, and comparison. The XI/captain/bench panel is deliberately pinned to the next gameweek —
  FPL makes you pick one lineup per GW. `"season"` is a string, so anything doing arithmetic on a
  horizon must go through `horizonLength`, never the value itself.
- Player search goes through `matchesPlayerQuery` (`lib/player-search.ts`), which matches every name
  field and folds accents. `web_name` alone is not enough — FPL abbreviates it to `E.Anderson`.
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
- **The API caps every response at 1000 rows** whatever `.limit()` asks for — a bigger limit does not
  raise the cap, it just truncates and returns 200. Anything larger must be paged with `.range()`
  until a short page comes back. `player_predictions` over 8 gameweeks is ~3,040 rows; taking the
  first 1,000 quietly shrinks every number computed from it (see `PAGE_ROWS` in `/transfers`).
- Edge Functions called from the browser need CORS preflight (`preflight()` in
  `_shared/sync.ts`) — curl never exercises the OPTIONS request.
- `trailingSlash: true` is required or `/team/` 404s on Pages.
- FPL kit images need the size suffix: `shirt_{team_code}-110.png`, GK `shirt_{code}_1-110.png`.
  Club crests are `resources.premierleague.com/premierleague/badges/70/t{team_code}.png`.
  FPL region codes aren't all ISO — EN/S1/WA/NI map to flagcdn `gb-eng`/`gb-sct`/`gb-wls`/`gb-nir`.
- Don't touch refs inside an IIFE in JSX; hoist into a `useMemo` or React lints it.
- **Filling a budget-constrained squad greedily by raw score is wrong**, and it looked right for two
  sprints: `max_points` returned 257.8 xP where `value` returned 311.6, because taking the highest
  xP first buys five premiums and leaves ten slots for whatever the budget reserve still permits. It
  is a knapsack — order the fill by score *per million*, then let the swap passes spend the surplus
  on raw points. A legality floor is not a quality floor.
- **Bounded searches prune the moves that only pay off in combination.** A beam ranked purely by gain
  drops the "sell a premium to fund an upgrade elsewhere" leg before its second leg exists, so
  `transfer-optimizer.ts` carries funders alongside winners (`FUNDER_WIDTH`). Same shape of bug as
  the reserve floor above.
- Verify engine changes by running the real module against live data in a `npx tsx` harness before
  trusting the UI — both bugs above survived review and were caught that way in minutes. Keep the
  harness out of the commit.
- **A prior fitted on a filtered sample answers a different question.** The cold-start playing-time
  prior was first fitted on seasons of 450+ minutes — the same floor that makes a per-90 rate
  meaningful — which conditions on the very thing being predicted and produced a prior asserting
  every defender averages 47 minutes a game. Check what a fitting filter selects *for*.
- **A variance needs far more data than a mean.** Estimating the between-player variance inside a
  price band collapsed it to zero on thin cells, and `sigma2 / (n * 0 + sigma2)` is 1 — the prior
  silently overriding real evidence. Estimate spread at the coarsest level that is still meaningful.
- **An acceptance threshold you invented is not evidence.** "Established players must move under 2%"
  failed at 3% while MAE and RMSE both *improved*; the meaningful gate was the existing phase-4
  backtest (bias, MAE, unchanged Pearson r), not the round number.

## Notifications

`PushNotification` reaches the owner's phone when Claude Code Remote Control is paired. Use it at
approval gates and when a long run finishes — a migration awaiting sign-off, a red build, a sprint
landing. Not for routine progress.

## Status

Built: sync pipeline, xP engine **v1.1.0** (component model + empirical-Bayes cold-start priors,
so all 567 players are projected rather than 380), dark theme, `/players`, `/fixtures` (Schedule + FDR tabs),
`/builder` (pitch UI, paginated picker, squad optimiser, lineup engine, replacement finder),
`/compare`, `/scenarios` (draft manager, SquadScore, comparison, timeline), and `/transfers`
(basket simulation with hits, sell prices, armband handling, plus the weekly roll/spend/hit/wildcard
plan). In the revised numbering that covers Sprints 5, 6, 7, 8, 9 and 11.

Next: **Sprint 12 — Chip Strategy Engine**, which needs the prediction window extended past 8
gameweeks first. See [docs/roadmap.md](docs/roadmap.md) for the full ordering and the finishing
passes outstanding on 6, 7, 9 and 11.

Carried knowingly: **4 `npm audit` advisories** (3 high, 1 moderate — `postcss`, `sharp`, `next`,
`hono`). Low exposure on a static export with no image optimisation, and the fix is a framework bump
that needs its own verification pass. Assessed per-package under "Dependency advisories" in
[docs/roadmap.md](docs/roadmap.md) — don't reach for `npm audit fix --force`.

Blocked, with the reason recorded rather than worked around:

- **Team strength is 0 for all 20 clubs** pre-season → custom FDR and the `TeamAttackStrength` term.
- **League 314 standings are empty** pre-season → all of Sprint 10 (EO, template, rank gain).
- **`generate-predictions` runs an 8-gameweek window**, so `xp_total` equals `xp_8` and the Season
  horizon is really an 8-week horizon. Extending it is a prerequisite for Sprint 12 chip planning —
  and now load-bearing for a *decision*, not just a display: the transfer plan's roll branch cannot
  see beyond that window, which is why the value of waiting for news is an explicit input rather
  than something the model claims to know.
- **`sync-live-gameweek`'s row-writing path has never executed** — no live matches yet.
- **xP `positionCalibration` is fitted in-sample.** The backtest proves arithmetic consistency, not
  predictive accuracy; refit against real 2026/27 results. Refitted once already for v1.1.0
  (GKP 1.1077 / DEF 1.2224 / MID 1.2116 / FWD 1.1972) after shrinkage moved the level.
- **No external-league data source.** Cold-start phase 2 (league translation) is blocked on one:
  API-Football has no xG at all, soccerdata does not cover the Championship out of the box, Understat
  is top-5 only, and a translation cohort built from `player_season_history` would be survivor-biased
  because that table only holds players still in the game. Assessed under "Cold-Start Patch" in
  [docs/roadmap.md](docs/roadmap.md).
