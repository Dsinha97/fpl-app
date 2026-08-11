// Hidden Gems (Sprint 15.5) — a value-discovery filter over players FPL
// under-prices relative to their underlying per-90 output.
//
// Not a new scoring model: everything here is a read-side filter over
// `ScoredPlayer` (lib/scoring.ts) plus the per-90 rates in
// `player_rate_profile` (see the migration for how those are derived).
// Ranking still runs through the one xP/value implementation this app has —
// `xpFor` and `valuePerMillion` — rather than inventing a second one.
//
// The constraint that shapes every archetype below: a candidate resting on
// the cold-start prior is not evidence of anything. The prior gives every
// promoted-club player at a price near-identical rates drawn from position
// and price alone (see COLD_START_NOTE), so a naive per-90 filter would
// flag an entire newly-promoted defence at once and hand the user the
// prior's own output back as a "discovery" — the same failure mode that got
// a supplied CSV rejected (docs/sprints/cold-start-patch.md, 2026-08-05:
// "Injecting it would have been actively harmful"). So every archetype below
// requires `reliability` of "high" or "medium" and a minimum observed
// minutes floor, and a "low"-reliability candidate can never be labelled a
// gem, full stop.

import { quantile } from "./stats";
import { fixtureScore, MINUTES_FLOOR, valuePerMillion, xpFor, type ScoredPlayer } from "./scoring";
import type { Horizon } from "./team-state";

export type GemArchetype = "defcon_defender" | "defcon_midfielder" | "breakout_attacker";

export const GEM_ARCHETYPE_LABELS: Record<GemArchetype, string> = {
  defcon_defender: "Defcon defender",
  defcon_midfielder: "Defcon midfielder",
  breakout_attacker: "Breakout attacker",
};

/** Per-90 rate profile for one player — one row of `player_rate_profile`. */
export interface RateProfile {
  observedMinutes: number | null;
  dc90: number | null;
  /**
   * Position-correct defensive-action rate — CBIT for defenders, CBIRT for
   * midfielders/forwards. Only populated for the season the API breaks the
   * aggregate `dc90` into its components (2025/26 at time of writing); `null`
   * outside it, never a substitute zero. Falls back to `dc90` when null so
   * the archetype still works on seasons without the split, at the cost of
   * mixing defenders' CBIT with midfielders' CBIRT the same way `xDefcon`
   * already does (see XDC_MODEL_NOTE).
   */
  positionDc90: number | null;
  xgi90: number | null;
}

export interface GemCandidate {
  player: ScoredPlayer;
  rates: RateProfile;
}

export interface GemCuts {
  /** Weighted minutes floor before a per-90 rate is trusted at all. */
  minObservedMinutes: number;
  /** Reuses the app's one minutes-floor constant rather than a second one. */
  minStartProbability: number;
  /** Reference-pool percentile a candidate's defining metric must clear, 0-1. */
  percentile: number;
  /**
   * Price-tier cutoffs, also percentiles of the *position's own* price
   * distribution rather than absolute tenths — a hardcoded "£5.0m" band
   * would be exactly the video's own invented number applied to a different
   * axis, and it goes stale the moment prices move during a season (as they
   * already had by the time this shipped: today's real Senesi/Anderson/
   * Semenyo sit at £6.0m/£6.5m/£8.5m, past a naive "≈£5.0m" reading of the
   * video). "Budget" and "mid-price" are defined relative to the position's
   * own distribution instead, so the band tracks price inflation for free.
   */
  budgetPricePercentile: number;
  breakoutPriceLowPercentile: number;
  breakoutPriceHighPercentile: number;
  /**
   * Floor on `fixtureScore` (lib/scoring.ts) — the same 0-1 "how kind is the
   * run" figure `/compare` and the risk engine already use, reused here
   * rather than computing a per-team clean-sheet probability from
   * `player_predictions.xp_clean_sheet` (which bakes in a position-specific
   * points multiplier the front end would have to unwind). See
   * `GEMS_MODEL_NOTE`.
   */
  minFixtureScore: number;
}

