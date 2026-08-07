// Sprint 4 — Risk Engine, Player Comparison, and Replacement Finder.
//
// All pure. The comparison and replacement engines both rank players, so they
// share one candidate shape and one risk model.

import {
  horizonLabel,
  horizonLength,
  type Horizon,
  type PlayerMeta,
  type SquadRules,
  type TeamState,
} from "./team-state";
import { clamp, mean, stdevPopulation } from "./stats";

export interface ScoredPlayer {
  id: number;
  webName: string;
  elementType: number;
  teamId: number;
  teamShort: string | null;
  price: number;
  ownership: number | null;
  /** Last completed season's points per game — real data pre-season. */
  pointsPerGame: number | null;
  xp: Record<Horizon, number | null>;
  /** Rate-uncertainty band. Optional — only exists from model v1.1.0. */
  xpLower?: Record<Horizon, number | null>;
  xpUpper?: Record<Horizon, number | null>;
  /** How much of the projection is the prior rather than the player's record. */
  reliability?: "high" | "medium" | "low";
  /** 0 = pure Premier League evidence, 1 = pure prior. */
  priorWeight?: number | null;
  expectedMinutes: number | null;
  startProbability: number | null;
  /** 0–1 from status / chance_of_playing. */
  availability: number;
  /** Official FDR for each of the next fixtures, in gameweek order. */
  fdrRun: number[];
}

/**
 * Front-end copy of `COLD_START_MODEL_NOTE` from
 * `supabase/functions/_shared/xp-model.ts`. Duplicated deliberately: that file is
 * Deno and excluded from tsconfig, so importing it here would break `tsc`. Keep
 * the two in step.
 */
export const COLD_START_NOTE =
  "Players with little or no Premier League record are projected by shrinking their own rates toward " +
  "a prior fitted from position and price, weighted by how many minutes they have actually played. " +
  "The low and high figures are a rate-uncertainty band, not a prediction interval — they ignore " +
  "match-to-match variance and are therefore narrower than real outcomes. No external-league data is " +
  "used yet, so a promoted-club player's prior rests on position, price and role alone, and team " +
  "attacking strength is omitted entirely because the API reports it as zero for all twenty clubs " +
  "pre-season. Since v1.2.0, every club's squad is also reconciled so exactly eleven players and one " +
  "goalkeeper start each fixture, so a player's number now depends on their team-mates too — where a " +
  "squad's raw numbers fall short of eleven (promoted clubs, mainly) or run past it (deep, expensive " +
  "squads), the shortfall or surplus is spread across the squad in proportion to existing estimates, " +
  "capped at each player's own chance of playing. This fixes how much a club plays, not how well — " +
  "team strength is still zero for all twenty clubs, so it is a role estimate, not a quality one — and " +
  "it does not order players within a position, so understudies can end up sharing a start rather than " +
  "one being picked out as first choice. It also does not distinguish an established starter from a " +
  "fringe squad member on the same price band: at a large, deep squad the correction is spread evenly " +
  "across everyone in a position, so a nailed starter can be pulled down by the same proportion as a " +
  "reserve who should have moved far more and the starter far less.";

/** Worded confidence for a projection, for badges and tooltips. */
export const RELIABILITY_LABELS: Record<"high" | "medium" | "low", string> = {
  high: "Projection rests on this player's own Premier League record.",
  medium: "Partly prior-based — a thin Premier League record, so the number leans on players of the same position and price.",
  low: "Mostly prior-based. Little or no Premier League football, so treat the number as an expectation for the price bracket rather than a read on him.",
};

/**
 * How many fixtures a horizon covers, for slicing the FDR run.
 *
 * Not the identity function any more: "season" is not a number, and an FDR run
 * never holds more entries than were fetched anyway, so over-slicing is safe.
 */
const fixturesFor = (horizon: Horizon, seasonWindow?: number) => horizonLength(horizon, seasonWindow);

