# Architecture

Companion to [../CLAUDE.md](../CLAUDE.md). The authoritative sprint plan is
[roadmap.md](roadmap.md); [updated-plan.md](updated-plan.md) is now the formula and method
reference only. The xP model's method and backtest are in [phase-4-model.md](phase-4-model.md).

## Shape

```
FPL public API  ──►  Supabase Edge Functions (Deno)  ──►  Postgres (RLS)
                             ▲                                  │
                        pg_cron + pg_net                    anon SELECT
                                                                ▼
                              Next.js static export ──► Cloudflare Workers assets
```

The browser talks only to Postgres over the publishable key, and only reads. Every write
path is an Edge Function running with the service role. Nothing in the front end can mutate
league data, which is why the client bundle needs no secret beyond the publishable key.

## Deployment

`next.config.ts` sets `output: "export"` and `trailingSlash: true`, and deliberately sets **no
`basePath`** — the site is served from the root of its own hostname. Cloudflare's Git integration
builds `main` with `npm run build` (Node from `.nvmrc`) and `wrangler deploy` serves `out/` as static
assets per `wrangler.jsonc`; `public/_headers` ships as `out/_headers` for immutable asset caching.
`.github/workflows/ci.yml` still typechecks, lints and builds as a quality gate, but no longer
deploys.

Three things this migration off GitHub Pages left behind, worth not rediscovering:

- **The base path was a landmine, not just dead code.** It was derived from `GITHUB_REPOSITORY`
  whenever `GITHUB_ACTIONS` was set. Cloudflare sets neither, so it resolved to `""` correctly by
  accident — but any future build inside Actions would have silently prefixed every asset with
  `/fpl-app`, giving a page whose HTML parsed and whose scripts all 404ed. Hence removed outright.
- **`trailingSlash: true` now pairs with Cloudflare's `html_handling` default**
  (`auto-trailing-slash`), which resolves both `/team` and `/team/` to `out/team/index.html`. Setting
  that to `"none"` in `wrangler.jsonc` would 404 every route.
- **`NEXT_PUBLIC_*` are Cloudflare *Build* variables, not runtime bindings.** A static export has no
  runtime; the values are baked in at build. `lib/supabase/client.ts` calls `createClient` at module
  scope, so a missing key throws `supabaseUrl is required` during prerender and fails the build. The
  same pair are GitHub Secrets for `ci.yml`.

The repository is **private**, which does not make the site private — the Workers URL is open to
anyone holding it, and Postgres RLS remains the only real access boundary. Gating it with Cloudflare
Access is a recorded follow-up in [roadmap.md](roadmap.md).

Drafts live in `localStorage` — `fpl_drafts_v1`, plus `fpl_draft_history_v1` holding the last 20
saves per draft for the Scenario Lab timeline (`lib/drafts.ts`). Cloud sync waits for Supabase Auth
in **Sprint 14**, along with the `team_drafts` / `draft_players` / `draft_lineups` tables: a cloud
table with no owning user column would only have to be rebuilt once auth arrives.

## Edge Functions and schedule

| Function | Cron | Reads | Writes |
|---|---|---|---|
| `sync-bootstrap` | `*/30 * * * *` | `bootstrap-static` | `teams`, `players`, `gameweeks`, `element_types`, `game_settings`, `chip_definitions`, snapshot tables |
| `sync-fixtures` | `0 * * * *` | `fixtures` | `fixtures`, `fixture_changes` |
| `sync-player-history` | `*/10 * * * *` | `element-summary/{id}` | `player_gameweek_stats`, `player_season_history` |
| `sync-live-gameweek` | `*/2 * * * *` | `event/{gw}/live` | `player_live_stats` |
| `sync-manager` | manual | `entry/{id}` + `/history` `/picks` `/transfers` | `managers`, `manager_*` |
| `generate-predictions` | `5,35 * * * *` | Postgres only | `player_predictions` |
| `fpl-session` | manual | — | `fpl_sessions` (encrypted) |
| `fpl-my-team` | manual | `api/my-team/{id}` (session-authenticated) | reads only |

`fpl-session` and `fpl-my-team` (Sprint 14, §F) are the two exceptions to "any caller can
trigger a sync harmlessly" — both verify the caller's Supabase JWT (`_shared/auth.ts`)
before touching anything, since they read/write a table keyed by Supabase user rather than
public FPL data. `fpl-session` encrypts the owner's pasted FPL session (AES-256-GCM,
`_shared/crypto.ts`, under the `FPL_SESSION_ENC_KEY` secret) into `fpl_sessions`, whose RLS
has **zero policies** — not even the row's owner can read it through the anon/authenticated
client, only the service-role client inside an Edge Function. `fpl-my-team` decrypts it and
calls `GET /api/my-team/{entry_id}/`, the auth-gated endpoint that returns real purchase
prices, bank and free transfers — verified live and distinct from the dead `/drf/my-team/<id>`
path older guides use, which 200s with an HTML shell instead of 404ing. See docs/roadmap.md,
"Sprint 14", for the full PingOne probe that ruled out an actual login endpoint.

