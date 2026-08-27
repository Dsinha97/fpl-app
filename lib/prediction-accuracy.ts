// Scores the pre-deadline prediction archive against real results.
//
// `player_prediction_archive` (migration 20260827154000_prediction_archive.sql)
// holds the last snapshot `generate-predictions` wrote before each
// gameweek's deadline — the only surviving record, since `player_predictions`
// itself is deleted and replaced wholesale on every run. This module joins
// that archive to `player_gameweek_stats` (the real results) per fixture and
// scores the residuals with the same `accuracyStats` the walk-forward
// backtest uses (`lib/stats.ts`), so the two numbers are directly comparable.

import { supabase } from "@/lib/supabase/client";
import { accuracyStats, type Residual } from "./stats";

export const ACCURACY_MODEL_NOTE =
  "GW1's predictions are unrecoverable: the archive didn't exist yet, and generate-predictions " +
  "deletes and replaces player_predictions on every run, so there is no snapshot of what the " +
  "model said before GW1's deadline and no honest way to reconstruct one — prices, availability " +
  "flags and fixture difficulty have all since moved. Every archived snapshot is the last " +
  "scheduled run before its gameweek's deadline, which can be up to 30 minutes stale (the " +
  "prediction job runs on a 30-minute cron), shown here via captured_at. A single gameweek's " +
  "bias/MAE/r is a sample of one, dominated by the Poisson-like variance in real match events " +
  "that the model does not claim to predict — treat it as a running count building toward " +
  "evidence, not a verdict on the model.";

export interface ArchivedPrediction {
  event: number;
  playerId: number;
  playerCode: number;
  fixture: number;
  modelVersion: string;
  xp: number;
  capturedAt: string;
  deadlineTime: string;
}

export interface AccuracyResidual extends Residual {
  event: number;
  playerId: number;
  positionCode: string | null;
  minutes: number;
}

export interface AccuracyReport {
  /** Archived gameweeks that had at least one scored fixture to join against. */
  events: number[];
  overall: ReturnType<typeof accuracyStats>;
  byPosition: Record<string, ReturnType<typeof accuracyStats>>;
}

const PAGE_ROWS = 1000;

/**
 * Pages a query past the API's 1000-row cap by re-issuing it with a growing
 * `.range()` until a short page comes back (CLAUDE.md: "the API caps every
 * response at 1000 rows whatever `.limit()` asks for"). Kept intentionally
 * simple — no head-count round trip first, unlike `lib/player-pool.ts` —
 * this module is queried a handful of times, not on every page render, so a
 * sequential page-until-short-page loop is plenty.
 */
async function fetchAllPages<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await build(from, from + PAGE_ROWS - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_ROWS) break;
    from += PAGE_ROWS;
  }
  return rows;
}

/** Every archived pre-deadline prediction for one gameweek, paged past the 1000-row cap. */
export async function loadArchivedPredictions(
  season: string,
  event: number,
): Promise<ArchivedPrediction[]> {
  const rows = await fetchAllPages<Record<string, unknown>>((from, to) =>
    supabase
      .from("player_prediction_archive")
      .select("event, player_id, player_code, fixture, model_version, xp, captured_at, deadline_time")
      .eq("season", season)
      .eq("event", event)
      .range(from, to),
  );

  return rows.map((r) => ({
    event: r.event as number,
    playerId: r.player_id as number,
    playerCode: r.player_code as number,
    fixture: r.fixture as number,
    modelVersion: r.model_version as string,
    xp: r.xp as number,
    capturedAt: r.captured_at as string,
    deadlineTime: r.deadline_time as string,
  }));
}

/** Which gameweeks the archive actually covers, for gating a UI on "enough n yet". */
export async function loadArchivedEvents(season: string): Promise<number[]> {
  const { data, error } = await supabase
    .from("player_prediction_archive")
    .select("event")
    .eq("season", season);
  if (error) throw new Error(error.message);
  return [...new Set((data ?? []).map((r) => r.event as number))].sort((a, b) => a - b);
}

interface ActualRow {
  playerCode: number;
  fixture: number;
  totalPoints: number;
  minutes: number;
}

async function loadActuals(season: string, event: number): Promise<ActualRow[]> {
  const rows = await fetchAllPages<Record<string, unknown>>((from, to) =>
    supabase
      .from("player_gameweek_stats")
      .select("player_code, fixture, total_points, minutes")
      .eq("season", season)
      .eq("event", event)
      .range(from, to),
  );
  return rows.map((r) => ({
    playerCode: r.player_code as number,
    fixture: r.fixture as number,
    totalPoints: (r.total_points as number | null) ?? 0,
    minutes: (r.minutes as number | null) ?? 0,
  }));
}

/**
 * Joins one gameweek's archived predictions to its real results, per fixture
 * (double-gameweek players contribute one residual per fixture, matching how
 * both the archive and `player_gameweek_stats` are keyed). Players with no
 * matching actuals row (didn't get transferred in / no stats row synced yet)
 * are silently excluded — an unmatched prediction is not a residual, it's
 * missing data, and folding it in as a zero would fabricate an observation.
 */
export async function scoreEvent(
  season: string,
  event: number,
  positionByCode: Map<number, string>,
): Promise<AccuracyResidual[]> {
  const [predictions, actuals] = await Promise.all([
    loadArchivedPredictions(season, event),
    loadActuals(season, event),
  ]);

  const actualByKey = new Map(actuals.map((a) => [`${a.playerCode}:${a.fixture}`, a]));

  const residuals: AccuracyResidual[] = [];
  for (const p of predictions) {
    const actual = actualByKey.get(`${p.playerCode}:${p.fixture}`);
    if (!actual) continue;
    residuals.push({
      event: p.event,
      playerId: p.playerId,
      pred: p.xp,
      actual: actual.totalPoints,
      minutes: actual.minutes,
      positionCode: positionByCode.get(p.playerCode) ?? null,
    });
  }
  return residuals;
}

/** Full accuracy report across every archived gameweek that has scored actuals to join against. */
export async function buildAccuracyReport(
  season: string,
  positionByCode: Map<number, string>,
): Promise<AccuracyReport> {
  const archivedEvents = await loadArchivedEvents(season);

  const perEvent = await Promise.all(
    archivedEvents.map((event) => scoreEvent(season, event, positionByCode)),
  );
  const allResiduals = perEvent.flat();
  const events = archivedEvents.filter((_, i) => perEvent[i].length > 0);

  const byPosition: Record<string, ReturnType<typeof accuracyStats>> = {};
  for (const pos of new Set(allResiduals.map((r) => r.positionCode).filter((p): p is string => p !== null))) {
    byPosition[pos] = accuracyStats(allResiduals.filter((r) => r.positionCode === pos));
  }

  return {
    events,
    overall: accuracyStats(allResiduals),
    byPosition,
  };
}
