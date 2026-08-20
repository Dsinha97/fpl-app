# Roadmap

**Authoritative sprint plan.** Sourced from [update-aug3.md](sources/update-aug3.md) (the owner's revised
feature set, kept unedited) and reconciled against what is actually in the repo.
[updated-plan.md](sources/updated-plan.md) remains the reference for formulas and method; its roadmap table
is superseded by this file. Full per-sprint history moved to [sprints/](sprints/) — see
[docs/README.md](README.md) for the complete documentation index.

`update-aug3.md` lists Sprint 4 as "Squad Optimizer"; in this repo that shipped as Sprint 2, and
Sprint 4 delivered the comparison engine and replacement finder, numbered 6 and 7 below. Full
reconciliation narrative: [sprints/additional-info.md](sprints/additional-info.md).

## Sprint index

| Sprint | Theme | Status | Detail |
|---|---|---|---|
| 5 | Scenario Lab & Draft Management | **Built** — `/scenarios`, `lib/squad-score.ts` | [sprints/sprint-05.md](sprints/sprint-05.md) |
| 6 | Player Comparison Engine | **Built** — `/compare`, `lib/scoring.ts` | — |
| 7 | Replacement Finder | **Built** — builder panel, `findReplacements` | — |
| 8 | Transfer Simulator | **Built** — `/transfers`, `lib/transfers.ts` | [sprints/sprint-08.md](sprints/sprint-08.md) |
| 9 | Transfer Optimizer (up to 5 banked FTs) | **Built** — `/transfers` plan panel, `lib/transfer-optimizer.ts` | [sprints/sprint-09.md](sprints/sprint-09.md) |
| 10 | Ownership Intelligence | Not started — **blocked**, league 314 empty pre-season | [sprints/sprint-10.md](sprints/sprint-10.md) |
| 11 | Captain & Bench Optimizer | **Built** — `lib/lineup.ts` | — |
| 12A | Manager Percentile Profile | **Built** — `/team`, `lib/manager-profile.ts` | [sprints/sprint-12.md](sprints/sprint-12.md#sprint-12a--manager-percentile-profile-built) |
| 12 | Chip Strategy Engine | **Built** — `/chips`, `lib/chips.ts` | [sprints/sprint-12.md](sprints/sprint-12.md) |
| 12.5 | PL Team (Club) Manager Intelligence | **Built** — buildable slice only (phases 1/2/7–9); phases 3–6 blocked on validation | [sprints/sprint-12.md](sprints/sprint-12.md#sprint-125--pl-team-club-manager-intelligence-buildable-slice-built-2026-08-07) |
| 12.6 | Defensive Contribution engine fix, plus five surface fixes | **Built** — xP engine v1.4.0 | [sprints/sprint-12.md](sprints/sprint-12.md#sprint-126--defensive-contribution-engine-fix-plus-five-surface-fixes-built-2026-08-08) |
| 13 | Live Matchday Hub | Not started — **staged for GW1** | [sprints/sprint-13.md](sprints/sprint-13.md) |
| 14 | Authentication & Team Sync | **Built**, plus 14.1–14.4 | [sprints/sprint-14.md](sprints/sprint-14.md) |
| 15.5 | Hidden Gems (value-discovery filter) | **Built** — `player_rate_profile`, `lib/hidden-gems.ts`, `/players` + builder filters | [sprints/hidden-gems.md](sprints/hidden-gems.md) |
| 15.6 | Championship cold-start priors (FootyStats PDF drop) | **Built** — xP engine v1.5.0, `external_player_seasons`, 33 players re-primed | [sprints/championship-priors.md](sprints/championship-priors.md) |
| 15.8 | Gameweek planning view, unified player filters, comparison-table fixes | **Built** — `/builder` gameweek dropdown (`squadEventAgg`, `projectionAtEvent`), `components/player-filters.tsx` shared by `/players` + builder picker, `/compare` tie handling | — |
| — | Deadline Hub | **Built** — `/deadline`, read-only over existing engines (`validateSquad`, `optimiseLineup`, `optimizeTransfers`, `benchBoostAt`/`tripleCaptainAt`, `change_feed`); no new sprint number, since Sprints 13/15/17 were all unavailable this week (see below). Extended 2026-08-15: both `/deadline` and `/team` gained a read-only pitch view defaulting to the manager's imported FPL squad, plus a Current squad / Gameweek result switch on `/team` (`lib/manager-picks.ts`) | [sprints/additional-info.md](sprints/additional-info.md) |
| — | Chip strategy planning | **Built** 2026-08-16 — pin a chip to a gameweek (`TeamState.chipPlan`, `lib/chip-plan.ts`), chip-aware `optimizeTransfers`/`simulateTransfers` branches, a bounded forward transfer path (`lib/transfer-path.ts`) sequencing transfers around planned chips, `/chips` → plan pinning. No new sprint number, extending Sprint 12's Chip Strategy Engine and Sprint 9's Transfer Optimizer rather than either alone | [docs/wiki/chip-plan.md](wiki/chip-plan.md) |
| 15 | Action Layer | Not started | below |
| 16 | Notifications & Automation | Not started | below |
| 17 | Historical Analytics & ML | Not started | below |
| 17a | Model Validation (walk-forward backtest) | **Built and run** 2026-08-18 — `ingest-fpl-archive` Edge Function, `scripts/backtest-walkforward.ts`; found the model underperforms a naive last-5-gameweeks baseline out-of-sample in every season tested | [sprints/sprint-17a.md](sprints/sprint-17a.md) |
| 18 | Squad Structure & Chip Sequencing | **Built** 2026-08-19 — Effective Starting XI budget (`lib/squad-budget.ts`), a real chip-sequencing bug fix in `planTransferPath`, calendar-derived chip-sequence presets on `/chips`, and transfer reversibility (`Replacement.exitRoutes`) on `/builder` + `/transfers` | [sprints/sprint-18.md](sprints/sprint-18.md) |
| 19 | Design System & Interaction Feedback | **Built** 2026-08-19/20 — fixed Geist Sans never actually applying, adopted `focus-visible` states app-wide on `/transfers`/`/chips`/`/builder`, stopped `optimizeTransfers`/`runChipEngine` freezing the tab, ranked the cards on `/deadline`/`/transfers`/`/chips`, promoted xP to the dominant number in the player detail panel | [sprints/sprint-19.md](sprints/sprint-19.md), [docs/wiki/design-system.md](wiki/design-system.md) |
| — | Rivals fixes & card density | **Built** 2026-08-20 — `/team` rivals now sync before writing (a candidate no longer has to be loaded via the main Manager ID form first), a manager with no completed seasons is shown instead of silently dropped, and rivals gained a This season / Career tab; new `CollapsibleCard` primitive repacks `/deadline`, `/transfers`, `/chips` (Sprint 19 ranked these cards but left the packing — dead space next to short cards — unfixed). No new sprint number, a bug-fix/polish pass prompted by the owner using the app | [sprints/rivals-and-card-density.md](sprints/rivals-and-card-density.md), [docs/wiki/manager-profile.md](wiki/manager-profile.md), [docs/wiki/design-system.md](wiki/design-system.md) |

Non-sprint work items, also in `sprints/`: [cold-start-patch.md](sprints/cold-start-patch.md)
(empirical-Bayes rate priors — phase 1 built, phase 2 deferred/gated) and
[squad-reconciliation.md](sprints/squad-reconciliation.md) (start/minutes water-fill — phase 1
v1.2.0, phase 2 v1.3.0, both built). Ops log and small finished items:
[sprints/additional-info.md](sprints/additional-info.md).

## Next up

- **GW1 predicted-lineup layer — built 2026-08-20, remove after GW1 is scored.** A one-off,
  single-source read (`lib/gw1-lineups.ts`) fills the one gap the cold-start xP model can't:
  which of several similarly-rated squad players actually starts GW1. Feeds `riskScore` at
  horizon 1 only — never `xp` — gated by a page toggle (off by default) and `nextEvent === 1`,
  wired into `/deadline` and `/transfers`. 262 names from a predicted-lineups video were
  resolved against the live `players` table; 23 turned out stale (wrong club, or not in FPL's
  2026-27 list at all — Salah and Bernardo Silva among them) and were owner-corrected. **Delete
  in one commit once GW1 is scored**: `lib/gw1-lineups.ts`, `components/gw1-badge.tsx`, the
  `ScoredPlayer.gw1` field and its two-line read in `riskScore` (`lib/scoring.ts`), the toggle
  and `gw1_*` fields on `/deadline` and `/transfers`, and the `PlayerData.gw1_*` fields /
  detail-panel block. `PlayerData.is_rotation_risk` and `RotationIcon` predate this and stay —
  they're for the real Risk Engine once it exists.
- **Deadline Hub — built 2026-08-14.** With Sprint 13 unverifiable, Sprint 15 blocked, and Sprint 17
  unfittable (all three below), a real gap remained: nothing gathered pre-deadline decisions into one
  place. `/deadline` does — live countdown, `validateSquad` legality, per-player availability alerts,
  `optimiseLineup`-driven captain/XI recommendation diffed against the draft's current picks, an
  `optimizeTransfers` call gated behind an explicit "Run optimiser" button (~1,875 simulations),
  `benchBoostAt`/`tripleCaptainAt` for this gameweek only, and a squad-scoped slice of `change_feed`.
  Pure read/render over trusted engines — no new migration, function, or table. Once GW1's first
  fixture goes live this page becomes the natural shell for Sprint 13's `GameweekState`, so
  pre-deadline planning and in-play tracking end up as the same route in two phases. Also extracted
  two duplicated helpers while touching every page that had them: `availabilityFromStatus`
  (`lib/scoring.ts`, was copy-pasted six times) and `loadSeasonContext` (`lib/season-context.ts`, the
  `gameweeks`/`element_types`/`game_settings` fetch that was copy-pasted three times, four counting
  `/chips`' variant) — both now single implementations per CLAUDE.md's "one quantity, one
  implementation" rule.
- **Squad view on Deadline Hub and My Team — built 2026-08-15.** Both pages now default to the
  squad actually imported from FPL (`entryId` recorded on `TeamState`, matched by
  `resolveRequestedDraft`'s new preference — see [sprints/additional-info.md](sprints/additional-info.md)
  for the full naming-consolidation and verification detail) and render it on a read-only pitch
  (`PitchView`'s `LineupResult` prop generalised to a `SquadLayout` so the same component can draw
  either a projection or a known XI). `/team` adds a Current squad / Gameweek result switch, backed
  by new `lib/manager-picks.ts` — summed per-fixture for double gameweeks, XI taken from `position`
  rather than `multiplier` so Bench Boost can't be mistaken for the starting XI, and the displayed
  total is never reconciled with FPL's own gameweek score, since `automatic_subs` isn't synced.
  Verified against a seeded-and-reverted GW1 in Supabase, since `manager_picks` is genuinely empty
  before the real GW1 deadline (2026-08-21).
- **Sprint 13 (Live Matchday Hub)** — staged, not started. `sync-live-gameweek`'s write path has
  never executed (no live fixture yet, GW1 deadline 2026-08-21); building against it now would be
  unverifiable. See [sprints/sprint-13.md](sprints/sprint-13.md) for the GW1 dry-run checklist to
  run the moment the first fixture kicks off.
- **Sprints 15–17**, not started:
  - **15 Action Layer** — submit lineup, captain, transfers, chips. Always with explicit
    confirmation; credentials server-side only.
  - **16 Notifications** — deadline, injury, suspension, price change, fixture change, new
    recommendation. Email / push / Telegram / Discord.
  - **17 Historical Analytics & ML** — captain success, transfer success, chip ROI, xP accuracy,
    rank progression, recommendation accuracy; then gradient-boosted minutes and injury models.
    Prerequisite: `positionCalibration` is fitted in-sample — refit against real 2026/27 results
    before trusting any accuracy claim. **Sprint 17a (below) now has the walk-forward evidence
    this refit needs** — it does not do the refit itself, on purpose (see sprint-17a.md's
    "explicitly not done" section for why rushing it in the same pass would be a mistake).
- **Finishing passes**, small — do opportunistically rather than as sprints:
  - Sprint 6 gap — EO column (needs Sprint 10); Form term dropped, see `COMPARISON_MODEL_NOTE`.
  - Sprint 11 gap — TeamAttack term dropped until team strength populates (`CAPTAIN_MODEL_NOTE`).

## Blocked, with reasons

| Blocked | Reason | Detail |
|---|---|---|
| Team strength (0 for all 20 clubs) | Pre-season; blocks custom FDR and `TeamAttackStrength` | — |
| League 314 standings (empty) | Pre-season; blocks all of Sprint 10 | [sprints/sprint-10.md](sprints/sprint-10.md) |
| `sync-live-gameweek` write path | Never executed — no live fixture yet | [sprints/sprint-13.md](sprints/sprint-13.md) |
| Automated FPL credential login | PingOne offers no password grant; the one reachable flow opens with bot detection | [sprints/sprint-14.md](sprints/sprint-14.md#fpl-login-is-blocked--automated-credential-login-not-the-session-handoff) |
| `positionCalibration` | Fitted in-sample; needs a refit against real 2026/27 results. Walk-forward evidence for why now exists: out-of-sample the model underperforms a naive last-5-gameweeks baseline in every season tested | [sprints/sprint-17a.md](sprints/sprint-17a.md) |
| Cold-Start phase 2, remaining 66 players + `dc90` | Sprint 15.6 covered 33 of 99 (COV/HUL/IPS, xg90/xa90/yellow90 only) via a one-shot PDF drop; the other 66 (overseas/academy) and `dc90` for all 33 have no fittable source | [sprints/championship-priors.md](sprints/championship-priors.md) |
| New-manager uncertainty discount (GW1-3 xP penalty) | `pl_managers` has no start date/tenure field — nothing says which club has a first-season manager. Now measurable in principle: Sprint 17a's 4 seasons of per-gameweek data could test "do first-season-manager players underperform their prior rate early on," but needs a tenure source first, and any xP effect is still gated behind the same backtest `μ_fit` needs | [sprints/sprint-17a.md](sprints/sprint-17a.md) |
| Sprint 12.5 phases 3–6 (System Fit multiplier) | **Half-unblocked by Sprint 15.6**: player-side rates (crosses/90, tackles/90, etc.) are now measured for the 58 FootyStats-covered players, but manager-side tactical thresholds are still transcribed opinion, not measured data — the block stands for that reason specifically now, not by default | [sprints/sprint-12.md](sprints/sprint-12.md#sprint-125--pl-team-club-manager-intelligence-buildable-slice-built-2026-08-07) |
| Manager behavioural history (transfers, captains, chips) | FPL API exposes none for past seasons; `manager_picks` FKs to the current season only | [sprints/sprint-12.md](sprints/sprint-12.md#sprint-12a--manager-percentile-profile-built) |

## Decisions that still bind

Live cross-cutting rules, each defined once in the sprint file that built it — this is an index,
not a copy.

- **SquadScore** (points-equivalent term sum) — [sprints/sprint-05.md](sprints/sprint-05.md)
- **TransferGain**, sell-price rule, shared risk exchange rate — [sprints/sprint-08.md](sprints/sprint-08.md)
- **`decisionMargin`** as a disclosed input rather than a modelled `FutureFlexibility` —
  [sprints/sprint-09.md](sprints/sprint-09.md)
- **ChipValue**, one-primitive reuse of `optimiseLineup`/`optimizeSquad` —
  [sprints/sprint-12.md](sprints/sprint-12.md)
- **Empirical-Bayes shrinkage** (`n_eff` / `w_prior` / `mu_post`) for cold-start rates —
  [sprints/cold-start-patch.md](sprints/cold-start-patch.md)
- **Evidence-weighted water-fill invariant** (`solveWeightedWaterFill`) for squad reconciliation —
  [sprints/squad-reconciliation.md](sprints/squad-reconciliation.md)
- **xP engine v1.4.0 calibration factors** (`GKP 1.265 / DEF 1.2241 / MID 1.2238 / FWD 1.2576`) —
  [sprints/sprint-12.md](sprints/sprint-12.md#sprint-126--defensive-contribution-engine-fix-plus-five-surface-fixes-built-2026-08-08)
- **Three-check gate for any new external data drop** (per-player values, genuine origin, no
  overlap with players who already carry PL minutes) —
  [sprints/cold-start-patch.md](sprints/cold-start-patch.md#phase-2--external-league-enrichment-partially-delivered-2026-08-11)
- **A league-translation λ is fitted per metric off a real cross-league cohort, never invented or
  shared across metrics** (xg90 0.200 / xa90 0.280 / yellow90 0.844; a metric with no fittable
  cohort — `dc90` — is left untranslated rather than guessed) —
  [sprints/championship-priors.md](sprints/championship-priors.md)
- **`mergeDrafts`** (unseen draft wins, else newer `updatedAt` wins) — the one merge rule shared by
  file import and cloud sync — [sprints/sprint-14.md](sprints/sprint-14.md)

## Cross-cutting

**Risk formula** (revised spec):

```
RiskScore = 0.30 Rotation + 0.25 Injury + 0.20 Minutes + 0.15 FixtureVariance − 0.10 EO
```

EO is unavailable until Sprint 10, so the term is dropped and the four remaining weights are
renormalised over 0.90 → `0.333 / 0.278 / 0.222 / 0.167`. See `RISK_WEIGHTS` and `RISK_MODEL_NOTE` in
`lib/scoring.ts`. This changed every risk score in the app relative to the previous
`0.35 / 0.30 / 0.20 / 0.15`.

**Horizons** are `1 | 3 | 5 | 8 | 19 | "season"` (`lib/team-state.ts`). Season reads `xp_total` from
`player_xp_horizons`, which now spans the full season (GW1–38 today) rather than stopping at a chip
window — `seasonHorizonNote(windowGws)` discloses the real span and, since the window now genuinely is
the season, warns instead that the far end of a frozen projection is its least trustworthy part.

**Every recommendation returns** recommendation, expected gain, confidence, risk, explanation, and
alternatives. The existing rationale strings in `findReplacements` and the strengths/weaknesses in
`comparePlayers` are the pattern to follow.
