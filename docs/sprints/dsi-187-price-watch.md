# DSI-187 — the price-watch reading, precomputed on write

**Applied 2026-11-04 (UTC).** [Sprint 40](sprint-40.md) §3 found that `loadPriceProgress` downloaded the
whole `player_ownership_history` table on every `/players`, `/transfers`, `/shortlist` or profile-modal visit.
It was 73,287 rows then and **154,524 on 2026-11-03**, growing ~15k a day. The shape chosen was the issue's
second candidate: precompute on write.

## What changed

- **`public.price_watch`** — one row per player and season: `anchor_at` (last price change), `sample_count`,
  `net_transfers`, `latest_percent`, `as_of`, and `rate_per_hour` (trailing 24 h). Public read, no client
  writes (checked: `anon` reads 670 rows and cannot insert).
- **`refresh_price_watch(season)`** holds the reset-aware accumulation. It runs from statement-level triggers
  on `player_ownership_history` and `player_price_history`, so it is current after every sampling insert. It
  reads only rows at-or-after each player's anchor, writes only rows whose figures changed, and is wrapped so a
  failure logs a warning rather than rolling back the sampling insert (that history cannot be recovered).
- **`loadPriceProgress`** reads `price_watch` (a count plus one page) and applies the fitted thresholds, the
  verdict ladder and the projection in TypeScript. `readingFromNet` and `projectFromRate` are the shared tails
  of the raw-sample path (`priceProgress`, `projectToCutoffs`) and the stored path, so those have one
  implementation.
- **`scripts/price-watch-parity.ts`** keeps the old full-scan loader verbatim as the reference and compares it
  to the stored path player by player.
- **`notify`** (price-proximity alert) reads `price_watch`; **deployed 2026-11-04 as v9** (`verify_jwt` unchanged, the three `_shared` files redeployed byte-identical to git).

## The one-implementation rule, honestly

The accumulation now exists twice: in SQL (`refresh_price_watch`) and in TypeScript
(`netTransfersSinceLastPriceChange`, kept because the walk-forward scripts replay it over arbitrary historical
sample windows). Before this change it existed three times (site, `notify`, and the scripts' mirrors). The
parity script is what ties SQL to TypeScript; **re-run it after any change to either side.** The reset
predicate (`transfers_in_event` decreasing between consecutive samples) is the part to keep equal.

## Gate: identical readings, and the latency

| | before | after |
|---|---|---|
| Readings vs the reference loader (670 players) | — | **all identical**: `netTransfers`, `direction`, `progress`, `progressRaw`, `verdict`, `asOf` |
| Projections (249 compared) | — | 0 outside ±0.02 or differing in length |
| Loader, node harness | 37.4 s | **0.65 s** |
| Rows read per visit | 154,524 (~155 requests) | ~670 (count + 1 page) |
| Ownership-history requests on `/players` (dev, preview) | ~148 averaging 8 s | **0**; `price_watch` calls 190–330 ms |

Checked before applying, in a rolled-back transaction: the SQL's per-player nets hashed equal to the
TypeScript path's (670 rows, 658 readings, sum 350,860), a synthetic sample moved one player's net by exactly
its +1,000, and a second refresh wrote nothing. A refresh takes ~0.4 s in steady state and runs on both tables
per sync tick (~0.4–0.8 s added to a tick).

## Known differences

- **The projection's rate is measured at the last refresh**, not at page load, so it can be up to one sync tick
  old. The parity run found no projection moving more than 0.02.
- **A null `selected_by_percent` reads as 0**, as it did before (`Number(null)`); preserved, not fixed.

## Closed 2026-11-04

Both open checks passed. An ownership sample landed at 02:00:10 UTC (86 rows) and `price_watch.rate_computed_at`
read exactly 02:00:10.606739, the same transaction, so the trigger fires in production. `notify` v9's first run
(02:15:04) read `success`. DSI-187 is Done.

## Not done

- **`notify` v9's alert logic has not fired on a real crossing.** Its first run (02:15 UTC) read `success` with
  `detected: 0`, which is correct but uninformative: it says the read works, not that an alert is built right.
  The stored nets equal the old arithmetic and `anchor_at` is the value the dedupe key used before, so none
  should re-fire; that is reasoned, not observed.
- **No browser cache layer** (the issue's third candidate). It is unneeded at ~670 rows.
- `/transfers`, `/shortlist` and the profile modal were not opened; they call the same loader.
