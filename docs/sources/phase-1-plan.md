# Phase 1 — FPL Data Ingestion

Detailed build plan for Phase 1 of [the phase-wise build plan](fpl_app_phase_wise_build_plan.md).

**Status:** complete — all five steps built, deployed, and verified on 2026-08-02
**Drafted:** 2026-08-02
**Goal:** a reliable pipeline that turns the official FPL API into a historical data warehouse in Supabase, so the
frontend never depends on FPL's response structure directly.

---

## 1. Observed API state

Verified against the live FPL API on **2026-08-02**. These observations drive the schema decisions below.

| Check | Result |
| --- | --- |
| Season state | 2026/27 pre-season. GW1 deadline `2026-08-21T17:30:00Z` |
| `elements` (players) | 564, each with 105 fields |
| `teams` | 20 |
| `events` (gameweeks) | 38 |
| `fixtures` | 380, all released, with `team_h_difficulty` / `team_a_difficulty` populated |
| `element-summary/{id}.history` | Empty — no matches played yet |
| `element-summary/{id}.history_past` | Up to 5 prior seasons per player |
| Team strength fields | `strength_attack_*` / `strength_defence_*` are `0`/`null` pre-season |
| `bootstrap.chips` | Season chip rules: two halves (GW1–19, GW20–38), each with wildcard / freehit / bboost / 3xc |
| `bootstrap.game_config.scoring` | Live scoring values per position |

### Endpoints used

```text
GET /api/bootstrap-static/          teams, element_types, events, elements, chips, game_config
GET /api/fixtures/                  all 380 fixtures
GET /api/element-summary/{id}/      per-player history, history_past, upcoming fixtures
GET /api/event/{gw}/live/           live per-player stats for a gameweek
```

Base URL: `https://fantasy.premierleague.com`

### Two free wins

`bootstrap.chips` and `game_config.scoring` are returned by the API as live, season-specific data. Ingesting them now
satisfies two constraints the build plan imposes on much later phases, at near-zero cost:

- Phase 8: *"Do not hardcode one season's chip behavior into the application."*
- Phase 4: *"keep scoring rules configurable rather than hardcoding them throughout the application."*

Example of what `game_config.scoring` provides:

```json
{
  "goals_scored":           { "GKP": 10, "DEF": 6, "MID": 5, "FWD": 4 },
  "defensive_contribution": { "GKP": 0,  "DEF": 2, "MID": 2, "FWD": 2 }
}
```

---

## 2. Schema design

### 2.1 Season scoping

Every table carries `season text` (e.g. `'2026-27'`).

FPL reuses `element.id` across seasons; **`element.code` is the stable cross-season identifier**, and it is what
`history_past` joins on (`element_code`). Therefore:

- Reference tables key on `(season, id)`
- Snapshot and history tables key on `(season, player_code)`

### 2.2 Change detection, not blind inserts

Naively inserting a price row per player per poll:

```text
564 players x 48 polls/day x 290 days  =  ~7.8M rows/season
```

That does not fit the Supabase free tier (500 MB). Inserting **only when the value differs from the last recorded
observation** captures identical information:

```text
~50-100 real price changes/day x 290 days  =  ~25k rows/season
```

The same pattern applies to status, news, and ownership. This is the single most important implementation detail in
Phase 1.

### 2.3 Tables

#### Reference (upserted, current state)

| Table | Source | Notes |
| --- | --- | --- |
| `teams` | `bootstrap.teams` | Includes `strength_*` fields; null until the season starts |
| `element_types` | `bootstrap.element_types` | Positions, squad selection rules |
| `gameweeks` | `bootstrap.events` | Deadlines, `is_current` / `is_next` / `finished`, average and highest score |
| `players` | `bootstrap.elements` | Current state per player per season |
| `fixtures` | `/api/fixtures/` | Kickoff, teams, scores, official difficulty, `stats` |

**`players` column strategy.** The API returns 105 fields. Type the ~40 the application actually queries — price,
status, position, team, ownership, minutes, xG/xA, defensive contribution, set-piece order — and keep the remainder in
a `raw jsonb` column. FPL adds fields most seasons; this avoids a migration each time one appears.

#### Config (new — not in the original plan, added per section 1)

| Table | Source | Columns |
| --- | --- | --- |
| `chip_definitions` | `bootstrap.chips` | `season, name, number, chip_type, start_event, stop_event` |
| `scoring_rules` | `game_config.scoring` | `season, stat, position, value` (unpivoted) |
| `game_settings` | `bootstrap.game_settings` | `season, key, value` — squad size, budget, club limit, transfer cap |

#### Historical snapshots (append-only, change-detected)

| Table | Written when | Key columns |
| --- | --- | --- |
| `player_price_history` | `now_cost` changes | `player_code, season, price, cost_change_event, observed_at` |
| `player_status_history` | `status` or `chance_of_playing_*` changes | `player_code, season, status, chance_of_playing_this_round, chance_of_playing_next_round, observed_at` |
| `player_news` | `news` text changes | `player_code, season, news, news_added, observed_at` |
| `player_ownership_history` | Daily | `player_code, season, selected_by_percent, transfers_in_event, transfers_out_event, observed_at` |
| `player_gameweek_stats` | Per GW | `player_id, season, event, fixture, minutes, goals, assists, xg, xa, bps, bonus, defensive_contribution, total_points, was_home, opponent_team, value` |
| `player_season_history` | Backfill, static | From `history_past`: `player_code, season_name, start_cost, end_cost, total_points, ...` |
| `fixture_changes` | Kickoff or gameweek changes | `fixture_id, field, old_value, new_value, observed_at` |

