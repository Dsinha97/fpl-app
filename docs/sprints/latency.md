# Latency — measured baseline and a roadmap

The site feels slow. Rather than start from generic web-performance advice, this measures
fpldecision.com as it actually runs today, checks the owner's NotebookLM research
([`docs/sources/website-optimization.md`](../sources/website-optimization.md)) against those
numbers, and ranks the ideas that survive contact with this app's own architecture — a static
Next.js export on Cloudflare Workers static assets, Supabase Postgres behind it, everything
fetched client-side after hydration (see [architecture.md](../architecture.md)).

**Two passes.** The first pass (below) measured signed out and changed no code — baseline and
ranked plan only. A second pass the same day signed in as the real owner account, closed the
signed-out blind spot, built and verified items 1 and 3's `/deadline`/`/builder` fixes, and found
one new, larger cost (item 5, not yet fixed — see "Signed-in baseline" below).

## Baseline (measured 2026-08-27, production, signed out)

Captured via the browser's own `performance.getEntriesByType("navigation"|"resource")` against
`https://fpldecision.com`, one route per navigation, no synthetic throttling — real numbers over
the owner's actual connection. "Signed out" matters: `/team/`'s auth-gated Supabase calls (the
squad-specific ones) never fire in this state, so `/team/`'s numbers below undercount its real
cost. That gap is flagged rather than guessed at — see **Limitations**.

| Route | DOMContentLoaded | `load` event | Supabase requests | Waves¹ | Last response settles |
|---|---|---|---|---|---|
| `/` | 590 ms | 699 ms | 5 | 2 | ~2,111 ms |
| `/team/` (signed out — partial) | 131 ms | 370 ms | 4 | 1 | 1,157 ms |
| `/players/` | 109 ms | 362 ms | 13 | 4 | 1,600 ms |
| `/transfers/` | 105 ms | 393 ms | 35 | 5 | 1,956 ms |
| `/builder/` | 113 ms | 388 ms | 15 | — | 2,278 ms |
| `/deadline/` | 123 ms | 403 ms | **40** | **~30** | **6,203 ms** |

¹ "Waves" = distinct ~50 ms start-time clusters among the Supabase requests — a proxy for how
many round trips are serialized rather than fired together.

**JS shipped per route** (from the production `npm run build` static export, `out/_next/static`,
by walking each route's `index.html` for its actual `<script>`/chunk references — raw bytes, not
wire-compressed):

| Route | Unique chunks | Raw JS bytes |
|---|---|---|
| `/` | 13 | 1,032,621 |
| `/team/` | 15 | 1,132,714 |
| `/players/` | 15 | 1,119,758 |
| `/transfers/` | 14 | 1,114,093 |
| `/builder/` | 16 | 1,177,433 |
| `/deadline/` | 16 | 1,179,116 |

Every route ships within 15% of the same ~1.1 MB of raw JS — there is essentially one bundle for
the whole app, not six route-specific ones. (First real navigation transfers this compressed —
the homepage measured 286 KB of JS over the wire for 12 files, `transferSize`; later
same-session navigations look artificially light in the per-route table above because the
browser already has the shared chunks cached — a caveat, not a route-specific win.)

Two chunks dominate: `_next/static/chunks/431at9exx6k4s.js` (235 KB) and `4561u0v7ysn3r.js`
(229 KB), together ~40% of the total. Turbopack's production minification strips module path
strings, so what's actually inside them couldn't be identified without adding a bundle analyzer —
flagged as a prerequisite for the chunk-trimming item below, not assumed.

### The clearest finding: `/deadline/` serially pages `player_predictions`

`app/deadline/page.tsx:433` runs its own copy of the "page past the API's 1,000-row cap" loop —
but unlike [`lib/player-pool.ts`](../../lib/player-pool.ts) (which already fires all pages
concurrently and memoises the result — CLAUDE.md's "one quantity, one implementation" — used by
`/transfers` and `/chips`), this one `await`s each `.range()` page before requesting the next.
The captured waterfall shows it directly: ~20 requests to
`/rest/v1/player_predictions?...&offset=N000&limit=1000`, each ~190–210 ms, starting almost
exactly ~190–210 ms after the previous one *ends* — textbook serial paging, not a slow query.
That single loop accounts for the majority of `/deadline/`'s 6.2 s settle time.

