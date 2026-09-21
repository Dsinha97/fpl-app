// Player card: the "#8 FWD" / "Average+" captions under a stat.
//
// A rank is only meaningful against a cohort, and the cohort here is always
// the player's own position — "#8 of 241 forwards" says something, "#96 of
// 667 players" mostly says he isn't a midfielder. Every metric below is
// therefore ranked within `element_type`.
//
// Two things this module refuses to do, both for the same reason (CLAUDE.md:
// "a variance needs far more data than a mean", and don't ship a quietly
// shrunken number):
//
//   1. It returns null, and the caption disappears, when the cohort is too
//      thin to rank in (MIN_COHORT) or when the metric is a rate and the
//      player has too few minutes to have earned one. "#1 FWD" out of four
//      forwards with minutes is worse than no caption at all. Pre-season and
//      early-season this fires constantly, by design.
//
//   2. Bars normalise to the cohort's 95th percentile, not its maximum. One
//      Haaland at the top of a max-normalised scale renders every other
//      forward as a stub, which reads as "nobody scores" rather than "one
//      player is an outlier". Values above p95 clamp to a full bar and say so.

import { supabase } from "./supabase/client";
import { quantile, clamp } from "./stats";

/** Cohorts smaller than this don't get ranked at all. */
const MIN_COHORT = 20;

/** Minutes below which a per-90 or per-appearance metric isn't earned yet. */
const MIN_MINUTES_FOR_RATE = 180;

export const RANK_MODEL_NOTE =
  "Ranks and bars compare this player against others in the same position only. The bar fills to " +
  "the position's 95th percentile rather than its highest value, so a single outlier doesn't " +
  "flatten everyone else — a full bar means top-5% or better, not best. A caption is hidden " +
  "entirely rather than guessed when the position has fewer than " +
  `${MIN_COHORT} players to rank against, or when a per-game metric rests on under ` +
  `${MIN_MINUTES_FOR_RATE} minutes.`;

/** Metrics the card ranks. Add here and in `METRIC_KIND` together. */
export type RankMetric =
  | "total_points"
  | "now_cost"
  | "form"
  | "ownership"
  | "xp_next"
  | "goals"
  | "assists"
  | "minutes"
  | "ppg"
  | "ict";

/**
 * Whether a metric is a rate (needs minutes behind it to mean anything) or a
 * total (a small number is simply a small number, and honest at any minutes).
 */
const METRIC_KIND: Record<RankMetric, "rate" | "total"> = {
  total_points: "total",
  now_cost: "total",
  form: "rate",
  ownership: "total",
  xp_next: "rate",
  goals: "total",
  assists: "total",
  minutes: "total",
  ppg: "rate",
  ict: "total",
};

export type RankBand = "top" | "above" | "average" | "below";

export interface Rank {
  /** 1-based, best first. */
  rank: number;
  /** Cohort size — always shown alongside the rank, never a bare "#8". */
  n: number;
  /** 0-100, higher is better. */
  percentile: number;
  band: RankBand;
  /** 0-1 bar fill, normalised to the cohort's p95. */
  fill: number;
}

/** What a caller must supply per player to be rankable. */
export interface RankablePlayer {
  code: number;
  element_type: number;
  minutes: number | null;
  total_points: number | null;
  now_cost: number | null;
  form: number | null;
  ownership: number | null;
  xp_next: number | null;
  goals: number | null;
  assists: number | null;
  ppg: number | null;
  ict: number | null;
}

interface MetricCohort {
  /** Descending values, for rank lookup. */
  sorted: number[];
  p95: number;
  byCode: Map<number, number>;
}

export interface PositionRanks {
  /** element_type -> metric -> cohort. */
  cohorts: Map<number, Map<RankMetric, MetricCohort>>;
  /** element_type of each ranked player, so `rankOf` needs only a code. */
  positionByCode: Map<number, number>;
  minutesByCode: Map<number, number>;
}

const VALUE_OF: Record<RankMetric, (p: RankablePlayer) => number | null> = {
  total_points: (p) => p.total_points,
  now_cost: (p) => p.now_cost,
  form: (p) => p.form,
  ownership: (p) => p.ownership,
  xp_next: (p) => p.xp_next,
  goals: (p) => p.goals,
  assists: (p) => p.assists,
  minutes: (p) => p.minutes,
  ppg: (p) => p.ppg,
  ict: (p) => p.ict,
};

/**
 * Builds every position-by-metric cohort in one pass.
 *
 * Callers that already hold the full player pool (`/players`, `/builder`)
 * should do this in a `useMemo` — it's pure arithmetic over a few hundred
 * rows and costs nothing. Pages without a pool use `loadPositionRanks`.
 */
