// Expected points model, v1.1.0.
//
// v1.1.0 adds the cold-start prior layer at the bottom of this file: rates are
// shrunk toward a fitted position/price prior instead of the player being
// dropped for having too few minutes. `predict` itself is unchanged — the prior
// produces the same `Rates` shape the model already consumed.
//
// Implements the nine steps in the build plan. Two deliberate deviations,
// both of which the plan itself sanctions:
//
//  * The fixture multiplier is applied per component rather than once at the
//    end. A hard fixture suppresses attacking returns and clean sheets in
//    opposite directions, so a single scalar cannot express both.
//  * Availability flows through expected minutes instead of a trailing
//    multiplier — the plan's step 9 notes this is the more complete form.
//
// Everything is derived from prior-season per-90 rates. That is the honest
// limit of a pre-season model: it cannot know about a new signing's role or a
// tactical change. Once player_gameweek_stats fills up, current-season form
// should be blended in and these rates reweighted.

export const MODEL_VERSION = "v1.1.0";

export const MODEL_PARAMS = {
  // Recency weights applied to prior seasons, most recent first.
  seasonWeights: [0.6, 0.3, 0.1],
  minWeightedMinutes: 270,

  // Share of starts that reach the 60-minute appearance threshold. Starters
  // are substituted before the hour far less often than the initial 0.85
  // guess implied; the in-sample backtest showed that assumption suppressing
  // both appearance and clean-sheet points across every position.
  startCompletion: 0.92,
  // Minutes that count as a near-certain appearance, for p(played at all).
  appearanceMinutes: 72,

  // Per-position level correction, fitted so that mean predicted points per
  // gameweek matches mean observed points per gameweek over the most recent
  // completed season (see docs/phase-4-model.md). These absorb effects the
  // component model does not represent: finishing above xG, penalties won,
  // and the fact that defensive-contribution counts are over-dispersed
  // relative to the Poisson tail used below. Refit once real gameweek data
  // accumulates — they are a calibration, not a theory.
  //
  // Refitted for v1.1.0. Shrinking rates toward a prior nudged the whole level
  // down by 0.084 points per gameweek, a uniform 1.5-3.7% across the four
  // positions, so the same method was rerun on the same 207-player cohort:
  // GKP x1.0153, DEF x1.0281, MID x1.0365, FWD x1.0277. Pearson r was 0.850
  // before and after, which is the check that matters — a level correction must
  // not disturb the ranking.
  positionCalibration: {
    GKP: 1.1077,
    DEF: 1.2224,
    MID: 1.2116,
    FWD: 1.1972,
  } as Record<string, number>,

  // Fixture sensitivity per FDR step away from average (FDR 3).
  attackAlpha: 0.09,
  defenceAlpha: 0.14,

  // Venue effects. Official FDR already encodes venue partially, so these are
  // deliberately mild to avoid double counting.
  homeAttack: 1.05,
  awayAttack: 0.95,
  homeDefence: 1.06,
  awayDefence: 0.94,

  // Not exposed by the API; fixed by FPL rules.
  savesPerPoint: 3,
  concededPerPenalty: 2,
  // Defensive-contribution thresholds by position id.
  dcThreshold: { 1: 0, 2: 10, 3: 12, 4: 12 } as Record<number, number>,

  maxCleanSheetProbability: 0.85,

  // ---- cold-start prior (v1.1.0) ----------------------------------------
  //
  // Minimum minutes for a player-season to be used when *fitting* the priors.
  // A 40-minute season produces a per-90 rate that is mostly noise, and feeding
  // it into the variance decomposition would inflate sigma2 and so make the
  // shrinkage weaker for everyone.
  minFitMinutes: 450,
  // Weight applied to each season beyond the third when the recent three hold
  // too little football. Continues the decay of seasonWeights rather than
  // restarting it, so a player who already clears the bar on three seasons is
  // scored from exactly the same numbers as before.
  extendedSeasonDecay: 0.5,
  // z for the reported rate band. 1.28 is the 80% two-sided normal quantile.
  bandZ: 1.28,
  // Prior-weight cut-points for the worded reliability label. Chosen to mean
  // something a reader can check: below 0.10 the number is essentially the
  // player's own record, above 0.50 it is mostly the prior talking.
  reliabilityHighBelow: 0.1,
  reliabilityLowAbove: 0.5,
} as const;

