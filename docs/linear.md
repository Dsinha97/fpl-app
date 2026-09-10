# Linear ↔ docs

The join between this repo and the Linear project. **[FPL-App](https://linear.app/dsinha-org/project/fpl-app-83aaf6f4e868)**,
team `Dsinha Org` (`DSI`). Any issue's URL is `https://linear.app/dsinha-org/issue/<id>`.

**Linear owns what is planned and what its status is** — priority, milestone, backlog order,
open/done. **`docs/` owns what happened and why** — the sprint files, the gates, the measured
results, the null findings. Neither restates the other: a Linear issue links its doc rather than
copying a gate into a second place where it can rot.

Project-level context also lives in Linear as
[Architecture & standing decisions](https://linear.app/dsinha-org/document/architecture-and-standing-decisions-a611e920765e),
a reader's summary of [architecture.md](architecture.md) and [roadmap.md](roadmap.md)'s
"Decisions that still bind". Where that page and this repo disagree, the repo wins.

## Milestones

| Milestone | Target | Covers |
|---|---|---|
| M1 · Core engines | 2026-08-08 | Sprints 5–12.6, cold-start phase 1, squad reconciliation |
| M2 · Season launch | 2026-08-21 | Deadline Hub, 13, 14, 10, 15.5/15.6/15.8, 17a, 18, 20, 21 |
| M3 · Design, density & navigation | 2026-08-27 | 19, 22–26, three owner-prompted polish passes, latency |
| M4 · In-season correction | 2026-09-05 | 27, 28, 29, 30, 31, 33 |
| M5 · Platform hardening & model validation | 2026-09-06 | 32, 34, 35 |
| M6 · GW5 check-in | 2026-09-21 | One cheap look after GW5 is scored |
| M7 · GW10 model batch | 2026-11-09 | The three model questions that share one harness run |
| M8 · Beyond this season | — | Sprints 15–17, platform follow-ups, blocked-on-data items |

## Shipped

| Sprint / item | Issue | Milestone | Sprint doc |
|---|---|---|---|
| 5 Scenario Lab & Draft Management | DSI-5 | M1 | [sprints/sprint-05.md](sprints/sprint-05.md) |
| 6 Player Comparison Engine | DSI-6 | M1 | — (roadmap index) |
| 7 Replacement Finder | DSI-7 | M1 | — (roadmap index) |
| 8 Transfer Simulator | DSI-8 | M1 | [sprints/sprint-08.md](sprints/sprint-08.md) |
| 9 Transfer Optimizer | DSI-9 | M1 | [sprints/sprint-09.md](sprints/sprint-09.md) |
| 11 Captain & Bench Optimizer | DSI-10 | M1 | — (roadmap index) |
| 12A Manager Percentile Profile | DSI-11 | M1 | [sprints/sprint-12.md](sprints/sprint-12.md) §12A |
| 12 Chip Strategy Engine | DSI-12 | M1 | [sprints/sprint-12.md](sprints/sprint-12.md) |
| 12.5 PL club manager intelligence | DSI-13 | M1 | [sprints/sprint-12.md](sprints/sprint-12.md) §12.5 |
| 12.6 Defensive Contribution fix | DSI-14 | M1 | [sprints/sprint-12.md](sprints/sprint-12.md) §12.6 |
| Cold-start patch phase 1 | DSI-15 | M1 | [sprints/cold-start-patch.md](sprints/cold-start-patch.md) |
| Squad reconciliation (water-fill) | DSI-16 | M1 | [sprints/squad-reconciliation.md](sprints/squad-reconciliation.md) |
| Deadline Hub | DSI-17 | M2 | [sprints/additional-info.md](sprints/additional-info.md) |
| Squad view on `/deadline` + `/team` | DSI-18 | M2 | [sprints/additional-info.md](sprints/additional-info.md) |
| Chip strategy planning | DSI-19 | M2 | [wiki/chip-plan.md](wiki/chip-plan.md) |
| 15.5 Hidden Gems | DSI-20 | M2 | [sprints/hidden-gems.md](sprints/hidden-gems.md) |
| 15.6 Championship cold-start priors | DSI-21 | M2 | [sprints/championship-priors.md](sprints/championship-priors.md) |
| 15.8 Gameweek planning & filters | DSI-22 | M2 | — (roadmap index) |
| 13 Live Matchday Hub | DSI-23 | M2 | [sprints/sprint-13.md](sprints/sprint-13.md) |
| 10 Ownership Intelligence | DSI-24 | M2 | [sprints/sprint-10.md](sprints/sprint-10.md) |
| GW1 live-hub follow-ups | DSI-25 | M2 | [sprints/additional-info.md](sprints/additional-info.md) |
| 14 Authentication & Team Sync | DSI-26 | M2 | [sprints/sprint-14.md](sprints/sprint-14.md) |
| 17a Model validation (walk-forward) | DSI-27 | M2 | [sprints/sprint-17a.md](sprints/sprint-17a.md) |
| 18 Squad structure & chip sequencing | DSI-28 | M2 | [sprints/sprint-18.md](sprints/sprint-18.md) |
| 20 RSS news ingestion | DSI-29 | M2 | [sprints/sprint-20.md](sprints/sprint-20.md) |
| 21 Squad-view fix, leagues, FDR, table | DSI-30 | M2 | [sprints/sprint-21.md](sprints/sprint-21.md) |
| 19 Design system & interaction | DSI-31 | M3 | [sprints/sprint-19.md](sprints/sprint-19.md) |
| Rivals fixes & card density | DSI-32 | M3 | [sprints/rivals-and-card-density.md](sprints/rivals-and-card-density.md) |
| AI design-audit response | DSI-33 | M3 | [sprints/design-audit-response.md](sprints/design-audit-response.md) |
| Mobile one-handed reachability | DSI-34 | M3 | [sprints/mobile-reachability.md](sprints/mobile-reachability.md) |
| 22 Navigation & shell | DSI-35 | M3 | [sprints/sprint-22.md](sprints/sprint-22.md) |
| 23 Page density | DSI-36 | M3 | [sprints/sprint-23.md](sprints/sprint-23.md) |
| 24 Expand/collapse polish | DSI-37 | M3 | [sprints/sprint-24.md](sprints/sprint-24.md) |
| 25 Domain cutover + defect sweep | DSI-38 | M3 | [sprints/sprint-25.md](sprints/sprint-25.md) |
| 26 Casual-user on-ramps + staging | DSI-39 | M3 | [sprints/sprint-26.md](sprints/sprint-26.md) |
| Latency baseline and its three fixes | DSI-40 | M3 | [sprints/latency.md](sprints/latency.md) |
| 27 Post-GW1 reckoning | DSI-41 | M4 | [sprints/sprint-27.md](sprints/sprint-27.md) |
| 28 Live/upcoming split, one answer | DSI-42 | M4 | [sprints/sprint-28.md](sprints/sprint-28.md) |
| 29 Price sampling, EO, ledger | DSI-43 | M4 | [sprints/sprint-29.md](sprints/sprint-29.md) |
| 30 Form-blend 2 + money bug chain | DSI-44 | M4 | [sprints/sprint-30.md](sprints/sprint-30.md) |
| 31 Chip awareness, FDR, pre-flight | DSI-45 | M4 | [sprints/sprint-31.md](sprints/sprint-31.md) |
| 33 Four page merges | DSI-46 | M4 | [sprints/sprint-33.md](sprints/sprint-33.md) |
| 32 Edge Function lockdown | DSI-47 | M5 | [sprints/sprint-32.md](sprints/sprint-32.md) |
| 34 Post-GW3 scoreboard + harness fixes | DSI-48 | M5 | [sprints/sprint-34.md](sprints/sprint-34.md) |
| 35 Results-derived FDR (not shipped) | DSI-49 | M5 | [sprints/sprint-35.md](sprints/sprint-35.md) |

## In flight

| Issue | Item | Milestone | Doc |
|---|---|---|---|
| DSI-74 | **Sprint 36** — decision analytics, a two-way Telegram bot, the Todo sweep | M8 | [sprints/sprint-36.md](sprints/sprint-36.md) |

Sprint 36 took the whole Todo column, so DSI-66, DSI-65, DSI-61, DSI-60, DSI-59 and DSI-58 are all
In Progress under it and stay in the Open table below until they close.

## Open

| Issue | Item | Milestone | Gate / blocker |
|---|---|---|---|
| DSI-50 | GW5 check-in — bias *sign* at n=4 | M6 | GW5 scored (~2026-09-21). A look, not a decision |
| DSI-51 | Re-run the current-season blend sweep | M7 | GW10 scored. `scope=all` and `scope=minutes` each clear 2 of 4 seasons today |
| DSI-52 | Derived FDR vs **official** FDR | M7 | GW10 scored. Sprint 35 measured vs *neutral* only; n=471 at GW3 was far too thin |
| DSI-53 | Refit `positionCalibration` | M7 | Conditional on DSI-50's sign holding. Current factors are fitted in-sample |
| DSI-54 | Price-change prediction step 3 | M7 | Enough watchlist history; must beat top-N-by-net-transfers on precision/recall |
| DSI-55 | Flip the repo public + post-flip hardening | M8 | Owner decision. Steps 3–4 are impossible while private (GitHub 422s both) |
| DSI-56 | Latency — route-level code splitting | M8 | None. `next/dynamic` is unused; every route ships ~1.1 MB JS |
| DSI-57 | Latency — serial-waterfall page reads | M8 | None. `/players`, `/transfers`, `/team` |
| DSI-58 | Custom SMTP for Supabase Auth | M8 | Unblocked by owning the domain; Google OAuth stays primary, so not urgent |
| DSI-59 | Sprint 32 leftovers | M8 | Deliberate gaps: `verify_jwt` posture, `scratch-path-test`, the unproven 429 |
| DSI-60 | Top-1k ownership sample, kept for real | M8 | None — pipeline proven at full scale 2026-08-30; nobody has run and kept it |
| DSI-61 | Rivals auto-populated from standings | M8 | None |
| DSI-62 | Sprint 6 gap — EO column on `/players` | M8 | None — Sprint 10's engine exists. Opportunistic |
| DSI-63 | Cloudflare Access gating | M8 | Weigh against `/settings` → Pipeline being deliberately public |
| DSI-64 | Sprint 15 — Action Layer | M8 | Shaped by the FPL-login finding; read it before scoping |
| DSI-65 | Sprint 16 — Notifications & Automation | M8 | None; the signals already exist unused |
| DSI-66 | Sprint 17 part 1 — historical decision analytics | M8 | None. Descriptive only; reuses `/review`'s primitives |
| DSI-73 | Sprint 17 part 2 — predictive models | M8 | Blocked by DSI-53. Accuracy claims inherit an in-sample calibration |
| DSI-67 | Blocked — `TeamAttackStrength` | M8 | `strength_*` is 0 for all 20 clubs in-season too (checked 2026-09-02) |
| DSI-68 | Blocked — cold-start phase 2 remainder | M8 | 66 overseas/academy players and `dc90` have no fittable source |
| DSI-69 | Blocked — new-manager discount | M8 | `pl_managers` has no tenure/start-date field |
| DSI-70 | Blocked — Sprint 12.5 phases 3–6 | M8 | Manager-side thresholds are transcribed opinion, not measured data |
| DSI-71 | Blocked — manager behavioural history | M8 | The FPL API exposes none for past seasons |
| DSI-72 | Blocked — automated FPL login | M8 | Superseded, not pending. PingOne offers no password grant |

## How to keep it true

- **New work starts as a Linear issue**, not as a line in `roadmap.md`. The dashboard is where
  priority and order are set.
- **A sprint starts from the Todo column.** `/start-sprint` reads it, reads each candidate's
  comments *and* its gate, and on approval writes the sprint into existence — parent issue,
  statuses, sprint doc, roadmap row. `/linear-sync` reconciles; `/start-sprint` starts. An issue's
  **comments can outrank its description** — that is where DSI-65 turned from a notifier into a
  two-way bot.
- **A shipped sprint closes its issue** and gains a row in the Shipped table above, alongside its
  entry in `roadmap.md`.
- **An issue with no row here, and a doc item with no issue, are both drift.** `/linear-sync`
  reports both directions; it does not silently fix either.
- **Don't copy a gate into Linear.** Link the doc that states it — the gate has exactly one home,
  and it isn't here.
