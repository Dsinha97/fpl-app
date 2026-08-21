// Sprint 9 — Transfer Optimizer.
//
// Sprint 8 answers "what would these transfers buy?". This answers the question
// FPL actually asks every week: roll the free transfer, spend one, spend two,
// take a hit, or wildcard.
//
// ---------------------------------------------------------------------------
// Why the roadmap's formula cannot be implemented literally
//
// The plan states the decision as
//
//     TransferValue = ExpectedGain - TransferCost - Risk
//     RollValue     = FutureFlexibility + ExpectedFutureGain
//
// Against this app's data, roll can never win. The xP projection is frozen: the
// same eight gameweeks of per-player xP are visible this week and next. So
// whatever the best basket is next week is available now too, and doing it now
// collects one extra gameweek of the same gain. A literal implementation
// recommends "transfer" every single week, and the tempting fix — tuning
// FutureFlexibility upward until roll sometimes wins — is a fudge factor
// masquerading as a model.
//
// So rolling is priced from the reasons that are genuinely computable, and the
// reason that is not is made an explicit input rather than hidden in a score:
//
//   1. Banking to two funds a basket you cannot do as two singles. A funding
//      chain — sell two mid-price players to afford one premium — is often
//      unaffordable when split across two gameweeks. Computed, via the same
//      simulator the manual basket uses.
//   2. Two free transfers next week avoid a -4 this week. Computed: four points
//      traded against one gameweek of the gain.
//   3. News, injuries and price moves not yet known. NOT derivable from a frozen
//      projection. It becomes `decisionMargin`, a visible input labelled as an
//      assumption, never folded silently into the net.
//
// The cost of waiting is exact rather than approximated. A basket played next
// gameweek forfeits precisely this gameweek's share of its gain, which
// `projectAtEvent` computes from the per-gameweek prediction series — not as
// gain x (H-1)/H, which would misprice a blank or a double.
// ---------------------------------------------------------------------------

import { findReplacements, type ScoredPlayer } from "./scoring";
import { optimizeSquad, suggestArmband, type OptimizerPlayer } from "./optimizer";
import { freeHitRebuildAt, type RebuildContext } from "./chips";
import { CHIP_LABELS, type ChipContext, type PredAt } from "./chip-plan";
import {
  HIT_COST,
  MAX_FREE_TRANSFERS,
  accrueFreeTransfers,
  simulateTransfers,
  type SimulateInput,
  type TransferMove,
  type TransferSimulation,
} from "./transfers";
import {
  horizonLength,
  projectAtEvent,
  projectionAtEvent,
  type ChipKind,
  type Horizon,
  type HorizonXp,
  type PlayerMeta,
  type SquadPick,
  type SquadRules,
  type TeamState,
  type XpByEvent,
} from "./team-state";

// `XpByEvent`, `projectionAtEvent` and `projectAtEvent` live in team-state.ts
// now — they mirror `computeProjection`, which is declared there — and are
// re-exported here so every existing import path keeps compiling.
export { projectAtEvent, projectionAtEvent, type XpByEvent };

/**
 * Deepest basket the search will build.
 *
 * Three is not arbitrary: the branches need at most free transfers + 2, the hit
 * branch is skipped once three transfers are free anyway, and a fourth level of
 * beam costs roughly as much as the first three combined for baskets no manager
 * plays outside a wildcard — which has its own branch.
 */
export const MAX_BASKET = 3;

/** Replacements considered per squad slot, from `findReplacements`. */
const CANDIDATES_PER_SLOT = 5;

/** Baskets carried forward per depth, ranked by gain. */
const BEAM_WIDTH = 8;

/**
 * Extra baskets carried forward per depth ranked by *cash freed* rather than by
 * gain.
 *
 * Without this the search cannot find a funding chain, which is the whole point
 * of the roll branch. Selling a premium to afford an upgrade elsewhere scores
 * badly as a standalone move, so a beam ranked only by gain prunes the first leg
 * before the second leg can pay for it — the same failure mode as the squad
 * optimiser's reserve floor.
 */
const FUNDER_WIDTH = 4;

