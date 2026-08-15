# Squad optimizer

Builds a full 15-player squad under FPL's rules (£100m budget, 2 GKP / 5 DEF / 5 MID / 3 FWD,
max 3 per club) for a chosen strategy.

## Strategies

`max_points | balanced | value | differential` — `lib/optimizer.ts`.

## Fill order and objective are separate concerns

The squad-optimiser's defining bug, caught by running the real module against live data in an
`npx tsx` harness rather than by review: maximising total xP under a budget is a **knapsack**, and
filling greedily by raw score is the textbook wrong answer for one. It bought five premiums,
exhausted the budget, and completed the squad with near-zero fillers the reserve floor happily
permitted — Maximum points scored *worse* (257.8 xP) than the Value strategy (311.6 xP) on the same
pool. `fillScoreOf` now orders the fill by points-per-million (the standard greedy approximation for
a knapsack) while the swap and funded-upgrade passes still maximise raw points, so a strategy keeps
its stated meaning — Max points returns 331.4 xP at a full spend after the fix.
— [sprint-09.md](../sprints/sprint-09.md#a-squad-optimiser-bug-this-sprint-exposed)

## Build sequence

1. **Greedy build** — fills by `fillScoreOf` (points per million), not raw score.
2. **Bounded same-position swap pass.**
3. **Funded-upgrade pass** — downgrades one pick to pay for a better one elsewhere. A same-position
   swap alone can't fix a pick costing 50p more than what's held once the budget is fully committed.

Its risk gate is non-binding in practice: the xP model already zeroes injured/suspended players, so
there's little left for a separate risk floor to catch.

## Risk control

`RiskLevel: low | high` reuses the cold-start prior's own rate-uncertainty band (`low` = lower edge,
`high` = mean) rather than inventing a discount coefficient. See
[cold-start-priors.md](cold-start-priors.md#how-this-interacts-with-squad-building) and
[risk-scoring.md](risk-scoring.md).

## Related engines

- [lineup-captain-bench.md](lineup-captain-bench.md) — picks the XI/captain from a built squad.
- [transfer-engine.md](transfer-engine.md) — the wildcard branch calls this optimiser and inherited
  the same bug before the fix (Sprint 9).
- [chip-strategy.md](chip-strategy.md) — Free Hit/Wildcard reuse this optimiser unchanged rather than
  a second implementation.
