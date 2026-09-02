// Sprint (chip strategy, Phase 3) — Forward Transfer Path.
//
// The deadline optimiser (lib/transfer-optimizer.ts) decides one gameweek.
// This decides a *sequence*: given a chip plan, what should happen at the
// deadline AND at the gameweeks between now and the last planned chip, so a
// Bench Boost gets a deep bench built ahead of it, a Wildcard stops the
// search wasting transfers on a squad about to be overwritten, and a Free
// Hit's squad is understood as temporary.
//
// ---------------------------------------------------------------------------
// Why this is a bounded search, not the best possible sequence
//
// The real problem is choosing up to `PATH_MAX_BASKET` moves at each of up to
// `PATH_MAX_EVENTS` gameweeks — astronomically larger than the deadline's own
// single-gameweek beam. So the deadline gameweek reuses `optimizeTransfers`'s
// real basket search verbatim (no second implementation of that decision),
// and every gameweek after it uses a much narrower beam: fewer replacement
// candidates per slot, a shallower basket, and a smaller state beam — see
// PATH_STATE_BEAM/PATH_CANDIDATES_PER_SLOT/PATH_MAX_BASKET below. Chip
// gameweeks are never searched; they are forced from the plan.
//
// Every step's contribution to the total is `projectAtEvent` — the same
// single-implementation this codebase already uses for "one gameweek's worth
// of a squad" (rollBranch's forfeit arithmetic, chipAdjustmentFor's mask) —
// valued against the ORIGINAL squad held unchanged, so steps sum without
// double-counting and the total reads the same way every other headline in
// this app does: a gain over doing nothing, never an absolute total.
// ---------------------------------------------------------------------------

import { findReplacements, type ScoredPlayer } from "./scoring";
import {
  simulateTransfers,
  accrueFreeTransfers,
  type TransferMove,
  type TransferSimulation,
} from "./transfers";
import {
  optimizeTransfers,
  pairRebuild,
  DEFAULT_DECISION_MARGIN,
  type WildcardWindow,
} from "./transfer-optimizer";
import { freeHitRebuildAt, wildcardRebuildAt, type RebuildContext } from "./chips";
import { chipBonusAt, chipContextFor, type PredAt } from "./chip-plan";
import { squadBank } from "./squad-budget";
import {
  projectAtEvent,
  type ChipKind,
  type ChipPlanEntry,
  type Horizon,
  type HorizonXp,
  type PlayerMeta,
  type SquadPick,
  type SquadRules,
  type TeamState,
  type XpByEvent,
} from "./team-state";

/** Squad states carried between gameweeks. */
export const PATH_STATE_BEAM = 4;
/** Replacements considered per squad slot at each future gameweek — narrower than the deadline's CANDIDATES_PER_SLOT (5), since this runs for several gameweeks, not one. */
export const PATH_CANDIDATES_PER_SLOT = 3;
/** Deepest basket a future gameweek's own search will build. */
export const PATH_MAX_BASKET = 2;
/** Hard cap on how many gameweeks ahead the path reaches. */
export const PATH_MAX_EVENTS = 6;

export interface TransferPathStep {
  event: number;
  /** The transfers made this gameweek. Empty for a roll, and for a Wildcard/Free Hit (their squad change is a rebuild, not a basket — see `chip`). */
  moves: TransferMove[];
  /** Null on a chip-forced gameweek, where the fielded squad differs from the carried one. */
  simulation: TransferSimulation | null;
  chip: ChipKind | null;
  /** The squad actually fielded this gameweek — the carried squad, or a Free Hit/Wildcard rebuild. */
  fieldedPicks: SquadPick[];
  freeTransfersBefore: number;
  freeTransfersAfter: number;
  /** This gameweek's gain over holding the ORIGINAL squad unchanged, from `projectAtEvent` — never an absolute total. */
  eventXp: number;
  /** Bench Boost / Triple Captain bonus this gameweek, 0 when none is planned here. */
  chipBonus: number;
  pointsCost: number;
  riskPointsDelta: number;
  /**
   * The assumed value of NOT acting, on a step that makes no move — the same
   * `decisionMargin` the deadline optimiser's roll branch carries
   * (lib/transfer-optimizer.ts). Zero on every step that does something.
   * Kept as its own term rather than folded into `eventXp`: it is an
   * assumption the owner sets, not a prediction.
   */
  decisionMargin: number;
  explanation: string[];
}