### Limitations of this baseline

- **Signed-out only.** `/team/`, `/deadline/`'s manager-specific calls, and anything gated behind
  auth were not exercised — CLAUDE.md's per-session magic-link OTP quota and the general rule
  against granting OAuth without asking meant this pass didn't sign in. The unauthenticated
  numbers above are a floor, not the full picture, for those routes.
- **One connection, one moment.** No repeat sampling, no throttled-network profile, no mobile
  viewport. Good enough to rank *architecture-level* fixes (waterfalls, bundle splitting); not
  good enough to promise a P75 number.
- **Chunk contents inferred, not confirmed** — see above.

## Signed-in baseline (measured 2026-08-27, local dev, real manager)

The "signed out only" gap above is closed. Signed in as the owner's real Google-linked account
(`deepayansinha@gmail.com`, FPL manager 274486, claimed via `user_profiles.entry_id`) against the
local dev server — dev mode's React StrictMode double-invokes effects, so absolute request counts
here run roughly 2× a production count and aren't comparable across environments; only the
before/after comparison within this same session is.

| Route | Requests | Settle time | What's dominating |
|---|---|---|---|
| `/team/` | 43 | **8.3 s** | A single `sync-manager` Edge Function call blocking for **3.7 s**, everything else on the page queued behind it — new finding, see item 5 below |
| `/deadline/` | 103 → **74** (after fix) | 6.8 s → **3.8 s** (after fix) | Confirmed: same serial `player_predictions` loop as signed out, unaffected by auth state |
| `/transfers/` | 55 | 1.5 s | Fine, already on the concurrent pattern — unaffected by manager-scoped data |
| `/builder/` (opening Replace) | +26 → **+24** (after fix) | ~5.3 s → **~1.9 s** (after fix) | Confirmed: same serial loop, lazy-loaded on first panel open |

Two things the signed-in pass ruled out or found that the signed-out pass couldn't:

- **`lib/manager-picks.ts`'s two paging loops are not a real cost.** The suspicion when this
  baseline was written was that they might serially page the way `/deadline` did. Checked against
  the live database: `manager_picks` holds 75 rows total, 15 for this manager — nowhere near the
  1,000-row page cap, so each loop's `for` only ever runs once. Recorded here so it isn't
  re-investigated later without cause.
- **`sync-manager` is a bigger cost than anything this document has ranked.** See item 5.

## What the notebook recommends, checked against this baseline

Full source: [`docs/sources/website-optimization.md`](../sources/website-optimization.md). Its
own synthesis targets a generic **server-backed** analytics dashboard; most of its four pillars
assume infrastructure this app doesn't have.

| Notebook recommendation | Verdict here | Why |
|---|---|---|
| Columnar OLAP engine (ClickHouse) / TimescaleDB continuous aggregates | **Doesn't apply** | The whole FPL dataset is low-hundreds-of-players × ~38 gameweeks — thousands of rows, not the "billions of rows" the notebook's own materialized-view section assumes. Postgres OLTP is not the bottleneck; the measured waterfalls are. |
| Cursor/keyset pagination instead of offset `.range()` | **Doesn't apply to the cause, does slightly to the shape** | The measured cost isn't `.range()`'s `O(N)` scan cost (Supabase's PostgREST `.range()` is already index-backed offset pagination on a small table, not the pathological "scan-and-discard millions of rows" case) — it's that the pages are awaited one at a time. Switching to a cursor wouldn't fix a serial loop; making the loop concurrent (§ below) would. |
| Binary serialization (Protobuf/MessagePack) instead of JSON | **Doesn't apply** | Supabase's REST layer is JSON-only (PostgREST); adopting Protobuf would mean standing up a server to transcode, contradicting the static-export non-goal. The measured payloads are small enough (thousands of rows of a handful of numeric fields) that parse time was never in the waterfall — round-trip *count*, not payload *format*, dominates every measured route. |
| Brotli compression | **Already done** — not by this app, by the platform | Cloudflare Workers static assets serves brotli/gzip automatically per `Accept-Encoding`; nothing in `public/_headers` or `wrangler.jsonc` needs to opt in. Nothing to build. |
| WebSocket / SSE / WebTransport for real-time updates | **Doesn't apply** | No server to hold a socket open — static export, no route handlers (`next.config.ts`). Nothing here needs sub-second push; gameweek/price data changes on the order of hours. |
| TanStack Query / SWR for client caching (`staleTime`/`cacheTime`) | **Applies, partially already done** | `lib/player-pool.ts`'s in-memory 5-minute TTL cache is a hand-rolled version of exactly this idea, scoped deliberately to one hot path. Extending the *pattern* (not necessarily the library) to more pages is real work below — see "Extend the shared cache." |
| DOM virtualization (react-window) for long lists | **Worth checking, not measured yet** | `/players/` renders the full ~600-player pool; whether that list is virtualized wasn't part of this pass (no scroll-jank measurement taken). Flagged as a follow-up, not ranked here — no baseline number to hold it to yet. |
| OffscreenCanvas / Web Workers for chart rendering | **Doesn't apply** | No canvas-based charting library in `package.json`; nothing here draws on a `<canvas>`. |
| OpenTelemetry tracing, Core Web Vitals dashboards | **Not this pass's scope** | Genuinely useful for catching regressions later, but it's observability infrastructure, not a latency fix — would need its own approval (new dependency, possibly a collector endpoint). Noted as a non-goal for this roadmap, worth a separate conversation. |
| Route-level code splitting / lazy loading | **Notebook doesn't say this explicitly, but its "avoid heavy components on landing" point implies it, and the baseline confirms it's real here** | Zero `next/dynamic`/`React.lazy` usage found in `app/`, `components/`, `lib/` — every route ships the same ~1.1 MB bundle regardless of what it uses. Ranked #1 below. |

