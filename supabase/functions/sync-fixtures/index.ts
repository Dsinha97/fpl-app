// sync-fixtures
//
// Upserts all 380 fixtures and records reschedules. A fixture moving gameweek
// or kickoff time creates blanks and doubles, which drives chip planning, so
// the change itself is worth keeping rather than just the current state.
//
// Runs hourly.

import { getFixtures } from "../_shared/fpl.ts";
import { currentSeason, jsonResponse, preflight, serviceClient, SyncRun } from "../_shared/sync.ts";
import { bool, chunk, int, ts } from "../_shared/coerce.ts";

const FUNCTION_NAME = "sync-fixtures";

/** Fields whose changes are worth an audit row. */
const TRACKED = ["event", "kickoff_time"] as const;

Deno.serve(async (req) => {
  const cors = preflight(req);
  if (cors) return cors;

  const db = serviceClient();
  const run = await SyncRun.start(db, FUNCTION_NAME);

  try {
    const season = await currentSeason(db);
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