/**
 * Price buckets for the prior lookup, in FPL tenths.
 *
 * Coarse deliberately. Finer buckets would empty the cells that matter — there
 * are only six DEF player-seasons above 7.5m in the whole history table — and
 * the point of the bucket is to carry a weak role signal, not to interpolate a
 * price curve. Nothing assumes the bands are ordered: xg90 rises cleanly across
 * midfield bands but is non-monotone for forwards, so this is a fitted lookup.
 */
export const PRICE_BANDS: { label: string; min: number; max: number }[] = [
  { label: "p1_under_45", min: 0, max: 44 },
  { label: "p2_45_49", min: 45, max: 49 },
  { label: "p3_50_59", min: 50, max: 59 },
  { label: "p4_60_74", min: 60, max: 74 },
  { label: "p5_75_89", min: 75, max: 89 },
  { label: "p6_90_up", min: 90, max: Number.MAX_SAFE_INTEGER },
];

export function priceBandOf(nowCost: number): string {
  const band = PRICE_BANDS.find((b) => nowCost >= b.min && nowCost <= b.max);
  return band?.label ?? PRICE_BANDS[0].label;
}

/**
 * The quantities that get a prior and are shrunk toward it.
 *
 * `mpg` and `start_share` are not per-90 rates but they take the same
 * treatment, and they matter most: expected minutes is the largest single
 * driver of xP, and a newcomer has no Premier League minutes at all.
 */
export const PRIOR_METRICS = [
  "xg90",
  "xa90",
  "bonus90",
  "dc90",
  "saves90",
  "xgc90",
  "cs90",
  "yellow90",
  "mpg",
  "start_share",
] as const;

export type PriorMetric = typeof PRIOR_METRICS[number];

export interface ScoringRules {
  /** Points for a given stat, resolved for a position short code. */
  get(stat: string, position: string): number;
}

export interface SeasonRow {
  season_name: string;
  minutes: number | null;
  starts: number | null;
  expected_goals: number | null;
  expected_assists: number | null;
  expected_goals_conceded: number | null;
  clean_sheets: number | null;
  bonus: number | null;
  saves: number | null;
  defensive_contribution: number | null;
  yellow_cards: number | null;
}

export interface Rates {
  weightedMinutes: number;
  minutesPerGame: number;
  startShare: number;
  xg90: number;
  xa90: number;
  bonus90: number;
  dc90: number;
  saves90: number;
  xgc90: number;
  cs90: number;
  yellow90: number;
  seasonsUsed: string[];
}

const GAMES_PER_SEASON = 38;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Blend up to three prior seasons into per-90 rates, weighted toward recent
 * ones. Seasons are matched newest-first by their sort order.
 */
export function deriveRates(rows: SeasonRow[]): Rates | null {
  const sorted = [...rows]
    .filter((r) => (r.minutes ?? 0) > 0)
    .sort((a, b) => b.season_name.localeCompare(a.season_name))
    .slice(0, MODEL_PARAMS.seasonWeights.length);

  if (sorted.length === 0) return null;

  let wMinutes = 0, wStarts = 0, wGames = 0;
  let xg = 0, xa = 0, bonus = 0, dc = 0, saves = 0, xgc = 0, cs = 0, yellow = 0;

  sorted.forEach((r, i) => {
    const w = MODEL_PARAMS.seasonWeights[i];
    wMinutes += w * (r.minutes ?? 0);
    wStarts += w * (r.starts ?? 0);
    wGames += w * GAMES_PER_SEASON;
    xg += w * (r.expected_goals ?? 0);
    xa += w * (r.expected_assists ?? 0);
    bonus += w * (r.bonus ?? 0);
    dc += w * (r.defensive_contribution ?? 0);
    saves += w * (r.saves ?? 0);
    xgc += w * (r.expected_goals_conceded ?? 0);
    cs += w * (r.clean_sheets ?? 0);
    yellow += w * (r.yellow_cards ?? 0);
  });

  // Too little football to build a stable rate from. Returning null is more
  // honest than emitting a confident number off 90 minutes of evidence.
  if (wMinutes < MODEL_PARAMS.minWeightedMinutes) return null;

  const per90 = (total: number) => (wMinutes > 0 ? (total / wMinutes) * 90 : 0);

  return {
    weightedMinutes: wMinutes,
    minutesPerGame: wGames > 0 ? wMinutes / wGames : 0,
    startShare: wGames > 0 ? clamp(wStarts / wGames, 0, 1) : 0,
    xg90: per90(xg),
    xa90: per90(xa),
    bonus90: per90(bonus),
    dc90: per90(dc),
    saves90: per90(saves),
    xgc90: per90(xgc),
    cs90: per90(cs),
    yellow90: per90(yellow),
    seasonsUsed: sorted.map((r) => r.season_name),
  };
}

