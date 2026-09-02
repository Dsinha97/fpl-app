// Sprint 8 — Transfer Simulator.
//
// One squad in, a basket of out/in pairs, and an honest account of what the
// basket buys:
//
//   TransferGain = xP(new team) − xP(old team) − TransferCost − RiskChange
//
// Pure, so Sprint 9's optimiser can search over baskets by calling this in a
// loop without touching React or the network.

import { fixtureScore, riskScore, xpFor, type ScoredPlayer } from "./scoring";
import { riskPoints } from "./squad-score";
import { squadBank } from "./squad-budget";
import { mean } from "./stats";
import { optimiseLineup, type LineupCandidate } from "./lineup";
import { chipAdjustmentFor, type ChipAdjustment, type ChipContext, type PredAt } from "./chip-plan";
import {
  addPlayer,
  computeProjection,
  removePlayer,
  setCaptain,
  setViceCaptain,
  validateSquad,
  type Horizon,
  type HorizonXp,
  type PlayerMeta,
  type Projection,
  type SquadRules,
  type TeamState,
  type XpByEvent,
} from "./team-state";

export interface TransferMove {
  outId: number;
  inId: number;
}

export interface MoveDetail {
  outId: number;
  inId: number;
  outName: string;
  inName: string;
  /** What FPL would pay for the outgoing player. */
  sellPrice: number;
  buyPrice: number;
  /** Positive means the move frees cash. */
  cashFreed: number;
  xpDelta: number;
  fixtureDelta: number;
  riskDelta: number;
  /** Set when the pair are different positions, which FPL forbids. */
  positionMismatch: boolean;
}

export interface TransferCostBreakdown {
  transfers: number;
  freeTransfers: number;
  hits: number;
  /** Points surrendered: 4 per transfer beyond the free ones. */
  pointsCost: number;
}

export interface SideMetrics {
  projection: Projection;
  meanFixture: number;
  meanRisk: number;
  /** Expected auto-sub contribution, null when no legal XI exists. */
  benchContribution: number | null;
  captain: number | null;
  viceCaptain: number | null;
  bank: number;
  /** Null when no chip plan touches this horizon window — see `SimulateInput.chip`. */
  chipAdjustment: ChipAdjustment | null;
  /** `projection.total`, adjusted for the chip plan. Equals `projection.total` when `chipAdjustment` is null. */
  chipAdjustedTotal: number;
}

export interface TransferSimulation {
  before: SideMetrics;
  after: SideMetrics;
  /** The squad as it would be, armband included. */
  resultingTeam: TeamState;
  moves: MoveDetail[];
  cost: TransferCostBreakdown;
  /** xP(after) − xP(before), before any cost. */
  xpDelta: number;
  riskPointsDelta: number;
  /** The headline: xP gain net of the hit and the risk change. */
  transferGain: number;
  /** False when the resulting squad could not be entered into FPL. */
  legal: boolean;
  problems: string[];
  /** Set when selling the captain or vice forced the armband to move. */
  armbandNote: string | null;
}

/** Points surrendered per transfer beyond the free allowance. */
export const HIT_COST = 4;

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

export interface SimulateInput {
  team: TeamState;
  moves: TransferMove[];
  freeTransfers: number;
  scoredById: Map<number, ScoredPlayer>;
  /** Penalty-taker flag per player, for the lineup engine's captain reasons. */
  isPenaltyTaker: (playerId: number) => boolean;
  lookup: (playerId: number) => PlayerMeta | undefined;
  xpOf: (playerId: number) => HorizonXp | undefined;
  availabilityOf: (playerId: number) => number;
  rules: SquadRules;
  horizon: Horizon;
  /**
   * The chip plan resolved for this horizon window, when one touches it.
   * Absent → every quantity below is byte-identical to a build with no chip
   * plan at all; this is the whole reason `xpDelta` is expressed through
   * `chipAdjustedTotal` rather than a separate code path.
   */
  chip?: {
    context: ChipContext;
    predAt: PredAt;
    seriesOf: (playerId: number) => XpByEvent | undefined;
  };
}

