// A fixture difficulty rating derived from real scorelines.
//
// Why this exists: Sprint 31 built a *strength*-derived FDR and proved it can
// never be model-grade — `teams` holds one season's rows and strength is a live
// snapshot with no history, so `scripts/backtest-walkforward.ts` has nothing to
// walk forward over and the standing gate cannot be run at all. That one is
// display-only, permanently.
//
// This one is backtestable, because results are. Four seasons of real
// scorelines are recoverable from `player_gameweek_stats` — see
// `resultsFromGameweekStats` for why that table and not `fixtures`.
//
// Three properties this has to have, and the reasons:
//
//   - **Within-season.** FPL reassigns team ids alphabetically every season, so
//     team 1 in 2023-24 is not team 1 today. Nothing here ever compares ids
//     across seasons. That costs nothing: a rolling in-season difficulty is
//     what the model consumes anyway.
//   - **Rolling and strictly backward-looking.** A rating used to predict event
//     E is built only from events < E. Anything else leaks the result being
//     predicted, which is the whole failure mode a walk-forward backtest exists
//     to avoid.
//   - **Shrunk toward the league mean.** A team three games into a season has
//     no more business carrying a full-confidence rating than a player with 200
//     minutes does. Same empirical-Bayes shape as the cold-start rate priors.
//
// This module is deliberately pure — no Supabase client, no I/O — so the
// walk-forward harness and the app can share one implementation, and so `tsc`
// checks it (`supabase/functions/**` is excluded from tsconfig by necessity).

import { clamp, mean } from "./stats";

/**
 * One side of one played fixture: what `team` did against `opponent`.
 *
 * Two of these per fixture, one per side.
 */
export interface FixtureResult {
  event: number;
  team: number;
  opponent: number;
  /** Was `team` at home. */
  isHome: boolean;
  goalsFor: number;
  goalsAgainst: number;
}

/**
 * A row of `player_gameweek_stats`, which is where historical scorelines have
 * to come from.
 *
 * `fixtures` holds **only the current season** (checked 2026-09-06: 380 rows,
 * all 2026-27), so `deriveStandingsFromFixtures` in `lib/fdr.ts` cannot be
 * walked over past seasons at all. `player_gameweek_stats` carries
 * `team_h_score`/`team_a_score`/`opponent_team`/`was_home` on every row for
 * four seasons, which is enough to reconstruct both sides of every fixture.
 */
export interface GameweekStatRow {
  event: number | null;
  fixture: number | null;
  opponent_team: number | null;
  was_home: boolean | null;
  team_h_score: number | null;
  team_a_score: number | null;
}

/**
 * Reconstructs one `FixtureResult` per side per fixture from player rows.
 *
 * Each fixture appears once per player, so rows are collapsed on
 * `fixture:opponent_team`. Note what a single row actually tells us: it is
 * written from the *player's* team's point of view, and that team's own id is
 * not stored. But the opponent's is, and so is the venue — which is all this
 * needs, because every rating here is a property of the opponent being faced.
 *
 * So for a row with `was_home = true`: the player's team is home, the opponent
 * is away, the opponent conceded `team_h_score` and scored `team_a_score`. The
 * `FixtureResult` is emitted from the *opponent's* perspective, since that is
 * the team whose strength is being measured.
 */
export function resultsFromGameweekStats(rows: GameweekStatRow[]): FixtureResult[] {
  const seen = new Map<string, FixtureResult>();

  for (const r of rows) {
    if (
      r.fixture === null || r.event === null || r.opponent_team === null ||
      r.was_home === null || r.team_h_score === null || r.team_a_score === null
    ) continue;

    const key = `${r.fixture}:${r.opponent_team}`;
    if (seen.has(key)) continue;

    // The opponent's venue is the opposite of the player's team's.
    const opponentAtHome = !r.was_home;
    seen.set(key, {
      event: r.event,
      team: r.opponent_team,
      // The player's own team id is not recoverable from this row; it is not
      // needed, and -1 marks it as deliberately absent rather than a real id.
      opponent: -1,
      isHome: opponentAtHome,
      goalsFor: opponentAtHome ? r.team_h_score : r.team_a_score,
      goalsAgainst: opponentAtHome ? r.team_a_score : r.team_h_score,
    });
  }

  return [...seen.values()];
}