// ===========================================================================
// Cold-start prior layer (v1.1.0)
//
// `deriveRates` above returns null below `minWeightedMinutes`, and the caller
// used to skip the player entirely — 187 of 567 players got no projection. Half
// of them had Premier League minutes that the gate discarded wholesale: at 269
// weighted minutes you got nothing, at 271 a full-confidence point estimate.
//
// The replacement shrinks a player's own rates toward a fitted prior in
// proportion to the evidence behind them:
//
//     w_prior = sigma2 / (n_eff * tau2 + sigma2)
//     mu_post = w_prior * mu_prior + (1 - w_prior) * own_rate
//
// The two variances are *measured*, not chosen — sigma2 from how much one
// player's own rate moves between seasons, tau2 from how much players in the
// same position and price band genuinely differ. Measured off this same history
// table, that yields a prior weight of 39% at 90 minutes, 18% at the old cliff
// and under 3% at 2,000, which is why established players barely move.
//
// Deliberately absent: no cap on n_eff. Capping it (the design document
// suggested 5) would leave a permanent 5-10% prior on every established player
// and move 380 settled numbers for no reason.
// ===========================================================================

/** Reserved band label for the position-wide fallback rung. */
export const POSITION_FALLBACK_BAND = "_position";

export interface PriorCell {
  positionId: number;
  priceBand: string;
  metric: string;
  mu: number;
  /** Within-player, season-to-season variance. Numerator of the weight. */
  sigma2: number;
  /**
   * Between-player variance, estimated per *position* rather than per band —
   * a variance needs far more data than a mean, and the per-band estimate
   * collapsed to zero on thin cells. Price informs `mu`; the position informs
   * the spread. Repeated on every cell of a position, by design.
   */
  tau2: number;
  sampleSize: number;
  shrunkTowardPosition: boolean;
}

export interface PriorSet {
  cells: PriorCell[];
  /** Band first, then the position-wide fallback. Undefined if neither exists. */
  lookup(positionId: number, priceBand: string, metric: string): PriorCell | undefined;
}

/** One prior-season row plus the context needed to bucket it. */
export interface FitRow extends SeasonRow {
  player_code: number;
  positionId: number;
  /** Band from that season's own start_cost, not today's price — no hindsight. */
  priceBand: string;
}

/** Per-90 (or per-game) value of one metric for a single season. */
function metricValue(row: SeasonRow, metric: PriorMetric): number | null {
  const minutes = row.minutes ?? 0;
  if (minutes <= 0) return null;

  const per90 = (total: number | null) => ((total ?? 0) / minutes) * 90;

  switch (metric) {
    case "xg90":
      return per90(row.expected_goals);
    case "xa90":
      return per90(row.expected_assists);
    case "bonus90":
      return per90(row.bonus);
    case "dc90":
      return per90(row.defensive_contribution);
    case "saves90":
      return per90(row.saves);
    case "xgc90":
      return per90(row.expected_goals_conceded);
    case "cs90":
      return per90(row.clean_sheets);
    case "yellow90":
      return per90(row.yellow_cards);
    // Per *game* against the nominal 38, matching how deriveRates computes them.
    case "mpg":
      return minutes / GAMES_PER_SEASON;
    case "start_share":
      return clamp((row.starts ?? 0) / GAMES_PER_SEASON, 0, 1);
  }
}

const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

/** Sample variance. Zero for fewer than two observations — not undefined. */
function variance(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1);
}

