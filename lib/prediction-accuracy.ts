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
  "evidence, not a verdict on the model. A gameweek is scored over only those of its fixtures " +
  "whose results have actually landed in the warehouse: sync-player-history runs a full pass " +
  "every 20 hours, so for several hours after a matchday some fixtures are played but not yet " +
  "written, and counting those as real zero-point returns would make the model look far more " +
  "over-generous than it is. Any gameweek scored on a subset of its fixtures says so below.";

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

/**
 * How much of one gameweek the residuals actually cover.
 *
 * `fixturesScored` counts fixtures whose results have landed; `fixturesTotal`
 * is how many the gameweek has at all, and is null for a season `fixtures`
 * does not hold (it carries the current season only). `fixturesTotal` is
 * deliberately every fixture, played or not — "6 of 10" is the true statement
 * either way, and it avoids leaning on `fixtures.finished_provisional`, which
 * was observed true on 2026-09-20 for GW5 fixtures that had neither confirmed
 * bonus nor any stats row at all.
 */
export interface EventCoverage {
  event: number;
  fixturesScored: number;
  fixturesTotal: number | null;
}

/** One gameweek's residuals plus how much of that gameweek they cover. */
export interface EventScore {
  event: number;
  residuals: AccuracyResidual[];
  coverage: EventCoverage;
}

