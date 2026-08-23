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
| 2026-08-20 | Rivals fixes & card density — `/team` rivals sync before writing and gained a This season / Career tab; `CollapsibleCard` primitive repacks `/deadline`, `/transfers`, `/chips` | [manager-profile.md](manager-profile.md), [design-system.md](design-system.md#packing-not-just-ranking-2026-08-20) |
| 2026-08-21 | GW1 deadline (17:30 UTC) and first kickoff — Sprint 13 (Live Matchday Hub) built and verified live on `/deadline`; Sprint 10's mini-league EO exact slice built (`sync-league-picks`, `lib/ownership.ts`); `sync-fixtures`' hourly cron lag found and fixed same day | [deadline-and-matchday.md](deadline-and-matchday.md), [ownership-and-leagues.md](ownership-and-leagues.md), [data-pipeline.md](data-pipeline.md#sync-fixtures-self-gated-cadence-fixed-2026-08-21) |
| 2026-08-21 (evening) | GW1 live-hub follow-ups from real use — live fixture event detail + `/fixtures` collapse fix + My Team link; player detail panel gained a live points breakdown, season stats, and recent form; news feed duplicates fixed (46% of rows) | [deadline-and-matchday.md](deadline-and-matchday.md#live-fixture-event-detail-and-the-fixtures-collapse-fix--built-2026-08-21-same-evening), [frontend-conventions.md](frontend-conventions.md#player-detail-panel-live-breakdown-season-stats-and-recent-form), [news-feed.md](news-feed.md#gotchas-hit-building-this) |
| 2026-08-22 | Expandable-card row-stretch bug found and fixed (`self-start` alongside the flex `w-[calc(...)]` basis) on `LiveFixtureCard`/`ClubTacticsGrid`; the xP model's current-season-form gap fully traced and written up as a gated, unbuilt proposal | [design-system.md](design-system.md#expandable-card-stretch-2026-08-22), [xp-model.md](xp-model.md#known-disclosed-gaps) |
| 2026-08-22 | Response to an external design audit — sticky app-wide `ContextBar`, current-season xG/xA + `xMins` on `/players`, nine hover-only tooltips migrated to the new `TapToReveal` primitive, focus rings closed on the six pages Sprint 19 didn't reach, `/transfers`/`/compare` mobile-layout bugs fixed; most of the audit's own findings verified false | [design-audit-response.md](../sprints/design-audit-response.md), [design-system.md](design-system.md#taptoreveal-added-2026-08-22-the-same-primitive-an-arbitrary-trigger), [methodology.md](methodology.md#verify-an-external-claim-before-implementing-it) |

| 2026-08-22 | Mobile one-handed reachability, prompted by the owner's phone screenshot — split `NavLinks` into `DesktopNav`/`MobileNav` and moved the mobile trigger off a two-`ml-auto` float to the header's left edge; replaced the nav dropdown with a bottom sheet; fixed a real "FT 15" bug (`freeTransfersDisplay`) and made free transfers persist across `/deadline`/`/transfers`/`/team`; extended `TapToReveal`'s tap-target floor and gave `InfoTooltip` a flip-up | [mobile-reachability.md](../sprints/mobile-reachability.md), [design-system.md](design-system.md#bottom-sheet-added-2026-08-22-a-third-disclosure-shape-and-a-tap-target-floor), [frontend-conventions.md](frontend-conventions.md#navlinks-split-into-desktopnavmobilenav-2026-08-22) |

See also: [blocked-and-data-gaps.md](blocked-and-data-gaps.md) for what's still waiting and why.
