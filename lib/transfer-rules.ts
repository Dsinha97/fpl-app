// The transfer rules FPL itself enforces, as plain arithmetic: the free-transfer
// bank and the sell price. Split out of `lib/transfers.ts` (Sprint 40) because
// `lib/team-state.ts` and `components/context-bar.tsx` sit in every route and
// need only these, while `lib/transfers.ts` pulls in the scoring, lineup and
// chip engines. `lib/transfers.ts` re-exports all of it, so there is still one
// implementation, just a lighter module for it to live in.

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
 */
export function freeTransfersDisplay(team: TeamState): FreeTransfersDisplay {
  if (team.activeChip === "wildcard" || team.activeChip === "freehit") {
    return { kind: "unlimited" };
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