export interface TransferPath {
  steps: TransferPathStep[];
  /** Σ eventXp + Σ chipBonus + Σ decisionMargin − Σ pointsCost − Σ riskPointsDelta. */
  total: number;
  terms: { eventXp: number; chipBonus: number; pointsCost: number; riskPoints: number; decisionMargin: number };
  /** The action at the upcoming deadline — what this whole search is for. */
  openingMove: TransferPathStep;
}

export interface TransferPathResult {
  /** Best first. */
  paths: TransferPath[];
  recommended: TransferPath | null;
  runnerUp: TransferPath | null;
  margin: number;
  /** Simulations actually run beyond the deadline gameweek's own optimizeTransfers call, so the button copy can state the real cost. */
  simulationCount: number;
  note: string;
}

export interface TransferPathInput {
  team: TeamState;
  pool: ScoredPlayer[];
  scoredById: Map<number, ScoredPlayer>;
  lookup: (playerId: number) => PlayerMeta | undefined;
  xpOf: (playerId: number) => HorizonXp | undefined;
  availabilityOf: (playerId: number) => number;
  isPenaltyTaker: (playerId: number) => boolean;
  seriesOf: (playerId: number) => XpByEvent | undefined;
  predAt: PredAt;
  rules: SquadRules;
  /**
   * The page-level horizon, passed straight through to the deadline
   * gameweek's own `optimizeTransfers` call. Was hardcoded to 5 until Sprint
   * 28, which is why the horizon toggle moved the transfer plan's answer and
   * left the path's opening move untouched — two answers to one question.
   * Gameweeks *after* the deadline still score at horizon 1, by design:
   * each one contributes its own event's prediction, nothing wider.
   */
  horizon: Horizon;
  /** The owner's assumed value of holding a transfer back — see `TransferPathStep.decisionMargin`. Defaults to the optimiser's own `DEFAULT_DECISION_MARGIN`. */
  decisionMargin?: number;
  freeTransfers: number;
  /** The upcoming deadline gameweek. */
  event: number;
  /** Last gameweek with a real projection — the path never reaches beyond it. */
  windowEnd: number;
  /** Already-validated entries — `ChipPlanValidation.usable`, never the raw plan. */
  plan: ChipPlanEntry[];
  wildcard: WildcardWindow;
}

export const TRANSFER_PATH_NOTE =
  "This is a bounded search, not the best possible sequence. Chip timing is yours — nothing here " +
  "moves a chip to a better gameweek. The upcoming deadline gets the full basket search from the " +
  "transfer optimiser at the horizon selected above; every gameweek after it is valued on its own " +
  "gameweek alone and considers only the top 3 replacements per slot, at most 2 moves, carrying the " +
  "best 4 squads forward. A gameweek that buys nothing carries the squad through unchanged and is " +
  "credited the decision margin — the assumed worth of holding a transfer back for news — which is " +
  "an input you set, not a prediction. Candidates beyond the deadline are ranked by next-gameweek " +
  "form (the model has no other per-gameweek signal to rank a future slot by), but each step's value " +
  "is still the real prediction for its own gameweek. Prices are frozen, so a rise that funds a later " +
  "move is not modelled, and neither are injuries or news that have not happened — a real manager " +
  "replans every week with information this projection cannot have, so treat the far end of the path " +
  "as the shape of a plan, not an instruction.";

interface PathState {
  team: TeamState;
  freeTransfers: number;
  steps: TransferPathStep[];
  eventXp: number;
  chipBonus: number;
  pointsCost: number;
  riskPoints: number;
  decisionMargin: number;
}

const scoreOf = (s: PathState) =>
  s.eventXp + s.chipBonus + s.decisionMargin - s.pointsCost - s.riskPoints;

