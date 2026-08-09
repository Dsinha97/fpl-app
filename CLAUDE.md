@AGENTS.md

# FPL Decision — Analytics Hub

Personal Fantasy Premier League analytics and decision-support app. Static Next.js
front end on Cloudflare, Supabase Postgres + Edge Functions behind it.

- Live: https://fpl-app.deepayansinha.workers.dev/ on Cloudflare Workers static assets ·
  repo `Dsinha97/fpl-app` (**private**)
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

**Secrets.** Never ask for, store, or accept the Supabase DB password — or, since Sprint 14,
an FPL password. Migrations and function deploys go through the Supabase MCP OAuth
integration; the browser client uses only the project URL and publishable key. `.env*` and
`.claude/` are gitignored, and secrets belong in `.env.local`, GitHub Secrets (for `ci.yml`)
or Cloudflare Build variables (for the deploy) — referenced by name, never pasted into chat
or a commit.

**FPL authentication is PingOne, and automated credential login is blocked — don't
re-derive this.** Probed 2026-08-09: `auth.pingone.eu`'s OAuth client offers no password
grant at all, a third party cannot register a redirect URI on the Premier League's client,
and the one reachable flow (`response_mode=pi.flow`) opens with a PingOne Protect
bot-detection node before any credential screen. See docs/roadmap.md, "Sprint 14 — FPL
login is blocked", for the full probe table. Built instead: a session handoff
(`app/settings/fpl`, `supabase/functions/fpl-session` / `fpl-my-team`) where the owner signs
in to FPL in their own browser and pastes the resulting session, which is AES-256-GCM
encrypted at rest under the `FPL_SESSION_ENC_KEY` Edge secret.

**Row Level Security is a real access boundary here, not a formality — verify it, don't
just enable it.** Every table with a `user_id` (`user_profiles`, `team_drafts`,
`draft_snapshots`, `manager_rivals`, added Sprint 14) is scoped `auth.uid() = user_id` in
both directions; `fpl_sessions` has RLS enabled with **zero policies**, so not even its own
owner can read it outside a service-role Edge Function. Before trusting a new policy,
simulate a second user with `set_config('request.jwt.claims', ...)` inside a rolled-back
`execute_sql` transaction and confirm they get zero rows and zero affected writes against
someone else's data — a policy that is present but permissive looks identical to a correct
one until tested from the other side. Every table before Sprint 14 uses the older
public-read / service-write-only shape (`for select to anon, authenticated using (true)`);
don't apply the newer per-user shape to those without a reason, and don't apply the older
shape to anything new that has an owner.

**Missing pre-season data — drop, renormalise, disclose.** Several formulas in the plan
reference fields FPL zeroes between seasons (team attack/defence strength, `players.form`).
Do not multiply a term by zero and ship a quietly shrunken score. Drop the term,
renormalise the remaining weights, and surface a note in the UI next to the number.
Precedent: `CAPTAIN_MODEL_NOTE` in `lib/lineup.ts`, `COMPARISON_MODEL_NOTE` and `RISK_MODEL_NOTE` in
`lib/scoring.ts`, `REPLACEMENT_MODEL_NOTE` for the omitted TeamFit terms, `SEASON_HORIZON_NOTE` in
`lib/team-state.ts` for a horizon that is shorter than its name suggests, `TRANSFER_MODEL_NOTE` in
`lib/transfers.ts`, `TRANSFER_OPTIMIZER_NOTE` in `lib/transfer-optimizer.ts`,
`COLD_START_MODEL_NOTE` in `supabase/functions/_shared/xp-model.ts` (mirrored front-side as
`COLD_START_NOTE` in `lib/scoring.ts` — the Deno file cannot be imported by Next), and
`chipModelNote` in `lib/chips.ts` for the flat fixture list every chip is currently valued against,
`TACTICAL_PROFILE_NOTE` in `lib/tactical-profile.ts` for PL club tactical data shown as
disclosed context rather than folded into xP, and `XDC_MODEL_NOTE` in `lib/scoring.ts` for the
defensive-contribution figure applying one aggregate FPL count to two different qualifying-action
rules (CBIT for defenders, CBIRT for midfielders/forwards).

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
                        /builder · /scenarios (draft lab) · /transfers · /chips · /compare
