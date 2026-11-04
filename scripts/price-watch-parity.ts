// DSI-187 parity gate: the precomputed `price_watch` reading must equal the
// reading computed the slow way, player by player.
//
// `referenceLoadPriceProgress` below is the pre-DSI-187 `loadPriceProgress`,
// kept verbatim as the reference: it downloads every ownership sample since
// each player's anchor and runs the TypeScript accumulation
// (`netTransfersSinceLastPriceChange`) over them. `refresh_price_watch` is the
// SQL copy of that same recurrence; this is the check that ties the two.
//
// Compared exactly: netTransfers, direction, progress, progressRaw, verdict,
// asOf. Compared with a tolerance: the forward projection, because the stored
// rate was measured when the row was last refreshed (<= one sync tick ago)
// while the reference measures it against "now".
//
// Read-only, publishable key. Slow by design (it is the full scan).
// Usage: set -a; . ./.env.local; set +a; npx tsx scripts/price-watch-parity.ts [season]

import { supabase } from "../lib/supabase/client";
import {
  loadPriceProgress,
  priceProgress,
  projectToCutoffs,
  type OwnershipSample,
  type PriceProgress,
  type PriceThresholds,
} from "../lib/price-watch";

const SEASON = process.argv[2] ?? "2026-27";

const PAGE_ROWS = 1000;

