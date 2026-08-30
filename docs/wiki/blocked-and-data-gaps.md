# Blocked, with reasons

The single answer to "why isn't X built yet." Everything here is blocked on a real, checked
constraint — not merely unscheduled. See [roadmap.md](../roadmap.md#blocked-with-reasons) for the
live index this page expands on.

| Blocked | Reason | Detail |
|---|---|---|
| Team strength (0 for all 20 clubs) | Pre-season placeholder; blocks custom FDR and any TeamAttack term | [fpl-api-constraints.md](fpl-api-constraints.md), [risk-scoring.md](risk-scoring.md) |
| League 314 rank-ordering (top-1k sample) | Not a data/engineering blocker any more — a Sprint 29 follow-up load-test proved `sync-league-picks` handles league 314 at full scale (2000 entries, rank-ordered, 0 failures, 47s), it just wasn't kept (test data, deleted after verification). `league_entries` for `league_id=314` is back to 0 rows as of 2026-08-30. Blocks only Sprint 10's top-1k sample — the exact mini-league slice has its own page now, `/leagues`, see [ownership-and-leagues.md](ownership-and-leagues.md) | [roadmap.md](../roadmap.md) |
| Accuracy scoreboard panel (`/status`) | `player_prediction_archive` exists and archives a gameweek's snapshot before its deadline, but held ≤1 archived gameweek at last check — a panel built on one gameweek's residual would invite reading it as a verdict on the model. The data layer (`lib/prediction-accuracy.ts`) is done; the UI ships once ≥2 gameweeks are archived | [data-pipeline.md](data-pipeline.md) |
| Automated FPL credential login | PingOne offers no password grant; the one reachable flow opens with bot detection | [fpl-authentication.md](fpl-authentication.md) |
| `positionCalibration` | Fitted **in-sample**; needs a refit against real 2026/27 results before any accuracy claim is trusted. Walk-forward evidence for why now exists: out-of-sample the model underperforms a naive last-5-gameweeks baseline in every season tested | [xp-model.md](xp-model.md#out-of-sample-validation-sprint-17a) |
| Cold-start, remaining 66 players + `dc90` for all 33 covered | No fittable source exists yet (overseas/academy players; no PL-side CBIT data for 2024/25) | [cold-start-priors.md](cold-start-priors.md) |
| Club tactical `μ_fit` multiplier | Modifiers are transcribed opinion, not measured data; needs a real per-player role source and a backtest | [club-tactical-profiles.md](club-tactical-profiles.md) |
| New-manager uncertainty discount (GW1-3 xP penalty) | `pl_managers` carries no start date, appointment date, or tenure field — nothing in this app can say which club has a first-season manager. Would also need the same backtest bar `μ_fit` is held to before touching xP. Now measurable in principle once a tenure source exists — Sprint 17a's backfilled per-gameweek data could test it directly | [club-tactical-profiles.md](club-tactical-profiles.md), [sprint-18.md](../sprints/sprint-18.md) |
| Manager behavioural history (transfers, captains, chips) | FPL API exposes none for past seasons; `manager_picks` FKs to the current season only | [manager-profile.md](manager-profile.md), [database-and-rls.md](database-and-rls.md#season-rollover-trap) |

## Distinguishing "blocked" from "not started"

Sprint 15 (Action Layer) is **not started but not blocked** in the same sense as the table above —
it's sequenced after a prerequisite sprint, not stuck on a missing data source. Sprint 13 (Live
Matchday Hub) was in that category until the GW1 deadline it was sequenced after actually arrived
(2026-08-21) — it's built now, see [deadline-and-matchday.md](deadline-and-matchday.md). Sprint 17
(Historical Analytics & ML) additionally needs `positionCalibration` refit against real results
first. See [roadmap.md](../roadmap.md#next-up) for the live sequencing.

## The pattern: disclose, don't hide

A blocked feature is shown as blocked with its reason, never silently omitted — "a blocked option
that vanishes reads as a bug; its reason is information." See
[methodology.md](methodology.md#a-blocked-option-that-vanishes-reads-as-a-bug-its-reason-is-information).
