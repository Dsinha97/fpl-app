# Roadmap

**Authoritative sprint plan.** Sourced from [update-aug3.md](update-aug3.md) (the owner's revised
feature set, kept unedited) and reconciled against what is actually in the repo.
[updated-plan.md](updated-plan.md) remains the reference for formulas and method; its roadmap table
is superseded by this file.

## Numbering correction

`update-aug3.md` lists Sprint 4 as "Squad Optimizer". In this repo the squad optimiser shipped in
Sprint 2, and Sprint 4 delivered the **comparison engine and replacement finder** — which the new
document numbers as Sprints 6 and 7. Those were therefore already built when this file was written.
Sprints 5, 8 and 9 have since shipped; the next sprint to start is **12, Chip Strategy** (10 is
blocked pre-season, 11 is built, 13 needs a live match and 14 is authentication).

| Sprint | Theme | Status |
|---|---|---|
| 5 | Scenario Lab & Draft Management | **Built** — `/scenarios`, `lib/squad-score.ts` |
| 6 | Player Comparison Engine | **Built** — `/compare`, `lib/scoring.ts` |
| 7 | Replacement Finder | **Built** — builder panel, `findReplacements` |
| 8 | Transfer Simulator | **Built** — `/transfers`, `lib/transfers.ts` |
| 9 | Transfer Optimizer (up to 5 banked FTs) | **Built** — `/transfers` plan panel, `lib/transfer-optimizer.ts` |
| 10 | Ownership Intelligence | Not started — **blocked**, see below |
| 11 | Captain & Bench Optimizer | **Built** — `lib/lineup.ts` |
| 12 | Chip Strategy Engine | Not started |
| 13 | Live Matchday Hub | Not started |
| 14 | Authentication & Team Sync | Not started |
| 15 | Action Layer | Not started |
| 16 | Notifications & Automation | Not started |
| 17 | Historical Analytics & ML | Not started |

## Finishing passes on what exists

Small, do them opportunistically rather than as sprints.

- **Sprint 6 gaps** — EO column (needs Sprint 10); Form term (dropped, see `COMPARISON_MODEL_NOTE`).
- **Sprint 7 gaps** — the spec asks for top 10 replacements; the panel shows 5. The position, budget,
  club-limit, availability and minutes filters are applied but not user-adjustable.
- **Sprint 11 gaps** — the TeamAttack term is dropped until team strength populates
  (`CAPTAIN_MODEL_NOTE`).
- **Sprint 9 follow-on** — `SquadBalance` and `FutureFlexibility` are computable now that the
  per-gameweek series is loaded, but `findReplacements` still omits them (`REPLACEMENT_MODEL_NOTE`).
  Threading the series into the builder's replacement panel is the remaining work.

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

### Dependency advisories (backlog, recorded 2026-08-03)

`npm audit` reports 4 — 3 high, 1 moderate. Deliberately **not** fixed yet: the exposure here is low
and the fix touches the framework version, which this repo treats as a change needing its own
verification pass. Recorded rather than silently carried.

| Package | Severity | What it is | Exposure in this app |
|---|---|---|---|
| `postcss` | high | Path traversal / arbitrary `.map` file read via attacker-controlled `sourceMappingURL` in CSS comments | Build-time only, on CSS we author ourselves in CI |
| `sharp` | high | Inherited libvips CVEs | Next uses it for image optimisation, which a static export disables — so it should never run |
| `next` | high | Flagged transitively through the two above | Static export: no server, no route handlers, no request-time rendering |
| `hono` | moderate | ReDoS in CORS middleware | Arrives via `shadcn` → `@modelcontextprotocol/sdk`, a dev-time CLI that never ships to the browser |

The fix for the first three is a single non-breaking bump, `next@16.2.12 → 16.3.0`
(`isSemVerMajor: false`). Do it deliberately, not with `npm audit fix --force`, and heed
[../AGENTS.md](../AGENTS.md) — this is not the Next.js in anyone's training data, so read
`node_modules/next/dist/docs/` for the version's own notes before assuming a minor bump is inert.
Then the full gate: `npx tsc --noEmit`, `npm run lint`, `npm run build`, and a browser pass over
`/builder` and `/transfers` in both themes.

`hono` is separate. The cleanest fix is not a version pin but moving **`shadcn` out of
`dependencies` into `devDependencies`**, where a scaffolding CLI belongs — that drops the whole
subtree from production installs and takes the advisory with it.

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

## Sprints 12–17

- **12 Chip Strategy** — `ChipValue = xP(with chip) − xP(without)`, optimised over 5 GW / 8 GW /
  season. `chip_definitions` already holds the real windows (GW1–19, GW20–38). Needs the prediction
  window extended past 8 gameweeks first, or "season" chip planning is really 8-week planning.
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
`player_xp_horizons`, which currently equals `xp_8` because `generate-predictions` runs an 8-gameweek
window — `SEASON_HORIZON_NOTE` discloses that wherever Season is selected.

**Every recommendation returns** recommendation, expected gain, confidence, risk, explanation, and
alternatives. The existing rationale strings in `findReplacements` and the strengths/weaknesses in
`comparePlayers` are the pattern to follow.