lib/            stats.ts        shared mean/median/variance/quantile/linearSlope — import, don't
                                redeclare (scoring.ts keeps the population stdev form, deliberately)
                manager-profile.ts  career percentile profile + rival comparison (Sprint 12A)
                team-state.ts   TeamState, validateSquad, computeProjection, horizons, armbands
                optimizer.ts    greedy fill + swap + funded-upgrade squad optimiser; fill order
                                and objective are separate (see fillScoreOf vs scoreOf)
                lineup.ts       XI / captain / bench-order engine
                scoring.ts      risk, comparison, replacement finder
                squad-score.ts  SquadScore over a whole draft (points-equivalent terms)
                transfers.ts    transfer basket simulation, sell prices, hit cost, FT accrual
                transfer-optimizer.ts  roll vs spend vs hit vs wildcard, beam search over baskets
                chips.ts        Chip Strategy Engine (Sprint 12) — per-event lineup/pool views over
                                optimiseLineup/optimizeSquad, joint chip-schedule search
                tactical-profile.ts  PL club manager profiles (Sprint 12.5) — types + loader only,
                                deliberately no scoring function; disclosed context, not an xP term
                player-search.ts  name matching for every search box
                formation.ts    bestStartingXi · fdr.ts FDR palette · drafts.ts localStorage
                utils.ts        cn() · supabase/client.ts
components/     pitch-view, pitch, player-card, player-detail, armband, identity, transfer-plan,
                fixture-schedule, fdr-matrix, draft-timeline, player-status-icons,
                confidence-badge (reliability + rate band), manager-profile-card (+ RivalTable),
                fdr-badge, brand, theme, nav-links, info-tooltip, ui/ (+ range-slider)
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
- `trailingSlash: true` is required or a direct hit on `/team/` 404s. It pairs with Cloudflare's
  default `html_handling: "auto-trailing-slash"`, which resolves both `/team` and `/team/` to
  `out/team/index.html` — setting that to `"none"` in `wrangler.jsonc` would 404 every route.
- **Cloudflare's setup wizard sees `next` in package.json and configures the OpenNext adapter**
  (`npx opennextjs-cloudflare build`), which is for server-rendered Next apps and dies on
  `ENOENT .next/standalone/...pages-manifest.json`. This app is `output: "export"`; the build command
  is plain `npm run build` and `wrangler.jsonc` serves `out/`. Don't let the wizard re-add it.
- **Cloudflare runtime variables are not build variables.** A static export bakes
  `NEXT_PUBLIC_*` in at build time, so they belong in Build variables. Set only as runtime
  bindings, the build fails at `supabaseUrl is required` — `lib/supabase/client.ts` calls
  `createClient` at module scope, so a missing key throws during prerender rather than degrading.
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

Built: sync pipeline, xP engine **v1.4.0** (component model + empirical-Bayes cold-start priors, so
all 567 players are projected rather than 380, plus squad reconciliation so every club's projected
starters, goalkeeper and minutes sum to the facts a match enforces — promoted-club squads no longer
collapse toward zero nor established squads inflate past eleven; v1.3.0 weights that correction by
each player's evidence rather than applying it uniformly, gated on a backtest; v1.4.0 gives the
defensive-contribution rate its own eligible-minutes denominator — see Status below),
dark theme, `/players` (horizon control, xDefcon, select-to-compare), `/fixtures` (Schedule + FDR +
Clubs tabs),
`/builder` (pitch UI, paginated picker, squad optimiser, lineup engine, replacement finder),
`/compare` (now with xDefcon), `/scenarios` (draft manager, SquadScore, comparison, timeline),
`/transfers` (basket simulation with hits, sell prices, armband handling, plus the weekly
roll/spend/hit/wildcard plan), and `/chips` (per-gameweek value for all four chips over the projected
window, plus a joint scheduling search). In the revised numbering that covers Sprints 5, 6, 7, 8, 9,
11 and 12.

