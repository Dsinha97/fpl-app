// Sprint 29.0 — price-change prediction, step 2: the descriptive tool.
//
// The owner's real question is "transfer now, or wait for the price to
// move" — that needs a progress-to-threshold reading, not a classifier.
// FPL's actual flag threshold is unpublished and ownership-dependent
// (roadmap: "price-change prediction"), so per CLAUDE.md ("when a term
// cannot be dropped, make it an input" / "never tune an invented
// coefficient until the answer looks reasonable") the threshold here is a
// documented, user-adjustable input — the same shape as `decisionMargin`
// in lib/transfer-optimizer.ts — not a fitted number.
//
// Step 1 (supabase/migrations/20260830191442_sprint29_price_watchlist.sql)
// samples player_ownership_history at ~2h for a bounded watchlist instead
// of the ~20h population default, so a net-transfer velocity reading is
// possible at all for those players. Off the watchlist, or before two
// samples exist since the last price change, this returns "unknown" rather
// than a guess — a thin history should read as thin, not as a confident
// zero.
//
// Step 3 (fitting a classifier on accumulated history) is explicitly out of
// scope until it can be gated on beating a naive top-N-by-net-transfers
// baseline, walk-forward — see docs/roadmap.md.

import { supabase } from "./supabase/client";
import { clamp } from "./stats";

export const PRICE_WATCH_MODEL_NOTE =
  "This is a progress reading toward FPL's own price-change threshold, not a prediction — that " +
  "threshold is unpublished and scales with a player's ownership, so it's a documented input you " +
  "can adjust (default rise/fall thresholds below), not a fitted number. 'Unknown' means fewer " +
  "than two ownership samples exist since the last price change — usually because this player " +
  "isn't on the ~2-hourly watchlist yet (see game_settings.price_watch_ownership_threshold / " +
  "price_watch_net_transfer_threshold) — not that nothing is happening.";

/** Default progress-to-threshold levels, in absolute net transfers. FPL's real
 *  thresholds are unpublished and scale with a player's ownership base; these
 *  are a starting input for the owner to override, not a fitted estimate. */
export const DEFAULT_RISE_THRESHOLD = 200_000;
export const DEFAULT_FALL_THRESHOLD = 150_000;

export type PriceDirection = "rise" | "fall" | "flat";

/**
 * How close this player is to FPL's threshold, as a ladder rather than a
 * yes/no. These are tokens, not display text — `priceVerdictLabel` words them
 * with the direction, so a caller can compare without string-matching prose.
 *
 * "expected" means the net transfers have passed the threshold you set. It
 * does NOT mean a probability: see PRICE_WATCH_MODEL_NOTE. "unknown" still
 * means too few samples to say anything, and is never a quiet "no".
 */
export type PriceVerdict = "expected" | "very likely" | "possible" | "not tonight" | "unknown";

/** Ladder cut-points, in progress-toward-threshold. */
const VERY_LIKELY_AT = 0.85;
const POSSIBLE_AT = 0.6;

export interface OwnershipSample {
  observedAt: string;
  transfersInEvent: number | null;
  transfersOutEvent: number | null;
}

export interface PriceProgress {
  playerCode: number;
  /** Net transfers (in − out) since the last recorded price change, from the
   *  most recent ownership sample. Null when there are fewer than two
   *  samples to difference. */
  netTransfers: number | null;
  direction: PriceDirection;
  /** 0–1 progress toward the relevant threshold. Null when netTransfers is null. */
  progress: number | null;
  /**
   * The same progress unclamped and signed — negative for a fall, and free to
   * exceed 1 once the threshold is passed. This is what the card's "+111.5%"
   * reads from; `progress` stays clamped because the bars fill 0–100%.
   */
  progressRaw: number | null;
  verdict: PriceVerdict;
  /** Timestamp of the most recent ownership sample used, for staleness display. */
  asOf: string | null;
  /**
   * Where this reading lands at the next few nightly cutoffs if the current
   * net-transfer rate holds. Empty — never zeroed — when the rate can't be
   * measured. Populated by `loadPriceProgress`; `priceProgress` itself leaves
   * it empty, since it has no clock to project against.
   */
  projections?: PriceProjection[];
}

/**
 * Net transfers since the last price change, from ownership samples anchored
 * on that change. `samples` must be ordered oldest-first and already scoped
 * to one player, one season, at-or-after the last price change.
 */
export function netTransfersSinceLastPriceChange(samples: OwnershipSample[]): number | null {
  if (samples.length < 2) return null;
  const first = samples[0];
  const last = samples[samples.length - 1];
  const firstNet = (first.transfersInEvent ?? 0) - (first.transfersOutEvent ?? 0);
  const lastNet = (last.transfersInEvent ?? 0) - (last.transfersOutEvent ?? 0);
  return lastNet - firstNet;
}

