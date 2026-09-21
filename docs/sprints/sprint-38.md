# Sprint 38 — the player profile, the price reading, and a shortlist

**Built 2026-09-21.**

Three threads that turned out to share a spine: the app knew a great deal about a player and had
nowhere good to show it. `/players` — the page built for researching a player — opened nothing at
all, and the one detail surface that existed was a 320px popover reachable only from a pitch.

Along the way the price-watch reading turned out to have been broken since it shipped, and a
scoring fact turned out to be living in three places with two of them wrong. Both are recorded
below — including a claim about the second that I got wrong first time and had to correct.

---

## 1. DSI-50 — the GW5 check-in, re-read at locked data

GW5 is final: 10/10 fixtures `finished`, bonus applied, `player_gameweek_stats` resynced
2026-09-21 05:50. The gate was "has the bias sign flipped?"

| | n | bias | MAE | Pearson r |
|---|---|---|---|---|
| GW2 | 620 | −0.150 | 1.396 | 0.518 |
| GW3 | 652 | −0.089 | 1.323 | 0.468 |
| GW4 | 656 | −0.079 | 1.379 | 0.501 |
| GW5 | 659 | **−0.006** | 1.348 | 0.490 |
| **Pooled** | **2,587** | **−0.080** (SE 0.044, t = −1.82) | 1.361 | 0.494 |

**The sign never flipped, and the figures are identical to the 2026-09-20 run** — GW5's bonus
confirming moved nothing. The magnitude has collapsed: Sprint 34's −0.248 over GW2+GW3 is −0.080
over four, ~1.8 SE from zero.

It decomposes into two cohorts that nearly cancel:

| cohort | n | bias | mean xP | mean actual | mean exp. mins | mean actual mins |
|---|---|---|---|---|---|---|
| appeared | 1,223 | **+0.627** | 2.384 | 3.011 | 47.1 | 64.2 |
| no-show | 1,364 | **−0.714** | 0.714 | 0.000 | 15.8 | 0.0 |

Expected minutes are right in aggregate (30.6 vs 30.4) and wrong per player. That is a
**discrimination** failure, which a multiplicative points scale cannot reach — so the GW10
`positionCalibration` refit (DSI-53) stays out of the plan. Spun out as **DSI-178**. Per position
only GKP survives as its own bias: −0.319 (n=281, t=−2.78).

DSI-50 stays open for a fifth read at GW6 (2026-10-10, after a three-week international break).

## 2. The price reading was broken, and is now worth showing

**The bug.** `loadPriceProgress` fetched ownership samples unpaged. The API caps every response at
1000 rows whatever `.limit()` asks for, and there are ~42,000 samples after the anchors — so
ordered ascending it returned the *oldest* 1000, nearly all from before every anchor. The
per-player filter then discarded them, leaving most players under two samples. The price column on
`/players` and `/transfers` read "unknown" or a flat 0% for almost everyone, which **looked quiet
rather than broken**. That is why it survived since Sprint 29.

Both queries now page, concurrently (the count-then-fetch-all shape from `lib/player-pool.ts`);
serially it was ~42 round trips and over twenty seconds. A server-side rollup would be better
still — 667 rows instead of 42,000 — and is worth a migration later.