/**
 * A fixture yields two sides only when both teams have player rows for it.
 *
 * Measured 2026-09-06: the three completed seasons reconstruct exactly 760
 * sides each (2 x 380), so this is complete for historical data. The live
 * season does not — 2026-27 gave 56 sides from 30 fixtures, because
 * `sync-player-history` is still filling and a couple of fixtures had rows from
 * only one side. A one-sided fixture is not wrong, just half-counted: that
 * team's record picks it up and its opponent's does not, until the sync
 * catches up.
 */
export const ONE_SIDED_FIXTURE_NOTE =
  "Reconstructed from player rows, so a fixture counts toward a team's record only once that " +
  "team's players have been synced for it. Complete for finished seasons; the current gameweek " +
  "can lag briefly.";

/** Attack and defence rates for one team, split by venue. */
export interface TeamRates {
  games: number;
  /** Goals scored per game, shrunk toward the league mean. */
  attackHome: number;
  attackAway: number;
  /** Goals conceded per game, shrunk toward the league mean. */
  defenceHome: number;
  defenceAway: number;
}

/**
 * How many games of league-average evidence every team is credited with before
 * its own record counts.
 *
 * A **documented input, not a fitted coefficient** — per CLAUDE.md, when a
 * quantity cannot be dropped it becomes a disclosed input rather than something
 * tuned until the answer looks right. At 4, a team's own record outweighs the
 * prior from its fifth game on, which lines up with a rating meant to be usable
 * early in a season without being noise for the first month. Swept in the
 * backtest rather than asserted.
 */
export const DEFAULT_PRIOR_GAMES = 4;

/**
 * Team rates from every result strictly before `beforeEvent`.
 *
 * Venue is kept separate throughout: home and away scoring rates differ by
 * enough that pooling them and then re-applying a global home/away factor
 * (which `predict` already does) would double-count the effect in one direction
 * and cancel it in the other.
 */
export function deriveTeamRates(
  results: FixtureResult[],
  beforeEvent: number,
  priorGames = DEFAULT_PRIOR_GAMES,
): Map<number, TeamRates> {
  const past = results.filter((r) => r.event < beforeEvent);

  // League means, per venue, are the prior every team is shrunk toward.
  const homeRows = past.filter((r) => r.isHome);
  const awayRows = past.filter((r) => !r.isHome);
  const leagueAttackHome = mean(homeRows.map((r) => r.goalsFor));
  const leagueAttackAway = mean(awayRows.map((r) => r.goalsFor));
  const leagueDefenceHome = mean(homeRows.map((r) => r.goalsAgainst));
  const leagueDefenceAway = mean(awayRows.map((r) => r.goalsAgainst));

  interface Acc { gf: number[]; ga: number[] }
  const byTeam = new Map<number, { home: Acc; away: Acc }>();
  for (const r of past) {
    let t = byTeam.get(r.team);
    if (!t) {
      t = { home: { gf: [], ga: [] }, away: { gf: [], ga: [] } };
      byTeam.set(r.team, t);
    }
    const side = r.isHome ? t.home : t.away;
    side.gf.push(r.goalsFor);
    side.ga.push(r.goalsAgainst);
  }

  // Shrink toward the league mean in proportion to games played: with n games
  // of evidence and `priorGames` of prior, the estimate is the evidence-weighted
  // blend of the two. n = 0 returns the league mean exactly.
  const shrink = (xs: number[], leagueMean: number): number => {
    if (!Number.isFinite(leagueMean)) return 0;
    const n = xs.length;
    const total = xs.reduce((a, b) => a + b, 0);
    return (total + priorGames * leagueMean) / (n + priorGames);
  };

  const out = new Map<number, TeamRates>();
  for (const [team, t] of byTeam) {
    out.set(team, {
      games: t.home.gf.length + t.away.gf.length,
      attackHome: shrink(t.home.gf, leagueAttackHome),
      attackAway: shrink(t.away.gf, leagueAttackAway),
      defenceHome: shrink(t.home.ga, leagueDefenceHome),
      defenceAway: shrink(t.away.ga, leagueDefenceAway),
    });
  }
  return out;
}

