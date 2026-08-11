import { emptyTeamState, type SquadRules, type TeamState } from "./team-state";
import { sellPrice } from "./transfers";

// Converts a real FPL squad into a TeamState — the gap Sprint 8 recorded as
// waiting on Sprint 14: "a real-FPL-squad starting point". Once built, every
// downstream engine (optimiser, transfer simulator, chip planner) treats an
// imported squad exactly like a manual draft, because TeamSource =
// "draft" | "fpl" was always meant to be interchangeable — see
// lib/team-state.ts.
//
// Sprint 14.2 — why this reads a pasted response rather than calling FPL
// itself. §F tried server-side authentication against FPL's auth-gated
// `/api/my-team/{id}/` and it cannot work: FPL moved from cookie sessions to
// a bearer token (`X-API-Authorization: Bearer …`) minted from an OIDC
// refresh token that lives only in the browser's localStorage, so a pasted
// Cookie header authenticates nothing (confirmed live — every attempt
// returned 401). Escalating to a refresh-token exchange was rejected on
// rotation risk: FPL retires the browser's copy of the refresh token the
// first time anything exchanges it, which could sign the owner out of their
// own FPL session. Pasting the *response* instead needs no credential at
// all — the owner is already signed in, in their own browser, and the app
// never touches anything secret. See docs/roadmap.md, "Sprint 14.2".

// ------------------------------------------------- manager_picks import
// (works once manager_picks/manager_transfers are populated — blocked
// pre-GW1, see teamStateFromMyTeamJson below for what works today)

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
 * slot. Every downstream sell-price calculation (`sellPrice`, below) is
 * built on purchase price, so this falls back to the player's current cost.
 * That fallback is exact for every player until a price first moves —
 * which, pre-GW1, is every player, since none has moved yet.
 *
 * A squad pasted through `teamStateFromMyTeamJson` instead carries FPL's own
 * real `purchase_price` per pick, so it does not need this fallback at all —
 * `IMPORTED_SQUAD_NOTE` distinguishes the two rather than describing one.
 */
export const IMPORTED_SQUAD_NOTE =
  "manager_picks doesn't carry what you actually paid for each player, so purchase price here is " +
  "today's price — exact until a price moves, after which sell values will read slightly off. " +
  "Pasting your squad from fantasy.premierleague.com/api/my-team/<id>/ (Settings → Import squad) " +
  "carries your real purchase prices instead.";

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

// -------------------------------------------------- my-team JSON import
// The route that actually works pre-GW1: the owner fetches
// https://fantasy.premierleague.com/api/my-team/<entry_id>/ in their own
// signed-in browser and pastes the response. Real purchase prices, real
// bank, real chip availability — no credential the app has to hold.

export interface MyTeamPick {
  element: number;
  position: number;
  multiplier: number;
  is_captain: boolean;
  is_vice_captain: boolean;
  element_type: number;
  selling_price: number;
  purchase_price: number;
}

export interface MyTeamChip {
  id: number;
  status_for_entry: string;
  played_by_entry: number[];
  name: string;
  number: number;
  start_event: number;
  stop_event: number | null;
  chip_type?: string;
  is_pending: boolean;
}

export interface MyTeamTransfers {
  cost: number;
  status: string;
  limit: number | null;
  made: number;
  bank: number;
  value: number;
}

export interface MyTeamResponse {
  picks: MyTeamPick[];
  picks_last_updated?: string;
  chips: MyTeamChip[];
  transfers: MyTeamTransfers;
}

export interface SellPriceMismatch {
  playerId: number;
  ours: number;
  fpl: number;
}

export interface MyTeamImportResult {
  state: TeamState | null;
  error: string | null;
  /**
   * Picks where recomputing lib/transfers.ts's sellPrice from the pasted
   * purchase_price disagrees with FPL's own selling_price for the same
   * pick. sellPrice is the one implementation of that rule (CLAUDE.md's "one
   * quantity, one implementation") — this is a cross-check against real
   * data, not a second source of truth, so a mismatch is reported as a
   * warning rather than silently trusted or silently overridden.
   */
  sellPriceMismatches: SellPriceMismatch[];
}

/**
 * Parses and validates a pasted `my-team` response into a TeamState.
 * Mirrors lib/drafts.ts's importDrafts idiom: JSON.parse in a try/catch,
 * then a shape guard, then per-entry checks, each with a plain-English
 * error rather than a stack trace.
 */
