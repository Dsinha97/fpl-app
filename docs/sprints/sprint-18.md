# Squad Structure & Chip Sequencing (Sprint 18, built 2026-08-19)

**Status: built and verified against real data.** GW1's deadline was ~2 days out when this
landed (2026-08-21 17:30 UTC).

## Why this exists

An experienced FPL manager's strategy breakdown ("The 7 Levels of FPL Strategy") was reviewed for
ideas worth adopting. Three of its four proposals survived checking; one was refused outright (see
below). Same governing precedent as Hidden Gems (Sprint 15.5): take the shape of an idea, replace
its literal numbers with ones derived from this app's own data — a different season's £17.5m bench
cap or GW4/GW8 wildcard dates have nothing in this repo to check them against.

Two findings reshaped scope before any code was written. Chip *pinning* already existed end to end
(`setChipPlanEntry`, `ChipPlanEditor`, one-click "pin whole schedule" on `/chips`), so named presets
are thin sugar over it. The real gap was that `lib/chips.ts` values every chip independently against
today's squad — `chipModelNote` discloses this outright — so nothing could answer "what is GW1 Bench
Boost → GW2 Free Hit → GW3 Wildcard worth *as a sequence*." `lib/transfer-path.ts` already carries
squad state across forced chip steps, so this turned out to be a bug fix and a UI layer, not a new
engine.

## What was built

### 1. Effective Starting XI budget (`lib/squad-budget.ts`)