function metricsFor(
  team: TeamState,
  input: SimulateInput,
): SideMetrics {
  const { scoredById, xpOf, availabilityOf, horizon, isPenaltyTaker, lookup } = input;

  const players = team.players.flatMap((p) => {
    const s = scoredById.get(p.playerId);
    return s ? [s] : [];
  });

  const candidates: LineupCandidate[] = players.map((s) => ({
    playerId: s.id,
    elementType: s.elementType,
    webName: s.webName,
    xp: s.xp[1],
    expectedMinutes: s.expectedMinutes,
    startProbability: s.startProbability,
    availability: s.availability,
    fdr: s.fdrRun[0] ?? null,
    opponent: null,
    isPenaltyTaker: isPenaltyTaker(s.id),
  }));
  const lineup = candidates.length > 0 ? optimiseLineup(candidates) : null;


  const projection = computeProjection(
    team.players,
    xpOf,
    availabilityOf,
    team.captain,
    team.viceCaptain,
    horizon,
  );

  const chipAdjustment = input.chip
    ? chipAdjustmentFor(
        team,
        input.chip.context,
        input.chip.seriesOf,
        availabilityOf,
        input.chip.predAt,
        lookup,
        isPenaltyTaker,
      )
    : null;
  const chipAdjustedTotal = chipAdjustment
    ? projection.total - chipAdjustment.excluded + chipAdjustment.bonus
    : projection.total;

  return {
    projection,
    meanFixture: mean(players.map((p) => fixtureScore(p, horizon))),
    meanRisk: mean(players.map((p) => riskScore(p, horizon))),
    benchContribution: lineup ? lineup.benchExpectedContribution : null,
    captain: team.captain,
    viceCaptain: team.viceCaptain,
    // Not `budget - spent`: that charges every held player's price rise to
    // the bank (see squadBank, lib/squad-budget.ts).
    bank: squadBank(team, (id) => lookup(id)?.nowCost),
    chipAdjustment,
    chipAdjustedTotal,
  };
}

/**
 * Apply a basket of transfers and report the difference.
 *
 * Moves are applied in order against a working copy, so a basket that frees cash
 * on move one can fund move two — which is how FPL behaves.
 */