/**
 * Assumed points value of waiting a week for news, when the caller does not say.
 *
 * A judgement call, not a measurement — roughly what a gameweek of press
 * conferences, price moves and injury updates is worth on a mid-price pick. It
 * is surfaced as its own term everywhere it is used so a reader can disagree
 * with it, and set it to zero to see the pure arithmetic.
 */
export const DEFAULT_DECISION_MARGIN = 1;

export type BranchKind = "roll" | "transfers" | "hit" | "wildcard" | "freehit";

export interface Branch {
  kind: BranchKind;
  label: string;
  /** Empty for roll — nothing is done this gameweek. */
  moves: TransferMove[];
  simulation: TransferSimulation | null;
  /** xP change over the horizon, already discounted for a rolled basket. */
  xpGain: number;
  pointsCost: number;
  riskPointsDelta: number;
  /** Kept separate from the net so an assumption is never mistaken for a result. */
  assumedNewsValue: number;
  /** The ranked quantity: xpGain - pointsCost - riskPointsDelta + assumedNewsValue. */
  net: number;
  explanation: string[];
  /** Why this option is unavailable, when it is. */
  blocked: string | null;
}

export interface OptimizerResult {
  /** Best first. Blocked branches sort last but are kept, so nothing vanishes. */
  branches: Branch[];
  recommended: Branch | null;
  runnerUp: Branch | null;
  confidence: "high" | "medium" | "low";
  confidenceReason: string;
  /** True when no option pays for itself and the honest answer is to hold. */
  holdIsBest: boolean;
  /** Free transfers carried into the next gameweek if nothing is spent now. */
  accruedFreeTransfers: number;
  note: string;
}

export interface WildcardWindow {
  available: boolean;
  /** Shown when unavailable — "No wildcard until GW2". */
  reason: string | null;
}

export interface OptimizeTransfersInput {
  team: TeamState;
  /** Every selectable player, for candidate generation. */
  pool: ScoredPlayer[];
  scoredById: Map<number, ScoredPlayer>;
  lookup: (playerId: number) => PlayerMeta | undefined;
  xpOf: (playerId: number) => HorizonXp | undefined;
  availabilityOf: (playerId: number) => number;
  isPenaltyTaker: (playerId: number) => boolean;
  /** Per-gameweek predictions, which is what prices the roll branch. */
  seriesOf: (playerId: number) => XpByEvent | undefined;
  rules: SquadRules;
  horizon: Horizon;
  /** Free transfers available for this gameweek. */
  freeTransfers: number;
  /** The gameweek being decided. */
  event: number;
  wildcard: WildcardWindow;
  decisionMargin?: number;
  /**
   * The chip plan resolved for this horizon window — see
   * `chipContextFor` (lib/chip-plan.ts). The caller resolves the window
   * because only it knows `seasonWindow`; absent means no chip plan touches
   * this window, and every branch behaves exactly as it did before this
   * field existed.
   */
  chip?: ChipContext;
  /** Needed only when `chip` is set — bench-boost/triple-captain bonuses and the Free Hit rebuild both read per-event predictions. */
  predAt?: PredAt;
}

export const TRANSFER_OPTIMIZER_NOTE =
  "The projection is frozen: the same eight gameweeks are visible now and next week, so rolling is " +
  "priced only from what can be computed — banking a second free transfer to fund a move you cannot " +
  "split across two weeks, and avoiding a hit. The value of waiting for news is the assumption " +
  "shown in the Roll row, not a modelled quantity; set it to zero to see the arithmetic alone. " +
  "Multi-gameweek transfer scheduling is not covered — a chip plan changes what each branch's own " +
  "horizon is worth, but every branch is still a single decision at this gameweek. The wildcard row does not " +
  "re-optimise the armband — so its gain is understated, never inflated.";

// ---------------------------------------------------------------- the search

interface Basket {
  moves: TransferMove[];
  sim: TransferSimulation;
  /** Ranked on gain net of risk; the hit is a per-branch matter, not a search one. */
  score: number;
}

const signature = (moves: TransferMove[]) =>
  moves
    .map((m) => `${m.outId}>${m.inId}`)
    .sort()
    .join("|");

