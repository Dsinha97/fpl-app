import type { SquadPick, SquadRules } from "./team-state";

// Squad optimiser (Sprint 2).
//
// Builds a legal 15 that maximises a strategy-weighted score subject to the
// season's real constraints: squad size, per-position quotas, club limit, and
// budget.
//
// This is a greedy fill with a budget reserve, followed by a bounded swap
// pass. A true integer program would be optimal, but greedy-plus-swaps lands
// close, runs in milliseconds on a 564-player pool, and — importantly — stays
// readable enough to debug when it picks something strange.

// Horizon lives in team-state, alongside the projection maths that consumes it;
// re-exported here so optimiser callers need only one import.
export type { Horizon } from "./team-state";
import type { Horizon } from "./team-state";

export type Strategy = "max_points" | "balanced" | "value" | "differential";
export type RiskLevel = "low" | "medium" | "high";

export interface OptimizerPlayer {
  id: number;
  elementType: number;
  teamId: number;
  price: number;
  /** Horizon totals from player_xp_horizons; null when the model abstained. */
  xp: Record<Horizon, number | null>;
  ownership: number | null;
  status: string | null;
  chanceNextRound: number | null;
}

export interface OptimizeInput {
  pool: OptimizerPlayer[];
  rules: SquadRules;
  /** Picks the user has already made; these are never removed. */
  locked: SquadPick[];
  horizon: Horizon;
  strategy: Strategy;
  risk: RiskLevel;
}

export interface OptimizeResult {
  picks: SquadPick[];
  filled: number;
  totalScore: number;
  /** Set when the optimiser could not complete a legal squad. */
  error: string | null;
  /** Picks with no model prediction, taken only as budget enablers. */
  withoutXp: number;
}

export const STRATEGY_LABELS: Record<Strategy, string> = {
  max_points: "Maximum points",
  balanced: "Balanced",
  value: "Value",
  differential: "Differential",
};

export const RISK_LABELS: Record<RiskLevel, string> = {
  low: "Low — fully fit only",
  medium: "Medium — 75%+ likely",
  high: "High — anyone",
};

function availability(p: OptimizerPlayer): number {
  if (p.chanceNextRound !== null && p.chanceNextRound !== undefined) {
    return Math.max(0, Math.min(1, p.chanceNextRound / 100));
  }
  return p.status === "a" ? 1 : 0;
}

function passesRisk(p: OptimizerPlayer, risk: RiskLevel): boolean {
  const a = availability(p);
  if (risk === "low") return p.status === "a" && a >= 1;
  if (risk === "medium") return a >= 0.75;
  return a > 0;
}

/**
 * What a finished squad is judged on. All variants start from horizon xP; they
 * differ in how they trade raw points against price and ownership.
 *
 * This is the objective the swap and funded-upgrade passes maximise. It is
 * deliberately *not* the order the greedy fill takes players in — see
 * `fillScoreOf`.
 */
function scoreOf(p: OptimizerPlayer, horizon: Horizon, strategy: Strategy): number {
  const xp = p.xp[horizon] ?? 0;
  if (xp <= 0) return 0;

  const priceM = Math.max(0.1, p.price / 10);

  switch (strategy) {
    case "max_points":
      return xp;
    case "value":
      return xp / priceM;
    case "differential": {
      // Halve the weight of heavily-owned players without discarding them.
      const owned = Math.max(0, Math.min(100, p.ownership ?? 0));
      return xp * (1 - owned / 200);
    }
    case "balanced":
      // xP is roughly 0-45 over 6 GWs and xP/£m roughly 0-6, so the value term
      // is scaled up before blending or it would contribute nothing.
      return xp * 0.7 + (xp / priceM) * 5 * 0.3;
  }
}