**Sprint 12 — Chip Strategy Engine — built (2026-08-07).** `lib/chips.ts` values Bench Boost, Triple
Captain, Free Hit and Wildcard per gameweek by reusing `optimiseLineup` and `optimizeSquad` unchanged
against a new per-event view rather than a second implementation. Measured against the live fixture
list: every gameweek this season has all 20 clubs playing exactly once — no blanks or doubles yet,
since those are only created later by cup postponements — so today's values are driven by fixture
difficulty alone and read comparatively flat; `chipModelNote` computes this from `fixtures` at call
time rather than asserting it, so the finding updates itself once real doubles appear. A chip window
the prediction engine hasn't reached yet is reported blocked, not silently omitted, matching
`transfer-optimizer.ts`'s wildcard-row precedent — moot today since predictions now reach GW38 (see
the horizon item below), so both chip halves (GW1-19, GW20-38) evaluate. Free Hit always re-optimises
the armband for its one-week squad; Wildcard carries the current armband forward when it survives the
rebuild and discloses understatement when it doesn't, the same treatment `transfer-optimizer.ts`'s
wildcard branch already gives the same situation — verified in a `tsx` harness against live data
(caught a real bug: `windowTotal` was defaulting a missing prediction to `0` instead of `null`, which
made `optimizeSquad`'s reserve-floor logic treat "no data" as a genuine zero-xP pick).

**Five queued items, built (2026-08-07):** a price filter on the Builder search (`RangeSlider`,
bounds from the live pool); the player detail panel's fixture ticker now follows the page's horizon
(was hardcoded to 3, capped at 8, `components/player-detail.tsx` / `app/builder/page.tsx`); a `19`
horizon plus **Season now means the full 38 gameweeks**, not the chip window it used to stop at
(`player_xp_horizons` gained `xp_19*`; `generate-predictions` runs to the season's real last
gameweek — verified live, 573 players, 21,774 rows, 20s; `seasonHorizonNote` rewritten since its old
"Sprint 12 prerequisite" caveat went stale the moment Sprint 12 shipped); Sprint 12.5's buildable
slice (below); and **squad reconciliation phase 2**, gated on a backtest and shipped as **xP engine
v1.3.0** — see "Squad reconciliation, phase 2" in [docs/roadmap.md](docs/roadmap.md) for the full gate
table (Pearson r 0.774 → 0.830 recovering most of the gap to the no-reconciliation 0.851, at a
disclosed cost of `consistencyViolations` rising 1.6% → 4.2% of the league).

**Sprint 12.5 — PL Team Manager Intelligence, buildable slice — built (2026-08-07).** `pl_managers` +
`teams.tactical_manager_id` (seeded via migration, alias-mapping the 7 of 20 clubs whose name differs
from `teams.name` and asserting all 20 linked or failing the migration), `lib/tactical-profile.ts`
(types + loader only — no scoring function, so nothing here can accidentally multiply into xP), a
`System` line in the player detail panel, and a full 20-club section (moved to a **Clubs** tab on
`/fixtures` in Sprint 12.6 — see below; was originally on `/team`). The numeric `μ_fit`
multiplier and cold-start integration stay blocked on validation, exactly as scoped — see
[docs/roadmap.md](docs/roadmap.md).

**Sprint 12.6 — Defensive Contribution engine fix, plus five surface fixes — built (2026-08-08).**
`dc90` was dividing by a minutes denominator that included pre-2024/25 seasons the FPL API never
tracked `defensive_contribution` for, silently halving the rate for every multi-season player;
`deriveDcEligibleSeasons` in `supabase/functions/_shared/xp-model.ts` derives the eligible-season set
from the data and gives `dc90` its own denominator, shipped as **xP engine v1.4.0** with
`positionCalibration` refit and gated on the phase-4 backtest cohort (Pearson r held per-position,
rose overall — see the gate table under "Sprint 12.6" in [docs/roadmap.md](docs/roadmap.md)). An
`xDefcon` column followed on `/players` (which also gained a horizon control, retiring the hardcoded
5-gameweek fixture run) and `/compare`, behind `XDC_MODEL_NOTE` — which discloses the one gap the
engine fix does not close: FPL scores defenders and midfielders on different qualifying-action sets
(CBIT vs CBIRT) but the API exposes only one combined count. Plus: select-to-compare checkboxes on
`/players` (`?ids=` into `/compare`, `MAX_COMPARE` now shared from `lib/scoring.ts`); `/chips` no
longer silently omits a gameweek before a chip's own window opens, showing it blocked with a reason
instead; and every draft-aware page (`/chips`, `/transfers`) now reads the `?draft=<id>` that
`/builder` and `/scenarios` link with, instead of defaulting to whichever draft was most recently
edited.

**Sprint 14 — Authentication & Team Sync — built (2026-08-09).** Magic-link Supabase Auth;
owned cloud storage for drafts (`user_profiles`, `team_drafts`, `draft_snapshots`,
`manager_rivals` — the first RLS in this schema beyond public-read, verified live with a
two-account cross-read test rather than just read from the policy definitions);
`lib/draft-sync.ts` layering local-first cloud sync on top of `lib/drafts.ts`'s unchanged
localStorage API; `lib/fpl-squad.ts` turning `manager_picks` into a `TeamState` (`source:
"fpl"`, the value `TeamSource` had carried unused since Sprint 5) with an "Import as draft"
button on `/team` and `IMPORTED_SQUAD_NOTE` disclosing that purchase price falls back to
`now_cost`; and the rivals table on `/team` replaced with an explicitly-added
`manager_rivals` set, closing a leak where every connected manager's entry was visible to
every other user. Automated FPL credential login — what the roadmap originally specified —
turned out to be blocked by the identity provider's own configuration (PingOne, no password
grant, bot-detection on the one reachable flow); built a session handoff instead
(`app/settings/fpl`, `fpl-session`/`fpl-my-team` Edge Functions, `fpl_sessions` with RLS
enabled and zero policies). Full detail in docs/roadmap.md, "Sprint 14".

