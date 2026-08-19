# Timeline

A chronological pointer into `sprints/`, for "what shipped when" — not a copy of the sprint files
themselves. See [roadmap.md](../roadmap.md) for the authoritative status table.

| Date | What | Detail |
|---|---|---|
| 2026-08-02 | Phase 1–4 built: data ingestion, xP model v1.0.0 | [xp-model.md](xp-model.md) |
| 2026-08-03 | Dependency advisories cleared, hosting follow-ups begin | [sprints/additional-info.md](../sprints/additional-info.md) |
| 2026-08-04 | Cold-start problem measured (187/567 players with no projection) | [cold-start-priors.md](cold-start-priors.md) |
| 2026-08-05 | Cold-start phase 1 shipped (empirical-Bayes shrinkage); a candidate data drop rejected (95% synthetic) | [cold-start-priors.md](cold-start-priors.md) |
| 2026-08-05 | Squad reconciliation phase 1 (v1.2.0) — water-fill for start/minute consistency | [xp-model.md](xp-model.md#squad-reconciliation) |
| 2026-08-06 | Prediction window extended past 8 GWs; CSP added; dependency fixes; Sprint 7/9 gaps closed | [sprints/additional-info.md](../sprints/additional-info.md) |
| 2026-08-06 | Sprint 12 (Chip Strategy Engine) built | [chip-strategy.md](chip-strategy.md) |
| 2026-08-07 | Sprint 12A (Manager Percentile Profile), 12.5 (Club Tactical Profiles), squad reconciliation phase 2 (v1.3.0) | [manager-profile.md](manager-profile.md), [club-tactical-profiles.md](club-tactical-profiles.md) |
| 2026-08-08 | Sprint 12.6 — `dc90` deflation bug fixed, xP engine v1.4.0, five surface fixes | [xp-model.md](xp-model.md#calibration) |
| 2026-08-09 | FPL login probed and closed as blocked; Sprint 14 (Auth & Team Sync) built; Sprint 13 groundwork staged | [fpl-authentication.md](fpl-authentication.md), [deadline-and-matchday.md](deadline-and-matchday.md) |
| 2026-08-09 | Sprint 14.1 — Google sign-in added after magic-link rate limit hit | [fpl-authentication.md](fpl-authentication.md) |
| 2026-08-09 | Sprint 14.2 — session-cookie handoff disproven; paste-the-JSON import shipped instead | [fpl-authentication.md](fpl-authentication.md) |
| 2026-08-10 | Sprint 14.3 — signed-in RLS bug fixed, account menu, `/settings` | [database-and-rls.md](database-and-rls.md) |
| 2026-08-10 | Sprint 14.4 — import instructions fixed (told users to hit a 401) | [fpl-authentication.md](fpl-authentication.md) |
| 2026-08-11 | Sprint 15.5 (Hidden Gems) and 15.6 (Championship cold-start priors, xP engine v1.5.0) built | [hidden-gems.md](hidden-gems.md), [cold-start-priors.md](cold-start-priors.md) |
| 2026-08-14 | Deadline Hub built | [deadline-and-matchday.md](deadline-and-matchday.md) |
| 2026-08-15 | Squad view on Deadline Hub and My Team — both default to the imported FPL squad on a read-only pitch, plus a Current squad / Gameweek result switch on `/team` | [deadline-and-matchday.md](deadline-and-matchday.md) |
| 2026-08-16 | Chip strategy planning built — pin a chip to a gameweek, chip-aware deadline optimiser, bounded forward transfer path | [chip-plan.md](chip-plan.md) |
| 2026-08-18 | Sprint 17a — walk-forward model validation; found the xP model underperforms a naive last-5-gameweeks baseline out-of-sample | [xp-model.md](xp-model.md#out-of-sample-validation-sprint-17a) |
| 2026-08-19 | Sprint 18 — Effective Starting XI budget, a chip-sequencing bug fix + calendar-derived presets, transfer reversibility | [lineup-captain-bench.md](lineup-captain-bench.md#bench-cost-sprint-18), [chip-plan.md](chip-plan.md) |
| 2026-08-19/20 | Sprint 19 — Design System & Interaction Feedback: fixed Geist Sans never applying, adopted focus-visible states, stopped the transfer/chip optimiser freeze, ranked the cards on `/deadline`/`/transfers`/`/chips`, promoted xP to the dominant number in the player detail panel | [design-system.md](design-system.md) |
| 2026-08-21 (upcoming) | GW1 deadline — unblocks Sprint 13's dry-run checklist | [deadline-and-matchday.md](deadline-and-matchday.md) |

See also: [blocked-and-data-gaps.md](blocked-and-data-gaps.md) for what's still waiting and why.
