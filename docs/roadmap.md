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
| 10 | Ownership Intelligence | **Exact-slice built** 2026-08-21 — mini-league EO (`sync-league-picks`, `lib/ownership.ts`), rendered on `/leagues` (2026-08-30). Top-1k sample: **not blocked as an engineering matter** — a 2026-08-30 load test synced league 314 end to end (2000 rank-ordered entries, 30,000 picks, 0 failures in 47s; test data deleted after verification) — just not currently sampled for real | [sprints/sprint-10.md](sprints/sprint-10.md), [sprints/sprint-29.md](sprints/sprint-29.md) |
| 11 | Captain & Bench Optimizer | **Built** — `lib/lineup.ts` | — |
| 12A | Manager Percentile Profile | **Built** — `/team`, `lib/manager-profile.ts` | [sprints/sprint-12.md](sprints/sprint-12.md#sprint-12a--manager-percentile-profile-built) |
| 12 | Chip Strategy Engine | **Built** — `/chips`, `lib/chips.ts` | [sprints/sprint-12.md](sprints/sprint-12.md) |
| 12.5 | PL Team (Club) Manager Intelligence | **Built** — buildable slice only (phases 1/2/7–9); phases 3–6 blocked on validation | [sprints/sprint-12.md](sprints/sprint-12.md#sprint-125--pl-team-club-manager-intelligence-buildable-slice-built-2026-08-07) |
| 12.6 | Defensive Contribution engine fix, plus five surface fixes | **Built** — xP engine v1.4.0 | [sprints/sprint-12.md](sprints/sprint-12.md#sprint-126--defensive-contribution-engine-fix-plus-five-surface-fixes-built-2026-08-08) |
| 13 | Live Matchday Hub | **Built and verified live** 2026-08-21 — GW1 kickoff dry run passed; live card group on `/deadline` (`lib/gameweek-state.ts`) | [sprints/sprint-13.md](sprints/sprint-13.md) |
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
| 20 | RSS News Ingestion | **Built** 2026-08-21 — `sync-news` Edge Function, table-driven `news_sources`, tiered player/club entity resolution, `/changes` renamed to `/news` with a Feeds tab, "In the news" on the player detail panel, `/deadline` team-news strip | [sprints/sprint-20.md](sprints/sprint-20.md) |
| 21 | Squad-view fix, Leagues, FDR sorting, League table | **Built** 2026-08-21 — fixed the root cause of `/team`'s stale-XI player-dropping bug (`hasConsistentLineup`, `lib/team-state.ts`), removed the broken "Current squad" mode, added a leagues list to `/team` (`manager_leagues`), FDR search/sort on `/fixtures`, and a new Premier League Table tab | [sprints/sprint-21.md](sprints/sprint-21.md) |
| — | Rivals fixes & card density | **Built** 2026-08-20 — `/team` rivals now sync before writing (a candidate no longer has to be loaded via the main Manager ID form first), a manager with no completed seasons is shown instead of silently dropped, and rivals gained a This season / Career tab; new `CollapsibleCard` primitive repacks `/deadline`, `/transfers`, `/chips` (Sprint 19 ranked these cards but left the packing — dead space next to short cards — unfixed). No new sprint number, a bug-fix/polish pass prompted by the owner using the app | [sprints/rivals-and-card-density.md](sprints/rivals-and-card-density.md), [docs/wiki/manager-profile.md](wiki/manager-profile.md), [docs/wiki/design-system.md](wiki/design-system.md) |
| — | AI-website design audit response | **Built** 2026-08-22 — sticky header + `ContextBar` (deadline countdown, bank, FT) on every page, current-season xG/xA and an xMins/Start% column on `/players`, nine hover-only tooltips converted to touch-accessible `TapToReveal`, focus rings closed on the six pages Sprint 19 didn't reach, `/transfers`' mobile summary ordering and `/compare`'s mobile table scroll fixed. Also verified most of an external audit's P0–P3 findings were false (no gradients, no scroll hijacking, no hover-dimming, FDR palette already correct) and rejected its neutral-palette recommendation. No new sprint number | [sprints/design-audit-response.md](sprints/design-audit-response.md), [docs/wiki/design-system.md](wiki/design-system.md) |
| — | Mobile one-handed reachability | **Built** 2026-08-22 — split `NavLinks` into independently-placeable `DesktopNav`/`MobileNav` and moved the mobile trigger to the header's left edge (was floating mid-header from two competing `ml-auto`s); the drawer became a bottom sheet so all 11 nav links land in the thumb zone regardless of grip; fixed a real "FT 15" bug (`freeTransfersDisplay` in `lib/transfers.ts` — FPL's pre-deadline "unlimited" sentinel was rendering raw) and made free transfers persist from `/deadline`/`/transfers`, plus a new FT control on `/team`; extended `TapToReveal`'s hit area (16px→36px effective) and gave `InfoTooltip` a flip-up when short on room below. No new sprint number, prompted by the owner's own phone screenshot | [sprints/mobile-reachability.md](sprints/mobile-reachability.md), [docs/wiki/design-system.md](wiki/design-system.md) |
| 22 | Navigation & shell | **Built** 2026-08-22 — grouped the 11-link nav into Live/Strategy/Statistics (`@base-ui/react/menu` dropdowns desktop, an expanding-groups left-side drawer mobile, replacing the bottom sheet); moved `/status` into `AccountMenu`; fixed the FT tooltip overflowing off-screen on mobile with a new shared `useAnchoredPanel` hook; removed an internal filename from user-facing tooltip copy | [sprints/sprint-22.md](sprints/sprint-22.md) |
| 23 | Page density | **Built** 2026-08-22 — repacked `/deadline`, `/team`, `/transfers`, `/chips` into the `grid-cols-[minmax(0,1fr)_360px]` two-column template `/builder`/`/transfers` already used; deleted `/team`'s redundant squad list; anchored `/transfers`' replace picker to its row instead of the bottom of the table | [sprints/sprint-23.md](sprints/sprint-23.md) |
| 24 | Expand/collapse polish | **Built** 2026-08-22 — new `ExpandToggle` primitive (36px circular chevron, theme-token colours), grid-rows `0fr`→`1fr` accordion replacing mount/unmount on `CollapsibleCard`, `LiveFixtureCard`, `ClubTacticsGrid`, and the mobile nav drawer | [sprints/sprint-24.md](sprints/sprint-24.md) |
| 25 | Domain cutover + UI defect sweep | **Built** 2026-08-23 — `fpldecision.com` is the canonical host (Cloudflare Registrar, apex canonical, `www` redirected, `wrangler.jsonc` routes); eleven UI fixes across `/deadline`, `/team`, `/fixtures`, `/chips`, `/players` and the nav shell — short team codes replacing truncated names, `/team` squad cards no longer overlapping the pitch, `/fixtures`' schedule brought onto the Sprint 24 expand pattern, `/chips`' dead space and duplicated fixture-flatness note fixed, `/players`' xG/xA moved to per-90, desktop nav hover-open + click-to-solidify, mobile drawer wordmark | [sprints/sprint-25.md](sprints/sprint-25.md), [docs/wiki/deployment.md](wiki/deployment.md) |
| 26 | Casual-user on-ramps + load staging | **Built** 2026-08-23/24 — builder "+" affordance, import-CTA discovery, shared parallelized `lib/player-pool.ts` loader (5s serial → ~1.7s), `/scenarios` freeze fix, staged `/deadline` load, squad Value in the context bar, not-played `–`-instead-of-`0` fix. Two commits with no sprint file at the time, backfilled during the Sprint 27 docs reconciliation | [sprints/sprint-26.md](sprints/sprint-26.md) |
| 27 | Post-GW1 reckoning | **Built** 2026-08-27 — pre-deadline prediction archive (`player_prediction_archive`, urgent: GW2's snapshot was ~26 hours from being lost the same way GW1's was), the GW1 predicted-lineup layer deleted per its own stated expiry, `/review` (what a gameweek's decision actually cost), and the current-season xP blend built and measured against a real walk-forward sweep — does not clear the gate (2024-25's bias worsens), not shipped. Docs reconciliation: two stale `Blocked` rows corrected, Sprint 26 backfilled | [sprints/sprint-27.md](sprints/sprint-27.md) |
| 28 | Live/upcoming split, one transfer answer, scenario actuals | **Built** 2026-08-29 — `/deadline` split into collapsible Live GW and Upcoming GW sections ordered by a new `livePhase` (`CollapsibleCard` gained a controlled mode, a `section` tier, `inert` collapsed bodies, and stopped clipping the pitch's player-detail popover); `TransferPlan` removed from `/transfers` and `/deadline` so the transfer path is the single answer, after fixing three real defects in it (hardcoded horizon 5, missing `decisionMargin`, and a roll branch that carried next gameweek's squad forward at zero cost); `/scenarios` gained an xP / Points-scored toggle over a new `lib/scenario-actuals.ts`. Prompted by the owner using the app during a live gameweek | [sprints/sprint-28.md](sprints/sprint-28.md) |
| 29 | Price sampling, mini-league EO, transfer tracking, layout/feed fixes | **Built** 2026-08-30 — price-change prediction steps 1–2 (bounded ~2h ownership watchlist, `lib/price-watch.ts`'s progress-to-threshold tool on `/players`/`/transfers`); new `/leagues` wires up Sprint 10's already-shipped `lib/ownership.ts` engine and `sync-league-picks` pipeline (never previously called from the app) into a real EO table; re-importing an FPL squad now overwrites the existing draft instead of minting a new one (`resolveImportTarget`), and `manager_transfers` (already written, previously empty) is rendered as a season transfer ledger on `/team` with a snapshot-diff reconciliation check; `/deadline`'s countdown inlined and its watch cards moved below the Live section via a generalised `sectionOrder`; `/review` moved from Live to Strategy nav; `change_feed` no longer double-reports one FPL update as both a status and a news row, and both `/news`/`/deadline` dedupe the FFS RSS triplication. Also fixed, found mid-sprint: `/fixtures`' league table was reading FPL's own `teams[].played/win/...` fields, which the live API never populates in-season — now derived from finished `fixtures` instead (`deriveStandingsFromFixtures`). | [sprints/sprint-29.md](sprints/sprint-29.md) |
| 30 | xP comparison form-blend (attempt 2) + a real-money accounting bug chain | **Built** 2026-08-30/09-02 — `/compare`'s `COMPARISON_WEIGHTS` restored to the plan's full five-term weighting once `form` data is present (see "Next up" below); a per-position bias-correction sweep added to `scripts/backtest-walkforward.ts` found no weight clears the gate, not shipped; `findReplacements`/`replacementLegality` and `/builder`'s picker sort column fixed. What looked like a settled "squad value already correct" turned out to be one level too shallow: chased into a real bug chain (Bank/affordability mixing sell-value and purchase-price bases, FPL's own `transfers.value` disagreeing with real per-player selling prices, `validateSquad`'s over-budget false positive, `freeTransfers` reading `limit` instead of `limit − made`) ending in `TeamState.bank` becoming the stored primitive instead of a residual derived from a frozen total | [sprints/sprint-30.md](sprints/sprint-30.md) |
| 31 | Chip awareness end to end, display-only custom FDR, public-repo pre-flight | **Built** 2026-09-03 — the owner played Triple Captain, pasted the JSON, and nothing acknowledged it. The parse was fine; three things downstream were not: nothing rendered `activeChip` anywhere, `chipAt` (the fact-beats-plan reconciler) had **zero callers** so the projection scored the squad as if the captain were merely doubled, and the chip had no gameweek of its own so a stale draft would claim it live in the *next* gameweek. Fixed with `TeamState.activeChipEvent` (from `played_by_entry`), a `multiplier`-based cross-check that proves 3xc/bboost from the payload's own arithmetic rather than an unverified `status_for_entry` enum, `fplActiveChipAt`/`chipEntriesInForce`, a status pill on `/deadline`, a Chip field in the ContextBar, and `chipLabel` replacing the raw `3xc` slug on `/transfers`/`/review`. Also: a strength-derived FDR on `/fixtures`, **display-only** because `teams` carries no strength history and so it cannot be backtested at all; and the three public-repo blockers settled | [sprints/sprint-31.md](sprints/sprint-31.md) |
| 32 | Edge Function lockdown | **Built (code only) 2026-09-05, not deployed** — every `/functions/v1/` endpoint was callable by anyone holding the publishable key, which is public by design. Split by caller: eight cron-only functions now require an `x-cron-secret` header minted by `invoke_sync` from Vault (`_shared/cron-auth.ts` — the inverse of Sprint 31's verdict on the publishable key, for the inverse reason: this secret has no public copy, so hiding it *is* the mechanism), and the two browser-invoked ones get `verifyUser` plus a per-user rate limit off a new `sync_runs.invoked_by`, with the limit a `game_settings` input derived from the busiest 10-minute window ever observed (27 calls) rather than a tuned constant. The scope doc named one `?force=1` self-gate bypass; grepping found **five**. `sync_runs`' public-read policy meant `invoked_by` would have published user ids, fixed with a column-level grant. CORS tightened off `*` for the browser-facing pair only and correctly labelled defence-in-depth; `verify_jwt` made explicit per function in `config.toml`. **Nothing deployed** — the Vault secret, migrations and function deploys are an owner action in a fixed order, because deploying the functions before the migration silently 401s every cron job | [sprints/sprint-32.md](sprints/sprint-32.md) |

Non-sprint work items, also in `sprints/`: [cold-start-patch.md](sprints/cold-start-patch.md)
(empirical-Bayes rate priors — phase 1 built, phase 2 deferred/gated) and
[squad-reconciliation.md](sprints/squad-reconciliation.md) (start/minutes water-fill — phase 1
v1.2.0, phase 2 v1.3.0, both built). Ops log and small finished items:
[sprints/additional-info.md](sprints/additional-info.md).

## Next up

- **Sprint 32 — the Edge Function lockdown is written but NOT deployed. Built 2026-09-05,
  code only; the repo flip waits on the deploy, not on more code.** Every function is now gated:
  the eight cron-only ones require an `x-cron-secret` header (`_shared/cron-auth.ts`), and the two
  browser-invoked ones (`sync-manager`, `sync-league-picks`) require `verifyUser` plus a per-user
  rate limit counted off `sync_runs.invoked_by`, with the limit an input in `game_settings`
  derived from the busiest 10-minute window ever observed (27 calls) rather than picked. The scope
  doc named one `?force=1` bypass; there were **five**. Also tightened CORS off `*` for the
  browser-facing pair only, and made `verify_jwt` explicit per function in `config.toml`.
  **What remains is an owner action in a fixed order** — Vault secret, then the `invoke_sync`
  migration, then the function deploys, then verify `sync_runs` — because deploying the functions
  first silently 401s every scheduled sync. Runbook, curl matrix and the post-deploy gate:
  [sprints/sprint-32.md](sprints/sprint-32.md).
- **A results-derived custom FDR — scoped 2026-09-03, not started.** Sprint 31 built the
  strength-derived one and proved it can never be model-grade (no strength history to backtest
  against). A difficulty derived from `deriveStandingsFromFixtures`' real scorelines *is*
  backtestable against four seasons of `player_gameweek_stats`, and is the only honest path to an
  FDR that could replace `ScoredPlayer.fdrRun`. Gate it the way the xP blend was gated.
- **Price-change prediction — steps 1–2 built 2026-08-30, step 3 not started.** The owner wants to
  know whether to transfer now or wait for a price move. Sprint 29.0 built the first two steps of the
  sequence below; step 3 (fitting a classifier) stays out until enough watchlist history has
  accumulated.
  1. **Fix the sampling first — built.** `player_ownership_history` was time-gated to ~20h for every
     player; a bounded watchlist (`cost_change_event <> 0`, or `selected_by_percent` / net-transfer
     thresholds in `game_settings`) now samples at ~2h instead
     (`supabase/migrations/20260830191442_sprint29_price_watchlist.sql`). Verified live: watchlist
     size came back 111 players, not the ~700-player full population.
  2. **Ship the descriptive tool — built.** `lib/price-watch.ts`'s `priceProgress()` reads net
     transfers since a player's last price change and reports a direction and 0–1 progress toward a
     documented, user-adjustable threshold (never a fitted coefficient) — `"unknown"`, not a guess,
     below two post-change samples. Surfaced on `/players` and `/transfers`.
  3. **Fit a model — not started, and may never be.** Gated the way the xP blend was: walk-forward
     over accumulated price history, scored on precision/recall of "rises tonight" against a naive
     top-N-by-net-transfers baseline. If it does not beat the baseline, ship the heuristic and say so.
  See [sprints/sprint-29.md](sprints/sprint-29.md) for the change.
- **Mini-league ownership UI — built 2026-08-30.** Sprint 10's engine and pipeline had shipped with
  nothing rendering them; `/leagues` (`app/leagues/page.tsx`, `lib/leagues.ts`) is that wiring — a
  league picker off `manager_leagues`, standings and EO paged past the 1000-row cap, a sync button as
  the first real caller of `sync-league-picks`, and an EO table with differential/rank-gain per
  player. Verified against real production data: synced a 5-entry league end to end and checked the
  EO math by hand. See [sprints/sprint-29.md](sprints/sprint-29.md). Not built: rivals
  auto-populated from a league's standings, and the Sprint 6 EO-column gap on `/players` — both still
  open if wanted later.
- **Repo going public — all three pre-flight items settled 2026-09-03 (Sprint 31); the switch
  itself is still the owner's to flip.** (1) **PII redacted** — the email is gone from
  `sprints/latency.md` and a repo-wide sweep now returns none; noted-not-changed is
  `fpl-app.deepayansinha.workers.dev` in `sprint-25.md` and `wiki/deployment.md`, a public URL
  that happens to carry the owner's name. (2) **The hardcoded publishable key is consciously
  accepted, no migration** — moving it to Vault would be theatre, since the identical key already
  ships in the deployed browser bundle and is readable off fpldecision.com today regardless of
  who can read the repo; the reasoning is written into the migration header itself. The *real*
  mitigation is `verify_jwt` or rate limiting on the Edge Functions, which is now its own open
  item (below). (3) **The two genuinely FootyStats-derived files are untracked** —
  `extracted/footystats_championship_2025_26.csv` and `extracted/insert.sql`; the roster CSV and
  this repo's own `match_report.json` stay, and nothing about the shipped cold-start priors
  becomes unauditable. Full reasoning: [sprints/sprint-31.md](sprints/sprint-31.md). The branch
  hardening below still needs applying, and publishing remains a deliberate owner action.
  The original scoping, kept for the reasoning behind each item:
  1. **PII.** `sprints/latency.md` contains the owner's email address beside a `user_profiles`
     description. Redact it. It is the only genuine PII in the repo — the FPL manager ID `274486` in
     14 files is public by construction (post-deadline picks are readable for any entry, which is
     Sprint 10's whole premise), and the Supabase project ref is already in the deployed CSP header.
  2. **The publishable key hardcoded in migration `20260803010912_phase1_scheduling.sql`.** Its
     header argues the key is public by design and the functions are idempotent read-only, which
     holds for *disclosure* but not for *abuse* — publishing makes the cron endpoint trivially
     callable by anyone reading the repo. Move it to a Vault secret referenced by name, or accept it
     consciously with rate limiting.
  3. **FootyStats-derived CSVs are tracked** (`docs/Promoted Team Data/`). `.gitignore`'s own note
     records that the source PDFs were excluded partly on redistribution grounds and that "the repo
     is private now, which weakens that half of the argument" — going public re-activates it. Check
     the licence or untrack them.
  Write access after publishing is GitHub's default (public read, write to no one; outside
  contributors can only open fork PRs), hardened with: a `main` ruleset requiring a PR and the
  existing `ci.yml` check, blocking force-push and deletion, **with no administrator bypass**;
  `.github/CODEOWNERS` plus required Code-Owner review; Actions set to require approval for all
  outside-collaborator fork PRs (they would otherwise reach `secrets.NEXT_PUBLIC_*`); secret scanning
  with push protection; and restricted branch creation. A sweep for JWTs, `sk-` keys, PEM blocks and
  `password =` across all tracked files found nothing but `package-lock.json` integrity hashes;
  `.env.local` is confirmed untracked.

  **Turned into a step-by-step runbook 2026-09-03** —
  [sprints/sprint-31.md](sprints/sprint-31.md)'s "Branch-protection runbook", with the exact
  ruleset settings, an equivalent `gh api` call, and the ordering (ruleset *before* the flip, so
  `main` is never public and unprotected). Two corrections to the sketch above came out of writing
  it: the required status check is named **`build`** (the job id), not `ci.yml`/"CI"; and
  **required Code-Owner review and any non-zero approval count are unsatisfiable on a one-person
  repo** — GitHub does not let a PR author approve their own PR, so pairing them with a no-bypass
  ruleset would block every merge. The runbook sets approvals to 0 (the PR requirement itself is
  what forces the diff through CI) and names "a second maintainer exists" as the trigger to raise
  it. "Restricted branch creation" is also dropped: it governs creating branches matching the
  target pattern, which is meaningless on a ruleset targeting only the already-existing default
  branch.

  **Applied 2026-09-03: steps 1–2 only, and the flip is now blocked on something else.** The
  `main` ruleset is live (id `22227209`, no bypass actors, `build` required, force-push and
  deletion blocked) and `.github/CODEOWNERS` is committed. Steps 3–4 turned out to be
  **impossible while private** — GitHub returns 422 for both fork-PR approval and secret scanning
  on a private repo — so the real order is 1 → 2 → flip → 3 → 4, not 1–5. More importantly:
  **items 1 and 3 of the pre-flight above were fixed in the working tree only.** The FootyStats
  CSV blob is still reachable in `9d4fe99` and the owner's email in `cfc5c17`, so publishing
  exposes both regardless of the removals — and the "no JWTs / `sk-` keys / PEM blocks" sweep
  carries the same caveat, since it read tracked files rather than history. **Accepted 2026-09-03**
  rather than rewriting history or republishing from a squash: not worth the cost for one email
  address and 58 rows of derived stats. So **items 1 and 3 above are mitigations, not removals** —
  the working tree is clean and nothing new accumulates, but both remain recoverable via
  `git log -p`. Recorded as such in [sprints/sprint-31.md](sprints/sprint-31.md), which also notes
  that step 4's secret scanning will likely flag the email out of history once enabled: expected,
  close it as accepted. The flip itself is now unblocked and is purely an owner decision.

- **Latency roadmap — `/deadline`, `/builder`, and `/team` fixed 2026-08-27.** Pulled the owner's
  NotebookLM research on web performance into
  [sources/website-optimization.md](sources/website-optimization.md), measured the live site
  instead of applying its advice generically (most of it targets a server-backed OLAP dashboard
  this app isn't), then signed in as the real owner account to close the signed-out blind spot.
  Built: `/deadline` and `/builder` both serially paged `player_predictions` instead of using
  `lib/player-pool.ts`'s already-concurrent `loadPredictionSeries` — routed both through it
  (6.8 s → 3.8 s settle on `/deadline`; ~5.3 s → ~1.9 s on `/builder`'s replace panel), and fixed
  a real latent bug found along the way: the shared loader's concurrent `.range()` pages had no
  `.order()`, so two offset queries had no guarantee of seeing the same row order — verified
  correct with a live-data harness before and after. Separately, `/team` called the `sync-manager`
  Edge Function (a live FPL API re-fetch) on *every* page load while signed in, blocking 3.7 s —
  the owner set the staleness policy directly (sync once a day off-matchday, every 2-minute cron
  tick on one, mirroring `sync-live-gameweek`'s own gating), so a new `sync-claimed-managers` cron
  now keeps claimed managers fresh in the background; `/team` reads pre-synced data instead
  (8.3 s → 5.5 s settle, the `sync-manager` call gone from ordinary loads; the manual Refresh
  button still forces one). Still open: zero `next/dynamic` usage anywhere (every route ships
  ~1.1 MB of raw JS regardless of what it uses), and a serial-waterfall pattern — now confirmed on
  `/team` too, not just `/players`/`/transfers` — among pages' own non-prediction reads. Full
  ranked plan, measured before/after, rejected alternatives: [sprints/latency.md](sprints/latency.md).
- **Custom SMTP for Supabase Auth — unblocked 2026-08-23, not started.** Sprint 14.1 recorded
  the built-in email sender's project-wide hourly cap as unfixable without custom SMTP, which
  needed "a domain we own" for sender verification — `fpldecision.com` (Sprint 25) removes that
  blocker. Not built yet; Google OAuth stays the primary sign-in path either way, so this is a
  quality-of-life item for the magic-link fallback, not urgent. See
  [sprints/sprint-14.md](sprints/sprint-14.md)'s reconciliation note.
- **Blend current-season form into the xP model — built and measured 2026-08-27; does not clear
  the gate, not shipped.** The scope-and-write-up entry that used to sit here is superseded: the
  blend was actually built (`SeasonRow.games`, `deriveRatesWithPrior`'s `currentSeasonRow`/
  `currentSeasonWeight` in `xp-model.ts`, both additive and inert for every existing caller) and
  swept against the real walk-forward backtest (`scripts/backtest-walkforward.ts`, now with a
  genuine within-season accumulation, not just the season-boundary walk-forward it had before).
  MAE and Pearson r both improve in every one of the three backtest seasons at every weight
  tested, but 2024-25's bias magnitude worsens (0.329 → 0.375-0.390) at every weight, and the
  gate needs all three seasons to clear. Full measured table, both real bugs the naive version of
  this would have shipped (a `games`-denominator bug that would have cut a nailed starter's `mpg`
  by ~58% off two gameweeks of data, and a displacement bug that halves the *prior* evidence
  weight the moment any current-season data exists), and the reasoning for not chasing a
  passing weight on 2024-25 alone: [phase-4-model.md](phase-4-model.md#honest-limitations).

  **Attempt 2, scoped 2026-08-29, swept 2026-08-30 (Sprint 30) — neither step ships a model
  change.** Two steps, in order:
  1. **Fix the expired premise — built.** `lib/scoring.ts`'s `COMPARISON_WEIGHTS` dropped FPL's
     `form` term and renormalised over 0.90 on the premise that FPL zeroes `form` between seasons —
     expired at GW1. `ScoredPlayer` gained an optional `form` field, populated only by `/compare`
     (which already fetched `players.form` for its own column); `comparePlayers` uses the plan's
     full five-term weighting when it's present, and the renormalised weights unchanged everywhere
     else. Comparison/ranking layer only, not the xP engine.
  2. **Re-run the sweep with a per-position bias correction — swept, does not clear the gate, not
     shipped.** The blend beats prior-only on MAE/r in every season and fails on bias alone, which
     reads like a fixable calibration offset — so a per-position additive intercept was swept
     alongside `currentSeasonWeight`, fit leave-one-season-out (never from the season it corrects).
     **No weight clears the gate in all three seasons.** The correction learned from 2024-25 and
     2025-26 (both under-predicting, strongly negative bias) overshoots when applied to 2023-24
     (which was already near-zero/slightly over-predicting), flipping its bias to +0.46–0.51 instead
     of correcting it — bias direction and magnitude aren't stable enough across seasons for one
     global per-position constant to fix. The dormant infrastructure (`SeasonRow.games`,
     `currentSeasonRow`/`currentSeasonWeight`) stays in `xp-model.ts`, inert. Full measured table:
     [phase-4-model.md](phase-4-model.md#honest-limitations). Reproduce with
     `npx tsx scripts/backtest-walkforward.ts`, which now sweeps and reports this permanently.
- **Archive pre-deadline predictions — built 2026-08-27.** `generate-predictions` deletes and
  replaces `player_predictions` wholesale every run, so there was never a record of what the
  model said *before* a gameweek was played — GW1's predictions were gone within the first cron
  tick after GW1 finished, and GW2's were about 26 hours from the same fate when this was found.
  `player_prediction_archive` (public-read/service-write, keyed without `model_version` since
  it's a historical fact) now holds a deadline-gated snapshot per gameweek, written by a hook
  inside `generate-predictions` itself. `lib/prediction-accuracy.ts` joins it to
  `player_gameweek_stats` once a gameweek scores — the scoreboard panel on `/status` is
  deliberately not built yet (see Blocked below: needs ≥2 archived gameweeks to say anything
  honest). RLS verified both roles; `accuracyStats` lifted out of the backtest script into
  `lib/stats.ts` so the walk-forward harness and this scoreboard score residuals identically.
- **`/review` — built 2026-08-27.** New route: what a gameweek's decision actually cost, in terms
  named separately rather than netted — points/rank movement, the captain call vs. the
  best-in-hindsight starter, bench points recovered by a projected auto-sub vs. still stranded
  (shown alongside FPL's own `points_on_bench`, not reconciled away), and transfers (an explicit
  empty state today — `manager_transfers` has 0 rows). Built entirely on existing primitives
  (`lib/manager-picks.ts`, `lib/gameweek-state.ts` — `loadGameweekState` is event-agnostic, so a
  finished gameweek runs the identical captaincy/auto-sub logic a live one does) — no new table,
  no model risk. `lib/gameweek-review.ts`.
- **GW1 predicted-lineup layer — deleted 2026-08-27, now GW1 is scored.** Built 2026-08-20 as a
  one-off, single-source read (`lib/gw1-lineups.ts`) to fill the one gap the cold-start xP model
  couldn't: which of several similarly-rated squad players actually starts GW1. Fed `riskScore`
  at horizon 1 only — never `xp`. Deleted in one commit per its own stated expiry:
  `lib/gw1-lineups.ts`, `components/gw1-badge.tsx`, `ScoredPlayer.gw1` and its read in
  `riskScore`, the toggle and `gw1_*` fields on `/deadline` and `/transfers`, and
  `PlayerData.gw1_*`/the detail-panel block. `PlayerData.is_rotation_risk` and `RotationIcon`
  predate this and stay — they're for the real Risk Engine once it exists.
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
- **Sprint 13 (Live Matchday Hub) — built and verified live, 2026-08-21.** The GW1 dry-run checklist
  passed against the real opening fixture: `sync-live-gameweek` left its `skipped` branch, a spot-check
  matched FPL's own live feed exactly, and `/deadline`'s new live card group (`lib/gameweek-state.ts`)
  rendered correctly against the owner's real GW1 squad in both themes. The dry run also found a real
  gap — `sync-fixtures` only ran hourly, so `fixtures.started` lagged kickoff by up to ~55 minutes —
  fixed same day with a self-gated 2-minute cadence; see [sprints/sprint-13.md](sprints/sprint-13.md).
- **Sprint 10 (Ownership Intelligence), exact slice — built 2026-08-21.** The same deadline made any
  entry's picks public, not just the top-1k template's, so mini-league effective ownership is now exact
  for the leagues in `manager_leagues` (`sync-league-picks`, `lib/ownership.ts`), rendered on
  `/leagues` (Sprint 29, 2026-08-30). The top-1k sample's blocker has moved: a 2026-08-30 load test
  proved `sync-league-picks` handles league 314 ("Overall", 9.9M entries) at full scale —
  2000 rank-ordered entries, 30,000 picks, 0 failures — so it is no longer a data/engineering gap,
  just something nobody has run and kept for real (that test's rows were deleted afterward). See
  [sprints/sprint-10.md](sprints/sprint-10.md), [sprints/sprint-29.md](sprints/sprint-29.md).
- **GW1 live-hub follow-ups — built 2026-08-21, same evening.** Using the app during the real
  opener surfaced four gaps, all fixed against data already in the database (only one new
  column, `player_live_stats.explain`):
  - **Live fixture event detail** — `fixtures.stats` already carried FPL's full goals/assists/
    cards/bonus breakdown; a new shared `LiveFixtures` component renders it on `/deadline`'s
    live hub (squad-aware) and as an expandable row on `/fixtures`' Schedule tab.
  - **`/fixtures` no longer collapses the gameweek being played** — `gameweeks.is_next` flips to
    the *next* gameweek at the current one's deadline, hours before it's played;
    `FixtureSchedule` now keeps a gameweek open while any fixture is genuinely live.
  - **Player detail panel** gained FPL's own live points breakdown (`explain`, stored verbatim —
    never a second implementation of `scoring_rules`), season totals, and DC action counts
    (explicitly labelled actions, not points) on `/team`, `/deadline`, `/builder`, and `/compare`.
  - **News feed duplicates fixed** — BBC's `<guid>` carries a changing `#fragment`, so 46% of
    `news_items` were re-fetched copies of the same article. Fixed at ingestion and cleaned up
    the existing 150 duplicate rows. See [sprints/additional-info.md](sprints/additional-info.md).
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
| `TeamAttackStrength` (attack/defence strength 0 for all 20 clubs) | Still blocked — `strength_attack_*`/`strength_defence_*` are `0` for every club **in-season too**, not just pre-season, and `strength` is `NULL`; checked live against `teams` 2026-09-02, GW3. This is the half the model term needs | [wiki/fpl-api-constraints.md](wiki/fpl-api-constraints.md) |
| ~~Custom FDR~~ **built display-only 2026-09-03 (Sprint 31); a model-grade one is blocked for a different reason** | The data blocker is gone — `strength_overall_home`/`_away` *are* populated for all 20 clubs — and `/fixtures` now offers a strength-derived rating beside FPL's own. But it **can never feed the model**: `teams` holds one season's rows and strength is a live snapshot with no history, so `scripts/backtest-walkforward.ts` has nothing to walk forward over and the standing gate cannot be run at all. The honest path to a model-grade FDR is a *results*-derived one on `deriveStandingsFromFixtures`, which **is** backtestable against four seasons of `player_gameweek_stats` — not started, its own sprint | [sprints/sprint-31.md](sprints/sprint-31.md), [wiki/fpl-api-constraints.md](wiki/fpl-api-constraints.md) |
| Accuracy scoreboard panel (`/status`) | **This row stated the wrong condition until 2026-09-03.** The bar is not "≥2 archived" — it is ≥2 gameweeks both **archived and scored**, since a residual needs a prediction *and* a result. Checked live 2026-09-03: `player_prediction_archive` holds GW2 and GW3, `player_gameweek_stats` for 2026-27 holds GW1 and GW2, so the usable intersection is **GW2 alone, n=1**. A panel on that could only ever say "n=1", which invites reading one gameweek's residual as a verdict on the model. Unblocks when GW3 is scored; the data layer (`lib/prediction-accuracy.ts`) is already done | [sprints/sprint-31.md](sprints/sprint-31.md) |
| League 314 rank-ordering (top-1k sample) | **No longer a data/engineering blocker — proven working 2026-08-30.** A Sprint 29 follow-up load test synced league 314 ("Overall", 9.9M entries, `game_settings.league_ownership_entry_cap` = 2000) end to end: 2000 rank-ordered entries, 30,000 picks, 0 failures, 47s. Two real bugs were found and fixed at this scale — an oversized `.in()` existence-check query and a live-rank-shift duplicate-key upsert crash, both in `sync-league-picks`. That test's rows were deleted afterward (verification only, not a production sync), so `league_entries` for `league_id=314` is back to 0 rows as of this writing — sampling it for real is now one click on `/leagues` away, not an unproven pipeline. Blocks only the top-1k sample — the exact mini-league slice has its own page, `/leagues` (built 2026-08-30) | [sprints/sprint-10.md](sprints/sprint-10.md), [sprints/sprint-29.md](sprints/sprint-29.md) |
| ~~`sync-live-gameweek` write path~~ **Resolved 2026-08-21.** | Executed for real during GW1: 2,434 successful runs, up to 610 rows/run, first success 2026-08-03 (pre-season dry runs against no live fixtures), real writes from GW1 kickoff. Self-gates back to `skipped` between gameweeks, as designed — the 15,154 `skipped` rows are that gate working, not a stuck function | [sprints/sprint-13.md](sprints/sprint-13.md) |
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