/** The `SimulateInput.chip` block, built once per call — `undefined` when there is nothing to thread, so an untouched build stays byte-identical. */
function chipSimOf(input: OptimizeTransfersInput): SimulateInput["chip"] {
  return input.chip && input.predAt
    ? { context: input.chip, predAt: input.predAt, seriesOf: input.seriesOf }
    : undefined;
}

/** The chip forced at `event` by the plan (a wildcard or free hit landing exactly there), or null. */
function chipForcedAt(chip: ChipContext | undefined, event: number): ChipKind | null {
  return chip?.excluded.find((x) => x.event === event)?.chip ?? null;
}

/**
 * "Bench Boost GW5, Wildcard GW8" — the plan's own gameweeks, deduplicated
 * from `ChipContext`'s expanded form (a wildcard's mask spans every event
 * from its own through the window end; this reports only the origin).
 */
function summarizeChipPlan(chip: ChipContext | undefined): string | null {
  if (!chip) return null;
  const origins = new Map<ChipKind, number>();
  for (const b of chip.bonus) origins.set(b.chip, b.event);
  const wildcardEvents = chip.excluded.filter((e) => e.chip === "wildcard").map((e) => e.event);
  if (wildcardEvents.length > 0) origins.set("wildcard", Math.min(...wildcardEvents));
  const freehit = chip.excluded.find((e) => e.chip === "freehit");
  if (freehit) origins.set("freehit", freehit.event);
  if (origins.size === 0) return null;
  return [...origins.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([chipKind, event]) => `${CHIP_LABELS[chipKind]} GW${event}`)
    .join(", ");
}

/**
 * Best legal basket at each size from 1 to `MAX_BASKET`, by beam search.
 *
 * Exhaustive is out of reach — one move is ninety candidates, two is forty
 * million. So candidates come from `findReplacements`, which is already
 * squad-aware, and every surviving basket is scored by the real
 * `simulateTransfers`. Nothing here re-implements the scoring: a recommendation
 * the manual simulator contradicts would be worse than no recommendation.
 */
function searchBaskets(input: OptimizeTransfersInput): Map<number, Basket> {
  const { team, pool, scoredById, lookup, rules, horizon } = input;
  const chip = chipSimOf(input);

  const simulate = (moves: TransferMove[]): TransferSimulation =>
    simulateTransfers({
      team,
      moves,
      // The search ranks on gain alone; each branch applies its own hit, so the
      // hit must not also be baked in here or it would be charged twice.
      freeTransfers: moves.length,
      scoredById,
      isPenaltyTaker: input.isPenaltyTaker,
      lookup,
      xpOf: input.xpOf,
      availabilityOf: input.availabilityOf,
      rules,
      horizon,
      chip,
    });

  const best = new Map<number, Basket>();
  let frontier: Basket[] = [];

  for (let depth = 1; depth <= MAX_BASKET; depth++) {
    // Depth one extends the untouched squad; deeper levels extend the survivors.
    const parents: { team: TeamState; moves: TransferMove[] }[] =
      depth === 1
        ? [{ team, moves: [] }]
        : frontier.map((b) => ({ team: b.sim.resultingTeam, moves: b.moves }));

    const seen = new Set<string>();
    const grown: Basket[] = [];

    for (const parent of parents) {
      const alreadyIn = new Set(parent.moves.map((m) => m.inId));

      for (const pick of parent.team.players) {
        // Selling a player this same basket just bought is legal but never
        // useful, and it makes the explanation nonsense.
        if (alreadyIn.has(pick.playerId)) continue;

        const target = scoredById.get(pick.playerId);
        if (!target) continue;

        const replacements = findReplacements(
          target,
          pool,
          parent.team,
          rules,
          lookup,
          horizon,
          CANDIDATES_PER_SLOT,
        );

        for (const replacement of replacements) {
          const moves = [...parent.moves, { outId: pick.playerId, inId: replacement.player.id }];
          const key = signature(moves);
          if (seen.has(key)) continue;
          seen.add(key);

          const sim = simulate(moves);
          if (!sim.legal || sim.moves.length !== depth) continue;

          grown.push({ moves, sim, score: sim.xpDelta - sim.riskPointsDelta });
        }
      }
    }

    if (grown.length === 0) break;

    // Deterministic throughout: the same squad must always produce the same
    // recommendation, so ties fall back to spend and then to the signature.
    const byScore = [...grown].sort(
      (a, b) => b.score - a.score || a.sim.after.bank - b.sim.after.bank || compareKey(a, b),
    );
    best.set(depth, byScore[0]);

    // Carry the funders as well as the winners — see FUNDER_WIDTH.
    const carried = byScore.slice(0, BEAM_WIDTH);
    const carriedKeys = new Set(carried.map((b) => signature(b.moves)));
    const funders = [...grown]
      .sort((a, b) => b.sim.after.bank - a.sim.after.bank || b.score - a.score || compareKey(a, b))
      .filter((b) => !carriedKeys.has(signature(b.moves)))
      .slice(0, FUNDER_WIDTH);

    frontier = [...carried, ...funders];
  }

  return best;
}

