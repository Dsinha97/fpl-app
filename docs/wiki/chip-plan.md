# Chip strategy planning

The owner pins a chip to a gameweek, and the deadline optimiser and a bounded forward transfer
path both work *against* that plan — closing the gap [chip-strategy.md](chip-strategy.md) itself
names: "a Triple Captain shown after a scheduled Wildcard does not yet reflect the rebuilt squad."

## The plan is data, not a fact

`TeamState.chipPlan?: ChipPlan` (`lib/team-state.ts`) is a sorted array of `{ chip, event, source,
pinnedAt }` entries, optional so every existing draft keeps parsing. It rides the existing
`team_drafts.payload` jsonb sync — no migration.

It is deliberately **separate from `activeChip`**: `activeChip` is FPL's own report of a chip
already live on the squad (imported, fail-closed, untyped because FPL owns the value); `chipPlan`
is the owner's forward intention. `chipAt(state, event)` (`lib/chip-plan.ts`) is the one place
anything reconciles the two — `activeChip` always wins at the draft's own gameweek.

`validateChipPlan` checks every entry against the real `chip_definitions` windows: the chip has an
open window covering that gameweek, at most one chip per gameweek, at most one of a given chip per
half (a half is *which `chip_definitions` row* the gameweek falls in, never an assumed GW19
boundary), and no conflict with a live `activeChip`. A null `stop_event` (open-ended window) is
resolved to the season's last gameweek via `resolveStopEvent`, not left to coerce to `0`.

`components/chip-plan-editor.tsx` is the shared editor, mounted on `/transfers` and `/deadline`
(the pages that already run the optimiser) — one `<select>` per chip per half, populated from that
chip's own windows. Writes go straight to the draft (`saveDraft({ ...team, chipPlan })`) rather
than forking a new one: a chip plan is a property of the squad you hold, not a transfer result.

## How a plan changes the deadline optimiser

Two mechanisms, both per-event (`lib/chip-plan.ts`):

- **Bench Boost / Triple Captain** at gameweek *n* — an additive bonus, `chipBonusAt`, delegating
  to `benchBoostAt`/`tripleCaptainAt` (the same functions [chip-strategy.md](chip-strategy.md)
  already documents) so the quantity has exactly one implementation.
- **Free Hit / Wildcard** at gameweek *n* — an event *mask*. Free Hit masks its own gameweek only
  (moves made *in* that gameweek still persist afterwards); Wildcard masks every gameweek from *n*
  through the horizon's end, because a rebuild overwrites everything before it. The subtraction
  reuses `projectAtEvent` — the same function `rollBranch` already uses for its forfeited-gameweek
  arithmetic ([transfer-engine.md](transfer-engine.md)) — so "near-worthless" falls out of the
  arithmetic rather than an invented coefficient.

`lib/transfers.ts`'s `simulateTransfers` takes an optional `chip` input; `xpDelta` is expressed
through `chipAdjustedTotal`, which falls back to the plain `projection.total` when no chip plan
touches the horizon — verified byte-identical to the pre-chip-plan build against live data. A
planned Wildcard at the deadline gameweek itself blocks the paid-transfer branches (`transfers`,
`hit`) with a reason, since every wildcard move is free; a planned Free Hit adds a new `freehit`
branch (`lib/chips.ts`'s `freeHitRebuildAt`, promoted from the private `freeHitAt`) that appears
only when Free Hit is pinned to the exact deadline gameweek.

**A real bug the verification harness caught**: when a Wildcard was planned for exactly *next*
gameweek, `rollBranch` forfeited that gameweek's value once via `projectAtEvent`, then subtracted
it again because the basket's own chip-masked total had already zeroed almost everything else —
reading as a misleadingly small number instead of "rolling costs nothing, the wildcard overwrites
it anyway." Fixed with an explicit early return once `chipForcedAt(input.chip, event + 1) ===
"wildcard"`.

`components/transfer-plan.tsx` shows a "Conditioned on: Bench Boost GW5, Wildcard GW8" banner and
decomposes each branch's arithmetic to name the chip terms inline, never folding them into a bare
net — the same "say what the number means" discipline every other headline in this app follows.

## The forward transfer path

`lib/transfer-path.ts`'s `planTransferPath` answers the harder question: not just this deadline,
but what to do at every gameweek up to the last planned chip — rolling free transfers into a deep
bench before a Bench Boost, not spending before a Wildcard.

Full sequencing is combinatorially out of reach, so this is an explicitly bounded search:

- The **deadline gameweek reuses `optimizeTransfers`'s real basket search** verbatim — no second
  implementation of that decision.
- **Every later gameweek** uses a much narrower beam: `PATH_CANDIDATES_PER_SLOT` (3) replacements
  per slot, up to `PATH_MAX_BASKET` (2) moves, carrying the top `PATH_STATE_BEAM` (4) squad states
  forward. Candidates are ranked by `findReplacements` at horizon 1 — the model has no other
  per-future-gameweek signal — but each candidate's own *value* is still the real per-event
  prediction for that gameweek, via `projectAtEvent`.
- **Chip gameweeks are forced, not searched.** A Wildcard replaces the carried state with
  `wildcardRebuildAt`'s rebuild and keeps accruing free transfers (real FPL does not reset the
  bank at a wildcard); a Free Hit fields `freeHitRebuildAt`'s rebuild for one gameweek only and the
  carried state reverts untouched.
- **Path length is derived from the plan**, not fixed: `min(windowEnd, max(lastPlannedEvent,
  nextEvent+2), nextEvent + PATH_MAX_EVENTS(6) - 1)` — a plan with no chips produces a short path; a
  Bench Boost three gameweeks out extends the search exactly that far and no further, verified
  directly against live data (a no-plan path stopped three gameweeks short of an otherwise-identical
  plan's Bench Boost gameweek).
- Every step's contribution is `projectAtEvent(fielded, event) − projectAtEvent(original squad,
  event)` — a gain over holding today's squad unchanged, the same convention every other headline
  in this app uses, so steps sum without double-counting.

`TRANSFER_PATH_NOTE` states the honesty boundary directly: bounded, not optimal; chip timing is the
owner's, nothing here moves a chip to a better gameweek; prices are frozen so a rise that funds a
later move is not modelled, and neither is news that has not happened yet.

Gated behind a "Plan the path" button on both `/transfers` and `/deadline` — like `/chips`' Free
Hit/Wildcard rebuilds, this runs `optimizeSquad`-class searches that do not belong in an eager
memo. On a real 15-player squad against live data it ran ~1,200 additional simulations in well
under half a second, but it is still never triggered on page load.

## Pinning from `/chips`

`/chips` stays the read-only valuation page from [chip-strategy.md](chip-strategy.md), with one
addition: a 📌 "Pin to plan" button on every shortlist row and schedule entry, writing through the
same `setChipPlanEntry` the editor uses (`source: "shortlist"`, distinguishing it from a manual
pin). "Pin whole schedule" pins every entry in one of the two season-half schedules at once, and is
disabled when `half.oneOff.margin < 1` — the page already knows a flat schedule isn't a real
recommendation ([chip-strategy.md](chip-strategy.md)); it must not let one be pinned as though it
were.

See also: [chip-strategy.md](chip-strategy.md) (the underlying valuations),
[transfer-engine.md](transfer-engine.md) (the simulator and deadline optimiser this plan
conditions), [frontend-conventions.md](frontend-conventions.md) (`TeamState`, horizon conventions).
