// sync-claimed-managers
//
// Keeps every FPL manager this app tracks for somebody fresh in the
// background, so /team
// can read it straight from Supabase instead of blocking on a live FPL
// re-fetch on every page load (that blocking call — sync-manager, invoked
// synchronously from app/team/page.tsx's auto-connect effect — measured at
// 3.7s; see docs/sprints/latency.md item 5).
//
// Scheduled every 2 minutes, same cadence as sync-live-gameweek, and gated
// the same way: self-gating on whether a match is live right now
// (hasLiveFixture, _shared/sync.ts) rather than on a fixed clock.
//
// WHICH MANAGERS. Claimed entries (`user_profiles.entry_id`) **and** rivals
// (`manager_rivals.entry_id`). The rival half was missing until 2026-09-10,
// and the bug it caused is worth recording because it was invisible rather
// than loud: `addRival` syncs a candidate once, at the moment it is added, and
// nothing re-synced it afterwards. Three rivals added on 2026-08-20 — the day
// *before* GW1's deadline — were therefore frozen at a point when the season
// had no gameweek history at all, and still had `current_event = null` and
// zero `manager_gameweek_history` rows three gameweeks later. They rendered as
// a rival with no data rather than as an error, which is why nobody noticed.
//
// The one rival that looked fine was fine by coincidence: it is also a
// *claimed* entry, so this cron had been syncing it all along.
//
// Note the traffic shape this implies: the tracked set now grows with every
// rival anyone adds, and on matchday every tracked manager is synced every two
// minutes. MANAGER_CONCURRENCY bounds the burst but not the total. If the set
// ever gets large, the honest fix is a cap or a longer matchday interval for
// rivals specifically — not silently dropping some of them.
//
//   - Matchday (a fixture is started and not finished): every tracked
//     manager is due every tick — the 2-minute cron schedule IS "every
//     switch", the same way sync-live-gameweek treats its own schedule.
//   - Non-matchday: a manager is due only once `managers.last_success_at` is
//     more than 24h old. That column was added 2026-09-10 and replaces
//     `updated_at` here, which was the wrong signal: it is trigger-maintained
//     and means "row touched", and syncManagerData has to write the managers
//     row *before* the six tables that reference it — so a sync that failed at
//     step two marked itself fresh and blocked its own retry for a day.
//   - Never *completed* (no `managers` row, or a row whose last_success_at is
//     null): always due, regardless of matchday. A half-finished sync is now
//     indistinguishable from one that never ran, which is the correct reading
//     of both.
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

  const db = serviceClient();

  // Sprint 32 — cron-only: nothing in a browser has any business calling
  // this. Checked before any work at all, which is what closes the
  // `?force=1` escape hatch rather than merely guarding it — the URL below
  // is not even parsed until this passes.
  const denied = await verifyCron(req, db);
  if (denied) return denied;

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

    // Both halves of "tracked": the entries users have claimed as their own,
    // and the rivals they compare against. A rival is displayed with exactly
    // the same freshness expectation as a claim, so it earns the same refresh.
    const [
      { data: profileRows, error: profileError },
      { data: rivalRows, error: rivalError },
    ] = await Promise.all([
      db.from("user_profiles").select("entry_id").not("entry_id", "is", null),
      db.from("manager_rivals").select("entry_id"),
    ]);
    if (profileError) throw new Error(`user_profiles: ${profileError.message}`);
    if (rivalError) throw new Error(`manager_rivals: ${rivalError.message}`);

    const claimed = [...new Set((profileRows ?? []).map((r) => r.entry_id as number))];
    const rivals = [...new Set((rivalRows ?? []).map((r) => r.entry_id as number))];
    const tracked = [...new Set([...claimed, ...rivals])];

    if (tracked.length === 0) {
      await run.finish("skipped", { season, details: { reason: "no tracked managers" } });
      return jsonResponse({ ok: true, season, skipped: "no tracked managers" });
    }

    const { data: managerRows, error: managersError } = await db
      .from("managers")
      .select("entry_id, last_success_at")
      .in("entry_id", tracked);
    if (managersError) throw new Error(`managers: ${managersError.message}`);

    const lastSuccessAt = new Map(
      (managerRows ?? [])
        .filter((r) => r.last_success_at)
        .map((r) => [r.entry_id as number, r.last_success_at as string]),
    );

    const staleBefore = new Date(Date.now() - STALE_AFTER_MS).toISOString();
    const due = tracked.filter((entryId) => {
      const succeededAt = lastSuccessAt.get(entryId);
      if (!succeededAt) return true; // never completed — always due
      if (matchday) return true; // every tracked manager, every live tick
      return succeededAt < staleBefore;
    });

    if (due.length === 0) {
      await run.finish("skipped", {
        season,
        details: {
          reason: "nothing due",
          matchday,
          tracked: tracked.length,
          claimed: claimed.length,
          rivals: rivals.length,
        },
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
        tracked: tracked.length,
        claimed: claimed.length,
        rivals: rivals.length,
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
