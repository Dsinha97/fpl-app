# Blocked, with reasons

The single answer to "why isn't X built yet." Everything here is blocked on a real, checked
constraint — not merely unscheduled. See [roadmap.md](../roadmap.md#blocked-with-reasons) for the
live index this page expands on.

| Blocked | Reason | Detail |
|---|---|---|
| Team strength (0 for all 20 clubs) | Pre-season placeholder; blocks custom FDR and any TeamAttack term | [fpl-api-constraints.md](fpl-api-constraints.md), [risk-scoring.md](risk-scoring.md) |
| League 314 standings (empty) | Pre-season; blocks all of Sprint 10 (Ownership Intelligence — EO, differentials, template) | [roadmap.md](../roadmap.md) |
| `sync-live-gameweek` write path | Never executed — no live fixture yet | [deadline-and-matchday.md](deadline-and-matchday.md) |
| Automated FPL credential login | PingOne offers no password grant; the one reachable flow opens with bot detection | [fpl-authentication.md](fpl-authentication.md) |
| `positionCalibration` | Fitted **in-sample**; needs a refit against real 2026/27 results before any accuracy claim is trusted | [xp-model.md](xp-model.md) |
| Cold-start, remaining 66 players + `dc90` for all 33 covered | No fittable source exists yet (overseas/academy players; no PL-side CBIT data for 2024/25) | [cold-start-priors.md](cold-start-priors.md) |
| Club tactical `μ_fit` multiplier | Modifiers are transcribed opinion, not measured data; needs a real per-player role source and a backtest | [club-tactical-profiles.md](club-tactical-profiles.md) |
| New-manager uncertainty discount (GW1-3 xP penalty) | `pl_managers` carries no start date, appointment date, or tenure field — nothing in this app can say which club has a first-season manager. Would also need the same backtest bar `μ_fit` is held to before touching xP | [xp-model.md](xp-model.md) |
| Manager behavioural history (transfers, captains, chips) | FPL API exposes none for past seasons; `manager_picks` FKs to the current season only | [manager-profile.md](manager-profile.md), [database-and-rls.md](database-and-rls.md#season-rollover-trap) |

## Distinguishing "blocked" from "not started"

Sprint 13 (Live Matchday Hub) and Sprint 15 (Action Layer) are **not started but not blocked** in
the same sense — they're sequenced after a real-world event (GW1) or a prerequisite sprint, not
stuck on a missing data source. Sprint 17 (Historical Analytics & ML) additionally needs
`positionCalibration` refit against real results first. See [roadmap.md](../roadmap.md#next-up) for
the live sequencing.

## The pattern: disclose, don't hide

A blocked feature is shown as blocked with its reason, never silently omitted — "a blocked option
that vanishes reads as a bug; its reason is information." See
[methodology.md](methodology.md#a-blocked-option-that-vanishes-reads-as-a-bug-its-reason-is-information).
