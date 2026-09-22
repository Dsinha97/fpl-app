# Methodology

The recurring rules this codebase has been built and corrected under. Most were learned the hard
way — a bug shipped, was caught, and the fix became a standing rule rather than a one-off patch. This
page is the single answer to "why does this app do things this way."

## Drop, renormalise, disclose

Several formulas reference fields FPL zeroes between seasons (team strength, `players.form`). The
rule: never multiply a term by zero and ship a quietly shrunken score. Drop the term, renormalise
the remaining weights, and surface a `*_MODEL_NOTE`/`*_NOTE` next to the number. Concrete instances:
[risk-scoring.md](risk-scoring.md)'s EO term, [lineup-captain-bench.md](lineup-captain-bench.md)'s
`CAPTAIN_MODEL_NOTE`, `SEASON_HORIZON_NOTE`, `TRANSFER_MODEL_NOTE`.

*Status note (2026-09-02): both example fields have since partly refilled — `players.form` is
populated for 358 of 651 players, and `strength_overall_home`/`_away` for all 20 clubs, though
`strength_attack_*`/`strength_defence_*` are still zero. The rule is unchanged; the examples are now
historical for form and half-historical for strength. Sprint 30 acted on the form half. See
[fpl-api-constraints.md](fpl-api-constraints.md).*

## When a term cannot be dropped, make it an input

