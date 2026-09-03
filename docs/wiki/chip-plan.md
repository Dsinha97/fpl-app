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
anything reconciles the two — `activeChip` always wins at the gameweek it belongs to.

### The fact half, and how it reaches the numbers (Sprint 31)

`chipAt` had **zero callers** until Sprint 31 — the reconciliation above was written and then
never wired up, so an FPL-reported chip changed nothing anywhere. Three pieces close that:

- **`fplActiveChipAt(state, event)`** is `chipAt`'s fact half on its own. Anything that *states*
  a chip is in play — the `/deadline` status pill, the ContextBar's Chip field — must use this and
  never `chipAt`, or it will label a planned chip as something that has already happened.
- **`TeamState.activeChipEvent?: number | null`** is the gameweek the active chip belongs to, from
  `my-team`'s `played_by_entry` or the `manager_gameweeks` row's own event. Optional, falling back
  to `gameweek` for drafts saved before it existed. Without it, `activeChip` is pinned to whatever
  gameweek an import was stamped with, so once that deadline passes the same saved draft claims
  last gameweek's chip is live in this one — reproduced in Sprint 31's harness.
- **`chipEntriesInForce(state, usable, event)`** merges the fact into `validateChipPlan`'s
  `usable` output as a synthetic `source: "fpl"` entry. This is the piece that matters for the
  numbers: a chip already in play is not a *choice* the optimiser can still make, but it is very
  much a term in this gameweek's points. Without it, `/deadline` scored a Triple Captain squad as
  if the captain were merely doubled, and offered Triple Captain as an available `+gain` in the
  same breath.

Anything rendering a chip slug goes through **`chipLabel`** — `activeChip` is an untyped string
FPL owns, and `/transfers` and `/review` were both printing a bare `3xc` at users.

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

## A second real bug: the opening gameweek's bonus chip (Sprint 18)

Every *later* gameweek in `planTransferPath` already ran a pinned Bench Boost/Triple Captain
through `chipBonusOf` correctly. The **opening (deadline) gameweek branch hardcoded `chipBonus: 0`**
regardless of what was pinned there — `optimizeTransfers`'s own branch *ranking* already accounted
for the bonus (via `chipAdjustedTotal`), so the recommended branch was always correct, but the
*displayed* total for a plan whose first chip lands next gameweek understated the real value by the
whole bonus. This is exactly the front-loaded sequence's opening move (Bench Boost at the very next
deadline), so it was hit immediately on real use.

Verified live, not in a synthetic harness: pinned Bench Boost to GW1 on a real squad, ran the
Transfer Path. Before the fix the GW1 step read `+0.3 xP + 0 chip`; after, `+0.3 xP + 15.9 chip`,
matching the deadline optimiser's own independent `+15.9 GW1 bench boost` figure exactly.
— [sprint-18.md](../sprints/sprint-18.md)

## Calendar-derived sequence presets (Sprint 18)

`/chips` gained a "Chip sequences" section offering three starting points, each written through the
existing `setChipPlanEntry` (no new state) and each checked against the real `chip_definitions`
window before being offered — one that doesn't fit is simply omitted, not shown broken:

- **Front-loaded** — Bench Boost / Free Hit / Wildcard across the opening three gameweeks. Only
  offered when it's genuinely still the season's opening (a "front-loaded" sequence starting
  mid-season contradicts its own premise).
- **Early-information anchor** — a Wildcard after a fixed number of real gameweeks, once
  starts/minutes/form begin to diverge from the prior-seasons rates every projection is built from.
- **Break pivot** — a Wildcard timed to the season's largest gap between deadlines, computed from
  `gameweeks.deadline_time` at call time (this season: GW5→GW6, 22 days).

None of these are the video that inspired them's literal dates — a different season's calendar has
nothing in this repo to check it against, the same move [hidden-gems.md](hidden-gems.md) made with
its source's literal percentile thresholds.

**A third real bug, also caught against live data**: `chip_definitions` carries **two rows per chip
name** — one per season half. The first implementation collapsed them into a `Map` keyed by chip
name, which silently kept whichever half's row happened to be last in the fetched array; all three
presets computed to zero on real data as a result. Fixed by searching every matching row for the one
whose window actually contains the target event. A related trap: Wildcard's own window never covers
GW1 (it opens GW2), so "which half is GW1 in" can't be answered from Wildcard's own definition —
Bench Boost's definition (which does cover GW1) locates the half correctly instead, since all four
chips share the same two half boundaries.

Presets deliberately don't touch `runChipEngine`/`bestSchedule` — those answer "when is each chip
individually best," a different, still-correct question. The sequence view is a second lens over the
same valuations, routed through `planTransferPath` above, not a competing implementation.

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