/** Counts the rows, then fetches every page concurrently; `run` must order totally. */
async function fetchAllPages<T>(
  count: () => PromiseLike<{ count: number | null; error: { message: string } | null }>,
  run: (from: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const { count: total, error: countError } = await count();
  if (countError) throw new Error(countError.message);
  const starts: number[] = [];
  for (let from = 0; from < (total ?? 0) || from === 0; from += PAGE_ROWS) starts.push(from);
  const pages = await Promise.all(
    starts.map(async (from) => {
      const { data, error } = await run(from);
      if (error) throw new Error(error.message);
      return data ?? [];
    }),
  );
  return pages.flat();
}

/**
 * Loads ownership samples for `playerCodes` since each player's last
 * recorded price change, and returns a progress reading per player. Players
 * with no player_price_history row yet (never repriced this season) are
 * skipped — there is no "last change" to anchor on.
 *
 * Both queries are paged. This is not defensive boilerplate: the API caps
 * every response at 1000 rows whatever `.limit()` asks for, and there are
 * ~42,000 ownership samples after the anchors across the pool. Unpaged and
 * ordered ascending, this returned the *oldest* 1000 rows — all of them from
 * before nearly every anchor, so almost every player was filtered down to
 * zero or one sample and read as "unknown" or a flat net of 0. The readings
 * looked quiet rather than broken, which is why it survived. (CLAUDE.md,
 * "the API caps every response at 1000 rows".)
 *
 * `earliestAnchor` narrows the ownership scan server-side: no sample before
 * the oldest anchor among the requested players can survive the per-player
 * filter below, so there is no reason to ship it to the browser.
 */
async function referenceLoadPriceProgress(
  season: string,
  playerCodes: number[],
  /** Override the measured, ownership-scaled thresholds for every player. */
  thresholds?: PriceThresholds,
): Promise<Map<number, PriceProgress>> {
  const result = new Map<number, PriceProgress>();
  if (playerCodes.length === 0) return result;

  const lastChanges = await fetchAllPages<{ player_code: number; observed_at: string }>(
    () =>
      supabase
        .from("player_price_history")
        .select("player_code", { count: "exact", head: true })
        .eq("season", season)
        .in("player_code", playerCodes),
    (from) =>
      supabase
        .from("player_price_history")
        .select("player_code, observed_at")
        .eq("season", season)
        .in("player_code", playerCodes)
        .order("observed_at", { ascending: false })
        .order("player_code")
        .range(from, from + PAGE_ROWS - 1),
  );

  const lastChangeAt = new Map<number, string>();
  for (const row of lastChanges) {
    const code = row.player_code;
    if (!lastChangeAt.has(code)) lastChangeAt.set(code, row.observed_at);
  }
  if (lastChangeAt.size === 0) return result;

  let earliestAnchor = "";
  for (const at of lastChangeAt.values()) {
    if (earliestAnchor === "" || at < earliestAnchor) earliestAnchor = at;
  }

  const ownership = await fetchAllPages<{
    player_code: number;
    observed_at: string;
    selected_by_percent: number | null;
    transfers_in_event: number | null;
    transfers_out_event: number | null;
  }>(
    () =>
      supabase
        .from("player_ownership_history")
        .select("player_code", { count: "exact", head: true })
        .eq("season", season)
        .in("player_code", playerCodes)
        .gte("observed_at", earliestAnchor),
    (from) =>
      supabase
        .from("player_ownership_history")
        .select("player_code, observed_at, selected_by_percent, transfers_in_event, transfers_out_event")
        .eq("season", season)
        .in("player_code", playerCodes)
        .gte("observed_at", earliestAnchor)
        // (observed_at, player_code) is this table's own key, so this is a
        // total order — required, because the pages are fetched concurrently.
        .order("observed_at", { ascending: true })
        .order("player_code")
        .range(from, from + PAGE_ROWS - 1),
  );

  const byPlayer = new Map<number, OwnershipSample[]>();
  for (const row of ownership) {
    const code = row.player_code;
    const changeAt = lastChangeAt.get(code);
    if (changeAt && row.observed_at < changeAt) continue; // before the last repricing
    const list = byPlayer.get(code) ?? [];
    list.push({
      observedAt: row.observed_at,
      transfersInEvent: row.transfers_in_event,
      transfersOutEvent: row.transfers_out_event,
      // FPL returns this as a string; a non-numeric one is absent, not zero.
      selectedByPercent: Number.isFinite(Number(row.selected_by_percent))
        ? Number(row.selected_by_percent)
        : null,
    });
    byPlayer.set(code, list);
  }

  const now = new Date();
  for (const code of playerCodes) {
    if (!lastChangeAt.has(code)) continue; // never repriced this season — no anchor
    const samples = byPlayer.get(code) ?? [];
    const reading = priceProgress(code, samples, thresholds);
    // Projected here rather than in the caller so the samples are used once
    // and not refetched — and so there is one implementation of the forward
    // reading, not one per surface.
    reading.projections = projectToCutoffs(reading, samples, thresholds, now);
    result.set(code, reading);
  }
  return result;
}
async function main() {
  const { data } = await supabase.from("players").select("code").eq("season", SEASON).range(0, 999);
  const codes = (data ?? []).map((r: { code: number }) => r.code);

  const t0 = Date.now();
  const stored = await loadPriceProgress(SEASON, codes);
  const storedMs = Date.now() - t0;
  const t1 = Date.now();
  const reference = await referenceLoadPriceProgress(SEASON, codes);
  const referenceMs = Date.now() - t1;

  const keys = new Set([...stored.keys(), ...reference.keys()]);
  const bad: string[] = [];
  let projCompared = 0;
  let projDrift = 0;
  for (const code of keys) {
    const a = stored.get(code);
    const b = reference.get(code);
    if (!a || !b) {
      bad.push(`${code}: present in ${a ? "stored" : "reference"} only`);
      continue;
    }
    for (const f of ["netTransfers", "direction", "progress", "progressRaw", "verdict", "asOf"] as const) {
      const x = a[f];
      const y = b[f];
      // asOf: the same instant can be rendered with a different offset.
      const same = f === "asOf" ? (x === null ? y === null : y !== null && Date.parse(x as string) === Date.parse(y as string)) : x === y;
      if (!same) bad.push(`${code}.${f}: stored ${String(x)} vs reference ${String(y)}`);
    }
    const pa = a.projections ?? [];
    const pb = b.projections ?? [];
    if (pa.length !== pb.length) {
      projDrift++;
      continue;
    }
    for (let i = 0; i < pa.length; i++) {
      projCompared++;
      if (Math.abs(pa[i].progressRaw - pb[i].progressRaw) > 0.02) projDrift++;
    }
  }

  console.log(`stored    : ${stored.size} players in ${storedMs} ms`);
  console.log(`reference : ${reference.size} players in ${referenceMs} ms`);
  console.log(`exact fields: ${bad.length === 0 ? "ALL IDENTICAL" : `${bad.length} MISMATCHES`}`);
  for (const line of bad.slice(0, 25)) console.log("  " + line);
  console.log(`projections: ${projCompared} compared, ${projDrift} outside +-0.02 or differing in length (tolerated: rate window differs by up to one sync tick)`);
  process.exit(bad.length === 0 ? 0 : 1);
}

main();
