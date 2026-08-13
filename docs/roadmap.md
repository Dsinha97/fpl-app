# Roadmap

**Authoritative sprint plan.** Sourced from [update-aug3.md](update-aug3.md) (the owner's revised
feature set, kept unedited) and reconciled against what is actually in the repo.
[updated-plan.md](updated-plan.md) remains the reference for formulas and method; its roadmap table
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
| 15 | Action Layer | Not started | below |
| 16 | Notifications & Automation | Not started | below |
| 17 | Historical Analytics & ML | Not started | below |

Non-sprint work items, also in `sprints/`: [cold-start-patch.md](sprints/cold-start-patch.md)
(empirical-Bayes rate priors — phase 1 built, phase 2 deferred/gated) and
[squad-reconciliation.md](sprints/squad-reconciliation.md) (start/minutes water-fill — phase 1
v1.2.0, phase 2 v1.3.0, both built). Ops log and small finished items:
[sprints/additional-info.md](sprints/additional-info.md).

## Next up

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
    before trusting any accuracy claim.
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
| `positionCalibration` | Fitted in-sample; needs a refit against real 2026/27 results | — |
| Cold-Start phase 2, remaining 66 players + `dc90` | Sprint 15.6 covered 33 of 99 (COV/HUL/IPS, xg90/xa90/yellow90 only) via a one-shot PDF drop; the other 66 (overseas/academy) and `dc90` for all 33 have no fittable source | [sprints/championship-priors.md](sprints/championship-priors.md) |
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
