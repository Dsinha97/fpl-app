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
| `sync-fixtures` | `0 * * * *` | `fixtures`, `fixture_changes` |
| `sync-player-history` | `*/10 * * * *` | `player_gameweek_stats`, `player_season_history` — cursor-batched, so ~700 `element-summary` calls spread across runs instead of one timing out |
| `sync-live-gameweek` | `*/2 * * * *` | `player_live_stats` — has only ever taken its no-op branch; see [deadline-and-matchday.md](deadline-and-matchday.md) |
| `sync-manager` | manual only | `managers`, `manager_*` — `invoke_sync` POSTs an empty body so it has no `entry_id` to schedule with; only runs when `/team` calls it directly |
| `generate-predictions` | `5,35 * * * *` | `player_predictions` — see [xp-model.md](xp-model.md) |
| `fpl-session` / `fpl-my-team` | manual | see [fpl-authentication.md](fpl-authentication.md) — the two functions that verify a Supabase JWT before touching anything |

`public.invoke_sync(text)` is the single pg_cron entry point (revoked from `anon`/`authenticated`).
Every run writes a `sync_runs` row (`success | partial | error | skipped`), which is what `/status`
renders.

## Change detection, not snapshotting

`public.record_player_snapshots()` compares each incoming bootstrap against the last stored value
and writes to `player_price_history` / `player_ownership_history` / `player_status_history` /
`player_news` **only when something actually moved**. Naively snapshotting 700 players every 30
minutes would be ~7.8M rows a season; this is ~25k. `fixture_changes` applies the same idea to
kickoff times and results. `change_feed` (a view) unions all of them for `/changes`.

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
