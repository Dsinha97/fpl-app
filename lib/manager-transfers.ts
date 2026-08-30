// Sprint 29.2 — the transfer ledger. `manager_transfers` already exists and
// is already written by supabase/functions/_shared/manager-sync.ts from
// FPL's own `/transfers/` endpoint; it was simply empty because the owner
// hadn't made a transfer yet this season. This is the one place that reads
// it, grouped by gameweek — `lib/gameweek-review.ts`'s own single-event
// `loadTransfers` was a narrower duplicate of this same query and now calls
// through here instead (CLAUDE.md: "one quantity, one implementation").

import { supabase } from "./supabase/client";
import { HIT_COST } from "./transfers";

export interface TransferRow {
  event: number;
  elementIn: number;
  elementInCost: number | null;
  elementOut: number;
  elementOutCost: number | null;
  transferTime: string | null;
}

/**
 * Every recorded transfer for one manager this season, optionally narrowed
 * to one gameweek. Not grouped here — callers that want a per-gameweek
 * breakdown group by `.event` themselves (see groupByEvent below); this
 * stays the one query, not the one shape, since /review wants a single
 * event's rows and /team wants the whole season's.
 */
export async function loadTransfers(
  season: string,
  entryId: number,
  event?: number,
): Promise<TransferRow[]> {
  let query = supabase
    .from("manager_transfers")
    .select("event, element_in, element_in_cost, element_out, element_out_cost, transfer_time")
    .eq("season", season)
    .eq("entry_id", entryId)
    .order("event", { ascending: false })
    .order("transfer_time", { ascending: false });
  if (event !== undefined) query = query.eq("event", event);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    event: r.event as number,
    elementIn: r.element_in as number,
    elementInCost: r.element_in_cost as number | null,
    elementOut: r.element_out as number,
    elementOutCost: r.element_out_cost as number | null,
    transferTime: r.transfer_time as string | null,
  }));
}

/** Groups a season's transfers by gameweek, newest gameweek first. */
export function groupByEvent(rows: TransferRow[]): Map<number, TransferRow[]> {
  const byEvent = new Map<number, TransferRow[]>();
  for (const r of rows) {
    const list = byEvent.get(r.event);
    if (list) list.push(r);
    else byEvent.set(r.event, [r]);
  }
  return byEvent;
}

/**
 * Points cost of `count` paid transfers, through lib/transfers.ts's single
 * `HIT_COST` — the same rate the transfer optimiser and simulator use, not
 * a second hardcoded 4.
 */
export const hitCost = (count: number): number => Math.max(0, count) * HIT_COST;
