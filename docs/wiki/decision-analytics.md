# Historical decision analytics

Four descriptive analytics over decisions the owner has **already made**, scored against results
already in the database: captain success, transfer success, chip ROI, rank progression. No new
model, no new gate, **no migration** — `manager_gameweek_history`, `manager_transfers` and
`manager_chips` were all already populated, and this is the first reader `manager_chips` has ever
had anywhere in `lib/`, `components/` or `app/`.

`lib/decision-analytics.ts` + `components/decision-analytics-panel.tsx`, mounted on `/team` above
the "This Season" table. Built 2026-09-10 — [sprint-36.md §1](../sprints/sprint-36.md).

The single-gameweek version of the same question is `/review`, now folded under `/team`'s gameweek
selector — see [deadline-and-matchday.md](deadline-and-matchday.md#review-review-built-2026-08-27).

## One season-wide load, not one per event

Looping `loadGameweekState` over 38 events is three queries each, ~114 round trips. Instead:
`loadManagerPicks` once (whole season, already paged), a season-wide
`Map<event, Map<playerId, points>>` in the shape `loadScenarioActuals` already returns,
`loadGwHistory` over all finished events, `loadTransfers`, and `manager_chips`.

It follows the `lib/prediction-accuracy.ts` + `components/accuracy-scoreboard.tsx` precedent: a
`lib/` module that owns the numbers, a `*_NOTE` constant that says what they mean, a self-loading
component. `players` is passed in as a prop rather than re-read.

## Captain success

`lib/gameweek-review.ts` already computed best-available-captain for a single event. That
computation **moved** into this module and `loadGameweekReview` calls it — one quantity, one
implementation ([methodology.md](methodology.md#one-quantity-one-implementation)). The proof that
the move left no second scorer behind is an equality check: the season table's GW3 captain row came
back byte-identical to a direct `captainChoiceAt` call for that event.

**The benchmark stays the starting XI, and the plan that said to widen it was wrong.** The plan
called for benchmarking against all fifteen owned, reasoning that a bench player can be captained.
That is wrong on FPL's own mechanics: an armband on a benched player earns nothing unless FPL
substitutes them on, so scoring the captain against the bench would blame the armband for a
*starting* decision. `DECISION_ANALYTICS_NOTE` now states the XI benchmark explicitly, which is a
stronger claim than the silent narrow definition it replaced.

Two things did change with the move, both real:

- **The gap is reported as *effective* points**: `(best − effective) × (multiplier − 1)`, not the raw
  difference. One copy of every starter's score is already in the XI total and the armband only adds
  the extras, so under a Triple Captain the same raw gap costs twice as much — which the old raw
  figure hid.
- `components/gameweek-review-panel.tsx` had **`× 2` hardcoded in three places**. It now reads the
  pick's own multiplier, so a Triple Captain gameweek no longer renders as a double.

The hit rate — how often the armband *was* the best of the XI — is its own named term rather than
being folded into the gap. It remains hindsight, and says so.

## Transfer success

Not implemented anywhere before this: `/review`'s transfers section was a bare in/out name list.
Per `manager_transfers` row: what came in, what went out, over the horizon the transfer was made
for.

**The horizon is a user input, not an invented constant.** The database records no intended
horizon, so it is a documented page-level control over the shared `HORIZONS` —
[methodology.md](methodology.md#when-a-term-cannot-be-dropped-make-it-an-input). Terms stay separate
(`+X in − Y out − Z hit`), never a bare net. A transfer whose horizon runs past the last scored
gameweek reports as *in progress, N of M scored* rather than being silently truncated.

## Chip ROI

Against a no-chip counterfactual computed from **actual** picks and **actual** points:

- **Bench Boost** — that gameweek's actual bench points. Exact.
- **Triple Captain** — the effective captain's actual raw points, the third helping. Exact.
- **Free Hit / Wildcard** — **no honest counterfactual exists in the data.** The squad that would
  otherwise have played is not recorded anywhere, so these render as *not scored, and why*, rather
  than as a reconstructed number. Reconstructing a pre-chip squad from the prior gameweek's picks
  and calling it a counterfactual was considered and rejected.

The forward xP helpers (`benchBoostAt`, `tripleCaptainAt`, `chipBonusAt` in `lib/chip-plan.ts`) are
deliberately not reused: a forward valuation is a **different quantity** from a retrospective
actual, and sharing code between them would be the reverse of the one-quantity rule rather than an
instance of it. See [chip-plan.md](chip-plan.md).

## Rank progression

Straight from `manager_gameweek_history`. The only real hazard is the direction convention:
`percentile_rank` is FPL's lower-is-better "top X%", `percentileScore` flips it to higher-is-better,
and `buildManagerProfile` un-flips again for `rankTier` — see
[manager-profile.md](manager-profile.md). One convention per screen, labelled on the axis, asserted
in the note.

The rank section is a **chart**, not a fourth copy of the "This Season" table's Overall Rank column,
with the y axis **inverted** so a rising line means an improving rank. The inversion is the reason a
picture earns its place here at all. The stroke resolves through `var(--primary)` rather than a
hardcoded hex, so it is brand green in dark and deep purple in light —
[design-system.md](design-system.md#the-token-layer-appglobalscss).

## Verified against live data before the UI existed

A throwaway `npx tsx` harness (not committed, per
[methodology.md](methodology.md#verify-engine-changes-against-live-data-not-just-review)) ran the
module against entry 274486. Three independent anchors agreed:

| Check | Module | FPL's own row |
|---|---|---|
| GW3 total (XI 34 + Haaland 9 × 3) | 52 | `points` = 52 |
| GW3 bench | 18 | `points_on_bench` = 18 |
| GW3 Triple Captain ROI (the third helping) | +9 | — |

Then browser-verified on `/team` at 1280 and 375 wide, light and dark: no horizontal overflow, cards
`self-start` so an expanded one does not inflate its row-mate
([design-system.md](design-system.md#expandable-card-stretch-2026-08-22)).
