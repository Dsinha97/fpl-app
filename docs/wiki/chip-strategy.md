# Chip strategy engine

Per-gameweek value for Bench Boost, Triple Captain, Free Hit and Wildcard, plus a joint schedule
that places all four without reusing a gameweek — `/chips`, `lib/chips.ts`, Sprint 12.

```
ChipValue = xP(with chip) − xP(without)
```

evaluated against `chip_definitions`' real windows (GW1–19, GW20–38 for 2026/27).

## One new primitive, everything else reused

`lib/chips.ts` adds a per-gameweek-event view of a squad/pool, then calls
[lineup-captain-bench.md](lineup-captain-bench.md)'s `optimiseLineup` for Bench Boost/Triple Captain
and [squad-optimizer.md](squad-optimizer.md)'s `optimizeSquad` for Free Hit/Wildcard **unchanged** —
so the knapsack fill-order fix and bench-substitution maths stay defined in exactly one place.
Squads are compared with `projectAtEvent`/a windowed sibling, since Wildcard's remaining-window
horizon doesn't fit any fixed `Horizon` value.

## Rules worth knowing

- **Bench Boost is net of auto-subs.** `benchExpectedContribution` already prices what the bench
  earns on a normal week; charging for it again would overstate every Bench Boost.
- **Triple Captain reports two figures** — gain with today's armband, and with the model's own best
  captain for that gameweek — because the best target is often not today's captain.
- **Free Hit always re-optimises the armband** (it's a one-week rebuild); **Wildcard does not** (the
  squad persists, the captain is a separate ongoing decision) — mirroring the transfer optimizer's
  own wildcard treatment exactly.
- **Today's fixture list has no blanks or doubles anywhere** (measured directly from `fixtures`) —
  Bench Boost/Triple Captain draw most of their real value from doubles, Free Hit from blanks, so
  every value today reads comparatively flat. `countBlanksAndDoubles`/`chipModelNote` compute this
  live so the disclosure updates itself the moment a real blank/double appears.
- **Only the first chip window is evaluable** — predictions reach GW19, so the GW20–38 half of every
  chip is reported *blocked with a reason*, following the "a blocked option that vanishes reads as a
  bug" pattern used throughout this app.
- **The joint schedule is a small exact search** (brute-forced, a few dozen candidates per chip),
  runs once per half (a real bug — `bestSchedule` originally only assigned one slot per chip *ever*,
  silently dropping the second half's use), and reports its margin over the next-best assignment.
- **The schedule splits units that don't sum.** Bench Boost/Triple Captain/Free Hit are single-
  gameweek gains (additive, own total); Wildcard is a cumulative rebuild valued over the rest of its
  half — a fixed defect where a single "Total" once mixed both kinds of number meaninglessly.

## A real bug this engine's harness caught

`windowTotal` (Wildcard's remaining-window sum) defaulted a missing prediction to `0` rather than
`null`. The squad optimiser treats `null` as "no data" (excluded from the reserve floor) and `0` as
a real, unappealing projection (included) — so an unpredicted player was silently read as a genuine
zero-xP pick, skewing the reserve floor. Caught by the `tsx` harness against live data before it
reached the UI. Same failure class as [squad-optimizer.md](squad-optimizer.md)'s fill-order bug.

## Also inline elsewhere

Bench Boost/Triple Captain values are exported (`benchBoostAt`/`tripleCaptainAt`) and computed live
on `/builder` and `/scenarios` — see [lineup-captain-bench.md](lineup-captain-bench.md). Free Hit and
Wildcard rebuilds stay expensive `optimizeSquad`-class searches, never eager — but `/chips` is no
longer the only place they run: [chip-plan.md](chip-plan.md)'s forward transfer path calls them too,
behind its own gate.

## The gap this page's own note names, now closed

`chipModelNote` still discloses, correctly, that a valuation here is scored against *today's*
squad regardless of what the schedule plays first. That gap — a Triple Captain shown after a
scheduled Wildcard not reflecting the rebuilt squad — is what pinning a chip to `TeamState.chipPlan`
and running the deadline optimiser or the forward transfer path against it closes. See
[chip-plan.md](chip-plan.md).

See also: [chip-plan.md](chip-plan.md) (pinning a chip to a gameweek, and the chip-aware optimiser
and forward transfer path this feeds), [deadline-and-matchday.md](deadline-and-matchday.md)
(this-gameweek-only chip calls on the Deadline Hub), [squad-score-and-scenarios.md](squad-score-and-scenarios.md)
(the wildcard toggle on the manual transfer basket).