/**
 * Percentile-based, not the video's literal figures (defcons/90 >= 10.5,
 * >= 12.0, xGI/90 >= 0.45) — those are someone else's fitted coefficients
 * with nothing in this repo to check them against, which is exactly what
 * "never tune an invented coefficient until the answer looks reasonable"
 * rules out. 85th percentile of this season's own pool is the default; every
 * field here is a plain, user-overridable input (the `decisionMargin`
 * precedent in transfer-optimizer.ts), so the video's own cut points can
 * still be dialled in deliberately rather than absorbed silently.
 */
export const DEFAULT_GEM_CUTS: GemCuts = {
  minObservedMinutes: 450,
  minStartProbability: MINUTES_FLOOR,
  percentile: 0.85,
  budgetPricePercentile: 0.5,
  breakoutPriceLowPercentile: 0.4,
  breakoutPriceHighPercentile: 0.8,
  minFixtureScore: 0.35,
};

export interface GemVerdict {
  playerId: number;
  archetype: GemArchetype;
  /** This player's percentile within the reference pool, 0-100. */
  metricPercentile: number;
  metricName: string;
  metricValue: number;
  ownership: number | null;
  /** A "low"-reliability player never reaches this type — see the module note. */
  reliability: "high" | "medium";
  xp: number;
  valuePerMillion: number;
  /** Each term stated on its own — never pre-summed into one score. */
  reasons: string[];
}

export const GEMS_MODEL_NOTE =
  "Archetypes are percentile filters against this season's own player pool, not fixed thresholds — " +
  "'top 15%' means top 15% of the players you would actually consider at that position and price, " +
  "and moves as the season's data does. Price tiers are percentiles of the position's own price " +
  "distribution too, not a fixed £-figure, so 'budget' and 'mid-price' track price inflation across " +
  "a season rather than reading a round number that was only ever a snapshot. A player is never " +
  "labelled a gem on a prior-based projection: " +
  "the reliability gate excludes anyone whose number mostly reflects position and price rather than " +
  "their own record, the same evidence standard the cold-start layer already applies. The defcon " +
  "defender archetype's clean-sheet term is `fixtureScore`, the same fixture-difficulty figure the " +
  "risk engine and /compare already use — a run-of-fixtures estimate, not a squad-quality one, since " +
  "team attacking/defensive strength is zero for all twenty clubs pre-season (see COLD_START_NOTE) and " +
  "says nothing about a back line's real quality. Outside the season the FPL API breaks the defensive-contribution count into " +
  "its components, the defender and midfielder archetypes fall back to the aggregate dc90 rate, which " +
  "mixes defenders' CBIT actions with midfielders' CBIRT actions (see XDC_MODEL_NOTE) — the same " +
  "one-number limitation, not a new one.";

/** Fraction of `pool` at or below `value`, 0-1. */
function percentileRankOf(value: number, pool: number[]): number {
  if (pool.length === 0) return 0;
  const atOrBelow = pool.filter((v) => v <= value).length;
  return atOrBelow / pool.length;
}

const meetsEvidenceFloor = (c: GemCandidate, cuts: GemCuts): boolean =>
  c.player.reliability !== "low" &&
  (c.rates.observedMinutes ?? 0) >= cuts.minObservedMinutes &&
  (c.player.startProbability ?? c.player.availability) >= cuts.minStartProbability;

const reliabilityOf = (c: GemCandidate): "high" | "medium" =>
  c.player.reliability === "high" ? "high" : "medium";

function ownershipReason(ownership: number | null): string {
  return ownership !== null ? `${ownership.toFixed(1)}% owned` : "ownership unknown";
}

function buildVerdict(
  c: GemCandidate,
  archetype: GemArchetype,
  metricName: string,
  metricValue: number,
  percentilePool: number[],
  horizon: Horizon,
  extraReasons: string[],
): GemVerdict {
  const xp = xpFor(c.player, horizon);
  const value = valuePerMillion(c.player, horizon);
  const pct = Math.round(percentileRankOf(metricValue, percentilePool) * 100);
  return {
    playerId: c.player.id,
    archetype,
    metricPercentile: pct,
    metricName,
    metricValue,
    ownership: c.player.ownership,
    reliability: reliabilityOf(c),
    xp,
    valuePerMillion: value,
    reasons: [
      `top ${100 - pct}% for ${metricName}`,
      ownershipReason(c.player.ownership),
      `${value.toFixed(2)} xP/£m`,
      ...extraReasons,
    ],
  };
}

