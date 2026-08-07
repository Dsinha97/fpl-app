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
file (10 is blocked pre-season, 11 is built, 13 needs a live match, 14 is authentication). Sprint 12
proper — Chip Strategy — is next; its prerequisite, extending the prediction window past 8
gameweeks, is done (below).

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
| 12 | Chip Strategy Engine | Not started |
| 13 | Live Matchday Hub | Not started |
| 14 | Authentication & Team Sync | Not started |
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

**Phase 2 — evidence-weighted water-fill (deferred, not gated on external data this time).** The
real fix is to weight each player's share of the correction by `n_eff` (evidence, already computed
by `deriveRatesWithPrior` for exactly this purpose) rather than uniformly, so a low-evidence reserve
absorbs most of a club's correction and a high-evidence established starter absorbs little. This is
a different algorithm from a plain KL-minimal proportional water-fill, not a parameter change to the
one shipped, and needs its own derivation and the same verification pass (constraint audit,
within-club Spearman, phase-4 cohort r) before it replaces phase 1. Unlike the cold-start patch's
phase 2, this one is blocked on design work, not on a missing data source — everything it needs
already exists in the model.

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

## Queued for next sprint (added 2026-08-07)

Four small items, not yet started. Grouped here because they are independent of each other and of
Sprint 12 proper — take in any order, or alongside it.

- **Squad reconciliation phase 2** — the evidence-weighted water-fill described under "Squad
  reconciliation, phase 1" above. Weight each player's share of the correction by `n_eff` (already
  computed by `deriveRatesWithPrior`) instead of applying one proportional factor uniformly across a
  club's position group. Needs its own derivation and the same verification pass as phase 1
  (constraint audit, within-club Spearman, phase-4 cohort Pearson r) before it replaces the shipped
  water-fill. Not blocked on data — everything it needs already exists in the model.
- **A 19 GW horizon button, and Season expanded to the full 38.** `HORIZONS` (`lib/team-state.ts`)
  is currently `[1, 3, 5, 8, "season"]`, and `"season"` still reads whatever `generate-predictions`
  actually projected — today GW1–19, per the pre-Sprint-12 finishing batch. Two separable pieces:
  add `19` as its own horizon value alongside `8`, and separately, extend `generate-predictions`'
  window derivation past the current chip-window cap so `"season"` can reach all 38 gameweeks rather
  than stopping at the wildcard window. The second half is the larger piece — it changes prediction
  volume (~572 players × up to 38 GWs) and needs the same row-count and timing check the GW19
  extension got, plus a look at whether a frozen 38-gameweek projection is honest to show at all this
  far out (the model has no way to reflect news that hasn't happened yet — this is the same caveat
  `decisionMargin` exists for in `transfer-optimizer.ts`).
- **Price filter on the Builder player search.** The main picker (`app/builder/page.tsx`, the
  `search`/`position`/`teamFilter` filter set around line 481) has no price bound today — only the
  replacement panel does (`maxPriceOverride`, added in the pre-Sprint-12 batch). Add a min/max price
  range using `components/ui/range-slider`, the same control already used there.
- **Fixture list in the player detail panel, capped at 8 GW.** `components/player-detail.tsx` shows
  point-in-time stats (price, xP GW, xP5, expected minutes, start%) but no fixture-by-fixture list.
  Add one driven by the page's selected horizon, reusing `FixtureCell`
  (`components/fdr-badge.tsx`, already imported into `player-detail.tsx`) — the same cell the FDR
  matrix uses, so a fixture reads identically everywhere it appears. Cap at 8 fixtures regardless of
  horizon, including once "season" reaches 19 or 38 above: the panel is a compact, anchored popover
  (`PANEL_MAX_HEIGHT` is fixed), not a schedule page, and `app/fixtures` already exists for the full
  run.

## Sprints 12–17

- **12 Chip Strategy** — `ChipValue = xP(with chip) − xP(without)`, optimised over 5 GW / 8 GW /
  season. `chip_definitions` already holds the real windows (GW1–19, GW20–38), and the prediction
  window now reaches them (see "Pre-Sprint-12 finishing batch" above) — ready to build on.
- **13 Live Matchday Hub** — a `GameweekState` object: live score, bonus, live rank, pending auto
  subs, captain EO, safety score. Depends on `sync-live-gameweek`'s row-writing path, which has never
  executed — there have been no live matches.
- **14 Authentication & Team Sync** — Supabase Auth, FPL login through an Edge Function, import team,
  compare draft against live. Drafts migrate off `localStorage` here.
- **15 Action Layer** — submit lineup, captain, transfers, chips. Always with explicit confirmation;
  credentials server-side only.
- **16 Notifications** — deadline, injury, suspension, price change, fixture change, new
  recommendation. Email / push / Telegram / Discord.
- **17 Historical Analytics & ML** — captain success, transfer success, chip ROI, xP accuracy, rank
  progression, recommendation accuracy. Then gradient-boosted minutes and injury models. Note that
  the current xP calibration is in-sample; refitting it against real 2026/27 results is a
  prerequisite for taking any accuracy claim seriously.

## Cross-cutting

**Risk formula** (revised spec):

```
RiskScore = 0.30 Rotation + 0.25 Injury + 0.20 Minutes + 0.15 FixtureVariance − 0.10 EO
```

EO is unavailable until Sprint 10, so the term is dropped and the four remaining weights are
renormalised over 0.90 → `0.333 / 0.278 / 0.222 / 0.167`. See `RISK_WEIGHTS` and `RISK_MODEL_NOTE` in
`lib/scoring.ts`. This changed every risk score in the app relative to the previous
`0.35 / 0.30 / 0.20 / 0.15`.

**Horizons** are `1 | 3 | 5 | 8 | "season"` (`lib/team-state.ts`). Season reads `xp_total` from
`player_xp_horizons`, which now spans whatever chip window `generate-predictions` last ran (GW1–19
today) rather than a fixed 8 gameweeks — `seasonHorizonNote(windowGws)` discloses the real span
wherever Season is selected.

**Every recommendation returns** recommendation, expected gain, confidence, risk, explanation, and
alternatives. The existing rationale strings in `findReplacements` and the strengths/weaknesses in
`comparePlayers` are the pattern to follow.