/** The plan entry pinned to `event`, if any. */
function planAt(plan: ChipPlanEntry[], event: number): ChipPlanEntry | undefined {
  return plan.find((e) => e.event === event);
}

export function planTransferPath(input: TransferPathInput): TransferPathResult {
  const { team, pool, scoredById, lookup, xpOf, availabilityOf, isPenaltyTaker, seriesOf, predAt, rules } = input;
  const decisionMargin = input.decisionMargin ?? DEFAULT_DECISION_MARGIN;

  const lastPlannedEvent = input.plan.length > 0 ? Math.max(...input.plan.map((e) => e.event)) : input.event + 2;
  const pathEnd = Math.min(
    input.windowEnd,
    Math.max(lastPlannedEvent, input.event + 2),
    input.event + PATH_MAX_EVENTS - 1,
  );

  let simulationCount = 0;

  const baselineEventXp = (fielded: SquadPick[], captain: number | null, vice: number | null, event: number): number =>
    projectAtEvent(fielded, seriesOf, availabilityOf, captain, vice, event) -
    projectAtEvent(team.players, seriesOf, availabilityOf, team.captain, team.viceCaptain, event);

  const chipBonusOf = (fieldedTeam: TeamState, event: number, chip: ChipKind | undefined): number => {
    if (chip !== "bboost" && chip !== "3xc") return 0;
    const v = chipBonusAt(fieldedTeam, event, chip, predAt, availabilityOf, lookup, isPenaltyTaker);
    return v && !v.blocked ? v.gain : 0;
  };

  const simDeps: SimDeps = { scoredById, lookup, xpOf, isPenaltyTaker };

  // -------------------------------------------------------- opening gameweek
  //
  // Chip-forced (Wildcard/Free Hit) uses the same forced-step logic every
  // later gameweek uses. Otherwise, the deadline reuses `optimizeTransfers`'s
  // real search rather than re-deciding this gameweek with the path's own
  // narrower beam.
  const opening = planAt(input.plan, input.event)?.chip ?? null;
  const rebuildCtx: RebuildContext = { team, pool, rules, predAt, availabilityOf };
  let openingStates: PathState[];

  // A Bench Boost / Triple Captain pinned at the opening (deadline) gameweek
  // was previously reported as chipBonus: 0 here — every later gameweek's
  // bonus chip already went through chipBonusOf (below), but this branch
  // hardcoded 0 regardless of what was pinned. optimizeTransfers' own branch
  // *ranking* already accounted for the bonus via chipAdjustedTotal (the
  // context it's given includes it), so the recommended branch was always
  // correct — only the displayed step.chipBonus, and therefore the visible
  // total for a plan whose first chip lands next gameweek, understated the
  // real value. Caught while wiring the front-loaded-sequence preset on
  // /chips, whose first chip is always the very next gameweek.
  const openingBonusChip = opening === "bboost" || opening === "3xc" ? opening : undefined;

  if (opening === "wildcard" || opening === "freehit") {
    const step = forcedChipStep(input.event, opening, team, input.freeTransfers, rebuildCtx, simDeps, pathEnd, baselineEventXp);
    openingStates = [
      {
        team: opening === "wildcard" ? step.simulation?.resultingTeam ?? team : team,
        freeTransfers: step.freeTransfersAfter,
        steps: [step],
        eventXp: step.eventXp,
        chipBonus: step.chipBonus,
        pointsCost: step.pointsCost,
        riskPoints: step.riskPointsDelta,
        decisionMargin: step.decisionMargin,
      },
    ];
  } else {
    const openingChip = chipContextFor(input.plan, input.event, Math.min(pathEnd, input.event + 4));
    const openingResult = optimizeTransfers({
      team,
      pool,
      scoredById,
      lookup,
      xpOf,
      availabilityOf,
      isPenaltyTaker,
      seriesOf,
      rules,
      horizon: input.horizon,
      decisionMargin,
      freeTransfers: input.freeTransfers,
      event: input.event,
      wildcard: input.wildcard,
      chip: openingChip ?? undefined,
      predAt,
    });

    const playable = openingResult.branches.filter((b) => b.blocked === null && b.simulation !== null);
    const ranked = [...playable].sort((a, b) => b.net - a.net).slice(0, PATH_STATE_BEAM);

    openingStates = ranked.map((branch) => {
      const sim = branch.simulation!;
      // A roll branch's `simulation` is NEXT gameweek's basket, kept by
      // `rollBranch` purely to price what waiting buys (lib/transfer-optimizer.ts).
      // Reading `sim.resultingTeam` here would field, score and carry forward a
      // squad with next week's transfers already applied, at zero cost, while
      // labelling the step "roll" — the squad the owner actually holds at this
      // deadline is the unchanged one. The path searches GW n+1 for itself in
      // the loop below, which is where that basket's value belongs.
      const isRoll = branch.kind === "roll";
      const carried = isRoll ? team : sim.resultingTeam;
      const usedForAccrual = branch.kind === "wildcard" ? 0 : branch.moves.length;
      const freeTransfersAfter = accrueFreeTransfers(input.freeTransfers, usedForAccrual);
      const evXp = baselineEventXp(
        carried.players,
        carried.captain,
        carried.viceCaptain,
        input.event,
      );
      const bonus = chipBonusOf(carried, input.event, openingBonusChip);
      const step: TransferPathStep = {
        event: input.event,
        moves: branch.moves,
        simulation: isRoll ? null : sim,
        chip: opening === null ? (branch.kind === "wildcard" ? "wildcard" : null) : openingBonusChip ?? null,
        fieldedPicks: carried.players,
        freeTransfersBefore: input.freeTransfers,
        freeTransfersAfter,
        eventXp: evXp,
        chipBonus: bonus,
        pointsCost: isRoll ? 0 : sim.cost.pointsCost,
        riskPointsDelta: isRoll ? 0 : sim.riskPointsDelta,
        decisionMargin: isRoll ? decisionMargin : 0,
        explanation: isRoll
          ? [
              "Roll — nothing bought this gameweek.",
              `Carries ${freeTransfersAfter} free transfer${freeTransfersAfter === 1 ? "" : "s"} into GW${input.event + 1}; what to spend them on is the next step, searched on its own.`,
            ]
          : branch.explanation,
      };
      return {
        team: carried,
        freeTransfers: freeTransfersAfter,
        steps: [step],
        eventXp: evXp,
        chipBonus: bonus,
        pointsCost: step.pointsCost,
        riskPoints: step.riskPointsDelta,
        decisionMargin: step.decisionMargin,
      };
    });
  }

  // -------------------------------------------------------- later gameweeks
  let frontier = openingStates;
  for (let event = input.event + 1; event <= pathEnd; event++) {
    const forced = planAt(input.plan, event)?.chip ?? null;
    const next: PathState[] = [];

    for (const state of frontier) {
      if (forced === "wildcard" || forced === "freehit") {
        const step = forcedChipStep(event, forced, state.team, state.freeTransfers, {
          team: state.team,
          pool,
          rules,
          predAt,
          availabilityOf,
        }, simDeps, pathEnd, baselineEventXp);
        next.push({
          team: forced === "wildcard" ? step.simulation?.resultingTeam ?? state.team : state.team,
          freeTransfers: step.freeTransfersAfter,
          steps: [...state.steps, step],
          eventXp: state.eventXp + step.eventXp,
          chipBonus: state.chipBonus + step.chipBonus,
          pointsCost: state.pointsCost + step.pointsCost,
          riskPoints: state.riskPoints + step.riskPointsDelta,
          decisionMargin: state.decisionMargin + step.decisionMargin,
        });
        continue;
      }

      const bonusChip = forced === "bboost" || forced === "3xc" ? forced : undefined;
      const candidates = expandOneGameweek(state, event, {
        pool,
        scoredById,
        lookup,
        xpOf,
        availabilityOf,
        isPenaltyTaker,
        rules,
      });
      simulationCount += candidates.simCount;

      for (const c of candidates.baskets) {
        const evXp = baselineEventXp(
          c.sim.resultingTeam.players,
          c.sim.resultingTeam.captain,
          c.sim.resultingTeam.viceCaptain,
          event,
        );
        const bonus = chipBonusOf(c.sim.resultingTeam, event, bonusChip);
        const freeTransfersAfter = accrueFreeTransfers(state.freeTransfers, c.moves.length);
        const explanation =
          c.moves.length === 0
            ? ["Roll — nothing bought this gameweek."]
            : c.moves.map((m) => `${m.outName} → ${m.inName}`);
        const step: TransferPathStep = {
          event,
          moves: c.moves.map((m) => ({ outId: m.outId, inId: m.inId })),
          simulation: c.sim,
          chip: bonusChip ?? null,
          fieldedPicks: c.sim.resultingTeam.players,
          freeTransfersBefore: state.freeTransfers,
          freeTransfersAfter,
          eventXp: evXp,
          chipBonus: bonus,
          pointsCost: c.sim.cost.pointsCost,
          riskPointsDelta: c.sim.riskPointsDelta,
          // Same assumption as the deadline's own roll branch: a gameweek
          // that buys nothing is worth `decisionMargin` in kept optionality.
          // Applied here too, or "hold" would win far more readily on the
          // /deadline plan than on the path and the two would disagree for a
          // reason that is an input, not a prediction.
          decisionMargin: c.moves.length === 0 && !bonusChip ? decisionMargin : 0,
          explanation,
        };
        next.push({
          team: c.sim.resultingTeam,
          freeTransfers: freeTransfersAfter,
          steps: [...state.steps, step],
          eventXp: state.eventXp + evXp,
          chipBonus: state.chipBonus + bonus,
          pointsCost: state.pointsCost + c.sim.cost.pointsCost,
          riskPoints: state.riskPoints + c.sim.riskPointsDelta,
          decisionMargin: state.decisionMargin + step.decisionMargin,
        });
      }
    }

    // Nothing legal found anywhere this gameweek (should not happen in
    // practice — roll is always a candidate) — stop growing rather than
    // silently truncate every remaining gameweek from every path.
    if (next.length === 0) break;

    const bySignature = new Map<string, PathState>();
    for (const s of next) {
      const sig = s.steps.map((st) => `${st.event}:${signatureOfMoves(st.moves)}:${st.chip ?? ""}`).join("|");
      const existing = bySignature.get(sig);
      if (!existing || scoreOf(s) > scoreOf(existing)) bySignature.set(sig, s);
    }
    const deduped = [...bySignature.values()];

    const byScore = [...deduped].sort((a, b) => scoreOf(b) - scoreOf(a));
    const carried = byScore.slice(0, PATH_STATE_BEAM);
    const carriedSigs = new Set(carried.map((s) => s.steps.map((st) => signatureOfMoves(st.moves)).join("|")));
    const funder = [...deduped]
      .sort((a, b) => {
        const bankA = squadBank(a.team, (id) => lookup(id)?.nowCost);
        const bankB = squadBank(b.team, (id) => lookup(id)?.nowCost);
        return bankB - bankA;
      })
      .find((s) => !carriedSigs.has(s.steps.map((st) => signatureOfMoves(st.moves)).join("|")));

    frontier = funder ? [...carried, funder] : carried;
  }

  const paths: TransferPath[] = frontier
    .map((s) => ({
      steps: s.steps,
      total: scoreOf(s),
      terms: {
        eventXp: s.eventXp,
        chipBonus: s.chipBonus,
        pointsCost: s.pointsCost,
        riskPoints: s.riskPoints,
        decisionMargin: s.decisionMargin,
      },
      openingMove: s.steps[0],
    }))
    .sort((a, b) => b.total - a.total);

  const recommended = paths[0] ?? null;
  const runnerUp = paths[1] ?? null;
  const margin = recommended && runnerUp ? recommended.total - runnerUp.total : Infinity;

  return {
    paths,
    recommended,
    runnerUp,
    margin,
    simulationCount,
    note: TRANSFER_PATH_NOTE,
  };
}

