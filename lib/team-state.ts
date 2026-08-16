// TeamState — the normalised squad object every downstream feature consumes.
//
// The updated build plan makes this the central abstraction: a squad may
// originate from the manual Team Builder or, later, from an authenticated FPL
// account, and the optimisers must not care which. Keeping the shape identical
// in both cases is what lets the transfer, captain, and chip engines run
// offline against drafts.

export type TeamSource = "draft" | "fpl";

export interface SquadPick {
  playerId: number;
  /** Price paid, in FPL tenths. Diverges from the live price once prices move. */
  purchasePrice: number;
}

export interface TeamState {
  source: TeamSource;
  draftId: string;
  name: string;
  /**
   * FPL entry this squad was imported from. Absent on manual drafts, and on
   * imports made before Sprint 15 — which is why `isImportedDraftFor`
   * (lib/fpl-squad.ts) still has to fall back to matching the draft's name.
   * Optional so every draft already in localStorage and in team_drafts.payload
   * keeps parsing unchanged.
   */
  entryId?: number | null;
  gameweek: number | null;
  players: SquadPick[];
  captain: number | null;
  viceCaptain: number | null;

  /** Populated by the Starting XI optimiser in a later sprint. */
  startingXI: number[];
  benchOrder: number[];
  /**
   * The chip FPL itself reports as live on this squad right now — untyped
   * because FPL owns the value (`manager_gameweeks.active_chip`, or `my-team`
   * JSON's `status_for_entry`), and deliberately fail-closed rather than
   * coerced into `ChipKind`. This is a fact, not an intention; see `chipPlan`
   * for the latter, and `chipAt` (lib/chip-plan.ts) for how the two reconcile.
   */
  activeChip: string | null;
  /**
   * Forward chip intent — which chip the owner means to play in which future
   * gameweek. Optional exactly as `entryId` is: every draft already in
   * localStorage and in team_drafts.payload keeps parsing unchanged, and
   * `undefined` means "no plan", distinct from an empty one.
   */
  chipPlan?: ChipPlan;

