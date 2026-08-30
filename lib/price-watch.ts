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
export type PriceVerdict = "likely tonight" | "not tonight" | "unknown";

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
  verdict: PriceVerdict;
  /** Timestamp of the most recent ownership sample used, for staleness display. */
  asOf: string | null;
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
    return { playerCode, netTransfers: null, direction: "flat", progress: null, verdict: "unknown", asOf };
  }

  const direction: PriceDirection = netTransfers > 0 ? "rise" : netTransfers < 0 ? "fall" : "flat";
  const threshold = direction === "rise" ? riseThreshold : direction === "fall" ? fallThreshold : null;
  const progress = threshold ? clamp(Math.abs(netTransfers) / threshold, 0, 1) : 0;
  const verdict: PriceVerdict = direction === "flat" ? "not tonight" : progress >= 0.85 ? "likely tonight" : "not tonight";

  return { playerCode, netTransfers, direction, progress, verdict, asOf };
}

/**
 * Loads ownership samples for `playerCodes` since each player's last
 * recorded price change, and returns a progress reading per player. Players
 * with no price_price_history row yet (never repriced this season) are
 * skipped — there is no "last change" to anchor on.
 */
export async function loadPriceProgress(
  season: string,
  playerCodes: number[],
  riseThreshold = DEFAULT_RISE_THRESHOLD,
  fallThreshold = DEFAULT_FALL_THRESHOLD,
): Promise<Map<number, PriceProgress>> {
  const result = new Map<number, PriceProgress>();
  if (playerCodes.length === 0) return result;

  const { data: lastChanges, error: priceError } = await supabase
    .from("player_price_history")
    .select("player_code, observed_at")
    .eq("season", season)
    .in("player_code", playerCodes)
    .order("observed_at", { ascending: false });
  if (priceError) throw new Error(priceError.message);

  const lastChangeAt = new Map<number, string>();
  for (const row of lastChanges ?? []) {
    const code = row.player_code as number;
    if (!lastChangeAt.has(code)) lastChangeAt.set(code, row.observed_at as string);
  }

  const { data: ownership, error: ownershipError } = await supabase
    .from("player_ownership_history")
    .select("player_code, observed_at, transfers_in_event, transfers_out_event")
    .eq("season", season)
    .in("player_code", playerCodes)
    .order("observed_at", { ascending: true });
  if (ownershipError) throw new Error(ownershipError.message);

  const byPlayer = new Map<number, OwnershipSample[]>();
  for (const row of ownership ?? []) {
    const code = row.player_code as number;
    const changeAt = lastChangeAt.get(code);
    if (changeAt && (row.observed_at as string) < changeAt) continue; // before the last repricing
    const list = byPlayer.get(code) ?? [];
    list.push({
      observedAt: row.observed_at as string,
      transfersInEvent: row.transfers_in_event as number | null,
      transfersOutEvent: row.transfers_out_event as number | null,
    });
    byPlayer.set(code, list);
  }

  for (const code of playerCodes) {
    if (!lastChangeAt.has(code)) continue; // never repriced this season — no anchor
    result.set(code, priceProgress(code, byPlayer.get(code) ?? [], riseThreshold, fallThreshold));
  }
  return result;
}
