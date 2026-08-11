# Sprint 8 — Transfer Simulator

**Status: built.** See [../roadmap.md](../roadmap.md) for the sprint index.

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