  /** Tenths, as FPL reports them. */
  budget: number;
  freeTransfers: number;
  strategy: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

/** The four chips FPL grants, once each per season half. */
export type ChipKind = "bboost" | "3xc" | "freehit" | "wildcard";

/** One chip pinned to one gameweek. */
export interface ChipPlanEntry {
  chip: ChipKind;
  event: number;
  /** How it got here — a shortlist pin reads differently from a deliberate choice. */
  source: "manual" | "shortlist";
  /** When it was pinned, so a stale plan can be shown as stale. */
  pinnedAt: string;
}

export interface ChipPlan {
  /** Shape version, so a future migration of the plan format has something to key on. */
  version: 1;
  /** Sorted by event on every write, so `sameSquadState` can compare positionally. */
  entries: ChipPlanEntry[];
}

export const EMPTY_CHIP_PLAN: ChipPlan = { version: 1, entries: [] };

/**
 * Squad legality rules. Read from the database rather than hardcoded — the
 * build plan is explicit that "all rules should come from a configuration
 * table", and FPL has changed squad size and budget between seasons.
 */
export interface SquadRules {
  /** Total budget in tenths (game_settings.squad_total_spend). */
  totalSpend: number;
  /** Max players from one club (game_settings.squad_team_limit). */
  teamLimit: number;
  /** Total squad size (game_settings.squad_squadsize). */
  squadSize: number;
  /** element_type id -> required count (element_types.squad_select). */
  positionQuota: Record<number, number>;
}

export const DEFAULT_RULES: SquadRules = {
  totalSpend: 1000,
  teamLimit: 3,
  squadSize: 15,
  positionQuota: { 1: 2, 2: 5, 3: 5, 4: 3 },
};

export interface PlayerMeta {
  id: number;
  elementType: number;
  teamId: number;
  nowCost: number;
  webName: string;
}

export interface PositionProgress {
  elementType: number;
  filled: number;
  required: number;
}

export interface ValidationResult {
  positions: PositionProgress[];
  /** Team ids that exceed the club limit, with their counts. */
  clubBreaches: { teamId: number; count: number }[];
  spent: number;
  budgetRemaining: number;
  overBudget: boolean;
  squadFull: boolean;
  positionsValid: boolean;
  clubsValid: boolean;
  hasCaptain: boolean;
  hasViceCaptain: boolean;
  /** A squad that could legally be entered into FPL. */
  isLegal: boolean;
}

export function emptyTeamState(rules: SquadRules, name = "New draft"): TeamState {
  const now = new Date().toISOString();
  return {
    source: "draft",
    draftId: crypto.randomUUID(),
    name,
    gameweek: null,
    players: [],
    captain: null,
    viceCaptain: null,
    startingXI: [],
    benchOrder: [],
    activeChip: null,
    chipPlan: EMPTY_CHIP_PLAN,
    budget: rules.totalSpend,
    freeTransfers: 1,
    strategy: null,
    notes: "",
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Full legality check. Pure, so the squad optimiser in the next sprint can
 * reuse it to score candidate squads without touching React or the network.
 */
export function validateSquad(
  state: TeamState,
  rules: SquadRules,
  lookup: (playerId: number) => PlayerMeta | undefined,
): ValidationResult {
  const positionCounts = new Map<number, number>();
  const clubCounts = new Map<number, number>();
  let spent = 0;

  for (const pick of state.players) {
    const meta = lookup(pick.playerId);
    spent += pick.purchasePrice;
    if (!meta) continue;
    positionCounts.set(meta.elementType, (positionCounts.get(meta.elementType) ?? 0) + 1);
    clubCounts.set(meta.teamId, (clubCounts.get(meta.teamId) ?? 0) + 1);
  }

  const positions: PositionProgress[] = Object.entries(rules.positionQuota)
    .map(([type, required]) => ({
      elementType: Number(type),
      filled: positionCounts.get(Number(type)) ?? 0,
      required,
    }))
    .sort((a, b) => a.elementType - b.elementType);

  const clubBreaches = [...clubCounts.entries()]
    .filter(([, count]) => count > rules.teamLimit)
    .map(([teamId, count]) => ({ teamId, count }));

  const budgetRemaining = state.budget - spent;
  const squadFull = state.players.length === rules.squadSize;
  const positionsValid = positions.every((p) => p.filled === p.required);
  const clubsValid = clubBreaches.length === 0;
  const overBudget = budgetRemaining < 0;
  const hasCaptain = state.captain !== null;
  const hasViceCaptain = state.viceCaptain !== null;

  return {
    positions,
    clubBreaches,
    spent,
    budgetRemaining,
    overBudget,
    squadFull,
    positionsValid,
    clubsValid,
    hasCaptain,
    hasViceCaptain,
    isLegal:
      squadFull && positionsValid && clubsValid && !overBudget && hasCaptain && hasViceCaptain,
  };
}

/**
 * Why a given player cannot be added right now, or null if they can be.
 * Returned as prose because it is surfaced directly as a tooltip.
 */
export function blockedReason(
  state: TeamState,
  rules: SquadRules,
  candidate: PlayerMeta,
  lookup: (playerId: number) => PlayerMeta | undefined,
): string | null {
  if (state.players.some((p) => p.playerId === candidate.id)) return "Already in your squad";

  const result = validateSquad(state, rules, lookup);

  if (state.players.length >= rules.squadSize) return `Squad already has ${rules.squadSize} players`;

  const position = result.positions.find((p) => p.elementType === candidate.elementType);
  if (position && position.filled >= position.required) {
    return `All ${position.required} slots in this position are filled`;
  }

  const clubCount = state.players.filter(
    (p) => lookup(p.playerId)?.teamId === candidate.teamId,
  ).length;
  if (clubCount >= rules.teamLimit) {
    return `Already have ${rules.teamLimit} players from this club`;
  }

  if (candidate.nowCost > result.budgetRemaining) {
    return `Costs £${(candidate.nowCost / 10).toFixed(1)}m but only £${(
      result.budgetRemaining / 10
    ).toFixed(1)}m is left`;
  }

  return null;
}

export interface HorizonXp {
  xp1: number | null;
  xp3: number | null;
  xp5: number | null;
  xp8: number | null;
  /** The half-season figure — both chip windows (GW1-19, GW20-38) are this long. */
  xp19: number | null;
  /** Every gameweek the model has projected, not necessarily all 38. */
  xpSeason: number | null;
}

/** Gameweek windows the xP engine publishes. */
export type Horizon = 1 | 3 | 5 | 8 | 19 | "season";

export const HORIZONS: Horizon[] = [1, 3, 5, 8, 19, "season"];

export const horizonLabel = (h: Horizon): string => (h === "season" ? "Season" : `${h} GW`);

/**
 * `generate-predictions` now runs from the next gameweek through the
 * season's real last gameweek (38 today), so "Season" means the actual
 * season rather than stopping at a chip window. `windowGws` is still read
 * from `player_xp_horizons.first_event`/`last_event` rather than hardcoded —
 * a season is 38 gameweeks today but was not always, and will not always be.
 * The caveat that remains is not the window's length but its freshness: a
 * projection frozen this far out cannot see news, injuries or form that
 * has not happened yet, so the far weeks of it are its least trustworthy
 * part — the same reason `decisionMargin` exists as a disclosed input in
 * `transfer-optimizer.ts` rather than a modelled one.
 */
export function seasonHorizonNote(windowGws: number): string {
  return (
    `Season covers the ${windowGws} gameweeks the prediction engine currently projects. It is a ` +
    "single frozen snapshot, not a forecast that updates itself — the further a gameweek is from " +
    "today, the more news, injuries and form it cannot yet reflect, so treat the back end of the " +
    "season as the least certain part of this number."
  );
}

/**
 * Gameweeks a horizon spans, for anything that needs a fixture count.
 * `seasonWindow` is the real prediction window for "season" — pass the
 * value read from `player_xp_horizons` when it is known. Defaults to 8,
 * `generate-predictions`' floor, so a caller that has not been updated to
 * thread the real value through stays exactly as conservative as before
 * rather than silently claiming the full 38-gameweek season.
 */
export function horizonLength(horizon: Horizon, seasonWindow: number = 8): number {
  return horizon === "season" ? seasonWindow : horizon;
}

export interface Projection {
  /** Squad total over the requested horizon, including the captaincy double. */
  total: number;
  /** The extra points the armband contributes over that horizon. */
  captainBonus: number;
  /** Picks the xP model declined to predict (no prior-season minutes). */
  missing: number;
}

/** Pull one window out of a player's horizon set. */
export function xpAt(xp: HorizonXp | undefined, horizon: Horizon): number | null {
  if (!xp) return null;
  switch (horizon) {
    case 1:
      return xp.xp1;
    case 3:
      return xp.xp3;
    case 5:
      return xp.xp5;
    case 8:
      return xp.xp8;
    case 19:
      return xp.xp19;
    case "season":
      return xp.xpSeason;
  }
}

/**
 * Squad projection with the captaincy double folded in.
 *
 * FPL doubles the captain's score, so the armband is worth one extra copy of
 * his xP. If he does not play the armband falls to the vice-captain, so the
 * expected value of the doubled slot is weighted by the captain's chance of
 * playing:
 *
 *     bonus = xP(captain) x pCap  +  xP(vice) x (1 - pCap)
 *
 * That makes both selections move the number — a nailed-on captain is worth
 * more than a doubtful one, and a strong vice partially insures a risky pick.
 */
export function computeProjection(
  picks: SquadPick[],
  xpOf: (playerId: number) => HorizonXp | undefined,
  availabilityOf: (playerId: number) => number,
  captain: number | null,
  vice: number | null,
  horizon: Horizon = 1,
): Projection {
  let base = 0;
  let missing = 0;

  for (const pick of picks) {
    const xp = xpOf(pick.playerId);
    const value = xpAt(xp, horizon);
    if (value === null) missing++;
    base += value ?? 0;
  }

  let captainBonus = 0;

  if (captain !== null) {
    const pCap = availabilityOf(captain);
    const capXp = xpAt(xpOf(captain), horizon) ?? 0;
    const viceXp = vice !== null ? (xpAt(xpOf(vice), horizon) ?? 0) : 0;

    captainBonus = capXp * pCap + viceXp * (1 - pCap);
  }

  return { total: base + captainBonus, captainBonus, missing };
}

/** A player's projected points keyed by gameweek, from `player_predictions`. */
export type XpByEvent = Map<number, number>;

/**
 * A squad's expected points for one gameweek, with the armband bonus broken
 * out — what the builder's gameweek planning panel needs (it shows the
 * bonus as its own line, same as the horizon projection does).
 *
 * Deliberately mirrors `computeProjection` term for term — all fifteen picks
 * plus the armband bonus weighted by the captain's chance of playing — so the
 * single-gameweek figure and the horizon figure cannot disagree about what a
 * squad is worth. `missing` counts picks with no entry at all in `seriesOf`
 * for this event — a genuine blank gameweek (a row that exists with xp 0) is
 * not "missing", it is a real answer.
 */
export function projectionAtEvent(
  picks: SquadPick[],
  seriesOf: (playerId: number) => XpByEvent | undefined,
  availabilityOf: (playerId: number) => number,
  captain: number | null,
  vice: number | null,
  event: number,
): { total: number; captainBonus: number; missing: number } {
  const at = (id: number) => seriesOf(id)?.get(event) ?? 0;

  let base = 0;
  let missing = 0;
  for (const pick of picks) {
    if (seriesOf(pick.playerId)?.has(event) !== true) missing++;
    base += at(pick.playerId);
  }

  let captainBonus = 0;
  if (captain !== null) {
    const pCap = availabilityOf(captain);
    captainBonus = at(captain) * pCap + (vice !== null ? at(vice) : 0) * (1 - pCap);
  }

  return { total: base + captainBonus, captainBonus, missing };
}

/**
 * A squad's expected points for one gameweek, total only — every existing
 * caller (the transfer beam search, `lib/chips.ts`) only ever needed the
 * number, so this stays a thin delegate rather than forcing them onto the
 * breakdown shape above.
 */
export function projectAtEvent(
  picks: SquadPick[],
  seriesOf: (playerId: number) => XpByEvent | undefined,
  availabilityOf: (playerId: number) => number,
  captain: number | null,
  vice: number | null,
  event: number,
): number {
  return projectionAtEvent(picks, seriesOf, availabilityOf, captain, vice, event).total;
}

const sameIds = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((id, i) => id === b[i]);

/**
 * Compares `chip` + `event` positionally only — entries are sorted by event on
 * every write, so this is sound without a set comparison. `source`/`pinnedAt`
 * are provenance, not squad shape: including `pinnedAt` would make a re-pin of
 * the identical chip read as a change, the same reasoning that already keeps
 * `updatedAt` out of `sameSquadState` below.
 */
const sameChipPlan = (a: ChipPlan | undefined, b: ChipPlan | undefined): boolean => {
  const ea = a?.entries ?? [];
  const eb = b?.entries ?? [];
  return (
    ea.length === eb.length &&
    ea.every((e, i) => e.chip === eb[i].chip && e.event === eb[i].event)
  );
};

/**
 * Whether two states are the same squad, for "are there unsaved changes?".
 *
 * Compares what a user would call the squad and deliberately ignores
 * `updatedAt` / `createdAt` — every save restamps those, so including them would
 * make a freshly loaded draft read as dirty forever.
 */
export function sameSquadState(a: TeamState, b: TeamState): boolean {
  return (
    a.name === b.name &&
    a.captain === b.captain &&
    a.viceCaptain === b.viceCaptain &&
    a.budget === b.budget &&
    a.activeChip === b.activeChip &&
    a.freeTransfers === b.freeTransfers &&
    sameChipPlan(a.chipPlan, b.chipPlan) &&
    a.players.length === b.players.length &&
    a.players.every(
      (p, i) =>
        p.playerId === b.players[i].playerId && p.purchasePrice === b.players[i].purchasePrice,
    ) &&
    sameIds(a.startingXI, b.startingXI) &&
    sameIds(a.benchOrder, b.benchOrder)
  );
}

export function addPlayer(state: TeamState, meta: PlayerMeta): TeamState {
  return {
    ...state,
    players: [...state.players, { playerId: meta.id, purchasePrice: meta.nowCost }],
    updatedAt: new Date().toISOString(),
  };
}

export function removePlayer(state: TeamState, playerId: number): TeamState {
  return {
    ...state,
    players: state.players.filter((p) => p.playerId !== playerId),
    captain: state.captain === playerId ? null : state.captain,
    viceCaptain: state.viceCaptain === playerId ? null : state.viceCaptain,
    updatedAt: new Date().toISOString(),
  };
}

// Captain and vice-captain must be different players. Promoting one of the two
// therefore swaps them rather than vacating the other armband: choosing your
// vice as captain almost always means you want the old captain as his backup,
// and silently clearing the vice loses information the user already gave.

export function setCaptain(state: TeamState, playerId: number): TeamState {
  return {
    ...state,
    captain: playerId,
    viceCaptain: state.viceCaptain === playerId ? state.captain : state.viceCaptain,
    updatedAt: new Date().toISOString(),
  };
}

export function setViceCaptain(state: TeamState, playerId: number): TeamState {
  return {
    ...state,
    viceCaptain: playerId,
    captain: state.captain === playerId ? state.viceCaptain : state.captain,
    updatedAt: new Date().toISOString(),
  };
}