## Ranked work items

### 1. Fix `/deadline/`'s serial pagination loop — **built and verified 2026-08-27**
**Cost was:** ~20 sequential round trips, ~4–5 s of the measured 6.2–6.8 s settle time.
**Built:** `app/deadline/page.tsx`'s Stage 3b now calls `lib/player-pool.ts`'s
`loadPredictionSeries` directly instead of its own `await`-in-a-loop `.range()` calls — routing
through the exact shared helper this item proposed, rather than duplicating its pattern
(CLAUDE.md's "one quantity, one implementation"). Deliberately fetches from `nextEvent` (not
`nextEvent + 1`), which is the same cache key `/transfers` and `/chips` already use — a small,
free overlap with Stage 3a's own single-event fetch, in exchange for cache-sharing across pages.
**A real correctness bug was found and fixed along the way, not just a speed issue:**
`player-pool.ts`'s `fetchAll` fired its pages concurrently with pre-computed offsets but issued no
`.order()` — Postgres gives no guarantee that two separate `OFFSET` queries return rows in the
same order without one, so concurrent pages could have silently overlapped or skipped rows. Fixed
by adding `.order("player_id").order("event").order("fixture")` — all three keys are needed since
`(player_id, event)` alone isn't unique (a double gameweek is two rows sharing both) and
`(season, model_version, player_id, fixture)` is the table's real primary key, making the
three-key order total within one season. Verified in a throwaway `npx tsx` harness against live
data (per CLAUDE.md — deleted after use): row counts, player counts, and every per-event value
matched exactly between the old serial loop and the new concurrent+ordered one, for both
`/deadline`'s overwrite-reducer and `/builder`'s accumulate-reducer (see item 3).
**Measured:** settle time 6.8 s → **3.8 s** (same signed-in local session, so directly
comparable); the ~30-wave serial pattern collapsed to 4 concurrent waves.

### 2. Route-level code splitting for the heaviest engines and components
**Cost today:** every route ships ~1.1 MB of raw JS regardless of use; no route is below 1.0 MB.
**Fix:** Wrap the page-specific heavy modules in `next/dynamic` — starting with
`lib/transfer-optimizer.ts`, `lib/optimizer.ts`, and `lib/squad-score.ts` (the engines only
`/builder`, `/transfers`, `/deadline` actually run), plus any large page-only components. A
static export supports `next/dynamic` for client components (no SSR streaming needed — CLAUDE.md
already notes static export means no server-rendering, but dynamic *client-side* imports still
split the bundle into separately-fetched chunks).
**Effort:** medium — requires checking each split point doesn't break a synchronous call site.
**Risk:** low-medium; test each page after splitting since a static export has no server fallback
to catch a broken dynamic import at build time the way SSR would.
**Verify:** re-run the "unique chunks / raw JS bytes" table above per route; a route that doesn't
use the optimizer should show a materially smaller number than one that does, where today they're
within 15% of each other.

