# Sprint 28 — Live/upcoming split, one transfer answer, scenario actuals

Built 2026-08-29. Prompted by the owner using the app during a live gameweek and
filing seven observations at once — three UI/engine defects and four questions.
This file covers the three that were built; the four questions are answered in
[roadmap.md](../roadmap.md)'s Next up and Blocked sections, and in
[phase-4-model.md](../phase-4-model.md) for the xP one.

The three builds share a shape: **the app was showing two of something where
there should be one.** `/deadline` interleaved the gameweek in play with the
gameweek being planned in a single scroll; `/transfers` and `/deadline` each
printed two contradicting answers to "what should I do at this deadline"; and
`/scenarios` showed a projection with nothing to check it against.

---

## 1. `/deadline` splits into Live GW and Upcoming GW

`app/deadline/page.tsx`, `components/ui/collapsible-card.tsx`.

The page already distinguished the two gameweeks internally — `ctx.nextEvent`
(`is_next`, being planned) and a separate `is_current` probe (being played,
Sprint 13). It just never separated them on screen. Now:

- **A top strip that is never collapsed**: the countdown plus the Price & news
  watch and Team news rail. The countdown answers "how long have I got", which
  is exactly what you want during a live gameweek, so hiding it behind a
  collapsed section would be backwards. The rail keeps Sprint 23's reason for
  sitting outside the live card (never orphaned before the first kickoff) and
  gains a second: it must not vanish behind a collapsed upcoming section either.
- **Two `CollapsibleCard tier="section"` blocks below it**, ordered and expanded
  by a new `livePhase`.

### `livePhase` — and why `liveStarted` could not answer this

`liveStarted` counts fixtures with `started = true`, and those rows stay true
forever. It can say "has kicked off"; it cannot say "is over". The probe now
also selects `gameweeks.finished` and counts fixtures with
`finished_provisional = false`:

```
unknown  probe not resolved            -> treated as `none` for rendering
none     no is_current row, no fixtures, or startedCount === 0
over     gw.finished === true, OR unfinishedCount === 0
live     otherwise
```

`finished_provisional` moves the page a sync cycle or two ahead of FPL's own
gameweek flag. **`data_checked` is deliberately not used**: it lags the last
whistle by hours to a day, and gating on it would bury the upcoming section
through most of the planning window. It would be the right flag for a
"bonus confirmed" label, not for this.

`liveStarted` is unchanged and still gates the fixture/`gwState` fetches — final
points must keep loading after the whistle.

### Open state: derive, with a sticky override

`defaultOpen` cannot work here on two counts: the probe resolves *after* first
paint, and the phase flips again mid-session at the final whistle. So
`CollapsibleCard` gained a controlled mode (`open` + `onOpenChange`, coexisting
with the uncontrolled `defaultOpen` path every other caller uses), and the page
derives:

```ts
const liveOpen     = overrideFor.live     ?? livePhase === "live";
const upcomingOpen = overrideFor.upcoming ?? livePhase !== "live";
```

The override is keyed on the live event, so a new gameweek starts from the
derived answer rather than inheriting last week's click. No effect writes open
state — this file would otherwise carry the repo's seventh
`react-hooks/set-state-in-effect` disable.

Collapsed summaries carry exactly what was asked for and nothing else: live
shows `{liveTotal} pts` (plus a provisional marker); upcoming shows squad
legality and the flag count.

### Reordering by flex `order`, not by reordering elements

The obvious implementation — an array of two elements, reversed on phase — was
rejected. Reordering elements lets React remount both subtrees at the whistle,
wiping an open `PlayerDetail` popover, an expanded `LiveFixtureCard` and
`ChipPlanEditor`'s own collapse state. `order-1`/`order-2` on two fixed
siblings changes nothing in the DOM, so a remount is impossible by
construction. The usual a11y objection to visual reordering does not bite:
whichever section is second is also collapsed, and a collapsed body is `inert`.

### Two real defects found in the primitive while doing this

