# Lineup, captain & bench

Picks the starting XI, captain/vice, and bench order from a squad — `lib/lineup.ts`,
`optimiseLineup`.

## XI selection

Maximises plain **Σ xP**, deliberately with no extra minutes multiplier — xP is already scaled by
expected minutes, and double-counting would punish rotation risk twice.

## Captain / vice

`computeProjection` weights the armband bonus by availability, so a doubtful captain's projection
falls back toward the vice rather than assuming the doubtful player plays. `setViceCaptain` **swaps**
rather than vacating the other armband (`lib/team-state.ts`).

`CAPTAIN_MODEL_NOTE` discloses a dropped term: the spec's TeamAttack component can't be computed
because team strength is zero for all 20 clubs pre-season — see
[blocked-and-data-gaps.md](blocked-and-data-gaps.md).

## Bench order

Uses a **Poisson substitution probability**: `λ = Σ(1 − playProbability)` over the ten outfield
starters, with the reserve keeper pinned to slot 0. `benchExpectedContribution` (the bench's
expected value *without* a chip) feeds both [squad-score-and-scenarios.md](squad-score-and-scenarios.md)
and the Bench Boost chip valuation — see below.

## Bench cost (Sprint 18)

Only the starting 11 score points, so a squad's money splits between an XI that earns and a bench
that (mostly) doesn't — nothing computed that split before `lib/squad-budget.ts`'s `squadBudget`,
despite every ingredient already existing (`SquadPick.purchasePrice`, `TeamState.startingXI`/
`benchOrder`, this page's own XI/bench split). Returns `{spent, bank, xiSpend, benchSpend,
benchFloor, benchSurplus}` — `benchFloor` is the cheapest *legal* bench for the XI's actual
formation, computed from the live price list at call time (today: GK/DEF £4.0m, MID/FWD £4.5m), not
a flat cap borrowed from a source with a different season's prices. `benchSurplus = benchSpend −
benchFloor` is the actionable number: money parked on players who don't score.

**A real bug caught during verification, not review**: a validated-split check (`isValidSplit`) was
added after a real imported draft's `benchOrder` referenced a `playerId` no longer in `players` at
all — stale from before a transfer. Silently pricing the missing player at 0 would have understated
`benchSpend` without ever surfacing that anything was wrong; an inconsistent split now reports
`splitKnown: false` instead, the same honesty `benchExpectedContribution` already applies when no
lineup is set. Surfaced on `/builder`'s budget panel and `/team`'s current-squad view as
`XI £Xm · bench £Ym (£Zm above the cheapest legal bench)`. — [sprint-18.md](../sprints/sprint-18.md)

Bundled with this: the `spent = Σ purchasePrice` reduce, previously duplicated across 11 call sites
in 9 files, is now `squad-budget.ts`'s exported `totalSpend` — one implementation, per
[methodology.md](methodology.md).

## Reused by, not duplicated in

- **[chip-strategy.md](chip-strategy.md)** — Bench Boost and Triple Captain call `optimiseLineup`
  unchanged rather than reimplementing lineup logic; Bench Boost's value is reported **net** of what
  auto-subs already deliver, since `benchExpectedContribution` already prices the no-chip case.
- **[squad-score-and-scenarios.md](squad-score-and-scenarios.md)** — `BenchStrength` in `SquadScore`
  is computed against each draft's own best XI via this engine, not whatever lineup happens to be
  stored, so a draft that's been through the optimiser isn't compared unfairly against one that
  hasn't.
- **/builder and /scenarios inline chip values** — `benchBoostAt`/`tripleCaptainAt` (`lib/chips.ts`)
  are exported and called directly on both pages, cheap enough (one `optimiseLineup` call) to run on
  every edit, unlike Free Hit/Wildcard which stay `/chips`-only because a full-squad rebuild search
  is too slow for live editing.
