// Expected points model, v1.0.0.
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

export const MODEL_VERSION = "v1.0.0";

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
  positionCalibration: {
    GKP: 1.091,
    DEF: 1.189,
    MID: 1.169,
    FWD: 1.165,
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
} as const;

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