export function teamStateFromMyTeamJson(
  raw: string,
  opts: {
    event: number;
    nowCostOf: (playerId: number) => number | undefined;
    knownPlayerIds: Set<number>;
  },
  rules: SquadRules,
  name: string,
): MyTeamImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      state: null,
      error: "That isn't valid JSON — make sure you copied the whole response.",
      sellPriceMismatches: [],
    };
  }

  // A tab opened directly on /api/my-team/<id>/ returns this shape, not a
  // squad — the endpoint wants a bearer token a plain navigation never
  // sends (see the file header note). Caught here, before the generic shape
  // guard below, so the user gets the actual explanation rather than a
  // generic "doesn't look like a squad" message for the exact mistake the
  // in-app instructions used to cause.
  if (
    parsed &&
    typeof parsed === "object" &&
    !Array.isArray((parsed as { picks?: unknown }).picks) &&
    typeof (parsed as { detail?: unknown }).detail === "string"
  ) {
    return {
      state: null,
      error:
        "That's FPL's \"not signed in\" response, not your squad — the /api/ URL needs a bearer " +
        "token a plain browser tab doesn't send. Copy the response from DevTools → Network instead " +
        "(see the steps above).",
      sellPriceMismatches: [],
    };
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray((parsed as { picks?: unknown }).picks) ||
    (parsed as { transfers?: unknown }).transfers === null ||
    typeof (parsed as { transfers?: unknown }).transfers !== "object"
  ) {
    return {
      state: null,
      error:
        'Doesn\'t look like an FPL my-team response — expected "picks" and "transfers". Copy the ' +
        "response from DevTools → Network instead of opening the /api/ URL directly (see the steps " +
        "above).",
      sellPriceMismatches: [],
    };
  }

  const data = parsed as MyTeamResponse;
  const picks = data.picks;

  if (picks.length !== rules.squadSize) {
    return {
      state: null,
      error: `Expected ${rules.squadSize} picks, found ${picks.length} — this doesn't look like a full squad.`,
      sellPriceMismatches: [],
    };
  }

  const unknown = picks.filter((p) => !opts.knownPlayerIds.has(p.element));
  if (unknown.length > 0) {
    return {
      state: null,
      error:
        `${unknown.length} player id(s) in this paste aren't in this season's player list — ` +
        "this may be a squad from a previous season.",
      sellPriceMismatches: [],
    };
  }

  const sorted = [...picks].sort((a, b) => a.position - b.position);
  const startingXI = sorted.filter((p) => p.position <= 11).map((p) => p.element);
  const benchOrder = sorted.filter((p) => p.position >= 12).map((p) => p.element);
  const captain = sorted.find((p) => p.is_captain)?.element ?? null;
  const viceCaptain = sorted.find((p) => p.is_vice_captain)?.element ?? null;

  const players = sorted.map((p) => ({ playerId: p.element, purchasePrice: p.purchase_price }));

  // Cross-check, not a second implementation: recompute sellPrice from the
  // pasted purchase_price and compare against FPL's own selling_price for
  // the same pick. FPL is authoritative on its own sell rule, so a
  // disagreement means lib/transfers.ts's formula has drifted — verified
  // here against real data, which nothing else in this app exercises it
  // against.
  const sellPriceMismatches: SellPriceMismatch[] = [];
  for (const p of sorted) {
    const nowCost = opts.nowCostOf(p.element);
    if (nowCost === undefined) continue;
    const ours = sellPrice(p.purchase_price, nowCost);
    if (ours !== p.selling_price) {
      sellPriceMismatches.push({ playerId: p.element, ours, fpl: p.selling_price });
    }
  }

  // transfers.limit is null with status "unlimited" pre-deadline (confirmed
  // in a real payload) — no hit is possible in that state, so it maps to
  // "as many as the squad", not a default of 1, which would let
  // simulateTransfers invent a -4 FPL would never actually charge.
  // Post-deadline, limit is a real number and is used directly.
  const freeTransfers =
    data.transfers.limit === null && data.transfers.status === "unlimited"
      ? rules.squadSize
      : (data.transfers.limit ?? 1);

  // Chip-active detection is best-effort: FPL's own status_for_entry enum
  // for an *active* chip isn't confirmed against a live example (every
  // payload seen so far has both chips "available", pre-season) — treated
  // as active only on an explicit "active" status rather than guessed from
  // is_pending, so a wrong guess fails closed (activeChip: null) rather
  // than falsely claiming a chip is in play.
  const activeChip =
    (Array.isArray(data.chips) ? data.chips : []).find((c) => c.status_for_entry === "active")
      ?.name ?? null;

  const base = emptyTeamState(rules, name);

  const state: TeamState = {
    ...base,
    source: "fpl",
    gameweek: opts.event,
    players,
    captain,
    viceCaptain,
    startingXI,
    benchOrder,
    activeChip,
    budget: data.transfers.value + data.transfers.bank,
    freeTransfers,
  };

  return { state, error: null, sellPriceMismatches };
}
