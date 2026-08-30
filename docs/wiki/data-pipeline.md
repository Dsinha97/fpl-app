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
| `sync-manager` | manual, plus every claim via `sync-claimed-managers` below | `managers`, `manager_*` — `invoke_sync` POSTs an empty body so it has no `entry_id` to schedule with itself; `/team`'s **Refresh** button and rival mutations still call it directly for a forced real-time sync |
| `sync-claimed-managers` | `*/2 * * * *` (fixed 2026-08-27) | Nothing directly — calls the fetch-and-write logic `sync-manager` was refactored to share (`_shared/manager-sync.ts`), once per claimed manager (`user_profiles.entry_id`) that's due. See "`/team` no longer syncs on every load" below |
| `sync-league-picks` | manual only, on-demand — first real caller is `/leagues` (2026-08-30) | `league_entries`, `league_entry_picks` — same reason as `sync-manager`: no `entry_id`/`league_id` to schedule with. See [ownership-and-leagues.md](ownership-and-leagues.md) |
| `generate-predictions` | `5,35 * * * *` | `player_predictions`, plus a pre-deadline snapshot into `player_prediction_archive` — see [xp-model.md](xp-model.md) and "`player_prediction_archive`" below |
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

## `/team` no longer syncs on every load (fixed 2026-08-27)

`app/team/page.tsx`'s auto-connect effect used to call `connect(entryId)` unconditionally on every
visit while signed in, and `connect` always invoked `sync-manager` — a full live re-fetch from
FPL's own API (`getEntry`, `getEntryHistory`, `getEntryTransfers`, per-gameweek picks), `await`ed
before anything from Supabase could render. Measured at **3.7s blocking**, the single largest cost
found in [performance.md](performance.md)'s latency pass — bigger than the `/deadline` pagination
bug below. Invisible to a signed-out baseline, since the whole path sits behind `user && entryId`.

Fixed with the same staleness policy `sync-live-gameweek` already uses for live scores, extended to
managers: `_shared/manager-sync.ts` is the fetch-and-write logic extracted out of `sync-manager`
verbatim, so the client-triggered single-manager sync and the new `sync-claimed-managers` cron
(`*/2 * * * *`, matching `sync-live-gameweek`'s own cadence) call one implementation. A claimed
manager is due if never synced (no `managers` row yet — a fresh claim doesn't wait a day for its
first data), due unconditionally on a matchday (the 2-minute tick *is* "every switch"), or due
after 24h on a quiet day (`managers.updated_at`, `sync-manager`'s upsert being the table's only
writer). `hasLiveFixture` (the "is a match live right now" query) moved into `_shared/sync.ts` so
both `sync-live-gameweek` and `sync-claimed-managers` share the one implementation rather than each
deciding matchday separately. `app/team/page.tsx`'s auto-mount effect now reads straight from
Supabase (`connect(entryId, { sync: false })`); a claim the cron hasn't reached yet falls back to a
real sync automatically off the same "no `managers` row" signal the cron's due-list check uses.

Measured: `/team` settle time **8.3s → 5.55s**, `sync-manager` gone entirely from an ordinary page
load. — [performance.md](performance.md), [sprints/latency.md](../sprints/latency.md)

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

**One FPL update could double-report as two `change_feed` rows (fixed 2026-08-30).**
`record_player_snapshots` writes `player_status_history` and `player_news` in one transaction, so
an update touching both status and the news text landed on the identical `observed_at` in both
tables — the view then emitted a `status` row and a `news` row for one real event. Fixed in the
view itself: a status event and a co-timestamped news event now merge into one `status` row, with
the news sentence folded into `detail.news_new` so nothing is lost (`describe()`,
`lib/change-feed.ts`, surfaces it). The news branch also gained the `rn > 1` baseline guard the
status branch already had, so a player's very first news row stops being reported as a change.
Verified live against three players whose duplicated rows collapsed into one merged row each.

A second, separate pipeline — [news-feed.md](news-feed.md) — ingests third-party RSS
headlines (Sprint 20) into `news_items`/`news_item_entities`, unioned by `news_feed`. It is
deliberately not merged into `change_feed`: those rows are verified facts derived from the
FPL API itself, RSS rows are editorial content with a probabilistic player/club link.

### `player_ownership_history`'s watchlist (Sprint 29.0, 2026-08-30)

Ownership snapshots were gated to ~20h for every player — full-population 2-hourly would be ~7.8M
rows/season. That gate is a data-accrual clock: FPL's price-change algorithm keys on net-transfer
**velocity**, and a daily snapshot can't reconstruct sub-daily velocity after the fact, so nothing
downstream could ever see the signal without fixing the sampling first. `record_player_snapshots`
now also samples at ~2h for a bounded watchlist — `cost_change_event <> 0`, or
`selected_by_percent`/net-transfer thresholds read from `game_settings`
(`price_watch_ownership_threshold`/`price_watch_net_transfer_threshold`, not hardcoded) — while the
rest of the population stays at ~20h. Verified live: watchlist size came back 111 players, not the
~700-player full population.

`lib/price-watch.ts`'s `priceProgress()` reads net transfers since a player's last recorded price
change and reports a direction and 0–1 progress toward a threshold that is itself a documented,
user-adjustable input (`DEFAULT_RISE_THRESHOLD`/`DEFAULT_FALL_THRESHOLD`) — FPL's real threshold is
unpublished and ownership-dependent, so per
[methodology.md](methodology.md#when-a-term-cannot-be-dropped-make-it-an-input) this is exposed
rather than fitted. Returns `"unknown"`, not a guess, below two post-change samples — verified
against a player who'd repriced the same day and correctly read unknown rather than a fabricated
percentage. Surfaced on `/players` (a column) and `/transfers` (inline on the incoming player).
Deliberately **not** a price-change classifier — that's gated on beating a naive
top-N-by-net-transfers baseline, walk-forward, and stays out until enough watchlist history has
accumulated. — [sprints/sprint-29.md](../sprints/sprint-29.md)

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

**`player_prediction_archive` (added 2026-08-27)** exists because `player_predictions` has no
history — `generate-predictions` deletes and replaces every row for the season on each run (see
above), so there was never a record of what the model said *before* a gameweek was played. GW1's
predictions were already gone by the time this was found; a deadline-gated hook inside
`generate-predictions` now snapshots the *next* gameweek's rows into the archive on every
pre-deadline run (re-archiving is fine — it just keeps the snapshot fresh up to the deadline) and
stops once that gameweek's deadline passes, freezing the last pre-deadline number. Public-read/
service-write like `player_predictions`, but keyed **without** `model_version` — it's one archived
historical fact per gameweek, not a live replaceable projection, so a mid-season `MODEL_VERSION`
bump only ever overwrites the still-open gameweek's row. `lib/prediction-accuracy.ts` joins it to
`player_gameweek_stats` once a gameweek scores; see [blocked-and-data-gaps.md](blocked-and-data-gaps.md)
for why the `/status` accuracy panel itself isn't built yet.

See also: [fpl-api-constraints.md](fpl-api-constraints.md) (the FPL-side API quirks this pipeline
absorbs), [database-and-rls.md](database-and-rls.md) (the schema and access rules on the other end).
