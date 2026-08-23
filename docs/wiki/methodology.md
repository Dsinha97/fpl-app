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