// ------------------------------------------------------------ risk engine
//
// The revised plan's weights:
//
//   0.30 x Rotation + 0.25 x Injury + 0.20 x Minutes + 0.15 x FixtureVariance
//   - 0.10 x EffectiveOwnership
//
// Effective ownership needs the top-1k template pipeline, which cannot run until
// a gameweek has been scored — league 314 returns an empty standings array
// pre-season. So the EO term is dropped and the four remaining weights are
// renormalised over 0.90, the same treatment Form gets in ComparisonScore.
//
// Reported 0-100, lower is better.

export const RISK_WEIGHTS = {
  rotation: 0.3 / 0.9,
  injury: 0.25 / 0.9,
  minutes: 0.2 / 0.9,
  fixtureVariance: 0.15 / 0.9,
} as const;

export const RISK_MODEL_NOTE =
  "Effective ownership is omitted — it needs the top-1k template snapshot, which cannot be built " +
  "until a gameweek has been scored. The remaining weights are renormalised, so risk here measures " +
  "how likely a player is to disappoint, not how much of the field owns him.";

/** Widest plausible spread of FDR values, used to normalise the variance term. */
const MAX_FDR_SD = 1.6;

export function riskScore(p: ScoredPlayer, horizon: Horizon, seasonWindow?: number): number {
  const rotation = 1 - (p.startProbability ?? p.availability);
  const injury = 1 - p.availability;

  // Minutes uncertainty peaks in the middle: a player nailed on for 90 and one
  // certain not to feature are both predictable; a 45-minute player is not.
  const share = p.expectedMinutes === null ? 0.5 : clamp(p.expectedMinutes / 90, 0, 1);
  const minutes = 1 - Math.abs(share - 0.5) * 2;

  const run = p.fdrRun.slice(0, fixturesFor(horizon, seasonWindow));
  const fixtureVariance = clamp(stdevPopulation(run) / MAX_FDR_SD, 0, 1);

  const raw =
    RISK_WEIGHTS.rotation * clamp(rotation, 0, 1) +
    RISK_WEIGHTS.injury * clamp(injury, 0, 1) +
    RISK_WEIGHTS.minutes * clamp(minutes, 0, 1) +
    RISK_WEIGHTS.fixtureVariance * fixtureVariance;

  return Math.round(raw * 100);
}

// ------------------------------------------------- fixture score (0-1)

/** Mean difficulty over the horizon, mapped so 1 is the kindest run. */
export function fixtureScore(p: ScoredPlayer, horizon: Horizon, seasonWindow?: number): number {
  const run = p.fdrRun.slice(0, fixturesFor(horizon, seasonWindow));
  if (run.length === 0) return 0.5;
  return clamp((5 - mean(run)) / 4, 0, 1);
}

export const xpFor = (p: ScoredPlayer, horizon: Horizon): number => p.xp[horizon] ?? 0;

/** Expected points per million, the plan's "Value". */
export const valuePerMillion = (p: ScoredPlayer, horizon: Horizon): number =>
  p.price > 0 ? xpFor(p, horizon) / (p.price / 10) : 0;

// ------------------------------------------------------ comparison score
//
// The plan's formula is:
//
//   0.40 x xP + 0.20 x FixtureScore + 0.15 x Value + 0.15 x Minutes
//   + 0.10 x Form - RiskPenalty
//
// FPL zeroes `form` between seasons — it is a 30-day rolling average, so every
// one of the 564 players reads 0.0 until matches are played. Rather than
// multiply that term by zero and quietly shrink every score, it is dropped and
// the remaining weights renormalised over 0.90. Last season's points per game
// is shown as its own column instead: informative, but genuinely not form.

export const COMPARISON_WEIGHTS = {
  xp: 0.4 / 0.9,
  fixture: 0.2 / 0.9,
  value: 0.15 / 0.9,
  minutes: 0.15 / 0.9,
} as const;

export const COMPARISON_MODEL_NOTE =
  "Form is omitted — FPL resets it between seasons, so it reads zero for every player until " +
  "matches are played. The remaining weights are renormalised; last season's points per game " +
  "is shown separately.";

