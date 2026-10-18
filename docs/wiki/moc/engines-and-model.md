# Engines and model (Map of Content)

Up: [Wiki home](../index.md)

The scoring and decision engines: the xP projection everything builds on, the risk rate, and the optimisers that spend it.

| Page | What it covers |
|---|---|
| [xp-model.md](../xp-model.md) | The expected-points engine: components, Poisson counts, calibration history, squad reconciliation |
| [cold-start-priors.md](../cold-start-priors.md) | How players with thin/no PL evidence still get a projection — empirical-Bayes shrinkage, the Championship λ fit, rejected data drops |
| [risk-scoring.md](../risk-scoring.md) | The one risk formula and its shared exchange rate |
| [squad-optimizer.md](../squad-optimizer.md) | Full-squad building under budget/formation rules — the knapsack fill-order bug and its fix |
| [lineup-captain-bench.md](../lineup-captain-bench.md) | XI, captain/vice, bench substitution order |
| [transfer-engine.md](../transfer-engine.md) | The manual basket simulator and the automated weekly roll/spend/hit recommendation |
| [chip-strategy.md](../chip-strategy.md) | Bench Boost / Triple Captain / Free Hit / Wildcard valuation and joint scheduling |
| [chip-plan.md](../chip-plan.md) | Pinning a chip to a gameweek, the chip-aware deadline optimiser, and the bounded forward transfer path |
| [fixture-difficulty.md](../fixture-difficulty.md) | Three generations of FDR — official, strength-derived (display-only forever), results-derived (measured, unshipped, and why) |
