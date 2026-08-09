# Roadmap

**Authoritative sprint plan.** Sourced from [update-aug3.md](update-aug3.md) (the owner's revised
feature set, kept unedited) and reconciled against what is actually in the repo.
[updated-plan.md](updated-plan.md) remains the reference for formulas and method; its roadmap table
is superseded by this file.

## Numbering correction

`update-aug3.md` lists Sprint 4 as "Squad Optimizer". In this repo the squad optimiser shipped in
Sprint 2, and Sprint 4 delivered the **comparison engine and replacement finder** — which the new
document numbers as Sprints 6 and 7. Those were therefore already built when this file was written.
Sprints 5, 8 and 9 have since shipped; **Sprint 12A, Manager Percentile Profile** ships alongside this
file (10 is blocked pre-season, 11 is built, 13 needs a live match, 14 is authentication). **Sprint
12, Chip Strategy Engine, is now built** — see below — after its prerequisite, extending the
prediction window past 8 gameweeks, landed 2026-08-06.

| Sprint | Theme | Status |
|---|---|---|
| 5 | Scenario Lab & Draft Management | **Built** — `/scenarios`, `lib/squad-score.ts` |
| 6 | Player Comparison Engine | **Built** — `/compare`, `lib/scoring.ts` |
| 7 | Replacement Finder | **Built** — builder panel, `findReplacements` |
| 8 | Transfer Simulator | **Built** — `/transfers`, `lib/transfers.ts` |
| 9 | Transfer Optimizer (up to 5 banked FTs) | **Built** — `/transfers` plan panel, `lib/transfer-optimizer.ts` |
| 10 | Ownership Intelligence | Not started — **blocked**, see below |
| 11 | Captain & Bench Optimizer | **Built** — `lib/lineup.ts` |
| 12A | Manager Percentile Profile | **Built** — `/team`, `lib/manager-profile.ts` |
| 12 | Chip Strategy Engine | **Built** — `/chips`, `lib/chips.ts` |
| 12.5 | PL Team (Club) Manager Intelligence | Not started — **reconciled and scoped down**, see below |
| 12.6 | Defensive Contribution engine fix, plus five surface fixes | **Built** — see below |
| 13 | Live Matchday Hub | Not started — **staged for GW1**, see below |
| 14 | Authentication & Team Sync | **Built** — see below |
| 15 | Action Layer | Not started |
| 16 | Notifications & Automation | Not started |
| 17 | Historical Analytics & ML | Not started |

## Pre-Sprint-12 finishing batch (2026-08-06)

Cleared before starting Sprint 12 proper: the prediction-window extension it depends on, plus four
items this file had recorded as knowingly carried.

