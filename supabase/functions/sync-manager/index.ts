// sync-manager
//
// On-demand ingestion of one FPL entry: profile, past-season history,
// current-season gameweek history, picks, transfers, and chips.
//
// Invoked from the frontend when a user connects (or refreshes) a Manager ID:
//   POST { "entry_id": 123456 }
//
// The actual fetch-and-write logic lives in _shared/manager-sync.ts, shared
// with sync-claimed-managers (the cron job that keeps claimed managers'
// data fresh in the background — see that function's own header). This
// function is now just the HTTP wrapper: parse the request, call the shared
// sync, and report the result via SyncRun — unchanged from before the split.

import { FplHttpError, int } from "../_shared/fpl.ts";
import { currentSeason, jsonResponse, preflight, serviceClient, SyncRun } from "../_shared/sync.ts";
import { ManagerNotFoundError, ManagerSyncError, syncManagerData } from "../_shared/manager-sync.ts";

const FUNCTION_NAME = "sync-manager";

async function parseEntryId(req: Request): Promise<number> {
  const url = new URL(req.url);
  let raw: unknown = url.searchParams.get("entry_id");

  if (raw === null && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    raw = (body as Record<string, unknown>).entry_id;
  }

  const id = int(raw);
  if (id === null || id <= 0) {
    throw new FplHttpError(400, "entry_id must be a positive integer");
  }
  return id;
}

Deno.serve(async (req) => {
  const cors = preflight(req);
  if (cors) return cors;

  const db = serviceClient();

  let entryId: number;
  try {
    entryId = await parseEntryId(req);
  } catch (err) {
    return jsonResponse({ ok: false, error: (err as Error).message }, 400);
  }

  const run = await SyncRun.start(db, FUNCTION_NAME);

  try {
    const season = await currentSeason(db);

    let counts: Record<string, number>;
    try {
      counts = await syncManagerData(db, season, entryId);
    } catch (err) {
      if (err instanceof ManagerNotFoundError) {
        await run.finish("error", { season, error: `entry ${entryId} not found` });
        return jsonResponse({ ok: false, error: err.message }, 404);
      }
      throw err;
    }

    const rowsWritten = Object.values(counts).reduce((a, b) => a + b, 0);
    await run.finish("success", {
      season,
      rowsWritten,
      details: { entry_id: entryId, ...counts },
    });

    return jsonResponse({ ok: true, season, entry_id: entryId, counts });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${FUNCTION_NAME} failed for entry ${entryId}: ${message}`);
    const partialCounts = err instanceof ManagerSyncError ? err.counts : {};
    await run.finish("error", { error: message, details: { entry_id: entryId, ...partialCounts } });
    return jsonResponse({ ok: false, error: message }, 500);
  }
});