/**
 * Fit the empirical-Bayes priors from prior-season history.
 *
 * Two levels of shrinkage, both estimated:
 *
 *  * `sigma2` is pooled per position rather than per band. Splitting it by band
 *    would leave a handful of players per cell, and how noisy a player's own
 *    per-90 rate is between seasons is a property of the metric and position,
 *    not of what he costs.
 *  * A thin band's mean is pulled toward the position-wide mean by the same
 *    formula, using the spread *between* bands as the prior. So no pseudo-count
 *    is invented: a band with plenty of players speaks for itself, one with six
 *    barely moves the position mean.
 */
export function fitRatePriors(rows: FitRow[]): PriorSet {
  const cells: PriorCell[] = [];
  const positions = [...new Set(rows.map((r) => r.positionId))];

  for (const positionId of positions) {
    for (const metric of PRIOR_METRICS) {
      // The minutes floor exists so a per-90 rate is computed off enough
      // football to mean something. Applying it to `mpg` and `start_share`
      // would be a selection bias on the very quantity being predicted: fitting
      // "how much does he play" only on seasons of 450+ minutes yields a prior
      // that says every player is a starter, and then tells a fringe defender
      // who genuinely averages 11 minutes that he averages 47.
      const isPlayingTime = metric === "mpg" || metric === "start_share";
      const floor = isPlayingTime ? 1 : MODEL_PARAMS.minFitMinutes;
      const inPosition = rows.filter(
        (r) => r.positionId === positionId && (r.minutes ?? 0) >= floor,
      );
      // Player -> that player's season values for this metric.
      const byPlayer = new Map<number, { value: number; band: string }[]>();
      for (const row of inPosition) {
        const value = metricValue(row, metric);
        if (value === null || !Number.isFinite(value)) continue;
        const list = byPlayer.get(row.player_code);
        const entry = { value, band: row.priceBand };
        if (list) list.push(entry);
        else byPlayer.set(row.player_code, [entry]);
      }
      if (byPlayer.size === 0) continue;

      // sigma2: mean of each player's own between-season variance, over players
      // who have at least two seasons to compare.
      const withinVariances = [...byPlayer.values()]
        .filter((seasons) => seasons.length >= 2)
        .map((seasons) => variance(seasons.map((s) => s.value)));
      const sigma2 = withinVariances.length > 0 ? mean(withinVariances) : 0;

      // A player is one observation, represented by his mean and his most
      // recent band, so a long career does not outvote a short one.
      const players = [...byPlayer.entries()].map(([code, seasons]) => ({
        code,
        value: mean(seasons.map((s) => s.value)),
        band: seasons[seasons.length - 1].band,
        n: seasons.length,
      }));

      const positionMu = mean(players.map((p) => p.value));
      const meanSeasons = Math.max(1, mean(players.map((p) => p.n)));

      // tau2 is estimated ONCE per position, not per price band.
      //
      // Var(observed player means) = tau2 + sigma2 / seasons_per_player, so the
      // genuine between-player variance is what remains after removing the noise
      // in each player's own estimate. Estimating it inside a single price band
      // is what broke the first attempt: a variance needs far more data than a
      // mean, and at n=3..15 the band estimate collapsed to zero, which drove the
      // prior weight to 1.00 and let the prior override real evidence entirely.
      //
      // So price is used for what it genuinely informs — the mean, which rises
      // cleanly with price — while the spread is taken from the whole position,
      // where there are hundreds of observations.
      const positionTau2 = Math.max(
        0,
        variance(players.map((p) => p.value)) - sigma2 / meanSeasons,
      );

      const bandStats = PRICE_BANDS.map((band) => {
        const members = players.filter((p) => p.band === band.label);
        return {
          label: band.label,
          n: members.length,
          rawMu: members.length > 0 ? mean(members.map((p) => p.value)) : positionMu,
        };
      }).filter((b) => b.n > 0);

      // Spread of the band means around the position mean: how much price
      // actually tells us. Small spread means the bands are interchangeable and
      // a thin band should collapse onto the position mean.
      const betweenBandVar = variance(bandStats.map((b) => b.rawMu));

      for (const band of bandStats) {
        // Shrink the band mean toward the position mean by the same shape of
        // formula, one level up — so a band of six players barely moves it.
        const muVariance = (positionTau2 + sigma2) / band.n;
        const wPosition = betweenBandVar > 0 ? muVariance / (muVariance + betweenBandVar) : 1;
        const mu = wPosition * positionMu + (1 - wPosition) * band.rawMu;

        cells.push({
          positionId,
          priceBand: band.label,
          metric,
          mu: Number.isFinite(mu) ? mu : positionMu,
          sigma2,
          tau2: positionTau2,
          sampleSize: band.n,
          shrunkTowardPosition: wPosition > 0.5,
        });
      }

      // A position-wide fallback, for a band with no history at all.
      cells.push({
        positionId,
        priceBand: POSITION_FALLBACK_BAND,
        metric,
        mu: positionMu,
        sigma2,
        tau2: positionTau2,
        sampleSize: players.length,
        shrunkTowardPosition: true,
      });
    }
  }

  const index = new Map<string, PriorCell>();
  for (const cell of cells) {
    index.set(`${cell.positionId}|${cell.priceBand}|${cell.metric}`, cell);
  }

  return {
    cells,
    lookup(positionId, priceBand, metric) {
      return index.get(`${positionId}|${priceBand}|${metric}`) ??
        index.get(`${positionId}|${POSITION_FALLBACK_BAND}|${metric}`);
    },
  };
}

