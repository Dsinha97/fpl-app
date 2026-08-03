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
  gameweek: number | null;
  players: SquadPick[];
  captain: number | null;
  viceCaptain: number | null;

  /** Populated by the Starting XI optimiser in a later sprint. */
  startingXI: number[];
  benchOrder: number[];
  activeChip: string | null;

  /** Tenths, as FPL reports them. */
  budget: number;
  freeTransfers: number;
  strategy: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

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
  /** Every gameweek the model has projected, not necessarily all 38. */
  xpSeason: number | null;
}

/** Gameweek windows the xP engine publishes. */
export type Horizon = 1 | 3 | 5 | 8 | "season";

export const HORIZONS: Horizon[] = [1, 3, 5, 8, "season"];

export const horizonLabel = (h: Horizon): string => (h === "season" ? "Season" : `${h} GW`);

/**
 * `generate-predictions` runs an 8-gameweek window, so the season total
 * currently equals the 8 GW figure exactly. Saying so beats presenting an
 * identical number under a longer-sounding name.
 */
export const SEASON_HORIZON_NOTE =
  "Season covers every gameweek the model has projected. The prediction engine currently runs an " +
  "8-gameweek window, so this matches the 8 GW figure until that window is extended for the chip planner.";

/** Gameweeks a horizon spans, for anything that needs a fixture count. */
export function horizonLength(horizon: Horizon): number {
  return horizon === "season" ? 38 : horizon;
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
