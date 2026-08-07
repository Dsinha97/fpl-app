// Sprint 5 — SquadScore, the single number a draft comparison can rank on.
//
// The revised spec's formula:
//
//   SquadScore = ExpectedPoints + FixtureQuality + BenchStrength + Value − RiskScore
//
// Every term is computable today, but they arrive in wildly different units:
// expected points is tens-to-hundreds, fixture quality is 0–1, risk is 0–100.
// Summing them raw would let whichever term happens to be largest decide the
// ranking. Each is therefore converted to points-equivalent first, and the
// breakdown is returned alongside the total so the UI can show what drove it.

import {
  fixtureScore,
  riskScore,
  valuePerMillion,
  xpFor,
  type ScoredPlayer,
} from "./scoring";
import { mean } from "./stats";
import {
  computeProjection,
  horizonLength,
  type Horizon,
  type HorizonXp,
  type SquadPick,
  type TeamState,
} from "./team-state";

export interface SquadScoreBreakdown {
  /** Σ xP over the horizon, including the availability-weighted armband. */
  expectedPoints: number;
  /** Points-equivalent bonus for a kind fixture run. */
  fixtureQuality: number;
  /** Expected auto-sub contribution from the bench. */
  benchStrength: number;
  /** Points-equivalent bonus for xP per £m above a baseline squad. */
  value: number;
  /** Points-equivalent penalty for rotation, injury, and minutes uncertainty. */
  risk: number;
  total: number;
  /** Picks the xP model declined to predict — the score is that much softer. */
  missing: number;
  /** Squad size, so a part-built draft is never silently compared with a full one. */
  size: number;
}

/**
 * A neutral fixture run scores 0.5, so a squad only earns fixture credit for
 * being better than average. Scaled to roughly a point per gameweek at the
 * extremes, which is the same exchange rate `findReplacements` uses.
 */
const FIXTURE_POINTS_PER_GW = 2;

/** xP per £m a competent squad should reach; credit accrues above this. */
const VALUE_BASELINE = 2.5;
const VALUE_WEIGHT = 4;

/** A 100-risk squad loses this many points. Deliberately modest — risk is a
 *  tilt on the projection, not a second projection. */
const RISK_POINTS_AT_MAX = 12;

/**
 * Convert a 0-100 risk figure to points.
 *
 * Exported so the transfer simulator subtracts risk on the same scale a squad is
 * scored on — two exchange rates for one quantity would make Scenarios and
 * Transfers disagree about the same squad.
 */
export const riskPoints = (meanRisk: number): number => (meanRisk / 100) * RISK_POINTS_AT_MAX;

export interface SquadScoreInput {
  team: TeamState;
  /** Every squad player, scored. Picks missing from this map are skipped. */
  scoredById: Map<number, ScoredPlayer>;
  xpOf: (playerId: number) => HorizonXp | undefined;
  availabilityOf: (playerId: number) => number;
  horizon: Horizon;
  /** Expected bench contribution from the lineup engine, when a lineup exists. */
  benchContribution?: number | null;
  /**
   * The real "season" prediction window in gameweeks, from
   * `player_xp_horizons.first_event`/`last_event`. Undefined falls back to
   * `horizonLength`'s own conservative default (8) rather than the fetched
   * value being required everywhere at once.
   */
  seasonWindow?: number;
}

export function squadScore(input: SquadScoreInput): SquadScoreBreakdown {
  const { team, scoredById, xpOf, availabilityOf, horizon, benchContribution, seasonWindow } = input;

  const picks: SquadPick[] = team.players;
  const players = picks.flatMap((p) => {
    const s = scoredById.get(p.playerId);
    return s ? [s] : [];
  });

  const projection = computeProjection(
    picks,
    xpOf,
    availabilityOf,
    team.captain,
    team.viceCaptain,
    horizon,
  );

  // Was `Math.min(horizonLength(horizon), 8)` — a clamp that only ever mattered
  // for "season", back when the model's own window was fixed at 8 GWs. Now
  // that the window moves with the chip calendar, `horizonLength` carries the
  // real figure (or the same 8-GW floor when it is not known), so the clamp
  // would otherwise silently cap fixtureQuality below the window that
  // `expectedPoints` and `fixtureScore` below are both computed over.
  const gameweeks = horizonLength(horizon, seasonWindow);

  const fixtureQuality =
    players.length === 0
      ? 0
      : (mean(players.map((p) => fixtureScore(p, horizon, seasonWindow))) - 0.5) * 2 * FIXTURE_POINTS_PER_GW * gameweeks;

  const spent = picks.reduce((sum, p) => sum + p.purchasePrice, 0);
  const totalXp = players.reduce((sum, p) => sum + xpFor(p, horizon), 0);
  const perMillion = spent > 0 ? totalXp / (spent / 10) : 0;
  const value = (perMillion - VALUE_BASELINE) * VALUE_WEIGHT;

  const risk =
    players.length === 0
      ? 0
      : riskPoints(mean(players.map((p) => riskScore(p, horizon, seasonWindow))));

  // The lineup engine already computes the honest version of bench strength —
  // xP times the probability an auto-sub actually uses the slot. Fall back to a
  // flat share of bench xP only when no lineup has been set, and say so by
  // leaving it at zero rather than inventing a figure.
  const benchStrength = benchContribution ?? 0;

  const total = projection.total + fixtureQuality + benchStrength + value - risk;

  return {
    expectedPoints: projection.total,
    fixtureQuality,
    benchStrength,
    value,
    risk,
    total,
    missing: projection.missing,
    size: picks.length,
  };
}

export const SQUAD_SCORE_NOTE =
  "SquadScore sums expected points with points-equivalent adjustments for fixture run, bench " +
  "contribution, value per £m, and risk. Bench strength counts only when a starting XI has been " +
  "set — an unset lineup contributes zero rather than an estimate.";

/** Per-player value, exported so the comparison table can show its own column. */
export function squadValuePerMillion(
  team: TeamState,
  scoredById: Map<number, ScoredPlayer>,
  horizon: Horizon,
): number {
  const spent = team.players.reduce((sum, p) => sum + p.purchasePrice, 0);
  if (spent === 0) return 0;
  const totalXp = team.players.reduce((sum, p) => {
    const s = scoredById.get(p.playerId);
    return sum + (s ? xpFor(s, horizon) : 0);
  }, 0);
  return totalXp / (spent / 10);
}

/** Mean value per million across the players actually scored, for a per-player view. */
export function meanPlayerValue(
  team: TeamState,
  scoredById: Map<number, ScoredPlayer>,
  horizon: Horizon,
): number {
  const values = team.players.flatMap((p) => {
    const s = scoredById.get(p.playerId);
    return s ? [valuePerMillion(s, horizon)] : [];
  });
  return mean(values);
}
