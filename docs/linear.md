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
| M8 · Beyond this season | — | Sprint 36 (shipped 2026-09-10), Sprint 15, platform follow-ups, blocked-on-data items |
| M9 · Design audit | 2026-09-13 | Sprints A/B/C1/C2 across every screen, plus DSI-139 and DSI-140 found in flight |

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
| 36 Decision analytics, Telegram bot, Todo sweep | DSI-74 | M8 | [sprints/sprint-36.md](sprints/sprint-36.md) |
| M9 A Design foundations (primitives + tokens) | DSI-134 | M9 | [sprints/m9.md](sprints/m9.md) |
| M9 B Global sweeps | DSI-135 | M9 | [sprints/m9.md](sprints/m9.md) |
| M9 B Pick-one controls on SegmentedControl | DSI-138 | M9 | [sprints/m9.md](sprints/m9.md) |
| M9 C1 Per-screen visual work | DSI-136 | M9 | [sprints/m9.md](sprints/m9.md) |
| M9 C2 Feature-shaped audit items | DSI-137 | M9 | [sprints/m9.md](sprints/m9.md) |
| Design audit, per screen | DSI-118 … DSI-129 | M9 | [sprints/m9.md](sprints/m9.md) |
| draft_snapshots sync hits a missing UPDATE policy | DSI-139 | M9 | [sprints/m9.md](sprints/m9.md) — both halves, the surface closed by DSI-141 |
| Long methodology explainers render inline | DSI-140 | M9 | [sprints/m9.md](sprints/m9.md) |
| Mobile defects found testing M9, and M9's two parked items | DSI-141 | M9 | [sprints/m9.md](sprints/m9.md) |
| 37 M9 design-audit Todo sweep — interface, writing, animation | DSI-176 (+ DSI-144…156) | M9 | [sprints/sprint-37.md](sprints/sprint-37.md) |
| 38 Player profile, price reading, shortlist | DSI-180 (+ DSI-179) | M7 | [sprints/sprint-38.md](sprints/sprint-38.md) |
| Fix: xDC — the UI hid forwards' DC column (the model was never wrong) | DSI-179 | M7 | [sprints/sprint-38.md](sprints/sprint-38.md) §4 |
| Fix: price threshold now scales with ownership (falls) and is re-levelled (rises) | DSI-180 | M7 | [sprints/sprint-38.md](sprints/sprint-38.md) §2c, §2e, §2f |
| Fix: price verdict ladder describes position, not "tonight" (crossing is ~10% predictive) | DSI-180 | M7 | [sprints/sprint-38.md](sprints/sprint-38.md) §2d |
| Fix: `loadPriceProgress` read ~2% of its data (1000-row cap, unpaged) since Sprint 29 | DSI-180 | M7 | [sprints/sprint-38.md](sprints/sprint-38.md) §2 |
| Fix: net transfers differenced across gameweek counter resets — sign inverted for 89% of players | DSI-180 | M7 | [sprints/sprint-38.md](sprints/sprint-38.md) §2a |
| 39 Player-profile bug sweep, prediction-pipeline reliability, expected-minutes cohort split | DSI-182 (+ DSI-181, DSI-142, DSI-178) | — | [sprints/sprint-39.md](sprints/sprint-39.md) |
| Fix: 7 Sprint-38 UI bugs — card overflow, tooltip z-index, price watch off /players, crest fallback, # Owned, sort-by-Price-Watch, price-proximity notifications | DSI-181 | — | [sprints/sprint-39.md](sprints/sprint-39.md) |
| Fix: `generate-predictions` 401s — retry on transient RPC error, `sync_runs` row written even on denial | DSI-142 | — | [sprints/sprint-39.md](sprints/sprint-39.md) |
| Expected-minutes cohort split (appeared/no-show, GKP) + start-probability Brier score added to the backtest harness | DSI-178 | M7 | [sprints/sprint-39.md](sprints/sprint-39.md) |
| Swipe-to-dismiss gestures for nav, player card, and compare panel | DSI-183 | M8 | [sprints/swipe-to-dismiss.md](sprints/swipe-to-dismiss.md) |
| GW5 check-in — **run 2026-09-20, issue left In Progress** for a re-read once GW5's bonus confirms | DSI-50 | M6 | [sprints/gw5-check-in.md](sprints/gw5-check-in.md) |
| Accuracy scoreboard counted a half-synced gameweek's zeros as real blanks | — (found in flight, PR [#30](https://github.com/Dsinha97/fpl-app/pull/30)) | M6 | [sprints/gw5-check-in.md](sprints/gw5-check-in.md) §1 |
| `/deadline` transfer cards → one CTA; `/team` ledger full-width; countdowns drop seconds above 24h | — (owner request, same PR) | M6 | [sprints/gw5-check-in.md](sprints/gw5-check-in.md) §4 |
| 17 part 1 Historical decision analytics | DSI-66 | M8 | [sprints/sprint-36.md](sprints/sprint-36.md) §1 |
| Rivals from a league's standings | DSI-61 | M8 | [sprints/sprint-36.md](sprints/sprint-36.md) §2 |
| 16 Notifications — the Telegram bot | DSI-65 | M8 | [sprints/sprint-36.md](sprints/sprint-36.md) §3 |
| Top-1k ownership sample, kept | DSI-60 | M8 | [sprints/sprint-36.md](sprints/sprint-36.md) §4 |
| Custom SMTP for Supabase Auth | DSI-58 | M8 | [sprints/sprint-36.md](sprints/sprint-36.md) §4 |
| Fix: price/news notifications silently dropped, fixture alert wording | DSI-133 | M8 | — |
| Fix: played chips not greyed out in Chip Plan | DSI-117 | M8 | — |
| Fix: Builder player-info panel running off screen | DSI-116 | M8 | — |
| Fork-PR workflow approval confirmed: `approval_policy: all_external_contributors`, read via `gh api …/actions/permissions/fork-pr-contributor-approval` (2026-09-24) | DSI-55 | M8 | [sprints/sprint-40.md](sprints/sprint-40.md) — closed in passing, not sprint work |
| 40 Latency — the shared bundle and the read waterfalls (PR [#36](https://github.com/Dsinha97/fpl-app/pull/36), merged 2026-09-24) | DSI-184 (+ DSI-56, DSI-57, DSI-77) | M8 | [sprints/sprint-40.md](sprints/sprint-40.md) |
| Every route's first-load JS down 135–153 KB: `motion` lazy-loaded, engines out of the root layout | DSI-56 | M8 | [sprints/sprint-40.md](sprints/sprint-40.md) §1 |
| False read dependencies collapsed on `/players`, `/transfers`, `/team` | DSI-57 | M8 | [sprints/sprint-40.md](sprints/sprint-40.md) §2 |
| Dead lint suppressions removed; lint verdict unambiguous | DSI-77 | M8 | [sprints/sprint-40.md](sprints/sprint-40.md) §4 |
| Fix: `notify`'s price-proximity alert read the oldest 1,000 of 4,284 ownership rows (deployed as v7) | — (found in flight, same PR) | M8 | [sprints/sprint-40.md](sprints/sprint-40.md) §3a |
| Scoped MIT licence for the public repo (PR [#38](https://github.com/Dsinha97/fpl-app/pull/38), merged 2026-09-25) | DSI-202 | M8 | `LICENSE`; [wiki/deployment.md](wiki/deployment.md#privacy-note) |
| Search indexing: sitemap, robots.txt, per-route metadata, preview card (PR [#39](https://github.com/Dsinha97/fpl-app/pull/39), merged 2026-09-26) | DSI-203 | M8 | [sprints/seo.md](sprints/seo.md) |

## Open

| Issue | Item | Milestone | Gate / blocker |
|---|---|---|---|
| DSI-50 | GW5 check-in — bias *sign* at n=4. **Re-read 2026-09-21 at locked data; unchanged. In Progress** | M6 | Gate met and read twice. GW5's bonus confirmed and moved nothing — the figures are identical to 2026-09-20 (pooled −0.080, SE 0.044, t=−1.82). Held open for a fifth read at **GW6, 2026-10-10** (three-week international break first). See [sprints/sprint-38.md](sprints/sprint-38.md) §1 |
| DSI-51 | Re-run the current-season blend sweep | M7 | GW10 scored. `scope=all` and `scope=minutes` each clear 2 of 4 seasons today |
| DSI-52 | Derived FDR vs **official** FDR | M7 | GW10 scored. Sprint 35 measured vs *neutral* only; n=471 at GW3 was far too thin |
| DSI-53 | ~~Refit `positionCalibration`~~ — **Canceled in Linear** (2026-09-21): its precondition is answered, and the answer is "don't" | M7 | DSI-50's sign held but the magnitude collapsed to −0.084 (≈1.8 SE from zero), and the residuals are a −0.714 non-appearance cohort cancelling a +0.627 appearance cohort — which a multiplicative points scale cannot separate. Rescoped to **expected-minutes** calibration (and GKP separately, −0.352), tracked as [DSI-178](https://linear.app/dsinha-org/issue/DSI-178), rather than running as originally scoped. See [sprints/gw5-check-in.md](sprints/gw5-check-in.md) §2 |
| DSI-54 | Price-change prediction step 3 — **falls half run 2026-09-21; gate FAILS. Ship the heuristic** | M7 | Walk-forward over 36 nights: no budget shows a significant win (best p=0.18 at K=40). An earlier run of the same gate appeared to pass at K=10/K=20 — that was a broken feature (gameweek-reset differencing) handicapping the baseline, which shares the same input. Corrected, the baseline gains far more than the model. Nothing wired in; `priceProgress` remains the reading. Re-run once more history accumulates **and** the ownership-scaled threshold (sprint-38 §2b) is settled. See [sprints/sprint-38.md](sprints/sprint-38.md) §3 |
| DSI-187 | Latency — the price-watch scan downloads the whole ownership-history table on every `/players` or `/transfers` visit | M8 | None to *start*; the design is open (three candidate shapes in the issue). Gate: identical per-player readings before and after, plus signed-in settle time and request count. The price-watch arithmetic must keep one implementation. Found by Sprint 40; see [sprints/sprint-40.md](sprints/sprint-40.md) §3 |
| DSI-59 | Sprint 32 leftovers — **two of three settled, now In Review** (2026-09-14) | M8 | Residue only: the `verify_jwt` flip is prepped in `config.toml` but **not deployed** (it was bundled with DSI-55, which closed 2026-09-24, so it's now waiting only on DSI-75's deploy), and the 429's HTTP render is unproven. `scratch-path-test` deleted; the 429's counting half proved |
| DSI-62 | Sprint 6 gap — EO column on `/players` | M8 | None — Sprint 10's engine exists. Opportunistic |
| DSI-63 | Cloudflare Access gating | M8 | Weigh against `/settings` → Pipeline being deliberately public |
| DSI-64 | Sprint 15 — Action Layer | M8 | Shaped by the FPL-login finding; read it before scoping |
| DSI-73 | Sprint 17 part 2 — predictive models. **Split 2026-09-24** into DSI-185 and DSI-186 | M8 | A parent only now. Its old gate (DSI-53, the refit) was canceled, and its two halves have different gates, so they became separate issues (below). The DSI-53 blocker has been removed |
| DSI-185 | Expected-minutes model: fix the appeared/no-show discrimination failure (gradient-boosted minutes/injury) | M8 | **Buildable now**, and faces the standing gate: walk-forward vs the last-5 baseline, judged per cohort (`byAppearance`, `gkpByAppearance`) plus `startBrier`, not just pooled. The DSI-178 follow-up. Current-season scoring waits for GW6 (2026-10-10); a meaningful read comes at the GW10 batch |
| DSI-186 | Accuracy claims, only once the model beats the last-5 baseline out-of-sample | M8 | Blocked by DSI-185 (shipped, or reported null). Must then beat the last-5 baseline on 2026-27 on MAE **and** r, pooled **and** per cohort, no earlier than the GW10 batch (~2026-11-09). **DSI-50's bias-sign read is explicitly not a gate:** the pooled bias is ~0 because the cohorts cancel. See [sprints/sprint-17a.md](sprints/sprint-17a.md), [sprints/gw5-check-in.md](sprints/gw5-check-in.md) §2 |
| DSI-67 | Blocked — `TeamAttackStrength` | M8 | `strength_*` is 0 for all 20 clubs in-season too (checked 2026-09-02) |
| DSI-68 | ~~Blocked — cold-start phase 2 remainder~~ **Canceled in Linear** (2026-09-14) | M8 | 66 overseas/academy players and `dc90` have no fittable source — closed rather than left pending, since no source is expected to appear |
| DSI-69 | Blocked — new-manager discount | M8 | `pl_managers` has no tenure/start-date field |
| DSI-70 | Blocked — Sprint 12.5 phases 3–6 | M8 | Manager-side thresholds are transcribed opinion, not measured data |
| DSI-71 | Blocked — manager behavioural history | M8 | The FPL API exposes none for past seasons |
| DSI-72 | Blocked — automated FPL login | M8 | Superseded, not pending. PingOne offers no password grant |
| DSI-75 | One CLI functions deploy reconciles four drifts | M8 | **Unblocked 2026-09-24**: DSI-55, the blocker it waited on by choice, is closed. Covers the `verify_jwt` flip, `sync-manager`'s `last_success_at`, and two hand-inlined bundles. The repo is public now, so the old "near-zero while private" reasoning no longer holds |
| DSI-76 | Gateway Timeouts cluster on cron boundaries | M8 | None — a hypothesis with six data points. Self-correcting since `last_success_at` landed, so watch rather than chase |
| DSI-143 | Decide whether to keep graft's `UserPromptSubmit` prompt hints | — | Not a gated item — an open call. Referenced from `CLAUDE.md`'s graft-patch note ("Whether the per-prompt hint hook earns its keep is open in DSI-143"). In Review in Linear; found missing from this table by `/linear-sync`'s 2026-09-21 run |

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