Next: the finishing pass outstanding on Sprint 11 (TeamAttack) remains blocked on team strength.
Sprint 13 (live match data) is staged — `sync-live-gameweek`'s write path still cannot be verified
before a real fixture kicks off (GW1 deadline 2026-08-21) — and is the next substantial piece of
work once it can be. Sprint 15 (Action Layer) is next after that.

Carried knowingly: **1 `npm audit` advisory** (moderate — `hono`, via `shadcn`'s own dev-time
dependency tree, unreachable from the app). The 3 high advisories (`postcss`, `sharp`, `next`) cleared
with the `next` 16.3.0 bump; `hono`'s cleared for production by moving `shadcn` to
`devDependencies`. Assessed under "Dependency advisories" in [docs/roadmap.md](docs/roadmap.md).

Blocked, with the reason recorded rather than worked around:

- **Team strength is 0 for all 20 clubs** pre-season → custom FDR and the `TeamAttackStrength` term.
- **League 314 standings are empty** pre-season → all of Sprint 10 (EO, template, rank gain).
- **`sync-live-gameweek`'s row-writing path has never executed** — no live matches yet.
- **Automated FPL credential login** → PingOne (the identity provider behind
  `fantasy.premierleague.com`) offers no password grant and the one reachable OAuth flow opens with
  bot-detection. Built a session handoff instead (Sprint 14, §F) — see docs/roadmap.md.
- **xP `positionCalibration` is fitted in-sample.** The backtest proves arithmetic consistency, not
  predictive accuracy; refit against real 2026/27 results. Refitted once already for v1.1.0
  (GKP 1.1077 / DEF 1.2224 / MID 1.2116 / FWD 1.1972) after shrinkage moved the level.
- **No external-league data source.** Cold-start phase 2 (league translation) is blocked on one:
  API-Football has no xG at all, soccerdata does not cover the Championship out of the box, Understat
  is top-5 only, and a translation cohort built from `player_season_history` would be survivor-biased
  because that table only holds players still in the game. Assessed under "Cold-Start Patch" in
  [docs/roadmap.md](docs/roadmap.md).
- **Squad reconciliation fixes how much a club plays, not how well.** Promoted-club squads are
  role-correct — starters, goalkeeper and minutes sum to what a match actually enforces — but team
  strength is still 0 for all 20 clubs, so the model has no way to say Hull's best player is worse
  than Arsenal's; a promoted club's projections can top the value tables purely because their squad
  sum was fixed, which is a real answer from an incomplete model, not a bug. Phase 1 (v1.2.0) could
  not tell an established starter from a fringe reserve on the same price band either — that part is
  now fixed: phase 2 (v1.3.0) weights the correction by each player's evidence, recovering the phase-4
  cohort Pearson r from 0.774 to 0.830 (0.851 with no reconciliation at all) — see "Squad
  reconciliation, phase 2" in [docs/roadmap.md](docs/roadmap.md).
- **Manager behavioural history (transfers, captains, chips, differentials) is blocked, not just
  pre-season** → all of §9/§10 in the Manager Intelligence change plan. The FPL API exposes none of
  that for past seasons, and `manager_picks` has a hard FK to the current season's `players`, so it
  cannot even be stored if it could be fetched. Buildable only from GW1 onward, current season only.

Two data-shape gotchas worth not rediscovering (Sprint 12A):

- **`manager_season_history.rank_percentage` is FPL's own "top X%" — lower is better.** Everything
  internal to `lib/manager-profile.ts` flips this to a 0–100 higher-is-better `percentileScore` so it
  reads the same direction as xP and SquadScore; don't mix the two conventions in one screen.
- **`total_players` (captured into `game_settings`) is a pre-season snapshot, not a field size.** It
  reads ~2.9M in early August and climbs to ~11M by GW1 — a ~4× swing. Nothing consumes it yet;
  `game_settings.updated_at` is the sample-time record for whoever does.