const signatureOfMoves = (moves: TransferMove[]) =>
  moves
    .map((m) => `${m.outId}>${m.inId}`)
    .sort()
    .join("|");

interface ExpandDeps {
  pool: ScoredPlayer[];
  scoredById: Map<number, ScoredPlayer>;
  lookup: (playerId: number) => PlayerMeta | undefined;
  xpOf: (playerId: number) => HorizonXp | undefined;
  availabilityOf: (playerId: number) => number;
  isPenaltyTaker: (playerId: number) => boolean;
  rules: SquadRules;
}

/**
 * One future gameweek's candidate baskets from one carried state: roll, every
 * single-slot replacement up to `PATH_CANDIDATES_PER_SLOT`, and one round of
 * `PATH_MAX_BASKET`-deep extension from the single best move found. Ranked
 * candidate generation uses `findReplacements` at horizon 1 — the model has
 * no per-future-gameweek "how good is this player" signal beyond that, which
 * `TRANSFER_PATH_NOTE` discloses; each candidate's own value is still the
 * real per-event prediction, computed by the caller from `projectAtEvent`.
 */
function expandOneGameweek(
  state: PathState,
  event: number,
  deps: ExpandDeps,
): { baskets: { moves: { outId: number; inId: number; outName: string; inName: string }[]; sim: TransferSimulation }[]; simCount: number } {
  const { pool, scoredById, lookup, xpOf, availabilityOf, isPenaltyTaker, rules } = deps;
  let simCount = 0;

  const simulate = (moves: TransferMove[]): TransferSimulation => {
    simCount++;
    return simulateTransfers({
      team: state.team,
      moves,
      freeTransfers: state.freeTransfers,
      scoredById,
      isPenaltyTaker,
      lookup,
      xpOf,
      availabilityOf,
      rules,
      horizon: 1,
    });
  };

  const roll = simulate([]);
  const baskets: { moves: { outId: number; inId: number; outName: string; inName: string }[]; sim: TransferSimulation }[] = [
    { moves: [], sim: roll },
  ];

  const singles: { moves: { outId: number; inId: number; outName: string; inName: string }[]; sim: TransferSimulation }[] = [];
  for (const pick of state.team.players) {
    const target = scoredById.get(pick.playerId);
    if (!target) continue;
    const replacements = findReplacements(target, pool, state.team, rules, lookup, 1, PATH_CANDIDATES_PER_SLOT);
    for (const r of replacements) {
      const moves = [{ outId: pick.playerId, inId: r.player.id, outName: target.webName, inName: r.player.webName }];
      const sim = simulate(moves.map((m) => ({ outId: m.outId, inId: m.inId })));
      if (!sim.legal) continue;
      singles.push({ moves, sim });
    }
  }
  baskets.push(...singles);

  if (PATH_MAX_BASKET >= 2 && singles.length > 0) {
    const bestSingle = [...singles].sort(
      (a, b) => (b.sim.xpDelta - b.sim.riskPointsDelta) - (a.sim.xpDelta - a.sim.riskPointsDelta),
    )[0];
    for (const pick of bestSingle.sim.resultingTeam.players) {
      if (pick.playerId === bestSingle.moves[0].inId) continue;
      const target = scoredById.get(pick.playerId);
      if (!target) continue;
      const replacements = findReplacements(target, pool, bestSingle.sim.resultingTeam, rules, lookup, 1, PATH_CANDIDATES_PER_SLOT);
      for (const r of replacements) {
        const moves = [
          ...bestSingle.moves,
          { outId: pick.playerId, inId: r.player.id, outName: target.webName, inName: r.player.webName },
        ];
        const sim = simulate(moves.map((m) => ({ outId: m.outId, inId: m.inId })));
        if (!sim.legal) continue;
        baskets.push({ moves, sim });
      }
    }
  }

  return { baskets, simCount };
}

