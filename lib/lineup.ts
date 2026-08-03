// Sprint 3 — Starting XI, bench order, and captaincy.
//
// Supersedes lib/formation.ts's provisional "best XI by xP". Three decisions
// the build plan asks for, each grounded in data we actually hold:
//
//   * Starting XI  — maximise the sum of expected points over legal formations.
//   * Bench order  — rank by expected points times the probability that the
//                    slot is actually used by an auto-sub.
//   * Captain      — the plan's weighted CaptainScore, with confidence and
//                    reasons, because an unexplained recommendation is not
//                    actionable.

export interface LineupCandidate {
  playerId: number;
  elementType: number;
  webName: string;
  /** Model xP for the next gameweek. Null when the model abstained. */
  xp: number | null;
  /** Expected minutes for the next gameweek, from player_predictions. */
  expectedMinutes: number | null;
  /** Probability of starting, from player_predictions. */
  startProbability: number | null;
  /** 0–1, from status / chance_of_playing. */
  availability: number;
  /** Official difficulty of the next fixture, 1 (easy) – 5 (hard). */
  fdr: number | null;
  opponent: string | null;
  isPenaltyTaker: boolean;
}

export interface CaptainPick {
  playerId: number;
  webName: string;
  score: number;
  /** 0–1. */
  confidence: number;
  reasons: string[];
  caveats: string[];
}

export interface LineupResult {
  starters: number[];
  /** Ordered for auto-subs: reserve keeper first, then outfielders. */
  bench: number[];
  formation: string;
  startersXp: number;
  benchXp: number;
  /** playerId -> probability that this bench slot gets used. */
  subProbability: Map<number, number>;
  /** Expected points the bench actually contributes via auto-subs. */
  benchExpectedContribution: number;
  captain: CaptainPick | null;
  vice: CaptainPick | null;
}

const FORMATION_LIMITS = {
  def: { min: 3, max: 5 },
  mid: { min: 2, max: 5 },
  fwd: { min: 1, max: 3 },
};

/**
 * Minutes at which an appearance is effectively certain. Matches the xP
 * model's own `appearanceMinutes`, so "probability of featuring" means the
 * same thing on both sides of the system.
 */
const APPEARANCE_MINUTES = 72;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Probability the player features at all. */
export function playProbability(c: LineupCandidate): number {
  if (c.expectedMinutes === null) return c.availability;
  return clamp(c.expectedMinutes / APPEARANCE_MINUTES, 0, 1) * 1;
}

/** P(X >= k) for X ~ Poisson(lambda). */
export function poissonAtLeast(lambda: number, k: number): number {
  if (k <= 0) return 1;
  if (lambda <= 0) return 0;
  let term = Math.exp(-lambda);
  let cdf = term;
  for (let i = 1; i < k; i++) {
    term *= lambda / i;
    cdf += term;
  }
  return clamp(1 - cdf, 0, 1);
}

// --------------------------------------------------------------- captain
//
// The plan's formula is:
//
//   0.50 x xP + 0.20 x FixtureScore + 0.15 x MinutesProbability
//   + 0.10 x TeamAttackStrength + 0.05 x PenaltyBonus - RiskPenalty
//
// FPL leaves team attack/defence strength at zero until matches are played, so
// that term has no data behind it this side of the season opener. Rather than
// multiply it by zero — which would quietly shrink every score by a tenth — the
// term is dropped and the remaining weights are renormalised over 0.90.

export const CAPTAIN_WEIGHTS = {
  xp: 0.5 / 0.9,
  fixture: 0.2 / 0.9,
  minutes: 0.15 / 0.9,
  penalty: 0.05 / 0.9,
  riskPenalty: 0.15,
} as const;

export const CAPTAIN_MODEL_NOTE =
  "Team attack strength is omitted — FPL publishes it as zero until matches are played, " +
  "so the remaining weights are renormalised.";

