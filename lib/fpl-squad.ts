import { emptyTeamState, type SquadRules, type TeamState } from "./team-state";

// Converts a synced FPL squad (manager_picks + managers) into a TeamState —
// the gap Sprint 8 recorded as waiting on Sprint 14: "a real-FPL-squad
// starting point". Once built, every downstream engine (optimiser, transfer
// simulator, chip planner) treats an imported squad exactly like a manual
// draft, because TeamSource = "draft" | "fpl" was always meant to be
// interchangeable — see lib/team-state.ts.

export interface FplPick {
  position: number;
  element: number;
  multiplier: number;
  is_captain: boolean;
  is_vice_captain: boolean;
}

export interface FplSquadMeta {
  entryId: number;
  event: number;
  activeChip: string | null;
  /** Tenths. From managers.last_deadline_bank. */
  bank: number | null;
  /** Tenths, squad value at the deadline. From managers.last_deadline_value. */
  value: number | null;
}

/**
 * `manager_picks` carries no purchase price — only which player and which
 * slot. Every downstream sell-price calculation (lib/transfers.ts's
 * `sellPrice`) is built on purchase price, so this falls back to the
 * player's current cost. That fallback is exact for every player until a
 * price first moves — which, pre-GW1, is every player, since none has moved
 * yet — and IMPORTED_SQUAD_NOTE says so wherever an imported squad is shown.
 * §F (the FPL session handoff) is what eventually retires this note by
 * reading real purchase prices from the auth-gated `my-team` endpoint.
 */
export const IMPORTED_SQUAD_NOTE =
  "Imported from your real FPL squad. manager_picks doesn't carry what you actually paid for each " +
  "player, so purchase price here is today's price — exact until a price moves, after which sell " +
  "values will read slightly off. Connecting your FPL session (Settings → FPL Account) replaces " +
  "this with your real purchase prices.";

/**
 * Builds a TeamState from one gameweek's picks. `nowCostOf` and `rules` come
 * from the caller (already-loaded `players` rows and `game_settings`), so
 * this stays a pure function the way every other TeamState constructor in
 * this file is.
 */
export function teamStateFromPicks(
  picks: FplPick[],
  nowCostOf: (playerId: number) => number | undefined,
  meta: FplSquadMeta,
  rules: SquadRules,
  name: string,
): TeamState {
  const base = emptyTeamState(rules, name);

  const sorted = [...picks].sort((a, b) => a.position - b.position);
  const startingXI = sorted.filter((p) => p.position <= 11).map((p) => p.element);
  const benchOrder = sorted.filter((p) => p.position >= 12).map((p) => p.element);
  const captain = sorted.find((p) => p.is_captain)?.element ?? null;
  const viceCaptain = sorted.find((p) => p.is_vice_captain)?.element ?? null;

  const players = sorted.map((p) => ({
    playerId: p.element,
    purchasePrice: nowCostOf(p.element) ?? 0,
  }));
  const spent = players.reduce((sum, p) => sum + p.purchasePrice, 0);

  // Total "budget" a squad is scored against is spend + what's left in the
  // bank, so budgetRemaining (lib/team-state.ts's validateSquad) comes out
  // to the real bank rather than a fixed £100m that ignores value gained or
  // lost since the season started.
  const budget = meta.value !== null && meta.bank !== null ? meta.value + meta.bank : spent;

  return {
    ...base,
    source: "fpl",
    gameweek: meta.event,
    players,
    captain,
    viceCaptain,
    startingXI,
    benchOrder,
    activeChip: meta.activeChip,
    budget,
    // manager_gameweek_history.event_transfers is transfers *used* that
    // gameweek, not the free-transfer allowance carried forward — that
    // needs accrueFreeTransfers' rollover history, which an import can't
    // reconstruct from one gameweek's snapshot. Defaulted the same way
    // emptyTeamState defaults a fresh draft, and left for the user to
    // correct on /transfers, same as any manually-created draft.
    freeTransfers: base.freeTransfers,
  };
}