1. **`overflow-hidden` clipped the pitch's player detail.** `PitchView` renders
   `PlayerDetail` as `position: absolute`, so any clipping ancestor cuts the
   popover off — and wrapping the squad in a card is exactly what this change
   does. The first attempt (clip while animating, switch to `overflow-visible`
   on `onTransitionEnd`) **does not work and was measured not working**: Chrome
   resolves an interpolating `fr` track in an indefinite-height grid to `0px`
   throughout and never fires a `transitionend` for `grid-template-rows`, so
   the body stayed clipped indefinitely. The shipped answer is simpler: a
   `section` tier opens instantly, with no height animation at all. That is
   also the right call on its own merits — sliding ~1,000px of squad, chip and
   transfer UI open over 300ms is a lurch, not a nicety. Card tiers keep
   Sprint 24's behaviour untouched.
2. **Collapsed bodies stayed in the tab order.** Tolerable for a 20-row news
   list, not for a collapsed section holding horizon buttons, two selects, a
   run button and fifteen player cards. The body wrapper now takes
   `inert={!isOpen}`. It stays *mounted* — that is load-bearing, since the
   collapsed summaries read state the collapsed body's own effects keep fresh.

### Not done, on purpose

The two sections were **not** extracted into components. The upcoming body
reads ~27 pieces of page state; extracting it means a props explosion or a
context, either a bigger and riskier diff than the wrapping itself. The live
body reads eight and is a plausible standalone extraction later.

Also: the live card lost its narrow left column when the rail moved to the top
strip, which was half of why Sprint 23 put it in a 1fr/360px grid (the BPS race
used to stretch the full page width). The summary block now carries
`max-w-2xl` to hold that constraint in its new home.

---

## 2. One transfer answer, and it is the path

`lib/transfer-path.ts`, `components/transfer-path.tsx`, `app/transfers/page.tsx`,
`app/deadline/page.tsx`.

`/transfers` and `/deadline` each rendered `TransferPlan`
(`optimizeTransfers().recommended`) *and* `TransferPath`
(`planTransferPath().recommended.openingMove`) — two headlines answering "what
should I do at this deadline", side by side, with nothing reconciling them. The
owner asked for one, and for it to be the path.

Strictly, neither is a second *scorer*: both bottom out in `simulateTransfers`,
and `projectAtEvent`/`riskPoints` each have exactly one implementation. But
CLAUDE.md's rule bites a level up — the *decision* had two implementations, and
they disagreed for three reasons that turned out to be defects rather than
framing.

### Three defects, fixed before the path became the only answer

1. **The horizon toggle was ignored.** `planTransferPath` hardcoded
   `horizon: 5` for its opening `optimizeTransfers` call. Switching the
   page-level horizon moved the plan's answer and left the path's opening move
   untouched. Now threaded through as `TransferPathInput.horizon`. Gameweeks
   *after* the deadline still score at horizon 1 — that is correct and already
   disclosed, since each contributes its own event's prediction and nothing
   wider.
2. **`decisionMargin` was applied on one side only.** `rollBranch` adds it to
   the net (`transfer-optimizer.ts`); the path scored its rolls on raw event xP.
   "Hold" therefore won far more readily on the plan than on the path — a
   disagreement caused by an *input the owner sets*, not by a prediction.
   `TransferPathStep` now carries `decisionMargin` as its own term, credited to
   any step that buys nothing and plays no chip, and summed into
   `TransferPath.terms` so the headline stays a term sum rather than a bare net.
3. **The roll branch leaked next gameweek's squad.** `rollBranch` returns
   `moves: []` but `simulation: basket.sim` — the simulation of *next* week's
   basket, kept purely to price what waiting buys. The path's opening mapper
   read `sim.resultingTeam` unconditionally, so a roll **fielded, scored and
   carried forward a squad with next week's transfers already applied, at zero
   cost, while labelling the step "roll"**. This is a genuine correctness bug,
   not a presentation one. A roll now carries the unchanged squad, attaches no
   simulation, and costs nothing; the deferred basket's value shows up where it
   belongs, as the next step's own `eventXp`.

Verified with a throwaway `npx tsx` harness against live GW3 data before
touching the UI, per CLAUDE.md's standing rule:

- horizons 1/3/5/8 produce distinct opening moves (h=1 differs; 3/5/8 converge
  on this squad);
- Σ`decisionMargin` equals `rolls × margin` exactly at margins 0, 1, 6 and 20;
- at margin 20 the *opening* step is itself a roll, with zero leaked squads;
- no roll step anywhere carries a cost, a risk delta, or a squad that is not
  its own carried one.