interface SimDeps {
  scoredById: Map<number, ScoredPlayer>;
  lookup: (playerId: number) => PlayerMeta | undefined;
  xpOf: (playerId: number) => HorizonXp | undefined;
  isPenaltyTaker: (playerId: number) => boolean;
}

/** Wildcard / Free Hit at `event`, forced by the plan. */
function forcedChipStep(
  event: number,
  chip: "wildcard" | "freehit",
  team: TeamState,
  freeTransfers: number,
  ctx: RebuildContext,
  deps: SimDeps,
  windowEnd: number,
  baselineEventXp: (fielded: SquadPick[], captain: number | null, vice: number | null, event: number) => number,
): TransferPathStep {
  const rebuild = chip === "wildcard" ? wildcardRebuildAt(ctx, event, windowEnd) : freeHitRebuildAt(ctx, event);

  if (rebuild.valuation.blocked) {
    return {
      event,
      moves: [],
      simulation: null,
      chip,
      fieldedPicks: team.players,
      freeTransfersBefore: freeTransfers,
      freeTransfersAfter: accrueFreeTransfers(freeTransfers, 0),
      eventXp: 0,
      chipBonus: 0,
      pointsCost: 0,
      riskPointsDelta: 0,
      decisionMargin: 0,
      explanation: [rebuild.valuation.blocked],
    };
  }

  // `ScoredPlayer` already carries `elementType`, so pairing needs no lookup.
  const elementTypeById = new Map(ctx.pool.map((p) => [p.id, p.elementType]));
  const moves = pairRebuild(team.players, rebuild.picks, (id) => elementTypeById.get(id));

  const evXp = baselineEventXp(rebuild.picks, rebuild.captain, rebuild.vice, event);

  if (chip === "freehit") {
    // Reverts — the carried state (and free-transfer count) is untouched.
    return {
      event,
      moves,
      simulation: null,
      chip,
      fieldedPicks: rebuild.picks,
      freeTransfersBefore: freeTransfers,
      freeTransfersAfter: accrueFreeTransfers(freeTransfers, 0),
      eventXp: evXp,
      chipBonus: 0,
      pointsCost: 0,
      riskPointsDelta: 0,
      decisionMargin: 0,
      explanation: [...rebuild.valuation.explanation],
    };
  }

  // Wildcard: a permanent, free rebuild. `freeTransfers` keeps accruing —
  // it is not spent by the chip (Phase 2 finding: real FPL carries banked
  // transfers across a wildcard, it does not reset them).
  const sim = simulateTransfers({
    team,
    moves,
    freeTransfers: moves.length,
    scoredById: deps.scoredById,
    isPenaltyTaker: deps.isPenaltyTaker,
    lookup: deps.lookup,
    xpOf: deps.xpOf,
    availabilityOf: ctx.availabilityOf,
    rules: ctx.rules,
    horizon: 1,
  });

  if (!sim.legal) {
    return {
      event,
      moves: [],
      simulation: null,
      chip,
      fieldedPicks: team.players,
      freeTransfersBefore: freeTransfers,
      freeTransfersAfter: accrueFreeTransfers(freeTransfers, 0),
      eventXp: 0,
      chipBonus: 0,
      pointsCost: 0,
      riskPointsDelta: 0,
      decisionMargin: 0,
      explanation: [sim.problems[0] ?? "The rebuilt squad is not legal."],
    };
  }

  return {
    event,
    moves,
    simulation: sim,
    chip,
    fieldedPicks: rebuild.picks,
    freeTransfersBefore: freeTransfers,
    freeTransfersAfter: accrueFreeTransfers(freeTransfers, 0),
    eventXp: evXp,
    // A Wildcard's own gameweek never carries a Bench Boost / Triple Captain
    // bonus too — `validateChipPlan` already rejects two chips in one
    // gameweek, so there is nothing for `chipBonusOf` to compute here.
    chipBonus: 0,
    pointsCost: 0,
    riskPointsDelta: sim.riskPointsDelta,
    decisionMargin: 0,
    explanation: [...rebuild.valuation.explanation, "Free transfers keep accruing across a Wildcard — it does not spend the bank."],
  };
}
