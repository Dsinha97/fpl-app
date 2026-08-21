# Data pipeline

FPL public API → Supabase Edge Functions (Deno) → Postgres, on a cron schedule via `pg_cron` +
`pg_net`.

```
FPL public API  ──►  Supabase Edge Functions (Deno)  ──►  Postgres (RLS)
                             ▲                                  │
                        pg_cron + pg_net                    anon SELECT
                                                                ▼
                              Next.js static export ──► Cloudflare Workers assets
```

The browser only ever reads Postgres over the publishable key. Every write is an Edge Function
running with the service role — nothing in the front end can mutate league data.
— [architecture.md](../architecture.md)

## Functions and cadence

| Function | Cron | Writes |
|---|---|---|
| `sync-bootstrap` | `*/30 * * * *` | `teams`, `players`, `gameweeks`, `element_types`, `game_settings`, `chip_definitions`, snapshots |
| `sync-fixtures` | `*/2 * * * *`, self-gated | `fixtures`, `fixture_changes` |
| `sync-player-history` | `*/10 * * * *` | `player_gameweek_stats`, `player_season_history` — cursor-batched, so ~700 `element-summary` calls spread across runs instead of one timing out |
| `sync-live-gameweek` | `*/2 * * * *`, self-gated | `player_live_stats` — took its no-op branch every day until GW1's first kickoff (2026-08-21), then wrote 600 real rows; see [deadline-and-matchday.md](deadline-and-matchday.md) |
| `sync-manager` | manual only | `managers`, `manager_*` — `invoke_sync` POSTs an empty body so it has no `entry_id` to schedule with; only runs when `/team` calls it directly |
| `sync-league-picks` | manual only, on-demand | `league_entries`, `league_entry_picks` — same reason as `sync-manager`: no `entry_id`/`league_id` to schedule with. See [ownership-and-leagues.md](ownership-and-leagues.md) |
| `generate-predictions` | `5,35 * * * *` | `player_predictions` — see [xp-model.md](xp-model.md) |
| `fpl-session` / `fpl-my-team` | manual | see [fpl-authentication.md](fpl-authentication.md) — the two functions that verify a Supabase JWT before touching anything |
| `ingest-fpl-archive` | manual, one-off backfill | `player_gameweek_stats` for past seasons (2022-23 through 2025-26) — see below |

`public.invoke_sync(text)` is the single pg_cron entry point (revoked from `anon`/`authenticated`).
Every run writes a `sync_runs` row (`success | partial | error | skipped`), which is what `/status`
renders.

### `sync-fixtures` self-gated cadence (fixed 2026-08-21)

Ran unconditionally hourly until GW1's kickoff dry run (see
[deadline-and-matchday.md](deadline-and-matchday.md)) found the gap this created:
`sync-live-gameweek`'s own gate trusts `fixtures.started`, so an hourly refresh left it blind for up
to ~55 minutes into a genuinely live match. `sync-fixtures` can't self-gate on `started`/`finished`
the way `sync-live-gameweek` does — those are exactly the columns it exists to refresh, so trusting
them would let a stale "not started" suppress the very sync that would correct it. It gates on
`kickoff_time` instead, which doesn't go stale on this timescale: any fixture kicking off within the
next 15 minutes or the last 3 hours (covers delays/stoppage time) always gets the full pull;
otherwise it falls back to an hourly floor via its own `sync_runs` history, so the rest of the day
(price moves, postponements) still refreshes without polling every 2 minutes for no reason. Confirmed
live: the new cadence fired unassisted twice while GW1's opener was in progress, both `success`.

## Backfilling seasons the FPL API no longer serves

`sync-player-history` only reaches the *current* season's per-gameweek data — the FPL API doesn't
serve past-season gameweek detail at all. `ingest-fpl-archive` (Sprint 17a) fills that gap from the
community-run [Vaastav archive](https://github.com/vaastav/Fantasy-Premier-League), fetched and
written **entirely server-side** — an earlier attempt tried to relay the CSVs through chat as
batched SQL and found a single 500-row batch tokenizes to roughly 500,000 tokens, infeasible at any
real scale. Mirrors `sync-player-history`'s cursored, time-budgeted shape (55s budget, resumable via
`sync_runs.cursor`), keyed `GET .../ingest-fpl-archive?season=2023-24[&maxGw=38][&force=1]`.

Rows are filtered to `player_code`s present in `player_season_history` — the xP model's only
training source, and a much smaller set (506 codes) than an archived season's full headcount
(~700-900 rows/gameweek, including academy/departed players this DB holds no history for). Two real
bugs surfaced during verification: the 1000-row PostgREST cap (see below) silently truncated the
allowed-codes fetch on the first run, undercounting by ~70%; and the archive occasionally repeats a
row within one gameweek's CSV (rearranged fixtures re-listed), which a plain array upsert can't
apply twice in one statement — fixed by deduping on `(player_id, fixture)` before writing. Feeds
[xp-model.md](xp-model.md)'s walk-forward validation. — [sprint-17a.md](../sprints/sprint-17a.md)

## Change detection, not snapshotting

`public.record_player_snapshots()` compares each incoming bootstrap against the last stored value
and writes to `player_price_history` / `player_ownership_history` / `player_status_history` /
`player_news` **only when something actually moved**. Naively snapshotting 700 players every 30
minutes would be ~7.8M rows a season; this is ~25k. `fixture_changes` applies the same idea to
kickoff times and results. `change_feed` (a view) unions all of them for `/news`.

A second, separate pipeline — [news-feed.md](news-feed.md) — ingests third-party RSS
headlines (Sprint 20) into `news_items`/`news_item_entities`, unioned by `news_feed`. It is
deliberately not merged into `change_feed`: those rows are verified facts derived from the
FPL API itself, RSS rows are editorial content with a probabilistic player/club link.

## `player_predictions` and the row cap

One row per player per fixture per model version, with full component provenance (`prior_weight`,
`n_eff`, `reliability`, `prior_source`, `xp_lower`/`xp_upper`) — see [xp-model.md](xp-model.md).
`player_xp_horizons` pivots this into `xp_1`/`xp_3`/`xp_5`/`xp_8`/`xp_19`/`xp_total`, which is what
almost every screen consumes. Three consumers need the **unpivoted** rows instead
(`/transfers`, `/builder`'s gameweek panel), and hit the platform's sharpest gotcha:
**the Supabase REST API caps every response at 1000 rows regardless of `.limit()`**, silently
truncating rather than erroring — anything reading the full series has to page with `.range()` until
a short page comes back (`PAGE_ROWS` in `app/transfers/page.tsx`). A double gameweek is two rows
sharing one `event` and must be **accumulated, not overwritten**, when folding into a per-event map
— an earlier version of `/builder`'s SquadBalance series shipped the overwrite bug.

See also: [fpl-api-constraints.md](fpl-api-constraints.md) (the FPL-side API quirks this pipeline
absorbs), [database-and-rls.md](database-and-rls.md) (the schema and access rules on the other end).