export type PriorSource =
  | "pl_recent"
  | "pl_extended"
  | "position_price"
  | "position_baseline";

export interface RateEvidence {
  /** Evidence in 90-minute units. Uncapped, on purpose. */
  nEff: number;
  weightedMinutes: number;
  seasonsUsed: string[];
  /** Mean prior share across the metrics that carry one. */
  priorWeight: number;
  priorSource: PriorSource;
  reliability: "high" | "medium" | "low";
  /** Posterior sd per metric, for the reported band. */
  sd: Record<string, number>;
}

export interface ShrunkRates {
  rates: Rates;
  evidence: RateEvidence;
}

/** Own per-90 rates from a weighted set of seasons, with the weights applied. */
function weightedOwnRates(rows: SeasonRow[], weights: number[]) {
  let wMinutes = 0, wStarts = 0, wGames = 0;
  const totals: Record<string, number> = {
    xg: 0, xa: 0, bonus: 0, dc: 0, saves: 0, xgc: 0, cs: 0, yellow: 0,
  };

  rows.forEach((r, i) => {
    const w = weights[i] ?? 0;
    wMinutes += w * (r.minutes ?? 0);
    wStarts += w * (r.starts ?? 0);
    wGames += w * GAMES_PER_SEASON;
    totals.xg += w * (r.expected_goals ?? 0);
    totals.xa += w * (r.expected_assists ?? 0);
    totals.bonus += w * (r.bonus ?? 0);
    totals.dc += w * (r.defensive_contribution ?? 0);
    totals.saves += w * (r.saves ?? 0);
    totals.xgc += w * (r.expected_goals_conceded ?? 0);
    totals.cs += w * (r.clean_sheets ?? 0);
    totals.yellow += w * (r.yellow_cards ?? 0);
  });

  const per90 = (total: number) => (wMinutes > 0 ? (total / wMinutes) * 90 : 0);

  return {
    wMinutes,
    own: {
      xg90: per90(totals.xg),
      xa90: per90(totals.xa),
      bonus90: per90(totals.bonus),
      dc90: per90(totals.dc),
      saves90: per90(totals.saves),
      xgc90: per90(totals.xgc),
      cs90: per90(totals.cs),
      yellow90: per90(totals.yellow),
      mpg: wGames > 0 ? wMinutes / wGames : 0,
      start_share: wGames > 0 ? clamp(wStarts / wGames, 0, 1) : 0,
    } as Record<PriorMetric, number>,
  };
}

export interface ShrinkInput {
  rows: SeasonRow[];
  positionId: number;
  /** From the player's *current* price — this is a forward-looking prior. */
  priceBand: string;
  priors: PriorSet;
}

/**
 * Rates for one player, shrunk toward the fitted prior.
 *
 * Returns null only when there is no evidence *and* no prior to fall back on —
 * the single genuine abstention left. Everything else gets a number plus an
 * honest statement of how much of it is the prior talking.
 */