### 3. Extend the concurrent-fetch-and-cache pattern past `player_predictions`
**`/builder`'s lazy replace-panel loop — built and verified 2026-08-27, same change as item 1.**
`app/builder/page.tsx`'s replacement-finder loop already filtered `.gte("event", nextEvent)` —
exactly `loadPredictionSeries(season, nextEvent)`, the same cache key as `/transfers`, `/chips`
and (after item 1) `/deadline`. Swapped in directly, preserving the *accumulate* reducer
(`byEvent.set(event, (byEvent.get(event) ?? 0) + xp)`) rather than item 1's *overwrite* one — a
double gameweek is two rows for one event and both must count, unlike `/deadline`'s idempotent
overwrite. Correctness verified in the same harness as item 1. **Measured:** opening the Replace
panel went from ~23 serial round trips / ~5.3 s to 24 requests in 2 waves / **~1.9 s**. Cache
sharing with `/transfers`/`/chips`/`/deadline` follows from the identical cache key
(`${season}:${nextEvent}`) and the memoisation being a simple `Date.now() - hit.at < TTL_MS`
check in `lib/player-pool.ts` — verified by reading that code path, not by a live cross-page
capture (browser-automation reproduced the correctness case but not a real SPA client-side
transition in the time available for this pass).

**Still open:** `/players/` (13 requests, 4 waves) and `/transfers/` (35 requests, 5 waves) both
show later waves that look like they depend on earlier ones finishing rather than being
independently fetchable — e.g. `/players/`'s last two Supabase calls start at 901 ms and 1,103 ms,
well after the first wave of 7 parallel calls at 567 ms. **`/team` shows the same pattern too**
(surfaced by item 5's fix — it was previously hidden behind the 3.7 s `sync-manager` block):
signed in, `/team`'s remaining ~5.5 s settle time is a serial chain of ~15 waves among its own
reads, one of which (`player_xp_horizons`, 1000 rows) alone takes 1.6 s. Same fix shape as above:
check whether
each later-wave query really depends on an earlier result or was just written sequentially, hoist
what can be hoisted, and cache what's season-scoped model output rather than live/squad-scoped
data.
**Effort:** medium — needs one page at a time, reading each `useEffect`/fetch sequence to confirm
which calls are truly independent before reordering.
**Risk:** low if each change is verified against the real dependency, not assumed.
**Verify:** wave count per page should drop; total settle time is the number that matters, not
request count.

### 4. Identify what's in the two ~230 KB chunks before proposing a fix
**Cost today:** unknown composition, ~40% of the shared bundle.
**Fix:** Add a one-off bundle analyzer run (e.g. `@next/bundle-analyzer`, dev dependency only,
run locally and not committed to the build pipeline) to see what's actually in
`431at9exx6k4s.js` and `4561u0v7ysn3r.js` before assuming it's prunable. This is a prerequisite
investigation, not a fix by itself.
**Effort:** low to investigate, unknown to fix until the contents are known.
**Risk:** none to investigate; the fix's risk depends what's found.
**Verify:** N/A until contents are known — this item's output is a follow-up item, not a shipped
change.

### 5. `/team` re-syncs from the live FPL API on every page load — built and verified 2026-08-27
**Cost was:** a single blocking call, **3.7 s** — bigger than any other item in this document,
including the pre-fix `/deadline` problem this whole pass started from.
**What was happening:** `app/team/page.tsx`'s auto-connect effect called `connect(entryId)`
unconditionally whenever a claimed `entry_id` existed, and `connect` invoked the `sync-manager`
Edge Function — a full live re-fetch from FPL's own API (`getEntry`, `getEntryHistory`,
`getEntryTransfers`, per-gameweek picks) — and `await`ed it before reading anything back from
Supabase. Every visit to `/team` while signed in blocked on a round trip to a third-party server
before showing data that, in the common case, hadn't changed since the last visit. Invisible to
the earlier signed-out baseline, since the whole path sits behind `user && entryId`.

**Built:** the staleness policy the previous write-up said this needed — the owner specified it
directly: sync once a day when no match is live, every poll tick while one is, explicitly modelled
on how `sync-live-gameweek` already handles the identical "freshness under a live match" problem
for live scores.

