# Documentation index

One screen, every doc. Status column: **live** (current reference, keep it accurate),
**source-spec** (owner's original plan, kept unedited — a banner at the top says what
shipped and where), **historical** (a finished build record, not actively maintained), or
**data asset** (not prose — a seed fixture or reference dataset).

## Start here

| Doc | Status | What it is |
|---|---|---|
| [roadmap.md](roadmap.md) | live | **Authoritative sprint plan.** Sprint index, next up, blocked items, live cross-cutting decisions. Start here for "what's next" or "what shipped when". |
| [architecture.md](architecture.md) | live | Data flow, schema, Edge Functions, routes table, `lib/` module map. |
| [phase-4-model.md](phase-4-model.md) | live | The xP model's method, calibration and backtest. |
| [wiki/index.md](wiki/index.md) | live | **Topic map.** One page per engine/feature/platform concern, cross-linked and source-attributed — organised by *what*, not *when*. Start here for "how does X work" or "why is X blocked". |

## Sprint history

`sprints/` holds one file per sprint (or per non-sprint work item), moved out of `roadmap.md` so it
stays scannable. Sub-versions (12A, 12.5, 12.6, 14.1–14.4) are sections inside their parent sprint's
file, not separate files.

| Doc | Status | What it is |
|---|---|---|
| [sprints/sprint-05.md](sprints/sprint-05.md) | historical | Scenario Lab & Draft Management. |
| [sprints/sprint-08.md](sprints/sprint-08.md) | historical | Transfer Simulator. |
| [sprints/sprint-09.md](sprints/sprint-09.md) | historical | Transfer Optimizer. |
| [sprints/sprint-10.md](sprints/sprint-10.md) | live (blocked) | Ownership Intelligence — not built; the build plan for when league 314 unblocks. |
| [sprints/sprint-12.md](sprints/sprint-12.md) | historical | Chip Strategy Engine + §12A (Manager Percentile Profile) + §12.5 (PL Team Manager Intelligence) + §12.6 (Defensive Contribution fix). |
| [sprints/sprint-13.md](sprints/sprint-13.md) | live (staged) | Live Matchday Hub — not built; the GW1 dry-run checklist. |
| [sprints/sprint-14.md](sprints/sprint-14.md) | historical | Authentication & Team Sync + §14.1–§14.4 + the FPL-login probe. |
| [sprints/cold-start-patch.md](sprints/cold-start-patch.md) | mixed | Phase 1 (empirical-Bayes rate priors) historical; phase 2 (external-league enrichment) partially delivered by Sprint 15.6, rest deferred/gated, findings still current. |
| [sprints/hidden-gems.md](sprints/hidden-gems.md) | historical | Sprint 15.5 — value-discovery archetype filter (`player_rate_profile`, `lib/hidden-gems.ts`); also records why `worldfootballR` doesn't help cold-start. |
| [sprints/championship-priors.md](sprints/championship-priors.md) | historical | Sprint 15.6 — 33 zero-PL-minute players re-primed from real Championship stats, xP engine v1.5.0. |
| [sprints/squad-reconciliation.md](sprints/squad-reconciliation.md) | historical | Start/minutes water-fill, phases 1 (v1.2.0) and 2 (v1.3.0). |
| [sprints/additional-info.md](sprints/additional-info.md) | historical | Ops log: hosting follow-ups, dependency advisories, small queued items. |
| [sprints/sprint-17a.md](sprints/sprint-17a.md) | live | Walk-forward model validation — found the xP model underperforms a naive last-5-gameweeks baseline out-of-sample. |
| [sprints/sprint-18.md](sprints/sprint-18.md) | live | Effective Starting XI budget, a chip-sequencing bug fix + calendar-derived presets, transfer reversibility. |

## Source specs

Owner-authored plans, kept unedited. Each carries a banner at the top recording what shipped, what
was superseded, and what remains live reference for work that's data-blocked rather than abandoned.
Do not edit the body — add reconciliation notes to the banner, or to the sprint file that built the
buildable slice.

| Doc | Status | What it is |
|---|---|---|
| [sources/update-aug3.md](sources/update-aug3.md) | source-spec | The owner's revised feature set. `roadmap.md`'s numbering is reconciled against this. |
| [sources/updated-plan.md](sources/updated-plan.md) | source-spec | Formula and method reference (Parts 1–3 live; Part 4's roadmap superseded by `roadmap.md`). |
| [sources/cold-start-patch-plan.md](sources/cold-start-patch-plan.md) | source-spec | Cold-start design doc. §4–14/§30–40 remain live reference for phase 2; the rest is superseded, with reasons in the banner. |
| [sources/manager_intelligence_sprint12_change_plan.md](sources/manager_intelligence_sprint12_change_plan.md) | source-spec | Manager Intelligence & Rank Normalization plan. Sprint 12A is the executable subset; §8–10 are blocked, not deferred — see the banner. |
| [sources/PL_Team_Manager_Intelligence_Patch_Plan.md](sources/PL_Team_Manager_Intelligence_Patch_Plan.md) | source-spec | PL club tactical-profile plan. Sprint 12.5 is the buildable slice; phases 3–6 blocked on validation — see the banner. |
| [sources/phase-1-plan.md](sources/phase-1-plan.md) | historical | Completed data-ingestion build plan, marked complete 2026-08-02. §1 (observed API state) and §7 (decisions taken) are durable reference. |
| [sources/fpl_app_phase_wise_build_plan.md](sources/fpl_app_phase_wise_build_plan.md) | source-spec | The original architecture document Phases 0–4 were built from. Superseded by `roadmap.md`; kept for provenance, linked into by `phase-1-plan.md` and `phase-4-model.md`. |

## Data assets

Not prose — filed in `docs/` because that's where they're consumed from, not because they're
documentation.

| Asset | What it is |
|---|---|
| [pl-manager-profiles.json](pl-manager-profiles.json) | 20 PL club tactical profiles, seeded into `pl_managers` by a migration (Sprint 12.5). |
| `Promoted Team Data/` | Raw scouting PDFs/CSVs for promoted clubs, gitignored (see `.gitignore` for why one candidate CSV was rejected — findings in [sprints/cold-start-patch.md](sprints/cold-start-patch.md)). `Promoted Team Data/extracted/` (tracked, not gitignored) holds the derived, auditable output of `scripts/extract-footystats.ts` — see [sprints/championship-priors.md](sprints/championship-priors.md). |
| `API-Football - Documentation.pdf` | Third-party API docs, gitignored, referenced in the cold-start phase 2 findings. |
