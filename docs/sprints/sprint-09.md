# Sprint 9 — Transfer Optimizer

**Status: built.** See [../roadmap.md](../roadmap.md) for the sprint index.

A panel at the top of `/transfers` answering the weekly question — roll, spend one, spend two, take a
hit, or wildcard — with every option scored by `simulateTransfers`, the same engine the manual basket
uses. The winner loads into that basket, so the recommendation ends in an action rather than a number.

## Why the spec's formula is not implemented literally

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

## Other decisions worth keeping

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

## Uncovered, with reasons

- **Free hit** — needs a one-week squad that then reverts, which is a different model. Sprint 12.
- **Multi-gameweek scheduling** — which gameweek to move in across all eight. The later weeks of a
  frozen projection are its least trustworthy part, so a two-gameweek decision is the honest scope.
- `SquadBalance` / `FutureFlexibility` in `REPLACEMENT_MODEL_NOTE` are now computable in principle,
  but wiring the per-gameweek series into the builder's replacement panel is its own change. Left in
  the finishing-passes list rather than smuggled in here.

## A squad-optimiser bug this sprint exposed

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