/**
 * A single difficulty score for facing `opponent`, who is at home iff
 * `opponentAtHome`. Higher is harder. Unbounded — `bandToFdr` turns a set of
 * these into 1-5 ratings.
 *
 * Difficulty of a fixture has two halves, and they are added rather than
 * multiplied so neither can dominate by being near zero:
 *
 *   - how hard it is to *score* against this opponent — their defensive record
 *   - how likely they are to *score* against you — their attacking record
 *
 * `predict` collapses both into one `fdr` scalar (with separate `attackAlpha`
 * and `defenceAlpha` applied to the same number), so a single score is what the
 * model can actually consume today. `phase-4-model.md` already records that one
 * scalar cannot really express both; splitting `FixtureInput.fdr` into attack
 * and defence terms is the natural follow-up **if** this clears its gate, and
 * is deliberately not bundled into the change that first tests whether the
 * signal exists at all.
 */
export function fixtureDifficulty(
  rates: TeamRates | undefined,
  opponentAtHome: boolean,
): number | null {
  if (!rates) return null;
  const theyConcede = opponentAtHome ? rates.defenceHome : rates.defenceAway;
  const theyScore = opponentAtHome ? rates.attackHome : rates.attackAway;
  // Conceding little makes them hard to play; scoring a lot makes them hard to
  // play. The first term is negated so both point the same way.
  return theyScore - theyConcede;
}

/**
 * Bands raw difficulty scores into FPL's 1-5 FDR scale by quintile.
 *
 * **Quintiles rather than thresholds, deliberately.** Mapping a raw score to
 * 1-5 needs a scale factor, and any constant picked for it would be exactly the
 * invented coefficient CLAUDE.md forbids tuning until the output looks
 * reasonable. Ranking sidesteps it: the bands are a property of the
 * distribution, not of a number somebody chose. It also matches what FDR *is* —
 * a banding of opponents against each other, not an absolute measure.
 *
 * The cost, stated rather than hidden: quintiles impose a spread of ratings
 * even in a season where every team is genuinely similar. Since the model reads
 * `3 - fdr` as a delta from neutral, that means a flat league still produces
 * non-zero adjustments. Whether that costs accuracy is exactly what the
 * backtest measures.
 */
export function bandToFdr<K>(scores: Map<K, number>): Map<K, number> {
  const ranked = [...scores.entries()].sort((a, b) => a[1] - b[1]);
  const n = ranked.length;
  const out = new Map<K, number>();
  if (n === 0) return out;

  ranked.forEach(([team], i) => {
    // i/n in [0,1) -> band 1..5, easiest fixtures (lowest difficulty) = 1.
    const band = clamp(Math.floor((i / n) * 5) + 1, 1, 5);
    out.set(team, band);
  });
  return out;
}

/**
 * The whole pipeline for one gameweek: results so far -> a 1-5 rating per
 * opponent, per venue.
 *
 * Returned keyed `team:venue` because a team's difficulty is not the same home
 * and away, and the caller knows which side it is looking at.
 */
export function fdrForEvent(
  results: FixtureResult[],
  event: number,
  priorGames = DEFAULT_PRIOR_GAMES,
): Map<string, number> {
  const rates = deriveTeamRates(results, event, priorGames);

  // Banded WITHIN venue, not across it. Pooling both venues into one ranking
  // sounds harmless and is not: home sides both score more and concede less, so
  // a single ranking sorts almost every team-at-home above almost every
  // team-away, and the resulting 1-5 mostly encodes *venue* rather than team
  // quality. `predict` already applies its own `homeAttack`/`awayAttack`
  // factor, so that rating would double-count venue in one direction and
  // partially cancel it in the other — the same double-count `deriveTeamRates`
  // keeps venue separate to avoid.
  //
  // Observed before this was fixed (2026-27, event 3): every `:H` entry banded
  // 3-5 and every `:A` entry 1-2, with the split falling on venue rather than
  // on any team's record.
  const out = new Map<string, number>();
  for (const atHome of [true, false]) {
    const scores = new Map<string, number>();
    for (const [team, r] of rates) {
      const d = fixtureDifficulty(r, atHome);
      if (d !== null) scores.set(`${team}:${atHome ? "H" : "A"}`, d);
    }
    for (const [k, band] of bandToFdr(scores)) out.set(k, band);
  }
  return out;
}

export const DERIVED_FDR_NOTE =
  "Fixture difficulty derived from real scorelines rather than FPL's own rating: each opponent " +
  "is scored on how much they concede and how much they score, split by venue, using only " +
  "matches played before the gameweek being rated. Early in a season a team's record is shrunk " +
  "toward the league average, so ratings start near neutral and sharpen as evidence accumulates. " +
  "Ratings are quintile bands of the league on the day, not an absolute scale — a 5 means " +
  "'hardest fifth of fixtures right now', not a fixed difficulty.";