`public.invoke_sync(text)` is the pg_cron entry point (pg_net POST, service role, revoked
from `anon`/`authenticated`). Every run writes a `sync_runs` row —
`success | partial | error | skipped` — which is what `/status` renders.

Shared helpers in `supabase/functions/_shared/`: `fpl.ts` (typed fetchers +
`mapLimit` bounded concurrency), `sync.ts` (`serviceClient`, `currentSeason`, `corsHeaders`,
`preflight`, `jsonResponse`), `coerce.ts` (null-safe casts, `chunk`), `season.ts`
(`deriveSeason` from deadlines), `xp-model.ts`.

`sync-player-history` is cursor-batched: it stores its position and processes a slice per
invocation, so 700 `element-summary` calls spread across runs instead of timing out.

`sync-live-gameweek`'s row-writing path is **unverified** — there are no live matches until
GW1, so it has only ever taken the no-op branch.

`sync-manager` is the one function with **no cron entry** — `invoke_sync` POSTs an empty body, so it
has no way to supply an `entry_id` even if scheduled. It runs only when `/team` invokes it directly
with the manager ID from `localStorage`, which is why manager data refreshes on a page visit rather
than on a schedule. Its `history.past` capture already includes `rank_percentage` per season, which
Sprint 12A's manager profile consumes as-is rather than re-deriving from a stored field size.

## Data model

Reference tables mirror `bootstrap-static` (`teams`, `players`, `element_types`,
`gameweeks`, `game_settings`, `scoring_rules`, `chip_definitions` — the last holds the real
season chip windows, GW1–19 / GW20–38).

History is **change-detected, not snapshotted**. `public.record_player_snapshots()` compares
the incoming bootstrap against the last stored value and writes to
`player_price_history`, `player_ownership_history`, `player_status_history`, and
`player_news` only when something actually moved. Naively snapshotting 700 players every
30 minutes would be ~7.8M rows a season; this is ~25k. `fixture_changes` does the same for
kickoff times and results. The `change_feed` view unions them for `/changes`.

`player_predictions` stores one row per player per gameweek per model version;
`prediction_models` records the version and parameters. Since **v1.1.0** each row also carries the
provenance of its own number — `prior_weight`, `n_eff`, `reliability`, `prior_source`, and an
`xp_lower` / `xp_upper` rate band — and `rate_priors` holds the fitted priors those were derived
from, so a projection can be explained after the fact rather than only recomputed. The `player_xp_horizons` view
pivots predictions into `xp_1` / `xp_3` / `xp_5` / `xp_8` / `xp_total`, which is the shape almost
every screen consumes (`expected_minutes` and `start_probability` come from `player_predictions`
directly, for the next gameweek).

Two consumers need the **unpivoted** rows instead. `/transfers` reads `player_id, event, xp` across
the whole window, because pricing a rolled transfer means knowing what a single gameweek is worth,
which a cumulative total cannot answer. That is ~380 players × 8 gameweeks ≈ 3,040 rows, and
**the API caps every response at 1000 rows whatever `.limit()` asks for** — a larger limit truncates
and still returns 200. It has to be paged with `.range()` until a short page comes back; see
`PAGE_ROWS` in `app/transfers/page.tsx`. Silently taking the first thousand would shrink every
number computed from the series.

`xp_total` sums every projected gameweek, so it is the Season horizon — but `generate-predictions`
runs `HORIZON = 8`, which makes `xp_total` **identical to `xp_8`** today. `SEASON_HORIZON_NOTE` says so
in the UI. Extending that window is the precondition for genuine season-long planning, and since
Sprint 9 it also bounds a *decision* rather than only a display: the transfer plan's roll branch
cannot see past the window, which is why the value of waiting for news is an explicit user input.

