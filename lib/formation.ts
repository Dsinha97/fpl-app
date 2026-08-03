// Starting XI selection.
//
// A provisional "best XI by xP" so the pitch can show a plausible lineup as
// soon as a squad is complete. Sprint 3 replaces the objective with the full
// treatment (substitution probability, rotation risk, bench ordering); the
// formation enumeration here is what that will build on.

export interface XiCandidate {
  playerId: number;
  elementType: number;
  xp: number;
}

export interface XiResult {
  starters: number[];
  bench: number[];
  /** e.g. "3-4-3" */
  formation: string;
  startersXp: number;
}

const LIMITS = {
  def: { min: 3, max: 5 },
  mid: { min: 2, max: 5 },
  fwd: { min: 1, max: 3 },
};

/**
 * Best legal XI by expected points: exactly one goalkeeper, then whichever
 * outfield split maximises the total. Enumerating the handful of legal
 * formations is cheap and exact, so there is no need to approximate.
 */
export function bestStartingXi(squad: XiCandidate[]): XiResult | null {
  const byPos = (type: number) =>
    squad.filter((p) => p.elementType === type).sort((a, b) => b.xp - a.xp);

  const gks = byPos(1);
  const defs = byPos(2);
  const mids = byPos(3);
  const fwds = byPos(4);

  if (gks.length === 0) return null;

  let best: XiResult | null = null;

  for (let d = LIMITS.def.min; d <= Math.min(LIMITS.def.max, defs.length); d++) {
    for (let m = LIMITS.mid.min; m <= Math.min(LIMITS.mid.max, mids.length); m++) {
      const f = 10 - d - m;
      if (f < LIMITS.fwd.min || f > LIMITS.fwd.max || f > fwds.length) continue;

      const starters = [
        gks[0],
        ...defs.slice(0, d),
        ...mids.slice(0, m),
        ...fwds.slice(0, f),
      ];
      const startersXp = starters.reduce((sum, p) => sum + p.xp, 0);

      if (!best || startersXp > best.startersXp) {
        const startingIds = new Set(starters.map((p) => p.playerId));
        // Bench order: reserve keeper first, then outfielders by xP — the
        // order auto-subs are applied in.
        const bench = [
          ...gks.slice(1),
          ...squad
            .filter((p) => !startingIds.has(p.playerId) && p.elementType !== 1)
            .sort((a, b) => b.xp - a.xp),
        ].map((p) => p.playerId);

        best = {
          starters: starters.map((p) => p.playerId),
          bench,
          formation: `${d}-${m}-${f}`,
          startersXp,
        };
      }
    }
  }

  return best;
}