/**
 * The order the greedy fill considers players in.
 *
 * Not the objective, and that distinction is the whole point. Maximising total
 * xP under a fixed budget is a knapsack problem, and greedy by raw value is the
 * textbook wrong answer to knapsack: "Maximum points" would take the five
 * highest-scoring players in the game, exhaust the budget, and then be forced to
 * complete the squad with whatever the reserve floor still permitted — ten near
 * zero-projection fillers. That is how the strategy came to return *fewer*
 * expected points than "Value" on the same pool.
 *
 * Ordering the fill by points per million is the standard greedy approximation
 * to knapsack. The swap and funded-upgrade passes then spend whatever budget the
 * density fill left over, and those passes still maximise raw points — so the
 * strategy keeps its meaning.
 *
 * The other three already price their score: Value *is* a density, Balanced
 * blends one in, and Differential scales xP by ownership rather than by cost but
 * never concentrates spend the way raw xP does. Dividing their scores again
 * would distort what the user asked for, so their fill order is their objective.
 */
function fillScoreOf(p: OptimizerPlayer, horizon: Horizon, strategy: Strategy): number {
  if (strategy !== "max_points") return scoreOf(p, horizon, strategy);
  const xp = p.xp[horizon] ?? 0;
  if (xp <= 0) return 0;
  return xp / Math.max(0.1, p.price / 10);
}

