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
 * Strategy score. All variants start from horizon xP; they differ in how they
 * trade raw points against price and ownership.
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

  // Eligible candidates, best score first.
  const eligible = pool
    .filter((p) => !chosen.has(p.id) && passesRisk(p, risk) && p.price > 0)
    .map((p) => ({ p, score: scoreOf(p, horizon, strategy) }))
    .sort((a, b) => b.score - a.score);

  // Cheapest eligible price per position, so the budget reserve knows the
  // floor cost of every slot still to be filled.
  const cheapest = new Map<number, number>();
  for (const { p } of eligible) {
    const current = cheapest.get(p.elementType);
    if (current === undefined || p.price < current) cheapest.set(p.elementType, p.price);
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
    const next = eligible.find(({ p }) => !chosen.has(p.id) && canTake(p));
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
