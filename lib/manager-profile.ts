// Sprint 12A — Manager Percentile Profile.
//
// docs/sources/manager_intelligence_sprint12_change_plan.md proposes normalising
// historical rank against a stored field size. FPL already does this for us:
// entry/{id}/history returns `rank_percentage` per past season at sub-1%
// precision, and it is already ingested into manager_season_history. Building
// a season_field_sizes table to re-derive it would mean inventing historical
// field sizes that no API exposes, to reproduce a number FPL gives away. See
// the "Manager Intelligence" note in docs/roadmap.md for the full comparison.
//
// What genuinely doesn't exist yet is a *profile* over those percentiles —
// best/worst/median, how much they vary, and whether they're trending — which
// is what this module computes. Pure, over data the front end already fetches;
// no new tables, no new Edge Functions.

import { clamp, linearSlope, mean, median, quantile, stdevSample } from "./stats";

/**
 * FPL reports "top X%" — lower is better, and 100 means dead last. Internally
 * everything here is 0-100 with higher better, so it reads the same direction
 * as xP, SquadScore and every other number in the app.
 */
export function percentileScore(rankPercentage: number): number {
  return clamp(100 - rankPercentage, 0, 100);
}

export type RankTier = "Elite" | "Strong" | "Competitive" | "Midfield" | "Chasing";

/** Tier boundaries from the change plan's §18, applied to the median rank_percentage (lower is better). */
const TIER_BOUNDARIES: { max: number; tier: RankTier }[] = [
  { max: 1, tier: "Elite" },
  { max: 10, tier: "Strong" },
  { max: 25, tier: "Competitive" },
  { max: 50, tier: "Midfield" },
  { max: Infinity, tier: "Chasing" },
];

export function rankTier(medianRankPercentage: number): RankTier {
  return TIER_BOUNDARIES.find((b) => medianRankPercentage <= b.max)!.tier;
}

/**
 * Minimum completed seasons before spread/stdev/trend are reported at all.
 * Below this a "spread" is describing noise, not volatility — the same
 * discipline `deriveRatesWithPrior` applies via `minWeightedMinutes` before
 * trusting a per-90 rate. Two points can always be joined by a line, which is
 * exactly why two points should not be allowed to assert a trend.
 */
const MIN_SPREAD_SEASONS = 3;
/** Below this many seasons, spread/stdev/trend are shown but flagged low confidence. */
const MIN_HIGH_CONFIDENCE_SEASONS = 6;

export interface SeasonRecord {
  seasonName: string;
  rankPercentage: number;
}

export interface ManagerProfile {
  seasons: number;
  /** Percentile score (0-100, higher better) for each input season, in the order given. */
  scores: number[];
  best: number;
  bestSeason: string;
  worst: number;
  worstSeason: string;
  median: number;
  mean: number;
  /** P90 - P10 of percentile score. Null below MIN_SPREAD_SEASONS — not zero, not fabricated. */
  spread: number | null;
  /** Sample standard deviation of percentile score. Null below MIN_SPREAD_SEASONS. */
  stdev: number | null;
  /** Percentile-score points per season, oldest to newest as given. Null below MIN_SPREAD_SEASONS. */
  trend: number | null;
  tier: RankTier;
  confidence: "high" | "medium" | "low";
  confidenceReason: string;
}

/**
 * Build a profile from a manager's past-season rank percentages.
 *
 * `records` must already be in a stable order (oldest-to-newest is assumed for
 * `trend`'s sign to mean "improving"); callers read them from
 * `manager_season_history` ordered by `season_name`.
 */
export function buildManagerProfile(records: SeasonRecord[]): ManagerProfile | null {
  if (records.length === 0) return null;

  const scores = records.map((r) => percentileScore(r.rankPercentage));

  let bestIdx = 0;
  let worstIdx = 0;
  scores.forEach((s, i) => {
    if (s > scores[bestIdx]) bestIdx = i;
    if (s < scores[worstIdx]) worstIdx = i;
  });

  const seasons = records.length;
  const med = median(scores);

  const hasSpread = seasons >= MIN_SPREAD_SEASONS;
  const spread = hasSpread ? quantile(scores, 0.9) - quantile(scores, 0.1) : null;
  const stdev = hasSpread ? stdevSample(scores) : null;
  const trend = hasSpread ? linearSlope(scores) : null;

  const confidence: ManagerProfile["confidence"] = seasons < MIN_SPREAD_SEASONS
    ? "low"
    : seasons < MIN_HIGH_CONFIDENCE_SEASONS
    ? "medium"
    : "high";

  const confidenceReason = seasons < MIN_SPREAD_SEASONS
    ? `Only ${seasons} completed season${seasons === 1 ? "" : "s"} — spread and trend need at least ${MIN_SPREAD_SEASONS} to mean anything, so they are not shown.`
    : seasons < MIN_HIGH_CONFIDENCE_SEASONS
    ? `${seasons} completed seasons — enough for a spread, but a longer record would settle it further.`
    : `${seasons} completed seasons of record.`;

  return {
    seasons,
    scores,
    best: scores[bestIdx],
    bestSeason: records[bestIdx].seasonName,
    worst: scores[worstIdx],
    worstSeason: records[worstIdx].seasonName,
    median: med,
    mean: mean(scores),
    spread,
    stdev,
    trend,
    tier: rankTier(100 - med),
    confidence,
    confidenceReason,
  };
}

export interface RivalComparison {
  entryId: number;
  teamName: string;
  seasons: number;
  median: number;
  best: number;
  worst: number;
  /** medianScore(me) - medianScore(rival), in percentile-score points. Positive: I am ahead. */
  gap: number;
}

/**
 * Compare a profile against a rival's, on career medians.
 *
 * Deliberately not a "current season" comparison — the change plan's §17
 * example ("My Percentile 97.2% vs Rival 98.5%") reads as a live in-season
 * figure, but pre-season there is no current rank for anyone. Labelling it
 * "career" here is what stops the UI from implying a number that does not
 * exist yet.
 */
export function compareToRival(
  mine: ManagerProfile,
  rivalEntryId: number,
  rivalTeamName: string,
  rival: ManagerProfile,
): RivalComparison {
  return {
    entryId: rivalEntryId,
    teamName: rivalTeamName,
    seasons: rival.seasons,
    median: rival.median,
    best: rival.best,
    worst: rival.worst,
    gap: mine.median - rival.median,
  };
}