export function deriveRatesWithPrior(input: ShrinkInput): ShrunkRates | null {
  const { rows, positionId, priceBand, priors } = input;
  const P = MODEL_PARAMS;

  const played = [...rows]
    .filter((r) => (r.minutes ?? 0) > 0)
    .sort((a, b) => b.season_name.localeCompare(a.season_name));

  // The recent-three window, with exactly the weights v1.0.0 used, so a player
  // who already cleared the old gate is scored from identical own-rates.
  const recent = played.slice(0, P.seasonWeights.length);
  let used = recent;
  let weights: number[] = [...P.seasonWeights];
  let priorSource: PriorSource = "pl_recent";

  let { wMinutes, own } = weightedOwnRates(used, weights);

  // Thin recent record but a longer career — Nelson has nine PL seasons and
  // 1,914 minutes and used to get nothing at all, because only three were read.
  if (wMinutes < P.minWeightedMinutes && played.length > recent.length) {
    used = played;
    weights = played.map((_, i) =>
      i < P.seasonWeights.length
        ? P.seasonWeights[i]
        : P.seasonWeights[P.seasonWeights.length - 1] *
          P.extendedSeasonDecay ** (i - P.seasonWeights.length + 1)
    );
    ({ wMinutes, own } = weightedOwnRates(used, weights));
    priorSource = "pl_extended";
  }

  const hasEvidence = wMinutes > 0;
  const nEff = wMinutes / 90;

  if (!hasEvidence) {
    // No Premier League football at all. The prior is the whole estimate, so
    // name the rung after where it came from.
    const probe = priors.lookup(positionId, priceBand, "mpg");
    if (!probe) return null;
    priorSource = probe.priceBand === POSITION_FALLBACK_BAND
      ? "position_baseline"
      : "position_price";
  }

  const posterior: Record<string, number> = {};
  const sd: Record<string, number> = {};
  // Weighted by how much each metric actually matters to this position, so the
  // headline figure is not diluted by metrics that are degenerate here. An
  // unweighted mean reported a midfielder as half prior-driven purely because
  // his saves90 and clean-sheet rates are near zero for everyone in the
  // position, which makes their prior weight 1 and says nothing about him.
  const priorWeights: { w: number; importance: number }[] = [];

  for (const metric of PRIOR_METRICS) {
    const cell = priors.lookup(positionId, priceBand, metric);
    const ownValue = own[metric];

    if (!cell) {
      // No prior for this metric — keep the player's own number and say the
      // prior contributed nothing, rather than inventing one.
      posterior[metric] = ownValue;
      sd[metric] = 0;
      continue;
    }

    const { mu, sigma2, tau2 } = cell;

    // Degenerate metric: every player in the position records the same value,
    // so there is nothing to shrink and nothing to divide by. A keeper's xg90
    // is exactly this case.
    const denominator = nEff * tau2 + sigma2;
    let wPrior: number;
    if (!hasEvidence) wPrior = 1;
    else if (denominator <= 0) wPrior = tau2 <= 0 ? 1 : 0;
    else wPrior = sigma2 / denominator;
    wPrior = clamp(wPrior, 0, 1);

    posterior[metric] = wPrior * mu + (1 - wPrior) * ownValue;

    // Conjugate normal posterior variance. Zero precision on either side
    // collapses the band rather than producing an infinity.
    const precision = (tau2 > 0 ? 1 / tau2 : 0) + (sigma2 > 0 ? nEff / sigma2 : 0);
    sd[metric] = precision > 0 ? Math.sqrt(1 / precision) : 0;

    // Minutes and starts dominate xP, but reporting their prior share alongside
    // eight scoring rates would drown the signal, so the headline figure is the
    // scoring rates only.
    if (metric !== "mpg" && metric !== "start_share") {
      priorWeights.push({ w: wPrior, importance: Math.max(0, mu) });
    }
  }

  const importanceTotal = priorWeights.reduce((a, p) => a + p.importance, 0);
  const priorWeight = importanceTotal > 0
    ? priorWeights.reduce((a, p) => a + p.w * p.importance, 0) / importanceTotal
    : priorWeights.length > 0
    ? mean(priorWeights.map((p) => p.w))
    : 1;

  const reliability: RateEvidence["reliability"] = !hasEvidence
    ? "low"
    : priorWeight < P.reliabilityHighBelow
    ? "high"
    : priorWeight > P.reliabilityLowAbove
    ? "low"
    : "medium";

  const rates: Rates = {
    weightedMinutes: wMinutes,
    minutesPerGame: Math.max(0, posterior.mpg),
    startShare: clamp(posterior.start_share, 0, 1),
    xg90: Math.max(0, posterior.xg90),
    xa90: Math.max(0, posterior.xa90),
    bonus90: Math.max(0, posterior.bonus90),
    dc90: Math.max(0, posterior.dc90),
    saves90: Math.max(0, posterior.saves90),
    xgc90: Math.max(0, posterior.xgc90),
    cs90: clamp(posterior.cs90, 0, 1),
    yellow90: Math.max(0, posterior.yellow90),
    seasonsUsed: used.map((r) => r.season_name),
  };

  return {
    rates,
    evidence: {
      nEff,
      weightedMinutes: wMinutes,
      seasonsUsed: rates.seasonsUsed,
      priorWeight,
      priorSource,
      reliability,
      sd,
    },
  };
}

