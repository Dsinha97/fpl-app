# Risk scoring

One risk number, shared by every engine that needs to weigh "could go wrong" against "expected
points" — rotation risk, injury, minutes uncertainty, fixture variance.

## The formula

The original spec:

```
RiskScore = 0.30 Rotation + 0.25 Injury + 0.20 Minutes + 0.15 FixtureVariance − 0.10 EO
```

EO (effective ownership) here means the **field's** ownership — every FPL entry, or at least a top-1k
sample of it. League 314 ("Overall") is provably syncable at that scale now (a Sprint 29 follow-up
load-test synced 2000 rank-ordered entries end to end, 0 failures — see
[ownership-and-leagues.md](ownership-and-leagues.md)#the-field-wide-top-1k-sample-whats-actually-still-blocked)),
but nobody has run and kept a real sample or wired it into this formula — a different quantity from
the exact mini-league EO that *did* unblock and ship as its own page (`/leagues`) at the GW1
deadline, scoped to a few-hundred-person league rather than the whole field. So the term is
**dropped and the remaining four weights renormalised** over the surviving 0.90:

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

  **Its form term came back on 2026-08-30 (Sprint 30 §0).** `COMPARISON_WEIGHTS` had dropped FPL's
  `form` term and renormalised the rest over 0.90, on the documented grounds that FPL zeroes `form`
  between seasons — true when written, expired the moment GW1 was scored. `/compare` now uses the
  plan's full five-term weighting (0.40 xP / 0.20 fixture / 0.15 value / 0.15 minutes / 0.10 form,
  normalised against the compared group's own max) whenever `form` is present. This is the "drop,
  renormalise, disclose" rule running in reverse — an expired premise is a stale disclosure, and the
  column's hint text, which still told the reader form "reads 0 for everyone pre-season", was
  corrected in the same pass.

  Scoped deliberately narrowly: `ScoredPlayer.form` is optional, following `reliability`/
  `priorWeight`, so the seven other construction sites keep the four-term weights and needed no
  change — `comparePlayers` is only ever called from `/compare`. Verified live (Haaland 7.5 vs.
  Palmer 10.0, folding into each score with the new note rendering). Note this is the *comparison
  layer* only; the xP engine itself still has no current-season form in it, and
  [xp-model.md](xp-model.md) records why two attempts to put it there have failed the backtest gate.
  — [sprints/sprint-30.md](../sprints/sprint-30.md#0-xp-comparison-layer-restore-the-form-term-compare)
- **`findReplacements`** — squad-aware: the outgoing player's price is spendable, their club slot is
  freed, and risk feeds the ranking alongside xP and fixture.
- **The squad optimiser's `RiskLevel`** — reuses the risk band the cold-start prior already produces
  (mean vs. lower-bound) rather than inventing a second discount coefficient. See
  [cold-start-priors.md](cold-start-priors.md#how-this-interacts-with-squad-building).

## Disclosed omissions elsewhere in the app follow the same pattern

`CAPTAIN_MODEL_NOTE` (`lib/lineup.ts` — TeamAttack term dropped; the attack/defence strength it
needs is still zero in-season, though the *overall* strength fields are not — corrected 2026-09-02,
see [fpl-api-constraints.md](fpl-api-constraints.md)),
`COMPARISON_MODEL_NOTE` / `REPLACEMENT_MODEL_NOTE` (`lib/scoring.ts`), `SEASON_HORIZON_NOTE`
(`lib/team-state.ts`), `TRANSFER_MODEL_NOTE` (`lib/transfers.ts`), `TRANSFER_OPTIMIZER_NOTE`
(`lib/transfer-optimizer.ts`) — every one of these is a term the model can't compute honestly today,
dropped rather than faked, and stated next to the number it affects.
