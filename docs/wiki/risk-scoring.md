# Risk scoring

One risk number, shared by every engine that needs to weigh "could go wrong" against "expected
points" — rotation risk, injury, minutes uncertainty, fixture variance.

## The formula

The original spec:

```
RiskScore = 0.30 Rotation + 0.25 Injury + 0.20 Minutes + 0.15 FixtureVariance − 0.10 EO
```

EO (effective ownership) here means the **field's** ownership — every FPL entry, or at least a top-1k
sample of it — and that still has no data source: league 314 only unblocks a *rank-ordered* top-1k
sample once GW1 is scored (see [ownership-and-leagues.md](ownership-and-leagues.md) for the exact
mini-league EO that *did* unblock at the GW1 deadline — a genuinely different quantity, scoped to a
few-hundred-person league rather than the whole field, and not wired into this formula). So the term
is **dropped and the remaining four weights renormalised** over the surviving 0.90:

```
0.333 Rotation + 0.278 Injury + 0.222 Minutes + 0.167 FixtureVariance
```

This is CLAUDE.md's "drop, renormalise, disclose" rule applied directly — see
[methodology.md](methodology.md). `RISK_WEIGHTS` and `RISK_MODEL_NOTE` in `lib/scoring.ts` carry the
live weights and the disclosure text. This changed every risk score in the app relative to the
original 0.35/0.30/0.20/0.15 spec. — [roadmap.md](../roadmap.md#cross-cutting)

## One rate, shared everywhere

`riskPoints` (`lib/squad-score.ts`) is the single risk→points exchange rate. `squad-score.ts`'s
`SquadScore` and `transfers.ts`'s `TransferGain` both call it — CLAUDE.md's "one quantity, one
implementation" rule exists specifically so Scenarios and Transfers can't disagree about the same
squad's risk. See [squad-score-and-scenarios.md](squad-score-and-scenarios.md) and
[transfer-engine.md](transfer-engine.md).

## Consumers

- **`comparePlayers`** (`lib/scoring.ts`) — normalises risk across the compared set, so it answers
  "which of these is riskier" rather than an absolute score.
- **`findReplacements`** — squad-aware: the outgoing player's price is spendable, their club slot is
  freed, and risk feeds the ranking alongside xP and fixture.
- **The squad optimiser's `RiskLevel`** — reuses the risk band the cold-start prior already produces
  (mean vs. lower-bound) rather than inventing a second discount coefficient. See
  [cold-start-priors.md](cold-start-priors.md#how-this-interacts-with-squad-building).

## Disclosed omissions elsewhere in the app follow the same pattern

`CAPTAIN_MODEL_NOTE` (`lib/lineup.ts` — TeamAttack term dropped, team strength is zero pre-season),
`COMPARISON_MODEL_NOTE` / `REPLACEMENT_MODEL_NOTE` (`lib/scoring.ts`), `SEASON_HORIZON_NOTE`
(`lib/team-state.ts`), `TRANSFER_MODEL_NOTE` (`lib/transfers.ts`), `TRANSFER_OPTIMIZER_NOTE`
(`lib/transfer-optimizer.ts`) — every one of these is a term the model can't compute honestly today,
dropped rather than faked, and stated next to the number it affects.
