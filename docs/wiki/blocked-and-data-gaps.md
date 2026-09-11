# Blocked, with reasons

The single answer to "why isn't X built yet." Everything here is blocked on a real, checked
constraint — not merely unscheduled. See [roadmap.md](../roadmap.md#blocked-with-reasons) for the
live index this page expands on.

| Blocked | Reason | Detail |
|---|---|---|
| ~~Team strength (0 for all 20 clubs)~~ ~~**Custom FDR**~~ **Built twice, neither shipped (2026-09-06)** | No longer a data blocker in either direction. A *strength*-derived FDR shipped display-only in Sprint 31 and is **permanently unbacktestable** (`teams` holds one season, no history). A *results*-derived FDR (Sprint 35) is backtestable, beats a neutral baseline in all four seasons with a scrambling control, and is unshipped for a different reason: **the baseline it beat is not the baseline production uses.** Derived-vs-official is the untested comparison, and becomes testable on 2026-27 from ~GW10 | [fixture-difficulty.md](fixture-difficulty.md) |
| `TeamAttackStrength` term (still blocked) | The attack/defence split is the half that never populated — `strength_attack_*` and `strength_defence_*` are still `0` for all 20 clubs in-season, and `strength` is still `NULL`. This is what `CAPTAIN_MODEL_NOTE` and the xP fixture term actually need | [fpl-api-constraints.md](fpl-api-constraints.md), [risk-scoring.md](risk-scoring.md), [lineup-captain-bench.md](lineup-captain-bench.md) |
| ~~League 314 rank-ordering (top-1k sample)~~ **Unblocked 2026-09-10** | The sample exists and is **kept** this time: `league_entries` for `league_id=314` holds **2,000 rows and 30,795 picks**, after a signed-in `/leagues` sync. The 2026-08-30 load-test rows really had been deleted — confirmed twice, once directly (0 rows as of 2026-09-10) and once independently, when 8 of the owner's 13 leagues came back with no stored standings, 314 among them. What remains is consuming it: the field-wide EO slice the risk formula wants is now a build, not a blocker | [ownership-and-leagues.md](ownership-and-leagues.md) |
| ~~Accuracy scoreboard panel~~ **Shipped 2026-09-06** | Unblocked on its own stated condition with no judgement call: GW3 finishing took the *archived* ∩ *scored* intersection from n=1 to n=2. Now on `/settings` → Pipeline, reporting n=1,272 residuals over GW2+GW3 — bias −0.248, MAE 1.392, r 0.460, framed as a running count rather than a verdict | [xp-model.md](xp-model.md#the-accuracy-scoreboard-shipped-2026-09-06) |
| Automated FPL credential login | PingOne offers no password grant; the one reachable flow opens with bot detection | [fpl-authentication.md](fpl-authentication.md) |
| `positionCalibration` | Fitted **in-sample**; needs a refit against real 2026/27 results before any accuracy claim is trusted. Walk-forward evidence for why now exists: out-of-sample the model underperforms a naive last-5-gameweeks baseline in every season tested. **The gate is now dated rather than vague** — the shipped factors were fitted on a 209-player full-season cohort, so refitting on three gameweeks' ~1,200 player-fixtures would bake this season's noise into a permanent constant. Wait for ~GW10-12, which is also when the last-5 baseline starts producing rows for 2026-27. The −0.248 production bias measured 2026-09-06 is partly these factors being wrong for this season | [xp-model.md](xp-model.md#the-accuracy-scoreboard-shipped-2026-09-06) |
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