/**
 * Detect the three archetypes across a candidate pool. `pool` should be
 * every player under consideration (the page's full player list), not an
 * already-filtered subset — the percentile cutoffs are computed from it.
 */
export function detectGems(
  pool: GemCandidate[],
  horizon: Horizon,
  cuts: GemCuts = DEFAULT_GEM_CUTS,
  seasonWindow?: number,
): GemVerdict[] {
  const verdicts: GemVerdict[] = [];

  const priceCutoff = (elementType: number, percentile: number): number =>
    quantile(
      pool.filter((c) => c.player.elementType === elementType).map((c) => c.player.price),
      percentile,
    );

  // --- Defcon defender: DEF, budget price, high defensive-action rate,
  //     plus a clean-sheet floor for the team he plays in.
  const defPriceCutoff = priceCutoff(2, cuts.budgetPricePercentile);
  const defPool = pool.filter((c) => c.player.elementType === 2 && c.player.price <= defPriceCutoff);
  const defRates = defPool
    .filter((c) => meetsEvidenceFloor(c, cuts))
    .map((c) => c.rates.positionDc90 ?? c.rates.dc90 ?? 0);
  const defCutoff = quantile(defRates, cuts.percentile);
  for (const c of defPool) {
    if (!meetsEvidenceFloor(c, cuts)) continue;
    const rate = c.rates.positionDc90 ?? c.rates.dc90;
    if (rate === null || rate < defCutoff) continue;
    const fixtures = fixtureScore(c.player, horizon, seasonWindow);
    if (fixtures < cuts.minFixtureScore) continue;
    verdicts.push(
      buildVerdict(c, "defcon_defender", "defensive actions", rate, defRates, horizon, [
        `fixture score ${fixtures.toFixed(2)}`,
      ]),
    );
  }

  // --- Defcon midfielder: MID, budget price, high defensive-action rate,
  //     nailed on for minutes.
  const midPriceCutoff = priceCutoff(3, cuts.budgetPricePercentile);
  const midPool = pool.filter((c) => c.player.elementType === 3 && c.player.price <= midPriceCutoff);
  const midRates = midPool
    .filter((c) => meetsEvidenceFloor(c, cuts))
    .map((c) => c.rates.positionDc90 ?? c.rates.dc90 ?? 0);
  const midCutoff = quantile(midRates, cuts.percentile);
  for (const c of midPool) {
    if (!meetsEvidenceFloor(c, cuts)) continue;
    const rate = c.rates.positionDc90 ?? c.rates.dc90;
    if (rate === null || rate < midCutoff) continue;
    verdicts.push(
      buildVerdict(c, "defcon_midfielder", "defensive actions", rate, midRates, horizon, [
        `${Math.round((c.player.expectedMinutes ?? 0))} expected minutes`,
      ]),
    );
  }

  // --- Breakout attacker: MID/FWD, mid-price window, high xGI rate.
  const attackPrices = pool
    .filter((c) => c.player.elementType === 3 || c.player.elementType === 4)
    .map((c) => c.player.price);
  const breakoutMinPrice = quantile(attackPrices, cuts.breakoutPriceLowPercentile);
  const breakoutMaxPrice = quantile(attackPrices, cuts.breakoutPriceHighPercentile);
  const attPool = pool.filter(
    (c) =>
      (c.player.elementType === 3 || c.player.elementType === 4) &&
      c.player.price >= breakoutMinPrice &&
      c.player.price <= breakoutMaxPrice,
  );
  const attRates = attPool
    .filter((c) => meetsEvidenceFloor(c, cuts))
    .map((c) => c.rates.xgi90 ?? 0);
  const attCutoff = quantile(attRates, cuts.percentile);
  for (const c of attPool) {
    if (!meetsEvidenceFloor(c, cuts)) continue;
    const rate = c.rates.xgi90;
    if (rate === null || rate < attCutoff) continue;
    verdicts.push(buildVerdict(c, "breakout_attacker", "xGI/90", rate, attRates, horizon, []));
  }

  return verdicts.sort((a, b) => b.metricPercentile - a.metricPercentile);
}