const compareKey = (a: Basket, b: Basket) =>
  signature(a.moves) < signature(b.moves) ? -1 : signature(a.moves) > signature(b.moves) ? 1 : 0;

// ------------------------------------------------------------ wildcard branch

/** ScoredPlayer is a superset of what the squad optimiser needs. */
function toOptimizerPlayer(p: ScoredPlayer): OptimizerPlayer {
  return {
    id: p.id,
    elementType: p.elementType,
    teamId: p.teamId,
    price: p.price,
    xp: p.xp,
    ownership: p.ownership,
    // The optimiser gates on status and chance-of-playing; ScoredPlayer has
    // already folded both into `availability`, so reconstruct the pair from it
    // rather than threading two more fields through every caller.
    status: p.availability >= 1 ? "a" : p.availability > 0 ? "d" : "u",
    chanceNextRound: Math.round(p.availability * 100),
    xpLower: p.xpLower,
    reliability: p.reliability,
  };
}

/**
 * Express a rebuilt squad as out/in pairs FPL would accept.
 *
 * A wildcard is not really a set of transfers, but the basket, the simulator and
 * Apply all speak in pairs — and since both squads satisfy the same position
 * quota, a like-for-like pairing always exists. Exported for `lib/transfer-path.ts`,
 * which pairs a Wildcard/Free Hit rebuild the same way at a future gameweek.
 */
export function pairRebuild(
  before: SquadPick[],
  after: SquadPick[],
  positionOf: (playerId: number) => number | undefined,
): TransferMove[] {
  const afterIds = new Set(after.map((p) => p.playerId));
  const beforeIds = new Set(before.map((p) => p.playerId));

  const outsByType = new Map<number, number[]>();
  const insByType = new Map<number, number[]>();

  const push = (map: Map<number, number[]>, type: number | undefined, id: number) => {
    if (type === undefined) return;
    const list = map.get(type);
    if (list) list.push(id);
    else map.set(type, [id]);
  };

  for (const pick of before) {
    if (!afterIds.has(pick.playerId)) push(outsByType, positionOf(pick.playerId), pick.playerId);
  }
  for (const pick of after) {
    if (!beforeIds.has(pick.playerId)) push(insByType, positionOf(pick.playerId), pick.playerId);
  }

  const moves: TransferMove[] = [];
  for (const [type, outs] of outsByType) {
    const ins = insByType.get(type) ?? [];
    for (let i = 0; i < Math.min(outs.length, ins.length); i++) {
      moves.push({ outId: outs[i], inId: ins[i] });
    }
  }
  return moves;
}

// ----------------------------------------------------------------- branches

function branchFor(
  kind: BranchKind,
  label: string,
  basket: Basket | undefined,
  input: OptimizeTransfersInput,
  freeTransfers: number,
): Branch | null {
  if (!basket) return null;

  // Re-scored with the branch's real free-transfer count, so `pointsCost` comes
  // from the simulator rather than from a second copy of the hit arithmetic.
  const sim = simulateTransfers({
    team: input.team,
    moves: basket.moves,
    freeTransfers,
    scoredById: input.scoredById,
    isPenaltyTaker: input.isPenaltyTaker,
    lookup: input.lookup,
    xpOf: input.xpOf,
    availabilityOf: input.availabilityOf,
    rules: input.rules,
    horizon: input.horizon,
    chip: chipSimOf(input),
  });

  return {
    kind,
    label,
    moves: basket.moves,
    simulation: sim,
    xpGain: sim.xpDelta,
    pointsCost: sim.cost.pointsCost,
    riskPointsDelta: sim.riskPointsDelta,
    assumedNewsValue: 0,
    net: sim.transferGain,
    explanation: describe(sim, input),
    blocked: null,
  };
}