- **Prediction window extended.** `generate-predictions`' `HORIZON = 8` is replaced by a window
  derived from `chip_definitions` — the chip window covering the next gameweek (GW1-19 today,
  Wildcard #1's real span), floored at 8 and clamped to the season's last gameweek. `player_xp_horizons`
  gains `last_event` so a consumer can read the real span rather than inferring it from `fixtures`.
  "Season" now means that real window everywhere it is used — `horizonLength`, `fixtureScore`,
  `riskScore`, `comparePlayers` and `squadScore` all take an optional `seasonWindow`, threaded through
  from `first_event`/`last_event` on each page that needs it, defaulting to 8 (today's floor) where not
  yet wired. `SEASON_HORIZON_NOTE` is now `seasonHorizonNote(windowGws)`, stating the real figure
  instead of a claim that stopped being true the moment the window moved. Deployed and verified live:
  `events: "1-19"`, 10,868 rows, `squad_consistency_violations` unchanged at 10.
- **Dependency advisories cleared** (see "Dependency advisories" below, kept for the record) —
  `next` bumped to 16.3.0, `shadcn` moved to `devDependencies`. `npm audit` now reports only the
  `hono` moderate advisory, isolated to `shadcn`'s own dev-time tree.
- **CSP added** to `public/_headers` (see "Hosting follow-ups" below).
- **Sprint 7 gaps closed** — `findReplacements` takes an optional trailing `ReplacementFilters` object
  (minimum start probability, price ceiling, "include below the minutes floor", `seasonWindow`) without
  changing its existing positional `limit` or default, so `/transfers` and `transfer-optimizer.ts`'s beam
  search are unaffected. The builder panel now shows 10 by default (5/10/20 control) with all three
  filters user-adjustable via `components/ui/range-slider.tsx`'s new single-thumb `ValueSlider`.
- **Sprint 9 follow-on, half closed** — `SquadBalance` is now computed and shown as its own rationale
  line (change in the squad's week-to-week coefficient of variation from the swap), loaded lazily only
  when the replacement panel is first opened. It is **not** folded into `teamFit`'s ranking — no
  exchange rate combines it with xP/fixture/risk, since inventing one would be exactly the "fudge
  factor" `TRANSFER_OPTIMIZER_NOTE` already warns against for the sibling `FutureFlexibility` term.
  `FutureFlexibility` itself stays unbuilt: the design spec never gives it a formula, and no computable
  proxy was found here that doesn't invent a coefficient with nothing to fit it against — the same
  conclusion `transfer-optimizer.ts` already reached, which is why its own roll-vs-spend decision
  exposes `decisionMargin` as a disclosed input rather than modelling it. `REPLACEMENT_MODEL_NOTE`
  says both of these things now.
- **Draft export/import shipped** on `/scenarios` (see "Hosting follow-ups" below).

## Finishing passes on what exists

Small, do them opportunistically rather than as sprints.

- **Sprint 6 gaps** — EO column (needs Sprint 10); Form term (dropped, see `COMPARISON_MODEL_NOTE`).
- **Sprint 11 gaps** — the TeamAttack term is dropped until team strength populates
  (`CAPTAIN_MODEL_NOTE`).

## Cold-Start Patch, phase 1 — empirical-Bayes rate priors (built)

Sits outside the sprint numbering: a patch taken before Sprint 12 because a third of the player pool
had no projection at all. Sourced from [cold-start-patch-plan.md](cold-start-patch-plan.md), which
remains the reference for the deferred phase 2.

### The problem, measured

`deriveRates` returned null below 270 recency-weighted prior-season minutes and
`generate-predictions` then skipped the player entirely — no rows, absent from `player_xp_horizons`,
a dash in the UI.

| Weighted minutes, 3 most recent seasons | Players | Had xP |
|---|---|---|
| Zero PL history | 92 | 0 |
| Under 60 | 44 | 0 |
| 60–149 | 29 | 0 |
| 150–269 — *just missed the gate* | 22 | 0 |
| 270+ | 380 | 380 |

**187 of 567 (33%).** Two things mattered more than the headline. **95 already had Premier League
evidence** that the gate discarded wholesale: at 269 weighted minutes you got nothing, at 271 a
full-confidence point estimate — a cliff, not a confidence judgement. And **the gate was catching two
unrelated populations**: Nelson (ARS) has 9 PL seasons and 1,914 minutes and still got nothing,
because only the 3 most recent seasons were read. The genuine newcomers clustered at promoted clubs —
COV 93%, HUL 76%, IPS 41%.

### What was built

Rates are shrunk toward a fitted prior in proportion to the evidence behind them:

```
n_eff   = weightedMinutes / 90
w_prior = sigma2 / (n_eff * tau2 + sigma2)
mu_post = w_prior * mu_prior + (1 - w_prior) * own_rate
```

**Both variances are measured, not chosen** — `sigma2` from how much one player's own rate moves
between seasons, `tau2` from how much players in a position differ, both off `player_season_history`
(1,386 player-seasons, 280 players with two or more seasons). A four-rung fallback supplies the
prior mean: `pl_recent` → `pl_extended` (widens the season window, which is what fixes Nelson) →
`position_price` → `position_baseline`.

Coverage went **187 skipped → 0**, with 468 players on `pl_recent`, 7 on `pl_extended` and 92 on
`position_price`.

### Decisions worth keeping

- **Price informs the mean; the position informs the spread.** The first attempt estimated `tau2`
  per price band and it collapsed to zero on thin cells, driving the prior weight to **1.00** and
  letting the prior override real evidence. A variance needs far more data than a mean, so `tau2` is
  estimated once per position where there are hundreds of observations, while the band mean is kept
  because price genuinely predicts (MID `xg90` 0.044 → 0.080 → 0.158 → 0.204 across bands). Nothing
  assumes the bands are ordered — `xg90` is non-monotone for forwards.
- **The playing-time prior must not be fitted on starters.** `minFitMinutes: 450` is right for a
  per-90 rate but a selection bias on `mpg`, which is the quantity being predicted. Fitting it on
  450+ minute seasons only produced a prior saying every defender averages 47 minutes, and told a
  fringe player who genuinely averages 11 that he was a starter — McNair's projection jumped 0.90 →
  5.10. Playing time is fitted on every season with a minute in it.
- **No cap on `n_eff`.** The design document suggested capping at 5; that would leave a permanent
  5–10% prior on every established player and move 380 settled numbers for no reason.
- **`positionCalibration` was refitted**, because the shrinkage lowered the level by 0.084 points per
  gameweek. Bias returned to −0.000, MAE *improved* to 0.410 from 0.420, and Pearson r stayed at
  0.850 — level corrected without disturbing ranking, which is the same test Phase 4 used.
- **The band is a rate-uncertainty band, not a prediction interval.** It comes from re-running
  `predict()` at the rates' ±1.28σ bounds, so it ignores match-to-match Poisson noise and is
  *narrower* than real outcomes. `COLD_START_MODEL_NOTE` says so wherever it appears.
- **The optimiser reuses the existing Risk control rather than inventing a discount.** Low optimises
  the band's lower edge, High the mean. Verified on real data: prior-based players drop 87.5% from
  mean to lower bound against 14% for established ones, so Munoz falls from 70th to 118th among
  midfielders. Without that lever this patch would have quietly filled squads with speculation, and
  `withoutXp` became `lowReliability` because almost nobody is now refused a number.
- **The first genuine out-of-sample test in this repo.** Truncating established players' histories to
  simulate 90/180/270 minutes, the shrunk estimate beat **both** the raw thin-sample rate (MAE 0.048
  vs 0.061) and the pure prior (0.054). If it had beaten only one, the blend would not have earned
  its place.

### Corrections to the design document

Recorded because the document is kept unedited as the owner's source:

1. **§15–§21 argue against a formula that does not exist.** `xp-model.ts` was already component-wise
   with position-specific scoring, Poisson DC thresholds and per-component fixture multipliers — §21's
   own requirement. The cold-start layer needed no new xP formula, only to produce the existing
   `Rates` shape, which is why this landed as one seam rather than a parallel model.
2. **§13's team context has no data** — `teams.strength_*` is zero for all 20 clubs, so it is dropped
   and disclosed.
3. **Four new prediction tables collapse to one** — `player_prior_predictions` and
   `player_posterior_predictions` duplicated `player_predictions`; metadata columns on the existing
   table are correct.
4. **§25's gameweek decay schedule** is replaced by minutes-based `n_eff`, as the document itself
   recommends.
5. **The Sprint A→G order is inverted for this repo** — it leads with provider integration, which is
   partly unobtainable, and ships nothing until Sprint E while half the gap needed no external data.

### Phase 2 — external-league enrichment (deferred, gated)

Not started. Findings that shape it, verified rather than assumed:

- **API-Football has no expected goals** — "xG" appears zero times in its 139-page documentation.
  `/players` gives goals, assists, shots, passes, tackles and a composite rating. It cannot satisfy
  §7, though it does cover minutes, shots, key passes and defensive actions.
- **soccerdata ships Big-5 + Premier League, not the Championship** — other leagues "can be added but
  there are no guarantees they will be scraped correctly". So the largest newcomer cluster is the
  least covered.
- **Understat is excluded**: top-5 leagues only, so it cannot reach the Championship at all.
  **Transfermarkt is excluded**: no performance metrics, and §22 says fees must not be the primary
  minutes proxy.
- **The translation cohort would be survivor-biased.** `player_season_history` holds 498 codes and
  every one is in the current squad, because `sync-player-history` iterates *current* players. Fitting
  λ from it would measure how well transfers translate *conditional on the player still being in the
  league years later*, hiding every flop and biasing λ upward — the direction that hurts a manager.
  The fix is to take both sides of the cohort from FBref.
- Free tier is 100 requests/day and `/players` paginates at 20, so a Championship season is ~36
  requests: enough for a seasonal backfill, never for anything live.

**A candidate data drop was rejected, measured rather than assumed (2026-08-05).**
`docs/Promoted Team Data/premier_league_new_players_analytics.csv` was supplied as per-player
minutes/appearances/xG/xA data for players new to the league, intended to feed the cold-start prior.
Three checks — distinct-tuple count per position, `origin_club == new_pl_club` rate, and a join
against `player_season_history` — showed it is 95% synthetic: 96 of 101 rows are one of four
hand-written position archetypes (all 13 goalkeepers identically 3420 minutes / 38 apps / 38 starts,
which is impossible — several clubs have four registered keepers), `origin_club` equals `new_pl_club`
in 79/101 rows with `origin_league` defaulting to `EFL_Championship`, and 42/101 players already
carry real Premier League minutes and are not cold-start cases at all. Injecting it would have been
actively harmful: shrinkage weights evidence by `n_eff = minutes/90`, so the fabricated 2700-minute
defender template would read as *strong* evidence and override the fitted prior, flipping ~96 players
from `reliability: "low"` to `"high"` and giving every promoted-club defender an identical
projection. **Not used.** Any future drop must pass the same three checks before it is allowed to
influence a projection: per-player distinct values (not position archetypes), a genuine origin
competition, and no overlap with players who already carry PL minutes.

### Hosting follow-ups (recorded 2026-08-04, after the move to Cloudflare)

- **Content-Security-Policy — done (2026-08-06).** `public/_headers` now sets one: `connect-src` for
  the Supabase project, `img-src` for `flagcdn.com`, `resources.premierleague.com` and
  `fantasy.premierleague.com`, `script-src`/`style-src` with `'unsafe-inline'` (a nonce needs a server
  a static export doesn't have, and Next's own RSC hydration payload changes every build so it can't be
  hashed either — the standard trade-off for this hosting shape). Verified via `wrangler dev` (the
  same asset-serving path Cloudflare uses in production): header present on every response, crests and
  flags load, zero CSP violations across `/players`, `/fixtures`, `/builder` and a connected `/team`.
- **Cloudflare Access.** The repo is private; the site is not. Gating it with Access (email
  one-time-PIN, free to 50 users) is a dashboard change needing no code. If it is switched on, gate
  **preview deployments too** — they get their own public URLs, so an unprotected preview makes the
  gate decorative.
- **Draft export/import — done (2026-08-06).** `lib/drafts.ts` gains `exportDrafts`/`importDrafts`
  under a versioned envelope carrying both the drafts and the save timeline; merge keeps whichever
  copy of a draft is newer by `updatedAt`, so reimporting an old backup can't clobber later work.
  `/scenarios` has a download button and a file picker. Sprint 14 still supersedes it with cloud sync.
- **Actions minutes are now metered.** Private repos get a monthly quota where public repos were
  unlimited. Deleting `deploy.yml` roughly halved per-push consumption, leaving `ci.yml` at ~2
  minutes a push — hundreds of pushes before it matters, but no longer free-and-ignorable.

### Dependency advisories — cleared (2026-08-06, recorded 2026-08-03)

`npm audit` reported 4 — 3 high, 1 moderate.

| Package | Severity | What it is | Resolution |
|---|---|---|---|
| `postcss` | high | Path traversal / arbitrary `.map` file read via attacker-controlled `sourceMappingURL` in CSS comments | Cleared by the `next` bump below (transitive) |
| `sharp` | high | Inherited libvips CVEs | Cleared by the `next` bump below (transitive) |
| `next` | high | Flagged transitively through the two above | **Bumped 16.2.12 → 16.3.0** (`isSemVerMajor: false`) |
| `hono` | moderate | ReDoS in CORS middleware | **`shadcn` moved to `devDependencies`** — drops the `@modelcontextprotocol/sdk` → `hono` subtree from production installs |

Verified: full gate (`tsc`, `lint`, `build`) passed, `npm audit` now reports only `hono`, isolated to
`shadcn`'s own dev-time tree (unreachable from either fix — it is `shadcn`'s own dependency, not a
transitive one either bump touches, so it stays until `shadcn` itself updates).

## Squad reconciliation, phase 1 — start/minutes water-fill (built, v1.2.0, 2026-08-05)

Investigating why the rejected data drop above felt necessary surfaced a real, measurable defect:
every club starts exactly 11 players and 1 goalkeeper per fixture, but `player_predictions` summed
`start_probability` anywhere from 4.08 (Hull) to 14.82 (Chelsea) per club. `reconcileClubSquad`
(`xp-model.ts`) fixes this with an exact, parameter-free water-fill onto two budgets per club per
fixture — 11 starters (1 goalkeeper) and 990 minutes, kept separate because the ratio between them
varies more than tenfold across today's squads (Hull ran 138 minutes per start against a league norm
of ~92). Full mechanism, measurements, and the trade-off accepted to ship it are recorded in
[phase-4-model.md §3](phase-4-model.md#3-squad-reconciliation-v120).

**Known limitation, shipped deliberately rather than fixed under the same change that found it.**
The water-fill is a single proportional factor per club per position group, so it cannot tell an
established starter from a fringe reserve on the same price band — at a large registered squad, the
correction lands on both equally, pulling a nailed starter down by the same proportion as a reserve
who should have moved far more. Measured on the phase-4 backtest cohort: Pearson r on the 207-player
established-player cohort fell from 0.850 to 0.761 with no recalibration, driven entirely by clubs
being scaled down (Chelsea, Spurs, Man City), while clubs being scaled up improved. The league-wide
level barely moved (mean predicted PPG −0.72%, inside the band this repo already treats as "leave
`positionCalibration` alone"), so recalibrating to chase the cohort figure would have been exactly
the mistake CLAUDE.md already warns against — raising the whole league to cancel a bias caused by
cohort *selection*.

**Phase 2 — evidence-weighted water-fill — built and shipped (v1.3.0, 2026-08-07).** Weights each
player's share of the correction by `RateEvidence.priorWeight` (0–1, already computed by
`deriveRatesWithPrior`) instead of uniformly, so a low-evidence reserve absorbs most of a club's
correction and a high-evidence established starter absorbs little. `solveWeightedWaterFill`
generalises `solveWaterFill` to `q_i = min(c_i, p_i · λ^{w_i})` — `w_i = 1` for everyone is *exactly*
phase 1's formula (verified to agree with the exact solver to ~1e-13), and `w_i = 0` holds a player at
their raw `p_i` regardless of `λ`. Two disclosed costs: mixed exponents have no closed form, so this
is bisection (tolerance ~1e-4) rather than phase 1's exact iterative capping; and if every player in a
group carries zero weight the correction can never move at all (not just when the fixed floor already
exceeds target), so both directions fall back to the unweighted solve rather than silently failing.
`reconcileClubSquad` (phase 1, exact) stays in `xp-model.ts` unchanged, reachable if a future run
needs it back; `generate-predictions` now calls `reconcileClubSquadWeighted`.

**Gated on a fresh run of the phase-4 backtest before shipping**, in a `tsx` harness against live
data, comparing three variants — no reconciliation, phase 1, phase 2 — on the 208-player cohort
(≥1200 minutes in 2025/26, currently `status: 'a'`):

| Check | No reconciliation | Phase 1 | Phase 2 | Verdict |
|---|---|---|---|---|
| Constraint audit (11/1/990 per club per fixture) | — | holds | holds | ✅ still exact |
| `consistencyViolations` | 0 | 9 (1.6%) | 24 (4.2%) | disclosed cost, not disqualifying |
| Within-club Spearman(priorWeight, \|scale−1\|) | — | 0.19 / 0.13 | **0.54 / 0.56** | ✅ weighting works as designed |
| Phase-4 cohort Pearson r | 0.851 | 0.774 | **0.830** | ✅ recovers most of the gap |
| MAE / RMSE / bias | 0.407 / 0.540 / −0.003 | 0.521 / 0.660 / −0.178 | 0.454 / 0.576 / −0.113 | ✅ improves on all three |

Three of four gate criteria pass with a clear margin; `consistencyViolations` rises 2.7× in absolute
terms but stays a small share of the league (1.6% → 4.2%), and it was already an accepted, disclosed
cost of phase 1 — the same trade CLAUDE.md records for the doubly-bounded minutes solve below. Shipped
on that balance. Verified live post-deploy: `squad_consistency_violations: 24`, `squad_status: {ok:
60}` (all 20 clubs × 3 budgets), `model_version: v1.3.0`, matching the harness exactly.

A doubly-bounded minutes solve (flooring each player's minutes at their own scaled start share, to
close the ~1% consistency gap where `p60 > pAny`) was tried and rejected: for a squad member with a
near-zero own minutes estimate, the floor swamps their base rate and hands them an implausibly large
minutes scale from borrowed signal — measured taking one club's third-choice goalkeeper from
squad-rank 24 to rank 3. The single-budget solve is shipped instead, leaving that ~1% consistency
gap as a smaller, disclosed cost.

## Sprint 5 — Scenario Lab & Draft Management (built)

`/scenarios` — every draft as a card ranked by SquadScore, with inline rename, clone, delete, open
(`/builder?draft=<id>`), a save timeline, and 2–4 draft comparison.

**SquadScore** (`lib/squad-score.ts`):

```
SquadScore = ExpectedPoints + FixtureQuality + BenchStrength + Value − RiskScore
```

The terms arrive in incompatible units — expected points is in the hundreds, fixture quality is 0–1,
risk is 0–100 — so each is converted to points-equivalent before summing, and `squadScore` returns the
per-term breakdown so the comparison table can show what drove the total. Bench strength comes from
`optimiseLineup`'s `benchExpectedContribution`, computed against **each draft's own best XI** rather
than whatever lineup happens to be stored, so one draft having been through the lineup optimiser and
another not does not decide the comparison.

Two presentation rules worth keeping: metrics that are context rather than merit (spend, squad size)
carry no best-marker — spending less is not a virtue in FPL — and a marker is suppressed when the
*formatted* values tie, since a ▲ beside two cells both reading "0.5" claims a winner the reader
cannot verify.

Drafts stay in `localStorage` (`fpl_drafts_v1`, with `fpl_draft_history_v1` holding the last 20 saves
per draft for the timeline). The `team_drafts` / `draft_players` / `draft_lineups` tables belong with
Sprint 14, when Supabase Auth gives them an owner — a cloud table with no user column would have to be
rebuilt.

The "import as a new draft" gap is now covered by the transfer simulator's Apply.

## Sprint 8 — Transfer Simulator (built)

`/transfers` — a **basket** of out/in pairs against a saved draft, applied in order so cash freed by
one move funds the next, as the game behaves.

```
TransferGain = xP(after) − xP(before) − pointsCost − riskPointsChange
```

Decisions worth keeping:

- **The hit is always its own term.** The headline reads `+8.5 xP − 8 hit − 0.2 risk = +0.3`, never a
  bare net figure. A basket that only breaks even should look like one.
- **Selling price follows FPL's rule** — purchase price plus half of any rise, rounded down
  (`sellPrice` in `lib/transfers.ts`). A no-op pre-season, and wrong the moment a price moves.
- **Risk shares one exchange rate with SquadScore** via `riskPoints` (`lib/squad-score.ts`), so
  Scenarios and Transfers cannot disagree about the same squad.
- **Selling the captain moves the armband and says so** — a forced armband change is part of the cost.
- **Apply writes a new draft**, named "<draft> +n transfers", leaving the original alone. That also
  covers the Sprint 5 gap about importing a generated squad without overwriting.
- Illegality blocks Apply and names the breach ("4 players from ARS — the limit is 3").

Free-transfer **accrual** landed with Sprint 9 (`accrueFreeTransfers`); the count is still an input
here, since the simulator asks what a basket buys rather than when to play it. Expiry does not exist
under current rules — transfers bank up to five and stay.

A real-FPL-squad starting point waits on Sprint 14 — `manager_picks` is empty until the first deadline.

## Sprint 9 — Transfer Optimizer (built)

A panel at the top of `/transfers` answering the weekly question — roll, spend one, spend two, take a
hit, or wildcard — with every option scored by `simulateTransfers`, the same engine the manual basket
uses. The winner loads into that basket, so the recommendation ends in an action rather than a number.

### Why the spec's formula is not implemented literally

The plan asked for:

```
TransferValue = ExpectedGain − TransferCost − Risk
RollValue     = FutureFlexibility + ExpectedFutureGain
recommend transfer when TransferValue > RollValue + DecisionMargin
```

Against this app's data **roll can never win**. The projection is frozen: the same eight gameweeks
are visible now and next week, so whatever the best basket is next week is available today, and doing
it today collects one extra gameweek of the same gain. A literal implementation recommends
"transfer" every week, and the tempting repair — raising `FutureFlexibility` until roll sometimes
wins — is a fudge factor wearing a model's clothes.

So rolling is priced from what is genuinely computable, and the one term that is not is made visible:

| Reason to roll | Treatment |
|---|---|
| Banking to two funds a basket you cannot split into two singles | **Computed.** A funding chain — sell two mid-price players to afford one premium — is often unaffordable a leg at a time. |
| Two free transfers next week avoid a −4 this week | **Computed.** Four points against one gameweek of the gain. |
| News, injuries and price moves not yet known | **An input, not a model.** `decisionMargin`, default 1 point, shown as its own `+1 news` term in the Roll row and settable to zero to see the arithmetic alone. |

The cost of waiting is exact, not approximated: `projectAtEvent` mirrors `computeProjection` term for
term against the **per-gameweek** prediction series, so a rolled basket forfeits precisely this
gameweek's share of its gain. Scaling by `(H−1)/H` instead would misprice a blank or a double.

Two consequences fall out of the arithmetic rather than being special-cased: over a 1 GW horizon a
rolled transfer gains exactly nothing, and at five banked transfers the branch relabels itself
"Hold" because there is nothing left to bank.

### Other decisions worth keeping

- **Search is a beam over `findReplacements` candidates, scored by `simulateTransfers`.** One move is
  ninety candidates; two is forty million. Nothing re-implements the scoring — a recommendation the
  manual simulator contradicts would be worse than no recommendation, and the panel row and the
  basket headline are verified to agree to the decimal.
- **The beam carries funders as well as winners** (`FUNDER_WIDTH`). Selling a premium to fund an
  upgrade elsewhere scores badly *alone*, so a beam ranked only by gain prunes the first leg before
  the second can pay for it — the same failure mode as the squad optimiser's reserve floor, and the
  reason funding chains are reachable at all.
- **The wildcard window comes from `chip_definitions`.** Wildcard #1 runs GW2–19, so in GW1 the row
  is shown blocked with "No wildcard until GW2" rather than offered or hidden. A blocked option that
  vanishes reads as a bug; its reason is information.
- **The wildcard row does not re-optimise the armband**, so its gain is *understated* — disclosed in
  `TRANSFER_OPTIMIZER_NOTE`. Understating with disclosure is acceptable; overstating is not.
- **Free-transfer accrual** is now modelled — `accrueFreeTransfers` in `lib/transfers.ts`, one per
  gameweek capped at five, clamped at both ends so a user-typed 9 cannot manufacture an allowance.
- **Confidence is derived**: low when the top two options are within a point or the squad has picks
  the model declined to predict, high on a clear margin. Worded, never a fabricated percentage.

### Uncovered, with reasons

- **Free hit** — needs a one-week squad that then reverts, which is a different model. Sprint 12.
- **Multi-gameweek scheduling** — which gameweek to move in across all eight. The later weeks of a
  frozen projection are its least trustworthy part, so a two-gameweek decision is the honest scope.
- `SquadBalance` / `FutureFlexibility` in `REPLACEMENT_MODEL_NOTE` are now computable in principle,
  but wiring the per-gameweek series into the builder's replacement panel is its own change. Left in
  the finishing-passes list rather than smuggled in here.

### A squad-optimiser bug this sprint exposed

The wildcard branch calls `optimizeSquad(max_points)`, and it produced a squad **worse** than the
`value` strategy on the same pool — 257.8 xP against 311.6 over five gameweeks. Maximising total xP
under a budget is a knapsack, and the fill was ordered by raw xP, which is the textbook wrong answer:
it bought five premiums, exhausted the budget, and completed the squad with ten near-zero fillers
that the reserve floor happily permitted.

Fill ordering and the objective are now separate concerns (`fillScoreOf` vs `scoreOf`): Maximum
points fills by points per million — the standard greedy approximation — while the swap and
funded-upgrade passes still maximise raw points, so the strategy keeps its meaning. It now returns
331.4 xP at a full £100m spend, and a wildcard on its output correctly proposes zero changes. The
other three strategies already price their scores and are untouched.

## Sprint 12A — Manager Percentile Profile (built)

`docs/manager_intelligence_sprint12_change_plan.md` proposed a Manager Intelligence & Rank
Normalization workstream alongside Sprint 12. This is the executable subset — a career percentile
profile and rival comparison on `/team` — scoped to what the data actually supports, with no new
tables and no new Edge Functions: every quantity is a deterministic statistic over the season rows
`/team` already fetches, computed in `lib/stats.ts` and `lib/manager-profile.ts`.

**FPL already ships the percentile.** `entry/{id}/history` returns `rank_percentage` per past season
at sub-1% precision, already ingested into `manager_season_history.rank_percentage` and already
rendered on `/team` as "Top X%". The change plan's proposed `season_field_sizes` table and
`1 − (rank−1)/(field−1)` formula would reinvent it — and worse, historical field sizes are not in any
API, so that table would be hand-entered constants going stale to reproduce a number FPL gives away.

**Over half the proposed capabilities are blocked, more permanently than Sprint 10.** Measured against
the live database: `manager_season_history` held 60 rows (7 managers, 4–13 seasons each);
`manager_gameweek_history`, `manager_picks`, `manager_transfers` and `manager_chips` held **zero**.
The gameweek tables are empty because it is pre-season, but the FPL API exposes no picks, transfers or
chips for *past* seasons at all, and `manager_picks` carries a hard FK to `players(season, id)` where
`players` holds only the current season — so past-season behaviour cannot be stored even if it could be
fetched. Transfer/captain/differential/chip aggressiveness, hit frequency and template dependence are
therefore not a 12A deliverable; they begin to accrue for the *current* season from GW1.

`total_players` (bootstrap-static) is a moving target — **2,889,243** in early August, climbing toward
~11M by GW1, a ~4× swing — so it is captured into `game_settings` (`sync-bootstrap`) but used by
nothing yet; `game_settings.updated_at` is the sample-time record.

**Decisions taken**: use `rank_percentage` as canonical, no composite volatility index (§7's
0.50/0.30/0.20 weights are uncalibratable on 7 managers — the three components are reported side by
side instead), and archetypes deferred entirely rather than classified on half the inputs (Ceiling
Chaser and Conservative Grinder are indistinguishable without differential exposure).

| §3 capability | Status |
|---|---|
| Historical percentile, consistency, volatility, best/worst, median | **Built** |
| Basic rival analysis (percentile gap) | **Built** — career comparison, 7 managers loaded |
| Manager archetype | Deferred — needs behaviour |
| Risk appetite, transfer/captain/differential/chip aggressiveness, hit frequency | Blocked — no historical behavioural data; accrues from GW1 |
| Template dependence | Doubly blocked — needs Sprint 10 *and* picks |

**Not scheduled by the change plan, but a real prerequisite**: `generate-predictions` ran a fixed
8-gameweek window, which `CLAUDE.md` already recorded as required before chip planning. Extended
2026-08-06 — see "Pre-Sprint-12 finishing batch" above.

## Sprint 10 — Ownership Intelligence

**Blocked.** League 314 ("Overall") returns an empty standings array pre-season — verified by probing
the API on 2026-08-03. No standings means no manager list, no picks, no EO, no template. Nothing here
can be validated until GW1 is scored.

When it unblocks, build it **sampled at the top 1,000**, not the top 10,000: ~20 standings pages plus
1,000 `entry/{id}/event/{gw}/picks` calls per gameweek, cursor-batched the way `sync-player-history`
is. Keep the cap in a config row so it can be raised once real rate-limit behaviour is known. Ten
thousand managers is ~10,000 requests per gameweek against an unauthenticated API — earn that
gradually.

Every EO figure must be labelled as a top-1k **sample**, never as "top 10k".

```
EO           = ownership × multiplier      (captain 2×, triple captain 3×, bench 0×)
Differential = xP × (1 − EO) × Upside × MinutesProbability
RankGain     = ExpectedPoints × (1 − EO)
```

Tables: `top10k_managers`, `top10k_picks`, `template_snapshots`, `ownership_metrics`, `eo_metrics`.

## Queued items, built (2026-08-07)

Five small independent items, taken alongside Sprint 12.5 immediately after Sprint 12 shipped.

- **Price filter on the Builder player search — built.** The main picker (`app/builder/page.tsx`)
  gained a min/max price band using `RangeSlider` (`components/ui/range-slider.tsx`, the same control
  the replacement panel's `ValueSlider` sibling already used), with bounds derived from the live pool
  rather than a hardcoded range so it stays correct as prices move.
- **Fixture list in the player detail panel — built, horizon-driven.** Smaller than it first looked:
  the ticker already existed (`components/player-detail.tsx` renders `player.upcoming` via
  `FixtureCell`), just hardcoded to 3 gameweeks. `app/builder/page.tsx`'s `DISPLAY_GWS` became
  `MAX_TICKER_GWS = 8`, and the slice now follows `horizonLength(horizon, seasonWindow)` capped at 8 —
  the panel is a compact popover with a fixed `PANEL_MAX_HEIGHT`, not a schedule page.
- **A 19 GW horizon, and Season expanded to the full 38 — built.** Two pieces:
  - `player_xp_horizons` (a view) gained `xp_19`/`xp_19_lower`/`xp_19_upper`
    (`20260807120000_horizon_xp_19.sql`); `Horizon`, `HORIZONS`, `HorizonXp` and `xpAt`
    (`lib/team-state.ts`) extended to match. `tsc` found every `Record<Horizon>` literal that needed
    the new key — nine call sites across `app/*` and `lib/chips.ts`/`lib/transfer-optimizer.ts`.
  - `generate-predictions` now runs from the next gameweek through the season's actual last gameweek
    (previously capped at the chip window, GW19) — verified live: 10,887 → **21,774** rows, 573
    players, 20 seconds. `seasonHorizonNote` was rewritten: its old text ("a longer window is a
    Sprint 12 prerequisite") went stale the moment Sprint 12 shipped; it now states the real remaining
    caveat — a frozen season-long projection cannot see news that hasn't happened yet, so its far end
    is its least trustworthy part, the same caveat `decisionMargin` exists for in
    `transfer-optimizer.ts`.
- **Sprint 12.5 — PL Team Manager Intelligence, buildable slice — built.** See its own section below.
- **Squad reconciliation, phase 2 — built and shipped.** See its own section below; this is the one
  item that needed a gate before shipping, and it passed.

## Sprint 12 — Chip Strategy Engine (built, 2026-08-07)

`/chips`, `lib/chips.ts` — per-gameweek value for Bench Boost, Triple Captain, Free Hit and Wildcard
over the projected window, plus a joint schedule that places all four without reusing a gameweek.
`ChipValue = xP(with chip) − xP(without)`, per `chip_definitions`' real windows (GW1–19, GW20–38).

**One new primitive, everything else reused.** `lib/chips.ts` adds a per-gameweek-event view of a
squad and pool, then reuses `optimiseLineup` (`lib/lineup.ts`) for Bench Boost/Triple Captain and
`optimizeSquad` (`lib/optimizer.ts`) for Free Hit/Wildcard unchanged — so the knapsack fill-order fix
and the bench sub-probability maths stay defined in exactly one place, per CLAUDE.md's "one quantity,
one implementation" rule. Squads are compared with `projectAtEvent`
(`lib/transfer-optimizer.ts`) or a windowed sibling that mirrors its formula for an arbitrary
gameweek range — needed because Wildcard's remaining-window horizon doesn't fit any of the fixed
`1 | 3 | 5 | 8 | "season"` horizons.

**Measured, not assumed: today's fixture list has no blanks or doubles anywhere.** Every gameweek
1–38 currently has all 20 clubs playing exactly once (counted from `fixtures` directly). Blanks and
doubles are created later by cup postponements. Bench Boost and Triple Captain draw most of their
real value from a double gameweek; Free Hit's canonical use is a blank. So every chip value today is
driven by fixture difficulty alone and reads comparatively flat — a real answer from an incomplete
fixture list, not a bug, but one the page must say out loud rather than present a near-tie as a
recommendation. `countBlanksAndDoubles`/`chipModelNote` compute this from `fixtures` at call time, so
the disclosure updates itself the moment a real double appears, with no code change.

**Only the first chip window is evaluable.** Predictions reach GW19; the GW20–38 half of every chip
is reported *blocked*, with its reason, rather than silently omitted — the same treatment
`transfer-optimizer.ts`'s wildcard row already gives an unavailable option: "a blocked option that
vanishes reads as a bug; its reason is information."

**Bench Boost is shown net of what auto-subs already deliver.** `optimiseLineup` already prices the
bench's expected contribution *without* the chip (`benchExpectedContribution`); charging for it again
would overstate every Bench Boost by however much the bench already earns on a normal week.

**Triple Captain reports two figures** — the gain with today's armband, and with the model's own best
captain for that gameweek — because the best target is often not today's captain, and collapsing the
two would hide a choice the user still has.

**Free Hit always re-optimises the armband for its one-week squad; Wildcard does not.** A Free Hit
squad is rebuilt from scratch for one week, so its captain is re-picked for it. A Wildcard squad
persists, so its captain is a separate decision the user still has to make — carrying the current
armband forward when it survives the rebuild, and disclosing understatement when it doesn't, mirrors
`transfer-optimizer.ts`'s wildcard branch exactly. This is also why a Wildcard valued over a
one-gameweek remaining window does not equal Free Hit's gain for the same gameweek even though both
rebuild the identical squad (verified directly) — the two differ by the captain-bonus term alone, by
design, not a bug.

**A real bug the verification harness caught.** `windowTotal` (Wildcard's remaining-window sum)
originally defaulted a missing prediction to `0` rather than `null`. `optimizeSquad` treats a `null`
projection as "no data" (excluded from the cheapest-real-pick reserve floor) and a `0` as a genuine,
if unappealing, projection (included) — so a player with no prediction at all was being read as a
real zero-xP pick, skewing which players the reserve floor considered. The same reserve-floor failure
mode CLAUDE.md already records for the squad optimiser, caught this time by the `tsx` harness against
live data before it reached the UI, not by code review.

**Joint schedule, not a bare ranking.** Assigning chips to distinct gameweeks within a half is a small
exact search (a few dozen candidate gameweeks per chip), so it is brute-forced rather than
approximated, and the result reports its margin over the next-best assignment — so a schedule built
from a flat set of values reads as illustrative rather than a confident recommendation, which is what
today's blank/double-free fixture list actually produces.

### Post-ship fixes and extensions (2026-08-07)

Two real defects, found by the owner using the shipped page, plus three follow-on extensions.

**Bug 1 — the joint schedule silently discarded the second half's chip use.** `chip_definitions`
holds two windows per chip (GW1-19, GW20-38 today — FPL grants each chip once per half), and
`runChipEngine` correctly valued every gameweek in both, but `bestSchedule` only ever assigned one
slot per chip name across the *entire* season. The second half's Bench Boost/Triple Captain/Free
Hit/Wildcard was computed and sitting in the calendar table but never reachable from the schedule.
Fixed: `bestSchedule` now runs once per half (grouping `chipDefinitions` by chip, then zipping each
chip's Nth window together as "half N", robust to windows starting on slightly different gameweeks
across chips — wildcard opens GW2, the others GW1). Two independent `ChipHalfSchedule`s are returned
and rendered as two blocks.

**Bug 2 — the schedule total mixed incompatible units.** Wildcard is valued cumulatively over the
rest of its half (a permanent rebuild), while Bench Boost, Triple Captain and Free Hit are each a
single gameweek's gain (nothing persists). The old single "Total" summed all four into one number —
a season-long figure added to three one-week figures, which meant nothing. Fixed: `ChipHalfSchedule`
splits `oneOff` (BB + TC + FH, genuinely additive, its own total and margin) from `wildcard` (its own
best gameweek, reported separately, never summed). `chipModelNote` now also discloses that every chip
is still valued against *today's* squad regardless of what the schedule plays first — a Triple
Captain shown after a scheduled Wildcard does not yet reflect the rebuilt squad, since the engine
doesn't model chip-to-chip interaction.

**Wildcard toggle on `/transfers`' manual basket.** The optimizer panel's own Wildcard row already
waived the hit internally (`freeTransfers: moves.length`), but a user building a custom basket by
hand had no way to do the same — any basket beyond the free-transfer count was charged normally. An
"Apply as Wildcard (no hit)" checkbox now does exactly that, gated on the same window check the
optimizer panel already computes plus a check that the draft doesn't already carry a different active
chip (the same guard `transfer-optimizer.ts`'s own wildcard branch applies). Applying sets the new
draft's `activeChip` to `"wildcard"` and leaves `freeTransfers` untouched — a wildcard spends the
chip, not a free transfer.

**Bench Boost / Triple Captain inline on `/builder` and `/scenarios`.** Both are one `optimiseLineup`
call, cheap enough to run on every edit; `benchBoostAt`/`tripleCaptainAt` (`lib/chips.ts`) are now
exported and reused directly rather than reimplemented. Both pages build a `PredAt` scoped to the
next gameweek entirely from data already loaded (`xp_1`, the loaded prediction row, the first
fixture's FDR) — no new fetch. Free Hit and Wildcard stay off both pages: each is a full-squad
rebuild search that already takes several seconds on `/chips` alone, and running it on every builder
edit would make the page unusable — both pages link to `/chips` for them instead.

## Sprints 15–17

Sprints 13 and 14 have their own sections below (13 staged for GW1, 14 built).

- **15 Action Layer** — submit lineup, captain, transfers, chips. Always with explicit confirmation;
  credentials server-side only.
- **16 Notifications** — deadline, injury, suspension, price change, fixture change, new
  recommendation. Email / push / Telegram / Discord.
- **17 Historical Analytics & ML** — captain success, transfer success, chip ROI, xP accuracy, rank
  progression, recommendation accuracy. Then gradient-boosted minutes and injury models. Note that
  the current xP calibration is in-sample; refitting it against real 2026/27 results is a
  prerequisite for taking any accuracy claim seriously.

## Sprint 12.5 — PL Team (Club) Manager Intelligence (buildable slice built, 2026-08-07)

[PL_Team_Manager_Intelligence_Patch_Plan.md](PL_Team_Manager_Intelligence_Patch_Plan.md) (owner's
patch plan, kept unedited) proposes a tactical layer: each PL club's head coach gets a profile —
formation, buildup style, pressing intensity, role preferences per position, and numeric modifiers —
which multiplies into xP as a `μ_fit` term, feeds the cold-start prior, and ranks replacements. Data
is [pl-manager-profiles.json](pl-manager-profiles.json), 20 profiles verified to cover all 20
current-season clubs including this season's promoted/newly-arrived four (Coventry, Hull, Ipswich,
Leeds) and Sunderland.

Two problems need resolving before this can be built as specified, plus one naming collision.

**Naming collision: "manager" already means something else here.** `managers` /
`manager_season_history` / `manager_gameweek_history` / `manager_picks` / `manager_transfers` /
`manager_chips` and `lib/manager-profile.ts` all refer to the **FPL fantasy manager** (the owner,
ID 274486) — Sprint 12A is literally titled "Manager Percentile Profile" and is already built on that
name. This patch's "manager" is a **real-world PL head coach**. Ship it under different names
throughout: a `pl_managers` table (not `manager_profiles`), `teams.tactical_manager_id` (not
`clubs.manager_id` — there is no `clubs` table, it's `teams`), and `lib/tactical-profile.ts` /
`system-fit.ts` (not `manager-profile.service.ts`, which collides with the file that already exists).
The plan's `MODEL_VERSION = v1.2` in Phase 4 also collides — the shipped cold-start-plus-reconciliation
model is already `v1.2.0`; a future bump here is `v1.3.0`.

**The modifiers are transcribed opinion, not measured data — the same shape of risk as the rejected
promoted-player CSV.** Values like `1.05` / `1.15` / `1.20` (set-piece bias) and strings like `"+15%
xA in high-offside trap / vertical transition games"` come from `source_file` entries that are
tactical-breakdown video and article titles (e.g. "Marco Rose's FM26 Blueprint", "How a Set-Piece
Coach Is DESTROYING The Premier League") — qualitative scouting judgment, hand-turned into numbers.
Multiplying that straight into `xP = Base × Fixture × Minutes × Availability × μ_fit` is exactly what
"An acceptance threshold you invented is not evidence" and "Never tune an invented coefficient until
the answer looks reasonable" (both in [../CLAUDE.md](../CLAUDE.md)) exist to catch, and it compounds:
the tactical traits key on abstract player roles (`inverted_pivot`, `transition_runner`,
`wide_crosser`, `box_presence_target`) that exist in no data source this app has — FPL gives position,
not tactical role — so matching a real player to a role would mean hand-authoring 573 more subjective
labels *before* the unmeasured multiplier is even applied. Phase 5's cold-start integration
(`w'(N) = w(N) × (1 − C_manager)`) is the sharpest version of this risk: `C_manager` is itself
undefined and unmeasured, and folding it into `deriveRatesWithPrior` would sit on top of shrinkage
weights that were out-of-sample validated (beat both the raw thin-sample rate and the pure prior) —
an uncalibrated multiplier could quietly undo that validation.

**Resolution, following the pattern this repo already uses for exactly this tension**
(`decisionMargin` in `transfer-optimizer.ts`: "when a term cannot be dropped, make it an input"): ship
the tactical data as **disclosed, non-multiplicative context**, not as a term inside xP, until there
is a way to validate it.

| Phase (as numbered in the patch plan) | Status here |
|---|---|
| 1 — Database | **Built.** `pl_managers` (`20260807130000_pl_managers.sql`), `teams.tactical_manager_id`. Seeded as a one-off migration (static reference data, no sync cadence — same treatment as `chip_definitions`), not an Edge Function. |
| 2 — Tactical Knowledge Base | **Built** — traits/modifiers stored verbatim as given in `tactical_traits`/`modifiers` jsonb; provenance for a human reader, not an input to arithmetic. `lib/tactical-profile.ts` is deliberately thin: types and a loader, no scoring function. |
| 7 — Team Builder badges / 8 — Scenario Lab explanations / 9 — Explainability | **Built, as text.** A one-line `System` summary in `components/player-detail.tsx` (`tacticalSummary`), and a fuller 20-club section on `/team` carrying formation, buildup style, pressing intensity, the traits, the source-figure modifiers, and `source_file` provenance — all behind `TACTICAL_PROFILE_NOTE`, same disclosure pattern as `RISK_MODEL_NOTE`. |
| 3, 4 — System Fit multiplier, xP integration | **Blocked on validation**, not on data. Needs a real per-player role source (not hand-authored) and a backtest showing the multiplier explains variance the current model misses, once 2026/27 results exist to check against — the same bar the cold-start patch and `positionCalibration` were both held to. |
| 5 — Cold-start `C_manager` scaling | **Blocked**, and flagged as the highest-risk phase — see above. Do not touch `deriveRatesWithPrior`'s validated shrinkage without the same out-of-sample test that validated it. |
| 6 — Replacement Finder System Fit Score | **Blocked**, downstream of 3/4. |
| 10 — Research pipeline | Deferred — a process question (how the owner keeps profiles current), not a build item. |

**Alias map, verified on the live `teams` table.** 7 of 20 clubs have a different name in the JSON
than in `teams.name` (`Brighton & Hove Albion`/`Brighton`, `Leeds United`/`Leeds`, `Manchester
City`/`Man City`, `Manchester United`/`Man Utd`, `Newcastle United`/`Newcastle`, `Nottingham
Forest`/`Nott'm Forest`, `Tottenham Hotspur`/`Spurs`). The seed migration maps these explicitly and
asserts 20 of 20 clubs linked, raising an exception rather than partially seeding if the assertion
fails — verified live, all 20 linked correctly including all 7 aliased ones.

**Player role tagging is a second data-quality question, separate from the manager profiles
themselves.** If the owner wants to supply it, it should get the same three-check treatment recorded
under "Cold-Start Patch, phase 2" for the rejected CSV: per-player values (not position archetypes),
a genuine source, and disclosed provenance — before it is trusted anywhere near a multiplier.

## Sprint 12.6 — Defensive Contribution engine fix, plus five surface fixes (built, 2026-08-08)

Five observations from using the app. Four were small surface fixes; the fifth ("add an xDefcon
field") uncovered a real deflation bug in the xP engine, so most of this sprint is the fix and its
backtest gate.

**xDefcon — why it couldn't just be surfaced.** The FPL API only tracks `defensive_contribution`
from 2024/25 onward; every `player_season_history` row from 2023/24 and earlier reads a real `0`,
not a missing value. `deriveRates`, `weightedOwnRates` (the path actually used since v1.1.0) and
`fitRatePriors`'s `metricValue` all blended `dc90` over the *same* multi-season minutes denominator
as every other rate, so a zero-DC season silently divided the true rate down by its share of the
blend. Verified before the fix: league-max `dc90` was 10.43 against thresholds of 10 (DEF) / 12
(MID), and `rate_priors.mu` for `dc90` was 4.51/90 (DEF) and 5.00/90 (MID) — both roughly half of
what the 2025/26 season alone implies (`sum(defensive_contribution)/minutes*90` over that one season
tops out near 15/90).

**Fix: `deriveDcEligibleSeasons`** (`supabase/functions/_shared/xp-model.ts`) derives the eligible-
season set from the data itself (any season where any player recorded `defensive_contribution > 0`)
rather than hardcoding a season list, so it self-updates as more seasons accumulate real data. `dc90`
gets its own minutes denominator restricted to that set, in `deriveRates`, `weightedOwnRates` and
`metricValue` (which now returns `null` — dropping the row — for an ineligible season, rather than
`0`). Verified live: post-fix `rate_priors.mu` for `dc90` rose to 7.56/90 (DEF) and 8.43/90 (MID).

**Calibration refit, gated on the phase-4 backtest cohort.** Raising `dc90` raises DEF/MID xP, so
`positionCalibration` needed refitting by the same mean-matching method `docs/phase-4-model.md` §2
documents. Measured on a 209-player, ≥1200-minute, currently-available cohort against 2025/26 actuals
(`xp_8/8` vs `total_points/38`) via `execute_sql`, immediately before and after each deploy — not a
committed harness, following the same discipline as prior refits:

| Metric | Pre-fix (measured) | Post-dc90-fix, pre-refit | Post-refit (v1.4.0) |
|---|---|---|---|
| Bias (overall) | −0.115 | −0.060 | **0.000** (by construction) |
| MAE (overall) | 0.454 | 0.455 | **0.449** |
| RMSE (overall) | 0.574 | 0.574 | **0.567** |
| Pearson r (overall) | 0.830 | 0.832 | **0.839** |
| Pearson r — GKP / DEF / MID / FWD | 0.778 / 0.838 / 0.825 / 0.829 | 0.733 / 0.844 / 0.843 / 0.804 | 0.733 / 0.844 / 0.843 / 0.804 |
| `squad_consistency_violations` | 24–32 (fluctuates run to run) | 32 | 32 |

Per-position Pearson r is bit-identical between the dc90-only run and the refit — expected, since a
level correction cannot change within-position ranking. The pre-fix→post-dc90-fix GKP/FWD dip (0.778
→ 0.733, 0.829 → 0.804) is **not attributable to this change**: `dcThreshold` is 0 for GKP so
`defensiveContribution` never enters its `predict()` output at all, and `dc90`'s prior importance for
GKP (`mu = 0`) means it cannot move GKP's `priorWeight` either — the shift is data drift between two
live runs roughly an hour apart (small-n cohorts, n=18 for both GKP and FWD), not a code effect. DEF
and MID — the positions the fix actually touches — both improved. Shipped as **xP engine v1.4.0**;
refit factors `GKP 1.265, DEF 1.2241, MID 1.2238, FWD 1.2576` (from `1.1077 / 1.2224 / 1.2116 /
1.1972`) — DEF and MID barely moved, since raising `dc90` had already zeroed most of their bias
before the refit.

**Schema.** `20260808160000_horizon_xdc.sql` adds `xdc_1/3/5/8/19/total` to `player_xp_horizons`,
same drop-and-recreate pattern as the view's three prior migrations (`CREATE OR REPLACE` cannot
insert mid-projection columns). Verified live: `xdc_5` matches a hand-summed `player_predictions`
window for spot-checked players exactly.

**Surfaces.** `xDefcon` column on `/players` (DEF/MID only — GKP/FWD show `—` rather than a
misleading `0.00`, since `dcThreshold` is 0 for GKP and FWD's own rate is negligible) and a matching
row on `/compare`, both behind `XDC_MODEL_NOTE` (`lib/scoring.ts`). The note discloses the one gap
the engine fix does not close: FPL scores defenders on CBIT and midfielders/forwards on CBIRT
(including recoveries), but the model applies one aggregate `defensive_contribution` count to both,
because that is the only qualifying-action total the API exposes as a single number.
`clearances_blocks_interceptions`, `recoveries` and `tackles` are stored in `players` /
`player_gameweek_stats` / `player_season_history` but read by no code path — a position-correct split
is separate future work.

**`/players` gained a horizon control** (`HORIZONS` from `lib/team-state.ts`, same button group
`/compare` already used), retiring the hardcoded `RUN_LENGTH = 5` and the xP column's fixed `xp_5`.
The horizon now drives the fixture ticker, the xP column and the xDefcon column together. Fixtures
are fetched unbounded and sliced client-side via `horizonLength`, the same pattern `/compare` already
uses for the same reason (the horizon can reach "season").

**Select-to-compare.** `/players` rows gained a leading checkbox (up to `MAX_COMPARE`, now a shared
constant in `lib/scoring.ts` rather than redeclared in both pages — `/compare` imports it too), a
sticky bottom bar once ≥2 are selected, and a "Compare N players →" link to `/compare?ids=…`, the
same query param `/compare` already reads for the builder's replacement-finder deep link.

**Chip disclosure.** `lib/chips.ts`'s per-gameweek loop clamped `from = max(def.startEvent,
windowStart)`, so a gameweek before a chip's own window (Wildcard/Free Hit's `start_event = 2`
leaving GW1 unplayable) simply had no entry — silently absent rather than shown blocked, unlike the
"`Predictions only reach GW…`" case three lines above it in the same function. Now emits a
`blockedValuation` for each such gameweek with reason `"<Chip> opens GW<N>."`, and `/chips`'s
per-gameweek grid renders it as a titled `—` instead of treating the (previously nonexistent, now
present-but-blocked) row as a genuine `+0.0`. The GW1 greying itself was correct — `chip_definitions`
really does say `start_event = 2` for 2026-27 — only the missing disclosure was the bug. `/transfers`'
matching tooltip now names the rule ("Wildcard opens GW2 — FPL doesn't allow it before then") rather
than only the gameweek number.

**Draft handoff.** `/builder`'s "Free Hit & Wildcard schedule" link, `/scenarios`' "Chip Strategy"
link, and any future draft-aware link now carry `?draft=<id>`, read by a new shared
`resolveRequestedDraft` helper (`lib/drafts.ts`) that both `/chips` and `/transfers` call in their
init effects — extracted rather than copied a third and fourth time, following `/builder`'s own
existing `?draft=` pattern. `listDrafts()` sorts by `updatedAt` descending, so without this every
target page defaulted to whichever draft was most recently *edited*, not the one actually being
looked at.

**Club tactics moved from `/team` to a third "Clubs" tab on `/fixtures`.** The Sprint 12.5 20-club
grid was ~160 lines sitting below the "Connect your FPL team" empty state on a page otherwise
entirely about one manager's squad — a league-wide reference table with no natural home there.
`/fixtures` already had tab machinery (`schedule | fdr`) and already loaded the `teams` row the grid
needs; extracted into `components/club-tactics.tsx`, unchanged in content and disclosure
(`TACTICAL_PROFILE_NOTE`).

## Sprint 13 — Live Matchday Hub (staged, not built, 2026-08-09)

Not started, deliberately: GW1's deadline is 2026-08-21, and `sync-live-gameweek`'s
row-writing path has never executed in production — it skips whenever there is no current
gameweek or no live fixture (`docs/architecture.md`), and both guards have been true every
day since the pipeline shipped. Code and a UI written against an unexercised write path
would be unverifiable until a real match kicks off, so Sprint 14 was taken first and this
sprint's groundwork was limited to what costs nothing and needs no live data to be correct:

- **`player_live_stats`'s row count is now visible on `/status`** (`app/status/page.tsx`),
  closing the one observability gap the exploration found — previously the table wasn't in
  the warehouse-contents grid at all, so there was no way to see the write path finally
  fire without querying the database directly.

**What Sprint 13 builds, once GW1 is live** — a `GameweekState` object surfaced on `/team`
(or a new `/live` page): live score, provisional bonus, live overall rank, pending
auto-substitutions, captain effective ownership, and a "safety score" for the bench/captain
decision already locked in. Every field is already in `player_live_stats` (`bonus`, `bps`,
`in_dreamteam`, the live per-gameweek aggregate) or reachable from `manager_gameweek_history`
— this is a read/render sprint, not a new sync.

**GW1 dry-run checklist**, to run the moment the first fixture kicks off:

1. Confirm `sync-live-gameweek` actually leaves its `skipped` branch — `/status`'s "Last run
   per function" row should read `success`, not `skipped`, and the new "Live-gameweek rows"
   count on the warehouse-contents grid should move off zero.
2. Spot-check one player's `player_live_stats` row against the FPL app's own live score for
   the same fixture — `bonus`/`bps` are provisional mid-match and can still move.
3. Only after that passes: build the `GameweekState` render layer against real rows, not
   `?force=1` synthetic ones — a shape that looks right against a forced dry run can still
   be wrong against what a live match actually populates (see CLAUDE.md's "verify engine
   changes against live data" precedent from the squad-optimiser and beam-search bugs).

## Sprint 14 — Authentication & Team Sync (built, 2026-08-09)

Supabase Auth (magic link / email OTP), owned cloud storage for drafts, real-FPL-squad
import, and a session handoff standing in for the FPL login the roadmap originally
specified — see "FPL login is blocked" below for why. This is the item Sprint 8 recorded as
a gap ("a real-FPL-squad starting point waits on Sprint 14") and the item `lib/drafts.ts`
recorded as waiting on ("Cloud sync arrives with Supabase Auth in a later sprint").

**Auth.** Passwordless: `signInWithOtp` + a PKCE callback (`app/signin`, `app/auth/callback`),
mirrored into a `components/auth-provider.tsx` context every page reads. No password is ever
set, stored, or reset for the app's own accounts either — the static export has no server to
hash one against, and it sidesteps building a reset flow for no benefit at one owner's scale.

**Ownership schema — the first RLS beyond "Public read" in this project.**
`user_profiles` / `team_drafts` / `draft_snapshots` / `manager_rivals`, every one scoped
`auth.uid() = user_id` in both directions, migration `20260809190000_sprint14_auth_ownership.sql`.
Verified live, not just read from the policy definitions: with two throwaway `auth.users` rows
in a rolled-back transaction, user B's `select count(*)` against all three RLS-scoped tables
returned 0, and B's `update ... where draft_id = <A's known id>` affected 0 rows — A's row was
provably untouched afterward. `team_drafts.players` is `jsonb`, not the roadmap's original
`team_drafts` / `draft_players` / `draft_lineups` split — a draft is always read and written
whole, so a normalised child table would buy nothing but a hard FK to `players(season, id)`
that a season rollover would strand, the exact trap `manager_picks` already carries.

**Draft sync stays local-first.** `lib/drafts.ts`'s synchronous localStorage API is
unchanged — every existing page (`/builder`, `/scenarios`, `/transfers`, `/chips`) still
works signed out, exactly as before. `lib/draft-sync.ts` layers a replica on top: pulls on
sign-in, pushes on a 2s debounce after any local mutation (`onDraftsChanged`, a small
pub-sub `lib/drafts.ts` now exposes so it stays framework- and auth-agnostic), and merges
via `mergeDrafts` — the exact rule `importDrafts`'s merge branch already used (unseen draft
wins, else newer `updatedAt` wins), pulled out into its own export specifically so file
import and cloud sync cannot disagree about which copy of a draft is correct. Deletes are
tombstoned locally (`fpl_draft_tombstones_v1`) before being pushed as `team_drafts.deleted_at`,
so a delete on one device is not resurrected by a pull on another.

**Real squad import.** `lib/fpl-squad.ts`'s `teamStateFromPicks` turns one gameweek's
`manager_picks` into a `TeamState` with `source: "fpl"` — the value `TeamSource` has carried
unused since it was declared. `manager_picks` has no purchase price, so it falls back to
`now_cost`; `IMPORTED_SQUAD_NOTE` discloses this next to the "Import as draft →" button on
`/team`, following the same disclosure pattern as `SEASON_HORIZON_NOTE` and
`TRANSFER_MODEL_NOTE`. The fallback is exact for every player pre-GW1 (no price has moved
yet), which is why §F below is sequenced last rather than blocking this.

**Rivals leak closed.** `app/team/page.tsx`'s rivals table previously scanned every row in
`managers` (`.neq("entry_id", ...)`) — every manager anyone had ever connected on the
deployment, harmless with one user and wrong the instant there are accounts, since it would
show every user's claimed entry to every other user. Replaced with `manager_rivals`, an
explicitly-added set with an "Add rival by Manager ID" control and per-rival remove buttons.

### FPL login is blocked — automated credential login, not the session handoff

The roadmap originally specified "FPL login through an Edge Function". Probed read-only on
2026-08-09 after being asked to build password login specifically (the owner's FPL account
is Google-federated, but a password may also exist — the finding below turned out not to
depend on which): FPL's identity provider is **PingOne**
(`auth.pingone.eu`, environment `68340de1-dfb9-412e-937c-20172986d129`), found from the
config block in `fantasy.premierleague.com`'s own HTML.

| Route | Result |
|---|---|
| `users.premierleague.com/accounts/login/` — the classic form POST, and the exact method in the widely-cited [2019 Medium guide](https://medium.com/@bram.vanherle1/fantasy-premier-league-api-authentication-guide-2f7aeb2382e4) | **NXDOMAIN**, confirmed against Cloudflare's public resolver — a dangling CNAME to `plusers.ismfg.net`. |
| OIDC `password` / ROPC grant | **Not offered.** `grant_types_supported` has no `password` entry at all — there is nowhere to send a password, full stop. |
| `authorization_code` + PKCE with our own redirect URI | `"Redirect URI mismatch"` — the client belongs to the Premier League; a third party cannot register a callback on it. |
| `device_code` grant | `"Client is missing required grant type: DEVICE_CODE"`. |
| `response_mode=pi.flow` (DaVinci, no redirect URI needed) | **200, a live flow** — but its first node is a PingOne Protect **Protect Payload**, a device/bot-detection signal. No credential screen is reachable before it. |

Every standards-based door is shut by the client's own configuration, and the one reachable
flow opens with bot detection — automating past that is bot-detection bypass, out of scope
regardless of whether a password exists to send. Recorded as blocked with this evidence,
next to team strength and league 314, rather than worked around.

**Built instead — §F, the session handoff.** `app/settings/fpl` lets the signed-in owner
paste the `Cookie` header their own browser sends to `fantasy.premierleague.com` after
signing in normally (Google, 2FA, whatever — no bot to detect because it really is a human).
`supabase/functions/fpl-session` verifies the caller's Supabase JWT (unlike `sync-manager`,
which writes only public data and skips this) and encrypts the pasted value at rest
(AES-256-GCM, Web Crypto, `supabase/functions/_shared/crypto.ts`) under the
`FPL_SESSION_ENC_KEY` Edge secret. `fpl_sessions` has RLS **enabled with zero policies** —
verified live: even the row's own owner, authenticated as themselves, gets `count = 0`
through the anon/authenticated client. Only the service-role client inside an Edge Function
can reach it.

`supabase/functions/fpl-my-team` decrypts the session and calls the endpoint this probe
verified live and working: `GET https://fantasy.premierleague.com/api/my-team/{entry_id}/`,
which returns `403 {"detail":"Authentication credentials were not provided."}`
unauthenticated — a genuine Django-REST endpoint needing only a session. **Deliberately not**
`/drf/my-team/<id>`, the path the 2019 guide uses: that prefix is dead and returns a
misleading `200` — a 10,032-byte SPA shell with `content-type: text/html`, Fastly's response
for any unmatched path on that host, not data. `fpl-my-team` checks content-type as well as
status for exactly this reason. A lapsed session (expired cookie, or that same HTML-shell
trap) is treated as its own first-class state — `{ error: "lapsed" }` — never silently
folded into "no data," which would otherwise let an imported squad's sell prices go quietly
wrong instead of visibly asking for a fresh paste.

Both functions are deployed. **One step only the owner can do**: set the
`FPL_SESSION_ENC_KEY` Edge secret (a 32-byte key, base64-encoded) via the Supabase dashboard
or CLI — until then `fpl-session` fails closed with "Server is not configured to store this
yet" rather than storing anything unencrypted.

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