`chip_definitions` is load-bearing rather than decorative: the transfer optimiser reads the real
wildcard window from it (wildcard #1 runs GW2–19), so the option is correctly unavailable in GW1.

RLS: anon `SELECT` on reference and derived tables, writes service-role only. **Sprint 14
adds a second RLS shape.** `user_profiles`, `team_drafts`, `draft_snapshots` and
`manager_rivals` carry a `user_id` and are scoped `auth.uid() = user_id` in both directions —
no anon access, and no cross-user access even when authenticated. `fpl_sessions` goes
further still: RLS enabled, **zero policies**, so no role at all (not even the row's owner)
can read it outside a service-role Edge Function. `team_drafts.players` is stored as
`jsonb` mirroring `lib/team-state.ts`'s `TeamState` rather than a normalised child table —
a draft is always read and written whole, so a `draft_players` table would only add a hard
FK to `players(season, id)` that a season rollover would strand, same as `manager_picks`.

## Routes

Static export, so no server components fetching at request time, no route handlers, and no
`next/image` optimisation. Every page loads its own data from Postgres in the browser.

| Route | What it is |
|---|---|
| `/` | Landing and status summary |
| `/team` | The owner's real FPL squad (empty until the first deadline — `manager_picks` has no rows yet), plus "Import as draft" (Sprint 14, `lib/fpl-squad.ts`) and rival management |
| `/signin`, `/auth/callback` | Magic-link sign-in and its PKCE callback (Sprint 14) |
| `/settings/fpl` | Paste an FPL session for real purchase prices/bank (Sprint 14, §F) — the alternative to the blocked automated login, see docs/roadmap.md |
| `/players` | Explorer: paginated, searchable, position/team/price filters |
| `/fixtures` | Schedule and FDR matrix sub-tabs |
| `/changes` | The `change_feed` view — prices, ownership, status, news, fixture changes |
| `/builder` | Pitch UI, paginated picker, squad optimiser, lineup engine, replacement finder |
| `/scenarios` | Draft manager: SquadScore ranking, 2–4 draft comparison, save timeline |
| `/transfers` | Weekly transfer plan, then basket simulation with hits and sell prices |
| `/compare` | Head-to-head player comparison |
| `/status` | `sync_runs` health per Edge Function |

Two conventions worth knowing before touching a page. **Horizon** (`1 | 3 | 5 | 8 | "season"`) is a
page-level control that drives projection, picker, optimiser and comparison together; the
XI/captain/bench panel is deliberately pinned to the next gameweek, because FPL makes you pick one
lineup per gameweek. And `"season"` is a *string*, so any arithmetic on a horizon must go through
`horizonLength`, never the value itself.

## Model layer (`lib/`)

Everything squad-shaped flows through `TeamState` in `team-state.ts` — picks, budget,
armbands, starting XI, bench order — mutated by pure functions returning new state.
`validateSquad` and `blockedReason` take `SquadRules` loaded from `game_settings`.
`computeProjection(picks, xpOf, availabilityOf, captain, vice, horizon)` returns
`{ total, captainBonus, missing }`, weighting the armband bonus by availability so a
doubtful captain's projection falls back toward the vice.

- `xp-model.ts` (Deno, `_shared/`) — the xP model, and since v1.1.0 the **cold-start prior layer**.
  `fitRatePriors` decomposes `player_season_history` into within-player (`sigma2`) and between-player
  (`tau2`) variance; `deriveRatesWithPrior` shrinks a player's own rates toward the prior by
  `sigma2 / (n_eff * tau2 + sigma2)`, so a thin record is used rather than discarded. `predict` is
  unchanged — the prior emits the same `Rates` shape it already consumed, which is why this was one
  seam and not a parallel model. Two traps are documented in the code because both shipped wrong
  first: fitting the playing-time prior on 450+ minute seasons selects for starters, and estimating
  `tau2` per price band collapses it to zero on thin cells and lets the prior override evidence.
- `optimizer.ts` — greedy build, then a bounded same-position swap pass, then a funded-upgrade pass
  that downgrades one pick to pay for a better one (a same-position swap alone cannot fix a bad pick
  costing 50p more than what is held, once the budget is committed). Strategies
  `max_points | balanced | value | differential`. **Fill order and objective are separate concerns**:
  maximising total xP under a budget is a knapsack, and ordering the fill by raw xP is the textbook
  wrong answer — it buys five premiums and completes the squad with near-zero fillers, which is how
  Maximum points once returned fewer points than Value. So `fillScoreOf` orders Maximum points by
  points per million while `scoreOf` keeps raw points as what the swap passes maximise. Its risk gate
  is non-binding in practice: the xP model already zeroes injured and suspended players.
- `lineup.ts` — XI, captain, bench order. The XI maximises plain Σ xP, deliberately with no
  extra minutes multiplier, because xP already scales by expected minutes and double-counting
  would punish rotation risk twice. Bench order uses a Poisson substitution probability:
  `λ = Σ (1 − playProbability)` over the ten outfield starters, with the reserve keeper
  pinned to slot 0.
- `scoring.ts` — risk score (rotation / injury / minutes uncertainty / fixture variance, weights
  renormalised over 0.90 because the spec's effective-ownership term has no data source yet),
  `comparePlayers` (normalised across the compared set, so it answers "which of these"),
  and `findReplacements`, which is squad-aware: the outgoing player's price is spendable and
  the club limit ignores him.
- `squad-score.ts` — `SquadScore` over a whole draft, for the Scenario Lab. The terms arrive in
  incompatible units (expected points in the hundreds, fixture quality 0–1, risk 0–100), so each is
  converted to points-equivalent before summing and the per-term breakdown is returned so a
  comparison table can show what drove the total. Exports `riskPoints`, the single risk→points
  exchange rate — shared with `transfers.ts` so two screens cannot disagree about one squad.
- `transfers.ts` — basket simulation. Applies out/in pairs in order against a working copy, so cash
  freed by move one funds move two, as the game behaves. `sellPrice` follows FPL's rule (purchase
  price plus half of any rise, rounded down); `accrueFreeTransfers` is the banking rule, one per
  gameweek capped at five and clamped at both ends. Pure, so the optimiser below can call it in a
  loop.
- `transfer-optimizer.ts` — the weekly decision: roll, spend one, spend two, take a hit, or wildcard.
  A beam search over `findReplacements` candidates, every surviving basket scored by
  `simulateTransfers` rather than by a second scorer, so a recommendation cannot contradict the
  manual simulator. The beam carries *funders* as well as winners: selling a premium to pay for an
  upgrade elsewhere scores badly alone, so a beam ranked only by gain prunes the first leg before the
  second can pay for it. `projectAtEvent` mirrors `computeProjection` term for term on a single
  gameweek, which is what prices the roll branch honestly — see the roll-value table in
  [roadmap.md](roadmap.md).
- `player-search.ts` — `matchesPlayerQuery` / `fullName`, matching every name field and folding
  accents. Used by every search box, because `web_name` alone is not enough: FPL abbreviates it to
  `E.Anderson`.
- `stats.ts` — shared `mean`/`median`/`variance`/`quantile`/`linearSlope`, added in Sprint 12A to
  replace five independent `mean` redeclarations. Keeps *both* variance forms as distinct exports
  (`variancePopulation`/`varianceSample`): `scoring.ts`'s risk engine has always used the population
  form, and the two are not interchangeable — the consolidation was verified to move zero risk scores
  across 2,272 player/horizon comparisons before it shipped.
- `manager-profile.ts` — career percentile profile and rival comparison (Sprint 12A). Converts FPL's
  own `rank_percentage` ("top X%", lower better) to a 0–100 higher-is-better score, then reports
  best/median/worst/spread/trend with a confidence gate below 3 and 6 seasons — deliberately no
  composite volatility index (uncalibratable weights) and no archetype (needs behavioural data the
  API does not expose for past seasons). See "Sprint 12A" in [roadmap.md](roadmap.md).
- `formation.ts`, `fdr.ts`, `drafts.ts`, `utils.ts` (`cn`), `supabase/client.ts`.

The squad optimiser's `RiskLevel` does double duty since v1.1.0: `low` optimises the *lower* edge of
the rate band, `high` the mean. That is what stops the cold-start layer filling squads with
speculation, and it avoided inventing a reliability discount coefficient — prior-based players lose
~87% from mean to lower bound against ~14% for established ones, so Low deprioritises them by
arithmetic rather than by fiat.

### Disclosed omissions

Several formulas in the plan reference fields FPL zeroes between seasons. Rather than multiply a term
by zero and ship a quietly shrunken score, the term is dropped, the remaining weights renormalised,
and a note surfaced in the UI next to the number: `CAPTAIN_MODEL_NOTE` (`lineup.ts`),
`COMPARISON_MODEL_NOTE` / `RISK_MODEL_NOTE` / `REPLACEMENT_MODEL_NOTE` (`scoring.ts`),
`SEASON_HORIZON_NOTE` (`team-state.ts`), `TRANSFER_MODEL_NOTE` (`transfers.ts`), and
`TRANSFER_OPTIMIZER_NOTE` (`transfer-optimizer.ts`).

## xP model

`_shared/xp-model.ts`, `MODEL_VERSION = "v1.0.0"`. Per-90 rates derived from prior seasons,
weighted toward the most recent, scaled by per-component fixture multipliers, then converted
to points via `scoring_rules`. Discrete counts (goals, clean sheets, bonus tiers) use Poisson
tails — `poissonAtLeast`, `expectedFloorDiv` — rather than rounding an expectation.

Calibration history and the backtest that caught a 17% arithmetic shortfall are in
[phase-4-model.md](phase-4-model.md). `MODEL_PARAMS.positionCalibration` is fitted in-sample
and must be refitted once real 2026/27 results exist.