function describe(sim: TransferSimulation, input: OptimizeTransfersInput): string[] {
  const out: string[] = [];

  for (const move of sim.moves) {
    const cash =
      move.cashFreed > 0
        ? `frees £${(move.cashFreed / 10).toFixed(1)}m`
        : move.cashFreed < 0
          ? `costs £${(-move.cashFreed / 10).toFixed(1)}m`
          : "price-neutral";
    out.push(
      `${move.outName} → ${move.inName}: ${signed(move.xpDelta)} xP, ${cash}`,
    );
  }

  if (sim.cost.hits > 0) {
    out.push(
      `${sim.cost.hits} transfer${sim.cost.hits === 1 ? "" : "s"} beyond your free ${
        sim.cost.freeTransfers === 1 ? "one" : sim.cost.freeTransfers
      } — that is the ${sim.cost.pointsCost}-point hit.`,
    );
  }
  if (sim.armbandNote) out.push(sim.armbandNote);
  if (input.horizon === 1) {
    out.push("Judged over one gameweek only — widen the horizon to value the fixtures beyond it.");
  }

  return out;
}

const signed = (v: number, digits = 1) => `${v >= 0 ? "+" : ""}${v.toFixed(digits)}`;

// ------------------------------------------------------------------- entry

export function optimizeTransfers(input: OptimizeTransfersInput): OptimizerResult {
  const { freeTransfers, horizon } = input;
  const decisionMargin = input.decisionMargin ?? DEFAULT_DECISION_MARGIN;
  const ft = Math.max(0, Math.min(MAX_FREE_TRANSFERS, freeTransfers));
  const accrued = accrueFreeTransfers(ft, 0);

  const baskets = searchBaskets(input);
  const branches: Branch[] = [];

  // A wildcard planned for exactly this gameweek makes every paid transfer
  // pointless — the wildcard rebuild is free however many players change, so
  // spending a free transfer or taking a hit is never correct here. The
  // branches stay visible (blocked, not removed) so the reason is legible.
  const forcedChip = chipForcedAt(input.chip, input.event);
  const wildcardForcedReason =
    forcedChip === "wildcard"
      ? `A Wildcard is planned for GW${input.event} — every move is free that gameweek, so this option is never the right one. See the Wildcard branch instead.`
      : null;
  const forceBlocked = (branch: Branch): Branch =>
    wildcardForcedReason ? { ...branch, blocked: wildcardForcedReason } : branch;

  // --- spend free transfers, no hit
  for (let k = 1; k <= Math.min(ft, MAX_BASKET); k++) {
    const branch = branchFor(
      "transfers",
      k === 1 ? "1 transfer" : `${k} transfers`,
      baskets.get(k),
      input,
      ft,
    );
    if (branch) branches.push(forceBlocked(branch));
  }

  // --- take a hit. Pointless once three transfers are already free: the extra
  //     move costs four points and the search does not build baskets that deep.
  if (ft < MAX_BASKET) {
    for (let k = ft + 1; k <= Math.min(ft + 2, MAX_BASKET); k++) {
      const hit = (k - ft) * HIT_COST;
      const branch = branchFor(
        "hit",
        `${k} transfers (−${hit})`,
        baskets.get(k),
        input,
        ft,
      );
      if (branch) branches.push(forceBlocked(branch));
    }
  }

  // --- roll
  branches.push(forceBlocked(rollBranch(input, ft, accrued, baskets, decisionMargin)));

  // --- wildcard
  branches.push(wildcardBranch(input));

  // --- free hit (only appears when the plan pins it to this exact gameweek)
  const freeHit = freeHitBranch(input);
  if (freeHit) branches.push(freeHit);

  const playable = branches.filter((b) => b.blocked === null);
  const ranked = [...playable].sort((a, b) => b.net - a.net || a.moves.length - b.moves.length);
  const blocked = branches.filter((b) => b.blocked !== null);

  const recommended = ranked[0] ?? null;
  const runnerUp = ranked[1] ?? null;

  // "Hold" is the honest answer when nothing you could do *this* week pays for
  // itself. Judged on the acting branches alone: the roll branch always carries
  // the declared news assumption, so including it would let an assumption argue
  // that action is worthwhile.
  const acting = playable.filter((b) => b.kind !== "roll" && b.moves.length > 0);
  const holdIsBest = acting.length === 0 || acting.every((b) => b.net <= 0);

  const missing = recommended?.simulation?.after.projection.missing ?? 0;
  const margin = recommended && runnerUp ? recommended.net - runnerUp.net : Infinity;

  let confidence: OptimizerResult["confidence"] = "medium";
  let confidenceReason = `${margin.toFixed(1)} points clear of the next option.`;
  if (missing > 0) {
    confidence = "low";
    confidenceReason = `${missing} pick${missing === 1 ? " has" : "s have"} no xP projection, so the resulting squad's total is understated.`;
  } else if (margin < 1) {
    confidence = "low";
    confidenceReason = `Only ${margin.toFixed(1)} points separate the top two options — treat them as equivalent.`;
  } else if (margin > 3) {
    confidence = "high";
  }
  if (horizon === 1) {
    confidenceReason += " Judged over a single gameweek.";
  }
  const chipSummary = summarizeChipPlan(input.chip);
  if (chipSummary) {
    confidenceReason += ` Conditioned on your chip plan: ${chipSummary}.`;
  }

  return {
    branches: [...ranked, ...blocked],
    recommended,
    runnerUp,
    confidence,
    confidenceReason,
    holdIsBest,
    accruedFreeTransfers: accrued,
    note: TRANSFER_OPTIMIZER_NOTE,
  };
}

