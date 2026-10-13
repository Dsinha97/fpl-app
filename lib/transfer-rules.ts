// The transfer rules FPL itself enforces, as plain arithmetic: the free-transfer
// bank and the sell price. Split out of `lib/transfers.ts` (Sprint 40) because
// `lib/team-state.ts` and `components/context-bar.tsx` sit in every route and
// need only these, while `lib/transfers.ts` pulls in the scoring, lineup and
// chip engines. `lib/transfers.ts` re-exports all of it, so there is still one
// implementation, just a lighter module for it to live in.

import { fplActiveChipAt } from "./chip-plan";
import type { TeamState } from "./team-state";

/** FPL currently lets a manager bank up to five free transfers. */
export const MAX_FREE_TRANSFERS = 5;

/**
 * The free transfers you carry into next gameweek.
 *
 * One is awarded per gameweek and the bank is capped, so a manager sitting on
 * five and spending none still has five — not six. Both ends are clamped
 * because the count is user-entered: a typed 9, or more transfers used than
 * were available, must not manufacture an allowance the game would not give.
 */
export function accrueFreeTransfers(current: number, used: number): number {
  const remaining = Math.max(0, Math.min(MAX_FREE_TRANSFERS, current) - Math.max(0, used));
  return Math.min(MAX_FREE_TRANSFERS, remaining + 1);
}

export interface FreeTransferHistoryRow {
  event: number;
  /** Transfers made that gameweek (`manager_gameweek_history.event_transfers`). */
  eventTransfers: number | null;
  /** Points hit taken that gameweek (`event_transfers_cost`). */
  eventTransfersCost: number | null;
  activeChip: string | null;
}

/** Points surrendered per transfer beyond the free allowance. */
export const HIT_COST = 4;

/**
 * The free transfers carried into the gameweek after `throughEvent`, replayed
 * from what FPL recorded — an estimate, and said to be one.
 *
 * The rules it encodes (FPL's published 2025/26 ones; the 2026/27 rules are not
 * confirmed, and the one-off GW16 top-up to five was specific to 2025/26):
 * transfers are unlimited until the GW1 deadline, so GW2 opens with one; each
 * later gameweek adds one up to the cap; a Wildcard or Free Hit gameweek uses
 * none and keeps the bank.
 *
 * It refuses to answer (returns null) rather than guess when the record can't
 * be trusted: a gameweek from GW2 on is missing or has no transfer count, or a
 * gameweek's recorded hit disagrees with what the replay says it should have
 * been. A hit is the one thing in the record that checks the replay, so a
 * disagreement means the rules above no longer describe this account.
 */
export function reconstructFreeTransfers(
  history: FreeTransferHistoryRow[],
  throughEvent: number,
): number | null {
  if (throughEvent < 1) return null;
  const byEvent = new Map(history.map((h) => [h.event, h]));
  let ft = 1; // carried into GW2
  for (let e = 2; e <= throughEvent; e++) {
    const row = byEvent.get(e);
    if (!row || row.eventTransfers === null) return null;
    const freeChip = row.activeChip === "wildcard" || row.activeChip === "freehit";
    const used = freeChip ? 0 : row.eventTransfers;
    const expectedHit = freeChip ? 0 : Math.max(0, used - ft) * HIT_COST;
    if (row.eventTransfersCost !== null && row.eventTransfersCost !== expectedHit) return null;
    ft = accrueFreeTransfers(ft, used);
  }
  return ft;
}

/** The one honest reading of `TeamState.freeTransfers`, shared by `/deadline`,
 * `/transfers`, `/team`, and `components/context-bar.tsx` instead of each
 * clamping it separately (CLAUDE.md: "one quantity, one implementation"). */
export type FreeTransfersDisplay = { kind: "unlimited" } | { kind: "count"; n: number };

/**
 * `TeamState.freeTransfers` is not always a real count. `teamStateFromMyTeamJson`
 * (`lib/fpl-squad.ts`) sets it to `rules.squadSize` — a sentinel, not a
 * transfer count — whenever FPL itself reports "unlimited" (pre-deadline,
 * before the season's first transfer window closes), so `simulateTransfers`
 * never invents a hit FPL would not actually charge. A wildcard or free hit
 * grants the same real "no hit, any number of changes" state while active.
 * Rendering either sentinel as a literal number (once seen live as "FT 15")
 * reads as a fact FPL never granted — CLAUDE.md's "say what the number
 * means". Anything else out of range is treated the same way: a value above
 * the real cap can only be a stale import artifact, not a real balance, so it
 * falls back to the documented default of 1 rather than the cap of 5, which
 * would itself read as a limit nobody actually set.
 *
 * The chip only grants "unlimited" in the gameweek it was played in: pass the
 * gameweek being planned as `event` and a Wildcard from last gameweek stops
 * reading as unlimited this one (`fplActiveChipAt` is the one rule for which
 * gameweek a chip belongs to). Without `event` the chip is not consulted — the
 * stale-chip reading was the bug, so there is deliberately no legacy fallback.
 */
export function freeTransfersDisplay(team: TeamState, event?: number | null): FreeTransfersDisplay {
  if (event != null) {
    const chip = fplActiveChipAt(team, event);
    if (chip === "wildcard" || chip === "freehit") return { kind: "unlimited" };
  }
  const n = team.freeTransfers;
  if (!Number.isFinite(n) || n > MAX_FREE_TRANSFERS) {
    return { kind: "count", n: 1 };
  }
  return { kind: "count", n: Math.max(0, n) };
}

/**
 * What FPL pays when you sell.
 *
 * Not the live price: FPL gives you the purchase price plus half of any rise,
 * rounded down to the nearest 0.1. A fall is absorbed in full. Pre-season this is
 * a no-op because no price has moved, which is exactly why it is worth writing
 * now — the first price change would otherwise silently corrupt every bank
 * figure the simulator reports.
 */
export function sellPrice(purchasePrice: number, nowCost: number): number {
  if (nowCost <= purchasePrice) return nowCost;
  return purchasePrice + Math.floor((nowCost - purchasePrice) / 2);
}
