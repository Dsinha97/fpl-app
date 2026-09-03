import { totalSpend } from "./squad-budget";
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

// ---------------------------------------------------------- import naming
//
// Both importers used to name a draft their own way — /team built
// `${team_name} (FPL)`, /settings built the bare team name — which meant
// nothing could reliably answer "which draft is this manager's import?".
// Sprint 15 needs exactly that answer, to default /deadline and /team to the
// right squad, so the rule lives here once and both importers call it.
//
// `entryId` on the TeamState is the durable link (it survives a rename);
// the name match below is the fallback for drafts imported before that field
// existed.

const IMPORT_SUFFIX = " (FPL)";

/** The one name every FPL import gets. Callers still wrap in `uniqueDraftName`. */
export function importedDraftName(teamName: string | null, entryId: number | null): string {
  const base = teamName?.trim() || (entryId !== null ? `Entry ${entryId}` : "Imported squad");
  return `${base}${IMPORT_SUFFIX}`;
}

/** Strips a `uniqueDraftName` disambiguator: "DS United (FPL) (2)" -> "DS United (FPL)". */
const withoutCopyIndex = (name: string) => name.replace(/ \(\d+\)$/, "").trim();

/**
 * Does `draftName` look like an import for `teamName`?
 *
 * Accepts the current form (`"DS United (FPL)"`) and the legacy /settings form
 * (the bare team name), each with or without a " (2)" suffix, so squads
 * imported before the rule was consolidated still match.
 */
export function isImportedDraftFor(draftName: string, teamName: string | null): boolean {
  const wanted = teamName?.trim();
  if (!wanted) return false;
  const base = withoutCopyIndex(draftName);
  return base === wanted || base === `${wanted}${IMPORT_SUFFIX}`;
}

/**
 * Sprint 29.2 — re-importing used to always mint a new draft: both importers
 * called `uniqueDraftName` on a freshly-built `TeamState` (a fresh
 * `draftId` from `emptyTeamState`), so a second import became
 * "DS United (FPL) (2)" instead of updating the first. That defeated
 * `saveDraft`'s own update-in-place behaviour (lib/drafts.ts:
 * `drafts.findIndex((d) => d.draftId === stamped.draftId)`) — it only
 * updates when the id already matches.
 *
 * This resolves which existing draft (if any) a new import should overwrite,
 * using the same precedence `resolveRequestedDraft` already uses to find
 * "this manager's import": match by `entryId` first (the durable link, see
 * the header comment above), then by `isImportedDraftFor` name matching,
 * then the newest import for any manager as a last resort (covers a squad
 * imported before `entryId` was ever recorded). Returns `undefined` only
 * when there is truly no prior import to overwrite — a first-ever import
 * still gets a fresh draftId via `emptyTeamState`, same as before.
 */
export function resolveImportTarget(
  drafts: TeamState[],
  entryId: number | null,
  teamName: string | null,
): string | undefined {
  // `drafts` is expected newest-first (list ordering already used
  // throughout lib/drafts.ts), so the first match at each tier is the most
  // recent import at that confidence level.
  const imports = drafts.filter((d) => d.source === "fpl");
  const byEntry = entryId !== null ? imports.find((d) => d.entryId === entryId) : undefined;
  const byName = imports.find((d) => isImportedDraftFor(d.name, teamName));
  return (byEntry ?? byName ?? imports[0])?.draftId;
}

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
 * built on purchase price, so this falls back to the player's current cost
 * *unless* the caller supplies `purchasePriceOf` (Sprint 29 follow-up):
 * `manager_transfers.element_in_cost` is the real price paid for any player
 * transferred in this season, so a caller that's already loaded the season's
 * transfer ledger (lib/manager-transfers.ts) can pass a lookup that beats
 * the now-cost fallback for those players. A player who has been in the
 * squad since before any transfer this season — the original squad, never
 * transferred — has no transfer-in row to recover a real price from, so
 * still falls back to current cost. That's the genuinely unrecoverable case
 * this note discloses.
 *
 * A squad pasted through `teamStateFromMyTeamJson` instead carries FPL's own
 * real `purchase_price` per pick, so it does not need either fallback —
 * `IMPORTED_SQUAD_NOTE` distinguishes the two rather than describing one.
 */
