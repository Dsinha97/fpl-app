# Performance

The site felt slow. Rather than start from generic web-performance advice, a 2026-08-27 pass
measured `fpldecision.com` as it actually runs, checked the owner's NotebookLM research
([`docs/sources/website-optimization.md`](../sources/website-optimization.md)) against those
numbers, and ranked only the ideas that survive contact with this app's own architecture — a
static Next.js export on Cloudflare Workers static assets, Supabase Postgres behind it, everything
fetched client-side after hydration. Full detail: [sprints/latency.md](../sprints/latency.md).

## Baseline, two passes

**Pass 1 (signed out, production)** — real `performance.getEntriesByType` captures against
`https://fpldecision.com`, no synthetic throttling. `/deadline/` stood out: 40 Supabase requests,
~30 of them in serial waves, settling at 6.2s versus every other route's sub-2.3s. Every route
ships within 15% of the same ~1.1MB of raw JS — there is essentially one bundle for the whole app,
not six route-specific ones. *(Sprint 40 measured why, and it wasn't what this pass assumed; see
[below](#sprint-40-the-shared-bundle-and-the-read-waterfalls-2026-09-24).)*

**Pass 2 (signed in, local dev, real manager)** closed the signed-out blind spot and found a
bigger cost than anything pass 1 had ranked: `/team` blocking 3.7s on a single Edge Function call
before rendering anything. See [data-pipeline.md](data-pipeline.md#team-no-longer-syncs-on-every-load-fixed-2026-08-27)
for that fix.

## Built and verified, same day

1. **`/deadline`'s serial `player_predictions` pagination.** `app/deadline/page.tsx` ran its own
   copy of the "page past the 1000-row cap" loop (see
   [fpl-api-constraints.md](fpl-api-constraints.md#response-size)), but `await`ed each page before
   requesting the next — ~20 sequential round trips, each starting only after the previous one
   settled. Textbook serial paging, not a slow query. Routed through
   [`lib/player-pool.ts`](../../lib/player-pool.ts)'s existing `loadPredictionSeries` instead,
   which already fires all pages concurrently and memoises the result (CLAUDE.md's "one quantity,
   one implementation"). **A real correctness bug was found fixing this, not just a speed issue**:
   `loadPredictionSeries`'s `fetchAll` fired concurrent pages with pre-computed offsets but issued
   no `.order()` — Postgres gives no guarantee that two separate `OFFSET` queries return rows in
   the same order without one, so concurrent pages could silently overlap or skip rows. Fixed with
   a three-key `.order("player_id").order("event").order("fixture")` (needed because
   `(player_id, event)` alone isn't unique — a double gameweek is two rows sharing both). Verified
   in a throwaway `npx tsx` harness against live data: row counts, player counts, and every
   per-event value matched exactly between the old serial loop and the new concurrent+ordered one.
   **Measured:** 6.8s → **3.8s** settle time; ~30 serial waves collapsed to 4 concurrent ones.
2. **`/builder`'s replace-panel loop**, same shared helper, same bug class, already using the
   correct *accumulate* reducer (a double gameweek's two rows for one event both count, unlike
   item 1's idempotent overwrite). **Measured:** ~23 serial round trips / ~5.3s → 24 requests in 2
   waves / **~1.9s**.
3. **`/team`'s unconditional `sync-manager` call on every load** — 3.7s blocking, the single
   largest cost measured across either pass. Full write-up:
   [data-pipeline.md](data-pipeline.md#team-no-longer-syncs-on-every-load-fixed-2026-08-27).
   **Measured:** `/team` settle time 8.3s → **5.55s**, the Edge Function call gone entirely from
   an ordinary load.

## What the notebook recommends, checked against this app

The notebook's own synthesis targets a generic **server-backed** analytics dashboard; most of its
four pillars assume infrastructure this app deliberately doesn't have.

| Recommendation | Verdict | Why |
|---|---|---|
| Columnar OLAP engine (ClickHouse, TimescaleDB) | Doesn't apply | Dataset is low-hundreds-of-players × ~38 gameweeks — thousands of rows, not the "billions" the notebook's own materialized-view section assumes. Postgres OLTP was never the bottleneck; the waterfalls were. |
| Cursor/keyset pagination instead of `.range()` | Doesn't apply to the cause | The measured cost isn't `.range()`'s scan cost (already index-backed on a small table) — it's pages being *awaited* one at a time. Making the loop concurrent fixes it; a different pagination style wouldn't. |
| Binary serialization (Protobuf/MessagePack) | Doesn't apply | Supabase's REST layer is JSON-only (PostgREST); adopting Protobuf would mean standing up a transcoding server, contradicting the static-export architecture (see [deployment.md](deployment.md)). Payload size was never in any measured waterfall. |
| Brotli compression | Already done, by the platform | Cloudflare Workers static assets serves it automatically per `Accept-Encoding`; nothing to build. |
| TanStack Query / SWR client caching | Partially already done | `lib/player-pool.ts`'s in-memory 5-minute TTL cache is a hand-rolled version of the same idea, scoped to one hot path. Extending the *pattern* to more pages is the still-open item below. |
| WebSocket/SSE for real-time updates | Doesn't apply | No server to hold a socket open (static export, no route handlers); nothing here changes fast enough to need push over poll-on-navigate. |
| Route-level code splitting | Real, built Sprint 40, but not where expected | Zero `next/dynamic`/`React.lazy` usage anywhere as of this pass. When Sprint 40 measured it, the engines were already split per route; the shared cost was elsewhere (see below). |

## Sprint 40: the shared bundle and the read waterfalls (2026-09-24)

Three of the items this page listed as open were built in one sprint. Two of the plan's
hypotheses turned out to be wrong. Source: [sprints/sprint-40.md](../sprints/sprint-40.md).

**The bundle.** The 2026-08-27 plan proposed wrapping the heavy engines in `next/dynamic`. But
Turbopack already splits them per route; only one to four routes import each one. The plan also
said identifying chunk contents needed a new dev dependency. It didn't: Next 16.3 ships
`next experimental-analyze --output`, whose per-route `analyze.data` has a JSON header with bytes
per source module. Attributed on `/news`, a route that runs none of the engines:

- ~583KB framework and React runtime;
- ~210KB `@supabase/*`, of which ~83KB is realtime and storage clients the app never uses;
- **~135KB `motion`**, arriving via the mobile nav's `SlideOver`;
- ~117KB `@base-ui/react`, the nav dropdowns;
- ~30KB of engines, pulled in through the root layout's imports.

Two fixes:

- `SlideOver` became a thin wrapper. It prefetches the motion-based panel on idle and mounts it
  on first open. After that it stays mounted, because `AnimatePresence` has to see `open` go
  false to animate the exit. See [design-system.md](design-system.md).
- The pure transfer rules (`sellPrice`, `freeTransfersDisplay`, …) that `team-state` and the
  context bar needed moved to `lib/transfer-rules.ts`, re-exported from `lib/transfers.ts`. See
  [frontend-conventions.md](frontend-conventions.md).

**Every route's first-load JS dropped 135–153KB.** Supabase's unused clients were left alone
because trimming them means composing the auth client by hand. `@base-ui`'s Menu stays because
the desktop nav paints it on first render.

**The waterfalls.** The same queries, reordered so nothing waits for a result it never reads.
Measured signed in, dev mode, three runs before and after in one session:

| Page | Settle before → after |
|---|---|
| `/players` | ~3.2s → ~1.3s |
| `/transfers` | ~3.2s → ~2.2s |
| `/team` | ~2.7s → ~2.2s, rendered text byte-identical |

`/team`'s first attempt measured **no improvement**, and the request trace showed why: the new
parallel wave was still awaited behind the rivals chain, which had now become the critical path.
Reading the trace rather than re-running is what found it. Two planned `/team` changes were
dropped as wrong:

- Reading the entry id from the auth provider would be *slower*: the provider settles only after
  a second, serial read.
- Concurrent paging buys nothing on tables that are one page today.

**Found and not fixed: the price-watch scan.** It was the largest cost measured, and no earlier
pass had looked. `loadPriceProgress` narrows its ownership read to the *oldest* last-price-change
across all players, which is pre-season. So every `/players` or `/transfers` visit downloads the
whole `player_ownership_history` table:

- 73,287 rows as of 2026-09-24, sent as ~74 concurrent pages;
- the connection stays saturated for 15+ seconds after first paint;
- the table grows ~15k rows a day.

It needs server-side windowing without creating a second implementation of the price-watch
arithmetic. See [data-pipeline.md](data-pipeline.md).

## Still open

- ~~**Route-level code splitting.**~~ Built, Sprint 40. The engine-splitting hypothesis was wrong;
  see above.
- ~~**Serial waterfalls on `/players` and `/transfers`**~~ (and `/team`). Built, Sprint 40.
- ~~**Bundle composition.**~~ Answered, Sprint 40, with `next experimental-analyze`. No
  dependency was needed.
- **The price-watch ownership scan.** Now the largest measured cost; see above.
- **`@supabase/*`'s unused realtime/storage clients** (~83KB on every route). This touches the
  auth client, a real access boundary, so it gets its own issue rather than a latency side-quest.
- **DOM virtualization for `/players`'** ~600-player list: flagged, not measured (no scroll-jank
  capture taken yet).

## Non-goals

No move off `output: "export"` / Cloudflare Workers static assets — every item above works within
that constraint. No new runtime dependency added on the strength of the notebook alone
(`next/dynamic` is first-party Next.js; the bundle analyzer turned out to be built into Next itself).
OpenTelemetry-grade observability is a real gap, named as a follow-up requiring its own approval,
not folded into this pass.

See also: [data-pipeline.md](data-pipeline.md) (the `sync-manager`/`sync-claimed-managers` fix in
full), [deployment.md](deployment.md) (the static-export constraints these verdicts lean on),
[methodology.md](methodology.md) (verify an external recommendation against this app's own
measurements before adopting it).
