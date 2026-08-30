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
not six route-specific ones.

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
| Route-level code splitting | Real, not yet built | Zero `next/dynamic`/`React.lazy` usage anywhere — every route ships the same ~1.1MB bundle regardless of what it uses. |

## Still open

- **Route-level code splitting.** `lib/transfer-optimizer.ts`, `lib/optimizer.ts`,
  `lib/squad-score.ts` — the heavy engines only `/builder`/`/transfers`/`/deadline` actually run —
  are candidates for `next/dynamic` (a static export supports client-side dynamic imports, just not
  SSR streaming). Medium effort, needs each split point checked against a synchronous call site.
- **Serial waterfalls on `/players` and `/transfers`** that don't reduce to the pagination bug
  above — later Supabase calls that look dependent on earlier ones finishing rather than
  independently fetchable. The same pattern showed up on `/team` too, once item 3 above removed
  the bigger cost hiding it (a `player_xp_horizons` read alone took 1.6s in that chain). Needs
  reading each page's fetch sequence to confirm which calls are genuinely independent before
  reordering — not assumed.
- **Bundle composition.** Two chunks (~230KB each, ~40% of the shared bundle) have unidentified
  contents — Turbopack's production minification strips module path strings. A bundle analyzer run
  is a prerequisite investigation, not a fix by itself.
- **DOM virtualization for `/players`'** ~600-player list — flagged, not measured (no scroll-jank
  capture taken this pass).

## Non-goals

No move off `output: "export"` / Cloudflare Workers static assets — every item above works within
that constraint. No new runtime dependency added on the strength of the notebook alone
(`next/dynamic` is first-party Next.js; a bundle analyzer would be dev-only, unshipped).
OpenTelemetry-grade observability is a real gap, named as a follow-up requiring its own approval,
not folded into this pass.

See also: [data-pipeline.md](data-pipeline.md) (the `sync-manager`/`sync-claimed-managers` fix in
full), [deployment.md](deployment.md) (the static-export constraints these verdicts lean on),
[methodology.md](methodology.md) (verify an external recommendation against this app's own
measurements before adopting it).