/**
 * The same rates displaced by `z` posterior standard deviations.
 *
 * Running `predict` at these gives a **rate-uncertainty band**, not a prediction
 * interval: it answers "how wrong could the underlying rates be?" and ignores
 * match-to-match Poisson noise entirely, so it is narrower than the spread of
 * actual outcomes. `COLD_START_MODEL_NOTE` says so wherever it is shown.
 */
export function ratesAtBound(rates: Rates, evidence: RateEvidence, z: number): Rates {
  const shift = (value: number, metric: PriorMetric, lo = 0, hi = Infinity) =>
    clamp(value + z * (evidence.sd[metric] ?? 0), lo, hi);

  return {
    ...rates,
    minutesPerGame: shift(rates.minutesPerGame, "mpg", 0, 90),
    startShare: shift(rates.startShare, "start_share", 0, 1),
    xg90: shift(rates.xg90, "xg90"),
    xa90: shift(rates.xa90, "xa90"),
    bonus90: shift(rates.bonus90, "bonus90"),
    dc90: shift(rates.dc90, "dc90"),
    saves90: shift(rates.saves90, "saves90"),
    // A worse defensive fixture means *more* goals conceded, so the pessimistic
    // end of this rate is the high one — the sign is deliberately not flipped.
    xgc90: shift(rates.xgc90, "xgc90"),
    cs90: shift(rates.cs90, "cs90", 0, 1),
    yellow90: shift(rates.yellow90, "yellow90"),
  };
}

export const COLD_START_MODEL_NOTE =
  "Players with little or no Premier League record are projected by shrinking their own rates toward " +
  "a prior fitted from position and price, weighted by how many minutes they have actually played. " +
  "The low and high figures are a rate-uncertainty band, not a prediction interval — they ignore " +
  "match-to-match variance and are therefore narrower than real outcomes. No external-league data is " +
  "used yet, so a promoted-club player's prior rests on position, price and role alone, and team " +
  "attacking strength is omitted entirely because the API reports it as zero for all twenty clubs " +
  "pre-season.";

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

/**
 * E[floor(X / d)] for X ~ Poisson(lambda) — FPL awards saves per 3 and the
 * goals-conceded penalty per 2, so the naive lambda/d overstates both.
 */
export function expectedFloorDiv(lambda: number, d: number): number {
  if (lambda <= 0) return 0;
  let term = Math.exp(-lambda);
  let expectation = 0;
  const limit = Math.max(20, Math.ceil(lambda + 8 * Math.sqrt(lambda)));

  for (let x = 0; x <= limit; x++) {
    if (x > 0) term *= lambda / x;
    expectation += Math.floor(x / d) * term;
  }
  return expectation;
}

export interface PlayerInput {
  positionId: number;
  positionCode: string;
  status: string | null;
  chanceNextRound: number | null;
}

export interface FixtureInput {
  fdr: number;
  isHome: boolean;
}

export interface Prediction {
  expectedMinutes: number;
  startProbability: number;
  p60: number;
  availability: number;
  attackMultiplier: number;
  defenceMultiplier: number;
  components: {
    appearance: number;
    goals: number;
    assists: number;
    cleanSheet: number;
    goalsConceded: number;
    saves: number;
    bonus: number;
    defensiveContribution: number;
    cards: number;
  };
  xp: number;
}