function captainScore(c: LineupCandidate, maxXp: number) {
  const xpNorm = maxXp > 0 ? clamp((c.xp ?? 0) / maxXp, 0, 1) : 0;
  // FDR 1 (easiest) -> 1.0, FDR 5 (hardest) -> 0.
  const fixture = c.fdr === null ? 0.5 : clamp((5 - c.fdr) / 4, 0, 1);
  const minutes = c.startProbability ?? playProbability(c);
  const penalty = c.isPenaltyTaker ? 1 : 0;

  const score =
    CAPTAIN_WEIGHTS.xp * xpNorm +
    CAPTAIN_WEIGHTS.fixture * fixture +
    CAPTAIN_WEIGHTS.minutes * minutes +
    CAPTAIN_WEIGHTS.penalty * penalty -
    CAPTAIN_WEIGHTS.riskPenalty * (1 - c.availability);

  return { score, xpNorm, fixture, minutes, penalty };
}

function explain(
  c: LineupCandidate,
  parts: ReturnType<typeof captainScore>,
  isTopXp: boolean,
): { reasons: string[]; caveats: string[] } {
  const reasons: string[] = [];
  const caveats: string[] = [];

  if (c.xp !== null) {
    reasons.push(
      isTopXp
        ? `Highest projected points in the squad (${c.xp.toFixed(1)} xP)`
        : `${c.xp.toFixed(1)} projected points`,
    );
  }
  if (c.fdr !== null && c.fdr <= 2) {
    reasons.push(`Favourable fixture — FDR ${c.fdr}${c.opponent ? ` vs ${c.opponent}` : ""}`);
  }
  if (parts.minutes >= 0.8) {
    reasons.push(`${Math.round(parts.minutes * 100)}% start probability`);
  }
  if (c.isPenaltyTaker) reasons.push("First-choice penalty taker");

  if (c.fdr !== null && c.fdr >= 4) {
    caveats.push(`Difficult fixture — FDR ${c.fdr}${c.opponent ? ` vs ${c.opponent}` : ""}`);
  }
  if (c.availability < 1) {
    caveats.push(`Availability ${Math.round(c.availability * 100)}%`);
  }
  if (parts.minutes < 0.7) {
    caveats.push(`Only ${Math.round(parts.minutes * 100)}% likely to start`);
  }
  if (c.xp === null) caveats.push("No xP projection — too little prior-season data");

  return { reasons, caveats };
}

// ------------------------------------------------------------- the lineup

/**
 * Best legal XI, bench order, and armband.
 *
 * The XI objective is a plain sum of expected points, matching the build
 * plan's `StartingXIValue = Sum ExpectedPoints_i`. Deliberately no extra
 * minutes multiplier: the xP model already scales every projection by expected
 * minutes, so re-applying it would penalise rotation risk twice.
 */
