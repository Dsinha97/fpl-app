// One shared implementation of "page player_predictions past the API's
// thousand-row cap," used by both /transfers and /chips — the two pages that
// each hand-copied a byte-for-byte identical serial paging loop (CLAUDE.md's
// "one quantity, one implementation" rule).
//
// Two differences from the loop this replaces:
//
//  - Pages are requested concurrently rather than one `await` at a time. A
//    ~5,000-row window used to take ~6 serial round trips (~170ms each,
//    measured against the real dev DB); this fires them together, so the
//    wall-clock cost is roughly one round trip's worth instead of the sum.
//  - The result is memoised per `season`/`fromEvent` for a few minutes and
//    shared across pages in the same browser session — navigating
//    /transfers -> /chips no longer re-downloads the same ~5,000 rows a
//    second time. This is season-scoped model output, not live or
//    user-scoped data, so it is safe to hold briefly: /deadline's live
//    numbers, `manager_picks`, and anything squad-specific are untouched and
//    keep fetching fresh every time, exactly as before.
//
// Deliberately scoped to just this one hot path rather than a full
// cross-page cache of `players`/`fixtures`/etc. — those reads are smaller
// and page-specific enough (different column lists per page) that unifying
// them would trade a modest win for a much larger, riskier refactor.

import { supabase } from "@/lib/supabase/client";

export interface PredictionSeriesRow {
  playerId: number;
  event: number;
  expectedMinutes: number | null;
  startProbability: number | null;
  /** 0-1, per event. */
  availability: number;
  fdr: number | null;
  xp: number | null;
}

/** Matches the API's own per-response cap — see the loop this replaces. */
const PAGE_ROWS = 1000;
const TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  at: number;
  promise: Promise<PredictionSeriesRow[]>;
}

const cache = new Map<string, CacheEntry>();

async function fetchAll(season: string, fromEvent: number): Promise<PredictionSeriesRow[]> {
  const { count, error: countError } = await supabase
    .from("player_predictions")
    .select("player_id", { count: "exact", head: true })
    .eq("season", season)
    .gte("event", fromEvent);
  if (countError) throw new Error(countError.message);

  const total = count ?? 0;
  const pageStarts: number[] = [];
  for (let from = 0; from < total || from === 0; from += PAGE_ROWS) pageStarts.push(from);

  const pages = await Promise.all(
    pageStarts.map(async (from) => {
      const { data, error } = await supabase
        .from("player_predictions")
        .select("player_id, event, expected_minutes, start_probability, availability, fdr, xp")
        .eq("season", season)
        .gte("event", fromEvent)
        .range(from, from + PAGE_ROWS - 1);
      if (error) throw new Error(error.message);
      return data ?? [];
    }),
  );

  return pages.flat().map((r) => ({
    playerId: r.player_id as number,
    event: r.event as number,
    expectedMinutes: r.expected_minutes as number | null,
    startProbability: r.start_probability as number | null,
    availability: (r.availability as number | null) ?? 0,
    fdr: r.fdr as number | null,
    xp: r.xp as number | null,
  }));
}

/**
 * The full per-gameweek prediction series from `fromEvent` onward, paged and
 * memoised. Callers reduce the flat row list into whatever `Map` shape they
 * need (`/transfers` and `/chips` each build a slightly different one) —
 * this module only owns the fetch, not the per-page representation.
 */
export function loadPredictionSeries(
  season: string,
  fromEvent: number,
): Promise<PredictionSeriesRow[]> {
  const key = `${season}:${fromEvent}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.promise;

  const promise = fetchAll(season, fromEvent).catch((err: unknown) => {
    // Don't memoise a failed fetch — the next caller should get a fresh try.
    cache.delete(key);
    throw err;
  });
  cache.set(key, { at: Date.now(), promise });
  return promise;
}