/**
 * Progress toward a rise/fall threshold. `riseThreshold`/`fallThreshold` are
 * the documented, caller-supplied inputs (see PRICE_WATCH_MODEL_NOTE) —
 * never invented coefficients tuned until the answer looks right.
 */
export function priceProgress(
  playerCode: number,
  samples: OwnershipSample[],
  riseThreshold = DEFAULT_RISE_THRESHOLD,
  fallThreshold = DEFAULT_FALL_THRESHOLD,
): PriceProgress {
  const asOf = samples.length > 0 ? samples[samples.length - 1].observedAt : null;
  const netTransfers = netTransfersSinceLastPriceChange(samples);

  if (netTransfers === null) {
    return {
      playerCode,
      netTransfers: null,
      direction: "flat",
      progress: null,
      progressRaw: null,
      verdict: "unknown",
      asOf,
    };
  }

  const direction: PriceDirection = netTransfers > 0 ? "rise" : netTransfers < 0 ? "fall" : "flat";
  const threshold = direction === "rise" ? riseThreshold : direction === "fall" ? fallThreshold : null;
  const ratio = threshold ? Math.abs(netTransfers) / threshold : 0;
  const progress = clamp(ratio, 0, 1);
  // Signed and unclamped: a fall reads negative, and passing the threshold
  // reads above 100% rather than pinning at it.
  const progressRaw = direction === "fall" ? -ratio : ratio;
  const verdict = verdictFor(direction, ratio);

  return { playerCode, netTransfers, direction, progress, progressRaw, verdict, asOf };
}

function verdictFor(direction: PriceDirection, ratio: number): PriceVerdict {
  if (direction === "flat") return "not tonight";
  if (ratio >= 1) return "expected";
  if (ratio >= VERY_LIKELY_AT) return "very likely";
  if (ratio >= POSSIBLE_AT) return "possible";
  return "not tonight";
}

/**
 * Display text for a verdict, worded with its direction.
 *
 * Deliberately says "expected to rise tonight", never "111% likely" — the
 * percentage is progress past a threshold the owner set, not a probability,
 * and wording it as confidence would be the exact conflation
 * PRICE_WATCH_MODEL_NOTE exists to prevent.
 */
export function priceVerdictLabel(verdict: PriceVerdict, direction: PriceDirection): string {
  if (verdict === "unknown") return "Not enough samples yet";
  if (direction === "flat") return "No movement";
  const move = direction === "rise" ? "rise" : "fall";
  switch (verdict) {
    case "expected":
      return `Expected to ${move} tonight`;
    case "very likely":
      return `Very likely to ${move}`;
    case "possible":
      return `Possible ${move}`;
    default:
      return "Not tonight";
  }
}

/** True when a move is close enough to act on — the old "likely tonight" gate. */
export const isImminent = (verdict: PriceVerdict): boolean =>
  verdict === "expected" || verdict === "very likely";

const PAGE_ROWS = 1000;