export interface AccuracyReport {
  /** Archived gameweeks that had at least one scored fixture to join against. */
  events: number[];
  /** Coverage for each of `events`, in the same order. */
  coverage: EventCoverage[];
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

/**
 * Which gameweeks the archive actually covers, for gating a UI on "enough n yet".
 *
 * Walks the distinct events one at a time — `.gt(event, last).order(event).limit(1)`
 * — rather than selecting the `event` column and de-duplicating client-side. The
 * archive holds roughly one row per player per fixture (~640 per gameweek), so a
 * single unpaged select hits the API's 1000-row cap during the *second* archived
 * gameweek and silently reports only the first (CLAUDE.md: "the API caps every
 * response at 1000 rows whatever `.limit()` asks for"). Paging the whole column
 * would also be correct but reads ~24,000 rows by the end of a season to learn 38
 * integers; this costs one single-row round trip per distinct event plus one to
 * terminate.
 */
export async function loadArchivedEvents(season: string): Promise<number[]> {
  const events: number[] = [];
  let last = -1;
  for (;;) {
    const { data, error } = await supabase
      .from("player_prediction_archive")
      .select("event")
      .eq("season", season)
      .gt("event", last)
      .order("event", { ascending: true })
      .limit(1);
    if (error) throw new Error(error.message);
    const next = (data ?? [])[0]?.event as number | undefined;
    if (next === undefined) break;
    events.push(next);
    last = next;
  }
  return events;
}

/**
 * `players.code` -> position short code, the join key `scoreEvent` needs.
 *
 * Lives here rather than in the panel so the 1000-row cap is handled in one
 * place: the player table sits just under the cap today (~700 rows) and would
 * silently truncate the moment it crossed it, dropping those players' position
 * from the per-position split without dropping them from the overall figure.
 */
export async function loadPositionByCode(season: string): Promise<Map<number, string>> {
  const [players, types] = await Promise.all([
    fetchAllPages<Record<string, unknown>>((from, to) =>
      supabase
        .from("players")
        .select("code, element_type")
        .eq("season", season)
        .range(from, to),
    ),
    supabase.from("element_types").select("id, singular_name_short").eq("season", season),
  ]);
  if (types.error) throw new Error(types.error.message);

  const nameById = new Map(
    (types.data ?? []).map((t) => [t.id as number, t.singular_name_short as string]),
  );
  const byCode = new Map<number, string>();
  for (const p of players) {
    const name = nameById.get(p.element_type as number);
    if (name) byCode.set(p.code as number, name);
  }
  return byCode;
}

/**
 * How many fixtures each gameweek has, for the "scored 6 of 10" denominator.
 *
 * `fixtures` holds the current season only (380 rows), which is also the only
 * season the archive covers — so a missing entry means "no denominator
 * available", not "zero fixtures", and callers state the numerator alone
 * rather than inventing one.
 */
export async function loadFixtureCountByEvent(season: string): Promise<Map<number, number>> {
  const rows = await fetchAllPages<Record<string, unknown>>((from, to) =>
    supabase.from("fixtures").select("event").eq("season", season).range(from, to),
  );
  const byEvent = new Map<number, number>();
  for (const r of rows) {
    const event = r.event as number | null;
    if (event === null) continue;
    byEvent.set(event, (byEvent.get(event) ?? 0) + 1);
  }
  return byEvent;
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
 * Which of a gameweek's fixtures have results that have actually landed.
 *
 * A fixture counts as landed once any player in it has real minutes. Nothing
 * subtler is needed and nothing subtler is trustworthy: every played fixture
 * puts 22+ players on the pitch, so a fixture whose every row reads
 * `minutes = 0` has not been written yet. Checked against the whole
 * warehouse on 2026-09-20 — across the four settled seasons (~150
 * gameweeks) every fixture with stats rows also had minutes, and the single
 * exception anywhere was 2026-27 GW5 mid-sync, which is precisely the case
 * this exists to catch. `fixtures.finished` / `finished_provisional` are NOT
 * used: both were true for GW5 fixtures that had no stats row at all.
 */
function landedFixtures(actuals: ActualRow[]): Set<number> {
  const landed = new Set<number>();
  for (const a of actuals) if (a.minutes > 0) landed.add(a.fixture);
  return landed;
}

/**
 * Joins one gameweek's archived predictions to its real results, per fixture
 * (double-gameweek players contribute one residual per fixture, matching how
 * both the archive and `player_gameweek_stats` are keyed). Players with no
 * matching actuals row (didn't get transferred in / no stats row synced yet)
 * are silently excluded — an unmatched prediction is not a residual, it's
 * missing data, and folding it in as a zero would fabricate an observation.
 *
 * The same reasoning now covers a whole fixture. `sync-player-history` does a
 * full pass only every 20 hours, so for several hours after a matchday a
 * fixture can have a complete set of `player_gameweek_stats` rows that are
 * all zeros. Those rows join, so they used to become residuals — a blank
 * return for every player who in fact played. Observed live on 2026-09-20:
 * four of GW5's ten fixtures were in that state, and the panel reported the
 * gameweek's bias as −0.589 when the real figure was −0.006. Fixtures that
 * have not landed are excluded here and *counted*, so the panel can say how
 * much of the gameweek it is actually reporting rather than presenting a
 * partial gameweek as a whole one.
 */
export async function scoreEvent(
  season: string,
  event: number,
  positionByCode: Map<number, string>,
  fixturesTotal: number | null = null,
): Promise<EventScore> {
  const [predictions, actuals] = await Promise.all([
    loadArchivedPredictions(season, event),
    loadActuals(season, event),
  ]);

  const landed = landedFixtures(actuals);
  const actualByKey = new Map(
    actuals.filter((a) => landed.has(a.fixture)).map((a) => [`${a.playerCode}:${a.fixture}`, a]),
  );

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
  return {
    event,
    residuals,
    coverage: { event, fixturesScored: landed.size, fixturesTotal },
  };
}

/** Full accuracy report across every archived gameweek that has scored actuals to join against. */
export async function buildAccuracyReport(
  season: string,
  positionByCode: Map<number, string>,
): Promise<AccuracyReport> {
  const archivedEvents = await loadArchivedEvents(season);

  const fixtureCounts = await loadFixtureCountByEvent(season);

  const perEvent = await Promise.all(
    archivedEvents.map((event) =>
      scoreEvent(season, event, positionByCode, fixtureCounts.get(event) ?? null),
    ),
  );
  // A gameweek with no landed fixture contributes nothing and is not listed as
  // scored — but it is not silently dropped either: `coverage` still carries
  // its 0-of-N, so "GW6 hasn't been scored yet" can be said rather than left
  // to be inferred from an absence.
  const scored = perEvent.filter((e) => e.residuals.length > 0);
  const allResiduals = scored.flatMap((e) => e.residuals);
  const events = scored.map((e) => e.event);

  const byPosition: Record<string, ReturnType<typeof accuracyStats>> = {};
  for (const pos of new Set(allResiduals.map((r) => r.positionCode).filter((p): p is string => p !== null))) {
    byPosition[pos] = accuracyStats(allResiduals.filter((r) => r.positionCode === pos));
  }

  return {
    events,
    coverage: scored.map((e) => e.coverage),
    overall: accuracyStats(allResiduals),
    byPosition,
  };
}