export interface ComparisonRow {
  player: ScoredPlayer;
  score: number;
  xp: number;
  valuePerMillion: number;
  fixture: number;
  minutes: number;
  risk: number;
  strengths: string[];
  weaknesses: string[];
}

/**
 * Rank a small set of players. xP and value are normalised across the set
 * rather than against the whole league, so the score answers "which of these"
 * rather than "how good in the abstract".
 */
export function comparePlayers(
  players: ScoredPlayer[],
  horizon: Horizon,
  seasonWindow?: number,
): ComparisonRow[] {
  if (players.length === 0) return [];

  const maxXp = Math.max(...players.map((p) => xpFor(p, horizon)), 0);
  const maxValue = Math.max(...players.map((p) => valuePerMillion(p, horizon)), 0);

  const rows = players.map((player) => {
    const xp = xpFor(player, horizon);
    const value = valuePerMillion(player, horizon);
    const fixture = fixtureScore(player, horizon, seasonWindow);
    const minutes = player.startProbability ?? player.availability;
    const risk = riskScore(player, horizon, seasonWindow);

    const score =
      COMPARISON_WEIGHTS.xp * (maxXp > 0 ? xp / maxXp : 0) +
      COMPARISON_WEIGHTS.fixture * fixture +
      COMPARISON_WEIGHTS.value * (maxValue > 0 ? value / maxValue : 0) +
      COMPARISON_WEIGHTS.minutes * minutes -
      risk / 100;

    return { player, score, xp, valuePerMillion: value, fixture, minutes, risk };
  });

  // Strengths and weaknesses are stated relative to the group, which is the
  // only comparison a two-player table can honestly support.
  const best = {
    xp: Math.max(...rows.map((r) => r.xp)),
    value: Math.max(...rows.map((r) => r.valuePerMillion)),
    fixture: Math.max(...rows.map((r) => r.fixture)),
    minutes: Math.max(...rows.map((r) => r.minutes)),
    risk: Math.min(...rows.map((r) => r.risk)),
  };

  return rows
    .map((r) => {
      const strengths: string[] = [];
      const weaknesses: string[] = [];

      if (rows.length > 1) {
        if (r.xp === best.xp && r.xp > 0) strengths.push(`Highest xP (${r.xp.toFixed(1)})`);
        if (r.valuePerMillion === best.value && r.valuePerMillion > 0) {
          strengths.push(`Best value (${r.valuePerMillion.toFixed(2)} xP/£m)`);
        }
        if (r.fixture === best.fixture) strengths.push("Kindest fixture run");
        if (r.minutes === best.minutes) strengths.push("Most secure minutes");
        if (r.risk === best.risk) strengths.push(`Lowest risk (${r.risk})`);

        if (r.xp < best.xp * 0.85) weaknesses.push(`${(best.xp - r.xp).toFixed(1)} xP behind the best`);
        if (r.minutes < 0.7) weaknesses.push(`Only ${Math.round(r.minutes * 100)}% likely to start`);
        if (r.risk > best.risk + 15) weaknesses.push(`Carries more risk (${r.risk})`);
      }
      if (r.player.availability < 1) {
        weaknesses.push(`Availability ${Math.round(r.player.availability * 100)}%`);
      }
      if (r.player.xp[horizon] === null) weaknesses.push("No xP projection");

      return { ...r, strengths, weaknesses };
    })
    .sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------- replacement finder

export interface Replacement {
  player: ScoredPlayer;
  /** TeamFit: what swapping actually gains this squad. */
  teamFit: number;
  xpDelta: number;
  fixtureDelta: number;
  riskDelta: number;
  priceDelta: number;
  rationale: string[];
}

export const REPLACEMENT_MODEL_NOTE =
  "TeamFit covers the transfer gain, fixture change, and risk change. Squad balance and future " +
  "flexibility need the multi-gameweek transfer optimiser and are not yet included.";

/** Minimum start probability for a candidate to be worth suggesting. */
const MINUTES_FLOOR = 0.4;

/**
 * Legal, affordable swaps for one squad player, best first.
 *
 * Squad-aware by design: the budget released by selling the outgoing player is
 * available to spend, and the club limit ignores him because he is leaving.
 */
export function findReplacements(
  target: ScoredPlayer,
  pool: ScoredPlayer[],
  team: TeamState,
  rules: SquadRules,
  lookup: (playerId: number) => PlayerMeta | undefined,
  horizon: Horizon,
  limit = 5,
): Replacement[] {
  const owned = new Set(team.players.map((p) => p.playerId));
  const outgoing = team.players.find((p) => p.playerId === target.id);
  const spent = team.players.reduce((sum, p) => sum + p.purchasePrice, 0);

  // Selling the outgoing player frees up what was paid for him.
  const affordable = team.budget - spent + (outgoing?.purchasePrice ?? target.price);

  const clubCounts = new Map<number, number>();
  for (const pick of team.players) {
    if (pick.playerId === target.id) continue;
    const meta = lookup(pick.playerId);
    if (meta) clubCounts.set(meta.teamId, (clubCounts.get(meta.teamId) ?? 0) + 1);
  }

  const targetXp = xpFor(target, horizon);
  const targetFixture = fixtureScore(target, horizon);
  const targetRisk = riskScore(target, horizon);
  const fixtureWeight = Math.max(
    1,
    Math.min(fixturesFor(horizon), target.fdrRun.length),
  );

  return pool
    .filter((c) => {
      if (c.id === target.id || owned.has(c.id)) return false;
      if (c.elementType !== target.elementType) return false;
      if (c.price > affordable) return false;
      if ((clubCounts.get(c.teamId) ?? 0) >= rules.teamLimit) return false;
      if ((c.startProbability ?? c.availability) < MINUTES_FLOOR) return false;
      return true;
    })
    .map((c) => {
      const xpDelta = xpFor(c, horizon) - targetXp;
      const fixtureDelta = fixtureScore(c, horizon) - targetFixture;
      const riskDelta = riskScore(c, horizon) - targetRisk;
      const priceDelta = c.price - target.price;

      // Fixture improvement is expressed in points so it is commensurate with
      // the xP gain: a full step of fixture quality is worth roughly a point
      // per gameweek. Weighted by the fixtures actually known, not by the
      // horizon's nominal length — Season would otherwise multiply an
      // eight-fixture signal by 38.
      const teamFit = xpDelta + fixtureDelta * fixtureWeight - riskDelta / 20;

      // State downgrades as downgrades. A −4 xP swap is not a "marginal
      // change", and describing it as one would mislead.
      const rationale: string[] = [];
      if (xpDelta > 0.5) rationale.push(`+${xpDelta.toFixed(1)} xP over ${horizonLabel(horizon)}`);
      else if (xpDelta < -0.5) rationale.push(`${xpDelta.toFixed(1)} xP — a downgrade`);
      if (fixtureDelta > 0.08) rationale.push("better fixtures");
      else if (fixtureDelta < -0.08) rationale.push("harder fixtures");
      if (riskDelta < -8) rationale.push("lower risk");
      else if (riskDelta > 8) rationale.push("more risk");
      if (priceDelta < 0) rationale.push(`frees £${(-priceDelta / 10).toFixed(1)}m`);
      // Say when a suggestion rests on the prior rather than on evidence. A
      // promoted-club player can out-score an established one on paper purely
      // because his number is the average for his price bracket.
      if (c.reliability === "low") rationale.push("prior-based, little PL record");
      if (rationale.length === 0) rationale.push("broadly equivalent");

      return { player: c, teamFit, xpDelta, fixtureDelta, riskDelta, priceDelta, rationale };
    })
    .sort((a, b) => b.teamFit - a.teamFit)
    .slice(0, limit);
}
