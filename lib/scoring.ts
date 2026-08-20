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
import { totalSpend } from "./squad-budget";

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
  /**
   * GW1-only predicted-lineup override from `lib/gw1-lineups.ts`. Read by
   * `riskScore` at horizon 1 only — see the gate there. Never affects `xp`.
   * Deliberately not folded into `startProbability`/`expectedMinutes` above:
   * those are read by other horizons and by the detail panel's "Start %" /
   * "Exp. mins" figures, which must stay the model's own numbers.
   */
  gw1?: { startProbability: number; expectedMinutes: number; tier: "locked" | "medium" | "high"; note?: string };
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
  "match-to-match variance and are therefore narrower than real outcomes. Since v1.5.0, 33 players at " +
  "the three promoted clubs use a real 2025/26 Championship rate (attack and discipline metrics only, " +
  "translated by a lambda fitted against the 12 players with both a Premier League and a Championship " +
  "season on record) in place of the position/price average — everyone else's prior still rests on " +
  "position, price and role alone, since no other external-league data is in use. This does not raise " +
  "a covered player's confidence label: the shrinkage weight is unchanged, only which number sits at " +
  "the fully-prior end of it. Team attacking strength is omitted entirely because the API reports it " +
  "as zero for all twenty clubs " +
  "pre-season. Since v1.2.0, every club's squad is also reconciled so exactly eleven players and one " +
  "goalkeeper start each fixture, so a player's number now depends on their team-mates too — where a " +
  "squad's raw numbers fall short of eleven (promoted clubs, mainly) or run past it (deep, expensive " +
  "squads), the shortfall or surplus is spread across the squad capped at each player's own chance of " +
  "playing. This fixes how much a club plays, not how well — team strength is still zero for all " +
  "twenty clubs, so it is a role estimate, not a quality one — and it does not order players within a " +
  "position, so understudies can end up sharing a start rather than one being picked out as first " +
  "choice. Since v1.3.0 the correction is weighted by how much of each player's number is prior " +
  "rather than their own Premier League record, so an established starter moves far less than a " +
  "fringe reserve on the same price band, rather than both moving by the same proportion.";

/**
 * Cap on players held at once by any compare-style UI — /compare's `?ids=`
 * parsing and /players' select-to-compare checkboxes both read this rather
 * than each redeclaring `4`, per the project's "one quantity, one
 * implementation" rule.
 */
export const MAX_COMPARE = 4;

/**
 * xDefcon (Sprint 12.6): expected points from clearing the defensive-
 * contribution threshold (10 for DEF, 12 for MID — 0 for GKP/FWD, who never
 * score it), summed over a horizon from `player_xp_horizons.xdc_*`.
 *
 * FPL's real rule scores different actions per group — defenders on CBIT
 * (clearances, blocks, interceptions, tackles), midfielders and forwards on
 * CBIRT (the same four plus recoveries) — but the model applies the same
 * aggregate `defensive_contribution` count to both, because that is the only
 * qualifying-action figure the FPL API exposes as one number.
 * `clearances_blocks_interceptions`, `recoveries` and `tackles` are stored in
 * `players` / `player_gameweek_stats` / `player_season_history` but read by
 * no code path yet — the position-correct split is a separate piece of work.
 * See docs/roadmap.md.
 */
export const XDC_MODEL_NOTE =
  "Expected points from clearing the defensive-contribution threshold (10 for defenders, 12 for " +
  "midfielders; forwards and goalkeepers never score it). Modelled as a Poisson tail on a shrunk " +
  "per-90 rate, gated on an eligible-minutes fix (v1.4.0) since FPL only tracks the stat from " +
  "2024/25 — see docs/phase-4-model.md. One real gap remains: FPL scores defenders on clearances + " +
  "blocks + interceptions + tackles and midfielders/forwards on the same four plus recoveries, but " +
  "this figure applies one aggregate count to both, because that is the only qualifying-action total " +
  "the API exposes as a single number.";

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

/**
 * `players.status`/`chance_of_playing_next_round` → a 0-1 availability figure.
 *
 * One implementation, shared by every page and engine that needs it — see
 * CLAUDE.md's "one quantity, one implementation" rule. `chance_of_playing_next_round`
 * wins when FPL has actually published one; otherwise a fit ("a") status reads as
 * fully available and anything else (injured/suspended/on loan/left) reads as zero.
 */