The harness was not committed.

### What changed on the pages

- `/transfers` no longer renders `TransferPlan`. The path **auto-runs on load**
  with the same signature/staleness pattern `runPlan` used, so the page still
  answers on arrival instead of regressing to "answer only after a click".
- `TransferPath` gained the **`Load` button on its opening step**. This is not
  cosmetic: `TransferPlan`'s per-branch Load was the *only* wiring from a
  recommendation into the manual basket and the Apply-as-new-draft flow.
  Removing the plan without this would have orphaned that flow entirely.
  Only the opening step is loadable — every later step depends on a squad that
  does not exist yet.
- `TransferPath` also took over the `decisionMargin` control and the
  "inputs changed — re-run" banner.
- `/deadline` lost `TransferPlan`, its "Run optimiser" button, and
  `runTransferOptimizer`. Its Transfer call card keeps the horizon and
  free-transfer controls, which now drive the path.

`optimizeTransfers` and `components/transfer-plan.tsx` are **not** deleted:
`planTransferPath` calls the former for its opening gameweek (the path *is*
built on the plan), and `signatureOf` still lives in the latter. The optimiser
did not lose its job — it stopped being a competing headline.

---

## 3. `/scenarios` gains an actual-points toggle

`lib/scenario-actuals.ts` (new), `app/scenarios/page.tsx`.

`/scenarios` compared drafts on xP alone, with nothing on screen ever saying
whether a projected gap had been borne out. A `Show: xP / Points scored` toggle
now exposes two figures per scenario:

- **last finished gameweek**, on its own;
- **season to date**, the same XI and captain applied to every finished
  gameweek and summed.

Both appear on the draft cards and as two new `ComparisonRows`.

### The honesty problem, and how it is handled

A scenario is a *hypothetical* squad. Applying today's XI and armband to a
gameweek they were not picked for is not a record of anything — season-to-date
especially, which credits an eleven for weeks before some of them were bought.
So: a `SCENARIO_ACTUALS_NOTE` behind the toggle's `InfoTooltip`, an amber banner
naming the exact gameweek range while the toggle is on, and per-row notes on
both comparison rows. Deliberately not modelled and stated as such:
auto-substitutions (a hypothetical squad has no pick history for FPL's rules to
run against), chips, bench points, prices and transfer costs.

### Implementation notes

- One paged query over `player_gameweek_stats` across every finished gameweek
  for the union of all drafts' players, rather than `loadEventPoints` per
  event — that would be a round trip per gameweek per scenario. Paged with
  `.range()` until a short page comes back, per the 1000-row cap.
- Merged with `player_live_stats` for the latest finished event, per player by
  higher minutes, exactly as `lib/manager-picks.ts` already reconciles them —
  a finalised row can itself be a stale pre-kickoff placeholder.
- Computed in a plain `useMemo`, **outside** `runCompute`'s gated batch. That
  batch exists to keep `optimiseLineup`/`squadScore` off the main thread; a few
  map lookups per draft do not need it, and folding them in would make the
  query's own async arrival surface as "inputs changed — re-run", which is a
  lie. The user changed nothing.

Verified against the database: the probe squad's GW1 figure of 49 reconciles
exactly with `sum(total_points) over the XI + the captain again` in SQL.

---

## Verification

`npx tsc --noEmit`, `npm run lint` (0 errors), `npm run build` all pass.

Checked live in the preview browser against a real in-play gameweek (GW2: 5
fixtures started, 5 unfinished, so `livePhase === "live"`):

- live section first and expanded with "18 pts · provisional" in its summary;
  upcoming second, collapsed, summary "Squad incomplete · no flags";
- expanding upcoming gives `overflow: visible` and an unclipped player-detail
  popover; collapsing live leaves its body `inert` at zero height;
- the manual override survives a phase change;
- `/transfers` answers on load with the path only, `Load` populates the basket;
- `/deadline` shows no "What should I do in GW…" heading anywhere;
- `/scenarios`' toggle reads "49 pts GW1 · 49 season", matching SQL;
- mobile (375×812) and desktop both clean.

Not verified live: the `over` phase, since no gameweek finished during the
session. The predicate is unit-obvious (`gw.finished` / `unfinishedCount === 0`)
but the reorder-at-the-whistle behaviour is worth watching the first time GW3
completes.