/**
 * Counts the rows, then fetches every page concurrently.
 *
 * The same shape as `fetchAll` in lib/player-pool.ts, and for the same
 * reason. Serially, the ownership scan below is ~42 round trips at ~400ms —
 * over twenty seconds before the price column says anything. Concurrently it
 * is one count plus one wall-clock page.
 *
 * `run` must impose a **total** order. Two concurrent OFFSET queries are
 * independent statements, and Postgres gives no guarantee they see the same
 * row order unless the ORDER BY is unique — a partial order can overlap or
 * skip rows across a page boundary.
 */
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
export async function loadPriceProgress(
  season: string,
  playerCodes: number[],
  riseThreshold = DEFAULT_RISE_THRESHOLD,
  fallThreshold = DEFAULT_FALL_THRESHOLD,
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
        .select("player_code, observed_at, transfers_in_event, transfers_out_event")
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
    });
    byPlayer.set(code, list);
  }

  const now = new Date();
  for (const code of playerCodes) {
    if (!lastChangeAt.has(code)) continue; // never repriced this season — no anchor
    const samples = byPlayer.get(code) ?? [];
    const reading = priceProgress(code, samples, riseThreshold, fallThreshold);
    // Projected here rather than in the caller so the samples are used once
    // and not refetched — and so there is one implementation of the forward
    // reading, not one per surface.
    reading.projections = projectToCutoffs(reading, samples, riseThreshold, fallThreshold, now);
    result.set(code, reading);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Forward-night projection
//
// FPL applies price changes once a night. Every recorded change this season
// landed in the 23:00 UTC hour (412 of them, 60 rises and 352 falls), so the
// cutoff is treated as ~23:30 UTC — measured from the data, not assumed from
// community lore.
//
// What follows is arithmetic on observed samples, not a model: it takes the
// net-transfer rate this player has actually run over a trailing window and
// carries it forward to the next few cutoffs. It is the same class of
// statement as `priceProgress` itself, which is why it is not gated behind
// the fitted-classifier work (docs/roadmap.md, "price-change prediction"
// step 3) — that gate is about fitting, and nothing here is fitted.
//
// It is still an extrapolation, and must be labelled as one: "at the current
// rate", never "will". A rate measured over hours does not know about a
// price change resetting the anchor, a manager's press conference, or a
// deadline. Below MIN_RATE_SAMPLES it returns null rather than a straight
// line through two points.
// ---------------------------------------------------------------------------

/** Nightly price-change cutoff, in UTC hours past midnight. */
const CUTOFF_HOUR_UTC = 23.5;

/** Samples needed in the trailing window before a rate is worth quoting. */
const MIN_RATE_SAMPLES = 3;

/** How far back to measure the rate. Long enough to smooth, short enough to be current. */
const RATE_WINDOW_HOURS = 24;

export interface PriceProjection {
  /** The cutoff this projection is for. */
  at: Date;
  /** Nights ahead: 1 is tonight. */
  nightsAhead: number;
  /** Projected signed progress at that cutoff, same units as `progressRaw`. */
  progressRaw: number;
  verdict: PriceVerdict;
}

/**
 * Net transfers per hour over the trailing window, or null when too thin.
 * `samples` must be oldest-first and scoped to one player, as
 * `loadPriceProgress` builds them.
 */
export function netTransferRatePerHour(
  samples: OwnershipSample[],
  now: Date = new Date(),
  windowHours: number = RATE_WINDOW_HOURS,
): number | null {
  const cutoff = now.getTime() - windowHours * 3600_000;
  const window = samples.filter((s) => new Date(s.observedAt).getTime() >= cutoff);
  if (window.length < MIN_RATE_SAMPLES) return null;

  const first = window[0];
  const last = window[window.length - 1];
  const hours = (new Date(last.observedAt).getTime() - new Date(first.observedAt).getTime()) / 3600_000;
  if (hours <= 0) return null;

  const firstNet = (first.transfersInEvent ?? 0) - (first.transfersOutEvent ?? 0);
  const lastNet = (last.transfersInEvent ?? 0) - (last.transfersOutEvent ?? 0);
  return (lastNet - firstNet) / hours;
}

/** The next `count` nightly cutoffs strictly after `now`. */
export function upcomingCutoffs(now: Date = new Date(), count = 3): Date[] {
  const out: Date[] = [];
  const first = new Date(now);
  first.setUTCHours(Math.floor(CUTOFF_HOUR_UTC), (CUTOFF_HOUR_UTC % 1) * 60, 0, 0);
  if (first.getTime() <= now.getTime()) first.setUTCDate(first.getUTCDate() + 1);
  for (let i = 0; i < count; i++) {
    const d = new Date(first);
    d.setUTCDate(d.getUTCDate() + i);
    out.push(d);
  }
  return out;
}

/**
 * Where this player's progress lands at each of the next few cutoffs if the
 * trailing net-transfer rate holds.
 *
 * Returns an empty array — not zeroes — when the rate can't be measured, the
 * direction is flat, or there is no progress reading to carry forward.
 */
export function projectToCutoffs(
  current: PriceProgress,
  samples: OwnershipSample[],
  riseThreshold = DEFAULT_RISE_THRESHOLD,
  fallThreshold = DEFAULT_FALL_THRESHOLD,
  now: Date = new Date(),
  nights = 3,
): PriceProjection[] {
  if (current.netTransfers === null || current.direction === "flat") return [];

  const rate = netTransferRatePerHour(samples, now);
  if (rate === null) return [];

  const threshold = current.direction === "rise" ? riseThreshold : fallThreshold;
  if (!threshold) return [];

  return upcomingCutoffs(now, nights).map((at, i) => {
    const hoursAhead = (at.getTime() - now.getTime()) / 3600_000;
    const projectedNet = current.netTransfers! + rate * hoursAhead;
    // Re-read the direction from the projected total: a player drifting back
    // the other way should not keep the sign he had when the window opened.
    const direction: PriceDirection =
      projectedNet > 0 ? "rise" : projectedNet < 0 ? "fall" : "flat";
    const ratio = Math.abs(projectedNet) / threshold;
    return {
      at,
      nightsAhead: i + 1,
      progressRaw: direction === "fall" ? -ratio : ratio,
      verdict: verdictFor(direction, ratio),
    };
  });
}
