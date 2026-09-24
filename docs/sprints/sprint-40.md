# Sprint 40 — Latency: the shared bundle and the read waterfalls

**Started and built 2026-09-24.** Scoped from that day's `/linear-sync`. DSI-56 was the only
issue promoted to Todo since the last sprint, and none of the three items had a gate. Parent
issue: DSI-184 · DSI-56 (code splitting) · DSI-57 (serial read waterfalls) · DSI-77 (lint
filler). Method, baseline and the ranked plan this works through:
[latency.md](latency.md).

Everything here was **measured before it was changed**, and two of the plan's own hypotheses
turned out to be wrong. Both are recorded below rather than quietly corrected.

## 1. DSI-56: what every route actually paid for

### The plan's hypothesis was wrong

latency.md item 2 proposed wrapping the engines (`transfer-optimizer`, `optimizer`,
`squad-score`) in `next/dynamic`. But only one to four routes import each of them, and Turbopack
already splits them per route. The ~1.1 MB that every route shared came from somewhere else.

### Measured, not guessed

`npx next experimental-analyze --output` is built into Next 16.3, so no dependency was added. It
writes `.next/diagnostics/analyze/data/<route>/analyze.data`: a 4-byte length, then a JSON header
(`sources`, `chunk_parts`, `output_files`) with per-source byte counts per output chunk. That
header is what makes item 4 answerable at last. It attributed `/news`, a route that uses none of
the engines, like this:

| Source | Client bytes |
|---|---|
| `next` (framework + React runtime) | ~583 KB |
| `@base-ui/react` (nav dropdowns, `Button`) | ~117 KB |
| `motion` (`motion-dom` + `framer-motion`) | **~135 KB** |
| `@supabase/*` | ~210 KB, of which realtime + phoenix + storage + iceberg ~83 KB is never used |
| `lib/scoring`, `transfers`, `squad-score`, `lineup`… | ~30 KB |

### Built

- **`motion` off the critical path.** It reached every route through the mobile nav's
  `SlideOver`. `components/ui/slide-over.tsx` is now a thin wrapper that loads the motion-based
  panel (`slide-over-panel.tsx`, unchanged apart from the rename) as its own chunk. The chunk is
  prefetched when the browser goes idle and mounted the first time `open` is true. After that it
  stays mounted, so `AnimatePresence` can still play the exit animation.
- **Engines out of the root layout.** `team-state`, `squad-budget`, `fpl-squad` and
  `context-bar` (all loaded on every route) imported `sellPrice`/`freeTransfersDisplay` from
  `lib/transfers`, which pulled in `scoring`, `squad-score` and `lineup`. Those four pure rules
  now live in `lib/transfer-rules.ts`, and `lib/transfers` re-exports them, so there is still only
  one implementation. This also removes a `scoring ↔ transfers` import cycle.

### Result

First-load JS per route, raw bytes, from the production `out/` HTML:

| Route | Before | After | Δ |
|---|---|---|---|
| `/` | 1,221,547 | 1,069,031 | −152,516 |
| `/news` | 1,230,336 | 1,077,820 | −152,516 |
| `/chips` | 1,210,028 | 1,057,512 | −152,516 |
| `/fixtures` | 1,265,494 | 1,112,978 | −152,516 |
| `/leagues` | 1,226,295 | 1,075,150 | −151,145 |
| `/players` | 1,344,403 | 1,203,485 | −140,918 |
| `/deadline` | 1,367,463 | 1,226,545 | −140,918 |
| `/scenarios` | 1,253,288 | 1,113,454 | −139,834 |
| `/team` | 1,407,832 | 1,272,334 | −135,498 |
| `/transfers` | 1,324,373 | 1,188,874 | −135,499 |
| `/builder` | 1,414,986 | 1,273,954 | −141,032 |

Verified in the preview: the nav drawer, the `/players` compare panel and the `/builder` bottom
sheet all open, animate and dismiss. The panel chunk shows up as a separate request about 1 s
after load. On a cold open before that prefetch, the panel mounts when the chunk lands, still
with its entrance animation.