/**
 * Do nothing this gameweek, and play the banked transfers next.
 *
 * The gain is the basket's horizon gain minus this gameweek's share of it, which
 * is what waiting actually costs. Everything beyond that arithmetic is the
 * declared `decisionMargin`.
 */
function rollBranch(
  input: OptimizeTransfersInput,
  ft: number,
  accrued: number,
  baskets: Map<number, Basket>,
  decisionMargin: number,
): Branch {
  const size = Math.min(accrued, MAX_BASKET);
  const basket = baskets.get(size);
  const label = accrued > ft ? `Roll to ${accrued} free transfers` : "Hold";
  const explanation: string[] = [];

  if (accrued === ft) {
    explanation.push(
      `You already hold the maximum ${MAX_FREE_TRANSFERS} free transfers, so rolling banks nothing.`,
    );
  }

  if (!basket) {
    explanation.push("Nothing legal and affordable to do next gameweek either.");
    return {
      kind: "roll",
      label,
      moves: [],
      simulation: null,
      xpGain: 0,
      pointsCost: 0,
      riskPointsDelta: 0,
      assumedNewsValue: decisionMargin,
      net: decisionMargin,
      explanation,
      blocked: null,
    };
  }

  // A Wildcard planned for exactly next gameweek overwrites whatever this
  // basket would be — `basket.sim.xpDelta` is already the chip-masked
  // 5-gameweek delta of *that* squad, which the ordinary forfeit arithmetic
  // below would then subtract *again* (both terms land on the same masked
  // gameweek), reading as ~0 for the wrong reason. Say so directly instead:
  // rolling costs nothing because there is no coherent "next week's basket"
  // once the wildcard rebuild lands there.
  if (chipForcedAt(input.chip, input.event + 1) === "wildcard") {
    explanation.push(
      `A Wildcard is planned for GW${input.event + 1} — it overwrites whatever squad you'd have by then, so there is no basket to price rolling into.`,
    );
    return {
      kind: "roll",
      label,
      moves: [],
      simulation: null,
      xpGain: 0,
      pointsCost: 0,
      riskPointsDelta: 0,
      assumedNewsValue: decisionMargin,
      net: decisionMargin,
      explanation,
      blocked: null,
    };
  }

  const forfeited =
    projectAtEvent(
      basket.sim.resultingTeam.players,
      input.seriesOf,
      input.availabilityOf,
      basket.sim.resultingTeam.captain,
      basket.sim.resultingTeam.viceCaptain,
      input.event,
    ) -
    projectAtEvent(
      input.team.players,
      input.seriesOf,
      input.availabilityOf,
      input.team.captain,
      input.team.viceCaptain,
      input.event,
    );

  const xpGain = basket.sim.xpDelta - forfeited;
  const net = xpGain - basket.sim.riskPointsDelta + decisionMargin;

  const names = basket.sim.moves.map((m) => `${m.outName} → ${m.inName}`).join(", ");
  if (size > ft) {
    explanation.push(
      `Waiting buys ${size} free transfer${size === 1 ? "" : "s"} for GW${input.event + 1}, enough for ${names} with no hit.`,
    );
  } else {
    explanation.push(`Next gameweek's best move with ${size} free transfer${size === 1 ? "" : "s"}: ${names}.`);
  }
  explanation.push(
    `Playing it a week later forfeits GW${input.event}'s ${forfeited.toFixed(1)} xP of the gain.`,
  );
  if (horizonLength(input.horizon) <= 1) {
    explanation.push(
      "Over a one-gameweek horizon a rolled transfer earns nothing at all — the whole window is the week you skipped.",
    );
  }

  return {
    kind: "roll",
    label,
    moves: [],
    simulation: basket.sim,
    xpGain,
    pointsCost: 0,
    riskPointsDelta: basket.sim.riskPointsDelta,
    assumedNewsValue: decisionMargin,
    net,
    explanation,
    blocked: null,
  };
}

