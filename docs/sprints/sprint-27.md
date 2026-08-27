# Sprint 27 — Post-GW1 reckoning

GW1 was scored 2026-08-21. The roadmap assumed that would unblock a cluster of items; checking
the live database on 2026-08-27 found a different picture — some things genuinely unlocked, one
urgent thing was actively being lost, and one long-blocked doc claim was simply stale. This
sprint is the response, in five parts.

## What GW1 actually did and didn't unlock

Verified against the live database rather than assumed: `player_gameweek_stats` gained 610 real
rows for GW1 (310 with minutes), `players.form` went non-zero for 292 players, the first 10 price
moves landed, and `manager_picks`/`manager_gameweek_history`/`league_entry_picks` all have real
rows. `teams.strength_attack_*`/`strength_defence_*`/`played`/`points` are **still 0 for all 20
clubs** after a fresh sync the same day — the TeamAttack term and custom analytical FDR stay
blocked on FPL's side, contrary to what the roadmap implied.

## Prediction archive (urgent — 26-hour clock)

`generate-predictions` deletes and replaces `player_predictions` wholesale on every run (see the
comment above that delete in `supabase/functions/generate-predictions/index.ts`) — there was
never a record of what the model said *before* a gameweek was played. GW1's predictions were
already gone by the time this was found; GW2's deadline was ~26 hours out.

- New table `player_prediction_archive` (migration `20260827154000_prediction_archive.sql`),
  public-read/service-write, keyed *without* `model_version` — one archived truth per gameweek,
  not a live replaceable projection like `player_predictions`.
- A deadline-gated hook inside `generate-predictions` snapshots the next gameweek's rows before
  its deadline and freezes after — verified live: the hook archived 616 rows on first invocation,
  and `sync_runs.details.archived_rows` confirms it.
- A one-shot backfill preserved GW2's snapshot immediately, ahead of the hook's own deploy.
- `lib/prediction-accuracy.ts` joins the archive to `player_gameweek_stats` once a gameweek is
  scored. `accuracyStats` (bias/MAE/RMSE/Pearson r) was lifted out of
  `scripts/backtest-walkforward.ts` into `lib/stats.ts` so the walk-forward harness and this
  scoreboard score residuals identically — "one quantity, one implementation" applies to the
  accuracy metric itself, not just the model.
- RLS verified for both `anon` and `authenticated`: select works, insert is outright denied,
  update/delete silently affect 0 rows (no write policy exists for either verb) — service-role
  only, as intended.
- The `/status` accuracy panel itself is deliberately **not built** — see roadmap.md's Blocked
  table. A panel that can only say "n=1" invites reading one gameweek's residual as a verdict.

## GW1 predicted-lineup layer deleted

Its own stated expiry ("delete in one commit once GW1 is scored") had arrived. Removed
`lib/gw1-lineups.ts`, `components/gw1-badge.tsx`, `ScoredPlayer.gw1` and its read in `riskScore`,
the toggle and `gw1_*` fields on `/deadline` and `/transfers`, and `PlayerData.gw1_*`/the
detail-panel block. `PlayerData.is_rotation_risk`/`RotationIcon` predate this layer and stay.
`RISK_MODEL_NOTE` was also refreshed while in the file — it said EO "cannot be built until a
gameweek has been scored", which stopped being true the moment GW1 was scored; the real,
still-current reason (the field-wide top-1k sample is separately blocked; league-scoped EO exists
but answers a different question) replaces it.

## `/review`

New route: what a gameweek's decision actually cost, in terms named separately — points and rank
movement, the captain call vs. the best-in-hindsight starter, bench points recovered by a
projected auto-sub vs. still stranded (alongside FPL's own `points_on_bench`, not reconciled away
against it), and transfers (an honest empty state — `manager_transfers` has 0 rows today). Built
entirely on existing primitives: `loadGameweekState` (`lib/gameweek-state.ts`) is event-agnostic,
so a finished gameweek runs through the identical captaincy/auto-sub/points-split logic a live one
does. `lib/gameweek-review.ts`. No new table, no model risk.

Verified live against entry 274486's real GW1 data: 49 pts / overall rank 4,673,927 matches
`manager_gameweek_history` exactly; bench-stranded (11) matches FPL's own `points_on_bench` (11);
the captain gap (−9 vs João Pedro) is consistent with the picked captain (Bruno Fernandes)
blanking.

## Current-season xP blend — built, measured, does not clear the gate

The roadmap's long-standing "blend current-season form into xP" item was actually built and
swept this sprint, not just scoped. Two real bugs were caught before the sweep could mean
anything (both additive/inert for every existing caller):

- `SeasonRow.games` — `weightedOwnRates`/`deriveRates` divided `mpg`/`start_share` by a fixed
  38-game denominator per season slot; a synthetic current-season row would have cut a nailed
  starter's `mpg` by ~58% off two gameweeks of data, silently, since the per-90 rates alone (all
  the original doc proposal checked) still looked fine.
- `deriveRatesWithPrior`'s `currentSeasonRow`/`currentSeasonWeight` **append** the current season
  as a fourth term rather than displacing the oldest of the three prior seasons (the original
  proposal) — displacing silently halves the *prior* evidence weight the moment any current-season
  data exists at all, a second way for one gameweek to dominate.

Swept with an extended `scripts/backtest-walkforward.ts` (genuine within-season walk-forward:
the synthetic row at event *E* is built only from that season's own events strictly before *E*).
MAE and Pearson r improve in every one of the three backtest seasons at every weight tested
(`wCur ∈ {0.3, 0.6, 1.0}`), but the gate also requires bias not to worsen in magnitude, and
2024-25's grows from 0.329 to 0.375–0.390 at every weight. Since the gate needs all three seasons,
**the blend is not wired into `generate-predictions`** — `MODEL_VERSION` stays `v1.5.0`,
`COLD_START_MODEL_NOTE`/`COLD_START_NOTE` are untouched. Full table and both bug write-ups:
[phase-4-model.md](../phase-4-model.md#honest-limitations).

## Docs reconciliation

`docs/roadmap.md`'s Blocked table had two stale rows: `sync-live-gameweek`'s write path was
recorded as "never executed" despite 2,434 successful runs (up to 610 rows each) during GW1, and
League 314's blocked reason ("ties on 0 until GW1 is scored") no longer applied — the real,
current reason is that league 314 has never been synced at all (0 rows in `league_entries` for
that league). Both corrected. `docs/sprints/sprint-26.md` backfills the two commits
(`45ff633`, `ca7dc04`) that shipped 2026-08-23/24 with no sprint file. `CLAUDE.md`'s route list is
updated to include `/deadline`, `/news`, and `/review`, which it was missing.
