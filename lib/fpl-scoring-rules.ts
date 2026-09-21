// Player card, Gameweeks tab: the per-stat points breakdown.
//
// FPL publishes a points *total* per player-fixture and, for the live
// gameweek only, an `explain` block that itemises it. Past gameweeks have no
// `explain` anywhere — `player_gameweek_stats.raw` is the element-summary
// history row, which carries every component stat and no points attribution.
// So the breakdown has to be derived.
//
// The values are NOT hardcoded here. `public.scoring_rules` holds FPL's own
// per-stat, per-position values, season-keyed and synced from bootstrap, so
// this module loads them the same way squad rules come from `game_settings`
// (CLAUDE.md, "squad rules come from the database"). A rule change between
// seasons needs no code change.
//
// Two quantities FPL does not publish anywhere are the only constants below:
// the divisors (1 point per 3 saves, -1 per 2 goals conceded) and the
// defensive-contribution thresholds. Both were measured against live data
// rather than assumed — see DC_THRESHOLD_BY_ELEMENT_TYPE in lib/scoring.ts,
// which DC_THRESHOLDS below reads from rather than redeclaring.
//
// Because this is derived, every breakdown is checked against the stored
// total and any difference is surfaced as an "Unattributed" line rather than
// absorbed. A silently-wrong breakdown is worse than a visibly incomplete one.

import { supabase } from "./supabase/client";
import { liveStatLabel } from "./fixture-stats";
import { DC_THRESHOLD_BY_ELEMENT_TYPE } from "./scoring";

export const SCORING_MODEL_NOTE =
  "This breakdown is derived, not published. FPL itemises a score only for the live gameweek, so " +
  "for finished gameweeks each line is this app applying the season's scoring rules (loaded from " +
  "FPL's own values, not hardcoded) to the recorded match stats. The lines are checked against the " +
  "stored total — if they don't reconcile, the difference is shown as 'Unattributed' rather than " +
  "hidden. Bonus is read from the recorded value, never inferred from BPS.";

/** Position short names, as `element_types.singular_name_short` spells them. */
export type PositionShort = "GKP" | "DEF" | "MID" | "FWD";

/**
 * Appearance points are a two-tier rule FPL stores as two separate stats
 * (`short_play` / `long_play`) with no minutes boundary attached to either.
 * 60 is the boundary, and it is stable across every season FPL has run.
 */
const LONG_PLAY_MINUTES = 60;

/**
 * Divisors FPL applies but does not publish as data: a goalkeeper banks a
 * point every 3 saves, and defenders/keepers lose one every 2 goals conceded.
 * `scoring_rules` carries the per-unit value (1 and -1); the unit size lives
 * only in the rules text.
 */
const SAVES_PER_POINT = 3;
const GOALS_CONCEDED_PER_POINT = 2;

/** `element_types.singular_name_short` -> FPL's element_type id. */
const ELEMENT_TYPE_OF: Record<PositionShort, number> = { GKP: 1, DEF: 2, MID: 3, FWD: 4 };

/**
 * Qualifying defensive actions needed to score the DC bonus, by position.
 *
 * Read from `DC_THRESHOLD_BY_ELEMENT_TYPE` (lib/scoring.ts) rather than
 * redeclared — one quantity, one implementation. That constant carries the
 * measurement these values came from, and mirrors the production model's own
 * `MODEL_PARAMS.dcThreshold`.
 *
 * Null here means "cannot score it", which is how this module's callers
 * decide whether to show the row at all; `scoring.ts` spells the same thing
 * as a threshold of 0.
 */
const DC_THRESHOLDS: Record<PositionShort, number | null> = Object.fromEntries(
  (Object.keys(ELEMENT_TYPE_OF) as PositionShort[]).map((p) => {
    const threshold = DC_THRESHOLD_BY_ELEMENT_TYPE[ELEMENT_TYPE_OF[p]] ?? 0;
    return [p, threshold > 0 ? threshold : null];
  }),
) as Record<PositionShort, number | null>;

/** One derived line of a points breakdown. */
export interface BreakdownLine {
  /** Stat identifier, or "unattributed" for the reconciliation line. */
  identifier: string;
  label: string;
  /** The recorded match value. Null on the reconciliation line, which has no stat. */
  value: number | null;
  points: number;
}

/**
 * Season scoring values, keyed `stat` then position. A stat FPL scores
 * identically for everyone is stored once under "ALL"; `valueFor` resolves
 * the position-specific entry first and falls back to it.
 */
export interface ScoringRules {
  season: string;
  valueFor: (stat: string, position: PositionShort) => number;
  /** element_type id -> short name, for callers holding raw ids. */
  positionById: Map<number, PositionShort>;
}