Nothing in the app computed the XI-vs-bench money split before this, despite every ingredient
existing (`SquadPick.purchasePrice`, `TeamState.startingXI`/`benchOrder`, `optimiseLineup`'s split).
`squadBudget(state, rules, lookup, allPlayers, lineup?)` returns `{spent, bank, xiSpend, benchSpend,
benchFloor, benchSurplus}`. `benchFloor` is the cheapest *legal* bench for the XI's actual formation,
computed from the live price list at call time — not the source's flat £17.5m cap. Verified today's
cheapest-per-position: GK £4.0m, DEF £4.0m, MID/FWD £4.5m.

**A real bug surfaced during verification, not review.** A validated-split check
(`isValidSplit`) was added after a real imported draft's `benchOrder` referenced a `playerId` no
longer in `players` at all — a stale cache from before a transfer. Silently pricing the missing
player at 0 would have understated `benchSpend` without ever surfacing that anything was wrong.
Now an inconsistent split reports `splitKnown: false` rather than a wrong number, matching
`squadScore`'s existing honesty about `benchStrength`.

**Bundled cleanup.** `spent = Σ purchasePrice` was duplicated across 11 call sites in 9 files
(`lib/drafts.ts`, `lib/fpl-squad.ts`, `lib/optimizer.ts`, `lib/scoring.ts`, `lib/squad-score.ts`
×2, `lib/transfer-path.ts` ×2, `lib/transfers.ts`, `app/builder/page.tsx`, `app/scenarios/page.tsx`)
— a live "one quantity, one implementation" violation. All now route through
`squad-budget.ts`'s exported `totalSpend`.

**Surfaces:** `/builder`'s budget panel and `/team`'s current-squad view, both showing
`XI £Xm · bench £Ym (£Zm above the cheapest legal bench)` when the split is known.

### 2. Chip sequence valuation

**A real, previously-invisible bug fix in `lib/transfer-path.ts`.** `planTransferPath`'s opening
(deadline) gameweek branch hardcoded `chipBonus: 0` regardless of what was pinned there — every
*later* gameweek's Bench Boost/Triple Captain already went through `chipBonusOf` correctly, but the
opening step never did. `optimizeTransfers`'s own branch *ranking* already accounted for the bonus
(via `chipAdjustedTotal`), so the recommended branch was always correct — only the *displayed*
`chipBonus` and total for a plan whose first chip lands next gameweek understated the real value.
This exact scenario — Bench Boost pinned at the very next deadline — is the front-loaded sequence's
opening move, so it was hit immediately.

**Verified live**, not in a synthetic harness: pinned Bench Boost to GW1 on a real squad via
`ChipPlanEditor`, ran `/transfers`' Transfer Path. Before the fix the GW1 step would have read `+0.3
xP + 0 chip`; after, it correctly reads **`+0.3 xP + 15.9 chip`**, matching the deadline optimiser's
independent `+15.9 GW1 bench boost` figure exactly, and the path total came out to `+20.3` against
holding the squad unchanged through GW3.

**Calendar-derived presets on `/chips`** (new "Chip sequences" section): Front-loaded (BB/FH/WC in
the opening three gameweeks, only offered when it's genuinely still the season's opening), Early
information anchor (Wildcard after a fixed number of real gameweeks), and Break pivot (Wildcard
timed to the season's largest gap between deadlines, computed from `gameweeks.deadline_time` — this
season that's GW5→GW6, a 22-day gap, giving GW6). None are hardcoded dates; each is checked against
its chip's real `chip_definitions` window and silently omitted if it doesn't fit, rather than shown
broken. Pinning writes through the existing `setChipPlanEntry` — no new persistence.

**A second real bug, also caught by running against live data, not by reading the code.**
`chip_definitions` carries **two rows per chip name** — one per season half — and the first
implementation collapsed them into a `Map` keyed by name, which silently kept whichever half's row
happened to be last in the array. All three presets computed to zero on real data as a result. Fixed
by searching all matching rows for the one whose window actually contains the target event, rather
than assuming one row per chip. A related instance: Wildcard's own window never covers GW1 (it opens
GW2), so "which half is GW1 in" cannot be answered by asking Wildcard's own definition — Bench
Boost's definition (which does cover GW1) locates the half correctly instead, since all four chips
share the same two half boundaries.

**Explicitly not duplicated:** `runChipEngine`/`bestSchedule` are unchanged — they answer "when is
each chip individually best," a real and still-correct question. The sequence view is a second lens
over the same underlying valuations, routed through the existing `planTransferPath`, not a
competing implementation.

### 3. Transfer reversibility (`Replacement.exitRoutes`)

`findReplacements` (`lib/scoring.ts`) gained an opt-in `filters.reversibility` flag. When set, each
candidate's result carries `exitRoutes`: how many *other* pool players at the incoming player's
position remain legally reachable (position, budget, 3-per-club — `replacementLegality`'s existing
checks) with one more free transfer after this swap. Off by default — an O(pool) scan per candidate
is fine for the handful of rows a Replacement Finder panel shows, wasteful inside
`transfer-optimizer.ts`'s beam search, which calls `findReplacements` far more often.

**Reported, never ranked** — the same treatment `squadBalanceDelta` already established, and
consistent with the standing rejection of a modelled `FutureFlexibility` term in favour of computed,
disclosed facts. `teamFit` is unchanged: `exitRoutes` is computed strictly after every existing term
and never read by them. Wired into `/builder`'s and `/transfers`' replacement panels as an "N exit
routes" line, verified live (a real DEF swap showed 93 legal alternatives remained).

### 4. Refused: new-manager uncertainty discount

The source's fourth proposal — a GW1-3 xP penalty for players under new managerial setups — was not
built, on three independent grounds: `pl_managers` carries no start date, appointment date, or
tenure field, so nothing in this app can say which manager is new; `lib/tactical-profile.ts` states
outright there is deliberately no scoring function and folding tactical data into xP "is a new,
reviewed change"; and the penalty size would be an invented coefficient, which methodology.md
forbids. Compounding all three: [sprint-17a.md](sprint-17a.md) had just established the model
already underperforms a naive baseline out-of-sample — a hand-tuned multiplier on top makes an
unvalidated model harder to validate, not better.

Logged in [blocked-and-data-gaps.md](../wiki/blocked-and-data-gaps.md) instead, with the empirical
version queued: Sprint 17a's four seasons of per-gameweek data make "do first-season-manager players
underperform their prior rate early on" a genuinely testable question once a tenure source exists —
turning a hunch into a measurement, not a shipped guess.

## Verification

Every engine change here was checked against real, live data before being trusted — the standing
rule methodology.md records, and the one that caught both real bugs above (the transfer-path opening
bonus, and the chip_definitions per-half collapse). `squadBudget`'s arithmetic
(`xiSpend + benchSpend === spent`, `spent + bank === budget`) was checked against a real imported
squad, including the split-invalidation path. `npx tsc --noEmit`, `npm run lint`, and dark-mode
styling were all confirmed clean on every touched file; `/builder`, `/chips`, and `/transfers` were
driven live in the preview browser, not assumed from code reading.