### Not done, and why

- **`@supabase/*`'s unused ~83 KB.** `createClient` builds the realtime and storage clients
  eagerly, so nothing tree-shakes them. The fix is composing the client from `auth-js` +
  `postgrest-js` + `functions-js` directly. That touches the auth session, which is a real access
  boundary, so it deserves its own issue and not a latency side-quest.
- **`@base-ui/react` Menu.** The desktop nav renders it on first paint. Deferring it would trade
  bytes for a visible pop-in.

## 2. DSI-57: read waterfalls

Same queries, same results; only the order changed. Measured signed in (the dev test account,
manager 274486) in the dev preview. That's the same environment as latency.md's signed-in
baseline, so only before/after within one session is comparable. Settle time excludes the
price-watch reads (see §3), and each figure is three runs, before and after, in the same session.

| Page | Before (settle) | After (settle) | Waves before → after |
|---|---|---|---|
| `/players` | 3.7 / 3.2 / 2.7 s | 2.6 / 1.2 / 1.3 s | 8–10 → 5–7 |
| `/transfers` | 3.9 / 3.2 / 2.2 s | 2.2 / 2.9 / 1.9 s | 7–9 → 6–8 |
| `/team` | 2.7 / 2.6 / 2.8 s | 3.1 (first, post-HMR) / 2.35 / 2.05 s | 17–20 → 14–16 |

- **`/players`.** `player_xp_horizons` joins the main wave, and the reads that aren't
  season-scoped start alongside the gameweek lookup. Clear win.
- **`/transfers`.** `loadPredictionSeries` needs only the gameweek, so it moves into the main
  `Promise.all`. It had been queueing ~1.9 s behind `player_xp_horizons`, whose query alone takes
  ~1.2 s. Modest, noisy win.
- **`/team`.** Rivals load alongside `readBack`. Picks, players, teams, gameweeks, rules and
  fixtures fire as one wave as soon as `nextGw` is known. Fixtures are read for the whole season
  (≤380 rows) and filtered client-side, so they no longer wait for the picks. The profile upsert
  no longer holds the spinner. `loadEventPoints`/`loadLiveDetail` (shared with `/deadline`) start
  their `player_live_stats` read alongside `player_gameweek_stats`. The rendered `/team` text is
  **byte-identical** before and after.
  - The first attempt measured as **no improvement**, and the trace showed why: the new season
    wave was still awaited after the (now parallel) rivals chain, which had become the critical
    path. Moving it ahead fixed that; `manager_picks` now starts at ~0.7 s, down from ~1.03 s.
  - What remains is mostly dev-mode render gaps between effects that wait on `data`. The win is
    real but small, about 0.5 s.

Two things worth keeping:

- **supabase-js query builders are lazy.** A request is only sent when something calls `.then`.
  `const p = supabase.from(…)…` followed by `await p` later starts nothing early. Each read
  that's meant to start early calls `.then((r) => r)`.
- **Two planned items were dropped as wrong.** Swapping `/team`'s auto-connect `user_profiles`
  read for `useAuth().entryId` would be *slower*: the provider only settles after a second,
  serial `managers` read, while the page's own read already runs in parallel with it. And
  converting the `players`/`manager_picks` loops to concurrent paging buys nothing today, since
  each is a single page (667 and ~75 rows).

**Row-cap check.** `players` and `player_xp_horizons` are at 667, `player_rate_profile` at 491,
last season's history at 480, and one event's `player_predictions` at 667. All are unpaged
`.limit(1000)` reads on `/players`/`/transfers`, and all are under the cap. The one to watch is a
large **double gameweek**: a single event's `player_predictions` gains one row per extra fixture,
and a heavy DGW could approach 1000 on the `/players` minutes read.

## 3. Found in flight: the price-watch scan downloads the whole ownership table

This wasn't in scope and wasn't fixed. It is the biggest latency cost measured this sprint.