export const IMPORTED_SQUAD_NOTE =
  "manager_picks doesn't carry what you actually paid for each player. Where this season's own " +
  "transfer record shows what you paid to bring a player in, that real price is used; for anyone " +
  "still in the squad from before any transfer, purchase price falls back to today's price — " +
  "exact until that price moves, after which sell values will read slightly off. Pasting your " +
  "squad from fantasy.premierleague.com/api/my-team/<id>/ (Settings → Import squad) carries your " +
  "real purchase prices for the whole squad instead.";

/**
 * Builds a TeamState from one gameweek's picks. `nowCostOf` and `rules` come
 * from the caller (already-loaded `players` rows and `game_settings`), so
 * this stays a pure function the way every other TeamState constructor in
 * this file is. `purchasePriceOf` is optional and, when it returns a value
 * for a player, takes precedence over `nowCostOf` — see IMPORTED_SQUAD_NOTE.
 */
export function teamStateFromPicks(
  picks: FplPick[],
  nowCostOf: (playerId: number) => number | undefined,
  meta: FplSquadMeta,
  rules: SquadRules,
  name: string,
  purchasePriceOf?: (playerId: number) => number | undefined,
): TeamState {
  const base = emptyTeamState(rules, name);

  const sorted = [...picks].sort((a, b) => a.position - b.position);
  const startingXI = sorted.filter((p) => p.position <= 11).map((p) => p.element);
  const benchOrder = sorted.filter((p) => p.position >= 12).map((p) => p.element);
  const captain = sorted.find((p) => p.is_captain)?.element ?? null;
  const viceCaptain = sorted.find((p) => p.is_vice_captain)?.element ?? null;

  const players = sorted.map((p) => ({
    playerId: p.element,
    purchasePrice: purchasePriceOf?.(p.element) ?? nowCostOf(p.element) ?? 0,
  }));
  const spent = totalSpend(players);

  // Total "budget" a squad is scored against is spend + what's left in the
  // bank, so budgetRemaining (lib/team-state.ts's validateSquad) comes out
  // to the real bank rather than a fixed £100m that ignores value gained or
  // lost since the season started.
  const budget = meta.value !== null && meta.bank !== null ? meta.value + meta.bank : spent;

  return {
    ...base,
    source: "fpl",
    entryId: meta.entryId,
    gameweek: meta.event,
    players,
    captain,
    viceCaptain,
    startingXI,
    benchOrder,
    activeChip: meta.activeChip,
    // The chip belongs to the gameweek it was read from, not to whatever
    // gameweek is next by the time this draft is read back — see
    // TeamState.activeChipEvent. `meta.event` is exactly that gameweek here,
    // since `meta.activeChip` came off the same `manager_gameweeks` row.
    activeChipEvent: meta.activeChip ? meta.event : null,
    budget,
    // Real cash, stored rather than re-derived from `budget` on every read —
    // see TeamState.bank. Left unset when FPL didn't report both halves, so
    // squadBank falls back to the legacy derivation rather than inventing one.
    bank: meta.bank ?? undefined,
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

export interface ActiveChipReading {
  /** Untyped for the same reason `TeamState.activeChip` is — FPL owns the value. */
  chip: string | null;
  /** The gameweek the chip belongs to. See `TeamState.activeChipEvent`. */
  event: number | null;
  /**
   * What established it. `"confirmed"` means both independent signals agree;
   * `"multipliers"` is the payload's own arithmetic alone; `"status"` is FPL's
   * enum alone. Recorded so a caller can be honest about which it had, rather
   * than presenting all three as equally certain.
   */
  evidence: "confirmed" | "multipliers" | "status" | null;
}

/**
 * Which chip FPL reports as live on a pasted `my-team` payload, and for which
 * gameweek.
 *
 * Two independent signals, because `status_for_entry`'s *active* enum was
 * never confirmed against a live example when this file was written (every
 * payload seen at the time was pre-season, with every chip "available"):
 *
 *   1. **The picks' own arithmetic**, which cannot be wrong about itself — a
 *      captain carrying `multiplier: 3` is Triple Captain by definition, and a
 *      bench where every pick carries `multiplier >= 1` (rather than the usual
 *      0) is Bench Boost by definition. This is evidence, not an enum guess.
 *   2. **`chips[].status_for_entry === "active"`**, as before.
 *
 * Agreement is `"confirmed"`. Where only one fires, it is still trusted — but
 * on disagreement the arithmetic wins, because it is arithmetic. Wildcard and
 * Free Hit leave **no** multiplier trace at all (they change the squad, not the
 * multipliers), so they remain signal-2-only; the cross-check covers the two
 * chips that can be corroborated, not all four. Nothing is inferred from
 * `is_pending`, so an unrecognised state still fails closed to `null` rather
 * than falsely claiming a chip is in play.
 *
 * The event comes from the matching chip's own `played_by_entry` — a history,
 * so the highest entry is the current play — and falls back to the import's
 * gameweek when FPL reports none. Never inferred beyond that.
 */
export function activeChipFromMyTeam(
  picks: MyTeamPick[],
  chips: MyTeamChip[] | undefined,
  fallbackEvent: number,
): ActiveChipReading {
  const bench = picks.filter((p) => p.position >= 12);
  const fromMultipliers: string[] = [];
  if (picks.some((p) => p.is_captain && p.multiplier === 3)) fromMultipliers.push("3xc");
  if (bench.length > 0 && bench.every((p) => p.multiplier >= 1)) fromMultipliers.push("bboost");
  // Two at once is not a state FPL allows (one chip per gameweek), so a
  // payload claiming both is self-contradictory — drop back to the status
  // enum rather than picking a winner between two impossible readings.
  const byMultiplier = fromMultipliers.length === 1 ? fromMultipliers[0] : null;

  const entries = Array.isArray(chips) ? chips : [];
  const byStatus = entries.find((c) => c.status_for_entry === "active")?.name ?? null;

  const chip = byMultiplier ?? byStatus;
  if (!chip) return { chip: null, event: null, evidence: null };

  const evidence =
    byMultiplier && byStatus === byMultiplier
      ? "confirmed"
      : byMultiplier
        ? "multipliers"
        : "status";

  const played = entries.find((c) => c.name === chip)?.played_by_entry;
  const event =
    Array.isArray(played) && played.length > 0 ? Math.max(...played) : fallbackEvent;

  return { chip, event, evidence };
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
    /**
     * The my-team payload carries no entry id — the caller knows it (it's in
     * the URL they fetched, and in the auth context). Recorded on the state so
     * "which draft is this manager's import?" survives a rename.
     */
    entryId: number | null;
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

  // Real data (2026-08-30): `data.transfers.value` disagreed with the sum of
  // the picks' own `selling_price` by 2 tenths (£0.2m) for a squad where
  // every pick's purchase_price equalled its selling_price — no gain/loss
  // to explain the gap, so `transfers.value` itself was simply wrong for
  // that payload. Each pick's own `selling_price` is what FPL will actually
  // credit on a sale; summing those directly is ground truth in a way the
  // separately-reported aggregate isn't, and is the one number this file
  // already treats as authoritative (see the sellPriceMismatches check
  // below, which trusts selling_price over a locally recomputed one).
  const sellingValue = sorted.reduce((sum, p) => sum + p.selling_price, 0);

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
  // Post-deadline, limit is the free transfers banked for this gameweek —
  // `made` (real data: limit=2, made=1) is how many are already spent, so
  // what's actually still free to use is limit - made, not limit on its own
  // (which double-counts a transfer already made as still available).
  const freeTransfers =
    data.transfers.limit === null && data.transfers.status === "unlimited"
      ? rules.squadSize
      : Math.max(0, (data.transfers.limit ?? 1) - data.transfers.made);

  const { chip: activeChip, event: activeChipEvent } = activeChipFromMyTeam(sorted, data.chips, opts.event);

  const base = emptyTeamState(rules, name);

  const state: TeamState = {
    ...base,
    source: "fpl",
    entryId: opts.entryId,
    gameweek: opts.event,
    players,
    captain,
    viceCaptain,
    startingXI,
    benchOrder,
    activeChip,
    activeChipEvent,
    budget: sellingValue + data.transfers.bank,
    // FPL's own cash figure, kept as the primitive: from here a price change
    // moves squad value, never the bank (see TeamState.bank).
    bank: data.transfers.bank,
    freeTransfers,
  };

  return { state, error: null, sellPriceMismatches };
}
