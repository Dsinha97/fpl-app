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
import {
  currentSeason,
  jsonResponse,
  preflight,
  serviceClient,
  SyncRun,
  withCors,
} from "../_shared/sync.ts";
import { ManagerNotFoundError, ManagerSyncError, syncManagerData } from "../_shared/manager-sync.ts";
import { verifyUser } from "../_shared/auth.ts";
import {
  checkRateLimit,
  loadRateLimit,
  rateLimitMessage,
  recordRejection,
} from "../_shared/rate-limit.ts";

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

Deno.serve(
  withCors(async (req) => {
    const cors = preflight(req);
    if (cors) return cors;

    const db = serviceClient();

    // Sprint 32 — Class B. This one has a real browser caller, so it stays
    // reachable, but not by everyone: signed in, and inside a per-user limit.
    // "Anyone with an account" is not a bound on its own — accounts are free.
    const user = await verifyUser(req);
    if (!user) {
      return jsonResponse({ ok: false, error: "sign in to refresh your team" }, 401);
    }

    // currentSeason throws on an empty database. It sits outside the
    // SyncRun try below, and an escaping throw would 500 without CORS
    // headers — which reaches the browser as an opaque CORS failure
    // rather than a message the button can show.
    let season: string;
    try {
      season = await currentSeason(db);
    } catch (err) {
      return jsonResponse({ ok: false, error: (err as Error).message }, 503);
    }
    const limit = await loadRateLimit(db, season);
    const verdict = await checkRateLimit(db, FUNCTION_NAME, user.id, limit);
    if (!verdict.allowed) {
      await recordRejection(db, FUNCTION_NAME, user.id, verdict);
      return jsonResponse({ ok: false, error: rateLimitMessage(limit) }, 429);
    }

    let entryId: number;
    try {
      entryId = await parseEntryId(req);
    } catch (err) {
      return jsonResponse({ ok: false, error: (err as Error).message }, 400);
    }

    const run = await SyncRun.start(db, FUNCTION_NAME, season, user.id);

    try {
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
      await run.finish("error", {
        error: message,
        details: { entry_id: entryId, ...partialCounts },
      });
      return jsonResponse({ ok: false, error: message }, 500);
    }
  }),
);
