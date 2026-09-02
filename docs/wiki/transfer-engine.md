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
  single implementation `lib/transfers.ts:118`; nothing else recomputes it. Having one
  implementation is not the same as every caller reaching for it: Sprint 30 (2026-08-30) found
  `findReplacements` and `replacementLegality` (`lib/scoring.ts`) and `/builder`'s replace-picker
  price ceiling all still computing what selling a player frees up from his raw purchase price, and
  routed all three through `sellPrice`. `components/context-bar.tsx`'s squad value was checked in
  the same pass and pronounced already correct — which turned out to be one level too shallow: the
  formula was right, but what `budget` itself held was not. That chase is §3–§4 of the sprint file and
  ends in the bank rule below.
  — [sprints/sprint-30.md](../sprints/sprint-30.md#2-three-defects-filed-from-the-shipped-app)
- **Risk shares `riskPoints`** with [squad-score-and-scenarios.md](squad-score-and-scenarios.md), so
  the two screens can't disagree about the same squad.
- **Bank is stored cash, not a residual (2026-09-02).** `squadBank` (`lib/squad-budget.ts`) is the
  one implementation of "what's left to spend", and reads `TeamState.bank` directly. It replaced
  three divergent copies, two of them here: `metricsFor`'s `bank` and the forward path's funder
  sort both computed `budget − Σ purchasePrice`, while `validateSquad` and `replacementLegality`
  computed `budget − Σ sellPrice` — same name, three different numbers. See
  [frontend-conventions.md](frontend-conventions.md#bank-is-the-stored-primitive-budget-is-derived-2026-09-02)
  for why the residual form was wrong in the first place.
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

### Reversibility: reported, never ranked (Sprint 18)

`findReplacements` gained an opt-in `filters.reversibility` flag. When set, each candidate's
`Replacement` carries `exitRoutes`: how many *other* pool players at the incoming player's position
remain legally reachable (`replacementLegality`'s own position/budget/3-per-club checks) with one
more free transfer after this swap. Off by default — an O(pool) scan per candidate is fine for the
handful of rows a Replacement Finder panel shows, wasteful inside this optimiser's own beam search,
which calls `findReplacements` far more often; no search-path call site sets it.

Same shape as `squadBalanceDelta` before it, and the same standing precedent: a modelled
`FutureFlexibility` term was rejected above in favour of computed, disclosed facts, never folded
into `teamFit` — `exitRoutes` follows exactly that pattern rather than inventing a second one.
Verified live that `teamFit` is unchanged with the flag on or off, across the full candidate pool.
Wired into `/builder` and `/transfers`' replacement panels as an "N exit routes" line.
— [sprint-18.md](../sprints/sprint-18.md)

### Chip-aware, when a plan is pinned

`OptimizeTransfersInput.chip` (a `ChipContext` resolved by the caller from `TeamState.chipPlan` —
see [chip-plan.md](chip-plan.md)) threads through every branch's `simulateTransfers` call: a
planned Bench Boost/Triple Captain adds its bonus, a planned Free Hit/Wildcard masks the gameweeks
it overwrites. Absent, every branch is byte-identical to the pre-chip-plan build — verified against
live data, not assumed. A Wildcard planned for exactly the deadline gameweek blocks the paid-
transfer branches outright (every wildcard move is free, so a hit is never correct); a Free Hit
planned there adds a new `freehit` branch.

### Uncovered, with reasons

- **Free Hit at a *future* gameweek** — the deadline branch above only appears when Free Hit is
  planned for the deadline itself; a Free Hit further out is priced by the forward transfer path
  instead ([chip-plan.md](chip-plan.md)).
- **True multi-gameweek scheduling of ordinary transfers** (which of several future gameweeks to
  move in, absent a chip plan) — the later weeks of a frozen projection are its least trustworthy
  part, so this optimizer's own scope stays 1–2 gameweeks. [chip-plan.md](chip-plan.md)'s bounded
  forward path covers the case a chip plan actually needs — sequencing transfers *around* pinned
  chips — with its own disclosed approximations, not this one's full search.

## One answer per deadline (Sprint 28, 2026-08-29)

`/transfers` and `/deadline` each used to render `TransferPlan`
(`optimizeTransfers().recommended`) **and** `TransferPath`
(`planTransferPath().recommended.openingMove`) — two headlines answering "what should I do at this
deadline", side by side, disagreeing, with nothing reconciling them. The path is now the only
recommendation on both pages.

Strictly neither was a second *scorer*: both bottom out in `simulateTransfers`, and
`projectAtEvent`/`riskPoints` each have one implementation. The "one quantity, one implementation"
rule bit a level up — the *decision* had two — and the disagreement turned out to be three real
defects in `planTransferPath` rather than a difference of framing. All three were fixed **before**
the path became the sole answer, so nothing knowingly wrong was left as the single headline:

1. **The horizon toggle was ignored.** The opening `optimizeTransfers` call hardcoded `horizon: 5`,
   so changing the page horizon moved the plan and left the path's opening move untouched. Now
   `TransferPathInput.horizon`. Gameweeks *after* the deadline still score at horizon 1 — correct
   and already disclosed, since each contributes its own event's prediction and nothing wider.
2. **`decisionMargin` was applied on one side only.** `rollBranch` adds it to the net; the path
   scored rolls on raw event xP, so "hold" won far more readily on the plan than on the path — a
   disagreement caused by *an input the owner sets*, not a prediction. `TransferPathStep` now
   carries `decisionMargin` as its own term, credited to any step that buys nothing and plays no
   chip, and summed into `TransferPath.terms` so the headline stays a term sum.
3. **The roll branch leaked next gameweek's squad — a genuine correctness bug.** `rollBranch`
   returns `moves: []` but `simulation: basket.sim`, the simulation of *next* week's basket, kept
   only to price what waiting buys. The path's opening mapper read `sim.resultingTeam`
   unconditionally, so a roll **fielded, scored and carried forward a squad with next week's
   transfers already applied, at zero cost, while labelling the step "roll"**. A roll now carries
   the unchanged squad, attaches no simulation, and costs nothing; the deferred basket's value
   appears where it belongs, as the next step's own `eventXp`.

`optimizeTransfers` and `components/transfer-plan.tsx` are **not** deleted — `planTransferPath`
calls the former for its opening gameweek (the path *is* built on the plan). The optimiser stopped
being a competing headline; it did not stop being the engine.

Two consequences worth knowing:

- **`TransferPath` gained a `Load` button on its opening step.** `TransferPlan`'s per-branch Load
  was the only wiring from a recommendation into `/transfers`' manual basket and the
  Apply-as-new-draft flow; removing the plan without this would have orphaned that flow. Only the
  opening step is loadable — every later step depends on a squad that does not exist yet.
- **`/transfers` auto-runs the path on load**, with the signature/staleness pattern `runPlan` used,
  so the page still answers on arrival rather than only after a click. `/deadline` keeps the path
  button-gated, as it always did.

Verified against live data in a throwaway `npx tsx` harness before the UI was touched: distinct
openings across horizons; Σ`decisionMargin` equal to `rolls × margin` at margins 0/1/6/20; an
opening roll at margin 20 with zero leaked squads. Full detail:
[sprint-28.md](../sprints/sprint-28.md).

See also: [squad-optimizer.md](squad-optimizer.md) (the wildcard branch's underlying engine),
[deadline-and-matchday.md](deadline-and-matchday.md) (where the optimizer surfaces pre-deadline),
[chip-plan.md](chip-plan.md) (chip-aware scoring and the forward transfer path).