export function availabilityFromStatus(
  status: string | null,
  chanceOfPlayingNextRound: number | null,
): number {
  if (chanceOfPlayingNextRound !== null) {
    return clamp(chanceOfPlayingNextRound / 100, 0, 1);
  }
  return status === "a" ? 1 : 0;
}

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
  // GW1 predicted-lineup override (lib/gw1-lineups.ts) — a one-off,
  // horizon-1-only read. `injury` and `fixtureVariance` are untouched: FPL's
  // own status/news is better evidence than a video, and the override says
  // nothing about fixtures.
  const gw1 = horizon === 1 ? p.gw1 : undefined;

  const rotation = 1 - (gw1?.startProbability ?? p.startProbability ?? p.availability);
  const injury = 1 - p.availability;

  // Minutes uncertainty peaks in the middle: a player nailed on for 90 and one
  // certain not to feature are both predictable; a 45-minute player is not.
  const effectiveMinutes = gw1?.expectedMinutes ?? p.expectedMinutes;
  const share = effectiveMinutes === null ? 0.5 : clamp(effectiveMinutes / 90, 0, 1);
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
  /**
   * Change in the squad's week-to-week evenness after the swap — positive
   * means smoother, negative means lumpier. Only present when the caller
   * supplied `filters.squadBalance`; informational only, not folded into
   * `teamFit` (see `REPLACEMENT_MODEL_NOTE` for why).
   */
  squadBalanceDelta?: number;
  /**
   * How many other pool candidates at the incoming player's position would
   * still be legally reachable (position, budget, club cap — the same
   * checks `replacementLegality` already makes) with one more free transfer
   * after this swap. Only present when `filters.reversibility` is set;
   * reported, never folded into `teamFit` — see `REPLACEMENT_MODEL_NOTE`.
   */
  exitRoutes?: number;
  rationale: string[];
}

export const REPLACEMENT_MODEL_NOTE =
  "TeamFit covers the transfer gain, fixture change, and risk change. FutureFlexibility from the " +
  "design spec is not included — nothing in this app computes it without inventing a coefficient " +
  "with nothing to fit it against, the same reasoning transfer-optimizer.ts already applies to its " +
  "own decisionMargin. SquadBalance — whether the swap smooths or roughens the squad's week-to-week " +
  "total, from the per-gameweek series — is shown as its own line when that series is available, but " +
  "reported rather than folded into the ranking for the same reason. ExitRoutes — how many other " +
  "legal candidates remain at this position afterward — is the same shape again: a real, computed " +
  "count, shown as its own line, never used to break a tie in the ranking.";

/** Minimum start probability for a candidate to be worth suggesting, by default. */
export const MINUTES_FLOOR = 0.4;

export interface ReplacementFilters {
  /**
   * Minimum start probability (or availability, when start probability is
   * unknown) for a candidate to survive. Defaults to `MINUTES_FLOOR`.
   * Ignored when `includeUnavailable` is set.
   */
  minStartProbability?: number;
  /**
   * Skip the minutes/availability filter entirely, surfacing candidates a
   * manager might still want to see — a returning-from-injury pick, a
   * rotation risk worth the gamble. Defaults to false.
   */
  includeUnavailable?: boolean;
  /**
   * Price ceiling for a candidate, in tenths. Can only narrow the legal
   * budget, never widen it — always clamped to what selling the outgoing
   * player actually affords, since a swap must stay legal.
   */
  maxPrice?: number;
  /** The real "season" prediction window, threaded into fixtureScore/riskScore. */
  seasonWindow?: number;
  /**
   * Supplies the per-gameweek series needed to report SquadBalance. Omit to
   * skip that computation entirely — every existing call site does, and
   * `squadBalanceDelta` is simply absent from the result.
   */
  squadBalance?: {
    /** Per-player projected points keyed by event, e.g. from `player_predictions`. */
    seriesOf: (playerId: number) => Map<number, number> | undefined;
    /** Every squad pick's player id — the full fifteen, not just starters. */
    squadPlayerIds: number[];
    /** Absolute event ids the horizon covers, e.g. [gw, gw+1, ...]. */
    windowEvents: number[];
  };
  /**
   * Restrict candidates to a Hidden Gems archetype (lib/hidden-gems.ts),
   * supplied as the set of player ids `detectGems` flagged. A set rather
   * than an archetype name: `findReplacements` operates on `ScoredPlayer`,
   * which carries no per-90 rate data, so recomputing archetypes in here
   * would be a second implementation of `detectGems`'s own filtering. The
   * caller runs `detectGems` once and passes the resulting ids through.
   */
  archetypeIds?: Set<number>;
  /**
   * Compute `Replacement.exitRoutes` — off by default, same shape as
   * `squadBalance`. Costs an O(pool) legality scan per surviving candidate,
   * fine for the handful of rows a Replacement Finder panel renders, wasteful
   * inside a search loop (the transfer optimiser's beam calls
   * `findReplacements` per squad slot per candidate basket), so no existing
   * call site sets it and none should without a reason.
   */
  reversibility?: boolean;
}

