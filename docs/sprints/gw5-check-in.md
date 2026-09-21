# GW5 check-in — and the coverage bug it found first

**Run 2026-09-20**, a day ahead of the ~2026-09-21 date [roadmap.md](../roadmap.md) set for it.
Linear [DSI-50](https://linear.app/dsinha-org/issue/DSI-50/gw5-check-in-read-the-accuracy-scoreboards-bias-sign-at-n4)
(M6), moved to **In Progress** rather than Done: GW5's bonus was still provisional at the time of
the run, so the figures below are expected to move slightly and the issue stays open for a re-read.

Not a sprint. Scoped as "one cheap look" per the roadmap's own framing, it turned into three
separable things: a data defect, the check-in itself, and an unrelated batch of interface work the
owner asked for in the same session.

## 0. The premise was wrong — GW5 was not fully scored

The check-in's stated bar is "GW2–5 archived *and* scored". Checked rather than assumed, and the
second half did not hold:

| | `fixtures` | `player_gameweek_stats` |
|---|---|---|
| GW5 fixtures | 10, all `started` + `finished_provisional`, real scores | 10 fixtures with rows |
| …of which carry real minutes | — | **6** |

The four fixtures that kicked off on 2026-09-20 (ids 44, 45, 49, 50 — 257 player-fixtures) had a
complete set of rows reading `minutes = 0, total_points = 0`. `sync-player-history` does a full
pass only every `PASS_INTERVAL_HOURS = 20`, so a played-but-unwritten window of several hours is
the **normal** state of the most recent matchday, not a failure.

`fixtures.finished_provisional` was `true` for all ten, including the four with no stats at all —
so no fixture status flag distinguishes "played" from "results are in". That is recorded in
[../wiki/data-pipeline.md](../wiki/data-pipeline.md) as a standing trap.

## 1. The scoreboard was scoring those zeros as real blanks

`scoreEvent` (`lib/prediction-accuracy.ts`) joined the archive to `player_gameweek_stats` per
`(player_code, fixture)` and dropped predictions with *no* matching row — correct — but a row that
exists and is all zeros joins fine. So 257 player-fixtures became residuals: a blank return for
every player who had in fact just played.

**Effect:** the panel reported GW5's bias as **−0.589**. Scored against `player_live_stats`
(`sync-live-gameweek` refreshes it every 2 minutes and it had the real figures), GW5's bias is
**−0.006**. Off by more than half a point per player-fixture, and it looked healthy while doing it.

**The fix (PR [#30](https://github.com/Dsinha97/fpl-app/pull/30), merged 2026-09-20).** A
per-fixture completeness gate. A fixture counts as *landed* once any player in it has real
minutes — every played fixture puts 22+ players on the pitch, so a fixture whose every row reads
`minutes = 0` has not been written yet.

Validated across the whole warehouse before being relied on: over the four settled seasons
(~150 gameweeks) **every** fixture with stats rows also had minutes. 2026-27 GW5 mid-sync is the
only exception anywhere — no false positives on settled data.

Partial gameweeks are **included and disclosed, not dropped** — a silently smaller `n` is the same
class of bug as a silently inflated one. `scoreEvent` now returns an `EventScore` carrying
coverage, `loadFixtureCountByEvent` supplies the denominator (`null` for a season `fixtures` does
not hold, since it carries the current season only — the panel then states the numerator alone
rather than inventing one), and the panel reads:

> 2026-27 · scored GW2, GW3, GW4, **GW5 (6 of 10 fixtures)** · 2,330 player-fixtures […] GW5 is
> scored over 6 of its 10 fixtures — the other 4 have no results in the warehouse yet
> (sync-player-history does a full pass every 20 hours), so they are left out rather than counted
> as blank returns.

The copy deliberately does not claim the missing fixtures "have been played" — distinguishing that
from "not yet kicked off" would require trusting exactly the flag that lied here.

## 2. The check-in — the bias has not flipped sign, but it has collapsed

Two independent routes, agreeing: `player_live_stats` for all of GW5 gives **−0.080 / n=2,587**;
the shipped completeness gate (GW5's 6 landed fixtures only) gives **−0.084 / n=2,330**.

| Cohort | n | bias | MAE | r |
|---|---|---|---|---|
| All | 2,330 | **−0.084** | 1.370 | 0.483 |
| GKP | 251 | −0.352 | 1.236 | 0.573 |
| DEF | 766 | −0.033 | 1.623 | 0.412 |
| MID | 1,031 | −0.047 | 1.266 | 0.504 |
| FWD | 282 | −0.113 | 1.182 | 0.540 |

Per gameweek: **−0.150, −0.089, −0.079, −0.006**.

DSI-50's gate was "read the sign". It has **not** flipped — four negatives in a row — but it is
shrinking monotonically toward zero, and the pooled figure sits ~1.8 standard errors from zero.
Two things ate [sprint-34.md](sprint-34.md)'s −0.248:

1. **Roughly half of it was provisional bonus.** GW2+GW3 on the *identical 1,272 rows* now reads
   **−0.119**, not −0.248, because GW3's bonus has since been confirmed. Sprint 34 flagged that
   provisionality in its own panel copy; this is that caveat coming true, at about half the
   headline figure.
2. **GW4 and GW5 came in near zero.**

### The structural finding — `positionCalibration` is the wrong term

| | n | bias |
|---|---|---|
| Did not play (`minutes = 0`) | 1,364 | **−0.714** |
| Played (`minutes > 0`) | 1,223 | **+0.627** |

(GW2–5, live actuals for GW5.) The model over-predicts non-appearances and under-predicts
appearances, and the two very nearly cancel — which is why the aggregate reads ≈0 while neither
half does.

`positionCalibration` is a multiplicative points scale. It cannot separate those two: fitting it
to the ≈0 aggregate bakes in noise, and fitting it to the over-prediction half would make the
played cohort *worse*. **The live question moved from points calibration to expected-minutes
calibration.**

Only GKP survives as a separate non-trivial bias (−0.352, ≈3 SE) and is worth its own look at GW10.

**Consequence for the GW10 batch:** item 3 (refit `positionCalibration`) should not run as
specified. Items 1 (current-season blend sweep) and 2 (derived vs official FDR) are untouched.

## 3. Price-change prediction — step 3's gate, measured

Checked in the same session against live data; **no code written, DSI-54 left in Backlog/M7.**
This is evidence for the gate, not a decision to build.

`player_price_history` (change-on-write) now covers **26 nights**: **55 rises, 226 falls**.
`player_ownership_history` holds 65,095 rows over 667 players across 49 days (~3.5 samples per
player per day).

The naive baseline DSI-54 gates against — rank every player each night by 24h net-transfer delta:

| | recall | mean rank of a real changer (of ~660) |
|---|---|---|
| Rises, top 5 | 19/55 (35%) | — |
| Rises, top 15 | **39/55 (71%)** | 88 |
| Falls, bottom 15 | 23/226 (10%) | — |
| Falls, bottom 40 | 46/226 (20%) | 171 |

Random would put a changer at ~330, so the raw signal is genuinely strong for rises and weak for
falls.

**A null result on the obvious improvement.** FPL's threshold is known to scale with ownership, so
the natural first feature is the delta normalised by `selected_by_percent`. It makes rises
**substantially worse** (39/55 → 15/55 in the top 15) and barely moves falls (46 → 59 at N=40).
Recorded so it is not re-derived as a good idea later.

**Where that leaves the gate:** falls are fittable now (226 labelled events against a baseline
catching 20%). Rises are not — 55 positives walk-forward leaves ~25–30 test positives, where
differences under roughly 15pp would be indistinguishable from noise, producing an *unresolvable*
verdict rather than an honest negative one. Run falls at M7; hold rises until ~GW10–12 doubles the
count. Do not narrow the gate to let rises through early.

## 4. Interface work in the same session

Unrelated to the above, asked for directly by the owner and shipped in the same PR.

- **`/deadline` no longer plans transfers.** The "Transfer call" settings card and the
  `TransferPath` block below it ran the optimiser a second time, landed on `/transfers` anyway,
  and arrived there with an **empty basket**. Both removed, replaced by one
  **"Plan Transfers and Chip Strategy"** link in the Chip call card's header (`flex-wrap` — at
  218px it wraps below the heading in the 360px rail, by design). That orphaned a good deal, all
  removed: `planTransferPath`/`runTransferPath`, the horizon and decision-margin controls,
  `freeTransfers` state (`/transfers` and `/team` both still set it), `wildcard` and its window
  fetch, `xpOf`, `seriesOf`, `chipPlanUsable`, `predsFullLoading`, and a `chipContext` memo that
  already had no reader before this change. **Stage 3b of the prediction load stays** — it warms
  the exact cache key `/transfers` reads, so the new button lands on a hot page.
- **`/team`'s "Transfers this season" moved out of the 360px rail** to full width below the grid,
  gameweeks flowing across up to four columns. It was the card making the rail overrun the squad
  column and leave dead space. Measured after: 992px, exactly the grid's content width.
- **Countdowns drop the seconds term above 24h.** A digit changing every second on a countdown
  measured in days is movement with no information in it, and it cost a re-render a second to say
  nothing. `fmtCountdown` returns `showsSeconds`, which `ContextBar` and `/deadline` use to tick at
  30s instead of 1s outside the window.

## Verification

- `npx tsc --noEmit`, `npm run lint` (no new warnings), `npm run build` — all pass. 5/5 CI checks
  green on PR #30.
- The coverage gate verified with a throwaway `npx tsx` harness against live data, per
  [../../CLAUDE.md](../../CLAUDE.md)'s "verify engine changes by running the real module against
  live data" rule, kept out of the commit: GW2–4 byte-identical at 10/10, GW5 `+0.020` over its 6
  landed fixtures, GW6 (0/10) contributing nothing and correctly not listed as scored.
- Panel copy read back in the browser at `/settings/?tab=status` — the signed-out exception to that
  page's sign-in wall.
- Countdown boundary checked: `24h+1s → "1d 0h 0m"`, `23h59m → "23h 59m 0s"`.
- The `/deadline` and `/team` layout changes verified in the preview at 1440px via the app's own
  signed-out path (`/team` → Connect 274486 → Import as draft), which needs no session: the CTA
  renders with the draft id in its href, the three removed controls are absent, the transfers card
  measures 992px across four columns, and `document.body.scrollWidth` (1425) ≤ `window.innerWidth`
  on both.

## Open

- **Re-read the scoreboard once GW5's bonus is confirmed** (`fixtures.finished` flips). DSI-50
  stays In Progress until then. The expected movement is small and upward — confirmed bonus adds
  points, which pushes `mean(actual − predicted)` toward zero or positive.
- GKP's −0.352 is the one cohort-level bias left standing; look at it separately at GW10.