function wildcardBranch(input: OptimizeTransfersInput): Branch {
  const base: Branch = {
    kind: "wildcard",
    label: "Wildcard",
    moves: [],
    simulation: null,
    xpGain: 0,
    pointsCost: 0,
    riskPointsDelta: 0,
    assumedNewsValue: 0,
    net: 0,
    explanation: [],
    blocked: null,
  };

  const forcedChip = chipForcedAt(input.chip, input.event);
  if (forcedChip && forcedChip !== "wildcard") {
    return { ...base, blocked: `${CHIP_LABELS[forcedChip]} is planned for GW${input.event} instead of a Wildcard.` };
  }
  const bonusHere = input.chip?.bonus.find((b) => b.event === input.event)?.chip ?? null;
  if (bonusHere) {
    return { ...base, blocked: `${CHIP_LABELS[bonusHere]} is planned for GW${input.event} instead of a Wildcard.` };
  }
  // `chip.excluded` fans a plan's wildcard out across every event from its own
  // through the window end (chipContextFor, lib/chip-plan.ts), so the origin
  // gameweek is the *earliest* wildcard-tagged entry, not just any entry that
  // isn't this event — otherwise the wildcard's own gameweek would see its own
  // forward shadow and wrongly block itself.
  const wildcardEvents = input.chip?.excluded.filter((x) => x.chip === "wildcard").map((x) => x.event) ?? [];
  const wildcardOrigin = wildcardEvents.length > 0 ? Math.min(...wildcardEvents) : null;
  if (wildcardOrigin !== null && wildcardOrigin !== input.event) {
    return { ...base, blocked: `A Wildcard is already planned for GW${wildcardOrigin} in this window.` };
  }

  if (!input.wildcard.available) {
    return { ...base, blocked: input.wildcard.reason ?? "Wildcard unavailable." };
  }
  if (input.team.activeChip && input.team.activeChip !== "wildcard") {
    return { ...base, blocked: `This draft already has the ${input.team.activeChip} chip active.` };
  }

  const optimizerPool = input.pool.map(toOptimizerPlayer);
  const byId = new Map(optimizerPool.map((p) => [p.id, p]));

  const rebuild = optimizeSquad({
    pool: optimizerPool,
    rules: input.rules,
    locked: [],
    horizon: input.horizon,
    strategy: "max_points",
    risk: "medium",
  });

  if (rebuild.error || rebuild.picks.length !== input.rules.squadSize) {
    return {
      ...base,
      blocked: rebuild.error ?? "Could not build a legal squad from scratch.",
    };
  }

  const moves = pairRebuild(input.team.players, rebuild.picks, (id) =>
    byId.get(id)?.elementType,
  );

  if (moves.length === 0) {
    return {
      ...base,
      explanation: ["Your squad already is the optimiser's squad — a wildcard would change nothing."],
    };
  }

  // A wildcard costs no points however many moves it makes.
  const sim = simulateTransfers({
    team: input.team,
    moves,
    freeTransfers: moves.length,
    scoredById: input.scoredById,
    isPenaltyTaker: input.isPenaltyTaker,
    lookup: input.lookup,
    xpOf: input.xpOf,
    availabilityOf: input.availabilityOf,
    rules: input.rules,
    horizon: input.horizon,
    chip: chipSimOf(input),
  });

  if (!sim.legal) {
    return { ...base, blocked: sim.problems[0] ?? "The rebuilt squad is not legal." };
  }

  const armband = suggestArmband(rebuild.picks, byId, input.horizon);
  const keepsArmband = sim.resultingTeam.captain === armband.captain;

  const explanation = [
    `${moves.length} change${moves.length === 1 ? "" : "s"}, no points hit.`,
    ...(rebuild.lowReliability > 0
      ? [`${rebuild.lowReliability} of the rebuilt picks are projected mostly from a position/price prior rather than a Premier League record.`]
      : []),
    ...(keepsArmband
      ? []
      : [
          `The armband is not re-optimised here — on this squad it would move to ${
            input.scoredById.get(armband.captain ?? -1)?.webName ?? "another player"
          }, so the gain shown is understated.`,
        ]),
  ];

  return {
    ...base,
    moves,
    simulation: sim,
    xpGain: sim.xpDelta,
    pointsCost: 0,
    riskPointsDelta: sim.riskPointsDelta,
    net: sim.xpDelta - sim.riskPointsDelta,
    explanation,
  };
}