/** Population coefficient of variation — 0 for a constant series, undefined for a zero mean. */
function coefficientOfVariation(xs: number[]): number {
  const m = mean(xs);
  return m > 0 ? stdevPopulation(xs) / m : 0;
}

/** The squad's total projected points for each event in `windowEvents`. */
function weeklyTotals(
  playerIds: number[],
  seriesOf: (playerId: number) => Map<number, number> | undefined,
  windowEvents: number[],
): number[] {
  return windowEvents.map((event) =>
    playerIds.reduce((sum, id) => sum + (seriesOf(id)?.get(event) ?? 0), 0),
  );
}

/** The shape `replacementLegality` needs from a candidate — any scored or raw player row satisfies it. */
export interface ReplacementCandidate {
  id: number;
  elementType: number;
  price: number;
  teamId: number;
}

/**
 * Legality for a 1-for-1 squad swap: same position, club cap respected, and
 * affordable from what selling the outgoing player frees up (further capped by
 * an optional `maxPrice`, e.g. a user-set slider).
 *
 * Squad-aware by design: the budget released by selling the outgoing player is
 * available to spend, and the club limit ignores him because he is leaving.
 *
 * This is the one implementation of transfer legality (position + budget +
 * 3-per-club) — `findReplacements` layers its quality filters (minutes floor,
 * archetype) on top of it, and `/builder`'s players-list picker uses it
 * directly when the user wants to choose a replacement themselves rather than
 * pick from the ranked suggestions.
 */
export function replacementLegality(
  target: { id: number; elementType: number; price: number },
  team: TeamState,
  rules: SquadRules,
  lookup: (playerId: number) => PlayerMeta | undefined,
  maxPrice?: number,
): { priceCeiling: number; isEligible: (c: ReplacementCandidate) => boolean } {
  const owned = new Set(team.players.map((p) => p.playerId));
  const outgoing = team.players.find((p) => p.playerId === target.id);
  const spent = totalSpend(team.players);

  // Selling the outgoing player frees up what was paid for him.
  const affordable = team.budget - spent + (outgoing?.purchasePrice ?? target.price);
  const priceCeiling = maxPrice != null ? Math.min(maxPrice, affordable) : affordable;

  const clubCounts = new Map<number, number>();
  for (const pick of team.players) {
    if (pick.playerId === target.id) continue;
    const meta = lookup(pick.playerId);
    if (meta) clubCounts.set(meta.teamId, (clubCounts.get(meta.teamId) ?? 0) + 1);
  }

  return {
    priceCeiling,
    isEligible: (c) => {
      if (c.id === target.id || owned.has(c.id)) return false;
      if (c.elementType !== target.elementType) return false;
      if (c.price > priceCeiling) return false;
      if ((clubCounts.get(c.teamId) ?? 0) >= rules.teamLimit) return false;
      return true;
    },
  };
}

/**
 * Legal, affordable swaps for one squad player, best first.
 *
 * `filters` is additive and optional — every existing call site (the transfer
 * optimiser's beam search, `/transfers`) keeps its exact prior behaviour by
 * simply not passing it. Only `/builder`'s user-facing panel threads it
 * through, so a wider or differently-filtered pool there can never silently
 * move a recommendation the optimiser produces elsewhere.
 */