If the missing quantity is the feature itself — not decoration on it — don't estimate it, expose it
as a documented, user-set input. The precedent is `decisionMargin` in
[transfer-engine.md](transfer-engine.md#why-the-literal-spec-formula-isnt-implemented): the value of
"news that hasn't happened yet" genuinely can't be modelled, so it's a settable number defaulting to
1 point, shown as its own term. Never tune an invented coefficient until the answer looks reasonable
— that's curve-fitting to a vibe, not modelling.

## One quantity, one implementation

`riskPoints` (see [risk-scoring.md](risk-scoring.md)) is the only risk→points rate; the transfer
optimiser scores every branch through `simulateTransfers` rather than a second scorer (see
[transfer-engine.md](transfer-engine.md)); the chip engine reuses `optimiseLineup`/`optimizeSquad`
unchanged (see [chip-strategy.md](chip-strategy.md)) rather than re-deriving lineup/knapsack logic. A
second implementation of one number is a bug with a delay on it — the two will drift and nothing
will notice until they visibly disagree on screen.

## An invented threshold is not evidence

Gate acceptance on an existing backtest (bias, MAE, Pearson r) — not a round number that sounds
right. Applies to calibration factors ([xp-model.md](xp-model.md)), the Hidden Gems percentile cuts
([hidden-gems.md](hidden-gems.md)) instead of a video's literal thresholds, and the club tactical
modifiers explicitly staying **out** of xP until backtestable ([club-tactical-profiles.md](club-tactical-profiles.md)).

## A prior fitted on a filtered sample answers a different question

Check what a fitting filter selects *for*. Fitting the cold-start playing-time prior only on
450+-minute seasons conditions on the very thing being predicted — it told every fringe player they
average ~47 minutes. See [cold-start-priors.md](cold-start-priors.md).

## A variance needs far more data than a mean

Estimate spread at the coarsest level that's still meaningful, or it collapses to zero on thin cells
and the prior silently overrides real evidence. `tau2` per price band did exactly this; fixed by
estimating it once per position instead. See [cold-start-priors.md](cold-start-priors.md).

## Fill order and objective are separate concerns

Maximising a total under a budget is a knapsack; filling greedily by raw score is the textbook wrong
answer for one. This is documented once here because it recurred: the squad optimiser had it, and
the same class of bug (`windowTotal` defaulting missing data to `0` instead of `null`) resurfaced in
the chip engine's wildcard branch. See [squad-optimizer.md](squad-optimizer.md),
[chip-strategy.md](chip-strategy.md#a-real-bug-this-engines-harness-caught).

## Bounded searches prune the moves that only pay off in combination

A beam ranked purely by immediate gain drops a funding leg before its payoff leg exists. The fix —
carrying funders alongside winners (`FUNDER_WIDTH`) — appears in both the transfer optimiser's beam
and is the general shape to watch for in any future bounded search. See
[transfer-engine.md](transfer-engine.md#search).

## Verify engine changes against live data, not just review

Every engine bug on this page was caught by running the real module against live data in a `npx tsx`
harness — not by code review, and not by the UI. Two of the sharpest examples (the squad-optimiser
fill-order bug, the chip engine's `null`-vs-`0` bug) survived review and were only caught this way,
in minutes. The harness itself is deliberately kept out of the commit. See the `engine-verify` skill
for the mechanics.

## Three-check gate for any new external data drop

Per-player distinct values (not position archetypes), a genuine origin competition, and no overlap
with players who already carry PL minutes. Born from a rejected CSV that was 95% synthetic; reused
verbatim to gate the FootyStats PDF drop that later passed. See
[cold-start-priors.md](cold-start-priors.md#phase-2--external-league-enrichment).

## Say what the number means

Downgrades are labelled as downgrades. Empty result sets say so rather than ranking worse options.
Costs and assumptions stay their own terms — a headline reads `+8.5 xP − 8 hit − 0.2 risk = +0.3`,
never a bare net figure. See [transfer-engine.md](transfer-engine.md).

## A blocked option that vanishes reads as a bug; its reason is information

Applies throughout: the transfer optimiser's wildcard row before GW2, the chip engine's GW20–38
half before those predictions exist, Sprint 10's field-wide EO sample before league 314 is
rank-ordered (the mini-league slice of the same sprint unblocked at the GW1 deadline — see
[ownership-and-leagues.md](ownership-and-leagues.md)). See
[blocked-and-data-gaps.md](blocked-and-data-gaps.md).

## Squad rules and scoring rules come from the database, never hardcoded

`SquadRules` loads from `game_settings`; scoring values load from `scoring_rules`. Never hardcode 15
players / £100m / 3-per-club, and never hardcode a points value — a mid-season FPL rule change
should flow straight through without a code change.

## Verify an external claim before implementing it

An audit, a video, or a third-party report making a claim about this specific app or its data is not
itself evidence — check it the same way an internal assumption gets checked, before acting on it.
An external "AI-coded website" audit ranked a "critical DNS resolution failure" as its top-priority
fix; a live `curl` against the deployed Worker returned `200` in 263ms with a cache hit — the
auditor's own tooling had no outbound network access, not a real outage. The same audit's other
headline claims (purple gradients, scroll hijacking, inverted hover states, a 3D pitch, hover-only
xG/xA) were each checked against the actual source and found false — zero `bg-gradient-*` utilities
app-wide, zero scroll listeners, zero `hover:opacity-*` dimming, a flat 2D `pitch.tsx`, and
current-season xG/xA already rendered as plain table cells. Its one genuinely good, if buried,
finding (no persistent deadline/bank/FT anywhere in the app's chrome) shipped; its confidently wrong
top-priority "fix" (replace the brand purple with a neutral palette to look less AI-generated) did
not. See [design-audit-response.md](../sprints/design-audit-response.md) for the full verified/false/
rejected breakdown. The same audit also flagged `lib/fdr.ts`'s green-to-red ramp as needing to match
FPL's own literal palette instead — wrongly: its header comment records a CVD (colour-vision-
deficiency) ΔE validation with a 12.3 protan adjacent-pair separation, which the audit's suggested
literal palette has no equivalent check for. (`design-system.md` used to cite `risk-scoring.md` for
this validation, which contained no such content — a broken cross-link flagged in this pass's tidy
note and corrected in the same pass to cite `lib/fdr.ts`'s own header comment directly.)
## A scrambling control is what separates a result from a coincidence

When a new signal improves a metric, run the same arm with the *mapping* destroyed and the
distribution intact. Sprint 35's results-derived FDR fed `predict` the identical spread of `fdr`
values with the team-to-rating assignment shuffled; that arm came out **worse than neutral** in
every season at every setting while the real ratings came out better. Without it, "a spread of fdr
values happens to help the model" would have been indistinguishable from "these ratings know
something". The improvement was small (MAE ~0.5%) and the control is the entire reason it counts as
real. See [fixture-difficulty.md](fixture-difficulty.md#the-result-and-the-control-arm-that-makes-it-one).

## A backtest proves the comparison it ran, not the one you want

The same sprint measured *derived FDR beats **no** fixture adjustment* and then did not ship,
because production uses FPL's **official** FDR and derived-vs-official was never tested — official
FDR for past seasons is not obtainable. Shipping on that evidence would have claimed something the
harness never measured. Name the baseline out loud whenever a result is quoted.

## A harness that records its outputs and not its inputs cannot be debugged

Sprint 34 spent longer on why published backtest tables would not reproduce than on the sweep it was
blocking, and found two input-corruption bugs rather than a model problem:

- **`fetchAll` paged with `limit`/`offset` and no `ORDER BY`.** Postgres guarantees no row order
  without one, so offset pages over a 10-17-page table skipped and repeated rows — 2023-24's arm
  read n=5710 unordered against n=4515 ordered, ~26% duplicates corrupting every statistic
  downstream. `order` is now a required argument at all six call sites, and two consecutive full
  runs are byte-identical. (The same defect CLAUDE.md already recorded for `lib/player-pool.ts`; the
  harness predated the rule.)
- **Position was resolved from today's roster**, and position selects the whole scoring rule set —
  10-13 players per season scored under the wrong rules. Fixed with `positionsForSeason`.

Runs now print an **input fingerprint** — row counts behind every reference table, plus per-season
truth and cohort counts — so a future divergence is attributable rather than guessable. The
corrected numbers landed on top of the originally published ones: the published tables were right
all along, and the harness had been drifting against itself.

## Work that silently does not happen renders as absence

The hardest class of bug in this project is not a wrong number, it is a job that never ran. Three
separate faults in Sprint 36 shared that shape and survived three weeks between them, because a
rival with no gameweek history looks exactly like a rival whose history is legitimately empty, and
nothing anywhere said "this did not finish".

Two rules came out of it:

- **A "last touched" timestamp cannot mean "last succeeded".** `managers.updated_at` is
  trigger-maintained, so a sync that died at step two marked itself fresh and blocked its own retry
  for 24 hours. Success needs its own **nullable** column, where null is a representable
  "never completed" state.
- **A status panel must never render empty.** Every branch says something — healthy, unknown, or
  broken — because a blank panel is indistinguishable from a broken one, which is the failure being
  fixed. Signed out reports "nothing to show", explicitly not "healthy".

See [data-pipeline.md](data-pipeline.md#sync-health-what-has-quietly-not-happened).

## Don't constrain a value somebody else owns

`manager_leagues.league_type` carried `check (league_type in ('s','x'))`. FPL emits `c` too, and
because that column is upserted early in the manager sync, one unrecognised value in one **cosmetic**
field aborted an entire manager's sync — history, chips, transfers and picks included. The
constraint was **dropped rather than widened** to `('s','x','c')`: widening re-arms the identical
trap for the fourth value. The precedent already existed — `TeamState.activeChip` is a deliberately
untyped string because FPL owns the value. Validate what this app means; accept what the upstream
API says.

## Read the comments, not just the issue

Linear is the planning interface, and a requirement added after an issue was written lives in its
**comment thread**, not its description. DSI-65's description said "email / push / Telegram /
Discord"; its comment turned it into a *two-way bot on one channel*, which is a different and larger
thing. Reading the description alone would have built the wrong feature. Where a comment and a
description disagree, the comment wins — now a standing step in
`.claude/skills/start-sprint/SKILL.md`. See
[notifications-and-bot.md](notifications-and-bot.md#why-a-two-way-bot-and-how-that-requirement-was-nearly-missed).

## Read the line that says what you asked for

`npm run lint`'s **last** line counts problems that are *fixable with `--fix`*, not errors. Reading
it instead of the `✖ N problems (1 error, 167 warnings)` summary immediately above let a real lint
error reach CI. A check is only a check if you read the part of the output that answers the
question.

## A row that exists is not a result

Closely related to **Work that silently does not happen renders as absence** above, and the harder
half of it: here the work has not happened yet and renders as *presence* — a full set of rows,
correctly keyed, joining cleanly, reading zero.

`lib/prediction-accuracy.ts` already handled the absence case properly. A prediction with no
matching `player_gameweek_stats` row was excluded on stated grounds: "an unmatched prediction is not
a residual, it's missing data, and folding it in as a zero would fabricate an observation." The
reasoning was right and the guard was one step too shallow. `sync-player-history` writes a row per
player per fixture on a 20-hour pass, so a fixture that has been played but not yet written has ~65
rows of `minutes = 0, total_points = 0` — which *do* match, and became 257 fabricated blank returns
on 2026-09-20, reporting GW5's bias as −0.589 against a true −0.006.

Three things generalise:

1. **Ask what a populated row means, not just whether it is there.** "Joined successfully" is a
   statement about keys, not about evidence.
2. **The status flag you would reach for is probably not measuring what you need.**
   `fixtures.finished_provisional` was `true` for fixtures with no stats at all; `finished` was
   `false` for fixtures that were fully written. Neither is a proxy for "results are in". The
   detector that worked was derived from the data itself — some player in the fixture with real
   minutes — because every played fixture puts 22+ players on the pitch.
3. **Validate a detector against the whole history before trusting it.** That one was checked
   across four settled seasons (~150 gameweeks) and produced zero false positives; the only
   discrepancy anywhere in the warehouse was the live case it was written for. Without that check
   it would have been a plausible rule, which is not the same thing.

And the disclosure half, per **Say what the number means**: a partially-covered gameweek is
*included and labelled* ("GW5 (6 of 10 fixtures)"), not dropped. Dropping it would have been the
same bug with the sign reversed — a silently smaller `n` reading as a healthy one.

— [sprints/gw5-check-in.md](../sprints/gw5-check-in.md) §0-1,
[data-pipeline.md](data-pipeline.md#a-played-gameweek-is-not-a-written-one-found-2026-09-20)

## A correction is only worth fitting if it can represent the error

The GW5 check-in's substantive finding, and a rule the blend attempts in
[xp-model.md](xp-model.md#known-disclosed-gaps) had already been circling.

The plan said: measure the bias, and if it holds, refit `positionCalibration`. The bias held in
sign. But decomposed, it was a **−0.714** over-prediction on players who did not appear and a
**+0.627** under-prediction on players who did, nearly cancelling into a ≈0 aggregate.
`positionCalibration` is a multiplicative scale on points. There is no value of it that fixes both
halves, because they point in opposite directions — fit the aggregate and you fit noise, fit either
half and you damage the other.

So the question to ask before fitting anything is not "is the error real" but **"can this parameter
express the error I measured?"** A term that cannot is not a partial fix; applied to a
near-cancelling aggregate it is a coin flip dressed as a correction, and it ships as a permanent
constant.

The practical form: **decompose the residual before fitting to it.** The split that mattered here
(`minutes > 0` vs `minutes = 0`) is one line of SQL and was not in any of the three prior passes
over these numbers, all of which reported the aggregate and the per-position breakdown only.

— [sprints/gw5-check-in.md](../sprints/gw5-check-in.md) §2

## When a fitted model beats a naive baseline that shares its inputs, check the inputs first

DSI-54's price-fall classifier appeared to pass its walk-forward gate at K=10 (p=0.0156) and K=20
(p=0.0039) — a real result, written up as such. It wasn't: the harness computed its feature the
same broken way the shipped code once did (differencing net-transfer counters across a gameweek
reset without accounting for the reset — see
[data-pipeline.md](data-pipeline.md#the-reading-was-broken-since-it-shipped-and-sprint-38-found-why-2026-09-21)).
Fixing the feature helped the *baseline* far more than the model, because the naive
top-N-by-net-transfers rule **is** that feature — K=40 recall went 13.4%→23.0%, K=80 27.0%→42.0%.
The apparent win was a broken shared input handicapping the thing the model was being compared
against, not the model finding signal. Whenever a fitted arm and its naive baseline read the same
underlying field, a suspicious win is at least as likely to be a broken feature as a real effect —
check the feature before trusting the model.

## Compare against a fairly tuned baseline, not the thing being replaced

A gate that beat pre-existing flat constants doesn't tell you whether a new *shape* (e.g. scaling
with ownership) is what won, or whether the old constants were just badly levelled. Sprint 38's
price-threshold gate first compared a scaled arm against the shipped flat defaults and came back
MIXED — a comparison that couldn't separate "ownership scaling helps" from "the old flat levels
were simply wrong" (they were: rises fire at ~378k against a shipped 200k default, a pure level
error). Re-run with a third arm — the best single constant per direction, refit walk-forward on the
same training events the scaled arm sees, **minus ownership** — the `flat`-vs-`scaled` comparison
becomes the one that actually isolates the shape's contribution: same data, same walk-forward,
differing only in whether ownership is consulted. The decomposition showed rises need only the
level correction (+3.5 F1 from the level, +0.8 from the shape) while falls need the shape (+1.4
from the level, +4.6 from the shape) — exactly matching what a direct measurement of the mechanism
had already found independently. A better-centred constant is also not automatically a better
*classifier*: the fitted-flat arm ranked worse than the original legacy constants at tight budgets,
because its lower mean threshold fires for more players. See
[data-pipeline.md](data-pipeline.md#the-reading-was-broken-since-it-shipped-and-sprint-38-found-why-2026-09-21).

## A gate on a consequence can stay inconclusive while the mechanism is measurable directly

Sprint 38's price-threshold gate tested a *downstream* consequence — does a scaled threshold rank
or classify real price changes better — and came back MIXED even after the three-arm re-run above,
short of significance at 23 scored nights. A separate script
(`scripts/price-window-probe.ts`) tested the *mechanism* directly instead: does the net-transfer
magnitude at the moment of a real firing event scale tightly with ownership, which is what a
threshold, by definition, would do if it were real. It fit falls at R²=0.811 and rises at R²=0.022
— unambiguous in both directions, and independently corroborated the gate's own decomposition
(+4.6 F1 for falls from the shape, +0.8 for rises). **The reading shipped on the probe's direct
measurement, with the gate's re-run kept as corroboration of its shape, not as the evidence
itself.** When a gate on a downstream consequence returns an inconclusive verdict, ask whether the
underlying quantity can be measured directly rather than inferred from its effects — a direct fit
needs far less statistical power than a ranking comparison to say something unambiguous. See
[data-pipeline.md](data-pipeline.md#the-reading-was-broken-since-it-shipped-and-sprint-38-found-why-2026-09-21).

## A tool's local patches revert on upgrade — re-apply, don't re-derive

Not a modelling rule; an operational one, recorded because it has already cost two rediscoveries.

The `graft/` code graph is wired through `.mcp.json`, `.claude/settings.json` and
`.claude/skills/graft/`, and needs three local patches to work here: a `tree-sitter-kotlin` shim
(without which the CLI will not start on Windows at all), and two suppressing graft's instruction
to end every reply with a "saved ~N tokens" tally. A global reinstall wipes the machine-tier
patches, and graft's own `reconcileWiring` silently rewrites the repo-tier ones from its templates
on any version skew.

After any `graft upgrade`, run the `graft-reapply.mjs` helper (idempotent; `--check` to report
only). The rationale lives in the `graft-patch` skill. Whether the per-prompt hint hook earns its
keep is open in [DSI-143](https://linear.app/dsinha-org/issue/DSI-143).

— [../../CLAUDE.md](../../CLAUDE.md)