export function optimizeSquad(input: OptimizeInput): OptimizeResult {
  const { pool, rules, locked, horizon, strategy, risk } = input;

  const byId = new Map(pool.map((p) => [p.id, p]));
  const picks: SquadPick[] = [...locked];

  const positionCount = new Map<number, number>();
  const clubCount = new Map<number, number>();
  let spent = 0;

  for (const pick of picks) {
    const meta = byId.get(pick.playerId);
    spent += pick.purchasePrice;
    if (!meta) continue;
    positionCount.set(meta.elementType, (positionCount.get(meta.elementType) ?? 0) + 1);
    clubCount.set(meta.teamId, (clubCount.get(meta.teamId) ?? 0) + 1);
  }

  const chosen = new Set(picks.map((p) => p.playerId));

  // Eligible candidates, best objective first — the order the swap and upgrade
  // passes rely on, since both take the first match they find.
  const eligible = pool
    .filter((p) => !chosen.has(p.id) && passesRisk(p, risk) && p.price > 0)
    .map((p) => ({ p, score: scoreOf(p, horizon, strategy), fill: fillScoreOf(p, horizon, strategy) }))
    .sort((a, b) => b.score - a.score);

  // The same candidates in fill order, which for Maximum points is by points per
  // million rather than by points.
  const byFillOrder = [...eligible].sort((a, b) => b.fill - a.fill);

  // Cheapest eligible price per position, so the budget reserve knows the
  // floor cost of every slot still to be filled. Prefers a player with a real
  // projection: the true floor for a *sensible* completion is the cheapest
  // player worth picking, not the cheapest body of any kind. Using the
  // null-xp floor understates the reserve by the gap between the two, which
  // compounds across every other pick taken while slots remain — this is what
  // let the fill starve genuine forwards down to zero-projection fillers even
  // when real ones were still affordable.
  const cheapestAny = new Map<number, number>();
  const cheapestReal = new Map<number, number>();
  for (const { p } of eligible) {
    const anyCur = cheapestAny.get(p.elementType);
    if (anyCur === undefined || p.price < anyCur) cheapestAny.set(p.elementType, p.price);
    if (p.xp[horizon] !== null) {
      const realCur = cheapestReal.get(p.elementType);
      if (realCur === undefined || p.price < realCur) cheapestReal.set(p.elementType, p.price);
    }
  }
  const cheapest = new Map<number, number>();
  for (const type of new Set([...cheapestAny.keys(), ...cheapestReal.keys()])) {
    cheapest.set(type, cheapestReal.get(type) ?? cheapestAny.get(type)!);
  }

  const slotsRemaining = () => {
    const out: { elementType: number; count: number }[] = [];
    for (const [type, required] of Object.entries(rules.positionQuota)) {
      const t = Number(type);
      const missing = required - (positionCount.get(t) ?? 0);
      if (missing > 0) out.push({ elementType: t, count: missing });
    }
    return out;
  };

  /** Minimum spend needed to fill every slot except one of `forType`. */
  const reserveExcluding = (forType: number): number => {
    let reserve = 0;
    for (const slot of slotsRemaining()) {
      const n = slot.elementType === forType ? slot.count - 1 : slot.count;
      reserve += n * (cheapest.get(slot.elementType) ?? 0);
    }
    return reserve;
  };

  const canTake = (p: OptimizerPlayer): boolean => {
    const required = rules.positionQuota[p.elementType] ?? 0;
    if ((positionCount.get(p.elementType) ?? 0) >= required) return false;
    if ((clubCount.get(p.teamId) ?? 0) >= rules.teamLimit) return false;
    const budgetLeft = rules.totalSpend - spent;
    return p.price <= budgetLeft - reserveExcluding(p.elementType);
  };

  const take = (p: OptimizerPlayer) => {
    picks.push({ playerId: p.id, purchasePrice: p.price });
    chosen.add(p.id);
    spent += p.price;
    positionCount.set(p.elementType, (positionCount.get(p.elementType) ?? 0) + 1);
    clubCount.set(p.teamId, (clubCount.get(p.teamId) ?? 0) + 1);
  };

  // ---------------------------------------------------------- greedy fill

  while (picks.length < rules.squadSize) {
    const next = byFillOrder.find(({ p }) => !chosen.has(p.id) && canTake(p));
    if (!next) break;
    take(next.p);
  }

  if (picks.length < rules.squadSize) {
    return {
      picks,
      filled: picks.length - locked.length,
      totalScore: 0,
      withoutXp: 0,
      error:
        "Could not complete a legal squad — the locked picks leave too little budget, or the risk filter excludes too many players.",
    };
  }

  // ------------------------------------------------------- swap improvement
  // One pass of single swaps: replace a chosen player with a better-scoring
  // eligible one that still fits. Bounded so the UI stays responsive.

  const lockedIds = new Set(locked.map((l) => l.playerId));

  for (let round = 0; round < 3; round++) {
    let improved = false;

    for (const pick of [...picks]) {
      if (lockedIds.has(pick.playerId)) continue;
      const out = byId.get(pick.playerId);
      if (!out) continue;

      const outScore = scoreOf(out, horizon, strategy);
      const budgetIfDropped = rules.totalSpend - spent + pick.purchasePrice;
      const clubIfDropped = (clubCount.get(out.teamId) ?? 1) - 1;

      const better = eligible.find(({ p, score }) => {
        if (chosen.has(p.id)) return false;
        if (p.elementType !== out.elementType) return false;
        if (score <= outScore) return false;
        if (p.price > budgetIfDropped) return false;
        const club = p.teamId === out.teamId ? clubIfDropped : (clubCount.get(p.teamId) ?? 0);
        return club < rules.teamLimit;
      });

      if (!better) continue;

      // Commit the swap.
      const index = picks.findIndex((x) => x.playerId === pick.playerId);
      picks.splice(index, 1);
      chosen.delete(pick.playerId);
      spent -= pick.purchasePrice;
      clubCount.set(out.teamId, clubIfDropped);
      positionCount.set(out.elementType, (positionCount.get(out.elementType) ?? 1) - 1);

      take(better.p);
      improved = true;
    }

    if (!improved) break;
  }

  // ------------------------------------------------- funded upgrade pass
  //
  // The same-position swap above can only replace a pick with something no
  // more expensive, so once the budget is fully committed it cannot fix an
  // obviously bad pick that costs even 50p more than what is currently held —
  // exactly the situation the reserve-floor fix above still leaves on the
  // table. This searches for a *funding* swap: downgrade some other
  // non-locked pick to the cheapest real-scoring player in its own position,
  // and spend the freed cash upgrading the weakest pick. Bounded to the
  // single worst pick per round, mirroring the pass above.
  for (let round = 0; round < 3; round++) {
    const weakest = [...picks]
      .filter((pick) => !lockedIds.has(pick.playerId))
      .map((pick) => ({ pick, score: scoreOf(byId.get(pick.playerId)!, horizon, strategy) }))
      .sort((a, b) => a.score - b.score)[0];
    if (!weakest) break;

    const weak = byId.get(weakest.pick.playerId)!;
    let bestPlan: {
      donor: SquadPick;
      donorReplacement: OptimizerPlayer;
      weakReplacement: OptimizerPlayer;
      netGain: number;
    } | null = null;

    for (const donor of picks) {
      if (donor.playerId === weakest.pick.playerId || lockedIds.has(donor.playerId)) continue;
      const donorMeta = byId.get(donor.playerId);
      if (!donorMeta) continue;

      const donorCheapest = eligible
        .filter(
          ({ p }) =>
            !chosen.has(p.id) &&
            p.elementType === donorMeta.elementType &&
            p.xp[horizon] !== null &&
            p.price < donor.purchasePrice,
        )
        .sort((a, b) => a.p.price - b.p.price)[0];
      if (!donorCheapest) continue;

      const freed = donor.purchasePrice - donorCheapest.p.price;
      const budget = rules.totalSpend - spent + weakest.pick.purchasePrice + freed;

      const donorClubAfter =
        donorCheapest.p.teamId === donorMeta.teamId
          ? (clubCount.get(donorMeta.teamId) ?? 1)
          : (clubCount.get(donorCheapest.p.teamId) ?? 0) + 1;
      if (donorCheapest.p.teamId !== donorMeta.teamId && donorClubAfter > rules.teamLimit) continue;

      const weakReplacement = eligible
        .filter(({ p }) => {
          if (chosen.has(p.id) || p.id === donorCheapest.p.id) return false;
          if (p.elementType !== weak.elementType) return false;
          if (p.price > budget) return false;
          const club =
            p.teamId === weak.teamId
              ? (clubCount.get(weak.teamId) ?? 1) - 1
              : (clubCount.get(p.teamId) ?? 0) +
                (p.teamId === donorCheapest.p.teamId && donorCheapest.p.teamId !== donorMeta.teamId
                  ? 1
                  : 0);
          return club <= rules.teamLimit;
        })
        .sort((a, b) => b.score - a.score)[0];
      if (!weakReplacement || weakReplacement.score <= weakest.score) continue;

      const donorLoss = scoreOf(donorMeta, horizon, strategy) - donorCheapest.score;
      const netGain = weakReplacement.score - weakest.score - donorLoss;
      if (netGain > 0 && (!bestPlan || netGain > bestPlan.netGain)) {
        bestPlan = {
          donor,
          donorReplacement: donorCheapest.p,
          weakReplacement: weakReplacement.p,
          netGain,
        };
      }
    }

    if (!bestPlan) break;

    // Commit both legs: drop the donor and the weak pick, then take their
    // replacements. Counters are rebuilt from the remaining picks rather than
    // netted out by hand, which stays correct regardless of whether the two
    // removed players shared a position or a club.
    for (const outId of [bestPlan.donor.playerId, weakest.pick.playerId]) {
      const idx = picks.findIndex((x) => x.playerId === outId);
      picks.splice(idx, 1);
      chosen.delete(outId);
    }
    spent = picks.reduce((sum, pick) => sum + pick.purchasePrice, 0);
    positionCount.clear();
    clubCount.clear();
    for (const pick of picks) {
      const meta = byId.get(pick.playerId)!;
      positionCount.set(meta.elementType, (positionCount.get(meta.elementType) ?? 0) + 1);
      clubCount.set(meta.teamId, (clubCount.get(meta.teamId) ?? 0) + 1);
    }
    take(bestPlan.donorReplacement);
    take(bestPlan.weakReplacement);
  }

  let totalScore = 0;
  let withoutXp = 0;
  for (const pick of picks) {
    const meta = byId.get(pick.playerId);
    if (!meta) continue;
    totalScore += scoreOf(meta, horizon, strategy);
    if (meta.xp[horizon] === null) withoutXp++;
  }

  return {
    picks,
    filled: picks.length - locked.length,
    totalScore,
    withoutXp,
    error: null,
  };
}

/** Highest and second-highest xP in the squad, for a default armband. */
export function suggestArmband(
  picks: SquadPick[],
  byId: Map<number, OptimizerPlayer>,
  horizon: Horizon,
): { captain: number | null; vice: number | null } {
  const ranked = picks
    .map((p) => ({ id: p.playerId, xp: byId.get(p.playerId)?.xp[horizon] ?? 0 }))
    .sort((a, b) => b.xp - a.xp);

  return {
    captain: ranked[0]?.id ?? null,
    vice: ranked[1]?.id ?? null,
  };
}