// ------------------------------------------------------------ free hit branch

/**
 * Only appears when the chip plan pins Free Hit to this exact gameweek —
 * modelled on `wildcardBranch`, but the rebuild is `freeHitRebuildAt`
 * (lib/chips.ts), which values one gameweek and reverts, not a permanent
 * squad change. `net`/`xpGain` are that one gameweek's gain, stated as such
 * in the explanation, never treated as a horizon figure.
 */
function freeHitBranch(input: OptimizeTransfersInput): Branch | null {
  if (chipForcedAt(input.chip, input.event) !== "freehit" || !input.predAt) return null;

  const base: Branch = {
    kind: "freehit",
    label: "Free Hit",
    moves: [],
    simulation: null,
    xpGain: 0,
    pointsCost: 0,
    riskPointsDelta: 0,
    assumedNewsValue: 0,
    net: 0,
    explanation: [],
    blocked: null,
  };

  const ctx: RebuildContext = {
    team: input.team,
    pool: input.pool,
    rules: input.rules,
    predAt: input.predAt,
    availabilityOf: input.availabilityOf,
  };
  const rebuild = freeHitRebuildAt(ctx, input.event);

  if (rebuild.valuation.blocked) {
    return { ...base, blocked: rebuild.valuation.blocked };
  }

  const byId = new Map(input.pool.map((p) => [p.id, p]));
  const moves = pairRebuild(input.team.players, rebuild.picks, (id) => byId.get(id)?.elementType);

  if (moves.length === 0) {
    return {
      ...base,
      explanation: ["Your squad already is the Free Hit optimiser's squad — nothing would change."],
    };
  }

  return {
    ...base,
    moves,
    xpGain: rebuild.valuation.gain,
    pointsCost: 0,
    riskPointsDelta: 0,
    net: rebuild.valuation.gain,
    explanation: [
      ...rebuild.valuation.explanation,
      "In real FPL this squad reverts automatically after the gameweek — loading these moves here would apply them as a permanent change instead, so treat this as the picks to consider rather than a basket to apply.",
    ],
  };
}
