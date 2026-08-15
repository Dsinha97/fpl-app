# Transfer engine (simulator + optimizer)

Two layers on `/transfers`: a manual basket simulator, and an automated weekly recommendation that
scores every option through the same simulator.

## Simulator (`lib/transfers.ts`, Sprint 8)

A **basket** of out/in pairs applied in order against a working copy, so cash freed by move one
funds move two — the way FPL actually behaves.

```
TransferGain = xP(after) − xP(before) − pointsCost − riskPointsChange
```

- **The hit is always its own term** — the headline reads `+8.5 xP − 8 hit − 0.2 risk = +0.3`, never
  a bare net figure, so a basket that only breaks even looks like one.
- **`sellPrice`** follows FPL's rule exactly (purchase price + half of any rise, rounded down) — the
  single implementation `lib/transfers.ts:118`; nothing else recomputes it.
- **Risk shares `riskPoints`** with [squad-score-and-scenarios.md](squad-score-and-scenarios.md), so
  the two screens can't disagree about the same squad.
- Selling the captain moves the armband and prices that as part of the cost.
- **Apply writes a new draft** ("`<draft> +n transfers`"), leaving the original untouched.
- Free-transfer **accrual** (`accrueFreeTransfers`, Sprint 9) — one per gameweek, capped at 5,
  clamped both ends so a hand-typed value can't manufacture an allowance.

## Optimizer (`lib/transfer-optimizer.ts`, Sprint 9)

Answers the weekly question — roll, spend one, spend two, take a hit, or wildcard — for a panel atop
`/transfers`. **Every option is scored by `simulateTransfers`**, the exact simulator above, so a
recommendation can never contradict the manual basket; verified to agree to the decimal.

### Why the literal spec formula isn't implemented

The spec asked for `TransferValue = ExpectedGain − TransferCost − Risk` vs.
`RollValue = FutureFlexibility + ExpectedFutureGain`, recommending a transfer when the first exceeds
the second plus a margin. Against this app's frozen 8-gameweek projection, **roll can never win
literally** — the same gain is visible next week too, so acting today just collects one more
gameweek of it. Inventing a `FutureFlexibility` number large enough to make roll sometimes win would
be "a fudge factor wearing a model's clothes."

Instead, what's genuinely computable is priced, and what isn't is made an explicit input:

| Reason to roll | Treatment |
|---|---|
| Banking to afford a two-leg move you can't split into two singles | Computed — a funding chain |
| Two free transfers next week avoid this week's −4 | Computed |
| News/injuries/price moves not yet known | **Input**: `decisionMargin`, default 1 point, shown as its own `+1 news` term, settable to 0 |

This is the precedent for CLAUDE.md's "when a term cannot be dropped, make it an input" rule — see
[methodology.md](methodology.md). `projectAtEvent` mirrors `computeProjection` term-for-term against
the *per-gameweek* prediction series, so the cost of waiting is priced exactly, not by a `(H−1)/H`
approximation that would misprice a blank or double.

### Search

A **beam search** over `findReplacements` candidates (one move ≈ 90 candidates, two ≈ 40 million —
exhaustive is out). The beam explicitly carries **funders alongside winners** (`FUNDER_WIDTH`):
selling a premium to fund an upgrade elsewhere scores badly *alone*, so a beam ranked purely by gain
prunes the funding leg before its payoff leg exists — the same failure mode the squad optimiser had
with its reserve floor.

**Wildcard** reads its real window from `chip_definitions` (wildcard #1: GW2–19) and is shown
*blocked* with a reason in GW1 rather than hidden — "a blocked option that vanishes reads as a bug;
its reason is information." It also doesn't re-optimise the armband, so its gain is deliberately
**understated**, disclosed via `TRANSFER_OPTIMIZER_NOTE` — understating-with-disclosure is
acceptable, overstating is not.

**Confidence** is derived (low when the top two options are within a point, or the squad has
undicted picks) and worded, never a fabricated percentage.

### Uncovered, with reasons

- **Free Hit** — needs a one-week squad that reverts; delivered separately in
  [chip-strategy.md](chip-strategy.md).
- **Multi-gameweek scheduling** (which of 8 gameweeks to move in) — the later weeks of a frozen
  projection are its least trustworthy part, so the honest scope stops at 1–2 gameweeks.

See also: [squad-optimizer.md](squad-optimizer.md) (the wildcard branch's underlying engine),
[deadline-and-matchday.md](deadline-and-matchday.md) (where the optimizer surfaces pre-deadline).