**The presentation** (step 2.5 — no fitting, so outside DSI-54's gate):

- `progressRaw` carries the signed, unclamped ratio beside the clamped `progress` the bars fill
  from, so a player 11% past the threshold reads `+111%` instead of pinning at 100%.
- `PriceVerdict` becomes a ladder — `expected` / `very likely` / `possible` / `not tonight` /
  `unknown` — as machine-readable tokens, with `priceVerdictLabel` wording them. `isImminent`
  replaces `/transfers`' old `=== "likely tonight"` string comparison.
- `projectToCutoffs` carries the trailing 24h net-transfer rate forward to the next nightly
  cutoffs. **The cutoff hour is measured, not assumed:** all 412 recorded changes this season
  landed in the 23:00 UTC hour. It returns nothing, rather than a line through two points, below
  three samples in the window.

**The label matters more than the number.** `+111.5%` is *111.5% of the net transfers your
threshold says a rise takes* — not a probability. The reference app the owner shared conflates the
two; this does not, in the badge title, the card copy and `PRICE_WATCH_MODEL_NOTE`.

## 3. DSI-54 — the gate, run on the falls half

Falls only: 352 recorded falls against 60 rises, and 55–60 positives leaves ~25–30 in a test fold,
which cannot separate "does not work" from "not enough data to tell". Rises stay held to ~GW10–12.

Walk-forward over 36 scored nights, 631 candidates a night. Both model and baseline pick K
players; scored on how many of that night's actual falls each caught, compared with a paired
per-night sign test so one freak night cannot carry the result.

| K | model recall | baseline | random | nights won/lost | sign-test p |
|---|---|---|---|---|---|
| 10 | 6.0% | 3.1% | 1.6% | 7/0 | 0.0156 |
| 20 | 10.2% | 6.8% | 3.2% | 9/0 | 0.0039 |
| 40 | 15.3% | 13.4% | 6.3% | 6/2 | 0.2891 |
| 80 | 26.7% | 27.0% | 12.7% | 9/8 | 1.0000 |

**The model beats the baseline where the budget is tight and ties once it is loose**, and the two
converge monotonically as K grows — the shape a better *ranking* produces, not scattered wins. At
K=10 and K=20 it never lost a night. Four budgets were tested, so the script applies a Bonferroni
correction and says which survives it: K=20 does, K=10 does not.

Two things this does **not** claim. Absolute recall is low at every budget — most falls are missed
because most players are off the ~2h watchlist and their features are stale, so the model is
better than the baseline without either being good. And **nothing is wired into the app**: that
needs somewhere to keep and refresh weights plus a nightly job, which is its own piece of work.
The shipped reading stays the descriptive heuristic.

Harness: `scripts/price-falls-walkforward.ts`.

**A bug found building it.** `cost_change_event` is FPL's *cumulative* change for the gameweek,
not a per-night delta — labelling a fall by its sign marks a player already down on the week as
falling every night. Direction comes from consecutive prices instead.

## 4. The player profile

A new `components/player-modal.tsx`: three tabs over everything the app knows about one player,
reachable from `/players` (its name cell is now a button), and from `/builder`, `/team` and
`/deadline` through a "Full profile" link on the pitch popover.

**Why a new surface rather than replacing `PlayerDetail`.** The popover handles the
high-frequency pitch taps — set captain, check the next fixture — and its never-fetch contract is
what lets four pages render it with no data coupling. Four queries behind every pitch tap would
be a regression. Opening the modal closes the popover first: both are `aria-modal` dialogs, and
leaving one open stacked two of them.

**Tabs.** Overview (snapshot, price, price outlook, transfers, fixtures, season stats, recent
price changes, recent form, availability, set-piece duty, club system, news); Gameweeks (every
fixture, each row expanding into the points breakdown); History (past seasons, keyed on
`player_code` because FPL reassigns element ids between seasons).

**One source per number.** Season figures are reduced from the same gameweek lines the Gameweeks
tab itemises, so the headline and the table beside it cannot disagree. This gameweek's transfers
fall back to the live ownership sample when the finalised row does not exist yet, and **say so** —
a settled event total and a ~2-hourly sample are different quantities.

**The same card everywhere.** `loadPlayerExtras` loads availability, set-piece duty, club system
and news itself rather than reading them off the caller's `PlayerData`. The popover's
caller-supplies-it contract is right for a panel four pages render with different data to hand,
but it meant the deep-dive card showed different sections depending on where you opened it from.
A "full profile" should not have that property.

**"Show full details" is gone.** Everything it held moved here, and `PlayerDetail` drops from 578
lines to 398.

**Rank captions** ("#13 MID", "Top 10%") come from `lib/player-ranks.ts`. Bars normalise to the
position's 95th percentile rather than its maximum, so one outlier does not render everyone else
as a stub, and a caption is **omitted entirely — never a dash** — when the cohort is under 20 or a
rate rests on under 180 minutes.

**The points breakdown is derived**, because FPL itemises a score only for the live gameweek. The
values come from the `scoring_rules` table, not a constants file — season-keyed and synced from
FPL, per "squad rules come from the database". Every breakdown is reconciled against the stored
total and any difference renders as an **"Unattributed"** row rather than being absorbed.

*Verified: all 3,218 recorded player-gameweeks this season reconcile exactly, zero unattributed.*

### The scoring finding

That verification established the defensive-contribution thresholds by measurement, over 677
player-gameweeks with ≥60 minutes and no goals/assists/cards/penalties/own-goals/bonus — so the
score reduces to appearance + clean sheet + goals conceded + saves + DC. The residual was exactly
+2 or exactly 0 in every cell, with **zero variance**:

| position | DC band | n | residual |
|---|---|---|---|
| DEF | 10–11 | 33 | **+2** |
| MID | 10–11 | 30 | 0 |
| MID | ≥12 | 36 | **+2** |
| FWD | ≥12 | 1 | **+2** |

So DEF 10, MID 12, **FWD 12 — and forwards do score it.**

**First reading of this was wrong, and the correction matters more than the finding.** It was
filed (DSI-179) as "the xP model excludes forwards from points they earn", a candidate contributor
to DSI-178's +0.627 appeared-cohort bias. The model does no such thing:
`supabase/functions/_shared/xp-model.ts:137` already carries
`dcThreshold: { 1: 0, 2: 10, 3: 12, 4: 12 }`, and the scoring at `:1619` gates on `threshold > 0`,
which excludes only goalkeepers. `player_xp_horizons` confirms it — forwards do get an xDC value
(1 of 79 non-zero, max 0.01), near zero because forwards rarely reach 12 defensive actions. **A low
expectation, not an exclusion.** DSI-178 keeps its full +0.627 to explain.

What was actually wrong was narrower and entirely on this side of the model:

- `XDC_MODEL_NOTE`'s prose — "forwards and goalkeepers never score it" — is false for forwards,
  and it is user-facing tooltip text.
- `XDC_POSITIONS = new Set([2, 3])`, declared **independently** in `app/players/page.tsx` and
  `components/compare-panel.tsx`, hid the xDC column for forwards. A forward who did clear the
  threshold showed "—" beside a real computed number. Two copies of one fact, both wrong.

Fixed by giving the fact one home: `DC_THRESHOLD_BY_ELEMENT_TYPE` and
`scoresDefensiveContribution()` in `lib/scoring.ts`, documented as mirroring the model's own
`MODEL_PARAMS.dcThreshold` — duplicated rather than imported because that file is Deno and
excluded from tsconfig, and if the two ever disagree the model's copy is the truth.
`lib/fpl-scoring-rules.ts` reads from it too, rather than keeping the third copy this sprint had
introduced. Reconciliation re-run after the change: still 3,218 of 3,218, zero unattributed.

The FWD cell is n=1 at the threshold, so the *magnitude* is worth re-checking as more gameweeks
land; the direction is settled by `scoring_rules` agreeing independently.

## 5. The shortlist

`user_shortlist`, owner-scoped on the Sprint 14 shape with `auth.uid() = user_id` in **both**
directions. Verified rather than assumed, in a rolled-back transaction: a second user sees 0 of
another's rows, deletes 0 of them, and an insert naming another user's id is refused while their
own succeeds; anon sees 0.

**Named "shortlist", not "watchlist".** "Watchlist" already means the bounded set of players
sampled every ~2h for price movement (Sprint 29, `game_settings.price_watch_*`) — a sampling
budget the system picks, not a set the owner picked. Two meanings for one word in one app is a bug
with a delay on it.

**No localStorage fallback, deliberately.** A shortlist that lives in one browser and silently
fails to appear on a phone is worse than one that says "sign in first", and a shadow copy that
conflicts on sign-in is worse still. Signed out, the control is a link to `/signin` — never a
silent no-op.

The modal owns the shortlist state rather than taking it as a prop, so the control exists on every
page instead of only where a caller remembered to wire it. `/shortlist` lists them with each
player's price-outlook reading, because a shortlist button with nowhere to read the shortlist is a
write-only hole.

## Verification

- Scoring breakdown: 3,218 of 3,218 player-gameweeks reconcile exactly, zero unattributed.
- RLS: both roles, both directions, inside a rolled-back transaction.
- Signed-in *and* signed-out passes via the dev test account.
- 375px light and 1280px dark, with `document.body.scrollWidth === window.innerWidth` asserted at
  both rather than checked by eye.
- `npx tsc --noEmit`, `npm run lint`, `npm run build` clean.

## Open after this sprint

- **DSI-178** — expected-minutes discrimination (M7).
- **A server-side price rollup** — `loadPriceProgress` ships ~42,000 rows to the browser to
  produce 667 readings.
- **Wiring the falls classifier** — the gate passed at tight budgets; the runtime plumbing did not
  happen.
- **The three `toPlayerData` copies** (`builder:1030`, `deadline:750`, `team:989`) are still three.