/** Availability as a probability, from FPL's status code and injury flag. */
export function availabilityOf(player: PlayerInput): number {
  const chance = player.chanceNextRound;
  if (chance !== null && chance !== undefined) return clamp(chance / 100, 0, 1);
  return player.status === "a" ? 1 : 0;
}

export function predict(
  player: PlayerInput,
  rates: Rates,
  fixture: FixtureInput,
  scoring: ScoringRules,
): Prediction {
  const P = MODEL_PARAMS;
  const pos = player.positionCode;

  // --- step 9 (folded in first): availability drives minutes -------------
  const availability = availabilityOf(player);
  const expectedMinutes = rates.minutesPerGame * availability;
  const minuteShare = expectedMinutes / 90;

  // --- step 1 & 2: minutes and appearance points -------------------------
  const startProbability = rates.startShare * availability;
  const p60 = clamp(startProbability * P.startCompletion, 0, 1);
  const pAny = clamp(expectedMinutes / P.appearanceMinutes, 0, 1);
  const p1to59 = clamp(pAny - p60, 0, 1);

  const appearance = scoring.get("long_play", pos) * p60 +
    scoring.get("short_play", pos) * p1to59;

  // --- step 8: fixture multipliers ---------------------------------------
  const fdrDelta = 3 - fixture.fdr;
  const attackMultiplier = (1 + P.attackAlpha * fdrDelta) *
    (fixture.isHome ? P.homeAttack : P.awayAttack);
  const defenceMultiplier = (1 + P.defenceAlpha * fdrDelta) *
    (fixture.isHome ? P.homeDefence : P.awayDefence);

  // --- step 3: attacking returns -----------------------------------------
  const goals = rates.xg90 * minuteShare * attackMultiplier *
    scoring.get("goals_scored", pos);
  const assists = rates.xa90 * minuteShare * attackMultiplier *
    scoring.get("assists", pos);

  // --- step 4: clean sheet ------------------------------------------------
  // The player's own clean-sheet rate is a serviceable proxy for their team's,
  // scaled by how favourable this particular fixture is defensively.
  const csProbability = clamp(
    rates.cs90 * defenceMultiplier,
    0,
    P.maxCleanSheetProbability,
  );
  const cleanSheet = csProbability * p60 * scoring.get("clean_sheets", pos);

  // --- step 6: goals conceded and saves -----------------------------------
  // A better fixture (higher defence multiplier) means fewer goals against.
  const lambdaConceded = defenceMultiplier > 0
    ? (rates.xgc90 * minuteShare) / defenceMultiplier
    : 0;
  const goalsConceded = scoring.get("goals_conceded", pos) *
    expectedFloorDiv(lambdaConceded, P.concededPerPenalty);

  const lambdaSaves = defenceMultiplier > 0
    ? (rates.saves90 * minuteShare) / defenceMultiplier
    : 0;
  const saves = scoring.get("saves", pos) *
    expectedFloorDiv(lambdaSaves, P.savesPerPoint);

  // --- step 5: bonus and defensive contribution ---------------------------
  // Bonus tracks both attacking output and clean sheets, so it is scaled by
  // the average of the two multipliers rather than either alone.
  const bonus = rates.bonus90 * minuteShare *
    ((attackMultiplier + defenceMultiplier) / 2);

  // Defensive actions per match are a count, so the probability of clearing
  // the threshold is a Poisson tail rather than a ratio.
  const threshold = P.dcThreshold[player.positionId] ?? 0;
  const dcPoints = scoring.get("defensive_contribution", pos);
  const defensiveContribution = threshold > 0
    ? poissonAtLeast(rates.dc90 * minuteShare, threshold) * dcPoints
    : 0;

  const cards = rates.yellow90 * minuteShare * scoring.get("yellow_cards", pos);

  const components = {
    appearance,
    goals,
    assists,
    cleanSheet,
    goalsConceded,
    saves,
    bonus,
    defensiveContribution,
    cards,
  };

  const rawXp = Object.values(components).reduce((a, b) => a + b, 0);
  const xp = rawXp * (P.positionCalibration[pos] ?? 1);

  return {
    expectedMinutes,
    startProbability,
    p60,
    availability,
    attackMultiplier,
    defenceMultiplier,
    components,
    xp,
  };
}