`loadPriceProgress` (`lib/price-watch.ts`) narrows its ownership scan to `earliestAnchor`, the
**oldest** last-price-change across all players. That was 2026-08-03 (pre-season), so the scan
returns the entire season's `player_ownership_history`:

- **73,287 rows**, fetched as ~74 concurrent 1000-row pages on every visit to `/players` or
  `/transfers` (148 requests in dev under StrictMode, averaging 8 s each and finishing at ~19 s).
  It doesn't block first paint, but it saturates the connection for 15+ seconds, so anything
  else the page requests in that window queues behind it.
- A per-player anchor would still ship **46,938 rows**. Moving the anchor filter server-side
  only removes about a third.
- The table grows by ~15,000 rows a day (23 samples × 667 players), so the cost grows linearly
  for the rest of the season.

A fix needs server-side work (an RPC or view that does the per-player windowing, or a
precomputed reading). The price-watch arithmetic (counter-reset detection, the fitted
thresholds) has to keep one implementation. Tracked as
[DSI-187](https://linear.app/dsinha-org/issue/DSI-187), which lists the candidate shapes and
the gate (identical readings per player, before and after).

### 3a. The same bug in `notify`'s copy, fixed and deployed

The wiki ingest after this sprint found that `notify`'s price-proximity alert (Sprint 39) makes the
same ownership read, **unpaged**. Its comment argued the cap was out of play at "dozens of
players". But the row count is players × samples since the earliest anchor: for the owner's
15-player squad the read asked for 4,284 rows and the cap returned the oldest 1,000.

- **Fix.** `readAllPages` in `supabase/functions/notify/index.ts` reads serial `.range()` pages
  with a total order (`observed_at, player_code`) on both the price-history and ownership reads.
  A failed page returns no alerts for that user and logs it, rather than alerting on a partial
  read.
- **Verified before deploy** with a throwaway harness that ran the old and new functions (source
  extracted from `git show HEAD` and the working copy) against live data for the owner's squad:
  - the old version computed a total for only **6 of 15** players, all 6 wrong;
  - the new version computes all 15, and **every total matches the site's own
    `loadPriceProgress` exactly**;
  - at the 20,000 threshold, 10 players are past it, not 6.
- **One alert already sent was false.** 215136 went out on 2026-09-22 at −67,848; the true figure
  is about −9,419, under the threshold.
- **Deployed as `notify` v7.** Deploying from the repo also brought `notify`'s bundled
  `_shared/cron-auth.ts` up to DSI-142's retry. The deployed v6 bundle still had the pre-retry
  copy, because each function bundles its own `_shared`, which is the drift DSI-75 is about.

## 4. DSI-77: lint

- Removed the dead `eslint-disable` directives in `app/leagues/page.tsx` and `app/team/page.tsx`,
  plus `/team`'s unused `card` constant. `npm run lint` now reports zero problems.
- `/ship-check` prints eslint's `✖ N problems (X errors, Y warnings)` line on a pass as well, and
  its SKILL.md says the verdict is the exit code. The "potentially fixable" line after the summary
  is the one that hid an error on 2026-09-10.
- `.claude/helpers/**` (gitignored graft hook scripts) is now in eslint's ignores. CI never saw
  those files, but they made the local gate fail where CI passed. A local gate that always fails
  teaches people to stop reading it, which is exactly the habit DSI-77 is about.

## Verification

- `/ship-check`: typecheck, lint and build all PASS.
- Preview, signed in: `/team`, `/players`, `/transfers` and `/builder` render with no console
  errors. The `/team` rendered text is identical before and after.
- The preview pane's animation frames were intermittently throttled (`requestAnimationFrame`
  stalled). While that lasts, `motion` exit animations can't finish, so a closed panel lingers in
  the DOM at opacity 0. This reproduced identically on the unchanged drawer code and is the
  environment, not this change (CLAUDE.md, "`behavior: "smooth"` does nothing on a hidden
  document").