/** The subset of a gameweek row a breakdown needs. */
export interface ScorableLine {
  minutes: number;
  total_points: number;
  goals_scored: number;
  assists: number;
  clean_sheets: number;
  goals_conceded: number;
  own_goals: number;
  penalties_saved: number;
  penalties_missed: number;
  yellow_cards: number;
  red_cards: number;
  saves: number;
  bonus: number;
  defensive_contribution: number | null;
}

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; promise: Promise<ScoringRules> }>();

async function fetchRules(season: string): Promise<ScoringRules> {
  const [rules, types] = await Promise.all([
    supabase.from("scoring_rules").select("stat, position, value").eq("season", season),
    supabase.from("element_types").select("id, singular_name_short").eq("season", season),
  ]);
  if (rules.error) throw new Error(rules.error.message);
  if (types.error) throw new Error(types.error.message);

  const byStat = new Map<string, number>();
  for (const row of rules.data ?? []) {
    // `value` is text in the table — it carries non-integer rules in other
    // seasons, so parse rather than cast.
    const parsed = Number(row.value);
    if (!Number.isFinite(parsed)) continue;
    byStat.set(`${row.stat as string}:${row.position as string}`, parsed);
  }

  const positionById = new Map<number, PositionShort>();
  for (const row of types.data ?? []) {
    positionById.set(row.id as number, row.singular_name_short as PositionShort);
  }

  return {
    season,
    positionById,
    valueFor: (stat, position) => byStat.get(`${stat}:${position}`) ?? byStat.get(`${stat}:ALL`) ?? 0,
  };
}

/** Season scoring rules, memoised for 5 minutes. Failures are not memoised. */
export function loadScoringRules(season: string): Promise<ScoringRules> {
  const hit = cache.get(season);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.promise;

  const promise = fetchRules(season).catch((err: unknown) => {
    cache.delete(season);
    throw err;
  });
  cache.set(season, { at: Date.now(), promise });
  return promise;
}

/**
 * Derives the per-stat points breakdown for one player-fixture.
 *
 * Only lines that actually happened are returned — a forward with no saves
 * gets no "Saves 0" row. The exception is `defensive_contribution`, which is
 * shown even at zero points whenever the position can score it, because "5
 * actions, 0 pts" answers "how close was he" and an absent row does not.
 *
 * The final line is "Unattributed" whenever the derived lines don't sum to
 * the recorded total. It should never appear; if it does, the rules mapping
 * is wrong and the number on screen says so instead of lying quietly.
 */
export function breakdownFor(
  line: ScorableLine,
  position: PositionShort,
  rules: ScoringRules,
): BreakdownLine[] {
  const out: BreakdownLine[] = [];
  const push = (identifier: string, value: number | null, points: number) => {
    out.push({ identifier, label: liveStatLabel(identifier), value, points });
  };

  if (line.minutes > 0) {
    const long = line.minutes >= LONG_PLAY_MINUTES;
    push("minutes", line.minutes, rules.valueFor(long ? "long_play" : "short_play", position));
  }

  if (line.goals_scored > 0) {
    push("goals_scored", line.goals_scored, line.goals_scored * rules.valueFor("goals_scored", position));
  }
  if (line.assists > 0) {
    push("assists", line.assists, line.assists * rules.valueFor("assists", position));
  }
  if (line.clean_sheets > 0) {
    push("clean_sheets", line.clean_sheets, line.clean_sheets * rules.valueFor("clean_sheets", position));
  }
  if (line.goals_conceded > 0) {
    const unitValue = rules.valueFor("goals_conceded", position);
    const units = Math.floor(line.goals_conceded / GOALS_CONCEDED_PER_POINT);
    push("goals_conceded", line.goals_conceded, units * unitValue);
  }
  if (line.saves > 0) {
    const units = Math.floor(line.saves / SAVES_PER_POINT);
    push("saves", line.saves, units * rules.valueFor("saves", position));
  }

  const dcThreshold = DC_THRESHOLDS[position];
  const dc = line.defensive_contribution;
  if (dcThreshold !== null && dc !== null) {
    push("defensive_contribution", dc, dc >= dcThreshold ? rules.valueFor("defensive_contribution", position) : 0);
  }

  for (const stat of ["penalties_saved", "penalties_missed", "own_goals", "yellow_cards", "red_cards"] as const) {
    const value = line[stat];
    if (value > 0) push(stat, value, value * rules.valueFor(stat, position));
  }

  if (line.bonus > 0) {
    // From the recorded column, never derived from BPS — BPS is a ranking
    // within a fixture, not a points rate.
    push("bonus", line.bonus, line.bonus * rules.valueFor("bonus", position));
  }

  const derived = out.reduce((sum, l) => sum + l.points, 0);
  const residual = line.total_points - derived;
  if (residual !== 0) {
    out.push({ identifier: "unattributed", label: "Unattributed", value: null, points: residual });
  }

  return out;
}

/** The defensive-contribution threshold for a position, or null if it can't score it. */
export const dcThresholdFor = (position: PositionShort): number | null => DC_THRESHOLDS[position];