export function buildPositionRanks(pool: RankablePlayer[]): PositionRanks {
  const cohorts = new Map<number, Map<RankMetric, MetricCohort>>();
  const positionByCode = new Map<number, number>();
  const minutesByCode = new Map<number, number>();

  const byPosition = new Map<number, RankablePlayer[]>();
  for (const p of pool) {
    positionByCode.set(p.code, p.element_type);
    minutesByCode.set(p.code, p.minutes ?? 0);
    const list = byPosition.get(p.element_type) ?? [];
    list.push(p);
    byPosition.set(p.element_type, list);
  }

  for (const [elementType, players] of byPosition) {
    const perMetric = new Map<RankMetric, MetricCohort>();
    for (const metric of Object.keys(VALUE_OF) as RankMetric[]) {
      const byCode = new Map<number, number>();
      const values: number[] = [];
      for (const p of players) {
        const v = VALUE_OF[metric](p);
        if (v === null || !Number.isFinite(v)) continue;
        byCode.set(p.code, v);
        values.push(v);
      }
      if (values.length < MIN_COHORT) continue; // too thin to rank in at all
      values.sort((a, b) => b - a);
      perMetric.set(metric, { sorted: values, p95: quantile(values, 0.95), byCode });
    }
    cohorts.set(elementType, perMetric);
  }

  return { cohorts, positionByCode, minutesByCode };
}

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; promise: Promise<PositionRanks> }>();

async function fetchPool(season: string): Promise<PositionRanks> {
  const pool: RankablePlayer[] = [];
  // The API caps every response at 1000 rows whatever .limit() asks for, so
  // page until a short page comes back. ~670 players today, but that is not
  // a reason to skip the paging.
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("players")
      .select(
        "code, element_type, minutes, total_points, now_cost, form, selected_by_percent, ep_next, goals_scored, assists, points_per_game, ict_index",
      )
      .eq("season", season)
      .order("code")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    for (const r of page) {
      pool.push({
        code: r.code as number,
        element_type: r.element_type as number,
        minutes: r.minutes as number | null,
        total_points: r.total_points as number | null,
        now_cost: r.now_cost as number | null,
        form: numeric(r.form),
        ownership: numeric(r.selected_by_percent),
        xp_next: numeric(r.ep_next),
        goals: r.goals_scored as number | null,
        assists: r.assists as number | null,
        ppg: numeric(r.points_per_game),
        ict: numeric(r.ict_index),
      });
    }
    if (page.length < 1000) break;
  }
  return buildPositionRanks(pool);
}

/** FPL returns several of these as strings; a non-numeric one is absent, not zero. */
function numeric(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Ranks for pages that don't already hold the player pool (`/team`,
 * `/deadline`, a cold `?player=` deep link). Memoised for 5 minutes; a
 * failure is not memoised. Pages that do hold the pool should call
 * `buildPositionRanks` on it instead of fetching it twice.
 */
export function loadPositionRanks(season: string): Promise<PositionRanks> {
  const hit = cache.get(season);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.promise;

  const promise = fetchPool(season).catch((err: unknown) => {
    cache.delete(season);
    throw err;
  });
  cache.set(season, { at: Date.now(), promise });
  return promise;
}

function bandFor(percentile: number): RankBand {
  if (percentile >= 90) return "top";
  if (percentile >= 66) return "above";
  if (percentile >= 33) return "average";
  return "below";
}

/**
 * One player's standing in a metric, or null when it can't be said honestly.
 *
 * Null — meaning the caption is omitted, not rendered as a dash — when the
 * ranks aren't loaded, the player isn't in the pool, the metric is missing
 * for him, the cohort is under MIN_COHORT, or the metric is a rate resting on
 * under MIN_MINUTES_FOR_RATE minutes.
 */
export function rankOf(
  ranks: PositionRanks | undefined,
  code: number,
  metric: RankMetric,
): Rank | null {
  if (!ranks) return null;

  const elementType = ranks.positionByCode.get(code);
  if (elementType === undefined) return null;

  if (METRIC_KIND[metric] === "rate" && (ranks.minutesByCode.get(code) ?? 0) < MIN_MINUTES_FOR_RATE) {
    return null;
  }

  const cohort = ranks.cohorts.get(elementType)?.get(metric);
  if (!cohort) return null;

  const value = cohort.byCode.get(code);
  if (value === undefined) return null;

  const n = cohort.sorted.length;
  // Ties share the best rank they're entitled to: the first index at this
  // value, not the player's arbitrary position among equals.
  const rank = cohort.sorted.indexOf(value) + 1;
  const percentile = n > 1 ? ((n - rank) / (n - 1)) * 100 : 100;
  const fill = cohort.p95 > 0 ? clamp(value / cohort.p95, 0, 1) : 0;

  return { rank, n, percentile, band: bandFor(percentile), fill };
}

/** Short caption for a rank, e.g. "#8 FWD". Callers supply the position label. */
export const rankCaption = (rank: Rank, positionShort: string): string =>
  `#${rank.rank} ${positionShort}`;

/** Worded band, for metrics where a rank reads as noise but a band doesn't. */
export const BAND_LABELS: Record<RankBand, string> = {
  top: "Top 10%",
  above: "Average+",
  average: "Average",
  below: "Below avg",
};

/** Full sentence for a tooltip — always names the denominator. */
export const rankTooltip = (rank: Rank, positionLong: string): string =>
  `${ordinal(rank.rank)} of ${rank.n} ${positionLong}.`;

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}