export function findReplacements(
  target: ScoredPlayer,
  pool: ScoredPlayer[],
  team: TeamState,
  rules: SquadRules,
  lookup: (playerId: number) => PlayerMeta | undefined,
  horizon: Horizon,
  limit = 5,
  filters: ReplacementFilters = {},
): Replacement[] {
  const { isEligible } = replacementLegality(target, team, rules, lookup, filters.maxPrice);
  const minStartProbability = filters.minStartProbability ?? MINUTES_FLOOR;

  const targetXp = xpFor(target, horizon);
  const targetFixture = fixtureScore(target, horizon, filters.seasonWindow);
  const targetRisk = riskScore(target, horizon, filters.seasonWindow);
  const fixtureWeight = Math.max(
    1,
    Math.min(fixturesFor(horizon, filters.seasonWindow), target.fdrRun.length),
  );

  return pool
    .filter((c) => {
      if (!isEligible(c)) return false;
      if (filters.archetypeIds && !filters.archetypeIds.has(c.id)) return false;
      if (
        !filters.includeUnavailable &&
        (c.startProbability ?? c.availability) < minStartProbability
      ) {
        return false;
      }
      return true;
    })
    .map((c) => {
      const xpDelta = xpFor(c, horizon) - targetXp;
      const fixtureDelta = fixtureScore(c, horizon, filters.seasonWindow) - targetFixture;
      const riskDelta = riskScore(c, horizon, filters.seasonWindow) - targetRisk;
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
      if (filters.archetypeIds?.has(c.id)) rationale.push("matches the Hidden Gems filter");
      // Only reachable with includeUnavailable set — the default filter
      // already excludes anyone below the floor, so this only ever fires
      // when the caller deliberately asked to see them anyway.
      if ((c.startProbability ?? c.availability) < minStartProbability) {
        rationale.push("below the usual minutes floor");
      }

      // SquadBalance: does swapping target -> c smooth or roughen the
      // squad's week-to-week total over the horizon? Reported only, never
      // folded into teamFit — see REPLACEMENT_MODEL_NOTE.
      let squadBalanceDelta: number | undefined;
      if (filters.squadBalance) {
        const { seriesOf, squadPlayerIds, windowEvents } = filters.squadBalance;
        const afterIds = squadPlayerIds.map((id) => (id === target.id ? c.id : id));
        const cvBefore = coefficientOfVariation(weeklyTotals(squadPlayerIds, seriesOf, windowEvents));
        const cvAfter = coefficientOfVariation(weeklyTotals(afterIds, seriesOf, windowEvents));
        squadBalanceDelta = cvBefore - cvAfter;
        if (squadBalanceDelta > 0.02) rationale.push("smoother week-to-week spread");
        else if (squadBalanceDelta < -0.02) rationale.push("lumpier week-to-week spread");
      }

      // ExitRoutes: after taking c, how many other pool players at his
      // position are still legally reachable with one more free transfer?
      // Reported only, never folded into teamFit — see REPLACEMENT_MODEL_NOTE.
      // A rejected FutureFlexibility term already sets the precedent for why:
      // this is a real, computed count, not an invented coefficient.
      let exitRoutes: number | undefined;
      if (filters.reversibility) {
        const resultingTeam: TeamState = {
          ...team,
          players: team.players.map((p) =>
            p.playerId === target.id ? { playerId: c.id, purchasePrice: c.price } : p,
          ),
        };
        const { isEligible: isReachable } = replacementLegality(
          { id: c.id, elementType: c.elementType, price: c.price },
          resultingTeam,
          rules,
          lookup,
        );
        exitRoutes = pool.filter(
          (p) => isReachable(p) && (p.startProbability ?? p.availability) >= minStartProbability,
        ).length;
      }

      if (rationale.length === 0) rationale.push("broadly equivalent");

      return {
        player: c,
        teamFit,
        xpDelta,
        fixtureDelta,
        riskDelta,
        priceDelta,
        squadBalanceDelta,
        exitRoutes,
        rationale,
      };
    })
    .sort((a, b) => b.teamFit - a.teamFit)
    .slice(0, limit);
}
