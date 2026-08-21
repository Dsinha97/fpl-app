// sync-fixtures
//
// Upserts all 380 fixtures and records reschedules. A fixture moving gameweek
// or kickoff time creates blanks and doubles, which drives chip planning, so
// the change itself is worth keeping rather than just the current state.
//
// Runs every 2 minutes but self-gating, the same shape sync-live-gameweek
// and sync-player-history already use (see the scheduling migration's own
// comment: "avoid unnecessarily aggressive polling... self-gating, so their
// short intervals cost one cheap query on most invocations"). This one can't
// gate on fixtures.started/finished the way sync-live-gameweek gates on
// them — those are exactly the columns this function exists to refresh, so
// trusting them here would let a stale "not started" suppress the very sync
// that would correct it. It gates on kickoff_time instead, which doesn't go
// stale on this timescale: a fixture kicking off soon or in the last few
// hours (covers delays/stoppage time) always gets the full pull; anything
// quieter falls back to an hourly floor so the rest of the day (price
// moves, postponements) still refreshes without polling every 2 minutes for
// no reason.

import { getFixtures } from "../_shared/fpl.ts";
import { currentSeason, jsonResponse, preflight, serviceClient, SyncRun } from "../_shared/sync.ts";
import { bool, chunk, int, ts } from "../_shared/coerce.ts";

const FUNCTION_NAME = "sync-fixtures";

/** Fields whose changes are worth an audit row. */
const TRACKED = ["event", "kickoff_time"] as const;

const LIVE_WINDOW_HOURS = 3;
const FORCE_INTERVAL_MINUTES = 55;

Deno.serve(async (req) => {
  const cors = preflight(req);
  if (cors) return cors;

  const db = serviceClient();
  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";

  const run = await SyncRun.start(db, FUNCTION_NAME);

  try {
    const season = await currentSeason(db);

    if (!force) {
      const now = new Date();
      const windowStart = new Date(now.getTime() - LIVE_WINDOW_HOURS * 3_600_000).toISOString();
      const windowEnd = new Date(now.getTime() + 15 * 60_000).toISOString();

      const { count: imminentOrLive, error: fixturesError } = await db
        .from("fixtures")
        .select("id", { count: "exact", head: true })
        .eq("season", season)
        .gte("kickoff_time", windowStart)
        .lte("kickoff_time", windowEnd);
      if (fixturesError) throw new Error(`fixtures: ${fixturesError.message}`);

      if (!imminentOrLive) {
        const { data: lastSuccess } = await db
          .from("sync_runs")
          .select("finished_at")
          .eq("function_name", FUNCTION_NAME)
          .eq("status", "success")
          .order("finished_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const minutesSince = lastSuccess?.finished_at
          ? (now.getTime() - new Date(lastSuccess.finished_at).getTime()) / 60_000
          : Infinity;

        if (minutesSince < FORCE_INTERVAL_MINUTES) {
          await run.finish("skipped", {
            season,
            details: { reason: "no fixture imminent or live, synced recently", minutesSince },
          });
          return jsonResponse({ ok: true, season, skipped: "no fixture imminent or live" });
        }
      }
    }

    const fixtures = await getFixtures();

    // Existing state, to diff against before overwriting it.
    const { data: existingRows, error: existingError } = await db
      .from("fixtures")
      .select("id, event, kickoff_time")
      .eq("season", season);
    if (existingError) throw new Error(`fixtures read: ${existingError.message}`);

    const existing = new Map(
      (existingRows ?? []).map((f) => [f.id as number, f as Record<string, unknown>]),
    );

    // ------------------------------------------------------------ changes

    const changes: Record<string, unknown>[] = [];

    for (const f of fixtures) {
      const before = existing.get(f.id);
      if (!before) continue; // first sight of a fixture is not a change

      for (const field of TRACKED) {
        // Normalise both sides so a timestamp formatting difference does not
        // register as a reschedule.
        const oldValue = field === "kickoff_time"
          ? ts(before.kickoff_time)
          : before.event === null || before.event === undefined
          ? null
          : String(before.event);
        const newValue = field === "kickoff_time"
          ? ts(f.kickoff_time)
          : f.event === null || f.event === undefined
          ? null
          : String(f.event);

        if (oldValue !== newValue) {
          changes.push({
            season,
            fixture_id: f.id,
            field,
            old_value: oldValue,
            new_value: newValue,
          });
        }
      }
    }

    if (changes.length > 0) {
      const { error } = await db.from("fixture_changes").insert(changes);
      if (error) throw new Error(`fixture_changes: ${error.message}`);
    }

    // ----------------------------------------------------------- fixtures

    const rows = fixtures.map((f) => ({
      season,
      id: f.id,
      code: int(f.code),
      event: int(f.event),
      kickoff_time: ts(f.kickoff_time),
      provisional_start_time: bool(f.provisional_start_time),
      team_h: f.team_h,
      team_a: f.team_a,
      team_h_score: int(f.team_h_score),
      team_a_score: int(f.team_a_score),
      team_h_difficulty: int(f.team_h_difficulty),
      team_a_difficulty: int(f.team_a_difficulty),
      started: bool(f.started),
      finished: bool(f.finished),
      finished_provisional: bool(f.finished_provisional),
      minutes: int(f.minutes),
      pulse_id: int(f.pulse_id),
      stats: f.stats ?? null,
      raw: f,
    }));

    for (const batch of chunk(rows, 200)) {
      const { error } = await db.from("fixtures").upsert(batch, { onConflict: "season,id" });
      if (error) throw new Error(`fixtures: ${error.message}`);
    }

    await run.finish("success", {
      season,
      rowsWritten: rows.length + changes.length,
      details: { fixtures: rows.length, changes: changes.length },
    });

    return jsonResponse({ ok: true, season, fixtures: rows.length, changes: changes.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${FUNCTION_NAME} failed: ${message}`);
    await run.finish("error", { error: message });
    return jsonResponse({ ok: false, error: message }, 500);
  }
});