#### Operations

| Table | Purpose |
| --- | --- |
| `sync_runs` | `function_name, started_at, finished_at, status, rows_written, http_status, error` |

Without `sync_runs` there is no way to distinguish a broken sync from a genuinely quiet news day. It is also what the
`/status` page reads.

### 2.4 RLS

All tables are readable by `anon` (this is public FPL data). Writes are restricted to the service role used by the
Edge Functions. Manager-specific tables introduced in Phase 2 will need per-user policies.

---

## 3. Edge Functions

| Function | FPL calls | Frequency | Notes |
| --- | --- | --- | --- |
| `sync-bootstrap` | 1 | 30 min | Reference + config tables, plus all change-detected snapshots |
| `sync-fixtures` | 1 | 60 min | Upserts 380 fixtures, diffs into `fixture_changes` |
| `sync-player-history` | 564 | Daily + post-GW | Cursor-batched — see below |
| `sync-live-gameweek` | 1 | 2 min while live | `event/{id}/live/` into `player_gameweek_stats` |
| `sync-manager` | — | — | Scaffold only; deferred to Phase 2 per the build plan |

### 3.1 The 564-call problem

A full player-history sync requires one `element-summary/{id}` call per player, against a 150 s Edge Function ceiling
on the free tier.

**Approach: bounded concurrency plus a cursor checkpoint.**

- 5 requests in flight at a time — fast enough, but does not hammer the FPL API
- Process ~150 players per invocation, then persist the cursor position to `sync_runs`
- The next invocation resumes where the previous one stopped
- Four invocations complete a full pass

This is resumable, cannot exceed the wall-clock limit, and keeps ingestion inside Supabase as the target architecture
intends. Player history is a daily job, not a hot path, so spreading it across invocations costs nothing.

*Alternative considered:* a GitHub Actions job has no time limit and was free while this repo was public, but splits
ingestion across two platforms and puts the FPL fetch logic outside Supabase. The repo is private now, so Actions
minutes are metered — which strengthens the original decision rather than changing it.

### 3.2 Shared module

`supabase/functions/_shared/` holds the FPL client (base URL, timeout, retry with backoff), the Supabase service
client, change-detection helpers, and `sync_runs` instrumentation. Each function stays thin.

---

## 4. Scheduling — `pg_cron` + `pg_net`

```text
sync-bootstrap        */30 * * * *        price and status changes
sync-fixtures         0 * * * *
sync-player-history   0 4 * * *           plus a post-gameweek trigger
sync-live-gameweek    */2 * * * *         self-gating
```

`sync-live-gameweek` exits immediately unless some fixture satisfies `started AND NOT finished`, so it costs almost
nothing outside match windows. Both extensions are enabled via migration.

Per the build plan: *"Avoid unnecessarily aggressive polling."*

---

## 5. Build sequence

| Step | Contents |
| --- | --- |
| 1 | Reference schema, `sync_runs`, `sync-bootstrap` — players, teams, gameweeks land |
| 2 | `sync-fixtures` and `fixture_changes` |
| 3 | Snapshot tables and change detection wired into `sync-bootstrap` |
| 4 | `sync-player-history` with cursor batching; backfill 5 seasons of `history_past` |
| 5 | `sync-live-gameweek`, pg_cron schedules, and a `/status` page showing last sync per function |

Steps 1–4 are worth completing before the season starts on **2026-08-21**. The five-season `history_past` backfill is
the training data for the Phase 4 xP model and is available now.

Each step is a migration plus a function, deployed and verified before the next begins.

---

## 6. Deliverable

Per the build plan, Supabase should contain current players, clubs, positions, gameweek, fixtures and deadlines,
player prices and status, historical player performance, and historical snapshots.

Concretely, Phase 1 is done when:

- All reference tables are populated and refreshing on schedule
- `sync_runs` shows green runs for every function
- `player_price_history` and `player_status_history` are accumulating change-detected rows
- Five seasons of `player_season_history` are backfilled
- `player_gameweek_stats` populates correctly during the first live gameweek
- The `/status` page reports last-sync time per function

---

## 7. Decisions taken

| # | Decision | Outcome |
| --- | --- | --- |
| 1 | Heavy sync placement | Edge Function with cursor batching. In practice the full 564-player pass completes in a single invocation; the cursor remains for when in-season history grows |
| 2 | `players` table shape | Typed core columns plus a `raw jsonb` tail |
| 3 | Ownership snapshot frequency | Daily, time-gated in `record_player_snapshots` |
| 4 | Cron authentication | Publishable key rather than storing the secret key in the database — the functions are idempotent and only touch public data |
| 5 | Live stats storage | Separate `player_live_stats` table. The live endpoint aggregates per player per gameweek and its bonus is provisional, so it cannot share a key with the per-fixture authoritative table |

### Known gap

`sync-live-gameweek` writes zero rows until matches begin: FPL's `/event/{id}/live/` returns an empty
`elements` array pre-season. Gating, scheduling, and the fetch path are verified; the row-writing path
is not exercised until the GW1 deadline on 2026-08-21.

---

## 8. Out of scope

Deferred to later phases, per the build plan:

- Manager data ingestion — Phase 2
- Any xP or FDR computation — Phases 4 and 5
- Authenticated FPL actions — Phase 9
- Notifications — Phase 10