export function optimiseLineup(squad: LineupCandidate[]): LineupResult | null {
  const byId = new Map(squad.map((c) => [c.playerId, c]));
  const xpOf = (c: LineupCandidate) => c.xp ?? 0;

  const byPos = (type: number) =>
    squad.filter((p) => p.elementType === type).sort((a, b) => xpOf(b) - xpOf(a));

  const gks = byPos(1);
  const defs = byPos(2);
  const mids = byPos(3);
  const fwds = byPos(4);

  if (gks.length === 0) return null;

  let bestStarters: LineupCandidate[] | null = null;
  let bestXp = -Infinity;
  let bestFormation = "";

  for (let d = FORMATION_LIMITS.def.min; d <= Math.min(FORMATION_LIMITS.def.max, defs.length); d++) {
    for (
      let m = FORMATION_LIMITS.mid.min;
      m <= Math.min(FORMATION_LIMITS.mid.max, mids.length);
      m++
    ) {
      const f = 10 - d - m;
      if (f < FORMATION_LIMITS.fwd.min || f > FORMATION_LIMITS.fwd.max || f > fwds.length) continue;

      const starters = [gks[0], ...defs.slice(0, d), ...mids.slice(0, m), ...fwds.slice(0, f)];
      const total = starters.reduce((sum, p) => sum + xpOf(p), 0);

      if (total > bestXp) {
        bestXp = total;
        bestStarters = starters;
        bestFormation = `${d}-${m}-${f}`;
      }
    }
  }

  if (!bestStarters) return null;

  const startingIds = new Set(bestStarters.map((p) => p.playerId));

  // ------------------------------------------------------- bench order
  //
  // A bench player only scores if a starter fails to appear, so their value is
  // xP weighted by the chance their slot is reached. The number of no-shows
  // among the ten outfield starters is a sum of independent Bernoulli trials;
  // a Poisson with the same mean is a good approximation of its tail and needs
  // no combinatorics.

  const outfieldStarters = bestStarters.filter((p) => p.elementType !== 1);
  const lambda = outfieldStarters.reduce((sum, p) => sum + (1 - playProbability(p)), 0);

  const reserveGks = gks.slice(1);
  const benchOutfield = squad
    .filter((p) => !startingIds.has(p.playerId) && p.elementType !== 1)
    // Slot probability falls with depth, so highest xP first maximises the
    // total expected contribution.
    .sort((a, b) => xpOf(b) - xpOf(a));

  const subProbability = new Map<number, number>();

  // The reserve keeper can only replace the starting keeper.
  const startingGk = bestStarters[0];
  for (const gk of reserveGks) {
    subProbability.set(gk.playerId, clamp(1 - playProbability(startingGk), 0, 1));
  }
  benchOutfield.forEach((p, index) => {
    subProbability.set(p.playerId, poissonAtLeast(lambda, index + 1));
  });

  const bench = [...reserveGks, ...benchOutfield].map((p) => p.playerId);

  const benchXp = bench.reduce((sum, id) => sum + xpOf(byId.get(id)!), 0);
  const benchExpectedContribution = bench.reduce(
    (sum, id) => sum + xpOf(byId.get(id)!) * (subProbability.get(id) ?? 0),
    0,
  );

  // ---------------------------------------------------------- captaincy

  const maxXp = Math.max(0, ...squad.map(xpOf));
  const topXpId = bestStarters.reduce(
    (best, p) => (xpOf(p) > xpOf(byId.get(best)!) ? p.playerId : best),
    bestStarters[0].playerId,
  );

  const ranked = bestStarters
    .map((c) => {
      const parts = captainScore(c, maxXp);
      return { candidate: c, ...parts };
    })
    .sort((a, b) => b.score - a.score);

  const toPick = (
    entry: (typeof ranked)[number] | undefined,
    runnerUpScore: number | null,
  ): CaptainPick | null => {
    if (!entry) return null;
    const { candidate, score } = entry;
    const margin = runnerUpScore === null ? 0.1 : Math.max(0, score - runnerUpScore);
    // Confidence blends how certain the minutes are with how clear-cut the
    // choice was: a narrow win over the next candidate is genuinely less
    // confident even when the player himself is nailed on.
    const confidence = clamp(
      (entry.minutes || candidate.availability) *
        candidate.availability *
        clamp(0.7 + margin * 4, 0.7, 1),
      0,
      1,
    );
    const { reasons, caveats } = explain(candidate, entry, candidate.playerId === topXpId);
    return {
      playerId: candidate.playerId,
      webName: candidate.webName,
      score,
      confidence,
      reasons,
      caveats,
    };
  };

  const captain = toPick(ranked[0], ranked[1]?.score ?? null);
  const vice = toPick(ranked[1], ranked[2]?.score ?? null);

  return {
    starters: bestStarters.map((p) => p.playerId),
    bench,
    formation: bestFormation,
    startersXp: bestXp,
    benchXp,
    subProbability,
    benchExpectedContribution,
    captain,
    vice,
  };
}
