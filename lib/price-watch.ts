// Sprint 29.0 — price-change prediction, step 2: the descriptive tool.
//
// The owner's real question is "transfer now, or wait for the price to
// move" — that needs a progress-to-threshold reading, not a classifier.
//
// Sprint 29 shipped the threshold as a flat, documented, user-set input
// rather than a fitted number, because FPL's real one is unpublished. Sprint
// 38 replaced it with a fitted one, deliberately and with sign-off: the flat
// pair was not merely imprecise but wrong in shape, reading -736% for a
// 39%-owned player who was in fact at 89% of his real threshold. See
// `thresholdsFor` below for the measurement and its weaknesses. It is still
// an input — `priceProgress` and `loadPriceProgress` both take an override —
// but its default is now evidence rather than a guess.
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
  "Progress toward FPL's own price-change threshold — how far the net transfers have added up, " +
  "not a prediction. The threshold is unpublished, so it is estimated from this season's actual " +
  "price changes: falls scale steeply with ownership (about 32k net transfers per 1% owned, which " +
  "explains 81% of when they fire), while rises go at a roughly flat 378k whatever the ownership. " +
  "Those are fitted figures you can override, not published ones. Passing 100% means the " +
  "transfers have reached the estimated threshold — measured across this season, a player past it " +
  "actually moved that night only about 10% of the time for falls and 22% for rises, so treat it " +
  "as 'the pressure is there', never as 'tonight'. 'Unknown' means fewer than two ownership " +
  "samples exist since the last price change — usually because this player isn't on the " +
  "~2-hourly watchlist yet (see game_settings.price_watch_ownership_threshold / " +
  "price_watch_net_transfer_threshold) — not that nothing is happening.";

/**
 * FPL's price-change thresholds, in absolute net transfers.
 *
 * **These are fitted**, which is a deliberate exception to this file's
 * original "a documented input, never a fitted number" stance, taken with the
 * owner's sign-off and on direct evidence rather than on the answer looking
 * reasonable. What changed: `scripts/price-window-probe.ts` measured the net
 * transfers standing at the moment every real 2026-27 price change fired, and
 * regressed that on ownership. A real threshold should be a tight function of
 * ownership, because that is what a threshold *is*.
 *
 *   falls (n=248): 3,577 + 31,870 per 1% owned, **R² = 0.811**
 *   rises (n=55):  ~378,000 flat,               **R² = 0.022**
 *
 * So the two directions are genuinely different mechanisms, and the previous
 * flat pair was wrong in two different ways: falls had the wrong *shape*
 * (a 39%-owned player's real threshold is ~1.24m, not 150k — which is how
 * B.Fernandes read −736%), and rises had the wrong *level* (~378k, not 200k)
 * while needing no scaling at all.
 *
 * The same probe killed the competing hypothesis that FPL's counter resets
 * each deadline: "since last price change" explained firings better on both
 * R² and spread, in both directions.
 *
 * Still an estimate, and still overridable. Two disclosed weaknesses: the fit
 * rests on events that *did* fire, so at ~2h sampling it slightly overshoots
 * the true trigger; and the rise level is a mean over 55 events rather than a
 * mechanism, so it is the half to revisit first.
 */
export const FALL_THRESHOLD_BASE = 3_577;
export const FALL_THRESHOLD_PER_PERCENT = 31_870;
export const RISE_THRESHOLD_FLAT = 378_000;

/** Floor, so a near-zero-ownership player still needs *some* net movement. */
const MIN_THRESHOLD = 5_000;

export interface PriceThresholds {
  rise: number;
  fall: number;
}

/**
 * Thresholds for a player at a given ownership percentage.
 *
 * Pass `null` ownership — a player with no sample yet — and it falls back to
 * the population mean fall threshold rather than the 0%-owned one, which
 * would fire for anybody.
 */
export function thresholdsFor(ownershipPercent: number | null): PriceThresholds {
  const own = ownershipPercent ?? MEAN_OWNERSHIP_FALLBACK;
  return {
    rise: RISE_THRESHOLD_FLAT,
    fall: Math.max(MIN_THRESHOLD, FALL_THRESHOLD_BASE + FALL_THRESHOLD_PER_PERCENT * own),
  };
}

/** Mean ownership across the pool, for players with no sample to read. */
const MEAN_OWNERSHIP_FALLBACK = 5;

export type PriceDirection = "rise" | "fall" | "flat";

/**
 * Where this player sits relative to the threshold, as a ladder rather than a
 * yes/no. Tokens, not display text — `priceVerdictLabel` words them with the
 * direction, so a caller can compare without string-matching prose.
 *
 * **Renamed from "expected"/"very likely"/"possible"/"not tonight".** Those
 * named a *prediction about tonight*, which these are not and cannot be:
 * gating on the best threshold that could be fitted from this season's price
 * changes, crossing it is followed by an actual change only 9.8% of the time
 * for falls and 21.9% for rises (`scripts/price-threshold-gate.ts`). A name
 * that promises 90% and delivers 10% is the failure CLAUDE.md's "say what the
 * number means" exists to prevent, so the ladder now describes position
 * relative to a threshold, which is exactly what it measures.
 *
 * "unknown" still means too few samples to say anything, and is never a quiet
 * "no".
 */
export type PriceVerdict = "past" | "close" | "approaching" | "far" | "unknown";

