// sync-claimed-managers
//
// Keeps every claimed FPL manager's data fresh in the background, so /team
// can read it straight from Supabase instead of blocking on a live FPL
// re-fetch on every page load (that blocking call — sync-manager, invoked
// synchronously from app/team/page.tsx's auto-connect effect — measured at
// 3.7s; see docs/sprints/latency.md item 5).
//
// Scheduled every 2 minutes, same cadence as sync-live-gameweek, and gated
// the same way: self-gating on whether a match is live right now
// (hasLiveFixture, _shared/sync.ts) rather than on a fixed clock.
//
//   - Matchday (a fixture is started and not finished): every claimed
//     manager is due every tick — the 2-minute cron schedule IS "every
//     switch", the same way sync-live-gameweek treats its own schedule.
//   - Non-matchday: a manager is due only once managers.updated_at (the
//     last successful sync — sync-manager's upsert is the only writer to
//     that table, so its trigger-maintained updated_at is a clean "last
//     synced" signal, no new column needed) is more than 24h old.
//   - Never synced (no `managers` row yet for a claimed entry_id): always
//     due, regardless of matchday, so a fresh claim doesn't wait up to a
//     day for its first real data.
//
// The actual per-manager sync is _shared/manager-sync.ts's syncManagerData
// — the same implementation sync-manager itself calls — so a manager synced
// by this cron and one synced by the client's own Refresh button write
// identically. One manager's failure doesn't abort the run: each is caught
// individually and reported in this function's own SyncRun details.

import {
  currentSeason,
  hasLiveFixture,
  jsonResponse,
  preflight,
  serviceClient,
  SyncRun,
} from "../_shared/sync.ts";
import { ManagerSyncError, syncManagerData } from "../_shared/manager-sync.ts";
import { verifyCron } from "../_shared/cron-auth.ts";

const FUNCTION_NAME = "sync-claimed-managers";
const MANAGER_CONCURRENCY = 3;
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

interface ManagerResult {
  entryId: number;
  ok: boolean;
  error?: string;
}

Deno.serve(async (req) => {
  const cors = preflight(req);
  if (cors) return cors;

  // Sprint 32 — cron-only: nothing in a browser has any business calling
  // this. Checked before any work at all, which is also what closes the
  // `?force=1` escape hatch rather than merely guarding it.
  const denied = verifyCron(req);
  if (denied) return denied;

  const db = serviceClient();
  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";

  const run = await SyncRun.start(db, FUNCTION_NAME);

  try {
    const season = await currentSeason(db);

    const { data: gw, error: gwError } = await db
      .from("gameweeks")
      .select("id")
      .eq("season", season)
      .eq("is_current", true)
      .maybeSingle();
    if (gwError) throw new Error(`gameweeks: ${gwError.message}`);

    const matchday = force ? true : gw ? await hasLiveFixture(db, season, gw.id) : false;

    const { data: profileRows, error: profileError } = await db
      .from("user_profiles")
      .select("entry_id")
      .not("entry_id", "is", null);
    if (profileError) throw new Error(`user_profiles: ${profileError.message}`);

    const claimed = [...new Set((profileRows ?? []).map((r) => r.entry_id as number))];

    if (claimed.length === 0) {
      await run.finish("skipped", { season, details: { reason: "no claimed managers" } });
      return jsonResponse({ ok: true, season, skipped: "no claimed managers" });
    }

    const { data: managerRows, error: managersError } = await db
      .from("managers")
      .select("entry_id, updated_at")
      .in("entry_id", claimed);
    if (managersError) throw new Error(`managers: ${managersError.message}`);

    const lastSyncedAt = new Map(
      (managerRows ?? []).map((r) => [r.entry_id as number, r.updated_at as string]),
    );

    const staleBefore = new Date(Date.now() - STALE_AFTER_MS).toISOString();
    const due = claimed.filter((entryId) => {
      const updatedAt = lastSyncedAt.get(entryId);
      if (!updatedAt) return true; // never synced — always due
      if (matchday) return true; // every claimed manager, every live tick
      return updatedAt < staleBefore;
    });

    if (due.length === 0) {
      await run.finish("skipped", {
        season,
        details: { reason: "nothing due", matchday, claimed: claimed.length },
      });
      return jsonResponse({ ok: true, season, matchday, due: 0, skipped: "nothing due" });
    }

    const results: ManagerResult[] = [];
    for (let i = 0; i < due.length; i += MANAGER_CONCURRENCY) {
      const batch = due.slice(i, i + MANAGER_CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(async (entryId): Promise<ManagerResult> => {
          try {
            await syncManagerData(db, season, entryId);
            return { entryId, ok: true };
          } catch (err) {
            const message = err instanceof ManagerSyncError || err instanceof Error
              ? err.message
              : String(err);
            console.error(`${FUNCTION_NAME}: entry ${entryId} failed: ${message}`);
            return { entryId, ok: false, error: message };
          }
        }),
      );
      results.push(...batchResults);
    }

    const failed = results.filter((r) => !r.ok);
    const status = failed.length === 0 ? "success" : failed.length === due.length ? "error" : "partial";

    await run.finish(status, {
      season,
      rowsWritten: results.length - failed.length,
      details: {
        matchday,
        claimed: claimed.length,
        due: due.length,
        synced: results.filter((r) => r.ok).map((r) => r.entryId),
        failed: failed.map((r) => ({ entryId: r.entryId, error: r.error })),
      },
    });

    return jsonResponse({
      ok: failed.length < due.length,
      season,
      matchday,
      due: due.length,
      synced: results.filter((r) => r.ok).map((r) => r.entryId),
      failed,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${FUNCTION_NAME} failed: ${message}`);
    await run.finish("error", { error: message });
    return jsonResponse({ ok: false, error: message }, 500);
  }
});
