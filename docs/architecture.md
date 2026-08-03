# Architecture

Companion to [../CLAUDE.md](../CLAUDE.md). Roadmap lives in [updated-plan.md](updated-plan.md);
the xP model's method and backtest in [phase-4-model.md](phase-4-model.md).

## Shape

```
FPL public API  ──►  Supabase Edge Functions (Deno)  ──►  Postgres (RLS)
                             ▲                                  │
                        pg_cron + pg_net                    anon SELECT
                                                                ▼
                                        Next.js static export ──► GitHub Pages
```

The browser talks only to Postgres over the publishable key, and only reads. Every write
path is an Edge Function running with the service role. Nothing in the front end can mutate
league data, which is why the client bundle needs no secret beyond the publishable key.

## Deployment

`next.config.ts` sets `output: "export"`, `trailingSlash: true`, and derives `basePath` from
`GITHUB_REPOSITORY` when `GITHUB_ACTIONS === "true"` — so local dev serves at `/` and Pages
serves at `/fpl-app/` from one config. `.github/workflows/ci.yml` typechecks, lints, and
builds; `deploy.yml` publishes `out/` to Pages. Both need the repo secrets
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.

Drafts live in `localStorage` (`lib/drafts.ts`). Cloud sync waits for Supabase Auth in
Sprint 8, along with the `team_drafts` / `draft_players` / `draft_lineups` tables.

## Edge Functions and schedule

| Function | Cron | Reads | Writes |
|---|---|---|---|
| `sync-bootstrap` | `*/30 * * * *` | `bootstrap-static` | `teams`, `players`, `gameweeks`, `element_types`, `game_settings`, `chip_definitions`, snapshot tables |
| `sync-fixtures` | `0 * * * *` | `fixtures` | `fixtures`, `fixture_changes` |
| `sync-player-history` | `*/10 * * * *` | `element-summary/{id}` | `player_gameweek_stats`, `player_season_history` |
| `sync-live-gameweek` | `*/2 * * * *` | `event/{gw}/live` | `player_live_stats` |
| `sync-manager` | manual | `entry/{id}` + `/history` `/picks` `/transfers` | `managers`, `manager_*` |
| `generate-predictions` | `5,35 * * * *` | Postgres only | `player_predictions` |

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
`prediction_models` records the version and parameters. The `player_xp_horizons` view
pivots predictions into `xp_1` / `xp_3` / `xp_5` / `xp_8` / `xp_total`, which is the single shape the
whole front end consumes (`expected_minutes` and `start_probability` come from
`player_predictions` directly, for the next gameweek).

`xp_total` sums every projected gameweek, so it is the Season horizon — but `generate-predictions`
runs `HORIZON = 8`, which makes `xp_total` **identical to `xp_8`** today. `SEASON_HORIZON_NOTE` says so
in the UI. Extending that window is the precondition for genuine season-long planning.

RLS: anon `SELECT` on reference and derived tables, writes service-role only.

## Model layer (`lib/`)

Everything squad-shaped flows through `TeamState` in `team-state.ts` — picks, budget,
armbands, starting XI, bench order — mutated by pure functions returning new state.
`validateSquad` and `blockedReason` take `SquadRules` loaded from `game_settings`.
`computeProjection(picks, xpOf, availabilityOf, captain, vice, horizon)` returns
`{ total, captainBonus, missing }`, weighting the armband bonus by availability so a
doubtful captain's projection falls back toward the vice.

- `optimizer.ts` — greedy build plus pairwise swap improvement, strategies
  `max_points | balanced | value | differential`. Its risk gate is non-binding in practice:
  the xP model already zeroes injured and suspended players, so they are never selected
  regardless of the setting.
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
- `formation.ts`, `fdr.ts`, `drafts.ts`, `supabase/client.ts`.

## xP model

`_shared/xp-model.ts`, `MODEL_VERSION = "v1.0.0"`. Per-90 rates derived from prior seasons,
weighted toward the most recent, scaled by per-component fixture multipliers, then converted
to points via `scoring_rules`. Discrete counts (goals, clean sheets, bonus tiers) use Poisson
tails — `poissonAtLeast`, `expectedFloorDiv` — rather than rounding an expectation.

Calibration history and the backtest that caught a 17% arithmetic shortfall are in
[phase-4-model.md](phase-4-model.md). `MODEL_PARAMS.positionCalibration` is fitted in-sample
and must be refitted once real 2026/27 results exist.