/** Ladder cut-points, in progress-toward-threshold. */
const CLOSE_AT = 0.85;
const APPROACHING_AT = 0.6;

export interface OwnershipSample {
  observedAt: string;
  transfersInEvent: number | null;
  transfersOutEvent: number | null;
  /** `selected_by_percent` at this sample. Drives the fall threshold. */
  selectedByPercent?: number | null;
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

const netOf = (s: OwnershipSample): number =>
  (s.transfersInEvent ?? 0) - (s.transfersOutEvent ?? 0);

/**
 * Net transfers since the last price change, from ownership samples anchored
 * on that change. `samples` must be ordered oldest-first and already scoped
 * to one player, one season, at-or-after the last price change.
 *
 * **`transfers_in_event` and `transfers_out_event` are per-GAMEWEEK counters
 * that FPL resets to zero at every deadline**, so this cannot simply
 * difference the first and last sample — that is only valid when no deadline
 * falls between them, which was true for 11% of players.
 *
 * What it did to the reading: Palmer's anchor was 2026-09-10, two deadlines
 * back. His first post-anchor sample read +446,406 (a gameweek of heavy
 * buying) and his latest read −41,347 (GW6's fresh counter), so the naive
 * difference was −487,753 — reported as "expected to fall tonight, −321%"
 * for three days without a fall. Summed correctly the figure is **+364,022**,
 * a net inflow: the sign was inverted, not merely the magnitude.
 *
 * The fix needs no deadline lookup. `transfers_in_event` only ever increases
 * within a gameweek, so a decrease between consecutive samples is a reset and
 * nothing else. Within a segment, accumulate the delta; across a reset, the
 * new sample's value *is* the accumulation since that reset.
 *
 * Still approximate in one way, and deliberately so: transfers made between
 * the last pre-reset sample and the deadline are missed, because the counter
 * is zeroed before the next sample sees them. At ~2h sampling that is a small
 * slice of one gameweek, and the alternative — inferring the missing tail —
 * would be inventing a number.
 */
export function netTransfersSinceLastPriceChange(samples: OwnershipSample[]): number | null {
  if (samples.length < 2) return null;

  let total = 0;
  for (let i = 1; i < samples.length; i++) {
    const previous = samples[i - 1];
    const current = samples[i];
    const reset = (current.transfersInEvent ?? 0) < (previous.transfersInEvent ?? 0);
    total += reset ? netOf(current) : netOf(current) - netOf(previous);
  }
  return total;
}

/**
 * Progress toward a rise/fall threshold.
 *
 * `thresholds` defaults to `thresholdsFor(this player's latest ownership)`,
 * so the fall threshold scales with ownership as FPL's own does. Pass an
 * explicit pair to override — it remains the owner's input, now with a
 * measured starting value rather than a guessed flat one.
 */
export function priceProgress(
  playerCode: number,
  samples: OwnershipSample[],
  thresholds?: PriceThresholds,
): PriceProgress {
  const latest = samples.length > 0 ? samples[samples.length - 1] : null;
  const { rise: riseThreshold, fall: fallThreshold } =
    thresholds ?? thresholdsFor(latest?.selectedByPercent ?? null);
  const asOf = latest?.observedAt ?? null;
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
  if (direction === "flat") return "far";
  if (ratio >= 1) return "past";
  if (ratio >= CLOSE_AT) return "close";
  if (ratio >= APPROACHING_AT) return "approaching";
  return "far";
}

/**
 * Display text for a verdict, worded with its direction.
 *
 * Every string here describes **where the player sits against your
 * threshold**, never what will happen tonight. It used to say "Expected to
 * fall tonight", which measured 9.8% right; Palmer carried that label for
 * three days without moving. The percentage was always documented as progress
 * rather than probability — the label is what contradicted it.
 */
export function priceVerdictLabel(verdict: PriceVerdict, direction: PriceDirection): string {
  if (verdict === "unknown") return "Not enough samples yet";
  if (direction === "flat") return "No net movement";
  const move = direction === "rise" ? "rise" : "fall";
  switch (verdict) {
    case "past":
      return `Past your ${move} threshold`;
    case "close":
      return `Close to your ${move} threshold`;
    case "approaching":
      return `Moving toward a ${move}`;
    default:
      return `Well short of a ${move}`;
  }
}

/**
 * True when a player is at or near the threshold — the flag /transfers shows
 * beside an incoming pick. Named for proximity, not imminence: see
 * PriceVerdict on why this cannot be read as "it will move tonight".
 */
export const isNearThreshold = (verdict: PriceVerdict): boolean =>
  verdict === "past" || verdict === "close";

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

  // Reset-aware for the same reason as above. A 24h window rarely spans a
  // deadline, but "rarely" is not "never", and on the day it does the naive
  // difference is off by a whole gameweek's transfers.
  return netTransfersSinceLastPriceChange(window)! / hours;
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
  thresholds?: PriceThresholds,
  now: Date = new Date(),
  nights = 3,
): PriceProjection[] {
  if (current.netTransfers === null || current.direction === "flat") return [];

  const rate = netTransferRatePerHour(samples, now);
  if (rate === null) return [];

  const latest = samples.length > 0 ? samples[samples.length - 1] : null;
  const resolved = thresholds ?? thresholdsFor(latest?.selectedByPercent ?? null);
  const threshold = current.direction === "rise" ? resolved.rise : resolved.fall;
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