- **`supabase/functions/_shared/manager-sync.ts`** — the fetch-and-write logic extracted out of
  `sync-manager` verbatim, so both the client-triggered single-manager sync and the new cron can
  call the exact same implementation (CLAUDE.md's "one quantity, one implementation").
- **`supabase/functions/_shared/sync.ts`** gained `hasLiveFixture` — `sync-live-gameweek`'s own
  matchday query, extracted so there's one implementation of "is a match live right now" rather
  than two functions each deciding it separately. `sync-live-gameweek` now calls it too
  (behaviour-preserving — same query, same error message).
- **`supabase/functions/sync-claimed-managers`** (new, cron `*/2 * * * *`, same cadence as
  `fpl-sync-live-gameweek`) — every claimed manager (`user_profiles.entry_id`) is due if never
  synced (`managers` has no row yet — a fresh claim doesn't wait a day for its first data), due
  unconditionally on a matchday (the 2-minute tick *is* "every switch"), or due on a non-matchday
  once `managers.updated_at` (sync-manager's upsert is the table's only writer, so its
  trigger-maintained timestamp is a clean "last synced" signal — no new column) is over 24h old.
  One manager's failure doesn't sink the run; each is caught individually.
- **`app/team/page.tsx`** — `connect` takes an options `{ sync?: boolean }`; the auto-mount
  effect now calls `connect(entryId, { sync: false })`, skipping straight to reading Supabase. A
  claim the cron hasn't reached yet (no `managers` row) falls back to a real sync automatically —
  the same "no row yet" signal the cron's own due-list check uses, checked client-side instead of
  guessed at with a timer. The **Refresh** button and rival mutations are unchanged, still forcing
  a real sync via `connect(entryId)` (`sync: true` default) — verified: clicking Refresh still
  fires `sync-manager`.

**Measured (same signed-in local session):**
- `/team` settle time: **8.3 s → 5.55 s**, and the `sync-manager` function call is **gone**
  entirely from an ordinary load (0 `functions/v1` requests, confirmed via
  `performance.getEntriesByType("resource")`).
- The remaining 5.55 s is **not** this item — it's a separate, pre-existing serial-waterfall
  pattern among `/team`'s *other* Supabase reads (the same shape as item 3's "still open" finding
  on `/players`/`/transfers`, now visible on `/team` too now that the bigger cost is gone). One
  request in that chain, `player_xp_horizons` selecting 1000 rows, alone took 1.6 s. Not fixed
  here — out of this item's scope, worth its own pass.
- Server-side: force-invoking `sync-claimed-managers` synced both claimed managers (`274486`,
  `4675109` — the app's 3 users collapse to 2 distinct claimed entries) in one run, advanced
  `managers.updated_at` for both, and wrote a `sync_runs` row with `status: "success"`. A second,
  un-forced invocation immediately after correctly found nothing due (`"skipped": "nothing due"`).
  `sync-live-gameweek`, after its refactor, still correctly no-ops with no live fixture.

## Measured, rejected

- **Migrate to a columnar/OLAP database (ClickHouse, TimescaleDB).** The dataset is thousands of
  rows, not billions; every measured route's cost is round-trip count and JS payload, not query
  execution time inside Postgres. Re-open only if a future baseline shows actual query duration
  (not round-trip count) dominating a route.
- **Switch API payload format to Protobuf/MessagePack.** Would require standing up a server
  (contradicts the static-export non-goal below) to transcode Supabase's JSON, for a payload size
  that was never the bottleneck in any measured route.
- **Cursor-based pagination in place of `.range()`.** The measured cost is serial *awaiting*, not
  offset-scan cost on a small table — item #1 above fixes the actual cause.
- **WebSocket/SSE for real-time updates.** No server to host the channel; nothing in this app
  changes fast enough to need push over poll-on-navigate.

## Non-goals

- No move off `output: "export"` / Cloudflare Workers static assets. Every item above works
  within that constraint.
- No new runtime dependency added on the strength of this document alone. `next/dynamic` (item 2)
  is a first-party Next.js feature, not a new dependency; a bundle analyzer (item 4) is dev-only
  and not shipped.
- Signed-in-route measurement and OpenTelemetry-grade observability are real gaps in this
  baseline, not silently ignored — both are named above as follow-ups requiring their own
  approval, not folded into this pass's scope.