export function simulateTransfers(input: SimulateInput): TransferSimulation {
  const { team, moves, freeTransfers, scoredById, lookup, rules, horizon } = input;

  const before = metricsFor(team, input);

  let working = team;
  const details: MoveDetail[] = [];
  const problems: string[] = [];

  for (const move of moves) {
    const outPick = working.players.find((p) => p.playerId === move.outId);
    const outScored = scoredById.get(move.outId);
    const inScored = scoredById.get(move.inId);
    const inMeta = lookup(move.inId);

    if (!outPick || !outScored) {
      problems.push(`Player ${move.outId} is not in this squad.`);
      continue;
    }
    if (!inScored || !inMeta) {
      problems.push(`No data for incoming player ${move.inId}.`);
      continue;
    }
    if (working.players.some((p) => p.playerId === move.inId)) {
      problems.push(`${inScored.webName} is already in the squad.`);
      continue;
    }

    const positionMismatch = outScored.elementType !== inScored.elementType;
    if (positionMismatch) {
      problems.push(
        `${outScored.webName} and ${inScored.webName} play different positions — FPL transfers must be like for like.`,
      );
    }

    const sell = sellPrice(outPick.purchasePrice, outScored.price);
    const buy = inMeta.nowCost;

    // Removing first frees the cash, then the incoming player is bought at the
    // live price — the order the game itself uses.
    working = addPlayer(removePlayer(working, move.outId, outScored.price), inMeta);

    details.push({
      outId: move.outId,
      inId: move.inId,
      outName: outScored.webName,
      inName: inScored.webName,
      sellPrice: sell,
      buyPrice: buy,
      cashFreed: sell - buy,
      xpDelta: xpFor(inScored, horizon) - xpFor(outScored, horizon),
      fixtureDelta: fixtureScore(inScored, horizon) - fixtureScore(outScored, horizon),
      riskDelta: riskScore(inScored, horizon) - riskScore(outScored, horizon),
      positionMismatch,
    });
  }

  // `removePlayer` vacates the armband when the holder leaves. Refill it from
  // the resulting squad rather than leaving the projection short of a captain,
  // and say so — a forced armband change is part of the cost of the transfer.
  let armbandNote: string | null = null;
  const lostCaptain = team.captain !== null && working.captain === null;
  const lostVice = team.viceCaptain !== null && working.viceCaptain === null;

  if (lostCaptain || lostVice) {
    const ranked = working.players
      .map((p) => ({ id: p.playerId, xp: xpFor(scoredById.get(p.playerId) ?? emptyScored(p.playerId), horizon) }))
      .sort((a, b) => b.xp - a.xp);

    if (lostCaptain) {
      const next = ranked.find((r) => r.id !== working.viceCaptain);
      if (next) working = setCaptain(working, next.id);
    }
    if (working.viceCaptain === null) {
      const next = ranked.find((r) => r.id !== working.captain);
      if (next) working = setViceCaptain(working, next.id);
    }

    const capName = working.captain !== null ? scoredById.get(working.captain)?.webName : null;
    armbandNote = lostCaptain
      ? `You sold your captain — the armband moves to ${capName ?? "another player"}.`
      : `You sold your vice-captain — the backup armband moves to ${
          working.viceCaptain !== null
            ? (scoredById.get(working.viceCaptain)?.webName ?? "another player")
            : "another player"
        }.`;
  }

  const after = metricsFor(working, input);

  const validation = validateSquad(working, rules, lookup);
  if (validation.overBudget) {
    problems.push(
      `Over budget by £${Math.abs(validation.budgetRemaining / 10).toFixed(1)}m.`,
    );
  }
  for (const breach of validation.clubBreaches) {
    const club = [...scoredById.values()].find((s) => s.teamId === breach.teamId);
    problems.push(
      `${breach.count} players from ${club?.teamShort ?? `club ${breach.teamId}`} — the limit is ${rules.teamLimit}.`,
    );
  }
  if (!validation.positionsValid && working.players.length === rules.squadSize) {
    problems.push("Position quotas no longer add up.");
  }

  const hits = Math.max(0, details.length - Math.max(0, freeTransfers));
  const cost: TransferCostBreakdown = {
    transfers: details.length,
    freeTransfers: Math.max(0, freeTransfers),
    hits,
    pointsCost: hits * HIT_COST,
  };

  // Byte-identical to `after.projection.total - before.projection.total` when
  // no chip plan touches this horizon — `chipAdjustedTotal` falls back to
  // `projection.total` on both sides. A chip changes neither the hit nor the
  // risk rate, so `cost` and `riskPointsDelta` are untouched.
  const xpDelta = after.chipAdjustedTotal - before.chipAdjustedTotal;
  const riskPointsDelta = riskPoints(after.meanRisk) - riskPoints(before.meanRisk);
  const transferGain = xpDelta - cost.pointsCost - riskPointsDelta;

  return {
    before,
    after,
    resultingTeam: working,
    moves: details,
    cost,
    xpDelta,
    riskPointsDelta,
    transferGain,
    legal: problems.length === 0,
    problems,
    armbandNote,
  };
}

/** Placeholder for a pick with no scoring data, so ranking never crashes. */
function emptyScored(id: number): ScoredPlayer {
  return {
    id,
    webName: `#${id}`,
    elementType: 0,
    teamId: 0,
    teamShort: null,
    price: 0,
    ownership: null,
    pointsPerGame: null,
    xp: { 1: null, 3: null, 5: null, 8: null, 19: null, season: null },
    expectedMinutes: null,
    startProbability: null,
    availability: 0,
    fdrRun: [],
  };
}

export const TRANSFER_MODEL_NOTE =
  "TransferGain is the xP change over the horizon, less the points hit, less the change in squad " +
  "risk expressed in points. The free-transfer count is yours to set here; what it becomes next " +
  "gameweek — one more, capped at five — is what the transfer plan above uses to price rolling. " +
  "Selling prices follow FPL's rule of purchase price plus half of any rise.";
